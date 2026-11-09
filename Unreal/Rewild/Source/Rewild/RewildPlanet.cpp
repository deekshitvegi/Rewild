#include "RewildPlanet.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/SkyLight.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "ProceduralMeshComponent.h"
#include <atomic>

namespace
{
	constexpr int32 TileN = 32;  // quads along a tile's side

	struct FFace
	{
		FVector3d Normal, U, V;  // U x V = Normal, so triangles wound (v00, v01, v10) face outward
	};
	const FFace Faces[6] = {
		{FVector3d(1, 0, 0), FVector3d(0, 1, 0), FVector3d(0, 0, 1)},
		{FVector3d(-1, 0, 0), FVector3d(0, 0, 1), FVector3d(0, 1, 0)},
		{FVector3d(0, 1, 0), FVector3d(0, 0, 1), FVector3d(1, 0, 0)},
		{FVector3d(0, -1, 0), FVector3d(1, 0, 0), FVector3d(0, 0, 1)},
		{FVector3d(0, 0, 1), FVector3d(1, 0, 0), FVector3d(0, 1, 0)},
		{FVector3d(0, 0, -1), FVector3d(0, 1, 0), FVector3d(1, 0, 0)},
	};

	/** A point on a face (S, T in -1..1) as a direction; the equal-angle warp keeps tiles near the same size. */
	FORCEINLINE FVector3d FaceDir(int32 Face, double S, double T)
	{
		const FFace& F = Faces[Face];
		const double A = FMath::Tan(S * UE_DOUBLE_PI * 0.25), B = FMath::Tan(T * UE_DOUBLE_PI * 0.25);
		return (F.Normal + F.U * A + F.V * B).GetSafeNormal();
	}

	/**
	 * The ground's texture coordinates are positions in metres, less an origin on a 2,048 m grid near the tile, so
	 * they stay small (and precise in a float) while every texture repeating in a fraction of 2,048 m lines up across
	 * tiles whose origins differ.
	 */
	constexpr double TexturePeriod = 2048.0;
	FORCEINLINE FVector3d TextureOrigin(const FVector3d& C)
	{
		return FVector3d(FMath::RoundToDouble(C.X / TexturePeriod), FMath::RoundToDouble(C.Y / TexturePeriod),
			FMath::RoundToDouble(C.Z / TexturePeriod)) * TexturePeriod;
	}

	/** Adds a triangle wound so its front faces Outward (Unreal's front face for (A, B, C) is (C - A) x (B - A)). */
	FORCEINLINE void AddFacing(TArray<int32>& Tris, const TArray<FVector>& V, int32 A, int32 B, int32 C, const FVector& Outward)
	{
		const FVector Front = FVector::CrossProduct(V[C] - V[A], V[B] - V[A]);
		if (FVector::DotProduct(Front, Outward) >= 0.0)
		{
			Tris.Append({A, B, C});
		}
		else
		{
			Tris.Append({A, C, B});
		}
	}

