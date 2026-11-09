#include "RewildReaper.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "RewildBolts.h"
#include "RewildExplosion.h"
#include "RewildFighter.h"
#include "RewildHealthComponent.h"
#include "RewildMissiles.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	constexpr float M = 100.f;  // metres to centimetres
	const FName GunL(TEXT("Gun_L"));
	const FName GunR(TEXT("Gun_R"));
	const FName MissileSocket(TEXT("Missile"));
	const FName EngineSocket(TEXT("Engine"));
	const FName SeamSlot(TEXT("M_Seam_Hot"));
	const FName EngineSlot(TEXT("M_Engine_Hot"));

	constexpr float LockNeeded = 1.8f;        // seconds of holding the player in its nose to lock
	constexpr float LockCone = 14.f;          // degrees
	constexpr float MissileRangeMin = 400.f * M;
	constexpr float MissileRangeMax = 2400.f * M;
	constexpr float MissileReloadTime = 18.f;

	/** Time for a bolt (speed Speed, plus the shooter's velocity) to meet a target; false if it never can. */
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

	bool PlayerAlive(const APawn* P)
	{
		const ARewildFighter* F = Cast<ARewildFighter>(P);
		return P && (!F || !F->IsDead());
	}
}

int32 ARewildReaper::SlugsFired = 0;

