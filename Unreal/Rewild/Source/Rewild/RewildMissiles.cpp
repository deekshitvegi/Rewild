#include "RewildMissiles.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "RewildExplosion.h"
#include "RewildHealthComponent.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	// Figures per kind, in cm and seconds. The player's missile (Haven-built, 2.8 m long) has a rocket
	// pushing about 33 g; the Harrow's is a little slower and turns a little less hard, so only a well-timed break
	// beats it, and each flare fools it one time in four (the game is meant to be hard: owner, 9 Nov 2026).
	struct FFigures
	{
		float Drop;         // seconds falling clear before the motor lights
		float Thrust;       // cm/s2 along the nose while burning
		float Burn;         // seconds of motor
		float Life;         // seconds before it self-destructs
		float MaxTurn;      // cm/s2 of sideways push from steering
		float Seeker;       // degrees off the nose it can still see its target
		float Fuse;         // cm: proximity fuse
		float Damage;       // at the centre of the blast
		float Decoy;        // chance that each hot flare it sees takes it away
		float Length;       // cm, nose to nozzle
		float PlumeLength;  // cm
		float PlumeWidth;   // cm across the flame's open end (it widens from the nozzle, as exhaust does in vacuum)
		float GlowSize;     // cm: the white-hot point at the nozzle
	};
	const FFigures RewildFigures{0.35f, 32000.f, 3.2f, 9.f, 38000.f, 55.f, 900.f, 140.f, 0.3f, 280.f, 450.f, 150.f, 70.f};
	const FFigures HarrowFigures{0.25f, 26000.f, 3.8f, 9.f, 34000.f, 50.f, 1200.f, 90.f, 0.25f, 260.f, 400.f, 170.f, 90.f};
	const FFigures& Figures(ERewildMissileKind Kind) { return Kind == ERewildMissileKind::Rewild ? RewildFigures : HarrowFigures; }

	constexpr float BlastRadius = 3000.f;   // 30 m
	constexpr float FlareLife = 3.f;
	constexpr float FlareHot = 2.2f;        // seconds a flare burns hot enough to fool a seeker
	constexpr float DecoyRange = 200000.f;  // 2 km
	constexpr float DecoyCone = 30.f;       // degrees off the missile's nose
	constexpr float PuffEvery = 0.035f;     // seconds between stretches of smoke trail
	constexpr float MinWidthPerMetre = 0.25f;  // cm of width per metre of distance: about 2 pixels at 1080 lines
	constexpr float Navigation = 4.f;       // proportional navigation constant
	constexpr int32 MaxPuffs = 3000;

	UInstancedStaticMeshComponent* MakeLayer(AActor* Owner, const TCHAR* Name, UStaticMesh* Mesh, UMaterialInterface* Material)
	{
		UInstancedStaticMeshComponent* C = Owner->CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		C->SetStaticMesh(Mesh);
		if (Material)
		{
			C->SetMaterial(0, Material);
		}
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetCastShadow(false);
		C->SetUsingAbsoluteLocation(true);
		C->SetUsingAbsoluteRotation(true);
		C->SetUsingAbsoluteScale(true);
		C->SetupAttachment(Owner->GetRootComponent());
		return C;
	}

	/** Closest approach of two points each moving in a straight line over one step (A0->A1, B0->B1). */
	float ClosestApproach(const FVector& A0, const FVector& A1, const FVector& B0, const FVector& B1, float& OutT)
	{
		const FVector D0 = A0 - B0;
		const FVector DV = (A1 - A0) - (B1 - B0);
		const float VV = DV.SizeSquared();
		OutT = VV > 1e-6f ? FMath::Clamp(-FVector::DotProduct(D0, DV) / VV, 0.f, 1.f) : 0.f;
		return (D0 + DV * OutT).Size();
	}

	bool IsAliveTarget(const AActor* A)
	{
		if (!A || A->IsHidden())
		{
			return false;
		}
		const URewildHealthComponent* H = A->FindComponentByClass<URewildHealthComponent>();
		return !H || !H->IsDead();
	}
}

