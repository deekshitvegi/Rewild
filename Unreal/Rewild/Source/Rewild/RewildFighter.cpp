#include "RewildFighter.h"

#include "Camera/CameraComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
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
#include "Misc/CommandLine.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr int32 DustCount = 600;
	constexpr float DustHalfBox = 6000.f;  // specks fill a 120 m box round the camera
	constexpr float DustScale = 0.06f;     // 6 cm specks (the engine sphere is 1 m across)

	const FName EngineSlot(TEXT("M_Engine_Glow"));
	const FName EyeSocket(TEXT("Cockpit_Eye"));
}

ARewildFighter::ARewildFighter()
{
	PrimaryActorTick.bCanEverTick = true;

	static ConstructorHelpers::FObjectFinder<UStaticMesh> BodyMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_Body.Fighter_Body"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> GlassMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_CanopyGlass.Fighter_CanopyGlass"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SpeckMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));

	Hull = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Hull"));
	SetRootComponent(Hull);
	Hull->SetStaticMesh(BodyMesh.Object);
	// No collision until there is something to hit (milestone 3). With the Pawn profile the game refused to spawn
	// the fighter, reporting a collision at the start (8 Nov 2026); it now always spawns.
	Hull->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SpawnCollisionHandlingMethod = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	Canopy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Canopy"));
	Canopy->SetupAttachment(Hull);
	Canopy->SetStaticMesh(GlassMesh.Object);
	Canopy->SetCollisionEnabled(ECollisionEnabled::NoCollision);

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
	Dust->SetStaticMesh(SpeckMesh.Object);
	Dust->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Dust->SetCastShadow(false);

	AutoPossessPlayer = EAutoReceiveInput::Player0;
}

void ARewildFighter::BeginPlay()
{
	Super::BeginPlay();

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
	Mapping->MapKey(RollAction, EKeys::Gamepad_RightShoulder);
	Negated(RollAction, EKeys::Gamepad_LeftShoulder);

	ThrottleAction = Action(TEXT("Throttle"), EInputActionValueType::Axis1D);
	Mapping->MapKey(ThrottleAction, EKeys::W);
	Negated(ThrottleAction, EKeys::S);
	Mapping->MapKey(ThrottleAction, EKeys::Gamepad_RightTriggerAxis);
	Negated(ThrottleAction, EKeys::Gamepad_LeftTriggerAxis);

	BoostAction = Action(TEXT("Boost"), EInputActionValueType::Boolean);
	Mapping->MapKey(BoostAction, EKeys::LeftShift);
	Mapping->MapKey(BoostAction, EKeys::Gamepad_FaceButton_Bottom);

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
	if (bDemo)
	{
		TickDemo(DeltaSeconds);
	}
	Fly(DeltaSeconds);
	UpdateDust();
}

void ARewildFighter::Fly(float DeltaSeconds)
{
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);

	// The stick wins while it is held; otherwise the mouse cursor steers. A small dead zone round the centre.
	FVector2D Steer = Stick.Size() > 0.1f ? Stick : AimCursor;
	const float Magnitude = Steer.Size();
	Steer = Magnitude < 0.05f ? FVector2D::ZeroVector : Steer * ((Magnitude - 0.05f) / (0.95f * Magnitude));

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

void ARewildFighter::TickDemo(float DeltaSeconds)
{
	// A scripted run for stills: a climbing right turn, the cockpit view, then a boost. Shots go to
	// Saved/Screenshots/ as ScreenShot*.png in this order: chase, cockpit, chase on boost.
	DemoTime += DeltaSeconds;
	Stick = FVector2D(0.28f, 0.06f);
	ThrottleInput = Throttle < 0.75f ? 1.f : 0.f;
	APlayerController* PC = Cast<APlayerController>(GetController());

	struct FStep { float Time; int32 Action; };
	static const FStep Steps[] = {{1.5f, 0}, {4.f, 0}, {6.f, 0}, {6.5f, 1}, {8.5f, 0}, {9.f, 2}, {11.5f, 0}, {13.f, 3}};
	while (DemoStep < UE_ARRAY_COUNT(Steps) && DemoTime >= Steps[DemoStep].Time)
	{
		switch (Steps[DemoStep].Action)
		{
		case 0: if (PC) { PC->ConsoleCommand(TEXT("Shot")); } break;  // the frame as played (HighResShot renders a separate view)
		case 1: SetCockpitView(true); break;
		case 2: SetCockpitView(false); bBoostHeld = true; break;
		default: if (PC) { PC->ConsoleCommand(TEXT("quit")); } break;
		}
		++DemoStep;
	}
}
