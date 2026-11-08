# Usage: python3 sheet.py out.png cols label1=path1 label2=path2 ...
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols = sys.argv[1], int(sys.argv[2])
items = [a.split('=', 1) for a in sys.argv[3:]]
ims = [(l, Image.open(p).convert('RGB')) for l, p in items]
w, h = ims[0][1].size
scale = min(1.0, 1600 / (w * cols))
tw, th = int(w * scale), int(h * scale)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (tw * cols, (th + 26) * rows), (12, 12, 14))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
except Exception:
    font = None
for i, (l, im) in enumerate(ims):
    x, y = (i % cols) * tw, (i // cols) * (th + 26)
    sheet.paste(im.resize((tw, th)), (x, y + 26))
    d.text((x + 8, y + 4), l, fill=(230, 230, 230), font=font)
sheet.save(out)
