"""Import the practice drone (art/drone/export) into /Game/FirstFight/Drone, make its materials, and take stills of
it over Earth: whole, from the chase camera, and blown apart (first fight, milestone 3). Run with rewild_shots.py's
command line; needs build_earth.py's assets.

RewildDrone loads /Game/FirstFight/Drone/Mesh/Drone (its socket "Gun" is the emitter muzzle; slot M_Beacon blinks
through the Glow parameter) and the fragments /Game/FirstFight/Drone/Debris/Debris_01..12, which the explosion
throws apart. The paint is the fighter's paint material (import_fighter.py) with the drone's own AO and cavity maps.
REWILD_REIMPORT=1 imports the model and maps again (after make_drone.py changes).
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

DEST = "/Game/FirstFight/Drone"
EXPORT = os.path.normpath(os.path.join(HERE, "..", "..", "..", "..", "art", "drone", "export"))
TAG = "drone_still"

assets = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

# Slot -> (colour (linear), roughness, metallic). The orange is the BQM-167 target drone's, measured off a photograph
# (lit sRGB 198,55,51); the blanket is gold-coloured Kapton foil, a metal; the sensor window is dark glass.
PAINT = {
    "M_Paint_Orange": ((0.55, 0.05, 0.025), 0.4, 0.0),
    "M_Paint_White": ((0.70, 0.70, 0.68), 0.38, 0.0),
    "M_Paint_Grey": ((0.20, 0.21, 0.22), 0.45, 0.0),
    "M_Metal_Dark": ((0.045, 0.045, 0.05), 0.42, 0.7),
    "M_Foil_MLI": ((1.0, 0.62, 0.22), 0.28, 1.0),
    "M_Glass_Sensor": ((0.01, 0.012, 0.015), 0.05, 0.0),
    "M_Metal_Torn": ((0.30, 0.28, 0.26), 0.55, 0.9),  # bare aluminium where the hull tore
}
BEACON_GLOW = 200000.0  # a white strobe that reads at 1 km against sunlit Earth (EV 14.5)


def beacon_material():
    mat = fighter.fresh_material("M_DroneBeacon", DEST)
    dome = fighter.node(mat, unreal.MaterialExpressionConstant3Vector, -400, 0, constant=unreal.LinearColor(0.6, 0.6, 0.6, 1))
    mel.connect_material_property(dome, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(fighter.node(mat, unreal.MaterialExpressionConstant, -400, 120, r=0.1), "",
                                  unreal.MaterialProperty.MP_ROUGHNESS)
    hot = fighter.node(mat, unreal.MaterialExpressionConstant3Vector, -700, 250, constant=unreal.LinearColor(1.0, 0.95, 0.9, 1))
    glow = fighter.param(mat, unreal.MaterialExpressionScalarParameter, "Glow", -700, 400, 1.0)  # RewildDrone blinks it
    level = fighter.param(mat, unreal.MaterialExpressionScalarParameter, "Intensity", -700, 500, BEACON_GLOW)
    e1 = fighter.node(mat, unreal.MaterialExpressionMultiply, -450, 300)
    fighter.link(hot, "", e1, "A")
    fighter.link(glow, "", e1, "B")
    e2 = fighter.node(mat, unreal.MaterialExpressionMultiply, -250, 350)
    fighter.link(e1, "", e2, "A")
    fighter.link(level, "", e2, "B")
    mel.connect_material_property(e2, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
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
        nanite.enabled = False  # 50k triangles a drone, seven drones: plain meshes are fine
        m.set_editor_property("nanite_settings", nanite)
        names = [str(s.get_editor_property("material_slot_name")) for s in m.get_editor_property("static_materials")]
        for i, n in enumerate(names):
            if n in slots:
                m.set_material(i, slots[n])
            else:
                shots.log(f"warning: slot {n} on {m.get_name()} has no material")
        b = m.get_bounds()
        shots.log(f"{m.get_name()}: {len(names)} slots, size {b.box_extent.x * 2:.0f} x {b.box_extent.y * 2:.0f} x "
                  f"{b.box_extent.z * 2:.0f} cm, gun socket {bool(m.find_socket('Gun'))}")
        assets.save_loaded_asset(m)


def remove_placeholders():
    """Interchange makes a placeholder material per slot name (M_Paint_Orange ...); ours replace them."""
    for p in assets.list_assets(DEST, recursive=False):
        path = p.split(".")[0]
        if path.rsplit("/", 1)[1] in list(PAINT) + ["M_Beacon"]:
            assets.delete_asset(path)


def stills(drone, debris):
    """The drone 400 km above Egypt, the Sun behind the camera's left shoulder; then its fragments pushed apart."""
    earth.open_level(earth.LEVEL, TAG)
    for a in actors.get_all_level_actors():  # the fighter's stills share the level and the spot (import_fighter remakes them)
        if fighter.TAG in [str(t) for t in a.tags]:
            actors.destroy_actor(a)
    rot = unreal.Rotator(roll=0, pitch=0, yaw=300.0)
    fwd, right, up = rot.get_forward_vector(), rot.get_right_vector(), unreal.Vector(0, 0, 1)

    def place(mesh, loc, label):
        a = actors.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
        a.set_editor_property("tags", [TAG])
        a.static_mesh_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.static_mesh_component.set_static_mesh(mesh)
        a.set_actor_label(label)

    place(drone, unreal.Vector(0, 0, 0), "Drone")
    # The fragments, 40 m to the side, each pushed out from the centre along where it sits in the whole.
    apart = right * 4000
    for m in debris:
        centre = m.get_bounds().origin  # in the drone's frame
        out = fwd * centre.x + right * centre.y + up * centre.z
        place(m, apart + out * 1.6, m.get_name())

    def cam(name, loc, target, fov=50.0):
        c = actors.spawn_actor_from_class(unreal.CameraActor, loc, unreal.MathLibrary.make_rot_from_x(target - loc))
        c.set_editor_property("tags", [TAG])
        c.camera_component.set_editor_property("field_of_view", fov)
        return (name, c)

    origin = unreal.Vector(0, 0, 0)
    shots_list = [
        cam("Drone_front34.png", fwd * 650 + right * -450 + up * 260, origin, 45.0),
        cam("Drone_rear34.png", fwd * -700 + right * 380 + up * 300, origin, 45.0),
        cam("Drone_chase60m.png", fwd * -6000 + up * 1200, origin, 70.0),  # what the player sees closing in
        cam("Drone_apart.png", apart + fwd * 700 + right * -650 + up * 380, apart, 50.0),
    ]
    unreal.get_editor_subsystem(unreal.LevelEditorSubsystem).save_current_level()
    return shots_list


if __name__ == "__main__":
    shots.start()
    try:
        earth.prepare_assets()
        if not assets.does_asset_exist(earth.LEVEL):
            raise RuntimeError("run build_earth.py first")
        ao = fighter.mask_texture("T_Drone_AO", DEST, EXPORT)
        cavity = fighter.mask_texture("T_Drone_Cavity", DEST, EXPORT)
        paint = fighter.paint_material(ao, cavity, "M_DronePaint", DEST)
        slots = {s: fighter.paint_instance(paint, s, *v, prefix="MI_Drone_", dest=DEST) for s, v in PAINT.items()}
        slots["M_Beacon"] = beacon_material()
        drone = import_meshes("drone.fbx", "Mesh", rename="Drone")
        debris = import_meshes("drone_debris.fbx", "Debris")
        setup_meshes(drone + debris, slots)
        remove_placeholders()
        unreal.AutomationLibrary.finish_loading_before_screenshot()
        shots.take_shots(stills(drone[0], debris), settle=6.0)
    except Exception as e:
        shots.fail(e)
