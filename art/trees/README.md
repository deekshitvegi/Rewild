# Trees

How `public/models/expedition/tree-*.glb` are made. Blender 4.2 LTS (headless), Python 3 with Pillow and
NumPy, Node with `@gltf-transform/core`, `@gltf-transform/extensions`, `@gltf-transform/functions`,
`meshoptimizer` and `sharp`.

## 1. Pictures for each kind of tree

`pictures/` holds the bark photographs and the leaf sprays (cut-outs on flat magenta), generated with
Higgsfield GPT Image 2.6. `textures.py` turns them into the three pictures a tree uses, written next to
it as `<kind>-bark.png`, `<kind>-bark-normal.png` and `<kind>-leaves.png` (two sprays side by side):

```
python3 textures.py <outdir> <kind> <bark> <leavesA> [leavesB|-] [magenta|green] [rotate] [grade r,g,b]
```

Leaves are keyed off the magenta and lose a pixel of edge; for needles set `NEEDLES=1` so they gain one
instead (otherwise they thin to nothing in the distance). Converted from `pictures/*.webp` to PNG first:

| kind | bark | leaves | extra |
| --- | --- | --- | --- |
| oak | bark-oak | leaves-oak-a, leaves-oak-b | |
| ash | bark-ash | leaves-ash | |
| maple-red, maple-orange | bark-maple | leaves-maple-red / -orange | |
| aspen | bark-aspen | leaves-aspen | |
| birch | bark-birch | leaves-birch | |
| poplar | bark-ash | leaves-poplar | |
| willow | bark-oak | willow-strand-0, willow-strand-2 | `magenta 0 0.7,0.78,0.55` |
| spruce | bark-spruce | leaves-spruce, its mirror image | `NEEDLES=1`, `magenta 90 0.78,0.9,1.0` |
| pine | bark-pine | leaves-pine | `NEEDLES=1`, `magenta 0 0.62,0.74,0.66` |
| hazel | bark-hazel | leaves-hazel | `magenta 0 0.82,0.86,0.8` |
| dead | bark-dead | leaves-oak-a (unused) | |
| jmaple-red | bark-maple (*) | leaves-maple-red | `green 0` |
| jmaple-orange | bark-maple (*) | leaves-maple-orange | `magenta 0 1.0,0.82,0.78` |
| niwaki | bark-pine (*) | leaves-pine | `NEEDLES=1`, `magenta 0 0.46,0.64,0.44` |
| cypress | bark-spruce (*) | leaves-spruce | `NEEDLES=1`, `magenta 0 0.5,0.66,0.46` |

(*) Graded first with Pillow's ImageEnhance (colour, brightness, contrast): the maple's bark to a smooth grey
(0.6, 0.95, 1), the black pine's darker and greyer (0.35, 0.72, 1.25), the cypress's (0.55, 0.8, 1).

The willow strands are single strands cut 300 px wide out of `leaves-willow`.

## 2. Grow the tree

```
blender -b --factory-startup -P maketree2.py -- <dir with the pictures> out.glb preview.png <seed> <preset>
```

Presets: oakA oakB oakWide ashA ashTall mapleRed mapleOrange aspenGold birch poplar willow spruce cedar
pineA pineB bushA bushB bushC deadTree, and for Haven's garden and temples jmapleRed jmapleOrange pineNiwaki
cypress. All shipped trees use seed 7, except deadTree (11) and jmapleRed (21). The script prints the triangle count and renders a
Cycles preview.

Without a Blender install, `bpy` from PyPI runs it the same way: `python maketree2.py -- <args>` (Python 3.13,
`pip install bpy`; only Cycles renders headless). The garden trees were grown so on 8 Nov 2026:

- `tiered` (Japanese maple): a short trunk splitting low into leaders that lean out; along each, limbs held
  level in tiers that fan into twigs, the leaves lying on them in layers (`tier` cards facing the sky).
- `niwaki` (black pine): a leaning S-curved trunk, limbs held level up it, each ending in a flat cloud of
  needle tufts (a pad), smaller and nearer the trunk higher up, with a pad at the top. Each pad is lit as a
  mass of its own (its cards carry their own centre). The model leans 2.59 rad from its front toward its
  right; propPlacement.ts turns it by that to aim the lean.
- `cypress` (Italian cypress): one leader, short steep branches, and upright sprays (`shell` cards, stems
  down) packed into a narrow column widest a third of the way up.

Branches taper nearly to a point at their tips, bend at crooks (`kink`, the chance per step of a side shoot
taking over the lead), have uneven cross-sections (`gnarl`) and a buttressed foot (`flare`). The finest twigs
are built as wood too and marked in a second UV map, `Twig` (u = 1): the game hides them on a living tree,
whose leaf sprays already show its twigs, and shows them on a dead one (ruined Earth), which also gets its
own far-off photographs. A dead-tree preset adds a haze of still finer twiglets. Broad and excurrent trees
were regrown with these on 5 Nov 2026; conifers, the willow and the bushes keep their earlier models.

## 3. Pack it for the game

```
node treepack.mjs out.glb ../../public/models/expedition/tree-<name>.glb
```

Leaves alpha-masked and two-sided, pictures to WebP, meshes meshopt-compressed.
