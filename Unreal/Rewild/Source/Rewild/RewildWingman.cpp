#include "RewildWingman.h"

#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "RewildBolts.h"
#include "RewildExplosion.h"
#include "RewildFighter.h"
#include "RewildHealthComponent.h"
#include "RewildMissiles.h"
#include "RewildRadio.h"
#include "RewildReaper.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr float M = 100.f;
	const FName GunLeft(TEXT("Gun_L"));
	const FName GunRight(TEXT("Gun_R"));
	const FName EngineSlot(TEXT("M_Engine_Glow"));
	const FName StripeSlot(TEXT("M_Paint_Red"));
	const TCHAR* Names[] = {TEXT("Noor"), TEXT("Kai"), TEXT("Amara")};
	// Each pilot's stripes (linear), muted like the player's red: sage green, ochre, cobalt.
	const FLinearColor Stripes[] = {FLinearColor(0.06f, 0.2f, 0.07f), FLinearColor(0.42f, 0.2f, 0.02f), FLinearColor(0.025f, 0.07f, 0.3f)};
	constexpr float LockNeeded = 2.f;
	constexpr float ComeBackTime = 60.f;  // free play: back from the Argo

	using RewildFlight::AngleDeg;
	using RewildFlight::SolveLead;
}

ARewildWingman::ARewildWingman()
{
	PrimaryActorTick.bCanEverTick = true;
	static ConstructorHelpers::FObjectFinder<UStaticMesh> BodyMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_Body.Fighter_Body"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> GlassMesh(TEXT("/Game/FirstFight/Fighter/Mesh/Fighter_CanopyGlass.Fighter_CanopyGlass"));

	Hull = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Hull"));
	SetRootComponent(Hull);
	Hull->SetStaticMesh(BodyMesh.Object);
	Hull->SetCollisionEnabled(ECollisionEnabled::QueryOnly);  // only bolts (visibility traces) touch it
	Hull->SetCollisionObjectType(ECC_Pawn);
	Hull->SetCollisionResponseToAllChannels(ECR_Ignore);
	Hull->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

	Canopy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Canopy"));
	Canopy->SetupAttachment(Hull);
	Canopy->SetStaticMesh(GlassMesh.Object);
	Canopy->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	Health = CreateDefaultSubobject<URewildHealthComponent>(TEXT("Health"));
	Health->ShieldMax = 100.f;
	Health->HullMax = 100.f;
	Health->ShieldRegenDelay = 4.f;
	Health->ShieldRegenRate = 20.f;
	Health->Team = 0;

	Figures.PitchRate = 82.f;
	Figures.YawRate = 45.f;
	Figures.RollRate = 200.f;
	Figures.Assist = 1.7f;
}

void ARewildWingman::BeginPlay()
{
	Super::BeginPlay();
	const int32 Engine = Hull->GetMaterialIndex(EngineSlot);
	if (Engine != INDEX_NONE)
	{
		EngineGlow = Hull->CreateDynamicMaterialInstance(Engine);
	}
	const int32 Paint = Hull->GetMaterialIndex(StripeSlot);
	if (Paint != INDEX_NONE)
	{
		Stripe = Hull->CreateDynamicMaterialInstance(Paint);
		Stripe->SetVectorParameterValue(TEXT("Colour"), GetStripe());
	}
	Health->Restore();
	Health->OnHit.AddUObject(this, &ARewildWingman::HandleHit);
	Health->OnDeath.AddUObject(this, &ARewildWingman::HandleDeath);
	Velocity = GetActorForwardVector() * CruiseSpeed * M;
}

void ARewildWingman::Setup(int32 InIndex, const FVector& InSlot, bool bInComesBack)
{
	Index = FMath::Clamp(InIndex, 0, 2);
	Slot = InSlot;
	bComesBack = bInComesBack;
	if (Stripe)
	{
		Stripe->SetVectorParameterValue(TEXT("Colour"), GetStripe());
	}
}

