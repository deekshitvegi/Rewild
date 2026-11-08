#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "RewildHUD.generated.h"

/**
 * For now only the aim reticle: a ring where the mouse cursor (the virtual stick) sits, and a small cross where
 * the nose points, in thin white at 70% opacity. The full HUD (direction F: frosted glass with instruments, one
 * amber accent) is its own job; none of the AI-looking furniture CLAUDE.md rules out.
 */
UCLASS()
class REWILD_API ARewildHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void Ring(const FVector2D& Centre, float Radius, const FLinearColor& Colour, float Thickness);
};
