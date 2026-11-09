#include "RewildFighter.h"
#include "RewildPlanet.h"

#include "Camera/CameraComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EngineUtils.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/LocalPlayer.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "RewildBolts.h"
#include "RewildDrone.h"
#include "RewildExplosion.h"
#include "RewildHealthComponent.h"
#include "RewildMissiles.h"
#include "RewildReaper.h"
#include "RewildRadio.h"
#include "RewildWingman.h"
#include "RewildHUD.h"
#include "RewildMission.h"
#include "RewildSave.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr int32 DustCount = 600;
	constexpr float DustHalfBox = 6000.f;  // specks fill a 120 m box round the camera
	constexpr float DustScale = 0.06f;     // 6 cm specks (the engine sphere is 1 m across)
	constexpr float TargetCone = 35.f;     // degrees from the nose
	constexpr float TargetRange = 250000.f;  // 2.5 km
	constexpr float RespawnTime = 4.f;

	const FName EngineSlot(TEXT("M_Engine_Glow"));
	const FName EyeSocket(TEXT("Cockpit_Eye"));
	const FName GunLeft(TEXT("Gun_L"));
	const FName GunRight(TEXT("Gun_R"));

	/** Time for a bolt (speed BoltSpeed, plus the shooter's velocity) to meet a target; false if it never can. */
	bool SolveLead(const FVector& Offset, const FVector& RelativeVelocity, float BoltSpeed, float& OutTime)
	{
		const float A = RelativeVelocity.SizeSquared() - BoltSpeed * BoltSpeed;
		const float B = 2.f * FVector::DotProduct(Offset, RelativeVelocity);
		const float C = Offset.SizeSquared();
		if (FMath::Abs(A) < 1e-3f)
		{
			OutTime = B < 0.f ? -C / B : -1.f;
			return OutTime > 0.f;
		}
		const float Disc = B * B - 4.f * A * C;
		if (Disc < 0.f)
		{
			return false;
		}
		const float Root = FMath::Sqrt(Disc);
		const float T1 = (-B - Root) / (2.f * A);
		const float T2 = (-B + Root) / (2.f * A);
		OutTime = (T1 > 0.f && (T1 < T2 || T2 <= 0.f)) ? T1 : T2;
		return OutTime > 0.f;
	}
}

ARewildFighter::ARewildFighter()
{
	PrimaryActorTick.bCanEverTick = true;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> BodyMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_Body.Fighter_Body"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> GlassMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_CanopyGlass.Fighter_CanopyGlass"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> ShieldMat(TEXT("/Game/FirstFight/FX/M_FX_Shield.M_FX_Shield"));

	Hull = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Hull"));
	SetRootComponent(Hull);
	Hull->SetStaticMesh(BodyMesh.Object);
	// Only bolts (visibility traces) touch the hull; the fighter always spawns (with a blocking profile the game
	// refused to spawn it, 8 Nov 2026).
	Hull->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Hull->SetCollisionObjectType(ECC_Pawn);
	Hull->SetCollisionResponseToAllChannels(ECR_Ignore);
	Hull->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);
	SpawnCollisionHandlingMethod = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	Canopy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Canopy"));
	Canopy->SetupAttachment(Hull);
	Canopy->SetStaticMesh(GlassMesh.Object);
	Canopy->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	// The shield: an ellipsoid just clear of the hull (15.2 x 13.3 x 3.1 m), seen only as a flash where it is hit.
	ShieldBubble = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ShieldBubble"));
	ShieldBubble->SetupAttachment(Hull);
	ShieldBubble->SetStaticMesh(SphereMesh.Object);
	if (ShieldMat.Object)
	{
		ShieldBubble->SetMaterial(0, ShieldMat.Object);
	}
	ShieldBubble->SetRelativeScale3D(FVector(17.f, 15.f, 5.f));
	ShieldBubble->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ShieldBubble->SetCastShadow(false);
	ShieldBubble->SetVisibility(false);

	// Chase camera: 15.5 m back, looking 10 degrees down over the spine, lagging a little behind turns.
	ChaseArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("ChaseArm"));
	ChaseArm->SetupAttachment(Hull);
	ChaseArm->TargetArmLength = 1550.f;
	ChaseArm->SetRelativeRotation(FRotator(-10.f, 0.f, 0.f));
	ChaseArm->SocketOffset = FVector(0.f, 0.f, 150.f);
	ChaseArm->bDoCollisionTest = false;
	ChaseArm->bEnableCameraLag = true;
	ChaseArm->CameraLagSpeed = 10.f;
	ChaseArm->CameraLagMaxDistance = 250.f;  // lag trails speed / lag speed: 42 m on boost, and the ship shrank away
	ChaseArm->bEnableCameraRotationLag = true;
	ChaseArm->CameraRotationLagSpeed = 7.f;

	ChaseCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("ChaseCamera"));
	ChaseCamera->SetupAttachment(ChaseArm, USpringArmComponent::SocketName);
	ChaseCamera->SetFieldOfView(70.f);

	// Cockpit camera at the pilot's eye; a wide view, as in the approved cockpit concept.
	CockpitCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("CockpitCamera"));
	CockpitCamera->SetupAttachment(Hull);
	CockpitCamera->SetFieldOfView(90.f);
	CockpitCamera->SetAutoActivate(false);

	Dust = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Dust"));
	Dust->SetupAttachment(Hull);
	Dust->SetUsingAbsoluteLocation(true);
	Dust->SetUsingAbsoluteRotation(true);
	Dust->SetUsingAbsoluteScale(true);
	Dust->SetStaticMesh(SphereMesh.Object);
	Dust->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Dust->SetCastShadow(false);

	Health = CreateDefaultSubobject<URewildHealthComponent>(TEXT("Health"));
	Health->ShieldMax = 100.f;
	Health->HullMax = 100.f;
	Health->ShieldRegenDelay = 4.f;  // a hard game: the shield waits longer and refills slower (owner, 9 Nov 2026)
	Health->ShieldRegenRate = 20.f;
	Health->Team = 0;

	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void ARewildFighter::BeginPlay()
{
	Super::BeginPlay();
	Start = GetActorTransform();
	Planet = ARewildPlanet::Find(GetWorld());

	// The eye socket gives the cockpit camera its place; it always looks along the hull.
	if (Hull->DoesSocketExist(EyeSocket))
	{
		CockpitCamera->SetRelativeLocation(Hull->GetSocketTransform(EyeSocket, RTS_Component).GetLocation());
	}
	const int32 Slot = Hull->GetMaterialIndex(EngineSlot);
	if (Slot != INDEX_NONE)
	{
		EngineGlow = Hull->CreateDynamicMaterialInstance(Slot);
	}
	ShieldMaterial = ShieldBubble->CreateDynamicMaterialInstance(0);

	FRandomStream Random(1717);
	DustOffsets.SetNum(DustCount);
	TArray<FTransform> Instances;
	for (FVector& P : DustOffsets)
	{
		P = GetActorLocation() + FVector(Random.FRandRange(-DustHalfBox, DustHalfBox),
			Random.FRandRange(-DustHalfBox, DustHalfBox), Random.FRandRange(-DustHalfBox, DustHalfBox));
		Instances.Add(FTransform(FRotator::ZeroRotator, P, FVector(DustScale)));
	}
	Dust->AddInstances(Instances, false, true);

	Health->Restore();
	Health->OnHit.AddUObject(this, &ARewildFighter::HandleHit);
	Health->OnDeath.AddUObject(this, &ARewildFighter::HandleDeath);
	if (URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>())
	{
		Bolts->OnBoltHit.AddUObject(this, &ARewildFighter::HandleBoltHit);
	}
	if (URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>())
	{
		Ms->OnMissileHit.AddUObject(this, &ARewildFighter::HandleMissileHit);
	}
	Missiles = MissileCapacity;
	Flares = FlareCapacity;
	ApplySettings();
	Health->bInvulnerable = FParse::Param(FCommandLine::Get(), TEXT("RewildInvulnerable"));  // tests reaching the end

	BuildInput();
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Input = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			Input->AddMappingContext(Mapping, 0);
		}
	}

	Velocity = GetActorForwardVector() * CruiseSpeedMax * Throttle * 100.f;
	bDemo = FParse::Param(FCommandLine::Get(), TEXT("RewildDemo"));
}

