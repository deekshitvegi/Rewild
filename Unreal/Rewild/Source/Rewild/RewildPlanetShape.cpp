#include "RewildPlanetShape.h"

namespace
{
	FORCEINLINE uint64 Mix(uint64 X)
	{
		X ^= X >> 33;
		X *= 0xff51afd7ed558ccdULL;
		X ^= X >> 33;
		X *= 0xc4ceb9fe1a85ec53ULL;
		X ^= X >> 33;
		return X;
	}

	/** A random gradient in -1..1 on each axis for one lattice point. */
	FORCEINLINE FVector3f Grad(int64 X, int64 Y, int64 Z)
	{
		const uint64 H = Mix(uint64(X) * 0x9E3779B97F4A7C15ULL ^ Mix(uint64(Y) * 0xC2B2AE3D27D4EB4FULL ^ Mix(uint64(Z) * 0x165667B19E3779F9ULL + 0x27d4eb2f165667c5ULL)));
		constexpr float Scale = 2.f / float(0x1FFFFF);
		return FVector3f(float(H & 0x1FFFFF) * Scale - 1.f, float((H >> 21) & 0x1FFFFF) * Scale - 1.f, float((H >> 42) & 0x1FFFFF) * Scale - 1.f);
	}

	/** Fixed rotations, one per octave, so the octaves' lattices never line up (seeded: the same on every run). */
	/** A rotation as three rows: Apply turns a point, ApplyT turns a gradient back. */
	struct FRot3
	{
		FVector3d R0, R1, R2;
		FORCEINLINE FVector3d Apply(const FVector3d& P) const { return FVector3d(R0.Dot(P), R1.Dot(P), R2.Dot(P)); }
		FORCEINLINE FVector3d ApplyT(const FVector3d& V) const { return R0 * V.X + R1 * V.Y + R2 * V.Z; }
	};

	struct FOctaveRotations
	{
		FRot3 M[32];
		FOctaveRotations()
		{
			FRandomStream Random(5730);
			for (FRot3& R : M)
			{
				const FVector3d Axis = FVector3d(Random.FRandRange(-1.f, 1.f), Random.FRandRange(-1.f, 1.f), Random.FRandRange(-1.f, 1.f)).GetSafeNormal();
				const FQuat4d Q(Axis, Random.FRandRange(0.6f, 2.4f));
				// rows of the rotation matrix = the rotated basis taken column-wise
				const FVector3d CX = Q.RotateVector(FVector3d(1, 0, 0)), CY = Q.RotateVector(FVector3d(0, 1, 0)), CZ = Q.RotateVector(FVector3d(0, 0, 1));
				R.R0 = FVector3d(CX.X, CY.X, CZ.X);
				R.R1 = FVector3d(CX.Y, CY.Y, CZ.Y);
				R.R2 = FVector3d(CX.Z, CY.Z, CZ.Z);
			}
		}
	};
	const FOctaveRotations& Rotations()
	{
		static const FOctaveRotations R;
		return R;
	}

	FORCEINLINE double SmoothStep(double A, double B, double X)
	{
		const double T = FMath::Clamp((X - A) / (B - A), 0.0, 1.0);
		return T * T * (3.0 - 2.0 * T);
	}
}

