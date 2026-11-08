"""Count material shares and pixel extent in the flat-colour ID renders (render_stills.py id_* views).

  python -I art/drone/tools/measure.py DIR/r1_id_side.png [more.png ...]
"""
import sys
import numpy as np
from PIL import Image

PAL = {"orange": (1, 0.25, 0), "white": (1, 1, 1), "grey": (0.35, 0.35, 0.35), "dark": (0.06, 0.06, 0.06),
       "glass": (0, 0, 1), "beacon": (1, 1, 0), "gold": (0.9, 0.6, 0.1), "torn": (0.5, 0, 0.5)}


def srgb(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055) * 255


names = list(PAL)
cols = np.array([srgb(PAL[n]) for n in names])
for path in sys.argv[1:]:
    im = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    a = im[..., 3] > 128
    px = im[..., :3][a]
    d = ((px[:, None, :] - cols[None, :, :]) ** 2).sum(-1)
    lab = d.argmin(1)
    n = len(px)
    ys, xs = np.nonzero(a)
    share = {names[i]: (lab == i).sum() / max(n, 1) for i in range(len(names))}
    print(f"{path.split('/')[-1].split(chr(92))[-1]}: {n} px, span {xs.max() - xs.min() + 1} x {ys.max() - ys.min() + 1} px  "
          + "  ".join(f"{k} {100 * v:.1f}%" for k, v in share.items() if v > 0.0005))
