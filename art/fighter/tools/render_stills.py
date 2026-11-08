"""Render the still-loop views of the fighter (or of the old ship.glb, placed in the same frame) with Cycles.

  blender -b --factory-startup -P art/fighter/tools/render_stills.py -- --blend fighter.blend --out DIR/new [--views a,b]
  blender -b --factory-startup -P art/fighter/tools/render_stills.py -- --glb web/.../ship.glb --out DIR/old

Views: ref0 ref1 ref2 (the angles of the old reference renders), chase (15 m behind, 4 m above), side, top, front,
back, close (3 m from the windscreen), space (hard sun on black), eye (cockpit eye point, 90 deg), belly.
"""
import bpy, sys, math, os
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


BLEND, GLB, OUT = arg("--blend"), arg("--glb"), arg("--out")
VIEWS = arg("--views", "ref0,ref1,ref2,chase,side,top,close,space,eye").split(",")
SAMPLES = int(arg("--samples", "96"))
CAVITY = arg("--cavity")      # baked T_Fighter_Cavity.png: darken grooves in the paint the way the Unreal material will
RES = arg("--res", "1600x900")
SHIFT_X = 2.25

if BLEND:
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    for o in list(bpy.data.objects):
        if o.type in ('CAMERA', 'LIGHT'):
            bpy.data.objects.remove(o, do_unlink=True)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)
    s = 16.0 / 0.987
    for o in bpy.context.scene.objects:
        if o.parent is None:
            o.scale = (o.scale[0] * s, o.scale[1] * s, o.scale[2] * s)
            o.location = (o.location[0] * s + SHIFT_X, o.location[1] * s, o.location[2] * s)
scene = bpy.context.scene
if CAVITY and BLEND:
    cimg = bpy.data.images.load(CAVITY)
    cimg.colorspace_settings.name = 'Non-Color'
    for mname in ("M_Paint_White", "M_Paint_Red", "M_Paint_Grey", "M_Canopy_Frame"):
        m = bpy.data.materials.get(mname)
        if not m:
            continue
        nt = m.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        col = tuple(bsdf.inputs["Base Color"].default_value)
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = cimg; tex.interpolation = 'Cubic'
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = 0.08, 0.46
        mr.inputs["To Min"].default_value, mr.inputs["To Max"].default_value = 0.30, 1.0
        nt.links.new(tex.outputs["Color"], mr.inputs["Value"])
        rgb = nt.nodes.new("ShaderNodeRGB"); rgb.outputs[0].default_value = col
        mul = nt.nodes.new("ShaderNodeVectorMath"); mul.operation = 'SCALE'
        nt.links.new(rgb.outputs[0], mul.inputs[0]); nt.links.new(mr.outputs[0], mul.inputs["Scale"])
        nt.links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    print("cavity mask applied to paint")
meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
bpy.context.view_layer.update()
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
size, ctr = mx - mn, (mx + mn) / 2
print("BBOX", tuple(round(v, 3) for v in size), "CTR", tuple(round(v, 3) for v in ctr))

scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU setup failed", e)
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPTIX'
except Exception:
    pass
scene.render.resolution_x, scene.render.resolution_y = map(int, RES.split("x"))
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [
    i.identifier for i in scene.view_settings.bl_rna.properties['look'].enum_items] else 'None'

world = bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True if world.node_tree is None else world.use_nodes
bg = world.node_tree.nodes["Background"]


def clear_lights():
    for o in list(scene.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)


def sun(rot, energy, angle=0.5, color=(1, 1, 1)):
    l = bpy.data.lights.new("sun", 'SUN')
    l.energy = energy
    l.angle = radians(angle)
    l.color = color
    o = bpy.data.objects.new("sun", l)
    scene.collection.objects.link(o)
    o.rotation_euler = [radians(a) for a in rot]
    return o


def area(loc, target, energy, size=6, color=(1, 1, 1)):
    l = bpy.data.lights.new("area", 'AREA')
    l.energy = energy
    l.size = size
    l.color = color
    o = bpy.data.objects.new("area", l)
    scene.collection.objects.link(o)
    o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o


def light_ref():
    """The lighting of render_ship.py (old reference renders): one sun, dark grey world."""
    clear_lights()
    bg.inputs[0].default_value = (0.05, 0.05, 0.06, 1)
    bg.inputs[1].default_value = 1.0
    sun((50, 0, 30), 4.0, 2.0)


def light_studio():
    clear_lights()
    bg.inputs[0].default_value = (0.20, 0.205, 0.215, 1)
    bg.inputs[1].default_value = 0.55
    sun((50, 0, 30), 3.2, 3.0)
    area((ctr.x - 10, ctr.y - 14, ctr.z + 8), ctr, 2500, 10)
    area((ctr.x + 6, ctr.y + 12, ctr.z - 6), ctr, 900, 12, (0.9, 0.95, 1.0))


def light_space():
    clear_lights()
    bg.inputs[0].default_value = (0.0, 0.0, 0.0, 1)
    bg.inputs[1].default_value = 0.0
    sun((35, 0, -40), 9.0, 0.53)
    # faint blue earthshine from below
    sun((180 - 20, 0, 60), 0.12, 20, (0.45, 0.6, 1.0))


cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look(loc, target, up=(0, 0, 1)):
    cam.location = Vector(loc)
    d = (Vector(target) - Vector(loc)).normalized()
    z = -d
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((0, 1, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    cam.matrix_world = Matrix.Translation(Vector(loc)) @ Matrix((x, y, z)).transposed().to_4x4()


def persp(lens=50.0, hfov=None):
    cam_data.type = 'PERSP'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.sensor_width = 36
    if hfov:
        cam_data.angle_x = radians(hfov)
    else:
        cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam_data.clip_end = 1000


def ortho(scale):
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = scale
    cam_data.clip_start = 0.05
    cam_data.clip_end = 1000


def render(name):
    scene.render.filepath = os.path.abspath(f"{OUT}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


r = max(size) * 1.6
# the reference renders were framed on the OLD model's bbox (centre and 1.6 x its 16.0 m length): use those for both
REF_CTR, REF_R = Vector((2.226, 0.008, 0.004)), 16.001 * 1.6
for v in VIEWS:
    if v.startswith("ref"):
        az, el = {"ref0": (35, 20), "ref1": (150, 35), "ref2": (270, 70)}[v]
        a, e = radians(az), radians(el)
        light_ref()
        persp(50)
        look(REF_CTR + Vector((REF_R * math.cos(e) * math.cos(a), REF_R * math.cos(e) * math.sin(a),
                                REF_R * math.sin(e))), REF_CTR)
        render(v)
    elif v == "chase":
        light_studio()
        persp(hfov=70)
        look((-15, 0, 4), (10, 0, 0.5))
        render(v)
    elif v in ("side", "top", "front", "back", "belly"):
        light_studio()
        ortho(17.0)
        L = 40
        dirs = {"side": ((0, -L, 0), (0, 0, 1)), "top": ((0, 0, L), (0, 1, 0)), "front": ((L, 0, 0), (0, 0, 1)),
                "back": ((-L, 0, 0), (0, 0, 1)), "belly": ((0, 0, -L), (0, 1, 0))}
        off, up = dirs[v]
        c0 = Vector((REF_CTR.x, 0, 0)) if v in ("side", "top", "belly") else Vector((0, 0, 0))
        look(c0 + Vector(off), c0, up)
        render(v)
    elif v == "close":
        light_studio()
        persp(35)
        tgt = Vector((1.9 + SHIFT_X, 0.0, 0.85))
        a, e = radians(32), radians(24)
        look(tgt + 3.0 * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))), tgt)
        render(v)
    elif v == "close2":
        light_studio()
        persp(35)
        tgt = Vector((-2.0 + SHIFT_X, 1.6, 0.3))
        a, e = radians(150), radians(28)
        look(tgt + 3.5 * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))), tgt)
        render(v)
    elif v == "front34":
        light_studio()
        persp(50)
        tgt = Vector((1.6 + SHIFT_X, 0.0, 0.35))
        a, e = radians(30), radians(16)
        look(tgt + 13.0 * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))), tgt)
        render(v)
    elif v in ("spine", "intake", "tail", "nozzle", "wing"):
        light_studio()
        persp(35)
        tgt, az, el, dist = {"spine": ((-2.6 + SHIFT_X, 0.0, 1.1), 200, 38, 4.5),
                             "intake": ((0.2 + SHIFT_X, 1.9, -0.45), 25, -8, 4.0),
                             "tail": ((-6.3 + SHIFT_X, 0.0, 0.2), 205, 12, 6.0),
                             "nozzle": ((-6.9 + SHIFT_X, 1.86, 0.36), 160, 8, 2.6),
                             "wing": ((-2.6 + SHIFT_X, 4.2, -0.2), 120, 48, 5.5)}[v]
        tgt = Vector(tgt)
        a, e = radians(az), radians(el)
        look(tgt + dist * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))), tgt)
        render(v)
    elif v == "space":
        light_space()
        persp(50)
        a, e = radians(40), radians(22)
        look(REF_CTR + 30 * Vector((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))), REF_CTR)
        render(v)
    elif v == "eye":
        clear_lights()
        bg.inputs[0].default_value = (0.004, 0.005, 0.008, 1)
        bg.inputs[1].default_value = 1.0
        sun((60, 0, 160), 2.5, 2.0)
        area((0.55 + SHIFT_X, 0, 0.8), (0.55 + SHIFT_X + 1, 0, 0.6), 8, 0.6)    # dim cockpit fill so frames read
        gm = bpy.data.materials.get("M_Glass_Canopy")
        if gm:   # judge the frame layout, not reflections of the preview light: near-clear glass from inside
            for n in gm.node_tree.nodes:
                if n.type == 'MATH' and n.operation == 'MAXIMUM':
                    n.inputs[1].default_value = 0.0
        persp(hfov=90)
        eye = None
        for o in scene.objects:
            if o.name == "SOCKET_Cockpit_Eye":
                eye = o.matrix_world.translation.copy()
        if eye is None:
            eye = Vector((0.55 + SHIFT_X, 0, 0.97))
        scene.render.resolution_x, scene.render.resolution_y = 1280, 714
        look(eye, eye + Vector((10, 0, 0)))
        render(v)
        scene.render.resolution_x, scene.render.resolution_y = map(int, RES.split("x"))