	void BuildTile(const FRewildPlanetShape& Shape, int32 Face, int32 Depth, uint32 TX, uint32 TY, ARewildPlanet::FTileMesh& Out)
	{
		const double Scale = 1.0 / double(uint64(1) << Depth);
		const double Span = 2.0 * Scale;
		const double S0 = -1.0 + Span * TX, T0 = -1.0 + Span * TY;
		const double R = Shape.Radius;
		const double Size = R * UE_DOUBLE_HALF_PI * Scale;
		const double Spacing = Size / TileN;
		// The shortest bumps drawn: six point spacings. At two (the most a grid can hold) the finest bumps lined up
		// with the grid and its triangles showed as a lattice in the light from the ship (9 Nov); the scans' normal
		// maps carry the relief finer than this.
		const double MinWave = Spacing * 6.0;

		// Heights on the grid with a border of one point all round (for normals that match the neighbours').
		constexpr int32 G = TileN + 3;
		TArray<FVector3d> Dirs, P;
		TArray<double> H;
		Dirs.SetNumUninitialized(G * G);
		P.SetNumUninitialized(G * G);
		H.SetNumUninitialized(G * G);
		for (int32 GJ = 0; GJ < G; ++GJ)
		{
			for (int32 GI = 0; GI < G; ++GI)
			{
				const int32 K = GJ * G + GI;
				Dirs[K] = FaceDir(Face, S0 + Span * double(GI - 1) / TileN, T0 + Span * double(GJ - 1) / TileN);
				H[K] = Shape.Height(Dirs[K], MinWave);
				P[K] = Dirs[K] * (R + H[K]);
				if (Shape.bHasSea && H[K] < 0.0)
				{
					// The sea is drawn on this same grid: keep the seabed a little under it at every point, so the
					// two flat surfaces never cross inside a cell (on coarse tiles they did, and sparkled along the
					// tile lines from orbit). The margin is 2% of the spacing: 5.6 km from orbit, 5 mm at your feet.
					P[K] = Dirs[K] * (R + FMath::Min(H[K], -Spacing * 0.02));
				}
			}
		}
		auto At = [](int32 I, int32 J) { return (J + 1) * G + (I + 1); };

		const FVector3d Centre = P[At(TileN / 2, TileN / 2)];
		const FVector3d Origin = TextureOrigin(Centre);
		Out.Centre = Centre;

		// The error: how far the children (twice the detail) would move the surface, at the middle of every cell,
		// and never less than the flat cells' sag across the sphere's curve.
		double Error = Spacing * Spacing / (8.0 * R);
		for (int32 J = 0; J < TileN; ++J)
		{
			for (int32 I = 0; I < TileN; ++I)
			{
				const FVector3d D = FaceDir(Face, S0 + Span * (I + 0.5) / TileN, T0 + Span * (J + 0.5) / TileN);
				const double Fine = Shape.Height(D, MinWave * 0.5);
				const double Coarse = 0.25 * (H[At(I, J)] + H[At(I + 1, J)] + H[At(I, J + 1)] + H[At(I + 1, J + 1)]);
				Error = FMath::Max(Error, FMath::Abs(Fine - Coarse));
				if (Shape.bHasSea && (Fine < 0.0) != (Coarse < 0.0))
				{
					// the coast would move within this cell: keep it sharp from orbit (at half a cell, every coast in
					// view split down to 3-pixel cells and the ship's view drew 3,300 tiles: 9 Nov)
					Error = FMath::Max(Error, Spacing * 0.1);
				}
			}
		}
		Out.Error = Error;

		// The ground.
		constexpr int32 NV = (TileN + 1) * (TileN + 1);
		Out.Vertices.Reserve(NV + 4 * TileN);
		Out.Normals.Reserve(NV + 4 * TileN);
		Out.Tangents.Reserve(NV + 4 * TileN);
		Out.UV0.Reserve(NV + 4 * TileN);
		Out.UV1.Reserve(NV + 4 * TileN);
		Out.UV2.Reserve(NV + 4 * TileN);
		Out.UV3.Reserve(NV + 4 * TileN);
		Out.Colors.Reserve(NV + 4 * TileN);
		double MinH = DBL_MAX, MaxH = -DBL_MAX, Radius = 0.0;
		TArray<FVector3d> VertexDirs;
		VertexDirs.Reserve(NV);
		for (int32 J = 0; J <= TileN; ++J)
		{
			for (int32 I = 0; I <= TileN; ++I)
			{
				const int32 K = At(I, J);
				const FVector3d Du = P[At(I + 1, J)] - P[At(I - 1, J)];
				const FVector3d Dv = P[At(I, J + 1)] - P[At(I, J - 1)];
				FVector3d Nrm = FVector3d::CrossProduct(Du, Dv).GetSafeNormal();
				if (Nrm.Dot(Dirs[K]) < 0.0)
				{
					Nrm = -Nrm;
				}
				const FVector3d Local = P[K] - Centre;
				Radius = FMath::Max(Radius, Local.Size());
				Out.Vertices.Add(FVector(Local * 100.0));
				Out.Normals.Add(FVector(Nrm));
				Out.Tangents.Add(FVector(Du.GetSafeNormal()));
				const FVector3d Tex = P[K] - Origin;
				Out.UV0.Add(FVector2D(Tex.X, Tex.Y));
				Out.UV1.Add(FVector2D(Tex.Z, 0.0));
				const FRewildPlanetShape::FCover C = Shape.Cover(Dirs[K], H[K], Nrm.Dot(Dirs[K]), MinWave);
				Out.UV2.Add(FVector2D(C.Tint, C.Wet));
				Out.UV3.Add(FVector2D(H[K], 0.0));
				Out.Colors.Add(C.Weights.ToFColor(false));
				MinH = FMath::Min(MinH, H[K]);
				MaxH = FMath::Max(MaxH, H[K]);
				VertexDirs.Add(Dirs[K]);
			}
		}
		auto V = [](int32 I, int32 J) { return J * (TileN + 1) + I; };
		Out.Triangles.Reserve(TileN * TileN * 6 + TileN * 24);
		for (int32 J = 0; J < TileN; ++J)
		{
			for (int32 I = 0; I < TileN; ++I)
			{
				const int32 V00 = V(I, J), V10 = V(I + 1, J), V01 = V(I, J + 1), V11 = V(I + 1, J + 1);
				Out.Triangles.Append({V00, V01, V10, V10, V01, V11});
			}
		}

		// Skirts: a curtain hanging under every edge, deep enough to close the gap to a coarser neighbour.
		const double Skirt = Error * 2.0 + Spacing * 0.25 + 0.2;
		TArray<int32> Ring;
		Ring.Reserve(4 * TileN);
		for (int32 I = 0; I < TileN; ++I) Ring.Add(V(I, 0));
		for (int32 J = 0; J < TileN; ++J) Ring.Add(V(TileN, J));
		for (int32 I = TileN; I > 0; --I) Ring.Add(V(I, TileN));
		for (int32 J = TileN; J > 0; --J) Ring.Add(V(0, J));
		const int32 FirstSkirt = Out.Vertices.Num();
		for (int32 Index : Ring)
		{
			// copies first: adding an array's own element to it is not allowed (it may move as it grows)
			const FVector Vtx = Out.Vertices[Index] - FVector(VertexDirs[Index] * (Skirt * 100.0));
			const FVector Nrm = Out.Normals[Index], Tan = Out.Tangents[Index];
			const FVector2D A = Out.UV0[Index], B = Out.UV1[Index], C = Out.UV2[Index], D = Out.UV3[Index];
			const FColor Col = Out.Colors[Index];
			Out.Vertices.Add(Vtx);
			Out.Normals.Add(Nrm);
			Out.Tangents.Add(Tan);
			Out.UV0.Add(A);
			Out.UV1.Add(B);
			Out.UV2.Add(C);
			Out.UV3.Add(D);
			Out.Colors.Add(Col);
		}
		for (int32 K = 0; K < Ring.Num(); ++K)
		{
			const int32 A = Ring[K], B = Ring[(K + 1) % Ring.Num()];
			const int32 SA = FirstSkirt + K, SB = FirstSkirt + (K + 1) % Ring.Num();
			const FVector Outward = (Out.Vertices[A] + Out.Vertices[B]) * 0.5;
			AddFacing(Out.Triangles, Out.Vertices, A, B, SA, Outward);
			AddFacing(Out.Triangles, Out.Vertices, B, SB, SA, Outward);
		}

		// The sea's surface, where the ground goes under it, on the ground's own grid (see the seabed above).
		if (Shape.bHasSea && MinH < 1.0)
		{
			constexpr int32 NS = TileN;
			for (int32 J = 0; J <= NS; ++J)
			{
				for (int32 I = 0; I <= NS; ++I)
				{
					const FVector3d D = FaceDir(Face, S0 + Span * double(I) / NS, T0 + Span * double(J) / NS);
					const FVector3d Ps = D * R;
					const FVector3d Local = Ps - Centre;
					Radius = FMath::Max(Radius, Local.Size());
					Out.SeaVertices.Add(FVector(Local * 100.0));
					Out.SeaNormals.Add(FVector(D));
					const FVector3d Tex = Ps - Origin;
					Out.SeaUV0.Add(FVector2D(Tex.X, Tex.Y));
					Out.SeaUV1.Add(FVector2D(Tex.Z, 0.0));
					Out.SeaUV2.Add(FVector2D(0.0, 0.0));
					Out.SeaUV3.Add(FVector2D(0.0, 0.0));
				}
			}
			auto SV = [](int32 I, int32 J) { return J * (NS + 1) + I; };
			for (int32 J = 0; J < NS; ++J)
			{
				for (int32 I = 0; I < NS; ++I)
				{
					const int32 V00 = SV(I, J), V10 = SV(I + 1, J), V01 = SV(I, J + 1), V11 = SV(I + 1, J + 1);
					Out.SeaTriangles.Append({V00, V01, V10, V10, V01, V11});
				}
			}
		}

		Out.MinH = MinH;
		Out.MaxH = MaxH;
		Out.Radius = Radius + Skirt;
	}

