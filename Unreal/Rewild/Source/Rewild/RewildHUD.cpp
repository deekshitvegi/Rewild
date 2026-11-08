#include "RewildHUD.h"

#include "Camera/PlayerCameraManager.h"
#include "Engine/Canvas.h"
#include "GameFramework/PlayerController.h"
#include "RewildFighter.h"
#include "RewildHealthComponent.h"

namespace
{
	const FLinearColor White(1.f, 1.f, 1.f, 0.7f);
	const FLinearColor Faint(1.f, 1.f, 1.f, 0.2f);
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
