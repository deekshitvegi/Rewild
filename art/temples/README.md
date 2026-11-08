# Temples and shrines

How the Haven temple models in `public/models/expedition/` are made: `temple-greek.glb`, `temple-nagara.glb`,
`temple-kund.glb`, `shrine-torii.glb`, `shrine-honden.glb`, `shrine-lantern.glb`, `shrine-lantern-hanging.glb`,
`shrine-pagoda.glb`, `shrine-bridge.glb` and `shrine-gate.glb`. Everything is modelled in code from real buildings,
in metres, and baked in Blender. No generated meshes.

## What each one is

| preset | file | after |
| --- | --- | --- |
| `greek` | temple-greek | A Doric peripteral temple, 6 x 13 columns, in the proportions of the Temple of Hephaestus in Athens: three steps, columns with entasis and 20 sharp flutes, echinus and abacus, triglyphs and metopes with regulae and guttae, cornice with mutules, pediments at 13 degrees, tiled roof with antefixes, akroteria, cella with pronaos and opisthodomos. Weathered marble. |
| `nagara` | temple-nagara | A Nagara temple in the Khajuraho manner: jagati terrace and two flights of steps, moulded plinth, pancharatha sanctum with niches in two registers, a curvilinear shikhara in stepped courses clustered with urushringas and shringas, amalaka and kalasha, a vestibule under the shukanasa, a pillared mandapa with balcony seats under a stepped pyramidal roof, and a porch. Buff sandstone. No figure sculpture. |
| `kund` | temple-kund | A stepped tank about 24 m square, its four sides stepping down in three flights to a floor 4.5 m down, small shrines on the first landing, kiosks on the corners. The game draws the water (its line is near -3.3 m). |
| `torii` | shrine-torii | A vermilion myojin torii in the four-legged ryobu form, after Itsukushima but smaller, made to stand in shallow water (algae and tide line up to about 1.15 m). |
| `honden` | shrine-honden | A three-bay nagare-zukuri shrine hall: raised floor, veranda and railing, stairs under the long front slope of a cypress-bark roof, katsuogi and okichigi on a copper ridge. |
| `lantern` | shrine-lantern | A Kasuga-style granite lantern (toro), 2.2 m. |
| `hanging` | shrine-lantern-hanging | A bronze hanging lantern (tsuri-doro) on the arm of a vermilion post. |
| `pagoda` | shrine-pagoda | A five-storey pagoda: diminishing storeys, three-stepped brackets, double rafters, tiled hipped roofs with lifted corners and wind bells, balconies, a bronze and gilt sorin. |
| `bridge` | shrine-bridge | An arched vermilion drum bridge (taiko-bashi), 14 m long and 3 m wide, over a pond. |
| `gate` | shrine-gate | A temple gate in the nio-mon manner: three bays, the centre an open passage, lattice-fronted side bays left empty, an irimoya (hip-and-gable) tiled roof. |

## The model contract (components/expedition/Props.tsx)

- Two meshes, named `lod0` (what is drawn near) and `lod1` (a decimated copy for far away, about a tenth of
  the triangles), sharing one material.
- One material with a base colour texture and a normal texture. Nothing else is read: no vertex colours (the game
  overwrites them), no metal, roughness, emissive or alpha. Ambient occlusion, grime, moss and lichen are baked
  into the colour; carving and joints are baked into the normal map.
- The normal map is tangent space, OpenGL convention (+Y), as Blender bakes it. Props.tsx flips the map's y
  because glTF's v runs down, which turns a Blender +Y map the right way: use it as it is.
- Y up, metres, the front facing +Z (Blender -Y), the origin at the centre of the base. Foundations go below
  y = 0 into the ground (the bounds printed by the script say how far).

## How a model is made

`maketemple.py` builds each preset twice from the same parts. **LO** is the mesh the game draws: crisp bevelled
geometry. **HI** is LO plus the small carving: column drum joints, guttae, ashlar and paving joints, tile rows and
laps, lattice studs, gavaksha arches on the shikhara, niche frames, door studs. HI is painted with node materials
made from scanned textures and weathered from its own shape:

- grime in crevices (ambient occlusion), and the occlusion itself multiplied into the colour;
- worn, lighter edges and chips (the bevel shader against the true normal);
- rain streaks running down vertical faces from the top of each part;
- moss where water sits (faces looking up, the foot), lichen rosettes, dark lichen;
- a small hue and value shift per part, so no two columns or blocks match;
- lacquer worn back to the wood at edges and in patches, faded on top; the torii's tide band; bronze patina.

The script then unwraps LO (smart UV project, packed), bakes HI's colour (an emission pass) and normals onto LO
through one atlas, decimates LO to LOD1, exports the GLB, and renders the baked LO in Cycles under Haven-like light:
a warm low sun (#ffd8b0, 30 degrees up), a teal sky (#4a726b at the horizon, #17292c overhead), grass underfoot
(water under the torii, a pond under the bridge, water in the kund).

## Commands

Blender as a Python module (5.2, no blender binary needed; Cycles on the CPU; EEVEE and Workbench crash headless):

```
python3 -m venv bpyenv && bpyenv/bin/pip install --upgrade pip && bpyenv/bin/pip install bpy pillow numpy
python3 -I fetch_textures.py <texture dir>          # Poly Haven, CC0; keep them out of the repository
bpyenv/bin/python maketemple.py -- <preset> <texture dir> <out dir> [options]
```

Options: `build` (only build and print triangle counts and size), `faces` (quick grey renders, faces the game
would cull in red), `quick` (small atlas, few samples, small renders), `nobake` (render HI with its node
materials), `hi` (also render HI), `views=hero,detail` (only these renders), `samples=N` (render samples).
A full run prints `BUILT` (triangles), `SIZE` (bounds in metres), `BAKE`, `LOD`, `EXPORT` and `RENDER` lines and
writes `<out>/<name>.glb`, `<name>_col.png`, `<name>_nrm.png` and `<preset>-<view>.jpg`.

Pack for the game (Node, from `tools/claude/hf/tools` after `npm install` there):

```
node proppack.mjs <out dir>/<name>.glb ../../../../public/models/expedition/<name>.glb 2048   # 1024 for torii, lanterns, bridge
```

It keeps `lod0` and `lod1`, makes the material opaque, single-sided and non-metallic, drops every attribute
but position, normal and UV, welds and prunes, turns the atlas into WebP, quantizes and meshopt-compresses.

## Renders

`renders/<preset>-<view>.jpg`: the baked LO as the game gets it (the `-lod1` ones are LOD1 from far away).