FText ARewildWingman::GetCallsign() const { return FText::FromString(Names[Index]); }
FLinearColor ARewildWingman::GetStripe() const { return Stripes[Index]; }
bool ARewildWingman::IsAlive() const { return !Health->IsDead(); }

void ARewildWingman::Order(ERewildOrder InOrder, AActor* InTarget)
{
	Orders = InOrder;
	Target = (InOrder == ERewildOrder::Attack && RewildFlight::IsAlive(InTarget)) ? InTarget : nullptr;
	if (InOrder == ERewildOrder::Attack && !Target.IsValid())
	{
		Orders = ERewildOrder::Free;
	}
	RetargetIn = 0.f;
	Manoeuvre = EManoeuvre::None;
}

void ARewildWingman::StartManoeuvre(EManoeuvre Kind, const FVector& Dir, float Seconds)
{
	Manoeuvre = Kind;
	ManoeuvreDir = Dir.GetSafeNormal();
	ManoeuvreLeft = Seconds;
	JinkSwitch = 0.f;
}

void ARewildWingman::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	if (Health->IsDead())
	{
		if (bComesBack && (BackIn -= Dt) <= 0.f)
		{
			ComeBack();
		}
		return;
	}
	HurtCooldown -= Dt;
	RetargetIn -= Dt;
	if (RetargetIn <= 0.f)
	{
		RetargetIn = 0.7f;
		ChooseTarget();
	}
	if (const AActor* T = Target.Get())
	{
		TargetVelocitySeen = FMath::Lerp(TargetVelocitySeen, T->GetVelocity(), 1.f - FMath::Exp(-3.f * Dt));
	}
	Defend(Dt);
	FVector Dir;
	float Speed;
	Think(Dt, Dir, Speed);
	RewildFlight::Steer(this, Stick, Velocity, Dir, Speed * M, Dt, Figures);
	TickGuns(Dt);
	TickMissile(Dt);
	if (EngineGlow)
	{
		const float Throttle = FMath::Clamp(Speed / CruiseSpeed, 0.f, 1.f);
		EngineGlow->SetScalarParameterValue(TEXT("Glow"), FMath::Lerp(8000.f, 100000.f, Throttle) * (bBoosting ? 1.6f : 1.f));
	}
}

void ARewildWingman::ChooseTarget()
{
	const APawn* Dev = UGameplayStatics::GetPlayerPawn(this, 0);
	if (Orders == ERewildOrder::FormUp)
	{
		Target = nullptr;
		return;
	}
	if (Orders == ERewildOrder::Attack)
	{
		if (RewildFlight::IsAlive(Target.Get()))
		{
			return;
		}
		Orders = ERewildOrder::Free;  // the order is done
	}
	const FVector Here = GetActorLocation();
	if (Orders == ERewildOrder::Free && RewildFlight::IsAlive(Target.Get()) && FVector::Dist(Target->GetActorLocation(), Here) < 3500.f * M)
	{
		return;  // stay on the one it is fighting
	}
	AActor* Best = nullptr;
	float BestScore = TNumericLimits<float>::Max();
	for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
	{
		if (!It->IsAlive())
		{
			continue;
		}
		const FVector R = It->GetActorLocation();
		float Score;
		if (Orders == ERewildOrder::Cover && Dev)
		{
			// what threatens Dev most: close to him, worse still behind him with its nose on him
			const FVector ToDev = Dev->GetActorLocation() - R;
			const bool bOnHim = AngleDeg(It->GetActorForwardVector(), ToDev) < 30.f && AngleDeg(-Dev->GetActorForwardVector(), -ToDev) < 60.f;
			Score = ToDev.Size() - (bOnHim ? 80000.f : 0.f);
		}
		else
		{
			Score = FVector::Dist(R, Here) - (It->GetPrey() == this ? 100000.f : 0.f);  // the one hunting it first
			if (FVector::Dist(R, Here) > 4000.f * M)
			{
				continue;
			}
		}
		if (Score < BestScore)
		{
			BestScore = Score;
			Best = *It;
		}
	}
	Target = Best;
}

