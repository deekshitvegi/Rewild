# blender -b --factory-startup -P maketree2.py -- <tex_dir> <out.glb> <preview.png> <seed> <preset>
# Trees for the game, grown by rules learned from photographs (refs/): a trunk of bark tubes splitting into
# limbs, branches and twigs; foliage as cut-out photographs of leaf sprays clumped at the twigs; darker inside
# the crown and low down (vertex colours, which the game's tree shader reads as occlusion); leaf normals bent
# out of the crown so it is lit as one soft mass. Forms: broad (oak, ash, maple...), columnar (poplar),
# weeping (willow), conifer (spruce, pine, cedar), bush, dead. Two meshes, 'bark' and 'leaves' (trees.ts).
import bpy, math, random, sys
from mathutils import Vector, Quaternion
argv = sys.argv[sys.argv.index('--') + 1:]
tex_dir, out_glb, preview_png, seed, preset = argv[0], argv[1], argv[2], int(argv[3]), argv[4]
rnd = random.Random(seed)
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)

BROAD = dict(form='broad', height=15.0, trunk=3.6, radius=0.62, limbs=(4, 6), limb_len=(7.0, 9.0), limb_angle=(48, 72),
             levels=4, kids=(4, 6), kid_ratio=0.58, kid_angle=(32, 58), gravity=-0.06, up=0.11, jitter=0.10,
             leaf_size=(0.32, 0.52), leaves_per_twig=(10, 16), sides=(12, 8, 5, 3, 3), crown_squash=0.72,
             hollow=0.35, spray=0.55, card='out', tex='oak', bark_around=2.0, bark_tile=2.4, ao_bark=(0.82, 1.0))
def P(**k):
    d = dict(BROAD); d.update(k); return d
PRESETS = {
    'oakA': P(),
    'oakB': P(height=16.0, trunk=4.4, limb_angle=(38, 62), limbs=(4, 5)),
    'oakWide': P(height=13.0, trunk=3.0, radius=0.7, limb_angle=(58, 82), limb_len=(8.0, 10.0), crown_squash=0.6),
    'ashA': P(tex='ash', height=18.0, trunk=5.0, radius=0.5, limb_angle=(28, 48), limb_len=(7.0, 9.0), kid_angle=(28, 50), crown_squash=0.9),
    'ashTall': P(tex='ash', height=22.0, trunk=7.0, radius=0.55, limb_angle=(22, 40), limb_len=(7.5, 9.5), kid_angle=(25, 45), crown_squash=1.0),
    'mapleRed': P(tex='maple-red', height=13.0, trunk=3.2, radius=0.45, limb_angle=(38, 60), limb_len=(5.5, 7.0), leaves_per_twig=(13, 18), hollow=0.3),
    'mapleOrange': P(tex='maple-orange', height=14.0, trunk=3.6, radius=0.48, limb_angle=(34, 58), limb_len=(6.0, 7.5), leaves_per_twig=(13, 18), hollow=0.3),
    'aspenGold': P(form='excurrent', tex='aspen', height=16.0, radius=0.24, crown_from=0.34, branch_len=3.6, branch_angle=(38, 62),
                   levels=3, kids=(3, 5), kid_ratio=0.6, kid_angle=(30, 55), gravity=-0.04, leaves_per_twig=(9, 14),
                   leaf_size=(0.26, 0.4), crown_squash=1.6, hollow=0.25, sides=(9, 5, 3, 3), bark_around=1.0, bark_tile=1.6),
    'birch': P(form='excurrent', tex='birch', height=17.0, radius=0.26, crown_from=0.3, branch_len=4.2, branch_angle=(45, 70),
               levels=3, kids=(4, 6), kid_ratio=0.62, kid_angle=(25, 50), gravity=-0.3, leaves_per_twig=(9, 14),
               leaf_size=(0.28, 0.42), crown_squash=1.5, hollow=0.25, sides=(9, 5, 3, 3), bark_around=1.0, bark_tile=1.6),
    'poplar': P(form='excurrent', tex='poplar', height=22.0, radius=0.42, crown_from=0.06, branch_len=4.6, branch_angle=(22, 38),
                envelope='column', levels=3, kids=(3, 5), kid_ratio=0.55, kid_angle=(18, 35), up=0.2, gravity=-0.02,
                leaves_per_twig=(10, 15), leaf_size=(0.34, 0.5), crown_squash=3.2, hollow=0.2, sides=(10, 5, 3, 3), step_z=(0.24, 0.4)),
    'willow': P(form='weeping', tex='willow', height=11.0, trunk=3.0, radius=0.6, limbs=(5, 7), limb_angle=(15, 36), limb_len=(5.0, 6.5), levels=2),
    'spruce': P(form='conifer', kind='spruce', tex='spruce', height=20.0, radius=0.36),
    'pineA': P(form='conifer', kind='pine', tex='pine', height=19.0, radius=0.34, crown_from=0.52, shape='flat'),
    'pineB': P(form='conifer', kind='pine', tex='pine', height=14.0, radius=0.3, crown_from=0.22, shape='cone'),
    'cedar': P(form='conifer', kind='cedar', tex='spruce', height=17.0, radius=0.5),
    'bushA': P(form='bush', tex='hazel', height=2.6, leaf_size=(0.16, 0.26)),
    'bushB': P(form='bush', tex='oak', height=2.2, leaf_size=(0.15, 0.24)),
    'bushC': P(form='bush', tex='maple-orange', height=2.4, leaf_size=(0.16, 0.26)),
    # Haven's shrine garden and temples (8 Nov 2026): Japanese maples low and layered, red and orange-red; a black
    # pine trained as niwaki; Italian cypress.
    'jmapleRed': P(form='tiered', tex='jmaple-red', height=6.0, trunk=0.9, radius=0.17, leaders=(3, 5), leader_angle=(26, 48),
                   leader_len=(3.1, 4.1), tiers=(0.3, 0.5, 0.7, 0.88, 1.0), tier_len=(1.3, 2.1), leaf_size=(0.3, 0.42),
                   leaves_per_twig=(9, 13), crown_squash=0.5, hollow=0.0, bark_around=1.5, bark_tile=1.6, ao_bark=(0.75, 1.0)),
    'jmapleOrange': P(form='tiered', tex='jmaple-orange', height=5.5, trunk=1.1, radius=0.15, leaders=(4, 5), leader_angle=(28, 50),
                      leader_len=(2.9, 3.9), tiers=(0.3, 0.5, 0.7, 0.88, 1.0), tier_len=(1.25, 2.0), leaf_size=(0.3, 0.42),
                      leaves_per_twig=(9, 13), crown_squash=0.5, hollow=0.0, bark_around=1.5, bark_tile=1.6, ao_bark=(0.75, 1.0)),
    'pineNiwaki': P(form='niwaki', tex='niwaki', height=5.0, radius=0.26, lean=0.85, limbs=(6, 8), limb_len=(1.5, 2.6),
                    pad_r=(0.8, 1.15), pad_tufts=270, leaf_size=(0.42, 0.62), crown_squash=0.6, hollow=0.0,
                    bark_around=1.5, bark_tile=1.2, ao_bark=(0.7, 1.0)),
    'cypress': P(form='cypress', tex='cypress', height=17.0, radius=0.3, crown_r=0.72, shell_cards=2200, leaf_size=(0.55, 0.85),
                 crown_squash=4.0, hollow=0.0, bark_around=1.5, bark_tile=1.4),
    'deadTree': P(form='dead', tex='dead', height=13.0, trunk=3.8, radius=0.55, levels=4, limbs=(3, 5), limb_len=(5.5, 7.5),
                  limb_angle=(30, 55), kids=(3, 5), jitter=0.16, gravity=-0.03, sides=(14, 8, 6, 4, 3), ao_bark=(0.7, 1.0), limb_r=0.7, kid_r=0.68, kid_ratio=0.62),
}
S = PRESETS[preset]

