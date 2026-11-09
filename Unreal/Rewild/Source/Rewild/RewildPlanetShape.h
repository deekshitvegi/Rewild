#pragma once

#include "CoreMinimal.h"

/**
 * The shape of a world (docs/unreal/PLAN.md, "Planets: land anywhere"): the height of its ground at every point and
 * what covers it there. One pure function of position, read from many threads at once: the ground's tiles, the sea,
 * the ship's altitude, and later where grass and trees grow, all ask it the same question and get the same answer.
 *
 * Positions are directions from the planet's centre (unit vectors, in the planet's own frame: +Z is up at the
 * colony on Haven). Heights are metres above sea level (the radius). MinWave is the shortest wavelength worth adding
 * at the caller's spacing, so a coarse tile seen from orbit does not pay for, or flicker with, pebble-sized detail.
 */
class REWILD_API FRewildPlanetShape
{
public:
	virtual ~FRewildPlanetShape() = default;

	/** Radius at sea level, metres. */
	double Radius = 6371000.0;
	/** Whether there is a sea at height 0. */
	bool bHasSea = false;

	virtual double Height(const FVector3d& Dir, double MinWave) const = 0;

	/** What covers the ground: weights 0..1 of grass, rock, sand and seabed (RGBA), plus a slow tint -1..1. */
	struct FCover
	{
		FLinearColor Weights = FLinearColor(1.f, 0.f, 0.f, 0.f);
		float Tint = 0.f;
		float Wet = 0.f;
	};
	/** Up is the slope's cosine (1 flat, 0 a cliff); patches shorter than MinWave are left out (they would alias). */
	virtual FCover Cover(const FVector3d& Dir, double HeightM, double Up, double MinWave) const = 0;

	/** The shape for a world by name ("Haven"), or null. */
	static TSharedPtr<const FRewildPlanetShape, ESPMode::ThreadSafe> Make(FName World);
};

/** Gradient noise in 3D with its derivatives (Inigo Quilez's form), sampled in double precision. */
namespace RewildNoise
{
	/** Value about -1..1 and its gradient (per unit of P). */
	float Gradient(const FVector3d& P, FVector3f& OutDerivative);
	inline float Gradient(const FVector3d& P) { FVector3f D; return Gradient(P, D); }
}

/**
 * Haven (docs/unreal/HAVEN.md): radius 5,730 km, seas in a few great basins, rolling teal grassland, mountains in
 * belts, and round the colony (+Z) gentle hills above a bay that opens toward TON 618 (+X).
 */
class REWILD_API FHavenShape : public FRewildPlanetShape
{
public:
	FHavenShape();
	virtual double Height(const FVector3d& Dir, double MinWave) const override;
	virtual FCover Cover(const FVector3d& Dir, double HeightM, double Up, double MinWave) const override;

private:
	double Continents(const FVector3d& P) const;
	double Hills(const FVector3d& P, const FVector3d& Up, double Amplitude, double LongestWave, double MinWave) const;
	double Mountains(const FVector3d& P, double MinWave) const;
	double Colony(const FVector3d& P, double MinWave) const;
};
