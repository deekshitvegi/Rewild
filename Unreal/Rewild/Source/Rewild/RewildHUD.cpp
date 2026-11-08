#include "RewildHUD.h"

#include "Engine/Canvas.h"
#include "RewildFighter.h"

void ARewildHUD::DrawHUD()
{
	Super::DrawHUD();
	const ARewildFighter* Fighter = Cast<ARewildFighter>(GetOwningPawn());
	if (!Fighter || !Canvas)
	{
		return;
	}

	const FVector2D Centre(Canvas->ClipX * 0.5f, Canvas->ClipY * 0.5f);
	const float Scale = Canvas->ClipY / 1080.f;          // sizes are for 1080 lines and scale with the screen
	const FLinearColor Colour(1.f, 1.f, 1.f, 0.7f);

	// Where the nose points: a small cross at the centre of the view.
	const float Arm = 7.f * Scale;
	DrawLine(Centre.X - Arm, Centre.Y, Centre.X + Arm, Centre.Y, Colour, 1.5f * Scale);
	DrawLine(Centre.X, Centre.Y - Arm, Centre.X, Centre.Y + Arm, Colour, 1.5f * Scale);

	// The steering cursor: up to a third of the screen height from the centre. Screen y runs down.
	const FVector2D Aim = Fighter->GetAimCursor();
	const FVector2D Cursor = Centre + FVector2D(Aim.X, -Aim.Y) * (Canvas->ClipY / 3.f);
	Ring(Cursor, 11.f * Scale, Colour, 1.5f * Scale);
}

void ARewildHUD::Ring(const FVector2D& Centre, float Radius, const FLinearColor& Colour, float Thickness)
{
	constexpr int32 Segments = 32;
	for (int32 I = 0; I < Segments; ++I)
	{
		const float A0 = 2.f * PI * I / Segments;
		const float A1 = 2.f * PI * (I + 1) / Segments;
		DrawLine(Centre.X + Radius * FMath::Cos(A0), Centre.Y + Radius * FMath::Sin(A0),
			Centre.X + Radius * FMath::Cos(A1), Centre.Y + Radius * FMath::Sin(A1), Colour, Thickness);
	}
}