verts, faces, uvs, cols, norms = [], [], [], [], []
# Per vertex: 1 where it belongs to the finest twigs, which a living tree leaves to its leaf sprays (their photographs
# carry their own stems) and a dead one shows. Exported as a second UV map, 'Twig' (u = 1 on a twig: the glTF exporter
# drops a colour's alpha the material does not use); trees.ts reads it.
twigs = []
leaf_quads = []   # (centre, size, rot, which, mode, axis)

def frame(d):
    d = d.normalized()
    a = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    x = d.cross(a).normalized(); y = d.cross(x).normalized()
    return x, y

def tube(pts, dirs, radii, sides, v0, twig=False, gnarl=0.0, flare=0.0):
    """Bark: rings round the points, UV round and along (the bark picture repeats). gnarl: how far the cross-section
    is from round (lobes that twist slowly along the wood); flare: the trunk's foot spreading into buttress roots."""
    base = len(verts); v = v0
    ph1, ph2, ph3 = rnd.uniform(0, 6.28), rnd.uniform(0, 6.28), rnd.uniform(0, 6.28)
    roots = rnd.randint(4, 6)
    for i, p in enumerate(pts):
        x, y = frame(dirs[i])
        if i > 0: v += (pts[i] - pts[i - 1]).length / S['bark_tile']
        twist = v * 0.9
        # The foot: wider, in lobes running down into the ground, over the first metre or so.
        foot = max(0.0, 1.0 - (p.z + 0.3) / 1.4) ** 2 if flare > 0 else 0.0
        for k in range(sides + 1):
            a = 2 * math.pi * k / sides
            n = x * math.cos(a) + y * math.sin(a)
            r = radii[i]
            if gnarl > 0:
                r *= 1 + gnarl * (math.sin(3 * a + ph1 + twist) * 0.6 + math.sin(5 * a + ph2 - twist * 0.7) * 0.4)
            if foot > 0:
                r *= 1 + flare * foot * (0.55 + 0.9 * max(0.0, math.cos(roots * a + ph3)) ** 3)
            verts.append(p + n * r); norms.append(n)
            uvs.append((S['bark_around'] * k / sides, v))
            lo, hi = S['ao_bark']
            cols.append(lo + (hi - lo) * min(1.0, max(0.0, p.z) / (S['height'] * 0.75)))
            twigs.append(1 if twig else 0)
    for i in range(len(pts) - 1):
        for k in range(sides):
            a = base + i * (sides + 1) + k; b = a + sides + 1
            faces.append((a, a + 1, b + 1, b))

def path(start, direction, length, level, up, gravity, jitter, step=0.5, kink=0.0):
    """kink: the chance at each step of a crook, where a bud died and a side shoot took over the lead."""
    steps = max(3, int(length / step))
    pts = [start.copy()]; dirs = []; d = direction.normalized()
    for i in range(steps):
        j = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        if kink > 0 and 0 < i < steps - 1 and rnd.random() < kink:
            sx, sy = frame(d); a = rnd.uniform(0, 6.28)
            j += (sx * math.cos(a) + sy * math.sin(a)) * rnd.uniform(0.35, 0.65)
        d = (d + j + Vector((0, 0, up)) + Vector((0, 0, gravity * (i / steps)))).normalized()
        dirs.append(d.copy()); pts.append(pts[-1] + d * (length / steps))
    dirs.append(d.copy())
    return pts, dirs

def point_on(pts, t):
    steps = len(pts) - 1; idx = min(int(t * steps), steps - 1)
    return pts[idx].lerp(pts[idx + 1], t * steps - idx), idx

def leaves_on(pts, count, from_t=0.55, spray=None, mode='out', size=None, local=None):
    spray = S['spray'] if spray is None else spray
    for _ in range(count):
        t = from_t + (1 - from_t) * rnd.random() ** 0.6
        p, idx = point_on(pts, t)
        r = spray * rnd.random() ** 0.5
        p = p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 1))).normalized() * r
        axis = (pts[min(idx + 1, len(pts) - 1)] - pts[idx]).normalized()
        leaf_quads.append((p, rnd.uniform(*(size or S['leaf_size'])), rnd.uniform(0, 2 * math.pi), rnd.randint(0, 1), mode, axis, local))

def twiglets(pts, radius, v0):
    """The finest twigs off a twig: a dead tree's crown is a haze of them. Marked as twigs (a living tree's leaf
    sprays carry them)."""
    for _ in range(rnd.randint(2, 4)):
        p, idx = point_on(pts, rnd.uniform(0.3, 0.95))
        x, y = frame((pts[min(idx + 1, len(pts) - 1)] - pts[idx]).normalized()); a = rnd.uniform(0, 6.28)
        d = ((pts[min(idx + 1, len(pts) - 1)] - pts[idx]).normalized() * 0.6 + (x * math.cos(a) + y * math.sin(a)) * 0.8 + Vector((0, 0, 0.25))).normalized()
        tp, td = path(p, d, rnd.uniform(0.25, 0.6), 5, 0.05, 0.0, 0.25, 0.2)
        n = len(tp) - 1
        tube(tp, td, [max(0.004, radius * (1 - 0.85 * i / n)) for i in range(n + 1)], 3, v0, twig=True)

