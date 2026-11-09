#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "RewildMissiles.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMesh;
class UStaticMeshComponent;

/** Whose missile: decides its model, its flame, how hard it turns and how easily flares fool it. */
enum class ERewildMissileKind : uint8
{
	Rewild,  // the player's, built at Haven: white-hot motor, white smoke
	Harrow,  // the Reapers': a dark cast dart with a deep orange flame
};

/** Draws every missile, its flame and smoke trail, and every flare (instances, a few draws in all). */
UCLASS(NotPlaceable)
class REWILD_API ARewildMissileRenderer : public AActor
{
	GENERATED_BODY()

public:
	ARewildMissileRenderer();

	/** A pooled body mesh for missile number Index this frame. */
	UStaticMeshComponent* Body(int32 Index, ERewildMissileKind Kind);
	void HideBodiesFrom(int32 Count);

	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> PlumeRewild;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> PlumeHarrow;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> GlowRewild;  // the nozzle's white-hot point
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> GlowHarrow;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Flares;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UInstancedStaticMeshComponent> Smoke;  // per-instance opacity in custom data 0

	UPROPERTY() TObjectPtr<UStaticMesh> RewildMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> HarrowMesh;
	UPROPERTY() TObjectPtr<UStaticMesh> Cylinder;  // stand-in body until the missile models are imported
	UPROPERTY() TArray<TObjectPtr<UStaticMeshComponent>> Bodies;
};

/**
 * Every missile and flare in the world (first fight, milestone 4). A missile drops clear of its launcher, lights its
 * motor and steers by proportional navigation (it turns to hold the line of sight to its target steady, as real
 * missiles do) within a turn limit, so a hard break at the right moment can beat it. A proximity fuse sets it off
 * near the target; the blast hurts everything of the other side close by. Flares are hot decoys: a missile that sees
 * one in its seeker may chase it instead.
 */
UCLASS()
class REWILD_API URewildMissiles : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	/** Launches from a hardpoint (From, facing Rotation). It homes on Target, or flies straight if there is none. */
	void Launch(AActor* Shooter, ERewildMissileKind Kind, int32 Team, const FVector& From, const FQuat& Rotation,
		const FVector& ShooterVelocity, AActor* Target);
	/** A salvo of flares thrown out behind and below. */
	void DropFlares(AActor* Owner, int32 Team, const FVector& From, const FQuat& Rotation, const FVector& OwnerVelocity, int32 Count);
	/** Someone is locking on (Progress 0..1, 1 locked). Call every frame while it holds; it lapses when not renewed. */
	void ReportLock(AActor* Shooter, AActor* Victim, float Progress);

	struct FThreat
	{
		FVector Position;
		FVector Velocity;
		float Seconds;  // to impact, roughly
	};
	/** Missiles homing on Victim right now (not fooled, not lost). */
	void GetThreats(const AActor* Victim, TArray<FThreat>& Out) const;
	/** The strongest lock on Victim right now (0 if none), and where the locker is. */
	float GetLockOn(const AActor* Victim, FVector* OutFrom = nullptr) const;
	/** Missiles of this team in flight. */
	int32 NumInFlight(int32 Team) const;

	DECLARE_MULTICAST_DELEGATE_TwoParams(FOnMissileHit, AActor* /*Shooter*/, AActor* /*Victim*/);
	FOnMissileHit OnMissileHit;

	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(URewildMissiles, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override
	{
		return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
	}

private:
	struct FMissile
	{
		FVector Position;
		FVector Velocity;
		FQuat Rotation;
		float Age = 0.f;
		ERewildMissileKind Kind = ERewildMissileKind::Rewild;
		int32 Team = 0;
		TWeakObjectPtr<AActor> Shooter;
		TWeakObjectPtr<AActor> Target;
		int32 FlareTarget = 0;  // id of the flare it chases instead (0 none)
		bool bLost = false;      // the target left its seeker: it flies on blind
		TArray<int32> FlaresSeen;
		FVector LastPuff = FVector::ZeroVector;
		float PuffClock = 0.f;
	};
	struct FFlare
	{
		int32 Id;
		FVector Position;
		FVector Velocity;
		float Age;
		int32 Team;
		FVector LastPuff;
		float PuffClock;
		float Flicker;
	};
	struct FPuff  // one stretch of smoke trail, a soft stretched sphere from A to B
	{
		FVector A;
		FVector B;
		FVector Drift;
		float Age;
		float Life;
		float Width0;
		float Width1;
		float Opacity;
	};
	struct FLock
	{
		TWeakObjectPtr<AActor> Shooter;
		TWeakObjectPtr<AActor> Victim;
		float Progress;
		float Time;
	};

	TArray<FMissile> Missiles;
	TArray<FFlare> Flares;
	TArray<FPuff> Puffs;
	TArray<FLock> Locks;
	int32 NextFlareId = 1;
	float Clock = 0.f;
	TWeakObjectPtr<ARewildMissileRenderer> Renderer;
	int32 Drawn[6] = {0, 0, 0, 0, 0, 0};

	const FFlare* FindFlare(int32 Id) const;
	void Guide(FMissile& M, float Dt);
	void Detonate(const FMissile& M, const FVector& At, bool bOnTarget);
	void AddPuff(const FVector& A, const FVector& B, const FVector& Drift, float Life, float Width0, float Width1, float Opacity);
	void Draw();
};
