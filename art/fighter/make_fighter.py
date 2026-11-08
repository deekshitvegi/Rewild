"""Rewild starfighter: built from code in Blender 5.2 (rebuild of the web version's ship.glb shape).

Run headless (from the repo root):
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P art/fighter/make_fighter.py -- \
      --blend <out.blend> [--export art/fighter/export] [--bake] [--no-grooves]

Everything is built in the old model's coordinates (nose +X, up +Z, metres at 16.21 m per old unit) and moved at the
end so the origin sits on the fuselage centre between the wing roots (old x = -2.25). See README.md.
"""
import bpy, bmesh, math, sys, os, time, bisect as _bisect
from math import radians, sin, cos, tan, pi, atan2, sqrt
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()


def log(*a):
    print(f"[{time.time() - T0:7.1f}s]", *a, flush=True)


ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGV:
        i = ARGV.index(name)
        if i + 1 < len(ARGV) and not ARGV[i + 1].startswith("--"):
            return ARGV[i + 1]
        return True
    return default


HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT_DIR = arg("--export")
BLEND_OUT = arg("--blend")
DO_BAKE = bool(arg("--bake", False))
NO_GROOVES = bool(arg("--no-grooves", False))
VARIANT = str(arg("--canopy", "B")).upper()      # B (owner's choice, 8 Nov): lowered deck, glass to -19 deg; A: old nose line
assert VARIANT in ("A", "B"), "--canopy must be A or B"
SHIFT_X = 2.25          # old-model x of the wing-root mid chord -> becomes x = 0
GROOVE_W, GROOVE_D = 0.012, 0.006

# ----------------------------------------------------------------------------------------------- materials
MAT_NAMES = ["M_Paint_White", "M_Paint_Red", "M_Paint_Grey", "M_Metal_Dark", "M_Canopy_Frame",
             "M_Glass_Canopy", "M_Engine_Glow", "M_TAG"]
W, R, G, D, F, GL, E, TAG = range(8)
MATS = []


def make_materials():
    pv = {
        "M_Paint_White": ((0.78, 0.78, 0.77), 0.36, 0.0),
        "M_Paint_Red": ((0.46, 0.022, 0.018), 0.36, 0.0),
        "M_Paint_Grey": ((0.105, 0.11, 0.115), 0.42, 0.0),
        "M_Metal_Dark": ((0.03, 0.03, 0.032), 0.38, 0.8),
        "M_Canopy_Frame": ((0.06, 0.062, 0.065), 0.4, 0.2),
        "M_TAG": ((1.0, 0.0, 1.0), 0.5, 0.0),
    }
    for n in MAT_NAMES:
        m = bpy.data.materials.new(n)
        nt = m.node_tree
        if nt is None:
            m.use_nodes = True
            nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        if n in pv:
            col, rough, metal = pv[n]
            bsdf.inputs["Base Color"].default_value = (*col, 1)
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = metal
            if n.startswith("M_Paint"):
                bsdf.inputs["Coat Weight"].default_value = 0.25
                bsdf.inputs["Coat Roughness"].default_value = 0.12
            m.diffuse_color = (*col, 1)
        elif n == "M_Glass_Canopy":
            # thin-sheet glass for previews: transparent + fresnel glossy (no refraction through one surface)
            out = nt.nodes.get("Material Output")
            nt.nodes.remove(bsdf)
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            tr.inputs[0].default_value = (0.86, 0.89, 0.9, 1)
            gl = nt.nodes.new("ShaderNodeBsdfGlossy")
            gl.inputs["Roughness"].default_value = 0.015
            fr = nt.nodes.new("ShaderNodeFresnel")
            fr.inputs["IOR"].default_value = 1.6
            mix = nt.nodes.new("ShaderNodeMixShader")
            geo = nt.nodes.new("ShaderNodeNewGeometry")
            m2 = nt.nodes.new("ShaderNodeMath")
            m2.operation = 'MULTIPLY'
            inv = nt.nodes.new("ShaderNodeMath")
            inv.operation = 'SUBTRACT'
            inv.inputs[0].default_value = 1.0
            nt.links.new(geo.outputs["Backfacing"], inv.inputs[1])
            nt.links.new(fr.outputs[0], m2.inputs[0])
            nt.links.new(inv.outputs[0], m2.inputs[1])
            mx2 = nt.nodes.new("ShaderNodeMath")
            mx2.operation = 'MAXIMUM'
            mx2.inputs[1].default_value = 0.04
            nt.links.new(m2.outputs[0], mx2.inputs[0])
            nt.links.new(mx2.outputs[0], mix.inputs[0])
            nt.links.new(tr.outputs[0], mix.inputs[1])
            nt.links.new(gl.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
            m.diffuse_color = (0.3, 0.35, 0.4, 0.3)
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                pass
        elif n == "M_Engine_Glow":
            bsdf.inputs["Base Color"].default_value = (0.02, 0.01, 0.005, 1)
            bsdf.inputs["Emission Color"].default_value = (1.0, 0.42, 0.12, 1)
            bsdf.inputs["Emission Strength"].default_value = 0.8
            m.diffuse_color = (1.0, 0.4, 0.1, 1)
        MATS.append(m)


# ----------------------------------------------------------------------------------------------- utilities
def pchip(table):
    """Monotone cubic (Fritsch-Carlson) through (x, y) pairs; no overshoot, so no lumps."""
    pts = sorted(table)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0] + m[0] * (x - xs[0])
        if x >= xs[-1]:
            return ys[-1] + m[-1] * (x - xs[-1])
        i = _bisect.bisect_right(xs, x) - 1
        i = min(i, n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1]
                + (t3 - t2) * h[i] * m[i + 1])
    return f


def lerp(a, b, t):
    return a + (b - a) * t


def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def fillet_path(pts, rad, nseg, narc):
    """Polyline P0..Pn in 2D; corners 1..n-1 rounded with radius rad[k]. nseg[k] intervals on straight k,
    narc intervals per arc. Returns sampled points P0..Pn without duplicates."""
    P = [Vector(p) for p in pts]
    tin, tout, arcs = {}, {}, {}
    for k in range(1, len(P) - 1):
        a, b, c = P[k - 1], P[k], P[k + 1]
        u, v = (a - b), (c - b)
        lu, lv = u.length, v.length
        u.normalize(); v.normalize()
        ang = u.angle(v)
        if ang > pi - 2e-3:
            d = min(0.01, 0.3 * lu, 0.3 * lv)
            tin[k], tout[k], arcs[k] = b + u * d, b + v * d, None
            continue
        d = rad[k] / tan(ang / 2)
        d = min(d, 0.45 * lu, 0.45 * lv)
        r = d * tan(ang / 2)
        p1, p2 = b + u * d, b + v * d
        bis = (u + v).normalized()
        ctr = b + bis * (r / sin(ang / 2))
        tin[k], tout[k], arcs[k] = p1, p2, (ctr, r)
    out = [P[0].copy()]
    for k in range(len(P) - 1):
        s = P[0] if k == 0 else tout[k]
        e = P[-1] if k == len(P) - 2 else tin[k + 1]
        for i in range(1, nseg[k] + 1):
            out.append(s.lerp(e, i / nseg[k]))
        if k + 1 < len(P) - 1:
            arc = arcs[k + 1]
            p1, p2 = tin[k + 1], tout[k + 1]
            if arc is None:
                for i in range(1, narc + 1):
                    out.append(p1.lerp(p2, i / narc))
            else:
                ctr, r = arc
                a1 = atan2(p1.y - ctr.y, p1.x - ctr.x)
                a2 = atan2(p2.y - ctr.y, p2.x - ctr.x)
                da = a2 - a1
                while da > pi:
                    da -= 2 * pi
                while da < -pi:
                    da += 2 * pi
                for i in range(1, narc + 1):
                    a = a1 + da * i / narc
                    out.append(Vector((ctr.x + r * cos(a), ctr.y + r * sin(a))))
    return out


def rounded_rect(a0, a1, b0, b1, r, n_arc=5, step=0.03):
    """Closed 2D loop (counter-clockwise) of a rectangle with corner radius r, sampled about every `step`."""
    r = min(r, 0.49 * (a1 - a0), 0.49 * (b1 - b0))
    pts = []
    corners = [((a1 - r, b0 + r), -pi / 2), ((a1 - r, b1 - r), 0.0), ((a0 + r, b1 - r), pi / 2), ((a0 + r, b0 + r), pi)]
    for (cx, cy), st in corners:
        for i in range(n_arc + 1):
            a = st + (pi / 2) * i / n_arc
            pts.append((cx + r * cos(a), cy + r * sin(a)))
    return densify(pts, step, closed=True)


def densify(pts, step, closed=False):
    out = []
    n = len(pts)
    rng = n if closed else n - 1
    for i in range(rng):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % n])
        k = max(1, int(math.ceil((b - a).length / step)))
        for j in range(k):
            out.append(tuple(a.lerp(b, j / k)))
    if not closed:
        out.append(tuple(pts[-1]))
    return out