	/** How many tile builds are running, shared with the builds themselves (they may outlive the planet). */
	struct FBuildCounter
	{
		std::atomic<int32> Count{0};
	};
	const TSharedPtr<FBuildCounter, ESPMode::ThreadSafe>& Builds()
	{
		static const TSharedPtr<FBuildCounter, ESPMode::ThreadSafe> Counter = MakeShared<FBuildCounter, ESPMode::ThreadSafe>();
		return Counter;
	}
}

ARewildPlanet::ARewildPlanet()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PostUpdateWork;  // after the camera has moved this frame

	Centre = CreateDefaultSubobject<USceneComponent>(TEXT("Centre"));
	RootComponent = Centre;

	Sky = CreateDefaultSubobject<USkyAtmosphereComponent>(TEXT("Sky"));
	Sky->SetupAttachment(Centre);
	Sky->TransformMode = ESkyAtmosphereTransformMode::PlanetCenterAtComponentTransform;
}

ARewildPlanet* ARewildPlanet::Find(const UWorld* World)
{
	if (World)
	{
		for (TActorIterator<ARewildPlanet> It(const_cast<UWorld*>(World)); It; ++It)
		{
			return *It;
		}
	}
	return nullptr;
}

void ARewildPlanet::BeginPlay()
{
	Super::BeginPlay();
	SetActorRotation(FRotator::ZeroRotator);  // the planet's frame is the world's axes
	Shape = FRewildPlanetShape::Make(World);
	if (!Shape)
	{
		UE_LOG(LogTemp, Error, TEXT("[rewild planet] no shape for world %s"), *World.ToString());
		return;
	}
	SetupSky();
	for (TActorIterator<ASkyLight> It(GetWorld()); It; ++It)
	{
		SkyLight = It->GetLightComponent();
		SkyLightIntensity = SkyLight ? SkyLight->Intensity : 1.f;
		break;
	}
	FParse::Value(FCommandLine::Get(), TEXT("RewildNearSea="), NearSeaDepth);  // testing the sea's two materials

	const double R = Shape->Radius;
	for (int32 F = 0; F < 6; ++F)
	{
		Roots[F] = MakeUnique<FTile>();
		FTile& T = *Roots[F];
		T.Face = uint8(F);
		T.Size = R * UE_DOUBLE_HALF_PI;
		T.Centre = Faces[F].Normal * R;
		T.Radius = T.Size;
		++TilesAlive;
	}

	// The share of the surface under the sea (HAVEN.md: about 40%), from 20,000 points.
	FRandomStream Random(1);
	int32 Wet = 0;
	constexpr int32 Samples = 20000;
	for (int32 I = 0; I < Samples; ++I)
	{
		Wet += Shape->Height(FVector3d(Random.VRand()), 20000.0) < 0.0 ? 1 : 0;
	}
	UE_LOG(LogTemp, Display, TEXT("[rewild planet] %s: radius %.0f km, %.1f%% under the sea, colony ground %.1f m"),
		*World.ToString(), R / 1000.0, 100.0 * Wet / Samples, Shape->Height(FVector3d(0, 0, 1), 0.5));
}

