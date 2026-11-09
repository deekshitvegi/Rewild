"""Build Haven's level and the planet's materials (docs/unreal/HAVEN.md, step 3: the planet system).

Run prepare_haven.py first (system Python), then this in the editor (rewild_shots.py's command line). It imports the
ground photographs into /Game/Worlds/Haven/Textures, makes M_PlanetGround and M_PlanetSea in
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


def import_texture(name, normal):
    folder = DEST + "/Textures"
    path = f"{folder}/{name}"
    task = unreal.AssetImportTask()
    task.filename = os.path.join(RAW, name + ".png")
    task.destination_path = folder
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = False
    tools.import_asset_tasks([task])
    tex = unreal.load_asset(path)
    if normal:
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
    assets.save_loaded_asset(tex)
    return tex


def f3(c):
    return f"float3({c[0]:.5f}, {c[1]:.5f}, {c[2]:.5f})"


GROUND_HLSL = """
float3 P = float3(UV0.x, UV0.y, UV1.x);
float3 n = normalize(Nrm);
float3 bw = pow(abs(n), 4.0);
bw /= (bw.x + bw.y + bw.z);
float4 W = float4(Wrgb.rgb, Wa);
W /= max(1e-3, W.x + W.y + W.z + W.w);
float near = saturate(1.0 - Depth / 150000.0);
near *= near;
float3 lumw = float3(0.2126, 0.7152, 0.0722);
// Texture2DSample, not .Sample: ray-traced lighting runs this too, where only explicit mip levels are allowed.
#define TRI(T, s) (Texture2DSample(T, T##Sampler, P.yz / (s)).rgb * bw.x + Texture2DSample(T, T##Sampler, P.xz / (s)).rgb * bw.y + Texture2DSample(T, T##Sampler, P.xy / (s)).rgb * bw.z)
// Broad mottling, seen from the ship and the air (a 256 m and a 1,024 m pattern), gone by orbit.
float mott = 0.6 * dot(TRI(Soil, 256.0), lumw) / SOIL_LUM + 0.4 * dot(TRI(Soil, 1024.0), lumw) / SOIL_LUM;
mott = lerp(1.0, mott, 0.35 * saturate(1.0 - Depth / 3000000.0));
// Grass: the colour from the cover's slow tint; from the soil photograph only its light and dark.
float3 grass = TW.x < 0.0 ? lerp(GRASS_LUSH, GRASS_HEATH, saturate(-TW.x * 1.4)) : lerp(GRASS_LUSH, GRASS_DRY, saturate(TW.x * 1.4));
float soil = dot(TRI(Soil, 2.0), lumw) * 0.6 / SOIL_LUM + dot(TRI(Soil, 8.0), lumw) * 0.4 / SOIL_LUM;
float gd = lerp(1.0, pow(max(soil, 0.0), 0.7), near);
float3 rd = lerp(1.0, (TRI(Rock, 4.0) * 0.6 + TRI(Rock, 16.0) * 0.4) / ROCK_MEAN, near);
float sd = lerp(1.0, dot(TRI(Sand, 3.0) / SAND_MEAN, lumw), near);
float wet = saturate(TW.y);
// Wet sand is about half as bright as dry (under the clear shallows it glowed neon, 9 Nov).
float3 c = W.x * grass * gd + W.y * ROCK_COL * rd + W.z * SAND_COL * sd * (1.0 - 0.6 * wet) + W.w * BED_COL * gd;
Rough = dot(W, float4(0.92, 0.78, 0.86, 0.6)) - 0.2 * wet;
// Grass is a canopy that drinks light: little specular, or it mirrors the warm horizon and goes olive far off.
Spec = dot(W, float4(0.2, 0.45, 0.4, 0.5));
return c * mott;
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


def ground_material(tex, means):
    folder = DEST + "/Materials"
    mat = fresh(unreal.Material, "M_PlanetGround", unreal.MaterialFactoryNew(), folder)
    lum = lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]  # noqa: E731
    code = GROUND_HLSL
    for k, v in {
        "SOIL_LUM": f"{lum(means['T_Soil']):.5f}",
        "ROCK_MEAN": f3(means["T_Rock"]),
        "SAND_MEAN": f3(means["T_Sand"]),
        "GRASS_HEATH": f3(GRASS_HEATH), "GRASS_LUSH": f3(GRASS_LUSH), "GRASS_DRY": f3(GRASS_DRY),
        "ROCK_COL": f3(ROCK), "SAND_COL": f3(SAND), "BED_COL": f3(BED),
    }.items():
        code = code.replace(k, v)
    pins = ["UV0", "UV1", "Nrm", "Wrgb", "Wa", "TW", "Depth", "Rock", "Soil", "Sand"]
    c = custom(mat, -500, 0, "Ground", code, pins, unreal.CustomMaterialOutputType.CMOT_FLOAT3,
               [("Rough", unreal.CustomMaterialOutputType.CMOT_FLOAT1), ("Spec", unreal.CustomMaterialOutputType.CMOT_FLOAT1)])
    uv = [node(mat, unreal.MaterialExpressionTextureCoordinate, -1100, -300 + 90 * i, coordinate_index=i) for i in range(3)]
    vc = node(mat, unreal.MaterialExpressionVertexColor, -1100, 0)
    nrm = node(mat, unreal.MaterialExpressionVertexNormalWS, -1100, 150)
    depth = node(mat, unreal.MaterialExpressionPixelDepth, -1100, 230)
    objs = {k: node(mat, unreal.MaterialExpressionTextureObject, -1100, 320 + 110 * i, texture=tex[t])
            for i, (k, t) in enumerate((("Rock", "T_Rock"), ("Soil", "T_Soil"), ("Sand", "T_Sand")))}
    mel.connect_material_expressions(uv[0], "", c, "UV0")
    mel.connect_material_expressions(uv[1], "", c, "UV1")
    mel.connect_material_expressions(uv[2], "", c, "TW")
    mel.connect_material_expressions(vc, "", c, "Wrgb")
    mel.connect_material_expressions(vc, "A", c, "Wa")
    mel.connect_material_expressions(nrm, "", c, "Nrm")
    mel.connect_material_expressions(depth, "", c, "Depth")
    for k, o in objs.items():
        mel.connect_material_expressions(o, "", c, k)
    mel.connect_material_property(c, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(c, "Rough", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(c, "Spec", unreal.MaterialProperty.MP_SPECULAR)
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
        with open(os.path.join(RAW, "textures.json")) as f:
            means = json.load(f)["means"]
        tex = {n: import_texture(n, n.endswith("_N")) for n in ("T_Rock", "T_Rock_N", "T_Soil", "T_Soil_N", "T_Sand", "T_Sand_N")}
        ground = ground_material(tex, means)
        sea = sea_material()
        build_level(ground, sea, far_sea_material())
        shots.finish(True)
    except Exception as e:  # noqa: BLE001
        shots.fail(e)


main()
