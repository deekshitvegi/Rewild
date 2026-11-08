"""Import the rebuilt fighter (art/fighter/export) into /Game/FirstFight/Fighter, make its materials, and take stills
of it over Earth (first fight, milestone 2). Run with rewild_shots.py's command line; needs build_earth.py's assets.

Materials: M_FighterPaint (master; paint colour and gloss, darkened in grooves by the baked cavity map and in
recesses by the AO map, with a faint panel-to-panel variation) and an instance per slot; M_FighterGlass (clear,
reflective); M_FighterEngine (the hot core; its Glow parameter is what the flight code turns up with throttle).
REWILD_REIMPORT=1 imports the model and maps again (after make_fighter.py changes).
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "earth"))
import unreal  # noqa: E402

import build_earth as earth  # noqa: E402
import rewild_shots as shots  # noqa: E402

DEST = "/Game/FirstFight/Fighter"
EXPORT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "art", "fighter", "export"))
TAG = "fighter_still"

tools = unreal.AssetToolsHelpers.get_asset_tools()
assets = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

# Slot name -> (colour (linear), roughness, metallic). White aircraft paint reflects about 70% (sRGB about 220);
# the red is a deep signal red; grey is the radome, belly and intake grey of the old model.
PAINT = {
    "M_Paint_White": ((0.70, 0.70, 0.68), 0.35, 0.0),
    "M_Paint_Red": ((0.42, 0.018, 0.016), 0.35, 0.0),
    "M_Paint_Grey": ((0.20, 0.21, 0.22), 0.45, 0.0),
    "M_Metal_Dark": ((0.045, 0.045, 0.05), 0.42, 0.7),
    "M_Canopy_Frame": ((0.07, 0.07, 0.075), 0.5, 0.0),
}
SOCKETS = ["Gun_L", "Gun_R", "Missile_L", "Missile_R", "Engine_L", "Engine_R", "Cockpit_Eye"]
ENGINE_GLOW = 4000.0  # emissive at full throttle: it must read hot against an exposure set for sunlit Earth (EV 14.5)


def reimport():
    return bool(os.environ.get("REWILD_REIMPORT"))


def import_file(path, name=None):
    target = f"{DEST}/{name}" if name else None
    if target and assets.does_asset_exist(target) and not reimport():
        return [target]
    task = unreal.AssetImportTask()
    task.filename = path
    task.destination_path = DEST
    if name:
        task.destination_name = name
    task.automated = True
    task.replace_existing = True
    task.save = True
    tools.import_asset_tasks([task])
    paths = [p.split(".")[0] for p in task.imported_object_paths]
    shots.log(f"imported {os.path.basename(path)}: {paths}")
    return paths


def mask_texture(name):
    path = import_file(os.path.join(EXPORT, "textures", f"{name}.png"), name)[0]
    tex = unreal.load_asset(path)
    tex.set_editor_property("srgb", False)
    tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_GRAYSCALE)
    assets.save_loaded_asset(tex)
    return tex


def fresh_material(name):
    path = f"{DEST}/{name}"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    return tools.create_asset(name, DEST, unreal.Material, unreal.MaterialFactoryNew())


def param(mat, cls, name, x, y, value=None):
    p = mel.create_material_expression(mat, cls, x, y)
    p.set_editor_property("parameter_name", name)
    if value is not None:
        p.set_editor_property("default_value", value)
    return p


def sample(mat, tex, x, y):
    s = mel.create_material_expression(mat, unreal.MaterialExpressionTextureSample, x, y)
    s.set_editor_property("texture", tex)
    s.set_editor_property("sampler_type", unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_GRAYSCALE)
    return s


def node(mat, cls, x, y, **props):
    n = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        n.set_editor_property(k, v)
    return n


def link(a, a_pin, b, b_pin):
    mel.connect_material_expressions(a, a_pin, b, b_pin)


def paint_material(ao_tex, cavity_tex):
    mat = fresh_material("M_FighterPaint")
    colour = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -900, -200, unreal.LinearColor(0.7, 0.7, 0.68, 1))
    rough = param(mat, unreal.MaterialExpressionScalarParameter, "Roughness", -900, 200, 0.35)
    metal = param(mat, unreal.MaterialExpressionScalarParameter, "Metallic", -900, 320, 0.0)
    ao = sample(mat, ao_tex, -900, 0)
    cav = sample(mat, cavity_tex, -900, 450)

    # Cavity: flat skin 0.5, grooves and recesses dark, convex edges bright. Grooves go dark and rough.
    cav2 = node(mat, unreal.MaterialExpressionMultiply, -650, 450, const_b=2.0)
    link(cav, "R", cav2, "A")
    groove = node(mat, unreal.MaterialExpressionSaturate, -500, 450)
    link(cav2, "", groove, "")
    groove_dark = node(mat, unreal.MaterialExpressionLinearInterpolate, -350, 450, const_a=0.35, const_b=1.0)
    link(groove, "", groove_dark, "Alpha")
    ao_dark = node(mat, unreal.MaterialExpressionLinearInterpolate, -650, 0, const_a=0.5, const_b=1.0)
    link(ao, "R", ao_dark, "Alpha")

    # A faint panel-to-panel variation (+-3%) so the paint is never one flat CG colour.
    pos = node(mat, unreal.MaterialExpressionLocalPosition, -900, 650)
    noise = node(mat, unreal.MaterialExpressionNoise, -700, 650, scale=0.004, levels=2, output_min=0.97, output_max=1.03)
    link(pos, "", noise, "Position")

    c1 = node(mat, unreal.MaterialExpressionMultiply, -350, -150)
    link(colour, "", c1, "A")
    link(ao_dark, "", c1, "B")
    c2 = node(mat, unreal.MaterialExpressionMultiply, -200, -100)
    link(c1, "", c2, "A")
    link(groove_dark, "", c2, "B")
    c3 = node(mat, unreal.MaterialExpressionMultiply, -50, -50)
    link(c2, "", c3, "A")
    link(noise, "", c3, "B")
    mel.connect_material_property(c3, "", unreal.MaterialProperty.MP_BASE_COLOR)

    inv = node(mat, unreal.MaterialExpressionOneMinus, -350, 300)
    link(groove, "", inv, "")
    rough_add = node(mat, unreal.MaterialExpressionMultiply, -200, 300, const_b=0.3)
    link(inv, "", rough_add, "A")
    r = node(mat, unreal.MaterialExpressionAdd, -50, 250)
    link(rough, "", r, "A")
    link(rough_add, "", r, "B")
    mel.connect_material_property(r, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
    mel.connect_material_property(ao, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)

    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def glass_material():
    mat = fresh_material("M_FighterGlass")
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    mat.set_editor_property("translucency_lighting_mode", unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING)
    tint = node(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=unreal.LinearColor(0.02, 0.025, 0.03, 1))
    mel.connect_material_property(tint, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(node(mat, unreal.MaterialExpressionConstant, -400, 150, r=0.04), "",
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    # Fresnel: nearly clear head-on, mirror-like at grazing angles, as a canopy is
    fres = node(mat, unreal.MaterialExpressionFresnel, -600, 300, exponent=4.0, base_reflect_fraction=0.08)
    op = node(mat, unreal.MaterialExpressionLinearInterpolate, -400, 300, const_a=0.1, const_b=0.75)
    link(fres, "", op, "Alpha")
    mel.connect_material_property(op, "", unreal.MaterialProperty.MP_OPACITY)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def engine_material():
    mat = fresh_material("M_FighterEngine")
    black = node(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=unreal.LinearColor(0.02, 0.02, 0.02, 1))
    mel.connect_material_property(black, "", unreal.MaterialProperty.MP_BASE_COLOR)
    hot = node(mat, unreal.MaterialExpressionConstant3Vector, -600, 200, constant=unreal.LinearColor(1.0, 0.42, 0.12, 1))
    glow = param(mat, unreal.MaterialExpressionScalarParameter, "Glow", -600, 350, ENGINE_GLOW)
    e = node(mat, unreal.MaterialExpressionMultiply, -350, 250)
    link(hot, "", e, "A")
    link(glow, "", e, "B")
    mel.connect_material_property(e, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def paint_instance(parent, slot, colour, rough, metal):
    name = "MI_Fighter_" + slot.split("_", 1)[1]
    path = f"{DEST}/{name}"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    mi = tools.create_asset(name, DEST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    mel.set_material_instance_vector_parameter_value(mi, "Colour", unreal.LinearColor(*colour, 1.0))
    mel.set_material_instance_scalar_parameter_value(mi, "Roughness", rough)
    mel.set_material_instance_scalar_parameter_value(mi, "Metallic", metal)
    mel.update_material_instance(mi)
    assets.save_loaded_asset(mi)
    return mi


def fighter_meshes():
    """Import fighter.fbx (if not yet, or REWILD_REIMPORT) and keep its static meshes in Fighter/Mesh."""
    paths = []
    if reimport() or not assets.does_directory_have_assets(DEST + "/Mesh"):
        paths = import_file(os.path.join(EXPORT, "fighter.fbx"))
    meshes = []
    for p in paths:
        if isinstance(unreal.load_asset(p), unreal.StaticMesh):
            new = f"{DEST}/Mesh/{p.rsplit('/', 1)[1]}"
            if assets.does_asset_exist(new):
                assets.delete_asset(new)
            assets.rename_asset(p, new)
    for p in assets.list_assets(DEST + "/Mesh", recursive=False):
        a = unreal.load_asset(p.split(".")[0])
        if isinstance(a, unreal.StaticMesh):
            meshes.append(a)
    if not meshes:
        raise RuntimeError("no fighter mesh imported")
    return meshes


def setup_meshes(meshes, slots):
    for m in meshes:
        nanite = m.get_editor_property("nanite_settings")
        nanite.enabled = False  # the canopy glass is translucent, which Nanite does not draw; 180k triangles is fine
        m.set_editor_property("nanite_settings", nanite)
        names = [str(s.get_editor_property("material_slot_name")) for s in m.get_editor_property("static_materials")]
        for i, n in enumerate(names):
            if n in slots:
                m.set_material(i, slots[n])
            else:
                shots.log(f"warning: slot {n} on {m.get_name()} has no material")
        b = m.get_bounds()
        found = [n for n in SOCKETS if m.find_socket(n) or m.find_socket("SOCKET_" + n)]
        shots.log(f"{m.get_name()}: slots {names}, size {b.box_extent.x * 2:.0f} x {b.box_extent.y * 2:.0f} x "
                  f"{b.box_extent.z * 2:.0f} cm, sockets {found}")
        assets.save_loaded_asset(m)


def remove_placeholders():
    """Interchange makes a placeholder material per slot name (M_Paint_White ...); ours replace them."""
    for p in assets.list_assets(DEST, recursive=False):
        path = p.split(".")[0]
        name = path.rsplit("/", 1)[1]
        if name in PAINT or name in ("M_Glass_Canopy", "M_Engine_Glow"):
            assets.delete_asset(path)


def stills(meshes):
    """The fighter 400 km above Egypt, heading west-north-west with the Sun behind its left shoulder."""
    earth.open_level(earth.LEVEL, TAG)
    heading = 300.0
    rot = unreal.Rotator(roll=0, pitch=0, yaw=heading)
    for m in meshes:
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, unreal.Vector(0, 0, 0), rot)
        a.set_editor_property("tags", [TAG])
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.static_mesh_component.set_static_mesh(m)
        a.set_actor_label(m.get_name())
    fwd, up = rot.get_forward_vector(), unreal.Vector(0, 0, 1)
    right = rot.get_right_vector()

    def cam(name, loc, target, fov=50.0):
        c = actors.spawn_actor_from_class(unreal.CameraActor, loc, unreal.MathLibrary.make_rot_from_x(target - loc))
        c.set_editor_property("tags", [TAG])
        c.camera_component.set_editor_property("field_of_view", fov)
        return (name, c)

    shots_list = [
        cam("Fighter_chase.png", fwd * -1500 + up * 400, fwd * 600, 70.0),  # the chase camera: 15 m back, 4 m up
        cam("Fighter_front34.png", fwd * 1500 + right * -1100 + up * 500, unreal.Vector(0, 0, 0)),
        cam("Fighter_side.png", right * -2400 + up * 150, unreal.Vector(0, 0, 0)),
        cam("Fighter_top_earth.png", fwd * -900 + right * -700 + up * 1600, fwd * 100, 60.0),
        cam("Fighter_close_canopy.png", fwd * 900 + right * -350 + up * 260, fwd * 300 + up * 80, 45.0),
    ]
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    return shots_list


if __name__ == "__main__":
    shots.start()
    try:
        earth.prepare_assets()  # Earth must exist in the stills level
        if not assets.does_asset_exist(earth.LEVEL):
            raise RuntimeError("run build_earth.py first")
        ao, cavity = mask_texture("T_Fighter_AO"), mask_texture("T_Fighter_Cavity")
        paint = paint_material(ao, cavity)
        slots = {s: paint_instance(paint, s, *v) for s, v in PAINT.items()}
        slots["M_Glass_Canopy"] = glass_material()
        slots["M_Engine_Glow"] = engine_material()
        meshes = fighter_meshes()
        setup_meshes(meshes, slots)
        remove_placeholders()
        unreal.AutomationLibrary.finish_loading_before_screenshot()
        shots.take_shots(stills(meshes), settle=6.0)
    except Exception as e:
        shots.fail(e)
