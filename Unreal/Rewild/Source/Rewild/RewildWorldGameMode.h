#pragma once

#include "CoreMinimal.h"
#include "RewildGameMode.h"
#include "RewildWorldGameMode.generated.h"

class ACameraActor;

/**
 * The game mode for a world (docs/unreal/PLAN.md, part one: the worlds): free flight over a whole round planet
 * (ARewildPlanet), with no Harrow and no mission yet. The fighter starts in orbit, 400 km up and 600 km short of the
 * colony, nose down toward it; -RewildAltitude=<metres> starts it lower, 3 km west of the colony, level, heading
 * east toward the bay and TON 618.
 *
 * -RewildWorldShots takes the stills docs/unreal/HAVEN.md is graded on (the globe, from orbit, from 20 km, from the
 * ship at 300 m, on foot, the ground at your feet), each once the ground has finished building for that view and
 * the light has settled, then quits. Shots land in Saved/Screenshots/WindowsEditor.
 */
UCLASS()
class REWILD_API ARewildWorldGameMode : public ARewildGameMode
{
	GENERATED_BODY()

public:
	ARewildWorldGameMode();
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void StartPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	/** A still: the camera above one point, looking at another (each: metres east and north of the colony, metres up). */
	struct FStill
	{
		FString Name;
		FVector2D From;
		double FromUp = 0.0;
		FVector2D At;
		double AtUp = 0.0;
		bool bAtCentre = false;  // look at the planet's centre instead (the whole globe)
	};

	UPROPERTY() TObjectPtr<ACameraActor> Camera;
	TArray<FStill> Stills;
	int32 StillIndex = -1;
	float Waited = 0.f;
	float SettledFor = 0.f;
	float AfterSettled = 0.f;
	float NextIn = 0.f;
	bool bShots = false;
	bool bQuitting = false;

	void ShowStill(int32 Index);
	static FVector3d DirAt(const FVector2D& EastNorth, double Radius);
};
