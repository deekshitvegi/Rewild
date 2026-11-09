#include "RewildWorldGameMode.h"

#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Engine/World.h"
#include "GameFramework/HUD.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "RewildFighter.h"
#include "RewildPlanet.h"

ARewildWorldGameMode::ARewildWorldGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = false;
}

void ARewildWorldGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);
	Mode = ERewildMode::Free;  // flight and the HUD, no main menu over the view
	bShots = FParse::Param(FCommandLine::Get(), TEXT("RewildWorldShots"));
}

FVector3d ARewildWorldGameMode::DirAt(const FVector2D& EastNorth, double Radius)
{
	// The colony is at +Z; east is +X (toward TON 618), north +Y.
	return FVector3d(EastNorth.X / Radius, EastNorth.Y / Radius, 1.0).GetSafeNormal();
}

void ARewildWorldGameMode::StartPlay()
{
	AGameModeBase::StartPlay();  // a world: none of the first fight's drones, wing, Harrow or mission

	ARewildPlanet* Planet = ARewildPlanet::Find(GetWorld());
	ARewildFighter* Dev = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Planet || !Dev)
	{
		UE_LOG(LogTemp, Error, TEXT("[rewild world] no planet or no fighter"));
		return;
	}
	const double R = Planet->GetRadius();

	double Altitude = 400000.0;
	FVector2D From(-600000.0, 0.0);
	float Pitch = -24.f;
	if (FParse::Value(FCommandLine::Get(), TEXT("RewildAltitude="), Altitude))
	{
		From = FVector2D(-3000.0, 0.0);
		Pitch = 0.f;
	}
	const FVector3d Dir = DirAt(From, R);
	const FVector Where = Planet->WorldAt(Dir, Altitude);
	const FVector Up = Planet->UpAt(Where);
	const FVector East = (FVector::ForwardVector - Up * FVector::DotProduct(FVector::ForwardVector, Up)).GetSafeNormal();
	const double P = FMath::DegreesToRadians(double(Pitch));  // negative: nose down
	const FVector Nose = (East * FMath::Cos(P) + Up * FMath::Sin(P)).GetSafeNormal();
	const FRotator Facing = FRotationMatrix::MakeFromXZ(Nose, Up).Rotator();
	Dev->SetStart(FTransform(Facing, Where));
	UE_LOG(LogTemp, Display, TEXT("[rewild world] start %.0f m up, %.0f km from the colony"), Altitude, From.Size() / 1000.0);
	if (FParse::Param(FCommandLine::Get(), TEXT("RewildWorldFly")))
	{
		Dev->SetWorldAutopilot(true);
	}

	if (bShots)
	{
		// HAVEN.md: the globe, from orbit, from 20 km, from the ship at 300 m, on foot, and the ground at your feet.
		Stills = {
			{TEXT("globe"), FVector2D(2.6e6, -1.2e6), 1.4e7, FVector2D::ZeroVector, 0.0, true},
			{TEXT("orbit"), FVector2D(-1.4e6, 0.0), 1.0e6, FVector2D(0.0, 0.0), 0.0},
			{TEXT("high"), FVector2D(-30000.0, -4000.0), 20000.0, FVector2D(3000.0, 0.0), 0.0},
			{TEXT("ship"), FVector2D(-1500.0, -300.0), 300.0, FVector2D(2600.0, 200.0), 0.0},
			{TEXT("foot"), FVector2D(-250.0, 0.0), 1.8, FVector2D(1500.0, 0.0), 25.0},
			{TEXT("ground"), FVector2D(-100.0, 0.0), 1.7, FVector2D(-97.0, 0.0), 0.0},
		};
		FString Only;
		if (FParse::Value(FCommandLine::Get(), TEXT("RewildStill="), Only))
		{
			Stills.RemoveAll([&Only](const FStill& S) { return !Only.Contains(S.Name); });  // e.g. globe+ship (a comma ends the value)
		}
		FActorSpawnParameters Spawn;
		Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Camera = GetWorld()->SpawnActor<ACameraActor>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
		Camera->GetCameraComponent()->SetFieldOfView(70.f);
		Camera->GetCameraComponent()->bConstrainAspectRatio = false;
		Dev->SetActorHiddenInGame(true);
		Dev->SetActorTickEnabled(false);
		if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
		{
			if (AHUD* Hud = PC->GetHUD())
			{
				Hud->bShowHUD = false;  // the ground only, no instruments
			}
		}
		ShowStill(0);
	}
}

void ARewildWorldGameMode::ShowStill(int32 Index)
{
	StillIndex = Index;
	Waited = 0.f;
	SettledFor = 0.f;
	AfterSettled = 0.f;
	ARewildPlanet* Planet = ARewildPlanet::Find(GetWorld());
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	if (!Stills.IsValidIndex(Index) || !Planet || !PC || !Camera)
	{
		return;
	}
	const FStill& S = Stills[Index];
	const double R = Planet->GetRadius();
	const FVector From = Planet->WorldAt(DirAt(S.From, R), S.FromUp);
	const FVector At = S.bAtCentre ? Planet->GetActorLocation() : Planet->WorldAt(DirAt(S.At, R), S.AtUp);
	// Looking at the centre, the view runs straight down "up": steady it on +X instead.
	const FVector Up = S.bAtCentre ? FVector::ForwardVector : Planet->UpAt(From);
	Camera->SetActorLocationAndRotation(From, FRotationMatrix::MakeFromXZ((At - From).GetSafeNormal(), Up).Rotator());
	PC->SetViewTarget(Camera);
	UE_LOG(LogTemp, Display, TEXT("[rewild world] still %s: %.1f m above the ground"), *S.Name, Planet->AltitudeAt(From));
}

void ARewildWorldGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bShots || bQuitting || !Stills.IsValidIndex(StillIndex))
	{
		return;
	}
	ARewildPlanet* Planet = ARewildPlanet::Find(GetWorld());
	APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	if (!Planet || !PC)
	{
		return;
	}
	if (NextIn > 0.f)
	{
		// "Shot" takes the next frame drawn: hold the view until it has (moving on at once photographed the next
		// view's first frame, before its ground was built: 9 Nov).
		NextIn -= DeltaSeconds;
		if (NextIn <= 0.f)
		{
			ShowStill(StillIndex + 1);
		}
		return;
	}
	Waited += DeltaSeconds;
	SettledFor = Planet->IsSettled() ? SettledFor + DeltaSeconds : 0.f;
	// Settled for half a second, then two and a half more for the light and the exposure to settle; or a minute.
	if ((Waited > 1.f && SettledFor > 0.5f) || Waited > 60.f)
	{
		AfterSettled += DeltaSeconds;
		if (AfterSettled > 2.5f)
		{
			UE_LOG(LogTemp, Display, TEXT("[rewild world] shot %s after %.1f s (%s), %d tiles"), *Stills[StillIndex].Name, Waited,
				SettledFor > 0.f ? TEXT("settled") : TEXT("timed out"), Planet->GetTilesShown());
			PC->ConsoleCommand(TEXT("Shot"));
			if (StillIndex + 1 < Stills.Num())
			{
				NextIn = 0.5f;
			}
			else
			{
				bQuitting = true;
				FTimerHandle Quit;
				GetWorldTimerManager().SetTimer(Quit, [this]()
				{
					if (APlayerController* P = UGameplayStatics::GetPlayerController(this, 0))
					{
						P->ConsoleCommand(TEXT("quit"));
					}
				}, 2.f, false);
			}
		}
	}
}