void ARewildFighter::BuildInput()
{
	if (Mapping)
	{
		return;
	}
	Mapping = NewObject<UInputMappingContext>(this, TEXT("FighterControls"));

	auto Action = [this](const TCHAR* Name, EInputActionValueType Type)
	{
		UInputAction* A = NewObject<UInputAction>(this, Name);
		A->ValueType = Type;
		return A;
	};
	auto Negated = [this](const UInputAction* A, const FKey& Key)
	{
		FEnhancedActionKeyMapping& M = Mapping->MapKey(A, Key);
		M.Modifiers.Add(NewObject<UInputModifierNegate>(this));
	};

	LookAction = Action(TEXT("Look"), EInputActionValueType::Axis2D);
	Mapping->MapKey(LookAction, EKeys::Mouse2D);

	StickAction = Action(TEXT("Stick"), EInputActionValueType::Axis2D);
	Mapping->MapKey(StickAction, EKeys::Gamepad_Left2D);

	RollAction = Action(TEXT("Roll"), EInputActionValueType::Axis1D);
	Mapping->MapKey(RollAction, EKeys::D);
	Negated(RollAction, EKeys::A);
	Mapping->MapKey(RollAction, EKeys::Gamepad_RightX);

	ThrottleAction = Action(TEXT("Throttle"), EInputActionValueType::Axis1D);
	Mapping->MapKey(ThrottleAction, EKeys::W);
	Negated(ThrottleAction, EKeys::S);
	Mapping->MapKey(ThrottleAction, EKeys::Gamepad_RightY);

	BoostAction = Action(TEXT("Boost"), EInputActionValueType::Boolean);
	Mapping->MapKey(BoostAction, EKeys::LeftShift);
	Mapping->MapKey(BoostAction, EKeys::Gamepad_FaceButton_Bottom);

	FireAction = Action(TEXT("Fire"), EInputActionValueType::Boolean);
	Mapping->MapKey(FireAction, EKeys::LeftMouseButton);
	Mapping->MapKey(FireAction, EKeys::Gamepad_RightTrigger);

	MissileAction = Action(TEXT("Missile"), EInputActionValueType::Boolean);
	Mapping->MapKey(MissileAction, EKeys::RightMouseButton);
	Mapping->MapKey(MissileAction, EKeys::Gamepad_LeftTrigger);

	FlareAction = Action(TEXT("Flares"), EInputActionValueType::Boolean);
	Mapping->MapKey(FlareAction, EKeys::F);
	Mapping->MapKey(FlareAction, EKeys::Gamepad_FaceButton_Right);

	const FKey OrderKeys[4][2] = {{EKeys::One, EKeys::Gamepad_DPad_Up}, {EKeys::Two, EKeys::Gamepad_DPad_Right},
		{EKeys::Three, EKeys::Gamepad_DPad_Down}, {EKeys::Four, EKeys::Gamepad_DPad_Left}};
	const TCHAR* OrderNames[4] = {TEXT("OrderAttack"), TEXT("OrderCover"), TEXT("OrderFormUp"), TEXT("OrderFree")};
	for (int32 I = 0; I < 4; ++I)
	{
		UInputAction* A = Action(OrderNames[I], EInputActionValueType::Boolean);
		Mapping->MapKey(A, OrderKeys[I][0]);
		Mapping->MapKey(A, OrderKeys[I][1]);
		OrderActions.Add(A);
	}

	CameraAction = Action(TEXT("Camera"), EInputActionValueType::Boolean);
	Mapping->MapKey(CameraAction, EKeys::C);
	Mapping->MapKey(CameraAction, EKeys::Gamepad_RightThumbstick);

	QuitAction = Action(TEXT("Pause"), EInputActionValueType::Boolean);
	Mapping->MapKey(QuitAction, EKeys::Escape);
	Mapping->MapKey(QuitAction, EKeys::Gamepad_Special_Right);
}

