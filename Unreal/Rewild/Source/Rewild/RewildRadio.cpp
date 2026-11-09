#include "RewildRadio.h"

#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "RewildBolts.h"
#include "RewildFighter.h"
#include "RewildFlight.h"
#include "RewildHealthComponent.h"
#include "RewildMissiles.h"
#include "RewildReaper.h"
#include "RewildWingman.h"
#include "Sound/SoundBase.h"

namespace
{
	struct FLine
	{
		const TCHAR* Id;
		ERewildSpeaker Speaker;
		const TCHAR* Words;
	};

	// The first story mission's lines (docs/missions/first_contact.md is the script; keep the two the same).
	const FLine Lines[] = {
		{TEXT("i01"), ERewildSpeaker::Argo, TEXT("Four hundred kilometres up. That's the Nile under you, Dev.")},
		{TEXT("i02"), ERewildSpeaker::Dev, TEXT("So that's Earth.")},
		{TEXT("i03"), ERewildSpeaker::Noor, TEXT("It's all desert. Where did all the green go?")},
		{TEXT("i04"), ERewildSpeaker::Kai, TEXT("Three hundred years with nobody to look after it. Give it time.")},
		{TEXT("i05"), ERewildSpeaker::Dev, TEXT("All right, range is hot. Drones ahead. Let's see if we can still shoot straight.")},
		{TEXT("d01"), ERewildSpeaker::Kai, TEXT("One down. Show-off.")},
		{TEXT("d02"), ERewildSpeaker::Amara, TEXT("That's two.")},
		{TEXT("s01"), ERewildSpeaker::Argo, TEXT("Dev, I'm picking up a voice. Ground source, seventy-eight north.")},
		{TEXT("s02"), ERewildSpeaker::Holdout, TEXT("Anyone up there... this is Svalbard... we can see your engines... please... they're in the vault...")},
		{TEXT("s03"), ERewildSpeaker::Amara, TEXT("Svalbard. The Seed Vault. There are still people down there.")},
		{TEXT("s04"), ERewildSpeaker::Noor, TEXT("Then we answer them.")},
		{TEXT("s05"), ERewildSpeaker::Argo, TEXT("Contact. Four Harrow fighters, over the horizon. They heard it too.")},
		{TEXT("s06"), ERewildSpeaker::Dev, TEXT("Reapers. Weapons free. Everyone stay on me.")},
		{TEXT("w2a"), ERewildSpeaker::Argo, TEXT("Five more, high on your left.")},
		{TEXT("w2b"), ERewildSpeaker::Kai, TEXT("They're testing us.")},
		{TEXT("w3a"), ERewildSpeaker::Argo, TEXT("Six. They're splitting up to come at you from both sides.")},
		{TEXT("w3b"), ERewildSpeaker::Dev, TEXT("Then so do we. Noor, Kai, take the left. Amara, you're with me.")},
		{TEXT("e01"), ERewildSpeaker::Argo, TEXT("That's the last of them. Their carrier will know by now.")},
		{TEXT("e02"), ERewildSpeaker::Dev, TEXT("Svalbard, this is the Argo. We hear you. Hold on. We're coming.")},
		{TEXT("e03"), ERewildSpeaker::Holdout, TEXT("We hear you... we'll hold...")},
		{TEXT("f01"), ERewildSpeaker::Argo, TEXT("Dev? Dev, answer me.")},
		{TEXT("k1"), ERewildSpeaker::Kai, TEXT("Got one!")},
		{TEXT("k2"), ERewildSpeaker::Noor, TEXT("He's down.")},
		{TEXT("k3"), ERewildSpeaker::Amara, TEXT("Scratch one Reaper.")},
		{TEXT("p1"), ERewildSpeaker::Kai, TEXT("Nice shot, Dev!")},
		{TEXT("p2"), ERewildSpeaker::Amara, TEXT("Good kill.")},
		{TEXT("p3"), ERewildSpeaker::Noor, TEXT("That's one less.")},
		{TEXT("t1"), ERewildSpeaker::Kai, TEXT("Dev, one on your tail!")},
		{TEXT("t2"), ERewildSpeaker::Amara, TEXT("Break, Dev, you've got one behind you!")},
		{TEXT("t3"), ERewildSpeaker::Noor, TEXT("Dev, behind you!")},
		{TEXT("a1"), ERewildSpeaker::Argo, TEXT("Missile lock.")},
		{TEXT("a2"), ERewildSpeaker::Argo, TEXT("Missile launched. Break and flare.")},
		{TEXT("a3"), ERewildSpeaker::Argo, TEXT("Shields down.")},
		{TEXT("a4"), ERewildSpeaker::Argo, TEXT("Hull breach. You can't take much more, Dev.")},
		{TEXT("h1"), ERewildSpeaker::Kai, TEXT("I'm hit, I'm hit!")},
		{TEXT("h2"), ERewildSpeaker::Noor, TEXT("They got my shields!")},
		{TEXT("h3"), ERewildSpeaker::Amara, TEXT("Taking fire!")},
		{TEXT("x1"), ERewildSpeaker::Kai, TEXT("I'm out! Ejecting!")},
		{TEXT("x2"), ERewildSpeaker::Noor, TEXT("I'm going down... punching out!")},
		{TEXT("x3"), ERewildSpeaker::Amara, TEXT("Lost my engines. Ejecting!")},
		{TEXT("x4"), ERewildSpeaker::Argo, TEXT("I have their beacon. I'll pick them up.")},
		{TEXT("oa1"), ERewildSpeaker::Kai, TEXT("On your target.")},
		{TEXT("oa2"), ERewildSpeaker::Noor, TEXT("Copy, going after it.")},
		{TEXT("oa3"), ERewildSpeaker::Amara, TEXT("Engaging your target.")},
		{TEXT("oc1"), ERewildSpeaker::Kai, TEXT("Coming to you, Dev.")},
		{TEXT("oc2"), ERewildSpeaker::Noor, TEXT("I've got your back.")},
		{TEXT("oc3"), ERewildSpeaker::Amara, TEXT("Covering you.")},
		{TEXT("of1"), ERewildSpeaker::Kai, TEXT("Forming up.")},
		{TEXT("of2"), ERewildSpeaker::Noor, TEXT("On your wing.")},
		{TEXT("of3"), ERewildSpeaker::Amara, TEXT("Rejoining.")},
		{TEXT("oe1"), ERewildSpeaker::Kai, TEXT("Weapons free!")},
		{TEXT("oe2"), ERewildSpeaker::Amara, TEXT("Picking my own.")},
		{TEXT("oe3"), ERewildSpeaker::Noor, TEXT("Going hunting.")},
	};