# ----------------------------------------------------------------------------------------------- bmesh builders
def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def bm_to_obj(bm, name, coll=None, free=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    if free:
        bm.free()
    for m in MATS:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    return link(ob, coll)


def loft(bm, rings, mat=W, cap0=True, cap1=True, closed=True):
    n = len(rings[0])
    V = [[bm.verts.new(p) for p in r] for r in rings]
    faces = []
    m = n if closed else n - 1
    for i in range(len(V) - 1):
        for j in range(m):
            jn = (j + 1) % n
            f = bm.faces.new((V[i][j], V[i][jn], V[i + 1][jn], V[i + 1][j]))
            f.material_index = mat
            faces.append((f, i, j))
    caps = []
    if cap0:
        f = bm.faces.new(list(reversed(V[0])))
        f.material_index = mat
        caps.append(f)
    if cap1:
        f = bm.faces.new(V[-1])
        f.material_index = mat
        caps.append(f)
    return V, faces, caps


def revolve(bm, profs, cy, cz, mat=W, axis_dir=1):
    """profs[k] = list of (x, r) for angle phi_k = 2 pi k / n, first and last points on the axis (r = 0).
    Axis parallel to X through (cy, cz). Angle 0 = +Y, pi/2 = +Z."""
    n = len(profs)
    m = len(profs[0])
    front = bm.verts.new((profs[0][0][0], cy, cz))
    back = bm.verts.new((profs[0][-1][0], cy, cz))
    V = []
    for k, pr in enumerate(profs):
        ph = 2 * pi * k / n
        c, s = cos(ph), sin(ph)
        V.append([bm.verts.new((x, cy + r * c, cz + r * s)) for (x, r) in pr[1:-1]])
    out = []
    for k in range(n):
        kn = (k + 1) % n
        out.append(bm.faces.new((front, V[kn][0], V[k][0])))
        for i in range(m - 3):
            out.append(bm.faces.new((V[k][i], V[kn][i], V[kn][i + 1], V[k][i + 1])))
        out.append(bm.faces.new((V[k][-1], V[kn][-1], back)))
    for f in out:
        f.material_index = mat
    return out


def lathe(bm, prof, cy, cz, n=48, mat=W):
    return revolve(bm, [prof] * n, cy, cz, mat)


def box(bm, c, size, mat=W, rot=None):
    """Axis-aligned box (optionally rotated by Matrix rot about its centre)."""
    c = Vector(c)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    corners = [Vector((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    if rot is not None:
        corners = [rot @ v for v in corners]
    vs = [bm.verts.new(c + v) for v in corners]
    idx = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    fs = [bm.faces.new([vs[i] for i in q]) for q in idx]
    for f in fs:
        f.material_index = mat
    return fs


def prism(bm, loop3d, normal, h_out, d_in, mat=W):
    """Closed prism: loop (3D points on a surface) pushed out by h_out and in by d_in along normal."""
    nrm = Vector(normal).normalized()
    top = [bm.verts.new(Vector(p) + nrm * h_out) for p in loop3d]
    bot = [bm.verts.new(Vector(p) - nrm * d_in) for p in loop3d]
    n = len(loop3d)
    fs = [bm.faces.new(top), bm.faces.new(list(reversed(bot)))]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((top[i], bot[i], bot[j], top[j])))
    for f in fs:
        f.material_index = mat
    return fs


def sweep(bm, path, normals, profile, closed=False, mat=W):
    """Sweep a 2D profile [(b, n), ...] (closed loop) along a 3D path with given surface normals.
    b axis = normal x tangent."""
    P = [Vector(p) for p in path]
    N = [Vector(n).normalized() for n in normals]
    k = len(P)
    rings = []
    for i in range(k):
        if closed:
            t = P[(i + 1) % k] - P[i - 1]
        else:
            t = P[min(i + 1, k - 1)] - P[max(i - 1, 0)]
        t.normalize()
        n = (N[i] - t * N[i].dot(t)).normalized()
        b = n.cross(t).normalized()
        rings.append([P[i] + b * pb + n * pn for (pb, pn) in profile])
    V, faces, caps = loft(bm, rings, mat, cap0=not closed, cap1=not closed, closed=True)
    if closed:
        m = len(profile)
        for j in range(m):
            jn = (j + 1) % m
            f = bm.faces.new((V[-1][j], V[-1][jn], V[0][jn], V[0][j]))
            f.material_index = mat
    return V


def finish(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def is_manifold(bm):
    return all(e.is_manifold for e in bm.edges)


# ----------------------------------------------------------------------------------------------- paint by planes
def poly_inside(pt, poly):
    x, y = pt
    ins = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if xi > x:
                ins = not ins
    return ins


AX = {'Z': (0, 1, 2), 'Y': (0, 2, 1), 'X': (1, 2, 0)}   # projection axis -> (a index, b index, axis index)


def paint_poly(bm, poly, axis, side, mat, faces_ok=None, margin=0.25):
    """Cut the mesh along the edges of a 2D polygon (seen along `axis`) and assign `mat` to the faces inside it
    whose normal faces `side` (+1 toward +axis, -1 toward -axis, 0 any). Colour edges become real mesh edges."""
    ia, ib, ic = AX[axis]
    n = len(poly)
    amin = min(p[0] for p in poly) - margin; amax = max(p[0] for p in poly) + margin
    bmin = min(p[1] for p in poly) - margin; bmax = max(p[1] for p in poly) + margin

    def region_faces():
        out = []
        for f in bm.faces:
            c = f.calc_center_median()
            if not (amin < c[ia] < amax and bmin < c[ib] < bmax):
                continue
            if side and f.normal[ic] * side < 0.05:
                continue
            if faces_ok and not faces_ok(f, c):
                continue
            out.append(f)
        return out
    for i in range(n):
        p1, p2 = Vector(poly[i]), Vector(poly[(i + 1) % n])
        e = p2 - p1
        L = e.length
        if L < 1e-6:
            continue
        ed = e / L
        nrm2 = Vector((-ed.y, ed.x))
        fs = []
        for f in region_faces():
            c = f.calc_center_median()
            q = Vector((c[ia], c[ib])) - p1
            along = q.dot(ed)
            if -0.12 < along < L + 0.12 and abs(q.dot(nrm2)) < 0.15:
                fs.append(f)
        if not fs:
            continue
        geom = set(fs)
        for f in fs:
            geom.update(f.edges)
            geom.update(f.verts)
        co = [0.0, 0.0, 0.0]; co[ia], co[ib] = p1.x, p1.y
        no = [0.0, 0.0, 0.0]; no[ia], no[ib] = nrm2.x, nrm2.y
        bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=co, plane_no=no)
    cnt = 0
    if mat is None:          # outline only (stencil zones): edges, no colour change
        return 0
    for f in region_faces():
        c = f.calc_center_median()
        if poly_inside((c[ia], c[ib]), poly):
            f.material_index = mat
            cnt += 1
    return cnt


def cut_plane(bm, co, no, faces_ok=None):
    geom = set()
    for f in bm.faces:
        if faces_ok and not faces_ok(f, f.calc_center_median()):
            continue
        geom.add(f); geom.update(f.edges); geom.update(f.verts)
    bmesh.ops.bisect_plane(bm, geom=list(geom), dist=1e-5, plane_co=co, plane_no=no)


# ================================================================================================ PROFILES
# Measured off the old model (sections and silhouettes at 16.21 m/unit), see README "Proportions".
F_HW = pchip([(7.86, 0.215), (7.50, 0.37), (7.00, 0.51), (6.50, 0.60), (6.00, 0.67), (5.00, 0.82), (4.00, 0.97),
              (3.50, 1.06), (3.00, 1.15), (2.50, 1.21), (2.00, 1.26), (1.50, 1.33), (1.00, 1.37), (0.40, 1.38),
              (0.00, 1.35), (-1.00, 1.26), (-2.00, 1.20), (-3.00, 1.12), (-4.00, 1.00), (-5.00, 0.94),
              (-5.80, 0.90), (-6.35, 0.85)])
F_ZT_AFT = [(0.00, 0.78), (-0.50, 0.795), (-1.00, 0.83), (-2.00, 0.90), (-3.00, 0.975), (-3.60, 1.00),
            (-4.20, 0.99), (-5.00, 0.93), (-5.80, 0.77), (-6.35, 0.57)]
F_ZT_NOSE = [(7.86, -0.31), (7.50, -0.25), (7.00, -0.14), (6.50, -0.045), (6.00, 0.035), (5.00, 0.195)]
if VARIANT == "A":
    # old nose line: the deck rises into the windscreen
    F_ZT = pchip(F_ZT_NOSE + [(4.00, 0.36), (3.50, 0.50), (3.00, 0.632), (2.50, 0.722), (2.00, 0.762),
                              (1.50, 0.777), (1.00, 0.78)] + F_ZT_AFT)
else:
    # B: the deck ahead of and beside the windscreen is lowered so that, from the eye, the glass edge lies on the
    # -19 deg sight line (centre at x 2.70, the pillar feet at x 1.30); blended into the old nose by x 5.0
    F_ZT = pchip(F_ZT_NOSE + [(4.50, 0.236), (4.00, 0.258), (3.50, 0.266), (3.00, 0.258), (2.70, 0.240),
                              (2.45, 0.31), (2.00, 0.44), (1.60, 0.55), (1.30, 0.62), (1.00, 0.72), (0.80, 0.772),
                              (0.40, 0.78)] + F_ZT_AFT)
F_ZB = pchip([(7.86, -0.655), (7.50, -0.68), (7.00, -0.725), (6.50, -0.765), (6.00, -0.78), (5.00, -0.81),
              (4.00, -0.86), (3.00, -0.917), (2.20, -0.97), (1.78, -1.00), (1.52, -1.30), (1.00, -1.32),
              (0.00, -1.335), (-1.00, -1.32), (-1.50, -1.29), (-2.00, -1.23), (-2.50, -1.16), (-3.00, -1.08),
              (-3.50, -0.99), (-4.00, -0.92), (-5.00, -0.76), (-5.80, -0.52), (-6.35, -0.34)])
F_FT = pchip([(7.86, 0.40), (4.00, 0.45), (3.00, 0.53), (2.50, 0.61), (2.00, 0.645), (-1.00, 0.645), (-2.00, 0.62),
              (-3.00, 0.57), (-6.35, 0.55)])
F_FB = pchip([(7.86, 0.60), (4.00, 0.62), (2.0, 0.62), (1.5, 0.60), (-6.35, 0.62)])
F_AU = pchip([(7.86, 30.0), (4.00, 30.0), (2.60, 42.0), (2.00, 45.0), (-1.50, 45.0), (-3.20, 30.0), (-6.35, 30.0)])
# lower chamfer: 42 deg on the nose, a flatter 22 deg under the broad belly (old: -1.21 at y = 1.2)
F_AL = pchip([(7.86, 42.0), (2.2, 42.0), (1.5, 24.0), (-2.5, 24.0), (-3.6, 40.0), (-6.35, 42.0)])
X_TIP, X_DOME, X_TAIL = 7.985, 7.86, -6.35

# Fuselage cross-section counts per half: top flat, upper chamfer, side, lower chamfer, bottom (+4 arcs of 4)
F_SEG = [7, 9, 8, 6, 7]
F_ARC = 4


def fus_params(x):
    hw, zt, zb = F_HW(x), F_ZT(x), F_ZB(x)
    ft, fb = F_FT(x), F_FB(x)
    zcu = zt - hw * (1 - ft) * tan(radians(F_AU(x)))
    zcl = zb + hw * (1 - fb) * tan(radians(F_AL(x)))
    if zcu < zcl + 0.04:
        mid = 0.5 * (zcu + zcl)
        zcu, zcl = mid + 0.02, mid - 0.02
    return hw, zt, zb, ft, fb, zcu, zcl


def fus_half(x):
    hw, zt, zb, ft, fb, zcu, zcl = fus_params(x)
    s = min(1.0, hw / 1.0)
    rr = [0, max(0.012, 0.05 * s), max(0.01, 0.04 * s), max(0.01, 0.04 * s), max(0.012, 0.05 * s), 0]
    pts = [(0, zt), (ft * hw, zt), (hw, zcu), (hw, zcl), (fb * hw, zb), (0, zb)]
    return fillet_path(pts, rr, F_SEG, F_ARC)


def fus_ring(x, scale=1.0, zc=None):
    half = fus_half(x)
    if scale != 1.0:
        zc0 = 0.5 * (half[0].y + half[-1].y) if zc is None else zc
        half = [Vector((p.x * scale, zc0 + (p.y - zc0) * scale)) for p in half]
    right = [Vector((x, p.x, p.y)) for p in half]
    left = [Vector((x, -p.x, p.y)) for p in reversed(half[1:-1])]
    return right + left


F_NHALF = sum(F_SEG) + 4 * F_ARC          # intervals per half
F_N = 2 * F_NHALF                          # points per ring


def fus_cat(j):
    """Section feature of ring interval j: 0 top, 1 upper chamfer, 2 side, 3 lower chamfer, 4 bottom
    (x.5 = the fillet arc after feature x)."""
    k = j if j < F_NHALF else (F_N - 1 - j)
    acc = 0
    for i, s in enumerate(F_SEG):
        acc += s
        if k < acc:
            return i
        if i < 4:
            acc += F_ARC
            if k < acc:
                return i + 0.5
    return 4


# Canopy (glass) and dorsal ridge: Lame-curve sections  |y/w|^n2 + |(z-zb)/h|^n1 = 1
CAN_X1 = -0.85                        # glass rear edge
CAN_WMAX = 0.66
if VARIANT == "A":
    CAN_X0 = 2.85                        # glass front tip
    CAN_TOP = pchip([(2.85, 0.62), (2.60, 0.795), (2.30, 0.885), (2.00, 0.97), (1.50, 1.115), (1.00, 1.205),
                     (0.50, 1.272), (0.00, 1.307), (-0.50, 1.322), (-0.85, 1.318)])
else:
    CAN_X0 = 2.70
    CAN_TOP = pchip([(2.70, 0.236), (2.45, 0.47), (2.20, 0.645), (2.00, 0.765), (1.50, 1.02), (1.00, 1.17),
                     (0.50, 1.265), (0.00, 1.307), (-0.50, 1.322), (-0.85, 1.318)])


def can_w(x):
    xm = 0.75
    if x > xm:
        u = min(1.0, (x - xm) / (CAN_X0 - xm))
        return CAN_WMAX * max(0.0, 1 - u ** 2.0) ** 0.5
    if x > -0.30:
        return CAN_WMAX
    return CAN_WMAX - (-0.30 - x) * 0.0727


def can_point(x, th, inset=0.0):
    """Point on the glass at station x, angle th (0 = right sill, pi/2 = top, pi = left sill)."""
    w = max(can_w(x) - inset, 1e-4)
    zs = F_ZT(x) - 0.004
    zt = CAN_TOP(x) - inset
    h = max(zt - zs, 1e-4)
    n1 = n2 = 2.3
    c, s = cos(th), sin(th)
    y = w * math.copysign(abs(c) ** (2 / n2), c)
    z = zs + h * math.copysign(abs(s) ** (2 / n1), s)
    return Vector((x, y, z))


def can_normal(x, th):
    e = 1e-3
    p = can_point(x, th)
    dx = can_point(x + e, th) - can_point(x - e, th)
    dt = can_point(x, th + e) - can_point(x, th - e)
    n = dx.cross(dt)
    if n.length < 1e-9:
        return Vector((0, 0, 1))
    n.normalize()
    ctr = Vector((x, 0, F_ZT(x) - 0.004))
    if n.dot(p - ctr) < 0:
        n = -n
    return n


RID_W = pchip([(0.10, 0.50), (-0.80, 0.585), (-0.85, 0.635), (-1.30, 0.84), (-1.80, 0.99), (-2.40, 1.00),
               (-3.00, 0.88), (-3.50, 0.68)])
RID_TOP = pchip([(-0.85, 1.318), (-1.50, 1.315), (-2.20, 1.29), (-2.60, 1.20), (-2.90, 1.10), (-3.20, 1.03),
                 (-3.50, 0.97)])


def ridge_ring(x, nth=40):
    if x > -0.82:   # turtle deck under the rear glazing, 7 cm under the glass, low behind the seat
        t = smooth01((0.10 - x) / 0.9)
        top = lerp(0.97, CAN_TOP(x) - 0.075, t)
        w = can_w(x) - 0.07
        n1, n2 = 2.3, 2.3
    else:
        top = RID_TOP(x)
        w = RID_W(x)
        t = smooth01((-0.85 - x) / 0.8)
        n1, n2 = lerp(2.3, 3.0, t), lerp(2.3, 1.45, t)
    zdeck = F_ZT(x)
    zb = zdeck - 0.15
    h = max(top - zb, 0.03)
    pts = []
    for i in range(nth + 1):
        th = pi * i / nth
        c, s = cos(th), sin(th)
        y = w * math.copysign(abs(c) ** (2 / n2), c)
        z = zb + h * abs(s) ** (2 / n1)
        pts.append(Vector((x, y, z)))
    pts.append(Vector((x, -w, zb - 0.35)))
    pts.append(Vector((x, w, zb - 0.35)))
    return pts


# Wing planform (straight lines fitted to the old silhouette), anhedral 6 deg
def w_le(y):
    return -0.24 - 0.60 * (y - 3.0)


def w_te(y):
    return -4.78 + 0.28 * (y - 3.0)


W_Y0, W_Y1 = 0.90, 6.48
W_ANH = radians(5.7)


def w_z(y):
    """z of the leading edge (old model: -0.28 at y = 3, -0.52 at y = 6)."""
    return -0.28 - 0.08 * (y - 3.0)


# Faceted thick section measured off the old wing at y = 3..6 (12% thick, flat underside, max thickness at 58%
# chord, trailing edge 2.4% of chord above the leading edge): (u, z/c) facet corners.
WING_UP = [(1.0, 0.025), (0.80, 0.058), (0.58, 0.073), (0.36, 0.068), (0.15, 0.043), (0.0, 0.0)]
WING_LO = [(0.0, 0.0), (0.07, -0.031), (0.18, -0.045), (0.58, -0.046), (0.82, -0.024), (1.0, 0.019)]


def wing_section(chord):
    """Closed loop (u, z/c) of the faceted section with small radii at the facet corners."""
    loop = WING_UP + WING_LO[1:] + [WING_UP[0]]
    r = [0, 0.004, 0.004, 0.004, 0.004, 0.0025, 0.004, 0.004, 0.004, 0.004, 0.0015, 0]
    nseg = [3, 3, 3, 3, 3, 2, 2, 5, 3, 3, 1]
    pts = fillet_path([(u, z) for u, z in loop], r, nseg, 2)
    return [(p.x, p.y) for p in pts[:-1]]


def naca_t(u, tc):
    return 5 * tc * (0.2969 * sqrt(max(u, 0)) - 0.1260 * u - 0.3516 * u ** 2 + 0.2843 * u ** 3 - 0.1036 * u ** 4)


def airfoil(chord, tc, n=26, te_half=0.003):
    """Upper TE->LE then lower LE->TE as (u, zoff) pairs, cosine spaced, finite TE."""
    us = [0.5 * (1 - cos(pi * i / n)) for i in range(n + 1)]
    up = [(u, max(naca_t(u, tc) * chord, te_half * u)) for u in reversed(us)]
    lo = [(u, -max(naca_t(u, tc) * chord, te_half * u)) for u in us[1:-1]]
    return up + lo


# Stencil zones (flat UV islands for decals later): plan/side polygons in the old-model frame, +Y side
def _wq(u0, u1, ya, yb):
    c = lambda y: w_le(y) - w_te(y)
    return [(w_le(ya) - u0 * c(ya), ya), (w_le(yb) - u0 * c(yb), yb), (w_le(yb) - u1 * c(yb), yb),
            (w_le(ya) - u1 * c(ya), ya)]


STENCILS = {
    "wing": _wq(0.39, 0.61, 5.38, 6.02),                         # upper wing, roundel / national marking
    "nose": [(5.55, -0.44), (6.05, -0.44), (6.05, -0.26), (5.55, -0.26)],   # nose sides (seen along Y): modex
}


# Fin (wingtip): vertical, y = +-6.55
FIN_Y = 6.48
FIN_Z0, FIN_Z1 = -0.88, 1.05


def fin_le(z):
    return lerp(-2.40, -3.65, (z - FIN_Z0) / (FIN_Z1 - FIN_Z0))


def fin_te(z):
    return lerp(-4.00, -4.45, (z - FIN_Z0) / (FIN_Z1 - FIN_Z0))


# Nacelle
NAC_Y, NAC_Z, NAC_R = 1.86, 0.36, 0.70
NAC_XC, NAC_DX = -2.875, 0.325          # lip plane centre and half scarf (lower lip -2.55, upper -3.20)
NAC_XEND = -6.15
NAC_XFAN = -3.90
NOZ_X0, NOZ_X1, NOZ_R0, NOZ_R1 = -6.15, -7.24, 0.635, 0.575


def nac_lip_x(r, ph):
    return NAC_XC - NAC_DX * (r / 0.66) * sin(ph)


# Trunk (cheek intake ducts under the wing roots)
TR_YO = pchip([(1.3, 2.44), (0.0, 2.43), (-4.5, 2.42), (-6.25, 2.30)])
TR_ZB = pchip([(1.3, -0.93), (0.0, -0.95), (-4.0, -0.95), (-5.0, -0.95), (-6.25, -0.96)])
TR_ZT = pchip([(1.3, -0.22), (-4.8, -0.22), (-5.6, -0.35), (-6.25, -0.48)])
TR_YI = 1.02
TR_X0, TR_X1 = 1.30, -6.25
# intake mouth plane: through (0.92, 1.0) and (0.0, 2.6) in plan, raked so the top lip leads by 0.18 per metre
MOUTH_P = Vector((0.92, 1.0, -0.6))
MOUTH_D1 = Vector((-0.92, 1.6, 0.0)).normalized()
MOUTH_D2 = Vector((0.18, 0.0, 1.0)).normalized()
MOUTH_N = MOUTH_D1.cross(MOUTH_D2).normalized()
if MOUTH_N.x < 0:
    MOUTH_N = -MOUTH_N

EYE = Vector((0.55, 0.0, 0.97))
GUN_Z = 0.27 if VARIANT == "A" else 0.13
VENT_Z = (-0.30, -0.04) if VARIANT == "A" else (-0.44, -0.20)
DASH_TOP = 0.735 if VARIANT == "A" else 0.42


# ================================================================================================ COMPONENTS
def build_fuselage():
    bm = bmesh.new()
    rings = []
    step = 0.08
    nst = int(round((X_DOME - X_TAIL) / step))
    main = [X_DOME - (X_DOME - X_TAIL) * i / nst for i in range(nst + 1)] + [6.95]
    main = sorted(set(round(x, 4) for x in main), reverse=True)
    # nose dome: the section at X_DOME shrunk toward its centre, then the main stations
    for k in [5.7, 5, 4, 3, 2, 1]:
        a = (pi / 2) * k / 6
        ring = fus_ring(X_DOME, cos(a))
        x = X_DOME + (X_TIP - X_DOME) * sin(a)
        for v in ring:
            v.x = x
        rings.append(ring)
    for x in main:
        rings.append(fus_ring(x))
    V, faces, caps = loft(bm, rings, W, cap0=True, cap1=True)
    # paint: radome (x > 6.95) grey, belly (lower chamfer + bottom) grey, deck round the canopy grey
    for f, i, j in faces:
        c = f.calc_center_median()
        cat = fus_cat(j)
        if c.x > 6.95 or c.x < -5.60:
            f.material_index = G
        elif cat >= 3:
            f.material_index = G
        elif cat == 0 and -0.95 < c.x < 3.05:
            f.material_index = G
    for f in caps:
        f.material_index = G
    finish(bm)
    # red stripe down the top of the nose
    stripe = [(6.05, -0.06), (6.05, 0.06), (3.30, 0.06), (3.30, -0.06)]
    paint_poly(bm, stripe, 'Z', +1, R, faces_ok=lambda f, c: c.z > F_ZT(c.x) - 0.02)
    for sd in (1, -1):
        paint_poly(bm, STENCILS["nose"], 'Y', sd, None)
    return bm


def build_ridge():
    bm = bmesh.new()
    xs = [0.10 - (0.10 + 3.50) * i / 64 for i in range(65)] + [-0.80, -0.82, -0.85]
    xs = sorted(set(round(x, 4) for x in xs), reverse=True)
    rings = [ridge_ring(x) for x in xs]
    V, faces, caps = loft(bm, rings, W)
    for f, i, j in faces:
        if f.calc_center_median().x > -0.84:
            f.material_index = G      # turtle deck under the glass
    for f in caps:
        f.material_index = G
    return finish(bm)


def build_trunk(side):
    bm = bmesh.new()
    xs = [TR_X0 - (TR_X0 - TR_X1) * i / 60 for i in range(61)]
    rings = []
    for x in xs:
        yo, zb, zt = TR_YO(x), TR_ZB(x), TR_ZT(x)
        loop = [((TR_YI + yo) / 2, zt), (yo, zt), (yo, zb), (TR_YI, zb), (TR_YI, zt), ((TR_YI + yo) / 2 - 0.01, zt)]
        p = fillet_path(loop, [0, 0.02, 0.15, 0.08, 0.02, 0], [3, 5, 8, 5, 3], 4)
        rings.append([Vector((x, side * q.x, q.y)) for q in p[:-1]])
    V, faces, caps = loft(bm, rings, W)
    for f, i, j in faces:
        c = f.calc_center_median()
        if c.z < TR_ZB(c.x) + 0.18 or f.normal.z < -0.5:
            f.material_index = G
    finish(bm)
    # cut the swept, raked mouth and close it
    mn = Vector((MOUTH_N.x, MOUTH_N.y * side, MOUTH_N.z))
    mp = Vector((MOUTH_P.x, MOUTH_P.y * side, MOUTH_P.z))
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=mp,
                           plane_no=mn, clear_outer=True)
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        r = bmesh.ops.edgeloop_fill(bm, edges=edges)
        for f in r.get("faces", []):
            f.material_index = G
    return finish(bm)


def build_wing(side):
    bm = bmesh.new()
    ys = [W_Y0 + (W_Y1 - W_Y0) * i / 56 for i in range(57)]
    rings = []
    for y in ys:
        le, te = w_le(y), w_te(y)
        c = le - te
        z0 = w_z(y)
        rings.append([Vector((le - u * c, side * y, z0 + zc * c)) for (u, zc) in wing_section(c)])
    V, faces, caps = loft(bm, rings, W)
    finish(bm)
    for f in bm.faces:              # the old model's whole underside is grey
        if f.normal.z < -0.15:
            f.material_index = G
    # grey leading-edge strip outboard of the nacelle (0.20 m deep), as a real edge
    strip = [(w_le(2.55) + 0.5, 2.55), (w_le(6.6) + 0.5, 6.6), (w_le(6.6) - 0.35, 6.6), (w_le(2.55) - 0.35, 2.55)]
    strip = [(a, side * b) for a, b in strip]
    paint_poly(bm, strip, 'Z', +1, G)
    paint_poly(bm, strip, 'Z', -1, G)

    def le_band(y0, y1, d0, d1):
        return [(w_le(y0) - d0, y0), (w_le(y1) - d0, y1), (w_le(y1) - d1, y1), (w_le(y0) - d1, y0)]

    def te_band(y0, y1, d0, d1):
        return [(w_te(y0) + d1, y0), (w_te(y1) + d1, y1), (w_te(y1) + d0, y1), (w_te(y0) + d0, y0)]
    def chord(y):
        return w_le(y) - w_te(y)
    # red LE stripe 0.11 m wide, 4 cm behind the LE-flap hinge (16% chord), so no groove runs inside it
    y0, y1 = 3.9, 6.15
    lb = [(w_le(y0) - 0.16 * chord(y0) - 0.04, y0), (w_le(y1) - 0.16 * chord(y1) - 0.04, y1),
          (w_le(y1) - 0.16 * chord(y1) - 0.15, y1), (w_le(y0) - 0.16 * chord(y0) - 0.15, y0)]
    for poly in (lb, te_band(4.75, 6.15, 0.26, 0.38)):
        paint_poly(bm, [(a, side * b) for a, b in poly], 'Z', +1, R)
    # walkway outline (no-step border) on the root just outboard of the nacelle: 5 cm grey border
    def wq(u0, u1, ya, yb):
        return [(w_le(ya) - u0 * chord(ya), ya), (w_le(yb) - u0 * chord(yb), yb),
                (w_le(yb) - u1 * chord(yb), yb), (w_le(ya) - u1 * chord(ya), ya)]
    outer = wq(0.20, 0.68, 2.66, 3.20)
    inner = [(outer[0][0] - 0.05, 2.71), (outer[1][0] - 0.05, 3.15), (outer[2][0] + 0.05, 3.15),
             (outer[3][0] + 0.05, 2.71)]
    paint_poly(bm, [(a, side * b) for a, b in outer], 'Z', +1, G)
    paint_poly(bm, [(a, side * b) for a, b in inner], 'Z', +1, W)
    # stencil zone (roundel) between the spars near the tip: cut its outline so it unwraps as one flat island
    paint_poly(bm, [(a, side * b) for a, b in STENCILS["wing"]], 'Z', +1, None)

    def wuv(u, y):
        return (w_le(y) - u * (w_le(y) - w_te(y)), y)
    flap = [wuv(0.72, 2.75), wuv(0.72, 4.55), wuv(1.05, 4.55), wuv(1.05, 2.75)]
    for zs in (1, -1):
        paint_poly(bm, [(a, side * b) for a, b in flap], 'Z', zs, G)
    return finish(bm)


def build_fin(side):
    bm = bmesh.new()
    zs = [FIN_Z0 + (FIN_Z1 - FIN_Z0) * i / 30 for i in range(31)]
    rings = []
    for z in zs:
        le, te = fin_le(z), fin_te(z)
        c = le - te
        prof = airfoil(c, 0.08, n=22, te_half=0.003)
        rings.append([Vector((le - u * c, side * (FIN_Y + dz), z)) for (u, dz) in prof])
    V, faces, caps = loft(bm, rings, W)
    finish(bm)
    le_poly = [(fin_le(FIN_Z0) + 0.3, FIN_Z0 - 0.1), (fin_le(FIN_Z1) + 0.3, FIN_Z1 + 0.1),
               (fin_le(FIN_Z1) - 0.14, FIN_Z1 + 0.1), (fin_le(FIN_Z0) - 0.14, FIN_Z0 - 0.1)]
    paint_poly(bm, le_poly, 'Y', 0, G)

    def chord_pt(z, f):
        return lerp(fin_le(z), fin_te(z), f)
    za, zb_ = -0.30, 0.82
    red = [(chord_pt(za, 0.28), za), (chord_pt(zb_, 0.30), zb_), (chord_pt(zb_, 0.66), zb_), (chord_pt(za, 0.64), za)]
    paint_poly(bm, red, 'Y', side, R)
    return finish(bm)


def build_pod(side):
    bm = bmesh.new()
    prof = [(-1.90, 0.0), (-1.93, 0.045), (-2.00, 0.085), (-2.12, 0.118), (-2.28, 0.142), (-2.45, 0.155),
            (-3.90, 0.155), (-4.10, 0.145), (-4.28, 0.115), (-4.40, 0.085), (-4.40, 0.0)]
    lathe(bm, prof, side * FIN_Y, -0.60, n=32, mat=W)
    finish(bm)
    for f in bm.faces:
        c = f.calc_center_median()
        if c.x > -2.06 or c.x < -4.05:
            f.material_index = G
    return bm


def build_nacelle(side):
    bm = bmesh.new()
    n = 72
    profs = []
    aft = [-5.20, -5.32, -5.55, -5.70, -5.85, -5.95, -6.04, -6.10, NAC_XEND]
    aft_r = [0.70, 0.70, 0.699, 0.695, 0.686, 0.675, 0.66, 0.648, NOZ_R0]
    for k in range(n):
        ph = 2 * pi * k / n
        xl = lambda r: nac_lip_x(r, ph)
        pr = [(NAC_XC, 0.0), (xl(0.30), 0.30), (xl(0.61), 0.61), (xl(0.64) - 0.006, 0.64),
              (xl(0.66) - 0.025, 0.668), (xl(0.68) - 0.06, 0.687), (xl(0.70) - 0.12, 0.697), (xl(0.70) - 0.20, 0.70)]
        x0 = xl(0.70) - 0.20
        for i in range(1, 11):
            pr.append((lerp(x0, -5.08, i / 10), 0.70))
        pr += list(zip(aft, aft_r))
        pr += [(NAC_XEND, 0.40), (NAC_XEND, 0.0)]
        profs.append(pr)
    revolve(bm, profs, side * NAC_Y, NAC_Z, W)
    finish(bm)
    for f in bm.faces:
        c = f.calc_center_median()
        lipx = NAC_XC - NAC_DX * ((c.z - NAC_Z) / 0.66)
        if c.x > lipx - 0.13 or c.x > -3.55:
            f.material_index = G
        elif -5.32 < c.x < -5.20:
            f.material_index = R
        elif c.x < -5.85:
            f.material_index = G
    return bm


def can_stations(n=72):
    out = []
    for i in range(n + 1):
        t = i / n
        # denser near the front tip
        out.append(CAN_X0 - (CAN_X0 - CAN_X1) * (t ** 1.25))
    return out


def build_glass():
    bm = bmesh.new()
    nth = 56
    xs = can_stations()[1:]
    rings = [[can_point(x, pi * j / nth) for j in range(nth + 1)] for x in xs]
    V = [[bm.verts.new(p) for p in r] for r in rings]
    tip = bm.verts.new(Vector((CAN_X0, 0.0, F_ZT(CAN_X0) - 0.004)))
    for j in range(nth):
        bm.faces.new((tip, V[0][j + 1], V[0][j]))
    for i in range(len(V) - 1):
        for j in range(nth):
            bm.faces.new((V[i][j], V[i][j + 1], V[i + 1][j + 1], V[i + 1][j]))
    for f in bm.faces:
        f.material_index = GL
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # outward = away from the cockpit centre
    up = sum((f.normal.z for f in bm.faces if f.calc_center_median().z > 1.1), 0.0)
    if up < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


def bow_x(th, plane):
    """x where the canopy surface at angle th meets a plane x = a + k (z - 0.78)."""
    a, k = plane
    lo, hi = CAN_X1 + 0.01, CAN_X0 - 0.02
    f = lambda x: x - (a + k * (can_point(x, th).z - 0.78))
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return None
    for _ in range(50):
        mid = 0.5 * (lo + hi)
        fm = f(mid)
        if (fm > 0) == (fhi > 0):
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return 0.5 * (lo + hi)


def frame_profile(w, h_out=0.022, d_in=0.028, ch=0.010):
    return [(-w / 2, -d_in), (-w / 2, h_out - ch), (-w / 2 + ch, h_out), (w / 2 - ch, h_out), (w / 2, h_out - ch),
            (w / 2, -d_in)]


HOOP_PLANE = (-0.02, 0.0)       # behind the pilot's head, out of the forward view
REAR_PLANE = (-0.83, 0.0)
BOW_AZ = radians(40.0)          # A-pillars lie on the vertical planes through the eye at +-40 deg (approved view)
BOW_XH = 0.86                   # header station: from the eye its lower edge sits above +30 deg, out of view


def bow_path(n=120):
    """Windscreen bow: pillars on the +-40 deg sight planes, header across the top at BOW_XH, corners blended."""
    t = tan(BOW_AZ)
    out = []
    for i in range(-4, n + 5):
        th = pi * i / n
        def f(x):
            return abs(can_point(x, th).y) - (x - EYE.x) * t
        lo, hi = EYE.x + 0.02, CAN_X0 - 0.03
        xp = None
        if f(lo) > 0 > f(hi):
            for _ in range(50):
                mid = 0.5 * (lo + hi)
                if f(mid) > 0:
                    lo = mid
                else:
                    hi = mid
            xp = 0.5 * (lo + hi)
        a, b, k = (xp if xp is not None else EYE.x), BOW_XH, 0.10
        x = 0.5 * (a + b + sqrt((a - b) ** 2 + k * k))
        out.append((x, th))
    return out


def build_frames():
    """Canopy frame: sill rails, windscreen bow (A-pillars + header), hoop, rear bow. Returns list of bmeshes."""
    out = []
    bm = bmesh.new()
    pts = bow_path()
    path = [can_point(x, th) for x, th in pts]
    nrm = [can_normal(x, max(min(th, pi - 1e-3), 1e-3)) for x, th in pts]
    sweep(bm, path, nrm, frame_profile(0.045, 0.016, 0.016, 0.008), mat=F)
    out.append(finish(bm))
    for plane, w in ((HOOP_PLANE, 0.075), (REAR_PLANE, 0.085)):
        bm = bmesh.new()
        path, nrm = [], []
        for i in range(-3, 64):
            th = pi * i / 60
            x = bow_x(th, plane)
            if x is None:
                continue
            path.append(can_point(x, th))
            nrm.append(can_normal(x, max(min(th, pi - 1e-3), 1e-3)))
        sweep(bm, path, nrm, frame_profile(w), mat=F)
        out.append(finish(bm))
    # sill rail: one U round the canopy base (glass edge), lying on the deck
    bm = bmesh.new()
    plan = []
    for i in range(14):
        x = lerp(CAN_X1 + 0.02, 0.70, i / 13)
        plan.append((x, -can_w(x)))
    for i in range(1, 60):
        ph = -pi / 2 + pi * i / 60
        plan.append((0.75 + (CAN_X0 - 0.75) * cos(ph), CAN_WMAX * sin(ph)))
    for i in range(13, -1, -1):
        x = lerp(CAN_X1 + 0.02, 0.70, i / 13)
        plan.append((x, can_w(x)))
    path = [Vector((x, y, F_ZT(x) - 0.004)) for x, y in plan]
    nrm = []
    for x, y in plan:
        e = 0.01
        dz = (F_ZT(x + e) - F_ZT(x - e)) / (2 * e)
        nrm.append(Vector((-dz, 0, 1)).normalized())
    prof = [(-0.040, -0.05), (-0.040, 0.012), (-0.030, 0.022), (0.030, 0.022), (0.040, 0.012), (0.040, -0.05)]
    sweep(bm, path, nrm, prof, mat=F)
    out.append(finish(bm))
    return out


def build_tub():
    """Cockpit cavity cutter (grey walls)."""
    bm = bmesh.new()
    xs = [2.28 - (2.28 - 0.16) * i / 24 for i in range(25)]
    rings = []
    for x in xs:
        hw = 0.55 if x < 1.75 else lerp(0.55, 0.40, (x - 1.75) / 0.53)
        z0 = -0.12 if x < 1.6 else lerp(-0.12, 0.30, (x - 1.6) / 0.68)
        loop = [(0, 1.45), (hw, 1.45), (hw, z0), (-hw, z0), (-hw, 1.45), (-0.001, 1.45)]
        p = fillet_path(loop, [0, 0.05, 0.10, 0.10, 0.05, 0], [3, 8, 8, 8, 3], 4)
        rings.append([Vector((x, q.x, q.y)) for q in p[:-1]])
    loft(bm, rings, G)
    return finish(bm)


# ================================================================================================ CAVITY CUTTERS
def build_trunk_duct(side):
    """Intake duct cut into the trunk: dark walls, ends 3 m in at a vane face."""
    bm = bmesh.new()
    xs = [1.8 - (1.8 + 1.9) * i / 30 for i in range(31)]
    rings = []
    for x in xs:
        yi, yo = 1.47, TR_YO(x) - 0.045
        zb, zt = TR_ZB(x) + 0.045, -0.28
        loop = [((yi + yo) / 2, zt), (yo, zt), (yo, zb), (yi, zb), (yi, zt), ((yi + yo) / 2 - 0.01, zt)]
        p = fillet_path(loop, [0, 0.06, 0.10, 0.06, 0.06, 0], [3, 4, 6, 4, 3], 3)
        rings.append([Vector((x, side * q.x, q.y)) for q in p[:-1]])
    loft(bm, rings, W)
    return finish(bm)


def build_nacelle_duct(side):
    bm = bmesh.new()
    n = 72
    profs = []
    for k in range(n):
        ph = 2 * pi * k / n
        x0 = nac_lip_x(0.585, ph) + 0.03
        pr = [(x0 + 0.2, 0.0), (x0 + 0.2, 0.30), (x0 + 0.03, 0.62), (x0 - 0.04, 0.585)]
        for i in range(1, 8):
            pr.append((lerp(x0 - 0.04, NAC_XFAN, i / 7), 0.585))
        pr += [(NAC_XFAN, 0.30), (NAC_XFAN, 0.0)]
        profs.append(pr)
    revolve(bm, profs, side * NAC_Y, NAC_Z, G)
    finish(bm)
    for f in bm.faces:
        if f.calc_center_median().x < NAC_XFAN + 0.01:
            f.material_index = D
    return bm


def rr_loop_x(xc, yc, zc, wy, hz, r, side_axis='X', n_arc=4):
    """Rounded rectangle in the plane x = xc (for pockets on the tail face)."""
    pts = rounded_rect(yc - wy / 2, yc + wy / 2, zc - hz / 2, zc + hz / 2, r, n_arc, step=0.05)
    return [Vector((xc, a, b)) for a, b in pts]


def build_tail_pockets():
    out = []
    for s in (1, -1):
        bm = bmesh.new()
        loop_front = rr_loop_x(X_TAIL + 0.55, s * 0.40, 0.10, 0.50, 0.44, 0.12)
        prism(bm, loop_front, (-1, 0, 0), 0.65, 0.0, D)
        out.append(finish(bm))
        # trunk rear vents
        bm = bmesh.new()
        loop = rr_loop_x(TR_X1 + 0.40, s * 1.80, -0.775, 0.80, 0.26, 0.08)
        prism(bm, loop, (-1, 0, 0), 0.6, 0.0, D)
        out.append(finish(bm))
    return out


# ================================================================================================ ADDED PARTS
def frame_of(n, t_hint=Vector((1, 0, 0))):
    n = Vector(n).normalized()
    t = (t_hint - n * t_hint.dot(n))
    if t.length < 1e-4:
        t = Vector((0, 1, 0)) - n * n.y
    t.normalize()
    b = n.cross(t)
    return t, b, n


def mat3(t, b, n):
    return Matrix((t, b, n)).transposed()


def cyl(bm, p0, p1, r0, r1, n=24, mat=D, cap=True):
    """Truncated cone between p0 and p1 (closed)."""
    p0, p1 = Vector(p0), Vector(p1)
    ax = (p1 - p0)
    L = ax.length
    ax.normalize()
    t, b, _ = frame_of(ax, Vector((0, 0, 1)) if abs(ax.z) < 0.9 else Vector((1, 0, 0)))
    ringa = [p0 + (t * cos(2 * pi * i / n) + b * sin(2 * pi * i / n)) * r0 for i in range(n)]
    ringb = [p1 + (t * cos(2 * pi * i / n) + b * sin(2 * pi * i / n)) * r1 for i in range(n)]
    loft(bm, [ringa, ringb], mat, cap0=cap, cap1=cap)


def build_fan(side):
    bm = bmesh.new()
    cy, cz = side * NAC_Y, NAC_Z
    x_face = NAC_XFAN
    # spinner and hub
    lathe(bm, [(x_face + 0.36, 0.0), (x_face + 0.33, 0.05), (x_face + 0.24, 0.12), (x_face + 0.12, 0.17),
               (x_face + 0.02, 0.19), (x_face + 0.0, 0.19), (x_face + 0.0, 0.0)], cy, cz, 32, D)
    nb = 22
    for k in range(nb):
        a = 2 * pi * k / nb
        er = Vector((0, cos(a), sin(a)))
        et = Vector((0, -sin(a), cos(a)))
        ex = Vector((1, 0, 0))
        rings = []
        for i in range(6):
            r = lerp(0.17, 0.575, i / 5)
            beta = radians(lerp(28, 62, i / 5))
            ch = ex * cos(beta) + et * sin(beta) * side
            th = -ex * sin(beta) + et * cos(beta) * side
            c = Vector((x_face + 0.10, cy, cz)) + er * r
            hc = lerp(0.085, 0.065, i / 5)
            tk = lerp(0.008, 0.004, i / 5)
            rings.append([c + ch * hc + th * tk, c - ch * hc + th * tk, c - ch * hc - th * tk, c + ch * hc - th * tk])
        loft(bm, rings, D)
    return finish(bm)


def build_nozzle(side):
    """Variable-geometry nozzle: base ring, 18 petals with seals between, dark liner, hot core set back 0.62 m."""
    bm = bmesh.new()
    cy, cz = side * NAC_Y, NAC_Z
    ctr = Vector((0, cy, cz))
    # base ring (actuator ring) behind the cowl
    lathe(bm, [(NOZ_X0 + 0.01, 0.0), (NOZ_X0 + 0.01, 0.645), (NOZ_X0 - 0.06, 0.652), (NOZ_X0 - 0.20, 0.652),
               (NOZ_X0 - 0.22, 0.60), (NOZ_X0 - 0.22, 0.0)], cy, cz, 72, G)
    npet = 18
    x0, x1 = NOZ_X0 - 0.16, NOZ_X1
    for k in range(npet):
        for kind in ("petal", "seal"):
            if kind == "petal":
                a0 = 2 * pi * k / npet
                half = (pi / npet) * 0.80
                dr, tk, mat = 0.0, 0.022, G
            else:
                a0 = 2 * pi * (k + 0.5) / npet
                half = (pi / npet) * 0.42
                dr, tk, mat = -0.016, 0.014, D
            rings = []
            for i in range(7):
                t = i / 6
                x = lerp(x0, x1, t)
                r = lerp(NOZ_R0 + 0.008, NOZ_R1, t) + dr - 0.012 * sin(pi * t)
                outer, inner = [], []
                for j in range(5):
                    a = a0 - half + 2 * half * j / 4
                    dirv = Vector((0, cos(a), sin(a)))
                    outer.append(Vector((x, cy, cz)) + dirv * r)
                    inner.append(Vector((x, cy, cz)) + dirv * (r - tk))
                rings.append(outer + list(reversed(inner)))
            loft(bm, rings, mat)
            if kind == "petal":
                # stiffening rib down the middle of each petal
                rib = []
                for i in range(7):
                    t = i / 6
                    x = lerp(x0 + 0.05, x1 + 0.06, t)
                    r = lerp(NOZ_R0 + 0.008, NOZ_R1, t) - 0.012 * sin(pi * t)
                    dirv = Vector((0, cos(a0), sin(a0)))
                    tv = Vector((0, -sin(a0), cos(a0)))
                    c = Vector((x, cy, cz)) + dirv * r
                    rib.append([c + tv * 0.012, c + tv * 0.012 + dirv * 0.012, c - tv * 0.012 + dirv * 0.012,
                                c - tv * 0.012])
                loft(bm, rib, G)
    # liner tube (dark), core disk (glow), centre cone, flame-holder vanes
    lathe(bm, [(NOZ_X0 - 0.10, 0.0), (NOZ_X0 - 0.10, 0.57), (NOZ_X1 + 0.06, 0.552), (NOZ_X1 + 0.06, 0.53),
               (NOZ_X0 - 0.12, 0.548), (NOZ_X0 - 0.12, 0.0)], cy, cz, 72, D)
    xc = NOZ_X1 + 0.62
    lathe(bm, [(xc + 0.02, 0.0), (xc + 0.02, 0.54), (xc, 0.54), (xc, 0.0)], cy, cz, 48, E)
    lathe(bm, [(xc - 0.01, 0.0), (xc - 0.01, 0.17), (xc - 0.12, 0.16), (xc - 0.30, 0.08), (xc - 0.36, 0.0)],
          cy, cz, 32, D)
    for k in range(6):
        a = 2 * pi * k / 6 + pi / 6
        er = Vector((0, cos(a), sin(a)))
        et = Vector((0, -sin(a), cos(a)))
        p0 = Vector((xc - 0.05, cy, cz)) + er * 0.15
        p1 = Vector((xc - 0.05, cy, cz)) + er * 0.54
        rings = [[p + Vector((0.03, 0, 0)) + et * 0.008, p + Vector((-0.03, 0, 0)) + et * 0.008,
                  p + Vector((-0.03, 0, 0)) - et * 0.008, p + Vector((0.03, 0, 0)) - et * 0.008] for p in (p0, p1)]
        loft(bm, rings, D)
    for rr in (0.27, 0.43):      # V-gutter flame holders (rings)
        lathe(bm, [(xc - 0.03, 0.0), (xc - 0.03, rr + 0.022), (xc - 0.085, rr + 0.004), (xc - 0.085, rr - 0.004),
                   (xc - 0.03, rr - 0.022), (xc - 0.03, 0.0)], cy, cz, 48, D)
    return finish(bm)


def build_vanes():
    """Vanes in the trunk duct ends, the tail exhausts and the trunk rear vents."""
    bm = bmesh.new()
    for s in (1, -1):
        for i in range(6):
            y = lerp(1.55, 2.27, (i + 0.5) / 6)
            box(bm, (-1.84, s * y, -0.62), (0.10, 0.018, 0.62), D)
        for i in range(3):
            z = 0.10 + (i - 1) * 0.13
            rot = Matrix.Rotation(radians(18), 3, 'Y')
            box(bm, (X_TAIL + 0.20, s * 0.40, z), (0.22, 0.48, 0.016), D, rot)
        for i in range(3):
            z = -0.775 + (i - 1) * 0.075
            rot = Matrix.Rotation(radians(-25), 3, 'Y')
            box(bm, (TR_X1 + 0.12, s * 1.80, z), (0.16, 0.78, 0.012), D, rot)
    return finish(bm)


def build_gun_blister(side):
    bm = bmesh.new()
    prof = [(1.48, 0.0), (1.48, 0.068), (1.45, 0.088), (1.38, 0.095), (0.75, 0.095), (0.35, 0.075), (0.10, 0.04),
            (0.02, 0.0)]
    lathe(bm, prof, side * 1.34, GUN_Z, 28, W)
    return finish(bm)


GUN_MUZZLE = Vector((1.48, 1.34, GUN_Z))


def build_nacelle_fairing(side):
    """Accessory-gearbox fairing on the inboard top of each nacelle (grey), tapered at both ends."""
    bm = bmesh.new()
    ph = radians(112) if side > 0 else radians(68)
    er = Vector((0, cos(ph), sin(ph)))
    et = Vector((0, -sin(ph), cos(ph)))
    ctr = Vector((0, side * NAC_Y, NAC_Z))
    xs = [lerp(-3.85, -5.20, i / 16) for i in range(17)]
    rings = []
    for x in xs:
        t = (x + 3.85) / (-5.20 + 3.85)
        k = min(1.0, smooth01(t / 0.25), smooth01((1 - t) / 0.30))
        hw, h = 0.17 * (0.55 + 0.45 * k), 0.12 * k + 0.005
        loop = [(0, NAC_R - 0.06), (hw, NAC_R - 0.06), (hw, NAC_R + h), (-hw, NAC_R + h), (-hw, NAC_R - 0.06),
                (-0.001, NAC_R - 0.06)]
        pts = fillet_path(loop, [0, 0.01, 0.035, 0.035, 0.01, 0], [2, 3, 5, 3, 2], 3)
        rings.append([Vector((x, 0, 0)) + ctr + et * q.x + er * q.y for q in pts[:-1]])
    loft(bm, rings, G)
    return finish(bm)


def build_gun_parts(side):
    bm = bmesh.new()
    m = Vector((GUN_MUZZLE.x, side * GUN_MUZZLE.y, GUN_MUZZLE.z))
    cyl(bm, m + Vector((-0.30, 0, 0)), m + Vector((0.07, 0, 0)), 0.034, 0.034, 20, D)
    # muzzle device: slotted ring
    cyl(bm, m + Vector((0.035, 0, 0)), m + Vector((0.09, 0, 0)), 0.042, 0.042, 20, D)
    return finish(bm)


def build_gun_pocket(side):
    bm = bmesh.new()
    m = Vector((GUN_MUZZLE.x, side * GUN_MUZZLE.y, GUN_MUZZLE.z))
    cyl(bm, m + Vector((-0.32, 0, 0)), m + Vector((0.2, 0, 0)), 0.058, 0.058, 24, D)
    return finish(bm)


def build_canoes(side):
    """Actuator (canoe) fairings under the flaperon and aileron hinge lines."""
    bm = bmesh.new()
    for (u, yy) in ((0.72, 3.25), (0.72, 4.10), (0.76, 5.15), (0.76, 5.95)):
        xh = w_le(yy) - u * (w_le(yy) - w_te(yy))
        x0, x1 = xh + 0.30, w_te(yy) - 0.12
        zl = w_z(yy) - 0.046 * (w_le(yy) - w_te(yy))      # flat underside of the section
        rings = []
        for i in range(13):
            t = i / 12
            x = lerp(x0, x1, t)
            k = max(sin(pi * t) ** 0.6, 0.06)
            hw, h = 0.05 * k + 0.004, 0.075 * k + 0.004
            loop = [(0, zl + 0.04), (hw, zl + 0.04), (hw, zl - h), (-hw, zl - h), (-hw, zl + 0.04),
                    (-0.001, zl + 0.04)]
            pts = fillet_path(loop, [0, 0.003, 0.025, 0.025, 0.003, 0], [1, 2, 3, 2, 1], 3)
            rings.append([Vector((x, side * yy + q.x, q.y)) for q in pts[:-1]])
        loft(bm, rings, G)
    return finish(bm)


def build_exhaust_rims():
    """Raised lips round the two tail exhausts and the trunk rear vents (grey), unioned."""
    bm = bmesh.new()
    for s_ in (1, -1):
        for (yc, zc, wy, hz, r) in ((s_ * 0.40, 0.10, 0.50, 0.44, 0.12), (s_ * 1.80, -0.775, 0.80, 0.26, 0.08)):
            x_face = X_TAIL if abs(yc) < 1 else TR_X1
            inner = rounded_rect(yc - wy / 2, yc + wy / 2, zc - hz / 2, zc + hz / 2, r, 4, 0.04)
            outer = rounded_rect(yc - wy / 2 - 0.035, yc + wy / 2 + 0.035, zc - hz / 2 - 0.035, zc + hz / 2 + 0.035,
                                 r + 0.035, 4, 0.04)
            n = min(len(inner), len(outer))
            # resample both loops to the same count
            def res(loop, m):
                pts = [Vector(q) for q in loop]
                L = [0.0]
                for i in range(len(pts)):
                    L.append(L[-1] + (pts[(i + 1) % len(pts)] - pts[i]).length)
                out = []
                for j in range(m):
                    d = L[-1] * j / m
                    i = max(k for k in range(len(pts)) if L[k] <= d)
                    t = (d - L[i]) / max(L[i + 1] - L[i], 1e-9)
                    out.append(pts[i].lerp(pts[(i + 1) % len(pts)], t))
                return out
            m = 64
            ri, ro = res(inner, m), res(outer, m)
            xa, xb = x_face + 0.08, x_face - 0.035
            rings = []
            for (x, loop) in ((xa, ro), (xb, ro), (xb, ri), (xa, ri)):
                rings.append([Vector((x, q.x, q.y)) for q in loop])
            V = [[bm.verts.new(v) for v in r_] for r_ in rings]
            for a in range(4):
                b = (a + 1) % 4
                for j in range(m):
                    jn = (j + 1) % m
                    f = bm.faces.new((V[a][j], V[a][jn], V[b][jn], V[b][j]))
                    f.material_index = G
    return finish(bm)


def build_diverter(side):
    """Boundary-layer diverter slot between the fuselage and each intake's inner lip (dark)."""
    bm = bmesh.new()
    box(bm, (0.45, side * 1.365, -0.60), (1.70, 0.11, 0.50), D)
    finish(bm)
    mn = Vector((MOUTH_N.x, MOUTH_N.y * side, MOUTH_N.z))
    mp = Vector((MOUTH_P.x, MOUTH_P.y * side, MOUTH_P.z)) + mn * 0.012
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-5, plane_co=mp, plane_no=mn,
                           clear_outer=True)
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        r = bmesh.ops.edgeloop_fill(bm, edges=edges)
        for f in r.get("faces", []):
            f.material_index = D
    return finish(bm)


def rbox(bm, c, size, mat, rot=None, r=0.015):
    """Box with rounded (bevelled) edges."""
    tmp = bmesh.new()
    box(tmp, c, size, mat, rot)
    bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=min(r, 0.45 * min(size)), segments=2, affect='EDGES',
                    profile=0.5)
    me = bpy.data.meshes.new("tmp_rbox")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


