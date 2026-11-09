#include "RewildSave.h"

#include "Kismet/GameplayStatics.h"

void URewildSave::Write(const FString& Mode, const FString& Mission, int32 Checkpoint)
{
	URewildSave* S = Cast<URewildSave>(UGameplayStatics::CreateSaveGameObject(URewildSave::StaticClass()));
	S->Mode = Mode;
	S->Mission = Mission;
	S->Checkpoint = Checkpoint;
	S->Saved = FDateTime::Now();
	UGameplayStatics::SaveGameToSlot(S, Mode, 0);
	UGameplayStatics::SaveGameToSlot(S, TEXT("Last"), 0);
	UE_LOG(LogTemp, Display, TEXT("[rewild] saved: %s, %s, checkpoint %d"), *Mode, *Mission, Checkpoint);
}

URewildSave* URewildSave::ReadLast()
{
	return UGameplayStatics::DoesSaveGameExist(TEXT("Last"), 0)
		? Cast<URewildSave>(UGameplayStatics::LoadGameFromSlot(TEXT("Last"), 0)) : nullptr;
}

FString URewildSave::Options() const
{
	// A finished story starts again from its last wave until the next mission exists.
	return FString::Printf(TEXT("Mode=%s?Checkpoint=%d"), *Mode, FMath::Clamp(Checkpoint, 0, 3));
}

URewildSettings* URewildSettings::Get()
{
	static TWeakObjectPtr<URewildSettings> Loaded;
	if (!Loaded.IsValid())
	{
		URewildSettings* S = UGameplayStatics::DoesSaveGameExist(TEXT("Settings"), 0)
			? Cast<URewildSettings>(UGameplayStatics::LoadGameFromSlot(TEXT("Settings"), 0)) : nullptr;
		if (!S)
		{
			S = Cast<URewildSettings>(UGameplayStatics::CreateSaveGameObject(URewildSettings::StaticClass()));
		}
		S->AddToRoot();
		Loaded = S;
	}
	return Loaded.Get();
}

void URewildSettings::Store()
{
	UGameplayStatics::SaveGameToSlot(this, TEXT("Settings"), 0);
}

float URewildSettings::MouseSensitivity() const
{
	static const float Steps[3] = {0.0015f, 0.0025f, 0.0038f};
	return Steps[FMath::Clamp(Mouse, 0, 2)];
}
