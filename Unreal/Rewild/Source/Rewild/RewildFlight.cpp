#include "RewildFlight.h"

#include "GameFramework/Actor.h"
#include "RewildHealthComponent.h"

namespace RewildFlight
{
	void Steer(AActor* Self, FRewildStick& Stick, FVector& Velocity, const FVector& Dir, float Speed, float Dt,
		const FRewildFlightFigures& Figures)
	{
		const FVector Local = Self->GetActorTransform().InverseTransformVectorNoScale(Dir);
		const float Off = AngleDeg(FVector::ForwardVector, Local);
		const float RollErr = FMath::Atan2(Local.Y, Local.Z);  // where the goal sits round the nose: 0 straight overhead
		float WantPitch = 0.f, WantYaw = 0.f, WantRoll = 0.f;
		if (Off > 10.f)
		{
			if (FMath::Abs(RollErr) > FMath::DegreesToRadians(130.f) && Off < 35.f)
			{
				// a little below: push the nose down rather than roll over
				WantPitch = FMath::Clamp(FMath::Atan2(Local.Z, Local.X) * 4.f, -0.6f, 0.f);
				WantYaw = FMath::Clamp(FMath::Atan2(Local.Y, Local.X) * 4.f, -1.f, 1.f);
			}
			else
			{
				// Bank so the goal sits above the canopy, then pull.
				WantRoll = FMath::Clamp(RollErr * 2.5f, -1.f, 1.f);
				const float Aligned = FMath::Clamp(1.f - FMath::Abs(RollErr) / FMath::DegreesToRadians(70.f), 0.f, 1.f);
				WantPitch = FMath::Clamp(Off / 30.f, 0.f, 1.f) * Aligned;
				WantYaw = FMath::Clamp(FMath::Atan2(Local.Y, Local.X) * 2.f, -1.f, 1.f) * 0.5f;
			}
		}
		else
		{
			// fine aim: small pitch and yaw, no roll
			WantPitch = FMath::Clamp(FMath::Atan2(Local.Z, Local.X) * 6.f, -1.f, 1.f);
			WantYaw = FMath::Clamp(FMath::Atan2(Local.Y, Local.X) * 6.f, -1.f, 1.f);
		}
		const float Step = 6.f * Dt;
		Stick.Pitch += FMath::Clamp(WantPitch - Stick.Pitch, -Step, Step);
		Stick.Yaw += FMath::Clamp(WantYaw - Stick.Yaw, -Step, Step);
		Stick.Roll += FMath::Clamp(WantRoll - Stick.Roll, -Step, Step);
		Self->SetActorRotation(Self->GetActorQuat() * FQuat(FRotator(Stick.Pitch * Figures.PitchRate * Dt,
			Stick.Yaw * Figures.YawRate * Dt, Stick.Roll * Figures.RollRate * Dt)));

		Velocity += (Self->GetActorForwardVector() * Speed - Velocity) * (1.f - FMath::Exp(-Figures.Assist * Dt));
		Self->AddActorWorldOffset(Velocity * Dt);
	}

	bool SolveLead(const FVector& Offset, const FVector& RelativeVelocity, float Speed, float& OutTime)
	{
		const float A = RelativeVelocity.SizeSquared() - Speed * Speed;
		const float B = 2.f * FVector::DotProduct(Offset, RelativeVelocity);
		const float C = Offset.SizeSquared();
		if (FMath::Abs(A) < 1e-3f)
		{
			OutTime = B < 0.f ? -C / B : -1.f;
			return OutTime > 0.f;
		}
		const float Disc = B * B - 4.f * A * C;
		if (Disc < 0.f)
		{
			return false;
		}
		const float Root = FMath::Sqrt(Disc);
		const float T1 = (-B - Root) / (2.f * A);
		const float T2 = (-B + Root) / (2.f * A);
		OutTime = (T1 > 0.f && (T1 < T2 || T2 <= 0.f)) ? T1 : T2;
		return OutTime > 0.f;
	}

	float AngleDeg(const FVector& A, const FVector& B)
	{
		return FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(A.GetSafeNormal(), B.GetSafeNormal()), -1.f, 1.f)));
	}

	bool IsAlive(const AActor* Actor)
	{
		if (!Actor || Actor->IsActorBeingDestroyed())
		{
			return false;
		}
		const URewildHealthComponent* H = Actor->FindComponentByClass<URewildHealthComponent>();
		return H && !H->IsDead();
	}
}