void ARewildFighter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	BuildInput();
	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input)
	{
		return;
	}
	Input->BindAction(LookAction, ETriggerEvent::Triggered, this, &ARewildFighter::OnLook);
	Input->BindAction(StickAction, ETriggerEvent::Triggered, this, &ARewildFighter::OnStick);
	Input->BindAction(StickAction, ETriggerEvent::Completed, this, &ARewildFighter::OnStickReleased);
	Input->BindAction(RollAction, ETriggerEvent::Triggered, this, &ARewildFighter::OnRoll);
	Input->BindAction(RollAction, ETriggerEvent::Completed, this, &ARewildFighter::OnRollReleased);
	Input->BindAction(ThrottleAction, ETriggerEvent::Triggered, this, &ARewildFighter::OnThrottle);
	Input->BindAction(ThrottleAction, ETriggerEvent::Completed, this, &ARewildFighter::OnThrottleReleased);
	Input->BindAction(BoostAction, ETriggerEvent::Started, this, &ARewildFighter::OnBoost);
	Input->BindAction(BoostAction, ETriggerEvent::Completed, this, &ARewildFighter::OnBoostReleased);
	Input->BindAction(FireAction, ETriggerEvent::Started, this, &ARewildFighter::OnFire);
	Input->BindAction(FireAction, ETriggerEvent::Completed, this, &ARewildFighter::OnFireReleased);
	Input->BindAction(MissileAction, ETriggerEvent::Started, this, &ARewildFighter::OnMissile);
	Input->BindAction(FlareAction, ETriggerEvent::Started, this, &ARewildFighter::OnFlares);
	Input->BindAction(OrderActions[0], ETriggerEvent::Started, this, &ARewildFighter::OnOrderAttack);
	Input->BindAction(OrderActions[1], ETriggerEvent::Started, this, &ARewildFighter::OnOrderCover);
	Input->BindAction(OrderActions[2], ETriggerEvent::Started, this, &ARewildFighter::OnOrderFormUp);
	Input->BindAction(OrderActions[3], ETriggerEvent::Started, this, &ARewildFighter::OnOrderFree);
	Input->BindAction(CameraAction, ETriggerEvent::Started, this, &ARewildFighter::OnCamera);
	Input->BindAction(QuitAction, ETriggerEvent::Started, this, &ARewildFighter::OnQuit);
}

void ARewildFighter::OnLook(const FInputActionValue& Value)
{
	AimCursor += Value.Get<FVector2D>() * MouseSensitivity;
	if (AimCursor.Size() > 1.f)
	{
		AimCursor.Normalize();
	}
}

void ARewildFighter::OnStick(const FInputActionValue& Value) { Stick = Value.Get<FVector2D>(); }
void ARewildFighter::OnStickReleased(const FInputActionValue&) { Stick = FVector2D::ZeroVector; }
void ARewildFighter::OnRoll(const FInputActionValue& Value) { RollInput = Value.Get<float>(); }
void ARewildFighter::OnRollReleased(const FInputActionValue&) { RollInput = 0.f; }
void ARewildFighter::OnThrottle(const FInputActionValue& Value) { ThrottleInput = Value.Get<float>(); }
void ARewildFighter::OnThrottleReleased(const FInputActionValue&) { ThrottleInput = 0.f; }
void ARewildFighter::OnBoost(const FInputActionValue&) { bBoostHeld = true; }
void ARewildFighter::OnBoostReleased(const FInputActionValue&) { bBoostHeld = false; }
void ARewildFighter::OnFire(const FInputActionValue&) { bFireHeld = true; }
void ARewildFighter::OnFireReleased(const FInputActionValue&) { bFireHeld = false; }
void ARewildFighter::OnCamera(const FInputActionValue&) { SetCockpitView(!bCockpitView); }
void ARewildFighter::OnMissile(const FInputActionValue&) { FireMissile(); }
void ARewildFighter::OnFlares(const FInputActionValue&) { DropFlares(); }
void ARewildFighter::OnOrderAttack(const FInputActionValue&) { GiveOrder(0); }
void ARewildFighter::OnOrderCover(const FInputActionValue&) { GiveOrder(1); }
void ARewildFighter::OnOrderFormUp(const FInputActionValue&) { GiveOrder(2); }
void ARewildFighter::OnOrderFree(const FInputActionValue&) { GiveOrder(3); }