void ARewildPlanet::SetupSky()
{
	const double R = Shape->Radius;
	Sky->SetBottomRadius(float(R / 1000.0));

	// The haze on far ground is kept in a volume 96 km deep by default; past it Unreal uses its last slice, which
	// drew a hard-edged box of glare on the sea toward TON 618 from 20 km up (9 Nov). A world seen from orbit needs
	// it deeper: 2,000 km in 64 slices. Set here, so the first fight's Earth keeps the look it was graded with.
	auto SetVar = [](const TCHAR* Name, float Value)
	{
		if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(Name))
		{
			Var->Set(Value, ECVF_SetByCode);
		}
	};
	SetVar(TEXT("r.SkyAtmosphere.AerialPerspectiveLUT.Depth"), 2000.f);
	SetVar(TEXT("r.SkyAtmosphere.AerialPerspectiveLUT.DepthResolution"), 64.f);
	SetVar(TEXT("r.SkyAtmosphere.AerialPerspectiveLUT.SampleCountMaxPerSlice"), 4.f);
	// The ground's flat triangles under a low light shadowed themselves one facet at a time: a lattice at the tiles'
	// point spacing showed across the grass from the ship (9 Nov; it went with shadows off and with this bias at 3,
	// the default being 0.5).
	SetVar(TEXT("r.Shadow.Virtual.NormalBias"), 3.f);
	if (World == TEXT("Haven"))
	{
		// Round 5 (9 Nov) measured the sky 1.5-2 stops too bright for the ground against the key art (zenith 28, 43,
		// 45 and horizon 112, 122, 110 where it has 10, 19, 22 and 35, 41, 44): thinner still, less haze, less of the
		// light bounced round the sky.
		// HAVEN.md: a dusky teal sky (key art: zenith 10, 19, 22). Under the warm light of TON 618's disk
		// (#ffd8b0), Rayleigh weights of about 0.26, 0.66, 1 give that colour. In the key art the sky is darker than
		// the grass (zenith 10, 19, 22 against grass 15, 61, 53), which only thin air gives: a third of Earth's
		// scattering, so the sky stays dusky while the ground is lit, and the hole shows by day.
		Sky->SetAtmosphereHeight(90.f);
		Sky->SetRayleighScattering(FLinearColor(0.26f, 0.66f, 1.0f));
		Sky->SetRayleighScatteringScale(0.0331f * 0.12f);
		Sky->SetRayleighExponentialDistribution(8.5f);
		// Little haze: at 0.006 (Earth's is 0.004) the warm haze drowned the teal (grass measured 59, 66, 42).
		Sky->SetMieScatteringScale(0.0008f);
		Sky->SetMieAnisotropy(0.8f);
		Sky->SetMultiScatteringFactor(0.6f);
		Sky->SetGroundAlbedo(FColor(18, 52, 44));
	}
}

