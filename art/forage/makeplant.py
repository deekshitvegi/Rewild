# python makeplant.py -- <atlas dir> <out.glb> <preview.png> <plant> [seed]
# (bpy from PyPI, or: blender -b --factory-startup -P makeplant.py -- ...)
# The food plants the explorer picks (components/expedition/Forage.tsx), one per kind of ground, grown by rules
# taken from the real plants: stems as bark tubes, every leaf a blade of its own (cupped along its midrib, its
# tip drooping, on a stalk), the fruit hanging where that plant bears it. Painted from <plant>-atlas.png
# (pictures.py). Four meshes:
#   body     the plant near the explorer          fruit     its fruit (hidden once picked; grows back)
#   bodyFar  the same plant for afar: a few        fruitFar  its fruit for afar
#            large leaves, plain stems
# Per vertex: colour (linear RGB: the part's colour times its occlusion inside the plant) and a second UV map,
# 'Kind', whose u says how the game lights it (KIND below, divided by 4).
#   verdant    currant      redcurrant (Ribes rubrum): arching canes, lobed leaves, strings of red berries
#   desert     melon        a melon vine (Cucumis melo) along the ground: big lobed leaves on long stalks, golden
#                           netted melons, a few yellow flowers
#   canyon     opuntia      prickly pear: jointed pads with areoles, red fruit on the pads' upper rims
#   cratered   rosette      a stemless succulent rosette (as Sempervivum, Echeveria) with its offsets, and seed
#                           pods on a stout stalk from the middle
#   frozen     frostberry   a low evergreen shrub (as lingonberry, bog bilberry): wiry stems, small leathery
#                           leaves rimed at the edge, pale blue berries under a waxy bloom
#   glacier    icekelp      strap fronds (as kelp, Clivia) arching from a cluster of pale translucent bulbs
import bpy, math, os, random, sys
from mathutils import Vector, Quaternion, Matrix
argv = sys.argv[sys.argv.index('--') + 1:]
tex_dir, out_glb, preview_png, plant = [os.path.abspath(a) for a in argv[:3]] + [argv[3]]
seed = int(argv[4]) if len(argv) > 4 else 7
rnd = random.Random(seed)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)

# How the game lights each part (Forage.tsx): wood/skin, a thin leaf (light through it, thinned edge-on),
# glossy fruit, glossy translucent fruit (currants, bulbs), fruit under a waxy bloom (blueberries).
WOOD, LEAF, GLOSS, JUICY, BLOOM = 0, 1, 2, 3, 4


def lin(h):
    h = h.lstrip('#')
    return Vector([(int(h[i:i + 2], 16) / 255.0) ** 2.2 for i in (0, 2, 4)])


def tile(c, r, u, v, inset=0.012):
    """Atlas coordinates of (u, v) in tile (c, r) of the 4 x 4 grid (r from the top; v up within the tile)."""
    u = inset + u * (1 - 2 * inset); v = inset + v * (1 - 2 * inset)
    return ((c + u) / 4.0, 1.0 - (r + 1) / 4.0 + v / 4.0)


class Part:
    def __init__(self):
        self.v, self.n, self.uv, self.kind, self.col, self.f = [], [], [], [], [], []

    def vert(self, p, n, uv, kind, col):
        self.v.append(Vector(p)); self.n.append(Vector(n).normalized()); self.uv.append(uv)
        self.kind.append(kind); self.col.append(Vector(col))
        return len(self.v) - 1

    def tris(self):
        return sum(len(f) - 2 for f in self.f)


P = {name: Part() for name in ('body', 'fruit', 'bodyFar', 'fruitFar')}


def frame(d):
    d = d.normalized()
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    x = d.cross(a).normalized(); y = d.cross(x).normalized()
    return x, y


def path(start, direction, length, steps, bend=0.0, jitter=0.0, up=0.0):
    """Points along a stem growing from `start`: each step turns by `bend` toward the ground (negative: up),
    a little at random, and toward the sky by `up`."""
    pts = [Vector(start)]; d = Vector(direction).normalized(); dirs = []
    for i in range(steps):
        j = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        d = (d + j + Vector((0, 0, up - bend * (i + 1) / steps))).normalized()
        dirs.append(d.copy()); pts.append(pts[-1] + d * (length / steps))
    dirs.append(d.copy())
    return pts, dirs


def point_on(pts, t):
    steps = len(pts) - 1; idx = min(int(t * steps), steps - 1); f = t * steps - idx
    return pts[idx].lerp(pts[idx + 1], f), idx


def tube(part, pts, dirs, radii, sides, col, t=(0, 2), kind=WOOD, ao=None, cap=False):
    """A stem: rings round the points, its bark picture stretched along it (tile t)."""
    base = len(part.v)
    for i, p in enumerate(pts):
        x, y = frame(dirs[i])
        a_ = ao(p) if ao else 1.0
        for k in range(sides + 1):
            a = 2 * math.pi * k / sides
            n = x * math.cos(a) + y * math.sin(a)
            part.vert(p + n * radii[i], n, tile(t[0], t[1], k / sides, i / max(1, len(pts) - 1)), kind, col * a_)
    for i in range(len(pts) - 1):
        for k in range(sides):
            a = base + i * (sides + 1) + k; b = a + sides + 1
            part.f.append((a, a + 1, b + 1, b))


