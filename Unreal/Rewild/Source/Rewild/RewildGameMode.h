#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "RewildGameMode.generated.h"

/** How the game was started (GAME_DESIGN.md, "How you play"). */
UENUM()
enum class ERewildMode : uint8
{
	Menu,   // the main menu over the fight's view (the level opened with no options)
	Story,  // the first story mission ("Mode=Story?Checkpoint=N")
	Free,   // free play: the Harrow keep coming ("Mode=Free")
};

/**
 * The first fight's game mode: the player flies ARewildFighter with ARewildHUD; the practice drones wait ahead
 * (ARewildTrainingRange, placed in the level); the crew's wingmen fly beside Dev (ARewildWingman); the Harrow come
 * (ARewildHarrowWave): by themselves in free play, sent by the story mission (ARewildMission) in the story. With no
 * options the main menu shows over the view. -RewildDemo plays the story on autopilot (-RewildFree for free play),
 * -RewildHarrow starts free play.
 */
UCLASS()
class REWILD_API ARewildGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ARewildGameMode();
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void StartPlay() override;

	ERewildMode GetMode() const { return Mode; }
	static ERewildMode ModeOf(const UWorld* World);
	/** After the story mission is won: carry on here in free play. */
	void ContinueAsFreePlay();

protected:
	ERewildMode Mode = ERewildMode::Menu;
	int32 Checkpoint = 0;
};
