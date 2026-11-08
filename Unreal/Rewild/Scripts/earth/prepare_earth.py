"""Turn the NASA downloads into the textures Unreal imports (RawSources/earth, not in git).

  python -I Unreal/Rewild/Scripts/earth/prepare_earth.py [tile ...]   (tiles A1..D2, or none for all)

- T_Earth_<tile>.jpg: each 21,600 px Blue Marble tile resampled to 16,384 px (Unreal's largest tile; about
  610 m per pixel). Tiles A-D run west to east from 180 W, 1 is north and 2 south of the equator. They are
  imported as 8 separate textures, not one UDIM texture: building all 8 at once needs about 19 GB of memory
  and ran the editor out of memory on 8 Nov 2026; one at a time needs about 2.4 GB.
- Earth_Water.png: 8,192 x 4,096 land/water mask (white = water), for gloss and sun glint. GEBCO ocean depth
  alone cannot do it (it is white on land and on shallow seas alike: the North Sea and the Bahamas banks read
  255), so water is GEBCO's deep sea plus every Blue Marble pixel that is blue rather than green, brown or white.

- Earth_Depth.png: 8,192 x 4,096 ocean depth from GEBCO (0 = land or shore, brighter = deeper). Blue Marble's
  open sea is near black (about RGB 2, 5, 20) with faint steps that texture compression turns into blocks once the
  atmosphere lifts them, so the material paints deep water itself and keeps Blue Marble only over shelves and reefs.

- T_Earth_Normal.png: 16,384 x 8,192 tangent-space normal map from GEBCO land elevation (2.4 km per pixel), so
  mountains catch the sun. x points east, y south (Unreal's v runs north to south), relief exaggerated 3 times:
  from orbit real relief reads through shadows far smaller than a 2.4 km pixel.
- Earth_Clouds.png: the Solar System Scope cloud map (8,192 x 4,096) as one grey channel: where clouds form.

Each output already present is skipped. A tile takes about a minute.
"""

import pathlib
import sys

from PIL import Image, ImageChops

Image.MAX_IMAGE_PIXELS = None

ROOT = pathlib.Path(__file__).resolve().parents[2] / "RawSources"
SRC = ROOT / "nasa"
OUT = ROOT / "earth"
SMALL = OUT / "small"
TILE = 16384
MASK_TILE = 2048
TILES = [f"{c}{r}" for r in (1, 2) for c in "ABCD"]


def albedo(tile):
    dest = OUT / f"T_Earth_{tile}.jpg"
    small = SMALL / f"{tile}.png"
    if dest.exists() and small.exists():
        print(f"have {dest.name}")
        return
    im = Image.open(SRC / f"world.200407.3x21600x21600.{tile}.jpg").convert("RGB")
    im.resize((MASK_TILE, MASK_TILE), Image.LANCZOS, reducing_gap=3.0).save(small)
    im.resize((TILE, TILE), Image.LANCZOS, reducing_gap=2.0).save(dest, quality=95, subsampling=0)
    print(f"made {dest.name}")


def blue_water(rgb):
    """White where a Blue Marble pixel is sea or lake: blue beats red by 15+, is not far below green
    (turquoise shallows count) and is not bright (ice and snow do not)."""
    r, g, b = rgb.split()
    px = zip(r.getdata(), g.getdata(), b.getdata())
    data = [255 if (bb > rr + 15 and bb >= gg - 10 and rr + gg + bb < 540) else 0 for rr, gg, bb in px]
    m = Image.new("L", rgb.size)
    m.putdata(data)
    return m


def water():
    dest = OUT / "Earth_Water.png"
    if dest.exists():
        print(f"have {dest.name}")
        return
    w, h = 4 * MASK_TILE, 2 * MASK_TILE
    colour = Image.new("RGB", (w, h))
    for tile in TILES:
        col, row = "ABCD".index(tile[0]), int(tile[1]) - 1
        colour.paste(Image.open(SMALL / f"{tile}.png"), (col * MASK_TILE, row * MASK_TILE))
    deep = Image.open(SRC / "gebco_08_rev_bath_21600x10800.jpg").convert("L").resize((w, h), Image.LANCZOS)
    deep = deep.point(lambda v: 255 if v < 250 else 0)
    mask = ImageChops.lighter(deep, blue_water(colour))
    mask.save(dest, optimize=True)
    print(f"made {dest.name}")


def depth():
    dest = OUT / "Earth_Depth.png"
    if dest.exists():
        print(f"have {dest.name}")
        return
    im = Image.open(SRC / "gebco_08_rev_bath_21600x10800.jpg").convert("L")
    im = im.point(lambda v: 255 - v)  # GEBCO's picture is white at the shore and darker with depth
    im.resize((8192, 4096), Image.LANCZOS).save(dest, optimize=True)
    print(f"made {dest.name}")


METRES_PER_LEVEL = 35.0  # GEBCO's elevation picture: Everest reads 226, Tibet 188, the Sahara 29
RELIEF = 3.0
R_EARTH_M = 6_371_000.0


def relief():
    import numpy as np

    dest = OUT / "T_Earth_Normal.png"
    if dest.exists():
        print(f"have {dest.name}")
        return
    w, h = 16384, 8192
    img = Image.open(SRC / "gebco_08_rev_elev_21600x10800.jpg").convert("L").resize((w, h), Image.LANCZOS)
    z = np.asarray(img, dtype=np.float32) * METRES_PER_LEVEL
    px = 2 * np.pi * R_EARTH_M / w  # metres per pixel along the equator, and north-south everywhere
    lat = (0.5 - (np.arange(h, dtype=np.float32) + 0.5) / h) * np.pi
    dx = np.maximum(px * np.cos(lat), px * 0.01)[:, None]  # east-west pixels shrink toward the poles
    east = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / (2 * dx)
    south = (np.vstack([z[1:], z[-1:]]) - np.vstack([z[:1], z[:-1]])) / (2 * px)
    del z
    nx, ny = -east * RELIEF, -south * RELIEF  # a slope rising to the east faces west
    del east, south
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + 1.0)
    rgb = np.stack([nx * inv, ny * inv, inv], axis=-1) * 127.5 + 127.5
    Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").save(dest)
    print(f"made {dest.name}")


def clouds():
    dest = OUT / "Earth_Clouds.png"
    if dest.exists():
        print(f"have {dest.name}")
        return
    Image.open(SRC / "8k_earth_clouds.jpg").convert("L").save(dest, optimize=True)
    print(f"made {dest.name}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    SMALL.mkdir(parents=True, exist_ok=True)
    tiles = sys.argv[1:] or TILES
    for t in tiles:
        albedo(t)
    if all((SMALL / f"{t}.png").exists() for t in TILES):
        water()
        depth()
        relief()
        clouds()
