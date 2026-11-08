"""
Stick-figure contact sheets of a motion, to choose frame ranges and to check a retarget
without a renderer: a side view (forward to the right) and a front view, one figure per
sampled frame, the ground line, and the feet's contact marks.

    <python> preview.py out.png bvh <file.bvh> [first last step]      a CMU capture as it is
    <python> preview.py out.png clip <motions.json> <clip name>       a retargeted clip on the explorer
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

import motionlib as ml

COLOURS = {'Left': (60, 120, 220), 'Right': (220, 80, 60)}


def segments(skel):
    out = []
    for j, p in enumerate(skel.parents):
        if p < 0:
            continue
        name = skel.names[j]
        side = 'Left' if 'Left' in name or name.endswith('.L') or name.startswith('L') and name[1:2].isupper() else 'Right' if 'Right' in name or name.endswith('.R') or name.startswith('R') and name[1:2].isupper() else ''
        out.append((p, j, COLOURS.get(side, (30, 30, 30))))
    return out


def sheet(path, skel, gp, frames, labels, unit, contact=None, title=''):
    """gp: (F, J, 3) positions. One column per frame: side view above, front view below."""
    cell = 150
    W = cell * len(frames)
    H = cell * 2 + 24
    im = Image.new('RGB', (W, H), (245, 245, 240))
    d = ImageDraw.Draw(im)
    segs = segments(skel)
    floor = np.percentile(gp[:, :, 1], 1)
    top = np.percentile(gp[:, :, 1], 99.5)
    span = max(top - floor, 1e-6) * 1.15
    s = (cell - 16) / span
    for k, f in enumerate(frames):
        ox = k * cell
        centre = gp[f, 0]
        for row, (ax, sign) in enumerate(((2, 1), (0, -1))):
            oy = 24 + row * cell
            gy = oy + cell - 8
            d.line([(ox + 4, gy), (ox + cell - 4, gy)], fill=(160, 160, 150))

            def P(p):
                return (ox + cell / 2 + sign * (p[ax] - centre[ax]) * s, gy - (p[1] - floor) * s)

            for a, b, col in segs:
                d.line([P(gp[f, a]), P(gp[f, b])], fill=col, width=2)
            if contact is not None:
                for side in range(contact.shape[1]):
                    if contact[f, side]:
                        x = ox + 10 + side * 12
                        d.ellipse([x, oy + 4, x + 8, oy + 12], fill=list(COLOURS.values())[side])
        d.text((ox + 4, 4), labels[k], fill=(0, 0, 0))
    d.text((W - 200, 4), title[:40], fill=(90, 90, 90))
    im.save(path)


def main():
    out, kind = sys.argv[1], sys.argv[2]
    if kind == 'bvh':
        skel, m = ml.load_bvh(sys.argv[3])
        a = int(sys.argv[4]) if len(sys.argv) > 4 else 1
        b = int(sys.argv[5]) if len(sys.argv) > 5 else m.frames - 1
        step = int(sys.argv[6]) if len(sys.argv) > 6 else max(1, (b - a) // 12)
        gq, gp = ml.fk(skel, m.lq, m.lt)
        frames = list(range(a, b, step))
        sheet(out, skel, gp, frames, ['%d (%.2fs)' % (f, f / m.fps) for f in frames], 1, title=sys.argv[3].split('/')[-1])
    else:
        data = json.load(open(sys.argv[3]))
        clip = next(c for c in data['clips'] if c['name'] == sys.argv[4])
        explorer = ml.Explorer(data['target'])
        lq = np.array(clip['rotations'])
        lt = np.tile(explorer.skel.offsets, (lq.shape[0], 1, 1))
        lt[:, explorer.hips] = np.array(clip['hips'])
        gq, gp = ml.fk(explorer.skel, lq, lt)
        n = lq.shape[0]
        frames = list(range(0, n, max(1, n // 12)))
        contact = np.array(clip['contact']) if clip.get('contact') else None
        sheet(out, explorer.skel, gp, frames, ['%d' % f for f in frames], 1, contact, title=clip['name'])


if __name__ == '__main__':
    main()
