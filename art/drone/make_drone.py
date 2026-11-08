"""Rewild practice target drone (the Argo's training target), built from code in Blender 5.2.

Run headless from the repo root:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b --factory-startup -P art/drone/make_drone.py -- \
      [--blend <out.blend>] [--export art/drone/export] [--bake]

Metres, front (the emitter face) +X, up +Z, origin at the centre of the body. See README.md.
Every part is a closed solid; the body is joined with Blender's Manifold boolean (face counts are logged, because a
non-manifold operand makes it silently do nothing). Paint boundaries are real panel edges: each panel is its own slab.
"""
import bpy, bmesh, math, sys, os, time, json, random
from math import radians, sin, cos, tan, pi, sqrt
from mathutils import Vector, Matrix, noise

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

# ============================================================================================== materials
MAT_NAMES = ["M_Paint_Orange", "M_Paint_White", "M_Paint_Grey", "M_Metal_Dark", "M_Glass_Sensor", "M_Beacon",
             "M_Foil_MLI", "M_Metal_Torn"]
O, W, G, D, GL, B, MLI, T = range(8)
MATS = []


def make_materials():
    # preview values only; the look is made in Unreal. Orange is a real high-vis orange-red, not neon.
    pv = {
        "M_Paint_Orange": ((0.78, 0.062, 0.030), 0.42, 0.0),
        "M_Paint_White": ((0.74, 0.74, 0.72), 0.40, 0.0),
        "M_Paint_Grey": ((0.20, 0.205, 0.21), 0.45, 0.25),
        "M_Metal_Dark": ((0.035, 0.035, 0.037), 0.36, 0.85),
        "M_Glass_Sensor": ((0.01, 0.012, 0.016), 0.04, 0.0),
        "M_Beacon": ((0.9, 0.9, 0.85), 0.2, 0.0),
        "M_Foil_MLI": ((0.90, 0.56, 0.16), 0.30, 1.0),
        "M_Metal_Torn": ((0.022, 0.020, 0.019), 0.62, 0.7),
    }
    for n in MAT_NAMES:
        m = bpy.data.materials.new(n)
        if m.node_tree is None:
            m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        col, rough, metal = pv[n]
        bsdf.inputs["Base Color"].default_value = (*col, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = metal
        if n == "M_Glass_Sensor":
            bsdf.inputs["Coat Weight"].default_value = 1.0
            bsdf.inputs["Coat Roughness"].default_value = 0.02
        if n == "M_Beacon":
            bsdf.inputs["Emission Color"].default_value = (1.0, 0.86, 0.62, 1)
            bsdf.inputs["Emission Strength"].default_value = 6.0
            bsdf.inputs["Transmission Weight"].default_value = 0.3
        m.diffuse_color = (*col, 1)
        MATS.append(m)


# ============================================================================================== primitives
# Every primitive is its own bmesh (one closed solid, or several closed solids that do not touch), oriented outward.

def fix_orientation(bm, name=""):
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-7)
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
    """4x4 rotation whose Z column is d (right-handed)."""
    d = Vector(d).normalized()
    a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    x = (a - d * a.dot(d)).normalized()
    y = d.cross(x)
    return Matrix((x, y, d)).transposed().to_4x4()


def place(p, d):
    M = frame_z(d)
    M.translation = Vector(p)
    return M


def bm_box(center, size, mat, rot=None, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=1, affect='EDGES', profile=0.5)
    M = (rot.to_4x4() if rot is not None else Matrix.Identity(4))
    M.translation = Vector(center)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return fix_orientation(set_mat(bm, mat), "box")


def bm_box_between(p0, p1, w, h, up, mat):
    """Box along the segment p0-p1, w wide (across, perpendicular to up) and h along up."""
    p0, p1 = Vector(p0), Vector(p1)
    ax = (p1 - p0)
    L = ax.length
    ax.normalize()
    up = Vector(up)
    up = (up - ax * up.dot(ax)).normalized()
    side = up.cross(ax)
    rot = Matrix((ax, side, up)).transposed()
    return bm_box((p0 + p1) / 2, (L, w, h), mat, rot)


def bm_cyl(p0, p1, r0, r1, n, mat):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=n, radius1=r0, radius2=r1, depth=d.length)
    M = place((p0 + p1) / 2, d)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return fix_orientation(set_mat(bm, mat), "cyl")


def bm_sphere(c, r, mat, nu=24, nv=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=nu, v_segments=nv, radius=r)
    bmesh.ops.translate(bm, vec=Vector(c), verts=bm.verts)
    return fix_orientation(set_mat(bm, mat), "sphere")


def shoelace(poly):
    return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                     for i in range(len(poly)))


def bm_prism(poly, origin, ex, ey, ez, z0, z1, mat, bm=None):
    """Extrude a 2D polygon (coords along ex, ey) from z0 to z1 along ez."""
    own = bm is None
    bm = bm or bmesh.new()
    if shoelace(poly) < 0:
        poly = poly[::-1]
    origin, ex, ey, ez = Vector(origin), Vector(ex), Vector(ey), Vector(ez)
    bot = [bm.verts.new(origin + ex * a + ey * b + ez * z0) for a, b in poly]
    top = [bm.verts.new(origin + ex * a + ey * b + ez * z1) for a, b in poly]
    fs = [bm.faces.new(top), bm.faces.new(bot[::-1])]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((bot[i], bot[j], top[j], top[i])))
    if ex.cross(ey).dot(ez) * (z1 - z0) < 0:
        bmesh.ops.reverse_faces(bm, faces=fs)
    for f in fs:
        f.material_index = mat
    if own:
        return fix_orientation(bm, "prism")
    return fs


def bm_lathe(profile, M, n, mat, bm=None):
    """Revolve a CLOSED profile loop [(z, r)] (r > 0) about the local Z axis, then transform by M (4x4)."""
    own = bm is None
    bm = bm or bmesh.new()
    m = len(profile)
    V = []
    for k in range(n):
        a = 2 * pi * k / n
        c, s = cos(a), sin(a)
        V.append([bm.verts.new(M @ Vector((r * c, r * s, z))) for (z, r) in profile])
    fs = []
    for k in range(n):
        kn = (k + 1) % n
        for i in range(m):
            i2 = (i + 1) % m
            fs.append(bm.faces.new((V[k][i], V[kn][i], V[kn][i2], V[k][i2])))
    for f in fs:
        f.material_index = mat
    if own:
        return fix_orientation(bm, "lathe")
    return fs


def bm_revolve_solid(profile, M, n, mat):
    """Revolve an OPEN profile [(z, r)] whose first and last points lie on the axis (r = 0): a closed solid."""
    bm = bmesh.new()
    z0, z1 = profile[0][0], profile[-1][0]
    a0 = bm.verts.new(M @ Vector((0, 0, z0)))
    a1 = bm.verts.new(M @ Vector((0, 0, z1)))
    mid = profile[1:-1]
    V = []
    for k in range(n):
        a = 2 * pi * k / n
        c, s = cos(a), sin(a)
        V.append([bm.verts.new(M @ Vector((r * c, r * s, z))) for (z, r) in mid])
    for k in range(n):
        kn = (k + 1) % n
        bm.faces.new((a0, V[kn][0], V[k][0]))
        for i in range(len(mid) - 1):
            bm.faces.new((V[k][i], V[kn][i], V[kn][i + 1], V[k][i + 1]))
        bm.faces.new((V[k][-1], V[kn][-1], a1))
    return fix_orientation(set_mat(bm, mat), "revolve")


