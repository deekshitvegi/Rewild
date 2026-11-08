"""Re-import the exported FBX files into an empty scene and print what Unreal will get: objects, bounding box,
material slots, sockets (position and the direction of their X axis), triangle counts.

  blender -b --factory-startup -P art/drone/tools/verify_fbx.py -- art/drone/export
"""
import bpy, sys, os
from mathutils import Vector

d = sys.argv[sys.argv.index("--") + 1]
for fn in ("drone.fbx", "drone_debris.fbx"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(d, fn))
    bpy.context.view_layer.update()
    print(f"=== {fn}")
    mn, mx = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    tot = 0
    for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
        if o.type == 'MESH':
            tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
            tot += tris
            for v in o.data.vertices:
                w = o.matrix_world @ v.co
                mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
            print(f"MESH {o.name:14s} tris {tris:6d} uv {[l.name for l in o.data.uv_layers]} "
                  f"slots {[m.name for m in o.data.materials]} origin {tuple(round(a, 3) for a in o.matrix_world.translation)}")
        elif o.type == 'EMPTY':
            p = o.matrix_world.translation
            xax = (o.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()
            print(f"EMPTY {o.name:14s} parent {o.parent.name if o.parent else None} at {tuple(round(a, 3) for a in p)} "
                  f"X axis {tuple(round(a, 2) for a in xax)}")
    print(f"BBOX min {tuple(round(a, 3) for a in mn)} max {tuple(round(a, 3) for a in mx)} "
          f"size {tuple(round(a, 3) for a in (mx - mn))}  triangles {tot}")