ARewildReaper::ARewildReaper()
{
	PrimaryActorTick.bCanEverTick = true;
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cone(TEXT("/Engine/BasicShapes/Cone.Cone"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Sphere(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> HaloMat(TEXT("/Game/FirstFight/FX/MI_FX_NozzleHarrow.MI_FX_NozzleHarrow"));

	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(GetRootComponent());
	// Until the Reaper model is imported (art/reaper): a dark 14 m cone pointing forward.
	Mesh->SetStaticMesh(Cone.Object);
	Mesh->SetRelativeRotation(FRotator(-90.f, 0.f, 0.f));
	Mesh->SetRelativeScale3D(FVector(10.f, 3.f, 14.f));
	// Only bolts (visibility traces) touch it.
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	Mesh->SetCollisionObjectType(ECC_WorldDynamic);
	Mesh->SetCollisionResponseToAllChannels(ECR_Ignore);
	Mesh->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

	// The furnace's glow: a soft orange point at the engine, so a Reaper running away reads at a kilometre (the dark
	// alloy alone vanished against space, 9 Nov 2026).
	EngineHalo = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("EngineHalo"));
	EngineHalo->SetupAttachment(GetRootComponent());
	EngineHalo->SetStaticMesh(Sphere.Object);
	if (HaloMat.Object)
	{
		EngineHalo->SetMaterial(0, HaloMat.Object);
	}
	EngineHalo->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	EngineHalo->SetCastShadow(false);
	EngineHalo->SetUsingAbsoluteScale(true);
	EngineHalo->SetRelativeLocation(FVector(-650.f, 0.f, 0.f));

	Health = CreateDefaultSubobject<URewildHealthComponent>(TEXT("Health"));
	Health->ShieldMax = 0.f;   // no shield: armour, and seams that glow hotter as it is hurt
	Health->HullMax = 130.f;   // 33 hits from the player's cannons; one missile
	Health->Team = 1;
}

void ARewildReaper::BeginPlay()
{
	Super::BeginPlay();
	if (UStaticMesh* Body = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/FirstFight/Reaper/Mesh/Reaper.Reaper"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Mesh->SetStaticMesh(Body);
		Mesh->SetRelativeRotation(FRotator::ZeroRotator);
		Mesh->SetRelativeScale3D(FVector::OneVector);
		if (Mesh->DoesSocketExist(EngineSocket))
		{
			EngineHalo->SetRelativeLocation(Mesh->GetSocketTransform(EngineSocket, RTS_Actor).GetLocation());
		}
	}
	const int32 Seam = Mesh->GetMaterialIndex(SeamSlot);
	if (Seam != INDEX_NONE)
	{
		SeamGlow = Mesh->CreateDynamicMaterialInstance(Seam);
	}
	const int32 Engine = Mesh->GetMaterialIndex(EngineSlot);
	if (Engine != INDEX_NONE)
	{
		EngineGlow = Mesh->CreateDynamicMaterialInstance(Engine);
	}
	for (int32 I = 1; I <= 16; ++I)
	{
		const FString Path = FString::Printf(TEXT("/Game/FirstFight/Reaper/Debris/Debris_%02d.Debris_%02d"), I, I);
		if (UStaticMesh* Piece = LoadObject<UStaticMesh>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet))
		{
			Debris.Add(Piece);
		}
	}
	Health->Restore();
	Health->OnHit.AddUObject(this, &ARewildReaper::HandleHit);
	Health->OnDeath.AddUObject(this, &ARewildReaper::Die);
}

void ARewildReaper::StartAt(const FVector& Location, const FRotator& Facing)
{
	SetActorLocationAndRotation(Location, Facing);
	Velocity = Facing.Vector() * CruiseSpeed * M;
}

void ARewildReaper::SetTactic(ERewildTactic InTactic, float InSide)
{
	if (InTactic == Tactic && InSide == Side)
	{
		return;
	}
	Tactic = InTactic;
	Side = InSide;
	TacticTime = 0.f;
	bArrived = false;
	JinkSwitch = 0.f;
}

bool ARewildReaper::IsAlive() const
{
	return !Health->IsDead() && !IsActorBeingDestroyed();
}

void ARewildReaper::StartManoeuvre(EManoeuvre Kind, const FVector& Dir, float Seconds)
{
	Manoeuvre = Kind;
	ManoeuvreDir = Dir.GetSafeNormal();
	ManoeuvreLeft = Seconds;
	JinkSwitch = 0.f;
}

void ARewildReaper::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (Health->IsDead())
	{
		return;
	}
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	Clock += Dt;
	TacticTime += Dt;
	HitFlash = FMath::Max(0.f, HitFlash - Dt * 3.f);

	APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (Player)
	{
		// What it believes the player is doing lags the truth by about 0.25 s, so only hard jinks throw its aim.
		PlayerVelocitySeen = FMath::Lerp(PlayerVelocitySeen, Player->GetVelocity(), 1.f - FMath::Exp(-4.f * Dt));
	}
	Defend(Dt, Player);
	FVector Dir;
	float Speed;
	Think(Dt, Dir, Speed);
	Steer(Dir, Speed, Dt);
	if (PlayerAlive(Player))
	{
		TickGuns(Dt, Player);
		TickMissile(Dt, Player);
	}

	if (SeamGlow)
	{
		// The ore in its seams runs hotter as it is hurt, and flares at each hit.
		const float Hurt = 1.f - Health->GetHullFraction();
		const float Flicker = Hurt > 0.5f ? FMath::FRandRange(0.8f, 1.2f) : 1.f;
		SeamGlow->SetScalarParameterValue(TEXT("Glow"), (1.f + 3.f * Hurt + 3.f * HitFlash) * Flicker);
	}
	if (EngineGlow)
	{
		EngineGlow->SetScalarParameterValue(TEXT("Glow"), bBoosting ? 1.7f : 1.f);
	}
	UpdateHalo();
}

void ARewildReaper::UpdateHalo()
{
	const APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(this, 0);
	if (!Cam)
	{
		return;
	}
	const FVector At = EngineHalo->GetComponentLocation();
	const FVector ToCam = Cam->GetCameraLocation() - At;
	const float Metres = ToCam.Size() / 100.f;
	// Seen from behind only (the hull hides the furnace from in front), 1.6 m across close in and never under about
	// three pixels far out, a little bigger on boost.
	const float Behind = FMath::Clamp(FVector::DotProduct(ToCam.GetSafeNormal(), -GetActorForwardVector()) * 2.5f + 0.2f, 0.f, 1.f);
	const float Size = FMath::Max(160.f, Metres * 0.3f) * (bBoosting ? 1.3f : 1.f) * Behind;
	EngineHalo->SetWorldScale3D(FVector(Size / 100.f));
	EngineHalo->SetVisibility(Size > 1.f);
}

