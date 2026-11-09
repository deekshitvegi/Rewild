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
 * Missiles (milestone 4): hold the nose on a target and the HUD's lock ring closes in 1.2 s; a missile fired when
 * locked homes on it, otherwise it flies straight. Six missiles, one back every 15 s. Flares throw hot decoys out
 * beside the ship, four at a time, to pull a Harrow missile away; twelve, one back every 6 s.
 *
 * Keyboard and mouse: mouse steers, left button fires the guns, right button a missile, F flares, W/S throttle,
 * A/D roll, Shift boost, C chase or cockpit camera, 1-4 orders to the wing (attack my target, cover me, form up,
 * weapons free), Esc pause. Gamepad: left stick steers, right trigger guns, left trigger missile, B flares, right
 * stick throttle (up/down) and roll (left/right), A boost, right stick press camera, d-pad orders (up attack, right
 * cover, down form up, left weapons free), Start pause.
 *
 * -RewildDemo on the command line flies an autopilot run against the Harrow's Reapers (guns, missiles, flares),
 * takes screenshots and quits.
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
	/** Missile lock on the current target, 0..1 (1 locked). */
	float GetLockProgress() const { return LockProgress; }
	int32 GetMissiles() const { return Missiles; }
	int32 GetMaxMissiles() const { return MissileCapacity; }
	int32 GetFlares() const { return Flares; }
	/** Story mode: being shot down ends the attempt (the mission shows the panel) instead of coming back. */
	void SetRespawns(bool bOn) { bRespawns = bOn; }
	/** Reads the player's settings (mouse sensitivity). */
	void ApplySettings();
	/** The last order given (0 attack, 1 cover, 2 form up, 3 weapons free) and how long the HUD still shows it. */
	int32 GetLastOrder() const { return LastOrder; }
	float GetOrderShown() const { return OrderShown; }
	int32 GetMaxFlares() const { return FlareCapacity; }

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

	// Missiles and flares.
	UPROPERTY(EditAnywhere, Category = "Missiles") int32 MissileCapacity = 6;
	UPROPERTY(EditAnywhere, Category = "Missiles") float MissileReload = 15.f;  // seconds for one more
	UPROPERTY(EditAnywhere, Category = "Missiles") float LockTime = 1.2f;       // seconds of nose on target to lock
	UPROPERTY(EditAnywhere, Category = "Missiles") float LockCone = 12.f;       // degrees
	UPROPERTY(EditAnywhere, Category = "Missiles") float LockRange = 2500.f;    // m
	UPROPERTY(EditAnywhere, Category = "Missiles") int32 FlareCapacity = 12;
	UPROPERTY(EditAnywhere, Category = "Missiles") int32 FlareSalvo = 4;
	UPROPERTY(EditAnywhere, Category = "Missiles") float FlareReload = 6.f;     // seconds for one more

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
	UPROPERTY() TObjectPtr<UInputAction> MissileAction;
	UPROPERTY() TObjectPtr<UInputAction> FlareAction;
	UPROPERTY() TArray<TObjectPtr<UInputAction>> OrderActions;  // 1 attack my target, 2 cover me, 3 form up, 4 weapons free
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
	void OnMissile(const FInputActionValue& Value);
	void OnFlares(const FInputActionValue& Value);
	void OnOrderAttack(const FInputActionValue& Value);
	void OnOrderCover(const FInputActionValue& Value);
	void OnOrderFormUp(const FInputActionValue& Value);
	void OnOrderFree(const FInputActionValue& Value);
	void GiveOrder(int32 Order);
	void OnCamera(const FInputActionValue& Value);
	void OnQuit(const FInputActionValue& Value);

	void SetCockpitView(bool bCockpit);
	void Fly(float DeltaSeconds);
	void TickGuns(float DeltaSeconds);
	void TickMissiles(float DeltaSeconds);
	void FireMissile();
	void DropFlares();
	void HandleMissileHit(AActor* Shooter, AActor* Victim);
	void FindTarget();
	void UpdateDust();
	void HandleHit(const FVector& Point, bool bOnShield);
	void HandleDeath();
	void HandleBoltHit(AActor* Shooter, AActor* Victim);
	void Respawn();
	void TickDemo(float DeltaSeconds);
	void Shoot(const FString& Why);
	void QueueShot(float After, const FString& Why);

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
	TWeakObjectPtr<AActor> LockTarget;
	float LockProgress = 0.f;
	int32 Missiles = 6;
	float MissileRecharge = 0.f;
	float MissileCooldown = 0.f;
	bool bRightMissileNext = false;
	int32 Flares = 16;
	float FlareRecharge = 0.f;
	float FlareCooldown = 0.f;
	int32 LastOrder = 3;
	bool bRespawns = true;
	float DemoEndedAt = -1.f;
	float OrderShown = 0.f;
	FVector LeadPoint = FVector::ZeroVector;
	bool bHasLead = false;
	float HitMarker = 0.f;
	float ShieldFlash = 0.f;
	FVector ShieldHitLocal = FVector::ZeroVector;  // where the shield was last hit, in the ship's frame
	bool bDemoSawShield = false;

	bool bDead = false;
	float RespawnIn = 0.f;
	FTransform Start;

	TArray<FVector> DustOffsets;  // speck positions, wrapped inside a box round the camera

	bool bDemo = false;
	float DemoTime = 0.f;
	int32 DemoShots = 0;
	int32 DemoKills = 0;
	bool bDemoTargetAlive = false;
	TWeakObjectPtr<AActor> DemoEngaged;
	float DemoBreak = 0.f;           // seconds left of a hard break away from a missile
	float DemoMissileGap = 0.f;
	int32 DemoMissilesFired = 0;
	int32 DemoFlareSalvos = 0;
	bool bDemoSawClose = false;
	bool bDemoSawLock = false;
	int32 DemoHitsTaken = 0;
	int32 DemoDeaths = 0;
	TArray<TPair<float, FString>> DemoQueue;  // screenshots to take: when, and why
};
