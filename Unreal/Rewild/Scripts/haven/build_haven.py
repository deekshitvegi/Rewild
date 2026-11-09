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
TON618_ELEVATION = 25.0   # degrees above the colony's horizon, toward +X (east). At 35 the hole and the horizon could not
                          # share one frame from the colony, as they do in the key art (9 Nov).
TON618_LUX = 60_000.0     # the disk's light at Haven
TON618_COLOUR = (255, 228, 200)  # warm, a little less than #ffd8b0: at #ffd8b0 the teal ground went olive
# Degrees. 8 made a flat, hard-edged plate of glare on the sea: Unreal reflects a wide light as one uniform disc
# (9 Nov). Its true look on the water comes with the hole drawn in the sky (HAVEN.md step 4); 2.5 keeps soft shadows.
TON618_ANGLE = 2.5
# TON 618 (HAVEN.md, "TON 618 in the sky"): the web version's ray tracer at the web version's own figures (the owner,
# 9 Nov: "can we have black hole more closer to the planet just like in the initial game"; 20 radii, matched to the key
# art's proportions, looked too far). Lengths in Schwarzschild radii.
HOLE_R0 = 13.18         # Haven's distance from the hole: 13 out and 2.2 above the disk, as web/components/expedition/bodies.ts
HOLE_HEIGHT = 2.2       # Haven above the disk's plane
HOLE_R_IN, HOLE_R_OUT = 2.2, 13.0  # the disk, as BlackHole.tsx
HOLE_ROLL = 12.0        # degrees the band is tilted in the sky, rising to the right
HOLE_DOPPLER = 0.35     # how much of the gas's orbital speed shows (Interstellar toned it down too)
HOLE_BRIGHT = 36000.0   # emissive at temperature 1 (nits): 80,000 washed it to cream; 45,000 still pale beside the key art
HOLE_SPIN = 0.04        # turn rate at the inner edge, radians a second (slower outward, as Kepler)
HOLE_STEPS = 400
HOLE_REACH = 100.0      # degrees from the hole's centre traced (this close, the disk floods half the sky)
HOLE_AIR = 0.92         # Haven's thin air lets this much of the hole's light through toward the colony
HOLE_GLOW = 1000.0      # nits at the centre of the air's glow round the disk (4,000 greyed the shadow)
SKY_RADIUS = 1.0e10     # cm: the sky sphere the hole is drawn on, 100,000 km round the planet

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
// Metres from the tile's texture origin: the vertex's place in its tile plus the tile's offset (full precision; the
// mesh's texture coordinates are half floats and drew bar codes 600 m out).
float3 P = LP / 100.0 + float3(TOX, TOY, TOZ);
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
Spec = dot(W, float4(0.06, 0.45, 0.4, 0.5));  // (0.2 still went beige looking toward TON 618, low in the sky)
// The scans' relief: the near layers out to 150 m, the aerial ones out to 6 km.
float3 dn = W.x * (gn - n) + W.y * (rn - n) + W.z * (sn - n) + W.w * (bn - n);
float3 dm = W.x * (gmn - n) + W.y * (rmn - n);
NormalWS = normalize(n + dn * near + dm * (mid * (1.0 - near) * 0.3));  // (0.7 lit the aerial repeat as a faint weave from 600 m)
return c;
"""

TON618_HLSL = """
// The camera's ray, into the hole's frame (y is the disk's axis); Haven's direction from the hole is OBS.
float3 view = -normalize(V);
float3 rd = float3(dot(view, HX), dot(view, HY), dot(view, HZ));
float3 e1 = OBS;
float a = dot(rd, e1);
float3 radiance = 0;
// Haven's air scatters a faint blue-white glow round the disk, longest along the band (as in the key art).
float3 bandAxis = normalize(cross(-e1, float3(0, 1, 0)));
float3 upAxis = cross(bandAxis, -e1);
float gx = dot(rd, bandAxis) / 0.7, gy = dot(rd, upAxis) / 0.28;
float3 glow = float3(0.55, 0.70, 1.0) * GLOW * exp(-(gx * gx + gy * gy)) * step(0.0, -a);
if (a > SKIP_ABOVE) return glow;  // farther than REACH from the hole's centre
float3 nrm = cross(e1, rd);
float nl = length(nrm);
if (nl < 1e-6) return glow;
nrm /= nl;
float3 e2 = cross(nrm, e1);
float b = max(dot(rd, e2), 1e-6);
float r0 = R0;
// Binet's equation for light round a Schwarzschild hole (u = 1 / r, r_s = 1), traced back from the camera with
// fourth-order Runge-Kutta in the angle round the hole (port of web/components/expedition/BlackHole.tsx).
float2 s = float2(1.0 / r0, -a * sqrt(max(1.0 - 1.0 / r0, 0.0)) / (b * r0));
float phi = 0.0;
float nextCross = 1e9;
if (abs(e1.y) + abs(e2.y) > 1e-5)
{
    nextCross = atan2(-e1.y, e2.y);
    if (nextCross <= 1e-4) nextCross += 3.14159265;
}
float images = 0.0;
float trans = 1.0;
bool captured = false;
// The disk's pattern turns with the gas, the inner parts faster; two copies half a cycle apart crossfade, so the
// shear never winds up over a long game.
float cycle = frac(T / 240.0);
float ta = cycle * 240.0;
float tb = frac(cycle + 0.5) * 240.0;
float wb = abs(cycle * 2.0 - 1.0);
#define HASH(p) frac(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453)
#define VNOISE(p, o) { float3 i_ = floor(p); float3 f_ = frac(p); float3 u_ = f_ * f_ * (3.0 - 2.0 * f_); \
    o = lerp(lerp(lerp(HASH(i_), HASH(i_ + float3(1, 0, 0)), u_.x), lerp(HASH(i_ + float3(0, 1, 0)), HASH(i_ + float3(1, 1, 0)), u_.x), u_.y), \
             lerp(lerp(HASH(i_ + float3(0, 0, 1)), HASH(i_ + float3(1, 0, 1)), u_.x), lerp(HASH(i_ + float3(0, 1, 1)), HASH(i_ + float3(1, 1, 1)), u_.x), u_.y), u_.z) * 2.0 - 1.0; }
