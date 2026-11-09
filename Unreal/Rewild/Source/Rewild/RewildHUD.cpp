#include "RewildHUD.h"

#include "Camera/PlayerCameraManager.h"
#include "Engine/Canvas.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "RewildFighter.h"
#include "RewildHealthComponent.h"
#include "RewildMissiles.h"
#include "RewildReaper.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "Kismet/GameplayStatics.h"
#include "RewildGameMode.h"
#include "RewildMission.h"
#include "RewildRadio.h"
#include "RewildSave.h"
#include "RewildUI.h"
#include "RewildWingman.h"
#include "Widgets/SWeakWidget.h"
#include "Misc/CommandLine.h"
#include "HAL/PlatformTime.h"

namespace
{
	const FLinearColor White(1.f, 1.f, 1.f, 0.7f);
	const FLinearColor Faint(1.f, 1.f, 1.f, 0.2f);
	const FLinearColor Dim(1.f, 1.f, 1.f, 0.45f);
	const FLinearColor Amber = FLinearColor::FromSRGBColor(FColor(0xFF, 0xB5, 0x47, 0xE0));  // #ffb547
}

bool ARewildHUD::ToScreen(const FVector& World, FVector2D& Out) const
{
	if (!PlayerOwner || !PlayerOwner->PlayerCameraManager || !Canvas)
	{
		return false;
	}
	const FVector Eye = PlayerOwner->PlayerCameraManager->GetCameraLocation();
	const FVector Forward = PlayerOwner->PlayerCameraManager->GetCameraRotation().Vector();
	if (FVector::DotProduct(World - Eye, Forward) <= 0.f)
	{
		return false;  // behind the camera
	}
	const FVector S = Canvas->Project(World);
	Out = FVector2D(S.X, S.Y);
	return true;
}