void ARewildReaper::Think(float Dt, FVector& OutDir, float& OutSpeed)
{
	const FVector Here = GetActorLocation();
	const FVector Fwd = GetActorForwardVector();
	OutDir = Fwd;
	OutSpeed = CruiseSpeed;
	bBoosting = false;

	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerAlive(Player))
	{
		OutDir = (Fwd + GetActorRightVector() * 0.15f).GetSafeNormal();  // nobody to fight: a slow wide circle
		return;
	}
	const FVector P = Player->GetActorLocation();
	const FVector PF = Player->GetActorForwardVector();
	const FVector PR = Player->GetActorRightVector();
	const FVector PU = Player->GetActorUpVector();
	const FVector To = P - Here;
	const float Dist = To.Size();
	const FVector ToN = To / FMath::Max(Dist, 1.f);

	auto Jink = [&]()
	{
		JinkSwitch -= Dt;
		if (JinkSwitch <= 0.f)
		{
			// a new hard turn every half second or so, away from the player's nose
			const FVector Across = FVector::CrossProduct(Fwd, FMath::VRand()).GetSafeNormal();
			ManoeuvreDir = (Fwd + Across * FMath::FRandRange(0.6f, 1.2f) - ToN * 0.4f).GetSafeNormal();
			JinkSwitch = FMath::FRandRange(0.5f, 1.1f);
		}
		OutDir = ManoeuvreDir;
	};

	// Never ram the player: break off close in.
	if (Dist < 120.f * M && FVector::DotProduct(Fwd, ToN) > 0.f && Manoeuvre != EManoeuvre::Break)
	{
		StartManoeuvre(EManoeuvre::Break, FVector::CrossProduct(ToN, FMath::VRand()), FMath::FRandRange(1.3f, 2.1f));
	}
	// The player's guns on it, close: jink.
	if (Manoeuvre == EManoeuvre::None && Tactic != ERewildTactic::Bait && Dist < 900.f * M && AngleDeg(PF, -To) < 12.f
		&& FMath::FRand() < Dt * 1.5f)
	{
		StartManoeuvre(EManoeuvre::Jink, Fwd, FMath::FRandRange(1.5f, 2.5f));
	}

	if (Manoeuvre != EManoeuvre::None)
	{
		ManoeuvreLeft -= Dt;
		switch (Manoeuvre)
		{
		case EManoeuvre::Break:
			OutDir = ManoeuvreDir;
			break;
		case EManoeuvre::Extend:
			OutDir = ManoeuvreDir;
			OutSpeed = BoostSpeed;
			bBoosting = true;
			break;
		default:
			Jink();
			OutSpeed = BoostSpeed;
			bBoosting = true;
			break;
		}
		if (ManoeuvreLeft <= 0.f)
		{
			if (Manoeuvre == EManoeuvre::Break)
			{
				StartManoeuvre(EManoeuvre::Extend, Fwd - ToN * 0.5f, FMath::FRandRange(1.5f, 2.8f));  // run out, then come back
			}
			else
			{
				Manoeuvre = EManoeuvre::None;
			}
		}
	}
	else
	{
		switch (Tactic)
		{
		case ERewildTactic::Engage:
		{
			// Fly at where the slugs will meet the player.
			float T = 0.f;
			const FVector Rel = PlayerVelocitySeen - Velocity;
			OutDir = SolveLead(To, Rel, SlagSpeed * M, T) ? (To + Rel * T).GetSafeNormal() : ToN;
			if (Dist > 1500.f * M)
			{
				OutSpeed = BoostSpeed;
				bBoosting = true;
			}
			else if (Dist < 500.f * M)
			{
				OutSpeed = FMath::Max(Player->GetVelocity().Size() / M + 15.f, 150.f);  // sit on the player's tail
			}
			// It overshot: the player is behind it and close. Break off.
			if (FVector::DotProduct(Fwd, ToN) < -0.2f && Dist < 400.f * M)
			{
				StartManoeuvre(EManoeuvre::Break, FVector::CrossProduct(ToN, GetActorUpVector()) * (FMath::RandBool() ? 1.f : -1.f), 1.5f);
			}
			break;
		}
		case ERewildTactic::Flank:
		case ERewildTactic::Pincer:
		{
			const FVector Slot = Tactic == ERewildTactic::Flank
				? P + PR * Side * 800.f * M + PF * 250.f * M + PU * Side * 120.f * M  // wide on one side, a little ahead
				: P - PF * 650.f * M + PR * Side * 250.f * M;                        // on the player's tail
			OutDir = (Slot + Player->GetVelocity() * 1.f - Here).GetSafeNormal();  // aim where the place will be
			OutSpeed = BoostSpeed;
			bBoosting = true;
			if (FVector::Dist(Here, Slot) < 300.f * M || TacticTime > 9.f)
			{
				bArrived = true;
			}
			break;
		}
		case ERewildTactic::Bait:
			Jink();
			if (Dist < 800.f * M)
			{
				OutSpeed = BoostSpeed;
				bBoosting = true;
			}
			break;
		}
	}

	// Keep clear of packmates.
	for (TActorIterator<ARewildReaper> It(GetWorld()); It; ++It)
	{
		if (*It == this || !It->IsAlive())
		{
			continue;
		}
		const FVector Away = Here - It->GetActorLocation();
		const float D = Away.Size();
		if (D < 80.f * M)
		{
			OutDir += Away / FMath::Max(D, 1.f) * (1.f - D / (80.f * M)) * 1.5f;
		}
	}
	OutDir = OutDir.GetSafeNormal(UE_SMALL_NUMBER, Fwd);
}

