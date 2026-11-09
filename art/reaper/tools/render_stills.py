"""Render the still-loop views of the Reaper (Cycles, GPU) from the .blend that make_reaper.py saves.

  blender -b --factory-startup -P art/reaper/tools/render_stills.py -- --blend reaper.blend --out DIR/r1
      [--views a,b] [--tex art/reaper/export/textures] [--res 1344x752] [--samples 96]

--tex applies the baked maps as the Unreal material is meant to: T_Reaper_Tint mixes the dark cast alloy toward
bronze and blue-grey temper colours, T_Reaper_Cavity darkens recesses and brightens worn edges, T_Reaper_AO adds
contact shadow, T_Reaper_Normal (DirectX, green down) carries the hammered cast surface.

Views:
  concept     the camera fitted to the concept picture (docs/reaper-concepts/reaper-concept-sickle-2.png), 1344x752
              (add 'e' for an Earth backdrop: concepte)
  chase120 chase400   the game's chase camera (70 deg, 1920x1080) behind and above the Reaper (add 'e': Earth)
  head200     head-on as it attacks, 200 m (70 deg, 1920x1080)
  belly       from below and in front (50 mm)
  rear        3/4 from behind and above, close (50 mm)
  top side front back bottom   orthographic, for measuring
  exploded    the debris pushed apart
  id_<view>   flat material colours, no anti-aliasing, for pixel counts (tools/measure.py)
"""
import bpy, sys, math, os, random
from math import radians
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]


