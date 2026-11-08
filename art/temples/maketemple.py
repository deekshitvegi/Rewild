# python maketemple.py -- <preset> <texture dir> <out dir> [quick] [nobake] [hi] [views=a,b] [samples=N]
#
# Temples and shrines for Haven, modelled from real buildings in metres and baked for the game.
# Presets: greek (Doric peripteral temple), torii (vermilion ryobu torii for shallow water), honden (nagare-zukuri
# shrine hall), lantern (Kasuga stone toro), nagara (rekha-deul / Khajuraho-manner temple).
#
# Each preset builds two versions of its building from the same parts: LO, the mesh the game draws (crisp bevelled
# geometry), and HI, the same plus the small carving (drum joints, guttae, ashlar joints, tile laps, petals...). HI is
# painted with node materials made from scanned textures (Poly Haven, CC0) and weathered from its own shape: grime in
# crevices (ambient occlusion), worn and chipped edges (the bevel shader against the true normal), rain streaks that
# run down from the top of each part, moss and lichen where water sits, a slight colour shift per part so no two
# columns or blocks match. That is baked onto LO through one atlas (colour with the occlusion in it, and a tangent-space
# normal map, Blender/OpenGL +Y), and LO is decimated to LOD1. Output: <out>/<name>.glb with meshes 'lod0' and 'lod1'
# and one material, plus Cycles renders under Haven-like light. Y up, front facing +Z (Blender -Y), origin at the
# centre of the base, metres.
#
# Options: quick (small atlas, few samples, small renders), nobake (render HI with its node materials, no GLB),
# hi (also render HI next to the baked result), views=... (only these renders), samples=N (render samples).
import bpy, bmesh, math, random, sys, os, time
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
PRESET, TEX, OUT = argv[0], argv[1], argv[2]
OPTS = argv[3:]
QUICK = 'quick' in OPTS
NOBAKE = 'nobake' in OPTS
SHOW_HI = 'hi' in OPTS
ONLY_VIEWS = next((o.split('=')[1].split(',') for o in OPTS if o.startswith('views=')), None)
RENDER_SAMPLES = next((int(o.split("=")[1]) for o in OPTS if o.startswith("samples=")), 24 if QUICK else 64)
os.makedirs(OUT, exist_ok=True)
TAU = 2 * math.pi
rnd = random.Random(7)          # shapes
PARTRND = random.Random(1234)   # per-part colour variation

# ---------------------------------------------------------------------------------------------------------------
# Settings per preset: file name, atlas size, LOD1 share of LOD0's triangles, smoothing angle, bake cage.
SETTINGS = {
    'greek':   dict(name='temple-greek', atlas=2048, lod1=0.1, sharp=34, cage=0.05, ray=0.14),
    'torii':   dict(name='shrine-torii', atlas=1024, lod1=0.12, sharp=40, cage=0.03, ray=0.08),
    'honden':  dict(name='shrine-honden', atlas=2048, lod1=0.1, sharp=36, cage=0.03, ray=0.08),
    'lantern': dict(name='shrine-lantern', atlas=1024, lod1=0.12, sharp=38, cage=0.012, ray=0.03),
    'nagara':  dict(name='temple-nagara', atlas=2048, lod1=0.1, sharp=34, cage=0.07, ray=0.16),
    'hanging': dict(name='shrine-lantern-hanging', atlas=1024, lod1=0.15, sharp=38, cage=0.01, ray=0.03),
    'bridge':  dict(name='shrine-bridge', atlas=1024, lod1=0.12, sharp=38, cage=0.03, ray=0.08),
    'pagoda':  dict(name='shrine-pagoda', atlas=2048, lod1=0.1, sharp=36, cage=0.04, ray=0.1),
    'gate':    dict(name='shrine-gate', atlas=2048, lod1=0.1, sharp=36, cage=0.04, ray=0.1),
    'kund':    dict(name='temple-kund', atlas=2048, lod1=0.1, sharp=34, cage=0.05, ray=0.12),
}
CFG = SETTINGS[PRESET]
ATLAS = 512 if QUICK and CFG['atlas'] <= 1024 else (1024 if QUICK else CFG['atlas'])
BAKE_SAMPLES = 6 if QUICK else 12

# ---------------------------------------------------------------------------------------------------------------
# Geometry: parts go into LO (what the game draws), HI (what is baked) or both. Every part keeps its material key,
# a random value (colour variation), the height of its top (where rain streaks start) and its grain axis (wood).
class Acc:
    def __init__(self):
        self.v, self.f, self.fm, self.fv, self.fa, self.vt, self.fx = [], [], [], [], [], [], []

    def add(self, verts, faces, mat, var, top, axis, auto=False):
        if not faces:
            return
        base = len(self.v)
        self.v.extend(verts)
        t = max(p[2] for p in verts) if top is None else top
        self.vt.extend([t] * len(verts))
        for f in faces:
            self.f.append(tuple(base + i for i in f)); self.fm.append(mat); self.fv.append(var); self.fa.append(axis)
            self.fx.append(auto)

LO, HI = Acc(), Acc()

def put(geo, mat, where='both', var=None, top=None, axis=0, xf=None, auto=False):
    """auto: a closed part whose faces may point the wrong way; they are turned outward once built. Everything else
    is built facing out by construction (profiles walk with the solid on their left)."""
    verts, faces = geo
    if xf is not None:
        verts = [tuple(xf @ Vector(p)) for p in verts]
        if xf.to_3x3().determinant() < 0:
            faces = [tuple(reversed(f)) for f in faces]
    if var is None:
        var = PARTRND.random()
    if where in ('both', 'lo'):
        LO.add(verts, faces, mat, var, top, axis, auto)
    if where in ('both', 'hi'):
        HI.add(verts, faces, mat, var, top, axis, auto)

def merge(*geos):
    verts, faces = [], []
    for v, f in geos:
        b = len(verts); verts.extend(v); faces.extend(tuple(b + i for i in face) for face in f)
    return verts, faces

def loft(rings, cap0=True, cap1=True, closed=True, split=False):
    """Quads between rings of equal length (CCW seen from above, bottom to top: faces point out). A ring that is a
    single point makes a cone tip. split: each side between two ring points becomes its own strip, so a moulding
    round a whole building unwraps as straight strips, not as one ring-shaped island with nothing inside it."""
    if split and closed and all(len(r) == len(rings[0]) for r in rings):
        verts, faces = [], []
        n = len(rings[0])
        for k in range(n):
            base = len(verts)
            for r in rings:
                verts.append(r[k]); verts.append(r[(k + 1) % n])
            for i in range(len(rings) - 1):
                a = base + 2 * i
                faces.append((a, a + 1, a + 3, a + 2))
        for ring, use, rev in ((rings[0], cap0, True), (rings[-1], cap1, False)):
            if use and len(ring) > 2:
                s0 = len(verts); verts.extend(ring)
                f = tuple(range(s0, s0 + len(ring)))
                faces.append(tuple(reversed(f)) if rev else f)
        return verts, faces
    verts, faces, idx = [], [], []
    for r in rings:
        start = len(verts); verts.extend(r); idx.append((start, len(r)))
    for (a0, na), (b0, nb) in zip(idx, idx[1:]):
        if na == nb:
            m = na if closed else na - 1
            for k in range(m):
                faces.append((a0 + k, a0 + (k + 1) % na, b0 + (k + 1) % na, b0 + k))
        elif nb == 1:
            for k in range(na):
                faces.append((a0 + k, a0 + (k + 1) % na, b0))
        elif na == 1:
            for k in range(nb):
                faces.append((a0, b0 + (k + 1) % nb, b0 + k))
    if closed:
        s, n = idx[0]
        if cap0 and n > 2:
            faces.append(tuple(reversed(range(s, s + n))))
        s, n = idx[-1]
        if cap1 and n > 2:
            faces.append(tuple(range(s, s + n)))
    return verts, faces

def lathe(profile, segs, rfun=None, a0=0.0, cap0=True, cap1=True):
    """A turned shape: profile [(r, z)] from bottom to top along the outer surface; rfun(theta, z, r, i) reshapes
    the radius (flutes, petals). r = 0 at an end closes it to a point."""
    rings = []
    for i, (r, z) in enumerate(profile):
        if r <= 1e-6:
            rings.append([(0.0, 0.0, z)]); continue
        ring = []
        for k in range(segs):
            th = a0 + TAU * k / segs
            rr = rfun(th, z, r, i) if rfun else r
            ring.append((rr * math.cos(th), rr * math.sin(th), z))
        rings.append(ring)
    return loft(rings, cap0, cap1)

def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

def ngon(n, r_flat, a0=0.0):
    rc = r_flat / math.cos(math.pi / n)
    return [(rc * math.cos(a0 + TAU * k / n), rc * math.sin(a0 + TAU * k / n)) for k in range(n)]

def chamfer_poly(poly, c):
    out = []
    n = len(poly)
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        out.append(tuple(p1 + (p0 - p1).normalized() * c)); out.append(tuple(p1 + (p2 - p1).normalized() * c))
    return out

def offset_poly(poly, d):
    """Move every edge of a CCW polygon outward by d (mitred corners)."""
    n = len(poly); out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e1 = (p1 - p0).normalized(); e2 = (p2 - p1).normalized()
        n1 = Vector((e1.y, -e1.x)); n2 = Vector((e2.y, -e2.x))
        m = (n1 + n2) / (1 + n1.dot(n2))
        out.append((p1.x + m.x * d, p1.y + m.y * d))
    return out

def ring_at(poly, z, scale=1.0, dx=0.0, dy=0.0):
    return [(p[0] * scale + dx, p[1] * scale + dy, z) for p in poly]

def stack(poly, profile, cap0=True, cap1=True):
    """A moulded plinth: the plan polygon offset by o at height z for each (o, z) of the profile, bottom to top."""
    return loft([ring_at(offset_poly(poly, o), z) for o, z in profile], cap0, cap1, split=True)

def cprism(poly, z0, z1, b=0.0, cap0=True, cap1=True):
    """A prism with its top and bottom edges chamfered by b."""
    if b <= 0:
        return stack(poly, [(0, z0), (0, z1)], cap0, cap1)
    return stack(poly, [(-b, z0), (0, z0 + b), (0, z1 - b), (-b, z1)], cap0, cap1)

def box(x0, y0, z0, x1, y1, z1, b=0.0, cap0=True, cap1=True):
    """A block with all its edges chamfered by b."""
    poly = rect(x0, y0, x1, y1)
    if b > 0:
        poly = chamfer_poly(poly, b)
    return cprism(poly, z0, z1, b, cap0, cap1)

def put_small_box(x0, y0, z0, x1, y1, z1, b, mat, xf=None, **kw):
    """A small block: plain (12 triangles) in LO, chamfered in HI (the bevel comes back through the normal map)."""
    put(box(x0, y0, z0, x1, y1, z1, 0.0), mat, 'lo', xf=xf, **kw)
    put(box(x0, y0, z0, x1, y1, z1, b), mat, 'hi', xf=xf, **kw)

def frame_of(t, up_hint=Vector((0, 0, 1))):
    """Side and up vectors across a path heading t: a profile (x, y) laid on (side, up) runs CCW seen from ahead."""
    t = t.normalized()
    s = up_hint.cross(t)
    if s.length < 1e-6:
        s = Vector((0, 1, 0)).cross(t)
    s.normalize(); u = t.cross(s).normalized()
    return s, u

def sweep(path, profile, cap0=True, cap1=True, up_hint=Vector((0, 0, 1)), scales=None):
    """A profile [(x, y)] (CCW, y up) carried along a path of points; x runs along the side vector, y along up.
    scales: a factor per path point."""
    rings = []
    n = len(path)
    for i, p in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(i + 1, n - 1)]) - Vector(path[max(i - 1, 0)]))
        s, u = frame_of(t, up_hint)
        k = scales[i] if scales else 1.0
        rings.append([tuple(p + s * (x * k) + u * (y * k)) for x, y in profile])
    # Rings must run CCW when seen looking back along the path: flip if needed.
    v, f = loft(rings, cap0, cap1)
    return v, f

def circle2d(r, n, a0=0.0):
    return [(r * math.cos(a0 + TAU * k / n), r * math.sin(a0 + TAU * k / n)) for k in range(n)]