void ARewildFighter::GiveOrder(int32 Order)
{
	if (bDead)
	{
		return;
	}
	static const ERewildOrder Orders[4] = {ERewildOrder::Attack, ERewildOrder::Cover, ERewildOrder::FormUp, ERewildOrder::Free};
	if (Order == 0 && !Target.IsValid())
	{
		return;  // nothing to attack
	}
	TArray<ARewildWingman*> Flying;
	for (TActorIterator<ARewildWingman> It(GetWorld()); It; ++It)
	{
		if (It->IsAlive())
		{
			It->Order(Orders[Order], Target.Get());
			Flying.Add(*It);
		}
	}
	// One of them answers, in their own voice (lines in Noor, Kai, Amara order).
	static const FName Answers[4][3] = {
		{TEXT("oa2"), TEXT("oa1"), TEXT("oa3")}, {TEXT("oc2"), TEXT("oc1"), TEXT("oc3")},
		{TEXT("of2"), TEXT("of1"), TEXT("of3")}, {TEXT("oe3"), TEXT("oe1"), TEXT("oe2")}};
	URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>();
	if (Radio && Flying.Num() > 0)
	{
		const int32 Who = Flying[FMath::RandRange(0, Flying.Num() - 1)]->GetIndex();
		Radio->ChatterBy(Who, {Answers[Order][0], Answers[Order][1], Answers[Order][2]});
	}
	LastOrder = Order;
	OrderShown = 2.5f;
}

void ARewildFighter::OnQuit(const FInputActionValue&)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (ARewildHUD* HUD = PC ? Cast<ARewildHUD>(PC->GetHUD()) : nullptr)
	{
		HUD->TogglePause();
	}
}

void ARewildFighter::ApplySettings()
{
	MouseSensitivity = URewildSettings::Get()->MouseSensitivity();
}

void ARewildFighter::SetCockpitView(bool bCockpit)
{
	bCockpitView = bCockpit;
	CockpitCamera->SetActive(bCockpit);
	ChaseCamera->SetActive(!bCockpit);
}

void ARewildFighter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	HitMarker = FMath::Max(0.f, HitMarker - Dt);
	if (bDead)
	{
		AddActorWorldOffset(Velocity * Dt);  // the camera drifts on with the wreck
		RespawnIn -= Dt;
		if (RespawnIn <= 0.f)
		{
			Respawn();
		}
		UpdateDust();
		return;
	}
	OrderShown = FMath::Max(0.f, OrderShown - Dt);
	FindTarget();
	if (bDemo)
	{
		TickDemo(Dt);
	}
	if (bWorldAuto)
	{
		TickWorldAuto(Dt, DeltaSeconds);
	}
	Fly(Dt);
	TickGuns(Dt);
	TickMissiles(Dt);
	UpdateDust();

	ShieldFlash = FMath::Max(0.f, ShieldFlash - Dt * 3.f);
	ShieldBubble->SetVisibility(ShieldFlash > 0.01f);
	if (ShieldMaterial)
	{
		ShieldMaterial->SetScalarParameterValue(TEXT("Strength"), ShieldFlash);
		ShieldMaterial->SetVectorParameterValue(TEXT("HitPoint"), GetActorTransform().TransformPosition(ShieldHitLocal));
	}
}

void ARewildFighter::Fly(float Dt)
{
	// The stick wins while it is held; otherwise the mouse cursor steers. A small dead zone round the centre.
	// The demo autopilot steers precisely, with no dead zone (one stopped it correcting errors under 1.4 degrees).
	FVector2D Steer = (bDemo || bWorldAuto) ? Stick : (Stick.Size() > 0.1f ? Stick : AimCursor);
	const float Magnitude = Steer.Size();
	if (!bDemo)
	{
		Steer = Magnitude < 0.05f ? FVector2D::ZeroVector : Steer * ((Magnitude - 0.05f) / (0.95f * Magnitude));
	}

	const FRotator Turn(Steer.Y * PitchRate * Dt, Steer.X * YawRate * Dt, (RollInput * RollRate + Steer.X * BankIntoTurns) * Dt);
	SetActorRotation(GetActorQuat() * FQuat(Turn));  // turn about the ship's own axes, never gimbal-locked

	Throttle = FMath::Clamp(Throttle + ThrottleInput * ThrottleRate * Dt, 0.f, 1.f);

	const bool bBoosting = bBoostHeld && !bOverheated;
	BoostHeat = FMath::Clamp(BoostHeat + (bBoosting ? BoostHeatRate : -BoostCoolRate) * Dt, 0.f, 1.f);
	if (BoostHeat >= 1.f)
	{
		bOverheated = true;  // the engines cut boost until they cool to 30%
	}
	else if (bOverheated && BoostHeat < 0.3f)
	{
		bOverheated = false;
	}

	// Over a world, travel speed grows with height (HAVEN.md: orbit to the ground in about two minutes): under 1.5 km
	// the fighter flies as it does in the first fight, at 300 km two hundred times faster. (One per 3 km took three
	// minutes from 400 km on the autopilot's glide: 9 Nov.)
	double SpeedScale = 1.0;
	ARewildPlanet* Below = Planet.Get();
	if (Below)
	{
		Altitude = Below->AltitudeAt(GetActorLocation());
		SpeedScale = FMath::Clamp(Altitude / 1500.0, 1.0, 600.0);
	}

	// Flight assist: velocity swings round to where the nose points, so hard turns drift for a moment.
	const double TargetSpeed = (bBoosting ? BoostSpeed : CruiseSpeedMax * Throttle) * 100.0 * SpeedScale;
	Velocity += (GetActorForwardVector() * TargetSpeed - Velocity) * (1.f - FMath::Exp(-Assist * Dt));
	AddActorWorldOffset(Velocity * Dt);

	// The ground: skim it, or hit it too steeply and the fighter is lost.
	if (Below)
	{
		Altitude = Below->AltitudeAt(GetActorLocation());
		constexpr double Clearance = 3.0;  // m, the hull's half height
		if (Altitude < Clearance)
		{
			const FVector Up = Below->UpAt(GetActorLocation());
			const double Into = -FVector::DotProduct(Velocity, Up) / 100.0;  // m/s straight down
			AddActorWorldOffset(Up * (Clearance - Altitude) * 100.0);
			if (Into > 0.0)
			{
				Velocity += Up * Into * 100.0;
			}
			if (Into > 40.0 && !bDead)
			{
				UE_LOG(LogTemp, Display, TEXT("[rewild] hit the ground at %.0f m/s"), Into);
				Health->ApplyDamage(1.0e6f, GetActorLocation());
				return;
			}
		}
	}

	if (EngineGlow)
	{
		EngineGlow->SetScalarParameterValue(TEXT("Glow"), FMath::Lerp(GlowIdle, GlowFull, Throttle) * (bBoosting ? 1.6f : 1.f));
	}
	const float Fast = FMath::Clamp((GetSpeedMetresPerSecond() / float(SpeedScale) - CruiseSpeedMax) / (BoostSpeed - CruiseSpeedMax), 0.f, 1.f);
	ChaseCamera->SetFieldOfView(70.f + 10.f * Fast);
}