void ARewildReaper::Steer(const FVector& Dir, float Speed, float Dt)
{
	const FVector Local = GetActorTransform().InverseTransformVectorNoScale(Dir);
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
			// Bank so the goal sits above the canopy, then pull: the way fighters turn.
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
	// The stick moves at a hand's pace, never instantly: turns start and end smoothly.
	const float Step = 6.f * Dt;
	PitchIn += FMath::Clamp(WantPitch - PitchIn, -Step, Step);
	YawIn += FMath::Clamp(WantYaw - YawIn, -Step, Step);
	RollIn += FMath::Clamp(WantRoll - RollIn, -Step, Step);
	SetActorRotation(GetActorQuat() * FQuat(FRotator(PitchIn * PitchRate * Dt, YawIn * YawRate * Dt, RollIn * RollRate * Dt)));

	// Flight assist, as the player's: velocity swings round to the nose.
	Velocity += (GetActorForwardVector() * Speed * M - Velocity) * (1.f - FMath::Exp(-Assist * Dt));
	AddActorWorldOffset(Velocity * Dt);
}

void ARewildReaper::TickGuns(float Dt, const AActor* Player)
{
	GunCooldown -= Dt;
	auto Hold = [this]() { GunCooldown = FMath::Max(GunCooldown, 0.f); };
	if (Tactic == ERewildTactic::Bait || Manoeuvre == EManoeuvre::Break || Manoeuvre == EManoeuvre::Extend)
	{
		BurstLeft = 0.f;
		return Hold();
	}
	if (BurstPause > 0.f)
	{
		BurstPause -= Dt;
		return Hold();
	}
	const FVector Here = GetActorLocation();
	const FVector To = Player->GetActorLocation() - Here;
	const FVector Rel = PlayerVelocitySeen - Velocity;
	float T = 0.f;
	if (To.Size() > GunRange * M || !SolveLead(To, Rel, SlagSpeed * M, T))
	{
		return Hold();
	}
	const FVector Aim = (To + Rel * T).GetSafeNormal();
	const FVector Fwd = GetActorForwardVector();
	if (AngleDeg(Fwd, Aim) > 2.5f)
	{
		return Hold();
	}
	if (BurstLeft <= 0.f)
	{
		BurstLeft = FMath::FRandRange(0.7f, 1.2f);
	}
	BurstLeft -= Dt;
	if (BurstLeft <= 0.f)
	{
		BurstPause = FMath::FRandRange(0.5f, 1.2f);
	}
	URewildBolts* Bolts = GetWorld()->GetSubsystem<URewildBolts>();
	while (GunCooldown <= 0.f && Bolts)
	{
		GunCooldown += 1.f / SlagRate;
		const FName Socket = bRightGun ? GunR : GunL;
		bRightGun = !bRightGun;
		const FVector Muzzle = Mesh->DoesSocketExist(Socket) ? Mesh->GetSocketLocation(Socket) : Here + Fwd * 600.f;
		// the guns swivel in the jaws onto the lead (from what it saw of the player 0.4 s ago); 5% hit when they
		// only swivelled halfway, 9 Nov 2026
		const FVector Dir = FMath::VRandCone((Fwd * 0.15f + Aim * 0.85f).GetSafeNormal(), FMath::DegreesToRadians(0.45f));
		Bolts->Fire(this, ERewildBoltKind::Slag, Health->Team, Muzzle, Dir * SlagSpeed * M + Velocity, SlagDamage);
		++SlugsFired;
	}
}