PYLON_Y = 4.0


def build_pylon(side):
    bm = bmesh.new()
    zs = [-0.42, -0.60, -0.78, -0.86]
    rings = []
    for z in zs:
        c = 1.95 if z > -0.8 else 1.85
        xle = -1.40 if z > -0.8 else -1.45
        prof = airfoil(c, 0.065, n=14, te_half=0.004)
        rings.append([Vector((xle - u * c, side * (PYLON_Y + dz), z)) for (u, dz) in prof])
    loft(bm, rings, G)
    finish(bm)
    # launch rail under the pylon
    box(bm, (-2.22, side * PYLON_Y, -0.895), (2.15, 0.11, 0.07), G)
    box(bm, (-1.16, side * PYLON_Y, -0.895), (0.08, 0.13, 0.08), G)
    return finish(bm)


MISSILE_SOCKET = Vector((-1.10, PYLON_Y, -0.93))


def build_antennas():
    bm = bmesh.new()
    for sgn, zroot, ztip in ((1, 0.92, 1.55), (-1, -0.96, -1.55)):
        rings = []
        for t in (0.0, 1.0):
            z = lerp(zroot, ztip, t)
            le = lerp(-3.05, -3.40, t)
            c = lerp(0.40, 0.13, t)
            prof = airfoil(c, 0.11, n=10, te_half=0.002)
            rings.append([Vector((le - u * c, dz, z)) for (u, dz) in prof])
        loft(bm, rings, G)
    return finish(bm)