#define FBM(p, n, gain, o) { float amp_ = 0.5; float3 pp_ = p; o = 0.0; for (int k_ = 0; k_ < n; k_++) { float v_; VNOISE(pp_, v_); o += amp_ * v_; amp_ *= gain; pp_ *= 2.0; } }
// The gas's density at radius r, angle ang, for time t.
#define DENSITY(r, ang0, t, o) { float ang_ = ang0 - t * SPIN * pow(r / RIN, -1.5); float lr_ = log(r); \
    float3 q_ = float3(cos(ang_) * 2.2, sin(ang_) * 2.2, lr_ * 3.5); float broad_; FBM(q_, 3, 0.5, broad_); \
    float3 q2_ = float3(cos(ang_) * 5.0, sin(ang_) * 5.0, lr_ * 18.0 + broad_ * 3.0); float streak_; FBM(q2_, 3, 0.5, streak_); \
    o = clamp(0.6 + broad_ * 0.6 + streak_ * 0.45, 0.05, 1.3); }
[loop] for (int i = 0; i < STEPS; i++)
{
    float h = lerp(0.24, 0.075, smoothstep(0.03, 0.22, s.x));
    h = lerp(h, 0.012, smoothstep(0.25, 0.62, s.x));
    h = min(h, 0.08 * max(s.x, 1.0) / max(abs(s.y), 1e-4));
    float2 k1 = float2(s.y, -s.x + 1.5 * s.x * s.x);
    float2 s2 = s + 0.5 * h * k1;
    float2 k2 = float2(s2.y, -s2.x + 1.5 * s2.x * s2.x);
    float2 s3 = s + 0.5 * h * k2;
    float2 k3 = float2(s3.y, -s3.x + 1.5 * s3.x * s3.x);
    float2 s4 = s + h * k3;
    float2 k4 = float2(s4.y, -s4.x + 1.5 * s4.x * s4.x);
    float2 nxt = s + h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
    float nphi = phi + h;
    if (nphi >= nextCross && images < 4.0)
    {
        float t = (nextCross - phi) / h;
        float u = lerp(s.x, nxt.x, t);
        float du = lerp(s.y, nxt.y, t);
        if (u > 0.0 && u < 1.0)
        {
            float3 radial = cos(nextCross) * e1 + sin(nextCross) * e2;
            float3 around = -sin(nextCross) * e1 + cos(nextCross) * e2;
            float3 hit = radial / u;
            // the trace runs backward; the light travels the other way
            float3 travel = -normalize(radial * (-du / (u * u)) + around / u);
            float r = length(hit.xz);
            float edge = smoothstep(RIN, RIN + 0.4, r) * (1.0 - smoothstep(ROUT * 0.6, ROUT, r));
            if (edge > 0.0)
            {
                float ang = atan2(hit.z, hit.x);
                float da, db;
                DENSITY(r, ang, ta, da)
                DENSITY(r, ang, tb, db)
                float density = edge * lerp(da, db, wb);
                // a thin disk's temperature, highest just outside its inner edge
                float x = RIN / r;
                float temperature = 1.6 * pow(x, 0.75) * pow(max(1.0 - sqrt(x) * 0.96, 0.0), 0.25);
                // gravity and (toned down) the gas's motion shift its light
                float beta = DOPPLER * min(sqrt(0.5 / max(r - 1.0, 1e-3)), 0.5);
                float3 motion = normalize(float3(-hit.z, 0.0, hit.x));
                float g = sqrt(1.0 - 1.0 / r) * sqrt(1.0 - beta * beta) / (1.0 - beta * dot(motion, travel));
                float tt = temperature * g;
                // the key art's palette: dusky rose at the cool rim, peach, white-peach at the hot edge
                float3 c = lerp(float3(0.30, 0.08, 0.10), float3(0.95, 0.34, 0.18), smoothstep(0.15, 0.5, tt));
                c = lerp(c, float3(1.0, 0.54, 0.30), smoothstep(0.45, 0.85, tt));
                c = lerp(c, float3(1.0, 0.80, 0.62), smoothstep(0.8, 1.2, tt));
                c = lerp(c, float3(0.86, 0.90, 1.0), smoothstep(1.2, 1.9, tt));
                // the key art's blue-white at the disk's cool outer reaches
                c = lerp(c, float3(0.50, 0.66, 1.0) * dot(c, float3(0.3, 0.5, 0.2)) * 2.0, smoothstep(0.45, 0.9, r / ROUT) * 0.9);
                float3 col = c * density * g * g * g * (images >= 1.0 ? 0.8 : 1.0);
                float alpha = clamp(density * 0.9, 0.0, 0.96);
                radiance += trans * col * alpha;
                trans *= 1.0 - alpha;
            }
        }
        images += 1.0;
        nextCross += 3.14159265;
    }
    if (nxt.x >= 1.0 && nxt.y > 0.0) { captured = true; break; }  // through the horizon
    if (nxt.x <= 0.0) break;                 // escaped
    if (trans < 0.01) break;
    s = nxt;
    phi = nphi;
}
// the air's glow stays out of the shadow, which reads near black, as in the key art and the web game
return radiance * BRIGHT * AIR + glow * (captured ? 0.15 : 1.0);
"""

SEA_HLSL = """
float3 P = LP / 100.0 + float3(TOX, TOY, TOZ);
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


