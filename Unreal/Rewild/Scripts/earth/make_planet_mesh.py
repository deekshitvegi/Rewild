"""Blender script: a 1 m latitude/longitude sphere for planets, exported to RawSources/earth/SM_Planet.fbx.

  blender -b --factory-startup -P Unreal/Rewild/Scripts/earth/make_planet_mesh.py

512 x 256 segments: from 400 km up the outline of a 6,371 km sphere is out by at most about 120 m, far below
a pixel. UV0 is equirectangular: u runs west to east from 180 W, v from the south pole (0) to the north pole (1)
in Blender, which Unreal flips on import (v = 0 at the north pole there). Each column keeps its own pole and
seam vertices so the map never smears across them.

Axes: Blender +X is 0 deg longitude, +Y is 90 E, +Z north. Unreal's FBX import keeps the look, so in Unreal
0 deg longitude is +X, 90 E is -Y and north is +Z.

Eight material slots, one per Blue Marble tile (Tile_A1 .. Tile_D2: A-D west to east from 180 W, 1 north and
2 south of the equator). Every face lies inside one tile (128 x 128 faces each), so each draws one texture.
"""

import math
import pathlib

import bmesh
import bpy

SEG, RINGS = 512, 256
OUT = pathlib.Path(__file__).resolve().parents[2] / "RawSources" / "earth" / "SM_Planet.fbx"

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("SM_Planet")
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")

grid = {}  # (j, i) -> vert; j = 0 north pole .. RINGS south pole, i = 0 at 180 W .. SEG (seam copy)
for j in range(RINGS + 1):
    lat = math.pi / 2 - math.pi * j / RINGS
    for i in range(SEG + 1):
        lon = -math.pi + 2 * math.pi * i / SEG
        grid[j, i] = bm.verts.new((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)))

for j in range(RINGS):
    for i in range(SEG):
        # top-left, bottom-left, bottom-right, top-right seen from outside (north up, east right): outward
        corners = [(j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1)]
        if j == 0:
            corners.pop(3)  # north pole: one vertex at the top
        elif j == RINGS - 1:
            corners.pop(2)  # south pole: one vertex at the bottom
        face = bm.faces.new([grid[c] for c in corners])
        face.material_index = (j // (RINGS // 2)) * 4 + i // (SEG // 4)
        for loop, (cj, ci) in zip(face.loops, corners):
            loop[uv].uv = (ci / SEG, 1 - cj / RINGS)

bm.normal_update()
bm.to_mesh(mesh)
bm.free()
for p in mesh.polygons:
    p.use_smooth = True

for row in (1, 2):
    for col in "ABCD":
        mesh.materials.append(bpy.data.materials.new(f"Tile_{col}{row}"))

obj = bpy.data.objects.new("SM_Planet", mesh)
bpy.context.scene.collection.objects.link(obj)

inward = sum(1 for p in mesh.polygons if p.normal.dot(p.center) < 0)
print(f"faces {len(mesh.polygons)}, inward {inward}")
assert inward == 0, "faces wound inward: Unreal would cull the outside"

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.fbx(filepath=str(OUT), use_selection=False, mesh_smooth_type="FACE")
print("wrote", OUT)