def build_domes():
    bm = bmesh.new()
    # SATCOM dome on the spine, a belly dome, RWR fairings on the fin tips, tail sting
    for (x, y, z, r, mat) in ((-3.78, 0.0, 0.99, 0.17, G), (-2.70, 0.0, -1.16, 0.12, G)):
        prof = [(0.0, r), (0.35 * r, 0.94 * r), (0.7 * r, 0.71 * r), (0.92 * r, 0.38 * r), (1.0 * r, 0.0)]
        sgn = 1 if z > 0 else -1
        # hemisphere along +-Z made from a lathe about X then rotated
        bmd = bmesh.new()
        h = 0.42 * r            # low blister, not a ball
        pts = [(-0.10, 0.0), (-0.10, r)] + [(h * sin(a), r * cos(a)) for a in [i * (pi / 2) / 8 for i in range(1, 9)]]
        pts[-1] = (h, 0.0)
        lathe(bmd, pts, 0, 0, 28, mat)
        rot = Matrix.Rotation(radians(-90 * sgn), 4, 'Y')
        bmesh.ops.transform(bmd, matrix=Matrix.Translation((x, y, z)) @ rot, verts=bmd.verts[:])
        me = bpy.data.meshes.new("tmp")
        bmd.to_mesh(me)
        bmd.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    for s in (1, -1):
        # RWR fairing on each fin tip
        lathe(bm, [(-3.93, 0.0), (-3.96, 0.022), (-4.02, 0.040), (-4.58, 0.036), (-4.62, 0.02), (-4.63, 0.0)],
              s * FIN_Y, FIN_Z1 - 0.012, 16, G)
    # tail sting (rear warning sensor boom)
    lathe(bm, [(X_TAIL + 0.15, 0.0), (X_TAIL + 0.15, 0.05), (-7.05, 0.03), (-7.12, 0.022), (-7.18, 0.0)],
          0, 0.12, 16, G)
    return finish(bm)


