# Practice target drone

The training target from the Argo's kit, for milestone 3 ("Fighting", docs/unreal/FIRST_FIGHT.md): the player
practises gunnery on it 400 km above Earth before the Harrow arrive. It is human-made, cheap, built to be shot at
and to be seen, and it follows real hardware: aerial targets (BQM-167 Skeeter, Banshee, BQM-177, QF-16) wear
high-vis orange-red and white; small spacecraft (Clementine's octagonal bus, Proba-1's honeycomb panels, Astrobee,
cubesats, the gold MLI on STP-H3) show what it is made of.

What it has, all built as geometry (no painted-on detail):

- An octagonal body 1.40 m across flats and 1.80 m long, of 25 mm honeycomb panels: 14 painted panels and 2 gold
  blankets on the sides, 4 quadrant panels on each end cap, 8 edge rails and 3 ring frames standing 10 mm proud,
  8 mm gaps, 12 mm fastener heads every 110 mm.
- Paint in big blocks measured off the BQM-167 photograph (lit sRGB about 198, 55, 51): orange-red and white
  quadrants on both caps, a checker round the body, white-framed wings with orange tips, orange RCS pods.
- Two trapezoid wings (1.0 m long, root chord 0.90 m, tip 0.50 m, 45 mm thick) on built root fittings (bracket,
  2 clevis pins, harness).
- Four RCS thruster pods on struts at the 45 deg diagonals, 5 hollow bell nozzles each, feed lines; one main nozzle
  (0.20 m exit) at the rear inside a ring of quilted gold MLI with fill-and-drain valves.
- Gold MLI blankets on the two upper rear diagonals: jittered 12 mm triangle facets, folds 10-15 cm apart, crinkles
  3-6 cm, tack dimples every 0.15 m, flat 25 mm taped edges.
- Front face (+X): the training-bolt emitter (0.30 m ball in a 0.38 m collar, finned barrel reaching 0.45 m from the
  ball centre, dark muzzle), a 90 mm sensor window in a bezel with a hood, a laser retro-reflector of 7 corner cubes.
- Top: tracking beacon (64 mm dome in a wire guard), grapple fixture, two 0.45 m whip antennas. Belly: battery
  module with cooling ribs, radar corner reflector (0.22 m edges), patch antenna, umbilical connector.
- Inside (seen only in the debris): bulkhead ring, hollow propellant tank on struts, avionics boxes, reaction
  wheel, turret drive, feed line.

The method was docs/claude/ASSET_JOB.md: references first, a numbered checklist with numbers, and 3 rounds of stills
graded against the references and measured (material shares and pixel spans counted from flat-colour renders).

## Files

| Path | What |
|---|---|
| `make_drone.py` | Builds everything (drone, debris, UVs, bakes, export) in one script. |
| `export/drone.fbx` | The whole drone: `Drone_Body` and its 3 sockets. |
| `export/drone_debris.fbx` | 12 fragments, `Debris_01` to `Debris_12`. |
| `export/drone_debris.json` | Per fragment: triangles, volume, centre of volume, bounding box, slots. |
| `export/textures/T_Drone_AO.png` | Ambient occlusion (0.35 m), 2048 px, UV0. |
| `export/textures/T_Drone_Cavity.png` | Cavity mask, 2048 px, UV0: flat 0.5, gaps and recesses dark, convex edges bright. |
| `tools/render_stills.py` | Still-loop views (Cycles, GPU), optionally with the AO and cavity applied as in Unreal. |
| `tools/measure.py` | Material shares and pixel extent from the flat-colour `id_*` renders. |
| `tools/compose.py` | Contact sheets, reference pairs, nearest-neighbour crops of the far views. |
| `tools/verify_fbx.py` | Re-imports both FBX files and prints objects, slots, sockets, size. |

## Rebuild and export

From the repo root (about 80 s with the bakes, on the RTX 3070):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P art/drone/make_drone.py -- ^
    --blend <scratch>\drone.blend --export art/drone/export --bake