double ARewildPlanet::GetRadius() const
{
	return Shape ? Shape->Radius : 0.0;
}

double ARewildPlanet::GroundHeightAt(const FVector& WorldPos) const
{
	if (!Shape)
	{
		return 0.0;
	}
	const FVector3d Dir = FVector3d(WorldPos - GetActorLocation()).GetSafeNormal();
	return Shape->Height(Dir, 0.25);
}

double ARewildPlanet::AltitudeAt(const FVector& WorldPos) const
{
	if (!Shape)
	{
		return 1.0e9;
	}
	const double FromCentre = FVector3d(WorldPos - GetActorLocation()).Size() / 100.0;
	double Ground = GroundHeightAt(WorldPos);
	if (Shape->bHasSea)
	{
		Ground = FMath::Max(Ground, 0.0);
	}
	return FromCentre - Shape->Radius - Ground;
}

FVector ARewildPlanet::UpAt(const FVector& WorldPos) const
{
	return (WorldPos - GetActorLocation()).GetSafeNormal();
}

FVector ARewildPlanet::WorldAt(const FVector3d& Dir, double AboveGround) const
{
	if (!Shape)
	{
		return GetActorLocation();
	}
	const FVector3d D = Dir.GetSafeNormal();
	double Ground = Shape->Height(D, 0.25);
	if (Shape->bHasSea)
	{
		Ground = FMath::Max(Ground, 0.0);
	}
	return GetActorLocation() + FVector(D * ((Shape->Radius + Ground + AboveGround) * 100.0));
}