def tube(path, radii, n=8, cap0=True, cap1=True, up_hint=Vector((0, 0, 1))):
    rings = []
    m = len(path)
    for i, p in enumerate(path):
        p = Vector(p)
        t = Vector(path[min(i + 1, m - 1)]) - Vector(path[max(i - 1, 0)])
        s, u = frame_of(t, up_hint)
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        rings.append([tuple(p + s * (r * math.cos(TAU * k / n)) + u * (r * math.sin(TAU * k / n))) for k in range(n)])
    v, f = loft(rings, cap0, cap1)
    # Rings around a path are CCW looking back along it when t x s ... make faces point out:
    c = Vector(path[len(path) // 2]); fix = []
    for face in f:
        if len(face) == 4:
            a, b, d = Vector(v[face[0]]), Vector(v[face[1]]), Vector(v[face[3]])
            nrm = (b - a).cross(d - a)
            centre = (a + b) / 2
            # nearest path point
            q = min(path, key=lambda pp: (Vector(pp) - centre).length)
            if nrm.dot(centre - Vector(q)) < 0:
                face = tuple(reversed(face))
        fix.append(face)
    return v, fix

def rot_z(a):
    return Matrix.Rotation(a, 4, 'Z')

def tr(x, y, z):
    return Matrix.Translation((x, y, z))

def panel(o0, o1, i0, i1, z0, z1, hole=None):
    """A wall panel between two outer corners o0 -> o1 (CCW) and the matching inner corners, with an optional
    rectangular hole (u0, u1, v0, v1 as shares of the outer face). Outer and inner faces and the hole's reveals."""
    o0, o1, i0, i1 = Vector((*o0, 0)), Vector((*o1, 0)), Vector((*i0, 0)), Vector((*i1, 0))
    up = Vector((0, 0, 1))
    def P(base0, base1, u, z):
        return tuple(base0.lerp(base1, u) + up * z)
    verts, faces = [], []
    def add(pts):
        s = len(verts); verts.extend(pts); return list(range(s, s + len(pts)))
    if hole is None:
        a = add([P(o0, o1, 0, z0), P(o0, o1, 1, z0), P(o0, o1, 1, z1), P(o0, o1, 0, z1)])
        faces.append(tuple(a))
        b = add([P(i0, i1, 0, z0), P(i0, i1, 1, z0), P(i0, i1, 1, z1), P(i0, i1, 0, z1)])
        faces.append(tuple(reversed(b)))
        return verts, faces
    u0, u1, v0, v1 = hole
    h0, h1 = z0 + (z1 - z0) * v0, z0 + (z1 - z0) * v1
    n = (o1 - o0).cross(up).normalized()
    t = (o0 - i0).dot(n)
    O = add([P(o0, o1, 0, z0), P(o0, o1, 1, z0), P(o0, o1, 1, z1), P(o0, o1, 0, z1)])
    H = add([P(o0, o1, u0, h0), P(o0, o1, u1, h0), P(o0, o1, u1, h1), P(o0, o1, u0, h1)])
    for k in range(4):
        faces.append((O[k], O[(k + 1) % 4], H[(k + 1) % 4], H[k]))
    Hi = add([tuple(Vector(verts[h]) - n * t) for h in H])
    # inner face: frame between the inner rectangle and the inner hole
    I = add([P(i0, i1, 0, z0), P(i0, i1, 1, z0), P(i0, i1, 1, z1), P(i0, i1, 0, z1)])
    for k in range(4):
        faces.append(tuple(reversed((I[k], I[(k + 1) % 4], Hi[(k + 1) % 4], Hi[k]))))
    for k in range(4):
        faces.append((H[k], H[(k + 1) % 4], Hi[(k + 1) % 4], Hi[k]))
    return verts, faces

# ---------------------------------------------------------------------------------------------------------------
# Kasuga-style stone lantern (toro), granite, about 2.1 m. Hexagonal with a flat side to the front (-Y).
LANTERN = dict(
    base_flat=0.40, base_h=0.15,           # kiso plinth: across flats / 2, height above ground
    cushion=(0.33, 0.12, 12),             # kaeribana: radius, height, petals (turned down)
    shaft=(0.125, 0.105, 0.74),           # sao: radius at foot and top, height
    deck_flat=0.31, deck_h=0.075,         # chudai rim: across flats / 2, height
    lotus=(0.13, 0.27, 0.13, 16),         # chudai lotus: radius at foot, at rim, height, petals
    box_flat=0.20, box_h=0.35, wall=0.045,# hibukuro: across flats / 2, height, wall thickness
    roof_flat=0.40, roof_rise=0.21, eave=0.048, lift=0.05,
)

def petals(n, amp, sharp=0.6, phase=0.0):
    def f(th, z, r, i, a=amp):
        u = ((th * n / TAU + phase) % 1.0) * 2 - 1
        return r + a(z) * (max(0.0, math.cos(u * math.pi / 2)) ** sharp)
    return f

def build_lantern():
    P = LANTERN
    S = 'granite'
    hexa = lambda rf: ngon(6, rf)
    # kiso: a hexagonal plinth sunk 6 cm into the ground, then the turned-down lotus cushion
    put(cprism(chamfer_poly(hexa(P['base_flat']), 0.012), -0.06, P['base_h'], 0.012, cap0=False), S)
    z = P['base_h']
    R, H, N = P['cushion']
    prof = [(R * 0.86, z), (R * 0.97, z + H * 0.12), (R, z + H * 0.3), (R * 0.95, z + H * 0.55), (R * 0.8, z + H * 0.78),
            (R * 0.6, z + H * 0.93), (R * 0.45, z + H)]
    amp = lambda zz: 0.022 * max(0.0, 1 - abs((zz - (z + H * 0.35)) / (H * 0.6)))
    put(lathe(prof, N * 8, petals(N, amp, 0.5), cap0=False), S)
    z += H
    # sao: round shaft with a collar at each end and the three-ringed node (fushi) at mid height
    r0, r1, h = P['shaft']
    def collar(zc, r, hh):
        return [(r, zc), (r + 0.012, zc + 0.006), (r + 0.012, zc + hh - 0.006), (r, zc + hh)]
    prof = [(r0 + 0.03, z), (r0 + 0.03, z + 0.02), (r0 + 0.012, z + 0.035), (r0, z + 0.05)]
    zm = z + h * 0.5
    prof += [(r0 + (r1 - r0) * 0.45, zm - 0.06)]
    prof += [(r0 + (r1 - r0) * 0.5 + 0.014, zm - 0.05), (r0 + (r1 - r0) * 0.5 + 0.014, zm - 0.03),
             (r0 + (r1 - r0) * 0.5 + 0.004, zm - 0.022), (r0 + (r1 - r0) * 0.5 + 0.02, zm - 0.012),
             (r0 + (r1 - r0) * 0.5 + 0.02, zm + 0.012), (r0 + (r1 - r0) * 0.5 + 0.004, zm + 0.022),
             (r0 + (r1 - r0) * 0.5 + 0.014, zm + 0.03), (r0 + (r1 - r0) * 0.5 + 0.014, zm + 0.05)]
    prof += [(r0 + (r1 - r0) * 0.55, zm + 0.06), (r1, z + h - 0.05), (r1 + 0.012, z + h - 0.035), (r1 + 0.026, z + h - 0.015), (r1 + 0.026, z + h)]
    put(lathe(prof, 40, cap0=False, cap1=False), S)
    z += h
    # chudai: lotus cup opening upward under a hexagonal deck
    ra, rb, hl, n = P['lotus']
    prof = [(ra, z), (ra + 0.02, z + 0.01), (ra + (rb - ra) * 0.45, z + hl * 0.35), (rb * 0.93, z + hl * 0.7), (rb, z + hl)]
    amp2 = lambda zz: 0.03 * max(0.0, min(1.0, (zz - z) / (hl * 0.5))) * (1 if zz < z + hl * 0.98 else 0.4)
    put(lathe(prof, n * 6, petals(n, amp2, 0.45), cap0=False, cap1=False), S)
    put(lathe(prof, n * 6, petals(n, amp2, 0.45, 0.5), cap0=False, cap1=False), S, 'hi')
    z += hl
    put(cprism(chamfer_poly(hexa(P['deck_flat']), 0.01), z, z + P['deck_h'], 0.012, cap0=True), S)
    z += P['deck_h']
    put(cprism(chamfer_poly(hexa(P['box_flat'] + 0.035), 0.006), z, z + 0.03, 0.006, cap0=False), S)
    z += 0.03
    # hibukuro: six walls round a hollow fire chamber; the windows face front and back
    zb0, zb1 = z, z + P['box_h']
    outer = hexa(P['box_flat']); inner = hexa(P['box_flat'] - P['wall'])
    for k in range(6):
        mid = (Vector(outer[k]) + Vector(outer[(k + 1) % 6])) / 2
        ang = math.atan2(mid.y, mid.x)
        front = abs(math.sin(ang)) > 0.99
        hole = (0.2, 0.8, 0.22, 0.86) if front else None
        put(panel(outer[k], outer[(k + 1) % 6], inner[k], inner[(k + 1) % 6], zb0, zb1, hole), S)
        if not front:
            # carved sun and moon on the closed walls (baked only)
            n_out = Vector((math.cos(ang), math.sin(ang), 0))
            c = mid.to_3d() + Vector((0, 0, (zb0 + zb1) / 2)) + n_out * 0.002
            m = Matrix.Translation(c) @ (Vector((0, 0, 1)).rotation_difference(n_out)).to_matrix().to_4x4()
            if k % 2 == 0:
                put(lathe([(0.05, 0.0), (0.05, 0.006), (0.046, 0.01), (0.0, 0.01)], 24, cap0=False), S, 'hi', xf=m)
            else:
                cres = [(0.05 * math.cos(a), 0.05 * math.sin(a)) for a in [math.radians(d) for d in range(40, 330, 15)]]
                cres += [(0.012 + 0.04 * math.cos(a), 0.04 * math.sin(a)) for a in [math.radians(d) for d in range(310, 50, -15)]]
                put(stack(cres, [(0, 0.0), (0, 0.01)], cap0=False), S, 'hi', xf=m, auto=True)
    # corner posts, standing a little proud of the walls
    for k in range(6):
        c = Vector(outer[k]) * 1.0
        a = math.atan2(c.y, c.x)
        post = box(-0.022, -0.022, zb0, 0.022, 0.022, zb1, 0.005, cap0=False, cap1=False)
        put(post, S, xf=tr(c.x, c.y, 0) @ rot_z(a + math.pi / 4))
    put(cprism(chamfer_poly(hexa(P['box_flat'] - P['wall'] + 0.002), 0.004), zb0 - 0.001, zb0 + 0.004, 0.0, cap0=False), S)
    # the chamber's ceiling
    put(cprism(hexa(P['box_flat'] - 0.002), zb1 - 0.004, zb1, 0.0, cap0=True, cap1=False), S)
    z = zb1
    # kasa: the roof, hexagonal, concave, its corners lifted into curled sprouts (warabite)
    Re = P['roof_flat'] / math.cos(math.pi / 6)
    sub = 8
    def roof_ring(r_corner, zz, lift, ridge):
        pts = []
        for k in range(6):
            a0, a1 = TAU * k / 6, TAU * (k + 1) / 6
            c0 = Vector((math.cos(a0), math.sin(a0))) * r_corner; c1 = Vector((math.cos(a1), math.sin(a1))) * r_corner
            for j in range(sub):
                s = j / sub
                p = c0.lerp(c1, s)
                edge = abs(s - 0.5) * 2
                pts.append((p.x, p.y, zz + lift * edge ** 3 + (ridge if j == 0 else 0.0)))
        return pts
    soffit_in = [(p[0], p[1], z) for p in roof_ring(P['box_flat'] / math.cos(math.pi / 6) + 0.01, 0, 0, 0)]
    ze = z + 0.03
    rings = [soffit_in, roof_ring(Re, ze, P['lift'], 0), roof_ring(Re, ze + P['eave'], P['lift'], 0)]
    top_r, rise = 0.11, P['roof_rise']
    steps = 9
    for i in range(1, steps + 1):
        t = i / steps
        rings.append(roof_ring(Re + (top_r - Re) * t, ze + P['eave'] + rise * t ** 1.7, P['lift'] * (1 - t) ** 2, 0.012 * (1 - t) if i < steps else 0))
    put(loft(rings, cap0=False, cap1=True), S)
    # warabite: at each corner the ridge rises and rolls outward into a bracken-shoot curl
    for k in range(6):
        a = TAU * k / 6
        d = Vector((math.cos(a), math.sin(a), 0))
        root = d * (Re - 0.03) + Vector((0, 0, ze + P['eave'] + P['lift'] - 0.006))
        centre = root + d * 0.012 + Vector((0, 0, 0.03))
        pts, rad = [], []
        steps = 14
        for j in range(steps + 1):
            t = j / steps
            ph = math.radians(215 - 320 * t)           # clockwise in the (outward, up) plane
            rr = 0.032 * (1 - 0.6 * t)
            pts.append(tuple(centre + d * (rr * math.cos(ph)) + Vector((0, 0, rr * math.sin(ph)))))
            rad.append(0.019 * (1 - 0.5 * t))
        put(tube(pts, rad, 10, up_hint=Vector((-d.y, d.x, 0))), S, auto=True)
    z = ze + P['eave'] + rise
    # hoju: lotus cup and the pointed jewel
    put(lathe([(0.1, z - 0.01), (0.105, z + 0.012), (0.075, z + 0.03), (0.055, z + 0.04)], 32, cap0=False, cap1=True), S)
    z += 0.04
    amp3 = lambda zz: 0.016 * max(0.0, min(1.0, (zz - z) / 0.04))
    put(lathe([(0.04, z), (0.06, z + 0.02), (0.085, z + 0.045), (0.09, z + 0.055)], 48, petals(8, amp3, 0.5), cap0=False), S)
    z += 0.055
    jewel = [(0.035, z), (0.07, z + 0.03), (0.084, z + 0.06), (0.078, z + 0.09), (0.058, z + 0.115), (0.032, z + 0.135),
             (0.012, z + 0.155), (0.0, z + 0.172)]
    put(lathe(jewel, 32, cap0=False), S)


# ---------------------------------------------------------------------------------------------------------------
# Torii: a vermilion myojin torii in the four-legged ryobu form, made to stand in shallow water (after Itsukushima,
# smaller). The kasagi runs along X; front is -Y. Main pillars lean inward (uchikorobi).
TORII = dict(
    span=9.0,            # main pillar centres
    pillar=(0.7, 0.63),  # main pillar radius at foot and top
    height=10.4,         # foot to the underside of the shimaki at the pillars
    lean=0.16,           # each pillar top moves this far inward
    kasagi=(16.8, 0.72, 0.34),  # length, sori (rise at the tips), end slant
    shimaki=(13.6, 0.62),       # length, depth
    nuki=(12.6, 7.9, 0.86, 0.5),# length, centre height, height, thickness
    sleeve=1.5,          # black base sleeve (nemaki) height
    ryobu=(2.8, 0.36, 6.6),     # sode-bashira distance fore and aft, radius, height
    algae=1.15,          # top of the tide band
)

def xloft(xs, profile, zf=lambda x: 0.0, cap0=True, cap1=True, slant=0.0):
    """A beam along +X whose section [(y, h)] (CCW, y right, h up, seen from +X) stays plumb and rides z = zf(x).
    slant: the end faces lean out so the top runs this much further than the bottom."""
    hs = [h for _, h in profile]; h0, h1 = min(hs), max(hs)
    rings = []
    for i, x in enumerate(xs):
        ring = []
        for y, h in profile:
            xx = x
            if i == 0:
                xx = x - slant * (h - h0) / (h1 - h0)
            elif i == len(xs) - 1:
                xx = x + slant * (h - h0) / (h1 - h0)
            ring.append((xx, y, zf(x) + h))
        rings.append(ring)
    return loft(rings, cap0, cap1)

def yloft(ys, profile, zf=lambda y: 0.0, cap0=True, cap1=True):
    """A beam along +Y, section [(x, h)] CCW in (x, h) as for xloft (reversed here: seen from +Y, x runs left)."""
    rings = [[(x, y, zf(y) + h) for x, h in reversed(profile)] for y in ys]
    return loft(rings, cap0, cap1)

def cham_rect(w, h0, h1, c):
    """A chamfered rectangle section, half-width w, from h0 to h1, CCW."""
    return [(-w + c, h0), (w - c, h0), (w, h0 + c), (w, h1 - c), (w - c, h1), (-w + c, h1), (-w, h1 - c), (-w, h0 + c)]

def spaced(a, b, n, ends=2.2):
    """n+1 positions from a to b, closer together toward both ends (where a curve bends most)."""
    out = []
    for i in range(n + 1):
        t = i / n
        u = 0.5 - 0.5 * math.cos(math.pi * t) if ends else t
        out.append(a + (b - a) * (0.65 * t + 0.35 * u))
    return out

def shear_x(s):
    m = Matrix.Identity(4); m[0][2] = s; return m

def build_torii():
    P = TORII
    L, B, G = 'lacquer', 'black', 'gold'
    half = P['span'] / 2
    r0, r1 = P['pillar']
    Lk, sori, slant = P['kasagi']
    sori_f = lambda x: sori * (abs(x) / (Lk / 2)) ** 2.6
    zk = P['height'] + P['shimaki'][1] - sori_f(half)        # underside of the kasagi at x = 0
    zf = lambda x: zk + sori_f(x)
    # kasagi: the vermilion beam and its black roof, plumb sections riding the upturned curve
    xs = spaced(-Lk / 2, Lk / 2, 30)
    put(xloft(xs, cham_rect(0.46, 0.0, 0.56, 0.025), zf, slant=slant), L, axis=1)
    cap = [(-0.51, 0.56), (0.51, 0.56), (0.525, 0.59), (0.525, 0.66), (0.33, 0.74), (0.13, 0.785), (0.0, 0.795), (-0.13, 0.785),
           (-0.33, 0.74), (-0.525, 0.66), (-0.525, 0.59)]
    put(xloft(xs, cap, zf, slant=slant + 0.04), B, axis=1)
    # shimaki: the lower lintel under the kasagi
    Ls, ds = P['shimaki']
    xs2 = spaced(-Ls / 2, Ls / 2, 26)
    put(xloft(xs2, cham_rect(0.36, -ds, 0.0, 0.025), zf, slant=0.12), L, axis=1)
    # main pillars (hashira), leaning in, with the black sleeve at the foot and the daiwa ring at the top
    H = P['height']
    for sgn in (-1, 1):
        lean = -sgn * P['lean'] / H
        m = tr(sgn * half, 0, 0) @ shear_x(lean)
        top = H + 0.25
        prof = [(r0, 0.0), (r0 - (r0 - r1) * 0.35, H * 0.35), (r0 - (r0 - r1) * 0.7, H * 0.7), (r1, top)]
        put(lathe(prof, 44, cap0=False, cap1=False), L, xf=m, top=H)
        sl = P['sleeve']
        put(lathe([(r0 + 0.055, -0.02), (r0 + 0.055, sl - 0.1), (r0 + 0.045, sl - 0.045), (r0 + 0.025, sl - 0.01), (r0 + 0.0, sl)], 44, cap0=False, cap1=False), B, xf=m)
        put(lathe([(r0 + 0.06, sl - 0.3), (r0 + 0.07, sl - 0.28), (r0 + 0.07, sl - 0.25), (r0 + 0.06, sl - 0.23)], 44, cap0=False, cap1=False), B, 'hi', xf=m)
        dz = H - 0.42
        rd = r1 + 0.075
        put(lathe([(r1, dz - 0.02), (rd - 0.02, dz), (rd, dz + 0.03), (rd, dz + 0.36), (rd - 0.015, dz + 0.42), (r1, dz + 0.42)], 44, cap0=False, cap1=False), L, xf=m)
        # kusabi: wedge through the nuki on the outer face of the pillar
        Ln, zn, hn, tn = P['nuki']
        px = sgn * half + lean * zn
        put(box(-0.085, -0.25, zn - hn / 2 - 0.06, 0.085, 0.25, zn + hn / 2 + 0.14, 0.015), L, xf=tr(px + sgn * (r0 + 0.07), 0, 0), axis=0)
        # ryobu: a sode-bashira fore and aft, each tied to the main pillar by two beams and capped by a small roof
        dy, rr, hh = P['ryobu']
        for fy in (-1, 1):
            cx, cy = sgn * half, fy * dy
            put(lathe([(rr, 0.0), (rr * 0.94, hh)], 32, cap0=False, cap1=True), L, xf=tr(cx, cy, 0))
            put(lathe([(rr + 0.045, -0.02), (rr + 0.045, 1.0), (rr + 0.03, 1.05), (rr, 1.07)], 32, cap0=False, cap1=False), B, xf=tr(cx, cy, 0))
            for zt in (3.5, 6.05):
                y0, y1 = (0.0, fy * (dy + rr + 0.38))
                ys = sorted((y0, y1))
                prof = [(-0.13, -0.16), (0.13, -0.16), (0.14, -0.145), (0.14, 0.145), (0.13, 0.16), (-0.13, 0.16), (-0.14, 0.145), (-0.14, -0.145)]
                put(yloft(ys, prof, lambda y, zt=zt: zt), L, xf=tr(cx + lean * zt * 0.5, 0, 0), axis=2)
            # the little roof
            a = 0.5
            z0 = hh - 0.02
            rings = [ring_at(rect(-a + 0.06, -a + 0.06, a - 0.06, a - 0.06), z0), ring_at(rect(-a, -a, a, a), z0 + 0.03),
                     ring_at(rect(-a, -a, a, a), z0 + 0.1), ring_at(rect(-0.12, -0.12, 0.12, 0.12), z0 + 0.42),
                     ring_at(rect(-0.07, -0.07, 0.07, 0.07), z0 + 0.47)]
            put(loft(rings, cap0=True, cap1=True), B, xf=tr(cx, cy, 0))
            put(lathe([(0.07, z0 + 0.47), (0.08, z0 + 0.5), (0.05, z0 + 0.56), (0.0, z0 + 0.58)], 16, cap0=False), G, xf=tr(cx, cy, 0))
    # nuki: the tie beam through both pillars, its ends running past them
    Ln, zn, hn, tn = P['nuki']
    put(box(-Ln / 2, -tn / 2, zn - hn / 2, Ln / 2, tn / 2, zn + hn / 2, 0.025), L, axis=1)
    # gakuzuka: the post between nuki and shimaki, with the plaque (gaku) on its face
    zt = zf(0) - ds
    put(box(-0.24, -0.2, zn + hn / 2 - 0.01, 0.24, 0.2, zt + 0.02, 0.02), L)
    pw, ph, pz = 1.04, 1.5, (zn + hn / 2 + zt) / 2 + 0.05
    tilt = Matrix.Translation((0, -0.2, pz)) @ Matrix.Rotation(math.radians(6), 4, 'X')
    put(box(-pw / 2, -0.12, -ph / 2, pw / 2, 0.0, ph / 2, 0.012), B, xf=tilt)
    fr = 0.085
    for (x0, z0_, x1, z1_) in [(-pw / 2, -ph / 2, pw / 2, -ph / 2 + fr), (-pw / 2, ph / 2 - fr, pw / 2, ph / 2),
                               (-pw / 2, -ph / 2 + fr, -pw / 2 + fr, ph / 2 - fr), (pw / 2 - fr, -ph / 2 + fr, pw / 2, ph / 2 - fr)]:
        put(box(x0, -0.155, z0_, x1, -0.11, z1_, 0.01), G, xf=tilt)
    # a carved inner border on the board (baked)
    inn = 0.16
    for (x0, z0_, x1, z1_) in [(-pw / 2 + inn, -ph / 2 + inn, pw / 2 - inn, -ph / 2 + inn + 0.025), (-pw / 2 + inn, ph / 2 - inn - 0.025, pw / 2 - inn, ph / 2 - inn),
                               (-pw / 2 + inn, -ph / 2 + inn, -pw / 2 + inn + 0.025, ph / 2 - inn), (pw / 2 - inn - 0.025, -ph / 2 + inn, pw / 2 - inn, ph / 2 - inn)]:
        put(box(x0, -0.13, z0_, x1, -0.115, z1_, 0.004), G, 'hi', xf=tilt)

# ---------------------------------------------------------------------------------------------------------------
# Honden: a three-bay nagare-zukuri shrine hall. A raised floor on posts with a veranda and railing, stairs under
# the long front slope of a cypress-bark (hiwadabuki) roof, vermilion frame, white walls, three pairs of doors,
# a copper ridge with katsuogi logs and crossed okichigi at the gable ends. Front is -Y.
HONDEN = dict(
    bays=(-2.7, -0.9, 0.9, 2.7),   # post lines across (x)
    front=-1.5, back=1.5,          # core wall lines (y)
    hisashi=-3.65,                 # front aisle post line (y)
    plat=(4.15, -4.75, 2.75, 0.32),# platform half-width, front y, back y, height
    floor=1.45,                    # floor level
    en=0.95,                       # veranda width
    wall_top=3.62,                 # head beam top
    ridge=(0.0, 5.61),             # ridge y, z (top of the roof surface)
    eave_f=(-5.0, 3.37),           # front eave edge y, z (top)
    eave_b=(3.0, 3.81),            # back eave edge y, z (top)
    roof_x=4.25,                   # roof half-length (gable overhang)
    thick=0.34,                    # eave edge thickness
)

def pchip(xs, ys):
    """Monotone cubic through the points (Fritsch-Carlson): no overshoot between them."""
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0 if d[i - 1] * d[i] <= 0 else 2 / (1 / d[i - 1] + 1 / d[i]) for i in range(1, n - 1)] + [d[-1]]
    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = max(0, min(n - 2, next(k for k in range(n - 1) if x <= xs[k + 1])))
        h = xs[i + 1] - xs[i]; t = (x - xs[i]) / h
        return (ys[i] * (2 * t ** 3 - 3 * t ** 2 + 1) + h * m[i] * (t ** 3 - 2 * t ** 2 + t)
                + ys[i + 1] * (-2 * t ** 3 + 3 * t ** 2) + h * m[i + 1] * (t ** 3 - t ** 2))
    return f

# The underside of the roof boards, through the purlins: the long front slope flattens toward its eave (the
# hisashi is pitched lower than the core), the back slope is short.
_UF = pchip([-5.0, -3.65, -1.5, 0.0], [3.03, 3.47, 4.34, 5.39])
_UB = pchip([0.0, 1.5, 3.0], [5.39, 4.34, 3.47])
def honden_under(y):
    return _UF(y) if y <= 0 else _UB(y)

def honden_thick(y):
    H = HONDEN
    e = min(y - H['eave_f'][0], H['eave_b'][0] - y)
    return 0.24 + 0.2 * max(0.0, 1 - e / 0.6) ** 1.5

def honden_roof_top(y):
    return honden_under(y) + honden_thick(y)

def build_honden():
    H = HONDEN
    L, W, P, K, C, G, S, D = 'lacquer', 'wood', 'plaster', 'bark', 'copper', 'gold', 'granite', 'darkwood'
    xs = H['bays']
    yf, yb, yh = H['front'], H['back'], H['hisashi']
    zf = H['floor']
    hw, pyf, pyb, ph = H['plat']
    # platform of dressed granite blocks, sunk a little into the ground
    put(box(-hw, pyf, -0.25, hw, pyb, ph, 0.03, cap0=False), S)
    for i, x in enumerate([-hw + 0.9 * k for k in range(1, int(2 * hw / 0.9) + 1)]):
        if x < hw - 0.2:
            put(box(x - 0.006, pyf - 0.004, -0.02, x + 0.006, pyb + 0.004, ph + 0.002, 0.0), S, 'hi', var=0.5)
    # foundation stones and posts
    def stone(x, y, r=0.2):
        put(lathe([(r + 0.03, ph - 0.01), (r + 0.03, ph + 0.05), (r + 0.01, ph + 0.1), (r - 0.01, ph + 0.11)], 20, cap0=False), S, xf=tr(x, y, 0))
    core = [(x, y) for x in xs for y in (yf, yb)] + [(x, 0.0) for x in (xs[0], xs[-1])]
    rp = 0.135
    for x, y in core:
        stone(x, y)
        put(lathe([(rp, ph + 0.11), (rp, H['wall_top'] + 0.02)], 24, cap0=False, cap1=False), L, xf=tr(x, y, 0), axis=0)
    for x in xs:
        stone(x, yh, 0.17)
        put(box(-0.105, -0.105, ph + 0.11, 0.105, 0.105, 3.03, 0.022, cap0=False), L, xf=tr(x, yh, 0))
    # veranda posts (short, under the floor edge)
    xe = xs[-1] + H['en']; ye = yf - H['en']
    en_posts = [(x, ye) for x in xs] + [(s * xe, y) for s in (-1, 1) for y in (yf, 0.0, yb)]
    for x, y in en_posts:
        stone(x, y, 0.13)
        put(box(-0.075, -0.075, ph + 0.11, 0.075, 0.075, zf - 0.14, 0.012, cap0=False), L, xf=tr(x, y, 0))
    # floor beams under the floor (koshi-nuki) and the edge beams of the veranda
    put(box(-xe - 0.06, ye - 0.06, zf - 0.32, xe + 0.06, ye + 0.08, zf - 0.13, 0.015), L, axis=1)
    for s in (-1, 1):
        put(box(s * xe - 0.07, ye - 0.06, zf - 0.32, s * xe + 0.07, yb + 0.08, zf - 0.13, 0.015), L, axis=2)
    put(box(xs[0], yf - 0.07, 0.95, xs[-1], yf + 0.07, 1.08, 0.012), L, axis=1)
    put(box(xs[0], yb - 0.07, 0.95, xs[-1], yb + 0.07, 1.08, 0.012), L, axis=1)
    # floor boards (core and veranda)
    put(box(-xe - 0.05, ye - 0.05, zf - 0.13, xe + 0.05, yb + 0.1, zf, 0.012), W, axis=2)
    for k in range(int((2 * xe + 0.1) / 0.24)):
        x = -xe - 0.05 + 0.24 * (k + 1)
        put(box(x - 0.004, ye - 0.06, zf - 0.004, x + 0.004, yb + 0.1, zf + 0.001, 0.0), W, 'hi', var=0.4)
    # walls: white plaster panels between the posts, three pairs of doors at the front
    wt = H['wall_top']
    def wall(x0, y0, x1, y1, z0, z1, mat=P, t=0.09):
        if abs(x1 - x0) > abs(y1 - y0):
            put(box(x0, y0 - t / 2, z0, x1, y0 + t / 2, z1, 0.008), mat, axis=1)
        else:
            put(box(x0 - t / 2, y0, z0, x0 + t / 2, y1, z1, 0.008), mat, axis=2)
    for s in (-1, 1):
        for y0, y1 in ((yf, 0.0), (0.0, yb)):
            wall(s * xs[-1], y0 + rp, s * xs[-1], y1 - rp, zf + 0.15, wt - 0.18)
    for x0, x1 in zip(xs, xs[1:]):
        wall(x0 + rp, yb, x1 - rp, yb, zf + 0.15, wt - 0.18)
        # doors: frame, two leaves with their battens and gold strap hinges
        put(box(x0 + rp, yf - 0.06, zf + 0.15, x1 - rp, yf + 0.06, zf + 0.25, 0.01), L, axis=1)
        put(box(x0 + rp, yf - 0.06, 3.0, x1 - rp, yf + 0.06, wt - 0.18, 0.01), P, axis=1)
        put(box(x0 + rp, yf - 0.07, 2.88, x1 - rp, yf + 0.07, 3.0, 0.01), L, axis=1)
        dw = (x1 - x0 - 2 * rp) / 2
        for j in range(2):
            lx0 = x0 + rp + j * dw
            put(box(lx0 + 0.01, yf - 0.035, zf + 0.25, lx0 + dw - 0.01, yf + 0.03, 2.88, 0.01), D, axis=0)
            for zz in (zf + 0.45, 2.62):
                put(box(lx0 + 0.04 if j == 0 else lx0 + dw * 0.35, yf - 0.05, zz, lx0 + dw * 0.65 if j == 0 else lx0 + dw - 0.04, yf - 0.03, zz + 0.07, 0.006), G, axis=1)
            for zz in (zf + 0.8, 1.95, 2.35):
                put(box(lx0 + 0.03, yf - 0.042, zz, lx0 + dw - 0.03, yf - 0.032, zz + 0.04, 0.004), D, 'hi')
            put(lathe([(0.035, 0.0), (0.04, 0.008), (0.0, 0.02)], 12, cap0=False), G,
                xf=tr(lx0 + (dw - 0.12 if j == 0 else 0.12), yf - 0.035, 1.85) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    # horizontal frame: ground sill, door-head tie and head beam (nageshi) round the core
    for z0, z1 in ((zf, zf + 0.15), (wt - 0.18, wt)):
        for y in (yf, yb):
            put(box(xs[0] - 0.05, y - 0.08, z0, xs[-1] + 0.05, y + 0.08, z1, 0.012), L, axis=1)
        for s in (-1, 1):
            put(box(s * xs[-1] - 0.08, yf - 0.05, z0, s * xs[-1] + 0.08, yb + 0.05, z1, 0.012), L, axis=2)
    # bracket sets on the core posts: bearing block and a boat-shaped arm under the purlin
    boat = [(-0.55, 0.0), (-0.42, -0.06), (-0.2, -0.13), (0.2, -0.13), (0.42, -0.06), (0.55, 0.0), (0.55, 0.06), (-0.55, 0.06)]
    for x in xs:
        for y in (yf, yb):
            put(box(x - 0.15, y - 0.15, wt, x + 0.15, y + 0.15, wt + 0.17, 0.015), L)
            prof = [(px, wt + 0.3 + pz) for px, pz in boat]
            rings = [[(x + px, y + dy, pz) for px, pz in prof] for dy in (-0.08, 0.08)]
            put(loft(rings, True, True), L, axis=1, auto=True)
    for y in (yf, yb):
        put(box(xs[0], y - 0.04, wt, xs[-1], y + 0.04, wt + 0.36, 0.0), P, axis=1)
    # purlins (keta) along the walls
    for y in (yf, yb):
        put(box(-H['roof_x'] + 0.55, y - 0.13, wt + 0.36, H['roof_x'] - 0.55, y + 0.13, wt + 0.62, 0.015), L, axis=1)
    # hisashi: tie beams on the front posts, and curved shrimp beams (ebi-koryo) up to the core posts
    put(box(xs[0] - 0.4, yh - 0.1, 2.78, xs[-1] + 0.4, yh + 0.1, 3.03, 0.015), L, axis=1)
    for x in xs:
        put(box(x - 0.13, yh - 0.13, 3.03, x + 0.13, yh + 0.13, 3.15, 0.012), L)
        path = []
        for k in range(9):
            t = k / 8
            yy = yh + (yf - yh) * t
            zz = 2.9 + (3.05 - 2.9) * t + 0.38 * math.sin(math.pi * t) ** 0.8
            path.append((x, yy, zz))
        put(sweep(path, cham_rect(0.08, -0.12, 0.12, 0.015)), L, axis=2)
    put(box(-H['roof_x'] + 0.4, yh - 0.12, 3.15, H['roof_x'] - 0.4, yh + 0.12, honden_under(yh) - 0.1, 0.015), L, axis=1)
    # roof: a thin curved shell of bark swept along x (the gables show only its edge)
    yr, zr = H['ridge']
    eyf, ezf = H['eave_f']; eyb, ezb = H['eave_b']
    th = H['thick']
    ys = spaced(eyf, yr, 16, ends=0) + spaced(yr, eyb, 10, ends=0)[1:]
    sec = [(y, honden_roof_top(y)) for y in ys] + [(y, honden_under(y)) for y in reversed(ys)]
    sec = sec[::-1]
    Rx = H['roof_x']
    put(xloft([-Rx, -Rx / 3, Rx / 3, Rx], sec), K, axis=2)
    # the layered eave edge (baked): thin courses stepping out, front and back, and down the gable ends
    for (ey, ez, sgn) in ((eyf, ezf, -1), (eyb, ezb, 1)):
        for j in range(7):
            zz = ez - th + j * th / 7
            put(box(-Rx - 0.004, ey - 0.02 + sgn * (0.012 + 0.004 * (j % 2)), zz + 0.004, Rx + 0.004, ey + sgn * (0.008 + 0.004 * (j % 2)), zz + th / 7 - 0.006, 0.003), K, 'hi', var=0.3)
    # rafters: two tiers (futanoki) under each eave, following the curve of the roof
    def rafters(y0, y1, drop, w=0.085, h=0.1):
        n = int((2 * (Rx - 0.25)) / 0.27)
        for k in range(n + 1):
            x = -(Rx - 0.25) + k * 2 * (Rx - 0.25) / n
            path = [(x, y, honden_under(y) - drop) for y in spaced(y0, y1, 6, ends=0)]
            put(sweep(path, cham_rect(w / 2, -h / 2, h / 2, 0.01)), L, axis=2)
    rafters(yf + 0.1, eyf + 0.42, 0.165)
    rafters(yh + 0.3, eyf + 0.04, 0.055, 0.08, 0.09)
    rafters(yb - 0.1, eyb - 0.42, 0.165)
    rafters(yb + 0.6, eyb - 0.04, 0.055, 0.08, 0.09)
    # boards closing the attic over the wall lines, behind the rafters
    for y, sg in ((yf, 1), (yb, -1)):
        put(box(xs[0] - 0.1, y + sg * 0.06 - 0.03, wt + 0.6, xs[-1] + 0.1, y + sg * 0.06 + 0.03, honden_under(y) + 0.02, 0.0), P, axis=1)
    # bargeboards (hafu) up the gable ends, following the roof, with a gold pendant (gegyo) at the apex
    for s in (-1, 1):
        path = [(s * (Rx + 0.04), y, honden_roof_top(y) + 0.06) for y in spaced(eyf - 0.05, eyb + 0.05, 26, ends=0)]
        put(sweep(path, cham_rect(0.045, -0.36, 0.0, 0.012), up_hint=Vector((0, 0, 1))), L, axis=2)
        put(box(-0.06, -0.28, zr - 0.62, 0.06, 0.28, zr - 0.18, 0.02), G, xf=tr(s * (Rx + 0.08), yr, 0))
        # the gable wall under the roof, over the side wall, with its tie beam and king post
        gx = s * xs[-1]
        rings = [[(gx - 0.045, y, wt), (gx + 0.045, y, wt), (gx + 0.045, y, honden_under(y) + 0.02), (gx - 0.045, y, honden_under(y) + 0.02)]
                 for y in spaced(yf, yb, 12, ends=0)]
        put(loft(rings, True, True), P, axis=2, auto=True)
        put(box(-0.07, yf, wt + 0.62, 0.07, yb, wt + 0.86, 0.01), L, xf=tr(gx + s * 0.03, 0, 0), axis=2)
        put(box(-0.06, -0.09, wt + 0.86, 0.06, 0.09, honden_under(0.0), 0.01), L, xf=tr(gx + s * 0.03, 0, 0))
    # ridge: copper cover, five katsuogi logs, crossed okichigi at each end
    rz = zr - 0.06
    put(xloft([-Rx + 0.1, Rx - 0.1], [(-0.2, 0.0), (0.2, 0.0), (0.22, 0.05), (0.2, 0.26), (0.12, 0.32), (-0.12, 0.32), (-0.2, 0.26), (-0.22, 0.05)],
              lambda x: rz, slant=0.0), C, axis=1)
    for x in (-2.4, -1.2, 0.0, 1.2, 2.4):
        z = rz + 0.32 + 0.12
        put(lathe([(0.0, -0.62), (0.13, -0.6), (0.135, -0.5), (0.13, 0.5), (0.135, 0.6), (0.0, 0.62)][::1], 16, cap0=False), W,
            xf=tr(x, yr, z) @ Matrix.Rotation(math.pi / 2, 4, 'X'), axis=2)
        for e in (-1, 1):
            put(lathe([(0.138, -0.09), (0.138, 0.09)], 16, cap0=False, cap1=False), G, xf=tr(x, yr + e * 0.52, z) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    for s in (-1, 1):
        for e in (-1, 1):
            m = tr(s * (Rx - 0.32), yr, rz + 0.2) @ Matrix.Rotation(e * math.radians(38), 4, 'X')
            put(box(-0.045, -0.11, 0.0, 0.045, 0.11, 1.55, 0.01), W, xf=m, axis=0)
            put(box(-0.048, -0.113, 1.38, 0.048, 0.113, 1.48, 0.008), G, xf=m)
    # veranda railing (koran): posts, three rails, giboshi caps at the ends by the stairs
    rail_h = 0.82
    def rail_run(p0, p1, n_posts, stop_posts=()):
        p0, p1 = Vector(p0), Vector(p1)
        axis = 1 if abs(p1.x - p0.x) > abs(p1.y - p0.y) else 2
        for k in range(n_posts + 1):
            p = p0.lerp(p1, k / n_posts)
            put(box(p.x - 0.045, p.y - 0.045, zf, p.x + 0.045, p.y + 0.045, zf + rail_h - 0.05, 0.008), L)
        for zz, rr in ((zf + rail_h - 0.02, 0.045), (zf + 0.45, 0.032), (zf + 0.1, 0.035)):
            put(tube([(p0.x, p0.y, zz), (p1.x, p1.y, zz)], rr, 10), L, axis=axis)
    sx = 0.82
    rail_run((-xe + 0.08, ye + 0.08), (-sx, ye + 0.08), 4)
    rail_run((sx, ye + 0.08), (xe - 0.08, ye + 0.08), 4)
    for s in (-1, 1):
        rail_run((s * (xe - 0.08), ye + 0.08), (s * (xe - 0.08), yb - 0.05), 5)
    def giboshi(x, y, z):
        put(lathe([(0.06, 0.0), (0.062, 0.05), (0.05, 0.065), (0.068, 0.11), (0.075, 0.15), (0.06, 0.2), (0.03, 0.235), (0.008, 0.27), (0.0, 0.28)],
                  20, cap0=False), G, xf=tr(x, y, z))
    for s in (-1, 1):
        put(lathe([(0.06, zf), (0.06, zf + rail_h + 0.02)], 16, cap0=False, cap1=True), L, xf=tr(s * sx, ye + 0.08, 0))
        giboshi(s * sx, ye + 0.08, zf + rail_h + 0.02)
    # stairs (kizahashi): six steps from the platform to the veranda, stringers, handrails ending in giboshi posts
    n = 6
    rise = (zf - ph) / (n + 1)
    tread = 0.27
    for k in range(n):
        z1 = ph + rise * (k + 1)
        y0 = ye - tread * (n - k)
        put(box(-0.75, y0, z1 - 0.06, 0.75, y0 + tread + 0.03, z1, 0.008), W, axis=1)
        put(box(-0.75, y0 + tread - 0.02, ph, 0.75, y0 + tread, z1 - 0.06, 0.006), W, axis=1)
    yfoot = ye - tread * n
    for s in (-1, 1):
        x = s * 0.8
        # stringer: a sloping board
        sl = [(x, yfoot - 0.06, ph), (x, ye + 0.02, zf - 0.02)]
        put(sweep(sl, cham_rect(0.05, -0.12, 0.2, 0.012)), L, axis=2)
        put(box(-0.06, -0.06, ph, 0.06, 0.06, ph + 0.95, 0.012), L, xf=tr(x, yfoot + 0.02, 0))
        giboshi(x, yfoot + 0.02, ph + 0.95)
        put(tube([(x, yfoot + 0.02, ph + 0.86), (x, ye + 0.08, zf + rail_h - 0.02)], 0.04, 10), L, axis=2)

# ---------------------------------------------------------------------------------------------------------------
# Greek Doric temple: peripteral hexastyle, 6 x 13 columns, in the proportions of the Temple of Hephaestus in Athens
# (stylobate 13.71 x 31.77 m, columns 1.02 m across and 5.71 m tall). Three steps, entasis, 20 sharp-edged flutes,
# annulets, echinus and abacus; architrave with taenia, regulae and guttae; triglyphs and metopes; cornice with
# mutules; pediments at 13 degrees; a tiled roof with antefixes and akroteria; a cella with pronaos and
# opisthodomos (two columns in antis each) and a tall doorway. Front (east) is -Y, the long axis is Y.
GREEK = dict(
    axis=(6.235, 15.265),   # column axes: half-width, half-length
    cols=(6, 13),
    contraction=0.18,       # corner bays are this much narrower (the corner triglyph conflict)
    D=1.02, Dc=1.04,        # column lower diameter, at the corners
    H=5.71,                 # column height with capital
    steps=(0.12, 0.42, 0.72, 1.03),   # euthynteria top, step tops (the last is the stylobate)
    slope=13.0,             # pediment and roof pitch (degrees)
    cella=(3.95, -10.9, 11.7, 0.75),  # half-width, front (antae), back, wall thickness
    naos=(-7.8, 8.8),       # door wall and back wall of the cella proper
    inantis=(1.45, 0.95),   # columns in antis: x, diameter
)

def axes_along(half, n, c):
    s = (2 * half + 2 * c) / (n - 1)
    xs = [-half]
    for i in range(1, n):
        xs.append(xs[-1] + s - (c if i in (1, n - 1) else 0.0))
    return xs

def palmette(w, h, lobes=7, stub=0.2, per=4):
    """A palmette outline (antefix, akroterion) in (u, v), base on v = 0, CCW."""
    a = w * 0.22
    v0 = h * stub
    cx, cy = 0.0, v0 * 0.9
    R = min(w / 2, h - cy)
    pts = [(-a, 0.0), (a, 0.0), (a, v0)]
    n = lobes * per
    for k in range(n + 1):
        th = math.radians(12 + 156 * k / n)
        ph = (k / float(per)) % 1.0
        tip = abs(math.cos(math.pi * ph)) ** 1.6
        r = R * (0.7 + 0.3 * tip)
        pts.append((cx + r * math.cos(th) * (w / 2) / R, cy + r * math.sin(th)))
    pts.append((-a, v0))
    return pts

def slab(poly, t, frame):
    """A flat outline poly (u, v) extruded t thick: u along frame[0], v along frame[1], thickness along frame[2]."""
    U, V, Wv, O = frame
    ring0 = [tuple(O + U * u + V * v) for u, v in poly]
    ring1 = [tuple(O + U * u + V * v + Wv * t) for u, v in poly]
    return loft([ring0, ring1], True, True)

def doric_column(cx, cy, z0, D, H, M, rnd_local):
    R0 = D / 2
    R1 = R0 * 0.78
    Hs = H - 0.45
    def R(z):
        t = z / Hs
        return R0 + (R1 - R0) * t + 0.012 * (D / 1.02) * math.sin(math.pi * t)
    def flutes(per):
        def f(th, z, r, i):
            u = (th * 20 / TAU) % 1.0
            d = 0.03 * r / R0
            return r - d * math.sqrt(max(0.0, 1 - (2 * u - 1) ** 2))
        return f
    top = z0 + H
    # LO shaft: 20 flutes, four points each, five spans for the entasis
    zs = [0.0, 1.1, 2.5, 3.9, Hs]
    put(lathe([(R(z), z0 + z) for z in zs], 80, flutes(4), cap0=False, cap1=False), M, 'lo', xf=tr(cx, cy, 0), top=top)
    # HI shaft: eight points a flute, the drum joints and the hypotrachelion groove cut in
    joints = []
    zj = 0.0
    while True:
        zj += rnd_local.uniform(0.82, 1.05)
        if zj > Hs - 0.5:
            break
        joints.append(zj)
    zs = sorted(set([0.0] + [Hs * k / 40 for k in range(1, 40)] + [j + d for j in joints for d in (-0.006, 0.0, 0.006)]
                    + [Hs - 0.14 + d for d in (-0.008, 0.0, 0.008)] + [Hs]))
    def groove(z):
        g = 0.0
        for j in joints:
            if abs(z - j) < 0.001:
                g = 0.005
        if abs(z - (Hs - 0.14)) < 0.001:
            g = 0.009
        return g
    put(lathe([(R(z) - groove(z), z0 + z) for z in zs], 160, flutes(8), cap0=False, cap1=False), M, 'hi', xf=tr(cx, cy, 0), top=top)
    # capital: annulets, echinus, abacus
    rn = R(Hs)
    ann = []
    z = Hs
    for k in range(3):
        ann += [(rn + 0.004, z0 + z), (rn + 0.012, z0 + z + 0.008), (rn + 0.012, z0 + z + 0.018), (rn + 0.004, z0 + z + 0.024)]
        z += 0.024
    re = 0.575 * D / 1.02
    ech = []
    for k in range(6):
        s_ = k / 5
        ech.append((rn + 0.016 + (re - rn - 0.016) * (s_ ** 0.62), z0 + Hs + 0.075 + 0.17 * s_))
    ech.append((re - 0.012, z0 + Hs + 0.25))
    put(lathe(ann, 64, cap0=False, cap1=False), M, 'hi', xf=tr(cx, cy, 0), top=top)
    put(lathe([(rn + 0.008, z0 + Hs), (rn + 0.012, z0 + Hs + 0.07), (rn + 0.016, z0 + Hs + 0.075)], 32, cap0=False, cap1=False), M, 'lo', xf=tr(cx, cy, 0), top=top)
    put(lathe(ech, 32, cap0=False, cap1=False), M, 'lo', xf=tr(cx, cy, 0), top=top)
    put(lathe(ech, 64, cap0=False, cap1=False), M, 'hi', xf=tr(cx, cy, 0), top=top)
    a = 0.575 * D / 1.02 + 0.01
    put(box(cx - a, cy - a, z0 + Hs + 0.25, cx + a, cy + a, z0 + H, 0.012, cap1=False), M, top=top)

def build_greek():
    P = GREEK
    M, T = 'marble', 'terracotta'
    AX, AY = P['axis']
    plan = rect(-AX, -AY, AX, AY)
    e0, s1, s2, zs = P['steps']
    # crepidoma: euthynteria and three steps, chamfered edges; the stylobate top is the floor
    c = 0.012
    prof = [(1.67, -0.5), (1.67, e0 - c), (1.67 - c, e0), (1.42 + c, e0), (1.42, e0 + c), (1.42, s1 - c), (1.42 - c, s1),
            (1.02 + c, s1), (1.02, s1 + c), (1.02, s2 - c), (1.02 - c, s2), (0.62 + c, s2), (0.62, s2 + c), (0.62, zs - c), (0.62 - c, zs)]
    put(stack(plan, prof, cap0=False, cap1=True), M, 'lo', top=zs)
    # HI: the blocks of each step and the stylobate paving in its place, so the joints show (never both: twin
    # surfaces black out the occlusion)
    def block_rows(o_out, o_in, z0, z1, length=1.25):
        pl = offset_poly(plan, o_out)
        x0, y0 = pl[0]; x1, y1 = pl[2]
        d = o_out - o_in
        for (ax0, ay0, ax1, ay1, along) in ((x0, y0, x1, y0 + d, 'x'), (x0, y1 - d, x1, y1, 'x'),
                                            (x0, y0 + d, x0 + d, y1 - d, 'y'), (x1 - d, y0 + d, x1, y1 - d, 'y')):
            a0, a1 = (ax0, ax1) if along == 'x' else (ay0, ay1)
            p = a0
            while p < a1 - 0.05:
                q = min(a1, p + length * rnd.uniform(0.8, 1.2))
                if a1 - q < 0.4:
                    q = a1
                if along == 'x':
                    put(box(p, ay0, z0, q, ay1, z1, 0.007), M, 'hi')
                else:
                    put(box(ax0, p, z0, ax1, q, z1, 0.007), M, 'hi')
                p = q
    block_rows(1.67, 1.42, -0.1, e0, 1.6)
    block_rows(1.42, 1.02, e0, s1, 1.3)
    block_rows(1.02, 0.62, s1, s2, 1.3)
    pl = offset_poly(plan, 0.62)
    x0, y0 = pl[0]; x1, y1 = pl[2]
    ny = int((y1 - y0) / 1.0)
    for j in range(ny):
        ya, yb = y0 + (y1 - y0) * j / ny, y0 + (y1 - y0) * (j + 1) / ny
        x = x0 + (0.0 if j % 2 else 0.6)
        xa = x0
        while xa < x1 - 0.05:
            xb = min(x1, (x if xa == x0 else xa) + 1.25)
            if x1 - xb < 0.35:
                xb = x1
            put(box(xa, ya, s2, xb, yb, zs, 0.006), M, 'hi')
            xa = xb
    # columns
    xs = axes_along(AX, P['cols'][0], P['contraction'])
    ys = axes_along(AY, P['cols'][1], P['contraction'])
    crnd = random.Random(31)
    spots = [(x, -AY) for x in xs] + [(x, AY) for x in xs] + [(-AX, y) for y in ys[1:-1]] + [(AX, y) for y in ys[1:-1]]
    for x, y in spots:
        corner = abs(abs(x) - AX) < 1e-6 and abs(abs(y) - AY) < 1e-6
        doric_column(x, y, zs, P['Dc'] if corner else P['D'], P['H'], M, crnd)
    zt = zs + P['H']                     # top of the abaci
    za, ztn, zf, zc = zt + 0.72, zt + 0.81, zt + 1.64, zt + 1.94   # taenia bottom, architrave top, frieze top, cornice top
    # architrave: body (LO continuous, HI in beams joined over the column axes) and taenia
    arch = [(-0.48, za), (-0.48, zt + c), (-0.48 + c, zt), (0.48 - c, zt), (0.48, zt + c), (0.48, za)]
    put(stack(plan, arch, cap0=False, cap1=False), M, 'lo', top=ztn)
    for row, axis_pts, fixed in ((('x', -AY), xs, -AY), (('x', AY), xs, AY), (('y', -AX), ys, -AX), (('y', AX), ys, AX)):
        for a0, a1 in zip(axis_pts, axis_pts[1:]):
            lo_ = a0 - (0.48 if a0 == axis_pts[0] else 0.0)
            hi_ = a1 + (0.48 if a1 == axis_pts[-1] else 0.0)
            if row[0] == 'x':
                put(box(lo_, fixed - 0.48, zt, hi_, fixed + 0.48, za, 0.007), M, 'hi', top=ztn)
            else:
                put(box(fixed - 0.48, lo_, zt, fixed + 0.48, hi_, za, 0.007), M, 'hi', top=ztn)
    put(stack(plan, [(0.48, za), (0.53, za), (0.53, ztn - 0.008), (0.522, ztn)], cap0=False, cap1=False), M, top=ztn)
    # frieze: metope face, triglyphs, regulae with guttae under them
    put(stack(plan, [(0.43, ztn), (0.43, zf - 0.075), (0.455, zf - 0.07), (0.455, zf)], cap0=False, cap1=False), M, top=zf)
    put(stack(plan, [(-0.45, zf - 0.3), (-0.45, ztn)], cap0=False, cap1=False), M, top=zf)   # inner face (walks down: faces in)
    tw = 0.53
    def trigs(axis_pts, half_other):
        edge = axis_pts[-1] + 0.48
        t = [-(edge - tw / 2)]
        inner = axis_pts[1:-1]
        t.append((t[0] + inner[0]) / 2)
        for a, b in zip(inner, inner[1:]):
            t += [a, (a + b) / 2]
        t.append(inner[-1])
        t.append((inner[-1] + (edge - tw / 2)) / 2)
        t.append(edge - tw / 2)
        return t
    tx, ty = trigs(xs, AY), trigs(ys, AX)
    def glyph_profile():
        # in (u along the face, d outward from the metope face); two V glyphs and two half glyphs at the edges
        g, dep = 0.085, 0.05
        hw = tw / 2
        u = [(-hw, 0.0), (-hw, dep - 0.04), (-hw + 0.044, dep)]
        for cu in (-hw / 3 + 0.005, hw / 3 - 0.005):
            u += [(cu - g / 2, dep), (cu, dep - 0.045), (cu + g / 2, dep)]
        u += [(hw - 0.044, dep), (hw, dep - 0.04), (hw, 0.0)]
        return u
    gp = glyph_profile()
    def place_trig(u0, side):
        # side: (origin of the face line, along vector, outward vector)
        O, A, N = side
        base = O + A * u0
        ring0 = [tuple(base + A * u + N * d + Vector((0, 0, ztn))) for u, d in gp]
        ring1 = [tuple(base + A * u + N * d + Vector((0, 0, zf - 0.09))) for u, d in gp]
        put(loft([ring0, ring1], True, True), M, top=zf, auto=True)
        put(slab(rect(-tw / 2 - 0.01, 0.0, tw / 2 + 0.01, 0.09), 0.08, (A, Vector((0, 0, 1)), N, base + Vector((0, 0, zf - 0.09)) - N * 0.02)), M, top=zf, auto=True)
        # regula and its six guttae under the taenia
        put(slab(rect(-tw / 2, 0.0, tw / 2, 0.045), 0.05, (A, Vector((0, 0, 1)), N, base + N * 0.05 + Vector((0, 0, za - 0.045)))), M, top=ztn, auto=True)
        for k in range(6):
            gu = -tw / 2 + tw * (k + 0.5) / 6
            gc = base + A * gu + N * 0.075 + Vector((0, 0, za - 0.045))
            put(lathe([(0.033, -0.055), (0.028, 0.0)], 10, cap0=True, cap1=False), M, 'hi', xf=tr(*gc), top=ztn)
    sides = [
        (Vector((0, -AY - 0.43, 0)), Vector((1, 0, 0)), Vector((0, -1, 0)), tx),
        (Vector((0, AY + 0.43, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), [-t for t in tx]),
        (Vector((AX + 0.43, 0, 0)), Vector((0, 1, 0)), Vector((1, 0, 0)), ty),
        (Vector((-AX - 0.43, 0, 0)), Vector((0, -1, 0)), Vector((-1, 0, 0)), [-t for t in ty]),
    ]
    for O, A, N, ts in sides:
        for u0 in ts:
            place_trig(u0, (O, A, N))
    # cornice (geison): sloping soffit, corona with a drip, hawksbeak crown
    gei = [(0.46, zf), (0.98, zf - 0.075), (1.01, zf - 0.07), (1.01, zt + 1.86), (1.03, zt + 1.885), (1.038, zt + 1.91),
           (1.03, zc - 0.006), (1.022, zc), (0.2, zc)]
    put(stack(plan, gei, cap0=False, cap1=False), M, top=zc)
    # mutules on the soffit over each triglyph and metope, eighteen guttae each (baked)
    soff = math.atan2(0.075, 0.52)
    for O, A, N, ts in sides:
        mids = [(a + b) / 2 for a, b in zip(ts, ts[1:])]
        for u0 in ts + mids:
            base = O + A * u0 + N * 0.08 + Vector((0, 0, zf - 0.012))
            Nd = (N * 0.52 + Vector((0, 0, -0.075))).normalized()
            down = A.cross(Nd).normalized()
            if down.z > 0:
                down = -down
            put(slab(rect(-0.25, 0.0, 0.25, 0.4), 0.035, (A, Nd, down, base)), M, top=zc, auto=True)
            for i in range(3):
                for k in range(6):
                    gc = base + A * (-0.25 + 0.5 * (k + 0.5) / 6) + Nd * (0.4 * (i + 0.5) / 3) + down * 0.035
                    m = Matrix.Translation(gc) @ Vector((0, 0, -1)).rotation_difference(down).to_matrix().to_4x4()
                    put(lathe([(0.026, 0.0), (0.022, 0.03)], 10, cap0=False, cap1=True), M, 'hi', xf=m, top=zc)
    # pediments: recessed tympanum, raking cornice and sima; roof planes with cover tiles; antefixes; akroteria
    tn = math.tan(math.radians(P['slope']))
    Xe = AX + 1.038                      # outer edge of the cornice
    ze = zc
    def zs_(x):
        return ze + (Xe - abs(x)) * tn
    for sg in (-1, 1):
        yface = sg * (AY + 0.43)
        ex = AX + 0.43
        tri = [(-ex, ze), (ex, ze), (ex, zs_(ex) - 0.01), (0.0, zs_(0.0) - 0.01), (-ex, zs_(ex) - 0.01)]
        U, V = Vector((1, 0, 0)), Vector((0, 0, 1))
        W = Vector((0, -sg, 0))
        put(slab(tri, 0.6, (U, V, W, Vector((0, yface, 0)))), M, top=ze + 2, auto=True)
        # raking geison: plumb sections riding the slope, from each corner to the apex
        yo = sg * (AY + 1.01)
        rg = [(sg * (AY + 0.43), -0.02), (yo, -0.02), (yo, 0.27), (yo + sg * 0.02, 0.29), (yo + sg * 0.028, 0.31), (yo + sg * 0.02, 0.33),
              (sg * (AY + 0.6), 0.33)]
        sima = [(sg * (AY + 0.7), 0.33), (yo + sg * 0.03, 0.33), (yo + sg * 0.03, 0.38), (yo + sg * 0.06, 0.45), (yo + sg * 0.07, 0.52),
                (yo + sg * 0.055, 0.6), (yo + sg * 0.06, 0.62), (yo + sg * 0.03, 0.64), (sg * (AY + 0.7), 0.64)]
        for half in (-1, 1):
            xs_r = [half * Xe * (1 - k / 8) for k in range(9)]
            xs_r = sorted(xs_r)
            for pr in (rg, sima):
                v, f = xloft(xs_r, pr, zs_, cap0=True, cap1=True)
                put((v, f), M, top=ze + 2, auto=True)
    # roof: pan tiles as two planes, cover-tile ridges down each slope, ridge tiles, antefixes on the eaves
    Ye = AY + 0.9
    zr0 = ze + 0.05
    def zroof(x):
        return zr0 + (Xe - 0.02 - abs(x)) * tn
    for sg in (-1, 1):
        quad = [(sg * (Xe - 0.02), -Ye, zr0), (sg * (Xe - 0.02), Ye, zr0), (0.0, Ye, zroof(0)), (0.0, -Ye, zroof(0))]
        if sg < 0:
            quad = quad[::-1]
        put((quad, [(0, 1, 2, 3)]), T, top=zroof(0))
        eave = [(sg * (Xe - 0.02), -Ye, zr0 - 0.14), (sg * (Xe - 0.02), Ye, zr0 - 0.14), (sg * (Xe - 0.02), Ye, zr0), (sg * (Xe - 0.02), -Ye, zr0)]
        if sg < 0:
            eave = eave[::-1]
        put((eave, [(0, 1, 2, 3)]), T, top=zr0)
        n = int(2 * Ye / 0.62)
        for k in range(n + 1):
            y = -Ye + 0.12 + k * (2 * Ye - 0.24) / n
            path = [(sg * (Xe - 0.06), y, zroof(Xe - 0.06) + 0.0), (0.0, y, zroof(0))]
            put(sweep(path, [(-0.09, 0.0), (0.09, 0.0), (0.075, 0.07), (0.0, 0.11), (-0.075, 0.07)]), T, top=zroof(0), auto=True)
            # antefix at the foot of each cover-tile row
            fr = (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((sg, 0, 0)), Vector((sg * (Xe - 0.05), y, zr0 + 0.02)))
            put(slab(palmette(0.3, 0.36, 5, 0.2, 2), 0.05, fr), M, top=zr0 + 0.4, auto=True)
        for j in range(1, 12):
            x = sg * (Xe - 0.02) * (1 - j / 12)
            put(box(min(x, x + sg * 0.03), -Ye, zroof(x) - 0.01, max(x, x + sg * 0.03), Ye, zroof(x) + 0.018, 0.004), T, 'hi')
    put(yloft([-Ye, Ye], [(-0.2, 0.0), (0.2, 0.0), (0.16, 0.12), (0.0, 0.18), (-0.16, 0.12)], lambda y: zroof(0) - 0.04), T, top=zroof(0) + 0.2)
    # akroteria: a tall palmette on each apex, smaller ones on the corners
    for sg in (-1, 1):
        y = sg * (AY + 0.9)
        za_ = zs_(0) + 0.64
        put(box(-0.3, y - 0.25, za_ - 0.05, 0.3, y + 0.25, za_ + 0.22, 0.01), M, top=za_ + 1.6)
        put(slab(palmette(1.1, 1.35, 9, 0.16), 0.14, (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)), Vector((0, y - 0.07, za_ + 0.22)))), M, top=za_ + 1.6, auto=True)
        for sx in (-1, 1):
            zc_ = ze + 0.64
            put(box(sx * Xe - 0.3 * sx - 0.25, y - 0.25, zc_ - 0.05, sx * Xe - 0.3 * sx + 0.25, y + 0.25, zc_ + 0.18, 0.01), M, top=zc_ + 1.0, auto=True)
            put(slab(palmette(0.7, 0.85, 7, 0.16), 0.12, (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)), Vector((sx * Xe - 0.3 * sx, y - 0.06, zc_ + 0.18)))), M, top=zc_ + 1.0, auto=True)
    # peristyle ceiling: slab over the walkway with marble beams; coffers (baked)
    cw, cyf, cyb, wt = P['cella']
    zce = zf - 0.3
    for (x0, y0, x1, y1) in ((-AX + 0.45, -AY + 0.45, AX - 0.45, cyf), (-AX + 0.45, cyb, AX - 0.45, AY - 0.45),
                             (-AX + 0.45, cyf, -cw, cyb), (cw, cyf, AX - 0.45, cyb)):
        put(box(x0, y0, zce, x1, y1, zf, 0.0, cap1=False), M, top=zf)
    for y in [cyf + 1.1 * k for k in range(int((cyb - cyf) / 1.1) + 1)]:
        for sx in (-1, 1):
            put(box(min(sx * cw, sx * (AX - 0.45)), y - 0.15, zce - 0.28, max(sx * cw, sx * (AX - 0.45)), y + 0.15, zce, 0.01, cap1=False), M, top=zf)
    for x in [-AX + 0.45 + 1.1 * k for k in range(int((2 * AX - 0.9) / 1.1) + 1)]:
        for (y0, y1) in ((-AY + 0.45, cyf), (cyb, AY - 0.45)):
            put(box(x - 0.15, y0, zce - 0.28, x + 0.15, y1, zce, 0.01, cap1=False), M, top=zf)
    # cella: side walls from the antae to the back, door wall and back wall of the naos, ashlar courses (baked)
    zw0 = zs
    zwt = zt + 1.64 - 0.3
    def wall_box(x0, y0, x1, y1, z0=zw0, z1=zwt):
        put(box(x0, y0, z0, x1, y1, z1, 0.01, cap0=False), M, top=z1)
        # ashlar: courses of blocks over the outer faces
        course = 0.52
        nz = int((z1 - z0 - 0.4) / course)
        horiz = abs(x1 - x0) > abs(y1 - y0)
        L0, L1 = (x0, x1) if horiz else (y0, y1)
        for k in range(nz):
            za0 = z0 + 0.4 + k * course
            za1 = za0 + course
            p = L0 + (0.0 if k % 2 else 0.6)
            q0 = L0
            while q0 < L1 - 0.05:
                q1 = min(L1, (p if q0 == L0 else q0) + 1.2)
                if L1 - q1 < 0.3:
                    q1 = L1
                if horiz:
                    put(box(q0, y0 - 0.003, za0, q1, y1 + 0.003, za1, 0.007), M, 'hi', top=z1)
                else:
                    put(box(x0 - 0.003, q0, za0, x1 + 0.003, q1, za1, 0.007), M, 'hi', top=z1)
                q0 = q1
        # the orthostates: a taller course at the foot
        if horiz:
            put(box(x0 - 0.006, y0 - 0.006, z0, x1 + 0.006, y1 + 0.006, z0 + 0.4, 0.01), M, 'hi', top=z1)
        else:
            put(box(x0 - 0.006, y0 - 0.006, z0, x1 + 0.006, y1 + 0.006, z0 + 0.4, 0.01), M, 'hi', top=z1)
    for sx in (-1, 1):
        wall_box(sx * cw - wt / 2 * sx - wt / 2, cyf, sx * cw - wt / 2 * sx + wt / 2, cyb)
    nf, nb = P['naos']
    dw, dh = 1.3, 4.9
    wall_box(-cw + wt, nf - wt / 2, -dw - 0.35, nf + wt / 2)
    wall_box(dw + 0.35, nf - wt / 2, cw - wt, nf + wt / 2)
    wall_box(-dw - 0.35, nf - wt / 2, dw + 0.35, nf + wt / 2, zw0 + dh + 0.35, zwt)
    wall_box(-cw + wt, nb - wt / 2, cw - wt, nb + wt / 2)
    # door: moulded frame and a dark threshold into the naos
    for x0, x1, z0, z1 in ((-dw - 0.35, -dw, zw0, zw0 + dh + 0.35), (dw, dw + 0.35, zw0, zw0 + dh + 0.35), (-dw - 0.35, dw + 0.35, zw0 + dh, zw0 + dh + 0.35)):
        put(box(x0, nf - wt / 2 - 0.06, z0, x1, nf - wt / 2 + 0.05, z1, 0.015), M)
    put(box(-dw - 0.6, nf - wt / 2 - 0.18, zw0 + dh + 0.35, dw + 0.6, nf - wt / 2 + 0.02, zw0 + dh + 0.55, 0.02), M)
    put(box(-dw, nf - wt / 2, zw0 - 0.02, dw, nf + wt / 2, zw0 + 0.02, 0.0), M)
    # interior: floor and ceiling of the naos (dark through the door)
    put(box(-cw + wt, nf, zw0 - 0.05, cw - wt, nb, zw0 + 0.0, 0.0, cap0=False), M)
    put(box(-cw + wt, nf, zwt - 0.25, cw - wt, nb, zwt, 0.0, cap1=False), M)
    # antae and the columns in antis, front and back, with their entablature band
    xi, Di = P['inantis']
    for yy in (cyf + 0.45, cyb - 0.45):
        for x in (-xi, xi):
            doric_column(x, yy, zs, Di, zt - zs, M, crnd)
    for sx in (-1, 1):
        for yy in (cyf, cyb):
            y0 = yy if yy < 0 else yy - 0.9
            put(box(sx * cw - (wt / 2 + 0.06) * sx - wt / 2 - 0.06, y0, zw0, sx * cw - (wt / 2 + 0.06) * sx + wt / 2 + 0.06, y0 + 0.9, zt, 0.012, cap0=False), M)
            put(box(sx * cw - (wt / 2 + 0.06) * sx - wt / 2 - 0.12, y0 - 0.06, zt - 0.3, sx * cw - (wt / 2 + 0.06) * sx + wt / 2 + 0.12, y0 + 0.96, zt, 0.012), M)
    cplan = rect(-cw - 0.06, cyf - 0.06, cw + 0.06, cyb + 0.06)
    put(stack(cplan, [(-0.6, zt + 0.72), (-0.6, zt), (0.0, zt), (0.0, zt + 0.72), (0.04, zt + 0.72), (0.04, zt + 0.81), (0.0, zt + 0.81),
                      (0.0, zwt + 0.3 - 0.07), (0.03, zwt + 0.3 - 0.06), (0.03, zwt + 0.3)], cap0=False, cap1=False), M, top=zwt + 0.3)