def arg(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


BLEND, OUT = arg("--blend"), arg("--out")
VIEWS = arg("--views", "concept,chase120,chase400,head200,belly,exploded").split(",")
SAMPLES = int(arg("--samples", "96"))
TEXDIR = os.path.abspath(arg("--tex")) if arg("--tex") else None
RES = arg("--res", "1344x752")

# the camera fitted to the concept (tools/concept_trace.json), in the design frame (before the origin shift)
CONCEPT_CAM = dict(az=50.366, el=32.706, dist=19.475, roll=-3.906, hfov=43.519, target=(0.971, 0.727, -0.414))

bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
for o in list(bpy.data.objects):
    if o.type in ('CAMERA', 'LIGHT'):
        bpy.data.objects.remove(o, do_unlink=True)
body = bpy.data.objects["Reaper_Body"]
OFF = Vector(body.get("design_offset", (0.0, 0.0, 0.0)))     # final = design - OFF
debris = [o for o in bpy.data.objects if o.name.startswith("Debris_")]
dcoll = bpy.data.collections.get("Debris")

if TEXDIR:
    def img(n):
        p = os.path.join(TEXDIR, n)
        if not os.path.exists(p):
            return None
        im = bpy.data.images.load(p)
        im.colorspace_settings.name = 'Non-Color'
        return im
    ao, cav, nrm, tint = img("T_Reaper_AO.png"), img("T_Reaper_Cavity.png"), img("T_Reaper_Normal.png"), \
        img("T_Reaper_Tint.png")
    for mname in ("M_Alloy_Dark", "M_Alloy_Tint", "M_Alloy_Bare"):
        m = bpy.data.materials.get(mname)
        nt = m.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        L = nt.links.new
        N = nt.nodes.new

        def tex(im):
            t = N("ShaderNodeTexImage")
            t.image = im
            t.interpolation = 'Cubic'
            return t.outputs["Color"]

        def val(v):
            n = N("ShaderNodeValue"); n.outputs[0].default_value = v
            return n.outputs[0]

        def rgb(c):
            n = N("ShaderNodeRGB"); n.outputs[0].default_value = (*c, 1)
            return n.outputs[0]

        def smoothstep(x, a, b):
            n = N("ShaderNodeMapRange"); n.interpolation_type = 'SMOOTHSTEP'
            n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = a, b
            L(x, n.inputs["Value"])
            return n.outputs[0]

        def mixc(f, a, b):
            n = N("ShaderNodeMix"); n.data_type = 'RGBA'
            L(f, n.inputs[0]); L(a, n.inputs[6]); L(b, n.inputs[7])
            return n.outputs[2]

        def mixf(f, a, b):
            n = N("ShaderNodeMix"); n.data_type = 'FLOAT'
            L(f, n.inputs[0]); L(a, n.inputs[2]); L(b, n.inputs[3])
            return n.outputs[0]

        def mul(a, b):
            n = N("ShaderNodeMath"); n.operation = 'MULTIPLY'
            L(a, n.inputs[0]); L(b, n.inputs[1])
            return n.outputs[0]
        tc = N("ShaderNodeTexCoord")
        # oxide skin: dark charcoal mottled toward warm brown over metres and centimetres
        n1 = N("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 0.45; n1.inputs["Detail"].default_value = 4.0
        L(tc.outputs["Object"], n1.inputs["Vector"])
        n2 = N("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 6.0; n2.inputs["Detail"].default_value = 8.0
        L(tc.outputs["Object"], n2.inputs["Vector"])
        warm = smoothstep(n1.outputs["Fac"], 0.38, 0.66)
        oxide = mixc(warm, rgb((0.024, 0.022, 0.021)), rgb((0.062, 0.038, 0.024)))
        n5 = N("ShaderNodeTexNoise"); n5.inputs["Scale"].default_value = 0.8; n5.inputs["Detail"].default_value = 3.0
        L(tc.outputs["Generated"], n5.inputs["Vector"])
        oxide = mixc(smoothstep(n5.outputs["Fac"], 0.57, 0.70), oxide, rgb((0.034, 0.040, 0.050)))   # blue-grey scale
        oxide = mixc(smoothstep(n2.outputs["Fac"], 0.3, 0.7), mixc(val(0.25), oxide, rgb((0.015, 0.014, 0.013))), oxide)
        # cast pitting and worn spots break up the oxide (Unreal: a tiling cast-iron detail texture does this)
        n3 = N("ShaderNodeTexNoise"); n3.inputs["Scale"].default_value = 28.0; n3.inputs["Detail"].default_value = 8.0
        L(tc.outputs["Object"], n3.inputs["Vector"])
        n4 = N("ShaderNodeTexNoise"); n4.inputs["Scale"].default_value = 9.0; n4.inputs["Detail"].default_value = 6.0
        n4.inputs["Roughness"].default_value = 0.7
        L(tc.outputs["Object"], n4.inputs["Vector"])
        pitk = N("ShaderNodeVectorMath"); pitk.operation = 'SCALE'
        L(oxide, pitk.inputs[0]); L(smoothstep(n3.outputs["Fac"], 0.25, 0.75), pitk.inputs["Scale"])
        oxide = mixc(val(0.55), oxide, pitk.outputs[0])
        worn = smoothstep(n4.outputs["Fac"], 0.62, 0.78)
        oxide = mixc(mul(worn, val(0.55)), oxide, rgb((0.16, 0.13, 0.11)))
        # temper colours from the heat-tint mask: bronze and straw at the fringe, purple, then blue-grey nearest the ore
        t = tex(tint) if tint is not None else val(0.0)
        tw = smoothstep(t, 0.12, 0.65)
        if mname == "M_Alloy_Tint":
            tw = mixf(val(0.6), tw, val(1.0))
        ramp = N("ShaderNodeValToRGB")
        cr = ramp.color_ramp
        cr.elements[0].position, cr.elements[0].color = 0.0, (0.070, 0.046, 0.030, 1)
        cr.elements[1].position, cr.elements[1].color = 1.0, (0.036, 0.046, 0.066, 1)
        e = cr.elements.new(0.45); e.color = (0.105, 0.070, 0.036, 1)
        e = cr.elements.new(0.75); e.color = (0.058, 0.036, 0.050, 1)
        L(t, ramp.inputs["Fac"])
        base = mixc(tw, oxide, ramp.outputs["Color"])
        metal = mixf(tw, val(0.55), val(0.75))
        rough = mixf(worn, mixf(tw, val(0.60), val(0.48)), val(0.40))
        if cav is not None:
            c = tex(cav)
            edge = smoothstep(c, 0.56, 0.78)
            if mname == "M_Alloy_Bare":
                edge = val(1.0)
            recess = smoothstep(c, 0.46, 0.30)
            base = mixc(mul(edge, val(0.75)), base, rgb((0.30, 0.29, 0.27)))
            metal = mixf(edge, metal, val(1.0))
            rough = mixf(edge, rough, val(0.36))
            dk = N("ShaderNodeVectorMath"); dk.operation = 'SCALE'
            L(base, dk.inputs[0]); L(mixf(recess, val(1.0), val(0.35)), dk.inputs["Scale"])
            base = dk.outputs[0]
        if ao is not None:
            a = smoothstep(tex(ao), 0.0, 1.0)
            sc2 = N("ShaderNodeVectorMath"); sc2.operation = 'SCALE'
            L(base, sc2.inputs[0]); L(mixf(a, val(0.3), val(1.0)), sc2.inputs["Scale"])
            base = sc2.outputs[0]
        L(base, bsdf.inputs["Base Color"])
        L(metal, bsdf.inputs["Metallic"])
        L(rough, bsdf.inputs["Roughness"])
        if nrm is not None:
            nt_ = tex(nrm)
            # DirectX normal map: flip green back to OpenGL for Blender
            sep = N("ShaderNodeSeparateColor"); comb = N("ShaderNodeCombineColor")
            inv = N("ShaderNodeMath"); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
            L(nt_, sep.inputs[0])
            L(sep.outputs[0], comb.inputs[0]); L(sep.outputs[1], inv.inputs[1]); L(inv.outputs[0], comb.inputs[1])
            L(sep.outputs[2], comb.inputs[2])
            nm = N("ShaderNodeNormalMap"); nm.space = 'TANGENT'
            L(comb.outputs[0], nm.inputs["Color"])
            L(nm.outputs[0], bsdf.inputs["Normal"])
    print("textures applied")

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
bg_light = wnt.nodes.new("ShaderNodeBackground")
bg_cam = wnt.nodes.new("ShaderNodeBackground")
lp = wnt.nodes.new("ShaderNodeLightPath")
mix = wnt.nodes.new("ShaderNodeMixShader")
wnt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
wnt.links.new(bg_light.outputs[0], mix.inputs[1])
wnt.links.new(bg_cam.outputs[0], mix.inputs[2])
wnt.links.new(mix.outputs[0], wout.inputs["Surface"])
tc = wnt.nodes.new("ShaderNodeTexCoord")
nz = wnt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = 3.0
nz.inputs["Detail"].default_value = 8.0
wnt.links.new(tc.outputs["Window"], nz.inputs["Vector"])
ramp = wnt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.52
ramp.color_ramp.elements[0].color = (0.004, 0.014, 0.045, 1)
ramp.color_ramp.elements[1].position = 0.68
ramp.color_ramp.elements[1].color = (0.50, 0.54, 0.60, 1)
wnt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
earth_link = [None]


def backdrop(kind):
    if earth_link[0] is not None:
        wnt.links.remove(earth_link[0])
        earth_link[0] = None
    if kind == 'earth':
        earth_link[0] = wnt.links.new(ramp.outputs["Color"], bg_cam.inputs["Color"])
        bg_cam.inputs[1].default_value = 1.0
    else:
        bg_cam.inputs["Color"].default_value = (0, 0, 0, 1)
        bg_cam.inputs[1].default_value = 0.0


def clear_lights():
    for o in list(scene.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)


def sun_dir(d, energy, angle=0.53, color=(1, 1, 1)):
    """Sun shining FROM direction d (world vector pointing toward the sun)."""
    l = bpy.data.lights.new("sun", 'SUN')
    l.energy = energy
    l.angle = radians(angle)
    l.color = color
    o = bpy.data.objects.new("sun", l)
    scene.collection.objects.link(o)
    o.rotation_euler = (-Vector(d)).to_track_quat('-Z', 'Y').to_euler()
    return o


cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look(loc, target, roll=0.0, up=(0, 0, 1)):
    loc, target = Vector(loc), Vector(target)
    z = -(target - loc).normalized()
    x = Vector(up).cross(z)
    if x.length < 1e-6:
        x = Vector((0, 1, 0)).cross(z)
    x.normalize()
    y = z.cross(x)
    if roll:
        c, s = math.cos(radians(roll)), math.sin(radians(roll))
        x, y = c * x + s * y, -s * x + c * y
    cam.matrix_world = Matrix.Translation(loc) @ Matrix((x, y, z)).transposed().to_4x4()


def cam_axes():
    M = cam.matrix_world.to_3x3()
    return M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0)), M @ Vector((0, 0, 1))


def light_space(kind='black', sun_cam=(-0.55, 0.62, -0.35), energy=6.0):
    """Hard white sun from the camera's upper left (sun_cam in camera axes: x right, y up, z toward the camera),
    Earthshine from below (Earth's 30% reflectance, blue)."""
    clear_lights()
    bg_light.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
    bg_light.inputs[1].default_value = 0.0
    backdrop(kind)
    cx, cy, cz = cam_axes()
    d = (cx * sun_cam[0] + cy * sun_cam[1] + cz * sun_cam[2]).normalized()
    sun_dir(d, energy, 0.53)
    sun_dir(Vector((0.25, 0.3, -1.0)), 2.0, 70, (0.45, 0.62, 1.0))


def persp(lens=50.0, hfov=None, clip_end=5000):
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
    cam_data.clip_end = 200


def sph(az, el, r):
    a, e = radians(az), radians(el)
    return Vector((r * math.cos(e) * math.cos(a), r * math.cos(e) * math.sin(a), r * math.sin(e)))


def show(whole=True):
    body.hide_render = not whole
    for o in debris:
        o.hide_render = whole
    if dcoll:
        dcoll.hide_render = whole


ID_COL = {"M_Alloy_Dark": (0.25, 0.25, 0.25), "M_Alloy_Tint": (0.6, 0.3, 0.05), "M_Alloy_Bare": (1, 1, 1),
          "M_Seam_Hot": (1, 0.1, 0), "M_Engine_Hot": (1, 1, 0), "M_Dark_Interior": (0, 0, 0.6)}
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
    rnd = random.Random(11)
    for o in debris:
        if not on:
            o.matrix_world = Matrix.Identity(4)
            continue
        me = o.data
        c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
        d = c.normalized() if c.length > 1e-6 else Vector((0, 0, 1))
        off = (d * 0.8 + c * 0.30) * k
        ax = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
        R = Matrix.Rotation(radians(rnd.uniform(6, 18)), 4, ax)
        o.matrix_world = Matrix.Translation(c + off) @ R @ Matrix.Translation(-c)


scene.cycles.samples = SAMPLES
for v in VIEWS:
    show(True)
    explode(False)
    body.rotation_euler = (0, 0, 0)
    is_id = v.startswith("id_")
    base = v[3:] if is_id else v
    earth = base.endswith("e") and base[:-1] in ("concept", "chase120", "chase400", "head200", "chase120b")
    if earth:
        base = base[:-1]
    if base == "concept":
        set_res(RES)
        c = CONCEPT_CAM
        tgt = Vector(c["target"]) - OFF
        persp(hfov=c["hfov"])
        look(tgt + sph(c["az"], c["el"], c["dist"]), tgt, roll=c["roll"])
        light_space('earth' if earth else 'black', sun_cam=(-0.55, 0.78, 0.10), energy=3.8)
    elif base in ("chase120", "chase400", "chase120b", "chase400b"):
        D = float(base[5:8])
        if base.endswith("b"):          # banked 50 deg into a turn, as it is most of a dogfight
            body.rotation_euler = (radians(-50), radians(6), 0)
            for o in debris:
                o.rotation_euler = body.rotation_euler
        set_res("1920x1080")
        persp(hfov=70)
        # the player 15 m behind its own ship, chasing: behind and a little above, the Reaper above screen centre
        look(sph(172, 9, D), Vector((0, 0, 0)) - Vector((0, 0, 0.05 * D)))
        light_space('earth' if earth else 'black', sun_cam=(-0.55, 0.62, 0.25), energy=6.0)
    elif base == "head200":
        set_res("1920x1080")
        persp(hfov=70)
        look(sph(6, 5, 200.0), Vector((0, 0, 0)))
        light_space('earth' if earth else 'black', sun_cam=(-0.55, 0.62, 0.30), energy=6.0)
    elif base == "belly":
        set_res(RES)
        persp(50)
        look(sph(28, -38, 26.0), Vector((0.5, 0, -0.3)))
        light_space('black', sun_cam=(-0.55, 0.40, 0.35), energy=6.0)
        sun_dir(Vector((0.2, 0.1, -1.0)), 2.0, 40, (0.55, 0.68, 1.0))      # stronger Earthshine for the belly
    elif base in ("core", "corer"):
        set_res(RES)
        persp(40)
        if base == "core":
            look(Vector((-2.0, 0, 0.3)) - OFF + sph(48, 30, 13.0), Vector((-2.0, 0, 0.1)) - OFF)
        else:
            look(Vector((-3.5, 0, 0.3)) - OFF + sph(150, 30, 13.0), Vector((-3.5, 0, 0.2)) - OFF)
        light_space('black', sun_cam=(-0.62, 0.55, -0.30), energy=6.5)
    elif base == "rear":
        set_res(RES)
        persp(50)
        look(sph(150, 26, 26.0), Vector((-1.0, 0, 0)))
        light_space('black', sun_cam=(-0.55, 0.62, 0.20), energy=6.0)
    elif base in ("top", "side", "front", "back", "bottom"):
        set_res("1600x1600" if base in ("top", "bottom") else "1600x1000")
        ortho({"top": 16.0, "bottom": 16.0, "side": 16.0}.get(base, 13.0))
        L = 60
        dirs = {"side": ((0, L, 0), (0, 0, 1)), "top": ((0, 0, L), (1, 0, 0)), "front": ((L, 0, 0), (0, 0, 1)),
                "back": ((-L, 0, 0), (0, 0, 1)), "bottom": ((0, 0, -L), (1, 0, 0))}
        off, up = dirs[base]
        look(Vector(off) + Vector((0.4, 0, 0)), Vector((0.4, 0, 0)), up=up)
        light_space('black', sun_cam=(-0.5, 0.6, 0.6), energy=5.0)
    elif base == "cut":
        show(False)
        explode(True, 1.7)
        set_res(RES)
        persp(40)
        look(Vector((1.5, 1.2, 0.6)) + sph(-25, 25, 12.0), Vector((1.5, 0.6, 0.0)))
        light_space('black', sun_cam=(-0.45, 0.6, 0.65), energy=5.0)
    elif base == "exploded":
        show(False)
        explode(True, 1.7)
        set_res(RES)
        persp(hfov=50)
        c = CONCEPT_CAM
        tgt = Vector(c["target"]) - OFF
        ctr = Vector((3.4, 0, 0))
        look(ctr + sph(-32, 42, 38.0), ctr)
        light_space('black', sun_cam=(-0.55, 0.78, 0.10), energy=5.5)
    else:
        print("unknown view", v)
        continue
    if is_id:
        id_mode(True)
    render(v)
    if is_id:
        id_mode(False)