ARewildPlanet::FView ARewildPlanet::MakeView() const
{
	FView V;
	FVector Camera = FVector::ZeroVector;
	float Fov = 90.f;
	if (const APlayerCameraManager* PCM = UGameplayStatics::GetPlayerCameraManager(this, 0))
	{
		Camera = PCM->GetCameraLocation();
		Fov = PCM->GetFOVAngle();
	}
	double Width = 1920.0;
	if (GEngine && GEngine->GameViewport)
	{
		FVector2D Size;
		GEngine->GameViewport->GetViewportSize(Size);
		if (Size.X > 0.0)
		{
			Width = Size.X;
		}
	}
	V.Camera = FVector3d(Camera - GetActorLocation()) / 100.0;
	V.PixelsPerRadian = (Width * 0.5) / FMath::Tan(FMath::DegreesToRadians(FMath::Clamp(Fov, 5.f, 170.f) * 0.5));
	return V;
}

void ARewildPlanet::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Shape)
	{
		return;
	}
	const double StartTime = FPlatformTime::Seconds();
	const FView V = MakeView();

	// The sky light is one picture of the sky taken where the camera is. From space that picture holds the planet
	// itself, which then lights its own night side (the globe showed no night: 9 Nov). Fade it out with height, so
	// from orbit only TON 618 lights Haven and the side turned away from it goes dark.
	if (SkyLight)
	{
		const double Up = V.Camera.Size() - Shape->Radius;
		const float Keep = FMath::Lerp(1.f, 0.05f, float(FMath::Clamp((Up - 30000.0) / 270000.0, 0.0, 1.0)));
		if (!FMath::IsNearlyEqual(SkyLight->Intensity, SkyLightIntensity * Keep, 0.01f))
		{
			SkyLight->SetIntensity(SkyLightIntensity * Keep);
		}
	}
	BuildRequests.Reset();
	Uploads.Reset();
	TilesShown = 0;
	for (TUniquePtr<FTile>& Root : Roots)
	{
		UpdateTile(*Root, V, true);
	}

	// Nearest (relative to its size) first.
	auto Priority = [&V](const FTile* T) { return FMath::Max(0.0, FVector3d::Dist(V.Camera, T->Centre) - T->Radius) / T->Size; };
	Uploads.Sort([&](const FTile& A, const FTile& B) { return Priority(&A) < Priority(&B); });
	const int32 UploadCount = FMath::Min(Uploads.Num(), MaxUploadsPerFrame);
	for (int32 I = 0; I < UploadCount; ++I)
	{
		Upload(*Uploads[I]);
	}

	BuildsInFlight = Builds()->Count.load();
	BuildRequests.Sort([&](const FTile& A, const FTile& B) { return Priority(&A) < Priority(&B); });
	for (FTile* T : BuildRequests)
	{
		if (BuildsInFlight >= MaxBuildsInFlight)
		{
			break;
		}
		StartBuild(*T);
		++BuildsInFlight;
	}
	bSettled = BuildRequests.Num() == 0 && Uploads.Num() == 0 && Builds()->Count.load() == 0;

	LogIn -= DeltaSeconds;
	if (LogIn <= 0.f)
	{
		LogIn = 5.f;
		const double Altitude = V.Camera.Size() - Shape->Radius;
		UE_LOG(LogTemp, Display, TEXT("[rewild planet] camera %.1f km up: %d tiles shown, %d alive, %d meshes, %d building, %d waiting, tick %.2f ms"),
			Altitude / 1000.0, TilesShown, TilesAlive, Meshes.Num(), Builds()->Count.load(), BuildRequests.Num(),
			(FPlatformTime::Seconds() - StartTime) * 1000.0);
	}
}