# ============================================================================================== the octagon
A = 0.70                  # body apothem (1.40 m across flats)
WALL = 0.025              # honeycomb panel wall
X0, X1, XM = -0.90, 0.90, 0.0
RAIL_W, RAIL_H = 0.022, 0.010     # edge rails: 22 mm onto each flat, 10 mm proud
PANEL_H = 0.004           # painted panels stand 4 mm proud of the structure
GAP = 0.008               # gaps between panels and frames
END_W, MID_W = 0.036, 0.044
CAP_RIM = 0.040           # end frame rim on the caps
C225 = cos(radians(22.5))
T225 = tan(radians(22.5))


def nrm(k):
    t = radians(45 * k)
    return Vector((0, cos(t), sin(t)))


def tng(k):
    t = radians(45 * k)
    return Vector((0, -sin(t), cos(t)))


def corner(j, h):
    """Corner between flat j and flat j+1 of the octagon of apothem h (in the YZ plane, x = 0)."""
    p = radians(22.5 + 45 * j)
    R = h / C225
    return Vector((0, R * cos(p), R * sin(p)))


def s_half(h):
    return h * T225


def oct_solid(h, x0, x1, mat, inward=False, bm=None):
    bm = bm or bmesh.new()
    a = [bm.verts.new(corner(j, h) + Vector((x0, 0, 0))) for j in range(8)]
    b = [bm.verts.new(corner(j, h) + Vector((x1, 0, 0))) for j in range(8)]
    fs = [bm.faces.new(b), bm.faces.new(a[::-1])]
    for j in range(8):
        jn = (j + 1) % 8
        fs.append(bm.faces.new((a[j], a[jn], b[jn], b[j])))
    # corners run counter-clockwise seen from +X, so the +X cap above points +X: outward
    if inward:
        bmesh.ops.reverse_faces(bm, faces=fs)
    for f in fs:
        f.material_index = mat
    return bm


def oct_lathe(profile, mat):
    """Sweep a closed (x, apothem) profile loop round the octagon: rings, frames, bands."""
    bm = bmesh.new()
    m = len(profile)
    V = [[bm.verts.new(corner(j, h) + Vector((x, 0, 0))) for (x, h) in profile] for j in range(8)]
    for j in range(8):
        jn = (j + 1) % 8
        for i in range(m):
            i2 = (i + 1) % m
            bm.faces.new((V[j][i], V[jn][i], V[jn][i2], V[j][i2]))
    return fix_orientation(set_mat(bm, mat), "octlathe")


def on_flat(k, x, s, h):
    """Point on flat k at axial x, across-flat s, height h (apothem)."""
    return Vector((x, 0, 0)) + nrm(k) * h + tng(k) * s


def rounded_rect(a0, a1, b0, b1, r, n=3):
    pts = []
    for (ca, cb, ang0) in ((a1 - r, b0 + r, -90), (a1 - r, b1 - r, 0), (a0 + r, b1 - r, 90), (a0 + r, b0 + r, 180)):
        for i in range(n + 1):
            t = radians(ang0 + 90 * i / n)
            pts.append((ca + r * cos(t), cb + r * sin(t)))
    return pts


