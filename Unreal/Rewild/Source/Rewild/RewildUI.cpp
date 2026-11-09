#include "RewildUI.h"

#include "Brushes/SlateRoundedBoxBrush.h"
#include "Engine/FontFace.h"
#include "Fonts/CompositeFont.h"
#include "Framework/Application/SlateApplication.h"
#include "Styling/CoreStyle.h"
#include "Styling/SlateTypes.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Layout/SBackgroundBlur.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SOverlay.h"
#include "Widgets/Text/STextBlock.h"

namespace
{
	const FLinearColor Words(1.f, 1.f, 1.f, 0.94f);
	const FLinearColor Soft(1.f, 1.f, 1.f, 0.62f);
	const FLinearColor Amber = FLinearColor::FromSRGBColor(FColor(0xFF, 0xB5, 0x47));  // direction F's one accent

	// The glass: a dark, see-through tint over a real blur of the view behind, a hairline of light round the edge.
	const FSlateRoundedBoxBrush& GlassBrush(float Radius)
	{
		// Frosted enough to read over a white hull even where the blur is weak (at 0.4 the fighter showed through
		// the buttons, 9 Nov 2026).
		static FSlateRoundedBoxBrush Small(FLinearColor(0.03f, 0.04f, 0.055f, 0.62f), 14.f, FLinearColor(1.f, 1.f, 1.f, 0.11f), 1.f);
		static FSlateRoundedBoxBrush Large(FLinearColor(0.025f, 0.032f, 0.045f, 0.78f), 22.f, FLinearColor(1.f, 1.f, 1.f, 0.12f), 1.f);
		return Radius > 16.f ? Large : Small;
	}

	const FButtonStyle& ButtonStyle()
	{
		static FButtonStyle Style = []
		{
			FButtonStyle S;
			S.SetNormal(FSlateRoundedBoxBrush(FLinearColor(1.f, 1.f, 1.f, 0.05f), 12.f));
			S.SetHovered(FSlateRoundedBoxBrush(FLinearColor(1.f, 1.f, 1.f, 0.13f), 12.f, Amber, 1.f));
			S.SetPressed(FSlateRoundedBoxBrush(FLinearColor(1.f, 1.f, 1.f, 0.2f), 12.f, Amber, 1.f));
			S.SetNormalPadding(FMargin(20.f, 12.f));
			S.SetPressedPadding(FMargin(20.f, 13.f, 20.f, 11.f));
			return S;
		}();
		return Style;
	}

	const FSlateColorBrush& DimBrush()
	{
		static FSlateColorBrush Brush(FLinearColor(0.f, 0.f, 0.f, 0.35f));
		return Brush;
	}
}