float RewildNoise::Gradient(const FVector3d& P, FVector3f& D)
{
	const double FX = FMath::FloorToDouble(P.X), FY = FMath::FloorToDouble(P.Y), FZ = FMath::FloorToDouble(P.Z);
	const int64 IX = int64(FX), IY = int64(FY), IZ = int64(FZ);
	const float X = float(P.X - FX), Y = float(P.Y - FY), Z = float(P.Z - FZ);

	// quintic fade and its derivative
	const float UX = X * X * X * (X * (X * 6.f - 15.f) + 10.f);
	const float UY = Y * Y * Y * (Y * (Y * 6.f - 15.f) + 10.f);
	const float UZ = Z * Z * Z * (Z * (Z * 6.f - 15.f) + 10.f);
	const float DUX = 30.f * X * X * (X * (X - 2.f) + 1.f);
	const float DUY = 30.f * Y * Y * (Y * (Y - 2.f) + 1.f);
	const float DUZ = 30.f * Z * Z * (Z * (Z - 2.f) + 1.f);

	const FVector3f GA = Grad(IX, IY, IZ), GB = Grad(IX + 1, IY, IZ), GC = Grad(IX, IY + 1, IZ), GD = Grad(IX + 1, IY + 1, IZ);
	const FVector3f GE = Grad(IX, IY, IZ + 1), GF = Grad(IX + 1, IY, IZ + 1), GG = Grad(IX, IY + 1, IZ + 1), GH = Grad(IX + 1, IY + 1, IZ + 1);

	const float VA = GA.X * X + GA.Y * Y + GA.Z * Z;
	const float VB = GB.X * (X - 1.f) + GB.Y * Y + GB.Z * Z;
	const float VC = GC.X * X + GC.Y * (Y - 1.f) + GC.Z * Z;
	const float VD = GD.X * (X - 1.f) + GD.Y * (Y - 1.f) + GD.Z * Z;
	const float VE = GE.X * X + GE.Y * Y + GE.Z * (Z - 1.f);
	const float VF = GF.X * (X - 1.f) + GF.Y * Y + GF.Z * (Z - 1.f);
	const float VG = GG.X * X + GG.Y * (Y - 1.f) + GG.Z * (Z - 1.f);
	const float VH = GH.X * (X - 1.f) + GH.Y * (Y - 1.f) + GH.Z * (Z - 1.f);

	const float K0 = VA - VB - VC + VD;
	const float K1 = VA - VC - VE + VG;
	const float K2 = VA - VB - VE + VF;
	const float K3 = -VA + VB + VC - VD + VE - VF - VG + VH;

	const float Value = VA + UX * (VB - VA) + UY * (VC - VA) + UZ * (VE - VA) + UX * UY * K0 + UY * UZ * K1 + UZ * UX * K2 + UX * UY * UZ * K3;

	D = GA + UX * (GB - GA) + UY * (GC - GA) + UZ * (GE - GA) + UX * UY * (GA - GB - GC + GD) + UY * UZ * (GA - GC - GE + GG)
		+ UZ * UX * (GA - GB - GE + GF) + UX * UY * UZ * (-GA + GB + GC - GD + GE - GF - GG + GH);
	D.X += DUX * ((VB - VA) + UY * K0 + UZ * K2 + UY * UZ * K3);
	D.Y += DUY * ((VC - VA) + UZ * K1 + UX * K0 + UZ * UX * K3);
	D.Z += DUZ * ((VE - VA) + UX * K2 + UY * K1 + UX * UY * K3);
	return Value;
}

TSharedPtr<const FRewildPlanetShape, ESPMode::ThreadSafe> FRewildPlanetShape::Make(FName World)
{
	if (World == TEXT("Haven"))
	{
		return MakeShared<FHavenShape, ESPMode::ThreadSafe>();
	}
	return nullptr;
}

// ---------------------------------------------------------------------------------------------------------------------
// Haven

namespace
{
	// The colony stands at +Z; TON 618 hangs 25 degrees up toward +X; the bay opens toward it.
	constexpr double HavenRadius = 5730000.0;
	constexpr double ColonyRegion = 26000.0;   // m: inside this the colony's own ground takes over
	constexpr double ColonyCore = 14000.0;

	/** The coast's distance east of the colony (m) at Y metres north: 1.3-2 km near the colony, with the bay reaching
	 * in toward it, wandering further off north and south. The colony's ground and the continents both use it. */
	double HavenCoast(double Y)
	{
		const double Far = SmoothStep(3000.0, 20000.0, FMath::Abs(Y));
		return 1900.0 + 380.0 * RewildNoise::Gradient(FVector3d(Y / 1500.0, 0.0, 0.0) + FVector3d(7.3, 1.1, 3.6))
			+ Far * 9000.0 * RewildNoise::Gradient(FVector3d(Y / 40000.0, 0.0, 0.0) + FVector3d(2.7, 5.9, 0.4))
			- 600.0 * FMath::Exp(-(Y * Y) / (750.0 * 750.0));
	}
}

FHavenShape::FHavenShape()
{
	Radius = HavenRadius;
	bHasSea = true;
}