def build_interior():
    """Cockpit tub contents (placeholder for the interior job): ejection seat, consoles, dash, stick, throttle."""
    bm = bmesh.new()
    tilt = Matrix.Rotation(radians(-14), 3, 'Y')
    rbox(bm, (0.58, 0, 0.13), (0.50, 0.46, 0.10), D, None, 0.03)          # seat pan cushion
    rbox(bm, (0.30, 0, 0.55), (0.10, 0.46, 0.80), D, tilt, 0.03)          # back cushion
    rbox(bm, (0.24, 0, 0.55), (0.06, 0.56, 0.95), G, tilt, 0.015)         # seat bucket back
    rbox(bm, (0.20, 0, 1.01), (0.16, 0.36, 0.22), G, tilt, 0.03)          # headrest / parachute box
    rbox(bm, (0.30, 0, 1.01), (0.04, 0.26, 0.16), D, tilt, 0.012)         # head pad
    for s in (1, -1):
        rbox(bm, (0.45, s * 0.265, 0.30), (0.62, 0.05, 0.40), G, None, 0.012)   # seat side walls
        box(bm, (0.36, s * 0.31, 0.55), (0.06, 0.03, 1.05), D, tilt)          # ejection rails
        rbox(bm, (0.95, s * 0.47, 0.36), (1.25, 0.16, 0.16), G, None, 0.02)    # side consoles
        box(bm, (0.95, s * 0.47, 0.445), (1.15, 0.13, 0.01), D)               # console panels
    dz = DASH_TOP - 0.735
    rbox(bm, (2.10, 0, 0.47 + dz), (0.10, 0.84, 0.46), G, Matrix.Rotation(radians(18), 3, 'Y'), 0.02)  # panel
    box(bm, (2.04, 0, 0.50 + dz), (0.02, 0.62, 0.22), D, Matrix.Rotation(radians(18), 3, 'Y'))        # displays
    rbox(bm, (2.06, 0, 0.71 + dz), (0.28, 0.86, 0.05), G, None, 0.02)                                 # glare shield
    cyl(bm, (1.18, 0, 0.05), (1.18, 0, 0.40), 0.02, 0.018, 12, D)        # stick
    box(bm, (1.18, 0, 0.44), (0.05, 0.04, 0.09), D)
    box(bm, (1.05, 0.46, 0.50), (0.10, 0.05, 0.10), D)                    # throttle
    return finish(bm)


# ================================================================================================ GROOVES AND POCKETS
class Surf:
    """Ray-casts onto the visible outer surface of the unioned body; optional filter to one component."""

    def __init__(self, body):
        me = body.data
        self.verts = [v.co.copy() for v in me.vertices]
        self.polys = [tuple(p.vertices) for p in me.polygons]
        self.mats = [p.material_index for p in me.polygons]
        self.bvh = BVHTree.FromPolygons(self.verts, self.polys, all_triangles=False)

    def on_comp(self, p, comp):
        if not comp:
            return True
        b = COMP_BVH.get(comp)
        if b is None:
            return True
        hit = b.find_nearest(p)
        return hit[0] is not None and hit[3] < 4e-3

    def cast(self, o, d, comp):
        hit = self.bvh.ray_cast(o, d, 60.0)
        if hit[0] is None:
            return None
        p, n = hit[0], hit[1]
        if n.dot(d) > 0:
            n = -n
        if not self.on_comp(p, comp):
            return None
        return p, n

    def cast_plane(self, a, b, plane, side, comp):
        if plane == 'Z':
            o = Vector((a, b, 30.0 * side)); d = Vector((0, 0, -side))
        elif plane == 'Y':
            o = Vector((a, 30.0 * side, b)); d = Vector((0, -side, 0))
        else:  # 'X'
            o = Vector((30.0 * side, a, b)); d = Vector((-side, 0, 0))
        return self.cast(o, d, comp)

    def cast_ring(self, x, psi, cy, cz, comp, R=6.0):
        dirv = Vector((0, cos(psi), sin(psi)))
        o = Vector((x, cy, cz)) + dirv * R
        return self.cast(o, -dirv, comp)


