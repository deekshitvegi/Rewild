"""Contact sheets for the still loop.

  python -I art/reaper/tools/compose.py grid OUT.png COLS img1 img2 ...      (labelled grid, each tile 800 px wide)
  python -I art/reaper/tools/compose.py pair OUT.png REF.png NEW.png [label] (reference | still, same height)
  python -I art/reaper/tools/compose.py stack OUT.png REF.png NEW.png [label] (reference over still, same width)
  python -I art/reaper/tools/compose.py crop OUT.png IMG.png W H SCALE [CX CY] (crop round CX,CY, nearest zoom)
  python -I art/reaper/tools/compose.py jpg OUT.jpg IMG.png WIDTH            (final still: resize, JPEG 88)
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
try:
    font = ImageFont.truetype("arial.ttf", 22)
except Exception:
    font = ImageFont.load_default()


def label(im, t):
    d = ImageDraw.Draw(im)
    d.rectangle([6, 6, 14 + d.textlength(t, font=font), 36], fill=(0, 0, 0))
    d.text((10, 9), t, fill=(255, 255, 255), font=font)
    return im


mode, out = sys.argv[1], sys.argv[2]
if mode == "grid":
    cols = int(sys.argv[3])
    paths = sys.argv[4:]
    tw = 800
    tiles = []
    for p in paths:
        im = Image.open(p).convert("RGB")
        im = im.resize((tw, int(im.height * tw / im.width)), Image.LANCZOS)
        tiles.append(label(im, os.path.splitext(os.path.basename(p))[0]))
    th = max(t.height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw + (cols - 1) * 6, rows * th + (rows - 1) * 6), (255, 255, 255))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * (tw + 6), (i // cols) * (th + 6)))
    sheet.save(out)
elif mode in ("pair", "stack"):
    a = Image.open(sys.argv[3]).convert("RGB")
    b = Image.open(sys.argv[4]).convert("RGB")
    if mode == "pair":
        h = 700
        a = a.resize((int(a.width * h / a.height), h), Image.LANCZOS)
        b = b.resize((int(b.width * h / b.height), h), Image.LANCZOS)
        im = Image.new("RGB", (a.width + b.width + 8, h), (255, 255, 255))
        im.paste(label(a, "concept"), (0, 0))
        im.paste(label(b, sys.argv[5] if len(sys.argv) > 5 else "build"), (a.width + 8, 0))
    else:
        w = 1344
        a = a.resize((w, int(a.height * w / a.width)), Image.LANCZOS)
        b = b.resize((w, int(b.height * w / b.width)), Image.LANCZOS)
        im = Image.new("RGB", (w, a.height + b.height + 8), (255, 255, 255))
        im.paste(label(a, "concept"), (0, 0))
        im.paste(label(b, sys.argv[5] if len(sys.argv) > 5 else "build"), (0, a.height + 8))
    im.save(out)
elif mode == "crop":
    im = Image.open(sys.argv[3]).convert("RGB")
    w, h, s = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
    cx, cy = (int(sys.argv[7]), int(sys.argv[8])) if len(sys.argv) > 8 else (im.width // 2, im.height // 2)
    c = im.crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)).resize((w * s, h * s), Image.NEAREST)
    c.save(out)
elif mode == "autocrop":
    # crop IMG round the ship found in an ID render (alpha), pad, nearest zoom: autocrop OUT IMG ID SCALE [PAD]
    import numpy as np
    im = Image.open(sys.argv[3]).convert("RGB")
    a = np.asarray(Image.open(sys.argv[4]).convert("RGBA"))[..., 3] > 128
    s_, pad = int(sys.argv[5]), int(sys.argv[6]) if len(sys.argv) > 6 else 12
    ys, xs = np.nonzero(a)
    box = (xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad)
    c = im.crop(box)
    c.resize((c.width * s_, c.height * s_), Image.NEAREST).save(out)
elif mode == "inset":
    # final chase still: the full game frame with a nearest-zoom inset of the ship: inset OUT IMG ID WIDTH SCALE
    import numpy as np
    im = Image.open(sys.argv[3]).convert("RGB")
    a = np.asarray(Image.open(sys.argv[4]).convert("RGBA"))[..., 3] > 128
    w, s_ = int(sys.argv[5]), int(sys.argv[6])
    ys, xs = np.nonzero(a)
    pad = 10
    c = im.crop((xs.min() - pad, ys.min() - pad, xs.max() + pad, ys.max() + pad))
    c = c.resize((c.width * s_, c.height * s_), Image.NEAREST)
    k = w / im.width
    big = im.resize((w, round(im.height * k)), Image.LANCZOS)
    x0, y0 = big.width - c.width - 16, 16
    d = ImageDraw.Draw(big)
    d.rectangle([x0 - 2, y0 - 2, x0 + c.width + 1, y0 + c.height + 1], outline=(200, 200, 200))
    big.paste(c, (x0, y0))
    big.save(out, quality=88)
elif mode == "jpg":
    im = Image.open(sys.argv[3]).convert("RGB")
    w = int(sys.argv[4])
    im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(out, quality=88)
print("wrote", out)