def clip_half(poly, a, b, c):
    """Keep the part of a polygon where a*x + b*y + c >= 0 (Sutherland-Hodgman)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp, fq = a * p[0] + b * p[1] + c, a * q[0] + b * q[1] + c
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0):
            t = fp / (fp - fq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def inset_convex(poly, d):
    """Offset a convex CCW polygon inward by d."""
    if shoelace(poly) < 0:
        poly = poly[::-1]
    n = len(poly)
    lines = []
    for i in range(n):
        p, q = Vector(poly[i]), Vector(poly[(i + 1) % n])
        e = (q - p).normalized()
        nin = Vector((-e.y, e.x))
        lines.append((p + nin * d, e))
    out = []
    for i in range(n):
        p1, e1 = lines[i - 1]
        p2, e2 = lines[i]
        den = e1.x * e2.y - e1.y * e2.x
        if abs(den) < 1e-9:
            out.append(tuple(p2))
            continue
        t = ((p2.x - p1.x) * e2.y - (p2.y - p1.y) * e2.x) / den
        out.append(tuple(p1 + e1 * t))
    return out


# ============================================================================================== parts
PARTS = {}          # group -> list of (name, bmesh)


def add(group, name, bm):
    PARTS.setdefault(group, []).append((name, bm))


def fasteners_rect(group, k, xa, xb, sa, sb, h_top, inset=0.018, pitch=0.11, r=0.006, mat=G):
    """Hex fastener heads round a rectangle on flat k (x along, s across), heads 1.8 mm above h_top."""
    bm = bmesh.new()
    pts = []
    for (p0, p1) in (((xa, sa), (xb, sa)), ((xb, sa), (xb, sb)), ((xb, sb), (xa, sb)), ((xa, sb), (xa, sa))):
        a = Vector(p0) + (Vector(p1) - Vector(p0)).normalized() * inset
        b = Vector(p1) - (Vector(p1) - Vector(p0)).normalized() * inset
        L = (b - a).length
        cnt = max(1, int(round(L / pitch)))
        for i in range(cnt):
            pts.append(a + (b - a) * (i / cnt))
    for (x, s) in pts:
        # move the point inward from the edge
        xi = min(max(x, xa + inset), xb - inset)
        si = min(max(s, sa + inset), sb - inset)
        p = on_flat(k, xi, si, 0)
        merge_into(bm, bm_cyl(p + nrm(k) * (h_top - 0.002), p + nrm(k) * (h_top + 0.0018), r, r * 0.9, 6, mat))
    return bm


def merge_into(dst, src):
    me = bpy.data.meshes.new("tmp")
    src.to_mesh(me)
    dst.from_mesh(me)
    bpy.data.meshes.remove(me)
    src.free()


def panel_mat(k, front):
    if front:
        return W if k in (0, 2, 4, 5, 6, 7) else O     # upper front diagonals orange, the rest of the front band white
    return MLI if k in (1, 3) else O         # the two upper rear diagonals carry the gold blankets


# ---------------------------------------------------------------------------------------------- body structure
def build_shell():
    bm = oct_solid(A, X0, X1, G)
    oct_solid(A - WALL, X0 + WALL, X1 - WALL, G, inward=True, bm=bm)
    fix_orientation(bm, "shell")
    add("body", "shell", bm)
    # frames: front and rear end bands wrapping onto the caps, mid ring
    E = 0.0035
    for sgn in (1, -1):
        xe = X1 if sgn > 0 else X0
        prof = [(xe - sgn * END_W, A - E), (xe - sgn * END_W, A + RAIL_H), (xe + sgn * RAIL_H, A + RAIL_H),
                (xe + sgn * RAIL_H, A - CAP_RIM), (xe - sgn * E, A - CAP_RIM), (xe - sgn * E, A - E)]
        if sgn < 0:
            prof = prof[::-1]
        add("body", "endframe", oct_lathe(prof, G))
    add("body", "midring", oct_lathe([(XM - MID_W / 2, A - E), (XM + MID_W / 2, A - E),
                                      (XM + MID_W / 2, A + RAIL_H), (XM - MID_W / 2, A + RAIL_H)], G))
    # edge rails (bent angle sections over each corner)
    for j in range(8):
        k, k1 = j, (j + 1) % 8
        e = 0.003

        def P(kk, h, d, plus):
            sh = s_half(h)
            s = (sh - d) if plus else (-sh + d)
            return nrm(kk) * h + tng(kk) * s
        poly3 = [P(k, A - e, RAIL_W, True), P(k, A + RAIL_H, RAIL_W, True), corner(j, A + RAIL_H),
                 P(k1, A + RAIL_H, RAIL_W, False), P(k1, A - e, RAIL_W, False), corner(j, A - e)]
        poly = [(p.y, p.z) for p in poly3]
        add("body", "rail", bm_prism(poly, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), X0 + 0.01, X1 - 0.01, G))


def build_side_panels():
    sp = s_half(A) - RAIL_W - GAP
    halves = {True: (XM + MID_W / 2 + GAP, X1 - END_W - GAP), False: (X0 + END_W + GAP, XM - MID_W / 2 - GAP)}
    for k in range(8):
        for front in (True, False):
            mat = panel_mat(k, front)
            xa, xb = halves[front]
            if mat == MLI:
                continue           # blankets are built separately
            poly = rounded_rect(xa, xb, -sp, sp, 0.018)
            org = nrm(k) * 0.0
            bm = bm_prism(poly, org, (1, 0, 0), tng(k), nrm(k), A - 0.0025, A + PANEL_H, mat)
            add("body", f"panel{k}{'F' if front else 'R'}", bm)
            add("body", "fast", fasteners_rect("body", k, xa, xb, -sp, sp, A + PANEL_H))


def build_caps():
    hr = A - CAP_RIM - GAP         # inside the cap rim
    octp = [(corner(j, hr).y, corner(j, hr).z) for j in range(8)]
    # front cap: four quadrants, orange / white like a roll pattern
    g2 = GAP / 2
    quads = [((1, 0, -g2), (0, 1, -g2), O), ((-1, 0, -g2), (0, 1, -g2), W),
             ((-1, 0, -g2), (0, -1, -g2), O), ((1, 0, -g2), (0, -1, -g2), W)]
    for (h1, h2, mat) in quads:
        p = clip_half(clip_half(octp, *h1), *h2)
        add("body", "capF", bm_prism(p, (0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), X1 - 0.0025, X1 + PANEL_H, mat))
    # rear cap: the same quadrants (the blanket ring lies on them)
    for (h1, h2, mat) in quads:
        p = clip_half(clip_half(octp, *h1), *h2)
        add("body", "capR", bm_prism(p, (0, 0, 0), (0, 1, 0), (0, 0, 1), (-1, 0, 0), -X0 - 0.0025, -X0 + PANEL_H,
                                     W if mat == O else O))


# ---------------------------------------------------------------------------------------------- MLI blankets
MLI_RES = 0.012           # facet size of the crinkled foil
MLI_RING_R = (0.135, 0.30)


def hash01(i, j, k):
    """Deterministic pseudo-random number in [0, 1) per grid vertex."""
    h = ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65536.0


def mli_crinkle(u, v, seed):
    """Foil relief (m): folds 10-15 cm apart with sharp crests in two directions and crinkles 3-6 cm apart,
    measured off the STP-H3 photograph; slopes reach 15-25 deg so facets catch the sun."""
    ca, sa = cos(seed * 2.3), sin(seed * 2.3)
    a, b = u * ca - v * sa, u * sa + v * ca
    f1 = 1.0 - abs(noise.noise(Vector((a * 7.0, b * 2.8, seed))))
    f2 = 1.0 - abs(noise.noise(Vector((a * 2.5 + 5.0, b * 7.5, seed + 9.0))))
    c1 = 1.0 - abs(noise.noise(Vector((a * 24.0, b * 16.0, seed + 3.0))))
    c2 = noise.noise(Vector((a * 52.0, b * 47.0, seed + 7.0)))
    return 0.0065 * f1 ** 2 + 0.0045 * f2 ** 2 + 0.0030 * c1 ** 1.5 + 0.0010 * c2 - 0.0060


def mli_height(u, v, du, dv, seed):
    """Blanket thickness (m) at local (u, v) inside a du x dv patch: flat taped edge, tack dimples every 0.15 m,
    pillowed between them, crinkled foil on top."""
    e = min(u, du - u, v, dv - v)
    t = min(1.0, max(0.0, (e - 0.025) / 0.03))
    t = t * t * (3 - 2 * t)
    sp = 0.15
    tu = round((u - du / 2) / sp) * sp + du / 2
    tv = round((v - dv / 2) / sp) * sp + dv / 2
    d2 = (u - tu) ** 2 + (v - tv) ** 2
    dimple = -0.0070 * math.exp(-d2 / (0.024 ** 2)) * t
    h = 0.0030 + 0.0110 * t + dimple + mli_crinkle(u, v, seed) * (0.2 + 0.8 * t)
    return max(h, 0.0015)


def bm_heightfield(origin, eu, ev, en, du, dv, res, hfun, mat, z_bottom=-0.003, seed=0):
    """Closed solid: a crinkled patch du x dv (along eu, ev) with height hfun(u, v) along en over a flat bottom.
    Inner vertices are jittered and each cell split along a random diagonal, so the facets are irregular
    triangles (a square grid of flat facets reads as pixels)."""
    bm = bmesh.new()
    nu, nv = max(2, int(round(du / res))), max(2, int(round(dv / res)))
    origin, eu, ev, en = Vector(origin), Vector(eu), Vector(ev), Vector(en)
    top = [[None] * (nv + 1) for _ in range(nu + 1)]
    for i in range(nu + 1):
        for j in range(nv + 1):
            u, v = du * i / nu, dv * j / nv
            hj = 0.0
            if 0 < i < nu and 0 < j < nv:
                u += (hash01(i, j, seed) - 0.5) * 0.7 * du / nu
                v += (hash01(j, i, seed + 1) - 0.5) * 0.7 * dv / nv
                hj = (hash01(i, j, seed + 2) - 0.5) * 0.0018
            top[i][j] = bm.verts.new(origin + eu * u + ev * v + en * (hfun(u, v) + hj))
    for i in range(nu):
        for j in range(nv):
            a, b, c, d = top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]
            if hash01(i, j, seed + 3) < 0.5:
                bm.faces.new((a, b, c))
                bm.faces.new((a, c, d))
            else:
                bm.faces.new((a, b, d))
                bm.faces.new((b, c, d))
    ring = [top[i][0] for i in range(nu)] + [top[nu][j] for j in range(nv)] + \
           [top[i][nv] for i in range(nu, 0, -1)] + [top[0][j] for j in range(nv, 0, -1)]
    bot = [bm.verts.new(v.co - en * (v.co - origin).dot(en) + en * z_bottom) for v in ring]
    n = len(ring)
    for i in range(n):
        i2 = (i + 1) % n
        bm.faces.new((ring[i2], ring[i], bot[i], bot[i2]))
    bm.faces.new(bot[::-1])
    if eu.cross(ev).dot(en) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    set_mat(bm, mat)
    return fix_orientation(bm, "heightfield")


def build_blankets():
    sp = s_half(A) - RAIL_W - GAP
    xa, xb = X0 + END_W + GAP, XM - MID_W / 2 - GAP
    for k in (1, 3):
        seed = k * 1.37
        origin = on_flat(k, xa, -sp, A)
        bm = bm_heightfield(origin, (1, 0, 0), tng(k), nrm(k), xb - xa, 2 * sp, MLI_RES,
                            lambda u, v, s=seed: mli_height(u, v, xb - xa, 2 * sp, s), MLI, seed=k)
        grp = "mliL" if k == 1 else "body"
        add(grp, f"mli{k}", bm)
    # ring round the main nozzle on the rear cap (polar grid, jittered, triangulated the same way)
    bm = bmesh.new()
    r0, r1 = MLI_RING_R
    nr = int(round((r1 - r0) / MLI_RES))
    na = int(round(2 * pi * (r0 + r1) / 2 / MLI_RES))
    xr = X0 - PANEL_H

    def hring(rr, a):
        e = min(rr - r0, r1 - rr)
        t = min(1.0, max(0.0, (e - 0.018) / 0.025))
        t = t * t * (3 - 2 * t)
        tk = 0.0
        for ta in range(8):
            aa = 2 * pi * ta / 8 + 0.2
            dx, dy = rr * cos(a) - 0.22 * cos(aa), rr * sin(a) - 0.22 * sin(aa)
            tk += -0.0065 * math.exp(-(dx * dx + dy * dy) / 0.022 ** 2)
        h = 0.0030 + 0.0100 * t + (mli_crinkle(cos(a) * rr, sin(a) * rr, 5.0) + tk) * (0.2 + 0.8 * t)
        return max(h, 0.0015)
    top = []
    for i in range(nr + 1):
        row = []
        for j in range(na):
            rr = r0 + (r1 - r0) * i / nr
            a = 2 * pi * j / na
            hj = 0.0
            if 0 < i < nr:
                rr += (hash01(i, j, 11) - 0.5) * 0.7 * (r1 - r0) / nr
                a += (hash01(j, i, 12) - 0.5) * 0.7 * 2 * pi / na
                hj = (hash01(i, j, 13) - 0.5) * 0.0018
            row.append(bm.verts.new((xr - hring(rr, a) - hj, rr * cos(a), rr * sin(a))))
        top.append(row)
    for i in range(nr):
        for j in range(na):
            jn = (j + 1) % na
            a_, b_, c_, d_ = top[i][j], top[i][jn], top[i + 1][jn], top[i + 1][j]
            if hash01(i, j, 14) < 0.5:
                bm.faces.new((a_, b_, c_))
                bm.faces.new((a_, c_, d_))
            else:
                bm.faces.new((a_, b_, d_))
                bm.faces.new((b_, c_, d_))
    bi = [bm.verts.new((xr + 0.0055, r0 * cos(2 * pi * j / na), r0 * sin(2 * pi * j / na))) for j in range(na)]
    bo = [bm.verts.new((xr + 0.0055, r1 * cos(2 * pi * j / na), r1 * sin(2 * pi * j / na))) for j in range(na)]
    for j in range(na):
        jn = (j + 1) % na
        bm.faces.new((top[0][jn], top[0][j], bi[j], bi[jn]))
        bm.faces.new((top[nr][j], top[nr][jn], bo[jn], bo[j]))
        bm.faces.new((bi[jn], bi[j], bo[j], bo[jn]))
    set_mat(bm, MLI)
    add("body", "mliring", fix_orientation(bm, "mliring"))


# ---------------------------------------------------------------------------------------------- front face
TUR_C = Vector((X1 + 0.02, 0.0, -0.16))       # ball centre
TUR_R = 0.15
MUZZLE = Vector((TUR_C.x + 0.45, 0.0, TUR_C.z))
WIN_C = Vector((X1, 0.27, 0.30))
LRA_C = Vector((X1, -0.27, 0.30))


def build_front():
    Mx = place((0, 0, 0), (1, 0, 0))
    # collar ring (fixed) and ball
    prof = [(X1 - 0.004, 0.142), (X1 - 0.004, 0.192), (X1 + 0.030, 0.192), (X1 + 0.044, 0.180),
            (X1 + 0.044, 0.142)]
    M = place((0, TUR_C.y, TUR_C.z), (1, 0, 0))
    add("body", "collar", bm_lathe([(z, r) for z, r in prof], M, 40, G))
    add("body", "ball", bm_sphere(TUR_C, TUR_R, G, 32, 16))
    # barrel: sleeve, finned heat sink, muzzle ring with a dark emitter inside
    c = TUR_C
    add("body", "sleeve", bm_cyl(c + Vector((0.08, 0, 0)), c + Vector((0.20, 0, 0)), 0.046, 0.042, 20, G))
    add("body", "core", bm_cyl(c + Vector((0.19, 0, 0)), c + Vector((0.33, 0, 0)), 0.026, 0.026, 16, D))
    for i in range(6):
        x = 0.205 + i * 0.022
        add("body", "fin", bm_cyl(c + Vector((x, 0, 0)), c + Vector((x + 0.006, 0, 0)), 0.060, 0.060, 20, D))
    add("body", "barrel", bm_cyl(c + Vector((0.32, 0, 0)), c + Vector((0.425, 0, 0)), 0.030, 0.029, 18, G))
    Mb = place((0, c.y, c.z), (1, 0, 0))
    add("body", "muzzle", bm_lathe([(c.x + 0.415, 0.019), (c.x + 0.415, 0.033), (c.x + 0.440, 0.034),
                                    (c.x + 0.450, 0.031), (c.x + 0.450, 0.021), (c.x + 0.440, 0.019)], Mb, 20, D))
    add("body", "emitter", bm_cyl(c + Vector((0.400, 0, 0)), c + Vector((0.428, 0, 0)), 0.0195, 0.0195, 16, D))
    # sensor window: bezel ring, glass, hood
    Mw = place((0, WIN_C.y, WIN_C.z), (1, 0, 0))
    add("body", "bezel", bm_lathe([(X1 - 0.003, 0.046), (X1 - 0.003, 0.068), (X1 + 0.020, 0.068),
                                   (X1 + 0.026, 0.062), (X1 + 0.026, 0.046)], Mw, 32, G))
    add("body", "window", bm_cyl(WIN_C + Vector((-0.003, 0, 0)), WIN_C + Vector((0.014, 0, 0)), 0.0465, 0.0465,
                                 32, GL))
    add("body", "hood", bm_box(WIN_C + Vector((0.045, 0, 0.066)), (0.050, 0.15, 0.006), G,
                               Matrix.Rotation(radians(-12), 3, 'Y')))
    # laser retro-reflector: hex plate with 7 corner cubes
    Ml = place((0, LRA_C.y, LRA_C.z), (1, 0, 0))
    hexp = [(0.082 * cos(radians(30 + 60 * i)), 0.082 * sin(radians(30 + 60 * i))) for i in range(6)]
    add("body", "lraplate", bm_prism(hexp, (X1, LRA_C.y, LRA_C.z), (0, 1, 0), (0, 0, 1), (1, 0, 0), -0.003, 0.010, G))
    cubes = bmesh.new()
    for (cy, cz) in [(0, 0)] + [(0.046 * cos(radians(60 * i)), 0.046 * sin(radians(60 * i))) for i in range(6)]:
        sub = bmesh.new()
        r = 0.021
        ring_lo = [sub.verts.new((X1 + 0.008, LRA_C.y + cy + r * cos(radians(60 * i)),
                                  LRA_C.z + cz + r * sin(radians(60 * i)))) for i in range(6)]
        ring_hi = [sub.verts.new((X1 + 0.0205, LRA_C.y + cy + r * cos(radians(60 * i)),
                                  LRA_C.z + cz + r * sin(radians(60 * i)))) for i in range(6)]
        apex = sub.verts.new((X1 + 0.0105, LRA_C.y + cy, LRA_C.z + cz))
        sub.faces.new(ring_lo[::-1])
        for i in range(6):
            i2 = (i + 1) % 6
            sub.faces.new((ring_lo[i], ring_lo[i2], ring_hi[i2], ring_hi[i]))
        for i in (0, 2, 4):     # three rhombic facets down to the apex: a corner cube
            sub.faces.new((ring_hi[i], ring_hi[(i + 1) % 6], ring_hi[(i + 2) % 6], apex))
        set_mat(sub, GL)
        fix_orientation(sub, "cube")
        merge_into(cubes, sub)
    add("body", "lracubes", cubes)
    # small lifting lugs on the front and rear frames (sides)
    for xe in (X1 - 0.025, X0 + 0.025):
        for k in (0, 4):
            p = on_flat(k, xe, 0.0, A + RAIL_H)
            M = place(p + nrm(k) * 0.012, Vector((1, 0, 0)))
            add("body", "lug", bm_lathe([(-0.005, 0.009), (0.005, 0.009), (0.005, 0.017), (-0.005, 0.017)],
                                        M, 16, G))
            add("body", "lugbase", bm_box(p + nrm(k) * 0.002, (0.030, 0.030, 0.030), G,
                                          Matrix((Vector((1, 0, 0)), tng(k), nrm(k))).transposed()))


# ---------------------------------------------------------------------------------------------- top and belly kit
BEACON_C = Vector((-0.45, 0.0, A + PANEL_H + 0.024))
ANT = [Vector((-0.74, 0.20, A + PANEL_H)), Vector((-0.74, -0.20, A + PANEL_H))]


def build_top():
    b = BEACON_C
    add("body", "beaconbase", bm_cyl(Vector((b.x, b.y, A - 0.002)), b, 0.040, 0.036, 24, G))
    add("body", "beacon", bm_sphere(b, 0.032, B, 24, 12))
    for ax in ((1, 0, 0), (0, 1, 0)):
        M = place(b, ax)
        prof = [(0.0025 * cos(radians(60 * i)), 0.046 + 0.0025 * sin(radians(60 * i))) for i in range(6)]
        add("body", "guard", bm_lathe(prof, M, 28, G))
    # grapple fixture: plate, pin with knob, three cam ramps
    gx = 0.46
    add("body", "grplate", bm_box((gx, 0, A + 0.004), (0.14, 0.14, 0.010), G, bevel=0.004))
    add("body", "grpin", bm_cyl((gx, 0, A + 0.006), (gx, 0, A + 0.085), 0.011, 0.011, 16, G))
    add("body", "grknob", bm_cyl((gx, 0, A + 0.080), (gx, 0, A + 0.098), 0.018, 0.014, 16, G))
    for i in range(3):
        a = radians(90 + 120 * i)
        dvec = Vector((cos(a), sin(a), 0))
        p0 = Vector((gx, 0, A + 0.006)) + dvec * 0.03
        p1 = Vector((gx, 0, A + 0.006)) + dvec * 0.062
        side = Vector((-sin(a), cos(a), 0))
        tri = [(0.0, 0.0), (0.032, 0.0), (0.0, 0.030)]
        add("body", "cam", bm_prism(tri, p0, dvec, Vector((0, 0, 1)), side, -0.006, 0.006, G))
    # whip antennas: base, spring, rod, tip ball (tilted 10 deg outward)
    for i, p in enumerate(ANT):
        grp = "antL" if i == 0 else "body"
        tilt = Matrix.Rotation(radians(-10 if p.y > 0 else 10), 3, 'X')
        up = tilt @ Vector((0, 0, 1))
        add(grp, "antbase", bm_cyl(p - up * 0.003, p + up * 0.026, 0.017, 0.014, 16, D))
        add(grp, "antspring", bm_cyl(p + up * 0.020, p + up * 0.066, 0.0062, 0.0055, 10, D))
        add(grp, "antrod", bm_cyl(p + up * 0.060, p + up * 0.50, 0.0026, 0.0020, 8, G))
        add(grp, "anttip", bm_sphere(p + up * 0.50, 0.0055, G, 10, 6))


def build_belly():
    zb = -A
    # battery module with cooling ribs and two connectors
    bx0, bx1, by = -0.78, -0.22, 0.19
    add("body", "battery", bm_box(((bx0 + bx1) / 2, 0, zb - 0.030), (bx1 - bx0, 2 * by, 0.068), G, bevel=0.008))
    for i in range(9):
        y = -by + 0.03 + i * (2 * by - 0.06) / 8
        add("body", "rib", bm_box(((bx0 + bx1) / 2 - 0.01, y, zb - 0.068), (bx1 - bx0 - 0.09, 0.006, 0.022), G))
    for y in (-0.08, 0.08):
        add("body", "batconn", bm_cyl((bx1 - 0.01, y, zb - 0.030), (bx1 + 0.032, y, zb - 0.030), 0.016, 0.016, 16, D))
    # radar corner reflector (trihedral of three 4 mm plates, 0.22 m edges) on a pedestal
    o = Vector((0.5, 0, -1)).normalized()
    C = Vector((0.40, 0.0, zb - 0.045))
    add("body", "crped", bm_cyl((C.x, C.y, zb + 0.004), C + Vector((0, 0, 0.006)), 0.03, 0.022, 16, G))
    # three mutually perpendicular unit edges around o
    e1 = frame_z(o).to_3x3()
    X, Y, Z = e1.col[0], e1.col[1], e1.col[2]
    cphi = sqrt(1 / 3)
    sphi = sqrt(2 / 3)
    edges = [(Z * cphi + (X * cos(radians(a)) + Y * sin(radians(a))) * sphi).normalized() for a in (0, 120, 240)]
    L = 0.22
    for i in range(3):
        a, bb = edges[i], edges[(i + 1) % 3]
        nn = a.cross(bb).normalized()
        tri = [Vector((0, 0, 0)), a * L, bb * L]
        ex = a
        ey = nn.cross(a)
        poly = [(p.dot(ex), p.dot(ey)) for p in tri]
        add("body", "crplate", bm_prism(poly, C, ex, ey, nn, -0.002, 0.002, G))
    # patch antenna tile (white radome on a grey frame), umbilical connector
    add("body", "patchframe", bm_box((0.18, 0.30, zb - 0.002), (0.13, 0.13, 0.012), G, bevel=0.003))
    add("body", "patch", bm_box((0.18, 0.30, zb - 0.008), (0.11, 0.11, 0.008), W, bevel=0.002))
    add("body", "umbplate", bm_box((0.16, -0.28, zb - 0.002), (0.10, 0.10, 0.010), G, bevel=0.003))
    add("body", "umb", bm_cyl((0.16, -0.28, zb), (0.16, -0.28, zb - 0.034), 0.034, 0.034, 24, D))


# ---------------------------------------------------------------------------------------------- wings
WING_ROOT_Y, WING_TIP_Y = 0.75, 1.75
W_LE_ROOT, W_LE_TIP, W_TE = 0.28, -0.12, -0.62
W_T = 0.045
W_SPLIT = 1.22


def build_wing(side):
    grp = "wingL" if side > 0 else "body"
    s = side
    plan = [(W_TE, WING_ROOT_Y), (W_LE_ROOT, WING_ROOT_Y), (W_LE_TIP, WING_TIP_Y), (W_TE, WING_TIP_Y)]
    plan = [(x, s * y) for x, y in plan]
    if shoelace(plan) < 0:
        plan = plan[::-1]
    h = W_T / 2
    # base slab, chamfered all round (the grey extrusion frame)
    c = 0.008
    bm = bmesh.new()
    lv = [(-h, inset_convex(plan, c)), (-h + c, plan), (h - c, plan), (h, inset_convex(plan, c))]
    rings = [[bm.verts.new((x, y, z)) for (x, y) in pl] for (z, pl) in lv]
    n = 4
    for i in range(3):
        for j in range(n):
            jn = (j + 1) % n
            bm.faces.new((rings[i][j], rings[i][jn], rings[i + 1][jn], rings[i + 1][j]))
    bm.faces.new(rings[-1])
    bm.faces.new(rings[0][::-1])
    set_mat(bm, W)
    add(grp, "wingslab", fix_orientation(bm, "wingslab"))
    # skins: root and tip, opposite colours on top and bottom, 40 mm in from the frame
    inner = inset_convex(plan, 0.028)
    sy = 1 if s > 0 else -1
    for zsign in (1, -1):
        for part in ("root", "tip"):
            if part == "root":
                p = clip_half(inner, 0, -sy, W_SPLIT - 0.006)   # y*s <= split
                mat = W if zsign > 0 else O
            else:
                p = clip_half(inner, 0, sy, -(W_SPLIT + 0.006))   # y*s >= split
                mat = O if zsign > 0 else W
            z0, z1 = (h - 0.003, h + 0.003) if zsign > 0 else (-h + 0.003, -h - 0.003)
            add(grp, "skin", bm_prism(p, (0, 0, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), z0, z1, mat))
            # fasteners round the skin
            fb = bmesh.new()
            pp = inset_convex(p, 0.016)
            for i in range(len(pp)):
                a, b2 = Vector(pp[i]), Vector(pp[(i + 1) % len(pp)])
                L = (b2 - a).length
                cnt = max(1, int(round(L / 0.11)))
                for t in range(cnt):
                    q = a + (b2 - a) * (t / cnt)
                    zt = z1
                    merge_into(fb, bm_cyl((q.x, q.y, zt - zsign * 0.002), (q.x, q.y, zt + zsign * 0.0018),
                                          0.006, 0.0054, 6, G))
            add(grp, "wfast", fb)
    # root fitting: bracket, two clevis pins, harness conduit into the body
    yb0, yb1 = s * (A - 0.004), s * (WING_ROOT_Y + 0.05)
    add(grp, "bracket", bm_box((-0.17, (yb0 + yb1) / 2, 0), (0.56, abs(yb1 - yb0), 0.070), G, bevel=0.006))
    for x in (-0.40, 0.06):
        add(grp, "clevis", bm_cyl((x, s * 0.735, -0.052), (x, s * 0.735, 0.052), 0.020, 0.020, 16, G))
        add(grp, "clevhead", bm_cyl((x, s * 0.735, 0.048), (x, s * 0.735, 0.060), 0.028, 0.028, 6, G))
    add(grp, "harness", bm_cyl((0.14, s * 0.80, 0.030), (0.20, s * 0.69, 0.140), 0.011, 0.011, 8, D))
    add(grp, "harness2", bm_cyl((0.14, s * 0.80, 0.030), (0.10, s * 0.80, 0.022), 0.011, 0.011, 8, D))


# ---------------------------------------------------------------------------------------------- thruster pods
POD_X, POD_R = -0.55, 0.98
POD_SZ = (0.36, 0.24, 0.24)          # x, tangential, radial


def bell(p, d, L, rt, re, wall, n, mat):
    """Hollow bell nozzle from p along d: throat radius rt, exit radius re, length L."""
    ins, outs = [], []
    steps = 5 if L < 0.1 else 9
    for i in range(steps + 1):
        t = i / steps
        r = rt + (re - rt) * (t ** 0.62)
        ins.append((L * t, r))
        outs.append((L * t, r + wall * (1.6 - 0.6 * t)))
    prof = ins[::-1] + outs
    return bm_lathe(prof, place(p, d), n, mat)


def build_pod(theta, grp):
    k = theta // 45
    u, v = nrm(k), tng(k)
    xh, th, rh = POD_SZ[0] / 2, POD_SZ[1] / 2, POD_SZ[2] / 2
    c = Vector((POD_X, 0, 0)) + u * POD_R
    rot = Matrix((Vector((1, 0, 0)), v, u)).transposed()
    add(grp, "podbody", bm_box(c, POD_SZ, O, rot, bevel=0.016))     # high-vis, like a target's wingtips
    # struts: a radial post and a raked brace, both into the body wall
    add(grp, "strut", bm_box_between(Vector((POD_X, 0, 0)) + u * (A - 0.02), Vector((POD_X, 0, 0)) + u * (POD_R - rh + 0.01),
                                     0.055, 0.055, v, G))
    add(grp, "brace", bm_box_between(Vector((POD_X + 0.20, 0, 0)) + u * (A - 0.02),
                                     Vector((POD_X + 0.06, 0, 0)) + u * (POD_R - rh + 0.02), 0.035, 0.035, v, G))
    add(grp, "feed", bm_cyl(Vector((POD_X - 0.05, 0, 0)) + u * (A - 0.01) + v * 0.045,
                            Vector((POD_X - 0.05, 0, 0)) + u * (POD_R - rh + 0.02) + v * 0.045, 0.009, 0.009, 8, D))
    # five nozzles: +X, -X, +v, -v, +u (outward)
    for d, half in ((Vector((1, 0, 0)), xh), (Vector((-1, 0, 0)), xh), (v, th), (-v, th), (u, rh)):
        p = c + d * (half - 0.006)
        add(grp, "valve", bm_cyl(p, p + d * 0.022, 0.021, 0.019, 12, D))
        add(grp, "bell", bell(p + d * 0.016, d, 0.070, 0.0095, 0.0275, 0.0022, 14, D))
    # connector on the inboard face
    add(grp, "podconn", bm_cyl(c - u * (rh - 0.004) + Vector((0.09, 0, 0)), c - u * (rh + 0.022) + Vector((0.09, 0, 0)),
                               0.014, 0.014, 10, D))


def build_main_engine():
    add("body", "flange", bm_cyl((X0 + 0.01, 0, 0), (X0 - 0.030, 0, 0), 0.125, 0.12, 32, G))
    add("body", "chamber", bm_cyl((X0 - 0.025, 0, 0), (X0 - 0.075, 0, 0), 0.055, 0.045, 24, D))
    add("body", "mainbell", bell(Vector((X0 - 0.065, 0, 0)), Vector((-1, 0, 0)), 0.24, 0.036, 0.100, 0.004, 36, D))
    for y in (-0.19, 0.19):          # fill and drain valves on the rear cap
        add("body", "fdv", bm_cyl((X0 + 0.003, y, 0.24), (X0 - 0.035, y, 0.24), 0.014, 0.014, 12, D))
        add("body", "fdvcap", bm_cyl((X0 - 0.030, y, 0.24), (X0 - 0.048, y, 0.24), 0.018, 0.018, 6, G))


# ---------------------------------------------------------------------------------------------- internals
def build_internals():
    E = 0.004
    add("body", "bulkhead", oct_lathe([(XM - 0.006, 0.50), (XM + 0.006, 0.50), (XM + 0.006, A - WALL + E),
                                       (XM - 0.006, A - WALL + E)], G))
    tank = bm_sphere((-0.45, 0, 0), 0.28, G, 28, 14)
    inner = bm_sphere((-0.45, 0, 0), 0.274, G, 28, 14)
    bmesh.ops.reverse_faces(inner, faces=inner.faces[:])
    merge_into(tank, inner)
    add("body", "tank", tank)
    add("body", "tankband", bm_cyl((-0.48, 0, 0), (-0.42, 0, 0), 0.287, 0.287, 28, D))
    for k in (1, 3, 5, 7):
        add("body", "tankstrut", bm_cyl(Vector((-0.45, 0, 0)) + nrm(k) * 0.25, Vector((-0.45, 0, 0)) + nrm(k) * (A - WALL + E),
                                        0.012, 0.012, 8, G))
    fl = -(A - WALL)
    add("body", "avion1", bm_box((0.36, 0.0, fl + 0.075), (0.40, 0.52, 0.16), D, bevel=0.006))
    add("body", "avion2", bm_box((0.42, A - WALL - 0.055, 0.03), (0.38, 0.12, 0.34), D, bevel=0.006))
    add("body", "avion3", bm_box((0.30, -(A - WALL - 0.05), 0.10), (0.30, 0.11, 0.26), D, bevel=0.006))
    add("body", "wheel", bm_cyl((0.40, 0, A - WALL + E), (0.40, 0, A - WALL - 0.09), 0.13, 0.13, 24, G))
    add("body", "turretdrive", bm_cyl((X1 - WALL + E, 0, -0.16), (X1 - 0.22, 0, -0.16), 0.10, 0.09, 20, D))
    add("body", "feedline", bm_cyl((-0.73, 0, 0), (X0 + WALL - E, 0, 0), 0.016, 0.016, 10, G))


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
    log(f"boolean {op:10s} {label:16s} {len(cutters) if cutters else 1:4d} operands  faces {nf0} -> {nf1}")
    if nf1 == nf0 and op == 'UNION':
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


def union_group(group, name):
    items = PARTS[group]
    objs = [bm_to_obj(bm, f"{name}_{nm}") for nm, bm in items]
    target = objs[0]
    if len(objs) > 1:
        boolean(target, objs[1:], 'UNION', label=group)
    target.name = name
    target.data.name = name
    nm, vol = nonmanifold(target)
    log(f"  {name}: {len(target.data.polygons)} faces, {tris(target)} tris, non-manifold edges {nm}, "
        f"volume {vol * 1000:.2f} L")
    return target


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


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


def used_slots(ob):
    used = {ob.data.materials[p.material_index].name for p in ob.data.polygons}
    return [n for n in MAT_NAMES if n in used]


def shade(ob, angle=30):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=radians(angle), keep_sharp_edges=True)
    # crinkled foil: only near-flat neighbours (< 6 deg) shade smooth; every crease stays a sharp facet that catches
    # the sun (smoothing up to 18 deg made the foil read as smudges)
    mli = {i for i, m in enumerate(ob.data.materials) if m and m.name == "M_Foil_MLI"}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for e in bm.edges:
        if len(e.link_faces) == 2 and all(f.material_index in mli for f in e.link_faces):
            e.smooth = e.calc_face_angle(0.0) < radians(6)
    for f in bm.faces:
        if f.material_index in mli:
            f.smooth = True
    bm.to_mesh(ob.data)
    bm.free()
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
    return o2


def join(target, others):
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target


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


def interior_face(c):
    """Face centre inside the hollow of the body (hidden in the whole drone)."""
    if abs(c.x) > X1 - WALL + 0.002:
        return False
    h = max(abs(c.y), abs(c.z), (abs(c.y) + abs(c.z)) / sqrt(2))
    return h < A - WALL + 0.002


def shrink_minor_islands(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv.active
    k = 0
    for g in uv_islands(bm, uvl):
        a3 = sum(f.calc_area() for f in g)
        inside = all(interior_face(f.calc_center_median()) for f in g)
        us = [l[uvl].uv.copy() for f in g for l in f.loops]
        mn = Vector((min(u.x for u in us), min(u.y for u in us)))
        mx = Vector((max(u.x for u in us), max(u.y for u in us)))
        d = mx - mn
        asp = min(d.x, d.y) / max(max(d.x, d.y), 1e-9)
        a2 = 0.0
        for f in g:
            ls = [l[uvl].uv for l in f.loops]
            m = len(ls)
            a2 += abs(sum(ls[i].x * ls[(i + 1) % m].y - ls[(i + 1) % m].x * ls[i].y for i in range(m))) / 2
        fill = a2 / max(d.x * d.y, 1e-12)
        s = None
        hidden = all(f.material_index == MLI and f.normal.dot(Vector((0, f.calc_center_median().y,
                                                                      f.calc_center_median().z)).normalized()) < -0.5
                     for f in g)
        if inside or hidden:
            s = 0.10
        elif a3 < 0.0006 or asp < 0.05 or all(f.material_index == D for f in g):
            s = 0.5
        elif fill < 0.30:          # rings and frames (panel-gap floors, cap rims): their holes would waste the map
            s = 0.34
        if s:
            c = (mn + mx) / 2
            for f in g:
                for l in f.loops:
                    l[uvl].uv = c + (l[uvl].uv - c) * s
            k += 1
    bm.to_mesh(ob.data)
    bm.free()
    log(f"UV {ob.name}: shrank {k} minor/interior islands")


def uv_unwrap(objs, margin=0.0012):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=margin, area_weight=0.0, correct_aspect=True,
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
    # first pass any rotation, second pass right angles only from the packed layout (54.5% of the map is used;
    # the thousands of small fastener and frame islands are what keep it from more)
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


def uv_overlap_count(ob, res=1024):
    """Rasterise UV triangles; count cells claimed by two different islands."""
    import array
    me = ob.data
    uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    isl = [0] * len(bm.faces)
    for gi, g in enumerate(uv_islands(bm, uvl)):
        for f in g:
            isl[f.index] = gi
    bm.free()
    owner = array.array('i', [-1]) * (res * res)
    clashes = 0
    for t in me.loop_triangles:
        pid = isl[t.polygon_index]
        pts = [uv[l].uv for l in t.loops]
        xs = [p.x * res for p in pts]
        ys = [p.y * res for p in pts]
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
                kk = yy * res + xx
                if owner[kk] == -1:
                    owner[kk] = pid
                elif owner[kk] != pid:
                    clashes += 1
    return clashes


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


def bake_ao(ob, out_png, size, samples=128):
    scene = bpy.context.scene
    gpu_setup(scene)
    scene.cycles.samples = samples
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = 0.35
    img = bpy.data.images.new("T_Drone_AO", size, size, alpha=False, float_buffer=False)
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
    scene.render.bake.margin = 8
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    for nt, node in added:
        nt.nodes.remove(node)
    log("baked AO", out_png)


def bake_cavity(ob, out_png, size):
    """Grooves and recesses dark, flat 0.5, convex edges bright: 0.5 * AO(out, 2.5 cm) + 0.5 * (1 - AO(in, 1.2 cm))."""
    scene = bpy.context.scene
    scene.cycles.samples = 32
    img = bpy.data.images.new("T_Drone_Cavity", size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    saved = []
    for m in ob.data.materials:
        nt = m.node_tree
        out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        ao1 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao1.samples = 16
        ao1.inputs["Distance"].default_value = 0.025; ao1.only_local = True
        ao2 = nt.nodes.new("ShaderNodeAmbientOcclusion"); ao2.samples = 16; ao2.inside = True
        ao2.inputs["Distance"].default_value = 0.012; ao2.only_local = True
        inv = nt.nodes.new("ShaderNodeMath"); inv.operation = 'SUBTRACT'; inv.inputs[0].default_value = 1.0
        nt.links.new(ao2.outputs["AO"], inv.inputs[1])
        add_ = nt.nodes.new("ShaderNodeMath"); add_.operation = 'ADD'
        nt.links.new(ao1.outputs["AO"], add_.inputs[0]); nt.links.new(inv.outputs[0], add_.inputs[1])
        half = nt.nodes.new("ShaderNodeMath"); half.operation = 'MULTIPLY'; half.inputs[1].default_value = 0.5
        nt.links.new(add_.outputs[0], half.inputs[0])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(half.outputs[0], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; nt.nodes.active = tex
        saved.append((nt, out, old, [ao1, ao2, inv, add_, half, em, tex]))
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
    log("baked cavity", out_png)


# ============================================================================================== debris
def tear_disp(a, b, seed):
    """Relief of a tear (m): broad warps 3-6 cm plus sharp zigzag teeth."""
    q1 = Vector((a * 2.1 + seed, b * 2.1 - seed, seed * 0.3))
    q2 = Vector((a * 7.5 - seed, b * 7.5 + seed * 2, seed))
    q3 = Vector((a * 19.0, b * 19.0, seed * 3))
    warp = noise.noise(q1) * 0.040
    teeth = (abs(noise.noise(q2)) * 2 - 1) * 0.018
    fine = noise.noise(q3) * 0.004
    return warp + teeth + fine


def bm_cutter(point, normal, seed, size=3.4, res=0.045, depth=3.0):
    """Closed half-space solid below a jagged surface through point (normal n points out of the solid)."""
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
    set_mat(bm, T)
    fix_orientation(bm, "cutter")
    # UVs of the torn faces: a small planar patch (they use M_Metal_Torn, not the AO map)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (0.5 + 0.25 * l.vert.co.dot(u), 0.5 + 0.25 * l.vert.co.dot(v))
    return bm


CUTS = [  # (point, normal, seed): three jagged cuts through the body
    (Vector((0.10, 0.06, 0.02)), Vector((0.30, 0.94, 0.16)), 1.3),
    (Vector((-0.22, 0.0, 0.0)), Vector((0.92, -0.22, 0.32)), 4.7),
    (Vector((-0.12, 0.0, 0.06)), Vector((0.26, 0.18, 0.95)), 8.1),
]


def split_islands(ob):
    """Split an object into its connected pieces; return list of (bmesh piece volume, object)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    comps = []
    for v0 in bm.verts:
        if v0.index in seen:
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
        comps.append(comp)
    bm.free()
    return len(comps)