def grow_broad(start, direction, length, r0, level, v0, dead=False):
    last = level >= S['levels']
    pts, dirs = path(start, direction, length, level, S['up'] if level < 2 else S['up'] * 0.5,
                     S['gravity'] * level, S['jitter'] + 0.05 * level, 0.6 if level < 2 else (0.7 if last else 0.45),
                     kink=0.0 if level == 0 else S.get('kink', 0.14))
    if level == 0:
        # Finer rings over the foot, so its buttresses are round, not faceted.
        fine_p, fine_d = [], []
        for i in range(len(pts) - 1):
            k = 3 if pts[i].z < 1.2 else 1
            for j in range(k):
                fine_p.append(pts[i].lerp(pts[i + 1], j / k)); fine_d.append(dirs[i].lerp(dirs[i + 1], j / k).normalized())
        fine_p.append(pts[-1]); fine_d.append(dirs[-1]); pts, dirs = fine_p, fine_d
    steps = len(pts) - 1
    # Wood thins as it goes: the trunk a little up to the crown, every branch nearly to a point at its tip.
    if level == 0:
        radii = [r0 * (1 - 0.6 * (i / steps)) for i in range(steps + 1)]
    else:
        radii = [max(0.005, r0 * max(0.07, 1 - i / steps) ** 0.8) for i in range(steps + 1)]
    sides = 3 if last else S['sides'][min(level, len(S['sides']) - 1)]
    # The last twigs live inside their leaf sprays, whose photographs carry their own stems: a living tree hides them.
    tube(pts, dirs, radii, sides, v0, twig=last and not dead,
         gnarl=S.get('gnarl', 0.09) if level < 2 else 0.0, flare=S.get('flare', 0.5) if level == 0 else 0.0)
    # A long-dead tree keeps a haze of the finest twigs too; a living one killed by the fire would have lost them.
    if last and dead:
        twiglets(pts, radii[len(radii) // 2] * 0.6, v0)
    if level < S['levels']:
        count = rnd.randint(*S['kids']) if level > 0 else rnd.randint(*S['limbs'])
        if dead and level >= 2: count = max(1, count - 1)
        golden = rnd.uniform(0, 2 * math.pi)
        for c in range(count):
            t = 0.78 + 0.22 * (c / max(count - 1, 1)) if level == 0 else 0.25 + 0.7 * (c + rnd.random() * 0.6) / count
            p, idx = point_on(pts, t)
            pd = dirs[idx]; x, y = frame(pd); golden += 2.39996
            ang = math.radians(rnd.uniform(*(S['limb_angle'] if level == 0 else S['kid_angle'])))
            nd = (pd * math.cos(ang) + (x * math.cos(golden) + y * math.sin(golden)) * math.sin(ang)).normalized()
            nl = rnd.uniform(*S['limb_len']) if level == 0 else length * S['kid_ratio'] * (1.15 - 0.5 * t) * rnd.uniform(0.85, 1.15)
            if dead and rnd.random() < 0.35: nl *= rnd.uniform(0.25, 0.5)   # broken off
            grow_broad(p, nd, nl, radii[idx] * (S.get('limb_r', 0.62) if level == 0 else S.get('kid_r', 0.55)), level + 1, v0 + rnd.uniform(0, 0.3), dead)
    if not dead and level >= S['levels'] - 1:
        n = rnd.randint(*S['leaves_per_twig'])
        leaves_on(pts, n if level == S['levels'] else n // 3)

def grow_excurrent():
    # One leader to the crown's top with branches all along its upper part, longest a third of the way up the
    # crown and shortening to the tip: the narrow, egg-shaped crowns of birch and aspen.
    H = S['height']
    pts, dirs = path(Vector((0, 0, -0.3)), Vector((rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 1)), H, 0, 0.0, 0.0, 0.035, 0.5)
    steps = len(pts) - 1
    radii = [S['radius'] * (1 - 0.94 * (i / steps)) ** 1.05 for i in range(steps + 1)]
    tube(pts, dirs, radii, S['sides'][0], 0.0)
    z0 = S['crown_from'] * H; z = z0; golden = rnd.random() * 6.28
    while z < H * 0.95:
        t = z / H; f = (z - z0) / (H * 0.95 - z0)
        p, idx = point_on(pts, t); golden += 2.39996 + rnd.uniform(-0.25, 0.25)
        x, y = frame(dirs[idx])
        ang = math.radians(rnd.uniform(*S['branch_angle']) * (1 - 0.35 * f))
        nd = (dirs[idx] * math.cos(ang) + (x * math.cos(golden) + y * math.sin(golden)) * math.sin(ang)).normalized()
        if S.get('envelope') == 'column':
            L = S['branch_len'] * (min(1.0, 0.55 + f * 3.0) * (1.0 - f ** 2.2) ** 0.7) * rnd.uniform(0.8, 1.15) + 0.4
        else:
            L = S['branch_len'] * (math.sin(math.pi * min(1.0, 0.18 + f * 0.95)) ** 0.7) * (1.0 - 0.45 * f) * rnd.uniform(0.75, 1.15) + 0.4
        grow_broad(p, nd, L, max(radii[idx] * 0.42, 0.03), 1, rnd.random())
        z += rnd.uniform(*S.get('step_z', (0.32, 0.55)))
    leaves_on(pts, 18, from_t=0.9, spray=0.6)

def grow_columnar():
    H = S['height']
    pts, dirs = path(Vector((0, 0, -0.3)), Vector((0, 0, 1)), H, 0, 0.0, 0.0, 0.03, 0.6)
    steps = len(pts) - 1
    radii = [S['radius'] * (1 - 0.95 * (i / steps)) ** 1.0 for i in range(steps + 1)]
    tube(pts, dirs, radii, 12, 0.0)
    z = H * 0.12; golden = 0.0
    while z < H * 0.97:
        t = z / H; p, idx = point_on(pts, t); golden += 2.39996
        ang = math.radians(rnd.uniform(14, 26))
        x, y = frame(dirs[idx]); nd = (Vector((0, 0, 1)) * math.cos(ang) + (x * math.cos(golden) + y * math.sin(golden)) * math.sin(ang)).normalized()
        L = (2.4 + rnd.uniform(-0.4, 0.6)) * (1.0 - 0.6 * t) * (0.6 + 0.4 * math.sin(math.pi * min(1, t * 1.3)))
        bp, bd = path(p, nd, L, 1, 0.05, -0.02, 0.06, 0.4)
        tube(bp, bd, [radii[idx] * 0.35 * (1 - 0.8 * i / (len(bp) - 1)) for i in range(len(bp))], 5, rnd.random())
        leaves_on(bp, rnd.randint(10, 15), from_t=0.15, spray=0.45)
        z += rnd.uniform(0.18, 0.32)

def grow_weeping():
    # A short thick trunk; limbs rising steeply; from them, branches that climb, arch over and fall,
    # so the crown is a dome; and from every arch, strands hanging in curtains that flare a little
    # as they fall and stop at different heights above the ground.
    arcs = []
    trunk_pts, trunk_dirs = path(Vector((0, 0, -0.3)), Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), 1)), S['trunk'], 0, 0.02, 0.0, 0.05, 0.5)
    steps = len(trunk_pts) - 1
    tr = [S['radius'] * (1 - 0.35 * (i / steps)) for i in range(steps + 1)]
    tube(trunk_pts, trunk_dirs, tr, 14, 0.0)
    n = rnd.randint(*S['limbs']); golden = rnd.random() * 6.28
    for c in range(n):
        p, idx = point_on(trunk_pts, 0.82 + 0.18 * c / max(n - 1, 1)); golden += 2.39996
        x, y = frame(trunk_dirs[idx]); ang = math.radians(rnd.uniform(*S['limb_angle']))
        nd = (trunk_dirs[idx] * math.cos(ang) + (x * math.cos(golden) + y * math.sin(golden)) * math.sin(ang)).normalized()
        L = rnd.uniform(*S['limb_len'])
        lp, ld = path(p, nd, L, 1, 0.05, -0.02, 0.07, 0.5)
        tube(lp, ld, [tr[idx] * 0.55 * (1 - 0.65 * i / (len(lp) - 1)) for i in range(len(lp))], 9, rnd.random())
        k = rnd.randint(4, 6); g2 = rnd.random() * 6.28
        for j in range(k):
            q, qi = point_on(lp, 0.35 + 0.65 * j / max(k - 1, 1)); g2 += 2.39996
            bx, by = frame(ld[qi])
            out = Vector((q.x, q.y, 0)); out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
            sd = (out * 0.75 + Vector((0, 0, 0.6)) + (bx * math.cos(g2) + by * math.sin(g2)) * 0.35).normalized()
            AL = rnd.uniform(3.5, 5.5)
            ap, ad = [q.copy()], []
            d = sd.copy(); segs = 10
            for s_ in range(segs):   # up, over, and down: the arch bends more the further out it gets
                d = (d + Vector((0, 0, -0.16 - 0.1 * s_ / segs)) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.05).normalized()
                ad.append(d.copy()); ap.append(ap[-1] + d * (AL / segs))
            ad.append(d.copy())
            tube(ap, ad, [max(tr[idx] * 0.16, 0.025) * (1 - 0.8 * i / segs) for i in range(segs + 1)], 4, rnd.random())
            arcs.append(ap)
    # Curtains: strands from all along every arch.
    for ap in arcs:
        for i in range(1, len(ap)):
            for _ in range(rnd.randint(2, 3)):
                q = ap[i] + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0))
                drop = min(q.z - rnd.uniform(0.3, 1.8), rnd.uniform(2.5, 6.5))
                if drop < 0.9: continue
                out = Vector((q.x, q.y, 0)); out = out.normalized() if out.length > 1e-3 else Vector((1, 0, 0))
                m = max(2, int(drop / 1.0))
                for k in range(m):
                    c = q + out * (0.05 * k) + Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), -(k + 0.5) * drop / m))
                    leaf_quads.append((c, drop / m * 1.3, rnd.uniform(0, 6.28), rnd.randint(0, 1), 'hang', Vector((0, 0, -1))))

