#include "RewildMission.h"

#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "RewildBolts.h"
#include "RewildDrone.h"
#include "RewildFighter.h"
#include "RewildFlight.h"
#include "RewildHUD.h"
#include "RewildMissiles.h"
#include "RewildRadio.h"
#include "RewildReaper.h"
#include "RewildSave.h"

namespace
{
	const TCHAR* MissionName = TEXT("FirstContact");
	constexpr float PracticeTime = 80.f;  // the signal comes after three drones, or this long
	constexpr float WaveGap = 6.f;        // seconds between one wave cleared and the next
}

ARewildMission::ARewildMission()
{
	PrimaryActorTick.bCanEverTick = true;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
}

ARewildMission* ARewildMission::Find(const UWorld* World)
{
	for (TActorIterator<ARewildMission> It(const_cast<UWorld*>(World)); It; ++It)
	{
		return *It;
	}
	return nullptr;
}

void ARewildMission::Begin(int32 InCheckpoint)
{
	bDemo = FParse::Param(FCommandLine::Get(), TEXT("RewildDemo"));
	for (TActorIterator<ARewildHarrowWave> It(GetWorld()); It; ++It)
	{
		Wave = *It;
		It->SetAuto(false);  // the mission sends the packs
	}
	if (URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>())
	{
		Bolts->OnBoltHit.AddUObject(this, &ARewildMission::HandleKill);
	}
	if (URewildMissiles* Missiles = GetWorld()->GetSubsystem<URewildMissiles>())
	{
		Missiles->OnMissileHit.AddUObject(this, &ARewildMission::HandleKill);
	}
	if (ARewildFighter* Dev = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		Dev->SetRespawns(false);  // in the story, being shot down ends the attempt
	}
	Checkpoint = FMath::Clamp(InCheckpoint, 0, 3);
	Enter(Checkpoint == 0 ? ERewildBeat::Intro : Checkpoint == 1 ? ERewildBeat::Wave1 : Checkpoint == 2 ? ERewildBeat::Wave2 : ERewildBeat::Wave3);
}

void ARewildMission::Shot(float After, const FString& Why)
{
	if (bDemo)
	{
		Shots.Add({Clock + After, Why});
	}
}

void ARewildMission::Enter(ERewildBeat Next)
{
	Beat = Next;
	BeatTime = 0.f;
	WaveClearFor = 0.f;
	URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>();
	auto Say = [Radio](std::initializer_list<const TCHAR*> Ids)
	{
		for (const TCHAR* Id : Ids)
		{
			if (Radio)
			{
				Radio->Say(Id);
			}
		}
	};
	UE_LOG(LogTemp, Display, TEXT("[rewild mission] beat %d at %.1f s"), int32(Beat), Clock);
	switch (Beat)
	{
	case ERewildBeat::Intro:
		URewildSave::Write(TEXT("Story"), MissionName, 0);
		Say({TEXT("i01"), TEXT("i02"), TEXT("i03"), TEXT("i04"), TEXT("i05")});
		Shot(2.5f, TEXT("mission: the intro"));
		break;
	case ERewildBeat::Practice:
		Shot(4.f, TEXT("mission: practice"));
		break;
	case ERewildBeat::Signal:
		Say({TEXT("s01"), TEXT("s02"), TEXT("s03"), TEXT("s04")});
		Shot(6.f, TEXT("mission: the signal"));
		break;
	case ERewildBeat::Wave1:
	case ERewildBeat::Wave2:
	case ERewildBeat::Wave3:
	{
		const int32 N = Beat == ERewildBeat::Wave1 ? 1 : Beat == ERewildBeat::Wave2 ? 2 : 3;
		Checkpoint = N;
		URewildSave::Write(TEXT("Story"), MissionName, N);
		if (ARewildHarrowWave* W = Wave.Get())
		{
			W->LaunchPack(N == 1 ? 4 : N == 2 ? 5 : 6, N == 3);  // the third splits to come from both sides
		}
		if (N == 1) { Say({TEXT("s05"), TEXT("s06")}); }
		if (N == 2) { Say({TEXT("w2a"), TEXT("w2b")}); }
		if (N == 3) { Say({TEXT("w3a"), TEXT("w3b")}); }
		Shot(9.f, FString::Printf(TEXT("mission: wave %d"), N));
		break;
	}
	case ERewildBeat::Won:
		URewildSave::Write(TEXT("Story"), MissionName, 4);
		Say({TEXT("e01"), TEXT("e02"), TEXT("e03")});
		Shot(3.f, TEXT("mission: won"));
		break;
	case ERewildBeat::Lost:
		if (Radio)
		{
			Radio->Say(TEXT("f01"));
		}
		break;
	}
}

