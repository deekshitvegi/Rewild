"""Import the Reaper, the Harrow's fighter (art/reaper/export), into /Game/FirstFight/Reaper, make its materials, and
take stills of it over Earth: posed like the concept, from the chase camera, head-on, from below, and blown apart
(first fight, milestone 4). Run with rewild_shots.py's command line; needs build_earth.py's assets.

RewildReaper loads /Game/FirstFight/Reaper/Mesh/Reaper (sockets Gun_L, Gun_R, Engine, Missile; slots M_Seam_Hot and
M_Engine_Hot glow through their Glow parameters) and the fragments /Game/FirstFight/Reaper/Debris/Debris_01..13.
The alloy is dark cast metal after the sickle concept the owner chose (docs/reaper-concepts/reaper-concept-sickle-2.png):
charcoal with heat-tinted bronze and blue-grey blooms (T_Reaper_Tint), rust-brown weathering, edges worn bright
(T_Reaper_Cavity), a hammered surface (T_Reaper_Normal, DirectX, Unreal's own convention), and thin hot seams.
REWILD_REIMPORT=1 imports the model and maps again (after make_reaper.py changes).
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "earth"))
import unreal  # noqa: E402

import build_earth as earth  # noqa: E402
import import_fighter as fighter  # noqa: E402
import rewild_shots as shots  # noqa: E402

DEST = "/Game/FirstFight/Reaper"
EXPORT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "art", "reaper", "export"))
TAG = "reaper_still"
OTHER_STILLS = ["fighter_still", "drone_still"]  # stills levels are shared: clear the others' actors first

assets = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
node, param, link, sample = fighter.node, fighter.param, fighter.link, fighter.sample

# Slot -> (colour (linear), tint strength, roughness, metallic). Cast iron, weathered grey-brown in the light as in the
# concept. In orbit a metal reflects black space: at metallic 0.6 and a 0.04 base the first Reapers were near black,
# invisible inside their HUD brackets (9 Nov 2026); so mostly rough and diffuse, a little metal.
ALLOY = {
    "M_Alloy_Dark": ((0.078, 0.075, 0.071), 0.6, 0.6, 0.3),
    "M_Alloy_Tint": ((0.095, 0.078, 0.062), 0.85, 0.55, 0.35),
    "M_Alloy_Bare": ((0.36, 0.34, 0.31), 0.15, 0.36, 0.85),    # the blades' honed inner edges
    "M_Dark_Interior": ((0.015, 0.014, 0.013), 0.0, 0.8, 0.2),
}
SEAM_GLOW = 100000.0    # x Glow (RewildReaper: 1 whole, up to 7 badly hurt or just hit); 28,000 is mid-grey at EV 14.5
ENGINE_GLOW = 60000.0   # the furnace mouth (150,000 blew out to white); RewildReaper adds a halo that reads at 1 km


def normal_texture(name):
    path = fighter.import_file(os.path.join(EXPORT, "textures", f"{name}.png"), name, DEST)[0]
    tex = unreal.load_asset(path)
    tex.set_editor_property("srgb", False)
    tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
    tex.set_editor_property("flip_green_channel", False)  # baked in DirectX order: Unreal's own
    assets.save_loaded_asset(tex)
    return tex


def alloy_material(ao_tex, cav_tex, nrm_tex, tint_tex):
    mat = fighter.fresh_material("M_ReaperAlloy", DEST)
    mat.set_editor_property("used_with_instanced_static_meshes", True)
    colour = param(mat, unreal.MaterialExpressionVectorParameter, "Colour", -1500, -400, unreal.LinearColor(0.04, 0.036, 0.033, 1))
    tint_k = param(mat, unreal.MaterialExpressionScalarParameter, "TintStrength", -1500, -250, 0.8)
    rough = param(mat, unreal.MaterialExpressionScalarParameter, "Roughness", -1500, 900, 0.6)
    metal = param(mat, unreal.MaterialExpressionScalarParameter, "Metallic", -1500, 1050, 0.6)
    ao = sample(mat, ao_tex, -1500, 0)
    cav = sample(mat, cav_tex, -1500, 300)
    tint = sample(mat, tint_tex, -1500, 600)
    nrm = node(mat, unreal.MaterialExpressionTextureSampleParameter2D, -1500, 1250, parameter_name="Normal",
               texture=nrm_tex, sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
    mel.connect_material_property(nrm, "RGB", unreal.MaterialProperty.MP_NORMAL)

    # Noise in the ship's own space, so the patterns ride with it: big rust-brown weathering patches (about 1.5 m)
    # and which temper colour a heat bloom takes (bronze or blue-grey, about 3 m).
    pos = node(mat, unreal.MaterialExpressionLocalPosition, -1800, 1500)
    rust = node(mat, unreal.MaterialExpressionNoise, -1500, 1500, scale=0.009, levels=4, output_min=0.0, output_max=1.0)
    link(pos, "", rust, "Position")
    hue = node(mat, unreal.MaterialExpressionNoise, -1500, 1650, scale=0.0016, levels=2, output_min=0.0, output_max=1.0)
    link(pos, "", hue, "Position")
    grain = node(mat, unreal.MaterialExpressionNoise, -1500, 1800, scale=0.06, levels=2, output_min=0.0, output_max=1.0)
    link(pos, "", grain, "Position")

    code = """
