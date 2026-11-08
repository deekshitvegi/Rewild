#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "RewildHUD.generated.h"

/**
 * The fight's minimal HUD (first fight, milestone 3), thin lines only, no text: the nose cross and steering ring, a
 * bracket on the target, an amber lead marker where to aim (amber is HUD direction F's one accent), shield and hull
 * as arcs left and right of the reticle (amber when low), gun heat as an arc below, and a hit marker. The full HUD
 * (direction F: frosted glass with instruments) is its own job; none of the AI-looking furniture CLAUDE.md rules out.
 */
UCLASS()
class REWILD_API ARewildHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void Ring(const FVector2D& Centre, float Radius, const FLinearColor& Colour, float Thickness);
	void Arc(const FVector2D& Centre, float Radius, float FromDeg, float ToDeg, const FLinearColor& Colour, float Thickness);
	bool ToScreen(const FVector& World, FVector2D& Out) const;
};
