"""Build Haven's level and the planet's materials (docs/unreal/HAVEN.md, step 3: the planet system).

Run fetch_scans.py and prepare_haven.py first (system Python), then this in the editor (rewild_shots.py's command
line). It imports the scanned ground (Poly Haven, CC0, packed by prepare_haven.py) into /Game/Generated/Haven/Scans
(not in git: about 300 MB; rebuilt on each PC), makes M_PlanetGround, M_PlanetSea and M_PlanetSeaFar in
/Game/Worlds/Haven/Materials, and builds /Game/Worlds/Haven/L_Haven: the planet (ARewildPlanet, its centre 5,730 km
under the colony, which stands at the world origin), TON 618's light 35 degrees up toward +X, the sky light and the
exposure. The game mode is ARewildWorldGameMode. Then play it:

    UnrealEditor.exe Rewild.uproject /Game/Worlds/Haven/L_Haven -game -windowed -ResX=1920 -ResY=1080 -RewildWorldShots

Frame: the planet's frame is the world's axes; the colony is at +Z (world origin, a little above sea level), east
(+X) toward TON 618, north +Y. Units are centimetres.
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import unreal  # noqa: E402

import rewild_shots as shots  # noqa: E402

DEST = "/Game/Worlds/Haven"
LEVEL = DEST + "/L_Haven"
TAG = "haven_build"
RAW = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()), "RawSources", "haven")
SCANS = os.path.join(RAW, "scans")
SCAN_DEST = "/Game/Generated/Haven/Scans"
# Each layer's scan and the size it repeats at, in metres: a fraction of 2,048 m, so the pattern lines up across
# tiles (RewildPlanet), close to the scan's real size (Poly Haven's figure in brackets).
LAYERS = {
    "Grass": ("grass_ground", 2.0),          # (2.5 m) the grassland at your feet
    "GrassMid": ("aerial_grass_rock", 16.0),  # (15 m) the same seen from the ship, out to 6 km
    "Rock": ("rock_face_03", 4.0),           # (2.7 m) steep ground
    "RockMid": ("aerial_rocks_02", 64.0),     # (50 m) mountains from the air
    "Sand": ("coast_sand_04", 4.0),          # (3.9 m) the coves
    "Bed": ("mud_forest", 2.0),              # (2.35 m) the seabed and the shallows
}

R_HAVEN = 573_000_000.0  # cm (5,730 km)
TON618_ELEVATION = 35.0   # degrees above the colony's horizon, toward +X (east)
TON618_LUX = 60_000.0     # the disk's light at Haven
TON618_COLOUR = (255, 228, 200)  # warm, a little less than #ffd8b0: at #ffd8b0 the teal ground went olive
# Degrees. 8 made a flat, hard-edged plate of glare on the sea: Unreal reflects a wide light as one uniform disc
# (9 Nov). Its true look on the water comes with the hole drawn in the sky (HAVEN.md step 4); 2.5 keeps soft shadows.
TON618_ANGLE = 2.5
EV100 = 13.5  # with the thinner sky of round 6 (the ground was 0.5-0.6 stop under the key art at 14)

# Linear albedo of each cover (HAVEN.md; tuned on the stills against the key art).
# The light is warm (#ffd8b0), so a grass that reads teal under it (key art 15, 61, 53) is bluer than it looks:
# the first stills, at 0.03, 0.105, 0.07, came out olive.
# Round 4 measured the teal's blue at half what the key art has (looking down: 26, 42, 27): bluer still.
GRASS_HEATH = (0.008, 0.045, 0.055)
GRASS_LUSH = (0.012, 0.085, 0.100)
GRASS_DRY = (0.040, 0.095, 0.075)
ROCK = (0.15, 0.15, 0.14)
SAND = (0.24, 0.22, 0.18)
BED = (0.035, 0.045, 0.035)  # dark silt: at 0.07 the shallows glowed neon jade under the water (9 Nov)

tools = unreal.AssetToolsHelpers.get_asset_tools()
assets = unreal.EditorAssetLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary


def fresh(cls, name, factory, folder):
    path = f"{folder}/{name}"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    return tools.create_asset(name, folder, cls, factory)


def node(mat, cls, x, y, **props):
    n = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        n.set_editor_property(k, v)
    return n


def custom(mat, x, y, name, code, inputs, out_type, extra_outputs=()):
    c = node(mat, unreal.MaterialExpressionCustom, x, y, description=name, code=code, output_type=out_type)
    ins = []
    for n in inputs:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        ins.append(ci)
    c.set_editor_property("inputs", ins)
    outs = []
    for n, t in extra_outputs:
        co = unreal.CustomOutput()
        co.set_editor_property("output_name", n)
        co.set_editor_property("output_type", t)
        outs.append(co)
    if outs:
        c.set_editor_property("additional_outputs", outs)
    return c


def import_scan(scan, part):
    """<scan>_A (colour and height: sRGB colour) or <scan>_B (normal, roughness, occlusion: linear), as BC7."""
    name = f"T_{scan}_{part}"
    path = f"{SCAN_DEST}/{name}"
    if not assets.does_asset_exist(path):
        task = unreal.AssetImportTask()
        task.filename = os.path.join(SCANS, scan, f"{scan}_{part}.png")
        task.destination_path = SCAN_DEST
        task.destination_name = name
        task.automated = True
        task.replace_existing = True
        task.save = False
        tools.import_asset_tasks([task])
    tex = unreal.load_asset(path)
    tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_BC7)
    tex.set_editor_property("srgb", part == "A")
    tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_WORLD)
    assets.save_loaded_asset(tex)
    return tex


def f3(c):
    return f"float3({c[0]:.5f}, {c[1]:.5f}, {c[2]:.5f})"


GROUND_HLSL = """
float3 P = float3(UV0.x, UV0.y, UV1.x);
float3 n = normalize(Nrm);
float3 bw = pow(abs(n), 6.0);
bw /= (bw.x + bw.y + bw.z);
float4 W = float4(Wrgb.rgb, Wa);
W /= max(1e-3, W.x + W.y + W.z + W.w);
// Distances in cm (PixelDepth). The scans at their own size out to 80 m; the aerial scans out to 6 km; patches from
// the aerial grass at 128 m and 512 m out to 30 km; beyond, the world's own colour.
float near = saturate(1.0 - Depth / 8000.0);
near *= near;
float mid = saturate(1.0 - Depth / 600000.0);
float far = saturate(1.0 - Depth / 3000000.0);
float3 lumw = float3(0.2126, 0.7152, 0.0722);
float wet = saturate(TW.y);
// Every scan read through the shared world sampler (12 textures would pass the 16-sampler limit), and through
// Texture2DSample, never .Sample: ray-traced lighting runs this too.
#define SX(T, s) Texture2DSample(T, View.MaterialTextureBilinearWrapedSampler, float2(P.z, P.y) / (s))
#define SY(T, s) Texture2DSample(T, View.MaterialTextureBilinearWrapedSampler, float2(P.x, P.z) / (s))
#define SZ(T, s) Texture2DSample(T, View.MaterialTextureBilinearWrapedSampler, float2(P.x, P.y) / (s))
// The same at a fixed mip level (a blurred copy), and turned a quarter (x and y swapped) so its repeats fall
// across the others'.
#define BLUR(T, s, m) (Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.z, P.y) / (s), m).rgb * bw.x     + Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.x, P.z) / (s), m).rgb * bw.y     + Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.x, P.y) / (s), m).rgb * bw.z)
#define TURNED(T, s, m) (Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.y, P.z) / (s), m).rgb * bw.x     + Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.z, P.x) / (s), m).rgb * bw.y     + Texture2DSampleLevel(T, View.MaterialTextureBilinearWrapedSampler, float2(P.y, P.x) / (s), m).rgb * bw.z)
// One layer, projected from three sides: colour and height from A; from B its normal in the world (whiteout
// blend, Ben Golus), roughness and occlusion. The planes' axes are the world's, so the normal maps need no flips.
#define LAYER(TA, TB, s, colour, height, normal, rough, ao) { \
    float4 ax = SX(TA, s), ay = SY(TA, s), az = SZ(TA, s); \
    float4 bx = SX(TB, s), by = SY(TB, s), bz = SZ(TB, s); \
    float4 a = ax * bw.x + ay * bw.y + az * bw.z; \
    colour = a.rgb; height = a.a; \
    float3 tx = float3(bx.xy * 2.0 - 1.0, 0.0); tx.z = sqrt(saturate(1.0 - dot(tx.xy, tx.xy))); \
    float3 ty = float3(by.xy * 2.0 - 1.0, 0.0); ty.z = sqrt(saturate(1.0 - dot(ty.xy, ty.xy))); \
    float3 tz = float3(bz.xy * 2.0 - 1.0, 0.0); tz.z = sqrt(saturate(1.0 - dot(tz.xy, tz.xy))); \
    tx = float3(tx.xy + n.zy, abs(tx.z) * n.x); \
    ty = float3(ty.xy + n.xz, abs(ty.z) * n.y); \
    tz = float3(tz.xy + n.xy, abs(tz.z) * n.z); \
    normal = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz.xyz * bw.z); \
    rough = bx.z * bw.x + by.z * bw.y + bz.z * bw.z; \
    ao = bx.w * bw.x + by.w * bw.y + bz.w * bw.z; }