FSlateFontInfo SRewildOverlay::Font(float Size)
{
	static TSharedPtr<FStandaloneCompositeFont> Inter;
	static bool bTried = false;
	if (!bTried)
	{
		bTried = true;
		if (UFontFace* Face = LoadObject<UFontFace>(nullptr, TEXT("/Game/UI/Fonts/Inter.Inter"), nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			Face->AddToRoot();
			Inter = MakeShared<FStandaloneCompositeFont>();
			FTypefaceEntry& Entry = Inter->DefaultTypeface.Fonts.AddDefaulted_GetRef();
			Entry.Name = TEXT("Regular");
			Entry.Font = FFontData(Face);
		}
	}
	return Inter ? FSlateFontInfo(Inter, Size) : FCoreStyle::GetDefaultFontStyle("Regular", Size);
}

TSharedRef<SWidget> SRewildOverlay::Glass(const TSharedRef<SWidget>& Content, float Radius, const FMargin& Padding) const
{
	return SNew(SBackgroundBlur)
		.BlurStrength(24.f)
		.CornerRadius(FVector4(Radius, Radius, Radius, Radius))
		.Padding(0.f)
		[
			SNew(SBorder)
			.BorderImage(&GlassBrush(Radius))
			.Padding(Padding)
			[
				Content
			]
		];
}

void SRewildOverlay::Construct(const FArguments& InArgs)
{
	// Sizes are Slate units (a third more pixels at 1080 lines): the smallest text, 11, is about 15 px.
	ChildSlot
	[
		SNew(SOverlay)

		// The world dims a little behind a menu.
		+ SOverlay::Slot()
		[
			SNew(SBorder)
			.BorderImage(&DimBrush())
			.Visibility_Lambda([this] { return bPanel && bDim ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
		]

		// The objective, top left.
		+ SOverlay::Slot()
		.HAlign(HAlign_Left)
		.VAlign(VAlign_Top)
		.Padding(40.f, 34.f)
		[
			SNew(SBox)
			.Visibility_Lambda([this] { return !Objective.IsEmpty() && !bPanel ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			[
				Glass(SNew(STextBlock)
					.Font(Font(15.f))
					.ColorAndOpacity(Words)
					.Text_Lambda([this] { return Objective; }), 14.f, FMargin(18.f, 11.f))
			]
		]

		// The radio: who is speaking, in amber, and the words.
		+ SOverlay::Slot()
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Bottom)
		.Padding(0.f, 0.f, 0.f, 64.f)
		[
			SNew(SBox)
			.MaxDesiredWidth(900.f)
			.MinDesiredWidth(360.f)
			.Visibility_Lambda([this] { return SubAlpha > 0.01f && !bPanel ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			[
				SNew(SBorder)
				.BorderImage(FCoreStyle::Get().GetBrush("NoBorder"))
				.Padding(0.f)
				.ColorAndOpacity_Lambda([this] { return FLinearColor(1.f, 1.f, 1.f, SubAlpha); })
				[
				Glass(SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(0.f, 0.f, 0.f, 4.f)
					[
						SNew(STextBlock).Font(Font(14.f)).ColorAndOpacity(Amber).Text_Lambda([this] { return SubName; })
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						// a fixed wrap width: auto-wrap squeezed the panel into one word a line (9 Nov 2026)
						SNew(STextBlock).Font(Font(19.f)).ColorAndOpacity(Words).WrapTextAt(840.f).Text_Lambda([this] { return SubWords; })
					], 14.f, FMargin(22.f, 14.f, 22.f, 16.f))
				]
			]
		]

		// A note in the corner (the order just given).
		+ SOverlay::Slot()
		.HAlign(HAlign_Right)
		.VAlign(VAlign_Bottom)
		.Padding(0.f, 0.f, 40.f, 64.f)
		[
			SNew(SBox)
			.Visibility_Lambda([this] { return NoteAlpha > 0.01f && !bPanel ? EVisibility::HitTestInvisible : EVisibility::Collapsed; })
			[
				SNew(SBorder)
				.BorderImage(FCoreStyle::Get().GetBrush("NoBorder"))
				.Padding(0.f)
				.ColorAndOpacity_Lambda([this] { return FLinearColor(1.f, 1.f, 1.f, NoteAlpha); })
				[
					Glass(SNew(STextBlock).Font(Font(14.f)).ColorAndOpacity(Words).Text_Lambda([this] { return Note; }), 14.f, FMargin(16.f, 10.f))
				]
			]
		]

		// The panel: menus and the end of a mission; the main menu sits on the left, clear of the ship.
		+ SOverlay::Slot()
		.Expose(PanelSlot)
		.HAlign(HAlign_Center)
		.VAlign(VAlign_Center)
		[
			SNew(SBox)
			.WidthOverride(520.f)
			.Visibility_Lambda([this] { return bPanel ? EVisibility::Visible : EVisibility::Collapsed; })
			[
				Glass(SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight().Padding(4.f, 0.f, 4.f, 6.f)
					[
						SNew(STextBlock).Font(Font(28.f)).ColorAndOpacity(Words).Text_Lambda([this] { return PanelTitle; })
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(4.f, 0.f, 4.f, 18.f)
					[
						SNew(STextBlock).Font(Font(15.f)).ColorAndOpacity(Soft).WrapTextAt(456.f)
						.Text_Lambda([this] { return PanelBody; })
						.Visibility_Lambda([this] { return PanelBody.IsEmpty() ? EVisibility::Collapsed : EVisibility::Visible; })
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						SAssignNew(Buttons, SVerticalBox)
					], 22.f, FMargin(30.f, 26.f, 30.f, 24.f))
			]
		]
	];
}

void SRewildOverlay::SetSubtitle(const FText& Name, const FText& InWords, float Alpha)
{
	SubName = Name;
	SubWords = InWords;
	SubAlpha = Alpha;
}

void SRewildOverlay::SetObjective(const FText& Text)
{
	Objective = Text;
}

void SRewildOverlay::SetNote(const FText& Text, float Alpha)
{
	Note = Text;
	NoteAlpha = Alpha;
}

void SRewildOverlay::ShowPanel(const FText& Title, const FText& Body, const TArray<FRewildMenuItem>& Items, bool bDimWorld, bool bOnLeft)
{
	bLeft = bOnLeft;
	if (PanelSlot)
	{
		PanelSlot->SetHorizontalAlignment(bLeft ? HAlign_Left : HAlign_Center);
		PanelSlot->SetPadding(bLeft ? FMargin(140.f, 0.f, 0.f, 0.f) : FMargin(0.f));
	}
	PanelTitle = Title;
	PanelBody = Body;
	bDim = bDimWorld;
	bPanel = true;
	Buttons->ClearChildren();
	FirstButton.Reset();
	for (const FRewildMenuItem& Item : Items)
	{
		TFunction<void()> Pick = Item.OnPick;
		TSharedRef<SButton> B = SNew(SButton)
			.ButtonStyle(&ButtonStyle())
			.OnClicked_Lambda([Pick]() { if (Pick) { Pick(); } return FReply::Handled(); })
			[
				SNew(STextBlock).Font(Font(16.f)).ColorAndOpacity(Words).Text(Item.Label)
			];
		Buttons->AddSlot().AutoHeight().Padding(0.f, 5.f)[B];
		if (!FirstButton.IsValid())
		{
			FirstButton = B;
		}
	}
	if (FSlateApplication::IsInitialized())
	{
		// Keyboard and gamepad can move between the buttons from the first one.
		FSlateApplication::Get().SetAllUserFocus(FirstButton.IsValid() ? FirstButton : SharedThis(this), EFocusCause::SetDirectly);
	}
}

void SRewildOverlay::HidePanel()
{
	bPanel = false;
	Buttons->ClearChildren();
	FirstButton.Reset();
	OnBack = nullptr;
}

FReply SRewildOverlay::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (bPanel && OnBack && (Key == EKeys::Escape || Key == EKeys::Gamepad_FaceButton_Right || Key == EKeys::Gamepad_Special_Right))
	{
		TFunction<void()> Back = OnBack;
		Back();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}