void ARewildReaper::TickMissile(float Dt, AActor* Player)
{
	URewildMissiles* Missiles = GetWorld()->GetSubsystem<URewildMissiles>();
	if (!bHasMissile)
	{
		MissileReload -= Dt;
		bHasMissile = MissileReload <= 0.f;
	}
	const FVector To = Player->GetActorLocation() - GetActorLocation();
	const float Dist = To.Size();
	const bool bCan = Missiles && bHasMissile && bMissileAllowed && Tactic != ERewildTactic::Bait
		&& Manoeuvre != EManoeuvre::Break && Manoeuvre != EManoeuvre::Extend
		&& Dist > MissileRangeMin && Dist < MissileRangeMax && AngleDeg(GetActorForwardVector(), To) < LockCone;
	if (!bCan)
	{
		LockTime = FMath::Max(0.f, LockTime - Dt * 1.5f);
		if (Missiles && LockTime > 0.f)
		{
			Missiles->ReportLock(this, Player, LockTime / LockNeeded);
		}
		return;
	}
	LockTime += Dt;
	Missiles->ReportLock(this, Player, FMath::Min(LockTime / LockNeeded, 1.f));
	if (LockTime >= LockNeeded)
	{
		const FVector From = Mesh->DoesSocketExist(MissileSocket) ? Mesh->GetSocketLocation(MissileSocket) : GetActorLocation() - GetActorUpVector() * 150.f;
		Missiles->Launch(this, ERewildMissileKind::Harrow, Health->Team, From, GetActorQuat(), Velocity, Player);
		bHasMissile = false;
		MissileReload = MissileReloadTime;
		LockTime = 0.f;
	}
}

void ARewildReaper::Defend(float Dt, const AActor* Player)
{
	DefendCooldown -= Dt;
	URewildMissiles* Missiles = GetWorld()->GetSubsystem<URewildMissiles>();
	if (!Missiles || DefendCooldown > 0.f)
	{
		return;
	}
	TArray<URewildMissiles::FThreat> Threats;
	Missiles->GetThreats(this, Threats);
	const URewildMissiles::FThreat* Nearest = nullptr;
	for (const URewildMissiles::FThreat& T : Threats)
	{
		if (!Nearest || T.Seconds < Nearest->Seconds)
		{
			Nearest = &T;
		}
	}
	if (Nearest && Nearest->Seconds < 2.6f)
	{
		DefendCooldown = 3.f;
		if (FlaresLeft > 0 && FMath::FRand() < 0.75f)
		{
			Missiles->DropFlares(this, Health->Team, GetActorLocation(), GetActorQuat(), Velocity, 3);
			FlaresLeft -= 3;
		}
		// Turn across the missile's path (beam it): it has to turn hardest to follow. Most get it right.
		if (FMath::FRand() < 0.85f)
		{
			const FVector LOS = (GetActorLocation() - Nearest->Position).GetSafeNormal();
			FVector Beam = FVector::CrossProduct(LOS, GetActorUpVector()).GetSafeNormal();
			if (FVector::DotProduct(Beam, GetActorForwardVector()) < 0.f)
			{
				Beam = -Beam;
			}
			StartManoeuvre(EManoeuvre::Break, Beam, 2.f);
		}
		return;
	}
	// The player locking on: it may start jinking early.
	if (Player && Manoeuvre == EManoeuvre::None && Missiles->GetLockOn(this) > 0.5f)
	{
		DefendCooldown = 1.5f;
		if (FMath::FRand() < 0.35f)
		{
			StartManoeuvre(EManoeuvre::Jink, GetActorForwardVector(), 1.8f);
		}
	}
}

