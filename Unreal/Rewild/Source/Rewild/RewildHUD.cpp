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
	const ARewildFighter* Fighter = Cast<ARewildFighter>(GetOwningPawn());
	if (!Fighter || !Canvas || Fighter->IsDead())
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