def remove_small_islands(ob, vmin=4e-6):
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


def make_debris(body_src, loose):
    pieces = [duplicate(body_src, "chunk")]
    for ci, (p, n, seed) in enumerate(CUTS):
        cut = bm_to_obj(bm_cutter(p, n, seed), f"cutter{ci}")
        new = []
        for pc in pieces:
            a = duplicate(pc, pc.name + "a")
            boolean(a, None, 'INTERSECT', label=f"cut{ci} in", operand_obj=cut)
            boolean(pc, None, 'DIFFERENCE', label=f"cut{ci} out", operand_obj=cut)
            for q in (a, pc):
                if len(q.data.polygons) > 0:
                    new.append(q)
                else:
                    bpy.data.objects.remove(q, do_unlink=True)
        pieces = new
        me = cut.data
        bpy.data.objects.remove(cut, do_unlink=True)
        bpy.data.meshes.remove(me)
    out = []
    for pc in pieces:
        r = remove_small_islands(pc)
        if len(pc.data.polygons) == 0:
            bpy.data.objects.remove(pc, do_unlink=True)
            continue
        out.append(pc)
    # order body chunks front-top first, so names are stable
    out.sort(key=lambda o: -centroid(o).x * 2 - centroid(o).z)
    frags = out + [duplicate(o, o.name + "_frag") for o in loose]
    for i, f in enumerate(frags):
        f.name = f"Debris_{i + 1:02d}"
        f.data.name = f.name
    return frags


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