void ARewildReaper::HandleHit(const FVector& Point, bool bOnShield)
{
	HitFlash = 1.f;
}

void ARewildReaper::Die()
{
	TArray<UStaticMesh*> Pieces;
	for (UStaticMesh* P : Debris)
	{
		Pieces.Add(P);
	}
	ARewildExplosion::Spawn(GetWorld(), GetActorLocation(), Velocity, 2.4f, Pieces, Mesh->GetComponentQuat());
	Mesh->SetVisibility(false);
	EngineHalo->SetVisibility(false);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	SetActorTickEnabled(false);
	SetLifeSpan(1.f);
}

ARewildHarrowWave::ARewildHarrowWave()
{
	PrimaryActorTick.bCanEverTick = true;
	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
}

void ARewildHarrowWave::BeginPlay()
{
	Super::BeginPlay();
	const TCHAR* Cmd = FCommandLine::Get();
	if (FParse::Param(Cmd, TEXT("RewildDemo")) || FParse::Param(Cmd, TEXT("RewildHarrow")))
	{
		StartDelay = 1.5f;
	}
	NextPackIn = StartDelay;
}

int32 ARewildHarrowWave::NumAlive() const
{
	int32 N = 0;
	for (const TWeakObjectPtr<ARewildReaper>& R : Pack)
	{
		N += R.IsValid() && R->IsAlive() ? 1 : 0;
	}
	return N;
}

void ARewildHarrowWave::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	Clock += Dt;
	Pack.RemoveAll([](const TWeakObjectPtr<ARewildReaper>& R) { return !R.IsValid() || !R->IsAlive(); });
	if (Pack.Num() == 0)
	{
		NextPackIn -= Dt;
		if (NextPackIn <= 0.f && PlayerAlive(UGameplayStatics::GetPlayerPawn(this, 0)))
		{
			SpawnPack(FMath::Min(3 + PacksSent, 5));
			++PacksSent;
			bStarted = true;
			NextPackIn = PackGap;
			ThinkIn = 0.f;
		}
		return;
	}
	ThinkIn -= Dt;
	if (ThinkIn <= 0.f)
	{
		ThinkIn = 0.4f;
		Coordinate();
	}
}

void ARewildHarrowWave::SpawnPack(int32 Size)
{
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	const FVector P = Player->GetActorLocation();
	const FVector F = Player->GetActorForwardVector();
	const FVector R = Player->GetActorRightVector();
	const FVector U = Player->GetActorUpVector();
	// From ahead, a little off to one side, 3.5 km out, in a loose vee.
	const FVector Centre = P + F * 3500.f * M + R * FMath::FRandRange(-900.f, 900.f) * M + U * FMath::FRandRange(-300.f, 300.f) * M;
	const FRotator Facing = (P - Centre).Rotation();
	const FVector VF = Facing.Vector();
	const FVector VR = FRotationMatrix(Facing).GetUnitAxis(EAxis::Y);
	FActorSpawnParameters Spawn;
	Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	for (int32 I = 0; I < Size; ++I)
	{
		const int32 Rank = (I + 1) / 2;
		const float SideSign = I == 0 ? 0.f : (I % 2 == 1 ? -1.f : 1.f);
		const FVector Where = Centre + VR * SideSign * 120.f * M * Rank - VF * 80.f * M * Rank;
		if (ARewildReaper* Reaper = GetWorld()->SpawnActor<ARewildReaper>(Where, Facing, Spawn))
		{
			Reaper->StartAt(Where, Facing);
			// The leader comes straight in; the rest swing wide to the sides.
			Reaper->SetTactic(I == 0 ? ERewildTactic::Engage : ERewildTactic::Flank, I == 0 ? 1.f : SideSign);
			Pack.Add(Reaper);
		}
	}
	UE_LOG(LogTemp, Display, TEXT("[rewild] Harrow pack of %d, 3.5 km ahead"), Size);
}

