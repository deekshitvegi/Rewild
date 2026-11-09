#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "RewildHealthComponent.generated.h"

DECLARE_MULTICAST_DELEGATE_TwoParams(FRewildOnHit, const FVector& /*Point*/, bool /*bOnShield*/);
DECLARE_MULTICAST_DELEGATE(FRewildOnDeath);

/**
 * Shield and hull for anything that can be shot (first fight, milestone 3). The shield takes damage first and
 * recharges after a quiet spell; the hull does not recharge. Bolts only hurt the other team.
 */
UCLASS(ClassGroup = (Rewild), meta = (BlueprintSpawnableComponent))
class REWILD_API URewildHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	URewildHealthComponent();

	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Damage at a world point. Returns true if this hit destroyed the owner. */
	bool ApplyDamage(float Amount, const FVector& Point);
	void Restore();

	/** Everything that can be shot, in this world (targeting, missile blasts, the HUD's markers). */
	static void ForEach(const UWorld* World, TFunctionRef<void(URewildHealthComponent*)> Visit);

	float GetShieldFraction() const { return ShieldMax > 0.f ? Shield / ShieldMax : 0.f; }
	float GetHullFraction() const { return HullMax > 0.f ? Hull / HullMax : 0.f; }
	bool IsDead() const { return bDead; }

	UPROPERTY(EditAnywhere, Category = "Health") float ShieldMax = 100.f;
	UPROPERTY(EditAnywhere, Category = "Health") float HullMax = 100.f;
	UPROPERTY(EditAnywhere, Category = "Health") float ShieldRegenDelay = 3.f;  // seconds without a hit
	UPROPERTY(EditAnywhere, Category = "Health") float ShieldRegenRate = 25.f;  // per second
	UPROPERTY(EditAnywhere, Category = "Health") int32 Team = 0;                // 0 the player's side, 1 targets and enemies

	FRewildOnHit OnHit;
	FRewildOnDeath OnDeath;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	static TArray<TWeakObjectPtr<URewildHealthComponent>> Registry;
	float Shield = 100.f;
	float Hull = 100.f;
	float SinceHit = 100.f;
	bool bDead = false;
};
