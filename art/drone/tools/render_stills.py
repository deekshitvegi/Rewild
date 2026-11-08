"""Render the still-loop views of the practice drone (Cycles, GPU), from the .blend that make_drone.py saves.

  blender -b --factory-startup -P art/drone/tools/render_stills.py -- --blend drone.blend --out DIR/r1 [--views a,b]
      [--tex art/drone/export/textures]   (darken paint with the baked AO and cavity, as the Unreal material will)

Views: ref_a ref_b ref_c (three-quarter studio views like the reference photographs), side top front back belly
(orthographic), belly34, chase300 chase100 (the game's chase camera, 70 deg, 1920x1080; add 'e' for an Earth
backdrop: chase300e), close8 close8f (8 m), space (hard sun on black), exploded, explodedspace,
id_side id_top id_chase100 id_chase300 (flat material colours, no anti-aliasing, for pixel counts).
"""
import bpy, sys, math, os, random
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


BLEND, OUT = arg("--blend"), arg("--out")
VIEWS = arg("--views", "ref_a,ref_b,ref_c,chase300,chase100,close8,space,belly34,exploded").split(",")
SAMPLES = int(arg("--samples", "128"))
TEXDIR = os.path.abspath(arg("--tex")) if arg("--tex") else None
RES = arg("--res", "1600x900")

bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o, do_unlink=True)
drone = bpy.data.objects["Drone_Body"]
debris = [o for o in bpy.data.objects if o.name.startswith("Debris_")]
dcoll = bpy.data.collections.get("Debris")

PAINT = ("M_Paint_Orange", "M_Paint_White", "M_Paint_Grey", "M_Foil_MLI")
if TEXDIR:
    ao = bpy.data.images.load(os.path.join(TEXDIR, "T_Drone_AO.png"))
    cav = bpy.data.images.load(os.path.join(TEXDIR, "T_Drone_Cavity.png"))
    for im in (ao, cav):
        im.colorspace_settings.name = 'Non-Color'
    for mname in PAINT + ("M_Metal_Dark",):
        m = bpy.data.materials.get(mname)
        nt = m.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        col = tuple(bsdf.inputs["Base Color"].default_value)
        t1 = nt.nodes.new("ShaderNodeTexImage"); t1.image = cav; t1.interpolation = 'Cubic'
        t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = ao; t2.interpolation = 'Cubic'
        mr = nt.nodes.new("ShaderNodeMapRange")       # cavity: grooves darker, flat skin unchanged
        mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = 0.10, 0.48
        mr.inputs["To Min"].default_value, mr.inputs["To Max"].default_value = 0.35, 1.0
        nt.links.new(t1.outputs["Color"], mr.inputs["Value"])
        mr2 = nt.nodes.new("ShaderNodeMapRange")      # AO: contact shadows, softened
        mr2.inputs["To Min"].default_value = 0.45
        nt.links.new(t2.outputs["Color"], mr2.inputs["Value"])
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = 'MULTIPLY'
        nt.links.new(mr.outputs[0], mul.inputs[0]); nt.links.new(mr2.outputs[0], mul.inputs[1])
        rgb = nt.nodes.new("ShaderNodeRGB"); rgb.outputs[0].default_value = col
        sc = nt.nodes.new("ShaderNodeVectorMath"); sc.operation = 'SCALE'
        nt.links.new(rgb.outputs[0], sc.inputs[0]); nt.links.new(mul.outputs[0], sc.inputs["Scale"])
        nt.links.new(sc.outputs[0], bsdf.inputs["Base Color"])
    print("AO + cavity applied")

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
scene.cycles.use_denoising = True
try:
    scene.cycles.denoiser = 'OPTIX'
except Exception:
    pass
scene.render.film_transparent = False


def set_res(r):
    scene.render.resolution_x, scene.render.resolution_y = map(int, r.split("x"))


set_res(RES)