def grow_conifer():
    H = S['height']; kind = S['kind']
    pts, dirs = path(Vector((0, 0, -0.3)), Vector((rnd.uniform(-0.03, 0.03), rnd.uniform(-0.03, 0.03), 1)), H, 0, 0.0, 0.0, 0.02, 0.5)
    steps = len(pts) - 1
    radii = [S['radius'] * (1 - 0.97 * (i / steps)) ** 0.9 for i in range(steps + 1)]
    tube(pts, dirs, radii, 12, 0.0)
    z0 = S.get('crown_from', {'spruce': 0.1, 'pine': 0.55, 'cedar': 0.18}[kind]) * H
    z = z0; golden = rnd.random() * 6.28
    while z < H * 0.985:
        t = z / H; f = (z - z0) / (H - z0)
        p, idx = point_on(pts, t)
        whorl = rnd.randint(4, 6) if kind != 'pine' else rnd.randint(3, 5)
        for w in range(whorl):
            golden += 2.39996 + rnd.uniform(-0.3, 0.3)
            if kind == 'spruce':
                L = (H * 0.27) * (1 - f) ** 0.95 + 0.35; elev = math.radians(-18 + 40 * f)
            elif kind == 'cedar':
                L = (H * 0.36) * (1 - f) ** 0.8 + 0.4; elev = math.radians(-4 + 20 * f)
            else:
                if S.get('shape') == 'cone':   # a young pine: a loose cone of whorls
                    L = (H * 0.22) * (1 - f) ** 0.75 + 0.5; elev = math.radians(6 + 30 * f)
                else:                          # an old pine: a wide, flat-topped, ragged crown on a bare trunk
                    L = (H * 0.3) * math.sin(math.pi * min(1.0, 0.32 + f * 0.62)) ** 0.6 * rnd.uniform(0.6, 1.15) + 0.6
                    elev = math.radians(rnd.uniform(-6, 14) + 26 * f)
            out = Vector((math.cos(golden), math.sin(golden), 0))
            nd = (out * math.cos(elev) + Vector((0, 0, math.sin(elev)))).normalized()
            up = 0.06 if kind == 'spruce' else 0.03
            bp, bd = path(p, nd, L, 1, up, -0.10 if kind == 'spruce' else -0.04, 0.05, 0.5)
            tube(bp, bd, [max(radii[idx] * 0.32, 0.02) * (1 - 0.85 * i / (len(bp) - 1)) for i in range(len(bp))], 4 if L > 2.5 else 3, rnd.random())
            if kind == 'pine':
                # Side shoots forking off the outer part of the branch, turned up at their ends, each ending in a
                # clump of needle tufts: the crown is a cloud of dark clumps with sky between them.
                leaves_on(bp, rnd.randint(8, 12), from_t=0.7, spray=0.45, mode='tuft', size=(0.6, 0.95))
                s_ = 0.3
                while s_ < 0.92:
                    q, qi = point_on(bp, s_); bx, by = frame(bd[qi]); b_ = rnd.random() * 6.28
                    sd = (bd[qi] * 0.6 + (bx * math.cos(b_) + by * math.sin(b_)) * 0.7 + Vector((0, 0, 0.35))).normalized()
                    sl = L * rnd.uniform(0.28, 0.45) * (1.1 - 0.5 * s_)
                    sp, sdirs = path(q, sd, sl, 2, 0.12, 0.0, 0.1, 0.4)
                    tube(sp, sdirs, [max(radii[idx] * 0.12, 0.015) * (1 - 0.7 * i / (len(sp) - 1)) for i in range(len(sp))], 4, rnd.random())
                    leaves_on(sp, rnd.randint(6, 10), from_t=0.55, spray=0.4, mode='tuft', size=(0.6, 0.95))
                    s_ += rnd.uniform(0.14, 0.24)
            else:
                # Flat sprays along the branch and on side shoots either side of it, lying nearly level and pointing
                # out: layer on layer of them, so the tree is a dense dark cone and the branches barely show.
                big = (0.8, 1.25) if kind == 'spruce' else (0.9, 1.35)
                leaves_on(bp, max(4, int(L * 5)), from_t=0.05, spray=0.2, mode='flat', size=big)
                s_ = 0.12
                while s_ < 0.92 and L > 0.8:
                    q, qi = point_on(bp, s_); bx, by = frame(bd[qi])
                    side = 1 if int(s_ * 100) % 2 else -1
                    sd = (bd[qi] * 0.75 + (bx if abs(bx.z) < abs(by.z) else by) * side * 0.65).normalized()
                    sl = L * (0.42 * (1 - s_) + 0.12)
                    sp, sdirs = path(q, sd, sl, 2, 0.0, -0.18, 0.06, 0.45)
                    if sl > 1.7:   # shorter shoots hide inside their own sprays; the picture carries their stems
                        tube(sp, sdirs, [max(radii[idx] * 0.08, 0.008) * (1 - 0.8 * i / (len(sp) - 1)) for i in range(len(sp))], 3, rnd.random())
                    leaves_on(sp, max(2, int(sl * 4)), from_t=0.15, spray=0.12, mode='flat', size=big)
                    s_ += rnd.uniform(0.09, 0.16)
        z += rnd.uniform(0.42, 0.6) if kind != 'pine' else rnd.uniform(0.6, 0.9)