def ellipsoid(part, centre, axes, segs, rings, col_fn, t=(1, 2), kind=GLOSS, shape=None, uv_fn=None):
    """A closed surface of revolution round axes[2] (local z): u round, v pole to pole. shape(v, a) -> (radial
    scale, z scale) bends a sphere into a melon, a pear, a pod. col_fn(v, a, normal) -> colour."""
    ax, ay, az = axes
    base = len(part.v)
    for r in range(rings + 1):
        v = r / rings; th = math.pi * v
        for s in range(segs + 1):
            a = 2 * math.pi * s / segs
            rs, zs = shape(v, a) if shape else (1.0, 1.0)
            local = Vector((math.sin(th) * math.cos(a) * rs, math.sin(th) * math.sin(a) * rs, -math.cos(th) * zs))
            p = centre + ax * local.x + ay * local.y + az * local.z
            # normal of the scaled sphere (good enough for the gentle shapes used)
            nl = ax * (local.x / max(ax.length ** 2, 1e-9)) + ay * (local.y / max(ay.length ** 2, 1e-9)) + az * (local.z / max(az.length ** 2, 1e-9))
            uv = uv_fn(v, s / segs) if uv_fn else tile(t[0], t[1], s / segs, v)
            part.vert(p, nl, uv, kind, col_fn(v, a, nl.normalized()))
    # (faces wound to match the outward normals, whichever way round the axes were given)
    flip = ax.cross(ay).dot(az) < 0
    for r in range(rings):
        for s in range(segs):
            a = base + r * (segs + 1) + s; b = a + segs + 1
            f = (a, b + 1, b) if r == 0 else (a, a + 1, b) if r == rings - 1 else (a, a + 1, b + 1, b)
            part.f.append(tuple(reversed(f)) if flip else f)


def blade(part, joint, along, facing, length, width, t, fold=0.25, droop=0.2, twist=0.0, col=Vector((1, 1, 1)),
          joint_v=0.36, nu=2, nv=2, kind=LEAF, outward=None, bend_n=0.35):
    """One leaf blade on its picture (tile t), the petiole's end at `joint`: the blade's midrib runs along `along`
    with its face toward `facing`; cupped along the midrib (fold), its tip bowed down (droop). The picture's
    petiole end sits at (0.5, joint_v) of the tile and the tile is `length` metres tall and `width` wide."""
    ax = Vector(along).normalized()
    nrm = (Vector(facing) - ax * Vector(facing).dot(ax)).normalized()
    if twist: nrm = Quaternion(ax, twist) @ nrm
    side = ax.cross(nrm).normalized()
    base = len(part.v)
    for j in range(nv + 1):
        v = j / nv
        for i in range(nu + 1):
            u = i / nu
            x = (u - 0.5) * width; y = (v - joint_v) * length
            lift = fold * abs(u - 0.5) * 2 * width * 0.5 - droop * (max(y, 0) / length) ** 2 * length
            p = joint + side * x + ax * y + nrm * lift
            # the blade's own normal (tilted by the fold and the droop), bent toward the plant's outside
            n = (nrm - side * math.copysign(fold * 0.9, u - 0.5) * (1 if u != 0.5 else 0) + ax * (droop * 2 * max(y, 0) / length)).normalized()
            if outward is not None: n = (n * (1 - bend_n) + outward * bend_n).normalized()
            part.vert(p, n, tile(t[0], t[1], u, v, 0.0), kind, col)
    for j in range(nv):
        for i in range(nu):
            a = base + j * (nu + 1) + i; b = a + nu + 1
            part.f.append((a, a + 1, b + 1, b))


def stalk(part, a, b, r, col, t=(0, 2)):
    """A leaf stalk too fine to model round: two crossed triangles from the stem to the blade."""
    d = (b - a).normalized(); x, y = frame(d)
    for side in (x, y):
        i0 = part.vert(a - side * r, side.cross(d), tile(t[0], t[1], 0.4, 0.2), WOOD, col)
        i1 = part.vert(a + side * r, side.cross(d), tile(t[0], t[1], 0.6, 0.2), WOOD, col)
        i2 = part.vert(b, side.cross(d), tile(t[0], t[1], 0.5, 0.8), WOOD, col)
        part.f.append((i0, i1, i2))


def quad(part, corners, normal, uvs, kind, col):
    b = len(part.v)
    for c, uv in zip(corners, uvs):
        part.vert(c, normal, uv, kind, col)
    part.f.append((b, b + 1, b + 2, b + 3))


# ------------------------------------------------------------------------------------------------- the plants