ARewildMissileRenderer::ARewildMissileRenderer()
{
	static ConstructorHelpers::FObjectFinder<UStaticMesh> CylinderMesh(TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> ConeMesh(TEXT("/Engine/BasicShapes/Cone.Cone"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> SphereMesh(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	static ConstructorHelpers::FObjectFinder<UStaticMesh> PlaneMesh(TEXT("/Engine/BasicShapes/Plane.Plane"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> PlumeRewildMat(TEXT("/Game/FirstFight/FX/MI_FX_PlumeRewild.MI_FX_PlumeRewild"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> PlumeHarrowMat(TEXT("/Game/FirstFight/FX/MI_FX_PlumeHarrow.MI_FX_PlumeHarrow"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> NozzleRewildMat(TEXT("/Game/FirstFight/FX/MI_FX_NozzleRewild.MI_FX_NozzleRewild"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> NozzleHarrowMat(TEXT("/Game/FirstFight/FX/MI_FX_NozzleHarrow.MI_FX_NozzleHarrow"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> FlareMat(TEXT("/Game/FirstFight/FX/MI_FX_FlarePoint.MI_FX_FlarePoint"));
	static ConstructorHelpers::FObjectFinder<UMaterialInterface> SmokeMat(TEXT("/Game/FirstFight/FX/M_FX_Smoke.M_FX_Smoke"));

	SetRootComponent(CreateDefaultSubobject<USceneComponent>(TEXT("Root")));
	Cylinder = CylinderMesh.Object;
	// The flames are cones, point at the nozzle (a cylinder of flame read as a glowing rod, 9 Nov 2026).
	PlumeRewild = MakeLayer(this, TEXT("PlumeRewild"), ConeMesh.Object, PlumeRewildMat.Object);
	PlumeHarrow = MakeLayer(this, TEXT("PlumeHarrow"), ConeMesh.Object, PlumeHarrowMat.Object);
	GlowRewild = MakeLayer(this, TEXT("GlowRewild"), SphereMesh.Object, NozzleRewildMat.Object);
	GlowHarrow = MakeLayer(this, TEXT("GlowHarrow"), SphereMesh.Object, NozzleHarrowMat.Object);
	Flares = MakeLayer(this, TEXT("Flares"), SphereMesh.Object, FlareMat.Object);
	// Smoke is ribbons: each stretch a soft-edged strip turned to face the camera (stretched spheres faded at
	// their ends and read as a string of beads, 9 Nov 2026).
	Smoke = MakeLayer(this, TEXT("Smoke"), PlaneMesh.Object, SmokeMat.Object);
	Smoke->NumCustomDataFloats = 1;  // opacity, faded as the smoke spreads
}

UStaticMeshComponent* ARewildMissileRenderer::Body(int32 Index, ERewildMissileKind Kind)
{
	static bool bTried = false;  // the models are optional until imported (art/missile)
	if (!bTried)
	{
		bTried = true;
		RewildMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/FirstFight/Missile/Mesh/Missile_Rewild.Missile_Rewild"), nullptr, LOAD_NoWarn | LOAD_Quiet);
		HarrowMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Game/FirstFight/Missile/Mesh/Missile_Harrow.Missile_Harrow"), nullptr, LOAD_NoWarn | LOAD_Quiet);
	}
	while (Bodies.Num() <= Index)
	{
		UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
		C->SetUsingAbsoluteLocation(true);
		C->SetUsingAbsoluteRotation(true);
		C->SetUsingAbsoluteScale(true);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetupAttachment(GetRootComponent());
		C->RegisterComponent();
		Bodies.Add(C);
	}
	UStaticMeshComponent* C = Bodies[Index];
	UStaticMesh* Want = Kind == ERewildMissileKind::Rewild ? RewildMesh.Get() : HarrowMesh.Get();
	if (!Want)
	{
		Want = Cylinder;
	}
	if (C->GetStaticMesh() != Want)
	{
		C->SetStaticMesh(Want);
	}
	C->SetVisibility(true);
	return C;
}

void ARewildMissileRenderer::HideBodiesFrom(int32 Count)
{
	for (int32 I = Count; I < Bodies.Num(); ++I)
	{
		Bodies[I]->SetVisibility(false);
	}
}

void URewildMissiles::Launch(AActor* Shooter, ERewildMissileKind Kind, int32 Team, const FVector& From, const FQuat& Rotation,
	const FVector& ShooterVelocity, AActor* Target)
{
	FMissile M;
	M.Position = From;
	M.Rotation = Rotation;
	M.Velocity = ShooterVelocity - Rotation.GetUpVector() * 600.f;  // pushed down off the rail at 6 m/s
	M.Kind = Kind;
	M.Team = Team;
	M.Shooter = Shooter;
	M.Target = Target;
	M.PuffClock = -1.f;  // no smoke until the motor lights
	Missiles.Add(MoveTemp(M));
}

void URewildMissiles::DropFlares(AActor* Owner, int32 Team, const FVector& From, const FQuat& Rotation, const FVector& OwnerVelocity, int32 Count)
{
	for (int32 I = 0; I < Count; ++I)
	{
		// thrown out to alternate sides at about wing level, drifting back slowly, so a salvo fans out beside the
		// ship where the chase camera sees it (thrown back or down they left the frame: the camera sits above and
		// behind, and its view reaches only 21 degrees below the middle, 9 Nov 2026)
		const float Side = (I % 2 == 0 ? 1.f : -1.f) * FMath::FRandRange(0.6f, 1.f);
		const FVector Local(-FMath::FRandRange(200.f, 600.f), Side * FMath::FRandRange(400.f, 900.f), FMath::FRandRange(-100.f, 300.f));
		const FVector Start = From + Rotation.RotateVector(FVector(-400.f, 0.f, -100.f));
		Flares.Add({NextFlareId++, Start, OwnerVelocity + Rotation.RotateVector(Local), -0.06f * I, Team, Start, 0.f, FMath::FRand()});
	}
}

void URewildMissiles::ReportLock(AActor* Shooter, AActor* Victim, float Progress)
{
	for (FLock& L : Locks)
	{
		if (L.Shooter.Get() == Shooter && L.Victim.Get() == Victim)
		{
			L.Progress = Progress;
			L.Time = Clock;
			return;
		}
	}
	Locks.Add({Shooter, Victim, Progress, Clock});
}

float URewildMissiles::GetLockOn(const AActor* Victim, FVector* OutFrom) const
{
	float Best = 0.f;
	for (const FLock& L : Locks)
	{
		if (L.Victim.Get() == Victim && L.Progress > Best && L.Shooter.IsValid())
		{
			Best = L.Progress;
			if (OutFrom)
			{
				*OutFrom = L.Shooter->GetActorLocation();
			}
		}
	}
	return Best;
}

void URewildMissiles::GetThreats(const AActor* Victim, TArray<FThreat>& Out) const
{
	for (const FMissile& M : Missiles)
	{
		if (M.Target.Get() != Victim || M.bLost || M.FlareTarget)
		{
			continue;
		}
		const FVector R = Victim->GetActorLocation() - M.Position;
		const float Closing = FMath::Max(float(FVector::DotProduct(M.Velocity - Victim->GetVelocity(), R.GetSafeNormal())), 10000.f);
		Out.Add({M.Position, M.Velocity, float(R.Size()) / Closing});
	}
}

int32 URewildMissiles::NumInFlight(int32 Team) const
{
	int32 N = 0;
	for (const FMissile& M : Missiles)
	{
		N += M.Team == Team ? 1 : 0;
	}
	return N;
}

const URewildMissiles::FFlare* URewildMissiles::FindFlare(int32 Id) const
{
	for (const FFlare& F : Flares)
	{
		if (F.Id == Id)
		{
			return &F;
		}
	}
	return nullptr;
}

void URewildMissiles::AddPuff(const FVector& A, const FVector& B, const FVector& Drift, float Life, float Width0, float Width1, float Opacity)
{
	if (Puffs.Num() < MaxPuffs)
	{
		Puffs.Add({A, B, Drift, 0.f, Life, Width0, Width1, Opacity});
	}
}

void URewildMissiles::Guide(FMissile& M, float Dt)
{
	const FFigures& Fig = Figures(M.Kind);
	if (M.Age < Fig.Drop)
	{
		return;  // falling clear of the launcher: no steering, no thrust
	}
	const FVector Nose = M.Rotation.GetForwardVector();

	// A hot flare in the seeker's view may take it away, once per flare.
	if (!M.FlareTarget && !M.bLost && M.Target.IsValid())
	{
		for (const FFlare& F : Flares)
		{
			if (F.Team == M.Team || F.Age < 0.f || F.Age > FlareHot || M.FlaresSeen.Contains(F.Id))
			{
				continue;
			}
			const FVector To = F.Position - M.Position;
			const float D = To.Size();
			if (D > DecoyRange)
			{
				continue;
			}
			const float Angle = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(Nose, To / FMath::Max(D, 1.f)), -1.f, 1.f)));
			if (Angle > DecoyCone)
			{
				continue;
			}
			M.FlaresSeen.Add(F.Id);
			if (FMath::FRand() < Fig.Decoy)
			{
				M.FlareTarget = F.Id;
				break;
			}
		}
	}

	FVector TargetPos, TargetVel;
	bool bAim = false;
	if (M.FlareTarget)
	{
		if (const FFlare* F = FindFlare(M.FlareTarget))
		{
			TargetPos = F->Position;
			TargetVel = F->Velocity;
			bAim = true;
		}
	}
	else if (!M.bLost)
	{
		AActor* T = M.Target.Get();
		if (IsAliveTarget(T))
		{
			TargetPos = T->GetActorLocation();
			TargetVel = T->GetVelocity();
			bAim = true;
		}
		else if (T)
		{
			M.bLost = true;
		}
	}

	const FVector VDir = M.Velocity.GetSafeNormal();
	FVector Accel = FVector::ZeroVector;
	if (bAim)
	{
		const FVector R = TargetPos - M.Position;
		const float Range = FMath::Max(R.Size(), 1.f);
		const FVector LOS = R / Range;
		const float OffNose = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(FVector::DotProduct(Nose, LOS), -1.f, 1.f)));
		if (OffNose > Fig.Seeker)
		{
			M.bLost = true;  // it can no longer see the target: it flies on blind
		}
		else
		{
			// Proportional navigation: push across the line of sight in proportion to how fast it swings.
			const FVector Vr = TargetVel - M.Velocity;
			const FVector Omega = FVector::CrossProduct(R, Vr) / FMath::Max(R.SizeSquared(), 1.f);
			const float Closing = FMath::Max(-FVector::DotProduct(LOS, Vr), 20000.f);
			Accel = Navigation * Closing * FVector::CrossProduct(Omega, LOS);
			// and a little pursuit, so it swings round early after launch
			Accel += (LOS - VDir * FVector::DotProduct(LOS, VDir)) * 6000.f;
		}
	}
	const bool bBurning = M.Age < Fig.Drop + Fig.Burn;
	Accel -= VDir * FVector::DotProduct(Accel, VDir);  // steering only pushes sideways
	Accel = Accel.GetClampedToMaxSize(Fig.MaxTurn * (bBurning ? 1.f : 0.6f));  // coasting, only its small thrusters steer
	M.Velocity += Accel * Dt;
	if (bBurning)
	{
		M.Velocity += Nose * Fig.Thrust * Dt;
	}
	M.Rotation = FQuat::Slerp(M.Rotation, FRotationMatrix::MakeFromX(M.Velocity).ToQuat(), 1.f - FMath::Exp(-12.f * Dt));
}

void URewildMissiles::Detonate(const FMissile& M, const FVector& At, bool bOnTarget)
{
	UWorld* World = GetWorld();
	const FFigures& Fig = Figures(M.Kind);
	const AActor* T = M.Target.Get();
	ARewildExplosion::Spawn(World, At, bOnTarget && T ? T->GetVelocity() : M.Velocity * 0.15f, 0.7f);

	TArray<URewildHealthComponent*> Hurt;  // gather first: the damage can destroy things
	URewildHealthComponent::ForEach(World, [&](URewildHealthComponent* H)
	{
		if (H->Team != M.Team && !H->IsDead() && FVector::Dist(H->GetOwner()->GetActorLocation(), At) < BlastRadius)
		{
			Hurt.Add(H);
		}
	});
	for (URewildHealthComponent* H : Hurt)
	{
		const float D = FVector::Dist(H->GetOwner()->GetActorLocation(), At);
		const float Full = Fig.Fuse * 1.5f;
		const float K = D <= Full ? 1.f : FMath::Clamp(1.f - (D - Full) / (BlastRadius - Full), 0.15f, 1.f);
		H->ApplyDamage(Fig.Damage * K, At);
		OnMissileHit.Broadcast(M.Shooter.Get(), H->GetOwner());
	}
}

void URewildMissiles::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}
	const float Dt = FMath::Min(DeltaTime, 0.05f);
	Clock += Dt;
	Locks.RemoveAll([this](const FLock& L) { return Clock - L.Time > 0.2f || !L.Victim.IsValid(); });

	for (int32 I = Flares.Num() - 1; I >= 0; --I)
	{
		FFlare& F = Flares[I];
		F.Age += Dt;
		if (F.Age < 0.f)
		{
			continue;  // not thrown yet (a salvo goes out one by one)
		}
		F.Position += F.Velocity * Dt;
		F.PuffClock += Dt;
		if (F.PuffClock >= 0.05f && F.Age < FlareLife - 0.4f)
		{
			F.PuffClock = 0.f;
			AddPuff(F.LastPuff, F.Position, F.Velocity * 0.1f, 1.4f, 25.f, 260.f, 0.4f);
			F.LastPuff = F.Position;
		}
		if (F.Age >= FlareLife)
		{
			Flares.RemoveAtSwap(I);
		}
	}

	for (int32 I = Missiles.Num() - 1; I >= 0; --I)
	{
		FMissile& M = Missiles[I];
		const FFigures& Fig = Figures(M.Kind);
		M.Age += Dt;
		const FVector Prev = M.Position;

		Guide(M, Dt);
		M.Position += M.Velocity * Dt;

		// Smoke while the motor burns, in stretches from the nozzle.
		const bool bBurning = M.Age >= Fig.Drop && M.Age < Fig.Drop + Fig.Burn;
		const FVector Nozzle = M.Position - M.Rotation.GetForwardVector() * Fig.Length * 0.5f;
		if (bBurning)
		{
			if (M.PuffClock < 0.f)
			{
				M.PuffClock = 0.f;
				M.LastPuff = Nozzle;
			}
			M.PuffClock += Dt;
			if (M.PuffClock >= PuffEvery)
			{
				M.PuffClock -= PuffEvery;
				const bool bOurs = M.Kind == ERewildMissileKind::Rewild;
				AddPuff(M.LastPuff, Nozzle, M.Velocity * 0.04f, bOurs ? 3.2f : 2.6f, bOurs ? 40.f : 55.f, bOurs ? 520.f : 460.f, bOurs ? 0.5f : 0.42f);
				M.LastPuff = Nozzle;
			}
		}

		// The proximity fuse, checked along the whole step (at 1 km/s a missile moves 17 m a frame).
		bool bHasTarget = false;
		FVector T0, T1;
		if (M.FlareTarget)
		{
			if (const FFlare* F = FindFlare(M.FlareTarget))
			{
				T1 = F->Position;
				T0 = T1 - F->Velocity * Dt;
				bHasTarget = true;
			}
			else
			{
				M.FlareTarget = 0;
				M.bLost = true;  // the flare burnt out under it
			}
		}
		else if (!M.bLost && IsAliveTarget(M.Target.Get()))
		{
			T1 = M.Target->GetActorLocation();
			T0 = T1 - M.Target->GetVelocity() * Dt;
			bHasTarget = true;
		}
		if (bHasTarget && M.Age > Fig.Drop)
		{
			float T = 0.f;
			if (ClosestApproach(Prev, M.Position, T0, T1, T) < Fig.Fuse)
			{
				Detonate(M, FMath::Lerp(Prev, M.Position, T), !M.FlareTarget);
				Missiles.RemoveAtSwap(I);
				continue;
			}
		}
		if (M.Age > Fig.Life)
		{
			Detonate(M, M.Position, false);  // self-destruct
			Missiles.RemoveAtSwap(I);
		}
	}

	for (int32 I = Puffs.Num() - 1; I >= 0; --I)
	{
		Puffs[I].Age += Dt;
		if (Puffs[I].Age >= Puffs[I].Life)
		{
			Puffs.RemoveAtSwap(I);
		}
	}
	Draw();
}

void URewildMissiles::Draw()
{
	ARewildMissileRenderer* R = Renderer.Get();
	if (!R)
	{
		if (Missiles.Num() + Flares.Num() + Puffs.Num() == 0)
		{
			return;
		}
		FActorSpawnParameters Spawn;
		Spawn.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		R = GetWorld()->SpawnActor<ARewildMissileRenderer>(FVector::ZeroVector, FRotator::ZeroRotator, Spawn);
		Renderer = R;
		if (!R)
		{
			return;
		}
	}
	FVector Eye = FVector::ZeroVector;
	if (APlayerCameraManager* Cam = UGameplayStatics::GetPlayerCameraManager(GetWorld(), 0))
	{
		Eye = Cam->GetCameraLocation();
	}
	// Never thinner than about two pixels, so far flames and flares do not break up (as the bolts, 8 Nov 2026).
	auto Width = [&Eye](float Cm, const FVector& P) { return FMath::Max(Cm, FVector::Dist(P, Eye) / 100.f * MinWidthPerMetre); };

	TArray<FTransform> PlumeR, PlumeH, GlowR, GlowH, FlarePts, SmokeTs;
	TArray<float> SmokeAlpha;
	int32 Bodies = 0;
	for (const FMissile& M : Missiles)
	{
		const FFigures& Fig = Figures(M.Kind);
		const FVector Fwd = M.Rotation.GetForwardVector();
		UStaticMeshComponent* C = R->Body(Bodies++, M.Kind);
		if (C->GetStaticMesh() == R->Cylinder)
		{
			C->SetWorldTransform(FTransform(FRotationMatrix::MakeFromZ(Fwd).ToQuat(), M.Position, FVector(0.15f, 0.15f, Fig.Length / 100.f)));
		}
		else
		{
			C->SetWorldTransform(FTransform(M.Rotation, M.Position));
		}
		if (M.Age < Fig.Drop || M.Age >= Fig.Drop + Fig.Burn)
		{
			continue;  // no flame before ignition or after burn-out
		}
		const bool bOurs = M.Kind == ERewildMissileKind::Rewild;
		const FVector Nozzle = M.Position - Fwd * Fig.Length * 0.5f;
		const float Ignite = FMath::Clamp((M.Age - Fig.Drop) / 0.12f, 0.f, 1.f);  // the motor lights over a tenth of a second
		const float L = Fig.PlumeLength * Ignite * FMath::FRandRange(0.88f, 1.12f);
		const float W = Width(Fig.PlumeWidth, Nozzle);
		// the glow material is hottest at the mesh's +Z end, the cone's point: put that at the nozzle
		(bOurs ? PlumeR : PlumeH).Add(FTransform(FRotationMatrix::MakeFromZ(Fwd).ToQuat(), Nozzle - Fwd * L * 0.5f, FVector(W / 100.f, W / 100.f, L / 100.f)));
		const float G = Width(Fig.GlowSize, Nozzle) * Ignite;
		(bOurs ? GlowR : GlowH).Add(FTransform(FQuat::Identity, Nozzle, FVector(G / 100.f)));
	}
	R->HideBodiesFrom(Bodies);

	for (const FFlare& F : Flares)
	{
		if (F.Age < 0.f)
		{
			continue;
		}
		const float Burn = FMath::Clamp((FlareLife - F.Age) / 0.6f, 0.f, 1.f) * FMath::FRandRange(0.75f, 1.25f);  // flickers, then dies
		const float S = Width(45.f, F.Position) * Burn;  // 70 cm bloomed into a 3 m ball beside the ship
		FlarePts.Add(FTransform(FQuat::Identity, F.Position, FVector(S / 100.f)));
	}
	for (const FPuff& P : Puffs)
	{
		const float K = P.Age / P.Life;
		const FVector A = P.A + P.Drift * P.Age;
		const FVector B = P.B + P.Drift * P.Age;
		const FVector Mid = (A + B) * 0.5f;
		FVector X = B - A;
		const float Len = X.Size();
		X = Len > 1.f ? X / Len : FVector::ForwardVector;
		// A strip along the trail, turned about its own length to face the camera; 20% longer than its stretch so
		// neighbours cross-fade over their soft ends (the material fades the last tenth at each end).
		FVector Y = FVector::CrossProduct((Mid - Eye).GetSafeNormal(), X);
		if (Y.SizeSquared() < 1e-6f)
		{
			Y = FVector::CrossProduct(FVector::UpVector, X);
		}
		Y.Normalize();
		const FVector Z = FVector::CrossProduct(X, Y);
		const float W = FMath::Lerp(P.Width0, P.Width1, FMath::Sqrt(K));
		SmokeTs.Add(FTransform(FMatrix(X, Y, Z, FVector::ZeroVector).ToQuat(), Mid, FVector(FMath::Max(Len * 1.2f, 10.f) / 100.f, W / 100.f, 1.f)));
		SmokeAlpha.Add(P.Opacity * FMath::Pow(1.f - K, 1.5f));
	}

	auto Update = [](UInstancedStaticMeshComponent* C, TArray<FTransform>& Ts, int32& Drawn)
	{
		while (C->GetInstanceCount() < Ts.Num())
		{
			C->AddInstance(FTransform(FQuat::Identity, FVector::ZeroVector, FVector::ZeroVector), true);
		}
		const int32 Used = Ts.Num();
		for (int32 I = Used; I < FMath::Max(Drawn, Used); ++I)
		{
			Ts.Add(FTransform(FQuat::Identity, FVector::ZeroVector, FVector::ZeroVector));  // hide spent instances
		}
		if (Ts.Num() > 0)
		{
			C->BatchUpdateInstancesTransforms(0, Ts, true, true, true);
		}
		const int32 Was = Drawn;
		Drawn = Used;
		return FMath::Max(Was, Used);
	};
	Update(R->PlumeRewild, PlumeR, Drawn[0]);
	Update(R->PlumeHarrow, PlumeH, Drawn[1]);
	Update(R->GlowRewild, GlowR, Drawn[2]);
	Update(R->GlowHarrow, GlowH, Drawn[3]);
	Update(R->Flares, FlarePts, Drawn[4]);
	const int32 SmokeSlots = Update(R->Smoke, SmokeTs, Drawn[5]);
	for (int32 I = 0; I < SmokeSlots; ++I)
	{
		R->Smoke->SetCustomDataValue(I, 0, I < SmokeAlpha.Num() ? SmokeAlpha[I] : 0.f, false);
	}
	if (SmokeSlots > 0)
	{
		R->Smoke->MarkRenderStateDirty();
	}
}
