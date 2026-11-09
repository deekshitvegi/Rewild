"""Prepare Haven's scanned ground for import (docs/unreal/HAVEN.md). Run fetch_scans.py first, then this with the
system Python:

    python -I Unreal/Rewild/Scripts/haven/prepare_haven.py

For each Poly Haven set in RawSources/haven/scans/<set> (CC0, not in git) it packs the four 4K maps into two
pictures, so the ground material reads two textures per layer instead of four:

    <set>_A.png  red, green, blue: colour (diff); alpha: height (disp), for blending one layer into the next
    <set>_B.png  red, green: the normal (nor_dx, Unreal's form); blue: roughness (arm.g); alpha: occlusion (arm.r)

and measures each colour map's mean in linear light (the material divides by it, so a scan adds its own light and
dark and part of its hue, while the world's colour comes from the ground's cover) and its mean height. Results in
RawSources/haven/scans/scans.json, which build_haven.py reads.
"""

import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SCANS = os.path.abspath(os.path.join(HERE, "..", "..", "RawSources", "haven", "scans"))
SETS = ["grass_ground", "aerial_grass_rock", "rock_face_03", "aerial_rocks_02", "coast_sand_04", "mud_forest", "dirt_floor"]


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    catalogue = json.load(open(os.path.join(SCANS, "_catalogue", "polyhaven_textures.json"), encoding="utf-8"))
    out = {}
    for name in SETS:
        folder = os.path.join(SCANS, name)
        path = lambda m: os.path.join(folder, f"{name}_{m}_4k.jpg")  # noqa: E731
        diff = np.asarray(Image.open(path("diff")).convert("RGB"))
        disp = np.asarray(Image.open(path("disp")).convert("L"))
        nor = np.asarray(Image.open(path("nor_dx")).convert("RGB"))
        arm = np.asarray(Image.open(path("arm")).convert("RGB"))
        a = np.dstack([diff, disp])
        b = np.dstack([nor[..., 0], nor[..., 1], arm[..., 1], arm[..., 0]])
        Image.fromarray(a, "RGBA").save(os.path.join(folder, f"{name}_A.png"), compress_level=1)
        Image.fromarray(b, "RGBA").save(os.path.join(folder, f"{name}_B.png"), compress_level=1)
        small = to_linear(diff[::8, ::8].astype(np.float64)).reshape(-1, 3)
        out[name] = {
            "mean": [round(float(v), 5) for v in small.mean(0)],
            "height_mean": round(float(disp.mean()) / 255.0, 4),
            "roughness_mean": round(float(arm[..., 1].mean()) / 255.0, 4),
            "size_m": round(catalogue[name]["dimensions"][0] / 1000.0, 2),
        }
        print(name, out[name])
    with open(os.path.join(SCANS, "scans.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)


if __name__ == "__main__":
    main()