def grow_currant():
    """Redcurrant: 9-12 canes from the crown, rising and arching out to about 1.1 m; side shoots along them; leaves
    at the nodes, in rosettes on the older wood; strings (strigs) of berries hanging from the spurs."""
    H = 1.05
    bark = lin('#7a6656'); young = lin('#8a7a5a')
    leaves, strigs = [], []
    canes = rnd.randint(11, 14)
    centre = Vector((0, 0, H * 0.55))

    def ao(p):
        # darker low down and inside the bush
        r = Vector((p.x, p.y, (p.z - centre.z) * 0.8)).length
        return min(1.0, 0.45 + 0.4 * (p.z / H) + 0.35 * r / 0.6)
    golden = rnd.random() * 6.28
    for c in range(canes):
        golden += 2.39996
        tilt = math.radians(rnd.uniform(4, 26))
        d = Vector((math.cos(golden) * math.sin(tilt), math.sin(golden) * math.sin(tilt), math.cos(tilt)))
        start = Vector((math.cos(golden) * 0.05, math.sin(golden) * 0.05, -0.04))
        L = H * rnd.uniform(0.85, 1.2)
        pts, dirs = path(start, d, L, 10, bend=rnd.uniform(0.15, 0.32), jitter=0.05)
        r0 = rnd.uniform(0.009, 0.012)
        radii = [r0 * (1 - 0.65 * i / 10) for i in range(11)]
        tube(P['body'], pts, dirs, radii, 6, bark, ao=ao)
        tube(P['bodyFar'], pts[::2], dirs[::2], [r * 1.4 for r in radii[::2]], 3, bark, ao=ao)
        # side shoots, alternate along the upper part of the cane
        s = rnd.uniform(0.18, 0.28); side = 1
        while s < 0.9:
            p, idx = point_on(pts, s); x, y = frame(dirs[idx]); side = -side
            a = golden + side * rnd.uniform(0.8, 1.6)
            out = Vector((math.cos(a), math.sin(a), 0))
            sd = (dirs[idx] * 0.55 + out * 0.8 + Vector((0, 0, 0.15))).normalized()
            sl = rnd.uniform(0.1, 0.26) * (1.15 - 0.5 * s)
            sp, sdirs = path(p, sd, sl, 5, bend=0.25, jitter=0.08)
            tube(P['body'], sp, sdirs, [radii[idx] * 0.5 * (1 - 0.6 * i / 5) for i in range(6)], 4, young, ao=ao)
            for k in range(1, 6):
                if rnd.random() < 0.9:
                    leaves.append((sp[k], sdirs[k], 0.75 + 0.25 * k / 5))
                if rnd.random() < 0.45:
                    leaves.append((sp[k], sdirs[k], 0.7 + 0.2 * k / 5))
            leaves.append((sp[-1], sdirs[-1], 1.0))
            leaves.append((sp[-1], sdirs[-1], 0.9))
            # a strig from the spur at the shoot's foot (on two-year wood), or from partway along the shoot,
            # hanging on the outside of the bush where it gets the sun
            if rnd.random() < 0.55 and 0.25 < s < 0.9:
                q, qi = point_on(sp, rnd.uniform(0.0, 0.5))
                strigs.append((q + out * 0.01, out))
            s += rnd.uniform(0.07, 0.11)
        # leaves along the cane's own upper part and a rosette at its tip
        for k in range(6, 11):
            leaves.append((pts[k], dirs[k], 0.85))
        for _ in range(3):
            leaves.append((pts[-1], dirs[-1], 1.0))

    # Leaves: a stalk (petiole) 3-5 cm out from the node, the blade at its end facing up and out.
    for n_, (p, d, size) in enumerate(leaves):
        out = Vector((p.x, p.y, 0)); out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
        a = rnd.uniform(0, 6.28)
        pd = (d * 0.3 + Vector((math.cos(a), math.sin(a), 0)) * 0.7 + out * 0.5 + Vector((0, 0, 0.4))).normalized()
        pl = rnd.uniform(0.03, 0.05)
        joint = p + pd * pl
        facing = (Vector((0, 0, 1)) * 0.75 + out * 0.45 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.35).normalized()
        along = (pd + Vector((0, 0, -0.1))).normalized()
        S = rnd.uniform(0.095, 0.125) * size
        t = (rnd.choice((0, 0, 1, 1, 2, 2, 3)), 0)
        rel = Vector((p.x, p.y, (p.z - centre.z) * 0.8))
        occ = min(1.0, 0.35 + 0.65 * min(1.0, rel.length / 0.55)) * (0.75 + 0.25 * min(1.0, p.z / H))
        leafcol = Vector((1, 1, 1)) * occ * rnd.uniform(0.85, 1.1)
        stalk(P['body'], p, joint, 0.0016, lin('#7c8a4a'))
        blade(P['body'], joint, along, facing, S, S, t, fold=0.28, droop=0.3, twist=rnd.uniform(-0.3, 0.3),
              col=leafcol, outward=(rel.normalized() if rel.length > 1e-3 else Vector((0, 0, 1))))
        if n_ % 2 == 0:
            blade(P['bodyFar'], joint, along, facing, S * 1.4, S * 1.4, t, fold=0.0, droop=0.0, nu=1, nv=1, col=leafcol,
                  outward=(rel.normalized() if rel.length > 1e-3 else Vector((0, 0, 1))), bend_n=0.5)

    # Strigs: a thin green-red stalk arching out and falling; berries along it on short stalks, larger near
    # its base. (A little larger than life, so the fruit reads from a few metres off.)
    for (p, out) in strigs:
        L = rnd.uniform(0.07, 0.11)
        sd = (out * 0.7 + Vector((0, 0, 0.25))).normalized()
        sp, sdirs = path(p, sd, L, 6, bend=2.2, jitter=0.03)
        tube(P['fruit'], sp, sdirs, [0.0014] * len(sp), 3, lin('#6b6a2e'))
        count = rnd.randint(8, 12)
        clusters = []
        for k in range(count):
            t_ = 0.18 + 0.8 * k / max(count - 1, 1)
            q, qi = point_on(sp, t_)
            x, y = frame(sdirs[qi]); a = k * 2.4 + rnd.random()
            ped = (x * math.cos(a) + y * math.sin(a)) * 0.006 + Vector((0, 0, -0.004))
            r = 0.0078 * (1.15 - 0.4 * t_) * rnd.uniform(0.9, 1.08)
            c = q + ped + Vector((0, 0, -r))
            hue = rnd.uniform(0.85, 1.1)
            red = lin('#c8141f') * hue

            def col(v, a_, n, red=red):
                # the dried flower at the bottom pole, a paler glint of the stalk's scar at the top
                tip = max(0.0, 1 - v / 0.12)
                return red * (1 - tip) + lin('#3a2216') * tip
            ellipsoid(P['fruit'], c, (Vector((r, 0, 0)), Vector((0, r, 0)), Vector((0, 0, r))), 5, 3, col, kind=JUICY)
            clusters.append(c)
        # far: three bigger berries down the string
        for k in (1, len(clusters) // 2, len(clusters) - 2):
            c = clusters[max(0, min(k, len(clusters) - 1))]
            ellipsoid(P['fruitFar'], c, (Vector((0.013, 0, 0)), Vector((0, 0.013, 0)), Vector((0, 0, 0.013))), 4, 2,
                      lambda v, a_, n: lin('#c8141f'), kind=JUICY)


def grow_melon():
    """Melon vine: runners along the ground from the crown, a leaf at each node on a stalk standing up from it,
    tendrils, a few flowers, and two to four melons lying among the leaves."""
    vine = lin('#6f8a3c')
    runners = rnd.randint(6, 8)
    nodes = []
    golden = rnd.random() * 6.28
    for k in range(runners):
        golden += 2.39996 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(golden), math.sin(golden), 0.08))
        L = rnd.uniform(0.75, 1.25)
        pts, dirs = path(Vector((0, 0, 0.04)), d, L, 14, bend=0.12, jitter=0.12)
        pts = [Vector((p.x, p.y, max(0.012, min(p.z, 0.05)))) for p in pts]
        tube(P['body'], pts, dirs, [0.008 * (1 - 0.5 * i / 14) for i in range(15)], 5, vine)
        tube(P['bodyFar'], pts[::3], dirs[::3], [0.012] * len(pts[::3]), 3, vine)
        for i in range(1, 15):
            nodes.append((pts[i], dirs[i], i / 14))
    for n_, (p, d, f) in enumerate(nodes):
        if rnd.random() < 0.08: continue
        a = rnd.uniform(0, 6.28)
        sd = (Vector((0, 0, 1)) * 1.0 + Vector((math.cos(a), math.sin(a), 0)) * 0.55).normalized()
        sl = rnd.uniform(0.09, 0.16) * (0.75 + 0.25 * (1 - f))
        sp, sdirs = path(p, sd, sl, 3, bend=0.35, jitter=0.05)
        tube(P['body'], sp, sdirs, [0.0035, 0.003, 0.0026, 0.0022], 3, vine)
        S = rnd.uniform(0.19, 0.26) * (0.85 + 0.25 * (1 - f))
        facing = (Vector((0, 0, 1)) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.35).normalized()
        along = (Vector((sdirs[-1].x, sdirs[-1].y, 0)).normalized() if Vector((sdirs[-1].x, sdirs[-1].y, 0)).length > 1e-3 else Vector((1, 0, 0)))
        t = (rnd.randint(0, 3), 0)
        occ = 0.75 + 0.25 * min(1.0, sp[-1].z / 0.2)
        blade(P['body'], sp[-1], along, facing, S, S, t, fold=0.18, droop=0.22, twist=rnd.uniform(-0.25, 0.25),
              col=Vector((1, 1, 1)) * occ, joint_v=0.4, outward=Vector((0, 0, 1)), bend_n=0.3)
        if n_ % 3 == 0:
            blade(P['bodyFar'], sp[-1], along, facing, S * 1.6, S * 1.6, t, fold=0, droop=0, nu=1, nv=1,
                  col=Vector((1, 1, 1)) * occ, joint_v=0.4, outward=Vector((0, 0, 1)), bend_n=0.4)
        # a flower here and there, at a short stalk off the node
        if rnd.random() < 0.12:
            c = p + Vector((0, 0, 0.05)) + Vector((math.cos(a + 2), math.sin(a + 2), 0)) * 0.03
            tube(P['body'], [p, c], [Vector((0, 0, 1))] * 2, [0.0015, 0.0012], 3, vine)
            s_ = 0.022
            n = (Vector((0, 0, 1)) + Vector((math.cos(a), math.sin(a), 0)) * 0.5).normalized(); x, y = frame(n)
            quad(P['body'], [c - x * s_ - y * s_, c + x * s_ - y * s_, c + x * s_ + y * s_, c - x * s_ + y * s_], n,
                 [tile(0, 3, 0, 0, 0), tile(0, 3, 1, 0, 0), tile(0, 3, 1, 1, 0), tile(0, 3, 0, 1, 0)], LEAF, Vector((1, 1, 1)))
        # tendrils: a tight coil
        if rnd.random() < 0.18:
            pts_, dirs_ = [], []
            ang = rnd.uniform(0, 6.28); o = Vector((math.cos(ang), math.sin(ang), 0.3)).normalized()
            for i in range(9):
                t_ = i / 8; spin = t_ * 6.28 * 2.5
                x, y = frame(o)
                pts_.append(p + o * (0.02 + 0.06 * t_) + (x * math.cos(spin) + y * math.sin(spin)) * 0.008 * t_)
                dirs_.append(o)
            tube(P['body'], pts_, dirs_, [0.0012] * 9, 3, vine)
    # Melons lying on the ground beside the runners.
    count = rnd.randint(2, 4)
    for k in range(count):
        p, d, f = nodes[rnd.randrange(len(nodes) // 4, len(nodes))]
        side = Vector((-d.y, d.x, 0)).normalized() * rnd.choice((-1, 1)) * 0.09
        L = rnd.uniform(0.17, 0.23); W = L * rnd.uniform(0.72, 0.82)
        c = Vector((p.x, p.y, 0)) + side + Vector((0, 0, W * 0.42))
        a = rnd.uniform(0, 6.28)
        ax = Vector((math.cos(a), math.sin(a), rnd.uniform(-0.1, 0.1))).normalized()
        y_ = Vector((0, 0, 1)).cross(ax).normalized(); z_ = ax.cross(y_).normalized()
        gold = lin('#dcb23c') * rnd.uniform(0.92, 1.05)

        def mcol(v, a_, n, gold=gold):
            # paler where it lies on the ground (the ground spot)
            under = max(0.0, -n.z)
            return gold * (1 - 0.35 * under ** 2) + lin('#cfc59a') * 0.35 * under ** 2
        # axes: x, y round (the melon's width), z its length (pole to pole along ax)
        ellipsoid(P['fruit'], c, (y_ * W / 2, z_ * W / 2, ax * L / 2), 14, 9, mcol, t=(2, 2), kind=GLOSS,
                  shape=lambda v, a_: (1 + 0.025 * math.cos(a_ * 10), 1.0))
        ellipsoid(P['fruitFar'], c, (y_ * W / 2, z_ * W / 2, ax * L / 2), 6, 4, mcol, t=(2, 2), kind=GLOSS)
        stem_end = c + ax * L / 2
        tube(P['fruit'], [stem_end, stem_end + ax * 0.02 + Vector((0, 0, 0.01))], [ax, ax], [0.004, 0.003], 4, vine)


def grow_opuntia():
    """Prickly pear: pads (cladodes) set edge to edge, each child on the upper rim of its parent and turned
    a little out of its plane; fruit (tunas) along the rims of the outer pads."""
    green = lin('#6a8a46'); old = lin('#7d8a5a')
    pads = []

    def pad(base, up, face, L, W, T, level):
        """A pad standing on its foot at `base`, its length along `up`, its broad face toward `face`."""
        up = up.normalized(); face = (face - up * face.dot(up)).normalized(); side = up.cross(face).normalized()
        c = base + up * L * 0.5
        col = green * (0.92 + 0.12 * rnd.random()) if level else old

        def shape(v, a):
            # obovate: narrow at the foot, widest two-thirds up
            w = 0.55 + 0.6 * math.sin(math.pi * min(1.0, v * 0.82 + 0.05)) * (0.6 + 0.4 * v)
            return (w, 1.0)

        def uv(v, s):
            # the areoles printed across both faces
            return tile(0, 2, 0.5 + 0.5 * math.cos(s * 6.2832) * 0.95, v)
        ellipsoid(P['body'], c, (side * W / 2, face * T / 2, up * L / 2), 14, 10, lambda v, a, n: col * (0.85 + 0.15 * v), shape=shape, uv_fn=uv, kind=WOOD)
        ellipsoid(P['bodyFar'], c, (side * W / 2, face * T / 2, up * L / 2), 8, 5, lambda v, a, n: col, shape=shape, uv_fn=uv, kind=WOOD)
        pads.append((c, up, face, side, L, W, T, level))
        return c, up, face, side
    roots = rnd.randint(2, 3)
    for k in range(roots):
        a = rnd.uniform(0, 6.28); tilt = rnd.uniform(0.05, 0.3)
        up = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        face = Vector((math.cos(a + 1.57), math.sin(a + 1.57), 0))
        L = rnd.uniform(0.32, 0.38)
        stack = [(Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, -0.03)), up, face, L, 0)]
        while stack:
            b, u, f, L, lv = stack.pop()
            c, u, f, side = pad(b, u, f, L, L * 0.68, 0.028, lv)
            if lv >= 3 or (lv == 2 and rnd.random() < 0.5): continue
            for j in range(rnd.randint(1, 3)):
                # where on the rim: angle from the pad's tip across its upper half
                t = rnd.uniform(-1.0, 1.0)
                rim = c + u * L * 0.5 * math.cos(t * 1.1) * 0.92 + side * L * 0.34 * math.sin(t * 1.1)
                nu = (u * math.cos(t * 0.9) + side * math.sin(t * 0.9) + Vector((0, 0, 0.35))).normalized()
                turn = Quaternion(nu, rnd.uniform(-1.2, 1.2))
                stack.append((rim, nu, turn @ f, L * rnd.uniform(0.8, 0.95), lv + 1))
    # Fruit on the upper rims of the outermost pads: barrel-shaped, a hollow at the top, red-purple.
    outer = [p for p in pads if p[7] >= 1] or pads
    for (c, u, f, side, L, W, T, lv) in outer:
        if rnd.random() < 0.25: continue
        for j in range(rnd.randint(2, 4)):
            t = rnd.uniform(-0.9, 0.9)
            rim = c + u * L * 0.5 * math.cos(t * 1.2) * 0.95 + side * W * 0.62 * math.sin(t * 1.2)
            out = (u * math.cos(t * 1.2) + side * math.sin(t * 1.2)).normalized()
            fu = (out + Vector((0, 0, 0.6))).normalized()
            fl = rnd.uniform(0.05, 0.065); fw = fl * 0.62
            x, y = frame(fu)
            centre = rim + fu * fl * 0.48
            red = lin('#9e1a3a') * rnd.uniform(0.85, 1.1)

            def fcol(v, a, n, red=red):
                # yellow-green at the foot where it joins the pad, ripening to red-purple
                foot = max(0.0, 1 - v / 0.35)
                return red * (1 - foot) + lin('#8a8a3a') * foot

            def fshape(v, a):
                # a barrel: full in the middle, cut flat at the top with a dimple
                return (math.sin(math.pi * min(1.0, 0.12 + v * 0.95)) ** 0.35, 1.0 - 0.25 * max(0.0, v - 0.85) / 0.15)
            ellipsoid(P['fruit'], centre, (x * fw / 2, y * fw / 2, fu * fl / 2), 8, 6, fcol, t=(2, 2), kind=GLOSS, shape=fshape)
            ellipsoid(P['fruitFar'], centre, (x * fw / 2, y * fw / 2, fu * fl / 2), 4, 2, fcol, t=(2, 2), kind=GLOSS)


