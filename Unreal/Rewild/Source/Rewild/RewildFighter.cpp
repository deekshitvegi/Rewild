#include "RewildFighter.h"

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
	Health->Team = 0;

	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void ARewildFighter::BeginPlay()
{
	Super::BeginPlay();
	Start = GetActorTransform();

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
	if (bDemo)
	{
		DemoShotAt = {7.f, 16.f};  // a chase shot in the first attack, a cockpit shot later; kills add their own
	}
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

	CameraAction = Action(TEXT("Camera"), EInputActionValueType::Boolean);
	Mapping->MapKey(CameraAction, EKeys::C);
	Mapping->MapKey(CameraAction, EKeys::Gamepad_RightThumbstick);

	QuitAction = Action(TEXT("Quit"), EInputActionValueType::Boolean);  // until there is a pause menu
	Mapping->MapKey(QuitAction, EKeys::Escape);
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

void ARewildFighter::OnQuit(const FInputActionValue&)
{
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->ConsoleCommand(TEXT("quit"));
	}
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
	FindTarget();
	if (bDemo)
	{
		TickDemo(Dt);
	}
	Fly(Dt);
	TickGuns(Dt);
	UpdateDust();

	ShieldFlash = FMath::Max(0.f, ShieldFlash - Dt * 3.f);
	ShieldBubble->SetVisibility(ShieldFlash > 0.01f);
	if (ShieldMaterial)
	{
		ShieldMaterial->SetScalarParameterValue(TEXT("Strength"), ShieldFlash);
	}
}

void ARewildFighter::Fly(float Dt)
{
	// The stick wins while it is held; otherwise the mouse cursor steers. A small dead zone round the centre.
	// The demo autopilot steers precisely, with no dead zone (one stopped it correcting errors under 1.4 degrees).
	FVector2D Steer = bDemo ? Stick : (Stick.Size() > 0.1f ? Stick : AimCursor);
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

	// Flight assist: velocity swings round to where the nose points, so hard turns drift for a moment.
	const float TargetSpeed = (bBoosting ? BoostSpeed : CruiseSpeedMax * Throttle) * 100.f;
	Velocity += (GetActorForwardVector() * TargetSpeed - Velocity) * (1.f - FMath::Exp(-Assist * Dt));
	AddActorWorldOffset(Velocity * Dt);

	if (EngineGlow)
	{
		EngineGlow->SetScalarParameterValue(TEXT("Glow"), FMath::Lerp(GlowIdle, GlowFull, Throttle) * (bBoosting ? 1.6f : 1.f));
	}
	const float Fast = FMath::Clamp((GetSpeedMetresPerSecond() - CruiseSpeedMax) / (BoostSpeed - CruiseSpeedMax), 0.f, 1.f);
	ChaseCamera->SetFieldOfView(70.f + 10.f * Fast);
}