void ARewildHUD::DrawHUD()
{
	Super::DrawHUD();
	UpdateOverlay();
	const ARewildFighter* Fighter = Cast<ARewildFighter>(GetOwningPawn());
	if (!Fighter || !Canvas || Fighter->IsDead() || IsMenuOpen() || ARewildGameMode::ModeOf(GetWorld()) == ERewildMode::Menu)
	{
		return;
	}

	// The reticle sits where the nose points, 1 km ahead: the chase camera looks 10 degrees down over the spine,
	// so that is above the screen's centre (drawing it at the centre misled the aim, 8 Nov 2026).
	FVector2D Centre(Canvas->ClipX * 0.5f, Canvas->ClipY * 0.5f);
	ToScreen(Fighter->GetActorLocation() + Fighter->GetActorForwardVector() * 100000.f, Centre);
	const float Scale = Canvas->ClipY / 1080.f;  // sizes are for 1080 lines and scale with the screen
	const float Line = 1.5f * Scale;

	// Where the nose points: a small cross at the centre of the view.
	const float Arm = 7.f * Scale;
	DrawLine(Centre.X - Arm, Centre.Y, Centre.X + Arm, Centre.Y, White, Line);
	DrawLine(Centre.X, Centre.Y - Arm, Centre.X, Centre.Y + Arm, White, Line);

	// A hit marker: four short ticks round the cross while our bolts land.
	if (Fighter->GetHitMarker() > 0.f)
	{
		const float In = 10.f * Scale, Out = 17.f * Scale;
		for (const FVector2D D : {FVector2D(1, 1), FVector2D(-1, 1), FVector2D(1, -1), FVector2D(-1, -1)})
		{
			const FVector2D N = D.GetSafeNormal();
			DrawLine(Centre.X + N.X * In, Centre.Y + N.Y * In, Centre.X + N.X * Out, Centre.Y + N.Y * Out, White, Line);
		}
	}

	// The steering cursor: up to a third of the screen height from the centre. Screen y runs down.
	const FVector2D Aim = Fighter->GetAimCursor();
	Ring(Centre + FVector2D(Aim.X, -Aim.Y) * (Canvas->ClipY / 3.f), 11.f * Scale, White, Line);

	// Shield (left) and hull (right) as arcs round the reticle; gun heat below. Screen angles: 0 right, 90 down.
	const float R = 92.f * Scale;
	if (const URewildHealthComponent* H = Fighter->GetHealth())
	{
		const float Shield = H->GetShieldFraction();
		const float Hull = H->GetHullFraction();
		Arc(Centre, R, 150.f, 210.f, Faint, Line);
		Arc(Centre, R, 210.f - 60.f * Shield, 210.f, Shield < 0.3f ? Amber : White, 2.f * Scale);
		Arc(Centre, R, -30.f, 30.f, Faint, Line);
		Arc(Centre, R, 30.f - 60.f * Hull, 30.f, Hull < 0.3f ? Amber : White, 2.f * Scale);
	}
	const float Heat = Fighter->GetGunHeat();
	Arc(Centre, R, 70.f, 110.f, Faint, Line);
	if (Heat > 0.01f)
	{
		Arc(Centre, R, 110.f - 40.f * FMath::Min(Heat, 1.f), 110.f, Fighter->AreGunsOverheated() ? Amber : White, 2.f * Scale);
	}

	// Missiles as short ticks across the top (lit while loaded); flares as a thin arc just outside them.
	const int32 MaxMissiles = FMath::Max(1, Fighter->GetMaxMissiles());
	for (int32 I = 0; I < MaxMissiles; ++I)
	{
		const float A = FMath::DegreesToRadians(FMath::Lerp(250.f, 290.f, MaxMissiles > 1 ? float(I) / (MaxMissiles - 1) : 0.5f));
		const FVector2D D(FMath::Cos(A), FMath::Sin(A));
		const FVector2D P0 = Centre + D * (R - 4.f * Scale), P1 = Centre + D * (R + 5.f * Scale);
		DrawLine(P0.X, P0.Y, P1.X, P1.Y, I < Fighter->GetMissiles() ? White : Faint, 2.f * Scale);
	}
	const float FlareShare = float(Fighter->GetFlares()) / FMath::Max(1, Fighter->GetMaxFlares());
	Arc(Centre, R + 12.f * Scale, 252.f, 288.f, Faint, Line);
	if (FlareShare > 0.f)
	{
		Arc(Centre, R + 12.f * Scale, 252.f, 252.f + 36.f * FlareShare, FlareShare < 0.25f ? Amber : Dim, Line);
	}

	// Every Reaper: small corners on screen, a pointer at the edge of a ring when off it (they flank: look for them).
	const float EdgeRing = Canvas->ClipY * 0.42f;
	for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
	{
		if (!It->IsAlive() || *It == Fighter->GetTarget())
		{
			continue;
		}
		FVector2D S;
		const bool bOn = ToScreen(It->GetActorLocation(), S) && S.X > 0.f && S.Y > 0.f && S.X < Canvas->ClipX && S.Y < Canvas->ClipY;
		if (bOn)
		{
			Corners(S, 9.f * Scale, Dim, Line);
		}
		else
		{
			Pointer(Centre, EdgeRing, ScreenAngle(It->GetActorLocation()), 9.f * Scale, Dim, Line);
		}
	}

	DrawWingmen(Scale);

	// Locked on by the Harrow: an amber arc toward the locker, pulsing faster as the lock firms; a missile coming
	// pulses faster still and gets a ring of its own.
	if (const URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>())
	{
		const float Now = GetWorld()->GetTimeSeconds();
		FVector From;
		const float Lock = Ms->GetLockOn(Fighter, &From);
		if (Lock > 0.05f)
		{
			const float Hz = Lock >= 1.f ? 5.f : 2.f;
			const float Pulse = 0.35f + 0.65f * (0.5f + 0.5f * FMath::Sin(Now * Hz * 2.f * PI));
			const float A = ScreenAngle(From);
			Arc(Centre, Canvas->ClipY * 0.36f, A - 14.f * Lock, A + 14.f * Lock, Amber * FLinearColor(1.f, 1.f, 1.f, Pulse), 3.f * Scale);
		}
		TArray<URewildMissiles::FThreat> Threats;
		Ms->GetThreats(Fighter, Threats);
		for (const URewildMissiles::FThreat& Th : Threats)
		{
			const float Pulse = 0.4f + 0.6f * (0.5f + 0.5f * FMath::Sin(Now * 8.f * 2.f * PI));
			const FLinearColor C = Amber * FLinearColor(1.f, 1.f, 1.f, Pulse);
			const float A = ScreenAngle(Th.Position);
			Arc(Centre, Canvas->ClipY * 0.36f, A - 10.f, A + 10.f, C, 4.f * Scale);
			Arc(Centre, Canvas->ClipY * 0.36f + 8.f * Scale, A - 6.f, A + 6.f, C, 2.f * Scale);
			FVector2D S;
			if (ToScreen(Th.Position, S))
			{
				Ring(S, 12.f * Scale, C, 2.f * Scale);
			}
		}
	}

	// The target: a bracket of four corners, sized by distance, and the amber lead marker where to aim.
	if (const AActor* Target = Fighter->GetTarget())
	{
		FVector2D T;
		if (ToScreen(Target->GetActorLocation(), T))
		{
			const float Metres = FVector::Dist(Target->GetActorLocation(), Fighter->GetActorLocation()) / 100.f;
			const float B = FMath::Clamp(30000.f / FMath::Max(Metres, 1.f), 16.f, 60.f) * Scale;
			const float C = B * 0.35f;
			for (const FVector2D S : {FVector2D(1, 1), FVector2D(-1, 1), FVector2D(1, -1), FVector2D(-1, -1)})
			{
				const FVector2D Corner = T + S * B;
				DrawLine(Corner.X, Corner.Y, Corner.X - S.X * C, Corner.Y, White, Line);
				DrawLine(Corner.X, Corner.Y, Corner.X, Corner.Y - S.Y * C, White, Line);
			}
			// The missile lock: an amber ring closing from wide onto the bracket; locked, it holds doubled.
			const float Lock = Fighter->GetLockProgress();
			if (Lock > 0.f && Lock < 1.f)
			{
				Ring(T, FMath::Lerp(B * 2.6f, B * 1.5f, Lock), Amber * FLinearColor(1.f, 1.f, 1.f, 0.4f + 0.6f * Lock), Line);
			}
			else if (Lock >= 1.f)
			{
				Ring(T, B * 1.5f, Amber, 2.f * Scale);
				Ring(T, B * 1.5f + 4.f * Scale, Amber, Line);
			}
		}
		else
		{
			Pointer(Centre, Canvas->ClipY * 0.42f, ScreenAngle(Target->GetActorLocation()), 11.f * Scale, White, 2.f * Scale);
		}
		FVector Lead;
		FVector2D L;
		if (Fighter->GetLeadPoint(Lead) && ToScreen(Lead, L))
		{
			Ring(L, 6.f * Scale, Amber, 2.f * Scale);
			DrawLine(L.X - 1.5f * Scale, L.Y, L.X + 1.5f * Scale, L.Y, Amber, 3.f * Scale);
		}
	}
}