def grow_rosette():
    """A stemless rosette of thick pointed leaves in a phyllotactic spiral, two to four offsets round it on short
    runners, and one or two stout stalks from the middle bearing ribbed seed pods."""
    glaucous = lin('#8aa092'); tips = lin('#8a5a4a'); pale = lin('#c8cfb0')

    def rosette(centre, scale, leaves, far=True):
        golden = rnd.random() * 6.28
        for k in range(leaves):
            golden += 2.39996
            f = k / leaves                         # 0 outer (oldest) ... 1 inner (youngest)
            L = scale * (0.16 - 0.09 * f) * rnd.uniform(0.92, 1.08)
            Wb = L * 0.42; Th = L * 0.24
            elev = math.radians(18 + 62 * f ** 0.8)
            d = Vector((math.cos(golden) * math.cos(elev), math.sin(golden) * math.cos(elev), math.sin(elev)))
            side = Vector((-math.sin(golden), math.cos(golden), 0))
            up_ = side.cross(d).normalized()
            base = centre + Vector((math.cos(golden), math.sin(golden), 0)) * scale * 0.012 * (1 - f) + Vector((0, 0, scale * 0.01 * f))
            # the leaf as a thick wedge: rings along it, a lens in section (flat-topped, keeled below)
            rings, around = 5, 6
            for part, rr_, aa_ in ((P['body'], rings, around), (P['bodyFar'], 2, 4)) if far else ((P['body'], rings, around),):
                b0 = len(part.v)
                for i in range(rr_ + 1):
                    t = i / rr_
                    w = Wb * (1 - t) ** 0.9 * (1 + 0.25 * math.sin(math.pi * t))
                    th = Th * (1 - t) ** 0.7
                    curl = d * (L * t) + up_ * (L * 0.12 * t * t) * (1 - f)
                    for j in range(aa_ + 1):
                        a = 2 * math.pi * j / aa_
                        cs, sn = math.cos(a), math.sin(a)
                        off = side * cs * w * 0.5 + up_ * (sn * th * 0.5 if sn < 0 else sn * th * 0.25)
                        n = (side * cs + up_ * sn * 1.4).normalized()
                        col = (glaucous * (1 - t ** 3) + tips * t ** 3) * (0.55 + 0.45 * (0.4 + 0.6 * (1 - f))) * (0.8 + 0.2 * t)
                        col = col * (1 - 0.3 * (1 - t) ** 6) + pale * 0.3 * (1 - t) ** 6
                        part.vert(base + curl + off, n, tile(0, 2, j / aa_, t), WOOD, col)
                for i in range(rr_):
                    for j in range(aa_):
                        a = b0 + i * (aa_ + 1) + j; b = a + aa_ + 1
                        part.f.append((a, b, b + 1, a + 1))
    rosette(Vector((0, 0, 0.0)), 1.0, rnd.randint(22, 28))
    for k in range(rnd.randint(2, 4)):
        a = rnd.uniform(0, 6.28); r = rnd.uniform(0.17, 0.24)
        c = Vector((math.cos(a) * r, math.sin(a) * r, -0.005))
        tube(P['body'], [Vector((0, 0, 0.01)), c * 0.5 + Vector((0, 0, 0.012)), c], [c.normalized()] * 3, [0.004, 0.004, 0.003], 3, lin('#8a8a6a'))
        rosette(c, rnd.uniform(0.45, 0.6), rnd.randint(12, 16), far=rnd.random() < 0.5)
    # Seed stalks from the middle, a cluster of pods near the top of each.
    for k in range(rnd.randint(1, 2)):
        a = rnd.uniform(0, 6.28); tilt = rnd.uniform(0.05, 0.3)
        d = Vector((math.cos(a) * math.sin(tilt), math.sin(a) * math.sin(tilt), math.cos(tilt)))
        L = rnd.uniform(0.16, 0.24)
        pts, dirs = path(Vector((0, 0, 0.02)), d, L, 5, bend=0.1, jitter=0.03)
        tube(P['body'], pts, dirs, [0.007 * (1 - 0.4 * i / 5) for i in range(6)], 5, lin('#7f8a66'))
        tube(P['bodyFar'], pts[::2], dirs[::2], [0.008] * 3, 3, lin('#7f8a66'))
        for j in range(rnd.randint(4, 6)):
            t = rnd.uniform(0.55, 1.0)
            q, qi = point_on(pts, t)
            x, y = frame(dirs[qi]); b = j * 2.4
            out = (x * math.cos(b) + y * math.sin(b) + dirs[qi] * 0.6).normalized()
            pl = rnd.uniform(0.035, 0.05); pw = pl * 0.55
            c = q + out * (0.008 + pl * 0.5)
            x2, y2 = frame(out)
            green = lin('#b9c98a') * rnd.uniform(0.9, 1.05)

            def pcol(v, a_, n, green=green):
                tip = max(0.0, (v - 0.85) / 0.15)
                return green * (1 - 0.5 * tip) + lin('#6b5a3a') * 0.5 * tip
            ellipsoid(P['fruit'], c, (x2 * pw / 2, y2 * pw / 2, out * pl / 2), 8, 6, pcol, t=(2, 2), kind=GLOSS,
                      shape=lambda v, a_: (math.sin(math.pi * min(1.0, 0.1 + v * 0.95)) ** 0.5 * (1 + 0.07 * math.cos(a_ * 5)), 1.0))
            ellipsoid(P['fruitFar'], c, (x2 * pw / 2, y2 * pw / 2, out * pl / 2), 4, 3, pcol, t=(2, 2), kind=GLOSS)
            tube(P['fruit'], [q, c - out * pl * 0.45], [out, out], [0.0025, 0.002], 3, lin('#7f8a66'))


