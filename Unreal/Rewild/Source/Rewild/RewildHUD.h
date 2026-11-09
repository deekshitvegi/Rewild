#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "Containers/Ticker.h"
#include "RewildHUD.generated.h"

/**
 * The fight's minimal HUD (first fight, milestones 3-4), thin lines only, no text: the nose cross and steering ring,
 * a bracket on the target, an amber lead marker where to aim (amber is HUD direction F's one accent), shield and
 * hull as arcs left and right of the reticle (amber when low), gun heat as an arc below, missiles as ticks and
 * flares as an arc above, a hit marker; the missile lock as an amber ring closing on the target; small corners on
 * every Reaper and pointers at the edge for those off screen; a pulsing amber arc toward anyone locking on, and a
 * ring on any missile coming; small diamonds on the crew's wingmen. Over it, SRewildOverlay (RewildUI): the radio's
 * subtitle, the objective, the order just given, and the menus (main, settings, pause, the end of a mission). The
 * full HUD (direction F: frosted glass with instruments) is its own job; none of the AI-looking furniture CLAUDE.md
 * rules out.
 */
UCLASS()
class REWILD_API ARewildHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

	void ShowMainMenu();
	void ShowSettings();
	void TogglePause();
	void ShowMissionEnd(bool bWon);
	bool IsMenuOpen() const;

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

private:
	TSharedPtr<class SRewildOverlay> Overlay;
	TSharedPtr<class SWidget> OverlayHost;
	bool bPaused = false;
	FTSTicker::FDelegateHandle UIShots;  // -RewildUIShots: photographs the menus in turn, then quits

	void UpdateOverlay();
	void Panel(const FText& Title, const FText& Body, const TArray<struct FRewildMenuItem>& Items, bool bDim, TFunction<void()> OnBack);
	void ClosePanel();
	void Open(const FString& Options);
	void DrawWingmen(float Scale);
	void Ring(const FVector2D& Centre, float Radius, const FLinearColor& Colour, float Thickness);
	void Arc(const FVector2D& Centre, float Radius, float FromDeg, float ToDeg, const FLinearColor& Colour, float Thickness);
	bool ToScreen(const FVector& World, FVector2D& Out) const;
	/** Screen direction (degrees: 0 right, 90 down) from the view's centre toward a world point, on screen or not. */
	float ScreenAngle(const FVector& World) const;
	void Corners(const FVector2D& At, float Half, const FLinearColor& Colour, float Thickness);
	void Pointer(const FVector2D& Centre, float Radius, float AngleDeg, float Size, const FLinearColor& Colour, float Thickness);
};