# ---------------------------------------------------------------------------------------------------------------
# Nagara temple in the Khajuraho manner, buff sandstone. A high terrace (jagati) reached by two flights of steps; a
# moulded plinth (adhishthana: khura, kumbha, kalasha, kapota); the sanctum (garbhagriha) on a pancharatha plan
# (five projections a side) with two registers of niches and a cornice; over it the curvilinear shikhara whose
# courses (bhumis) step in along the rekha curve, clustered with half-spires (urushringas) on its faces and miniature
# spires (shringas) at its foot, a ribbed amalaka and a kalasha on top; in front a vestibule (antarala) under the
# shukanasa, an open pillared hall (mandapa) with balcony seats (kakshasana) under a stepped pyramidal roof, and an
# entrance porch. Front (east) is -Y.
NAGARA = dict(
    jagati=(8.4, -16.2, 12.2, 2.4),   # half-width, front y, back y, height
    plinth=1.6,                       # adhishthana height
    sanctum=(0.0, 4.6, 4.0),          # centre x, y, half-size of the wall plan
    wall=4.6,                         # jangha height (walls, two registers)
    cornice=0.7,                      # varandika
    spire=(13.0, 0.6),                # shikhara height, how far it narrows (share of its width)
    courses=18,
    mandapa=(4.3, -9.2, -0.7, 3.5),   # half-width, front y, back y, pillar height
    porch=(2.6, -12.6, -9.2, 3.0),
)