def mirror_comp(comp):
    if comp and comp.endswith("L"):
        return comp[:-1] + "R"
    return comp


def runs(hits):
    out, cur = [], []
    for h in hits:
        if h is None:
            if len(cur) > 1:
                out.append(cur)
            cur = []
        else:
            if cur and (h[0] - cur[-1][0]).length < 1e-4:
                continue
            if cur and (h[0] - cur[-1][0]).length > 0.25:   # jumped across a gap
                if len(cur) > 1:
                    out.append(cur)
                cur = []
            cur.append(h)
    if len(cur) > 1:
        out.append(cur)
    return out


def smooth_normals(run, k=2):
    ns = []
    for i in range(len(run)):
        acc = Vector((0, 0, 0))
        for j in range(max(0, i - k), min(len(run), i + k + 1)):
            acc += run[j][1]
        ns.append(acc.normalized())
    return ns


CUTTERS = []        # (bmesh) groove ribbons and pockets, collected then applied in one boolean


def dp_keep(pts, tol):
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        pa, pb = pts[a], pts[b]
        ab = pb - pa
        L2 = max(ab.length_squared, 1e-12)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            t = max(0.0, min(1.0, (pts[i] - pa).dot(ab) / L2))
            dd = (pts[i] - (pa + ab * t)).length
            if dd > best:
                best, bi = dd, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return keep


def simplify_run(run, closed, tol=0.0012):
    if len(run) < 3:
        return run
    pts = [h[0] for h in run]
    if closed:
        far = max(range(len(pts)), key=lambda i: (pts[i] - pts[0]).length)
        k1 = dp_keep(pts[:far + 1], tol)
        k2 = dp_keep(pts[far:] + [pts[0]], tol)
        keep = k1[:-1] + k2[:-1]
    else:
        keep = dp_keep(pts, tol)
    # never leave a gap longer than 0.6 m (keeps the ribbon hugging gently curved skin)
    out, last = [], None
    for i, h in enumerate(run):
        if keep[i] or (last is not None and (h[0] - last).length > 0.6):
            out.append(h)
            last = h[0]
    return out


def ribbon(run, closed, w=GROOVE_W, d=GROOVE_D, mat=TAG):
    if len(run) < 2:
        return
    sm = smooth_normals(run)
    run = [(h[0], n) for h, n in zip(run, sm)]
    run = simplify_run(run, closed)
    if len(run) < 2:
        return
    GROOVE_LEN[0] += sum((run[i + 1][0] - run[i][0]).length for i in range(len(run) - 1))
    bm = bmesh.new()
    prof = [(-w / 2, -d), (-w / 2, 0.02), (w / 2, 0.02), (w / 2, -d)]
    sweep(bm, [h[0] for h in run], [h[1] for h in run], prof, closed=closed, mat=mat)
    CUTTERS.append(finish(bm))


GROOVE_LEN = [0.0]


def groove(S, pts2d, plane, side, comp, closed=False, mirror=True, w=GROOVE_W, d=GROOVE_D, step=0.025):
    pts = densify(pts2d, step, closed=closed)
    variants = [(side, comp, 1)]
    if mirror:
        if plane == 'Y':
            variants.append((-side, mirror_comp(comp), 1))
        elif plane == 'Z':
            variants.append((side, mirror_comp(comp), -1))
    n = 0
    for sd, cp, ysign in variants:
        if plane == 'Z' and ysign < 0:
            if all(abs(b) < 1e-6 for a, b in pts):
                continue
            pp = [(a, -b) for a, b in pts]
        else:
            pp = pts
        hits = [S.cast_plane(a, b, plane, sd, cp) for a, b in pp]
        rs = runs(hits)
        whole = closed and len(rs) == 1 and all(h is not None for h in hits)
        for r in rs:
            ribbon(r, whole, w, d)
            n += 1
    return n


def ring_groove(S, x, cy, cz, comp, psi0=0.0, psi1=2 * pi, mirror_y=False, w=GROOVE_W, d=GROOVE_D):
    for ysign in ((1, -1) if mirror_y else (1,)):
        npts = max(8, int(abs(psi1 - psi0) / radians(1.0)))
        full = abs(psi1 - psi0) >= 2 * pi - 1e-6
        cp = comp if ysign > 0 else mirror_comp(comp)
        hits = []
        for i in range(npts + (0 if full else 1)):
            psi = psi0 + (psi1 - psi0) * i / npts
            hits.append(S.cast_ring(x, psi, cy * ysign, cz, cp))
        rs = runs(hits)
        whole = full and len(rs) == 1 and all(h is not None for h in hits)
        for r in rs:
            ribbon(r, whole, w, d)


def pocket(S, loop2d, plane, side, comp, depth, mat, mirror=True, h_out=0.08):
    """Recess cut along the local normal: walls and floor get `mat` (TAG = inherit the skin)."""
    out = []
    variants = [(side, comp, 1)]
    if mirror:
        if plane == 'Y':
            variants.append((-side, mirror_comp(comp), 1))
        elif plane == 'Z':
            variants.append((side, mirror_comp(comp), -1))
    for sd, cp, ysign in variants:
        pp = [(a, b * ysign) for a, b in loop2d] if plane == 'Z' else loop2d
        hits = [S.cast_plane(a, b, plane, sd, cp) for a, b in pp]
        if any(h is None for h in hits):
            log("  pocket missed surface", plane, side, comp, loop2d[0])
            continue
        nrm = Vector((0, 0, 0))
        for h in hits:
            nrm += h[1]
        nrm.normalize()
        bm = bmesh.new()
        prism(bm, [h[0] for h in hits], nrm, h_out, depth, mat)
        CUTTERS.append(finish(bm))
        c = Vector((0, 0, 0))
        for h in hits:
            c += h[0]
        out.append((c / len(hits), nrm))
    return out


NACA_HALF = [(0.0, 0.083), (0.1, 0.158), (0.2, 0.236), (0.3, 0.312), (0.4, 0.369), (0.5, 0.410), (0.6, 0.440),
             (0.7, 0.460), (0.8, 0.480), (0.9, 0.495), (1.0, 0.500)]


def naca(S, x_front, L, W_, yc, plane, side, comp, mirror=True, ramp_deg=7.0):
    """NACA submerged inlet: ogive walls, floor ramping down at ~7 deg to a vertical rear lip (dark)."""
    left = [(x_front - t * L, yc + h * W_) for t, h in NACA_HALF]
    right = [(x_front - t * L, yc - h * W_) for t, h in reversed(NACA_HALF)]
    loop = left + right
    ts = [t for t, h in NACA_HALF] + [t for t, h in reversed(NACA_HALF)]
    D = L * tan(radians(ramp_deg))
    variants = [(1, comp)]
    if mirror:
        variants.append((-1, mirror_comp(comp)))
    for ysign, cp in variants:
        hits = [S.cast_plane(a, b * ysign, plane, side, cp) for a, b in loop]
        if any(h is None for h in hits):
            log("  naca missed", x_front, yc, cp)
            continue
        nrm = Vector((0, 0, 0))
        for h in hits:
            nrm += h[1]
        nrm.normalize()
        bm = bmesh.new()
        top = [bm.verts.new(h[0] + nrm * 0.03) for h in hits]
        bot = [bm.verts.new(h[0] - nrm * max(0.003, D * t)) for h, t in zip(hits, ts)]
        n = len(hits)
        fs = [bm.faces.new(top), bm.faces.new(list(reversed(bot)))]
        for i in range(n):
            j = (i + 1) % n
            fs.append(bm.faces.new((top[i], bot[i], bot[j], top[j])))
        for f in fs:
            f.material_index = G
        CUTTERS.append(finish(bm))


def circle2d(ca, cb, r, step=0.02):
    n = max(12, int(2 * pi * r / step))
    return [(ca + r * cos(2 * pi * i / n), cb + r * sin(2 * pi * i / n)) for i in range(n)]


def poly_round(pts, r=0.04, step=0.025):
    """Closed polygon with rounded corners (2D)."""
    loop = list(pts) + [pts[0]]
    n = len(loop)
    rr = [0] + [r] * (n - 2) + [0]
    # start the walk mid-way along the first edge so every corner is filleted
    a, b = Vector(pts[0]), Vector(pts[1])
    m = (a + b) / 2
    walk = [tuple(m)] + [tuple(p) for p in pts[1:]] + [tuple(pts[0]), tuple(m + (a - m) * 0.0 + (b - a) * -0.001)]
    rr = [0] + [r] * (len(walk) - 2) + [0]
    segs = []
    for i in range(len(walk) - 1):
        L = (Vector(walk[i + 1]) - Vector(walk[i])).length
        segs.append(max(1, int(L / step)))
    p = fillet_path(walk, rr, segs, 4)
    return [tuple(q) for q in p[:-1]]


def wing_uv(u, y):
    return (w_le(y) - u * (w_le(y) - w_te(y)), y)


def wing_quad(u0, u1, y0, y1, r=0.05):
    """Panel bounded by chord fractions u0..u1 and span y0..y1, corners rounded."""
    pts = [wing_uv(u0, y0), wing_uv(u0, y1), wing_uv(u1, y1), wing_uv(u1, y0)]
    return poly_round(pts, r)


def fin_uz(f, z):
    return (lerp(fin_le(z), fin_te(z), f), z)


RCS_SPOTS = []      # (centre, normal, count) for nozzle placement


