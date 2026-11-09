#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "RewildRadio.generated.h"

class AActor;
class USoundBase;

/** Who is speaking (docs/missions/first_contact.md; the owner's cast in art/audio/README.md). */
UENUM()
enum class ERewildSpeaker : uint8
{
	Argo,     // the ship's mind: dry, she is the ship
	Dev,      // the player
	Noor,
	Kai,
	Amara,
	Holdout,  // a voice from Svalbard, through static
};

/**
 * The radio (first fight, milestone 5): the crew and ARGO talking, one line at a time, each with its recorded voice
 * (/Game/Audio/Radio/FC_<id>) and a subtitle. Story lines queue and always play; chatter plays only when the radio is
 * quiet and has been for a few seconds, and is dropped otherwise, so it never piles up. It also listens to the fight
 * and calls out what matters: a Reaper on Dev's tail, a missile lock or launch, shields down, a kill, a wingman hit
 * or shot down.
 */
UCLASS()
class REWILD_API URewildRadio : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	/** A story line: queued, never dropped. */
	void Say(FName Id);
	/** Chatter: one of these lines (at random), if the radio is quiet; returns whether it plays. */
	bool Chatter(std::initializer_list<FName> Ids);
	/** A line spoken by one wingman (0 Noor, 1 Kai, 2 Amara) if the radio is quiet. */
	bool ChatterBy(int32 Wingman, std::initializer_list<FName> PerWingman);

	/** Anything playing or waiting. */
	bool IsBusy() const { return Current.IsSet() || Queue.Num() > 0; }
	/** The subtitle now showing: speaker's name, the words, and a fade 0..1. False when the radio is quiet. */
	bool GetSubtitle(FText& OutName, FText& OutWords, float& OutAlpha) const;
	/** Off in the menus. */
	void SetListening(bool bOn) { bListening = bOn; }

	static FText SpeakerName(ERewildSpeaker Speaker);

	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(URewildRadio, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type WorldType) const override
	{
		return WorldType == EWorldType::Game || WorldType == EWorldType::PIE;
	}

private:
	struct FPlaying
	{
		FName Id;
		ERewildSpeaker Speaker;
		FText Words;
		float Left;
		float Total;
	};
	TOptional<FPlaying> Current;
	TArray<FName> Queue;
	TMap<FName, TObjectPtr<USoundBase>> Sounds;  // loaded once
	float Quiet = 10.f;          // seconds since the last line ended
	float WatchIn = 0.f;
	TMap<FName, float> Cooldowns;  // per kind of call-out
	bool bListening = true;
	bool bWasShield = true;
	bool bSaidHull = false;
	int32 ThreatsBefore = 0;

	void Start(FName Id);
	void Watch();
	bool Ready(FName Kind, float Cooldown);
	void HandleKill(AActor* Shooter, AActor* Victim);
};
