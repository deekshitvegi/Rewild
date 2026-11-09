#include "RewildGameMode.h"

#include "EngineUtils.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "RewildFighter.h"
#include "RewildDrone.h"
#include "RewildHUD.h"
#include "RewildMission.h"
#include "RewildReaper.h"
#include "RewildSave.h"
#include "RewildWingman.h"

ARewildGameMode::ARewildGameMode()
{
	DefaultPawnClass = ARewildFighter::StaticClass();
	HUDClass = ARewildHUD::StaticClass();
}

void ARewildGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);
	const FString M = UGameplayStatics::ParseOption(Options, TEXT("Mode"));
	Checkpoint = UGameplayStatics::GetIntOption(Options, TEXT("Checkpoint"), 0);
	Mode = M == TEXT("Story") ? ERewildMode::Story : M == TEXT("Free") ? ERewildMode::Free : ERewildMode::Menu;
	const TCHAR* Cmd = FCommandLine::Get();
	if (FParse::Param(Cmd, TEXT("RewildHarrow")))
	{
		Mode = ERewildMode::Free;
	}
	if (FParse::Param(Cmd, TEXT("RewildDemo")))
	{
		Mode = FParse::Param(Cmd, TEXT("RewildFree")) ? ERewildMode::Free : ERewildMode::Story;
		FParse::Value(Cmd, TEXT("RewildCheckpoint="), Checkpoint);
	}
	UE_LOG(LogTemp, Display, TEXT("[rewild] mode %d, checkpoint %d"), int32(Mode), Checkpoint);
}

ERewildMode ARewildGameMode::ModeOf(const UWorld* World)
{
	const ARewildGameMode* GM = World ? World->GetAuthGameMode<ARewildGameMode>() : nullptr;
	return GM ? GM->Mode : ERewildMode::Menu;
}

void ARewildGameMode::StartPlay()
{
	Super::StartPlay();
	FActorSpawnParameters Spawn;
	Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ARewildHarrowWave* Wave = GetWorld()->SpawnActor<ARewildHarrowWave>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
	if (Wave)
	{
		Wave->SetAuto(Mode == ERewildMode::Free);
	}

	// The wing: Noor ahead on Dev's right, Kai ahead on his left, Amara further out to the right (cm: forward, right,
	// up of Dev). Ahead, so the chase camera sees them: level with or behind Dev they flew outside its view (9 Nov).
	if (const APawn* Dev = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		const FVector Slots[3] = {FVector(6000.f, 4500.f, 400.f), FVector(6000.f, -4500.f, 400.f), FVector(11000.f, 9500.f, -500.f)};
		const FTransform T = Dev->GetActorTransform();
		for (int32 I = 0; I < 3; ++I)
		{
			if (ARewildWingman* W = GetWorld()->SpawnActor<ARewildWingman>(T.TransformPosition(Slots[I]), Dev->GetActorRotation(), Spawn))
			{
				W->Setup(I, Slots[I], Mode != ERewildMode::Story);  // in the story, a wingman shot down is out
				if (Mode == ERewildMode::Menu)
				{
					W->Order(ERewildOrder::FormUp, nullptr);
				}
			}
		}
	}
	if (Mode == ERewildMode::Menu)
	{
		// behind the menu the wing just flies: no practice drones shooting at Dev
		for (TActorIterator<ARewildDrone> It(GetWorld()); It; ++It)
		{
			It->Destroy();
		}
	}
	if (Mode == ERewildMode::Story)
	{
		if (ARewildMission* Mission = GetWorld()->SpawnActor<ARewildMission>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn))
		{
			Mission->Begin(Checkpoint);
		}
	}
	else if (Mode == ERewildMode::Free)
	{
		URewildSave::Write(TEXT("Free"), TEXT("FreePlay"), 0);
	}
}

void ARewildGameMode::ContinueAsFreePlay()
{
	Mode = ERewildMode::Free;
	for (TActorIterator<ARewildHarrowWave> It(GetWorld()); It; ++It)
	{
		It->SetAuto(true);
	}
	if (ARewildFighter* Dev = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		Dev->SetRespawns(true);
	}
}