def make_cutters(S):
    """All panel lines, hatches and pockets, designed on the orthographic views like a real skin layout."""
    # ---------------- fuselage rings (radial casts round the section centre)
    for x in (6.95, 5.55, 4.20, 3.10, 1.70, 0.30, -0.95, -2.60, -4.30, -5.60):
        zc = 0.5 * (F_ZT(x) + F_ZB(x))
        ring_groove(S, x, 0.0, zc, "fuselage")
    # stringers along the nose sides just inside the chines
    xs = [6.95 - (6.95 - 1.70) * i / 60 for i in range(61)]
    groove(S, [(x, fus_params(x)[5] - 0.07) for x in xs], 'Y', 1, "fuselage")
    groove(S, [(x, fus_params(x)[6] + 0.07) for x in xs], 'Y', 1, "fuselage")
    # top of the nose: two lines either side of the red stripe
    groove(S, [(x, 0.22 * F_HW(x)) for x in [6.95 - (6.95 - 3.10) * i / 30 for i in range(31)]], 'Z', 1, "fuselage")
    # belly: keel line and nose-gear doors with sawtooth ends, weapons bay doors
    groove(S, [(6.95, 0.0), (5.25, 0.0)], 'Z', -1, "fuselage", mirror=False)
    ng = [(5.10, 0.0), (5.24, 0.20), (5.10, 0.40), (3.55, 0.40), (3.41, 0.20), (3.55, 0.0)]
    groove(S, poly_round(ng, 0.03), 'Z', -1, "fuselage", closed=True)
    groove(S, [(5.10, 0.0), (3.55, 0.0)], 'Z', -1, "fuselage", mirror=False)
    wb = [(1.25, 0.0), (1.38, 0.35), (1.25, 0.70), (-1.40, 0.70), (-1.53, 0.35), (-1.40, 0.0)]
    groove(S, poly_round(wb, 0.03), 'Z', -1, "fuselage", closed=True)
    groove(S, [(1.25, 0.0), (-1.40, 0.0)], 'Z', -1, "fuselage", mirror=False)
    # side hatches (avionics bays, boarding step) with latch recesses
    for (xa, xb, za, zb) in ((4.30, 5.40, -0.46, -0.12), (1.60, 2.25, -0.42, 0.06), (0.95, 1.30, -0.32, -0.08)):
        groove(S, rounded_rect(xa, xb, za, zb, 0.06), 'Y', 1, "fuselage", closed=True)
        for xl in (xa + 0.12, xb - 0.12):
            pocket(S, rounded_rect(xl - 0.035, xl + 0.035, zb - 0.075, zb - 0.04, 0.012, 3, 0.01), 'Y', 1, "fuselage",
                   0.005, TAG)
    # louvred side vents (old model's dark grilles)
    for (xa, xb) in ((2.42, 2.82), (3.18, 3.76)):
        pocket(S, rounded_rect(xa, xb, VENT_Z[0], VENT_Z[1], 0.03, 3, 0.02), 'Y', 1, "fuselage", 0.06, D)
        groove(S, rounded_rect(xa - 0.06, xb + 0.06, VENT_Z[0] - 0.06, VENT_Z[1] + 0.06, 0.05), 'Y', 1, "fuselage",
               closed=True)
    # sensor windows: chin EOTS (faceted), nose-side DAS, belly DAS
    pocket(S, [(5.32, -0.17), (5.74, -0.11), (5.74, 0.11), (5.32, 0.17)], 'Z', -1, "fuselage", 0.012, D, mirror=False)
    pocket(S, circle2d(3.85, -0.02, 0.065), 'Y', 1, "fuselage", 0.010, D)
    pocket(S, circle2d(-1.85, 0.0, 0.065), 'Z', -1, "fuselage", 0.010, D, mirror=False)
    # nose RCS: side-firing and up-firing clusters
    for c, nrm in pocket(S, rounded_rect(6.14, 6.36, -0.43, -0.33, 0.025, 3, 0.01), 'Y', 1, "fuselage", 0.035, G):
        RCS_SPOTS.append((c, nrm, 3))
    for c, nrm in pocket(S, rounded_rect(5.88, 6.10, 0.12, 0.22, 0.025, 3, 0.01), 'Z', 1, "fuselage", 0.035, G):
        RCS_SPOTS.append((c, nrm, 3))
    # tail RCS on the fuselage sides between the nacelles
    for zs in (1, -1):
        for c, nrm in pocket(S, rounded_rect(-6.12, -5.90, 0.24, 0.34, 0.025, 3, 0.01), 'Z', zs, "fuselage", 0.035, G):
            RCS_SPOTS.append((c, nrm, 3))
    # NACA flush inlets on the nose top, either side of the stripe (old model's paired slots)
    for (xa, L, yc) in ((4.70, 0.55, 0.27), (3.45, 0.55, 0.31)):
        naca(S, xa, L, 0.13, yc, 'Z', 1, "fuselage")
    # nose-tip sensor window (laser rangefinder / IRST), upper chamfer panels
    pocket(S, circle2d(0.0, -0.47, 0.045, 0.01), 'X', 1, "fuselage", 0.012, D, mirror=False)
    groove(S, poly_round([(4.35, 0.46), (5.40, 0.42), (5.40, 0.74), (4.35, 0.82)], 0.05), 'Z', 1, "fuselage",
           closed=True)
    groove(S, poly_round([(3.30, 0.55), (4.05, 0.50), (4.05, 0.86), (3.30, 0.94)], 0.05), 'Z', 1, "fuselage",
           closed=True)
    # nacelle outboard NACA inlets
    naca(S, -4.05, 0.45, 0.11, NAC_Y + 0.42, 'Z', 1, "nacelleL")
    # spine: docking clamp recess, panel round it
    pocket(S, circle2d(-4.60, 0.0, 0.34), 'Z', 1, "fuselage", 0.045, G, mirror=False)
    pocket(S, circle2d(-4.60, 0.0, 0.05), 'Z', 1, "fuselage", 0.16, D, mirror=False)
    groove(S, rounded_rect(-5.30, -3.90, -0.47, 0.47, 0.08), 'Z', 1, "fuselage", closed=True, mirror=False)
    groove(S, [(-3.90, 0.0), (-3.55, 0.0)], 'Z', 1, "fuselage", mirror=False)
    # ---------------- ridge behind the canopy: louvre bay, DAS window, joints
    pocket(S, rounded_rect(-2.52, -1.46, -0.30, 0.30, 0.04, 3, 0.02), 'Z', 1, "ridge", 0.09, D, mirror=False,
           h_out=0.20)
    groove(S, rounded_rect(-2.64, -1.34, -0.42, 0.42, 0.07), 'Z', 1, "ridge", closed=True, mirror=False)
    pocket(S, circle2d(-2.88, 0.0, 0.06), 'Z', 1, "ridge", 0.010, D, mirror=False)
    for x in (-1.05, -3.05):
        zc = 0.5 * (F_ZT(x) + 1.3)
        ring_groove(S, x, 0.0, zc - 0.3, "ridge")
    groove(S, [(-1.05, 0.62), (-3.05, 0.62)], 'Z', 1, "ridge")
    # ---------------- wings (upper and lower)
    for side in (1, -1):
        def wl(u0, u1, y0, y1):
            return wing_quad(u0, u1, y0, y1)
        for zs in (1, -1):
            # control surfaces: flaperon, aileron, LE flap (hinge lines + end cuts), 16 mm gaps
            for (u, ya, yb) in ((0.72, 2.75, 4.55), (0.76, 4.65, 6.28)):
                groove(S, [wing_uv(u, ya), wing_uv(u, yb)], 'Z', zs, "wingL", mirror=True, w=0.016)
                for yy in (ya, yb):
                    groove(S, [wing_uv(u - 0.01, yy), wing_uv(1.04, yy)], 'Z', zs, "wingL", mirror=True, w=0.016)
            groove(S, [wing_uv(0.16, 2.80), wing_uv(0.16, 6.28)], 'Z', zs, "wingL", mirror=True, w=0.016)
            for yy in (2.80, 6.28):
                groove(S, [wing_uv(-0.04, yy), wing_uv(0.17, yy)], 'Z', zs, "wingL", mirror=True, w=0.016)
            # spars
            groove(S, [wing_uv(0.36, 2.62), wing_uv(0.36, 6.40)], 'Z', zs, "wingL", mirror=True)
            groove(S, [wing_uv(0.62, 2.62), wing_uv(0.62, 6.40)], 'Z', zs, "wingL", mirror=True)
            # rib joints (kept clear of the roundel stencil zone between y 5.38 and 6.02)
            for yy in (3.70, 4.60, 6.12):
                groove(S, [wing_uv(0.16, yy), wing_uv(0.72, yy)], 'Z', zs, "wingL", mirror=True)
            # service caps on the rear spar (fuel-tank drains and test points)
            for yy in (3.10, 3.90, 4.70, 5.50):
                groove(S, circle2d(*wing_uv(0.665, yy), 0.035, 0.012), 'Z', zs, "wingL", closed=True)
        # access panels between the spars (upper), fuel-tank panels (lower)
        for (y0, y1) in ((3.00, 3.55), (3.85, 4.40), (4.75, 5.25)):
            groove(S, wl(0.40, 0.58, y0, y1), 'Z', 1, "wingL", closed=True)
            groove(S, wl(0.39, 0.59, y0 + 0.05, y1 - 0.05), 'Z', -1, "wingL", closed=True)
            for yy in (y0 + 0.08, y1 - 0.08):
                cx, cy_ = wing_uv(0.58, yy)
                pocket(S, rounded_rect(cx - 0.02, cx + 0.05, cy_ - 0.03, cy_ + 0.03, 0.01, 3, 0.01), 'Z', 1,
                       "wingL", 0.004, TAG)
        # gravity fuel filler: ring + recessed cap with its hinge tab
        fx, fy = wing_uv(0.27, 3.32)
        groove(S, circle2d(fx, fy, 0.075, 0.012), 'Z', 1, "wingL", closed=True)
        pocket(S, circle2d(fx, fy, 0.052, 0.01), 'Z', 1, "wingL", 0.004, TAG)
        pocket(S, rounded_rect(fx - 0.075, fx - 0.045, fy - 0.012, fy + 0.012, 0.005, 2, 0.005), 'Z', 1, "wingL",
               0.006, D)
        # control-surface hinge access doors on the flaperon and aileron lines
        for (u0, u1, yy) in ((0.645, 0.705, 3.25), (0.645, 0.705, 4.10), (0.69, 0.745, 5.15), (0.69, 0.745, 5.95)):
            groove(S, wl(u0, u1, yy - 0.10, yy + 0.10), 'Z', 1, "wingL", closed=True)
        break
    # wing-root fillet joint along the trunk/wing junction (lower)
    # ---------------- nacelles
    for x in (-3.55, -4.55, -5.20, -5.32, -5.85):
        ring_groove(S, x, NAC_Y, NAC_Z, "nacelleL", mirror_y=True)
    for ang in (radians(38), radians(142)):
        for ysign in (1, -1):
            hits = []
            for i in range(40):
                x = lerp(-3.55, -5.85, i / 39)
                hits.append(S.cast_ring(x, ang if ysign > 0 else pi - ang, NAC_Y * ysign, NAC_Z,
                                        "nacelleL" if ysign > 0 else "nacelleR"))
            for r in runs(hits):
                ribbon(r, False)
    groove(S, rounded_rect(-4.95, -3.80, 0.42, 0.80, 0.06), 'Y', 1, "nacelleL", closed=True)
    # ---------------- trunks: outer-wall joints and main gear doors (sawtooth ends)
    for x in (-0.55, -2.85, -4.70):
        groove(S, [(x, -0.98), (x, -0.40)], 'Y', 1, "trunkL")
        groove(S, [(x, 1.30), (x, 2.50)], 'Z', -1, "trunkL")
    mg = [(-0.70, 1.42), (-0.84, 1.85), (-0.70, 2.28), (-2.70, 2.28), (-2.84, 1.85), (-2.70, 1.42)]
    groove(S, poly_round(mg, 0.03), 'Z', -1, "trunkL", closed=True)
    groove(S, [(-0.77, 1.85), (-2.77, 1.85)], 'Z', -1, "trunkL")
    # ---------------- fins: rudder, root joint; pods: joints and RCS
    for ysd in (1, -1):
        groove(S, [fin_uz(0.70, -0.42), fin_uz(0.70, 0.98)], 'Y', ysd, "finL", w=0.016)
        groove(S, [fin_uz(0.69, -0.42), fin_uz(1.05, -0.42)], 'Y', ysd, "finL", w=0.016)
        groove(S, [fin_uz(0.69, 0.98), fin_uz(1.05, 0.98)], 'Y', ysd, "finL", w=0.016)
        groove(S, [fin_uz(-0.05, -0.20), fin_uz(0.70, -0.20)], 'Y', ysd, "finL")
    for x in (-2.45, -3.90):
        ring_groove(S, x, FIN_Y, -0.60, "podL", mirror_y=True)
    for c, nrm in pocket(S, rounded_rect(-2.38, -2.18, -0.645, -0.555, 0.02, 3, 0.01), 'Y', 1, "podL", 0.03, G):
        RCS_SPOTS.append((c, nrm, 2))
    for c, nrm in pocket(S, rounded_rect(-2.38, -2.18, FIN_Y - 0.045, FIN_Y + 0.045, 0.02, 3, 0.01), 'Z', -1, "podL",
                         0.03, G):
        RCS_SPOTS.append((c, nrm, 2))
    for c, nrm in pocket(S, rounded_rect(-4.02, -3.84, -0.645, -0.555, 0.02, 3, 0.01), 'Y', 1, "podL", 0.03, G):
        RCS_SPOTS.append((c, nrm, 2))


def build_rcs_nozzles():
    bm = bmesh.new()
    for c, n, k in RCS_SPOTS:
        t, b, nn = frame_of(n)
        for i in range(k):
            off = (i - (k - 1) / 2) * 0.062
            p = c + t * off - nn * 0.035
            cyl(bm, p, p + nn * 0.022, 0.024, 0.024, 14, G)
            cyl(bm, p + nn * 0.022, p + nn * 0.030, 0.021, 0.017, 14, D)
    return finish(bm)


def build_louvres():
    bm = bmesh.new()
    # ridge louvre slats (spanwise, tilted), side vents slats
    for i in range(11):
        x = lerp(-2.46, -1.52, i / 10)
        z = RID_TOP(x) - 0.088
        box(bm, (x, 0, z), (0.075, 0.56, 0.010), G, Matrix.Rotation(radians(-38), 3, 'Y'))
    for s in (1, -1):
        for (xa, xb) in ((2.42, 2.82), (3.18, 3.76)):
            nsl = int((xb - xa) / 0.065)
            for i in range(nsl):
                x = lerp(xa + 0.04, xb - 0.04, i / max(1, nsl - 1))
                y = fus_params(x)[0] - 0.035
                box(bm, (x, s * y, 0.5 * (VENT_Z[0] + VENT_Z[1])), (0.012, 0.06, VENT_Z[1] - VENT_Z[0] - 0.02), G,
                    Matrix.Rotation(radians(35 * s), 3, 'Z'))
    return finish(bm)


def build_clamp():
    bm = bmesh.new()
    z = F_ZT(-4.60) - 0.045
    for k in range(4):
        a = pi / 4 + k * pi / 2
        c = Vector((-4.60 + 0.25 * cos(a), 0.25 * sin(a), z + 0.025))
        box(bm, c, (0.10, 0.07, 0.05), D, Matrix.Rotation(a, 3, 'Z'))
        box(bm, c + Vector((0, 0, 0.03)), (0.06, 0.05, 0.02), G, Matrix.Rotation(a, 3, 'Z'))
    cyl(bm, (-4.60, 0, z - 0.01), (-4.60, 0, z + 0.004), 0.30, 0.30, 48, G)
    return finish(bm)


