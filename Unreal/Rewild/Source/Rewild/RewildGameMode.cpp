#include "RewildGameMode.h"

#include "Engine/World.h"
#include "RewildFighter.h"
#include "RewildHUD.h"
#include "RewildReaper.h"

ARewildGameMode::ARewildGameMode()
{
	DefaultPawnClass = ARewildFighter::StaticClass();
	HUDClass = ARewildHUD::StaticClass();
}

void ARewildGameMode::StartPlay()
{
	Super::StartPlay();
	FActorSpawnParameters Spawn;
	Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	GetWorld()->SpawnActor<ARewildHarrowWave>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
}