def grow_bush():
    H = S['height']
    for s_ in range(rnd.randint(6, 9)):
        a = rnd.random() * 6.28; ang = math.radians(rnd.uniform(8, 42))
        nd = Vector((math.cos(a) * math.sin(ang), math.sin(a) * math.sin(ang), math.cos(ang)))
        pts, dirs = path(Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), -0.1)), nd, H * rnd.uniform(0.75, 1.05), 1, 0.04, -0.05, 0.12, 0.3)
        tube(pts, dirs, [0.05 * (1 - 0.8 * i / (len(pts) - 1)) for i in range(len(pts))], 5, rnd.random())
        for k in range(rnd.randint(3, 5)):
            p, idx = point_on(pts, 0.3 + 0.65 * rnd.random()); x, y = frame(dirs[idx]); b = rnd.random() * 6.28
            sd = (dirs[idx] * 0.6 + (x * math.cos(b) + y * math.sin(b)) * 0.8).normalized()
            sp, sdirs = path(p, sd, H * rnd.uniform(0.25, 0.45), 2, 0.03, -0.08, 0.15, 0.2)
            tube(sp, sdirs, [0.025 * (1 - 0.8 * i / (len(sp) - 1)) for i in range(len(sp))], 3, rnd.random())
            leaves_on(sp, rnd.randint(22, 32), from_t=0.15, spray=0.32)
        leaves_on(pts, rnd.randint(14, 22), from_t=0.35, spray=0.38)

def fan(p, d, L, r):
    """A Japanese maple's tier: a limb held nearly level, forking sideways into a flat fan of twigs, the leaves lying
    on it in a layer."""
    pts, dirs = path(p, d, L, 2, 0.0, -0.025, 0.06, 0.3, kink=0.1)
    n = len(pts) - 1
    tube(pts, dirs, [max(0.004, r * (1 - 0.85 * i / n)) for i in range(n + 1)], 5, rnd.random())
    s_ = rnd.uniform(0.15, 0.3); sgn = 1
    while s_ < 0.95:
        q, qi = point_on(pts, s_); sgn = -sgn
        hz = Vector((dirs[qi].x, dirs[qi].y, 0)); hz = hz.normalized() if hz.length > 1e-3 else Vector((1, 0, 0))
        side = Vector((-hz.y, hz.x, 0)) * sgn
        sd = (dirs[qi] * 0.55 + side * 0.85 + Vector((0, 0, rnd.uniform(-0.05, 0.12)))).normalized()
        sl = L * rnd.uniform(0.3, 0.5) * (1.15 - 0.6 * s_)
        sp, sdirs = path(q, sd, sl, 3, 0.0, -0.02, 0.1, 0.2)
        m = len(sp) - 1
        tube(sp, sdirs, [max(0.003, r * 0.45 * (1 - 0.85 * i / m)) for i in range(m + 1)], 3, rnd.random())
        mid, _ = point_on(sp, 0.55)
        leaves_on(sp, rnd.randint(*S['leaves_per_twig']), from_t=0.1, spray=0.22, mode='tier',
                  local=(mid - Vector((0, 0, 0.06)), 0.4, 0.45))
        s_ += rnd.uniform(0.08, 0.14)
    leaves_on(pts, rnd.randint(*S['leaves_per_twig']), from_t=0.45, spray=0.25, mode='tier')