```

`--blend` saves the scene (drone plus a `Debris` collection; keep it out of git), `--export DIR` writes the FBX files
and the JSON, `--bake` bakes the two maps into `DIR/textures`, `--tex 4096` changes the map size, `--check-uv` counts
overlapping UV cells without exporting. The log prints every boolean's face counts (a non-manifold operand makes the
Manifold boolean silently do nothing), non-manifold edges and volume per part, triangles, and the volume check.

Stills: `blender -b --factory-startup -P art/drone/tools/render_stills.py -- --blend <scratch>\drone.blend
--out <dir>\drone --tex art/drone/export/textures --views ref_a,chase100,close8,belly34,exploded,id_chase100`, then
`python -I art/drone/tools/measure.py <dir>\drone_id_chase100.png`. Check: `blender -b --factory-startup -P
art/drone/tools/verify_fbx.py -- art/drone/export`.

How it is built (to tweak it): the measured values are constants near each builder (`A`, `X0`/`X1`, `RAIL_*`,
`GAP`, `W_*` for the wings, `POD_*`, `TUR_*`, `MLI_*`); `panel_mat()` is the paint map. Every part is a closed solid;
the body's ~190 parts are joined by one Manifold boolean union. UVs are unwrapped on the parts before the debris
cuts, so the fragments inherit the drone's UVs and can use the same two maps. The debris are three jagged cuts
(`CUTS`, relief from `tear_disp`: 4 cm warps plus 1.8 cm teeth) applied recursively to the body.

## Size, axes and origin

- Metres. 3.50 m wingtip to wingtip, 2.575 m long (main nozzle exit to emitter muzzle), 2.10 m tall (pods to
  antenna tips).
- In Blender: front (the emitter face) +X, up +Z, left wing +Y. Exported exactly like the fighter (FBX forward -Z,
  up Y, "FBX units scale"), so in Unreal the front points **+X** and up is **+Z** (1 m = 100 uu). Re-importing the FBX
  into an empty Blender scene gives front +X, up +Z, size unchanged (checked with `tools/verify_fbx.py`).
- Origin: the centre of the body (the middle of the octagon, halfway along it).

## Material slots

`M_Paint_Orange`, `M_Paint_White`, `M_Paint_Grey` (frames, rails, struts, grapple, battery, turret ball and collar,
interior structure), `M_Metal_Dark` (nozzles, valves, barrel and fins, connectors, antenna bases, avionics boxes),
`M_Glass_Sensor` (sensor window and the 7 corner cubes), `M_Beacon` (only the beacon dome, about 0.006 m2: make it
emissive and pulse it), `M_Metal_Torn` (torn faces of the debris only, never on the whole drone).

**Extra slot, not in the original list: `M_Foil_MLI`** for the gold insulation blankets (gold metallic, roughness
about 0.3; the facets are geometry). The list had no slot for the blanket the drone was asked to show.

The colours in the FBX are previews only. Suggested Unreal import: Combine Meshes off, Import Normals, Nanite on;
apply `T_Drone_Cavity` to darken gaps (for example remap 0.10-0.48 to 0.35-1.0 and multiply the base colour) and
`T_Drone_AO` for contact shadows. Texel density on UV0: painted panels 2.7-2.8 mm, MLI 3.1 mm; frames, gap floors and
dark parts about a third of that; hidden interior faces a tenth. UV0 has 0 overlapping islands and uses 54.5% of the
map.

## Sockets (empties parented to `Drone_Body`, X axis = the direction)

| Socket | Where (m) | Points |
|---|---|---|
| `SOCKET_Gun` | emitter muzzle (1.37, 0, -0.16) | forward (+X) |
| `SOCKET_Core` | body centre (0, 0, 0), for the explosion | +X |
| `SOCKET_Beacon` | inside the beacon dome (-0.45, 0, 0.738) | up (+Z) |

## Fragments (drone_debris.fbx)

Every fragment's pivot is the drone origin and its vertices stay where they are in the drone, so the game can swap
`Drone_Body` for the 12 fragments at the same transform and push them apart (for example along each centroid from
the JSON). Each is closed (0 non-manifold edges); their volumes add up to the whole drone's 631.4 L (100.0%). The
torn faces are `M_Metal_Torn`; through the tears show the 25 mm walls, the bulkhead, the hollow tank and the boxes.

| Fragment | What (centre of volume, m) | Triangles |
|---|---|---|
| Debris_01 | body chunk, front upper left, with the sensor window (0.56, 0.32, 0.25) | 6,804 |
| Debris_02 | body chunk, middle upper right, with the beacon (0.10, -0.52, 0.45) | 10,880 |
| Debris_03 | body chunk, front lower left (0.54, 0.29, -0.51) | 2,810 |
| Debris_04 | body chunk, front lower right (0.19, -0.60, -0.31) | 6,172 |
| Debris_05 | body chunk, rear upper left (-0.60, 0.53, 0.36) | 1,620 |
| Debris_06 | body chunk, rear upper right, with the right blanket and antenna (-0.73, -0.25, 0.52) | 6,074 |
| Debris_07 | body chunk, rear lower left (-0.51, 0.60, -0.46) | 4,968 |
| Debris_08 | body chunk, rear lower right, with most of the tank and the main nozzle (-0.62, -0.28, -0.38) | 14,300 |
| Debris_09 | the left wing with its root fitting (-0.25, 1.17, 0.00) | 2,246 |
| Debris_10 | the upper left thruster pod with its struts (-0.55, 0.69, 0.69) | 2,048 |
| Debris_11 | the left whip antenna (-0.74, 0.21, 0.78) | 254 |
| Debris_12 | the upper left MLI blanket, with the strut holes (-0.43, 0.50, 0.50) | 6,714 |

The right wing and the other three pods stay on their body chunks (the right wing is torn across by a cut).

## Numbers

- Triangles: whole drone 49,552; fragments together 64,890 (+31%, the torn faces).
- Files: drone.fbx 4.0 MB, drone_debris.fbx 5.5 MB, AO 2.5 MB, cavity 1.4 MB; art/drone about 13 MB.
- At the chase camera (70 deg, 1920x1080): 14 px across at 300 m, 46 px at 100 m. Material shares in the side, top,
  back and 100 m chase views: orange 36-43%, white 27-30%, grey, dark metal and gold together 30-34%.

## Known limits

- No markings yet (numbers, stencils): decals in Unreal, as for the fighter.
- UV0 uses 54.5% of the map (thousands of small fastener and frame islands); the paint still gets 2.7 mm per texel.
- The turret is part of the static mesh; to aim it, split the ball and barrel off as their own mesh at
  (0.92, 0, -0.16).
- MLI folds are gentler than the most crumpled real blankets (STP-H3's); the facets carry the look.