double FHavenShape::Continents(const FVector3d& P) const
{
	// Land and sea from a few slow octaves (wavelengths 5,000 km down to about 40 km), warped so the coasts wander.
	const FVector3d Warp(RewildNoise::Gradient(P / 2.9e6 + FVector3d(11.3, 2.1, 7.7)),
		RewildNoise::Gradient(P / 2.9e6 + FVector3d(3.9, 17.2, 1.4)),
		RewildNoise::Gradient(P / 2.9e6 + FVector3d(8.6, 5.5, 13.1)));
	const FVector3d Q = P + Warp * 9.0e5;
	double C = 0.0, A = 1.0, W = 5.0e6;
	for (int32 K = 0; K < 7; ++K)
	{
		C += A * RewildNoise::Gradient(Rotations().M[K].Apply(Q) / W);
		A *= 0.5;
		W *= 0.5;
	}

	// Round the colony: land to the west, and the colony's own coast running on north and south of it with the sea
	// to the east (toward TON 618), so the bay opens into a real sea (a circle round the colony showed as a lagoon).
	if (P.Z > 0.0)
	{
		const double FromColony = FVector2d(P.X, P.Y).Size();
		C += 0.1 * SmoothStep(6.0e5, 1.5e5, FromColony);
		const double Near = SmoothStep(2.6e5, 1.2e5, FromColony);
		if (Near > 0.0)
		{
			const double Inland = HavenCoast(P.Y) - P.X;
			C = FMath::Lerp(C, FMath::Clamp(Inland / 1.5e5, -0.25, 0.08) - 0.02, Near);
		}
	}
	return C;
}

double FHavenShape::Hills(const FVector3d& P, const FVector3d& Up, double Amplitude, double LongestWave, double MinWave) const
{
	// Eroded fBm (Inigo Quilez): each octave is damped by the slope the longer ones have already made, so slopes stay
	// smooth and long and the fine detail gathers on the flats and ridges, as water and weather leave real ground.
	double H = 0.0, A = Amplitude, W = LongestWave;
	FVector3d Slope = FVector3d::ZeroVector;
	for (int32 K = 0; K < 32 && W > MinWave * 0.5; ++K)
	{
		const double Fade = FMath::Clamp((W - MinWave * 0.5) / (MinWave * 0.5), 0.0, 1.0);
		const FRot3& M = Rotations().M[(K + 7) & 31];
		FVector3f D;
		const float N = RewildNoise::Gradient(M.Apply(P) / W, D);
		FVector3d G = M.ApplyT(FVector3d(D)) * (A / W);
		G -= Up * FVector3d::DotProduct(G, Up);
		Slope += G * Fade;
		H += Fade * A * N / (1.0 + 3.5 * Slope.SizeSquared());
		A *= 0.5;
		W *= 0.5;
	}
	return H;
}

double FHavenShape::Mountains(const FVector3d& P, double MinWave) const
{
	// Ridged multifractal in belts: sharp crests, each octave strongest where the last made a ridge.
	double H = 0.0, A = 1.0, W = 1.4e5, Weight = 1.0;
	for (int32 K = 0; K < 24 && W > MinWave * 0.5; ++K)
	{
		const double Fade = FMath::Clamp((W - MinWave * 0.5) / (MinWave * 0.5), 0.0, 1.0);
		double R = 1.0 - FMath::Abs(RewildNoise::Gradient(Rotations().M[(K + 13) & 31].Apply(P) / W));
		R *= R * Weight;
		Weight = FMath::Clamp(R * 1.6, 0.0, 1.0);
		H += Fade * A * R;
		A *= 0.48;
		W *= 0.5;
	}
	return H;
}

double FHavenShape::Colony(const FVector3d& P, double MinWave) const
{
	// The colony's ground (x east toward TON 618, y north, metres from the colony): a low hill under the domes,
	// rolling grass round it (hills 20-80 m high over 300-800 m), and 1.3-2 km east the shore of a bay.
	const double X = P.X, Y = P.Y;
	const FVector3d Up(0.0, 0.0, 1.0);
	// (gradient noise rarely passes +-0.5, so the amplitudes are twice the heights wanted: the first stills, at 24 m,
	// were near flat from 300 m)
	double Land = 40.0 + 30.0 * RewildNoise::Gradient(FVector3d(X, Y, 0.0) / 3200.0 + FVector3d(4.1, 9.3, 2.2));
	Land += Hills(P, Up, 70.0, 1600.0, MinWave);
	Land += 10.0 * FMath::Exp(-(X * X + Y * Y) / (650.0 * 650.0));  // the colony's hill

	const double Inland = HavenCoast(Y) - X;  // metres inland from the shore
	const double Bed = -4.0 - FMath::Min(36.0, 0.03 * FMath::Max(0.0, -Inland)) + Hills(P, Up, 3.0, 400.0, MinWave);
	return FMath::Lerp(Bed, Land, SmoothStep(-260.0, 420.0, Inland));
}

