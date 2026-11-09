#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RewildFlight.h"
#include "RewildWingman.generated.h"

class UMaterialInstanceDynamic;
class URewildHealthComponent;
class UStaticMeshComponent;

/** What Dev has told the wing to do (keys 1-4, gamepad d-pad). */
UENUM()
enum class ERewildOrder : uint8
{
	Free,    // weapons free: each picks its own Reaper
	Attack,  // go after Dev's target
	Cover,   // go after whatever threatens Dev
	FormUp,  // fly on Dev's wing
};

/**
 * One of the crew in her or his own fighter beside Dev (first fight, milestone 5): Noor, Kai or Amara, the same
 * fighter as the player's with the stripes in their own colour. Flies like the Reapers do (RewildFlight), leads its
 * shots a little worse than Dev, breaks off after a pass, jinks when a Reaper sits on its tail, throws flares and
 * beams incoming missiles. Shot down, it ejects and is out of the mission (ARGO picks them up); in free play it comes
 * back from the Argo a minute later.
 */
UCLASS()
class REWILD_API ARewildWingman : public AActor
{
	GENERATED_BODY()

public:
	ARewildWingman();

	virtual void Tick(float DeltaSeconds) override;
	virtual FVector GetVelocity() const override { return Velocity; }

	/** Index 0 Noor, 1 Kai, 2 Amara; Slot is its place on Dev's wing (cm: forward, right, up of Dev). */
	void Setup(int32 InIndex, const FVector& InSlot, bool bInComesBack);
	void Order(ERewildOrder InOrder, AActor* InTarget);
	bool IsAlive() const;
	int32 GetIndex() const { return Index; }
	FText GetCallsign() const;
	FLinearColor GetStripe() const;
	ERewildOrder GetOrder() const { return Orders; }
	AActor* GetTarget() const { return Target.Get(); }

protected:
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, Category = "Flight") float CruiseSpeed = 225.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostSpeed = 380.f;
	UPROPERTY(EditAnywhere, Category = "Guns") float GunRate = 10.f;
	UPROPERTY(EditAnywhere, Category = "Guns") float GunSpeed = 1500.f;
	UPROPERTY(EditAnywhere, Category = "Guns") float GunDamage = 4.f;
	UPROPERTY(EditAnywhere, Category = "Guns") float GunRange = 900.f;

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Hull;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Canopy;
	UPROPERTY(VisibleAnywhere) TObjectPtr<URewildHealthComponent> Health;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> EngineGlow;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> Stripe;

	enum class EManoeuvre : uint8 { None, Break, Extend, Jink };

	FRewildStick Stick;
	FRewildFlightFigures Figures;
	FVector Velocity = FVector::ZeroVector;
	int32 Index = 0;
	FVector Slot = FVector(-2500.f, 4500.f, 0.f);
	bool bComesBack = false;

	ERewildOrder Orders = ERewildOrder::Free;
	TWeakObjectPtr<AActor> Target;
	FVector TargetVelocitySeen = FVector::ZeroVector;
	float RetargetIn = 0.f;

	EManoeuvre Manoeuvre = EManoeuvre::None;
	float ManoeuvreLeft = 0.f;
	FVector ManoeuvreDir = FVector::ForwardVector;
	float JinkSwitch = 0.f;
	bool bBoosting = false;

	float GunCooldown = 0.f;
	float BurstLeft = 0.f;
	float BurstPause = 0.f;
	bool bRightGun = false;
	int32 Missiles = 2;
	float LockTime = 0.f;
	float MissileGap = 0.f;
	int32 Flares = 8;
	float DefendCooldown = 0.f;
	float HurtCooldown = 0.f;
	float BackIn = 0.f;

	void ChooseTarget();
	void Think(float Dt, FVector& OutDir, float& OutSpeed);
	void TickGuns(float Dt);
	void TickMissile(float Dt);
	void Defend(float Dt);
	void StartManoeuvre(EManoeuvre Kind, const FVector& Dir, float Seconds);
	void HandleHit(const FVector& Point, bool bOnShield);
	void HandleDeath();
	void ComeBack();
};
