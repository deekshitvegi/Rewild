#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Tasks/Task.h"
#include "RewildPlanetShape.h"
#include "RewildPlanet.generated.h"

class UMaterialInterface;
class UProceduralMeshComponent;
class USkyAtmosphereComponent;

/**
 * A whole round world you can land on anywhere (docs/unreal/PLAN.md, "Planets: land anywhere"; first on Haven,
 * docs/unreal/HAVEN.md). The actor stands at the planet's centre; the planet's frame is the world's axes.
 *
 * The ground is a cube's six faces bent onto the sphere, each a quadtree of tiles (32 x 32 quads) that split where
 * the camera would see a coarse tile's error as more than about a pixel and a half, down to tiles 8.6 m across with
 * a point every 27 cm at Haven's size. Tiles are built on worker threads from the world's shape
 * (FRewildPlanetShape) and swapped in only when all four children are ready, so there are never holes; skirts hang
 * under every tile's edge to hide the cracks between tiles of different detail. Where the ground dips under the
 * sea, the tile also carries the sea's surface. The sky (Sky Atmosphere at the planet's real size) is part of the
 * planet; its light (the directional light, TON 618 on Haven) is placed in the level.
 */
UCLASS()
class REWILD_API ARewildPlanet : public AActor
{
	GENERATED_BODY()

public:
	ARewildPlanet();

	virtual void Tick(float DeltaSeconds) override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;

	/** The planet in this world, or null. */
	static ARewildPlanet* Find(const UWorld* World);

	/** Ground height (metres above sea level) under a world position, at full detail. */
	double GroundHeightAt(const FVector& WorldPos) const;
	/** Metres above the ground, or above the sea where that is higher. */
	double AltitudeAt(const FVector& WorldPos) const;
	/** Up (away from the centre) at a world position. */
	FVector UpAt(const FVector& WorldPos) const;
	/** A world position: a direction in the planet's frame, and metres above the ground (or sea) there. */
	FVector WorldAt(const FVector3d& Dir, double AboveGround) const;
	double GetRadius() const;
	const FRewildPlanetShape* GetShape() const { return Shape.Get(); }
	/** Nothing waiting to be built or swapped in for the current view. */
	bool IsSettled() const { return bSettled; }
	int32 GetTilesShown() const { return TilesShown; }

	UPROPERTY(EditAnywhere, Category = "Planet") FName World = TEXT("Haven");
	UPROPERTY(EditAnywhere, Category = "Planet") TObjectPtr<UMaterialInterface> GroundMaterial;
	UPROPERTY(EditAnywhere, Category = "Planet") TObjectPtr<UMaterialInterface> SeaMaterial;
	/** The sea on coarse tiles, seen from afar: plain deep water (the water shading reads its depth from the depth
	 * buffer, which has no precision left thousands of km away: from orbit it lit up white, 9 Nov). */
	UPROPERTY(EditAnywhere, Category = "Planet") TObjectPtr<UMaterialInterface> FarSeaMaterial;
	/** Tiles this deep or deeper (35 km across on Haven) get the full water shading. */
	UPROPERTY(EditAnywhere, Category = "Planet") int32 NearSeaDepth = 8;
	UPROPERTY(EditAnywhere, Category = "Planet") int32 MaxDepth = 20;
	UPROPERTY(EditAnywhere, Category = "Planet") float ErrorPixels = 1.5f;
	UPROPERTY(EditAnywhere, Category = "Planet") int32 MaxBuildsInFlight = 64;
	UPROPERTY(EditAnywhere, Category = "Planet") int32 MaxUploadsPerFrame = 24;
	UPROPERTY(EditAnywhere, Category = "Planet") int32 MaxTiles = 6000;

protected:
	virtual void BeginPlay() override;

private:
	UPROPERTY(VisibleAnywhere) TObjectPtr<USceneComponent> Centre;
	UPROPERTY(VisibleAnywhere) TObjectPtr<USkyAtmosphereComponent> Sky;
	/** Every tile mesh made so far; tiles keep an index into it. */
	UPROPERTY() TArray<TObjectPtr<UProceduralMeshComponent>> Meshes;
	/** The level's sky light, dimmed with height (see Tick). */
	UPROPERTY() TObjectPtr<class USkyLightComponent> SkyLight;
	float SkyLightIntensity = 1.f;

public:
	/** A tile's finished mesh, made on a worker thread (public so the builder can fill it). */
	struct FTileMesh
	{
		TArray<FVector> Vertices, Normals;
		TArray<int32> Triangles;
		TArray<FVector2D> UV0, UV1, UV2, UV3;
		TArray<FColor> Colors;
		TArray<FVector> Tangents;
		TArray<FVector> SeaVertices, SeaNormals;
		TArray<int32> SeaTriangles;
		TArray<FVector2D> SeaUV0, SeaUV1, SeaUV2, SeaUV3;
		FVector3d Centre = FVector3d::ZeroVector;  // planet frame, metres
		double Radius = 0.0;                        // bounding radius, metres
		double Error = 0.0;                         // metres: how far this tile's surface is from its children's
		double MinH = 0.0, MaxH = 0.0;
		/** Metres from the tile's texture origin (on a 2,048 m grid) to its centre: the materials add the vertices'
		 * own positions in the tile to it (custom primitive data 0-2), at full precision. The mesh's texture
		 * coordinates are half floats, which at 600 m from the origin step every half metre and drew the 2 m grass
		 * scan as bar codes (9 Nov). */
		FVector3d TexOffset = FVector3d::ZeroVector;
	};

private:
	struct FTile
	{
		uint8 Face = 0;
		uint8 Depth = 0;
		uint32 X = 0, Y = 0;
		FVector3d Centre = FVector3d::ZeroVector;
		double Radius = 0.0;
		double Size = 0.0;     // edge length, metres
		double Error = -1.0;   // metres, -1 until built
		int32 Mesh = INDEX_NONE;
		bool bBuilt = false;
		bool bShown = false;
		bool bQueued = false;
		UE::Tasks::FTask Task;
		TSharedPtr<FTileMesh, ESPMode::ThreadSafe> Pending;  // filled by Task
		TUniquePtr<FTile> Kids[4];
		bool HasKids() const { return Kids[0].IsValid(); }
	};

	struct FView
	{
		FVector3d Camera = FVector3d::ZeroVector;  // planet frame, metres
		double PixelsPerRadian = 1000.0;
	};

	TSharedPtr<const FRewildPlanetShape, ESPMode::ThreadSafe> Shape;
	TUniquePtr<FTile> Roots[6];
	TArray<int32> FreeMeshes;
	TArray<FTile*> BuildRequests;   // this frame's tiles waiting to be built
	TArray<FTile*> Uploads;         // this frame's tiles with a finished mesh
	int32 BuildsInFlight = 0;
	int32 TilesShown = 0;
	int32 TilesAlive = 0;
	bool bSettled = false;
	bool bWarnedFull = false;
	float LogIn = 0.f;

	void SetupSky();
	FView MakeView() const;
	void UpdateTile(FTile& T, const FView& V, bool bAllowShow);
	bool WantsSplit(const FTile& T, const FView& V) const;
	void MakeKids(FTile& T);
	void DropKids(FTile& T);
	void DropTile(FTile& T);
	void SetShown(FTile& T, bool bShow);
	void StartBuild(FTile& T);
	void Upload(FTile& T);
	int32 AcquireMesh();
	void ReleaseMesh(int32 Index);
};
