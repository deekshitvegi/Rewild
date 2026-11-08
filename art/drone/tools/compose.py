"""Contact sheets for the still loop.

  python -I art/drone/tools/compose.py grid OUT.png COLS img1 img2 ...      (labelled grid, each tile 800 px wide)
  python -I art/drone/tools/compose.py pair OUT.png REF.png NEW.png [label] (reference | still, same height)
  python -I art/drone/tools/compose.py crop OUT.png IMG.png W H SCALE [CX CY] (crop round CX,CY (default centre), nearest zoom)
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
elif mode == "pair":
    a = Image.open(sys.argv[3]).convert("RGB")
    b = Image.open(sys.argv[4]).convert("RGB")
    h = 700
    a = a.resize((int(a.width * h / a.height), h), Image.LANCZOS)
    b = b.resize((int(b.width * h / b.height), h), Image.LANCZOS)
    im = Image.new("RGB", (a.width + b.width + 8, h), (255, 255, 255))
    im.paste(label(a, "reference"), (0, 0))
    im.paste(label(b, sys.argv[5] if len(sys.argv) > 5 else "drone"), (a.width + 8, 0))
    im.save(out)
elif mode == "crop":
    im = Image.open(sys.argv[3]).convert("RGB")
    w, h, s = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
    cx, cy = (int(sys.argv[7]), int(sys.argv[8])) if len(sys.argv) > 8 else (im.width // 2, im.height // 2)
    c = im.crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)).resize((w * s, h * s), Image.NEAREST)
    c.save(out)
print("wrote", out)