# ================================================================================================ ASSEMBLY
def apply_all(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def boolean(target, cutters, op='DIFFERENCE', solver='MANIFOLD', label=""):
    if not cutters:
        return
    coll = bpy.data.collections.new("tmp_bool")
    bpy.context.scene.collection.children.link(coll)
    for c in cutters:
        for uc in list(c.users_collection):
            uc.objects.unlink(c)
        coll.objects.link(c)
    nf0 = len(target.data.polygons)
    mod = target.modifiers.new("bool", 'BOOLEAN')
    mod.operation = op
    mod.solver = solver
    mod.operand_type = 'COLLECTION'
    mod.collection = coll
    mod.material_mode = 'TRANSFER'
    apply_all(target)
    nf1 = len(target.data.polygons)
    log(f"boolean {op:10s} {label:14s} {len(cutters):4d} cutters  faces {nf0} -> {nf1}")
    if nf1 == nf0:
        log("  WARNING: boolean changed nothing (non-manifold operand?)")
    for c in list(coll.objects):
        me = c.data
        bpy.data.objects.remove(c, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    bpy.data.collections.remove(coll)


def check(bm, name):
    if not is_manifold(bm):
        bad = sum(1 for e in bm.edges if not e.is_manifold)
        log(f"  WARNING {name}: {bad} non-manifold edges")
    return bm


def join(target, others):
    if not others:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def build_big_shapes():
    parts = {}
    parts["fuselage"] = check(build_fuselage(), "fuselage")
    parts["ridge"] = check(build_ridge(), "ridge")
    for s, tag in ((1, "L"), (-1, "R")):
        parts["trunk" + tag] = check(build_trunk(s), "trunk" + tag)
        parts["wing" + tag] = check(build_wing(s), "wing" + tag)
        parts["fin" + tag] = check(build_fin(s), "fin" + tag)
        parts["pod" + tag] = check(build_pod(s), "pod" + tag)
        parts["nacelle" + tag] = check(build_nacelle(s), "nacelle" + tag)
    return parts


def fix_tag(body, S):
    me = body.data
    n = 0
    for p in me.polygons:
        if p.material_index == TAG:
            c = p.center
            hit = S.bvh.find_nearest(c)
            p.material_index = S.mats[hit[2]] if hit[0] is not None and S.mats[hit[2]] != TAG else W
            n += 1
    log("inherited paint on", n, "groove faces")


def keep_materials(ob, names):
    """Reduce the object's slots to `names` (in that order), remapping face indices."""
    me = ob.data
    old = [m.name if m else None for m in me.materials]
    new_idx = {}
    for i, nm in enumerate(old):
        if nm in names:
            new_idx[i] = names.index(nm)
    idx = [p.material_index for p in me.polygons]
    bad = sum(1 for i in idx if i not in new_idx)
    if bad:
        log(f"  WARNING {ob.name}: {bad} faces on dropped slots -> {names[0]}")
    me.materials.clear()
    for nm in names:
        me.materials.append(bpy.data.materials[nm])
    for p, i in zip(me.polygons, idx):
        p.material_index = new_idx.get(i, 0)


def shade(ob, angle=32):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=radians(angle), keep_sharp_edges=True)
    mod = ob.modifiers.new("wn", 'WEIGHTED_NORMAL')
    mod.mode = 'FACE_AREA'
    mod.keep_sharp = True
    mod.weight = 50
    apply_all(ob)


def stencil_faces(ob):
    """Faces of the stencil zones (inside the outlines cut in build_*), on the outer skin."""
    me = ob.data
    sel = set()
    zones = []
    for sd in (1, -1):
        zones.append(([(a, sd * b) for a, b in STENCILS["wing"]], 'Z', 1, "wingL" if sd > 0 else "wingR"))
        zones.append((STENCILS["nose"], 'Y', sd, "fuselage"))
    for poly, axis, side, comp in zones:
        ia, ib, ic = AX[axis]
        bvh = COMP_BVH.get(comp)
        for p in me.polygons:
            c = p.center.copy()
            c.x -= SHIFT_X
            if p.normal[ic] * side < 0.3:
                continue
            if not poly_inside((c[ia], c[ib]), poly):
                continue
            if bvh is not None:
                hit = bvh.find_nearest(c)
                if hit[0] is None or hit[3] > 2e-3:
                    continue
            sel.add(p.index)
    return sel


def uv_islands(bm, uvl):
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            if all(([l[uvl].uv for l in f1.loops if l.vert == v][0] - [l[uvl].uv for l in f2.loops if l.vert == v][0])
                   .length < 1e-6 for v in e.verts):
                parent[find(f1.index)] = find(f2.index)
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def shrink_minor_islands(ob, keep=None, s=0.35):
    """Groove walls, slivers and all-dark interior islands get a third of the texel density, so the visible skin
    gets more of the 4096 map (they are dark in every bake anyway)."""
    keep = keep or set()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    k = 0
    for g in uv_islands(bm, uvl):
        if any(f.index in keep for f in g):
            continue
        a3 = sum(f.calc_area() for f in g)
        us = [l[uvl].uv.copy() for f in g for l in f.loops]
        mn = Vector((min(u.x for u in us), min(u.y for u in us)))
        mx = Vector((max(u.x for u in us), max(u.y for u in us)))
        d = mx - mn
        asp = min(d.x, d.y) / max(max(d.x, d.y), 1e-9)
        dark = {f.material_index for f in g} <= {3}
        if a3 < 0.004 or asp < 0.06 or dark:
            c = (mn + mx) / 2
            for f in g:
                for l in f.loops:
                    l[uvl].uv = c + (l[uvl].uv - c) * s
            k += 1
    bm.to_mesh(ob.data)
    bm.free()
    log("UV: shrank", k, "minor islands")


def uv_unwrap(ob, margin=0.0008, stencils=None):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    me = ob.data
    stencils = stencils or set()
    if stencils:
        # stencil zones first: each one a flat, undistorted island (decals later)
        for p in me.polygons:
            p.select = p.index in stencils
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.uv.smart_project(angle_limit=radians(85), island_margin=margin, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        for p in me.polygons:
            p.select = p.index not in stencils
        bpy.ops.object.mode_set(mode='EDIT')
    else:
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=margin, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    shrink_minor_islands(ob, stencils)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True,
                                margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
    except TypeError:
        bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def uv_overlap_count(ob, res=2048):
    """Rasterise UV triangles into a grid; count cells claimed by more than one island (approximate check)."""
    import array
    me = ob.data
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    # island id per polygon via union-find on shared UV-connected verts
    owner = array.array('i', [-1]) * (res * res)
    clashes = 0
    # islands: use bmesh UV island detection
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            ok = True
            for v in e.verts:
                u1 = [l[uvl].uv for l in f1.loops if l.vert == v][0]
                u2 = [l[uvl].uv for l in f2.loops if l.vert == v][0]
                if (u1 - u2).length > 1e-5:
                    ok = False
            if ok:
                parent[find(f1.index)] = find(f2.index)
    isl = [find(f.index) for f in bm.faces]
    bm.free()
    for t in me.loop_triangles:
        pid = isl[t.polygon_index]
        pts = [uv[l].uv for l in t.loops]
        xs = [p.x * res for p in pts]; ys = [p.y * res for p in pts]
        x0, x1 = max(0, int(min(xs))), min(res - 1, int(max(xs)))
        y0, y1 = max(0, int(min(ys))), min(res - 1, int(max(ys)))
        (ax, ay), (bx, by), (cx, cy) = zip(xs, ys)
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-12:
            continue
        for yy in range(y0, y1 + 1):
            for xx in range(x0, x1 + 1):
                px, py = xx + 0.5, yy + 0.5
                l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
                l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
                if l1 < 0 or l2 < 0 or l1 + l2 > 1:
                    continue
                k = yy * res + xx
                if owner[k] == -1:
                    owner[k] = pid
                elif owner[k] != pid:
                    clashes += 1
    return clashes


def uv_area(ob):
    me = ob.data
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    a = 0.0
    for t in me.loop_triangles:
        p0, p1, p2 = (uv[l].uv for l in t.loops)
        a += abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) * 0.5
    return a


def bake_cavity(body, glass, out_png, size=4096):
    """Cavity / convexity mask on UV0: grooves and recesses dark, flat 0.5, convex edges bright.
    value = 0.5 * AO(outside, 2.5 cm) + 0.5 * (1 - AO(inside, 1.2 cm))."""
    scene = bpy.context.scene
    scene.cycles.samples = 24
    img = bpy.data.images.new("T_Fighter_Cavity", size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    saved = []
    for m in body.data.materials:
        nt = m.node_tree
        out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        ao1 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao1.samples = 16; ao1.inputs["Distance"].default_value = 0.025
        ao1.only_local = True
        ao2 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao2.samples = 16; ao2.inside = True
        ao2.inputs["Distance"].default_value = 0.012
        ao2.only_local = True
        inv = nt.nodes.new("ShaderNodeMath"); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(ao2.outputs["AO"], inv.inputs[1])
        add = nt.nodes.new("ShaderNodeMath"); add.operation = 'ADD'
        nt.links.new(ao1.outputs["AO"], add.inputs[0]); nt.links.new(inv.outputs[0], add.inputs[1])
        half = nt.nodes.new("ShaderNodeMath"); half.operation = 'MULTIPLY'; half.inputs[1].default_value = 0.5
        nt.links.new(add.outputs[0], half.inputs[0])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(half.outputs[0], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; nt.nodes.active = tex
        saved.append((nt, out, old, [ao1, ao2, inv, add, half, em, tex]))
    glass.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type='EMIT', margin=6, use_clear=True)
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    glass.hide_render = False
    for nt, out, old, nodes in saved:
        for n in nodes:
            nt.nodes.remove(n)
        if old is not None:
            nt.links.new(old, out.inputs["Surface"])
    log("baked cavity", out_png)


def bake_ao(body, glass, out_png, size=4096, samples=96):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'OPTIX'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == 'OPTIX'
        scene.cycles.device = 'GPU'
    except Exception as e:
        log("GPU setup failed", e)
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = 0.8
    img = bpy.data.images.new("T_Fighter_AO", size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for m in body.data.materials:
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        added.append((nt, node))
    glass.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    glass.hide_render = False
    for nt, node in added:
        nt.nodes.remove(node)
    log("baked AO", out_png)


SOCKETS = {
    "SOCKET_Gun_L": (GUN_MUZZLE + Vector((0.09, 0, 0)), 0),
    "SOCKET_Gun_R": (Vector((GUN_MUZZLE.x + 0.09, -GUN_MUZZLE.y, GUN_MUZZLE.z)), 0),
    "SOCKET_Missile_L": (MISSILE_SOCKET, 0),
    "SOCKET_Missile_R": (Vector((MISSILE_SOCKET.x, -MISSILE_SOCKET.y, MISSILE_SOCKET.z)), 0),
    "SOCKET_Engine_L": (Vector((NOZ_X1, NAC_Y, NAC_Z)), 180),
    "SOCKET_Engine_R": (Vector((NOZ_X1, -NAC_Y, NAC_Z)), 180),
    "SOCKET_Cockpit_Eye": (EYE, 0),
}


def add_sockets(body):
    out = []
    for name, (p, yaw) in SOCKETS.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        e.empty_display_size = 0.4
        link(e)
        e.parent = body
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.location = (p.x + SHIFT_X, p.y, p.z)
        e.rotation_euler = (0, 0, radians(yaw))
        out.append(e)
    return out


def export_fbx(body, glass, sockets, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [body, glass] + sockets:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'MESH', 'EMPTY'},
                             apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', axis_forward='-Z',
                             axis_up='Y', use_space_transform=True, bake_space_transform=False,
                             mesh_smooth_type='FACE', use_tspace=True, use_triangles=True, add_leaf_bones=False,
                             bake_anim=False, path_mode='STRIP', use_mesh_modifiers=True)
    log("exported", path, f"{os.path.getsize(path) / 1e6:.1f} MB")


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    make_materials()
    log("building big shapes")
    parts = build_big_shapes()
    global COMP_BVH
    COMP_BVH = {k: BVHTree.FromBMesh(v) for k, v in parts.items()}
    objs = {k: bm_to_obj(v, "C_" + k) for k, v in parts.items()}
    body = objs.pop("fuselage")
    body.name = "Fighter_Body"
    adds = list(objs.values())
    for s in (1, -1):
        adds.append(bm_to_obj(check(build_gun_blister(s), "blister"), "C_blister"))
        adds.append(bm_to_obj(check(build_pylon(s), "pylon"), "C_pylon"))
    adds.append(bm_to_obj(check(build_antennas(), "antennas"), "C_ant"))
    for s in (1, -1):
        adds.append(bm_to_obj(check(build_nacelle_fairing(s), "nfair"), "C_nfair"))
        adds.append(bm_to_obj(check(build_canoes(s), "canoes"), "C_canoe"))
    adds.append(bm_to_obj(check(build_exhaust_rims(), "rims"), "C_rims"))
    adds.append(bm_to_obj(check(build_domes(), "domes"), "C_domes"))
    boolean(body, adds, 'UNION', label="components")
    cav = [bm_to_obj(check(build_tub(), "tub"), "X_tub")]
    for s in (1, -1):
        cav.append(bm_to_obj(check(build_trunk_duct(s), "tduct"), "X_tduct"))
        cav.append(bm_to_obj(check(build_nacelle_duct(s), "nduct"), "X_nduct"))
        cav.append(bm_to_obj(check(build_gun_pocket(s), "gunpocket"), "X_gun"))
        cav.append(bm_to_obj(check(build_diverter(s), "diverter"), "X_div"))
    for b in build_tail_pockets():
        cav.append(bm_to_obj(check(b, "tailpocket"), "X_tail"))
    boolean(body, cav, 'DIFFERENCE', label="cavities")
    frames = [bm_to_obj(check(b, "frame"), "X_frame") for b in build_frames()]
    boolean(body, frames, 'UNION', label="frames")
    if not NO_GROOVES:
        S = Surf(body)
        make_cutters(S)
        log("cutters:", len(CUTTERS), f"groove length {GROOVE_LEN[0]:.0f} m")
        cut_objs = [bm_to_obj(b, "X_groove") for b in CUTTERS]
        boolean(body, cut_objs, 'DIFFERENCE', label="grooves")
        fix_tag(body, S)
    # added parts (not booleaned)
    extra = []
    for s in (1, -1):
        extra.append(bm_to_obj(build_fan(s), "P_fan"))
        extra.append(bm_to_obj(build_nozzle(s), "P_nozzle"))
        extra.append(bm_to_obj(build_gun_parts(s), "P_gun"))
    extra.append(bm_to_obj(build_vanes(), "P_vanes"))
    extra.append(bm_to_obj(build_rcs_nozzles(), "P_rcs"))
    extra.append(bm_to_obj(build_louvres(), "P_louvres"))
    extra.append(bm_to_obj(build_clamp(), "P_clamp"))
    extra.append(bm_to_obj(build_interior(), "P_interior"))
    join(body, extra)
    glass = bm_to_obj(build_glass(), "Fighter_CanopyGlass")
    for ob in (body, glass):
        ob.data.transform(Matrix.Translation((SHIFT_X, 0, 0)))
        ob.data.update()
    keep_materials(body, ["M_Paint_White", "M_Paint_Red", "M_Paint_Grey", "M_Metal_Dark", "M_Canopy_Frame",
                          "M_Engine_Glow"])
    keep_materials(glass, ["M_Glass_Canopy"])
    body.data.name, glass.data.name = "Fighter_Body", "Fighter_CanopyGlass"
    shade(body)
    bpy.ops.object.select_all(action='DESELECT')
    glass.select_set(True)
    bpy.context.view_layer.objects.active = glass
    bpy.ops.object.shade_smooth()
    nt = sum(len(p.vertices) - 2 for p in body.data.polygons)
    ng = sum(len(p.vertices) - 2 for p in glass.data.polygons)
    log(f"triangles: body {nt}, glass {ng}, total {nt + ng}")
    sockets = add_sockets(body)
    if arg("--dump-tris"):
        dump_tris([body, glass], arg("--dump-tris"))
    if EXPORT_DIR or DO_BAKE:
        st = stencil_faces(body)
        log("stencil faces:", len(st))
        uv_unwrap(body, stencils=st)
        uv_unwrap(glass)
        ov = uv_overlap_count(body, 1024)
        log("UV overlap cells (1024 grid):", ov, f"  UV area used {100 * uv_area(body):.0f}%")
    if DO_BAKE:
        tex = os.path.join(os.path.abspath(EXPORT_DIR or HERE), "textures")
        os.makedirs(tex, exist_ok=True)
        bake_ao(body, glass, os.path.join(tex, "T_Fighter_AO.png"))
        bake_cavity(body, glass, os.path.join(tex, "T_Fighter_Cavity.png"))
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
        log("saved", BLEND_OUT)
    if EXPORT_DIR:
        os.makedirs(EXPORT_DIR, exist_ok=True)
        export_fbx(body, glass, sockets, os.path.join(os.path.abspath(EXPORT_DIR), "fighter.fbx"))


def dump_tris(objs, path):
    import json
    tris = []
    for ob in objs:
        me = ob.data
        me.calc_loop_triangles()
        M = ob.matrix_world
        vw = [M @ v.co for v in me.vertices]
        for t in me.loop_triangles:
            tris.append([[round(vw[i].x - SHIFT_X, 4), round(vw[i].y, 4), round(vw[i].z, 4)] for i in t.vertices])
    with open(path, "w") as f:
        json.dump(tris, f)
    log("dumped", len(tris), "triangles to", path)


COMP_BVH = {}
COMP_BM = {}

if __name__ == "__main__":
    main()