def grow_frostberry():
    """A low dense evergreen: wiry stems branching from the base, small leathery leaves crowded on the young
    shoots, berries in twos to fives at the shoot tips."""
    H = 0.5
    bark = lin('#6b3a2c')
    leaves, tips = [], []

    def ao(p):
        return min(1.0, 0.45 + 0.55 * p.z / H)

    def shoot(start, d, L, r0, level):
        pts, dirs = path(start, d, L, 6 if level < 2 else 4, bend=0.12, jitter=0.12, up=0.04)
        n = len(pts) - 1
        tube(P['body'], pts, dirs, [r0 * (1 - 0.6 * i / n) for i in range(n + 1)], 4 if level < 2 else 3, bark, ao=ao)
        if level == 0:
            tube(P['bodyFar'], pts[::3], dirs[::3], [r0 * 1.3] * len(pts[::3]), 3, bark, ao=ao)
        if level < 2:
            for k in range(rnd.randint(2, 4)):
                t = rnd.uniform(0.35, 0.95); q, qi = point_on(pts, t)
                x, y = frame(dirs[qi]); a = rnd.uniform(0, 6.28)
                nd = (dirs[qi] * 0.6 + (x * math.cos(a) + y * math.sin(a)) * 0.7 + Vector((0, 0, 0.2))).normalized()
                shoot(q, nd, L * rnd.uniform(0.45, 0.65), r0 * 0.6, level + 1)
        if level >= 1:
            for k in range(1, n + 1):
                for _ in range(3):
                    leaves.append((pts[k], dirs[k]))
            tips.append((pts[-1], dirs[-1]))
    golden = rnd.random() * 6.28
    for s in range(rnd.randint(7, 10)):
        golden += 2.39996
        tilt = math.radians(rnd.uniform(12, 48))
        d = Vector((math.cos(golden) * math.sin(tilt), math.sin(golden) * math.sin(tilt), math.cos(tilt)))
        shoot(Vector((math.cos(golden) * 0.03, math.sin(golden) * 0.03, -0.02)), d, H * rnd.uniform(0.6, 0.85), 0.006, 0)
    for n_, (p, d) in enumerate(leaves):
        a = rnd.uniform(0, 6.28)
        x, y = frame(d)
        along = (d * 0.5 + (x * math.cos(a) + y * math.sin(a)) * 0.8).normalized()
        facing = (Vector((0, 0, 1)) + Vector((p.x, p.y, 0)) * 1.5 + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.4).normalized()
        S = rnd.uniform(0.038, 0.048)
        occ = (0.5 + 0.5 * min(1.0, Vector((p.x, p.y, 0)).length / 0.3)) * (0.7 + 0.3 * p.z / H)
        t = (rnd.randint(0, 3), 0)
        blade(P['body'], p + along * 0.003, along, facing, S, S * 0.55, t, fold=0.35, droop=0.1, col=Vector((1, 1, 1)) * occ,
              joint_v=0.07, nu=2, nv=1, outward=Vector((p.x, p.y, p.z - H * 0.4)).normalized(), bend_n=0.4)
        if n_ % 4 == 0:
            blade(P['bodyFar'], p + along * 0.003, along, facing, S * 2.0, S * 1.0, t, fold=0, droop=0, col=Vector((1, 1, 1)) * occ,
                  joint_v=0.07, nu=1, nv=1, outward=Vector((p.x, p.y, p.z - H * 0.4)).normalized(), bend_n=0.5)
    rnd.shuffle(tips)
    for (p, d) in tips[:max(6, len(tips) * 2 // 5)]:
        for j in range(rnd.randint(2, 4)):
            x, y = frame(d); a = j * 2.2 + rnd.random()
            r = rnd.uniform(0.0062, 0.0075)
            c = p + (x * math.cos(a) + y * math.sin(a)) * 0.011 + Vector((0, 0, -0.006 - r))
            blue = lin('#7fa8c8') * rnd.uniform(0.9, 1.1)

            def bcol(v, a_, n, blue=blue):
                # the crown of the calyx at the top: a dark ring with a pale bloom round it
                top = v > 0.86
                return lin('#3a3a52') if top else blue * (0.9 + 0.1 * v)
            ellipsoid(P['fruit'], c, (Vector((r, 0, 0)), Vector((0, r, 0)), Vector((0, 0, r * 0.88))), 5, 4, bcol, kind=BLOOM)
            tube(P['fruit'], [p, c + Vector((0, 0, r))], [Vector((0, 0, -1))] * 2, [0.0009, 0.0008], 3, lin('#7a4a3a'))
            if j == 0:
                ellipsoid(P['fruitFar'], c, (Vector((0.01, 0, 0)), Vector((0, 0.01, 0)), Vector((0, 0, 0.01))), 4, 2,
                          lambda v, a_, n: lin('#7fa8c8'), kind=BLOOM)


def grow_icekelp():
    """Strap fronds arching out of a cluster of bulbs: the bulbs (the food) pale and translucent, sunk to their
    waists in the ice; the fronds leathery, ruffled, teal fading to clear at the tips."""
    bulbs = []
    for k in range(rnd.randint(5, 8)):
        a = k * 2.4 + rnd.random(); r = 0.03 + 0.05 * math.sqrt(rnd.random())
        size = rnd.uniform(0.05, 0.085)
        c = Vector((math.cos(a) * r, math.sin(a) * r, size * 0.15))
        tilt = Vector((math.cos(a) * 0.3, math.sin(a) * 0.3, 1)).normalized()
        x, y = frame(tilt)
        pale = lin('#a8e6ef') * rnd.uniform(0.9, 1.05)

        def bcol(v, a_, n, pale=pale):
            neck = max(0.0, (v - 0.75) / 0.25)
            return pale * (1 - 0.4 * neck) + lin('#5f9a8a') * 0.4 * neck

        def bshape(v, a_):
            # an onion: round below, drawn in to a neck at the top
            s0 = math.sin(math.pi * v)
            if s0 < 1e-3: return (1.0, 1.0)
            want = s0 ** (0.7 if v < 0.55 else 1.8) * (1 + 0.04 * math.cos(a_ * 9))
            return (want / s0, 1.0)
        ellipsoid(P['fruit'], c, (x * size * 0.5, y * size * 0.5, tilt * size * 0.6), 10, 8, bcol, t=(0, 2), kind=JUICY, shape=bshape)
        ellipsoid(P['fruitFar'], c, (x * size * 0.5, y * size * 0.5, tilt * size * 0.6), 5, 3, bcol, t=(0, 2), kind=JUICY)
        bulbs.append((c, size))
    for k in range(rnd.randint(13, 17)):
        a = k * 2.4 + rnd.uniform(-0.3, 0.3)
        out = Vector((math.cos(a), math.sin(a), 0))
        L = rnd.uniform(0.3, 0.55); Wd = rnd.uniform(0.022, 0.032)
        d = (Vector((0, 0, 1)) * 1.0 + out * rnd.uniform(0.25, 0.6)).normalized()
        pts, dirs = path(Vector((math.cos(a) * 0.02, math.sin(a) * 0.02, 0.03)), d, L, 10, bend=rnd.uniform(1.1, 1.9), jitter=0.06)
        # a frond that reaches the ground lies along it
        pts = [Vector((p.x, p.y, max(p.z, 0.008 + 0.002 * i))) for i, p in enumerate(pts)]
        t = (rnd.randint(0, 2), 0)
        for part, step, nu in ((P['body'], 1, 2), (P['bodyFar'], 5, 1)):
            b0 = len(part.v)
            idx = list(range(0, len(pts), step))
            if idx[-1] != len(pts) - 1: idx.append(len(pts) - 1)
            for ii, i in enumerate(idx):
                v = i / (len(pts) - 1)
                side = dirs[i].cross(Vector((0, 0, 1))).normalized() if abs(dirs[i].z) < 0.99 else Vector((1, 0, 0))
                side = Quaternion(dirs[i], (0.9 * v + 0.25 * math.sin(v * 9 + k)) * (1 if k % 2 else -1)) @ side
                n = side.cross(dirs[i]).normalized()
                for j in range(nu + 1):
                    u = j / nu
                    p = pts[i] + side * (u - 0.5) * Wd * 2 + n * (abs(u - 0.5) * Wd * 0.4)
                    # the frond tile is 256 x 512: rows 0 and 1 of column t[0]
                    uv = ((t[0] + 0.02 + u * 0.96) / 4.0, 1.0 - 2 / 4.0 + v * 2 / 4.0 * 0.98)
                    occ = 0.6 + 0.4 * v
                    part.vert(p, (n + Vector((0, 0, 0.3))).normalized(), uv, LEAF, Vector((1, 1, 1)) * occ)
            for ii in range(len(idx) - 1):
                for j in range(nu):
                    a_ = b0 + ii * (nu + 1) + j; b_ = a_ + nu + 1
                    part.f.append((a_, a_ + 1, b_ + 1, b_))


GROW = {'currant': grow_currant, 'melon': grow_melon, 'opuntia': grow_opuntia, 'rosette': grow_rosette,
        'frostberry': grow_frostberry, 'icekelp': grow_icekelp}
GROW[plant]()

# ------------------------------------------------------------------------------------------------- export

atlas_path = f'{tex_dir}/{plant}-atlas.png'


def material():
    mat = bpy.data.materials.new('plant'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(atlas_path)
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs['A']); nt.links.new(vc.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Roughness'].default_value = 0.6
    return mat


MAT = material()


def make(name, part):
    if not part.f: return None
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in part.v], [], [tuple(f) for f in part.f]); mesh.update()
    col = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    mesh.uv_layers.new(name='UVMap'); mesh.uv_layers.new(name='Kind')
    mesh.uv_layers['UVMap'].active_render = True; mesh.uv_layers.active = mesh.uv_layers['UVMap']
    uvl = mesh.uv_layers['UVMap']; kl = mesh.uv_layers['Kind']
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = mesh.loops[li].vertex_index
            uvl.data[li].uv = part.uv[vi]
            kl.data[li].uv = (part.kind[vi] / 4.0, 0.0)
            c = part.col[vi]; col.data[li].color = (c.x, c.y, c.z, 1.0)
    mesh.color_attributes.active_color = col
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in part.n])
    mesh.materials.append(MAT)
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)
    return obj


