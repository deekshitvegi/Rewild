"""Build Earth from orbit in Unreal and take stills (first fight, milestone 1).

Needs RawSources/earth (fetch_earth.py, prepare_earth.py, make_planet_mesh.py). Run with rewild_shots.py's
command line. Imports into /Game/Generated/Earth (not in git; rebuilt on each PC), builds the level
/Game/Generated/Earth/L_EarthStills and takes stills into Saved/Screenshots/WindowsEditor/Earth_*.png.

Frame: the fight is at the world origin, 400 km above Earth; Earth's centre is straight below. World +X is
north at the point below, +Y east, +Z up. Units are centimetres.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import unreal  # noqa: E402

import rewild_shots as shots  # noqa: E402

R_EARTH = 637_100_000.0  # cm (6,371 km)
ALTITUDE = 40_000_000.0  # cm (400 km)
CENTRE = unreal.Vector(0, 0, -(R_EARTH + ALTITUDE))
BELOW = (30.0, 25.0)  # latitude, longitude under the fight: Libya and Egypt, the Nile and the Red Sea to the east
SUN = (35.0, 225.0)  # sun elevation and azimuth (from north, clockwise) at the point below: mid afternoon
EV100 = 14.5  # exposure of the stills (15 left the desert about 0.7 stop darker than the ISS photographs)
# Graded against ISS photographs (8 Nov 2026, A/B renders AB_0..AB_4): at Unreal's defaults the haze washed the
# ground out from space (Red Sea RGB 57, 86, 127 where photographs show about 5-25, 20-40, 50-80) and ozone
# turned the limb lavender. Half the aerial perspective distance and half the ozone match the photographs.
AERIAL_PERSPECTIVE_SCALE = 0.5
OZONE_SCALE = 0.5
# Open-ocean reflectance seen from space (linear): little red, some green, most in the blue (water-leaving
# reflectance about 0.001-0.002 red, 0.008 green, 0.03-0.04 blue); the sky's reflection and glint add the rest.
DEEP_SEA = (0.002, 0.008, 0.032)

DEST = "/Game/Generated/Earth"
LEVEL = "/Game/Generated/Earth/L_EarthStills"  # rebuilt by this script every run, so not in git
TAG = "earth_build"
RAW = os.path.join(
    unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir()), "RawSources", "earth"
)

# (file, azimuth, pitch, field of view): the views an ISS photograph would have
STILLS = [
    ("Earth_oblique_east.png", 120.0, -35.0, 60.0),  # towards the Nile and the Red Sea
    ("Earth_limb_sunward.png", 225.0, -26.0, 60.0),  # towards the sun: the limb and any sun glint
    ("Earth_down_north.png", 0.0, -55.0, 60.0),  # down towards the Mediterranean coast
]

tools = unreal.AssetToolsHelpers.get_asset_tools()
assets = unreal.EditorAssetLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
mel = unreal.MaterialEditingLibrary


def import_file(filename, name):
    path = f"{DEST}/{name}"
    if assets.does_asset_exist(path):
        return unreal.load_asset(path)
    task = unreal.AssetImportTask()
    task.filename = os.path.join(RAW, filename)
    task.destination_path = DEST
    task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    shots.log(f"imported {filename}: {list(task.imported_object_paths)}")
    if not assets.does_asset_exist(path):  # some importers keep their own name
        found = [p for p in task.imported_object_paths if p.split(".")[0].endswith("/" + name)]
        path = (found or list(task.imported_object_paths))[0].split(".")[0]
    return unreal.load_asset(path)


TILES = [f"{c}{r}" for r in (1, 2) for c in "ABCD"]  # A-D west to east from 180 W; 1 north, 2 south


def textures():
    """Eight 16,384 px tiles, each its own virtual texture (all eight as one UDIM texture needs about 19 GB
    to build and ran the editor out of memory), plus the land/water mask."""
    tiles = {}
    for t in TILES:
        tex = import_file(f"T_Earth_{t}.jpg", f"T_Earth_{t}")
        tex.set_editor_property("srgb", True)
        tex.set_editor_property("virtual_texture_streaming", True)
        tex.set_editor_property("lod_group", unreal.TextureGroup.TEXTUREGROUP_WORLD)
        tex.set_editor_property("address_x", unreal.TextureAddress.TA_CLAMP)  # no bleeding across tile edges
        tex.set_editor_property("address_y", unreal.TextureAddress.TA_CLAMP)
        assets.save_loaded_asset(tex)
        tiles[t] = tex
    masks = {}
    for name in ("Water", "Depth"):
        tex = import_file(f"Earth_{name}.png", f"T_Earth_{name}")
        tex.set_editor_property("srgb", False)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
        assets.save_loaded_asset(tex)
        masks[name] = tex
    return tiles, masks


def scalar_param(mat, name, x, y):
    p = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, x, y)
    p.set_editor_property("parameter_name", name)
    return p


def material(tiles, masks):
    """M_Earth draws one tile (parameters Albedo, TileU, TileV); MI_Earth_<tile> sets them per mesh section."""
    path = f"{DEST}/M_Earth"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    mat = tools.create_asset("M_Earth", DEST, unreal.Material, unreal.MaterialFactoryNew())

    uv = mel.create_material_expression(mat, unreal.MaterialExpressionTextureCoordinate, -1100, 0)
    scale = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -900, 0)
    grid = mel.create_material_expression(mat, unreal.MaterialExpressionConstant2Vector, -1100, 120)
    grid.set_editor_property("r", 4.0)  # 4 tiles west to east
    grid.set_editor_property("g", 2.0)  # 2 tiles north to south (Unreal's v runs north to south)
    mel.connect_material_expressions(uv, "", scale, "A")
    mel.connect_material_expressions(grid, "", scale, "B")
    offset = mel.create_material_expression(mat, unreal.MaterialExpressionAppendVector, -900, 200)
    mel.connect_material_expressions(scalar_param(mat, "TileU", -1100, 220), "", offset, "A")
    mel.connect_material_expressions(scalar_param(mat, "TileV", -1100, 300), "", offset, "B")
    local = mel.create_material_expression(mat, unreal.MaterialExpressionSubtract, -700, 60)
    mel.connect_material_expressions(scale, "", local, "A")
    mel.connect_material_expressions(offset, "", local, "B")

    col = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSampleParameter2D, -450, -100)
    col.set_editor_property("parameter_name", "Albedo")
    col.set_editor_property("texture", tiles["A1"])
    col.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_VIRTUAL_COLOR)
    mel.connect_material_expressions(local, "", col, "UVs")

    sea = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -450, 250)
    sea.set_editor_property("texture", masks["Water"])
    sea.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
    mel.connect_material_expressions(uv, "", sea, "UVs")

    # Deep water is painted from GEBCO depth (Blue Marble's near-black sea breaks into blocks once compressed);
    # Blue Marble stays over shelves and reefs, fading out between about 200 m and 1,500 m deep.
    depth = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, -450, 500)
    depth.set_editor_property("texture", masks["Depth"])
    depth.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
    mel.connect_material_expressions(uv, "", depth, "UVs")
    below_shelf = mel.create_material_expression(mat, unreal.MaterialExpressionSubtract, -250, 500)
    below_shelf.set_editor_property("const_b", 0.02)
    mel.connect_material_expressions(depth, "R", below_shelf, "A")
    ramp = mel.create_material_expression(mat, unreal.MaterialExpressionDivide, -100, 500)
    ramp.set_editor_property("const_b", 0.10)
    mel.connect_material_expressions(below_shelf, "", ramp, "A")
    deep_amount = mel.create_material_expression(mat, unreal.MaterialExpressionSaturate, 50, 500)
    mel.connect_material_expressions(ramp, "", deep_amount, "")
    deep_sea = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, 200, 450)
    mel.connect_material_expressions(deep_amount, "", deep_sea, "A")
    mel.connect_material_expressions(sea, "R", deep_sea, "B")
    navy = mel.create_material_expression(mat, unreal.MaterialExpressionConstant3Vector, 200, 300)
    navy.set_editor_property("constant", unreal.LinearColor(*DEEP_SEA, 1.0))
    base = mel.create_material_expression(mat, unreal.MaterialExpressionLinearInterpolate, 400, 0)
    mel.connect_material_expressions(col, "RGB", base, "A")
    mel.connect_material_expressions(navy, "", base, "B")
    mel.connect_material_expressions(deep_sea, "", base, "Alpha")
    mel.connect_material_property(base, "", unreal.MaterialProperty.MP_BASE_COLOR)

    rough = mel.create_material_expression(mat, unreal.MaterialExpressionLinearInterpolate, -150, 250)
    rough.set_editor_property("const_a", 0.9)  # land
    rough.set_editor_property("const_b", 0.32)  # wind-roughened sea: a broad glint, as from the ISS
    mel.connect_material_expressions(sea, "R", rough, "Alpha")
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)

    spec = mel.create_material_expression(mat, unreal.MaterialExpressionLinearInterpolate, -150, 380)
    spec.set_editor_property("const_a", 0.5)  # land: Unreal's default, 4% reflectance head-on
    spec.set_editor_property("const_b", 0.25)  # water reflects 2% head-on (refractive index 1.33)
    mel.connect_material_expressions(sea, "R", spec, "Alpha")
    mel.connect_material_property(spec, "", unreal.MaterialProperty.MP_SPECULAR)

    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)

    instances = {}
    for t in TILES:
        name = f"MI_Earth_{t}"
        if assets.does_asset_exist(f"{DEST}/{name}"):
            assets.delete_asset(f"{DEST}/{name}")
        mi = tools.create_asset(name, DEST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, mat)
        mel.set_material_instance_texture_parameter_value(mi, "Albedo", tiles[t])
        mel.set_material_instance_scalar_parameter_value(mi, "TileU", float("ABCD".index(t[0])))
        mel.set_material_instance_scalar_parameter_value(mi, "TileV", float(int(t[1]) - 1))
        mel.update_material_instance(mi)
        assets.save_loaded_asset(mi)
        instances[t] = mi
    return instances


def planet_mesh(instances):
    mesh = import_file("SM_Planet.fbx", "SM_Planet")
    nanite = mesh.get_editor_property("nanite_settings")
    nanite.enabled = True
    mesh.set_editor_property("nanite_settings", nanite)
    slots = [str(m.get_editor_property("material_slot_name")) for m in mesh.get_editor_property("static_materials")]
    shots.log(f"planet slots {slots}")
    for i, slot in enumerate(slots):
        tile = slot.split("_")[-1]
        if tile not in instances:
            raise RuntimeError(f"planet mesh slot {slot} matches no tile")
        mesh.set_material(i, instances[tile])
    assets.save_loaded_asset(mesh)
    radius = mesh.get_bounds().box_extent.x
    shots.log(f"planet mesh radius {radius:.2f} cm")
    return mesh, radius


def frame_at(lat, lon):
    """Planet rotation that puts (lat, lon) straight below the origin with north along world +X."""
    p, l = math.radians(lat), math.radians(lon)
    up = (math.cos(p) * math.cos(l), -math.cos(p) * math.sin(l), math.sin(p))  # planet-local, east is -Y
    east = (-math.sin(l), -math.cos(l), 0.0)
    north = (-math.sin(p) * math.cos(l), math.sin(p) * math.sin(l), math.cos(p))
    # rows north, east, up map planet-local to world X, Y, Z; the object's own X and Z axes in world are columns
    x_axis = unreal.Vector(north[0], east[0], up[0])
    z_axis = unreal.Vector(north[2], east[2], up[2])
    return unreal.MathLibrary.make_rot_from_xz(x_axis, z_axis)


def direction(azimuth, elevation):
    a, e = math.radians(azimuth), math.radians(elevation)
    return unreal.Vector(math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))


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
        if not unreal.EditorLoadingAndSavingUtils.save_map(
            unreal.get_editor_subsystem(unreal.UnrealEditorSubsystem).get_editor_world(), LEVEL
        ):
            raise RuntimeError("could not make " + LEVEL)
    for a in actors.get_all_level_actors():
        if TAG in [str(t) for t in a.get_editor_property("tags")]:
            actors.destroy_actor(a)


def build_level(mesh, radius):
    open_level()

    earth = spawn(unreal.StaticMeshActor, CENTRE, frame_at(*BELOW), "Earth")
    smc = earth.static_mesh_component
    smc.set_static_mesh(mesh)
    smc.set_mobility(unreal.ComponentMobility.STATIC)
    earth.set_actor_scale3d(unreal.Vector(1, 1, 1) * (R_EARTH / radius))
    smc.set_cast_shadow(False)  # a sphere cannot shadow itself; keeps virtual shadow maps for the fight
    smc.set_editor_property("affect_distance_field_lighting", False)
    smc.set_editor_property("affect_dynamic_indirect_lighting", False)

    sky = spawn(unreal.SkyAtmosphere, CENTRE, label="Atmosphere")
    sc = sky.get_component_by_class(unreal.SkyAtmosphereComponent)
    sc.set_editor_property("transform_mode", unreal.SkyAtmosphereTransformMode.PLANET_CENTER_AT_COMPONENT_TRANSFORM)
    sc.set_editor_property("bottom_radius", R_EARTH / 100_000.0)  # km
    sc.set_editor_property("aerial_pespective_view_distance_scale", AERIAL_PERSPECTIVE_SCALE)  # sic: Unreal's spelling
    sc.set_editor_property("other_absorption_scale", sc.get_editor_property("other_absorption_scale") * OZONE_SCALE)

    toward_sun = direction(SUN[1], SUN[0])
    sun = spawn(unreal.DirectionalLight, rot=unreal.MathLibrary.make_rot_from_x(toward_sun * -1.0), label="Sun")
    sun.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    lc = sun.light_component
    lc.set_editor_property("intensity", 120_000.0)  # lux: sunlight above the atmosphere
    lc.set_editor_property("atmosphere_sun_light", True)
    lc.set_editor_property("light_source_angle", 0.5357)  # the Sun's real angular diameter

    skylight = spawn(unreal.SkyLight, label="Sky light")
    skylight.root_component.set_mobility(unreal.ComponentMobility.MOVABLE)
    skylight.light_component.set_editor_property("real_time_capture", True)

    ppv = spawn(unreal.PostProcessVolume, label="Exposure")
    ppv.set_editor_property("unbound", True)
    s = ppv.get_editor_property("settings")
    for k, v in {
        # A fixed photographic exposure for stills, as an ISS camera would use for the sunlit Earth (about
        # f/8, 1/500 s, ISO 100). Manual without the physical camera starts at EV100 0; the bias sets it.
        "auto_exposure_method": unreal.AutoExposureMethod.AEM_MANUAL,
        "auto_exposure_apply_physical_camera_exposure": False,
        "auto_exposure_bias": -EV100,
        "vignette_intensity": 0.15,
        # Unreal's filmic tone curve turns bright saturated blue toward purple (first stills: a lavender limb and
        # pink haze where the photographs are white-cyan and blue). Full blue correction, no gamut expansion.
        "blue_correction": 1.0,
        "expand_gamut": 0.0,
    }.items():
        s.set_editor_property("override_" + k, True)
        s.set_editor_property(k, v)
    ppv.set_editor_property("settings", s)

    cams = []
    for name, az, pitch, fov in STILLS:
        cam = spawn(unreal.CameraActor, rot=unreal.Rotator(roll=0, pitch=pitch, yaw=az), label="Cam_" + name[:-4])
        cam.camera_component.set_editor_property("field_of_view", fov)
        cams.append((name, cam))

    if not levels.save_current_level():
        raise RuntimeError("could not save " + LEVEL)
    shots.log("level built: " + LEVEL)
    return cams


def atmosphere_ab(cams):
    """Same view, one atmosphere ingredient off at a time, to find what washes the ground out."""
    sc = next(a for a in actors.get_all_level_actors() if isinstance(a, unreal.SkyAtmosphere)).get_component_by_class(
        unreal.SkyAtmosphereComponent
    )
    base = {k: sc.get_editor_property(k) for k in (
        "other_absorption_scale", "mie_scattering_scale", "mie_absorption_scale",
        "aerial_pespective_view_distance_scale", "multi_scattering_factor")}
    shots.log(f"atmosphere defaults {base}")

    def variant(**changes):
        def setup():
            for k, v in base.items():
                sc.set_editor_property(k, changes.get(k, v))
        return setup

    cam = cams[0][1]
    return [
        ("AB_0_baseline.png", cam, variant()),
        ("AB_1_no_ozone.png", cam, variant(other_absorption_scale=0.0)),
        ("AB_2_no_mie.png", cam, variant(mie_scattering_scale=0.0, mie_absorption_scale=0.0)),
        ("AB_3_half_aerial.png", cam, variant(aerial_pespective_view_distance_scale=0.5)),
        ("AB_4_no_multiscatter.png", cam, variant(multi_scattering_factor=0.0)),
    ]


shots.start()
try:
    tile_textures, mask_textures = textures()
    mesh, radius = planet_mesh(material(tile_textures, mask_textures))
    cams = build_level(mesh, radius)
    if "--ab" in sys.argv or os.environ.get("REWILD_AB"):
        cams = atmosphere_ab(cams)
    shots.take_shots(cams, settle=8.0)
except Exception as e:
    shots.fail(e)
