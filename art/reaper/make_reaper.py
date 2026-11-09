"""Rewild: the Reaper, the Harrow's fighter, built from code in Blender 5.2.

Run headless from the repo root:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P art/reaper/make_reaper.py -- \
      [--blend <out.blend>] [--export art/reaper/export] [--bake] [--tex 2048] [--fast]

Metres, forward +X, up +Z, left blade +Y; origin at the centre of volume of the core (see README.md).
Built in a design frame (engine exit at x = -6.6, blade tips at x = +7.4) and shifted at the end so the origin sits at
the core's centre of volume. Every part is a closed solid; parts are joined with Blender's Manifold boolean (face counts
are logged, because a non-manifold operand makes it silently do nothing).
"""
import bpy, bmesh, math, sys, os, time, json, random
from math import radians, sin, cos, tan, pi, sqrt, atan2
from mathutils import Vector, Matrix, noise, geometry, kdtree
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
TEX = int(arg("--tex", 2048))
FAST = bool(arg("--fast", False))          # skip debris (quick shape previews)

# ============================================================================================== materials
MAT_NAMES = ["M_Alloy_Dark", "M_Alloy_Tint", "M_Alloy_Bare", "M_Seam_Hot", "M_Engine_Hot", "M_Dark_Interior"]
DK, TI, BA, HOT, ENG, INT = range(6)
MATS = []


def make_materials():
    # preview values only; the materials are made in Unreal
    pv = {
        "M_Alloy_Dark": ((0.075, 0.068, 0.062), 0.55, 0.75, None),
        "M_Alloy_Tint": ((0.120, 0.075, 0.048), 0.50, 0.85, None),
        "M_Alloy_Bare": ((0.420, 0.400, 0.380), 0.36, 1.00, None),
        "M_Seam_Hot": ((0.30, 0.08, 0.02), 0.60, 0.00, ((1.0, 0.24, 0.03), 3.5)),
        "M_Engine_Hot": ((0.30, 0.10, 0.03), 0.60, 0.00, ((1.0, 0.33, 0.06), 5.0)),
        "M_Dark_Interior": ((0.010, 0.009, 0.009), 0.80, 0.30, None),
    }
    for n in MAT_NAMES:
        m = bpy.data.materials.new(n)
        if m.node_tree is None:
            m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        col, rough, metal, em = pv[n]
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if em:
            bsdf.inputs["Emission Color"].default_value = (*em[0], 1)
            bsdf.inputs["Emission Strength"].default_value = em[1]
        m.diffuse_color = (*col, 1)
        MATS.append(m)


# ============================================================================================== small maths
def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def interp(table, x):
    """Piecewise-linear lookup in a sorted [(x, y)] table."""
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return lerp(y0, y1, (x - x0) / (x1 - x0))
    return table[-1][1]


def catmull(pts, n_per=8, closed=False):
    """Catmull-Rom through points (Vectors or tuples); returns a dense list of Vectors."""
    P = [Vector(p) for p in pts]
    out = []
    m = len(P)
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = P[(i - 1) % m] if (closed or i > 0) else P[0] * 2 - P[1]
        p1 = P[i]
        p2 = P[(i + 1) % m]
        p3 = P[(i + 2) % m] if (closed or i + 2 < m) else P[-1] * 2 - P[-2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1].copy())
    return out


def resample(poly, n):
    """Resample an open polyline to n points evenly by arc length."""
    P = [Vector(p) for p in poly]
    d = [0.0]
    for a, b in zip(P, P[1:]):
        d.append(d[-1] + (b - a).length)
    L = d[-1]
    out = []
    j = 0
    for i in range(n):
        s = L * i / (n - 1)
        while j < len(d) - 2 and d[j + 1] < s:
            j += 1
        t = (s - d[j]) / max(d[j + 1] - d[j], 1e-12)
        out.append(P[j].lerp(P[j + 1], min(max(t, 0), 1)))
    return out


def poly_len(P):
    return sum((b - a).length for a, b in zip(P, P[1:]))


# ============================================================================================== bmesh primitives
def fix_orientation(bm, name=""):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
    v = bm.calc_volume(signed=True)
    if v < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bad = sum(1 for e in bm.edges if not e.is_manifold)
    if bad:
        log(f"  WARNING part {name}: {bad} non-manifold edges")
    return bm


def set_mat(bm, mat):
    for f in bm.faces:
        f.material_index = mat
    return bm


def frame_z(d):
    d = Vector(d).normalized()
    a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    x = (a - d * a.dot(d)).normalized()
    y = d.cross(x)
    return Matrix((x, y, d)).transposed().to_4x4()


