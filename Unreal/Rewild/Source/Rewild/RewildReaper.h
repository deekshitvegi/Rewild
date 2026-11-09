#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RewildFlight.h"
#include "RewildReaper.generated.h"

class UMaterialInstanceDynamic;
class URewildHealthComponent;
class UStaticMesh;
class UStaticMeshComponent;

/** What the pack wants of one Reaper (ARewildHarrowWave decides, a few times a second). */
UENUM()
enum class ERewildTactic : uint8
{
	Engage,  // fly at the player and shoot
	Flank,   // swing wide to one side of the player, then turn in
	Pincer,  // get onto the player's tail while a packmate draws them on
	Bait,    // the one being chased: jink and run, and drag the player into the pincer
};

/**
 * A Reaper, the Harrow's fighter (first fight, milestone 4): a sickle of dark cast alloy with hot seams where the ore
 * runs (art/reaper; the sickle concept the owner chose). It flies like the player's fighter, banking into its turns
 * and pulling, with the same speeds, so it is a fair fight. It has no shield: its armour takes the hits and its
 * seams glow hotter the more it is hurt.
 *
 * It fights as its pack tells it (ERewildTactic) and looks after itself: it breaks off after a pass, jinks when the
 * player sits on its tail, and when a missile comes it may throw flares and turn across the missile's path. Each
 * Reaper carries one missile; the pack lets one of them at a time lock on and fire (the HUD warns the player).
 */
UCLASS()
class REWILD_API ARewildReaper : public AActor
{
	GENERATED_BODY()

public:
	ARewildReaper();

	virtual void Tick(float DeltaSeconds) override;
	virtual FVector GetVelocity() const override { return Velocity; }

	/** Starts it flying: from the wave, facing the player, at cruise speed. */
	void StartAt(const FVector& Location, const FRotator& Facing);
	void SetTactic(ERewildTactic InTactic, float InSide = 1.f);
	ERewildTactic GetTactic() const { return Tactic; }
	/** Reached its flank or pincer place (the pack then turns it in). */
	bool HasArrived() const { return bArrived; }
	bool IsAlive() const;
	bool HasMissile() const { return bHasMissile; }
	float GetLockTime() const { return LockTime; }
	/** Slugs fired by all Reapers so far (the demo's summary). */
	static int32 SlugsFired;

	/** Whom it hunts: the player, or one of the crew's wingmen (the pack decides). Falls back to the player. */
	void SetPrey(AActor* InPrey) { Prey = InPrey; }
	AActor* GetPrey() const;

	/** The pack lets one Reaper at a time lock on and fire its missile. */
	void SetMissileAllowed(bool bAllowed) { bMissileAllowed = bAllowed; }

protected:
	virtual void BeginPlay() override;

	// Flight, matched to the player's fighter (RewildFighter): speeds in m/s, rates in degrees per second.
	UPROPERTY(EditAnywhere, Category = "Flight") float CruiseSpeed = 230.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float BoostSpeed = 360.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float PitchRate = 85.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float YawRate = 40.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float RollRate = 220.f;
	UPROPERTY(EditAnywhere, Category = "Flight") float Assist = 1.8f;

	// Guns: two, in the jaws under the beak, firing short molten slugs.
	UPROPERTY(EditAnywhere, Category = "Guns") float SlagSpeed = 1100.f;  // m/s, plus its own velocity
	UPROPERTY(EditAnywhere, Category = "Guns") float SlagRate = 10.f;     // rounds per second in a burst
	UPROPERTY(EditAnywhere, Category = "Guns") float SlagDamage = 6.f;    // the player's shield and hull are 100 each
	UPROPERTY(EditAnywhere, Category = "Guns") float GunRange = 1100.f;   // m

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere) TObjectPtr<URewildHealthComponent> Health;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> EngineHalo;  // the furnace's glow, seen from behind
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> SeamGlow;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> EngineGlow;
	UPROPERTY() TArray<TObjectPtr<UStaticMesh>> Debris;

	enum class EManoeuvre : uint8 { None, Break, Extend, Jink };

	FVector Velocity = FVector::ZeroVector;
	FRewildStick Stick;
	TWeakObjectPtr<AActor> Prey;
	float Clock = 0.f;
	bool bBoosting = false;

	ERewildTactic Tactic = ERewildTactic::Engage;
	float Side = 1.f;
	float TacticTime = 0.f;
	bool bArrived = false;

	EManoeuvre Manoeuvre = EManoeuvre::None;
	float ManoeuvreLeft = 0.f;
	FVector ManoeuvreDir = FVector::ForwardVector;
	float JinkSwitch = 0.f;

	float BurstLeft = 0.f;
	float BurstPause = 0.f;
	float GunCooldown = 0.f;
	bool bRightGun = false;
	FVector PlayerVelocitySeen = FVector::ZeroVector;  // lags the truth a little: it can be out-jinked

	bool bHasMissile = true;
	bool bMissileAllowed = false;
	float MissileReload = 0.f;
	float LockTime = 0.f;

	int32 FlaresLeft = 12;
	float DefendCooldown = 0.f;
	float HitFlash = 0.f;

	void Think(float Dt, FVector& OutDir, float& OutSpeed);
	void Steer(const FVector& Dir, float Speed, float Dt);  // Speed in m/s
	void TickGuns(float Dt, const AActor* Player);
	void TickMissile(float Dt, AActor* Player);
	void Defend(float Dt, const AActor* Player);
	void StartManoeuvre(EManoeuvre Kind, const FVector& Dir, float Seconds);
	void HandleHit(const FVector& Point, bool bOnShield);
	void UpdateHalo();
	void Die();
};

/**
 * The Harrow's attack on the first fight (milestone 4): packs of Reapers that come for the player once the practice
 * has gone on a while (at once with -RewildDemo or -RewildHarrow). A pack is three, then four, then five. It flanks:
 * one engages head-on while the others swing wide and turn in from the sides; when the player chases one, it runs
 * and jinks as bait while the rest close on the player's tail. When a pack is destroyed the next comes 8 s later.
 */
UCLASS()
class REWILD_API ARewildHarrowWave : public AActor
{
	GENERATED_BODY()

public:
	ARewildHarrowWave();

	virtual void Tick(float DeltaSeconds) override;
	/** Reapers alive now. */
	int32 NumAlive() const;
	bool HasStarted() const { return bStarted; }
	/** Free play: packs come by themselves, one after another. The story mission turns this off and calls LaunchPack. */
	void SetAuto(bool bInAuto) { bAuto = bInAuto; }
	/** A pack of Size Reapers, 3.5 km ahead of the player, coming in; split, half come from each side. */
	void LaunchPack(int32 Size, bool bSplit = false);

protected:
	virtual void BeginPlay() override;

	UPROPERTY(EditAnywhere, Category = "Harrow") float StartDelay = 35.f;  // seconds of practice before they come
	UPROPERTY(EditAnywhere, Category = "Harrow") float PackGap = 8.f;      // seconds between packs

private:
	TArray<TWeakObjectPtr<ARewildReaper>> Pack;
	TWeakObjectPtr<ARewildReaper> Locker;  // the one allowed to fire its missile
	float Clock = 0.f;
	float NextPackIn = 0.f;
	float ThinkIn = 0.f;
	float MissileGap = 0.f;
	float ReflankIn = 12.f;
	int32 PacksSent = 0;
	bool bStarted = false;
	bool bAuto = true;
	bool bWasMissileFlying = false;

	void SpawnPack(int32 Size, bool bSplit);
	void Coordinate();
};