def look_tf(standard=False):
    scene.view_settings.view_transform = 'Standard' if standard else 'AgX'
    looks = [i.identifier for i in scene.view_settings.bl_rna.properties['look'].enum_items]
    scene.view_settings.look = 'None' if standard else (
        'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in looks else 'None')


look_tf()
world = bpy.data.worlds.new("w")
scene.world = world
if world.node_tree is None:
    world.use_nodes = True
wnt = world.node_tree
for n in list(wnt.nodes):
    wnt.nodes.remove(n)
wout = wnt.nodes.new("ShaderNodeOutputWorld")
bg_light = wnt.nodes.new("ShaderNodeBackground")      # what lights the drone
bg_cam = wnt.nodes.new("ShaderNodeBackground")        # what the camera sees behind it
lp = wnt.nodes.new("ShaderNodeLightPath")
mix = wnt.nodes.new("ShaderNodeMixShader")
wnt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
wnt.links.new(bg_light.outputs[0], mix.inputs[1])
wnt.links.new(bg_cam.outputs[0], mix.inputs[2])
wnt.links.new(mix.outputs[0], wout.inputs["Surface"])
# Earth backdrop for camera rays: deep navy sea with white cloud fields (worst case for the white panels)
tc = wnt.nodes.new("ShaderNodeTexCoord")
nz = wnt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0
nz.inputs["Detail"].default_value = 8.0
wnt.links.new(tc.outputs["Window"], nz.inputs["Vector"])
ramp = wnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.52
ramp.color_ramp.elements[0].color = (0.004, 0.012, 0.035, 1)
ramp.color_ramp.elements[1].position = 0.66
ramp.color_ramp.elements[1].color = (0.55, 0.58, 0.62, 1)
wnt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
earth_link = [None]


def backdrop(kind):
    """kind: 'grey' (studio), 'black' (space), 'earth'."""
    if earth_link[0] is not None:
        wnt.links.remove(earth_link[0])
        earth_link[0] = None
    if kind == 'earth':
        earth_link[0] = wnt.links.new(ramp.outputs["Color"], bg_cam.inputs["Color"])
        bg_cam.inputs[1].default_value = 1.0
    elif kind == 'black':
        bg_cam.inputs["Color"].default_value = (0, 0, 0, 1)
        bg_cam.inputs[1].default_value = 0.0
    else:
        bg_cam.inputs["Color"].default_value = (0.20, 0.205, 0.215, 1)
        bg_cam.inputs[1].default_value = 0.55


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


def area(loc, target, energy, size=4, color=(1, 1, 1)):
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


def light_studio():
    clear_lights()
    bg_light.inputs["Color"].default_value = (0.20, 0.205, 0.215, 1)
    bg_light.inputs[1].default_value = 0.55
    backdrop('grey')
    sun((50, 0, 30), 2.3, 3.0)
    area((-4, -6, 4), (0, 0, 0), 330, 5)
    area((3, 5, -3), (0, 0, 0), 150, 6, (0.9, 0.95, 1.0))


def light_space(kind='black'):
    clear_lights()
    bg_light.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
    bg_light.inputs[1].default_value = 0.0
    backdrop(kind)
    sun((35, 0, -40), 7.0, 0.53)
    # earthshine from below: Earth's 30% reflectance fills the shadow side
    sun((180 - 15, 0, 60), 1.1, 60, (0.55, 0.68, 1.0))


cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look(loc, target, up=(0, 0, 1)):
    loc, target = Vector(loc), Vector(target)
    z = -(target - loc).normalized()
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((0, 1, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    cam.matrix_world = Matrix.Translation(loc) @ Matrix((x, y, z)).transposed().to_4x4()


def persp(lens=50.0, hfov=None, clip_end=2000):
    cam_data.type = 'PERSP'
    cam_data.sensor_fit = 'HORIZONTAL'
    cam_data.sensor_width = 36
    if hfov:
        cam_data.angle_x = radians(hfov)
    else:
        cam_data.lens = lens
    cam_data.clip_start = 0.05
    cam_data.clip_end = clip_end


def ortho(scale):
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = scale
    cam_data.clip_start = 0.05
    cam_data.clip_end = 100


def sph(az, el, r):
    a, e = radians(az), radians(el)
    return Vector((r * math.cos(e) * math.cos(a), r * math.cos(e) * math.sin(a), r * math.sin(e)))


def show(whole=True):
    drone.hide_render = not whole
    for o in debris:
        o.hide_render = whole
    if dcoll:
        dcoll.hide_render = whole


ID_COL = {"M_Paint_Orange": (1, 0.25, 0), "M_Paint_White": (1, 1, 1), "M_Paint_Grey": (0.35, 0.35, 0.35),
          "M_Metal_Dark": (0.06, 0.06, 0.06), "M_Glass_Sensor": (0, 0, 1), "M_Beacon": (1, 1, 0),
          "M_Foil_MLI": (0.9, 0.6, 0.1), "M_Metal_Torn": (0.5, 0, 0.5)}
saved_mats = {}


def id_mode(on):
    if on:
        for mname, col in ID_COL.items():
            m = bpy.data.materials.get(mname)
            if not m:
                continue
            nt = m.node_tree
            out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
            old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = (*col, 1)
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            saved_mats[mname] = (nt, out, old, em)
        scene.render.film_transparent = True
        scene.cycles.samples = 1
        scene.cycles.use_denoising = False
        scene.cycles.filter_width = 0.01
        look_tf(standard=True)
    else:
        for mname, (nt, out, old, em) in saved_mats.items():
            nt.nodes.remove(em)
            if old is not None:
                nt.links.new(old, out.inputs["Surface"])
        saved_mats.clear()
        scene.render.film_transparent = False
        scene.cycles.samples = SAMPLES
        scene.cycles.use_denoising = True
        scene.cycles.filter_width = 1.5
        look_tf()


def render(name):
    scene.render.filepath = os.path.abspath(f"{OUT}_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("WROTE", scene.render.filepath)


def explode(on, k=1.0):
    rnd = random.Random(7)
    for o in debris:
        if not on:
            o.matrix_world = Matrix.Identity(4)
            continue
        me = o.data
        c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
        d = c.normalized() if c.length > 1e-6 else Vector((0, 0, 1))
        off = (d * 0.55 + c * 0.75) * k
        ax = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
        R = Matrix.Rotation(radians(rnd.uniform(8, 22)), 4, ax)
        o.matrix_world = Matrix.Translation(c + off) @ R @ Matrix.Translation(-c)


CHASE = {"chase300": 300.0, "chase100": 100.0}
scene.cycles.samples = SAMPLES
for v in VIEWS:
    show(True)
    explode(False)
    is_id = v.startswith("id_")
    base = v[3:] if is_id else v
    earth = base.endswith("e") and base[:-1] in CHASE
    if earth:
        base = base[:-1]
    if is_id:
        id_mode(True)
    if base in ("ref_a", "ref_b", "ref_c"):
        light_studio()
        persp(50)
        az, el = {"ref_a": (35, 14), "ref_b": (145, 30), "ref_c": (250, 62)}[base]
        look(sph(az, el, 9.5), (0.05, 0, 0.05))
    elif base in ("side", "top", "front", "back", "belly"):
        light_studio()
        ortho({"side": 4.2, "top": 6.6, "belly": 6.6}.get(base, 4.0))
        L = 20
        dirs = {"side": ((0, -L, 0), (0, 0, 1)), "top": ((0, 0, L), (0, 1, 0)), "front": ((L, 0, 0), (0, 0, 1)),
                "back": ((-L, 0, 0), (0, 0, 1)), "belly": ((0, 0, -L), (0, 1, 0))}
        off, up = dirs[base]
        look(Vector(off), (0.08 if base in ("side", "top", "belly") else 0, 0, 0.12 if base in ("side", "front", "back") else 0), up)
    elif base == "belly34":
        light_studio()
        persp(50)
        look(sph(205, -42, 9.0), (0, 0, -0.2))
    elif base in CHASE:
        light_space('earth' if earth else 'black')
        D = CHASE[base]
        set_res("1920x1080")
        persp(hfov=70)
        # player behind and a little above the drone, the drone a bit above the screen centre
        loc = sph(158, 14, D)
        look(loc, Vector((0, 0, 0)) - Vector((0, 0, 0.06 * D)))
    elif base in ("close8", "close8f"):
        light_space('black')
        set_res("1920x1080")
        persp(hfov=70)
        az, el = (150, 24) if base == "close8" else (32, 12)
        look(sph(az, el, 8.0), (0.1, 0, 0))
    elif base in ("mli", "mlistudio"):
        if base == "mli":
            light_space('black')
        else:
            light_studio()
        persp(35)
        tgt = Vector((-0.45, 0.47, 0.50))
        look(tgt + sph(150, 40, 1.6), tgt)
    elif base == "space":
        light_space('black')
        persp(50)
        look(sph(40, 20, 10.0), (0.1, 0, 0))
    elif base in ("exploded", "explodedspace"):
        show(False)
        explode(True)
        if base == "exploded":
            light_studio()
        else:
            light_space('black')
        persp(50)
        look(sph(38, 24, 13.5), (0.0, 0.0, 0.0))
    else:
        print("unknown view", v)
        continue
    render(v)
    set_res(RES)
    if is_id:
        id_mode(False)
