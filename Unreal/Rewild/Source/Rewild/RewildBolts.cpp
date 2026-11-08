#include "RewildBolts.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Camera/PlayerCameraManager.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "RewildExplosion.h"
#include "RewildHealthComponent.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr float BoltLife = 2.5f;  // seconds: about 3.7 km for a cannon bolt
	// The engine cylinder is 1 m tall (along Z) and 1 m across.
	// A tracer streak is about one frame of travel long (1,500 m/s at 60 fps is 25 m), as the eye and a camera see
	// it; 12 cm x 6 m barely showed (8 Nov 2026). Width grows with distance to stay about 2 pixels wide.
	const FVector CannonScale(0.25f, 0.25f, 20.f);
	const FVector TrainingScale(0.3f, 0.3f, 8.f);
	constexpr float MinWidthPerMetre = 0.002f;

	UInstancedStaticMeshComponent* MakeLayer(AActor* Owner, const TCHAR* Name, UStaticMesh* Mesh, UMaterialInterface* Material)
	{
		UInstancedStaticMeshComponent* C = Owner->CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		C->SetStaticMesh(Mesh);
		if (Material)
		{
			C->SetMaterial(0, Material);
		}
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetUsingAbsoluteLocation(true);
		C->SetUsingAbsoluteRotation(true);
		C->SetUsingAbsoluteScale(true);
		return C;
	}
}

ARewildBoltRenderer::ARewildBoltRenderer()
{
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cylinder(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> CannonMat(TEXT("/Game/FirstFight/FX/MI_Bolt_Cannon.MI_Bolt_Cannon"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> TrainingMat(TEXT("/Game/FirstFight/FX/MI_Bolt_Training.MI_Bolt_Training"));
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
	Cannon = MakeLayer(this, TEXT("Cannon"), Cylinder.Object, CannonMat.Object);
	Cannon->SetupAttachment(GetRootComponent());
	Training = MakeLayer(this, TEXT("Training"), Cylinder.Object, TrainingMat.Object);
	Training->SetupAttachment(GetRootComponent());
}

void URewildBolts::Fire(AActor* Shooter, ERewildBoltKind Kind, int32 Team, const FVector& Muzzle, const FVector& Velocity, float Damage)
{
	Bolts.Add({Muzzle, Velocity, BoltLife, Damage, Team, Kind, Shooter});
}

void URewildBolts::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World || Bolts.Num() == 0)
	{
		if (DrawnCannon + DrawnTraining > 0)
		{
			Draw();
		}
		return;
	}
	const float Dt = FMath::Min(DeltaTime, 0.05f);
	for (int32 I = Bolts.Num() - 1; I >= 0; --I)
	{
		FBolt& B = Bolts[I];
		const FVector End = B.Position + B.Velocity * Dt;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(RewildBolt), true);  // trace the real triangles
		if (AActor* Shooter = B.Shooter.Get())
		{
			Params.AddIgnoredActor(Shooter);
		}
		FHitResult Hit;
		if (World->LineTraceSingleByChannel(Hit, B.Position, End, ECC_Visibility, Params))
		{
			AActor* Victim = Hit.GetActor();
			URewildHealthComponent* Health = Victim ? Victim->FindComponentByClass<URewildHealthComponent>() : nullptr;
			if (Health && Health->Team == B.Team)
			{
				B.Position = End;  // friendly: fly on through
				continue;
			}
			bool bShield = false;
			if (Health && !Health->IsDead())
			{
				bShield = Health->GetShieldFraction() > 0.f;
				Health->ApplyDamage(B.Damage, Hit.ImpactPoint);
				OnBoltHit.Broadcast(B.Shooter.Get(), Victim);
			}
			ARewildExplosion::Impact(World, Hit.ImpactPoint, Victim ? Victim->GetVelocity() : FVector::ZeroVector, bShield);
			Bolts.RemoveAtSwap(I);
			continue;
		}
		B.Position = End;
		B.Life -= Dt;
		if (B.Life <= 0.f)
		{
			Bolts.RemoveAtSwap(I);
		}
	}
	Draw();
}

void URewildBolts::Draw()
{
	ARewildBoltRenderer* R = Renderer.Get();
	if (!R)
	{
		FActorSpawnParameters Spawn;
		Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		R = GetWorld()->SpawnActor<ARewildBoltRenderer>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
		Renderer = R;
		if (!R)
		{
			return;
		}
	}
	FVector Eye = FVector::ZeroVector;
	if (APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(GetWorld(), 0))
	{
		Eye = Cam->GetCameraLocation();
	}
	TArray<FTransform> Cannon, Training;
	for (const FBolt& B : Bolts)
	{
		const FVector Dir = B.Velocity.GetSafeNormal();
		const bool bCannon = B.Kind == ERewildBoltKind::Cannon;
		FVector Scale = bCannon ? CannonScale : TrainingScale;
		const float Width = FMath::Max(Scale.X, FVector::Dist(B.Position, Eye) / 100.f * MinWidthPerMetre);
		Scale.X = Scale.Y = Width;
		// the streak trails behind the bolt's head
		const FTransform T(FRotationMatrix::MakeFromZ(Dir).Rotator(), B.Position - Dir * Scale.Z * 50.f, Scale);
		(bCannon ? Cannon : Training).Add(T);
	}
	auto Update = [](UInstancedStaticMeshComponent* C, TArray<FTransform>& Ts, int32& Drawn)
	{
		while (C->GetInstanceCount() < Ts.Num())
		{
			C->AddInstance(FTransform(FQuat::Identity, FVector::ZeroVector, FVector::ZeroVector), true);
		}
		const int32 Used = Ts.Num();
		for (int32 I = Used; I < FMath::Max(Drawn, Used); ++I)
		{
			Ts.Add(FTransform(FQuat::Identity, FVector::ZeroVector, FVector::ZeroVector));  // hide spent instances
		}
		if (Ts.Num() > 0)
		{
			C->BatchUpdateInstancesTransforms(0, Ts, true, true, true);
		}
		Drawn = Used;
	};
	Update(R->Cannon, Cannon, DrawnCannon);
	Update(R->Training, Training, DrawnTraining);
}
