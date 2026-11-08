"""Download the NASA maps Earth is made from into Unreal/Rewild/RawSources/nasa (not in git; about 400 MB).

  python Unreal/Rewild/Scripts/earth/fetch_earth.py

- Blue Marble Next Generation, July 2004, 8 tiles of 21,600 x 21,600 px (500 m per pixel), NASA Earth
  Observatory, public domain: https://visibleearth.nasa.gov/images/74092
- GEBCO 2008 ocean depth (bathymetry), 21,600 x 10,800 px, via NASA Visible Earth:
  https://visibleearth.nasa.gov/images/73963 (used only as a land/water mask)

Files already present at the right size are skipped, so it is safe to run again.
"""

import pathlib
import sys
import urllib.request

BASE = "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng"
TILES = [f"{col}{row}" for row in (1, 2) for col in "ABCD"]  # A1..D1 north, A2..D2 south; A is 180W-90W
FILES = [f"{BASE}/bmng-base/july/world.200407.3x21600x21600.{t}.jpg" for t in TILES] + [
    f"{BASE}/bathymetry/gebco_08_rev_bath_21600x10800.jpg"
]

OUT = pathlib.Path(__file__).resolve().parents[2] / "RawSources" / "nasa"


def remote_size(url):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers.get("Content-Length", 0))


def fetch(url):
    dest = OUT / url.rsplit("/", 1)[1]
    size = remote_size(url)
    if dest.exists() and dest.stat().st_size == size:
        print(f"have {dest.name}")
        return
    part = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=120) as r, open(part, "wb") as f:
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
    if size and done != size:
        sys.exit(f"short download: {dest.name} {done} of {size} bytes")
    part.replace(dest)
    print(f"got {dest.name} ({done / 1048576:.0f} MB)")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for url in FILES:
        fetch(url)
    print("done")