def grow_tiered():
    """Japanese maple (Acer palmatum): a short trunk dividing low into a few leaders that lean out and wander; along
    each, limbs held level in tiers, fanning into twigs; the fine leaves lie in layers on the tiers, air between."""
    lean = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 1)).normalized()
    pts, dirs = path(Vector((0, 0, -0.3)), lean, S['trunk'] + 0.3, 0, 0.0, 0.0, 0.05, 0.25)
    steps = len(pts) - 1; r0 = S['radius']
    tube(pts, dirs, [r0 * (1 - 0.2 * i / steps) for i in range(steps + 1)], 14, 0.0, gnarl=0.12, flare=0.6)
    top = pts[-1]; golden = rnd.random() * 6.28
    for c in range(rnd.randint(*S['leaders'])):
        golden += 2.39996 + rnd.uniform(-0.3, 0.3)
        ang = math.radians(rnd.uniform(*S['leader_angle']))
        out = Vector((math.cos(golden), math.sin(golden), 0))
        d = (Vector((0, 0, 1)) * math.cos(ang) + out * math.sin(ang)).normalized()
        start = top - Vector((0, 0, rnd.uniform(0, 0.25))) + out * r0 * 0.3
        lp, ld = path(start, d, rnd.uniform(*S['leader_len']), 1, 0.02, -0.03, 0.07, 0.35, kink=0.12)
        m = len(lp) - 1
        rl = r0 * 0.62 * rnd.uniform(0.8, 1.0)
        lr = [max(0.012, rl * (1 - 0.8 * i / m) ** 0.9) for i in range(m + 1)]
        tube(lp, ld, lr, 9, rnd.random(), gnarl=0.06)
        for f in S['tiers']:
            f = min(1.0, f + rnd.uniform(-0.06, 0.06))
            p, idx = point_on(lp, f * 0.98)
            for k in range(rnd.randint(2, 3) if f < 0.95 else 2):
                a = golden + rnd.uniform(-1.7, 1.7)
                el = math.radians(rnd.uniform(-6, 14))
                hd = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
                fan(p, hd, rnd.uniform(*S['tier_len']) * (1.15 - 0.45 * f), max(0.01, lr[idx] * 0.55))

def pad(e, d, R):
    """A niwaki pad: twigs radiating level from a limb's end, and over them a flat cloud of needle tufts, densest
    on its upper face, lit as a mass of its own."""
    hz = Vector((d.x, d.y, 0)); hz = hz.normalized() if hz.length > 1e-3 else Vector((1, 0, 0))
    c = e + hz * R * 0.25 + Vector((0, 0, 0.12))
    for k in range(rnd.randint(5, 8)):
        a = rnd.uniform(0, 6.28); dd = Vector((math.cos(a), math.sin(a), rnd.uniform(0.05, 0.25))).normalized()
        sp, sd = path(e, dd, R * rnd.uniform(0.5, 0.85), 2, 0.05, 0.0, 0.15, 0.2)
        m = len(sp) - 1
        tube(sp, sd, [max(0.004, 0.022 * (1 - 0.8 * i / m)) for i in range(m + 1)], 4, rnd.random())
    thick = R * S.get('pad_thick', 0.34)
    lc = (c + Vector((0, 0, -thick * 0.3)), R, 0.45)
    ex = rnd.uniform(1.0, 1.3); turn = rnd.uniform(0, 6.28)
    for i in range(int(S['pad_tufts'] * (R / 0.9) ** 2)):
        r = math.sqrt(rnd.random()); a = rnd.uniform(0, 6.28)
        top = thick * (0.15 + 0.85 * math.sqrt(max(0.0, 1 - r * r)))
        z = top * rnd.random() ** 0.35
        x, y = math.cos(a) * r * R * ex, math.sin(a) * r * R
        p = c + Vector((x * math.cos(turn) - y * math.sin(turn), x * math.sin(turn) + y * math.cos(turn), z - thick * 0.25))
        leaf_quads.append((p, rnd.uniform(*S['leaf_size']), rnd.uniform(0, 6.28), rnd.randint(0, 1), 'tuft', Vector((0, 0, 1)), lc))

def grow_niwaki():
    """A Japanese black pine (Pinus thunbergii) trained as niwaki: a trunk that leans and twists; a few long limbs
    held level, each ending in a flat cloud of needles (a pad), with open air between the pads; a pad at the top."""
    H = S['height']
    a0 = rnd.uniform(0, 6.28)
    leanv = Vector((math.cos(a0), math.sin(a0), 0)); side = Vector((-leanv.y, leanv.x, 0))
    pts = [Vector((0, 0, -0.3))]; dirs = []
    steps = 16; Lt = H * 0.92
    for i in range(steps):
        t = i / steps
        wob = math.sin(t * math.pi * 2.0 + 0.3) * 0.55
        dd = (Vector((0, 0, 1)) + leanv * (S['lean'] * (1 - 0.9 * t) + wob * 0.5) + side * math.sin(t * 5.5 + 1.0) * 0.28).normalized()
        dirs.append(dd); pts.append(pts[-1] + dd * Lt / steps)
    dirs.append(dirs[-1])
    radii = [S['radius'] * (1 - 0.62 * (i / steps)) ** 1.2 for i in range(steps + 1)]
    tube(pts, dirs, radii, 14, 0.0, gnarl=0.16, flare=0.6)
    n = rnd.randint(*S['limbs']); golden = rnd.random() * 6.28
    # tiers up the trunk, alternating sides, each pad smaller and nearer the trunk than the one below
    for k, f in enumerate(0.42 + 0.46 * (i / max(n - 1, 1)) + rnd.uniform(-0.03, 0.03) for i in range(n)):
        golden += 2.39996 + rnd.uniform(-0.4, 0.4)
        p, idx = point_on(pts, f)
        out = Vector((math.cos(golden), math.sin(golden), 0))
        # the lowest limb reaches furthest, out over the side the trunk leans to
        if k == 0: out = (leanv * 0.8 + out * 0.4).normalized()
        L = rnd.uniform(*S['limb_len']) * ((1.25 if k == 0 else 1.0) - 0.6 * f)
        el = math.radians(rnd.uniform(-5, 9))
        d = (out * math.cos(el) + Vector((0, 0, math.sin(el)))).normalized()
        lp, ld = path(p, d, L, 1, 0.03, 0.0, 0.08, 0.3, kink=0.15)
        m = len(lp) - 1
        tube(lp, ld, [max(0.015, radii[idx] * 0.45 * (1 - 0.6 * i / m)) for i in range(m + 1)], 7, rnd.random(), gnarl=0.05)
        pad(lp[-1], ld[-1], rnd.uniform(*S['pad_r']) * (1.1 - 0.3 * f))
        if L > 1.6 and rnd.random() < 0.6:
            # a smaller pad on a side shoot partway along
            q, qi = point_on(lp, rnd.uniform(0.45, 0.6))
            sd = (ld[qi] + Vector((-ld[qi].y, ld[qi].x, 0)) * rnd.choice((-1, 1)) * 0.9 + Vector((0, 0, 0.2))).normalized()
            sp, sdirs = path(q, sd, rnd.uniform(0.5, 0.8), 2, 0.05, 0.0, 0.08, 0.25)
            tube(sp, sdirs, [0.02 * (1 - 0.5 * i / (len(sp) - 1)) for i in range(len(sp))], 5, rnd.random())
            pad(sp[-1], sdirs[-1], rnd.uniform(*S['pad_r']) * 0.6)
    pad(pts[-1], dirs[-1], rnd.uniform(*S['pad_r']) * 0.8)

