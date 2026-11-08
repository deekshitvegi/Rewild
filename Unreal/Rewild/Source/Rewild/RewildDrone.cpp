#include "RewildDrone.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "RewildBolts.h"
#include "RewildExplosion.h"
#include "RewildHealthComponent.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr float TrainingBoltSpeed = 50000.f;  // cm/s (500 m/s): slow enough to see coming
	constexpr float TrainingBoltDamage = 7.f;
	constexpr float ArmedRange = 150000.f;        // 1.5 km
	constexpr float FireInterval = 1.8f;
	constexpr float TurnRate = 40.f;              // degrees per second toward the player
	constexpr float RespawnTime = 6.f;
	const FName GunSocket(TEXT("Gun"));
	const FName BeaconSlot(TEXT("M_Beacon"));
}

ARewildDrone::ARewildDrone()
{
	PrimaryActorTick.bCanEverTick = true;
	static ConstructorHelpers::FObjectFinder<UStaticMesh> DroneMesh(TEXT("/Game/FirstFight/Drone/Mesh/Drone.Drone"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Fallback(TEXT("/Engine/BasicShapes/Sphere.Sphere"));

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	SetRootComponent(Mesh);
	if (DroneMesh.Object)
	{
		Mesh->SetStaticMesh(DroneMesh.Object);
	}
	else
	{
		Mesh->SetStaticMesh(Fallback.Object);  // until the drone model is imported: a 3.5 m stand-in
		Mesh->SetRelativeScale3D(FVector(3.5f));
	}
	// Only bolts (visibility traces) touch it.
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Mesh->SetCollisionObjectType(ECC_WorldDynamic);
	Mesh->SetCollisionResponseToAllChannels(ECR_Ignore);
	Mesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

	Health = CreateDefaultSubobject<URewildHealthComponent>(TEXT("Health"));
	Health->ShieldMax = 30.f;
	Health->HullMax = 50.f;
	Health->Team = 1;
}

void ARewildDrone::BeginPlay()
{
	Super::BeginPlay();
	Health->Restore();
	Health->OnDeath.AddUObject(this, &ARewildDrone::Die);
	const int32 Slot = Mesh->GetMaterialIndex(BeaconSlot);
	if (Slot != INDEX_NONE)
	{
		Beacon = Mesh->CreateDynamicMaterialInstance(Slot);
	}
	for (int32 I = 1; I <= 16; ++I)
	{
		const FString Path = FString::Printf(TEXT("/Game/FirstFight/Drone/Debris/Debris_%02d.Debris_%02d"), I, I);
		if (UStaticMesh* Piece = LoadObject<UStaticMesh>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			Debris.Add(Piece);
		}
	}
	SetActorLocation(PathPosition(0.f));
}

void ARewildDrone::Configure(ERewildDroneMotion InMotion, const FVector& InCentre, const FVector& InAxis, float InRadius, float InSpeed, float InPhase, bool bInArmed)
{
	Motion = InMotion;
	Centre = InCentre;
	Axis = InAxis.GetSafeNormal();
	Radius = InRadius;
	Speed = InSpeed;
	Phase = InPhase;
	bArmed = bInArmed;
	if (bArmed)
	{
		Health->ShieldMax = 60.f;
		Health->HullMax = 70.f;
		Health->Restore();
	}
	SetActorLocation(PathPosition(0.f));
}

bool ARewildDrone::IsAlive() const
{
	return !Health->IsDead();
}

FVector ARewildDrone::PathPosition(float T) const
{
	FVector U, V;
	Axis.FindBestAxisVectors(U, V);
	switch (Motion)
	{
	case ERewildDroneMotion::Orbit:
	{
		const float A = Phase + Speed / FMath::Max(Radius, 1.f) * T;
		return Centre + Radius * (FMath::Cos(A) * U + FMath::Sin(A) * V);
	}
	case ERewildDroneMotion::Weave:
	{
		const float W = Speed / FMath::Max(Radius, 1.f);
		return Centre + Radius * (FMath::Sin(W * T + Phase) * U + 0.5f * FMath::Sin(2.f * (W * T + Phase)) * V)
			+ Axis * Radius * 0.25f * FMath::Sin(0.7f * W * T);
	}
	default:
		return Centre + Axis * 500.f * FMath::Sin(2.f * PI * T / 9.f + Phase);
	}
}

void ARewildDrone::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	if (Health->IsDead())
	{
		RespawnIn -= Dt;
		if (RespawnIn <= 0.f)
		{
			Respawn();
		}
		return;
	}
	Clock += Dt;
	const FVector Now = PathPosition(Clock);
	Velocity = (Now - GetActorLocation()) / FMath::Max(Dt, 1e-3f);
	SetActorLocation(Now);

	if (bArmed)
	{
		TickArmed(Dt);
	}
	else if (Motion == ERewildDroneMotion::Hold)
	{
		AddActorWorldRotation(FRotator(0.f, 6.f * Dt, 0.f));  // a slow spin
	}
	else if (!Velocity.IsNearlyZero())
	{
		SetActorRotation(FMath::RInterpTo(GetActorRotation(), Velocity.Rotation(), Dt, 3.f));
	}

	if (Beacon)
	{
		// a short blink every 1.5 s, as real tracking beacons do
		Beacon->SetScalarParameterValue(TEXT("Glow"), FMath::Fmod(Clock + Phase, 1.5f) < 0.12f ? 1.f : 0.f);
	}
}

void ARewildDrone::TickArmed(float Dt)
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player || Player->IsHidden())
	{
		return;
	}
	const FVector ToPlayer = Player->GetActorLocation() - GetActorLocation();
	const float Distance = ToPlayer.Size();
	if (Distance > ArmedRange * 1.5f)
	{
		return;
	}
	// Turn toward where the player will be, roughly (half the true lead: training drones are not marksmen).
	const float Flight = Distance / TrainingBoltSpeed;
	const FVector Aim = ToPlayer + (Player->GetVelocity() - Velocity) * Flight * 0.5f;
	SetActorRotation(FMath::RInterpConstantTo(GetActorRotation(), Aim.Rotation(), Dt, TurnRate));

	FireCooldown -= Dt;
	const float Off = FMath::RadiansToDegrees(FMath::Acos(FVector::DotProduct(GetActorForwardVector(), Aim.GetSafeNormal())));
	if (FireCooldown <= 0.f && Distance < ArmedRange && Off < 6.f)
	{
		FireCooldown = FireInterval;
		const FVector Muzzle = Mesh->DoesSocketExist(GunSocket) ? Mesh->GetSocketLocation(GunSocket) : GetActorLocation() + GetActorForwardVector() * 250.f;
		const FVector Dir = FMath::VRandCone(GetActorForwardVector(), FMath::DegreesToRadians(1.5f));
		if (URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>())
		{
			Bolts->Fire(this, ERewildBoltKind::Training, Health->Team, Muzzle, Dir * TrainingBoltSpeed + Velocity, TrainingBoltDamage);
		}
	}
}

