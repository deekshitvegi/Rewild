#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RewildDrone.generated.h"

class UMaterialInstanceDynamic;
class URewildHealthComponent;
class UStaticMesh;
class UStaticMeshComponent;

UENUM()
enum class ERewildDroneMotion : uint8
{
	Hold,    // station-keeping, a slow bob and spin
	Orbit,   // a circle round a point at a steady speed: lead it
	Weave,   // a figure-of-eight: lead it and change your lead
};

/**
 * A training drone from the Argo's kit (first fight, milestone 3): high-visibility, built to be shot at. Armed drones
 * turn to face the player and fire weak training bolts, to test the shields. Shot down, it breaks into its fragments
 * and returns 6 seconds later, until the Harrow come.
 */
UCLASS()
class REWILD_API ARewildDrone : public AActor
{
	GENERATED_BODY()

public:
	ARewildDrone();

	void Configure(ERewildDroneMotion InMotion, const FVector& InCentre, const FVector& InAxis, float InRadius, float InSpeed, float InPhase, bool bInArmed);

	virtual void Tick(float DeltaSeconds) override;
	virtual FVector GetVelocity() const override { return Velocity; }
	bool IsAlive() const;
	bool IsArmed() const { return bArmed; }

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere) TObjectPtr<URewildHealthComponent> Health;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> Beacon;
	UPROPERTY() TArray<TObjectPtr<UStaticMesh>> Debris;

	ERewildDroneMotion Motion = ERewildDroneMotion::Hold;
	FVector Centre = FVector::ZeroVector;
	FVector Axis = FVector::UpVector;  // orbit plane's normal
	float Radius = 25000.f;            // cm
	float Speed = 8000.f;              // cm/s along the path
	float Phase = 0.f;
	bool bArmed = false;

	FVector Velocity = FVector::ZeroVector;
	float Clock = 0.f;
	float FireCooldown = 2.f;
	float RespawnIn = 0.f;

	FVector PathPosition(float T) const;
	void TickArmed(float Dt);
	void Die();
	void Respawn();
	bool HarrowHaveCome() const;
};

/** Places the training drones ahead of the player start (put one in the level; it faces the player's heading). */
UCLASS()
class REWILD_API ARewildTrainingRange : public AActor
{
	GENERATED_BODY()

public:
	ARewildTrainingRange();

protected:
	virtual void BeginPlay() override;
};
