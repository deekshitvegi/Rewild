#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "InputActionValue.h"
#include "RewildFighter.generated.h"

class UCameraComponent;
class UInstancedStaticMeshComponent;
class UInputAction;
class UInputMappingContext;
class UMaterialInstanceDynamic;
class URewildHealthComponent;
class USpringArmComponent;
class UStaticMeshComponent;

/**
 * The player's fighter (first fight: milestone 2 flying, milestone 3 fighting).
 *
 * Arcade space flight with flight assist: the ship turns at fixed rates, and its velocity swings round toward where
 * the nose points over about a second, so it drifts a little in hard turns. The mouse is a virtual stick: moving it
 * offsets an aim cursor, and the ship turns toward the cursor in proportion to the offset. Throttle sets cruising
 * speed; boost runs hotter and faster until the engines overheat.
 *
 * Two cannons fire bolts that fly at a finite speed plus the ship's own, so moving targets must be led (the HUD shows
 * where to aim at the target nearest the nose). The guns heat up; a shield takes hits first and recharges, then the
 * hull. Destroyed, the fighter blows apart and returns to the start.
 *
 * Keyboard and mouse: mouse steers, left button fires, W/S throttle, A/D roll, Shift boost, C chase or cockpit
 * camera, Esc quit. Gamepad: left stick steers, right trigger fires, right stick throttle (up/down) and roll
 * (left/right), A boost, right stick press camera.
 *
 * -RewildDemo on the command line flies an autopilot run against the training drones, takes screenshots and quits.
 */
UCLASS()
class REWILD_API ARewildFighter : public APawn
{
	GENERATED_BODY()

public:
	ARewildFighter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual FVector GetVelocity() const override { return Velocity; }

	/** The aim cursor, -1..1 on each axis (the HUD draws it). */
	FVector2D GetAimCursor() const { return AimCursor; }
	float GetSpeedMetresPerSecond() const { return Velocity.Size() / 100.f; }
	float GetThrottle() const { return Throttle; }
	float GetBoostHeat() const { return BoostHeat; }
	float GetGunHeat() const { return GunHeat; }
	bool AreGunsOverheated() const { return bGunsOverheated; }
	bool IsCockpitView() const { return bCockpitView; }
	bool IsDead() const { return bDead; }
	URewildHealthComponent* GetHealth() const { return Health; }
	/** The target nearest the nose (within 35 degrees and 2.5 km), or null. */
	AActor* GetTarget() const { return Target.Get(); }
	/** Where to aim so the bolts meet the target; false without a target or a solution. */
	bool GetLeadPoint(FVector& Out) const { Out = LeadPoint; return bHasLead; }
	/** Seconds left of the hit marker (a bolt of ours just hit). */
	float GetHitMarker() const { return HitMarker; }

protected:
	virtual void BeginPlay() override;

	// Flight figures. Speeds in metres per second, rates in degrees per second.
	UPROPERTY(EditAnywhere, Category = "Flight") float CruiseSpeedMax = 220.f;  // about 800 km/h relative to the fight
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostSpeed = 420.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float PitchRate = 80.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float YawRate = 55.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float RollRate = 160.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float BankIntoTurns = 25.f;   // roll added by steering sideways
	UPROPERTY(EditAnywhere, Category = "Flight") float Assist = 1.6f;          // how fast velocity follows the nose (1/s)
	UPROPERTY(EditAnywhere, Category = "Flight") float ThrottleRate = 0.6f;    // throttle travel per second
	UPROPERTY(EditAnywhere, Category = "Flight") float MouseSensitivity = 0.0025f; // cursor travel per mouse count
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostHeatRate = 0.25f;  // full heat in 4 s of boost
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostCoolRate = 0.15f;
	UPROPERTY(EditAnywhere, Category = "Engines") float GlowIdle = 8000.f;     // M_FighterEngine Glow at idle
	UPROPERTY(EditAnywhere, Category = "Engines") float GlowFull = 100000.f;   // full throttle (x1.6 on boost): reads hot at EV 14.5