def tile_position(mat, c, x):
    """The vertex's position in its tile (cm) and the tile's offset from its texture origin (m, custom primitive
    data 0-2, set by RewildPlanet), into the custom node's LP and TOX/TOY/TOZ."""
    lp = node(mat, unreal.MaterialExpressionLocalPosition, x, -420)
    mel.connect_material_expressions(lp, "", c, "LP")
    for i, pin in enumerate(("TOX", "TOY", "TOZ")):
        p = node(mat, unreal.MaterialExpressionScalarParameter, x, -340 + 70 * i, parameter_name=pin)
        p.set_editor_property("use_custom_primitive_data", True)
        p.set_editor_property("primitive_data_index", i)
        mel.connect_material_expressions(p, "", c, pin)


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
    pins = ["LP", "TOX", "TOY", "TOZ", "Nrm", "Wrgb", "Wa", "TW", "Depth"]
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
    tile_position(mat, c, -1300)
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
    c = custom(mat, -500, 0, "Waves", SEA_HLSL, ["LP", "TOX", "TOY", "TOZ", "Nrm", "Depth", "T"],
               unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    tile_position(mat, c, -900)
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


def hole_frame():
    """The hole's frame in the world (x, y = the disk's axis, z) and Haven's direction from it, in that frame."""
    def norm(v):
        n = math.sqrt(sum(c * c for c in v))
        return tuple(c / n for c in v)

    def dot(a, b):
        return sum(x * y for x, y in zip(a, b))

    def cross(a, b):
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    def add(*vs):
        return tuple(sum(c) for c in zip(*vs))

    def mul(v, k):
        return tuple(c * k for c in v)

    e = math.radians(TON618_ELEVATION)
    toward = (math.cos(e), 0.0, math.sin(e))       # from the colony to the hole
    obs = mul(toward, -1.0)                          # from the hole to Haven
    up = norm(add((0.0, 0.0, 1.0), mul(toward, -toward[2])))
    side = cross(toward, up)
    roll = math.radians(HOLE_ROLL)
    w = add(mul(up, math.cos(roll)), mul(side, math.sin(roll)))
    el = math.asin(HOLE_HEIGHT / HOLE_R0)
    ny = norm(add(mul(obs, math.sin(el)), mul(w, math.cos(el))))  # the disk's axis
    nx = norm(cross(ny, toward))
    nz = cross(nx, ny)
    return nx, ny, nz, (dot(obs, nx), dot(obs, ny), dot(obs, nz))


def ton618_material():
    """TON 618, traced per pixel and added over Haven's sky (unlit, additive: behind the hole there is only dark
    space, so the shadow shows just the air in front of it, as the rest of the sky does)."""
    folder = DEST + "/Materials"
    mat = fresh(unreal.Material, "M_TON618", unreal.MaterialFactoryNew(), folder)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    mat.set_editor_property("two_sided", True)
    mat.set_editor_property("translucency_pass", unreal.MaterialTranslucencyPass.MTP_BEFORE_DOF)
    for prop in ("use_translucency_vertex_fog", "apply_fogging", "apply_cloud_fogging"):
        try:
            mat.set_editor_property(prop, False)  # the air is already in the sky behind it
        except Exception:  # noqa: BLE001
            pass
    nx, ny, nz, obs = hole_frame()
    code = TON618_HLSL
    vals = {
        # (written out as a value: "-COS" became "--0.17", a decrement, once the reach passed 90 degrees)
        "SKIP_ABOVE": f"({-math.cos(math.radians(HOLE_REACH)):.6f})", "STEPS": str(HOLE_STEPS),
        "R0": f"{HOLE_R0:.3f}", "RIN": f"{HOLE_R_IN:.3f}", "ROUT": f"{HOLE_R_OUT:.3f}",
        "DOPPLER": f"{HOLE_DOPPLER:.3f}", "SPIN": f"{HOLE_SPIN:.4f}", "BRIGHT": f"{HOLE_BRIGHT:.1f}", "AIR": f"{HOLE_AIR:.3f}",
        "GLOW": f"{HOLE_GLOW:.1f}",
        "HX": f3(nx), "HY": f3(ny), "HZ": f3(nz), "OBS": f3(obs),
    }
    for k in sorted(vals, key=len, reverse=True):
        code = code.replace(k, vals[k])
    c = custom(mat, -500, 0, "TON 618", code, ["V", "T"], unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionCameraVectorWS, -900, 0), "", c, "V")
    mel.connect_material_expressions(node(mat, unreal.MaterialExpressionTime, -900, 100), "", c, "T")
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
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


