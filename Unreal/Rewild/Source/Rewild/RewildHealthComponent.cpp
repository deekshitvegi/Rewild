#include "RewildHealthComponent.h"

URewildHealthComponent::URewildHealthComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
}

void URewildHealthComponent::Restore()
{
	Shield = ShieldMax;
	Hull = HullMax;
	SinceHit = 100.f;
	bDead = false;
}

bool URewildHealthComponent::ApplyDamage(float Amount, const FVector& Point)
{
	if (bDead || Amount <= 0.f)
	{
		return false;
	}
	SinceHit = 0.f;
	const bool bOnShield = Shield > 0.f;
	const float Absorbed = FMath::Min(Shield, Amount);
	Shield -= Absorbed;
	Hull = FMath::Max(0.f, Hull - (Amount - Absorbed));
	OnHit.Broadcast(Point, bOnShield);
	if (Hull <= 0.f)
	{
		bDead = true;
		OnDeath.Broadcast();
		return true;
	}
	return false;
}

void URewildHealthComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	SinceHit += DeltaTime;
	if (!bDead && SinceHit >= ShieldRegenDelay)
	{
		Shield = FMath::Min(ShieldMax, Shield + ShieldRegenRate * DeltaTime);
	}
}