def grow_cypress():
    """Italian cypress (Cupressus sempervirens 'Stricta'): one leader to a pointed top, short branches all the way
    up held steeply against it, and the foliage in upright sprays packed into a narrow column, widest a third of
    the way up."""
    H = S['height']; Rm = S['crown_r']
    pts, dirs = path(Vector((0, 0, -0.3)), Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02), 1)), H, 0, 0.0, 0.0, 0.015, 0.5)
    steps = len(pts) - 1
    radii = [S['radius'] * (1 - 0.96 * i / steps) ** 0.9 for i in range(steps + 1)]
    tube(pts, dirs, radii, 10, 0.0, flare=0.4)
    def env(z):
        t = z / H
        if t < 0.03: return 0.0
        rise = min(1.0, (t - 0.03) / 0.12) ** 0.6
        fall = (1 - max(0.0, (t - 0.3) / 0.7) ** 1.5) ** 0.85 if t > 0.3 else 1.0
        return Rm * rise * max(0.04, fall)
    z = 0.6; golden = rnd.random() * 6.28
    while z < H * 0.97:
        p, idx = point_on(pts, z / H); R = env(z)
        golden += 2.39996
        out = Vector((math.cos(golden), math.sin(golden), 0))
        ang = math.radians(rnd.uniform(14, 28))
        d = (Vector((0, 0, 1)) * math.cos(ang) + out * math.sin(ang)).normalized()
        L = min(2.5, max(0.25, R / math.sin(ang) * rnd.uniform(0.6, 0.9)))
        bp, bd = path(p, d, L, 1, 0.02, 0.0, 0.04, 0.4)
        m = len(bp) - 1
        tube(bp, bd, [max(0.006, radii[idx] * 0.25 * (1 - 0.8 * i / m)) for i in range(m + 1)], 3, rnd.random())
        z += rnd.uniform(0.14, 0.22)
    for i in range(S['shell_cards']):
        z = H * (0.03 + 0.97 * rnd.random() ** 0.9); R = env(z)
        if R < 0.05: continue
        a = rnd.uniform(0, 6.28); r = R * (0.45 + 0.6 * rnd.random() ** 0.5)
        ap, _ = point_on(pts, z / H)
        p = Vector((ap.x + math.cos(a) * r, ap.y + math.sin(a) * r, z))
        leaf_quads.append((p, rnd.uniform(*S['leaf_size']) * (0.55 + 0.45 * min(1.0, R / Rm)), rnd.uniform(-0.4, 0.4), rnd.randint(0, 1),
                           'shell', Vector((0, 0, 1)), (Vector((ap.x, ap.y, z)), R, 1.0)))

form = S['form']
if form in ('broad', 'dead'):
    lean = Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), 1)).normalized()
    grow_broad(Vector((0, 0, -0.3)), lean, S['trunk'] + rnd.uniform(-0.4, 0.6), S['radius'] * rnd.uniform(0.9, 1.1), 0, 0.0, dead=form == 'dead')
elif form == 'columnar': grow_columnar()
elif form == 'excurrent': grow_excurrent()
elif form == 'weeping': grow_weeping()
elif form == 'conifer': grow_conifer()
elif form == 'bush': grow_bush()
elif form == 'tiered': grow_tiered()
elif form == 'niwaki': grow_niwaki()
elif form == 'cypress': grow_cypress()

leaf_base = len(verts)
if leaf_quads:
    lp = [q[0] for q in leaf_quads]
    centre = sum(lp, Vector()) / len(lp)
    reach = max((p - centre).length for p in lp)
    kept = []
    for q in leaf_quads:
        rel = q[0] - centre; rel.z /= S['crown_squash']
        if q[4] == 'out' and rel.length / max(reach, 1e-3) < S['hollow'] and rnd.random() < 0.85: continue
        kept.append(q)
    for q_ in kept:
        p, size, rot, which, mode, axis = q_[:6]
        local = q_[6] if len(q_) > 6 else None
        # Lit as the mass it belongs to: the whole crown, or its own pad or layer of the column.
        lc, lr, lsq = local if local else (centre, reach, S['crown_squash'])
        out = p - lc; out.z /= lsq; out = out.normalized() if out.length > 1e-4 else Vector((0, 0, 1))
        if mode == 'out':
            face_n = (out + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.5, 1))) * 0.7).normalized()
            x, y = frame(face_n); q = Quaternion(face_n, rot); x = q @ x; y = q @ y
            hx = hy = size / 2
        elif mode == 'tuft':
            face_n = (out + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.9).normalized()
            x, y = frame(face_n); q = Quaternion(face_n, rot); x = q @ x; y = q @ y
            hx = hy = size / 2
        elif mode == 'tier':
            # A maple's layer: lying on the tier, facing the sky, tipped a little at random.
            face_n = (Vector((0, 0, 1)) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)) * 0.45).normalized()
            x, y = frame(face_n); q = Quaternion(face_n, rot); x = q @ x; y = q @ y
            hx = hy = size / 2
        elif mode == 'shell':
            # Upright sprays round a column, facing out, their stems down (the picture's stem is at its top).
            face_n = (out + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))) * 0.35).normalized()
            y = -(Vector((0, 0, 1)) - face_n * face_n.z).normalized()
            y = Quaternion(face_n, rot) @ y
            x = y.cross(face_n).normalized()
            hx = hy = size / 2
        elif mode == 'flat':
            # Lying along the branch, nearly level, tipped a little at random.
            along = Vector((axis.x, axis.y, axis.z * 0.3)).normalized()
            side = along.cross(Vector((0, 0, 1))).normalized()
            tilt = Quaternion(along, rnd.uniform(-0.35, 0.35))
            x = along; y = tilt @ side
            face_n = x.cross(y).normalized()
            if face_n.z < 0: face_n = -face_n
            hx = size * 0.6; hy = size * 0.4
        else:  # 'hang': upright strands, turned at random about the vertical
            a = rot; x = Vector((math.cos(a), math.sin(a), 0)); y = Vector((0, 0, 1))
            face_n = x.cross(y).normalized()
            hx = size * 0.15; hy = size * 0.5
        corners = [p - x * hx - y * hy, p + x * hx - y * hy, p + x * hx + y * hy, p - x * hx + y * hy]
        u0, u1 = (0.0, 0.5) if which == 0 else (0.5, 1.0)
        cuv = [(u0, 0.0), (u1, 0.0), (u1, 1.0), (u0, 1.0)]
        rel = p - lc; rel.z /= lsq
        dist = rel.length / max(lr, 1e-3)
        outer = max(0.0, min(1.0, (dist - 0.35) / 0.6))
        top = max(0.0, min(1.0, (p.z - lc.z) / lr * 0.8 + 0.55))
        ao = 0.5 + 0.5 * outer * (0.7 + 0.3 * top)
        if mode == 'shell': ao *= 0.72 + 0.28 * min(1.0, p.z / S['height'])
        if mode == 'tier' and local:
            # a layer in a crown: its own top lit, its underside dark, and the whole crown darker inside
            g = p - centre; g.z /= S['crown_squash']
            ao *= 0.62 + 0.38 * max(0.0, min(1.0, (g.length / max(reach, 1e-3) - 0.2) / 0.6))
        if mode == 'hang': ao = 0.62 + 0.38 * outer
        if mode == 'flat':
            # A conifer's sprays are lit as the layers they are: from above, and from the side they face out to.
            radial = Vector((p.x, p.y, 0.0)); radial = radial.normalized() if radial.length > 1e-3 else Vector((1, 0, 0))
            n_soft = (radial * 0.6 + Vector((0, 0, 1)) * 0.6 + face_n * 0.2).normalized()
        elif mode == 'hang':
            n_soft = (out * 0.5 + face_n * 0.5).normalized()
        elif mode == 'tier':
            n_soft = (Vector((0, 0, 1)) * 0.55 + out * 0.45 + face_n * 0.2).normalized()
        elif mode == 'shell':
            n_soft = (out * 0.7 + Vector((0, 0, 0.3)) + face_n * 0.2).normalized()
        else:
            n_soft = (out * 0.75 + face_n * 0.25).normalized()
        b = len(verts)
        for c, uv in zip(corners, cuv):
            verts.append(c); uvs.append(uv); cols.append(ao); norms.append(n_soft); twigs.append(0)
        faces.append((b, b + 1, b + 2, b + 3))