void ARewildPlanet::UpdateTile(FTile& T, const FView& V, bool bAllowShow)
{
	if (!T.bBuilt && T.Pending.IsValid() && T.Task.IsCompleted())
	{
		Uploads.Add(&T);
	}
	bool bSplit = T.bBuilt && T.Depth < MaxDepth && WantsSplit(T, V);
	if (bSplit && !T.HasKids() && TilesAlive + 4 > MaxTiles)
	{
		bSplit = false;
		if (!bWarnedFull)
		{
			bWarnedFull = true;
			UE_LOG(LogTemp, Warning, TEXT("[rewild planet] tile limit %d reached"), MaxTiles);
		}
	}
	if (bSplit)
	{
		if (!T.HasKids())
		{
			MakeKids(T);
		}
		bool bReady = true;
		for (const TUniquePtr<FTile>& Kid : T.Kids)
		{
			bReady &= Kid->bBuilt;
		}
		SetShown(T, bAllowShow && !bReady);
		for (TUniquePtr<FTile>& Kid : T.Kids)
		{
			UpdateTile(*Kid, V, bAllowShow && bReady);
		}
	}
	else
	{
		if (T.HasKids())
		{
			DropKids(T);
		}
		if (!T.bBuilt && !T.Pending.IsValid())
		{
			BuildRequests.Add(&T);
		}
		SetShown(T, bAllowShow && T.bBuilt);
	}
}

bool ARewildPlanet::WantsSplit(const FTile& T, const FView& V) const
{
	const double Dist = FMath::Max(0.5, FVector3d::Dist(V.Camera, T.Centre) - T.Radius);
	const double Pixels = T.Error / Dist * V.PixelsPerRadian;
	const bool bHas = T.HasKids();
	return Pixels > (bHas ? ErrorPixels * 0.7 : ErrorPixels) || Dist < T.Size * (bHas ? 0.9 : 0.75);
}

void ARewildPlanet::MakeKids(FTile& T)
{
	const double R = Shape->Radius;
	const double Scale = 1.0 / double(uint64(1) << (T.Depth + 1));
	for (int32 Q = 0; Q < 4; ++Q)
	{
		T.Kids[Q] = MakeUnique<FTile>();
		FTile& K = *T.Kids[Q];
		K.Face = T.Face;
		K.Depth = uint8(T.Depth + 1);
		K.X = T.X * 2 + (Q & 1);
		K.Y = T.Y * 2 + (Q >> 1);
		K.Size = T.Size * 0.5;
		const double S = -1.0 + 2.0 * Scale * (K.X + 0.5), U = -1.0 + 2.0 * Scale * (K.Y + 0.5);
		K.Centre = FaceDir(K.Face, S, U) * (T.Centre.Size());
		K.Radius = K.Size;
	}
	TilesAlive += 4;
}

void ARewildPlanet::DropKids(FTile& T)
{
	for (TUniquePtr<FTile>& Kid : T.Kids)
	{
		DropTile(*Kid);
		Kid.Reset();
	}
	TilesAlive -= 4;
}

void ARewildPlanet::DropTile(FTile& T)
{
	if (T.HasKids())
	{
		DropKids(T);
	}
	if (T.Mesh != INDEX_NONE)
	{
		ReleaseMesh(T.Mesh);
		T.Mesh = INDEX_NONE;
	}
	T.Pending.Reset();  // a build still running finishes into its own copy and is thrown away
	T.bBuilt = false;
	T.bShown = false;
}

void ARewildPlanet::SetShown(FTile& T, bool bShow)
{
	if (bShow)
	{
		++TilesShown;
	}
	if (T.bShown != bShow && T.Mesh != INDEX_NONE)
	{
		T.bShown = bShow;
		Meshes[T.Mesh]->SetVisibility(bShow);
		// A hidden tile must leave ray tracing too: its finer children lie a hair above or below it, and Lumen's
		// rays from them hit it, drawing its triangles as a lattice on the grass (after flying down from orbit, 9 Nov).
		Meshes[T.Mesh]->SetVisibleInRayTracing(bShow);
	}
}

