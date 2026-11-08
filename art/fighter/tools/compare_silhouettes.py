"""Compare top / side / front silhouettes of two triangle soups (JSON lists of [[x,y,z]x3], metres, old-model
frame: nose +X). Prints IoU per view and writes overlays: old only = red, new only = cyan, both = white.
usage: python -I compare_silhouettes.py old_tris.json old_scale new_tris.json new_scale out_prefix"""
import json, sys
from PIL import Image, ImageDraw

old = json.load(open(sys.argv[1])); so = float(sys.argv[2])
new = json.load(open(sys.argv[3])); sn = float(sys.argv[4])
out = sys.argv[5]
P = 100.0
FR = {"top": (0, 1, (-8.2, 8.2), (-6.9, 6.9)), "side": (0, 2, (-8.2, 8.2), (-1.7, 1.7)),
      "front": (1, 2, (-6.9, 6.9), (-1.7, 1.7))}


def raster(tris, s, ia, ib, ra, rb):
    W, H = int((ra[1] - ra[0]) * P), int((rb[1] - rb[0]) * P)
    im = Image.new("1", (W, H), 0)
    d = ImageDraw.Draw(im)
    for t in tris:
        d.polygon([((p[ia] * s - ra[0]) * P, H - (p[ib] * s - rb[0]) * P) for p in t], fill=1)
    return im


for name, (ia, ib, ra, rb) in FR.items():
    a = raster(old, so, ia, ib, ra, rb)
    b = raster(new, sn, ia, ib, ra, rb)
    pa, pb = a.load(), b.load()
    W, H = a.size
    inter = union = only_a = only_b = 0
    ov = Image.new("RGB", (W, H))
    po = ov.load()
    for y in range(H):
        for x in range(W):
            u, v = pa[x, y], pb[x, y]
            if u and v:
                inter += 1; po[x, y] = (235, 235, 235)
            elif u:
                only_a += 1; po[x, y] = (230, 40, 40)
            elif v:
                only_b += 1; po[x, y] = (40, 200, 230)
            if u or v:
                union += 1
    ov.save(f"{out}_{name}.png")
    print(f"{name:6s} IoU {inter / union:.3f}   old-only {only_a / union:.3f}  new-only {only_b / union:.3f}")