	// Guns: two cannons, fired in turn.
	UPROPERTY(EditAnywhere, Category = "Guns") float GunRate = 12.f;           // rounds per second, both guns together
	UPROPERTY(EditAnywhere, Category = "Guns") float GunSpeed = 1500.f;        // m/s, plus the ship's own velocity
	UPROPERTY(EditAnywhere, Category = "Guns") float GunDamage = 4.f;          // a drone takes 20 hits, the fighter 50
	UPROPERTY(EditAnywhere, Category = "Guns") float GunHeatPerShot = 0.035f;  // about 2.4 s of fire to overheat
	UPROPERTY(EditAnywhere, Category = "Guns") float GunCoolRate = 0.4f;
	UPROPERTY(EditAnywhere, Category = "Guns") float Convergence = 700.f;      // m: the two streams cross here

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Hull;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Canopy;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> ShieldBubble;
	UPROPERTY(VisibleAnywhere) TObjectPtr<USpringArmComponent> ChaseArm;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> ChaseCamera;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UCameraComponent> CockpitCamera;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Dust;
	UPROPERTY(VisibleAnywhere) TObjectPtr<URewildHealthComponent> Health;

	UPROPERTY() TObjectPtr<UInputMappingContext> Mapping;
	UPROPERTY() TObjectPtr<UInputAction> LookAction;
	UPROPERTY() TObjectPtr<UInputAction> StickAction;
	UPROPERTY() TObjectPtr<UInputAction> RollAction;
	UPROPERTY() TObjectPtr<UInputAction> ThrottleAction;
	UPROPERTY() TObjectPtr<UInputAction> BoostAction;
	UPROPERTY() TObjectPtr<UInputAction> FireAction;
	UPROPERTY() TObjectPtr<UInputAction> CameraAction;
	UPROPERTY() TObjectPtr<UInputAction> QuitAction;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> EngineGlow;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> ShieldMaterial;

	void BuildInput();
	void OnLook(const FInputActionValue& Value);
	void OnStick(const FInputActionValue& Value);
	void OnStickReleased(const FInputActionValue& Value);
	void OnRoll(const FInputActionValue& Value);
	void OnRollReleased(const FInputActionValue& Value);
	void OnThrottle(const FInputActionValue& Value);
	void OnThrottleReleased(const FInputActionValue& Value);
	void OnBoost(const FInputActionValue& Value);
	void OnBoostReleased(const FInputActionValue& Value);
	void OnFire(const FInputActionValue& Value);
	void OnFireReleased(const FInputActionValue& Value);
	void OnCamera(const FInputActionValue& Value);
	void OnQuit(const FInputActionValue& Value);

	void SetCockpitView(bool bCockpit);
	void Fly(float DeltaSeconds);
	void TickGuns(float DeltaSeconds);
	void FindTarget();
	void UpdateDust();
	void HandleHit(const FVector& Point, bool bOnShield);
	void HandleDeath();
	void HandleBoltHit(AActor* Shooter, AActor* Victim);
	void Respawn();
	void TickDemo(float DeltaSeconds);
	void Shoot(const TCHAR* Why);

	FVector Velocity = FVector::ZeroVector;  // cm/s, world
	FVector2D AimCursor = FVector2D::ZeroVector;
	FVector2D Stick = FVector2D::ZeroVector;
	float RollInput = 0.f;
	float ThrottleInput = 0.f;
	float Throttle = 0.5f;
	float BoostHeat = 0.f;
	bool bBoostHeld = false;
	bool bOverheated = false;
	bool bCockpitView = false;

	bool bFireHeld = false;
	float GunCooldown = 0.f;
	float GunHeat = 0.f;
	bool bGunsOverheated = false;
	bool bRightGunNext = false;

	TWeakObjectPtr<AActor> Target;
	FVector LeadPoint = FVector::ZeroVector;
	bool bHasLead = false;
	float HitMarker = 0.f;
	float ShieldFlash = 0.f;

	bool bDead = false;
	float RespawnIn = 0.f;
	FTransform Start;

	TArray<FVector> DustOffsets;  // speck positions, wrapped inside a box round the camera

	bool bDemo = false;
	float DemoTime = 0.f;
	int32 DemoShots = 0;
	int32 DemoKills = 0;
	bool bDemoTargetAlive = false;
	TArray<float> DemoShotAt;  // times to take a screenshot
};