objs = {name: make(name, part) for name, part in P.items()}
print(f"PLANT {plant} seed {seed}: " + ', '.join(f'{k} {p.tris()} tris' for k, p in P.items()))
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_vertex_color='ACTIVE', export_all_vertex_colors=False)

# Preview (Cycles): the near plant and its fruit, the far version beside it.
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'CPU'
scene.render.resolution_x = 640; scene.render.resolution_y = 384
scene.view_settings.view_transform = 'AgX'
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.65, 0.8, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.5; sun.data.angle = math.radians(2)
sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
g = bpy.data.meshes.new('g'); g.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
go = bpy.data.objects.new('g', g); scene.collection.objects.link(go)
gm = bpy.data.materials.new('gm'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.1, 0.08, 1); g.materials.append(gm)
xs = [v.x for v in P['body'].v]; ys = [v.y for v in P['body'].v]; zs = [v.z for v in P['body'].v]
span = max(max(xs) - min(xs), max(ys) - min(ys), max(zs)) or 1.0
for name in ('bodyFar', 'fruitFar'):
    if objs[name]: objs[name].location.x = span * 1.15
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 50
target = Vector((span * 0.575, 0, max(zs) * 0.42))
cam.location = target + Vector((0, -span * 2.9, span * 0.75))
cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = preview_png
bpy.ops.render.render(write_still=True)
print('PREVIEW', preview_png)