float ARewildHUD::ScreenAngle(const FVector& World) const
{
	if (!PlayerOwner || !PlayerOwner->PlayerCameraManager)
	{
		return 0.f;
	}
	const FRotationMatrix Cam(PlayerOwner->PlayerCameraManager->GetCameraRotation());
	const FVector To = World - PlayerOwner->PlayerCameraManager->GetCameraLocation();
	const float X = FVector::DotProduct(To, Cam.GetUnitAxis(EAxis::Y));   // right
	const float Y = -FVector::DotProduct(To, Cam.GetUnitAxis(EAxis::Z));  // screen y runs down
	return FMath::RadiansToDegrees(FMath::Atan2(Y, X));
}

void ARewildHUD::Corners(const FVector2D& At, float Half, const FLinearColor& Colour, float Thickness)
{
	const float C = Half * 0.45f;
	for (const FVector2D S : {FVector2D(1, 1), FVector2D(-1, 1), FVector2D(1, -1), FVector2D(-1, -1)})
	{
		const FVector2D Corner = At + S * Half;
		DrawLine(Corner.X, Corner.Y, Corner.X - S.X * C, Corner.Y, Colour, Thickness);
		DrawLine(Corner.X, Corner.Y, Corner.X, Corner.Y - S.Y * C, Colour, Thickness);
	}
}

void ARewildHUD::Pointer(const FVector2D& Centre, float Radius, float AngleDeg, float Size, const FLinearColor& Colour, float Thickness)
{
	// A thin chevron on the ring, its point outward toward the target.
	const float A = FMath::DegreesToRadians(AngleDeg);
	const FVector2D D(FMath::Cos(A), FMath::Sin(A));
	const FVector2D N(-D.Y, D.X);
	const FVector2D Tip = Centre + D * Radius;
	const FVector2D L = Tip - D * Size + N * Size * 0.8f;
	const FVector2D R = Tip - D * Size - N * Size * 0.8f;
	DrawLine(L.X, L.Y, Tip.X, Tip.Y, Colour, Thickness);
	DrawLine(R.X, R.Y, Tip.X, Tip.Y, Colour, Thickness);
}

void ARewildHUD::Ring(const FVector2D& Centre, float Radius, const FLinearColor& Colour, float Thickness)
{
	Arc(Centre, Radius, 0.f, 360.f, Colour, Thickness);
}