void ARewildPlanet::StartBuild(FTile& T)
{
	TSharedPtr<FTileMesh, ESPMode::ThreadSafe> Out = MakeShared<FTileMesh, ESPMode::ThreadSafe>();
	T.Pending = Out;
	TSharedPtr<const FRewildPlanetShape, ESPMode::ThreadSafe> S = Shape;
	TSharedPtr<FBuildCounter, ESPMode::ThreadSafe> Counter = Builds();
	const int32 Face = T.Face, Depth = T.Depth;
	const uint32 X = T.X, Y = T.Y;
	Counter->Count.fetch_add(1);
	T.Task = UE::Tasks::Launch(UE_SOURCE_LOCATION, [S, Out, Counter, Face, Depth, X, Y]()
	{
		BuildTile(*S, Face, Depth, X, Y, *Out);
		Counter->Count.fetch_sub(1);
	}, UE::Tasks::ETaskPriority::BackgroundNormal);
}

void ARewildPlanet::Upload(FTile& T)
{
	const FTileMesh& M = *T.Pending;
	T.Mesh = AcquireMesh();
	UProceduralMeshComponent* Mesh = Meshes[T.Mesh];
	Mesh->SetRelativeLocation(FVector(M.Centre * 100.0));
	TArray<FProcMeshTangent> Tangents;
	Tangents.Reserve(M.Tangents.Num());
	for (const FVector& Tn : M.Tangents)
	{
		Tangents.Add(FProcMeshTangent(Tn, false));
	}
	Mesh->CreateMeshSection(0, M.Vertices, M.Triangles, M.Normals, M.UV0, M.UV1, M.UV2, M.UV3, M.Colors, Tangents, false);
	Mesh->SetMaterial(0, GroundMaterial);
	static const bool bNoSea = FParse::Param(FCommandLine::Get(), TEXT("RewildNoSea"));  // testing: the ground alone
	if (M.SeaVertices.Num() > 0 && !bNoSea)
	{
		Mesh->CreateMeshSection(1, M.SeaVertices, M.SeaTriangles, M.SeaNormals, M.SeaUV0, M.SeaUV1, M.SeaUV2, M.SeaUV3,
			TArray<FColor>(), TArray<FProcMeshTangent>(), false);
		Mesh->SetMaterial(1, (T.Depth >= NearSeaDepth || !FarSeaMaterial) ? SeaMaterial : FarSeaMaterial);
	}
	T.Centre = M.Centre;
	T.Radius = M.Radius;
	T.Error = M.Error;
	T.bBuilt = true;
	T.bShown = false;
	T.Pending.Reset();
}

int32 ARewildPlanet::AcquireMesh()
{
	if (FreeMeshes.Num() > 0)
	{
		return FreeMeshes.Pop(EAllowShrinking::No);
	}
	UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(this, NAME_None, RF_Transient);
	Mesh->SetupAttachment(Centre);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->bUseAsyncCooking = true;
	Mesh->SetCastShadow(true);
	Mesh->bAffectDistanceFieldLighting = false;
	Mesh->SetVisibility(false);
	Mesh->SetVisibleInRayTracing(false);
	Mesh->RegisterComponent();
	return Meshes.Add(Mesh);
}

void ARewildPlanet::ReleaseMesh(int32 Index)
{
	UProceduralMeshComponent* Mesh = Meshes[Index];
	Mesh->ClearAllMeshSections();
	Mesh->SetVisibility(false);
	Mesh->SetVisibleInRayTracing(false);
	FreeMeshes.Add(Index);
}

void ARewildPlanet::EndPlay(const EEndPlayReason::Type Reason)
{
	for (TUniquePtr<FTile>& Root : Roots)
	{
		if (Root)
		{
			DropTile(*Root);
			Root.Reset();
		}
	}
	Super::EndPlay(Reason);
}