else:
    # A dead tree has no leaves: one tiny transparent card keeps the game's two-part layout.
    b = len(verts)
    for c in [(0, 0, 1.5), (0.01, 0, 1.5), (0.01, 0, 1.51), (0, 0, 1.51)]:   # inside the trunk
        verts.append(Vector(c)); uvs.append((0.25, 0.02)); cols.append(1.0); norms.append(Vector((0, 0, 1))); twigs.append(0)
    faces.append((b, b + 1, b + 2, b + 3))

def make(name, face_list, material):
    used = sorted({i for f in face_list for i in f}); remap = {o: n for n, o in enumerate(used)}
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(verts[i]) for i in used], [], [tuple(remap[i] for i in f) for f in face_list]); mesh.update()
    mesh.color_attributes.new(name='Col', type='BYTE_COLOR', domain='CORNER')
    mesh.uv_layers.new(name='UVMap')
    mesh.uv_layers.new(name='Twig')
    # (The pictures keep reading the first map.)
    mesh.uv_layers['UVMap'].active_render = True; mesh.uv_layers.active = mesh.uv_layers['UVMap']
    uvl = mesh.uv_layers['UVMap']; twl = mesh.uv_layers['Twig']; col = mesh.color_attributes['Col']
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vi = used[mesh.loops[li].vertex_index]
            uvl.data[li].uv = uvs[vi]; a = cols[vi]; col.data[li].color = (a, a, a, 1.0)
            twl.data[li].uv = (float(twigs[vi]), 0.0)
    mesh.normals_split_custom_set_from_vertices([tuple(norms[i]) for i in used])
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(obj)

def material(name, picture, normal=None, clip=False):
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(picture)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if clip:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha']); mat.blend_method = 'CLIP'
    if normal:
        nm = nt.nodes.new('ShaderNodeTexImage'); nm.image = bpy.data.images.load(normal); nm.image.colorspace_settings.name = 'Non-Color'
        nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nm.outputs['Color'], nmap.inputs['Color']); nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = 0.9 if not clip else 0.7
    return mat

T = S['tex']
make('bark', [f for f in faces if f[0] < leaf_base], material('bark', f'{tex_dir}/{T}-bark.png', f'{tex_dir}/{T}-bark-normal.png'))
make('leaves', [f for f in faces if f[0] >= leaf_base], material('leaves', f'{tex_dir}/{T}-leaves.png', clip=True))
assert len(twigs) == len(verts), (len(twigs), len(verts))
tris = sum(len(f) - 2 for f in faces)
twig_tris = sum(len(f) - 2 for f in faces if f[0] < leaf_base and twigs[f[0]])
print(f'TREE {preset} seed {seed}: {len(verts)} verts, {tris} tris ({twig_tris} in twigs), {len(leaf_quads)} leaf cards, height {max(v.z for v in verts):.1f} m')
bpy.ops.export_scene.gltf(filepath=out_glb, export_format='GLB', export_attributes=True)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.cycles.device = 'CPU'
scene.render.resolution_x = 384; scene.render.resolution_y = 384
scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Medium High Contrast'
world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
sky = world.node_tree.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA' if bpy.app.version < (5, 0, 0) else 'MULTIPLE_SCATTERING'; sky.sun_elevation = math.radians(38); sky.sun_rotation = math.radians(215)
world.node_tree.links.new(sky.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color']); world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3.0; sun.data.angle = math.radians(1.5)
sun.rotation_euler = (math.radians(52), 0, math.radians(35)); scene.collection.objects.link(sun)
g = bpy.data.meshes.new('g'); g.from_pydata([(-40, -40, 0), (40, -40, 0), (40, 40, 0), (-40, 40, 0)], [], [(0, 1, 2, 3)])
go = bpy.data.objects.new('g', g); scene.collection.objects.link(go)
gm = bpy.data.materials.new('gm'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.16, 0.04, 1); g.materials.append(gm)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
Hh = max(v.z for v in verts)
cam.location = (Hh * 1.1, -Hh * 1.4, max(1.7, Hh * 0.3)); cam.data.lens = 40
cam.rotation_euler = (Vector((0, 0, Hh * 0.48)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = preview_png
bpy.ops.render.render(write_still=True)
print('PREVIEW', preview_png)