void ARewildHUD::Arc(const FVector2D& Centre, float Radius, float FromDeg, float ToDeg, const FLinearColor& Colour, float Thickness)
{
	const int32 Segments = FMath::Max(4, FMath::RoundToInt(FMath::Abs(ToDeg - FromDeg) / 8.f));
	for (int32 I = 0; I < Segments; ++I)
	{
		const float A0 = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, float(I) / Segments));
		const float A1 = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, float(I + 1) / Segments));
		DrawLine(Centre.X + Radius * FMath::Cos(A0), Centre.Y + Radius * FMath::Sin(A0),
			Centre.X + Radius * FMath::Cos(A1), Centre.Y + Radius * FMath::Sin(A1), Colour, Thickness);
	}
}

void ARewildHUD::DrawWingmen(float Scale)
{
	// The crew: a small open diamond on each wingman still flying (Reapers get corners, the target a bracket).
	const FLinearColor Friend(1.f, 1.f, 1.f, 0.5f);
	for (TActorIterator<ARewildWingman> It(GetWorld()); It; ++It)
	{
		FVector2D S;
		if (!It->IsAlive() || !ToScreen(It->GetActorLocation(), S))
		{
			continue;
		}
		const float R = 7.f * Scale;
		DrawLine(S.X, S.Y - R, S.X + R, S.Y, Friend, 1.5f * Scale);
		DrawLine(S.X + R, S.Y, S.X, S.Y + R, Friend, 1.5f * Scale);
		DrawLine(S.X, S.Y + R, S.X - R, S.Y, Friend, 1.5f * Scale);
		DrawLine(S.X - R, S.Y, S.X, S.Y - R, Friend, 1.5f * Scale);
	}
}

void ARewildHUD::BeginPlay()
{
	Super::BeginPlay();
	if (GEngine && GEngine->GameViewport)
	{
		SAssignNew(Overlay, SRewildOverlay);
		OverlayHost = SNew(SWeakWidget).PossiblyNullContent(Overlay);
		GEngine->GameViewport->AddViewportWidgetContent(OverlayHost.ToSharedRef(), 10);
	}
	if (ARewildGameMode::ModeOf(GetWorld()) == ERewildMode::Menu)
	{
		ShowMainMenu();
	}
	if (FParse::Param(FCommandLine::Get(), TEXT("RewildUIShots")))
	{
		// A test of the screens: a shot of what shows first (the main menu, or the game), then the pause menu and
		// settings, each photographed with the UI, then quit. A core ticker, so it runs while the game is paused.
		TWeakObjectPtr<ARewildHUD> Self(this);
		TSharedRef<int32> Step = MakeShared<int32>(0);
		TSharedRef<double> Next = MakeShared<double>(FPlatformTime::Seconds() + 12.0);
		UIShots = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateLambda([Self, Step, Next](float)
		{
			if (!Self.IsValid() || !Self->PlayerOwner)
			{
				return false;
			}
			if (FPlatformTime::Seconds() < *Next)
			{
				return true;
			}
			*Next = FPlatformTime::Seconds() + 2.5;
			APlayerController* PC = Self->PlayerOwner;
			const int32 S = (*Step)++;
			UE_LOG(LogTemp, Display, TEXT("[rewild ui shots] step %d"), S);
			switch (S)
			{
			case 0: case 2: case 4: PC->ConsoleCommand(TEXT("Shot showui")); break;
			case 1: Self->TogglePause(); break;
			case 3: Self->ShowSettings(); break;
			default: PC->ConsoleCommand(TEXT("quit")); return false;
			}
			return true;
		}));
	}
}

void ARewildHUD::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UIShots.IsValid())
	{
		FTSTicker::GetCoreTicker().RemoveTicker(UIShots);
	}
	if (OverlayHost.IsValid() && GEngine && GEngine->GameViewport)
	{
		GEngine->GameViewport->RemoveViewportWidgetContent(OverlayHost.ToSharedRef());
	}
	Overlay.Reset();
	OverlayHost.Reset();
	Super::EndPlay(Reason);
}

bool ARewildHUD::IsMenuOpen() const
{
	return Overlay.IsValid() && Overlay->IsPanelShown();
}

