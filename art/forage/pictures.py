# python3 pictures.py <outdir>
# The pictures the forage plants are painted with, drawn from the botany rather than photographed: leaf blades
# with their real outlines (lobes, sinuses, teeth), primary and secondary veins and the mottling of a living
# leaf; skins for the fruit (a melon's net, a prickly pear's areoles, the ribs of a bulb); bark for the stems.
# Each plant gets one 1024 x 1024 atlas of 256 px tiles, laid out as makeplant.py expects (TILES below):
# <outdir>/<plant>-atlas.png, RGBA, alpha cut round the leaves and flowers.
import math, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

T = 256          # tile size in the atlas
SS = 4           # supersampling when drawing
rng = np.random.default_rng(11)


def srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def noise2(n, scale, seed, octaves=3):
    """Smooth value noise on an n x n grid, roughly 0..1, features about `scale` pixels across."""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cells = max(2, int(n / scale) + 2)
        g = r.random((cells, cells))
        img = Image.fromarray((g * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        out += np.asarray(img).astype(np.float64) / 255.0 * amp
        total += amp; amp *= 0.5; scale /= 2.0
    return out / total


def finish(rgb, alpha, size=T, dilate=True):
    """Downsample a supersampled picture; colour bleeds out under the cut so mip levels keep the leaf's own colour."""
    n = rgb.shape[0]
    rgbi = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), 'RGB').resize((size, size), Image.LANCZOS)
    ai = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8), 'L').resize((size, size), Image.LANCZOS)
    arr = np.concatenate([np.asarray(rgbi), np.asarray(ai)[..., None]], -1).copy()
    if dilate:
        m = arr[..., 3] > 16
        if m.any():
            arr[~m, :3] = arr[m][:, :3].mean(0).astype(np.uint8)
            # and the rim a little further, from the nearest leaf colour
            blurred = np.asarray(Image.fromarray(arr[..., :3]).filter(ImageFilter.GaussianBlur(3)))
            rim = (~m) & (np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(9))) > 0)
            arr[rim, :3] = blurred[rim]
    return arr


def polar(n, cx, cy):
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    dx, dy = x - cx, cy - y
    return dx, dy, np.hypot(dx, dy), np.arctan2(dx, dy)   # theta 0 = up (toward the tile's top)


def palmate(lobes, teeth, tooth_depth, base=(0.5, 0.86), cordate=0.0, seed=0, round_tip=0.8, core=0.0):
    """A palmately lobed blade: each lobe (angle, length, half-width rad) is a petal of radius L * (1 - (d/w)^2)^p
    round the petiole's end; the margin carries teeth spaced along its length. Returns (mask, R(theta) sampler,
    centre) at SS * T resolution, leaf tip toward the tile's top."""
    n = T * SS
    cx, cy = base[0] * n, base[1] * n
    th = np.linspace(-math.pi, math.pi, 8192, endpoint=False)
    R = np.zeros_like(th)
    for (phi, L, w) in lobes:
        d = np.angle(np.exp(1j * (th - phi)))
        f = np.clip(1 - (d / w) ** 2, 0, None) ** round_tip
        R = np.maximum(R, L * n * f)
    if core > 0:
        # the blade's middle: the sinuses between the lobes stop short of the centre (a smooth union)
        k = core * lobes[0][1] * n
        R = 0.5 * (R + k + np.sqrt((R - k) ** 2 + (0.08 * n) ** 2))
    if cordate > 0:
        # the sinus at the petiole: the blade folds back round it
        d = np.angle(np.exp(1j * (th - math.pi)))
        R *= 1 - cordate * np.exp(-(d / 0.35) ** 2)
    # teeth by arc length: a saw whose points lean toward the lobe tips
    s = np.cumsum(np.maximum(R, 1.0) * (2 * math.pi / th.size))
    spacing = teeth * n
    phase = (s / spacing) % 1.0
    saw = np.where(phase < 0.62, phase / 0.62, (1 - phase) / 0.38) ** 0.7
    # doubly toothed: each tooth carries a smaller one on its rising edge
    small = (s / (spacing * 0.5)) % 1.0
    saw = np.clip(saw - 0.18 * (1 - np.where(small < 0.6, small / 0.6, (1 - small) / 0.4)) * (phase < 0.62), 0, 1)
    r2 = np.random.default_rng(seed)
    jitter = 1 + 0.25 * np.interp(np.arange(th.size), np.linspace(0, th.size, 40), r2.random(40))
    R = R * (1 - tooth_depth * jitter * (1 - saw) * np.clip(R / (0.12 * n), 0, 1))
    dx, dy, r, t = polar(n, cx, cy)
    Rt = np.interp(t, th, R, period=2 * math.pi)
    mask = np.clip((Rt - r) / 1.5 + 0.5, 0, 1)
    return mask, (cx, cy), r, t, Rt


