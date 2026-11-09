#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "RewildSave.generated.h"

/**
 * Where a game stands, for Continue (GAME_DESIGN.md, "How you play"): written by itself at the mission's start and
 * at every checkpoint. Story and free play keep their own slots ("Story", "Free"); "Last" is whichever was played
 * last, which Continue opens.
 */
UCLASS()
class REWILD_API URewildSave : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY() FString Mode;          // "Story" or "Free"
	UPROPERTY() FString Mission;       // "FirstContact"
	UPROPERTY() int32 Checkpoint = 0;  // 0 the start, 1-3 the start of a wave, 4 done
	UPROPERTY() FDateTime Saved;

	static void Write(const FString& Mode, const FString& Mission, int32 Checkpoint);
	/** The last game played, or null. */
	static URewildSave* ReadLast();
	/** The level options that pick it up again ("Mode=Story?Checkpoint=2"). */
	FString Options() const;
};

/** The player's settings (the main menu's Settings): mouse sensitivity and subtitles. */
UCLASS()
class REWILD_API URewildSettings : public USaveGame
{
	GENERATED_BODY()

public:
	UPROPERTY() int32 Mouse = 1;         // 0 low, 1 medium, 2 high
	UPROPERTY() bool bSubtitles = true;

	static URewildSettings* Get();       // loaded once, created if missing
	void Store();
	float MouseSensitivity() const;      // cursor travel per mouse count
};