// The scans are read through a slow warp, from the aerial grass blurred to 32 m cells at 128 m (once turned, once
// not), so their repeats fall on wavy lines instead of a grid (from the ship the 16 m repeat showed as a grid of
// dots, 9 Nov). Blurred that far the scan varies by only about 10% (measured), hence the large gains: about 8 m
// for the aerial scans, about 1 m for the near ones. (14 m from a copy blurred to 4-8 m bent so sharply that the
// near scans smeared into streaks at your feet; 2 m left the grid as it was.)
float L0 = dot(GRASSMID_MEAN, lumw);
float wx = dot(TURNED(GrassMidA, 128.0, 10.0), lumw) / L0 - 1.0;
float wy = dot(BLUR(GrassMidA, 128.0, 10.0), lumw) / L0 - 1.0;
float3 P0 = P;
float3 offs = float3(wx, wy, -wx);
P = P0 + offs * 10.0;
float3 gc, rc, sc, bc, gmc, rmc, gn, rn, sn, bn, gmn, rmn;
float gh, rh, sh, bh, gmh, rmh, gr, rr, sr, br, gmr, rmr, ga, ra, sa, ba, gma, rma;
LAYER(GrassA, GrassB, GRASS_S, gc, gh, gn, gr, ga)
LAYER(RockA, RockB, ROCK_S, rc, rh, rn, rr, ra)
LAYER(SandA, SandB, SAND_S, sc, sh, sn, sr, sa)
LAYER(BedA, BedB, BED_S, bc, bh, bn, br, ba)
P = P0 + offs * 80.0;
LAYER(GrassMidA, GrassMidB, GRASSMID_S, gmc, gmh, gmn, gmr, gma)
LAYER(RockMidA, RockMidB, ROCKMID_S, rmc, rmh, rmn, rmr, rma)
// their blurred copies, read through the same warp (read unwarped, they put the 16 m grid straight back: 9 Nov)
float3 gml = BLUR(GrassMidA, GRASSMID_S, 9.0);
float3 rml = BLUR(RockMidA, ROCKMID_S, 9.0);
P = P0;