def elliptic(length, width, a=0.9, b=0.8, tip=1.6, teeth=0.0, tooth_depth=0.0, seed=0):
    """A blade along a midrib from the tile's bottom to its top: half-width w(t) = W sin(pi t^a)^b, narrowing
    to a point at the tip. Returns mask and the leaf's (u across, t along) coordinates."""
    n = T * SS
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    y0, y1 = n * (0.5 + length / 2), n * (0.5 - length / 2)
    t = (y0 - y) / (y0 - y1)
    tc = np.clip(t, 0, 1)
    hw = width * n / 2 * np.sin(math.pi * tc ** a) ** b * (1 - 0.15 * tc ** tip)
    if teeth > 0:
        phase = (t * length * n / (teeth * n)) % 1.0
        hw = hw * (1 - tooth_depth * (1 - np.abs(phase * 2 - 1)))
    u = (x - n / 2) / np.maximum(hw, 1e-3)
    mask = np.clip((hw - np.abs(x - n / 2)) / 1.5 + 0.5, 0, 1) * (t >= 0) * (t <= 1)
    return mask, u, t, hw


def draw_lines(n, segments, widths, value=1.0):
    img = Image.new('L', (n, n), 0)
    d = ImageDraw.Draw(img)
    for seg, w in zip(segments, widths):
        d.line(seg, fill=int(255 * value), width=max(1, int(w)), joint='curve')
    return np.asarray(img).astype(np.float64) / 255.0


def palmate_veins(centre, lobes, n, primary=10, secondary=4, spacing=0.07, angle=0.75, seed=0):
    """Veins of a palmate leaf: a primary to each lobe's tip, secondaries off it toward the margin."""
    cx, cy = centre
    r = np.random.default_rng(seed)
    prim, sec = [], []
    for (phi, L, w) in lobes:
        L = L * n
        tip = (cx + math.sin(phi) * L * 0.93, cy - math.cos(phi) * L * 0.93)
        pts = [(cx + (tip[0] - cx) * k / 10 + r.normal(0, 1.5), cy + (tip[1] - cy) * k / 10 + r.normal(0, 1.5)) for k in range(11)]
        for k in range(10):
            prim.append(([pts[k], pts[k + 1]], primary * (1 - 0.75 * k / 10)))
        s = spacing * n
        along = s
        while along < L * 0.85:
            p = (cx + math.sin(phi) * along, cy - math.cos(phi) * along)
            for side in (-1, 1):
                a = phi + side * angle * (0.9 + 0.2 * r.random())
                ln = min(L * w * 0.85, (L - along) * 0.9) * (0.8 + 0.3 * r.random())
                q = (p[0] + math.sin(a) * ln, p[1] - math.cos(a) * ln)
                mid = ((p[0] + q[0]) / 2 + r.normal(0, 2), (p[1] + q[1]) / 2 + r.normal(0, 2))
                sec.append(([p, mid, q], secondary))
            along += s * (0.85 + 0.3 * r.random())
    return prim, sec