void ARewildWingman::Think(float Dt, FVector& OutDir, float& OutSpeed)
{
	const FVector Here = GetActorLocation();
	const FVector Fwd = GetActorForwardVector();
	OutDir = Fwd;
	OutSpeed = CruiseSpeed;
	bBoosting = false;
	const APawn* Dev = UGameplayStatics::GetPlayerPawn(this, 0);

	auto Jink = [&]()
	{
		JinkSwitch -= Dt;
		if (JinkSwitch <= 0.f)
		{
			const FVector Across = FVector::CrossProduct(Fwd, FMath::VRand()).GetSafeNormal();
			ManoeuvreDir = (Fwd + Across * FMath::FRandRange(0.6f, 1.2f)).GetSafeNormal();
			JinkSwitch = FMath::FRandRange(0.5f, 1.1f);
		}
		OutDir = ManoeuvreDir;
	};

	// A Reaper close behind with its nose on it: jink.
	if (Manoeuvre == EManoeuvre::None)
	{
		for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
		{
			if (!It->IsAlive())
			{
				continue;
			}
			const FVector To = It->GetActorLocation() - Here;
			if (To.Size() < 600.f * M && AngleDeg(-Fwd, To) < 40.f && AngleDeg(It->GetActorForwardVector(), -To) < 20.f && FMath::FRand() < Dt * 1.2f)
			{
				StartManoeuvre(EManoeuvre::Jink, Fwd, FMath::FRandRange(1.5f, 2.5f));
				break;
			}
		}
	}

	if (Manoeuvre != EManoeuvre::None)
	{
		ManoeuvreLeft -= Dt;
		if (Manoeuvre == EManoeuvre::Jink)
		{
			Jink();
			OutSpeed = BoostSpeed;
			bBoosting = true;
		}
		else
		{
			OutDir = ManoeuvreDir;
			OutSpeed = Manoeuvre == EManoeuvre::Extend ? BoostSpeed : CruiseSpeed;
			bBoosting = Manoeuvre == EManoeuvre::Extend;
		}
		if (ManoeuvreLeft <= 0.f)
		{
			Manoeuvre = Manoeuvre == EManoeuvre::Break ? EManoeuvre::Extend : EManoeuvre::None;
			ManoeuvreLeft = FMath::FRandRange(1.2f, 2.2f);
			if (Manoeuvre == EManoeuvre::Extend)
			{
				ManoeuvreDir = Fwd;
			}
		}
	}
	else if (const AActor* T = Target.Get(); T && RewildFlight::IsAlive(T))
	{
		const FVector To = T->GetActorLocation() - Here;
		const float Dist = To.Size();
		const FVector ToN = To / FMath::Max(Dist, 1.f);
		float Time = 0.f;
		const FVector Rel = TargetVelocitySeen - Velocity;
		OutDir = SolveLead(To, Rel, GunSpeed * M, Time) ? (To + Rel * Time).GetSafeNormal() : ToN;
		if (Dist > 1500.f * M)
		{
			OutSpeed = BoostSpeed;
			bBoosting = true;
		}
		else if (Dist < 400.f * M)
		{
			OutSpeed = FMath::Max(T->GetVelocity().Size() / M + 15.f, 150.f);
		}
		if ((Dist < 90.f * M && FVector::DotProduct(Fwd, ToN) > 0.f) || (FVector::DotProduct(Fwd, ToN) < -0.2f && Dist < 400.f * M))
		{
			StartManoeuvre(EManoeuvre::Break, FVector::CrossProduct(ToN, GetActorUpVector()) * (FMath::RandBool() ? 1.f : -1.f), 1.4f);
		}
	}
	else if (Dev)
	{
		// On Dev's wing: fly to its place, a little ahead of where it will be, then match his heading and speed.
		const FVector P = Dev->GetActorLocation();
		const FVector PF = Dev->GetActorForwardVector();
		const FVector Place = P + PF * Slot.X + Dev->GetActorRightVector() * Slot.Y + Dev->GetActorUpVector() * Slot.Z;
		const FVector ToPlace = Place + Dev->GetVelocity() * 0.8f - Here;
		const float DevSpeed = Dev->GetVelocity().Size() / M;
		if (ToPlace.Size() > 150.f * M)
		{
			OutDir = ToPlace.GetSafeNormal();
			OutSpeed = FMath::Max(BoostSpeed, DevSpeed + 60.f);
			bBoosting = true;
		}
		else
		{
			OutDir = (PF + ToPlace / (60.f * M)).GetSafeNormal();
			OutSpeed = FMath::Clamp(DevSpeed + FVector::DotProduct(Place - Here, PF) / M * 0.6f, 60.f, BoostSpeed);
		}
	}

	// Keep clear of Dev and the others.
	auto Clear = [&](const AActor* A)
	{
		if (!A || A == this)
		{
			return;
		}
		const FVector Away = Here - A->GetActorLocation();
		const float D = Away.Size();
		if (D < 60.f * M)
		{
			OutDir += Away / FMath::Max(D, 1.f) * (1.f - D / (60.f * M)) * 2.f;
		}
	};
	Clear(Dev);
	for (TActorIterator<ARewildWingman> It(GetWorld()); It; ++It)
	{
		Clear(*It);
	}
	OutDir = OutDir.GetSafeNormal(UE_SMALL_NUMBER, Fwd);
}

