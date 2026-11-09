"""Measure the flat-colour ID renders (render_stills.py id_* views) and compare with the concept.

  python -I art/reaper/tools/measure.py shares DIR/r1_id_concept.png [more.png ...]
      material shares of the ship's pixels and pixel extent
  python -I art/reaper/tools/measure.py iou DIR/r1_id_concept.png [overlay.png]
      silhouette IoU against the traced concept (tools/concept_trace.json, 1344x752); writes an overlay
      (both = grey, concept only = red, build only = cyan)
  python -I art/reaper/tools/measure.py lum DIR/r1_concept.png DIR/r1_id_concept.png
      median luminance, warm / cool shares and hot-pixel share of the ship in a lit render (concept: 0.135,
      47% warm, 30% cool, 0.52% hot)
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PAL = {"dark": (0.25, 0.25, 0.25), "tint": (0.6, 0.3, 0.05), "bare": (1, 1, 1), "seam_hot": (1, 0.1, 0),
       "engine_hot": (1, 1, 0), "interior": (0, 0, 0.6)}


def srgb(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * c ** (1 / 2.4) - 0.055) * 255


def load_id(path):
    im = np.asarray(Image.open(path).convert("RGBA")).astype(float)
    return im[..., :3], im[..., 3] > 128


def concept_mask(shape):
    P = json.load(open(os.path.join(HERE, "concept_trace.json")))
    H, W = shape
    m = Image.new("L", (1344, 752), 0)
    ImageDraw.Draw(m).polygon([tuple(p) for p in P], fill=255)
    m = m.resize((W, H), Image.NEAREST)
    return np.asarray(m) > 0


mode = sys.argv[1]
if mode == "shares":
    names = list(PAL)
    cols = np.array([srgb(PAL[n]) for n in names])
    for path in sys.argv[2:]:
        rgb, a = load_id(path)
        px = rgb[a]
        lab = ((px[:, None, :] - cols[None, :, :]) ** 2).sum(-1).argmin(1)
        n = len(px)
        ys, xs = np.nonzero(a)
        share = {names[i]: (lab == i).sum() / max(n, 1) for i in range(len(names))}
        print(f"{os.path.basename(path)}: {n} px, span {xs.max() - xs.min() + 1} x {ys.max() - ys.min() + 1} px  "
              + "  ".join(f"{k} {100 * v:.2f}%" for k, v in share.items() if v > 0.00005))
elif mode == "iou":
    rgb, a = load_id(sys.argv[2])
    m = concept_mask(a.shape)
    inter, uni = (a & m).sum(), (a | m).sum()
    print(f"IoU {inter / uni:.3f}  concept-only {(m & ~a).sum() / uni:.3f}  build-only {(a & ~m).sum() / uni:.3f}")
    if len(sys.argv) > 3:
        ov = np.zeros(a.shape + (3,), np.uint8)
        ov[a & m] = (200, 200, 200)
        ov[m & ~a] = (230, 40, 40)
        ov[a & ~m] = (40, 200, 230)
        Image.fromarray(ov).save(sys.argv[3])
elif mode == "lum":
    lit = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(float) / 255
    _, a = load_id(sys.argv[3])
    px = lit[a]
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    mx, mn = px.max(1), px.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    hot = (r > 0.55) & (r > g * 1.6) & (g > b * 1.2) & (sat > 0.55)
    warm = (r > b * 1.15) & ~hot
    cool = b > r * 1.05
    print(f"median lum {np.median(lum):.3f}  warm {100 * warm.mean():.1f}%  cool {100 * cool.mean():.1f}%  "
          f"hot {100 * hot.mean():.2f}%  (concept 0.135, 47.5%, 30.0%, 0.52%)")