void ARewildFighter::FindTarget()
{
	const FVector Here = GetActorLocation();
	const FVector Nose = GetActorForwardVector();
	auto AngleTo = [&](const AActor* A)
	{
		const FVector To = (A->GetActorLocation() - Here).GetSafeNormal();
		return FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(Nose, To), -1.f, 1.f)));
	};
	auto Alive = [](const AActor* A)
	{
		const URewildHealthComponent* H = A ? A->FindComponentByClass<URewildHealthComponent>() : nullptr;
		return H && !H->IsDead();
	};
	// The demo goes for the Reapers once they come: the drones are practice.
	bool bReapersOnly = false;
	if (bDemo)
	{
		for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
		{
			bReapersOnly |= It->IsAlive();
		}
	}

	AActor* Best = nullptr;
	AActor* Held = LockTarget.Get();
	if (Held && LockProgress > 0.3f && Alive(Held) && AngleTo(Held) < 30.f && FVector::Dist(Held->GetActorLocation(), Here) < TargetRange)
	{
		Best = Held;  // hold on to a target being locked while it stays near the nose
	}
	else
	{
		float BestAngle = TargetCone;
		URewildHealthComponent::ForEach(GetWorld(), [&](URewildHealthComponent* H)
		{
			AActor* A = H->GetOwner();
			if (H->Team == Health->Team || H->IsDead() || A->IsHidden() || (bReapersOnly && !A->IsA<ARewildReaper>()))
			{
				return;
			}
			if (FVector::Dist(A->GetActorLocation(), Here) > TargetRange)
			{
				return;
			}
			const float Angle = AngleTo(A);
			if (Angle < BestAngle)
			{
				BestAngle = Angle;
				Best = A;
			}
		});
	}
	Target = Best;
	bHasLead = false;
	if (Best)
	{
		float Time = 0.f;
		const FVector Offset = Best->GetActorLocation() - Here;
		const FVector Relative = Best->GetVelocity() - Velocity;  // bolts carry the ship's velocity
		if (SolveLead(Offset, Relative, GunSpeed * 100.f, Time))
		{
			LeadPoint = Here + Offset + Relative * Time;
			bHasLead = true;
		}
	}
}

void ARewildFighter::TickGuns(float Dt)
{
	GunCooldown -= Dt;
	GunHeat = FMath::Max(0.f, GunHeat - GunCoolRate * Dt);
	if (bGunsOverheated && GunHeat < 0.35f)
	{
		bGunsOverheated = false;
	}
	URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>();
	while (bFireHeld && !bGunsOverheated && GunCooldown <= 0.f && Bolts)
	{
		GunCooldown += 1.f / GunRate;
		const FName Socket = bRightGunNext ? GunRight : GunLeft;
		bRightGunNext = !bRightGunNext;
		const FVector Muzzle = Hull->DoesSocketExist(Socket) ? Hull->GetSocketLocation(Socket) : GetActorLocation();
		// The two streams cross at the convergence distance ahead of the nose.
		const FVector Aim = GetActorLocation() + GetActorForwardVector() * Convergence * 100.f;
		const FVector Dir = (Aim - Muzzle).GetSafeNormal();
		Bolts->Fire(this, ERewildBoltKind::Cannon, Health->Team, Muzzle, Dir * GunSpeed * 100.f + Velocity, GunDamage);
		GunHeat += GunHeatPerShot;
		if (GunHeat >= 1.f)
		{
			bGunsOverheated = true;
		}
	}
	if (!bFireHeld)
	{
		GunCooldown = FMath::Max(GunCooldown, 0.f);
	}
}

void ARewildFighter::TickMissiles(float Dt)
{
	MissileCooldown -= Dt;
	FlareCooldown -= Dt;
	if (Missiles < MissileCapacity && (MissileRecharge -= Dt) <= 0.f)
	{
		++Missiles;
		MissileRecharge = MissileReload;
	}
	if (Flares < FlareCapacity && (FlareRecharge -= Dt) <= 0.f)
	{
		++Flares;
		FlareRecharge = FlareReload;
	}

	// The lock builds while the target stays in the nose's cone and in range, and drains when it slips out.
	AActor* T = Target.Get();
	if (T != LockTarget.Get())
	{
		LockTarget = T;
		LockProgress = 0.f;
	}
	if (!T)
	{
		return;
	}
	const FVector To = T->GetActorLocation() - GetActorLocation();
	const float Angle = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(GetActorForwardVector(), To.GetSafeNormal()), -1.f, 1.f)));
	const bool bHolding = Angle < LockCone && To.Size() < LockRange * 100.f && Missiles > 0;
	LockProgress = bHolding ? FMath::Min(1.f, LockProgress + Dt / LockTime) : FMath::Max(0.f, LockProgress - Dt * 1.5f);
	if (LockProgress > 0.f)
	{
		if (URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>())
		{
			Ms->ReportLock(this, T, LockProgress);  // the Reapers feel it and may jink
		}
	}
}