void ARewildHUD::UpdateOverlay()
{
	if (!Overlay.IsValid())
	{
		return;
	}
	const bool bMenu = ARewildGameMode::ModeOf(GetWorld()) == ERewildMode::Menu;
	FText Name, Words;
	float Alpha = 0.f;
	const URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>();
	if (!bMenu && Radio && URewildSettings::Get()->bSubtitles && Radio->GetSubtitle(Name, Words, Alpha))
	{
		Overlay->SetSubtitle(Name, Words, Alpha);
	}
	else
	{
		Overlay->SetSubtitle(FText::GetEmpty(), FText::GetEmpty(), 0.f);
	}
	const ARewildMission* Mission = ARewildMission::Find(GetWorld());
	Overlay->SetObjective(Mission ? Mission->GetObjective() : FText::GetEmpty());
	const ARewildFighter* Fighter = Cast<ARewildFighter>(GetOwningPawn());
	if (Fighter && Fighter->GetOrderShown() > 0.f)
	{
		static const TCHAR* Orders[4] = {TEXT("Wing: attack my target"), TEXT("Wing: cover me"), TEXT("Wing: form up"), TEXT("Wing: weapons free")};
		Overlay->SetNote(FText::FromString(Orders[FMath::Clamp(Fighter->GetLastOrder(), 0, 3)]), FMath::Clamp(Fighter->GetOrderShown() / 0.4f, 0.f, 1.f));
	}
	else
	{
		Overlay->SetNote(FText::GetEmpty(), 0.f);
	}
}

void ARewildHUD::Panel(const FText& Title, const FText& Body, const TArray<FRewildMenuItem>& Items, bool bDim, TFunction<void()> OnBack)
{
	if (!Overlay.IsValid() || !PlayerOwner)
	{
		return;
	}
	PlayerOwner->SetShowMouseCursor(true);
	FInputModeUIOnly Mode;
	Mode.SetWidgetToFocus(Overlay);
	Mode.SetLockMouseToViewportBehavior(EMouseLockMode::DoNotLock);
	PlayerOwner->SetInputMode(Mode);
	Overlay->ShowPanel(Title, Body, Items, bDim, ARewildGameMode::ModeOf(GetWorld()) == ERewildMode::Menu);
	Overlay->OnBack = OnBack;
	if (URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>())
	{
		Radio->SetListening(false);
	}
}

void ARewildHUD::ClosePanel()
{
	if (Overlay.IsValid())
	{
		Overlay->HidePanel();
	}
	if (PlayerOwner)
	{
		PlayerOwner->SetShowMouseCursor(false);
		PlayerOwner->SetInputMode(FInputModeGameOnly());
	}
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetAllUserFocusToGameViewport();
	}
	if (URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>())
	{
		Radio->SetListening(true);
	}
}

void ARewildHUD::Open(const FString& Options)
{
	UGameplayStatics::SetGamePaused(GetWorld(), false);
	UGameplayStatics::OpenLevel(GetWorld(), TEXT("/Game/FirstFight/Maps/L_FirstFight"), true, Options);
}

void ARewildHUD::ShowMainMenu()
{
	TArray<FRewildMenuItem> Items;
	FText Body = FText::FromString(TEXT("Win Earth back from the Harrow."));
	if (const URewildSave* Last = URewildSave::ReadLast())
	{
		const FString Options = Last->Options();
		const FString Where = Last->Mode == TEXT("Free") ? TEXT("free play")
			: Last->Checkpoint == 0 ? TEXT("First contact, from the start")
			: Last->Checkpoint >= 4 ? TEXT("replay the last wave of First contact")
			: FString::Printf(TEXT("First contact, wave %d of 3"), Last->Checkpoint);
		Items.Add({FText::FromString(TEXT("Continue")), [this, Options] { Open(Options); }});
		Body = FText::FromString(FString::Printf(TEXT("Continue: %s."), *Where));
	}
	Items.Add({FText::FromString(TEXT("Story")), [this] { Open(TEXT("Mode=Story?Checkpoint=0")); }});
	Items.Add({FText::FromString(TEXT("Free play")), [this] { Open(TEXT("Mode=Free")); }});
	Items.Add({FText::FromString(TEXT("Settings")), [this] { ShowSettings(); }});
	Items.Add({FText::FromString(TEXT("Quit")), [this] { if (PlayerOwner) { PlayerOwner->ConsoleCommand(TEXT("quit")); } }});
	Panel(FText::FromString(TEXT("Rewild")), Body, Items, false, nullptr);
}