double FHavenShape::Height(const FVector3d& Dir, double MinWave) const
{
	const FVector3d P = Dir * Radius;
	const FVector3d Up = Dir;

	// Continents: a continental shelf to about -90 m, then the deep basins.
	const double S = Continents(P) + 0.02;
	double Base = S > -0.03 ? S * 3000.0 : -90.0 - 3600.0 * SmoothStep(0.03, 0.3, -S);
	const double LandWeight = SmoothStep(-0.02, 0.06, S);

	// Rolling hills everywhere on land, steeper in some regions; low swells on the sea floor.
	const double Rough = 0.5 + 0.5 * RewildNoise::Gradient(P / 6.0e5 + FVector3d(1.7, 8.2, 4.4));
	const double HillAmp = FMath::Lerp(36.0, 260.0, Rough * Rough) * LandWeight + 40.0 * (1.0 - LandWeight);
	double H = Base + Hills(P, Up, HillAmp, 6000.0, MinWave);

	// Mountain belts.
	const double Belt = SmoothStep(0.35, 0.6, RewildNoise::Gradient(P / 1.6e6 + FVector3d(5.5, 2.9, 9.1)) + 0.25 * Rough);
	if (Belt > 0.0 && LandWeight > 0.0)
	{
		H += Belt * LandWeight * 2600.0 * Mountains(P, MinWave);
	}

	// The colony's own ground.
	if (Dir.Z > 0.0)
	{
		const double FromColony = FVector2d(P.X, P.Y).Size();
		if (FromColony < ColonyRegion)
		{
			H = FMath::Lerp(H, Colony(P, MinWave), SmoothStep(ColonyRegion, ColonyCore, FromColony));
		}
	}
	return H;
}

FRewildPlanetShape::FCover FHavenShape::Cover(const FVector3d& Dir, double HeightM, double Up, double MinWave) const
{
	const FVector3d P = Dir * Radius;
	FCover C;
	// Each pattern only where the points are close enough to draw it (a pattern finer than the points aliased into
	// blotches from orbit, 9 Nov).
	auto Seen = [MinWave](double Wave) { return SmoothStep(MinWave * 2.0, MinWave * 4.0, Wave); };
	const double Rock = FMath::Max(SmoothStep(0.84, 0.72, Up), SmoothStep(1700.0, 2600.0, HeightM));
	const double Bed = SmoothStep(0.2, -1.2, HeightM);
	// Shingle and sand only in some coves; elsewhere the grass runs down to the water (ASSET_JOB lesson).
	const double Shore = SmoothStep(2.2, 0.6, HeightM) * SmoothStep(-1.4, 0.0, HeightM);
	const double Cove = SmoothStep(0.12, 0.4, Seen(700.0) * RewildNoise::Gradient(P / 700.0 + FVector3d(3.3, 6.1, 0.7)));
	const double Sand = Shore * Cove * (1.0 - Rock);
	const double Grass = FMath::Max(0.0, 1.0 - Rock - Bed - Sand);
	const double Sum = FMath::Max(1e-6, Grass + Rock + Bed + Sand);
	C.Weights = FLinearColor(float(Grass / Sum), float(Rock / Sum), float(Sand / Sum), float(Bed / Sum));
	// Patches of dark heath, lush and dry grass at 40 km, 9 km and 1.3 km (gradient noise mostly stays within +-0.5).
	C.Tint = float(FMath::Clamp(1.1 * Seen(40000.0) * RewildNoise::Gradient(P / 40000.0 + FVector3d(6.1, 3.3, 8.8))
		+ 0.9 * Seen(9000.0) * RewildNoise::Gradient(P / 9000.0 + FVector3d(2.2, 7.1, 5.3))
		+ 0.6 * Seen(1300.0) * RewildNoise::Gradient(P / 1300.0 + FVector3d(9.4, 0.8, 6.6)), -1.0, 1.0));
	C.Wet = float(SmoothStep(1.5, 0.0, HeightM));
	return C;
}