def ratha_plan(half, five=True):
    """The stepped plan: a square with projections on each side (karna at the corners, pratiratha, central bhadra),
    recesses (salilantara) between them; CCW, centred on 0."""
    if five == 'simple':
        segs = [(-1, -0.45, 0.0), (-0.45, 0.45, 0.12), (0.45, 1, 0.0)]
    elif five:
        segs = [(-1, -0.69, 0.0), (-0.69, -0.63, -0.035), (-0.63, -0.44, 0.06), (-0.44, -0.38, 0.015), (-0.38, 0.38, 0.14),
                (0.38, 0.44, 0.015), (0.44, 0.63, 0.06), (0.63, 0.69, -0.035), (0.69, 1, 0.0)]
    else:
        segs = [(-1, -0.56, 0.0), (-0.56, -0.48, -0.04), (-0.48, 0.48, 0.12), (0.48, 0.56, -0.04), (0.56, 1, 0.0)]
    pts = []
    for n, t in (((0, -1), (1, 0)), ((1, 0), (0, 1)), ((0, 1), (-1, 0)), ((-1, 0), (0, -1))):
        n, t = Vector(n), Vector(t)
        side = []
        for u0, u1, d in segs:
            for u in (u0, u1):
                p = n * (half * (1 + d)) + t * (u * half)
                side.append((p.x, p.y))
        side = side[:-1]           # the last corner is the next side's first
        pts += side
    # remove repeated points
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > 1e-6:
            out.append(p)
    if (Vector(out[0]) - Vector(out[-1])).length < 1e-6:
        out.pop()
    return out

def rekha(t, narrow):
    return 1 - narrow * t ** 1.7

def amalaka(cx, cy, z0, R, h, ribs, M, where='both', segs=None):
    segs = segs or ribs * 4
    prof = []
    for k in range(9):
        ph = -math.pi / 2 + math.pi * k / 8
        prof.append((max(0.0, R * math.cos(ph)) if 0 < k < 8 else R * 0.55, z0 + h / 2 + h / 2 * math.sin(ph)))
    def rib(th, z, r, i):
        return r * (0.9 + 0.1 * math.sqrt(abs(math.cos(th * ribs / 2))))
    put(lathe(prof, segs, rib, cap0=True, cap1=True), M, where, xf=tr(cx, cy, 0))

def spire(cx, cy, z0, half, H, n_courses, M, narrow=0.6, five=True, top=True, hi_motifs=False, lip=0.03, detail=3):
    """A curvilinear spire: the stepped plan scaled along the rekha curve. Each course (bhumi) is a recessed face
    under a projecting band, so the courses read as a stack of storeys; amalaka and kalasha on top."""
    plan = ratha_plan(half, five)
    rings = []
    for k in range(n_courses):
        t0 = k / n_courses
        t1 = (k + 1) / n_courses
        z, dz = z0 + H * t0, H / n_courses
        f, f1 = rekha(t0, narrow), rekha(t1, narrow)
        if detail >= 3:
            rings.append(ring_at(plan, z, f - lip * 0.3, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.62, f + (f1 - f) * 0.62 - lip * 0.3, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.7, f + (f1 - f) * 0.7 + lip, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.93, f + (f1 - f) * 0.93 + lip * 0.85, cx, cy))
        elif detail == 2:
            rings.append(ring_at(plan, z, f - lip * 0.3, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.7, f + (f1 - f) * 0.7 + lip, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.9, f + (f1 - f) * 0.9 + lip * 0.8, cx, cy))
        else:
            rings.append(ring_at(plan, z, f - lip * 0.3, cx, cy))
            rings.append(ring_at(plan, z + dz * 0.75, f + (f1 - f) * 0.75 + lip, cx, cy))
    ft = rekha(1.0, narrow)
    rings.append(ring_at(plan, z0 + H, ft - lip * 0.3, cx, cy))
    put(loft(rings, cap0=False, cap1=True), M, top=z0 + H)
    if hi_motifs:
        # gavaksha mesh: little horseshoe arches on the faces of every course (baked)
        for k in range(n_courses - 1):
            t0 = (k + 0.55) / n_courses
            z = z0 + H * t0
            f = rekha(t0, narrow)
            for side in range(4):
                n = Vector(((0, -1), (1, 0), (0, 1), (-1, 0))[side]).to_3d()
                t = Vector(((1, 0), (0, 1), (-1, 0), (0, -1))[side]).to_3d()
                for u, d in ((-0.82, 0.0), (-0.53, 0.06), (0.0, 0.14), (0.53, 0.06), (0.82, 0.0)):
                    if (k + side + int(u * 10)) % 2 and abs(u) < 0.6:
                        continue
                    c = Vector((cx, cy, 0)) + n * (half * (1 + d) * f) + t * (u * half * f) + Vector((0, 0, z))
                    w = min(0.42, H / n_courses * 0.7) * (half / 4.0) ** 0.3
                    arch = [(w * 0.55 * math.cos(a), w * 0.25 + w * 0.55 * math.sin(a)) for a in [math.radians(d_) for d_ in range(-40, 225, 22)]]
                    arch = [(-w * 0.38, -w * 0.45), (w * 0.38, -w * 0.45)] + arch[::1]
                    inner = [(x * 0.62, y * 0.62 + w * 0.08) for x, y in arch]
                    put(slab(arch, 0.025, (t, Vector((0, 0, 1)), n, c - n * 0.005)), M, 'hi', auto=True, top=z0 + H)
                    put(slab(inner, 0.02, (t, Vector((0, 0, 1)), n, c + n * 0.015)), 'shade', 'hi', auto=True, top=z0 + H)
    if top:
        zt = z0 + H
        rn = half * ft * 0.62
        seg_a, seg_k = (96, 24) if half > 3 else (48, 12) if half > 1 else (24, 8)
        put(lathe([(rn, zt), (rn, zt + 0.12 * half / 4 + 0.05)], seg_k * 2 if half > 1 else 8, cap0=False, cap1=True), M, xf=tr(cx, cy, 0))
        ra = half * ft * 0.9
        za = zt + 0.12 * half / 4 + 0.05
        ha = ra * 0.55
        amalaka(cx, cy, za, ra, ha, seg_a // 4, M, segs=seg_a)
        zk = za + ha
        k = ra * 0.42
        kal = [(k * 0.9, zk), (k * 0.95, zk + 0.08 * k), (k * 0.5, zk + 0.3 * k), (k * 0.85, zk + 0.75 * k), (k * 0.9, zk + 1.0 * k),
               (k * 0.7, zk + 1.35 * k), (k * 0.3, zk + 1.55 * k), (k * 0.36, zk + 1.7 * k), (k * 0.22, zk + 1.85 * k), (0.0, zk + 2.4 * k)]
        put(lathe(kal, seg_k, cap0=True), M, xf=tr(cx, cy, 0))

def pillar(x, y, z0, H, M, rot=0.0):
    """Square base, shaft turning from square to octagon to sixteen sides, pot-and-foliage capital, cross bracket."""
    b = 0.3
    put(box(x - b, y - b, z0, x + b, y + b, z0 + 0.5, 0.02, cap0=False), M, top=z0 + H)
    oct_ = chamfer_poly(rect(-0.24, -0.24, 0.24, 0.24), 0.07)
    put(cprism([(x + px, y + py) for px, py in oct_], z0 + 0.5, z0 + 1.6, 0.012, cap0=False), M, top=z0 + H)
    put(cprism([(x + px, y + py) for px, py in rect(-0.25, -0.25, 0.25, 0.25)], z0 + 1.6, z0 + 1.72, 0.01), M, top=z0 + H)
    put(lathe([(0.23, z0 + 1.72), (0.22, z0 + H - 1.0)], 16, cap0=False, cap1=False), M, top=z0 + H, xf=tr(x, y, 0))
    gp = [(0.22, z0 + H - 1.0), (0.28, z0 + H - 0.92), (0.33, z0 + H - 0.75), (0.31, z0 + H - 0.6), (0.24, z0 + H - 0.5), (0.27, z0 + H - 0.44),
          (0.27, z0 + H - 0.36), (0.32, z0 + H - 0.33)]
    put(lathe(gp, 16, petals(8, lambda zz: 0.03, 0.6), cap0=False, cap1=False), M, top=z0 + H, xf=tr(x, y, 0))
    put(box(x - 0.34, y - 0.34, z0 + H - 0.33, x + 0.34, y + 0.34, z0 + H - 0.18, 0.015), M, top=z0 + H)
    for ax in ((1, 0), (0, 1)):
        hx, hy = (0.62, 0.17) if ax[0] else (0.17, 0.62)
        put(loft([ring_at(rect(-hx + 0.12, -hy + (0.0 if ax[0] else 0.12), hx - 0.12, hy - (0.0 if ax[0] else 0.12)), z0 + H - 0.18, 1.0, x, y),
                  ring_at(rect(-hx, -hy, hx, hy), z0 + H - 0.06, 1.0, x, y), ring_at(rect(-hx, -hy, hx, hy), z0 + H, 1.0, x, y)], True, True), M, top=z0 + H)

def pyramid_roof(x0, y0, x1, y1, z0, tiers, M, rise=0.42, step=0.36):
    """A phamsana roof: horizontal slabs (pidhas), each with a drooping lip, stepping in; a bell (ghanta) on top."""
    z = z0
    hx, hy = (x1 - x0) / 2, (y1 - y0) / 2
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    for k in range(tiers):
        ax, ay = hx - k * step, hy - k * step
        if ax < 0.5 or ay < 0.5:
            break
        pl = rect(cx - ax, cy - ay, cx + ax, cy + ay)
        put(stack(pl, [(-0.12, z), (0.0, z + 0.04), (0.02, z + rise * 0.55), (0.0, z + rise * 0.75), (-0.14, z + rise * 0.82),
                       (-0.14, z + rise)], cap0=(k == 0), cap1=False), M, top=z0 + 3)
        z += rise
    ax, ay = max(0.4, hx - tiers * step), max(0.4, hy - tiers * step)
    put(cprism(rect(cx - ax, cy - ay, cx + ax, cy + ay), z, z + 0.1, 0.02, cap0=False), M)
    r = min(ax, ay) * 0.95
    z += 0.1
    bell = [(r, z), (r * 0.98, z + 0.12), (r * 0.8, z + 0.4), (r * 0.55, z + 0.62), (r * 0.36, z + 0.72), (r * 0.3, z + 0.8)]
    put(lathe(bell, 24, cap0=False, cap1=True), M, xf=tr(cx, cy, 0))
    amalaka(cx, cy, z + 0.8, r * 0.55, r * 0.3, 16, M, segs=48)
    zk = z + 0.8 + r * 0.3
    k = r * 0.22
    put(lathe([(k * 0.9, zk), (k * 0.5, zk + 0.3 * k), (k * 0.9, zk + 0.9 * k), (k * 0.3, zk + 1.5 * k), (0.0, zk + 2.2 * k)], 12, cap0=True), M, xf=tr(cx, cy, 0))
    return z + 0.8, r

def build_nagara():
    P = NAGARA
    M, V = 'sandstone', 'shade'
    jw, jf, jb, jh = P['jagati']
    # jagati: the terrace, moulded base, recessed dado with pilaster strips (baked), cornice; its top is the floor
    jpl = rect(-jw, jf, jw, jb)
    put(stack(jpl, [(0.35, -0.4), (0.35, 0.28), (0.3, 0.33), (0.22, 0.38), (0.0, 0.42), (0.0, jh - 0.42), (0.1, jh - 0.36),
                    (0.22, jh - 0.3), (0.22, jh - 0.12), (0.26, jh - 0.08), (0.26, jh), (0.24, jh)], cap0=False, cap1=True), M, top=jh)
    for side in range(4):
        n = Vector(((0, -1), (1, 0), (0, 1), (-1, 0))[side])
        t = Vector(((1, 0), (0, 1), (-1, 0), (0, -1))[side])
        L = (2 * jw) if side % 2 == 0 else (jb - jf)
        c = Vector(((0, jf), (jw, (jf + jb) / 2), (0, jb), (-jw, (jf + jb) / 2))[side])
        k = 0
        while k * 1.6 < L - 1.0:
            u = -L / 2 + 0.8 + k * 1.6
            p = c + t * u
            if not (side == 0 and abs(u) < 2.6):
                put(slab(rect(-0.18, 0.42, 0.18, jh - 0.42), 0.035, (t.to_3d(), Vector((0, 0, 1)), n.to_3d(), p.to_3d() - n.to_3d() * 0.005)), M, 'hi', auto=True, top=jh)
            k += 1
    # terrace paving (baked)
    for gy in range(int((jb - jf) / 1.3)):
        y0_ = jf + 0.3 + gy * 1.3
        if y0_ + 1.3 > jb - 0.2:
            break
        x = -jw + 0.3
        while x < jw - 0.4:
            x1_ = min(jw - 0.3, x + rnd.uniform(1.1, 1.8))
            put(box(x, y0_, jh - 0.06, x1_, y0_ + 1.3, jh + 0.004, 0.006), M, 'hi', top=jh)
            x = x1_
    # two flights of steps with sloping side walls: ground to terrace, terrace to the porch
    def flight(x_half, y_top, z_bot, z_top, n, tread):
        rise = (z_top - z_bot) / n
        for k in range(n):
            ya = y_top - tread * (n - k)
            put(box(-x_half, ya, z_bot + rise * k - 0.05, x_half, ya + tread + 0.02, z_bot + rise * (k + 1), 0.012, cap0=False), M, top=z_top)
        yb_ = y_top - tread * n
        for sx in (-1, 1):
            x0_, x1_ = sx * x_half, sx * (x_half + 0.55)
            xa, xb = min(x0_, x1_), max(x0_, x1_)
            rings = [[(xa, y, z_bot - 0.05), (xb, y, z_bot - 0.05), (xb, y, zt_), (xa, y, zt_)] for y, zt_ in
                     ((yb_ - 0.3, z_bot + 0.55), (y_top, z_top + 0.55))]
            put(loft(rings, True, True), M, auto=True, top=z_top + 0.6)
            put(box(xa - 0.05, yb_ - 0.6, z_bot - 0.05, xb + 0.05, yb_ - 0.0, z_bot + 0.85, 0.02), M, top=z_bot + 0.85)
    pl_ = P['plinth']
    pw, pf, pb, ph_ = P['porch']
    flight(1.9, jf, 0.0, jh, 12, 0.3)
    flight(1.6, pf, jh, jh + pl_, 8, 0.3)
    z0 = jh
    # adhishthana profile (o outward, z): khura, kumbha, kalasha, recess, kapota, then the wall face
    def plinth_prof(z, h):
        k = h / 1.6
        return [(0.3, z), (0.3, z + 0.2 * k), (0.22, z + 0.24 * k), (0.25, z + 0.34 * k), (0.32, z + 0.48 * k), (0.3, z + 0.6 * k),
                (0.2, z + 0.66 * k), (0.24, z + 0.72 * k), (0.25, z + 0.8 * k), (0.2, z + 0.88 * k), (0.08, z + 0.92 * k),
                (0.08, z + 1.06 * k), (0.3, z + 1.16 * k), (0.34, z + 1.24 * k), (0.3, z + 1.36 * k), (0.1, z + 1.42 * k),
                (0.06, z + 1.5 * k), (0.06, z + h), (0.0, z + h)]
    # sanctum
    scx, scy, sh = P['sanctum']
    splan = [(x + scx, y + scy) for x, y in ratha_plan(sh)]
    put(stack(splan, plinth_prof(z0, pl_), cap0=False, cap1=False), M, top=z0 + pl_)
    zw = z0 + pl_
    wh = P['wall']
    zm = zw + wh * 0.5
    wall_prof = [(0.0, zw), (0.0, zm - 0.18), (0.06, zm - 0.14), (0.1, zm - 0.06), (0.1, zm + 0.06), (0.06, zm + 0.14), (0.0, zm + 0.18),
                 (0.0, zw + wh)]
    put(stack(splan, wall_prof, cap0=False, cap1=False), M, top=zw + wh)
    zc = zw + wh
    ch = P['cornice']
    put(stack(splan, [(0.0, zc), (0.12, zc + 0.08), (0.2, zc + 0.2), (0.24, zc + 0.3), (0.16, zc + 0.36), (0.16, zc + 0.46),
                      (0.3, zc + 0.52), (0.32, zc + 0.6), (0.24, zc + ch), (0.0, zc + ch)], cap0=False, cap1=True), M, top=zc + ch)
    # niches in two registers on every projection (baked): pilasters, sill and lintel round a darker recess
    base_plan = ratha_plan(sh)
    for side in range(4):
        n = Vector(((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0))[side])
        t = Vector(((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))[side])
        for u, d, w in ((-0.845, 0.0, 0.26), (-0.535, 0.06, 0.16), (0.0, 0.14, 0.5), (0.535, 0.06, 0.16), (0.845, 0.0, 0.26)):
            for (za, zb) in ((zw + 0.25, zm - 0.28), (zm + 0.28, zc - 0.2)):
                if side == 0 and abs(u) < 0.2:
                    continue
                c = Vector((scx, scy, 0)) + n * (sh * (1 + d)) + t * (u * sh)
                W_ = w * sh
                fr = (t, Vector((0, 0, 1)), n, c - n * 0.003)
                put(slab(rect(-W_ / 2, za, -W_ / 2 + 0.12, zb), 0.04, fr), M, 'hi', auto=True)
                put(slab(rect(W_ / 2 - 0.12, za, W_ / 2, zb), 0.04, fr), M, 'hi', auto=True)
                put(slab(rect(-W_ / 2 - 0.04, zb - 0.16, W_ / 2 + 0.04, zb), 0.05, fr), M, 'hi', auto=True)
                put(slab(rect(-W_ / 2 - 0.02, za, W_ / 2 + 0.02, za + 0.12), 0.05, fr), M, 'hi', auto=True)
                put(slab(rect(-W_ / 2 + 0.14, za + 0.14, W_ / 2 - 0.14, zb - 0.18), 0.01, (t, Vector((0, 0, 1)), n, c - n * 0.004)), V, 'hi', auto=True)
                # a lotus boss in the niche (no figures)
                lc = c + n * 0.0 + Vector((0, 0, (za + zb) / 2))
                m = Matrix.Translation(lc) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4()
                rr = min(0.18, W_ / 2 - 0.2)
                if rr > 0.06:
                    put(lathe([(rr, 0.0), (rr * 0.9, 0.025), (rr * 0.5, 0.04), (0.0, 0.045)], 24, petals(10, lambda zz: rr * 0.12, 0.5), cap0=False), M, 'hi', xf=m)
    # shikhara: main spire, half-spires on three faces, shringas round its foot, shukanasa on the front
    H, narrow = P['spire']
    zs = zc + ch
    spire(scx, scy, zs, sh, H, P['courses'], M, narrow, True, True, hi_motifs=True, lip=0.032, detail=3)
    def face_point(side, u, t_h):
        n = Vector(((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0))[side])
        tv = Vector(((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))[side])
        f = rekha(t_h, narrow)
        return Vector((scx, scy, 0)) + n * (sh * 1.14 * f) + tv * (u * sh * f), n
    for side in range(4):
        # half-spires (urushringas) stacked up the bhadra: three on the sides and back, two above the shukanasa in front
        stack_ = [(0.0, 0.52), (0.26, 0.4), (0.48, 0.28)] if side else [(0.3, 0.42), (0.5, 0.3)]
        for th_, hs_ in stack_:
            p, n = face_point(side, 0.0, th_)
            hh = hs_ * sh * rekha(th_, narrow) ** 0.3
            c = p - n * (hh * 0.62)
            spire(c.x, c.y, zs + H * th_, hh, H * (0.6 - th_ * 0.62) + 1.0, 8, M, narrow, False, True, lip=0.04, detail=1)
        # miniature spires (shringas) at the corners, two tiers, and on the pratirathas
        tv = Vector(((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))[side])
        if side % 2 == 0:
            for u in (-0.86, 0.86):
                p, n = face_point(side, u, 0.0)
                c = p - n * (0.2 * sh * 0.55)
                spire(c.x, c.y, zs, 0.22 * sh, 3.3, 6, M, 0.55, 'simple', True, lip=0.05, detail=1)
        for u in (-0.62, 0.62):
            p, n = face_point(side, u, 0.0)
            c = p - n * (0.16 * sh * 0.6)
            spire(c.x, c.y, zs, 0.15 * sh, 2.4, 5, M, 0.55, 'simple', True, lip=0.05, detail=1)
    # shukanasa: the frontal gable over the vestibule with a great arch (gavaksha) in it
    p, n = face_point(0, 0.0, 0.0)
    sw = 1.7
    sy0 = scy - sh * 1.14 - 1.6
    put(loft([ring_at(rect(-sw, sy0, sw, scy - sh), zs), ring_at(rect(-sw, sy0, sw, scy - sh), zs + 2.2),
              ring_at(rect(-0.3, sy0 + 0.6, 0.3, scy - sh), zs + 4.3)], cap0=True, cap1=True), M, top=zs + 4.3)
    for r_, d_ in ((1.15, 0.05), (0.85, 0.05)):
        ring = [(r_ * math.cos(a), 1.2 + r_ * math.sin(a)) for a in [math.radians(dd) for dd in range(-20, 205, 15)]]
        ring = [(-r_ * 0.95, 0.0), (r_ * 0.95, 0.0)] + ring
        put(slab(ring, d_, (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0)), Vector((0, sy0 - 0.0, zs + 0.3)))), M if r_ > 1 else V, 'hi', auto=True)
    # antarala: walls and roof between the hall and the sanctum, and the sanctum doorway
    mw, mf, mb, mh = P['mandapa']
    ay0, ay1 = mb, scy - sh * 1.14 + 0.02
    for sx in (-1, 1):
        put(stack(rect(sx * 2.3 - 0.35, ay0, sx * 2.3 + 0.35, ay1), plinth_prof(z0, pl_), cap0=False, cap1=False), M)
        put(box(sx * 2.3 - 0.35, ay0, zw, sx * 2.3 + 0.35, ay1, zc, 0.012, cap0=False), M)
    put(box(-2.75, ay0 - 0.2, zc, 2.75, ay1, zc + 0.5, 0.02), M)
    put(box(-2.0, ay0 - 0.25, zw - 0.02, 2.0, ay1, zw, 0.0, cap0=False), M)
    dz0, dw_, dh_ = zw, 0.75, 2.9
    yd = scy - sh * 1.14
    for k, (o, depth) in enumerate(((0.75, 0.62), (0.5, 0.48), (0.28, 0.34))):
        for sx in (-1, 1):
            put(box(min(sx * dw_, sx * (dw_ + o)), yd - depth, dz0, max(sx * dw_, sx * (dw_ + o)), yd, dz0 + dh_ + o * 0.8, 0.012), M)
        put(box(-dw_ - o, yd - depth, dz0 + dh_ + o * 0.8 - 0.25, dw_ + o, yd, dz0 + dh_ + o * 0.8, 0.012), M)
    put(box(-dw_, yd - 0.05, dz0, dw_, yd, dz0 + dh_, 0.0, cap0=False), V)
    put(box(-dw_ - 0.9, yd - 0.85, dz0 + dh_ + 1.4, dw_ + 0.9, yd, dz0 + dh_ + 1.65, 0.02), M)
    # mandapa: plinth, floor, balcony seats with sloping backrests, pillars, lintels, ceiling, stepped roof
    put(stack(rect(-mw, mf, mw, mb), plinth_prof(z0, pl_), cap0=False, cap1=True), M, top=zw)
    zr = zw + mh
    pillars = [(sx * (mw - 0.45), y) for sx in (-1, 1) for y in (mf + 0.45, (mf + mb) / 2, mb - 0.45)] + \
              [(sx * 1.55, y) for sx in (-1, 1) for y in (mf + (mb - mf) * 0.3, mf + (mb - mf) * 0.7)]
    for x, y in pillars:
        pillar(x, y, zw, mh, M)
    for sx in (-1, 1):
        xo = sx * mw
        put(box(min(xo, xo - sx * 0.35), mf + 0.8, zw, max(xo, xo - sx * 0.35), mb - 0.8, zw + 0.55, 0.015), M)
        put(box(min(xo + sx * 0.05, xo - sx * 0.55), mf + 0.75, zw + 0.55, max(xo + sx * 0.05, xo - sx * 0.55), mb - 0.75, zw + 0.66, 0.02), M)
        rings = [[(xo - sx * 0.05, y, zw + 0.66), (xo + sx * 0.0, y, zw + 0.66), (xo + sx * 0.32, y, zw + 1.25), (xo + sx * 0.26, y, zw + 1.25)]
                 for y in (mf + 0.78, mb - 0.78)]
        put(loft(rings, True, True), M, auto=True)
        for k in range(9):
            y = mf + 0.95 + k * (mb - mf - 1.9) / 8
            put(box(-0.04, -0.06, 0, 0.04, 0.06, 0.62, 0.008), M, 'hi', auto=True,
                xf=tr(xo + sx * 0.12, y, zw + 0.66) @ Matrix.Rotation(-sx * math.radians(27), 4, 'Y'))
    for sx in (-1, 1):
        put(box(sx * (mw - 0.45) - 0.3, mf + 0.15, zr, sx * (mw - 0.45) + 0.3, mb - 0.15, zr + 0.42, 0.015), M)
        put(box(sx * 1.55 - 0.25, mf + 0.15, zr, sx * 1.55 + 0.25, mb - 0.15, zr + 0.42, 0.015), M)
    for y in (mf + 0.45, mb - 0.45):
        put(box(-mw + 0.15, y - 0.3, zr, mw - 0.15, y + 0.3, zr + 0.42, 0.015), M)
    put(box(-mw + 0.1, mf + 0.1, zr + 0.42, mw - 0.1, mb - 0.1, zr + 0.62, 0.0, cap1=False), M)
    for k, r_ in enumerate((1.6, 1.25, 0.9, 0.55)):
        put(lathe([(r_, 0.0), (r_ - 0.08, -0.06), (r_ - 0.2, -0.06), (0.0, -0.06)], 32, petals(16, lambda zz: 0.04, 0.6), cap0=False),
            M, 'hi', xf=tr(0, (mf + mb) / 2, zr + 0.42 - 0.001 * k), auto=True)
    put(stack(rect(-mw - 0.2, mf - 0.2, mw + 0.2, mb + 0.2), [(0.0, zr + 0.62), (0.3, zr + 0.72), (0.42, zr + 0.86), (0.36, zr + 0.96),
                                                              (0.0, zr + 1.02)], cap0=True, cap1=False), M)
    pyramid_roof(-mw - 0.1, mf - 0.1, mw + 0.1, mb + 0.1, zr + 1.02, 7, M, rise=0.46, step=0.42)
    # porch: plinth, four pillars, beam, smaller stepped roof
    put(stack(rect(-pw, pf, pw, pb), plinth_prof(z0, pl_), cap0=False, cap1=True), M, top=zw)
    ph2 = P['porch'][3]
    for sx in (-1, 1):
        for y in (pf + 0.45, pb - 0.4):
            pillar(sx * (pw - 0.45), y, zw, ph2, M)
    zp = zw + ph2
    for sx in (-1, 1):
        put(box(sx * (pw - 0.45) - 0.28, pf + 0.15, zp, sx * (pw - 0.45) + 0.28, pb, zp + 0.4, 0.015), M)
    put(box(-pw + 0.15, pf + 0.15, zp, pw - 0.15, pf + 0.75, zp + 0.4, 0.015), M)
    put(box(-pw + 0.1, pf + 0.1, zp + 0.4, pw - 0.1, pb, zp + 0.58, 0.0, cap1=False), M)
    put(stack(rect(-pw - 0.2, pf - 0.2, pw + 0.2, pb), [(0.0, zp + 0.58), (0.3, zp + 0.68), (0.4, zp + 0.82), (0.0, zp + 0.95)], cap0=True, cap1=False), M)
    pyramid_roof(-pw - 0.1, pf - 0.1, pw + 0.1, pb + 0.2, zp + 0.95, 5, M, rise=0.4, step=0.36)
    # a carved arch (torana) hanging between the front porch pillars
    arch = [((pw - 0.75) * math.cos(a), 0.5 * math.sin(a)) for a in [math.radians(d) for d in range(0, 181, 12)]]
    path = [(x, pf + 0.45, zp - 0.75 + z) for x, z in arch]
    put(tube(path, 0.09, 8), M)
    for x, z in arch[1:-1:2]:
        put(lathe([(0.1, 0.0), (0.06, 0.08), (0.0, 0.11)], 10, cap0=True), M, 'hi', xf=tr(x, pf + 0.45, zp - 0.75 + z + 0.07))