void ARewildFighter::FireMissile()
{
	URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>();
	if (bDead || !Ms || Missiles <= 0 || MissileCooldown > 0.f)
	{
		return;
	}
	if (Missiles == MissileCapacity)
	{
		MissileRecharge = MissileReload;
	}
	--Missiles;
	MissileCooldown = 0.6f;
	// From under the wing roots, left and right in turn: it drops clear, then lights.
	const float Side = bRightMissileNext ? 1.f : -1.f;
	bRightMissileNext = !bRightMissileNext;
	const FVector From = GetActorLocation() + GetActorRightVector() * Side * 250.f - GetActorUpVector() * 90.f;
	Ms->Launch(this, ERewildMissileKind::Rewild, Health->Team, From, GetActorQuat(), Velocity, LockProgress >= 1.f ? LockTarget.Get() : nullptr);
}

void ARewildFighter::DropFlares()
{
	URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>();
	if (bDead || !Ms || Flares <= 0 || FlareCooldown > 0.f)
	{
		return;
	}
	if (Flares == FlareCapacity)
	{
		FlareRecharge = FlareReload;
	}
	const int32 N = FMath::Min(FlareSalvo, Flares);
	Flares -= N;
	FlareCooldown = 0.8f;
	Ms->DropFlares(this, Health->Team, GetActorLocation(), GetActorQuat(), Velocity, N);
}

void ARewildFighter::HandleMissileHit(AActor* Shooter, AActor* Victim)
{
	if (Shooter == this && Victim)
	{
		HitMarker = 0.35f;
	}
}

void ARewildFighter::UpdateDust()
{
	const UCameraComponent* Camera = bCockpitView ? CockpitCamera : ChaseCamera;
	const FVector Centre = Camera->GetComponentLocation();
	TArray<FTransform> Instances;
	Instances.Reserve(DustOffsets.Num());
	for (FVector& P : DustOffsets)
	{
		FVector Rel = P - Centre;
		for (int32 Axis = 0; Axis < 3; ++Axis)
		{
			// wrap each speck back into the box round the camera
			Rel[Axis] = FMath::Fmod(Rel[Axis] + DustHalfBox * 3.f, DustHalfBox * 2.f) - DustHalfBox;
		}
		P = Centre + Rel;
		Instances.Add(FTransform(FRotator::ZeroRotator, P, FVector(DustScale)));
	}
	Dust->BatchUpdateInstancesTransforms(0, Instances, true, true, true);
}

void ARewildFighter::HandleHit(const FVector& Point, bool bOnShield)
{
	++DemoHitsTaken;
	if (bOnShield)
	{
		ShieldFlash = 1.f;
		ShieldHitLocal = GetActorTransform().InverseTransformPosition(Point);  // the ripple spreads from here
		if (bDemo && !bDemoSawShield && DemoTime > 10.f)
		{
			bDemoSawShield = true;
			QueueShot(0.06f, TEXT("shield hit"));
		}
	}
}

void ARewildFighter::HandleBoltHit(AActor* Shooter, AActor* Victim)
{
	if (Shooter == this && Victim)
	{
		HitMarker = 0.15f;
	}
}

