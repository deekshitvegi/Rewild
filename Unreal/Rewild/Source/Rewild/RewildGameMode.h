#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "RewildGameMode.generated.h"

/**
 * The first fight's game mode: the player flies ARewildFighter with ARewildHUD, the practice drones wait ahead
 * (ARewildTrainingRange, placed in the level), and the Harrow's Reapers come (ARewildHarrowWave, spawned here).
 */
UCLASS()
class REWILD_API ARewildGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ARewildGameMode();
	virtual void StartPlay() override;
};