void ARewildDrone::Die()
{
	TArray<UStaticMesh*> Pieces;
	for (UStaticMesh* P : Debris)
	{
		Pieces.Add(P);
	}
	ARewildExplosion::Spawn(GetWorld(), GetActorLocation(), Velocity, 1.f, Pieces, GetActorQuat());
	Mesh->SetVisibility(false);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	RespawnIn = RespawnTime;
}

void ARewildDrone::Respawn()
{
	Health->Restore();
	Mesh->SetVisibility(true);
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	SetActorLocation(PathPosition(Clock));
}

ARewildTrainingRange::ARewildTrainingRange()
{
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
}

void ARewildTrainingRange::BeginPlay()
{
	Super::BeginPlay();
	const FVector O = GetActorLocation();
	const FVector F = GetActorForwardVector();
	const FVector R = GetActorRightVector();
	const FVector Up = FVector::UpVector;
	const float M = 100.f;  // metres to centimetres

	struct FSpec { ERewildDroneMotion Motion; FVector Centre; FVector Axis; float Radius; float Speed; float Phase; bool bArmed; };
	const FSpec Layout[] = {
		// two station-keepers to learn the guns on
		{ERewildDroneMotion::Hold, O + F * 500 * M + R * -60 * M, Up, 0, 0, 0.f, false},
		{ERewildDroneMotion::Hold, O + F * 800 * M + R * 90 * M + Up * 40 * M, Up, 0, 0, 1.f, false},
		// three circling at 60, 90 and 120 m/s: they must be led
		{ERewildDroneMotion::Orbit, O + F * 1200 * M, Up, 250 * M, 60 * M, 0.f, false},
		{ERewildDroneMotion::Orbit, O + F * 1300 * M + R * 300 * M, (Up + R * 0.5f), 200 * M, 90 * M, 2.f, false},
		{ERewildDroneMotion::Orbit, O + F * 1500 * M + R * -350 * M + Up * 100 * M, (Up + F * 0.6f), 300 * M, 120 * M, 4.f, false},
		// two armed weavers that shoot back
		{ERewildDroneMotion::Weave, O + F * 1700 * M + R * 400 * M, Up, 220 * M, 70 * M, 0.f, true},
		{ERewildDroneMotion::Weave, O + F * 1900 * M + R * -450 * M + Up * 150 * M, (Up + R * 0.3f), 260 * M, 80 * M, 1.5f, true},
	};
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	for (const FSpec& S : Layout)
	{
		if (ARewildDrone* D = GetWorld()->SpawnActor<ARewildDrone>(S.Centre, GetActorRotation(), P))
		{
			D->Configure(S.Motion, S.Centre, S.Axis, S.Radius, S.Speed, S.Phase, S.bArmed);
		}
	}
}
