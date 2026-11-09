#pragma once

#include "CoreMinimal.h"

class AActor;

/** The AI pilot's hands on the stick, -1..1 on each axis, eased so turns start and end smoothly. */
struct FRewildStick
{
	float Pitch = 0.f;
	float Yaw = 0.f;
	float Roll = 0.f;
};

/** Turn rates and assist for an AI fighter (degrees per second; assist in 1/s), as the player's fighter flies. */
struct FRewildFlightFigures
{
	float PitchRate = 85.f;
	float YawRate = 40.f;
	float RollRate = 220.f;
	float Assist = 1.8f;
};

namespace RewildFlight
{
	/**
	 * Flies an AI fighter (the Reapers, the crew's wingmen) toward Dir at Speed (cm/s): it banks so the goal sits above
	 * the canopy and pulls, the way fighters turn; small corrections use pitch and yaw only; the stick moves at a
	 * hand's pace; flight assist swings Velocity round to the nose. Moves the actor.
	 */
	REWILD_API void Steer(AActor* Self, FRewildStick& Stick, FVector& Velocity, const FVector& Dir, float Speed, float Dt,
		const FRewildFlightFigures& Figures);

	/** Time for a shot at Speed (plus the shooter's velocity) to meet a target at Offset moving at RelativeVelocity. */
	REWILD_API bool SolveLead(const FVector& Offset, const FVector& RelativeVelocity, float Speed, float& OutTime);

	/** Degrees between two directions. */
	REWILD_API float AngleDeg(const FVector& A, const FVector& B);

	/** True if the actor can still fight (it has a health component that is not dead, and is not being destroyed). */
	REWILD_API bool IsAlive(const AActor* Actor);
}