def leaf_colour(mask, veins_p, veins_s, base, vein_tint, seed, edge_dark=0.15, mottle=0.12, yellow=0.0, red=0.0, dist=None):
    n = mask.shape[0]
    col = np.ones((n, n, 3)) * base
    m1 = noise2(n, n / 5, seed)
    m2 = noise2(n, n / 22, seed + 1)
    col *= (1 + mottle * (m1 - 0.5) * 2)[..., None]
    col *= (1 + 0.06 * (m2 - 0.5) * 2)[..., None]
    if yellow > 0:
        y = np.clip((noise2(n, n / 3, seed + 2) - (1 - yellow)) * 2, 0, 1) * 0.6
        col = col * (1 - y[..., None]) + srgb('#9a9a34') ** 2.2 * y[..., None]
    if red > 0:
        y = np.clip((noise2(n, n / 4, seed + 3) - (1 - red)) * 3, 0, 1)
        col = col * (1 - y[..., None]) + srgb('#7a2a1c') ** 2.2 * y[..., None]
    # darker toward the margin, where the blade is thinnest and the light comes through least
    if dist is not None:
        col *= (1 - edge_dark * (1 - np.clip(dist, 0, 1)))[..., None]
    v = np.clip(veins_p + veins_s * 0.7, 0, 1)
    col = col * (1 - v[..., None] * 0.55) + vein_tint * v[..., None] * 0.55
    return col