# ---------------------------------------------------------------------------------------------------------------
# Japanese kit shared by the hanging lantern, bridge, pagoda and gate.
def giboshi_cap(x, y, z, s=1.0, M='gold'):
    """The onion-shaped bronze cap on a railing's end post."""
    prof = [(0.06, 0.0), (0.062, 0.05), (0.05, 0.065), (0.068, 0.11), (0.075, 0.15), (0.06, 0.2), (0.03, 0.235), (0.008, 0.27), (0.0, 0.28)]
    put(lathe([(r * s, zz * s) for r, zz in prof], 20, cap0=False), M, xf=tr(x, y, z))

def rail_line(pts, r, M='lacquer', n=10):
    """A round rail through 3D points (a curve)."""
    put(tube(pts, r, n), M, axis=1)

def koran(path, h=0.82, every=1.6, M='lacquer', G='gold', post=0.09, ends=True, end_post=0.13):
    """Railing along a 3D polyline (floor points): posts, a round top rail, a flat middle rail, a bottom rail,
    giboshi on the end posts."""
    P = [Vector(p) for p in path]
    L = sum((b - a).length for a, b in zip(P, P[1:]))
    def at(s):
        acc = 0.0
        for a, b in zip(P, P[1:]):
            d = (b - a).length
            if acc + d >= s - 1e-9:
                return a.lerp(b, (s - acc) / max(d, 1e-9))
            acc += d
        return P[-1]
    n = max(1, int(round(L / every)))
    for k in range(n + 1):
        p = at(L * k / n)
        end = k in (0, n)
        w = (end_post if end else post) / 2
        top = h + (0.06 if end else -0.04)
        put_small_box(p.x - w, p.y - w, p.z, p.x + w, p.y + w, p.z + top, 0.01, M, top=p.z + top)
        if end and ends:
            giboshi_cap(p.x, p.y, p.z + top, 1.15 if end_post > 0.12 else 1.0, G)
    samples = [at(L * k / (n * 3)) for k in range(n * 3 + 1)]
    for dz, r in ((h - 0.02, 0.042), (h * 0.5, 0.03), (0.1, 0.034)):
        rail_line([tuple(p + Vector((0, 0, dz))) for p in samples], r, M)

# ---------------------------------------------------------------------------------------------------------------
# Hanging lantern (tsuri-doro): a bronze hexagonal lantern with lattice windows and an upturned roof, hung from the
# arm of a vermilion post on a granite foot. The arm reaches toward -Y (the path side).
HANGING = dict(post=(0.09, 2.95), arm=0.72, lantern=(0.18, 0.36))