void ARewildFighter::HandleDeath()
{
	bDead = true;
	++DemoDeaths;
	bFireHeld = false;
	LockProgress = 0.f;
	RespawnIn = bRespawns ? RespawnTime : 1e9f;  // the story's mission handles it
	ARewildExplosion::Spawn(GetWorld(), GetActorLocation(), Velocity, 1.6f);
	Hull->SetVisibility(false, true);  // the hull and everything on it, cameras excepted
	Hull->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ARewildFighter::TickWorldAuto(float Dt, float RawDt)
{
	// Fly down from orbit toward the colony (it stands at +Z of the world below), gliding at the point 400 m over it;
	// once under 800 m, level out at 300 m heading east over the bay toward TON 618. Shots on the way down (chase
	// view, the fighter in frame) and frame times; quits 14 s after levelling out.
	ARewildPlanet* World = Planet.Get();
	if (!World)
	{
		return;
	}
	DemoTime += Dt;
	ThrottleInput = Throttle < 0.7f ? 1.f : (Throttle > 0.75f ? -1.f : 0.f);
	const FVector Here = GetActorLocation();
	const FVector Colony = World->WorldAt(FVector3d(0, 0, 1), 0.0);
	const FVector Up = World->UpAt(Here);
	const double ToColony = FVector::VectorPlaneProject(Colony - Here, Up).Size() / 100.0;
	if (!bWorldLow && Altitude < 800.0)
	{
		bWorldLow = true;
		UE_LOG(LogTemp, Display, TEXT("[rewild fly] levelling out after %.1f s, %.0f m up, %.1f km from the colony"), DemoTime, Altitude, ToColony / 1000.0);
	}
	FVector Aim;
	if (bWorldLow)
	{
		WorldLowTime += Dt;
		const FVector East = FVector::VectorPlaneProject(FVector::ForwardVector, Up).GetSafeNormal();
		Aim = Here + East * 500000.0 + Up * (300.0 - Altitude) * 100.0;
	}
	else
	{
		Aim = World->WorldAt(FVector3d(0, 0, 1), 400.0);
	}
	const FVector Local = GetActorTransform().InverseTransformVectorNoScale((Aim - Here).GetSafeNormal());
	Stick = FVector2D(FMath::Clamp(FMath::Atan2(Local.Y, Local.X) * 4.f, -1.f, 1.f), FMath::Clamp(FMath::Atan2(Local.Z, Local.X) * 4.f, -1.f, 1.f));
	// keep the wings level with the ground below
	const float Bank = FMath::RadiansToDegrees(FMath::Asin(FMath::Clamp(FVector::DotProduct(GetActorRightVector(), Up), -1.0, 1.0)));
	RollInput = FMath::Clamp(Bank / 20.f, -1.f, 1.f);

	// frame times (the unclamped frame), by stage: above 100 km, 100 km to 3 km, under 3 km
	WorldFrameSum += RawDt;
	++WorldFrames;
	WorldWorstFrame = FMath::Max(WorldWorstFrame, RawDt);
	WorldLogIn -= Dt;
	if (WorldLogIn <= 0.f)
	{
		WorldLogIn = 2.f;
		UE_LOG(LogTemp, Display, TEXT("[rewild fly] %.1f s: %.2f km up, %.0f m/s, %.1f km to go, frames %.1f ms (worst %.1f)"),
			DemoTime, Altitude / 1000.0, GetSpeedMetresPerSecond(), ToColony / 1000.0,
			1000.0 * WorldFrameSum / FMath::Max(1, WorldFrames), 1000.f * WorldWorstFrame);
		WorldFrameSum = 0.0;
		WorldFrames = 0;
		WorldWorstFrame = 0.f;
	}

	for (int32 I = DemoQueue.Num() - 1; I >= 0; --I)
	{
		if (DemoTime >= DemoQueue[I].Key)
		{
			Shoot(DemoQueue[I].Value);
			DemoQueue.RemoveAt(I);
		}
	}
	static const double Marks[] = {100000.0, 20000.0, 3000.0};
	if (WorldShotStage < 3 && Altitude < Marks[WorldShotStage])
	{
		QueueShot(0.f, FString::Printf(TEXT("descending, %.0f km up"), Altitude / 1000.0));
		++WorldShotStage;
	}
	if (WorldShotStage == 3 && WorldLowTime > 4.f)
	{
		QueueShot(0.f, TEXT("low over the grass"));
		++WorldShotStage;
	}
	if (WorldShotStage == 4 && WorldLowTime > 8.f)
	{
		SetCockpitView(true);
		QueueShot(0.5f, TEXT("cockpit, low"));
		++WorldShotStage;
	}
	if (WorldShotStage == 5 && WorldLowTime > 14.f)
	{
		++WorldShotStage;
		if (APlayerController* PC = Cast<APlayerController>(GetController()))
		{
			PC->ConsoleCommand(TEXT("quit"));
		}
	}
}

void ARewildFighter::SetStart(const FTransform& Where)
{
	Start = Where;
	SetActorTransform(Where);
	Velocity = Where.GetRotation().GetForwardVector() * CruiseSpeedMax * Throttle * 100.f;
}

void ARewildFighter::Respawn()
{
	bDead = false;
	SetActorTransform(Start);
	Velocity = Start.GetRotation().GetForwardVector() * CruiseSpeedMax * Throttle * 100.f;
	Health->Restore();
	Hull->SetVisibility(true, true);
	ShieldBubble->SetVisibility(false);
	Hull->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	GunHeat = 0.f;
	bGunsOverheated = false;
	Missiles = MissileCapacity;
	Flares = FlareCapacity;
}

void ARewildFighter::Shoot(const FString& Why)
{
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->ConsoleCommand(TEXT("Shot showui"));
		UE_LOG(LogTemp, Display, TEXT("[rewild demo] shot %d at %.1f s: %s"), DemoShots, DemoTime, *Why);
		++DemoShots;
	}
}

void ARewildFighter::QueueShot(float After, const FString& Why)
{
	DemoQueue.Add({DemoTime + After, Why});
}