	const FLine* Find(FName Id)
	{
		for (const FLine& L : Lines)
		{
			if (Id == FName(L.Id))
			{
				return &L;
			}
		}
		return nullptr;
	}

	constexpr float QuietBeforeChatter = 1.5f;  // seconds of silence before chatter may speak
	constexpr float Gap = 0.35f;                 // between lines
}

FText URewildRadio::SpeakerName(ERewildSpeaker Speaker)
{
	switch (Speaker)
	{
	case ERewildSpeaker::Argo: return FText::FromString(TEXT("ARGO"));
	case ERewildSpeaker::Dev: return FText::FromString(TEXT("Dev"));
	case ERewildSpeaker::Noor: return FText::FromString(TEXT("Noor"));
	case ERewildSpeaker::Kai: return FText::FromString(TEXT("Kai"));
	case ERewildSpeaker::Amara: return FText::FromString(TEXT("Amara"));
	default: return FText::FromString(TEXT("Svalbard"));
	}
}

void URewildRadio::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	if (URewildBolts* Bolts = Collection.InitializeDependency<URewildBolts>())
	{
		Bolts->OnBoltHit.AddUObject(this, &URewildRadio::HandleKill);
	}
	if (URewildMissiles* Missiles = Collection.InitializeDependency<URewildMissiles>())
	{
		Missiles->OnMissileHit.AddUObject(this, &URewildRadio::HandleKill);
	}
}