// Ragged edges between layers within 300 m: each scan's height pushes its layer out where it stands tall.
float4 hgt = float4(lerp(gmh, gh, near), lerp(rmh, rh, near), sh, bh);
float4 Wh = W + hgt * 0.5;
float top = max(max(Wh.x, Wh.y), max(Wh.z, Wh.w)) - 0.3;
float4 Wb = max(Wh - top, 0.0);
Wb /= max(1e-4, Wb.x + Wb.y + Wb.z + Wb.w);
W = lerp(W, Wb, saturate(1.0 - Depth / 30000.0));

// A scan adds its own light and dark and part of its hue (chroma), around the world's colour for that cover.
#define RATIO(c, mean, chroma) clamp(lerp(float3(1.0, 1.0, 1.0) * (dot(c, lumw) / dot(mean, lumw)), (c) / (mean), chroma), 0.25, 3.0)
float3 grass = TW.x < 0.0 ? lerp(GRASS_LUSH, GRASS_HEATH, saturate(-TW.x * 1.4)) : lerp(GRASS_LUSH, GRASS_DRY, saturate(TW.x * 1.4));
float midNear = 0.6 * mid * (1.0 - 0.6 * near);  // (at full strength the aerial scans' repeat still showed faintly)
// The aerial scans only add detail finer than about 2 m (each divided by its own copy blurred to 2 m): their big
// patches of moss and gravel showed the 16 m repeat as a grid from the ship (9 Nov). Patches of 10-100 m come from
// the aerial grass at 128 m, turned, blurred to 8 m.
// Light and dark only: the grass scans average yellow-brown, so their grey stones divided out as blue and read as
// lilac patches against the teal (9 Nov). Haven's hue comes from the cover's tint.
grass *= lerp(1.0, RATIO(gc, GRASS_MEAN, 0.0), near) * lerp(1.0, RATIO(gmc, gml, 0.0), midNear);
// (blurred to 32 m and at 0.35: blurred to 8 m and at 0.6 they showed the 128 m repeat as a checker from the ship)
float3 patches = TURNED(GrassMidA, 128.0, 10.0);
grass *= lerp(1.0, RATIO(patches, GRASSMID_MEAN, 0.0), 0.35 * far);
float3 rock = ROCK_COL * lerp(1.0, RATIO(rc, ROCK_MEAN, 0.5), near) * lerp(1.0, RATIO(rmc, rml, 0.6), midNear);
// Wet sand is about half as bright as dry (under the clear shallows it glowed neon, 9 Nov).
float3 sand = SAND_COL * lerp(1.0, RATIO(sc, SAND_MEAN, 0.4), near) * (1.0 - 0.6 * wet);
float3 bed = BED_COL * lerp(1.0, RATIO(bc, BED_MEAN, 0.0), near);
float3 broadc = SX(GrassMidA, 512.0).rgb * bw.x + SY(GrassMidA, 512.0).rgb * bw.y + SZ(GrassMidA, 512.0).rgb * bw.z;
float broad = lerp(1.0, dot(broadc, lumw) / dot(GRASSMID_MEAN, lumw), 0.2 * far);
float occ = lerp(1.0, W.x * ga + W.y * ra + W.z * sa + W.w * ba, 0.6 * near);
float3 c = (W.x * grass + W.y * rock + W.z * sand + W.w * bed) * broad * occ;