void ARewildWingman::TickGuns(float Dt)
{
	GunCooldown -= Dt;
	auto Hold = [this]() { GunCooldown = FMath::Max(GunCooldown, 0.f); };
	const AActor* T = Target.Get();
	if (!T || !RewildFlight::IsAlive(T) || Manoeuvre == EManoeuvre::Break || Manoeuvre == EManoeuvre::Extend)
	{
		return Hold();
	}
	if (BurstPause > 0.f)
	{
		BurstPause -= Dt;
		return Hold();
	}
	const FVector Here = GetActorLocation();
	const FVector To = T->GetActorLocation() - Here;
	const FVector Rel = TargetVelocitySeen - Velocity;
	float Time = 0.f;
	if (To.Size() > GunRange * M || !SolveLead(To, Rel, GunSpeed * M, Time))
	{
		return Hold();
	}
	const FVector Aim = (To + Rel * Time).GetSafeNormal();
	const FVector Fwd = GetActorForwardVector();
	if (AngleDeg(Fwd, Aim) > 2.5f)
	{
		return Hold();
	}
	if (BurstLeft <= 0.f)
	{
		BurstLeft = FMath::FRandRange(0.6f, 1.f);
	}
	BurstLeft -= Dt;
	if (BurstLeft <= 0.f)
	{
		BurstPause = FMath::FRandRange(0.4f, 0.9f);
	}
	URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>();
	while (GunCooldown <= 0.f && Bolts)
	{
		GunCooldown += 1.f / GunRate;
		const FName Socket = bRightGun ? GunRight : GunLeft;
		bRightGun = !bRightGun;
		const FVector Muzzle = Hull->DoesSocketExist(Socket) ? Hull->GetSocketLocation(Socket) : Here + Fwd * 800.f;
		const FVector Dir = FMath::VRandCone((Fwd * 0.3f + Aim * 0.7f).GetSafeNormal(), FMath::DegreesToRadians(0.6f));
		Bolts->Fire(this, ERewildBoltKind::Cannon, Health->Team, Muzzle, Dir * GunSpeed * M + Velocity, GunDamage);
	}
}