void ARewildFighter::FindTarget()
{
	const FVector Here = GetActorLocation();
	const FVector Nose = GetActorForwardVector();
	AActor* Best = nullptr;
	float BestAngle = TargetCone;
	for (TActorIterator<ARewildDrone> It(GetWorld()); It; ++It)
	{
		if (!It->IsAlive())
		{
			continue;
		}
		const FVector To = It->GetActorLocation() - Here;
		const float Distance = To.Size();
		if (Distance > TargetRange)
		{
			continue;
		}
		const float Angle = FMath::RadiansToDegrees(FMath::Acos(FVector::DotProduct(Nose, To / FMath::Max(Distance, 1.f))));
		if (Angle < BestAngle)
		{
			BestAngle = Angle;
			Best = *It;
		}
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
	if (bOnShield)
	{
		ShieldFlash = 1.f;
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
	bFireHeld = false;
	RespawnIn = RespawnTime;
	ARewildExplosion::Spawn(GetWorld(), GetActorLocation(), Velocity, 1.6f);
	Hull->SetVisibility(false, true);  // the hull and everything on it, cameras excepted
	Hull->SetCollisionEnabled(ECollisionEnabled::NoCollision);
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
}

void ARewildFighter::Shoot(const TCHAR* Why)
{
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->ConsoleCommand(TEXT("Shot"));
		UE_LOG(LogTemp, Display, TEXT("[rewild demo] shot %d at %.1f s: %s"), DemoShots, DemoTime, Why);
		++DemoShots;
	}
}

void ARewildFighter::TickDemo(float Dt)
{
	// An autopilot against the training range: it turns onto the lead point of the target nearest the nose and
	// fires when it is within 2.5 degrees and 1.6 km. Screenshots: one in the first attack, one from the cockpit,
	// and two of each of the first three kills (as the drone blows apart and half a second later).
	DemoTime += Dt;
	ThrottleInput = Throttle < 0.45f ? 1.f : (Throttle > 0.5f ? -1.f : 0.f);

	ARewildDrone* Drone = Cast<ARewildDrone>(Target.Get());
	if (Drone)
	{
		const FVector Aim = bHasLead ? LeadPoint : Drone->GetActorLocation();
		const FVector Local = GetActorTransform().InverseTransformVectorNoScale((Aim - GetActorLocation()).GetSafeNormal());
		const float Yaw = FMath::Atan2(Local.Y, Local.X);
		const float Pitch = FMath::Atan2(Local.Z, Local.X);
		Stick = FVector2D(FMath::Clamp(Yaw * 8.f, -1.f, 1.f), FMath::Clamp(Pitch * 8.f, -1.f, 1.f));
		const float Off = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(Local.X, -1.f, 1.f)));
		const float Distance = FVector::Dist(Aim, GetActorLocation());
		// Fire only when the aim is off by less than the drone's own size (it is 3.5 m across).
		const float Allowed = FMath::Max(0.2f, FMath::RadiansToDegrees(FMath::Atan(150.f / FMath::Max(Distance, 1.f))));
		bFireHeld = Off < Allowed && Distance < 70000.f;  // within 700 m, where the shots show the fight
		// Close slowly on near targets so there is time to shoot
		ThrottleInput = Distance < 60000.f ? (Throttle > 0.25f ? -1.f : 0.f) : ThrottleInput;
	}
	else
	{
		Stick = FVector2D(0.3f, 0.f);  // circle until a drone comes into the nose's cone
		bFireHeld = false;
	}

	static TWeakObjectPtr<ARewildDrone> Engaged;
	if (Engaged.IsValid() && !Engaged->IsAlive() && bDemoTargetAlive)
	{
		++DemoKills;
		if (DemoKills <= 3)
		{
			DemoShotAt.Add(DemoTime + 0.08f);
			DemoShotAt.Add(DemoTime + 0.6f);
		}
	}
	if (Drone != Engaged.Get())
	{
		Engaged = Drone;
	}
	bDemoTargetAlive = Engaged.IsValid() && Engaged->IsAlive();

	if (DemoTime > 15.f && DemoTime < 15.f + Dt * 1.5f)
	{
		SetCockpitView(true);
	}
	if (DemoTime > 18.f && bCockpitView)
	{
		SetCockpitView(false);
	}
	for (int32 I = DemoShotAt.Num() - 1; I >= 0; --I)
	{
		if (DemoTime >= DemoShotAt[I])
		{
			Shoot(bCockpitView ? TEXT("cockpit") : (DemoKills > 0 ? TEXT("kill") : TEXT("attack")));
			DemoShotAt.RemoveAt(I);
		}
	}
	if (DemoTime > 40.f || (DemoKills >= 3 && DemoShotAt.Num() == 0 && DemoTime > 17.f))
	{
		if (APlayerController* PC = Cast<APlayerController>(GetController()))
		{
			PC->ConsoleCommand(TEXT("quit"));
		}
	}
}