Rough = lerp(dot(W, float4(0.92, 0.8, 0.86, 0.65)), dot(W, float4(gr, rr, sr, br)), near) - 0.25 * wet;
// Grass is a canopy that drinks light: little specular, or it mirrors the warm horizon and goes olive far off.
Spec = dot(W, float4(0.2, 0.45, 0.4, 0.5));
// The scans' relief: the near layers out to 150 m, the aerial ones out to 6 km.
float3 dn = W.x * (gn - n) + W.y * (rn - n) + W.z * (sn - n) + W.w * (bn - n);
float3 dm = W.x * (gmn - n) + W.y * (rmn - n);
NormalWS = normalize(n + dn * near + dm * (mid * (1.0 - near) * 0.3));  // (0.7 lit the aerial repeat as a faint weave from 600 m)
return c;
"""

SEA_HLSL = """
float3 P = float3(UV0.x, UV0.y, UV1.x);
float3 n = normalize(Nrm);
float fade = saturate(1.0 - Depth / 400000.0);  // (PixelDepth is in cm: the waves are drawn out to 4 km)
// Waves whose wave vectors are whole numbers of cycles per 2,048 m on each axis, so they line up across tiles
// (each tile's coordinates start on a 2,048 m grid). Deep-water speeds; x: cycles east, y: north, z: up, w: steepness.
const float K = 6.2831853 / 2048.0;
float4 waves[10] = {
    float4(61, 23, 0, 0.05), float4(-37, 71, 0, 0.045), float4(113, -52, 0, 0.04), float4(-170, -95, 0, 0.035),
    float4(240, 133, 0, 0.03), float4(-311, 205, 0, 0.025), float4(0, 41, 67, 0.05), float4(59, 0, -83, 0.05),
    float4(0, -150, 120, 0.035), float4(140, 0, 170, 0.035)};
