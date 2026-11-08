#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RewildExplosion.generated.h"

class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class UPointLightComponent;
class UStaticMesh;
class UStaticMeshComponent;

/**
 * An explosion in vacuum (first fight, milestone 3): a brilliant flash, a fireball that lasts under a second (fuel
 * burning with its own oxidiser, then nothing to burn), glowing embers, and dark fragments that keep flying with
 * the wreck's own speed. No smoke billows: there is no air. A bolt impact is the same at a small size, orange
 * sparks on a hull, a blue-white flash on a shield.
 */
UCLASS(NotPlaceable)
class REWILD_API ARewildExplosion : public AActor
{
	GENERATED_BODY()

public:
	ARewildExplosion();

	/** Size 1 is a 3.5 m drone; the fighter is about 1.6. Debris meshes (fragments of the wreck) fly apart too. */
	static ARewildExplosion* Spawn(UWorld* World, const FVector& Location, const FVector& Velocity, float Size,
		const TArray<UStaticMesh*>& Debris = TArray<UStaticMesh*>(), const FQuat& DebrisRotation = FQuat::Identity);
	static void Impact(UWorld* World, const FVector& Location, const FVector& Velocity, bool bShield);

	virtual void Tick(float DeltaSeconds) override;

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UPointLightComponent> Flash;
	// The fireball is several overlapping billows, so its outline is lumpy, not a ball (one sphere read as a
	// glitter ball, 8 Nov 2026).
	static constexpr int32 NumPuffs = 5;
	UPROPERTY(VisibleAnywhere) TArray<TObjectPtr<UStaticMeshComponent>> Puffs;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Core;  // the white-hot first instant
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Embers;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Shards;
	UPROPERTY() TArray<TObjectPtr<UMaterialInstanceDynamic>> PuffMaterials;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> CoreMaterial;
	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Pieces;

	struct FParticle
	{
		FVector Position;
		FVector Velocity;
		FQuat Rotation;
		FVector Spin;  // axis * radians per second
		float Size;
		float Life;
		float Life0;
	};
	struct FPuff
	{
		FVector Offset;  // where it ends up, from the centre, in cm
		float Scale;     // of the full fireball's diameter
		float Delay;     // seconds after the blast
		float Life;      // seconds
	};
	TArray<FPuff> PuffData;
	TArray<FParticle> EmberParticles;
	TArray<FParticle> ShardParticles;
	TArray<FParticle> PieceParticles;

	FVector Drift = FVector::ZeroVector;  // the wreck's velocity, inherited by everything
	float Size = 1.f;
	float Age = 0.f;
	float Lifetime = 12.f;
	float FlashPeak = 0.f;
	FLinearColor FireColour = FLinearColor(1.f, 0.55f, 0.2f);
	bool bIsImpact = false;

	void Start(float InSize, const FVector& Velocity, bool bImpact, bool bShield, const TArray<UStaticMesh*>& Debris, const FQuat& DebrisRotation);
};
