#include "RewildGameMode.h"

#include "RewildFighter.h"
#include "RewildHUD.h"

ARewildGameMode::ARewildGameMode()
{
	DefaultPawnClass = ARewildFighter::StaticClass();
	HUDClass = ARewildHUD::StaticClass();
}
