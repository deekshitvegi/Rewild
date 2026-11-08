# python3 textures.py <outdir> <species> <bark.png> <leavesA.png> [leavesB.png|-] [key=magenta|green] [rotate=deg] [grade=r,g,b]
# The species' three pictures: bark (512, tiling), its normal map (from the photo's shading), and the leaves
# (two cut-out sprays side by side, 1024x512; a single spray is used twice, the second mirrored).
import sys
from PIL import Image, ImageFilter, ImageOps
import numpy as np
out, sp, bark_p, la_p = sys.argv[1:5]
lb_p = sys.argv[5] if len(sys.argv) > 5 else '-'
key = sys.argv[6] if len(sys.argv) > 6 else 'magenta'
rot = float(sys.argv[7]) if len(sys.argv) > 7 else 0.0
grade = np.array([float(v) for v in sys.argv[8].split(',')]) if len(sys.argv) > 8 else np.ones(3)
bark = Image.open(bark_p).convert('RGB').resize((512, 512), Image.LANCZOS)
bark.save(f'{out}/{sp}-bark.png')
h = np.asarray(bark.convert('L').filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255.0
dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 2.5
dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 2.5
n = np.stack([-dx, dy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(f'{out}/{sp}-bark-normal.png')
def cutout(path, mirror=False):
    img = Image.open(path).convert('RGB')
    if rot: img = img.rotate(rot, expand=False, fillcolor=(255, 0, 255) if key == 'magenta' else (0, 255, 0))
    if mirror: img = ImageOps.mirror(img)
    im = np.asarray(img).astype(np.float32) / 255.0
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    if key == 'green':
        screen = g - np.maximum(r, b)
        alpha = 1.0 - np.clip((screen - 0.10) / 0.25, 0.0, 1.0)
        spill = np.clip(g - np.maximum(r, b) * 1.0, 0.0, None) * (alpha < 0.999)
        rgb = np.stack([r, np.clip(g - spill, 0, 1), b], -1)
    else:
        screen = np.minimum(r, b) - g
        alpha = 1.0 - np.clip((screen - 0.08) / 0.24, 0.0, 1.0)
        spill = np.clip(screen, 0.0, None)
        rgb = np.stack([np.clip(r - spill * 0.9, 0, 1), g, np.clip(b - spill * 0.9, 0, 1)], -1)
    rgb = np.clip(rgb * grade, 0, 1)
    # Broad leaves lose a pixel of their edge (no fringe); needles gain one, or far off they thin to nothing.
    import os
    edge = ImageFilter.MaxFilter(3) if os.environ.get('NEEDLES') else ImageFilter.MinFilter(3)
    a = Image.fromarray((alpha * 255).astype(np.uint8)).filter(edge).filter(ImageFilter.GaussianBlur(0.6))
    arr = np.concatenate([(rgb * 255).astype(np.uint8), np.asarray(a)[..., None]], -1)
    m = arr[..., 3] > 8
    arr[~m, :3] = arr[m][:, :3].mean(0).astype(np.uint8)
    return Image.fromarray(arr, 'RGBA').resize((512, 512), Image.LANCZOS)
leaves = Image.new('RGBA', (1024, 512))
leaves.paste(cutout(la_p), (0, 0))
leaves.paste(cutout(lb_p) if lb_p != '-' else cutout(la_p, mirror=True), (512, 0))
leaves.save(f'{out}/{sp}-leaves.png')
print('textures', sp)