def volume(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    v = bm.calc_volume(signed=True)
    bm.free()
    return v


# ============================================================================================== sockets, export
SOCKETS = {
    "SOCKET_Gun": (MUZZLE, (0, 0, 0)),
    "SOCKET_Core": (Vector((0, 0, 0)), (0, 0, 0)),
    "SOCKET_Beacon": (BEACON_C + Vector((0, 0, 0.01)), (0, -90, 0)),     # X axis points up
}


def add_sockets(body):
    out = []
    for name, (p, rot) in SOCKETS.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = 'ARROWS'
        e.empty_display_size = 0.25
        bpy.context.scene.collection.objects.link(e)
        e.parent = body
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.location = p
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


def bbox(objs):
    mn = Vector((1e9,) * 3)
    mx = Vector((-1e9,) * 3)
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            mn = Vector(map(min, mn, w))
            mx = Vector(map(max, mx, w))
    return mn, mx


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    make_materials()
    log("building parts")
    build_shell()
    build_side_panels()
    build_caps()
    build_blankets()
    build_front()
    build_top()
    build_belly()
    build_wing(1)
    build_wing(-1)
    for th in (45, 135, 225, 315):
        build_pod(th, "podL" if th == 45 else "body")
    build_main_engine()
    build_internals()
    log("parts:", {g: len(v) for g, v in PARTS.items()})
    body = union_group("body", "Body")
    loose = [union_group("wingL", "WingL"), union_group("podL", "PodL"), union_group("antL", "AntennaL"),
             union_group("mliL", "BlanketL")]
    # the loose blanket keeps the holes where the pod's strut and brace went through it
    u7, v7 = nrm(1), tng(1)
    holes = [bm_to_obj(bm_box_between(Vector((POD_X, 0, 0)) + u7 * (A - 0.05), Vector((POD_X, 0, 0)) + u7 * (A + 0.06),
                                      0.064, 0.064, v7, G), "hole1"),
             bm_to_obj(bm_box_between(Vector((POD_X + 0.20, 0, 0)) + u7 * (A - 0.05),
                                      Vector((POD_X + 0.17, 0, 0)) + u7 * (A + 0.06), 0.044, 0.044, v7, G), "hole2")]
    boolean(loose[3], holes, 'DIFFERENCE', label="blanket holes")
    allp = [body] + loose
    mn, mx = bbox(allp)
    log(f"bbox min {tuple(round(v, 3) for v in mn)} max {tuple(round(v, 3) for v in mx)} "
        f"size {tuple(round(v, 3) for v in (mx - mn))}")
    # UVs on the parts (shared map), before the debris cuts so fragments inherit them
    uv_unwrap(allp)
    # the whole drone
    drone = join(duplicate(body, "Drone_Body"), [duplicate(o, o.name + "_w") for o in loose])
    drone.name = drone.data.name = "Drone_Body"
    keep_materials(drone, [n for n in MAT_NAMES if n != "M_Metal_Torn"])
    if EXPORT_DIR or arg("--check-uv"):
        ov = uv_overlap_count(drone, 1024)
        log(f"UV overlap cells (1024 grid): {ov}")
    log(f"UV area used {100 * uv_area(drone):.1f}%")
    # debris from the parts
    frags = make_debris(body, loose)
    for o in [drone] + frags:
        shade(o)
    for f in frags:
        keep_materials(f, used_slots(f))
    tri_d = tris(drone)
    tri_f = sum(tris(f) for f in frags)
    log(f"triangles: drone {tri_d}, fragments {tri_f} ({len(frags)} pieces)")
    vol_whole = volume(drone)
    info = []
    for f in frags:
        nm, v = nonmanifold(f)
        c = centroid(f)
        mn, mx = bbox([f])
        info.append({"name": f.name, "triangles": tris(f), "volume_l": round(v * 1000, 3),
                     "centroid": [round(c.x, 3), round(c.y, 3), round(c.z, 3)],
                     "bbox_min": [round(a, 3) for a in mn], "bbox_max": [round(a, 3) for a in mx],
                     "non_manifold_edges": nm, "slots": used_slots(f)})
        log(f"  {f.name}: tris {tris(f):6d}  vol {v * 1000:8.3f} L  nonmanifold {nm}  centroid "
            f"{tuple(round(a, 2) for a in c)}  slots {used_slots(f)}")
    vsum = sum(i["volume_l"] for i in info) / 1000
    log(f"volume: whole {vol_whole * 1000:.3f} L, fragments {vsum * 1000:.3f} L ({100 * vsum / vol_whole:.1f}%)")
    # debris live in their own collection (hidden for renders of the whole drone)
    dc = bpy.data.collections.new("Debris")
    bpy.context.scene.collection.children.link(dc)
    for f in frags:
        for uc in list(f.users_collection):
            uc.objects.unlink(f)
        dc.objects.link(f)
    for o in allp:
        bpy.data.objects.remove(o, do_unlink=True)
    sockets = add_sockets(drone)
    if DO_BAKE:
        tex = os.path.join(os.path.abspath(EXPORT_DIR or HERE), "textures")
        os.makedirs(tex, exist_ok=True)
        dc.hide_render = True
        bake_ao(drone, os.path.join(tex, "T_Drone_AO.png"), TEX)
        bake_cavity(drone, os.path.join(tex, "T_Drone_Cavity.png"), TEX)
        dc.hide_render = False
    if EXPORT_DIR:
        ed = os.path.abspath(EXPORT_DIR)
        os.makedirs(ed, exist_ok=True)
        export_fbx([drone] + sockets, os.path.join(ed, "drone.fbx"))
        export_fbx(frags, os.path.join(ed, "drone_debris.fbx"))
        with open(os.path.join(ed, "drone_debris.json"), "w") as fh:
            json.dump({"note": "Fragments of drone.fbx; vertices in the drone's frame (metres, +X front, +Z up), "
                               "pivot at the drone origin. Centroid = centre of volume.",
                       "whole_volume_l": round(vol_whole * 1000, 3), "fragments": info}, fh, indent=1)
    if BLEND_OUT:
        dc.hide_viewport = False
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND_OUT))
        log("saved", BLEND_OUT)


if __name__ == "__main__":
    main()