FText ARewildMission::GetObjective() const
{
	switch (Beat)
	{
	case ERewildBeat::Practice:
		return FText::FromString(FString::Printf(TEXT("Destroy three practice drones  %d / 3"), FMath::Min(DroneKills, 3)));
	case ERewildBeat::Wave1:
	case ERewildBeat::Wave2:
	case ERewildBeat::Wave3:
	{
		const int32 Left = Wave.IsValid() ? Wave->NumAlive() : 0;
		const int32 N = Beat == ERewildBeat::Wave1 ? 1 : Beat == ERewildBeat::Wave2 ? 2 : 3;
		return Left > 0
			? FText::FromString(FString::Printf(TEXT("Destroy the Harrow fighters  %d left  ·  wave %d of 3"), Left, N))
			: FText::FromString(TEXT("More are coming"));
	}
	case ERewildBeat::Won:
		return FText::FromString(TEXT("Mission complete"));
	default:
		return FText::GetEmpty();
	}
}

void ARewildMission::HandleKill(AActor* Shooter, AActor* Victim)
{
	if (!Victim || RewildFlight::IsAlive(Victim) || Counted.Contains(Victim))
	{
		return;
	}
	Counted.Add(Victim);
	if (Victim->IsA<ARewildReaper>())
	{
		++ReaperKills;
	}
	else if (Victim->IsA<ARewildDrone>() && Beat == ERewildBeat::Practice
		&& Shooter == UGameplayStatics::GetPlayerPawn(this, 0))
	{
		++DroneKills;
		URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>();
		if (Radio && DroneKills == 1)
		{
			Radio->Say(TEXT("d01"));
		}
		if (Radio && DroneKills == 2)
		{
			Radio->Say(TEXT("d02"));
		}
		Counted.Remove(Victim);  // drones come back: count each kill, not each drone
	}
}

void ARewildMission::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);
	Clock += Dt;
	BeatTime += Dt;
	URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>();
	const bool bQuiet = !Radio || !Radio->IsBusy();
	ARewildFighter* Dev = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(this, 0));

	if (Dev && Dev->IsDead() && Beat != ERewildBeat::Lost && Beat != ERewildBeat::Won)
	{
		Enter(ERewildBeat::Lost);
	}

	switch (Beat)
	{
	case ERewildBeat::Intro:
		if (bQuiet && BeatTime > 2.f)
		{
			Enter(ERewildBeat::Practice);
		}
		break;
	case ERewildBeat::Practice:
		if (DroneKills >= 3 || BeatTime > PracticeTime)
		{
			Enter(ERewildBeat::Signal);
		}
		break;
	case ERewildBeat::Signal:
		if (bQuiet && BeatTime > 2.f)
		{
			Enter(ERewildBeat::Wave1);
		}
		break;
	case ERewildBeat::Wave1:
	case ERewildBeat::Wave2:
	case ERewildBeat::Wave3:
		if (BeatTime > 4.f && Wave.IsValid() && Wave->NumAlive() == 0)
		{
			WaveClearFor += Dt;
			if (WaveClearFor > (Beat == ERewildBeat::Wave3 ? 1.5f : WaveGap))
			{
				Enter(Beat == ERewildBeat::Wave1 ? ERewildBeat::Wave2 : Beat == ERewildBeat::Wave2 ? ERewildBeat::Wave3 : ERewildBeat::Won);
			}
		}
		break;
	case ERewildBeat::Won:
	case ERewildBeat::Lost:
		if (!bPanelShown && bQuiet && BeatTime > (Beat == ERewildBeat::Won ? 2.f : 3.5f))
		{
			bPanelShown = true;
			if (ARewildHUD* HUD = Cast<ARewildHUD>(UGameplayStatics::GetPlayerController(this, 0)->GetHUD()))
			{
				HUD->ShowMissionEnd(Beat == ERewildBeat::Won);
			}
			Shot(0.6f, Beat == ERewildBeat::Won ? TEXT("mission complete panel") : TEXT("shot down panel"));
		}
		break;
	}

	for (int32 I = Shots.Num() - 1; I >= 0; --I)
	{
		if (Clock >= Shots[I].Key)
		{
			if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
			{
				PC->ConsoleCommand(TEXT("Shot showui"));
				UE_LOG(LogTemp, Display, TEXT("[rewild demo] mission shot at %.1f s: %s"), Clock, *Shots[I].Value);
			}
			Shots.RemoveAt(I);
		}
	}
}
