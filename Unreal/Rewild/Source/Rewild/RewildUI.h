#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"
#include "Widgets/SOverlay.h"

class SVerticalBox;
class SWidget;

/** One button on a glass panel: its words, and what it does. */
struct FRewildMenuItem
{
	FText Label;
	TFunction<void()> OnPick;
};

/**
 * The game's screens over the 3D view (first fight, milestone 5), in HUD direction F: rounded frosted glass (a real
 * background blur), Inter, sentence case, white words, one amber accent (#ffb547), nothing under 12 px. The radio's
 * subtitle at the bottom, the objective at the top left, a note when Dev gives an order, and a centred panel for the
 * main menu, the pause menu and the end of a mission. ARewildHUD owns it and feeds it each frame.
 */
class REWILD_API SRewildOverlay : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SRewildOverlay) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

	/** The radio line now showing (empty to hide), with its fade. */
	void SetSubtitle(const FText& Name, const FText& Words, float Alpha);
	/** The objective (empty to hide). */
	void SetObjective(const FText& Text);
	/** A short note in the corner, e.g. the order just given (empty to hide). */
	void SetNote(const FText& Text, float Alpha);
	/** A centred panel: a title, a line under it, and buttons (no buttons and an empty title to hide). */
	void ShowPanel(const FText& Title, const FText& Body, const TArray<FRewildMenuItem>& Items, bool bDimWorld, bool bOnLeft = false);
	void HidePanel();
	bool IsPanelShown() const { return bPanel; }
	/** Esc / gamepad B while a panel is up does this (e.g. resume); unset to ignore. */
	TFunction<void()> OnBack;

	virtual bool SupportsKeyboardFocus() const override { return true; }
	virtual FReply OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent) override;

	/** Inter at a size (px at 1080 lines), from /Game/UI/Fonts/Inter; the engine's font if it is missing. */
	static FSlateFontInfo Font(float Size);

private:
	FText SubName, SubWords, Objective, Note, PanelTitle, PanelBody;
	float SubAlpha = 0.f;
	float NoteAlpha = 0.f;
	bool bPanel = false;
	bool bDim = false;
	bool bLeft = false;
	SOverlay::FOverlaySlot* PanelSlot = nullptr;
	TSharedPtr<SVerticalBox> Buttons;
	TSharedPtr<SWidget> FirstButton;

	TSharedRef<SWidget> Glass(const TSharedRef<SWidget>& Content, float Radius, const FMargin& Padding) const;
};