def bm_box(center, size, mat, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    M = (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    M.translation = Vector(center)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return fix_orientation(set_mat(bm, mat), "box")


def bm_box_axes(center, ex, ey, ez, size, mat):
    rot = Matrix((Vector(ex).normalized(), Vector(ey).normalized(), Vector(ez).normalized())).transposed()
    return bm_box(center, size, mat, rot)


def bm_cyl(p0, p1, r0, r1, n, mat):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r0, radius2=r1, depth=d.length)
    M = frame_z(d)
    M.translation = (p0 + p1) / 2
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return fix_orientation(set_mat(bm, mat), "cyl")


def bm_tube_path(path, r, n, mat):
    """Closed tube (round section) along a polyline, capped."""
    bm = bmesh.new()
    P = [Vector(p) for p in path]
    rings = []
    prev_x = None
    for i, p in enumerate(P):
        t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        a = prev_x if prev_x is not None else (Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
        x = (a - t * a.dot(t)).normalized()
        prev_x = x
        y = t.cross(x)
        rings.append([bm.verts.new(p + (x * cos(2 * pi * k / n) + y * sin(2 * pi * k / n)) * r) for k in range(n)])
    for i in range(len(rings) - 1):
        for k in range(n):
            k2 = (k + 1) % n
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    return fix_orientation(set_mat(bm, mat), "tube")


def loft_rings(bm, rings, close_start=True, close_end=True, mats=None, cap_mat=None):
    """Quads between consecutive rings (lists of BMVerts of equal length, closed loops). Returns faces.
    mats: optional function (ring index i, segment index k) -> material."""
    fs = []
    n = len(rings[0])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(n):
            k2 = (k + 1) % n
            vs = (A[k], A[k2], B[k2], B[k])
            # collapse degenerate quads at pointed ends
            uniq = []
            for v in vs:
                if v not in uniq:
                    uniq.append(v)
            if len(uniq) < 3:
                continue
            try:
                f = bm.faces.new(uniq)
            except ValueError:
                continue
            if mats:
                f.material_index = mats(i, k)
            fs.append(f)
    for flag, R in ((close_start, rings[0][::-1]), (close_end, rings[-1])):
        if flag and len(set(R)) >= 3:
            try:
                f = bm.faces.new(R)
                if cap_mat is not None:
                    f.material_index = cap_mat
                fs.append(f)
            except ValueError:
                pass
    return fs


# ============================================================================================== objects, booleans
def bm_to_obj(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in MATS:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_all(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def boolean(target, cutters, op='UNION', label="", operand_obj=None):
    nf0 = len(target.data.polygons)
    mod = target.modifiers.new("bool", 'BOOLEAN')
    mod.operation = op
    mod.solver = 'MANIFOLD'
    mod.material_mode = 'TRANSFER'
    coll = None
    if operand_obj is not None:
        mod.operand_type = 'OBJECT'
        mod.object = operand_obj
    else:
        coll = bpy.data.collections.new("tmp_bool")
        bpy.context.scene.collection.children.link(coll)
        for c in cutters:
            for uc in list(c.users_collection):
                uc.objects.unlink(c)
            coll.objects.link(c)
        mod.operand_type = 'COLLECTION'
        mod.collection = coll
    apply_all(target)
    nf1 = len(target.data.polygons)
    log(f"boolean {op:10s} {label:18s} {len(cutters) if cutters else 1:4d} operands  faces {nf0} -> {nf1}")
    if nf1 == nf0 and op != 'INTERSECT':
        log("  WARNING: boolean changed nothing (non-manifold operand?)")
    if coll is not None:
        for c in list(coll.objects):
            me = c.data
            bpy.data.objects.remove(c, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
        bpy.data.collections.remove(coll)
    return nf1


def nonmanifold(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = sum(1 for e in bm.edges if not e.is_manifold)
    v = bm.calc_volume(signed=True)
    bm.free()
    return n, v


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


PARTS = {}          # group -> list of (name, bmesh)


def add(group, name, bm):
    PARTS.setdefault(group, []).append((name, bm))


def union_group(group, name):
    items = PARTS[group]
    objs = []
    for nm, bm in items:
        bad = sum(1 for e in bm.edges if not e.is_manifold)
        if bad:
            log(f"  skipping non-manifold part {group}/{nm} ({bad} edges)")
            bm.free()
            continue
        objs.append(bm_to_obj(bm, f"{name}_{nm}"))
    target = objs[0]
    if len(objs) > 1:
        boolean(target, objs[1:], 'UNION', label=group)
    target.name = name
    target.data.name = name
    nm, vol = nonmanifold(target)
    log(f"  {name}: {len(target.data.polygons)} faces, {tris(target)} tris, non-manifold edges {nm}, "
        f"volume {vol * 1000:.1f} L")
    return target


def shade(ob, angle=32):
    """Smooth by angle (creases stay sharp), then face-area weighted normals so big flat facets shade flat."""
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=radians(angle), keep_sharp_edges=True)
    mod = ob.modifiers.new("wn", 'WEIGHTED_NORMAL')
    mod.mode = 'FACE_AREA'
    mod.keep_sharp = True
    mod.weight = 50
    apply_all(ob)


def duplicate(ob, name):
    me = ob.data.copy()
    me.name = name
    o2 = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o2)
    o2.matrix_world = ob.matrix_world.copy()
    return o2


def join(target, others):
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target


# ============================================================================================== the hull
# Superelliptic rings along x (design frame). theta: 0 = +Y (left), 90 = top, 180 = -Y (right), 270 = bottom.
HULL_X = [-5.45, -5.05, -4.25, -3.45, -2.65, -1.85, -1.05, -0.35, 0.10, 0.42]
HULL_A = [0.98, 1.24, 1.47, 1.56, 1.54, 1.45, 1.26, 1.00, 0.75, 0.40]      # half width
HULL_ZT = [1.10, 1.26, 1.42, 1.44, 1.36, 1.22, 1.06, 0.92, 0.72, 0.42]     # top
HULL_ZB = [-0.42, -0.66, -0.92, -1.00, -1.00, -0.96, -0.88, -0.74, -0.62, -0.48]   # bottom
HULL_N = 2.4                 # superellipse exponent: round-shouldered, not an oval
HULL_WALL = 0.08


def _spline_tab(xs, ys, x):
    """Monotone-ish cubic (Catmull-Rom) through a table, clamped at the ends."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = max(j for j in range(len(xs) - 1) if xs[j] <= x)
    t = (x - xs[i]) / (xs[i + 1] - xs[i])
    y0 = ys[i - 1] if i > 0 else 2 * ys[i] - ys[i + 1]
    y1, y2 = ys[i], ys[i + 1]
    y3 = ys[i + 2] if i + 2 < len(ys) else 2 * ys[i + 1] - ys[i]
    return 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t * t + (-y0 + 3 * y1 - 3 * y2 + y3) * t ** 3)


def hull_sec(x):
    a = _spline_tab(HULL_X, HULL_A, x)
    zt = _spline_tab(HULL_X, HULL_ZT, x)
    zb = _spline_tab(HULL_X, HULL_ZB, x)
    return a, (zt + zb) / 2, (zt - zb) / 2


def _se(c, n):
    return math.copysign(abs(c) ** (2.0 / n), c)


def hull_p(x, th, inset=0.0):
    a, zc, hz = hull_sec(x)
    t = radians(th)
    return Vector((x, _se(cos(t), HULL_N) * (a - inset), zc + _se(sin(t), HULL_N) * (hz - inset)))


def hull_n(x, th):
    e = 1e-3
    du = hull_p(x + e, th) - hull_p(x - e, th)
    dv = hull_p(x, th + 0.05) - hull_p(x, th - 0.05)
    n = du.cross(dv)
    if n.length < 1e-9:
        return Vector((0, cos(radians(th)), sin(radians(th))))
    n.normalize()
    return n


def hull_off(x, th, d):
    return hull_p(x, th) + hull_n(x, th) * d


def build_hull():
    xs = [lerp(HULL_X[0], HULL_X[-1], (i / 39) ** 1.0) for i in range(40)]
    NT = 56
    bm = bmesh.new()
    outer = [[bm.verts.new(hull_p(x, 360 * k / NT)) for k in range(NT)] for x in xs]
    fs = loft_rings(bm, outer)
    for f in fs:
        f.material_index = DK
    # inner skin (hollow shell, 8 cm wall) for the debris cuts
    xs_i = [x for x in xs if HULL_X[0] + 0.25 < x < -0.55]
    inner = [[bm.verts.new(hull_p(x, 360 * k / NT, HULL_WALL / max(0.5, 1.0))) for k in range(NT)] for x in xs_i]
    fs2 = loft_rings(bm, inner)
    bmesh.ops.reverse_faces(bm, faces=fs2)
    for f in fs2:
        f.material_index = INT
    add("core", "hull", fix_orientation(bm, "hull"))


# ============================================================================================== cast plates on the hull
def plate_outline(ctrl, sharp=(), n_per=6):
    """Closed outline in (x, theta) from control points; Catmull-Rom everywhere except at the 'sharp' indices,
    which stay corners (plate points)."""
    P = [Vector(c) for c in ctrl]
    m = len(P)
    out = []
    for i in range(m):
        p1, p2 = P[i], P[(i + 1) % m]
        p0, p3 = P[(i - 1) % m], P[(i + 2) % m]
        if i in sharp:
            p0 = p1 * 2 - p2
        if (i + 1) % m in sharp:
            p3 = p2 * 2 - p1
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
                              (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


def bm_plate(outline, d0, thick, mat, bevel=0.03, grid=0.22, lip_mat=None, surf=None, sa=1.0, sb=None):
    """A cast plate lying on a parametric surface: outline [(a, b)], bottom at offset d0, thickness thick(a, b) (m).
    Default surface: the hull, (a, b) = (x, theta in degrees). Built from a constrained Delaunay grid in the scaled
    (a * sa, b * sb) space (about metres), mapped onto the surface; the top rim is bevelled."""
    if surf is None:
        surf = hull_off
    if sb is None:
        sb = radians(1.0) * 1.25          # hull: metres per degree of theta
    pts2 = [Vector((p[0] * sa, p[1] * sb)) for p in outline]
    if shoelace2(pts2) < 0:
        pts2 = pts2[::-1]
        outline = outline[::-1]
    xs = [p.x for p in pts2]
    ys = [p.y for p in pts2]
    inner_pts = []
    nx = max(2, int((max(xs) - min(xs)) / grid))
    ny = max(2, int((max(ys) - min(ys)) / grid))
    for i in range(1, nx):
        for j in range(1, ny):
            q = Vector((lerp(min(xs), max(xs), i / nx), lerp(min(ys), max(ys), j / ny)))
            if point_in_poly(q, pts2) and min((q - p).length for p in pts2) > grid * 0.45:
                inner_pts.append(q)
    allp = pts2 + inner_pts
    nb = len(pts2)
    res = geometry.delaunay_2d_cdt(allp, [], [list(range(nb))], 1, 1e-7)
    V2, F2 = res[0], res[2]
    bm = bmesh.new()

    AB = [(v.x / sa, v.y / sb) for v in V2]
    top = [bm.verts.new(surf(a, b, d0 + thick(a, b))) for (a, b) in AB]
    bot = [bm.verts.new(surf(a, b, d0)) for (a, b) in AB]
    for f in F2:
        bm.faces.new([top[i] for i in f])
        bm.faces.new([bot[i] for i in f[::-1]])
    # side walls along the boundary: find the boundary loop of the output (edges used once)
    cnt = {}
    for f in F2:
        for a, b in zip(f, f[1:] + f[:1]):
            cnt[(a, b)] = cnt.get((a, b), 0) + 1
    side = []
    for (a, b), c in cnt.items():
        if (b, a) not in cnt:
            side.append(bm.faces.new((top[b], top[a], bot[a], bot[b])))
    for f in bm.faces:
        f.material_index = mat
    fix_orientation(bm, "plate")
    if bevel > 0:
        topset = set(top)
        rim = [e for e in bm.edges if all(v in topset for v in e.verts) and
               any(f in side for f in e.link_faces)]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=2, affect='EDGES', profile=0.5, clamp_overlap=True)
    if lip_mat is not None:
        for f in bm.faces:
            if f in side:
                f.material_index = lip_mat
    return fix_orientation(bm, "plate")


def shoelace2(P):
    return 0.5 * sum(P[i].x * P[(i + 1) % len(P)].y - P[(i + 1) % len(P)].x * P[i].y for i in range(len(P)))


def point_in_poly(q, P):
    c = False
    n = len(P)
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        if (a.y > q.y) != (b.y > q.y):
            x = a.x + (q.y - a.y) * (b.x - a.x) / (b.y - a.y)
            if x > q.x:
                c = not c
    return c


def wedge(x_front, x_back, t_front, t_back):
    """Plate thickness: thick at its free front edge, thin where it tucks under the plate behind."""
    def f(x, th):
        u = (x - x_back) / (x_front - x_back)
        return lerp(t_back, t_front, smooth(u) ** 0.8)
    return f


def mirror_th(outline):
    return [(x, 180.0 - th) for (x, th) in outline]


PLATES = {}    # name -> outline (x, theta) for seams


def crowned(x_front, x_back, t_front, t_back, b_lo, b_hi, crown=0.6):
    """Wedge thickness (thick free front edge, thin buried back) with a crown: thicker along the plate's middle."""
    w = wedge(x_front, x_back, t_front, t_back)

    def f(a, b):
        q = (b - (b_lo + b_hi) / 2) / max((b_hi - b_lo) / 2, 1e-6)
        return w(a, b) * (1.0 + crown * max(0.0, 1.0 - q * q))
    return f


POCKETS = []     # (liner bmesh, cutter bmesh) pairs: recessed openings with closed backs


def pocket(outline_liner, outline_cut, depth):
    liner = bm_plate(outline_liner, -depth - 0.08, lambda a, b: depth + 0.06, INT, bevel=0.0, grid=0.18)
    cut = bm_plate(outline_cut, -depth, lambda a, b: depth + 0.25, INT, bevel=0.0, grid=0.18)
    POCKETS.append((liner, cut))


def build_plates():
    def plate(name, ctrl, sharp, d0, thick, mat=DK, bevel=0.05, both=False):
        outl = plate_outline(ctrl, sharp)
        PLATES[name] = outl
        add("core", name, bm_plate(outl, d0, thick, mat, bevel))
        if both:
            outr = mirror_th(outl)
            PLATES[name + "_R"] = outr
            add("core", name + "_R", bm_plate(outr, d0, thick, mat, bevel))

    # dorsal row, front to back: each plate's thick free edge laps over the plate ahead (the brow claw leads)
    plate("dorsal1", [(-1.05, 90), (-1.45, 66), (-2.3, 56), (-2.75, 72), (-2.75, 108), (-2.3, 124), (-1.45, 114)],
          (0,), 0.00, crowned(-1.05, -2.75, 0.36, 0.07, 56, 124, 0.45))
    plate("dorsal2", [(-2.45, 90), (-2.7, 62), (-3.4, 50), (-4.05, 60), (-4.15, 90), (-4.05, 120), (-3.4, 130),
                      (-2.7, 118)], (), 0.07, crowned(-2.45, -4.15, 0.40, 0.08, 50, 130, 0.45))
    plate("dorsal3", [(-3.85, 90), (-4.05, 60), (-4.7, 50), (-5.3, 58), (-5.42, 90), (-5.3, 122), (-4.7, 130),
                      (-4.05, 120)], (), 0.07, crowned(-3.85, -5.42, 0.34, 0.05, 50, 130, 0.45))
    # side carapace plates: big ovals either side of the dorsal row, over the shoulders' upper edge
    plate("carapace_s", [(-2.0, 40), (-2.4, 24), (-3.4, 18), (-4.3, 24), (-4.5, 42), (-4.1, 56), (-3.0, 60),
                         (-2.3, 54)], (), 0.03, crowned(-2.0, -4.5, 0.32, 0.07, 18, 60, 0.45), both=True)
    # upper flank row, pointed forward, above the talons and ahead of the shoulder
    plate("flank1", [(-0.30, 44), (-0.9, 30), (-1.9, 26), (-2.2, 42), (-1.9, 60), (-0.9, 60)], (0,), -0.01,
          crowned(-0.30, -2.2, 0.24, 0.06, 26, 60, 0.45), both=True)
    plate("flank2", [(-1.75, 46), (-2.2, 30), (-3.1, 28), (-3.4, 46), (-3.1, 62), (-2.2, 62)], (0,), 0.02,
          crowned(-1.75, -3.4, 0.26, 0.06, 28, 62, 0.45), both=True)
    # lower rear flank, behind the louvres, under the shoulder
    plate("flank3", [(-2.55, -22), (-3.0, -8), (-4.4, -6), (-4.9, -24), (-4.4, -44), (-3.0, -44)], (0,), -0.01,
          crowned(-2.55, -4.9, 0.20, 0.06, -44, -6, 0.45), both=True)
    # chin plates under the head, either side of the jaw
    plate("chin", [(-0.15, -40), (-0.6, -26), (-1.3, -26), (-1.5, -44), (-1.3, -62), (-0.6, -62)], (0,), -0.01,
          crowned(-0.15, -1.5, 0.14, 0.05, -62, -26, 0.5), both=True)
    # belly plates either side of the missile cradle, and the aft keel
    bel = [(-0.70, 252), (-1.4, 234), (-3.6, 228), (-4.75, 238), (-4.8, 257), (-3.6, 259), (-1.4, 259)]
    plate("belly", bel, (0,), -0.01, crowned(-0.70, -4.8, 0.14, 0.05, 228, 259, 0.5))
    plate("belly_R", [(x, 540 - th) for (x, th) in bel], (0,), -0.01, crowned(-0.70, -4.8, 0.14, 0.05, 281, 312, 0.5))
    plate("keel_aft", [(-4.0, 270), (-4.3, 262), (-5.3, 258), (-5.42, 270), (-5.3, 282), (-4.3, 278)], (0,),
          -0.01, crowned(-4.0, -5.42, 0.14, 0.05, 258, 282, 0.5))
    # recessed openings: flank louvres (both sides) and the missile cradle under the core
    lv = [(-1.30, -10), (-1.30, -42), (-2.55, -42), (-2.55, -10)]
    lvc = [(-1.38, -14), (-1.38, -38), (-2.47, -38), (-2.47, -14)]
    pocket(plate_outline(lv, (0, 1, 2, 3), 2), plate_outline(lvc, (0, 1, 2, 3), 2), 0.22)
    pocket(mirror_th(plate_outline(lv, (0, 1, 2, 3), 2)), mirror_th(plate_outline(lvc, (0, 1, 2, 3), 2)), 0.22)
    cr = [(-0.50, 259), (-0.50, 281), (-3.70, 281), (-3.70, 259)]
    crc = [(-0.62, 262), (-0.62, 278), (-3.58, 278), (-3.58, 262)]
    pocket(plate_outline(cr, (0, 1, 2, 3), 2), plate_outline(crc, (0, 1, 2, 3), 2), 0.30)
    PLATES["louvre"] = lvc
    PLATES["cradle"] = crc


GUN_L = Vector((0.30, 0.30, -0.47))     # muzzles inside the jaw (design frame); the right one mirrors y
JAW = ((-0.30, 0.80), (-0.58, 0.58), (-0.68, -0.30))


def build_jaw():
    """The jaw under the head: a dark mouth, downward teeth across it and the two guns inside."""
    (x0, x1), (y0, y1), (z0, z1) = JAW
    cut = bm_box(Vector(((x0 + x1) / 2, 0, (z0 + z1) / 2)), (x1 - x0, y1 - y0, z1 - z0), INT)
    det = []
    for yy in (0.0, 0.10, -0.10, 0.20, -0.20, 0.40, -0.40, 0.50, -0.50):
        det.append(bm_claw([Vector((0.24, yy, -0.26)), Vector((0.30, yy, -0.45)), Vector((0.36, yy, -0.64))], 0.075,
                           0.11, [Vector((1, 0, 0))] * 3, DK, wp=0.6, tp=0.6))
    for side in (1, -1):
        g = Vector((GUN_L.x, GUN_L.y * side, GUN_L.z))
        det.append(bm_cyl(g - Vector((0.55, 0, 0)), g, 0.085, 0.075, 16, DK))          # barrel
        det.append(bm_cyl(g - Vector((0.62, 0, 0)), g - Vector((0.35, 0, 0)), 0.13, 0.13, 16, DK))   # breech collar
    return cut, det


def build_openings_detail():
    """Things that sit inside the openings, unioned after the pockets are cut: louvre vanes, jaw teeth, guns,
    cradle rails."""
    out = []
    for side in (1, -1):
        for k in range(7):
            x = lerp(-1.48, -2.37, k / 6)
            th0, th1 = -16, -36
            p0 = hull_off(x, th0 if side > 0 else 180 - th0, -0.05)
            p1 = hull_off(x, th1 if side > 0 else 180 - th1, -0.05)
            n = hull_n(x, -26 if side > 0 else 206)
            ax = (p1 - p0)
            fwd = Vector((1, 0, 0))
            fwd = (fwd - n * fwd.dot(n)).normalized()
            vane_dir = (fwd * 0.5 + n * 0.86).normalized()       # vanes raked back 30 deg
            c = (p0 + p1) / 2 - n * 0.06
            out.append(bm_box_axes(c, vane_dir, ax.normalized(), vane_dir.cross(ax.normalized()),
                                   (0.30, ax.length + 0.06, 0.045), DK))
    # cradle: two rails and three clamp ribs under the ceiling
    for yy in (-0.13, 0.13):
        out.append(bm_box(Vector((-2.1, yy, 0)) + Vector((0, 0, hull_p(-2.1, 270).z + 0.33)), (2.7, 0.06, 0.07), DK))
    for xx in (-3.0, -2.1, -1.2):
        zc = hull_p(xx, 270).z + 0.36
        out.append(bm_box(Vector((xx, 0, zc)), (0.10, 0.50, 0.10), DK))
    return out


# ============================================================================================== claws (talons, beak, collar)
def bm_claw(path, w0, t0, ups, mat, wp=0.85, tp=0.9, n_st=18, ridge=1.0, under=0.35):
    """Pointed plate lofted along a path (list of Vectors, root first), flattened-diamond section that tapers to the
    tip. ups: list of up vectors (one per path point) giving the face normal (away from the hull)."""
    P = catmull(path, 6)
    U = catmull(ups, 6)
    P = resample(P, n_st)
    U = resample(U, n_st)
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(P):
        s = i / (n_st - 1)
        t = (P[min(i + 1, n_st - 1)] - P[max(i - 1, 0)]).normalized()
        up = U[i]
        up = (up - t * up.dot(t)).normalized()
        side = t.cross(up)
        w = w0 * (1 - s) ** wp
        h = t0 * (1 - s) ** tp
        if i == n_st - 1:
            rings.append([bm.verts.new(p)] * 8)
            continue
        sec = [(-1, 0), (-0.55, 0.62 * ridge), (0, ridge), (0.55, 0.62 * ridge), (1, 0), (0.55, -under),
               (0, -under * 1.1), (-0.55, -under)]
        rings.append([bm.verts.new(p + side * (u * w / 2) + up * (v * h)) for (u, v) in sec])
    loft_rings(bm, rings, close_start=True, close_end=False)
    return fix_orientation(set_mat(bm, mat), "claw")


HEAD = {}


def build_head():
    """A tall stack of forward-pointing cast plates like the concept's: beak lowest and foremost, two pairs of talons
    above it converging on the centre line, the brow on top; dark gaps between them."""
    z = Vector((0, 0, 1))
    beak = [Vector((-0.95, 0, -0.06)), Vector((-0.1, 0, -0.08)), Vector((0.50, 0, -0.20)), Vector((0.86, 0, -0.38)),
            Vector((1.0, 0, -0.58))]
    ups = [z, z, Vector((0.25, 0, 1)), Vector((0.6, 0, 1)), Vector((0.9, 0, 0.6))]
    add("core", "beak", bm_claw(beak, 1.10, 0.52, ups, DK, wp=0.75, tp=0.8, ridge=1.0, under=0.30))
    HEAD["beak_tip"] = beak[-1]
    HEAD["beak_path"] = beak
    for s_ in (1, -1):
        t1 = [Vector((-1.45, 0.95 * s_, -0.22)), Vector((-0.55, 0.78 * s_, -0.16)), Vector((0.30, 0.42 * s_, -0.12)),
              Vector((0.90, 0.15 * s_, -0.12))]
        u1 = [Vector((0, 0.9 * s_, 0.45)), Vector((0.1, 0.9 * s_, 0.45)), Vector((0.35, 0.7 * s_, 0.6)),
              Vector((0.5, 0.4 * s_, 0.75))]
        add("core", f"talon1_{s_}", bm_claw(t1, 0.92, 0.38, u1, DK, wp=0.7, tp=0.75, under=0.45))
        t2 = [Vector((-1.75, 0.98 * s_, 0.30)), Vector((-0.80, 0.86 * s_, 0.34)), Vector((0.10, 0.52 * s_, 0.33)),
              Vector((0.70, 0.22 * s_, 0.30))]
        u2 = [Vector((0, 0.8 * s_, 0.6)), Vector((0.1, 0.8 * s_, 0.6)), Vector((0.35, 0.6 * s_, 0.7)),
              Vector((0.5, 0.35 * s_, 0.8))]
        add("core", f"talon2_{s_}", bm_claw(t2, 0.96, 0.38, u2, DK, wp=0.7, tp=0.75, under=0.45))
        HEAD[f"t1_{s_}"] = t1
        HEAD[f"t2_{s_}"] = t2
    brow = [Vector((-1.6, 0, 0.92)), Vector((-0.6, 0, 0.95)), Vector((0.05, 0, 0.82)), Vector((0.42, 0, 0.70))]
    ub = [z, z, Vector((0.3, 0, 1)), Vector((0.5, 0, 1))]
    add("core", "brow", bm_claw(brow, 1.25, 0.40, ub, DK, wp=0.7, tp=0.7, under=0.5))
    HEAD["brow"] = brow


# ============================================================================================== the engine
ENG_Z = 0.43
ENG_X0, ENG_X1 = -6.60, -5.25        # exit, front
ENG_R = 0.92
ENG_S = 1.00                         # radial scale of the drum (the concept's drum is nearly as tall as the core)


def bm_lathe_x(profile, n, mat, z=ENG_Z, phase=0.0):
    """Revolve a closed profile [(x, r)] about the engine axis (parallel to X at height z)."""
    bm = bmesh.new()
    rings = []
    for k in range(n):
        a = 2 * pi * k / n + phase
        rings.append([bm.verts.new(Vector((x, r * ENG_S * cos(a), z + r * ENG_S * sin(a)))) for (x, r) in profile])
    m = len(profile)
    for k in range(n):
        kn = (k + 1) % n
        for i in range(m):
            i2 = (i + 1) % m
            bm.faces.new((rings[k][i], rings[kn][i], rings[kn][i2], rings[k][i2]))
    return fix_orientation(set_mat(bm, mat), "lathe")


def build_engine():
    # hot chamber: the furnace inside the ribs, its back face recessed 0.36 m inside the mouth
    add("core", "chamber", bm_cyl((-6.24, 0, ENG_Z), (-5.35, 0, ENG_Z), 0.74 * ENG_S, 0.74 * ENG_S, 32, ENG))
    # front ring (joins the hull) and the rear lip of the furnace mouth
    add("core", "ring_f", bm_lathe_x([(-5.62, 0.55), (-5.62, 0.93), (-5.50, 0.96), (-5.25, 0.96), (-5.25, 0.55)],
                                     40, DK))
    add("core", "lip", bm_lathe_x([(-6.62, 0.63), (-6.62, 0.86), (-6.56, 0.93), (-6.40, 0.95), (-6.28, 0.92),
                                   (-6.28, 0.70), (-6.40, 0.66)], 40, DK))
    # mouth liner (dark tube between the lip and the chamber's back face)
    add("core", "liner", bm_lathe_x([(-6.45, 0.60), (-6.45, 0.68), (-6.20, 0.76), (-6.20, 0.60)], 32, TI))
    # ribs: 16 bars round the drum, the hot chamber glows between them
    NR = 14
    for k in range(NR):
        a = 2 * pi * (k + 0.5) / NR
        rad = Vector((0, cos(a), sin(a)))
        tg = Vector((0, -sin(a), cos(a)))
        c = Vector((0, 0, ENG_Z))
        bm = bmesh.new()
        prof = [(-6.36, 0.70, 0.11), (-6.30, 0.93, 0.13), (-5.95, 0.92, 0.15), (-5.62, 0.91, 0.20), (-5.55, 0.70, 0.20)]
        # each rib: a bar whose tangential width grows toward the front; profile in (x, r_out); inner r 0.70
        rings = []
        for (x, r, w) in prof:
            rings.append([bm.verts.new(c + Vector((x, 0, 0)) + rad * rr * ENG_S + tg * ww * ENG_S)
                          for (rr, ww) in ((0.70, -w / 2), (r, -w / 2 * 0.86), (r, w / 2 * 0.86), (0.70, w / 2))])
        loft_rings(bm, rings)
        add("core", f"rib{k}", fix_orientation(set_mat(bm, DK), "rib"))
    # grate: horizontal bars across the mouth in front of the chamber's back face
    for j, zz in enumerate((-0.54, -0.36, -0.18, 0.0, 0.18, 0.36, 0.54)):
        zz *= ENG_S
        half = sqrt(max((0.66 * ENG_S) ** 2 - zz ** 2, 0.04)) + 0.05
        add("core", f"grate{j}", bm_box(Vector((-6.38, 0, ENG_Z + zz)), (0.24, 2 * half, 0.095), DK))
    # a vertical spine bar through the grate (a furnace door, not a jet nozzle)
    add("core", "grate_v", bm_box(Vector((-6.40, 0, ENG_Z)), (0.22, 0.10, 2 * 0.70 * ENG_S), DK))
    # collar: curved claws gripping the drum's front half
    for k, ang in enumerate((25, 62, 90, 118, 155, 215, 325)):
        a = radians(ang)
        rad = Vector((0, cos(a), sin(a)))
        c = Vector((0, 0, ENG_Z))
        path = [c + Vector((-4.45, 0, 0)) + rad * 1.08 * ENG_S, c + Vector((-5.20, 0, 0)) + rad * 1.12 * ENG_S,
                c + Vector((-5.62, 0, 0)) + rad * 1.07 * ENG_S, c + Vector((-5.86, 0, 0)) + rad * 0.99 * ENG_S]
        add("core", f"collar{k}", bm_claw(path, 0.56, 0.24, [rad] * 4, DK, wp=0.55, tp=0.65, under=0.6))


# ============================================================================================== blades
# plan edges of the LEFT blade (design frame), root to tip; the right blade mirrors y
BLADE_OUT = [(-6.10, 0.95), (-5.85, 2.45), (-5.12, 3.82), (-3.90, 4.88), (-2.40, 5.42), (-0.85, 5.60), (0.65, 5.48),
             (2.25, 5.14), (3.85, 4.62), (5.22, 3.96), (6.40, 3.18), (7.40, 2.40)]
BLADE_IN = [(-1.45, 0.95), (-1.42, 1.90), (-1.15, 2.66), (-0.62, 3.22), (0.25, 3.56), (1.55, 3.70), (2.95, 3.66),
            (4.42, 3.42), (5.70, 3.02), (6.70, 2.70), (7.40, 2.40)]
BLADE_H = [(0.0, 1.25), (0.08, 1.12), (0.20, 0.88), (0.35, 0.64), (0.50, 0.47), (0.65, 0.35), (0.80, 0.21),
           (0.92, 0.09), (0.97, 0.035), (1.0, 0.004)]           # thickness at the spine (m) vs t
BLADE_ZC = [(0.0, 0.16), (0.15, 0.10), (0.3, 0.04), (1.0, -0.14)]           # section centre height
BLADE_BANK = (10.0, 22.0)                                     # deg, outer edge down, root and tip (twist)
SPINE_U = [(0.0, 0.58), (0.30, 0.47), (1.0, 0.47)]          # spine ridge, fraction across from the sharp inner edge
EDGE_U = 0.035                                                # honed band of the inner edge
DOME = [(0.0, 0.16), (0.12, 0.13), (0.35, 0.0), (1.0, 0.0)]   # convex shoulder face near the root (fraction of h)


def section_uv(t):
    """Blade section loop [(u, v)]: u 0 (sharp inner edge) .. 1 (blunt outer back), v in units of the thickness.
    Top: inner bevel rising to the spine ridge (domed near the root), outer bevel falling convex to the back.
    Bottom: a shallower keel under the spine."""
    sp = interp(SPINE_U, t)
    dome = interp(DOME, t)
    top = [(0.0, 0.0), (EDGE_U, 0.04)]
    for f in (0.2, 0.4, 0.6, 0.8):
        u = lerp(EDGE_U, sp, f)
        top.append((u, lerp(0.04, 0.62, f) + dome * sin(pi * f) ** 0.8))
    top.append((sp, 0.62))
    for f in (0.15, 0.4, 0.7, 0.9):
        u = lerp(sp, 1.0, f)
        top.append((u, 0.62 - 0.52 * f ** 1.5))      # outer bevel: steep, convex, falling to a short blunt back
    top.append((1.0, 0.08))
    bot = [(1.0, -0.14)]
    for f in (0.9, 0.6, 0.3):
        u = lerp(sp, 1.0, f)
        bot.append((u, -0.38 + 0.24 * f ** 1.5))
    bot.append((sp, -0.38))
    for f in (0.65, 0.35):
        u = lerp(EDGE_U, sp, f)
        bot.append((u, -0.035 - 0.355 * f ** 0.8))
    bot.append((EDGE_U, -0.035))
    return top + bot


SEC_N = len(section_uv(0.0))
SPINE_IDX = 6                                                 # index of the spine point in the loop
JOINTS = [0.38, 0.68]          # forged segment joints (the blade breaks here)
SHOULDER = (0.0, 0.215)        # the shoulder plate over the blade root (t range)
N_ST = 72


def blade_stations(side=1):
    """Per station: inner point, outer point (plan, 3D at section centre), up vector, thickness, t."""
    O = resample(catmull([Vector((x, y, 0)) for x, y in BLADE_OUT], 10), 400)
    I = resample(catmull([Vector((x, y, 0)) for x, y in BLADE_IN], 10), 400)
    ts = []
    for i in range(N_ST):
        u = i / (N_ST - 1)
        ts.append(u)
    # extra stations round the joints for the lip steps
    for j in JOINTS:
        ts += [j - 0.03, j - 0.012, j - 0.0015, j]
    ts = sorted(set(round(t, 5) for t in ts))
    out = []
    for t in ts:
        k = t * 399
        k0 = int(min(k, 398))
        f = k - k0
        o = O[k0].lerp(O[k0 + 1], f)
        ii = I[k0].lerp(I[k0 + 1], f)
        zc = interp(BLADE_ZC, t)
        o.z = ii.z = zc
        o.y *= side
        ii.y *= side
        out.append((t, ii, o))
    return out


_EDGES = {}


def blade_edges():
    if not _EDGES:
        _EDGES["O"] = resample(catmull([Vector((x, y, 0)) for x, y in BLADE_OUT], 10), 400)
        _EDGES["I"] = resample(catmull([Vector((x, y, 0)) for x, y in BLADE_IN], 10), 400)
    return _EDGES["I"], _EDGES["O"]


def blade_io(t, side):
    I, O = blade_edges()
    k = min(max(t, 0.0), 1.0) * 399
    k0 = int(min(k, 398))
    f = k - k0
    o = O[k0].lerp(O[k0 + 1], f)
    ii = I[k0].lerp(I[k0 + 1], f)
    o.z = ii.z = interp(BLADE_ZC, t)
    o.y *= side
    ii.y *= side
    return ii, o


def blade_top(t, u, side, scale=1.0):
    """Point on the blade's top surface at station t, across-fraction u (0 inner edge .. 1 outer back)."""
    ii, o = blade_io(t, side)
    pts, up, cx, w, h = sec_pts(t, ii, o, scale)
    loop = section_uv(t)
    k_end = [i for i, (uu, vv) in enumerate(loop) if uu >= 0.9999][0]      # top runs 0..k_end
    top = loop[:k_end + 1]
    for i in range(len(top) - 1):
        if top[i][0] <= u <= top[i + 1][0]:
            f = (u - top[i][0]) / max(top[i + 1][0] - top[i][0], 1e-9)
            return pts[i].lerp(pts[i + 1], f)
    return pts[k_end] if u > 0.5 else pts[0]


def blade_off(t, u, d, side):
    p = blade_top(t, u, side)
    e = 0.004
    dt = blade_top(t + e, u, side) - blade_top(t - e, u, side)
    du = blade_top(t, min(u + 0.01, 1.0), side) - blade_top(t, max(u - 0.01, 0.0), side)
    n = dt.cross(du) * side
    if n.z < 0:
        n = -n
    n.normalize()
    return p + n * d


def joint_scale(t):
    s = 1.0
    for j in JOINTS:
        if j - 0.03 < t <= j - 0.0015 + 1e-6:
            s = 1.0 + 0.045 * smooth((t - (j - 0.03)) / 0.018)
    return s


def sec_pts(t, ii, o, scale=1.0, inset=0.0, hscale=1.0):
    """Section loop (list of Vectors) of the blade at station t; returns (points, tags) with tags per point."""
    c = o - ii
    w = c.length
    cx = c.normalized()
    h = interp(BLADE_H, t) * hscale
    bank = radians(lerp(BLADE_BANK[0], BLADE_BANK[1], t)) * (1 if o.y > 0 else -1)
    up = Vector((0, 0, 1))
    tang = cx.cross(up).normalized()
    up = Matrix.Rotation(bank, 3, tang) @ up
    if up.z < 0:
        up = -up
    pts = []
    mid = ii.lerp(o, 0.5)
    for (u, v) in section_uv(t):
        p = ii + cx * (u * w) + up * (v * h)
        pts.append(mid + (p - mid) * scale)
    return pts, up, cx, w, h


def build_blade(side):
    st = blade_stations(side)
    grp = "bladeL" if side > 0 else "bladeR"
    bm = bmesh.new()
    rings = []
    for (t, ii, o) in st:
        pts, up, cx, w, h = sec_pts(t, ii, o, joint_scale(t))
        if t >= 0.9999:
            rings.append([bm.verts.new(o.lerp(ii, 0.5))] * len(pts))
        else:
            rings.append([bm.verts.new(p) for p in pts])
    def mats(i, k):
        # honed inner edge: the segments touching the edge point (index 0 and the last)
        if k == 0 or k == SEC_N - 1:
            return BA
        return DK
    loft_rings(bm, rings, close_start=True, close_end=False, mats=mats, cap_mat=DK)
    cav = blade_cavity_and_ribs(side, grp)
    if cav is not None:
        cbm, t_end = cav
        me_ = bpy.data.meshes.new("tmpcav")
        cbm.to_mesh(me_)
        cbm.free()
        bm.from_mesh(me_)
        bpy.data.meshes.remove(me_)
        log(f"  blade {side}: hollow to t = {t_end:.2f}")
    fix_orientation(bm, "blade")
    add(grp, "shell", bm)
    BLADES[side] = st
    # the shoulder: a big convex cast plate over the root's inner face, thick lip toward the tip, wrapping onto the
    # core's flank (the concept's near-side root plate, outlined by the hot seam)
    t0, t1 = SHOULDER
    sp = interp(SPINE_U, 0.1)
    ctrl = [(t1, 0.22), (t1 - 0.02, 0.06), (0.10, 0.04), (0.02, 0.10), (-0.01, 0.30), (0.0, sp + 0.02),
            (0.06, sp + 0.04), (t1 - 0.03, sp + 0.03), (t1 + 0.012, 0.42)]
    outl = plate_outline(ctrl, (0,))
    th = lambda t, u: lerp(0.07, 0.20, smooth((t - t0) / (t1 - t0)) ** 0.9)
    pl = bm_plate(outl, -0.02, th, DK, bevel=0.035, grid=0.25, surf=lambda t, u, d: blade_off(t, u, d, side),
                  sa=14.0, sb=3.0)
    add(grp, "shoulder", pl)
    PLATES[f"shoulder_blade_{side}"] = (outl, side)
    # outer root plate on the outer bevel behind the spine
    ctrl2 = [(0.16, sp + 0.10), (0.10, sp + 0.07), (0.02, sp + 0.08), (-0.01, sp + 0.25), (0.0, 0.93),
             (0.08, 0.95), (0.15, 0.80)]
    outl2 = plate_outline(ctrl2, (0,))
    th2 = lambda t, u: lerp(0.05, 0.14, smooth(t / 0.16) ** 0.9)
    add(grp, "outerroot", bm_plate(outl2, -0.02, th2, DK, bevel=0.03, grid=0.25,
                                   surf=lambda t, u, d: blade_off(t, u, d, side), sa=14.0, sb=3.0))


BLADES = {}


def centroid(ob):
    me = ob.data
    me.calc_loop_triangles()
    vs = me.vertices
    c = Vector((0, 0, 0))
    vol = 0.0
    for t in me.loop_triangles:
        a, b, cc = (vs[i].co for i in t.vertices)
        v6 = a.dot(b.cross(cc))
        vol += v6
        c += (a + b + cc) * v6
    if abs(vol) < 1e-12:
        return sum((v.co for v in vs), Vector()) / max(1, len(vs))
    return c / (4 * vol)


# ============================================================================================== interior (seen in the debris)
CONDUITS = []        # (polyline in the design frame, hot core radius): ore conduits whose cut ends glow
CONDUIT_R, CONDUIT_CORE = 0.10, 0.06


def ring_frame(x, in0, in1, half, mat):
    """Closed annular frame inside the hull at station x: from inset in0 to in1, x +- half."""
    NT = 56
    bm = bmesh.new()
    R = [[bm.verts.new(hull_p(xx, 360 * k / NT, ii)) for k in range(NT)]
         for (xx, ii) in ((x - half, in0), (x + half, in0), (x + half, in1), (x - half, in1))]
    for i in range(4):
        A, B = R[i], R[(i + 1) % 4]
        for k in range(NT):
            k2 = (k + 1) % NT
            bm.faces.new((A[k], A[k2], B[k2], B[k]))
    return fix_orientation(set_mat(bm, mat), "frame")


def build_interior():
    # ring frames and longerons inside the hollow hull
    for x in (-4.7, -3.7, -2.7, -1.6):
        add("core", f"frame{x}", ring_frame(x, HULL_WALL - 0.03, HULL_WALL + 0.27, 0.045, DK))
    for th in (45, 135, 225, 315):
        path = [hull_p(x, th, HULL_WALL + 0.07) for x in [lerp(-4.95, -0.9, i / 24) for i in range(25)]]
        add("core", f"longeron{th}", bm_tube_path(path, 0.06, 8, DK))
    # ore conduits: the trunk from the jaw back to the furnace, branches out to each blade root
    trunk = [hull_p(x, 270, 0.43) for x in [lerp(-0.9, -4.6, i / 20) for i in range(21)]]
    trunk.append(Vector((-5.15, 0, ENG_Z - 0.25)))
    trunk.append(Vector((-5.45, 0, ENG_Z - 0.10)))
    add("core", "trunk", bm_tube_path(trunk, CONDUIT_R, 12, TI))
    CONDUITS.append(trunk)
    for side in (1, -1):
        br_ = [hull_p(-3.4, 270, 0.43), Vector((-3.5, 0.45 * side, -0.15)), Vector((-3.6, 0.95 * side, 0.08)),
               Vector((-3.7, 1.25 * side, 0.15))]
        add("core", f"branch{side}", bm_tube_path(br_, CONDUIT_R * 0.8, 12, TI))
        CONDUITS.append(br_)


def blade_cavity_and_ribs(side, grp):
    """Hollow the thick part of the blade (7 cm walls) and stiffen it with transverse ribs; an ore conduit runs
    along under the spine. Returns nothing; adds parts to the blade group."""
    WALL = 0.07
    ts = [t for t in [lerp(0.04, 0.60, i / 40) for i in range(41)]]
    bm = bmesh.new()
    rings = []
    for t in ts:
        ii, o = blade_io(t, side)
        pts, up, cx, w, h = sec_pts(t, ii, o)
        loop = section_uv(t)
        k_end = [i for i, (uu, vv) in enumerate(loop) if uu >= 0.9999][0]
        top = loop[:k_end + 1]
        bot = [loop[-1 - i] for i in range(len(loop) - k_end - 1)] if False else None

        def vt(u):
            for i in range(len(top) - 1):
                if top[i][0] <= u <= top[i + 1][0]:
                    f = (u - top[i][0]) / max(top[i + 1][0] - top[i][0], 1e-9)
                    return lerp(top[i][1], top[i + 1][1], f)
            return top[-1][1]
        botl = [(1.0, loop[k_end + 1][1])] + loop[k_end + 2:] + [(0.0, 0.0)]
        botl = sorted(botl, key=lambda q: q[0])

        def vb(u):
            for i in range(len(botl) - 1):
                if botl[i][0] <= u <= botl[i + 1][0]:
                    f = (u - botl[i][0]) / max(botl[i + 1][0] - botl[i][0], 1e-9)
                    return lerp(botl[i][1], botl[i + 1][1], f)
            return botl[-1][1]
        us = [0.24, 0.36, 0.47, 0.60, 0.74, 0.86]
        sec = []
        for u in us:
            sec.append((u, vt(u) * h - WALL))
        for u in reversed(us):
            sec.append((u, vb(u) * h + WALL))
        ok = all(sec[i][1] - sec[-1 - i][1] > 0.03 for i in range(len(us)))
        if not ok:
            break
        rings.append([bm.verts.new(ii + cx * (u * w) + up * v) for (u, v) in sec])
    if len(rings) < 3:
        bm.free()
        return None
    fs = loft_rings(bm, rings)
    bmesh.ops.reverse_faces(bm, faces=fs)
    for f in fs:
        f.material_index = INT
    t_end = ts[len(rings) - 1]
    # transverse ribs across the cavity
    for t in (0.12, 0.22, 0.32, 0.44, 0.54):
        if t > t_end - 0.03:
            continue
        ii, o = blade_io(t, side)
        pts, up, cx, w, h = sec_pts(t, ii, o, 0.97)
        tg = (blade_io(t + 0.01, side)[0].lerp(blade_io(t + 0.01, side)[1], 0.5) -
              blade_io(t - 0.01, side)[0].lerp(blade_io(t - 0.01, side)[1], 0.5)).normalized()
        rb = bmesh.new()
        R = [[rb.verts.new(p + tg * d) for p in pts] for d in (-0.035, 0.035)]
        loft_rings(rb, R)
        add(grp, f"rib{t}", fix_orientation(set_mat(rb, DK), "rib"))
    # conduit under the spine
    path = []
    for t in [lerp(0.0, t_end - 0.02, i / 24) for i in range(25)]:
        ii, o = blade_io(t, side)
        pts, up, cx, w, h = sec_pts(t, ii, o)
        sp = interp(SPINE_U, t)
        path.append(ii + cx * (sp * w) + up * (0.05 * h))
    add(grp, "conduit", bm_tube_path(path, 0.075, 10, TI))
    CONDUITS.append(path)
    return bm, t_end


# ============================================================================================== debris
def tear_disp(a, b, seed):
    """Relief of a fracture (m): broad warps 5-8 cm plus sharp zigzag teeth 3 cm."""
    q1 = Vector((a * 1.6 + seed, b * 1.6 - seed, seed * 0.3))
    q2 = Vector((a * 6.0 - seed, b * 6.0 + seed * 2, seed))
    q3 = Vector((a * 16.0, b * 16.0, seed * 3))
    return noise.noise(q1) * 0.07 + (abs(noise.noise(q2)) * 2 - 1) * 0.03 + noise.noise(q3) * 0.006


def bm_cutter(point, normal, seed, size, res, depth):
    """Closed solid on the -normal side of a jagged surface through point (size x size, extruded by depth).
    Its faces are M_Alloy_Bare: the fresh fracture."""
    n = Vector(normal).normalized()
    u = (Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))).cross(n).normalized()
    v = n.cross(u)
    bm = bmesh.new()
    N = int(size / res)
    grid = [[None] * (N + 1) for _ in range(N + 1)]
    for i in range(N + 1):
        for j in range(N + 1):
            a, b = -size / 2 + size * i / N, -size / 2 + size * j / N
            grid[i][j] = bm.verts.new(Vector(point) + u * a + v * b + n * tear_disp(a, b, seed))
    for i in range(N):
        for j in range(N):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    ring = [grid[i][0] for i in range(N)] + [grid[N][j] for j in range(N)] + \
           [grid[i][N] for i in range(N, 0, -1)] + [grid[0][j] for j in range(N, 0, -1)]
    bot = [bm.verts.new(vv.co - n * depth) for vv in ring]
    m = len(ring)
    for i in range(m):
        i2 = (i + 1) % m
        bm.faces.new((ring[i2], ring[i], bot[i], bot[i2]))
    bm.faces.new(bot[::-1])
    set_mat(bm, BA)
    fix_orientation(bm, "cutter")
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (0.995 + 0.004 * ((l.vert.co.dot(u) * 0.37) % 1.0), 0.995 + 0.004 * ((l.vert.co.dot(v) * 0.37) % 1.0))
    return bm


def remove_small_islands(ob, vmin=2e-4):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    removed = 0
    for v0 in list(bm.verts):
        if not v0.is_valid or v0.index in seen:
            continue
        stack = [v0]
        comp = []
        seen.add(v0.index)
        while stack:
            v = stack.pop()
            comp.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        faces = {f for v in comp for f in v.link_faces}
        vol = 0.0
        for f in faces:
            for tri in [(f.verts[0].co, f.verts[i].co, f.verts[i + 1].co) for i in range(1, len(f.verts) - 1)]:
                vol += tri[0].dot(tri[1].cross(tri[2])) / 6.0
        if abs(vol) < vmin:
            removed += 1
            bmesh.ops.delete(bm, geom=list(faces), context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()
    return removed


def split_by(pc, cutter_bm, label):
    """Split object pc by a cutter solid: returns (inside, outside) objects (either may be None)."""
    cut = bm_to_obj(cutter_bm, "cutter")
    a = duplicate(pc, pc.name + "a")
    boolean(a, None, 'INTERSECT', label=f"{label} in", operand_obj=cut)
    boolean(pc, None, 'DIFFERENCE', label=f"{label} out", operand_obj=cut)
    me = cut.data
    bpy.data.objects.remove(cut, do_unlink=True)
    bpy.data.meshes.remove(me)
    res = []
    for q in (a, pc):
        if len(q.data.polygons) == 0:
            bpy.data.objects.remove(q, do_unlink=True)
            res.append(None)
        else:
            res.append(q)
    return res


def hot_conduit_ends(ob, off):
    """Fracture faces that cross an ore conduit's core glow: M_Alloy_Bare -> M_Seam_Hot."""
    segs = []
    for path in CONDUITS:
        P = [p - off for p in path]
        segs += list(zip(P, P[1:]))
    me = ob.data
    k = 0
    for poly in me.polygons:
        if me.materials[poly.material_index].name != "M_Alloy_Bare":
            continue
        c = poly.center
        for a, b in segs:
            ab = b - a
            t = max(0.0, min(1.0, (c - a).dot(ab) / max(ab.length_squared, 1e-12)))
            if (a + ab * t - c).length < CONDUIT_CORE:
                poly.material_index = [i for i, m in enumerate(me.materials) if m.name == "M_Seam_Hot"][0]
                k += 1
                break
    return k


def make_debris(core_src, bl_src, br_src, off):
    """13 fragments: each blade breaks at its two forged joints; the engine drum comes off; the core splits left /
    right, front / back, and the head splits again above the jaw."""
    frags = []
    for src, side in ((bl_src, 1), (br_src, -1)):
        pc = duplicate(src, f"blade{side}")
        pieces = []
        for j, seed in zip(JOINTS, (2.3, 5.9)):
            ii, o = blade_io(j, side)
            c = ii.lerp(o, interp(SPINE_U, j)) - off
            i2, o2 = blade_io(j + 0.01, side)
            i0, o0 = blade_io(j - 0.01, side)
            tg = (i2.lerp(o2, 0.5) - i0.lerp(o0, 0.5)).normalized()
            tip, rest = split_by(pc, bm_cutter(c, -tg, seed + side, 5.0, 0.05, 12.0), f"blade{side} j{j}")
            pieces.append(rest)
            pc = tip
        pieces.append(pc)
        frags += [p for p in pieces if p is not None]
    pc = duplicate(core_src, "core")
    eng, front = split_by(pc, bm_cutter(Vector((-5.42, 0, ENG_Z)) - off, Vector((1, 0, 0.12)), 7.7, 4.6, 0.06, 4.0),
                          "engine")
    pieces = [eng]
    lr = split_by(front, bm_cutter(Vector((-2.6, 0.04, 0.2)) - off, Vector((0.08, 1, 0.18)), 3.1, 9.0, 0.07, 4.0),
                  "left-right")
    for half in lr:
        if half is None:
            continue
        fb = split_by(half, bm_cutter(Vector((-2.75, 0, 0.2)) - off, Vector((1, 0.18, 0.22)), 4.4, 6.0, 0.06, 5.0),
                      "front-back")
        back, frnt = fb[1], fb[0]
        if back is not None:
            pieces.append(back)
        if frnt is not None:
            hd = split_by(frnt, bm_cutter(Vector((-0.9, 0, 0.12)) - off, Vector((0.25, 0, 1)), 8.8, 4.2, 0.06, 3.0),
                          "head")
            pieces += [p for p in hd if p is not None]
    frags = [p for p in pieces if p is not None] + frags
    out = []
    for f in frags:
        remove_small_islands(f)
        if len(f.data.polygons) == 0:
            bpy.data.objects.remove(f, do_unlink=True)
            continue
        hot_conduit_ends(f, off)
        out.append(f)
    for i, f in enumerate(out):
        f.name = f"Debris_{i + 1:02d}"
        f.data.name = f.name
    return out


def volume(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    v = bm.calc_volume(signed=True)
    bm.free()
    return v


def used_slots(ob):
    used = {ob.data.materials[p.material_index].name for p in ob.data.polygons}
    return [n for n in MAT_NAMES if n in used]


def keep_materials(ob, names):
    me = ob.data
    old = [m.name if m else None for m in me.materials]
    idx = [p.material_index for p in me.polygons]
    me.materials.clear()
    for nm in names:
        me.materials.append(bpy.data.materials[nm])
    for p, i in zip(me.polygons, idx):
        nm = old[i] if i < len(old) else None
        p.material_index = names.index(nm) if nm in names else 0


# ============================================================================================== sockets, export
def add_sockets(body, off):
    g = GUN_L
    sockets = {
        "SOCKET_Gun_L": (Vector((g.x, g.y, g.z)), (0, 0, 0)),
        "SOCKET_Gun_R": (Vector((g.x, -g.y, g.z)), (0, 0, 0)),
        "SOCKET_Engine": (Vector((ENG_X0 - 0.02, 0, ENG_Z)), (0, 0, 180)),          # X axis points backward
        "SOCKET_Missile": (Vector((-2.1, 0, hull_p(-2.1, 270).z + 0.16)), (0, 0, 0)),
    }
    out = []
    for name, (p, rot) in sockets.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        e.empty_display_size = 0.5
        bpy.context.scene.collection.objects.link(e)
        e.parent = body
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.location = p - off
        e.rotation_euler = [radians(a) for a in rot]
        out.append(e)
    return out


def export_fbx(objs, path):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'MESH', 'EMPTY'},
                             apply_unit_scale=True, apply_scale_options='FBX_SCALE_UNITS', axis_forward='-Z',
                             axis_up='Y', use_space_transform=True, bake_space_transform=False,
                             mesh_smooth_type='FACE', use_tspace=True, use_triangles=True, add_leaf_bones=False,
                             bake_anim=False, path_mode='STRIP', use_mesh_modifiers=True)
    log("exported", path, f"{os.path.getsize(path) / 1e6:.2f} MB")


# ============================================================================================== hot seams
SEAM_MAIN = (0.050, 0.034, 0.040)        # top width, floor width, depth (m)
SEAM_SEC = (0.022, 0.014, 0.025)


def seam_cutter(path, normals, dims, bvhs, step=0.045, lift=0.6):
    """Groove cutter swept along a path, dropped onto the surface by ray casts (first hit along -normal from
    `lift` m outside). Floor M_Seam_Hot (the ore glows at the bottom of the crack), walls M_Alloy_Tint."""
    P = resample(path, max(4, int(poly_len(path) / step) + 1))
    N = resample(normals, len(P))
    H, M = [], []
    for p, n in zip(P, N):
        n = n.normalized()
        best = None
        for bvh in bvhs:
            hit = bvh.ray_cast(p + n * lift, -n, lift + 0.5)
            if hit[0] is not None and (best is None or hit[3] < best[3]):
                best = hit
        if best is None:
            continue
        hn = best[1] if best[1].dot(n) > 0 else -best[1]
        H.append(best[0])
        M.append(hn)
    if len(H) < 4:
        return None
    # smooth the normals along the path (plate edges and creases make them jump)
    Ms = []
    for i in range(len(M)):
        a = sum((M[j] for j in range(max(0, i - 3), min(len(M), i + 4))), Vector())
        Ms.append(a.normalized())
    wt, wf, dp = dims
    bm = bmesh.new()
    rings = []
    for i, (h, m) in enumerate(zip(H, Ms)):
        t = (H[min(i + 1, len(H) - 1)] - H[max(i - 1, 0)])
        if t.length < 1e-9:
            continue
        t.normalize()
        sd = t.cross(m).normalized()
        mm = sd.cross(t).normalized()
        rings.append([bm.verts.new(h + sd * a + mm * b) for (a, b) in
                      ((-wt / 2, 0.10), (-wf / 2, -dp), (wf / 2, -dp), (wt / 2, 0.10))])

    def mats(i, k):
        return HOT if k == 1 else TI
    loft_rings(bm, rings, mats=mats, cap_mat=TI)
    return fix_orientation(bm, "seam")


def outline_path(outl, surf, push=0.05):
    """3D path along a closed plate outline (param space), pushed outward from the plate's centre by `push` m."""
    c = (sum(a for a, b in outl) / len(outl), sum(b for a, b in outl) / len(outl))
    q = surf(c[0], c[1], 0.0)
    P, N = [], []
    for (a, b) in list(outl) + [outl[0]]:
        p = surf(a, b, 0.0)
        n = (surf(a, b, 0.05) - p).normalized()
        out = (p - q)
        out = (out - n * out.dot(n)).normalized()
        P.append(p + out * push)
        N.append(n)
    return P, N


SEAM_LOG = {}


def make_seams(core, bl, br):
    """Cut the hot seams into the core and the blades (after their unions)."""
    dg = bpy.context.evaluated_depsgraph_get()
    bv = {"core": BVHTree.FromObject(core, dg), "L": BVHTree.FromObject(bl, dg), "R": BVHTree.FromObject(br, dg)}
    jobs = {"core": [], "L": [], "R": []}
    count = {"main": 0, "secondary": 0}

    def add_seam(path, nrm, dims, targets, kind):
        bm = seam_cutter(path, nrm, dims, [bv[t] for t in targets])
        if bm is None:
            return
        count[kind] += 1
        for t in targets:
            jobs[t].append(bm.copy())
        bm.free()
    for side, key in ((1, "L"), (-1, "R")):
        surf = (lambda sd: (lambda t, u, d: blade_off(t, u, d, sd)))(side)
        # main: the blade's spine, from the shoulder plate's lip to three quarters of the way to the tip
        ts = [lerp(0.205, 0.86, i / 120) for i in range(121)]
        P = [blade_top(t, interp(SPINE_U, t), side) for t in ts]
        N = [(blade_off(t, interp(SPINE_U, t), 0.05, side) - p).normalized() for t, p in zip(ts, P)]
        add_seam(P, N, SEAM_MAIN, [key], "main")
        # main: round the shoulder plate (the concept's outlined root plate), onto the core where it meets it
        outl, _ = PLATES[f"shoulder_blade_{side}"]
        P, N = outline_path(outl, surf, push=0.045)
        add_seam(P, N, SEAM_MAIN, [key, "core"], "main")
        # secondary: across the blade at each forged joint, just tip-side of the step
        for j in JOINTS:
            us = [lerp(0.06, 0.96, i / 40) for i in range(41)]
            P = [blade_top(j + 0.005, u, side) for u in us]
            N = [(blade_off(j + 0.005, u, 0.05, side) - p).normalized() for u, p in zip(us, P)]
            add_seam(P, N, SEAM_SEC, [key], "secondary")
    # main: the free front edges of the two big dorsal plates (in front of the lip, on the plate below)
    for nm in ("dorsal2", "dorsal3"):
        outl = PLATES[nm]
        xf = max(a for a, b in outl)
        front = sorted([(a, b) for (a, b) in outl if a > xf - 0.55], key=lambda ab: ab[1])
        P = [hull_off(a + 0.06, b, 0.0) for (a, b) in front]
        N = [hull_n(a + 0.06, b) for (a, b) in front]
        add_seam(P, N, SEAM_MAIN, ["core"], "main")
    # secondary: the front edges of the upper flank plates
    for nm in ("flank1", "flank1_R", "flank2", "flank2_R"):
        outl = PLATES[nm]
        xf = max(a for a, b in outl)
        front = sorted([(a, b) for (a, b) in outl if a > xf - 0.7], key=lambda ab: ab[1])
        P = [hull_off(a + 0.05, b, 0.0) for (a, b) in front]
        N = [hull_n(a + 0.05, b) for (a, b) in front]
        add_seam(P, N, SEAM_SEC, ["core"], "secondary")
    # secondary: in the gaps between the head plates (beak / lower talon / upper talon / brow), both sides
    for side in (1, -1):
        for a_, b_ in (("beak", "t1"), ("t1", "t2"), ("t2", "brow")):
            A = HEAD["beak_path"] if a_ == "beak" else HEAD[f"{a_}_{side}"]
            B = HEAD["brow"] if b_ == "brow" else HEAD[f"{b_}_{side}"]
            A = resample(catmull(A, 6), 30)
            B = resample(catmull(B, 6), 30)
            P = []
            for k in range(3, 22):
                m = (A[k] + B[k]) / 2
                if a_ == "beak":
                    m = A[k] * 0.4 + B[k] * 0.6
                    m.y = abs(B[k].y) * 0.55 * side
                P.append(m)
            N = [(p - Vector((p.x, 0, 0.15))).normalized() for p in P]
            add_seam(P, N, SEAM_SEC, ["core"], "secondary")
    log(f"seams: {count['main']} main runs, {count['secondary']} secondary")
    SEAM_LOG.update(count)
    for key, ob in (("core", core), ("L", bl), ("R", br)):
        objs = [bm_to_obj(b, f"seam_{key}{i}") for i, b in enumerate(jobs[key])]
        if objs:
            boolean(ob, objs, 'DIFFERENCE', label=f"seams {key}")


# ============================================================================================== UVs
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
            ok = True
            for v in e.verts:
                u1 = [l[uvl].uv for l in f1.loops if l.vert == v][0]
                u2 = [l[uvl].uv for l in f2.loops if l.vert == v][0]
                if (u1 - u2).length > 1e-6:
                    ok = False
                    break
            if ok:
                parent[find(f1.index)] = find(f2.index)
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(f.index), []).append(f)
    return list(groups.values())


def shrink_minor_islands(ob):
    """Dark interiors, glowing faces and slivers get less of the map than the cast skin."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    k = 0
    for g in uv_islands(bm, uvl):
        a3 = sum(f.calc_area() for f in g)
        mats = {f.material_index for f in g}
        us = [l[uvl].uv.copy() for f in g for l in f.loops]
        mn = Vector((min(u.x for u in us), min(u.y for u in us)))
        mx = Vector((max(u.x for u in us), max(u.y for u in us)))
        d = mx - mn
        asp = min(d.x, d.y) / max(max(d.x, d.y), 1e-9)
        s = None
        if mats <= {INT}:
            s = 0.15
        elif mats <= {HOT, ENG, TI}:
            s = 0.35
        elif a3 < 0.002 or asp < 0.04:
            s = 0.5
        if s:
            c = (mn + mx) / 2
            for f in g:
                for l in f.loops:
                    l[uvl].uv = c + (l[uvl].uv - c) * s
            k += 1
    bm.to_mesh(ob.data)
    bm.free()
    log(f"UV {ob.name}: shrank {k} minor islands")


def uv_unwrap(objs, margin=0.0015):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=radians(60), island_margin=margin, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        shrink_minor_islands(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    for rot in ('ANY', 'CARDINAL'):
        try:
            bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method=rot, scale=True,
                                    margin_method='FRACTION', margin=margin, shape_method='CONCAVE')
        except TypeError:
            bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def uv_area(ob):
    me = ob.data
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    a = 0.0
    for t in me.loop_triangles:
        p0, p1, p2 = (uv[l].uv for l in t.loops)
        a += abs((p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)) * 0.5
    return a


# ============================================================================================== bakes
def gpu_setup(scene):
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


def _bake_target(ob, name, size, float_buffer=False):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = 'Non-Color'
    added = []
    for m in ob.data.materials:
        nt = m.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        added.append((nt, node))
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    return img, added


def _bake_save(img, added, out_png):
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    for nt, node in added:
        nt.nodes.remove(node)
    log("baked", out_png)


def bake_ao(ob, out_png, size, samples=128):
    scene = bpy.context.scene
    gpu_setup(scene)
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = 0.6
    img, added = _bake_target(ob, "T_Reaper_AO", size)
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    _bake_save(img, added, out_png)


def _emit_bake(ob, out_png, size, build, name, samples=32):
    """Bake an emission shader made by build(nt) -> output socket, on every material, then restore."""
    scene = bpy.context.scene
    scene.cycles.samples = samples
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    saved = []
    for m in ob.data.materials:
        nt = m.node_tree
        out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        n0 = set(nt.nodes)
        sock = build(nt, m.name)
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(sock, em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        saved.append((nt, out, old, [n for n in nt.nodes if n not in n0]))
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='EMIT', margin=8, use_clear=True)
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    for nt, out, old, nodes in saved:
        for n in nodes:
            nt.nodes.remove(n)
        if old is not None:
            nt.links.new(old, out.inputs["Surface"])
    log("baked", out_png)


def bake_cavity(ob, out_png, size):
    """Grooves and recesses dark, flat 0.5, convex edges bright: 0.5 * AO(out, 4 cm) + 0.5 * (1 - AO(in, 2 cm))."""
    def build(nt, mname):
        L = nt.links.new
        ao1 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao1.samples = 16
        ao1.inputs["Distance"].default_value = 0.04; ao1.only_local = True
        ao2 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao2.samples = 16; ao2.inside = True
        ao2.inputs["Distance"].default_value = 0.02; ao2.only_local = True
        inv = nt.nodes.new("ShaderNodeMath"); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        L(ao2.outputs["AO"], inv.inputs[1])
        add_ = nt.nodes.new("ShaderNodeMath"); add_.operation = 'ADD'
        L(ao1.outputs["AO"], add_.inputs[0]); L(inv.outputs[0], add_.inputs[1])
        half = nt.nodes.new("ShaderNodeMath"); half.operation = 'MULTIPLY'; half.inputs[1].default_value = 0.5
        L(add_.outputs[0], half.inputs[0])
        return half.outputs[0]
    _emit_bake(ob, out_png, size, build, "T_Reaper_Cavity", samples=32)


def cast_height(nt):
    """Procedural surface of hammered, cast alloy (object space, metres): shallow hammer dimples 8-20 cm, cast
    pitting 1-2 cm, slow undulation over metres. Returns a height socket (about 0..1)."""
    L = nt.links.new
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.feature = 'SMOOTH_F1'
    vor.inputs["Scale"].default_value = 7.0
    vor.inputs["Smoothness"].default_value = 0.6
    vor.inputs["Randomness"].default_value = 0.9
    L(tc.outputs["Object"], vor.inputs["Vector"])
    pit = nt.nodes.new("ShaderNodeTexNoise"); pit.inputs["Scale"].default_value = 55.0
    pit.inputs["Detail"].default_value = 6.0; pit.inputs["Roughness"].default_value = 0.65
    L(tc.outputs["Object"], pit.inputs["Vector"])
    und = nt.nodes.new("ShaderNodeTexNoise"); und.inputs["Scale"].default_value = 1.2
    und.inputs["Detail"].default_value = 2.0
    L(tc.outputs["Object"], und.inputs["Vector"])
    a = nt.nodes.new("ShaderNodeMath"); a.operation = 'MULTIPLY_ADD'
    a.inputs[1].default_value = 0.55
    L(vor.outputs["Distance"], a.inputs[0])
    mid = nt.nodes.new("ShaderNodeTexNoise"); mid.inputs["Scale"].default_value = 14.0
    mid.inputs["Detail"].default_value = 5.0; mid.inputs["Roughness"].default_value = 0.6
    L(tc.outputs["Object"], mid.inputs["Vector"])
    b = nt.nodes.new("ShaderNodeMath"); b.operation = 'MULTIPLY'; b.inputs[1].default_value = 0.45
    L(pit.outputs["Fac"], b.inputs[0])
    b2 = nt.nodes.new("ShaderNodeMath"); b2.operation = 'MULTIPLY_ADD'; b2.inputs[1].default_value = 0.30
    L(mid.outputs["Fac"], b2.inputs[0]); L(b.outputs[0], b2.inputs[2])
    L(b2.outputs[0], a.inputs[2])
    c = nt.nodes.new("ShaderNodeMath"); c.operation = 'MULTIPLY_ADD'; c.inputs[1].default_value = 0.35
    L(und.outputs["Fac"], c.inputs[0]); L(a.outputs[0], c.inputs[2])
    return c.outputs[0]


def bake_normal(ob, out_png, size):
    """Tangent-space normal map, DirectX convention (green = -Y, Unreal's): the hammered cast surface (bump from
    cast_height) on rounded plate edges (Cycles Bevel, 2.5 cm), on every alloy face; seams, engine and interiors
    stay flat."""
    scene = bpy.context.scene
    scene.cycles.samples = 16
    img, added = _bake_target(ob, "T_Reaper_Normal", size)
    saved = []
    for m in ob.data.materials:
        nt = m.node_tree
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        n0 = set(nt.nodes)
        if m.name in ("M_Alloy_Dark", "M_Alloy_Tint", "M_Alloy_Bare"):
            bev = nt.nodes.new("ShaderNodeBevel"); bev.samples = 8
            bev.inputs["Radius"].default_value = 0.025
            bump = nt.nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 0.85 if m.name != "M_Alloy_Bare" else 0.3
            bump.inputs["Distance"].default_value = 0.012
            nt.links.new(cast_height(nt), bump.inputs["Height"])
            nt.links.new(bev.outputs["Normal"], bump.inputs["Normal"])
            nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        saved.append((nt, [n for n in nt.nodes if n not in n0], bsdf))
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', normal_r='POS_X', normal_g='NEG_Y', normal_b='POS_Z',
                        margin=8, use_clear=True)
    for nt, nodes, bsdf in saved:
        for n in nodes:
            nt.nodes.remove(n)
    _bake_save(img, added, out_png)


def heat_attribute(body, core_frame_off):
    """Per-vertex heat for the tint mask: near the hot seams, round the engine, toward the blade roots."""
    me = body.data
    hot = [i for i, m in enumerate(me.materials) if m.name in ("M_Seam_Hot", "M_Engine_Hot")]
    pts = [me.polygons[i].center.copy() for i in range(len(me.polygons)) if me.polygons[i].material_index in hot]
    kd = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    eng = Vector((-5.9, 0, ENG_Z)) - core_frame_off
    att = me.attributes.new("tint_heat", "FLOAT", "POINT")    # ("heat" is a Cycles smoke attribute: it reads as 0)
    for v in me.vertices:
        p = v.co
        _, _, d = kd.find(p)
        h_seam = math.exp(-d / 0.32)
        q = p - eng
        de = max(0.0, sqrt(q.y * q.y + q.z * q.z) - 0.95) + max(0.0, abs(q.x) - 0.7)
        h_eng = math.exp(-de / 0.9)
        r = sqrt((p.y) ** 2) - 1.4                   # distance outboard of the core's flank
        h_root = math.exp(-max(r, 0.0) / 2.2) if abs(p.y) > 1.0 else 0.0
        h = min(1.0, 0.75 * h_seam + 0.85 * h_eng + 0.45 * h_root)
        att.data[v.index].value = h
    log(f"heat attribute from {len(pts)} hot faces")


def bake_tint(ob, out_png, size):
    """Heat-tint mask: white where the alloy is tempered by the ore's heat, in irregular forge-like blooms (the
    smooth per-vertex heat broken up by object-space noise), black elsewhere."""
    def build(nt, mname):
        L = nt.links.new
        attr = nt.nodes.new("ShaderNodeAttribute"); attr.attribute_name = "tint_heat"
        tc = nt.nodes.new("ShaderNodeTexCoord")
        n1 = nt.nodes.new("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 0.9
        n1.inputs["Detail"].default_value = 4.0; n1.inputs["Roughness"].default_value = 0.6
        L(tc.outputs["Object"], n1.inputs["Vector"])
        n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 4.5
        n2.inputs["Detail"].default_value = 6.0
        L(tc.outputs["Object"], n2.inputs["Vector"])
        m1 = nt.nodes.new("ShaderNodeMath"); m1.operation = 'MULTIPLY_ADD'      # bloom = 1.8 * noise - 0.4
        m1.inputs[1].default_value = 1.8; m1.inputs[2].default_value = -0.4; m1.use_clamp = True
        L(n1.outputs["Fac"], m1.inputs[0])
        m2 = nt.nodes.new("ShaderNodeMath"); m2.operation = 'MULTIPLY'
        L(attr.outputs["Fac"], m2.inputs[0]); L(m1.outputs[0], m2.inputs[1])
        m3 = nt.nodes.new("ShaderNodeMath"); m3.operation = 'MULTIPLY_ADD'      # + fine mottling
        m3.inputs[1].default_value = 0.3; m3.inputs[2].default_value = -0.15
        L(n2.outputs["Fac"], m3.inputs[0])
        m4 = nt.nodes.new("ShaderNodeMath"); m4.operation = 'MULTIPLY_ADD'
        m4.inputs[1].default_value = 1.4
        L(m2.outputs[0], m4.inputs[0]); L(m3.outputs[0], m4.inputs[2])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = 0.32, 0.90
        L(m4.outputs[0], mr.inputs["Value"])
        if mname in ("M_Seam_Hot", "M_Engine_Hot", "M_Dark_Interior"):
            one = nt.nodes.new("ShaderNodeValue")
            one.outputs[0].default_value = 1.0 if mname != "M_Dark_Interior" else 0.0
            return one.outputs[0]
        return mr.outputs[0]
    _emit_bake(ob, out_png, size, build, "T_Reaper_Tint", samples=8)


# ============================================================================================== main (shape stage)
def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    make_materials()
    log("building parts")
    build_hull()
    build_plates()
    build_head()
    build_engine()
    build_interior()
    build_blade(1)
    build_blade(-1)
    log("parts:", {g: len(v) for g, v in PARTS.items()})
    core = union_group("core", "Core")
    # recessed openings: line the pockets, cut them, then put the vanes, teeth, guns and rails in
    liners = [bm_to_obj(l, f"liner{i}") for i, (l, c) in enumerate(POCKETS)]
    boolean(core, liners, 'UNION', label="pocket liners")
    jaw_cut, jaw_det = build_jaw()
    cutters = [bm_to_obj(c, f"pocket{i}") for i, (l, c) in enumerate(POCKETS)] + [bm_to_obj(jaw_cut, "jawcut")]
    boolean(core, cutters, 'DIFFERENCE', label="openings")
    det = [bm_to_obj(b, f"det{i}") for i, b in enumerate(build_openings_detail() + jaw_det)]
    boolean(core, det, 'UNION', label="opening detail")
    bl = union_group("bladeL", "BladeL")
    br = union_group("bladeR", "BladeR")
    make_seams(core, bl, br)
    log(f"triangles: core {tris(core)}, blades {tris(bl)} + {tris(br)}")
    # origin: centre of volume of the core (x, z); y stays on the centre line
    c = centroid(core)
    OFF = Vector((c.x, 0.0, c.z))
    log(f"core centre of volume (design frame) {tuple(round(a, 3) for a in c)}")
    for o in (core, bl, br):
        o.data.transform(Matrix.Translation(-OFF))
        shade(o)
    cmn, cmx = bbox([core])
    log(f"core bbox size {tuple(round(v, 3) for v in (cmx - cmn))} (with the engine drum and head plates)")
    for t in (0.0, 0.25, 0.5, 0.75, 0.97):
        ii, o = blade_io(t, 1)
        log(f"blade t {t:.2f}: width {(o - ii).length:.2f} m, thickness {interp(BLADE_H, t):.2f} m")
    i1, o1 = blade_io(0.985, 1)
    i2, o2 = blade_io(1.0, 1)
    d = (i2.lerp(o2, 0.5) - i1.lerp(o1, 0.5))
    log(f"blade tip heading {math.degrees(atan2(-d.y, d.x)):.1f} deg inward; tips {2 * blade_io(1.0, 1)[0].y:.2f} m apart")
    # UVs on the parts (one shared map) before the debris cuts, so the fragments inherit them
    uv_unwrap([core, bl, br])
    body = join(duplicate(core, "Reaper_Body"), [duplicate(bl, "bl_w"), duplicate(br, "br_w")])
    body.name = body.data.name = "Reaper_Body"
    body["design_offset"] = tuple(OFF)
    log(f"UV area used {100 * uv_area(body):.1f}%")
    log(f"triangles: Reaper_Body {tris(body)}")
    mn, mx = bbox([body])
    log(f"bbox min {tuple(round(v, 3) for v in mn)} max {tuple(round(v, 3) for v in mx)} "
        f"size {tuple(round(v, 3) for v in (mx - mn))}")
    for o in (core, bl, br):
        o.hide_render = True
        o.hide_set(True)
    keep_materials(body, MAT_NAMES)
    heat_attribute(body, OFF)
    frags = []
    if not FAST:
        frags = make_debris(core, bl, br, OFF)
        for f in frags:
            shade(f)
            keep_materials(f, used_slots(f))
        dc = bpy.data.collections.new("Debris")
        bpy.context.scene.collection.children.link(dc)
        for f in frags:
            for uc in list(f.users_collection):
                uc.objects.unlink(f)
            dc.objects.link(f)
    vol_whole = sum(volume(o) for o in (core, bl, br))
    info = []
    for f in frags:
        nm, v = nonmanifold(f)
        c = centroid(f)
        mn, mx = bbox([f])
        info.append({"name": f.name, "triangles": tris(f), "volume_l": round(v * 1000, 1),
                     "centroid": [round(c.x, 3), round(c.y, 3), round(c.z, 3)],
                     "bbox_min": [round(a, 3) for a in mn], "bbox_max": [round(a, 3) for a in mx],
                     "non_manifold_edges": nm, "slots": used_slots(f)})
        log(f"  {f.name}: tris {tris(f):6d}  vol {v * 1000:9.1f} L  nonmanifold {nm}  centroid "
            f"{tuple(round(a, 2) for a in c)}  slots {used_slots(f)}")
    if frags:
        vsum = sum(i["volume_l"] for i in info) / 1000
        log(f"fragments: {len(frags)}, triangles {sum(tris(f) for f in frags)}; volume whole parts "
            f"{vol_whole * 1000:.1f} L, fragments {vsum * 1000:.1f} L ({100 * vsum / vol_whole:.1f}%)")
    sockets = add_sockets(body, OFF)
    if DO_BAKE:
        tex = os.path.join(os.path.abspath(EXPORT_DIR or HERE), "textures")
        os.makedirs(tex, exist_ok=True)
        if frags:
            bpy.data.collections["Debris"].hide_render = True
        bake_ao(body, os.path.join(tex, "T_Reaper_AO.png"), TEX)
        bake_cavity(body, os.path.join(tex, "T_Reaper_Cavity.png"), TEX)
        bake_normal(body, os.path.join(tex, "T_Reaper_Normal.png"), TEX)
        bake_tint(body, os.path.join(tex, "T_Reaper_Tint.png"), TEX)
        if frags:
            bpy.data.collections["Debris"].hide_render = False
    for o in (core, bl, br):
        bpy.data.objects.remove(o, do_unlink=True)
    if EXPORT_DIR:
        ed = os.path.abspath(EXPORT_DIR)
        os.makedirs(ed, exist_ok=True)
        export_fbx([body] + sockets, os.path.join(ed, "reaper.fbx"))
        if frags:
            export_fbx(frags, os.path.join(ed, "reaper_debris.fbx"))
            with open(os.path.join(ed, "reaper_debris.json"), "w") as fh:
                json.dump({"note": "Fragments of reaper.fbx; vertices in the Reaper's frame (metres, +X forward, +Z up), "
                                   "pivot at the Reaper's origin (the core's centre of volume). Centroid = centre of "
                                   "volume. The whole volume counts the core and both blades as separate solids "
                                   "(the blade roots are sunk into the core).",
                           "whole_volume_l": round(vol_whole * 1000, 1), "fragments": info}, fh, indent=1)
    if BLEND_OUT:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
        log("saved", BLEND_OUT)
    log("done")


def bbox(objs):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


if __name__ == "__main__":
    main()
