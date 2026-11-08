#include "RewildExplosion.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	FVector RandomDirection(FRandomStream& R) { return R.GetUnitVector(); }

	UInstancedStaticMeshComponent* MakeParticles(AActor* Owner, const TCHAR* Name, UStaticMesh* Mesh, UMaterialInterface* Material)
	{
		UInstancedStaticMeshComponent* C = Owner->CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		C->SetupAttachment(Owner->GetRootComponent());
		C->SetStaticMesh(Mesh);
		if (Material)
		{
			C->SetMaterial(0, Material);
		}
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetUsingAbsoluteLocation(true);
		C->SetUsingAbsoluteRotation(true);
		C->SetUsingAbsoluteScale(true);
		return C;
	}
}

ARewildExplosion::ARewildExplosion()
{
	PrimaryActorTick.bCanEverTick = true;
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cube(TEXT("/Engine/BasicShapes/Cube.Cube"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> FireMat(TEXT("/Game/FirstFight/FX/M_FX_Fireball.M_FX_Fireball"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> EmberMat(TEXT("/Game/FirstFight/FX/MI_FX_Ember.MI_FX_Ember"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> ShardMat(TEXT("/Game/FirstFight/Fighter/MI_Fighter_Metal_Dark.MI_Fighter_Metal_Dark"));

	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));

	Flash = CreateDefaultSubobject<UPointLightComponent>(TEXT("Flash"));
	Flash->SetupAttachment(GetRootComponent());
	Flash->SetIntensityUnits(ELightUnits::Candelas);
	Flash->SetCastShadows(false);
	Flash->SetIntensity(0.f);

	for (int32 I = 0; I < NumPuffs; ++I)
	{
		UStaticMeshComponent* P = CreateDefaultSubobject<UStaticMeshComponent>(FName(*FString::Printf(TEXT("Puff%d"), I)));
		P->SetupAttachment(GetRootComponent());
		P->SetStaticMesh(Sphere.Object);
		if (FireMat.Object)
		{
			P->SetMaterial(0, FireMat.Object);
		}
		P->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		P->SetCastShadow(false);
		P->SetUsingAbsoluteLocation(true);
		P->SetUsingAbsoluteScale(true);
		P->SetVisibility(false);
		Puffs.Add(P);
	}

	Core = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Core"));
	Core->SetupAttachment(GetRootComponent());
	Core->SetStaticMesh(Sphere.Object);
	if (FireMat.Object)
	{
		Core->SetMaterial(0, FireMat.Object);
	}
	Core->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Core->SetCastShadow(false);

	// Embers are streaks along their motion, as sparks look on camera (round dots read as confetti).
	Embers = MakeParticles(this, TEXT("Embers"), Cylinder.Object, EmberMat.Object);
	Embers->SetCastShadow(false);
	Shards = MakeParticles(this, TEXT("Shards"), Cube.Object, ShardMat.Object);
}

ARewildExplosion* ARewildExplosion::Spawn(UWorld* World, const FVector& Location, const FVector& Velocity, float InSize,
	const TArray<UStaticMesh*>& Debris, const FQuat& DebrisRotation)
{
	if (!World)
	{
		return nullptr;
	}
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ARewildExplosion* E = World->SpawnActor<ARewildExplosion>(Location, FRotator::ZeroRotator, P);
	if (E)
	{
		E->Start(InSize, Velocity, false, false, Debris, DebrisRotation);
	}
	return E;
}

void ARewildExplosion::Impact(UWorld* World, const FVector& Location, const FVector& Velocity, bool bShield)
{
	if (!World)
	{
		return;
	}
	FActorSpawnParameters P;
	P.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	if (ARewildExplosion* E = World->SpawnActor<ARewildExplosion>(Location, FRotator::ZeroRotator, P))
	{
		E->Start(0.15f, Velocity, true, bShield, TArray<UStaticMesh*>(), FQuat::Identity);
	}
}

void ARewildExplosion::Start(float InSize, const FVector& Velocity, bool bImpact, bool bShield,
	const TArray<UStaticMesh*>& Debris, const FQuat& DebrisRotation)
{
	Size = InSize;
	Drift = Velocity;
	bIsImpact = bImpact;
	Lifetime = bImpact ? 1.f : 14.f;
	FireColour = bShield ? FLinearColor(0.55f, 0.8f, 1.f) : FLinearColor(1.f, 0.55f, 0.2f);

	// A flash bright enough to light a ship 20 m away against full sunlight (about 120,000 lux).
	FlashPeak = (bImpact ? 4.0e6f : 2.0e8f) * Size;
	Flash->SetIntensity(FlashPeak);
	Flash->SetAttenuationRadius((bImpact ? 3000.f : 60000.f) * FMath::Max(Size, 0.5f));
	Flash->SetLightColor(FireColour);

	FRandomStream R(FMath::Rand());
	const float FireTime = bImpact ? 0.25f : 0.9f;
	const float FullDiameter = (bImpact ? 1.2f : 9.f) * Size * 100.f;  // cm
	const int32 Count = bImpact ? 1 : NumPuffs;
	for (int32 I = 0; I < Count; ++I)
	{
		FPuff P;
		const bool bCentre = I == 0;
		P.Offset = bCentre ? FVector::ZeroVector : R.GetUnitVector() * R.FRandRange(0.15f, 0.35f) * FullDiameter;
		P.Scale = bCentre ? 1.f : R.FRandRange(0.5f, 0.85f);
		P.Delay = bCentre ? 0.f : R.FRandRange(0.f, 0.12f);
		P.Life = FireTime * (bCentre ? 1.f : R.FRandRange(0.7f, 1.2f));
		PuffData.Add(P);
		UMaterialInstanceDynamic* M = Puffs[I]->CreateDynamicMaterialInstance(0);
		if (M)
		{
			M->SetVectorParameterValue(TEXT("Colour"), FireColour);
			M->SetScalarParameterValue(TEXT("Fade"), 0.f);
		}
		PuffMaterials.Add(M);
	}
	CoreMaterial = Core->CreateDynamicMaterialInstance(0);
	if (CoreMaterial)
	{
		CoreMaterial->SetVectorParameterValue(TEXT("Colour"), bShield ? FLinearColor(0.8f, 0.92f, 1.f) : FLinearColor(1.f, 0.9f, 0.75f));
		CoreMaterial->SetScalarParameterValue(TEXT("Intensity"), 1.2e6f);
		CoreMaterial->SetScalarParameterValue(TEXT("Fade"), 0.f);
	}

	const FVector Here = GetActorLocation();
	auto Burst = [&](TArray<FParticle>& Out, int32 Count, float SpeedMin, float SpeedMax, float SizeMin, float SizeMax, float LifeMin, float LifeMax)
	{
		for (int32 I = 0; I < Count; ++I)
		{
			FParticle P;
			P.Position = Here;
			P.Velocity = RandomDirection(R) * R.FRandRange(SpeedMin, SpeedMax) * 100.f;
			P.Rotation = FQuat(RandomDirection(R), R.FRandRange(0.f, 2.f * PI));
			P.Spin = RandomDirection(R) * R.FRandRange(1.f, 8.f);
			P.Size = R.FRandRange(SizeMin, SizeMax);
			P.Life = P.Life0 = R.FRandRange(LifeMin, LifeMax);
			Out.Add(P);
		}
	};
	if (bImpact)
	{
		Burst(EmberParticles, bShield ? 6 : 10, 8.f, 35.f, 0.04f, 0.1f, 0.25f, 0.7f);
	}
	else
	{
		const float Spread = FMath::Sqrt(Size);
		Burst(EmberParticles, FMath::RoundToInt(120 * Size), 20.f * Spread, 110.f * Spread, 0.08f, 0.22f, 0.8f, 2.2f);
		Burst(ShardParticles, FMath::RoundToInt(20 * Size), 15.f, 80.f, 0.2f, 0.9f, Lifetime, Lifetime);
	}

	// The wreck's own fragments: they start where they sit in the whole and fly apart from its centre.
	for (UStaticMesh* Mesh : Debris)
	{
		if (!Mesh)
		{
			continue;
		}
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
		C->SetStaticMesh(Mesh);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetUsingAbsoluteLocation(true);
		C->SetUsingAbsoluteRotation(true);
		C->SetupAttachment(GetRootComponent());
		C->RegisterComponent();
		C->SetWorldLocationAndRotation(Here, DebrisRotation);
		Pieces.Add(C);
		const FVector Out = DebrisRotation.RotateVector(Mesh->GetBounds().Origin).GetSafeNormal();
		FParticle P;
		P.Position = Here;
		P.Velocity = ((Out.IsNearlyZero() ? RandomDirection(R) : Out) + RandomDirection(R) * 0.4f).GetSafeNormal() * R.FRandRange(15.f, 50.f) * 100.f;
		P.Rotation = DebrisRotation;
		P.Spin = RandomDirection(R) * R.FRandRange(0.5f, 3.f);
		P.Size = 1.f;
		P.Life = P.Life0 = Lifetime;
		PieceParticles.Add(P);
	}

	TArray<FTransform> Init;
	Init.Init(FTransform(FQuat::Identity, Here, FVector::ZeroVector), EmberParticles.Num());
	Embers->AddInstances(Init, false, true);
	Init.Init(FTransform(FQuat::Identity, Here, FVector::ZeroVector), ShardParticles.Num());
	Shards->AddInstances(Init, false, true);
}

void ARewildExplosion::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	Age += Dt;
	if (Age > Lifetime)
	{
		Destroy();
		return;
	}

	Flash->SetIntensity(FlashPeak * FMath::Exp(-Age / (bIsImpact ? 0.06f : 0.25f)));

	// The fireball: each billow swells fast and drifts outward, then thins to nothing in under a second.
	const float FullDiameter = (bIsImpact ? 1.2f : 9.f) * Size;  // metres: the engine sphere is 1 m across
	for (int32 I = 0; I < PuffData.Num(); ++I)
	{
		const FPuff& P = PuffData[I];
		const float K = (Age - P.Delay) / P.Life;
		UStaticMeshComponent* C = Puffs[I];
		if (K < 0.f || K >= 1.f)
		{
			if (C->IsVisible())
			{
				C->SetVisibility(false);
			}
			continue;
		}
		const float Grow = FMath::Sqrt(K);
		C->SetWorldLocation(GetActorLocation() + Drift * Age + P.Offset * (0.3f + 0.7f * Grow));
		C->SetWorldScale3D(FVector(FullDiameter * P.Scale * (0.35f + 0.65f * Grow)));
		if (!C->IsVisible())
		{
			C->SetVisibility(true);
		}
		if (UMaterialInstanceDynamic* M = PuffMaterials[I])
		{
			M->SetScalarParameterValue(TEXT("Fade"), K);
		}
	}

	// The core: a white-hot ball, a third of the fireball, gone in 0.15 s (60 ms for an impact).
	const float CoreTime = bIsImpact ? 0.06f : 0.15f;
	if (Age < CoreTime)
	{
		const float K = Age / CoreTime;
		Core->SetWorldLocation(GetActorLocation() + Drift * Age);
		Core->SetWorldScale3D(FVector((bIsImpact ? 0.6f : 3.5f) * Size * (0.6f + 0.6f * K)));
		if (CoreMaterial)
		{
			CoreMaterial->SetScalarParameterValue(TEXT("Fade"), K);
		}
	}
	else if (Core->IsVisible())
	{
		Core->SetVisibility(false);
	}

	// Sparks thinner than a pixel break into dashes on screen: keep them at least about 1.5 pixels wide.
	FVector Eye = GetActorLocation();
	if (APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(this, 0))
	{
		Eye = Cam->GetCameraLocation();
	}
	auto Step = [&](TArray<FParticle>& Ps, bool bShrink)
	{
		TArray<FTransform> Ts;
		Ts.Reserve(Ps.Num());
		for (FParticle& P : Ps)
		{
			P.Position += (P.Velocity + Drift) * Dt;
			P.Life -= Dt;
			const float Angle = P.Spin.Size() * Dt;
			if (Angle > 0.f)
			{
				P.Rotation = FQuat(P.Spin.GetSafeNormal(), Angle) * P.Rotation;
			}
			const float S = FMath::Max(bShrink ? P.Size * FMath::Clamp(P.Life / P.Life0, 0.f, 1.f) : P.Size, 0.f);
			if (bShrink)
			{
				// a streak as long as 40 ms of its own flight, pointing away from the blast (the wreck's drift is
				// shared with the camera chasing it, so it is left out)
				const float Left = FMath::Clamp(P.Life / P.Life0, 0.f, 1.f);
				const float Width = FMath::Max(S, FVector::Dist(P.Position, Eye) / 100.f * 0.0016f * Left);
				const float Length = FMath::Max(Width, P.Velocity.Size() * 0.03f / 100.f) * FMath::Max(Left, 0.3f);
				Ts.Add(FTransform(FRotationMatrix::MakeFromZ(P.Velocity.GetSafeNormal()).ToQuat(), P.Position, FVector(Width, Width, Length)));
			}
			else
			{
				Ts.Add(FTransform(P.Rotation, P.Position, FVector(S)));
			}
		}
		return Ts;
	};
	if (EmberParticles.Num() > 0)
	{
		Embers->BatchUpdateInstancesTransforms(0, Step(EmberParticles, true), true, true, true);
	}
	if (ShardParticles.Num() > 0)
	{
		Shards->BatchUpdateInstancesTransforms(0, Step(ShardParticles, false), true, true, true);
	}
	for (int32 I = 0; I < Pieces.Num() && I < PieceParticles.Num(); ++I)
	{
		FParticle& P = PieceParticles[I];
		P.Position += (P.Velocity + Drift) * Dt;
		const float Angle = P.Spin.Size() * Dt;
		if (Angle > 0.f)
		{
			P.Rotation = FQuat(P.Spin.GetSafeNormal(), Angle) * P.Rotation;
		}
		Pieces[I]->SetWorldLocationAndRotation(P.Position, P.Rotation);
	}
}
