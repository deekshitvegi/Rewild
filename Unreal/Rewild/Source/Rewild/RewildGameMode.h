#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "RewildGameMode.generated.h"

/** The first fight's game mode: the player flies ARewildFighter, with ARewildHUD's aim reticle. */
UCLASS()
class REWILD_API ARewildGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ARewildGameMode();
};