void URewildRadio::Say(FName Id)
{
	if (Find(Id))
	{
		Queue.Add(Id);
	}
}

namespace
{
	bool SpeakerFlying(UWorld* World, ERewildSpeaker Speaker)
	{
		int32 Index = Speaker == ERewildSpeaker::Noor ? 0 : Speaker == ERewildSpeaker::Kai ? 1 : Speaker == ERewildSpeaker::Amara ? 2 : -1;
		if (Index < 0)
		{
			return true;
		}
		for (TActorIterator<ARewildWingman> It(World); It; ++It)
		{
			if (It->GetIndex() == Index)
			{
				return It->IsAlive();
			}
		}
		return false;
	}
}

bool URewildRadio::Chatter(std::initializer_list<FName> Ids)
{
	if (!bListening || IsBusy() || Quiet < QuietBeforeChatter)
	{
		return false;
	}
	TArray<FName> Can;
	for (const FName& Id : Ids)
	{
		const FLine* L = Find(Id);
		if (L && SpeakerFlying(GetWorld(), L->Speaker))
		{
			Can.Add(Id);
		}
	}
	if (Can.Num() == 0)
	{
		return false;
	}
	Start(Can[FMath::RandRange(0, Can.Num() - 1)]);
	return true;
}

bool URewildRadio::ChatterBy(int32 Wingman, std::initializer_list<FName> PerWingman)
{
	if (Wingman < 0 || Wingman >= int32(PerWingman.size()) || !bListening || IsBusy() || Quiet < QuietBeforeChatter)
	{
		return false;
	}
	Start(*(PerWingman.begin() + Wingman));
	return true;
}

void URewildRadio::Start(FName Id)
{
	const FLine* L = Find(Id);
	if (!L)
	{
		return;
	}
	USoundBase* Sound = nullptr;
	if (TObjectPtr<USoundBase>* Found = Sounds.Find(Id))
	{
		Sound = *Found;
	}
	else
	{
		const FString Path = FString::Printf(TEXT("/Game/Audio/Radio/FC_%s.FC_%s"), L->Id, L->Id);
		Sound = LoadObject<USoundBase>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
		Sounds.Add(Id, Sound);
	}
	float Seconds = 1.2f + 0.065f * FCString::Strlen(L->Words);  // a reading pace when there is no recording
	if (Sound)
	{
		UGameplayStatics::PlaySound2D(this, Sound);
		Seconds = Sound->GetDuration() + 0.25f;
	}
	Current = FPlaying{Id, L->Speaker, FText::FromString(L->Words), Seconds, Seconds};
	UE_LOG(LogTemp, Display, TEXT("[rewild radio] %s: %s"), *SpeakerName(L->Speaker).ToString(), L->Words);
}

bool URewildRadio::GetSubtitle(FText& OutName, FText& OutWords, float& OutAlpha) const
{
	if (!Current.IsSet())
	{
		return false;
	}
	OutName = SpeakerName(Current->Speaker);
	OutWords = Current->Words;
	const float Age = Current->Total - Current->Left;
	OutAlpha = FMath::Clamp(FMath::Min(Age / 0.15f, (Current->Left + 0.2f) / 0.35f), 0.f, 1.f);
	return true;
}

bool URewildRadio::Ready(FName Kind, float Cooldown)
{
	float& Next = Cooldowns.FindOrAdd(Kind);
	const float Now = GetWorld()->GetTimeSeconds();
	if (Now < Next)
	{
		return false;
	}
	Next = Now + Cooldown;
	return true;
}