// Dark cast alloy (the Reaper): temper blooms where the ore ran hot, rust-brown weathering, edges worn bright,
// grooves dark, a hammered grain. Out: base colour in RGB, roughness in A.
float c = Cav;                                   // 0.5 flat, below in recesses, above on convex edges
float groove = saturate(c * 2.0);
float edge = saturate((c - 0.56) * 5.0);
float3 temper = lerp(float3(0.17, 0.105, 0.06), float3(0.07, 0.085, 0.11), smoothstep(0.4, 0.6, Hue));  // bronze or blue-grey
float3 base = lerp(Colour, temper, saturate(Tint * TintK));
float r = smoothstep(0.5, 0.85, Rust);                      // rust: lighter and redder, never dark blotches
base = lerp(base, float3(0.14, 0.075, 0.04), r * 0.35);   // (big dark patches read as camouflage, 9 Nov 2026)
base = lerp(base, float3(0.3, 0.285, 0.26), edge * 0.7);
base *= lerp(0.35, 1.0, groove) * lerp(0.55, 1.0, Ao) * (0.9 + 0.2 * Grain);
float rough = Rough + 0.15 * r - 0.25 * edge + 0.2 * (1.0 - groove) + 0.06 * (Grain - 0.5);
return float4(base, saturate(rough));
"""
    cust = node(mat, unreal.MaterialExpressionCustom, -900, 400, description="CastAlloy", code=code,
                output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT4)
    pins = ["Colour", "TintK", "Rough", "Ao", "Cav", "Tint", "Rust", "Hue", "Grain"]
    ins = []
    for n in pins:
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", n)
        ins.append(ci)
    cust.set_editor_property("inputs", ins)
    col3 = node(mat, unreal.MaterialExpressionComponentMask, -1250, -400, r=True, g=True, b=True)
    link(colour, "", col3, "")
    for name, (src, pin) in zip(pins, [(col3, ""), (tint_k, ""), (rough, ""), (ao, "R"), (cav, "R"), (tint, "R"),
                                       (rust, ""), (hue, ""), (grain, "")]):
        link(src, pin, cust, name)
    rgb = node(mat, unreal.MaterialExpressionComponentMask, -600, 300, r=True, g=True, b=True)
    link(cust, "", rgb, "")
    a = node(mat, unreal.MaterialExpressionComponentMask, -600, 500, r=False, g=False, b=False, a=True)
    link(cust, "", a, "")
    mel.connect_material_property(rgb, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(a, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
    mel.connect_material_property(ao, "R", unreal.MaterialProperty.MP_AMBIENT_OCCLUSION)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def alloy_instance(parent, slot, colour, tint_k, rough, metal):
    name = "MI_Reaper_" + slot.split("_", 1)[1]
    path = f"{DEST}/{name}"
    if assets.does_asset_exist(path):
        assets.delete_asset(path)
    mi = fighter.tools.create_asset(name, DEST, unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    mel.set_material_instance_parent(mi, parent)
    mel.set_material_instance_vector_parameter_value(mi, "Colour", unreal.LinearColor(*colour, 1))
    mel.set_material_instance_scalar_parameter_value(mi, "TintStrength", tint_k)
    mel.set_material_instance_scalar_parameter_value(mi, "Roughness", rough)
    mel.set_material_instance_scalar_parameter_value(mi, "Metallic", metal)
    mel.update_material_instance(mi)
    assets.save_loaded_asset(mi)
    return mi


def hot_material(name, colour, intensity, fade_with_distance):
    """Emissive: Colour x Intensity x Glow (RewildReaper drives Glow). The seams are 22-50 mm wide, far under a pixel
    beyond about 100 m, so their glow eases off with distance instead of sparkling (visual-references bar 9)."""
    mat = fighter.fresh_material(name, DEST)
    mat.set_editor_property("used_with_instanced_static_meshes", True)
    dark = node(mat, unreal.MaterialExpressionConstant3Vector, -600, -150, constant=unreal.LinearColor(0.02, 0.015, 0.012, 1))
    mel.connect_material_property(dark, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(node(mat, unreal.MaterialExpressionConstant, -600, -50, r=0.7), "",
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    hot = node(mat, unreal.MaterialExpressionConstant3Vector, -900, 150, constant=unreal.LinearColor(*colour, 1))
    level = param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -900, 300, intensity)
    glow = param(mat, unreal.MaterialExpressionScalarParameter, "Glow", -900, 420, 1.0)
    e1 = node(mat, unreal.MaterialExpressionMultiply, -650, 200)
    link(hot, "", e1, "A")
    link(level, "", e1, "B")
    e2 = node(mat, unreal.MaterialExpressionMultiply, -450, 260)
    link(e1, "", e2, "A")
    link(glow, "", e2, "B")
    out = e2
    if fade_with_distance:
        depth = node(mat, unreal.MaterialExpressionPixelDepth, -900, 600)
        fade = node(mat, unreal.MaterialExpressionCustom, -650, 600, description="SeamFade",
                    code="return clamp(8000.0 / max(Depth, 1.0), 0.3, 1.0);",
                    output_type=unreal.CustomMaterialOutputType.CMOT_FLOAT1)
        ci = unreal.CustomInput()
        ci.set_editor_property("input_name", "Depth")
        fade.set_editor_property("inputs", [ci])
        link(depth, "", fade, "Depth")
        e3 = node(mat, unreal.MaterialExpressionMultiply, -300, 350)
        link(e2, "", e3, "A")
        link(fade, "", e3, "B")
        out = e3
    mel.connect_material_property(out, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def import_meshes(filename, folder, rename=None):
    """Import an FBX (if the folder is empty, or REWILD_REIMPORT) and move its static meshes into DEST/folder."""
    if fighter.reimport() or not assets.does_directory_have_assets(f"{DEST}/{folder}"):
        for p in fighter.import_file(os.path.join(EXPORT, filename), dest=DEST):
            if isinstance(unreal.load_asset(p), unreal.StaticMesh):
                name = rename or p.rsplit("/", 1)[1]
                new = f"{DEST}/{folder}/{name}"
                if assets.does_asset_exist(new):
                    assets.delete_asset(new)
                assets.rename_asset(p, new)
    meshes = []
    for p in sorted(assets.list_assets(f"{DEST}/{folder}", recursive=False)):
        a = unreal.load_asset(p.split(".")[0])
        if isinstance(a, unreal.StaticMesh):
            meshes.append(a)
    if not meshes:
        raise RuntimeError(f"nothing imported from {filename}")
    return meshes


def setup_meshes(meshes, slots):
    for m in meshes:
        nanite = m.get_editor_property("nanite_settings")
        nanite.enabled = False  # 65k triangles a Reaper, five at most: plain meshes
        m.set_editor_property("nanite_settings", nanite)
        names = [str(s.get_editor_property("material_slot_name")) for s in m.get_editor_property("static_materials")]
        for i, n in enumerate(names):
            if n in slots:
                m.set_material(i, slots[n])
            else:
                shots.log(f"warning: slot {n} on {m.get_name()} has no material")
        b = m.get_bounds()
        sockets = [s for s in ("Gun_L", "Gun_R", "Engine", "Missile") if m.find_socket(s)]
        shots.log(f"{m.get_name()}: {len(names)} slots, size {b.box_extent.x * 2:.0f} x {b.box_extent.y * 2:.0f} x "
                  f"{b.box_extent.z * 2:.0f} cm, sockets {sockets}")
        assets.save_loaded_asset(m)


def remove_placeholders():
    """Interchange makes a placeholder material per slot name; ours replace them."""
    for p in assets.list_assets(DEST, recursive=False):
        path = p.split(".")[0]
        if path.rsplit("/", 1)[1] in list(ALLOY) + ["M_Seam_Hot", "M_Engine_Hot"]:
            assets.delete_asset(path)


def stills(reaper, debris):
    """The Reaper 400 km above Egypt, posed like the concept (from above and in front, its left side to us), from the
    player's chase camera 150 m behind, head-on as it attacks, from below; then its fragments pushed apart."""
    earth.open_level(earth.LEVEL, TAG)
    for a in actors.get_all_level_actors():
        if any(t in [str(x) for x in a.tags] for t in OTHER_STILLS):
            actors.destroy_actor(a)
    rot = unreal.Rotator(roll=-12.0, pitch=4.0, yaw=300.0)  # banked a little, as in the concept
    fwd, right, up = rot.get_forward_vector(), rot.get_right_vector(), rot.get_up_vector()

    def place(mesh, loc, label):
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
        a.set_editor_property("tags", [TAG])
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.static_mesh_component.set_static_mesh(mesh)
        a.set_actor_label(label)

    place(reaper, unreal.Vector(0, 0, 0), "Reaper")
    apart = right * 25000
    for m in debris:
        centre = m.get_bounds().origin
        out = fwd * centre.x + right * centre.y + up * centre.z
        place(m, apart + out * 1.5, m.get_name())

    def cam(name, loc, target, fov=50.0):
        c = actors.spawn_actor_from_class(unreal.CameraActor, loc, unreal.MathLibrary.make_rot_from_x(target - loc))
        c.set_editor_property("tags", [TAG])
        c.camera_component.set_editor_property("field_of_view", fov)
        return (name, c)

    o = unreal.Vector(0, 0, 0)
    shots_list = [
        cam("Reaper_concept_pose.png", fwd * 2200 + right * -2600 + up * 1500, o, 50.0),
        cam("Reaper_front34.png", fwd * 2400 + right * -1600 + up * -300, o, 45.0),
        cam("Reaper_rear34.png", fwd * -2000 + right * -1600 + up * 900, o, 50.0),
        cam("Reaper_chase150m.png", fwd * -15000 + up * 2600, o, 70.0),
        cam("Reaper_headon300m.png", fwd * 30000 + up * 1500, o, 70.0),
        cam("Reaper_apart.png", apart + fwd * 2600 + right * -2400 + up * 1300, apart, 50.0),
    ]
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    return shots_list