def edge_distance(mask, reach=24):
    """0 at the margin rising to 1 about `reach` px in."""
    img = Image.fromarray((mask > 0.5).astype(np.uint8) * 255)
    acc = np.zeros(mask.shape)
    cur = img
    for k in range(reach // 4):
        cur = cur.filter(ImageFilter.MinFilter(9))
        acc += np.asarray(cur) > 0
    return acc / (reach // 4)


def to_lin(c):
    return np.asarray(c) ** 2.2


def out(rgb_lin, alpha):
    return finish(rgb_lin ** (1 / 2.2), alpha)


# ---------------------------------------------------------------------------- leaves

def currant_leaf(seed, yellow=0.0):
    """Ribes rubrum: three main lobes and two small basal ones, broad, coarsely double-toothed, cordate base."""
    r = np.random.default_rng(seed)
    j = lambda v, s=0.06: v * (1 + r.normal(0, s))
    lobes = [(0.0, j(0.56), 0.78), (j(-1.05, 0.04), j(0.48), 0.72), (j(1.05, 0.04), j(0.48), 0.72),
             (j(-2.1, 0.04), j(0.3), 0.6), (j(2.1, 0.04), j(0.3), 0.6)]
    mask, c, rr, tt, Rt = palmate(lobes, teeth=0.048, tooth_depth=0.055, base=(0.5, 0.64), cordate=0.6, seed=seed, round_tip=0.6, core=0.62)
    n = mask.shape[0]
    prim, sec = palmate_veins(c, lobes, n, primary=9, secondary=2.5, spacing=0.06, angle=0.55, seed=seed)
    vp = draw_lines(n, [s for s, w in prim], [w for s, w in prim])
    vs = draw_lines(n, [s for s, w in sec], [w for s, w in sec])
    vp = np.asarray(Image.fromarray((vp * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))) / 255.0
    vs = np.asarray(Image.fromarray((vs * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))) / 255.0
    base = to_lin(srgb('#42722f') * (1 + r.normal(0, 0.05)))
    col = leaf_colour(mask, vp, vs * 0.45, base, to_lin(srgb('#8fb05a')), seed, edge_dark=0.18, mottle=0.14, yellow=yellow,
                      dist=edge_distance(mask))
    # the blade puckers between the veins: lighter on the bulges
    pucker = noise2(n, n / 14, seed + 5)
    col *= (0.92 + 0.16 * pucker)[..., None]
    return out(col, mask)


def melon_leaf(seed):
    """Cucumis melo: rounded, five shallow lobes, deeply cordate, finely toothed, rough and greyish green."""
    r = np.random.default_rng(seed)
    j = lambda v, s=0.05: v * (1 + r.normal(0, s))
    lobes = [(0.0, j(0.5), 0.95), (j(-1.2), j(0.46), 0.85), (j(1.2), j(0.46), 0.85),
             (j(-2.3), j(0.36), 0.7), (j(2.3), j(0.36), 0.7)]
    mask, c, rr, tt, Rt = palmate(lobes, teeth=0.03, tooth_depth=0.035, base=(0.5, 0.6), cordate=0.75, seed=seed, round_tip=0.45, core=0.78)
    n = mask.shape[0]
    prim, sec = palmate_veins(c, lobes, n, primary=11, secondary=4, spacing=0.06, angle=0.9, seed=seed)
    vp = draw_lines(n, [s for s, w in prim], [w for s, w in prim])
    vs = draw_lines(n, [s for s, w in sec], [w for s, w in sec])
    vp = np.asarray(Image.fromarray((vp * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5))) / 255.0
    vs = np.asarray(Image.fromarray((vs * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))) / 255.0
    base = to_lin(srgb('#5b7a37') * (1 + r.normal(0, 0.05)))
    col = leaf_colour(mask, vp, vs * 0.5, base, to_lin(srgb('#b4c487')), seed, edge_dark=0.2, mottle=0.16,
                      yellow=0.12 if seed % 3 == 0 else 0.0, dist=edge_distance(mask))
    rough = noise2(n, 6, seed + 9, octaves=2)
    col *= (0.9 + 0.2 * rough)[..., None]
    return out(col, mask)


def frost_leaf(seed):
    """A small leathery evergreen leaf, elliptic, its margin rolled under and rimed white with frost."""
    r = np.random.default_rng(seed)
    mask, u, t, hw = elliptic(0.86, 0.52 * (1 + r.normal(0, 0.06)), a=0.85, b=0.6, tip=2.0, teeth=0.05, tooth_depth=0.03)
    n = mask.shape[0]
    mid = np.exp(-(u * hw / 5.0) ** 2) * (t > 0) * (t < 0.97)
    secv = np.zeros_like(mask)
    for k in range(7):
        t0 = 0.12 + k * 0.11
        ln = (t - t0 - np.abs(u) * 0.22)
        secv = np.maximum(secv, np.exp(-(ln * n / 4.0) ** 2) * (np.abs(u) < 0.85))
    dist = edge_distance(mask, 20)
    base = to_lin(srgb('#2f4f4a') * (1 + r.normal(0, 0.05)))
    col = leaf_colour(mask, mid, secv * 0.5, base, to_lin(srgb('#6f8f84')), seed, edge_dark=-0.05, mottle=0.1, dist=dist)
    # rime on the margin
    frost = np.clip(1 - dist * 2.2, 0, 1) * (0.6 + 0.4 * noise2(n, 10, seed + 4))
    col = col * (1 - frost[..., None] * 0.75) + to_lin(srgb('#d9eef2')) * frost[..., None] * 0.75
    col *= (0.88 + 0.24 * (1 - np.abs(u).clip(0, 1)))[..., None]   # the blade folded up along the midrib
    return out(col, mask)


def frond(seed):
    """A strap-shaped frond (the ice-kelp's): 256 x 512, wavy ruffled margins, parallel veins, teal fading to a
    clear, pale tip."""
    n = T * SS
    H = 2 * n
    y, x = np.mgrid[0:H, 0:n].astype(np.float64)
    t = (H * 0.98 - y) / (H * 0.96)
    tc = np.clip(t, 0, 1)
    r = np.random.default_rng(seed)
    hw = n * 0.36 * (np.sin(math.pi * np.clip(tc * 0.9 + 0.1, 0, 1) ** 0.6) ** 0.5) * (1 - 0.55 * tc ** 3)
    ruffle = 1 + 0.1 * np.sin(t * 46 + r.random() * 6) + 0.05 * np.sin(t * 97 + r.random() * 6)
    hw = hw * ruffle
    ax = n / 2 + n * 0.03 * np.sin(t * 5 + r.random() * 6)
    u = (x - ax) / np.maximum(hw, 1e-3)
    mask = np.clip((hw - np.abs(x - ax)) / 1.5 + 0.5, 0, 1) * (t >= 0) * (t <= 1)
    veins = 0.5 + 0.5 * np.cos(u * math.pi * 7)
    col = np.ones((H, n, 3)) * to_lin(srgb('#2e6f6a'))
    tip = np.clip((tc - 0.45) / 0.55, 0, 1)
    col = col * (1 - tip[..., None]) + to_lin(srgb('#a9d6cf')) * tip[..., None]
    col *= (0.9 + 0.12 * veins)[..., None]
    col *= (0.85 + 0.3 * noise2(H, 30, seed + 1)[:, :n])[..., None] if False else 1.0
    base = np.clip(1 - tc / 0.12, 0, 1)
    col = col * (1 - base[..., None] * 0.5) + to_lin(srgb('#d7e6d6')) * base[..., None] * 0.5
    rgb = (np.clip(col, 0, 1) ** (1 / 2.2))
    img = Image.fromarray((rgb * 255).astype(np.uint8), 'RGB').resize((T, 2 * T), Image.LANCZOS)
    a = Image.fromarray((mask * 255).astype(np.uint8), 'L').resize((T, 2 * T), Image.LANCZOS)
    arr = np.concatenate([np.asarray(img), np.asarray(a)[..., None]], -1).copy()
    m = arr[..., 3] > 16
    arr[~m, :3] = arr[m][:, :3].mean(0).astype(np.uint8)
    return arr


def melon_flower(seed):
    """Five-petalled yellow flower, petals rounded and crinkled, a deeper centre."""
    n = T * SS
    dx, dy, r, t = polar(n, n / 2, n / 2)
    petals = 5
    rr = n * 0.42 * (0.72 + 0.28 * np.abs(np.cos(t * petals / 2)) ** 0.6)
    mask = np.clip((rr - r) / 1.5 + 0.5, 0, 1)
    col = np.ones((n, n, 3)) * to_lin(srgb('#f2c53d'))
    col *= (0.85 + 0.15 * np.cos(t * petals * 6) * (r / n))[..., None]
    centre = np.clip(1 - r / (n * 0.12), 0, 1)
    col = col * (1 - centre[..., None]) + to_lin(srgb('#c98a1c')) * centre[..., None]
    return out(col, mask)


# ---------------------------------------------------------------------------- skins and bark

def solid(colour='#ffffff', speckle=0.06, seed=0):
    n = T * SS
    col = np.ones((n, n, 3)) * to_lin(srgb(colour))
    col *= (1 + speckle * (noise2(n, 8, seed, 2) - 0.5) * 2)[..., None]
    return out(col, np.ones((n, n)))


def bark(colour, streak=0.25, lenticels=0.0, seed=0):
    """Thin-stem bark: fine streaks along the stem (v), a few pale lenticels across it."""
    n = T * SS
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    r = np.random.default_rng(seed)
    st = np.asarray(Image.fromarray((r.random((8, n // 2)) * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)) / 255.0
    col = np.ones((n, n, 3)) * to_lin(srgb(colour))
    col *= (1 + streak * (st - 0.5) * 2)[..., None]
    if lenticels > 0:
        lt = np.zeros((n, n))
        for _ in range(int(60 * lenticels)):
            cx, cy = r.random() * n, r.random() * n
            lt = np.maximum(lt, np.exp(-(((x - cx) / 18) ** 2 + ((y - cy) / 5) ** 2)))
        col = col * (1 - lt[..., None] * 0.5) + to_lin(srgb('#b8a990')) * lt[..., None] * 0.5
    return out(col, np.ones((n, n)))


def melon_skin(seed):
    """A netted melon's rind: a raised tan net over golden skin, with faint sutures running pole to pole (v)."""
    n = T * SS
    r = np.random.default_rng(seed)
    pts = r.random((90, 2)) * n
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    d1 = np.full((n, n), 1e9, np.float32); d2 = np.full((n, n), 1e9, np.float32)
    for px, py in pts:
        for ox in (-n, 0, n):           # wrap round in u
            d = np.hypot(x - px - ox, (y - py) * 1.3)
            nd2 = np.minimum(d2, np.maximum(d1, d)); d1 = np.minimum(d1, d); d2 = nd2
    edge = np.clip(1 - (d2 - d1) / 7.0, 0, 1)
    col = np.ones((n, n, 3)) * to_lin(srgb('#f4ecd8'))
    col *= (0.92 + 0.16 * noise2(n, n / 6, seed))[..., None]
    sut = 0.5 + 0.5 * np.cos(x / n * 2 * math.pi * 10)
    col *= (1 - 0.12 * sut ** 6)[..., None]
    col = col * (1 - edge[..., None] * 0.7) + to_lin(srgb('#fff8e8')) * edge[..., None] * 0.7
    return out(col, np.ones((n, n)))


def areole_skin(colour, seed, spacing=0.17, spines=True, felt='#8a6a45'):
    """An Opuntia pad's skin: areoles in a quincunx, each a tuft of brown felt with fine pale spines."""
    n = T * SS
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    r = np.random.default_rng(seed)
    col = np.ones((n, n, 3)) * to_lin(srgb(colour))
    col *= (0.9 + 0.2 * noise2(n, n / 5, seed))[..., None]
    col *= (0.95 + 0.1 * noise2(n, 10, seed + 1, 2))[..., None]
    s = spacing * n
    img = Image.new('L', (n, n), 0); d = ImageDraw.Draw(img)
    felt_m = np.zeros((n, n))
    for j in range(-1, int(n / s) + 2):
        for i in range(-1, int(n / s) + 2):
            cx = i * s + (s / 2 if j % 2 else 0) + r.normal(0, s * 0.05)
            cy = j * s * 0.9 + r.normal(0, s * 0.05)
            felt_m = np.maximum(felt_m, np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * (s * 0.07) ** 2)))
            if spines:
                for k in range(r.integers(2, 5)):
                    a = r.normal(-math.pi / 2, 0.6); L = s * r.uniform(0.25, 0.5)
                    d.line([(cx, cy), (cx + math.cos(a) * L, cy + math.sin(a) * L)], fill=230, width=3)
    sp = np.asarray(img) / 255.0
    col = col * (1 - felt_m[..., None]) + to_lin(srgb(felt)) * felt_m[..., None]
    col = col * (1 - sp[..., None] * 0.8) + to_lin(srgb('#e9e2c4')) * sp[..., None] * 0.8
    return out(col, np.ones((n, n)))


def ribbed(colour, ribs, seed, depth=0.25, vein='#ffffff'):
    """Skin ribbed from pole to pole (v), ribs across u: a bulb's scale veins, a pod's sutures."""
    n = T * SS
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    col = np.ones((n, n, 3)) * to_lin(srgb(colour))
    rib = 0.5 + 0.5 * np.cos(x / n * 2 * math.pi * ribs)
    col *= (1 - depth + depth * rib)[..., None]
    fine = 0.5 + 0.5 * np.cos(x / n * 2 * math.pi * ribs * 5 + noise2(n, 40, seed) * 3)
    col = col * (1 - 0.12 * fine[..., None]) + to_lin(srgb(vein)) * 0.12 * fine[..., None]
    col *= (0.93 + 0.14 * noise2(n, n / 6, seed + 1))[..., None]
    return out(col, np.ones((n, n)))


def succulent_skin(seed):
    """A succulent's leaf: glaucous bloom over grey-green, fine dots (stomata in rows), a smooth sheen left to the
    shader."""
    n = T * SS
    col = np.ones((n, n, 3)) * to_lin(srgb('#ffffff'))
    col *= (0.9 + 0.12 * noise2(n, n / 4, seed))[..., None]
    dots = noise2(n, 3, seed + 2, 1)
    col *= (1 - 0.1 * (dots > 0.72))[..., None]
    return out(col, np.ones((n, n)))


# ---------------------------------------------------------------------------- atlases

def blank():
    return np.zeros((T, T, 4), np.uint8)


def atlas(tiles):
    """tiles: {(col, row): array}; a 512-tall tile takes (col, row) and (col, row + 1)."""
    A = np.zeros((4 * T, 4 * T, 4), np.uint8)
    for (c, rw), arr in tiles.items():
        h, w = arr.shape[:2]
        A[rw * T:rw * T + h, c * T:c * T + w] = arr
    return Image.fromarray(A, 'RGBA')


# Bark and skins are drawn near white: the detail is theirs, the colour the vertex colours' (makeplant.py).
PLANTS = {
    # Tiles: (0..3, 0) leaves; (0, 2) bark; (1, 2) plain (fruit painted by vertex colour); (2, 2), (3, 2) skins;
    # (0..3, 3) flowers and the like. A frond takes (c, 0) and (c, 1).
    'currant': lambda: {(0, 0): currant_leaf(1), (1, 0): currant_leaf(2), (2, 0): currant_leaf(3), (3, 0): currant_leaf(4, yellow=0.35),
                        (0, 2): bark('#e8e0d6', 0.3, 0.6, 5), (1, 2): solid('#ffffff', 0.04, 6), (2, 2): bark('#ecf0e6', 0.15, 0.0, 7)},
    'melon': lambda: {(0, 0): melon_leaf(1), (1, 0): melon_leaf(2), (2, 0): melon_leaf(3), (3, 0): melon_leaf(4),
                      (0, 2): bark('#eef2e4', 0.2, 0.0, 5), (1, 2): solid('#ffffff', 0.04, 6), (2, 2): melon_skin(7),
                      (0, 3): melon_flower(8)},
    'opuntia': lambda: {(0, 2): areole_skin('#eef2e6', 3), (1, 2): solid('#ffffff', 0.04, 6),
                        (2, 2): areole_skin('#ffffff', 4, spacing=0.22, spines=False, felt='#c9a46a'), (3, 2): bark('#eeeee4', 0.2, 0.0, 7)},
    'rosette': lambda: {(0, 2): succulent_skin(3), (1, 2): solid('#ffffff', 0.04, 6), (2, 2): ribbed('#ffffff', 6, 4, depth=0.2),
                        (3, 2): bark('#eeeae0', 0.2, 0.0, 7)},
    'frostberry': lambda: {(0, 0): frost_leaf(1), (1, 0): frost_leaf(2), (2, 0): frost_leaf(3), (3, 0): frost_leaf(4),
                           (0, 2): bark('#ece2dc', 0.3, 0.3, 5), (1, 2): solid('#ffffff', 0.05, 6)},
    'icekelp': lambda: {(0, 0): frond(1), (1, 0): frond(2), (2, 0): frond(3),
                        (0, 2): ribbed('#ffffff', 9, 4, depth=0.18), (1, 2): solid('#ffffff', 0.04, 6), (3, 2): bark('#e4ecea', 0.2, 0.0, 7)},
}

if __name__ == '__main__':
    outdir = sys.argv[1]
    which = sys.argv[2:] or list(PLANTS)
    for name in which:
        tiles = PLANTS[name]()
        atlas(tiles).save(f'{outdir}/{name}-atlas.png')
        print('atlas', name)