def build_hanging():
    L, B, G, S, Pp = 'lacquer', 'bronze', 'gold', 'granite', 'paper'
    hp, H = HANGING['post']
    # granite foot, post, a small roof cap, the arm with its curved strut
    put(cprism(chamfer_poly(rect(-0.28, -0.28, 0.28, 0.28), 0.03), -0.08, 0.22, 0.02, cap0=False), S, top=0.22)
    put(cprism(chamfer_poly(rect(-0.2, -0.2, 0.2, 0.2), 0.02), 0.22, 0.3, 0.012, cap0=False), S, top=0.3)
    put(box(-hp, -hp, 0.3, hp, hp, H, 0.015, cap0=False), L, top=H)
    put(box(-hp - 0.015, -hp - 0.015, 0.3, hp + 0.015, hp + 0.015, 0.75, 0.012, cap0=False), 'black', top=0.75)
    a = 0.17
    put(loft([ring_at(rect(-a + 0.04, -a + 0.04, a - 0.04, a - 0.04), H - 0.01), ring_at(rect(-a, -a, a, a), H + 0.02),
              ring_at(rect(-a, -a, a, a), H + 0.06), ring_at(rect(-0.04, -0.04, 0.04, 0.04), H + 0.2)], True, True), 'black', top=H + 0.2)
    giboshi_cap(0, 0, H + 0.2, 0.6)
    arm = HANGING['arm']
    za = H - 0.28
    put(box(-hp - 0.02, -arm - 0.06, za - 0.05, hp + 0.02, hp + 0.06, za + 0.07, 0.012), L, axis=2, top=za + 0.07)
    pts = []
    for k in range(9):
        t = k / 8
        ang = math.pi / 2 * t
        pts.append((0.0, -hp - (arm - 0.2) * (1 - math.cos(ang)), za - 0.05 - 0.48 * (1 - math.sin(ang))))
    put(sweep(pts, cham_rect(0.04, -0.04, 0.04, 0.01), up_hint=Vector((1, 0, 0))), L, axis=2, auto=True)
    put(lathe([(0.03, 0.0), (0.03, 0.02), (0.0, 0.03)], 10, cap0=True), G, xf=tr(0, -arm + 0.02, za + 0.07))
    # hook and chain links
    zh = za - 0.05
    hx, hy = 0.0, -arm + 0.1
    for k in range(3):
        m = tr(hx, hy, zh - 0.05 - k * 0.075) @ Matrix.Rotation(math.pi / 2 * (k % 2), 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X')
        put(torus(0.03, 0.009, 12, 6), B, xf=m, auto=True)
    # the lantern: top ring, roof with curled corners, lattice body, base
    r_body, h_body = HANGING['lantern']
    zt = zh - 0.27
    put(torus(0.035, 0.01, 12, 6), B, xf=tr(hx, hy, zt + 0.06) @ Matrix.Rotation(math.pi / 2, 4, 'X'), auto=True)
    put(lathe([(0.04, zt - 0.02), (0.05, zt + 0.02), (0.02, zt + 0.04)], 12, cap0=False, cap1=True), B, xf=tr(hx, hy, 0))
    # roof
    Re = 0.33
    def hex_ring(r, z, lift):
        pts = []
        for k in range(6):
            a0, a1 = TAU * k / 6, TAU * (k + 1) / 6
            c0 = Vector((math.cos(a0), math.sin(a0))) * r; c1 = Vector((math.cos(a1), math.sin(a1))) * r
            for j in range(4):
                s = j / 4
                p = c0.lerp(c1, s)
                pts.append((hx + p.x, hy + p.y, z + lift * (abs(s - 0.5) * 2) ** 3))
        return pts
    zr = zt - 0.22
    rings = [hex_ring(r_body * 1.05, zr - 0.01, 0.0), hex_ring(Re, zr + 0.02, 0.05), hex_ring(Re, zr + 0.045, 0.05)]
    for k in range(1, 6):
        t = k / 5
        rings.append(hex_ring(Re + (0.05 - Re) * t, zr + 0.045 + 0.17 * t ** 1.6, 0.05 * (1 - t) ** 2))
    put(loft(rings, cap0=False, cap1=True), B, top=zt)
    for k in range(6):
        ang = TAU * k / 6
        d = Vector((math.cos(ang), math.sin(ang), 0))
        c = Vector((hx, hy, 0)) + d * (Re - 0.01) + Vector((0, 0, zr + 0.1))
        pts = [tuple(c + d * (0.018 * math.cos(math.radians(200 - 300 * t))) + Vector((0, 0, 0.018 * math.sin(math.radians(200 - 300 * t)))))
               for t in [j / 8 for j in range(9)]]
        put(tube(pts, [0.009 * (1 - 0.4 * j / 8) for j in range(9)], 6), B, auto=True)
        # a little bell hanging from each corner
        bc = Vector((hx, hy, 0)) + d * (Re - 0.02) + Vector((0, 0, zr - 0.07))
        put(lathe([(0.0, 0.0), (0.022, 0.004), (0.02, 0.03), (0.012, 0.045), (0.0, 0.05)], 10), G, xf=tr(*bc))
        put(tube([tuple(bc + Vector((0, 0, 0.05))), tuple(bc + Vector((0, 0, 0.09)))], 0.003, 4), B)
    # body: six corner posts, lattice windows with paper behind them, top and bottom rims
    zb0, zb1 = zr - h_body, zr - 0.01
    outer = ngon(6, r_body * math.cos(math.pi / 6))
    for k in range(6):
        c = Vector(outer[k])
        put(box(-0.016, -0.016, zb0, 0.016, 0.016, zb1, 0.004), B, xf=tr(hx + c.x, hy + c.y, 0) @ rot_z(math.atan2(c.y, c.x)))
    inner = ngon(6, r_body * math.cos(math.pi / 6) - 0.02)
    paper_in = ngon(6, r_body * math.cos(math.pi / 6) - 0.012)
    for k in range(6):
        put(panel(paper_in[k], paper_in[(k + 1) % 6], inner[k], inner[(k + 1) % 6], zb0 + 0.04, zb1 - 0.04), Pp)
        o0, o1 = Vector(outer[k]), Vector(outer[(k + 1) % 6])
        n = (o1 - o0).to_3d().cross(Vector((0, 0, 1))).normalized()
        tvec = (o1 - o0).normalized().to_3d()
        mid = ((o0 + o1) / 2).to_3d() + Vector((hx, hy, 0))
        side = (o1 - o0).length
        fr = (tvec, Vector((0, 0, 1)), -n, mid - n * 0.004)
        for j in range(5):
            u = -side / 2 + side * (j + 0.5) / 5
            put(slab(rect(u - 0.006, zb0 + 0.04, u + 0.006, zb1 - 0.04), 0.012, fr), B, auto=True)
        for zz in (zb0 + 0.12, zb0 + 0.22):
            put(slab(rect(-side / 2, zz - 0.006, side / 2, zz + 0.006), 0.012, fr), B, auto=True)
    put(cprism([(hx + x, hy + y) for x, y in ngon(6, r_body * 1.05)], zb1 - 0.04, zb1, 0.006), B)
    put(cprism([(hx + x, hy + y) for x, y in ngon(6, r_body * 1.08)], zb0 - 0.05, zb0 + 0.04, 0.008), B)
    put(cprism([(hx + x, hy + y) for x, y in ngon(6, r_body * 0.7)], zb0 - 0.1, zb0 - 0.05, 0.006, cap1=False), B)
    for k in range(6):
        ang = TAU * k / 6 + math.pi / 6
        c = Vector((hx, hy, 0)) + Vector((math.cos(ang), math.sin(ang), 0)) * r_body * 0.85
        put(lathe([(0.016, 0.0), (0.012, -0.06), (0.018, -0.075), (0.0, -0.08)], 8, cap0=True), B, xf=tr(c.x, c.y, zb0 - 0.05), auto=True)

def torus(R, r, n, m):
    verts, faces = [], []
    for i in range(n):
        a = TAU * i / n
        for j in range(m):
            b = TAU * j / m
            verts.append(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
    for i in range(n):
        for j in range(m):
            a_, b_ = i * m + j, ((i + 1) % n) * m + j
            c_, d_ = ((i + 1) % n) * m + (j + 1) % m, i * m + (j + 1) % m
            faces.append((a_, b_, c_, d_))
    return verts, faces

# ---------------------------------------------------------------------------------------------------------------
# Arched bridge (taiko-bashi): a vermilion drum bridge 14 m long and 3 m wide over a pond. The deck of weathered
# planks rides an arch on two stringers, with cleats for footing, a railing with giboshi each side, three bents of
# posts standing in the water, granite abutments. It spans along X; its sides face -Y and +Y.
BRIDGE = dict(span=14.0, width=3.0, rise=1.75, end_z=0.32, deck=0.12, bents=(-4.4, 0.0, 4.4), bed=-1.4)

def bridge_z(x):
    B = BRIDGE
    t = max(-1.0, min(1.0, x / (B['span'] / 2)))
    return B['end_z'] + B['rise'] * max(0.0, math.cos(math.pi * t / 2)) ** 1.15

def build_bridge():
    B = BRIDGE
    L, W, G, S = 'lacquer', 'wood', 'gold', 'granite'
    half, w = B['span'] / 2, B['width'] / 2
    xs = spaced(-half, half, 40, ends=0)
    # deck planks over the arch, seams baked; cleats across for footing
    put(xloft(xs, cham_rect(w, -B['deck'], 0.0, 0.012), bridge_z), W, 'lo', axis=2, top=bridge_z(0))
    put(xloft(xs, cham_rect(w, -B['deck'], -0.02, 0.012), bridge_z), W, 'hi', axis=2, top=bridge_z(0))
    x = -half + 0.3
    while x < half - 0.3:
        put(box(-0.03, -w + 0.15, 0.0, 0.03, w - 0.15, 0.035, 0.008), W, axis=2,
            xf=tr(x, 0, bridge_z(x)) @ Matrix.Rotation(-math.atan(derivative(bridge_z, x)), 4, 'Y'))
        x += 0.42
    x = -half + 0.1
    while x < half - 0.1:
        put(box(-0.105, -w, -0.05, 0.105, w, 0.0, 0.007), W, 'hi', axis=2,
            xf=tr(x, 0, bridge_z(x)) @ Matrix.Rotation(-math.atan(derivative(bridge_z, x)), 4, 'Y'))
        x += 0.21
    # stringers with the fascia board on their outer faces
    for sy in (-1, 1):
        y0 = sy * (w + 0.06)
        put(xloft(xs, [(y0 - 0.12, -0.55), (y0 + 0.12, -0.55), (y0 + 0.13, -0.53), (y0 + 0.13, 0.06), (y0 + 0.11, 0.08),
                       (y0 - 0.11, 0.08), (y0 - 0.13, 0.06), (y0 - 0.13, -0.53)], bridge_z, slant=0.0), L, axis=1, top=bridge_z(0) + 0.1)
        # railing on the stringer
        path = [(x_, y0, bridge_z(x_) + 0.08) for x_ in spaced(-half + 0.15, half - 0.15, 24, ends=0)]
        koran(path, h=0.86, every=1.6, end_post=0.15)
    # joists under the deck and the three bents: posts in the water, cap beam, tie beam
    x = -half + 0.6
    while x < half - 0.5:
        put(box(x - 0.08, -w - 0.1, bridge_z(x) - 0.32, x + 0.08, w + 0.1, bridge_z(x) - B['deck'], 0.01), L, axis=2)
        x += 0.95
    for bx in B['bents']:
        zt = bridge_z(bx) - 0.55
        put(box(bx - 0.17, -w - 0.45, zt - 0.3, bx + 0.17, w + 0.45, zt, 0.015), L, axis=2, top=zt)
        for sy in (-1, 1):
            put(lathe([(0.17, B['bed']), (0.16, zt)], 20, cap0=False, cap1=False), L, xf=tr(bx, sy * (w + 0.1), 0), top=zt)
            put(lathe([(0.2, B['bed']), (0.2, 0.25), (0.19, 0.29), (0.17, 0.3)], 20, cap0=False, cap1=False), 'black', xf=tr(bx, sy * (w + 0.1), 0))
        zn = min(zt - 0.9, 0.9)
        if zn > 0.35:
            put(box(bx - 0.08, -w - 0.4, zn - 0.14, bx + 0.08, w + 0.4, zn + 0.14, 0.012), L, axis=2)
    # abutments of dressed granite at both ends, with a step down to the path
    for sx in (-1, 1):
        x0_ = sx * half
        put(box(min(x0_ - sx * 0.7, x0_ + sx * 0.8), -w - 0.45, -1.2, max(x0_ - sx * 0.7, x0_ + sx * 0.8), w + 0.45, B['end_z'] - B['deck'] + 0.01, 0.02, cap0=False), S)
        put(box(min(x0_ + sx * 0.8, x0_ + sx * 1.25), -w - 0.3, -0.3, max(x0_ + sx * 0.8, x0_ + sx * 1.25), w + 0.3, 0.1, 0.02, cap0=False), S)

def derivative(f, x, h=1e-3):
    return (f(x + h) - f(x - h)) / (2 * h)

# ---------------------------------------------------------------------------------------------------------------
# Japanese hipped roof, brackets and rafters (pagoda, gate).
def roof_frame(hw, hd, eave, t, s, side, lift, flare, z_e, z_in, iw, idp, pitch_pow=1.6):
    """A point on a hipped roof: t from the eave (0) to the inner rectangle (1), s along the side (0..1, CCW),
    side 0..3 (-Y, +X, +Y, -X). The eave line lifts and flares toward the corners (sori)."""
    Ae, Be = hw + eave, hd + eave
    a = Ae + (iw - Ae) * t
    b = Be + (idp - Be) * t
    corners = [Vector((-a, -b)), Vector((a, -b)), Vector((a, b)), Vector((-a, b))]
    c0, c1 = corners[side], corners[(side + 1) % 4]
    p = c0.lerp(c1, s)
    e = abs(2 * s - 1)
    k = (1 - t) ** 2
    out = p.normalized() if p.length > 0 else Vector((0, 0))
    # flare: corners pushed out along the diagonal
    p = p + Vector((p.x / max(a, 1e-6), p.y / max(b, 1e-6))) * flare * e ** 3 * k * 0.7
    z = z_e + (z_in - z_e) * t ** pitch_pow + lift * e ** 3 * k
    return Vector((p.x, p.y, z))

def jp_roof(cx, cy, hw, hd, z_e, eave, z_in, iw, idp, M='tile', lift=0.6, flare=0.3, thick=0.34, sub=10, rings_n=9,
            soffit_rise=0.55, tiles=True, ridges=True, R='tile', top_cap=True, pitch_pow=1.6):
    """Hipped roof from an eave rectangle (half-sizes hw+eave, hd+eave) up to an inner rectangle (iw, idp) at z_in."""
    def ring(t, dz=0.0, scale_in=None):
        pts = []
        for side in range(4):
            for j in range(sub):
                p = roof_frame(hw, hd, eave, t, j / sub, side, lift, flare, z_e, z_in, iw, idp, pitch_pow)
                pts.append((cx + p.x, cy + p.y, p.z + dz))
        return pts
    def soffit_ring():
        pts = []
        for side in range(4):
            for j in range(sub):
                s = j / sub
                corners = [Vector((-hw, -hd)), Vector((hw, -hd)), Vector((hw, hd)), Vector((-hw, hd))]
                p = corners[side].lerp(corners[(side + 1) % 4], s)
                pts.append((cx + p.x, cy + p.y, z_e - thick + soffit_rise))
        return pts
    rings = [soffit_ring(), ring(0.0, -thick), ring(0.0)]
    for i in range(1, rings_n + 1):
        rings.append(ring(i / rings_n))
    put(loft(rings, cap0=False, cap1=top_cap), M, top=z_in)
    # tile rows down the slope (baked) and the hip ridges
    if tiles:
        for side in range(4):
            along = (hw if side % 2 == 0 else hd) + eave
            n = int(2 * along / 0.3)
            for j in range(1, n):
                s = j / n
                pts = []
                for i in range(rings_n + 1):
                    t = i / rings_n
                    a_t = (hw if side % 2 == 0 else hd) + eave
                    a_t = a_t + ((iw if side % 2 == 0 else idp) - a_t) * t
                    b_t = (hd if side % 2 == 0 else hw) + eave
                    b_t = b_t + ((idp if side % 2 == 0 else iw) - b_t) * t
                    u = (s - 0.5) * 2 * ((hw if side % 2 == 0 else hd) + eave)
                    if abs(u) > a_t - 0.12:
                        break
                    ss = 0.5 + u / (2 * a_t)
                    p = roof_frame(hw, hd, eave, t, ss, side, lift, flare, z_e, z_in, iw, idp, pitch_pow)
                    pts.append((cx + p.x, cy + p.y, p.z + 0.035))
                if len(pts) >= 3:
                    put(tube(pts, 0.075, 6), M, 'hi')
    if ridges:
        for side in range(4):
            pts = []
            for i in range(rings_n + 1):
                p = roof_frame(hw, hd, eave, i / rings_n, 0.0, side, lift, flare, z_e, z_in, iw, idp, pitch_pow)
                pts.append((cx + p.x, cy + p.y, p.z + 0.06))
            put(sweep(pts, [(-0.13, -0.08), (0.13, -0.08), (0.12, 0.12), (0.06, 0.19), (-0.06, 0.19), (-0.12, 0.12)]), R, auto=True, top=z_in)
            # the ridge-end tile (onigawara) with a gold cap, and a wind bell under the corner
            p0 = Vector(pts[0]); p1 = Vector(pts[1])
            d = (p0 - p1).normalized()
            m = Matrix.Translation(p0 + d * 0.05) @ Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
            put(box(-0.16, -0.16, 0.0, 0.16, 0.16, 0.22, 0.02), R, xf=m, auto=True)
            put(lathe([(0.12, 0.2), (0.1, 0.27), (0.0, 0.3)], 12, cap0=True), 'gold', xf=m, auto=True)
            bell_at = Vector(pts[0]) - Vector((0, 0, thick + 0.15))
            put(tube([tuple(bell_at + Vector((0, 0, 0.12))), tuple(bell_at + Vector((0, 0, -0.05)))], 0.012, 6), 'bronze')
            put(lathe([(0.0, 0.0), (0.09, 0.01), (0.085, 0.12), (0.05, 0.18), (0.0, 0.2)], 14), 'bronze', xf=tr(bell_at.x, bell_at.y, bell_at.z - 0.25))
    return rings

def rafters_jp(cx, cy, hw, hd, z_e, eave, lift, flare, thick, soffit_rise, M='lacquer', spacing=0.38):
    """Two tiers of parallel rafters under each eave, shortening into the corners (heiko-daruki)."""
    for side in range(4):
        n_v = Vector(((0, -1), (1, 0), (0, 1), (-1, 0))[side])
        t_v = Vector(((1, 0), (0, 1), (-1, 0), (0, -1))[side])
        wall = hd if side % 2 == 0 else hw
        span = hw if side % 2 == 0 else hd
        m = int(2 * (span + eave) / spacing)
        for j in range(m + 1):
            u = -(span + eave) + 0.15 + j * (2 * (span + eave) - 0.3) / m
            d0 = max(0.0, abs(u) - span)
            for (dstart, dend, h, w, drop) in ((max(d0, 0.0), eave - 0.5, 0.12, 0.1, 0.2), (max(d0, eave - 1.1), eave - 0.05, 0.1, 0.09, 0.07)):
                if dend - dstart < 0.25:
                    continue
                pts = []
                for d in (dstart, dend):
                    base = Vector((cx, cy)) + n_v * (wall + d) + t_v * u
                    e = min(1.0, abs(u) / (span + eave))
                    zz = z_e - thick + soffit_rise * (1 - d / eave) + lift * e ** 3 * (1 - 0.0) * (d / eave) ** 2 - drop
                    pts.append((base.x, base.y, zz))
                put(sweep(pts, rect(-w / 2, -h / 2, w / 2, h / 2)), M, 'lo', axis=2 if side % 2 == 0 else 1, auto=True)
                put(sweep(pts, cham_rect(w / 2, -h / 2, h / 2, 0.012)), M, 'hi', axis=2 if side % 2 == 0 else 1, auto=True)

def bracket_set(x, y, z, out, diag=False, M='lacquer', scale=1.0, G='gold'):
    """A three-stepped bracket set (mitesaki): bearing block, then arms and small blocks stepping out three times
    to carry the eave purlin. `out` is the outward direction (unit 2D)."""
    s = scale
    o = Vector((out[0], out[1], 0)).normalized()
    t = Vector((-o.y, o.x, 0))
    base = Vector((x, y, z))
    def blk(c, a_len, w, h, along):
        # a block centred at c, a_len long along `along`, w wide, h tall
        al = along.normalized(); cr = Vector((-al.y, al.x, 0))
        m = Matrix((
            (al.x, cr.x, 0, c.x), (al.y, cr.y, 0, c.y), (0, 0, 1, c.z), (0, 0, 0, 1)))
        put_small_box(-a_len / 2, -w / 2, 0.0, a_len / 2, w / 2, h, 0.012 * s, M, xf=m)
    blk(base, 0.44 * s, 0.44 * s, 0.24 * s, o)
    zz = z + 0.24 * s
    for step in range(3):
        reach = (0.45 + 0.5 * step) * s * (1.35 if diag else 1.0)
        blk(base + o * (reach / 2 - 0.1 * s) + Vector((0, 0, zz - z)), reach + 0.2 * s, 0.17 * s, 0.2 * s, o)
        if not diag or step == 0:
            blk(base + Vector((0, 0, zz - z)), 1.0 * s, 0.17 * s, 0.2 * s, t)
        zz += 0.2 * s
        blk(base + o * reach + Vector((0, 0, zz - z)), 0.26 * s, 0.26 * s, 0.14 * s, o)
        if not diag:
            for sg in (-1, 1):
                blk(base + t * (0.42 * s * sg) + Vector((0, 0, zz - z)), 0.24 * s, 0.24 * s, 0.14 * s, o)
        zz += 0.14 * s
    return zz

# ---------------------------------------------------------------------------------------------------------------
# Five-storey pagoda (goju-no-to): a granite platform with steps, five storeys diminishing upward, each with posts,
# white walls, a central door with gold studs and lattice windows, three-stepped brackets, double rafters and a deep
# tiled hipped roof with lifted corners, hip ridges and wind bells; balconies on the upper storeys; a bronze sorin of
# nine rings, water flame and jewel on top. Front is -Y.
PAGODA = dict(widths=(6.4, 5.86, 5.32, 4.78, 4.24), walls=(3.0, 1.9, 1.8, 1.7, 1.65), eaves=(2.8, 2.7, 2.6, 2.5, 2.4),
              base=(6.6, 1.1), pitch=0.56)

def build_pagoda():
    P = PAGODA
    L, Wl, G, S, D, T, B = 'lacquer', 'plaster', 'gold', 'granite', 'darkwood', 'tile', 'bronze'
    bh, bz = P['base']
    # platform with a flight of steps on each side
    put(stack(rect(-bh, -bh, bh, bh), [(0.0, -0.3), (0.0, bz - 0.2), (0.06, bz - 0.15), (0.06, bz), (0.0, bz)], cap0=False, cap1=True), S, top=bz)
    for side in range(4):
        m = rot_z(side * math.pi / 2)
        for k in range(4):
            y0 = -bh - 0.32 * (4 - k)
            put(box(-1.2, y0, -0.2, 1.2, y0 + 0.36, bz * (k + 1) / 5, 0.012, cap0=False), S, xf=m)
    zf = bz
    for k, (w, hw_, ev) in enumerate(zip(P['widths'], P['walls'], P['eaves'])):
        h = w / 2
        bs = 1.0 if k == 0 else 0.8
        zw = zf + hw_
        bay = w / 3
        posts = [(-h + bay * i, -h) for i in range(4)] + [(h, -h + bay * i) for i in range(1, 4)] + \
                [(h - bay * i, h) for i in range(1, 4)] + [(-h, h - bay * i) for i in range(1, 3)]
        rp = 0.16 if k == 0 else 0.14
        for x, y in posts:
            put(lathe([(rp, zf), (rp, zw + 0.02)], 16, cap0=False, cap1=False), L, xf=tr(x, y, 0), top=zw)
        # walls: centre bay a door, side bays lattice windows (renji-mado) on white walls
        for side in range(4):
            n = Vector(((0, -1, 0), (1, 0, 0), (0, 1, 0), (-1, 0, 0))[side])
            tv = Vector(((1, 0, 0), (0, 1, 0), (-1, 0, 0), (0, -1, 0))[side])
            for b in range(3):
                u0, u1 = -h + bay * b + rp, -h + bay * (b + 1) - rp
                c0 = n * (h - 0.05)
                fr = (tv, Vector((0, 0, 1)), -n, c0)
                if b == 1:
                    put(slab(rect(u0, zf + 0.12, u1, zw - 0.45), 0.1, fr), D, auto=True, top=zw)
                    for i in range(2):
                        for zz in [zf + 0.4 + j * 0.42 for j in range(int((zw - zf - 0.9) / 0.42))]:
                            for uu in [u0 + (u1 - u0) * (i * 0.5 + 0.1 + 0.08 * q) for q in range(5)]:
                                put(lathe([(0.03, 0.0), (0.024, 0.015), (0.0, 0.022)], 8, cap0=False), G, 'hi', xf=Matrix.Translation(c0 + tv * uu + Vector((0, 0, zz)) - n * 0.0) @ Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4())
                    put(slab(rect(u0, zw - 0.45, u1, zw - 0.12), 0.1, fr), Wl, auto=True, top=zw)
                else:
                    put(slab(rect(u0, zf + 0.12, u1, zw - 0.12), 0.1, fr), Wl, auto=True, top=zw)
                    wz0, wz1 = zf + (zw - zf) * 0.35, zw - 0.5
                    put(slab(rect(u0 + 0.15, wz0, u1 - 0.15, wz1), 0.06, (tv, Vector((0, 0, 1)), -n, c0 + n * 0.04)), D, auto=True, top=zw)
                    for q in range(7):
                        uu = u0 + 0.2 + (u1 - u0 - 0.4) * (q + 0.5) / 7
                        put(slab(rect(uu - 0.025, wz0, uu + 0.025, wz1), 0.05, (tv, Vector((0, 0, 1)), -n, c0 + n * 0.08)), L, auto=True, top=zw)
            # sill and head beams (nageshi)
            for z0_, z1_ in ((zf, zf + 0.14), (zw - 0.45, zw - 0.33), (zw - 0.12, zw + 0.02)):
                put(slab(rect(-h - 0.08, z0_, h + 0.08, z1_), 0.14, (tv, Vector((0, 0, 1)), -n, n * (h + 0.07))), L, auto=True, top=zw, axis=1 if side % 2 == 0 else 2)
        # brackets: one on every post, diagonal at the corners
        for x, y in posts:
            corner = abs(abs(x) - h) < 1e-6 and abs(abs(y) - h) < 1e-6
            if corner:
                bracket_set(x, y, zw + 0.02, (math.copysign(1, x), math.copysign(1, y)), diag=True, scale=bs)
            else:
                out = (0, -1) if abs(y + h) < 1e-6 else (1, 0) if abs(x - h) < 1e-6 else (0, 1) if abs(y - h) < 1e-6 else (-1, 0)
                bracket_set(x, y, zw + 0.02, out, scale=bs)
        zb = zw + 0.02 + (0.24 + 3 * 0.34) * bs
        # eave purlin round the bracket ends, then the roof
        po = 1.5 * bs
        put(stack(rect(-h, -h, h, h), [(po - 0.12, zb - 0.02), (po + 0.12, zb - 0.02), (po + 0.12, zb + 0.22), (po - 0.12, zb + 0.22), (po - 0.12, zb - 0.02)], cap0=False, cap1=False), L, top=zb)
        z_e = zb + 0.42
        if k < 4:
            nw = P['widths'][k + 1] / 2
            inner = nw + 0.6
            z_in = z_e + (h + ev - inner) * P['pitch']
            jp_roof(0, 0, h, h, z_e, ev, z_in, inner, inner, lift=0.95 - 0.06 * k, flare=0.45, thick=0.44, soffit_rise=0.75)
            rafters_jp(0, 0, h, h, z_e, ev, 0.95 - 0.06 * k, 0.45, 0.44, 0.75, spacing=0.42)
            # the soffit inside the brackets: a ceiling closing the gap between the wall and the roof
            put(box(-h - 0.05, -h - 0.05, zw + 0.02, h + 0.05, h + 0.05, zb + 0.86, 0.0, cap0=False, cap1=False), Wl, top=zb)
            # balcony of the next storey: floor and railing
            zf = z_in + 0.15
            put(cprism(rect(-inner, -inner, inner, inner), z_in - 0.05, zf, 0.012), 'wood', top=zf, axis=1)
            put(stack(rect(-inner, -inner, inner, inner), [(0.02, z_in - 0.22), (0.06, z_in - 0.18), (0.06, z_in - 0.04), (0.0, z_in - 0.0)], cap0=True, cap1=False), L, top=zf)
            rp_ = inner - 0.12
            path = [(-rp_, -rp_, zf), (rp_, -rp_, zf), (rp_, rp_, zf), (-rp_, rp_, zf), (-rp_, -rp_, zf)]
            koran(path, h=0.72, every=1.4, ends=False, end_post=0.1)
        else:
            zt = z_e + (h + ev - 0.62) * P['pitch'] * 1.15
            jp_roof(0, 0, h, h, z_e, ev, zt, 0.62, 0.62, lift=0.75, flare=0.45, thick=0.44, soffit_rise=0.75, pitch_pow=1.45)
            rafters_jp(0, 0, h, h, z_e, ev, 0.75, 0.45, 0.44, 0.75, spacing=0.42)
            put(box(-h - 0.05, -h - 0.05, zw + 0.02, h + 0.05, h + 0.05, zb + 0.86, 0.0, cap0=False, cap1=False), Wl, top=zb)
            # sorin: roban, inverted bowl, lotus, nine rings on the mast, water flame, dragon wheel, jewel
            z = zt
            put(cprism(rect(-0.62, -0.62, 0.62, 0.62), z - 0.1, z + 0.45, 0.02, cap0=False), B, top=z + 9)
            z += 0.45
            put(lathe([(0.55, z), (0.58, z + 0.1), (0.5, z + 0.32), (0.3, z + 0.45), (0.12, z + 0.5)], 24, cap0=False), B, top=z + 9)
            z += 0.5
            put(lathe([(0.12, z), (0.38, z + 0.1), (0.5, z + 0.3), (0.12, z + 0.32)], 32, petals(8, lambda zz: 0.06, 0.5), cap0=False), G, top=z + 9)
            z += 0.32
            put(lathe([(0.09, z), (0.08, z + 4.6)], 12, cap0=False, cap1=False), B, top=z + 6)
            for i in range(9):
                r = 0.52 - 0.016 * i
                zz = z + 0.15 + i * 0.4
                put(lathe([(0.09, zz), (r, zz + 0.03), (r + 0.015, zz + 0.07), (r, zz + 0.11), (0.09, zz + 0.14)], 32, cap0=False, cap1=False), G, top=z + 6)
            zz = z + 0.15 + 9 * 0.4
            flame = [(0.0, 0.0), (0.18, 0.05), (0.42, 0.25), (0.36, 0.42), (0.48, 0.6), (0.3, 0.7), (0.34, 0.9), (0.14, 0.95), (0.16, 1.15), (0.0, 1.3)]
            flame = flame + [(-x, y) for x, y in flame[::-1][1:-1]]
            for a in (0.0, math.pi / 2):
                put(slab(flame, 0.035, (Vector((math.cos(a), math.sin(a), 0)), Vector((0, 0, 1)), Vector((-math.sin(a), math.cos(a), 0)),
                                         Vector((0, 0, zz)) - Vector((-math.sin(a), math.cos(a), 0)) * 0.0175)), G, auto=True, top=zz + 1.3)
            put(lathe([(0.0, zz + 1.25), (0.16, zz + 1.33), (0.18, zz + 1.45), (0.16, zz + 1.57), (0.0, zz + 1.65)], 16), G, top=zz + 2)
            put(lathe([(0.0, zz + 1.65), (0.14, zz + 1.7), (0.17, zz + 1.82), (0.12, zz + 1.95), (0.04, zz + 2.04), (0.0, zz + 2.1)], 16), G, top=zz + 2.1)

# ---------------------------------------------------------------------------------------------------------------
# Temple gate (nio-mon style): a granite platform, three bays by two, the centre bay an open passage with its great
# doors swung back, the side bays closed by lattice (kongo-goshi) in front of dim rooms (the guardian bays, left
# empty), three-stepped brackets, double rafters and a tiled irimoya roof: a hipped skirt below, a gable above with
# bargeboards and a gold pendant, a ridge ending in tall end tiles. Front is -Y; the passage runs along Y.
GATE = dict(xs=(-4.5, -1.8, 1.8, 4.5), ys=(-2.4, 0.0, 2.4), plat=(6.5, 4.0, 0.45), wall=5.0, eave=2.7, pitch=0.52)

def build_gate():
    P = GATE
    L, Wl, G, S, D, T, B = 'lacquer', 'plaster', 'gold', 'granite', 'darkwood', 'tile', 'bronze'
    xs, ys = P['xs'], P['ys']
    pw, pd, ph = P['plat']
    put(stack(rect(-pw, -pd, pw, pd), [(0.0, -0.3), (0.0, ph - 0.04), (-0.04, ph)], cap0=False, cap1=True), S, top=ph)
    for sy in (-1, 1):
        for k in range(2):
            y0 = sy * (pd + 0.34 * (2 - k))
            put(box(-1.9, min(y0, y0 - sy * 0.38), -0.2, 1.9, max(y0, y0 - sy * 0.38), ph * (k + 1) / 3, 0.012, cap0=False), S)
    zw = P['wall']
    hw, hd = xs[-1], ys[-1]
    rp = 0.24
    posts = [(x, y) for x in xs for y in ys]
    for x, y in posts:
        put(lathe([(rp + 0.06, ph - 0.01), (rp + 0.06, ph + 0.12), (rp + 0.02, ph + 0.18), (rp, ph + 0.2)], 20, cap0=False, cap1=False), S, xf=tr(x, y, 0))
        put(lathe([(rp, ph + 0.18), (rp, zw + 0.02)], 20, cap0=False, cap1=False), L, xf=tr(x, y, 0), top=zw)
    # beams round the frame and across: door-head tie, head tie, a rainbow beam over the passage
    for z0, z1 in ((3.55, 3.75), (zw - 0.32, zw + 0.02)):
        for y in ys:
            put(box(-hw - 0.15, y - 0.11, z0, hw + 0.15, y + 0.11, z1, 0.015), L, axis=1, top=zw)
        for x in xs:
            put(box(x - 0.11, -hd - 0.15, z0, x + 0.11, hd + 0.15, z1, 0.015), L, axis=2, top=zw)
    for y in (-hd, hd):
        path = [(x, y, 3.85 + 0.28 * math.sin(math.pi * (x + 1.8) / 3.6) ** 0.7) for x in spaced(-1.8, 1.8, 10, ends=0)]
        put(sweep(path, cham_rect(0.12, -0.2, 0.2, 0.02)), L, axis=1)
    # the guardian bays: lattice on the outer faces, white walls inside, a dim floor
    for sx in (-1, 1):
        xa, xb = sorted((sx * 1.8, sx * 4.5))
        for y0_, y1_ in ((-hd, 0.0), (0.0, hd)):
            wy = y0_ if y0_ < 0 else y1_
            put(box(xa + rp, wy - 0.05, ph + 0.4, xb - rp, wy + 0.05, ph + 0.62, 0.01), L, axis=1)
            n_bars = 11
            for q in range(n_bars):
                xq = xa + rp + 0.1 + (xb - xa - 2 * rp - 0.2) * (q + 0.5) / n_bars
                put_small_box(xq - 0.045, wy - 0.045, ph + 0.62, xq + 0.045, wy + 0.045, 3.55, 0.012, L, axis=0)
            put(box(xa + rp, wy - 0.06, 3.35, xb - rp, wy + 0.06, 3.55, 0.01), L, axis=1)
            put(box(xa + rp, wy - 0.04, 3.75, xb - rp, wy + 0.04, zw - 0.32, 0.0), Wl, axis=1)
        put(box(xa + 0.1, -0.06, ph, xb - 0.1, 0.06, 3.55, 0.0), Wl, axis=1)
        put(box(sx * 1.8 - 0.06, -hd + rp, ph, sx * 1.8 + 0.06, hd - rp, 3.55, 0.0), Wl, axis=2)
        put(box(sx * 4.5 - 0.06, -hd + rp, ph, sx * 4.5 + 0.06, hd - rp, zw - 0.32, 0.0), Wl, axis=2)
        put(box(xa + 0.1, -hd + 0.1, ph, xb - 0.1, hd - 0.1, ph + 0.4, 0.01), 'wood', axis=1)
        # the great doors, swung open toward the front against the side walls of the passage
        put(box(sx * 1.5 - 0.06, -1.75, ph + 0.06, sx * 1.5 + 0.06, -0.05, 3.5, 0.012), D, axis=0)
        for zz in (1.1, 2.0, 2.9):
            put(box(sx * 1.5 - 0.075, -1.7, zz, sx * 1.5 + 0.075, -0.1, zz + 0.08, 0.008), G, axis=2)
        for zz in [ph + 0.4 + 0.33 * q for q in range(9)]:
            for yy in [-1.55 + 0.3 * q for q in range(5)]:
                put(lathe([(0.026, 0.0), (0.02, 0.014), (0.0, 0.02)], 8, cap0=False), G, 'hi', xf=tr(sx * 1.5 - sx * 0.06, yy, zz) @ Matrix.Rotation(-sx * math.pi / 2, 4, 'Y'))
    # brackets on every outer post, diagonal at the corners, and the eave purlin
    outer = [(x, y) for x, y in posts if abs(x) == hw or abs(y) == hd]
    for x, y in outer:
        corner = abs(x) == hw and abs(y) == hd
        if corner:
            bracket_set(x, y, zw + 0.02, (math.copysign(1, x), math.copysign(1, y)), diag=True)
        elif abs(y) == hd:
            bracket_set(x, y, zw + 0.02, (0, math.copysign(1, y)))
        else:
            bracket_set(x, y, zw + 0.02, (math.copysign(1, x), 0))
    zb = zw + 0.02 + 0.24 + 3 * 0.34
    po = 1.5
    put(stack(rect(-hw, -hd, hw, hd), [(po - 0.13, zb - 0.02), (po + 0.13, zb - 0.02), (po + 0.13, zb + 0.24), (po - 0.13, zb + 0.24),
                                        (po - 0.13, zb - 0.02)], cap0=False, cap1=False), L, top=zb)
    put(box(-hw - 0.05, -hd - 0.05, zw + 0.02, hw + 0.05, hd + 0.05, zb + 0.9, 0.0, cap0=False, cap1=False), Wl, top=zb)
    # a ceiling of boards on joists over the whole gate, so the passage looks up at wood, not into the roof
    put(box(-hw, -hd, zw - 0.36, hw, hd, zw - 0.32, 0.0, cap1=False), 'wood', axis=1)
    for k in range(-7, 8):
        put_small_box(k * 0.6 - 0.05, -hd, zw - 0.46, k * 0.6 + 0.05, hd, zw - 0.36, 0.01, L, axis=2)
    # irimoya roof: hipped skirt, then the gable
    ev = P['eave']
    z_e = zb + 0.42
    gx, gy = hw - 0.5, 1.6               # the gable triangle stands at x = +-gx; the skirt rises to y = +-gy
    z_in = z_e + (hd + ev - gy) * P['pitch']
    jp_roof(0, 0, hw, hd, z_e, ev, z_in, gx, gy, lift=0.75, flare=0.4, thick=0.38, soffit_rise=0.8, top_cap=True)
    rafters_jp(0, 0, hw, hd, z_e, ev, 0.75, 0.4, 0.38, 0.8, spacing=0.42)
    zr = z_in + gy * P['pitch'] * 1.25
    ox = gx + 0.75
    def gable_z(y):
        t = max(0.0, 1 - abs(y) / (gy + 0.25))
        return z_in - 0.12 + (zr - z_in + 0.12) * (0.55 * t + 0.45 * t ** 1.6)
    ysg = spaced(-gy - 0.25, gy + 0.25, 16, ends=0)
    # the two slopes as one shell swept along x
    top = [(y, gable_z(y)) for y in ysg]
    under = [(y, gable_z(y) - 0.3) for y in reversed(ysg)]
    put(xloft([-ox, ox], (top + under)[::-1]), T, axis=2, top=zr)
    for k in range(int(2 * ox / 0.3)):
        x = -ox + 0.15 + k * 0.3
        for sg in (-1, 1):
            pts = [(x, y, gable_z(y) + 0.035) for y in spaced(sg * (gy + 0.25), 0.0, 8, ends=0)]
            put(tube(pts, 0.075, 6), T, 'hi')
    # gable triangles with a lattice and a frame, bargeboards along the gable edges, gold pendant at the apex
    for sx in (-1, 1):
        rings = [[(sx * gx - 0.06, y, z_in - 0.1), (sx * gx + 0.06, y, z_in - 0.1), (sx * gx + 0.06, y, gable_z(y) - 0.25), (sx * gx - 0.06, y, gable_z(y) - 0.25)]
                 for y in spaced(-gy - 0.05, gy + 0.05, 10, ends=0)]
        put(loft(rings, True, True), Wl, auto=True, axis=2)
        for q in range(-6, 7):
            yq = q * gy / 6.5
            put_small_box(sx * gx - 0.08 - 0.02, yq - 0.03, z_in - 0.1, sx * gx - 0.08 + 0.02, yq + 0.03, gable_z(yq) - 0.28, 0.008, L)
        put(box(sx * gx - 0.12, -gy - 0.1, z_in - 0.18, sx * gx + 0.12, gy + 0.1, z_in + 0.05, 0.012), L, axis=2)
        path = [(sx * (ox + 0.05), y, gable_z(y) + 0.08) for y in spaced(-gy - 0.25, gy + 0.25, 24, ends=0)]
        put(sweep(path, cham_rect(0.06, -0.42, 0.0, 0.015)), L, axis=2, auto=True)
        put(slab([(-0.32, 0.0), (0.32, 0.0), (0.22, -0.3), (0.0, -0.5), (-0.22, -0.3)], 0.08,
                  (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((sx, 0, 0)), Vector((sx * (ox + 0.08), 0, zr - 0.32)))), G, auto=True)
        for y in (-gy * 0.55, gy * 0.55):
            put(lathe([(0.1, 0.0), (0.09, 0.03), (0.0, 0.04)], 12, cap0=False), G, xf=tr(sx * (ox + 0.12), y, gable_z(y) - 0.1) @ Matrix.Rotation(sx * math.pi / 2, 4, 'Y'))
    # ridge with tall end tiles (onigawara) and gold caps
    put(xloft([-ox - 0.1, ox + 0.1], [(-0.24, -0.1), (0.24, -0.1), (0.24, 0.25), (0.18, 0.35), (-0.18, 0.35), (-0.24, 0.25)], lambda x: zr), T, axis=1, top=zr + 0.4)
    for sx in (-1, 1):
        x = sx * (ox + 0.1)
        oni = [(-0.4, 0.0), (0.4, 0.0), (0.42, 0.55), (0.3, 0.8), (0.12, 0.95), (0.0, 1.0), (-0.12, 0.95), (-0.3, 0.8), (-0.42, 0.55)]
        put(slab(oni, 0.34, (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((-sx, 0, 0)), Vector((x, 0, zr + 0.1)))), T, auto=True, top=zr + 1.1)
        put(lathe([(0.1, 0.0), (0.08, 0.06), (0.0, 0.09)], 12), G, xf=tr(x - sx * 0.17, 0, zr + 1.08))

# ---------------------------------------------------------------------------------------------------------------
# Stepped tank (kund): a square tank about 24 m across, sandstone, its four sides stepping down in three flights
# with landings to the floor 4.5 m below; a small shrine on each side of the first landing and a kiosk on each corner
# of the rim. The game draws the water (its line is near -3.3 m: the stone is darker and stained below it).
KUND = dict(half=12.0, rim=1.0, flights=((6, 0.25, 0.36), (6, 0.25, 0.36), (6, 0.25, 0.36)), landing=(1.3, 1.1), floor=-4.5)

def build_kund():
    P = KUND
    M = 'sandkund'
    half = P['half']
    rim = half - P['rim']
    plan = rect(-rim, -rim, rim, rim)
    # outer coping and the rim paving
    put(stack(rect(-half, -half, half, half), [(0.0, -0.6), (0.0, 0.02), (-0.03, 0.06)], cap0=False, cap1=False), M, top=0.06)
    put(stack(rect(-half + 0.03, -half + 0.03, half - 0.03, half - 0.03), [(0.0, 0.06), (-P['rim'] + 0.03, 0.06)], cap0=False, cap1=False), M, top=0.06)
    # the steps: one profile walking down and in from the rim (risers face the centre, treads face up)
    prof = [(0.0, 0.06)]
    o, z = 0.0, 0.06
    for i, (n, rise, tread) in enumerate(P['flights']):
        for k in range(n):
            prof += [(o, z - rise + 0.012), (o - 0.012, z - rise)]
            z -= rise
            o -= tread if k < n - 1 else (P['landing'][i] if i < len(P['landing']) else tread)
            prof += [(o + 0.0, z)]
    prof += [(o, P['floor'])]
    # walk the stack from inside out so the faces point into the tank: the profile must have the solid on its left
    put(stack(plan, prof, cap0=False, cap1=True), M, top=0.06)
    # HI: block joints along every riser
    o, z = 0.0, 0.06
    for i, (n, rise, tread) in enumerate(P['flights']):
        for k in range(n):
            a = rim + o
            p = -a
            while p < a - 0.3:
                q = min(a, p + rnd.uniform(0.9, 1.6))
                for side in range(4):
                    m = rot_z(side * math.pi / 2)
                    put(box(p, -a - 0.3, z - rise, q, -a + 0.004, z + 0.004, 0.008), M, 'hi', xf=m)
                p = q
            z -= rise
            o -= tread if k < n - 1 else (P['landing'][i] if i < len(P['landing']) else tread)
    # shrines on the first landing (mid-side) and kiosks on the rim corners
    n0, r0, t0 = P['flights'][0]
    land_o = -(t0 * (n0 - 1)) - P['landing'][0] / 2
    land_z = 0.06 - n0 * r0
    for side in range(4):
        m = rot_z(side * math.pi / 2)
        c = Vector((0.0, -(rim + land_o), land_z))
        shrine_small(c, m, 1.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = Vector((sx * (half - 0.9), sy * (half - 0.9), 0.06))
            shrine_small(c, Matrix.Identity(4), 0.85, kiosk=True)
    # small stepped mounds with a finial on the second landing, two each side (as round the tank at Modhera)
    n1, r1, t1 = P['flights'][1]
    land2_o = land_o - P['landing'][0] / 2 - t1 * (n1 - 1) - P['landing'][1] / 2
    land2_z = land_z - n1 * r1
    for side in range(4):
        m = rot_z(side * math.pi / 2)
        for u in (-5.2, 5.2):
            c = m @ Vector((u, -(rim + land2_o), land2_z))
            z = land2_z
            for k, w in enumerate((0.75, 0.55, 0.36)):
                put(box(c.x - w, c.y - w, z - (0.2 if k == 0 else 0.0), c.x + w, c.y + w, z + 0.28, 0.012, cap0=False), 'sandkund')
                z += 0.28
            put(lathe([(0.2, 0.0), (0.24, 0.08), (0.12, 0.2), (0.2, 0.32), (0.08, 0.45), (0.0, 0.6)], 12), 'sandkund', xf=tr(c.x, c.y, z))

def shrine_small(c, m, s, kiosk=False):
    """A small Nagara shrine or kiosk: plinth, four pillars, a stepped pyramid roof with bell, amalaka and kalasha."""
    M = 'sandkund'
    w = 0.85 * s
    def P(x, y):
        v = m @ Vector((x, y, 0))
        return c.x + v.x, c.y + v.y
    x0, y0 = P(-w, -w); x1, y1 = P(w, w)
    xa, xb, ya, yb = min(x0, x1), max(x0, x1), min(y0, y1), max(y0, y1)
    put(stack(rect(xa, ya, xb, yb), [(0.1, c.z - 0.3), (0.1, c.z + 0.2), (0.14, c.z + 0.26), (0.14, c.z + 0.34), (0.06, c.z + 0.4), (0.0, c.z + 0.45)], cap0=False, cap1=True), M)
    h = 1.9 * s
    for px, py in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x, y = P(px * (w - 0.18), py * (w - 0.18))
        put(box(x - 0.12, y - 0.12, c.z + 0.45, x + 0.12, y + 0.12, c.z + 0.65, 0.012), M)
        put(cprism([(x + qx, y + qy) for qx, qy in chamfer_poly(rect(-0.1, -0.1, 0.1, 0.1), 0.03)], c.z + 0.65, c.z + 0.45 + h - 0.3, 0.008), M)
        put(lathe([(0.1, 0.0), (0.15, 0.08), (0.14, 0.16), (0.17, 0.2)], 12), M, xf=tr(x, y, c.z + 0.45 + h - 0.3))
        put(box(x - 0.19, y - 0.19, c.z + 0.45 + h - 0.1, x + 0.19, y + 0.19, c.z + 0.45 + h, 0.012), M)
    zt = c.z + 0.45 + h
    put(box(xa + 0.02, ya + 0.02, zt, xb - 0.02, yb - 0.02, zt + 0.22, 0.015), M)
    if not kiosk:
        bx0, by0 = P(-w + 0.12, -w + 0.12); bx1, by1 = P(w - 0.12, -w + 0.3)
        put(box(min(bx0, bx1), min(by0, by1), c.z + 0.45, max(bx0, bx1), max(by0, by1), zt, 0.01), M)
        put(box(min(bx0, bx1) + 0.25, min(by0, by1) - 0.01, c.z + 0.75, max(bx0, bx1) - 0.25, max(by0, by1) + 0.01, zt - 0.4, 0.0), 'shade', 'hi', auto=True)
    put(stack(rect(xa - 0.1, ya - 0.1, xb + 0.1, yb + 0.1), [(0.0, zt + 0.22), (0.12, zt + 0.3), (0.0, zt + 0.38)], cap0=True, cap1=False), M)
    pyramid_roof(xa - 0.1, ya - 0.1, xb + 0.1, yb + 0.1, zt + 0.38, 4, M, rise=0.3, step=0.22)


BUILDERS = {'lantern': build_lantern, 'torii': build_torii, 'honden': build_honden, 'greek': build_greek, 'nagara': build_nagara,
            'hanging': build_hanging, 'bridge': build_bridge, 'pagoda': build_pagoda, 'gate': build_gate, 'kund': build_kund}

# ---------------------------------------------------------------------------------------------------------------
# Materials. A small helper to write node graphs.
def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)

def mulrgb(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)

class NB:
    def __init__(self, mat):
        self.mat = mat; self.nt = mat.node_tree; self.nt.nodes.clear()

    def n(self, kind, **kw):
        node = self.nt.nodes.new(kind)
        ins = kw.pop('ins', {})
        for k, v in kw.items():
            setattr(node, k, v)
        for k, v in ins.items():
            self.set(self.inp(node, k), v)
        return node

    @staticmethod
    def inp(node, name):
        if isinstance(name, int):
            return node.inputs[name]
        for s in node.inputs:
            if s.name == name and getattr(s, 'enabled', True):
                return s
        return node.inputs[name]

    @staticmethod
    def out(node, name=0):
        if isinstance(name, int):
            outs = [s for s in node.outputs if getattr(s, 'enabled', True)]
            return outs[name]
        for s in node.outputs:
            if s.name == name and getattr(s, 'enabled', True):
                return s
        return node.outputs[name]

    def set(self, sock, v):
        if hasattr(v, 'is_output') or isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            if sock.type == 'RGBA' and isinstance(v, (int, float)):
                v = (v, v, v, 1.0)
            elif sock.type == 'VECTOR' and isinstance(v, (int, float)):
                v = (v, v, v)
            elif sock.type == 'RGBA' and len(v) == 3:
                v = (*v, 1.0)
            sock.default_value = v

    def math(self, op, a, b=None, c=None, clamp=False):
        node = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        self.set(node.inputs[0], a)
        if b is not None:
            self.set(node.inputs[1], b)
        if c is not None:
            self.set(node.inputs[2], c)
        return node.outputs[0]

    def add(self, a, b): return self.math('ADD', a, b)
    def sub(self, a, b): return self.math('SUBTRACT', a, b)
    def mul(self, a, b): return self.math('MULTIPLY', a, b)
    def clamp(self, a): return self.math('ADD', a, 0.0, clamp=True)
    def maxf(self, a, b): return self.math('MAXIMUM', a, b)
    def minf(self, a, b): return self.math('MINIMUM', a, b)

    def smooth(self, x, e0, e1):
        node = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.set(node.inputs['From Min'], e0); self.set(node.inputs['From Max'], e1); self.set(node.inputs['Value'], x)
        return self.out(node, 'Result')

    def vmath(self, op, a, b=None):
        node = self.n('ShaderNodeVectorMath', operation=op)
        self.set(node.inputs[0], a)
        if b is not None:
            self.set(node.inputs[1], b)
        return node.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else node.outputs['Vector']

    def mix(self, a, b, f, blend='MIX'):
        node = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        self.set(self.inp(node, 'Factor'), f); self.set(self.inp(node, 'A'), a); self.set(self.inp(node, 'B'), b)
        return self.out(node, 'Result')

    def mixf(self, a, b, f):
        node = self.n('ShaderNodeMix', data_type='FLOAT')
        self.set(self.inp(node, 'Factor'), f); self.set(self.inp(node, 'A'), a); self.set(self.inp(node, 'B'), b)
        return self.out(node, 'Result')

    def mulc(self, a, b):
        return self.mix(a, b, 1.0, 'MULTIPLY')

    def sep(self, v):
        node = self.n('ShaderNodeSeparateXYZ'); self.set(node.inputs[0], v)
        return node.outputs['X'], node.outputs['Y'], node.outputs['Z']

    def comb(self, x, y, z):
        node = self.n('ShaderNodeCombineXYZ')
        for i, c in enumerate((x, y, z)):
            self.set(node.inputs[i], c)
        return node.outputs[0]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        node = self.n('ShaderNodeTexNoise', noise_dimensions='3D')
        self.set(node.inputs['Vector'], vec); self.set(node.inputs['Scale'], scale); self.set(node.inputs['Detail'], detail)
        self.set(node.inputs['Roughness'], rough); self.set(node.inputs['Distortion'], dist)
        return node.outputs['Fac']

    def voronoi(self, vec, scale, rand=1.0, out='Distance'):
        node = self.n('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1')
        self.set(node.inputs['Vector'], vec); self.set(node.inputs['Scale'], scale); self.set(node.inputs['Randomness'], rand)
        return node.outputs[out]

    def img(self, path, vec, color=True, blend=0.3):
        node = self.n('ShaderNodeTexImage', projection='BOX', projection_blend=blend, interpolation='Cubic')
        im = bpy.data.images.load(path, check_existing=True)
        im.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
        node.image = im
        self.set(node.inputs['Vector'], vec)
        return node.outputs['Color']

    def bw(self, c):
        node = self.n('ShaderNodeRGBToBW'); self.set(node.inputs[0], c); return node.outputs[0]

    def hsv(self, c, h=0.5, s=1.0, v=1.0):
        node = self.n('ShaderNodeHueSaturation')
        self.set(node.inputs['Hue'], h); self.set(node.inputs['Saturation'], s); self.set(node.inputs['Value'], v); self.set(node.inputs['Color'], c)
        return node.outputs[0]

    def attr(self, name):
        return self.out(self.n('ShaderNodeAttribute', attribute_name=name), 'Fac')

    def ao(self, dist, samples=16):
        if 'noao' in OPTS:
            return self.math('ADD', 1.0, 0.0)
        node = self.n('ShaderNodeAmbientOcclusion', only_local=True, samples=samples)
        self.set(node.inputs['Distance'], dist)
        return node.outputs['AO']


def tex_path(name):
    for ext in ('jpg', 'png'):
        p = os.path.join(TEX, f'{name}.{ext}')
        if os.path.exists(p):
            return p
    raise FileNotFoundError(name)

MATERIALS = {}   # key -> (material, emission node, principled node, output node)

def surface(key, base, **W):
    """One weathered surface. base: dict(tex=<poly haven id>, scale=metres per repeat, tint=rgb, axis=False) for a
    scanned material, or dict(color=rgb, color2=rgb, scale=...) for a painted / plain one. W: weathering amounts."""
    mat = bpy.data.materials.new(key)
    g = NB(mat)
    tc = g.n('ShaderNodeTexCoord')
    co = g.out(tc, 'Object')
    geo = g.n('ShaderNodeNewGeometry')
    N = g.out(geo, 'Normal')
    nx, ny, nz = g.sep(N)
    px, py, pz = g.sep(co)
    var = g.attr('var')
    var2 = g.math('FRACT', g.mul(var, 7.31))
    var3 = g.math('FRACT', g.mul(var, 13.7))
    ptop = g.attr('ptop')
    # Texture space: offset per part; wood turns its grain along the part's axis (attribute gaxis: 0 up, 1 x, 2 y).
    off = g.vmath('MULTIPLY', g.comb(var, var2, var3), (17.3, 9.1, 5.7))
    cov = co
    if base.get('axis'):
        gax = g.attr('gaxis')
        fx = g.smooth(gax, 0.5, 0.6); fy = g.smooth(gax, 1.5, 1.6)
        alongx = g.comb(pz, py, px)
        alongy = g.comb(px, pz, py)
        node = g.n('ShaderNodeMix', data_type='VECTOR')
        g.set(g.inp(node, 'Factor'), g.sub(fx, fy)); g.set(g.inp(node, 'A'), co); g.set(g.inp(node, 'B'), alongx)
        v1 = g.out(node, 'Result')
        node = g.n('ShaderNodeMix', data_type='VECTOR')
        g.set(g.inp(node, 'Factor'), fy); g.set(g.inp(node, 'A'), v1); g.set(g.inp(node, 'B'), alongy)
        cov = g.out(node, 'Result')
    tv = g.vmath('ADD', g.vmath('MULTIPLY', cov, 1.0 / base.get('scale', 2.0)), off)
    height = 0.0
    if 'tex' in base:
        col = g.img(tex_path(base['tex'] + '_d'), tv)
        col = g.mulc(col, base.get('tint', (1, 1, 1)))
        if base.get('desat'):
            col = g.hsv(col, 0.5, 1 - base['desat'], 1.0)
        try:
            h = g.bw(g.img(tex_path(base['tex'] + '_h'), tv, color=False))
            height = g.mul(g.sub(h, 0.5), base.get('bump', 0.004))
        except FileNotFoundError:
            pass
    else:
        n1 = g.noise(tv, 3.0, 6.0, 0.6)
        col = g.mix(base['color'], base.get('color2', base['color']), g.smooth(n1, 0.35, 0.7))
        height = g.mul(g.sub(g.noise(tv, 40.0, 4.0, 0.5), 0.5), base.get('bump', 0.0015))
    # Part to part: a little hue and a little value.
    hv, vv = W.get('hue_var', 0.012), W.get('val_var', 0.08)
    col = g.hsv(col, g.add(0.5 - hv / 2, g.mul(var, hv)), g.add(1 - W.get('sat_var', 0.1) / 2, g.mul(var3, W.get('sat_var', 0.1))),
                g.add(1 - vv / 2, g.mul(var2, vv)))
    # Paint over the substrate, worn back at the edges and in patches.
    ao_s = g.ao(W.get('ao_small', 0.22), 4)
    ao_b = g.ao(W.get('ao_big', 1.6), 4)
    bev = g.n('ShaderNodeBevel', samples=4); g.set(bev.inputs['Radius'], W.get('edge_r', 0.012))
    edge = g.smooth(g.sub(1.0, g.vmath('DOT_PRODUCT', g.out(bev, 'Normal'), N)), 0.01, 0.12)
    convex = g.mul(edge, g.smooth(ao_s, 0.78, 0.97))
    crev = g.sub(1.0, ao_s)
    if 'paint' in W:
        pw = W['paint']
        pn = g.noise(g.vmath('MULTIPLY', co, 1.0), 1.4, 5.0, 0.6)
        paint = g.mix(pw['color'], pw.get('color2', pw['color']), g.smooth(pn, 0.3, 0.75))
        # sun-faded on top
        paint = g.mix(paint, pw.get('faded', pw['color']), g.mul(g.smooth(nz, 0.3, 0.95), pw.get('fade', 0.5)))
        wear_mask = g.add(g.mul(convex, pw.get('edge_wear', 1.2)), 0.0)
        if pw.get('patches'):
            pm = g.bw(g.img(tex_path('japanese_sycamore_d'), g.vmath('MULTIPLY', tv, pw.get('patch_scale', 1.5))))
            big = g.noise(co, 0.6, 3.0, 0.5)
            wear_mask = g.add(wear_mask, g.mul(g.smooth(pm, 0.62, 0.7), g.mul(g.smooth(big, 0.45, 0.65), pw['patches'])))
        wear_mask = g.add(g.mul(g.smooth(g.noise(co, 9.0, 4.0, 0.6), 0.45, 0.8), g.mul(convex, 0.6)), wear_mask)
        under = g.mulc(col, pw.get('under', (1, 1, 1)))
        col = g.mix(paint, under, g.clamp(wear_mask))
    # Large-scale patina (sun and rain colour the stone over decades)
    if W.get('patina'):
        pn = g.noise(co, W.get('patina_scale', 0.35), 4.0, 0.55)
        col = g.mix(col, g.mulc(col, W['patina_col']), g.mul(g.smooth(pn, 0.4, 0.7), W['patina']))
    # Grime in crevices
    col = g.mix(col, W.get('grime_col', (0.05, 0.045, 0.035)), g.mul(g.smooth(crev, 0.08, 0.7), W.get('grime', 0.6)))
    # Worn, lighter edges and chips
    col = g.mix(col, g.mulc(col, W.get('edge_col', (1.18, 1.15, 1.1))), g.mul(convex, W.get('wear', 0.5)))
    chipn = g.noise(co, W.get('chip_scale', 10.0), 3.0, 0.6)
    chip = g.mul(convex, g.smooth(chipn, 0.58, 0.64))
    if W.get('chips'):
        col = g.mix(col, W.get('chip_col', (0.75, 0.72, 0.66)), g.mul(chip, W['chips']))
        height = g.add(height, g.mul(chip, -W.get('chip_depth', 0.004)))
    # Rain streaks, from the top of each part down its vertical faces
    vert = g.sub(1.0, g.smooth(g.math('ABSOLUTE', nz), 0.15, 0.55))
    if W.get('streak'):
        drip = g.math('EXPONENT', g.math('DIVIDE', g.sub(pz, ptop), W.get('drip_len', 1.5)))
        sv = g.comb(g.mul(px, 1.0), g.mul(py, 1.0), g.mul(pz, 0.035))
        sn = g.noise(sv, W.get('streak_scale', 28.0), 3.0, 0.55)
        sn2 = g.noise(co, 0.8, 2.0, 0.5)
        streak = g.mul(g.mul(vert, g.smooth(sn, 0.48, 0.72)), g.mul(g.add(0.25, g.mul(drip, 0.75)), g.smooth(sn2, 0.3, 0.6)))
        col = g.mix(col, W.get('streak_col', (0.08, 0.075, 0.065)), g.mul(streak, W['streak']))
    # Water at the foot: an algae and tide band (the torii)
    if W.get('algae'):
        top = W['algae']
        ln = g.mul(g.sub(g.noise(co, 3.0, 3.0, 0.5), 0.5), 0.12)
        band = g.sub(1.0, g.smooth(g.add(pz, ln), top - 0.08, top + 0.02))
        acol = g.mix((0.05, 0.065, 0.03), (0.13, 0.12, 0.06), g.smooth(g.noise(co, 6.0, 4.0, 0.6), 0.3, 0.7))
        col = g.mix(col, acol, g.mul(band, 0.92))
        tide = g.mul(g.smooth(g.add(pz, ln), top + 0.0, top + 0.06), g.sub(1.0, g.smooth(g.add(pz, ln), top + 0.08, top + 0.3)))
        col = g.mix(col, (0.55, 0.52, 0.46), g.mul(tide, 0.35))
    # Moss where water sits: up-facing surfaces and the foot; lichen spots everywhere exposed
    if W.get('moss'):
        up = g.smooth(nz, W.get('moss_up', 0.55), 0.92)
        dco = g.vmath('ADD', co, g.vmath('MULTIPLY', g.out(g.n('ShaderNodeTexNoise', ins={'Vector': co, 'Scale': 1.5}), 'Color'), 0.25))
        mn = g.noise(dco, W.get('moss_scale', 2.2), 6.0, 0.62)
        moss = g.mul(up, g.smooth(mn, W.get('moss_t', 0.5), W.get('moss_t', 0.5) + 0.12))
        moss = g.add(moss, g.mul(g.mul(up, crev), 1.5))
        if W.get('moss_foot'):
            foot = g.sub(1.0, g.smooth(pz, 0.0, W['moss_foot']))
            moss = g.add(moss, g.mul(foot, g.smooth(mn, 0.4, 0.55)))
        moss = g.mul(g.clamp(moss), W['moss'])
        mcol = g.mix(W.get('moss_col', (0.035, 0.055, 0.012)), W.get('moss_col2', (0.10, 0.11, 0.025)), g.smooth(g.noise(co, 8.0, 5.0, 0.6), 0.3, 0.7))
        mcol = g.mix(mcol, g.mulc(mcol, 0.45), crev)
        col = g.mix(col, mcol, moss)
        height = g.add(height, g.mul(moss, 0.003))
    if W.get('lichen'):
        # crustose lichen: irregular rosettes of two sizes, pale grey-green and a little ochre, and dark spots
        ls = W.get('lichen_scale', 9.0)
        warp = g.vmath('MULTIPLY', g.out(g.n('ShaderNodeTexNoise', ins={'Vector': co, 'Scale': ls * 0.6, 'Detail': 4.0}), 'Color'), 2.2 / ls)
        dco = g.vmath('ADD', co, warp)
        d1 = g.voronoi(dco, ls); d2 = g.voronoi(g.vmath('ADD', dco, (3.1, 1.7, 0.4)), ls * 2.3)
        grain = g.noise(co, ls * 6.0, 2.0, 0.5)
        rose = g.maxf(g.sub(1.0, g.smooth(d1, 0.1, 0.42)), g.sub(1.0, g.smooth(d2, 0.08, 0.3)))
        rose = g.mul(rose, g.smooth(grain, 0.3, 0.55))
        where = g.smooth(g.noise(co, 1.1, 3.0, 0.5), 0.42, 0.62)
        lc = g.mix(W.get('lichen_col', (0.42, 0.44, 0.34)), W.get('lichen_col2', (0.55, 0.42, 0.18)), g.smooth(g.noise(co, 2.5), 0.58, 0.64))
        lc = g.mix(lc, g.mulc(lc, 0.7), g.noise(co, ls * 3.0))
        col = g.mix(col, lc, g.mul(g.mul(rose, where), W['lichen'] * 0.8))
        dk = g.voronoi(g.vmath('MULTIPLY', dco, 1.7), ls * 1.4)
        dark = g.mul(g.sub(1.0, g.smooth(dk, 0.06, 0.24)), g.smooth(g.noise(co, 0.9, 3.0, 0.5), 0.48, 0.66))
        col = g.mix(col, (0.045, 0.045, 0.04), g.mul(g.mul(dark, g.smooth(grain, 0.25, 0.5)), W['lichen'] * W.get('dark_lichen', 0.6)))
    # Granite: black mica and white feldspar grains
    if W.get('speckle'):
        sp1 = g.voronoi(co, W.get('speckle_scale', 260.0))
        sp2 = g.voronoi(g.vmath('ADD', co, (0.37, 0.11, 0.73)), W.get('speckle_scale', 260.0) * 0.7)
        col = g.mix(col, (0.03, 0.03, 0.03), g.mul(g.sub(1.0, g.smooth(sp1, 0.12, 0.25)), W['speckle']))
        col = g.mix(col, g.mulc(col, 1.45), g.mul(g.sub(1.0, g.smooth(sp2, 0.15, 0.32)), W['speckle'] * 0.7))
    # Metal sheen faked into the colour (gilt and bronze): brighter where the face looks up at the sky
    if W.get('sheen'):
        col = g.mix(col, g.mulc(col, W.get('sheen_col', (1.7, 1.55, 1.25))), g.mul(g.smooth(nz, 0.05, 0.95), W['sheen']))
    # Soil splash at the very foot
    if W.get('splash', 0.0):
        sp = g.sub(1.0, g.smooth(pz, 0.0, W.get('splash_h', 0.35)))
        col = g.mix(col, g.mulc(col, (0.55, 0.5, 0.42)), g.mul(sp, W['splash']))
    # The occlusion that the game cannot compute: multiplied into the colour
    col = g.mulc(col, g.mix(1.0, ao_b, W.get('ao_mult', 0.55)))
    col = g.mulc(col, g.mix(1.0, ao_s, W.get('ao_small_mult', 0.35)))
    # Shaders
    bump = g.n('ShaderNodeBump', ins={'Strength': 1.0, 'Distance': 1.0})
    g.set(g.inp(bump, 'Height'), height)
    bsdf = g.n('ShaderNodeBsdfPrincipled', ins={'Roughness': W.get('rough', 0.75), 'Metallic': 0.0})
    g.set(g.inp(bsdf, 'Base Color'), col)
    g.set(g.inp(bsdf, 'Normal'), g.out(bump, 'Normal'))
    em = g.n('ShaderNodeEmission', ins={'Strength': 1.0}); g.set(g.inp(em, 'Color'), col)
    outn = g.n('ShaderNodeOutputMaterial', target='CYCLES')
    g.nt.links.new(bsdf.outputs[0], outn.inputs['Surface'])
    MATERIALS[key] = (mat, em, bsdf, outn)
    return mat

def use_output(kind):
    for mat, em, bsdf, outn in MATERIALS.values():
        src = em.outputs[0] if kind == 'emit' else bsdf.outputs[0]
        mat.node_tree.links.new(src, outn.inputs['Surface'])

WOOD = dict(tex='rough_wood', scale=1.8, axis=True, tint=(0.8, 0.68, 0.55), bump=0.0025)
LACQUER = dict(color=srgb('#b9321b')[:3], color2=srgb('#8f2314')[:3], faded=srgb('#d4673b')[:3], fade=0.55, edge_wear=1.0,
               patches=0.75, patch_scale=0.8, under=(0.3, 0.22, 0.18))
BLACK = dict(color=(0.016, 0.014, 0.013), color2=(0.03, 0.026, 0.022), faded=(0.075, 0.068, 0.06), fade=0.6, edge_wear=0.8,
             patches=0.35, patch_scale=0.8, under=(0.45, 0.33, 0.25))
RECIPES = {
    'granite': lambda: surface('granite', dict(tex='rock_01', scale=0.9, tint=(0.92, 0.9, 0.86), desat=0.2, bump=0.004),
            grime=0.75, grime_col=(0.035, 0.035, 0.03), wear=0.35, chips=0.5, chip_col=(0.36, 0.35, 0.33), chip_scale=26,
            streak=0.55, drip_len=0.35, streak_scale=60, moss=0.95, moss_up=0.45, moss_scale=6.0, moss_t=0.46, moss_foot=0.25,
            lichen=0.7, lichen_scale=14.0, speckle=0.55, lichen_col=(0.36, 0.39, 0.31), lichen_col2=(0.6, 0.5, 0.25), patina=0.5,
            patina_col=(0.82, 0.86, 0.72), patina_scale=2.0, ao_small=0.06, ao_big=0.35, edge_r=0.006, splash=0.4, splash_h=0.2,
            hue_var=0.0, val_var=0.0, rough=0.85),
    'lacquer': lambda: surface('lacquer', WOOD, paint=LACQUER, grime=0.55, grime_col=(0.05, 0.02, 0.012), wear=0.2,
            streak=0.75, streak_col=(0.06, 0.03, 0.02), drip_len=3.5, streak_scale=22, algae=TORII['algae'] if PRESET == 'torii' else 0,
            moss=0.25, moss_up=0.75, moss_t=0.56, lichen=0.12, lichen_scale=6.0, ao_small=0.15, ao_big=1.2, edge_r=0.015,
            hue_var=0.01, val_var=0.06, rough=0.55),
    'black': lambda: surface('black', WOOD, paint=BLACK, grime=0.3, wear=0.2, streak=0.3, streak_col=(0.12, 0.11, 0.1),
            drip_len=1.0, algae=TORII['algae'] if PRESET == 'torii' else 0, moss=0.3, moss_up=0.7, moss_t=0.55, lichen=0.15,
            lichen_scale=8.0, ao_small=0.15, ao_big=1.0, edge_r=0.012, rough=0.5),
    'gold': lambda: surface('gold', dict(color=(0.5, 0.34, 0.09), color2=(0.66, 0.48, 0.15), scale=0.4, bump=0.0008), sheen=0.7,
            grime=0.85, grime_col=(0.04, 0.03, 0.015), wear=0.6, edge_col=(1.3, 1.25, 1.1), streak=0.35, streak_col=(0.12, 0.16, 0.12),
            drip_len=0.4, patina=0.35, patina_col=(0.55, 0.75, 0.6), patina_scale=3.0, ao_small=0.06, ao_big=0.5, edge_r=0.006,
            hue_var=0.0, val_var=0.04, rough=0.4),
    'wood': lambda: surface('wood', dict(tex='rough_wood', scale=1.6, axis=True, tint=(0.86, 0.8, 0.72), desat=0.3, bump=0.003),
            grime=0.55, grime_col=(0.05, 0.045, 0.04), wear=0.25, streak=0.45, streak_col=(0.09, 0.08, 0.07), drip_len=1.2,
            moss=0.35, moss_up=0.7, moss_t=0.56, lichen=0.25, lichen_scale=7.0, ao_small=0.12, ao_big=1.0, edge_r=0.01, rough=0.8),
    'darkwood': lambda: surface('darkwood', dict(tex='rough_wood', scale=1.4, axis=True, tint=(0.42, 0.3, 0.21), bump=0.002),
            grime=0.45, wear=0.4, edge_col=(1.4, 1.3, 1.2), streak=0.3, drip_len=1.0, ao_small=0.1, ao_big=0.8, edge_r=0.008, rough=0.7),
    'plaster': lambda: surface('plaster', dict(tex='painted_plaster_wall', scale=2.5, tint=(1.12, 1.1, 1.04), desat=0.6, bump=0.0015),
            grime=0.5, grime_col=(0.12, 0.1, 0.08), wear=0.15, streak=0.6, streak_col=(0.32, 0.29, 0.24), drip_len=0.9,
            streak_scale=18, splash=0.35, splash_h=0.25, moss=0.12, moss_foot=0.4, ao_small=0.15, ao_big=1.0, hue_var=0.004,
            val_var=0.03, rough=0.9),
    'bark': lambda: surface('bark', dict(tex='japanese_cedar_bark', scale=1.3, axis=True, tint=(0.78, 0.64, 0.52), bump=0.006),
            grime=0.6, grime_col=(0.03, 0.025, 0.02), wear=0.1, streak=0.2, drip_len=0.5, moss=0.85, moss_up=0.35,
            moss_scale=1.6, moss_t=0.52, moss_col=(0.03, 0.05, 0.012), moss_col2=(0.085, 0.1, 0.03), lichen=0.35, lichen_scale=5.0,
            lichen_col=(0.4, 0.42, 0.33), patina=0.4, patina_col=(0.7, 0.72, 0.68), patina_scale=0.5, ao_small=0.2, ao_big=1.4,
            edge_r=0.012, hue_var=0.0, val_var=0.0, rough=0.9),
    'copper': lambda: surface('copper', dict(color=(0.16, 0.38, 0.31), color2=(0.27, 0.5, 0.42), scale=0.6, bump=0.0008),
            grime=0.6, grime_col=(0.04, 0.06, 0.05), wear=0.4, edge_col=(1.6, 0.9, 0.6), streak=0.6, streak_col=(0.06, 0.1, 0.08),
            drip_len=0.3, patina=0.5, patina_col=(0.7, 0.85, 0.8), patina_scale=1.5, lichen=0.1, ao_small=0.08, ao_big=0.6,
            edge_r=0.01, hue_var=0.0, val_var=0.03, rough=0.6),
    'marble': lambda: surface('marble', dict(tex='marble_cliff_05', scale=2.6, tint=(1.42, 1.36, 1.24), desat=0.55, bump=0.0025),
            grime=0.35, grime_col=(0.2, 0.18, 0.15), wear=0.25, edge_col=(1.08, 1.07, 1.05), chips=0.4,
            chip_col=(0.88, 0.86, 0.82), chip_scale=7.0, chip_depth=0.006, streak=0.32, streak_col=(0.38, 0.36, 0.32),
            drip_len=1.6, streak_scale=16, patina=0.45, patina_col=(1.02, 0.9, 0.74), patina_scale=0.3, moss=0.25,
            moss_up=0.65, moss_t=0.57, moss_col=(0.12, 0.13, 0.06), moss_col2=(0.25, 0.25, 0.12), lichen=0.32, lichen_scale=5.0,
            lichen_col=(0.68, 0.69, 0.6), lichen_col2=(0.72, 0.52, 0.22), dark_lichen=0.25, splash=0.18, splash_h=0.35,
            ao_small=0.2, ao_big=1.4, ao_mult=0.35, ao_small_mult=0.25, edge_r=0.015, hue_var=0.01, val_var=0.07, rough=0.7),
    'terracotta': lambda: surface('terracotta', dict(color=(0.5, 0.235, 0.13), color2=(0.6, 0.32, 0.19), scale=1.5, bump=0.002),
            grime=0.5, grime_col=(0.05, 0.035, 0.025), wear=0.2, streak=0.4, streak_col=(0.12, 0.1, 0.08), drip_len=1.0,
            moss=0.45, moss_up=0.2, moss_t=0.56, lichen=0.6, lichen_scale=4.0, lichen_col=(0.55, 0.55, 0.45),
            lichen_col2=(0.7, 0.55, 0.2), patina=0.5, patina_col=(0.75, 0.75, 0.7), patina_scale=0.4, ao_small=0.12,
            ao_big=1.2, hue_var=0.02, val_var=0.12, rough=0.8),
    'sandstone': lambda: surface('sandstone', dict(tex='sandstone_blocks_04', scale=3.2, tint=(1.18, 1.0, 0.78), desat=0.15, bump=0.004),
            grime=0.55, grime_col=(0.09, 0.075, 0.06), wear=0.3, edge_col=(1.12, 1.08, 1.02), chips=0.3,
            chip_col=(0.78, 0.66, 0.5), chip_scale=6.0, chip_depth=0.006, streak=0.5, streak_col=(0.16, 0.15, 0.13),
            drip_len=1.4, streak_scale=14, patina=0.45, patina_col=(0.72, 0.7, 0.66), patina_scale=0.22, moss=0.35,
            moss_up=0.62, moss_t=0.56, moss_col=(0.07, 0.08, 0.03), moss_col2=(0.17, 0.17, 0.08), lichen=0.45, lichen_scale=4.5,
            lichen_col=(0.68, 0.68, 0.6), lichen_col2=(0.7, 0.48, 0.18), dark_lichen=0.45, splash=0.2, splash_h=0.5,
            ao_small=0.25, ao_big=1.6, ao_mult=0.4, ao_small_mult=0.3, edge_r=0.015, hue_var=0.015, val_var=0.09, rough=0.85),
    'shade': lambda: surface('shade', dict(tex='sandstone_blocks_04', scale=3.2, tint=(0.22, 0.18, 0.14), bump=0.002),
            grime=0.8, wear=0.0, ao_small=0.3, ao_big=1.5, ao_mult=0.7, hue_var=0.0, val_var=0.0, rough=0.9),
    'bronze': lambda: surface('bronze', dict(color=(0.15, 0.105, 0.065), color2=(0.22, 0.155, 0.09), scale=0.5, bump=0.0008), sheen=0.35,
            grime=0.75, grime_col=(0.1, 0.22, 0.17), wear=0.75, edge_col=(2.3, 1.8, 1.2), streak=0.55, streak_col=(0.16, 0.3, 0.24),
            drip_len=0.25, streak_scale=40, patina=0.65, patina_col=(1.25, 2.3, 2.0), patina_scale=4.0, lichen=0.0,
            ao_small=0.05, ao_big=0.3, edge_r=0.004, hue_var=0.0, val_var=0.05, rough=0.45),
    'paper': lambda: surface('paper', dict(color=(0.86, 0.78, 0.6), color2=(0.92, 0.85, 0.66), scale=0.25, bump=0.0004),
            grime=0.35, grime_col=(0.25, 0.2, 0.12), wear=0.0, streak=0.25, streak_col=(0.55, 0.45, 0.3), drip_len=0.2,
            ao_small=0.05, ao_big=0.2, ao_mult=0.3, hue_var=0.0, val_var=0.05, rough=0.9),
    'tile': lambda: surface('tile', dict(tex='rock_01', scale=0.8, tint=(0.36, 0.37, 0.39), desat=0.7, bump=0.002),
            grime=0.6, grime_col=(0.02, 0.02, 0.022), wear=0.4, edge_col=(1.5, 1.5, 1.5), streak=0.5, streak_col=(0.32, 0.31, 0.29),
            drip_len=0.6, streak_scale=30, moss=0.4, moss_up=0.4, moss_t=0.58, moss_col=(0.04, 0.05, 0.02), lichen=0.55,
            lichen_scale=6.0, lichen_col=(0.5, 0.52, 0.45), lichen_col2=(0.62, 0.5, 0.22), dark_lichen=0.2, ao_small=0.12,
            ao_big=0.9, hue_var=0.0, val_var=0.06, rough=0.6),
    'sandkund': lambda: surface('sandkund', dict(tex='sandstone_blocks_04', scale=3.2, tint=(1.0, 0.86, 0.68), desat=0.15, bump=0.004),
            grime=0.75, grime_col=(0.055, 0.045, 0.035), wear=0.35, edge_col=(1.15, 1.1, 1.02), chips=0.35, chip_col=(0.72, 0.6, 0.45),
            chip_scale=6.0, chip_depth=0.006, streak=0.6, streak_col=(0.11, 0.1, 0.09), drip_len=0.8, streak_scale=14, patina=0.6,
            patina_col=(0.62, 0.6, 0.56), patina_scale=0.22, moss=0.5, moss_up=0.6, moss_t=0.52, moss_col=(0.05, 0.06, 0.02),
            moss_col2=(0.14, 0.14, 0.06), lichen=0.5, lichen_scale=4.5, lichen_col=(0.62, 0.62, 0.55), lichen_col2=(0.66, 0.44, 0.15),
            dark_lichen=0.7, algae=-3.25, ao_small=0.3, ao_big=2.0, ao_mult=0.6, edge_r=0.015, hue_var=0.015, val_var=0.1, rough=0.85),
}

def make_materials():
    for key in sorted(set(LO.fm) | set(HI.fm)):
        RECIPES[key]()

# ---------------------------------------------------------------------------------------------------------------
def build_object(acc, name, with_attrs):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(acc.v, [], acc.f)
    mesh.update()
    keys = sorted(set(acc.fm))
    for k in keys:
        mesh.materials.append(MATERIALS[k][0] if k in MATERIALS else bpy.data.materials.new(k))
    idx = {k: i for i, k in enumerate(keys)}
    mesh.polygons.foreach_set('material_index', [idx[k] for k in acc.fm])
    if with_attrs:
        a = mesh.attributes.new('var', 'FLOAT', 'FACE'); a.data.foreach_set('value', acc.fv)
        a = mesh.attributes.new('gaxis', 'FLOAT', 'FACE'); a.data.foreach_set('value', [float(x) for x in acc.fa])
        a = mesh.attributes.new('ptop', 'FLOAT', 'POINT'); a.data.foreach_set('value', acc.vt)
    if any(acc.fx):
        bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
        bmesh.ops.recalc_face_normals(bm, faces=[bm.faces[i] for i, a in enumerate(acc.fx) if a])
        bm.to_mesh(mesh); bm.free()
    mesh.shade_smooth()
    mesh.set_sharp_from_angle(angle=math.radians(CFG['sharp']))
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def select_only(*obs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]

def clean(ob):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.dissolve_degenerate(threshold=0.0001)
    bpy.ops.object.mode_set(mode='OBJECT')

def unwrap(ob):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # Thousands of small islands: the margin must be a fixed fraction of the atlas (two texels), not one scaled
    # with every island, or the margins eat the atlas and small faces shrink below a texel and never bake.
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=2.0 / ATLAS, margin_method='FRACTION', rotate=True, shape_method='CONCAVE')
    bpy.ops.object.mode_set(mode='OBJECT')

def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def setup_cycles(samples):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.render.threads_mode = 'AUTO'
    return sc

def bake(lo, hi):
    sc = setup_cycles(BAKE_SAMPLES)
    sc.cycles.use_denoising = False
    col = bpy.data.images.new(CFG['name'] + '_col', ATLAS, ATLAS); col.colorspace_settings.name = 'sRGB'
    nrm = bpy.data.images.new(CFG['name'] + '_nrm', ATLAS, ATLAS); nrm.colorspace_settings.name = 'Non-Color'
    tgt = bpy.data.materials.new('bake_target')
    node = tgt.node_tree.nodes.new('ShaderNodeTexImage'); tgt.node_tree.nodes.active = node
    lo.data.materials.clear(); lo.data.materials.append(tgt)
    b = sc.render.bake
    b.use_selected_to_active = True; b.cage_extrusion = CFG['cage']; b.max_ray_distance = CFG['ray']
    b.margin = 6 if ATLAS >= 2048 else 4; b.margin_type = 'EXTEND'; b.target = 'IMAGE_TEXTURES'
    select_only(hi, lo, active=lo)
    t = time.time()
    node.image = col; use_output('emit')
    bpy.ops.object.bake(type='EMIT')
    print(f'BAKE colour {time.time() - t:.0f} s'); t = time.time()
    node.image = nrm; use_output('bsdf')
    sc.cycles.samples = max(4, BAKE_SAMPLES // 4)
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', normal_r='POS_X', normal_g='POS_Y', normal_b='POS_Z')
    print(f'BAKE normal {time.time() - t:.0f} s')
    for im, suffix in ((col, 'col'), (nrm, 'nrm')):
        im.filepath_raw = os.path.join(OUT, f"{CFG['name']}_{suffix}.png"); im.file_format = 'PNG'; im.save()
    return col, nrm

def atlas_material(col, nrm):
    mat = bpy.data.materials.new(CFG['name'])
    nt = mat.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.inputs['Roughness'].default_value = 0.8; bsdf.inputs['Metallic'].default_value = 0.0
    tc = nt.nodes.new('ShaderNodeTexImage'); tc.image = col
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = nrm
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    return mat

def probe(lo, img):
    """Average baked colour of the faces whose centres fall in a few named boxes (debugging the bake)."""
    W = img.size[0]
    px = img.pixels[:]
    me = lo.data
    uv = me.uv_layers.active.data
    boxes = {
        'column shaft': lambda c: abs(c.y + GREEK['axis'][1]) < 0.6 and 2.5 < c.z < 5.0 and abs(c.x) < 7,
        'stylobate': lambda c: abs(c.z - GREEK['steps'][3]) < 0.02 and abs(c.x) < 4,
        'riser': lambda c: c.y < -16.0 and 0.2 < c.z < 0.9 and abs(c.x) < 4,
        'frieze': lambda c: c.y < -15.6 and 7.9 < c.z < 8.5,
        'roof': lambda c: c.z > 9.5 and abs(c.y) < 10,
    } if PRESET == 'greek' else {}
    for name, test in boxes.items():
        acc = [0.0, 0.0, 0.0]; n = 0; black = 0
        for poly in me.polygons:
            if not test(poly.center):
                continue
            # the face's UV centre (its loops sit on island borders, next to the margin)
            us = [uv[li].uv for li in poly.loop_indices]
            u = sum(q[0] for q in us) / len(us); v = sum(q[1] for q in us) / len(us)
            i = (min(W - 1, max(0, int(v * W))) * W + min(W - 1, max(0, int(u * W)))) * 4
            for k in range(3):
                acc[k] += px[i + k]
            black += px[i] + px[i + 1] + px[i + 2] < 0.03
            n += 1
        print('PROBE', name, n, 'faces, mean', [round(a / max(n, 1), 3) for a in acc], 'black', black)

def uv_report(ob):
    """How well the atlas is used: share of a 256 grid covered once, and covered more than once (overlaps)."""
    import numpy as np
    N = 256
    cov = np.zeros((N, N), dtype=np.int32)
    me = ob.data; uv = me.uv_layers.active.data
    me.calc_loop_triangles()
    lo_u = [9, 9]; hi_u = [-9, -9]
    for tri in me.loop_triangles:
        pts = [uv[li].uv for li in tri.loops]
        for q in pts:
            lo_u = [min(lo_u[0], q[0]), min(lo_u[1], q[1])]; hi_u = [max(hi_u[0], q[0]), max(hi_u[1], q[1])]
        xs = [q[0] * N for q in pts]; ys = [q[1] * N for q in pts]
        x0, x1 = max(0, int(min(xs))), min(N - 1, int(max(xs)))
        y0, y1 = max(0, int(min(ys))), min(N - 1, int(max(ys)))
        (ax, ay), (bx, by), (cx_, cy_) = zip(xs, ys)
        d = (by - cy_) * (ax - cx_) + (cx_ - bx) * (ay - cy_)
        if abs(d) < 1e-12:
            continue
        for gy in range(y0, y1 + 1):
            for gx in range(x0, x1 + 1):
                px_, py_ = gx + 0.5, gy + 0.5
                l1 = ((by - cy_) * (px_ - cx_) + (cx_ - bx) * (py_ - cy_)) / d
                l2 = ((cy_ - ay) * (px_ - cx_) + (ax - cx_) * (py_ - cy_)) / d
                if l1 >= 0 and l2 >= 0 and l1 + l2 <= 1:
                    cov[gy, gx] += 1
    print(f'UV range {lo_u} .. {hi_u}; covered {np.mean(cov > 0):.2f}, overlapped {np.mean(cov > 1):.2f}')

def make_lod1(lo):
    me = lo.data.copy(); me.name = 'lod1'; ob = bpy.data.objects.new('lod1', me); bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new('dec', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'; mod.ratio = CFG['lod1']
    mod.use_collapse_triangulate = True
    select_only(ob); bpy.ops.object.modifier_apply(modifier='dec')
    return ob

def export(lo, lod1):
    path = os.path.join(OUT, CFG['name'] + '.glb')
    select_only(lo, lod1)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_tangents=False, export_attributes=False,
                              export_vertex_color='NONE', export_materials='EXPORT', export_image_format='AUTO',
                              export_cameras=False, export_lights=False, export_animations=False)
    return path

# ---------------------------------------------------------------------------------------------------------------
# Renders under Haven-like light: a warm low sun (#ffd8b0, 30 degrees up), a teal sky, grass underfoot.
VIEWS = {
    'lantern': {
        'hero': dict(loc=(-2.6, -4.4, 1.5), at=(0, 0, 1.05), lens=35),
        'detail': dict(loc=(-0.75, -1.25, 1.85), at=(0, 0, 1.62), lens=50),
        'low': dict(loc=(1.4, -2.6, 0.5), at=(0, 0, 1.2), lens=32),
        'far': dict(loc=(-9, -14, 2.0), at=(0, 0, 1.0), lens=50, far=True),
    },
    'torii': {
        'hero': dict(loc=(-13.0, -25.0, 1.9), at=(0.6, 0, 5.6), lens=32),
        'side': dict(loc=(-21.0, -9.0, 3.0), at=(0, 0, 5.0), lens=30),
        'detail': dict(loc=(8.6, -7.4, 7.6), at=(4.6, 0, 9.5), lens=38),
        'far': dict(loc=(-38, -72, 4.0), at=(0, 0, 5.5), lens=50, far=True),
    },
    'greek': {
        'hero': dict(loc=(-21.0, -40.0, 1.8), at=(0.5, -6.0, 5.2), lens=30),
        'front': dict(loc=(-3.0, -36.0, 2.2), at=(0, 0, 6.2), lens=32),
        'detail': dict(loc=(-9.4, -19.6, 6.0), at=(-6.2, -15.4, 7.7), lens=32),
        'colonnade': dict(loc=(-5.1, -14.2, 2.75), at=(-5.0, 6.0, 4.4), lens=24),
        'far': dict(loc=(-75, -125, 8.0), at=(0, 0, 5.5), lens=50, far=True),
    },
    'nagara': {
        'hero': dict(loc=(-24.0, -42.0, 2.2), at=(0.0, -2.0, 9.0), lens=30),
        'front': dict(loc=(-2.0, -40.0, 2.6), at=(0, -4.0, 8.5), lens=34),
        'detail': dict(loc=(-12.5, -6.5, 11.5), at=(-2.5, 3.5, 15.5), lens=32),
        'hall': dict(loc=(-11.0, -14.0, 4.6), at=(-2.0, -5.5, 5.4), lens=28),
        'far': dict(loc=(-80, -130, 8.0), at=(0, 0, 9.0), lens=50, far=True),
    },
    'hanging': {
        'hero': dict(loc=(-1.9, -3.6, 1.55), at=(0.0, -0.35, 1.85), lens=35),
        'detail': dict(loc=(-0.75, -1.95, 2.3), at=(0.0, -0.62, 2.2), lens=50),
        'far': dict(loc=(-5, -9, 1.7), at=(0, -0.3, 1.6), lens=50, far=True),
    },
    'bridge': {
        'hero': dict(loc=(-11.5, -13.0, 1.7), at=(0.0, 0.0, 1.0), lens=30),
        'side': dict(loc=(0.6, -14.0, 0.6), at=(0.0, 0.0, 1.1), lens=30),
        'deck': dict(loc=(-9.4, -0.5, 1.75), at=(0.0, 0.2, 2.1), lens=28),
        'far': dict(loc=(-24, -34, 3.0), at=(0, 0, 1.0), lens=50, far=True),
    },
    'pagoda': {
        'hero': dict(loc=(-27.0, -36.0, 1.8), at=(0.0, 0.0, 14.5), lens=28),
        'low': dict(loc=(-9.5, -13.5, 1.6), at=(0.0, 0.0, 10.0), lens=22),
        'detail': dict(loc=(-5.8, -10.0, 3.2), at=(-2.4, -4.6, 5.8), lens=30),
        'far': dict(loc=(-60, -95, 6.0), at=(0, 0, 15.0), lens=50, far=True),
    },
    'gate': {
        'hero': dict(loc=(-12.5, -17.0, 1.7), at=(0.0, 0.0, 5.0), lens=30),
        'front': dict(loc=(0.0, -15.5, 1.6), at=(0.0, 0.0, 4.6), lens=32),
        'detail': dict(loc=(-8.8, -6.8, 3.6), at=(-5.0, -3.0, 6.6), lens=30),
        'far': dict(loc=(-34, -55, 4.0), at=(0, 0, 5.0), lens=50, far=True),
    },
    'kund': {
        'hero': dict(loc=(-17.0, -20.0, 2.6), at=(0.0, 0.0, -2.4), lens=26),
        'into': dict(loc=(-2.5, -13.4, 1.7), at=(0.0, 1.5, -2.6), lens=24),
        'far': dict(loc=(-45, -60, 9.0), at=(0, 0, -1.5), lens=50, far=True),
    },
    'honden': {
        'hero': dict(loc=(-10.5, -15.5, 1.75), at=(0.2, -0.9, 3.0), lens=30),
        'front': dict(loc=(-2.4, -9.2, 2.2), at=(-0.6, -3.2, 2.9), lens=32),
        'gable': dict(loc=(-11.5, -3.0, 4.2), at=(-3.6, -0.2, 4.6), lens=42),
        'far': dict(loc=(-28, -46, 3.0), at=(0, 0, 3.0), lens=50, far=True),
    },
}

def render_setup():
    sc = setup_cycles(RENDER_SAMPLES)
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    sc.cycles.max_bounces = 6; sc.cycles.diffuse_bounces = 3; sc.cycles.glossy_bounces = 2
    sc.render.resolution_x, sc.render.resolution_y = (640, 360) if QUICK else (1280, 720)
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
    world = bpy.data.worlds.new('haven'); sc.world = world
    nt = world.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld'); bg = nt.nodes.new('ShaderNodeBackground')
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    els = ramp.color_ramp.elements
    els[0].position = 0.0; els[0].color = srgb('#3a4a32')
    els[1].position = 0.5; els[1].color = srgb('#4a726b')
    e = els.new(0.62); e.color = srgb('#33554f')
    e = els.new(1.0); e.color = srgb('#17292c')
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color']); bg.inputs['Strength'].default_value = 2.2
    nt.links.new(bg.outputs[0], out.inputs[0])
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 4.2; sun.data.color = srgb('#ffd8b0')[:3]; sun.data.angle = math.radians(1.0)
    el, az = math.radians(30), math.radians(55)
    d = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))
    sun.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.collection.objects.link(sun)
    # ground
    size = 600
    g = bpy.data.meshes.new('ground')
    g.from_pydata([(-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new('ground', g); sc.collection.objects.link(go)
    gm = bpy.data.materials.new('grass'); nb = NB(gm)
    co = nb.out(nb.n('ShaderNodeTexCoord'), 'Object')
    c = nb.img(tex_path('leafy_grass_d'), nb.vmath('MULTIPLY', co, 1 / 3.0))
    c2 = nb.img(tex_path('leafy_grass_d'), nb.vmath('MULTIPLY', co, 1 / 17.0))
    c = nb.mix(c, c2, 0.35)
    c = nb.mulc(nb.hsv(c, 0.55, 0.9, 1.0), (0.3, 0.46, 0.17))
    bsdf = nb.n('ShaderNodeBsdfPrincipled', ins={'Roughness': 0.95}); nb.set(nb.inp(bsdf, 'Base Color'), c)
    o = nb.n('ShaderNodeOutputMaterial'); nb.nt.links.new(bsdf.outputs[0], o.inputs[0])
    g.materials.append(gm)
    if PRESET == 'kund':
        # the tank's pit cut out of the ground, and water in it (the game draws its own)
        h = KUND['half']
        g.clear_geometry()
        g.from_pydata([(-size, -size, 0), (size, -size, 0), (size, size, 0), (-size, size, 0), (-h, -h, 0), (h, -h, 0), (h, h, 0), (-h, h, 0)], [],
                      [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])
        g.materials.append(gm)
        w = bpy.data.meshes.new('water'); wz = -3.3
        w.from_pydata([(-h, -h, wz), (h, -h, wz), (h, h, wz), (-h, h, wz)], [], [(0, 1, 2, 3)])
        wo = bpy.data.objects.new('water', w); sc.collection.objects.link(wo)
        wm = bpy.data.materials.new('water'); nb = NB(wm)
        bsdf = nb.n('ShaderNodeBsdfPrincipled', ins={'Roughness': 0.05, 'Transmission Weight': 1.0, 'IOR': 1.333, 'Base Color': (0.5, 0.7, 0.62, 1.0)})
        vol = nb.n('ShaderNodeVolumeAbsorption', ins={'Density': 1.4, 'Color': (0.3, 0.55, 0.45, 1.0)})
        o = nb.n('ShaderNodeOutputMaterial'); nb.nt.links.new(bsdf.outputs[0], o.inputs['Surface']); nb.nt.links.new(vol.outputs[0], o.inputs['Volume'])
        w.materials.append(wm)
    if PRESET in ('torii', 'bridge'):
        # shallow water over a sandy bed (the torii at high tide; the bridge's pond between two grassy banks)
        bed = bpy.data.materials.new('bed'); nb = NB(bed); g.materials[0] = bed
        co = nb.out(nb.n('ShaderNodeTexCoord'), 'Object')
        c = nb.mulc(nb.img(tex_path('rock_surface_d'), nb.vmath('MULTIPLY', co, 1 / 4.0)), (0.75, 0.7, 0.6))
        bsdf = nb.n('ShaderNodeBsdfPrincipled', ins={'Roughness': 0.9}); nb.set(nb.inp(bsdf, 'Base Color'), c)
        o = nb.n('ShaderNodeOutputMaterial'); nb.nt.links.new(bsdf.outputs[0], o.inputs[0])
        w = bpy.data.meshes.new('water')
        wz = 0.75 if PRESET == 'torii' else -0.35
        w.from_pydata([(-size, -size, wz), (size, -size, wz), (size, size, wz), (-size, size, wz)], [], [(0, 1, 2, 3)])
        if PRESET == 'bridge':
            go.location.z = -1.4
            for sx in (-1, 1):
                bk = bpy.data.meshes.new('bank')
                x0, x1 = sorted((sx * 7.6, sx * 300.0))
                bk.from_pydata([(x0, -size, 0), (x1, -size, 0), (x1, size, 0), (x0, size, 0), (x0 - sx * 1.5, -size, -1.4), (x0 - sx * 1.5, size, -1.4)], [],
                               [(0, 1, 2, 3), (4, 0, 3, 5) if sx > 0 else (0, 4, 5, 3)])
                bo = bpy.data.objects.new('bank', bk); sc.collection.objects.link(bo)
                bk.materials.append(bpy.data.materials['grass'])
        wo = bpy.data.objects.new('water', w); sc.collection.objects.link(wo)
        wm = bpy.data.materials.new('water'); nb = NB(wm)
        co = nb.out(nb.n('ShaderNodeTexCoord'), 'Object')
        bump = nb.n('ShaderNodeBump', ins={'Strength': 0.25, 'Distance': 0.05})
        nb.set(nb.inp(bump, 'Height'), nb.noise(nb.vmath('MULTIPLY', co, (1.0, 2.5, 1.0)), 1.6, 3.0, 0.5))
        bsdf = nb.n('ShaderNodeBsdfPrincipled', ins={'Roughness': 0.04, 'Transmission Weight': 1.0, 'IOR': 1.333,
                                                      'Base Color': (0.55, 0.75, 0.7, 1.0)})
        nb.set(nb.inp(bsdf, 'Normal'), nb.out(bump, 'Normal'))
        vol = nb.n('ShaderNodeVolumeAbsorption', ins={'Density': 0.9, 'Color': (0.35, 0.6, 0.55, 1.0)})
        o = nb.n('ShaderNodeOutputMaterial'); nb.nt.links.new(bsdf.outputs[0], o.inputs['Surface']); nb.nt.links.new(vol.outputs[0], o.inputs['Volume'])
        w.materials.append(wm)
        sc.cycles.transmission_bounces = 4; sc.cycles.volume_bounces = 0
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.clip_end = 2000
    return sc, cam

def render_views(sc, cam, show, hide, suffix=''):
    for o in hide:
        o.hide_render = True
    for o in show:
        o.hide_render = False
    paths = []
    for vname, v in VIEWS[PRESET].items():
        if ONLY_VIEWS and vname not in ONLY_VIEWS:
            continue
        far = bool(v.get('far'))
        if far != (suffix == '-lod1'):
            continue
        cam.location = v['loc']; cam.data.lens = v['lens']
        cam.rotation_euler = (Vector(v['at']) - Vector(v['loc'])).to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(OUT, f'{PRESET}-{vname}{suffix}.jpg')
        sc.render.filepath = p
        t = time.time()
        bpy.ops.render.render(write_still=True)
        print(f'RENDER {p} {time.time() - t:.0f} s')
        paths.append(p)
    return paths

# ---------------------------------------------------------------------------------------------------------------
def render_glb():
    """Render the exported GLB as it is (what the game gets), without rebuilding or baking."""
    path = os.path.join(OUT, CFG['name'] + '.glb')
    bpy.ops.import_scene.gltf(filepath=path)
    lo = bpy.data.objects['lod0']; lod1 = bpy.data.objects['lod1']
    print(f'IMPORTED {path}: lod0 {tris(lo)} tris, lod1 {tris(lod1)} tris')
    sc, cam = render_setup()
    render_views(sc, cam, [lo], [lod1])
    render_views(sc, cam, [lod1], [lo], '-lod1')

def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    t0 = time.time()
    if 'glbrender' in OPTS:
        render_glb()
        print(f'DONE {time.time() - t0:.0f} s')
        return
    BUILDERS[PRESET]()
    make_materials()
    hi = build_object(HI, 'hi', True)
    lo = build_object(LO, 'lod0', False)
    lo.data.name = 'lod0'
    clean(lo)
    print(f'BUILT {PRESET}: lo {tris(lo)} tris, hi {tris(hi)} tris, {time.time() - t0:.0f} s')
    bb = [lo.matrix_world @ Vector(c) for c in lo.bound_box]
    mn = Vector((min(p.x for p in bb), min(p.y for p in bb), min(p.z for p in bb)))
    mx = Vector((max(p.x for p in bb), max(p.y for p in bb), max(p.z for p in bb)))
    print(f'SIZE x {mn.x:.2f}..{mx.x:.2f}  y {mn.y:.2f}..{mx.y:.2f}  z {mn.z:.2f}..{mx.z:.2f}  '
          f'(glTF: width {mx.x - mn.x:.2f}, depth {mx.y - mn.y:.2f}, height {mx.z - mn.z:.2f} m)')
    if 'build' in OPTS:
        return
    if 'faces' in OPTS:
        # Faces the game would not draw (seen from behind) in red
        dm = bpy.data.materials.new('faces'); nb = NB(dm)
        geo = nb.n('ShaderNodeNewGeometry')
        col = nb.mix((0.7, 0.7, 0.7), (1.0, 0.0, 0.0), nb.out(geo, 'Backfacing'))
        bsdf = nb.n('ShaderNodeBsdfDiffuse'); nb.set(nb.inp(bsdf, 'Color'), col)
        o = nb.n('ShaderNodeOutputMaterial'); nb.nt.links.new(bsdf.outputs[0], o.inputs[0])
        lo.data.materials.clear(); lo.data.materials.append(dm)
        sc, cam = render_setup()
        render_views(sc, cam, [lo], [hi], '-faces')
        return
    if NOBAKE:
        lo.hide_render = True
        sc, cam = render_setup()
        render_views(sc, cam, [hi], [lo], '-hi')
        return
    unwrap(lo)
    if 'probe' in OPTS:
        uv_report(lo)
    col, nrm = bake(lo, hi)
    mat = atlas_material(col, nrm)
    lo.data.materials.clear(); lo.data.materials.append(mat)
    if 'probe' in OPTS:
        probe(lo, col)
    lod1 = make_lod1(lo)
    print(f'LOD lod0 {tris(lo)} tris, lod1 {tris(lod1)} tris')
    path = export(lo, lod1)
    print(f'EXPORT {path} {os.path.getsize(path) / 1024:.0f} KB')
    sc, cam = render_setup()
    render_views(sc, cam, [lo], [hi, lod1])
    render_views(sc, cam, [lod1], [hi, lo], '-lod1')
    if SHOW_HI:
        render_views(sc, cam, [hi], [lo, lod1], '-hi')
    print(f'DONE {time.time() - t0:.0f} s')

main()