def build_level(ground, sea, far_sea, hole):
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
        "bloom_intensity": 0.45,  # 0.675 (the default) flared the sea's glint; 0.25 left TON 618 without its glow
        "blue_correction": 0.6,  # the default; 1.0 (right for the limb of Earth) greyed the teal
        "lens_flare_intensity": 0.0,
        "expand_gamut": 0.0,
    }.items():
        s.set_editor_property("override_" + k, True)
        s.set_editor_property(k, v)
    ppv.set_editor_property("settings", s)

    spawn(unreal.PlayerStart, unreal.Vector(0, 0, 100_000.0), label="Start")

    # TON 618 on a sphere 100,000 km round the planet's centre (the camera never leaves it; the material looks only
    # at the view's direction, so where on it a pixel lies does not matter).
    sphere = unreal.load_asset("/Engine/EngineSky/SM_SkySphere")
    sky = spawn(unreal.StaticMeshActor, unreal.Vector(0, 0, -R_HAVEN), label="TON 618")
    smc = sky.static_mesh_component
    smc.set_static_mesh(sphere)
    smc.set_mobility(unreal.ComponentMobility.MOVABLE)
    radius = sphere.get_bounds().sphere_radius
    sky.set_actor_scale3d(unreal.Vector(1, 1, 1) * (SKY_RADIUS / radius))
    smc.set_material(0, hole)
    smc.set_cast_shadow(False)
    smc.set_editor_property("translucency_sort_priority", -100)
    smc.set_editor_property("visible_in_ray_tracing", False)
    # Out of the sky light: in it, the disk's peach light warmed Haven's teal ground to beige (9 Nov).
    for prop in ("visible_in_real_time_sky_captures", "visible_in_reflection_captures"):
        smc.set_editor_property(prop, False)
    smc.set_editor_property("bounds_scale", 1.0)

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
        build_level(ground, sea, far_sea_material(), ton618_material())
        shots.finish(True)
    except Exception as e:  # noqa: BLE001
        shots.fail(e)


main()
