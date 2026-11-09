#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "RewildMission.generated.h"

class ARewildHarrowWave;

/** Where the first story mission stands (docs/missions/first_contact.md). */
UENUM()
enum class ERewildBeat : uint8
{
	Intro,
	Practice,
	Signal,
	Wave1,
	Wave2,
	Wave3,
	Won,
	Lost,
};

/**
 * "First contact", the first story mission (first fight, milestone 5): over the Nile, Dev's wing finishes gunnery
 * practice; a voice from the Holdouts at Svalbard gives them away; the Harrow come in three waves, four, five and
 * six Reapers. It runs the radio's story lines, the objective, the packs, saves a checkpoint at the start and at each
 * wave, and ends with the mission complete or Dev shot down (ARewildHUD shows the panel). Lines and beats:
 * docs/missions/first_contact.md.
 */
UCLASS()
class REWILD_API ARewildMission : public AActor
{
	GENERATED_BODY()

public:
	ARewildMission();

	/** Starts at a checkpoint: 0 the start, 1-3 the start of a wave. */
	void Begin(int32 InCheckpoint);
	virtual void Tick(float DeltaSeconds) override;

	ERewildBeat GetBeat() const { return Beat; }
	int32 GetCheckpoint() const { return Checkpoint; }
	FText GetObjective() const;
	int32 GetReaperKills() const { return ReaperKills; }
	float GetTime() const { return Clock; }

	static ARewildMission* Find(const UWorld* World);

private:
	ERewildBeat Beat = ERewildBeat::Intro;
	float BeatTime = 0.f;
	float Clock = 0.f;
	int32 Checkpoint = 0;
	int32 DroneKills = 0;
	int32 ReaperKills = 0;
	float WaveClearFor = 0.f;
	bool bPanelShown = false;
	bool bDemo = false;
	TArray<TPair<float, FString>> Shots;  // -RewildDemo: screenshots to take at the beats
	TSet<TWeakObjectPtr<AActor>> Counted;
	TWeakObjectPtr<ARewildHarrowWave> Wave;

	void Enter(ERewildBeat Next);
	void HandleKill(AActor* Shooter, AActor* Victim);
	void Shot(float After, const FString& Why);
};