void ARewildWingman::TickMissile(float Dt)
{
	MissileGap -= Dt;
	URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>();
	AActor* T = Target.Get();
	if (!Ms || !T || Missiles <= 0 || MissileGap > 0.f || !RewildFlight::IsAlive(T))
	{
		LockTime = 0.f;
		return;
	}
	const FVector To = T->GetActorLocation() - GetActorLocation();
	const float Dist = To.Size();
	if (Dist > 400.f * M && Dist < 2200.f * M && AngleDeg(GetActorForwardVector(), To) < 12.f)
	{
		LockTime += Dt;
		Ms->ReportLock(this, T, FMath::Min(LockTime / LockNeeded, 1.f));
		if (LockTime >= LockNeeded)
		{
			Ms->Launch(this, ERewildMissileKind::Rewild, Health->Team, GetActorLocation() - GetActorUpVector() * 90.f, GetActorQuat(), Velocity, T);
			--Missiles;
			MissileGap = 8.f;
			LockTime = 0.f;
		}
	}
	else
	{
		LockTime = FMath::Max(0.f, LockTime - Dt);
	}
}

void ARewildWingman::Defend(float Dt)
{
	DefendCooldown -= Dt;
	URewildMissiles* Ms = GetWorld()->GetSubsystem<URewildMissiles>();
	if (!Ms || DefendCooldown > 0.f)
	{
		return;
	}
	TArray<URewildMissiles::FThreat> Threats;
	Ms->GetThreats(this, Threats);
	for (const URewildMissiles::FThreat& Th : Threats)
	{
		if (Th.Seconds < 2.2f)
		{
			DefendCooldown = 3.f;
			if (Flares > 0 && FMath::FRand() < 0.7f)
			{
				Ms->DropFlares(this, Health->Team, GetActorLocation(), GetActorQuat(), Velocity, 2);
				Flares -= 2;
			}
			if (FMath::FRand() < 0.8f)
			{
				const FVector LOS = (GetActorLocation() - Th.Position).GetSafeNormal();
				FVector Beam = FVector::CrossProduct(LOS, GetActorUpVector()).GetSafeNormal();
				if (FVector::DotProduct(Beam, GetActorForwardVector()) < 0.f)
				{
					Beam = -Beam;
				}
				StartManoeuvre(EManoeuvre::Break, Beam, 1.8f);
			}
			return;
		}
	}
}

void ARewildWingman::HandleHit(const FVector& Point, bool bOnShield)
{
	if (HurtCooldown <= 0.f && (Health->GetShieldFraction() <= 0.f || Health->GetHullFraction() < 0.5f))
	{
		if (URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>())
		{
			if (Radio->ChatterBy(Index, {TEXT("h2"), TEXT("h1"), TEXT("h3")}))
			{
				HurtCooldown = 15.f;
			}
		}
	}
}

void ARewildWingman::HandleDeath()
{
	ARewildExplosion::Spawn(GetWorld(), GetActorLocation(), Velocity, 1.6f);
	Hull->SetVisibility(false, true);
	Hull->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	if (URewildRadio* Radio = GetWorld()->GetSubsystem<URewildRadio>())
	{
		static const FName Out[] = {TEXT("x2"), TEXT("x1"), TEXT("x3")};
		Radio->Say(Out[Index]);
		Radio->Say(TEXT("x4"));
	}
	BackIn = ComeBackTime;
	Target = nullptr;
	UE_LOG(LogTemp, Display, TEXT("[rewild] %s shot down"), Names[Index]);
}

void ARewildWingman::ComeBack()
{
	const APawn* Dev = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Dev)
	{
		return;
	}
	SetActorLocationAndRotation(Dev->GetActorLocation() - Dev->GetActorForwardVector() * 30000.f + Dev->GetActorRightVector() * Slot.Y,
		Dev->GetActorRotation());
	Velocity = Dev->GetVelocity();
	Health->Restore();
	Hull->SetVisibility(true, true);
	Hull->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Missiles = 2;
	Flares = 8;
	Orders = ERewildOrder::Free;
}
