"""Stack reference | still side by side with labels. usage: python -I compose.py old_prefix new_prefix out_prefix view1,view2,..."""
import sys
from PIL import Image, ImageDraw, ImageFont
old, new, out, views = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(",")
try:
    font = ImageFont.truetype("arial.ttf", 30)
except Exception:
    font = ImageFont.load_default()
for v in views:
    a = Image.open(f"{old}_{v}.png").convert("RGB")
    b = Image.open(f"{new}_{v}.png").convert("RGB")
    if b.size != a.size:
        b = b.resize(a.size)
    W, H = a.size
    im = Image.new("RGB", (W * 2 + 8, H), (255, 255, 255))
    im.paste(a, (0, 0)); im.paste(b, (W + 8, 0))
    d = ImageDraw.Draw(im)
    for x, t in ((12, f"OLD (reference)  {v}"), (W + 20, f"NEW (rebuild)  {v}")):
        d.rectangle([x - 6, 8, x + 12 + d.textlength(t, font=font), 48], fill=(0, 0, 0))
        d.text((x, 12), t, fill=(255, 255, 255), font=font)
    im.save(f"{out}_{v}.png")
    print("wrote", f"{out}_{v}.png")