if __name__ == "__main__":
    shots.start()
    try:
        earth.prepare_assets()
        if not assets.does_asset_exist(earth.LEVEL):
            raise RuntimeError("run build_earth.py first")
        ao = fighter.mask_texture("T_Reaper_AO", DEST, EXPORT)
        cav = fighter.mask_texture("T_Reaper_Cavity", DEST, EXPORT)
        tint = fighter.mask_texture("T_Reaper_Tint", DEST, EXPORT)
        nrm = normal_texture("T_Reaper_Normal")
        alloy = alloy_material(ao, cav, nrm, tint)
        slots = {s: alloy_instance(alloy, s, *v) for s, v in ALLOY.items()}
        slots["M_Seam_Hot"] = hot_material("M_ReaperSeam", (1.0, 0.36, 0.07), SEAM_GLOW, True)
        slots["M_Engine_Hot"] = hot_material("M_ReaperEngine", (1.0, 0.5, 0.15), ENGINE_GLOW, False)
        reaper = import_meshes("reaper.fbx", "Mesh", rename="Reaper")
        debris = import_meshes("reaper_debris.fbx", "Debris")
        setup_meshes(reaper + debris, slots)
        remove_placeholders()
        unreal.AutomationLibrary.finish_loading_before_screenshot()
        shots.take_shots(stills(reaper[0], debris), settle=6.0)
    except Exception as e:
        shots.fail(e)
