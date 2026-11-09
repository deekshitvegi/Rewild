"""Download Haven's scanned ground sets from Poly Haven (CC0) into Unreal/Rewild/RawSources/haven/scans (not in git:
about 330 MB). Run with the system Python (the owner allowed this download on 9 Nov 2026):

    python -I Unreal/Rewild/Scripts/haven/fetch_scans.py

Each set gets its own folder; four maps at 4K: colour (diff), normal in DirectX form (nor_dx, Unreal's), ambient
occlusion / roughness / metal packed (arm), and height (disp, for blending between layers). Files already there are
kept. prepare_haven.py then measures them and build_haven.py imports them into /Game/Generated/Haven/Scans.
"""

import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "RawSources", "haven", "scans"))
AGENT = {"User-Agent": "Rewild-asset-fetch/1.0"}

# What each set is for (docs/unreal/HAVEN.md): the size Poly Haven gives for each scan is in its catalogue.
SETS = [
    "grass_ground",       # the grassland at your feet (2.5 m scan)
    "aerial_grass_rock",  # the same grassland seen from the ship and the air (15 m)
    "rock_face_03",       # bare rock on steep ground (2.7 m)
    "aerial_rocks_02",    # mountains and cliffs from the air (50 m)
    "coast_sand_04",      # sand in the coves (3.9 m)
    "mud_forest",         # the silt of the seabed and the shallows (2.35 m)
    "dirt_floor",         # bare soil: paths and the colony's ground, later (2.1 m)
]
MAPS = {"Diffuse": "diff", "nor_dx": "nor_dx", "arm": "arm", "Displacement": "disp"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=AGENT), timeout=120) as r:
        return r.read()


def main():
    total = 0
    for name in SETS:
        folder = os.path.join(OUT, name)
        os.makedirs(folder, exist_ok=True)
        files = json.loads(get(f"https://api.polyhaven.com/files/{name}"))
        with open(os.path.join(folder, "files.json"), "w", encoding="utf-8") as f:
            json.dump(files, f)
        for key, short in MAPS.items():
            entry = files[key]["4k"]["jpg"]
            path = os.path.join(folder, f"{name}_{short}_4k.jpg")
            if os.path.exists(path) and os.path.getsize(path) == entry["size"]:
                print("have", os.path.basename(path))
                continue
            data = get(entry["url"])
            with open(path, "wb") as f:
                f.write(data)
            total += len(data)
            print("got ", os.path.basename(path), round(len(data) / 1e6, 1), "MB")
    print("downloaded", round(total / 1e6), "MB into", OUT)


if __name__ == "__main__":
    main()