void ARewildHUD::ShowSettings()
{
	URewildSettings* S = URewildSettings::Get();
	static const TCHAR* Mouse[3] = {TEXT("low"), TEXT("medium"), TEXT("high")};
	TArray<FRewildMenuItem> Items;
	Items.Add({FText::FromString(FString::Printf(TEXT("Mouse sensitivity: %s"), Mouse[FMath::Clamp(S->Mouse, 0, 2)])), [this, S]
	{
		S->Mouse = (S->Mouse + 1) % 3;
		S->Store();
		if (ARewildFighter* F = Cast<ARewildFighter>(GetOwningPawn()))
		{
			F->ApplySettings();
		}
		ShowSettings();
	}});
	Items.Add({FText::FromString(S->bSubtitles ? TEXT("Subtitles: on") : TEXT("Subtitles: off")), [this, S]
	{
		S->bSubtitles = !S->bSubtitles;
		S->Store();
		ShowSettings();
	}});
	const bool bInGame = ARewildGameMode::ModeOf(GetWorld()) != ERewildMode::Menu;
	auto Back = [this, bInGame] { if (bInGame) { bPaused = false; TogglePause(); } else { ShowMainMenu(); } };
	Items.Add({FText::FromString(TEXT("Back")), Back});
	Panel(FText::FromString(TEXT("Settings")), FText::GetEmpty(), Items, bInGame, Back);
}

void ARewildHUD::TogglePause()
{
	if (ARewildGameMode::ModeOf(GetWorld()) == ERewildMode::Menu)
	{
		return;
	}
	const ARewildMission* Mission = ARewildMission::Find(GetWorld());
	if (Mission && (Mission->GetBeat() == ERewildBeat::Won || Mission->GetBeat() == ERewildBeat::Lost) && IsMenuOpen())
	{
		return;  // the end-of-mission panel stays
	}
	if (bPaused)
	{
		bPaused = false;
		UGameplayStatics::SetGamePaused(GetWorld(), false);
		ClosePanel();
		return;
	}
	bPaused = true;
	UGameplayStatics::SetGamePaused(GetWorld(), true);
	TArray<FRewildMenuItem> Items;
	Items.Add({FText::FromString(TEXT("Resume")), [this] { TogglePause(); }});
	if (Mission && Mission->GetCheckpoint() > 0)
	{
		const int32 C = Mission->GetCheckpoint();
		Items.Add({FText::FromString(TEXT("Start the wave again")), [this, C] { Open(FString::Printf(TEXT("Mode=Story?Checkpoint=%d"), C)); }});
	}
	Items.Add({FText::FromString(TEXT("Settings")), [this] { ShowSettings(); }});
	Items.Add({FText::FromString(TEXT("Main menu")), [this] { Open(TEXT("")); }});
	Items.Add({FText::FromString(TEXT("Quit")), [this] { if (PlayerOwner) { PlayerOwner->ConsoleCommand(TEXT("quit")); } }});
	const FText Body = Mission ? Mission->GetObjective() : FText::FromString(TEXT("Free play"));
	Panel(FText::FromString(TEXT("Paused")), Body, Items, true, [this] { TogglePause(); });
}

void ARewildHUD::ShowMissionEnd(bool bWon)
{
	const ARewildMission* Mission = ARewildMission::Find(GetWorld());
	const int32 Kills = Mission ? Mission->GetReaperKills() : 0;
	const int32 C = Mission ? FMath::Max(1, Mission->GetCheckpoint()) : 1;
	TArray<FRewildMenuItem> Items;
	if (bWon)
	{
		Items.Add({FText::FromString(TEXT("Fly on")), [this]
		{
			// free play from here: the Harrow keep coming
			if (ARewildGameMode* GM = GetWorld()->GetAuthGameMode<ARewildGameMode>())
			{
				GM->ContinueAsFreePlay();
			}
			ClosePanel();
		}});
		Items.Add({FText::FromString(TEXT("Main menu")), [this] { Open(TEXT("")); }});
		Panel(FText::FromString(TEXT("First contact")),
			FText::FromString(FString::Printf(TEXT("Mission complete. %d Reapers destroyed by the wing. Svalbard is waiting."), Kills)), Items, true, nullptr);
	}
	else
	{
		Items.Add({FText::FromString(TEXT("Try again")), [this, C] { Open(FString::Printf(TEXT("Mode=Story?Checkpoint=%d"), C)); }});
		Items.Add({FText::FromString(TEXT("Main menu")), [this] { Open(TEXT("")); }});
		Panel(FText::FromString(TEXT("Shot down")),
			FText::FromString(Mission && Mission->GetCheckpoint() > 0
				? FString::Printf(TEXT("The Harrow got you on wave %d of 3. Try again from the start of that wave."), C)
				: FString(TEXT("The Harrow got you. Try again from the start."))), Items, true, nullptr);
	}
}