void ARewildHarrowWave::Coordinate()
{
	const ARewildFighter* Fighter = Cast<ARewildFighter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Fighter || Fighter->IsDead())
	{
		return;
	}
	const FVector P = Fighter->GetActorLocation();
	const FVector PF = Fighter->GetActorForwardVector();

	// The one the player is chasing becomes the bait.
	ARewildReaper* Bait = nullptr;
	if (AActor* T = Fighter->GetTarget())
	{
		const FVector To = T->GetActorLocation() - P;
		if (To.Size() < 1300.f * M && AngleDeg(PF, To) < 20.f)
		{
			for (const TWeakObjectPtr<ARewildReaper>& R : Pack)
			{
				if (R.Get() == T)
				{
					Bait = R.Get();
				}
			}
		}
	}
	if (Pack.Num() < 2)
	{
		Bait = nullptr;  // alone, it just fights
	}

	float NextSide = 1.f;
	for (const TWeakObjectPtr<ARewildReaper>& W : Pack)
	{
		ARewildReaper* R = W.Get();
		if (R == Bait)
		{
			R->SetTactic(ERewildTactic::Bait);
			continue;
		}
		switch (R->GetTactic())
		{
		case ERewildTactic::Bait:
			R->SetTactic(ERewildTactic::Engage);  // no longer chased
			break;
		case ERewildTactic::Flank:
		case ERewildTactic::Pincer:
			if (R->HasArrived())
			{
				R->SetTactic(ERewildTactic::Engage);  // in place: turn in
			}
			break;
		case ERewildTactic::Engage:
		{
			// While the player chases the bait, the others close on the player's tail (unless already behind them).
			const FVector From = R->GetActorLocation() - P;
			if (Bait && FVector::DotProduct(PF, From.GetSafeNormal()) > -0.3f)
			{
				R->SetTactic(ERewildTactic::Pincer, NextSide);
				NextSide = -NextSide;
			}
			break;
		}
		}
	}

	// Keep them moving: now and then one swings wide again.
	ReflankIn -= 0.4f;
	if (ReflankIn <= 0.f && !Bait && Pack.Num() >= 2)
	{
		ReflankIn = FMath::FRandRange(9.f, 15.f);
		ARewildReaper* R = Pack[FMath::RandRange(0, Pack.Num() - 1)].Get();
		if (R && R->GetTactic() == ERewildTactic::Engage && FVector::Dist(R->GetActorLocation(), P) > 600.f * M)
		{
			R->SetTactic(ERewildTactic::Flank, FMath::RandBool() ? 1.f : -1.f);
		}
	}

	// Missiles: one Reaper at a time locks on, only when no Harrow missile is flying, and 3 s after one.
	URewildMissiles* Missiles = GetWorld()->GetSubsystem<URewildMissiles>();
	const bool bFlying = Missiles && Missiles->NumInFlight(1) > 0;
	if (bWasMissileFlying && !bFlying)
	{
		MissileGap = 3.f;
	}
	bWasMissileFlying = bFlying;
	MissileGap -= 0.4f;
	ARewildReaper* L = Locker.Get();
	if (!L || !L->IsAlive() || !L->HasMissile())
	{
		L = nullptr;
		float Best = 180.f;
		for (const TWeakObjectPtr<ARewildReaper>& W : Pack)
		{
			const float A = AngleDeg(W->GetActorForwardVector(), P - W->GetActorLocation());
			if (W->HasMissile() && A < Best)
			{
				Best = A;
				L = W.Get();
			}
		}
		Locker = L;
	}
	for (const TWeakObjectPtr<ARewildReaper>& W : Pack)
	{
		W->SetMissileAllowed(W.Get() == L && !bFlying && MissileGap <= 0.f);
	}
}
