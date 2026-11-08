"""Approved cockpit concept | eye-point render(s), with angle guides (90 deg HFOV).
usage: python -I compose_eye.py concept.png out.png label1=render1.png [label2=render2.png]"""
import sys, math
from PIL import Image, ImageDraw, ImageFont
concept, out = sys.argv[1], sys.argv[2]
items = [("APPROVED cockpit concept", concept)] + [tuple(a.split("=", 1)) for a in sys.argv[3:]]
ims = [Image.open(p).convert("RGB") for _, p in items]
W, H = ims[0].size
ims = [im.resize((W, H)) for im in ims]
sheet = Image.new("RGB", (W * len(ims) + 8 * (len(ims) - 1), H), (255, 255, 255))
try:
    f = ImageFont.truetype("arial.ttf", 22)
except Exception:
    f = ImageFont.load_default()
d = ImageDraw.Draw(sheet)
foc = W / 2 / math.tan(math.radians(45))
for i, ((label, _), im) in enumerate(zip(items, ims)):
    x0 = i * (W + 8)
    sheet.paste(im, (x0, 0))
    for el, col in ((25, (0, 200, 255)), (-20, (255, 180, 0)), (-7, (255, 80, 80))):
        y = H / 2 - foc * math.tan(math.radians(el))
        d.line([(x0, y), (x0 + W, y)], fill=col, width=1)
    for az in (-40, 40):
        x = W / 2 + foc * math.tan(math.radians(az))
        d.line([(x0 + x, 0), (x0 + x, H)], fill=(0, 255, 120), width=1)
    d.rectangle([x0 + 6, 6, x0 + 14 + d.textlength(label, font=f), 36], fill=(0, 0, 0))
    d.text((x0 + 10, 8), label, fill=(255, 255, 255), font=f)
d.text((10, H - 28), "guides: cyan +25 deg, red -7 deg, orange -20 deg, green +-40 deg", fill=(255, 255, 255), font=f)
sheet.save(out)
print("wrote", out)