void ARewildFighter::TickDemo(float Dt)
{
	// An autopilot against the Harrow (milestone 4). It turns onto the lead point of the target nearest the nose,
	// fires the guns when the aim is off by less than the target's size and within 700 m, fires a missile when
	// locked, and when a Harrow missile closes it throws flares and pulls hard. Screenshots: the Reapers close, the
	// lock warning, the first two missiles (launch and flight), the first two flare salvos, a cockpit view and the
	// first three kills (as it blows apart and half a second later).
	DemoTime += Dt;
	DemoMissileGap -= Dt;
	ThrottleInput = Throttle < 0.55f ? 1.f : (Throttle > 0.6f ? -1.f : 0.f);
	URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>();

	TArray<URewildMissiles::FThreat> Threats;
	if (Ms)
	{
		Ms->GetThreats(this, Threats);
		if (!bDemoSawLock && Ms->GetLockOn(this) > 0.6f)
		{
			bDemoSawLock = true;
			QueueShot(0.f, TEXT("lock warning"));
		}
	}
	float Soonest = 99.f;
	for (const URewildMissiles::FThreat& Th : Threats)
	{
		Soonest = FMath::Min(Soonest, Th.Seconds);
	}
	if (Soonest < 1.8f && FlareCooldown <= 0.f && Flares > 0)
	{
		DropFlares();
		DemoBreak = 1.4f;
		if (++DemoFlareSalvos <= 2)
		{
			QueueShot(0.5f, TEXT("flares"));
		}
	}

	AActor* T = Target.Get();
	if (DemoBreak > 0.f)
	{
		DemoBreak -= Dt;
		Stick = FVector2D(0.3f, 1.f);  // pull hard across the missile's path
		RollInput = 0.6f;
		bFireHeld = false;
	}
	else if (T)
	{
		RollInput = 0.f;
		const FVector Aim = bHasLead ? LeadPoint : T->GetActorLocation();
		const FVector Local = GetActorTransform().InverseTransformVectorNoScale((Aim - GetActorLocation()).GetSafeNormal());
		const float Yaw = FMath::Atan2(Local.Y, Local.X);
		const float Pitch = FMath::Atan2(Local.Z, Local.X);
		Stick = FVector2D(FMath::Clamp(Yaw * 8.f, -1.f, 1.f), FMath::Clamp(Pitch * 8.f, -1.f, 1.f));
		const float Off = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Local.X, -1.f, 1.f)));
		const float Distance = FVector::Dist(Aim, GetActorLocation());
		const bool bReaper = T->IsA<ARewildReaper>();
		// Fire only when the aim is off by less than the target's own size (a drone 3.5 m, a Reaper about 11 m).
		// (drones get a looser gate: at 0.2 deg it never settled on one, 9 Nov 2026)
		const float Allowed = FMath::Max(bReaper ? 0.2f : 0.6f, FMath::RadiansToDegrees(FMath::Atan((bReaper ? 450.f : 250.f) / FMath::Max(Distance, 1.f))));
		bFireHeld = Off < Allowed && Distance < 70000.f;  // within 700 m, where the shots show the fight
		static float LogIn = 0.f;
		if ((LogIn -= Dt) <= 0.f)
		{
			LogIn = 6.f;
			UE_LOG(LogTemp, Display, TEXT("[rewild demo] target %s at %.0f m, off %.2f deg (allowed %.2f), fire %d, heat %.2f, lead %d"),
				*T->GetName(), Distance / 100.f, Off, Allowed, bFireHeld ? 1 : 0, GunHeat, bHasLead ? 1 : 0);
		}
		// Close slowly (drones hardly move: at Reaper speeds it circled one at 138 m, 2.3 deg off, never firing,
		// 9 Nov 2026), and pull away to come round again if it ends up too close.
		const float Slow = bReaper ? 0.4f : 0.22f;
		ThrottleInput = Distance < (bReaper ? 50000.f : 60000.f) ? (Throttle > Slow ? -1.f : 0.f) : ThrottleInput;
		if (Distance < 12000.f && Off > Allowed * 3.f)
		{
			DemoBreak = 1.6f;
		}
		if (bReaper && !bDemoSawClose && Distance < 35000.f)
		{
			bDemoSawClose = true;
			QueueShot(0.f, TEXT("reaper close"));
		}
		if (bReaper && LockProgress >= 1.f && DemoMissileGap <= 0.f && Distance > 45000.f && Missiles > 0)
		{
			FireMissile();
			DemoMissileGap = 5.f;
			if (++DemoMissilesFired <= 2)
			{
				QueueShot(0.45f, TEXT("missile launch"));
				QueueShot(1.3f, TEXT("missile flying"));
			}
		}
	}
	else
	{
		RollInput = 0.f;
		Stick = FVector2D(0.3f, 0.f);  // circle until something comes into the nose's cone
		bFireHeld = false;
	}

	// A kill: what it was fighting has died (the wreck stays a second before it goes).
	AActor* E = DemoEngaged.Get();
	const URewildHealthComponent* EH = E ? E->FindComponentByClass<URewildHealthComponent>() : nullptr;
	if (bDemoTargetAlive && EH && EH->IsDead())
	{
		++DemoKills;
		if (DemoKills <= 2)
		{
			QueueShot(0.08f, FString::Printf(TEXT("kill %d"), DemoKills));
			QueueShot(0.6f, FString::Printf(TEXT("kill %d, after"), DemoKills));
		}
	}
	if (T != E)
	{
		DemoEngaged = T;
		E = T;
		EH = E ? E->FindComponentByClass<URewildHealthComponent>() : nullptr;
	}
	bDemoTargetAlive = EH && !EH->IsDead();

	if (DemoTime > 20.f && DemoTime < 20.f + Dt * 1.5f)
	{
		SetCockpitView(true);
		QueueShot(0.6f, TEXT("cockpit"));
	}
	if (DemoTime > 23.f && bCockpitView)
	{
		SetCockpitView(false);
	}
	for (int32 I = DemoQueue.Num() - 1; I >= 0; --I)
	{
		if (DemoTime >= DemoQueue[I].Key)
		{
			Shoot(DemoQueue[I].Value);
			DemoQueue.RemoveAt(I);
		}
	}
	// The story demo runs the whole mission and stops a few seconds after its end panel; free play after 90 s.
	const ARewildMission* Mission = ARewildMission::Find(GetWorld());
	if (Mission && DemoEndedAt < 0.f && (Mission->GetBeat() == ERewildBeat::Won || Mission->GetBeat() == ERewildBeat::Lost))
	{
		DemoEndedAt = DemoTime;
	}
	const bool bDone = Mission ? ((DemoEndedAt >= 0.f && DemoTime > DemoEndedAt + 24.f) || DemoTime > 480.f)
		: (DemoTime > 90.f || (DemoKills >= 3 && DemoQueue.Num() == 0 && DemoTime > 25.f));
	if (bDone)
	{
		UE_LOG(LogTemp, Display, TEXT("[rewild demo] done at %.1f s: %d kills, %d missiles, %d flare salvos, %d hits taken, %d deaths, hull %.0f%%, Reaper slugs fired %d"),
			DemoTime, DemoKills, DemoMissilesFired, DemoFlareSalvos, DemoHitsTaken, DemoDeaths, Health->GetHullFraction() * 100.f, ARewildReaper::SlugsFired);
		if (APlayerController* PC = Cast<APlayerController>(GetController()))
		{
			PC->ConsoleCommand(TEXT("quit"));
		}
	}
}