void URewildRadio::Tick(float DeltaTime)
{
	const float Dt = FMath::Min(DeltaTime, 0.1f);
	if (Current.IsSet())
	{
		Current->Left -= Dt;
		if (Current->Left <= -Gap)
		{
			Current.Reset();
			Quiet = 0.f;
		}
	}
	else
	{
		Quiet += Dt;
		if (Queue.Num() > 0)
		{
			const FName Next = Queue[0];
			Queue.RemoveAt(0);
			Start(Next);
		}
	}
	WatchIn -= Dt;
	if (WatchIn <= 0.f && bListening)
	{
		WatchIn = 0.4f;
		Watch();
	}
}

void URewildRadio::Watch()
{
	ARewildFighter* Dev = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(GetWorld(), 0));
	if (!Dev || Dev->IsDead())
	{
		bWasShield = true;
		bSaidHull = false;
		return;
	}
	URewildMissiles* Missiles = GetWorld()->GetSubsystem<URewildMissiles>();
	const URewildHealthComponent* H = Dev->GetHealth();

	// A missile on its way: ARGO cuts in (urgent: it may interrupt chatter).
	TArray<URewildMissiles::FThreat> Threats;
	if (Missiles)
	{
		Missiles->GetThreats(Dev, Threats);
	}
	if (Threats.Num() > ThreatsBefore && Ready(TEXT("launch"), 5.f))
	{
		if (Current.IsSet() && Current->Speaker != ERewildSpeaker::Argo && !Queue.Num())
		{
			Current.Reset();  // chatter gives way
		}
		Queue.Insert(TEXT("a2"), 0);
	}
	ThreatsBefore = Threats.Num();

	if (Missiles && Missiles->GetLockOn(Dev) > 0.6f && Threats.Num() == 0 && Ready(TEXT("lock"), 12.f))
	{
		Chatter({TEXT("a1")});
	}
	if (H)
	{
		const bool bShield = H->GetShieldFraction() > 0.f;
		if (bWasShield && !bShield && Ready(TEXT("shield"), 20.f))
		{
			Chatter({TEXT("a3")});
		}
		bWasShield = bShield;
		if (!bSaidHull && H->GetHullFraction() < 0.33f)
		{
			bSaidHull = Chatter({TEXT("a4")});
		}
	}

	// A Reaper close behind Dev with its nose on him: a wingman calls it.
	const FVector P = Dev->GetActorLocation();
	const FVector Back = -Dev->GetActorForwardVector();
	for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
	{
		if (!It->IsAlive())
		{
			continue;
		}
		const FVector To = It->GetActorLocation() - P;
		if (To.Size() < 60000.f && RewildFlight::AngleDeg(Back, To) < 35.f
			&& RewildFlight::AngleDeg(It->GetActorForwardVector(), -To) < 25.f && Ready(TEXT("tail"), 12.f))
		{
			Chatter({TEXT("t1"), TEXT("t2"), TEXT("t3")});
			break;
		}
	}
}

void URewildRadio::HandleKill(AActor* Shooter, AActor* Victim)
{
	if (!Shooter || !Victim || !Victim->IsA<ARewildReaper>() || RewildFlight::IsAlive(Victim))
	{
		return;
	}
	static TSet<TWeakObjectPtr<AActor>> Credited;  // a wreck can take several hits in the frame it dies
	if (Credited.Contains(Victim))
	{
		return;
	}
	Credited.Add(Victim);
	if (Shooter == UGameplayStatics::GetPlayerPawn(GetWorld(), 0))
	{
		if (FMath::FRand() < 0.7f && Ready(TEXT("praise"), 8.f))
		{
			Chatter({TEXT("p1"), TEXT("p2"), TEXT("p3")});
		}
	}
	else if (const ARewildWingman* W = Cast<ARewildWingman>(Shooter))
	{
		ChatterBy(W->GetIndex(), {TEXT("k2"), TEXT("k1"), TEXT("k3")});
	}
}
