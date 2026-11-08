# Food plants

How `public/models/expedition/forage-*.glb` are made: the plants the explorer picks fruit from
(`components/expedition/Forage.tsx`), one for each kind of ground. Python 3 with Pillow and NumPy, Blender
(`bpy` 5.2 from PyPI works: `pip install bpy`, Python 3.13; or `blender -b --factory-startup -P`), and Node with
the same glTF Transform, meshoptimizer and sharp packages as `source_assets/trees`.

| Plant | Ground | What it is |
| --- | --- | --- |
| currant | verdant (Earth, Haven) | Redcurrant: canes from the crown, side shoots, lobed toothed leaves on stalks, strings of berries |
| melon | desert | Melon vine: runners along the ground, big lobed leaves on stalks, tendrils, flowers, golden netted melons |
| opuntia | canyon (Mars) | Prickly pear: pads set edge to edge, areoles, barrel-shaped red fruit on the outer pads' rims |
| rosette | cratered (Moon, Mercury) | A thick-leaved succulent rosette with offsets, seed pods on a stalk from its middle (invented) |
| frostberry | frozen | A low evergreen shrub, leathery leaves rimed at the edge, pale blue berries under a bloom (invented) |
| icekelp | glacier | Strap fronds arching from a cluster of pale translucent bulbs (invented) |

## 1. Pictures

```
python3 pictures.py <outdir> [plant ...]
```

Draws `<outdir>/<plant>-atlas.png`, 1024 x 1024 RGBA in 256 px tiles: leaf blades from their botany (lobes as
petals of a polar outline with a smooth middle, a heart-shaped base, teeth spaced along the margin; primary and
secondary veins; mottling, a darker margin, a frosted rim for the frost-berry), fruit skins (a melon's net, a
prickly pear's areoles, ribbed bulbs and pods), plain tiles that the vertex colours paint, and thin-stem bark.
No photographs.

## 2. Grow the plant

```
python makeplant.py -- <atlas dir> out.glb preview.png <plant> [seed]
```

Prints the triangles in each mesh and renders a Cycles preview (the near plant beside the light one). All
shipped plants use seed 7. Four meshes: `body` and `fruit` near the explorer, `bodyFar` and `fruitFar` beyond
(Forage.tsx dissolves one into the other): the far plant keeps a third of the leaves, larger, on plainer stems.
The fruit is a mesh of its own, so a picked plant is drawn without it. Per vertex: a colour (linear RGB: the
part's colour times its occlusion inside the plant) and a second UV map, `Kind`, whose u (times 4) says how the
game lights it: 0 stem or skin, 1 leaf (light through it, thinned when seen edge-on, paler underneath), 2 glossy
fruit, 3 glossy and translucent fruit, 4 fruit under a waxy bloom.

## 3. Pack it for the game

```
node plantpack.mjs out.glb ../../public/models/expedition/forage-<plant>.glb
```

One material, alpha-masked and two-sided; the atlas to WebP; meshes meshopt-compressed.