float3 g = 0;
for (int i = 0; i < 10; i++)
{
    float3 k = waves[i].xyz * K;
    float kl = length(k);
    float a = waves[i].w / kl;
    float ph = dot(k, P) - sqrt(9.81 * kl) * T;
    g += a * k * cos(ph);
}
g -= n * dot(g, n);
return normalize(n - g * fade);
"""


def ground_material(scans, info):
    folder = DEST + "/Materials"
    mat = fresh(unreal.Material, "M_PlanetGround", unreal.MaterialFactoryNew(), folder)
    mat.set_editor_property("tangent_space_normal", False)  # the shader gives the normal in the world
    code = GROUND_HLSL
    values = {
        "GRASS_HEATH": f3(GRASS_HEATH), "GRASS_LUSH": f3(GRASS_LUSH), "GRASS_DRY": f3(GRASS_DRY),
        "ROCK_COL": f3(ROCK), "SAND_COL": f3(SAND), "BED_COL": f3(BED),
    }
    for layer, (scan, size) in LAYERS.items():
        key = layer.upper()
        values[key + "_MEAN"] = f3(info[scan]["mean"])
        values[key + "_S"] = f"{size:.1f}"
    for k in sorted(values, key=len, reverse=True):  # longest first: GRASSMID_MEAN before GRASS_MEAN
        code = code.replace(k, values[k])
    pins = ["UV0", "UV1", "Nrm", "Wrgb", "Wa", "TW", "Depth"]
    for layer in LAYERS:
        pins += [layer + "A", layer + "B"]
    c = custom(mat, -500, 0, "Ground", code, pins, unreal.CustomMaterialOutputType.CMOT_FLOAT3,
               [("Rough", unreal.CustomMaterialOutputType.CMOT_FLOAT1),
                ("Spec", unreal.CustomMaterialOutputType.CMOT_FLOAT1),
                ("NormalWS", unreal.CustomMaterialOutputType.CMOT_FLOAT3)])
    uv = [node(mat, unreal.MaterialExpressionTextureCoordinate, -1300, -300 + 90 * i, coordinate_index=i) for i in range(3)]
    vc = node(mat, unreal.MaterialExpressionVertexColor, -1300, 0)
    nrm = node(mat, unreal.MaterialExpressionVertexNormalWS, -1300, 150)
    depth = node(mat, unreal.MaterialExpressionPixelDepth, -1300, 230)
    mel.connect_material_expressions(uv[0], "", c, "UV0")
    mel.connect_material_expressions(uv[1], "", c, "UV1")
    mel.connect_material_expressions(uv[2], "", c, "TW")
    mel.connect_material_expressions(vc, "", c, "Wrgb")
    mel.connect_material_expressions(vc, "A", c, "Wa")
    mel.connect_material_expressions(nrm, "", c, "Nrm")
    mel.connect_material_expressions(depth, "", c, "Depth")
    y = 320
    for layer, (scan, _) in LAYERS.items():
        for part in ("A", "B"):
            o = node(mat, unreal.MaterialExpressionTextureObject, -1300, y, texture=scans[(scan, part)])
            o.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if part == "A"
                                  else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
            mel.connect_material_expressions(o, "", c, layer + part)
            y += 110
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(c, "Rough", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(c, "Spec", unreal.MaterialProperty.MP_SPECULAR)
    mel.connect_material_property(c, "NormalWS", unreal.MaterialProperty.MP_NORMAL)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def sea_material():
    folder = DEST + "/Materials"
    mat = fresh(unreal.Material, "M_PlanetSea", unreal.MaterialFactoryNew(), folder)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_SINGLE_LAYER_WATER)
    mat.set_editor_property("tangent_space_normal", False)
    c = custom(mat, -500, 0, "Waves", SEA_HLSL, ["UV0", "UV1", "Nrm", "Depth", "T"],
               unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    for i, pin in enumerate(("UV0", "UV1")):
        mel.connect_material_expressions(node(mat, unreal.MaterialExpressionTextureCoordinate, -900, -200 + 90 * i,
                                              coordinate_index=i), "", c, pin)
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionVertexNormalWS, -900, 0), "", c, "Nrm")
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionPixelDepth, -900, 80), "", c, "Depth")
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionTime, -900, 160), "", c, "T")
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_NORMAL)

    def const(v, x, y):
        if isinstance(v, tuple):
            return node(mat, unreal.MaterialExpressionConstant3Vector, x, y, constant=unreal.LinearColor(*v, 1.0))
        return node(mat, unreal.MaterialExpressionConstant, x, y, r=v)

    mel.connect_material_property(const((0.0, 0.0, 0.0), -300, -300), "", unreal.MaterialProperty.MP_BASE_COLOR)
    # Smooth up close, rougher as the waves grow too small to draw (their glitter blurs into a sheen), matching the
    # far sea's 0.25 where the two meet (a hard square of glare showed at the seam, 9 Nov).
    rough = custom(mat, -500, -260, "Roughness", "return lerp(0.04, 0.25, saturate(D / 2500000.0));", ["D"],
                   unreal.CustomMaterialOutputType.CMOT_FLOAT1)
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionPixelDepth, -800, -260), "", rough, "D")
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(const(0.0, -300, -160), "", unreal.MaterialProperty.MP_OPACITY)  # 0: all water
    out = node(mat, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, 0, 300)
    # HAVEN.md: clear fresh water, jade in the shallows (#2f6d63), dark teal where deep (#0b2629): red goes in
    # the first metres (pure water absorbs about 0.35 per metre at 650 nm, 0.06 at 550), blue a little faster than
    # green, and a little green-blue light scattered back. Unreal wants these per centimetre.
    def pin(src, names):
        for n in names:
            if mel.connect_material_expressions(src, "", out, n):
                return
        raise RuntimeError("no water pin " + names[0])

    # Scattering a tenth of that guess: at 0.017 per metre the sea came out milky white from orbit (9 Nov).
    pin(const((0.000002, 0.000008, 0.000007), -300, 250), ("Scattering Coefficients", "ScatteringCoefficients"))
    # (green and blue absorbed a little faster than pure water: the shallows were a bright neon band, HAVEN.md wants
    # a muted jade, #2f6d63)
    pin(const((0.0045, 0.0009, 0.0007), -300, 330), ("Absorption Coefficients", "AbsorptionCoefficients"))  # blue at 0.0011 left the shallows grass-green (30, 77, 57)
    pin(const(0.25, -300, 410), ("Phase G", "PhaseG"))
    pin(const(1.0, -300, 470), ("Color Scale Behind Water", "ColorScaleBehindWater"))
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def far_sea_material():
    """The sea on tiles far from the camera: plain lit deep water. Rough enough (0.3) that the light's reflection
    spreads into the broad sheen seen from orbit (ASSET_JOB: a glint is a sheen, never a hot spot)."""
    folder = DEST + "/Materials"
    mat = fresh(unreal.Material, "M_PlanetSeaFar", unreal.MaterialFactoryNew(), folder)
    base = node(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=unreal.LinearColor(0.004, 0.017, 0.019, 1))
    rough = node(mat, unreal.MaterialExpressionConstant, -400, 150, r=0.25)  # the near sea's roughness where they meet
    # Water's reflectance (2% head on), not the default 4%: the far sea's glint was twice the near sea's and a hard
    # edge showed where they met (9 Nov).
    spec = node(mat, unreal.MaterialExpressionConstant, -400, 250, r=0.25)
    mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)
    mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def spawn(cls, loc=unreal.Vector(0, 0, 0), rot=unreal.Rotator(0, 0, 0), label=None):
    a = actors.spawn_actor_from_class(cls, loc, rot)
    a.set_editor_property("tags", [TAG])
    if label:
        a.set_actor_label(label)
    return a


def open_level():
    current = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    if current and current.get_path_name().startswith(LEVEL + "."):
        pass
    elif assets.does_asset_exist(LEVEL):
        levels.load_level(LEVEL)
    elif not levels.new_level(LEVEL):
        raise RuntimeError("could not make " + LEVEL)
    for a in actors.get_all_level_actors():
        if TAG in [str(t) for t in a.get_editor_property("tags")]:
            actors.destroy_actor(a)


def build_level(ground, sea, far_sea):
    open_level()
    world = unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world()
    ws = world.get_world_settings()
    ws.set_editor_property("default_game_mode", unreal.load_class(None, "/Script/Rewild.RewildWorldGameMode"))
    ws.set_editor_property("enable_world_bounds_checks", False)  # the far side of Haven is 11,460 km below

    planet = spawn(unreal.RewildPlanet, unreal.Vector(0, 0, -R_HAVEN), label="Haven")
    planet.set_editor_property("world", "Haven")
    planet.set_editor_property("ground_material", ground)
    planet.set_editor_property("sea_material", sea)
    planet.set_editor_property("far_sea_material", far_sea)

    e = math.radians(TON618_ELEVATION)
    toward = unreal.Vector(math.cos(e), 0.0, math.sin(e))
    light = spawn(unreal.DirectionalLight, rot=unreal.MathLibrary.make_rot_from_x(toward * -1.0), label="TON 618")
    light.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    lc = light.light_component
    lc.set_editor_property("intensity", TON618_LUX)
    lc.set_editor_property("light_color", unreal.Color(r=TON618_COLOUR[0], g=TON618_COLOUR[1], b=TON618_COLOUR[2], a=255))
    lc.set_editor_property("atmosphere_sun_light", True)
    lc.set_editor_property("light_source_angle", TON618_ANGLE)
    # The hole and its disk are drawn later (HAVEN.md step 4); the atmosphere must not paint a sun disk meanwhile.
    lc.set_editor_property("atmosphere_sun_disk_color_scale", unreal.LinearColor(0, 0, 0, 1))
    lc.set_editor_property("cast_shadows", True)

    skylight = spawn(unreal.SkyLight, label="Sky light")
    skylight.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    skylight.light_component.set_editor_property("real_time_capture", True)
    skylight.light_component.set_editor_property("lower_hemisphere_is_black", False)

    ppv = spawn(unreal.PostProcessVolume, label="Exposure")
    ppv.set_editor_property("unbound", True)
    s = ppv.get_editor_property("settings")
    for k, v in {
        "auto_exposure_method": unreal.AutoExposureMethod.AEM_MANUAL,
        "auto_exposure_apply_physical_camera_exposure": False,
        "auto_exposure_bias": -EV100,
        "vignette_intensity": 0.2,
        "bloom_intensity": 0.25,  # the default flared the light's reflection on the sea into a white disc
        "blue_correction": 0.6,  # the default; 1.0 (right for the limb of Earth) greyed the teal
        "lens_flare_intensity": 0.0,
        "expand_gamut": 0.0,
    }.items():
        s.set_editor_property("override_" + k, True)
        s.set_editor_property(k, v)
    ppv.set_editor_property("settings", s)

    spawn(unreal.PlayerStart, unreal.Vector(0, 0, 100_000.0), label="Start")

    if not levels.save_current_level():
        raise RuntimeError("could not save " + LEVEL)
    shots.log("level built: " + LEVEL)


def main():
    shots.start()
    try:
        with open(os.path.join(SCANS, "scans.json"), encoding="utf-8") as f:
            info = json.load(f)
        # The first ground photographs (ambientCG, 1K) are replaced by the scans.
        for old in ("T_Rock", "T_Rock_N", "T_Soil", "T_Soil_N", "T_Sand", "T_Sand_N"):
            if assets.does_asset_exist(f"{DEST}/Textures/{old}"):
                assets.delete_asset(f"{DEST}/Textures/{old}")
        scans = {(scan, part): import_scan(scan, part) for scan, _ in LAYERS.values() for part in ("A", "B")}
        ground = ground_material(scans, info)
        sea = sea_material()
        build_level(ground, sea, far_sea_material())
        shots.finish(True)
    except Exception as e:  # noqa: BLE001
        shots.fail(e)


main()
