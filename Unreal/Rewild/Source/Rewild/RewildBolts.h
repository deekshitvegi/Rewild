#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "RewildBolts.generated.h"

class UInstancedStaticMeshComponent;

/** Who fired a bolt, which decides its colour and whom it can hurt. */
enum class ERewildBoltKind : uint8 { Cannon, Training };

/** Draws every bolt in flight as instances of one stretched cylinder (one draw per kind). */
UCLASS(NotPlaceable)
class REWILD_API ARewildBoltRenderer : public AActor
{
	GENERATED_BODY()

public:
	ARewildBoltRenderer();

	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Cannon;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Training;
};

/**
 * Every bolt in the world (first fight, milestone 3). Bolts are real projectiles: they fly at a finite speed plus
 * the shooter's own velocity, so moving targets must be led. Each frame a bolt's path is traced; a hit damages
 * the URewildHealthComponent of the other team and leaves an impact flash.
 */
UCLASS()
class REWILD_API URewildBolts : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	void Fire(AActor* Shooter, ERewildBoltKind Kind, int32 Team, const FVector& Muzzle, const FVector& Velocity, float Damage);

	/** Called when one of this shooter's bolts hits something (the HUD's hit marker). */
	DECLARE_MULTICAST_DELEGATE_TwoParams(FOnBoltHit, AActor* /*Shooter*/, AActor* /*Victim*/);
	FOnBoltHit OnBoltHit;

	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(URewildBolts, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override
	{
		return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
	}

private:
	struct FBolt
	{
		FVector Position;
		FVector Velocity;
		float Life;
		float Damage;
		int32 Team;
		ERewildBoltKind Kind;
		TWeakObjectPtr<AActor> Shooter;
	};

	TArray<FBolt> Bolts;
	TWeakObjectPtr<ARewildBoltRenderer> Renderer;
	int32 DrawnCannon = 0;
	int32 DrawnTraining = 0;

	void Draw();
};
