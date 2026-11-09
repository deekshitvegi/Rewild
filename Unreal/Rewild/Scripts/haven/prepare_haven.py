"""Prepare Haven's surface pictures for import (planet system, docs/unreal/HAVEN.md). Run with the system Python:

    python Unreal/Rewild/Scripts/haven/prepare_haven.py

Takes the scanned ground photographs already in the repo (ambientCG, CC0: web/public/textures/expedition/terrain,
see ATTRIBUTION.md there), writes them as PNG into Unreal/Rewild/RawSources/haven (not in git), and measures each
one's mean colour in linear light, which the ground material divides by so the picture adds only its detail and the
world's own colour comes from the ground's cover (build_haven.py reads textures.json).
"""

import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SRC = os.path.join(REPO, "web", "public", "textures", "expedition", "terrain")
OUT = os.path.join(REPO, "Unreal", "Rewild", "RawSources", "haven")

# name in Unreal: (file, is a normal map). ambientCG sets only (scanned): Rock050, Ground022, Ground097.
PICTURES = {
    "T_Rock": ("rock-grey.webp", False),
    "T_Rock_N": ("rock-grey-n.webp", True),
    "T_Soil": ("gravel.webp", False),
    "T_Soil_N": ("gravel-n.webp", True),
    "T_Sand": ("dunes.webp", False),
    "T_Sand_N": ("dunes-n.webp", True),
}


def to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    os.makedirs(OUT, exist_ok=True)
    means = {}
    for name, (file, normal) in PICTURES.items():
        im = Image.open(os.path.join(SRC, file)).convert("RGB")
        im.save(os.path.join(OUT, name + ".png"))
        if not normal:
            means[name] = [round(float(v), 5) for v in to_linear(np.asarray(im, dtype=np.float64)).reshape(-1, 3).mean(0)]
        print(name, im.size, means.get(name, "normal"))
    with open(os.path.join(OUT, "textures.json"), "w") as f:
        json.dump({"means": means}, f, indent=2)


if __name__ == "__main__":
    main()
