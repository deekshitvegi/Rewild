# Fighter (the player's starfighter)

The player's fighter for the first fight (docs/unreal/FIRST_FIGHT.md), rebuilt from code in Blender. It keeps the
shape of the web version's `ship.glb` (Higgsfield/Tripo, which the owner chose to "keep shape, rebuild") and replaces
its smeared, painted-on detail with built hard-surface engineering: a chined octagonal fuselage, a thick faceted
wing, scarfed nacelle intakes, petal nozzles, caret-style cheek intakes, real panel-line grooves, hatches, louvres,
NACA inlets, RCS clusters, a docking clamp, sensor windows, two wing-root cannons and two missile pylons.

The method was docs/claude/ASSET_JOB.md (checklist with numbers, still loop graded side by side against the old model).

## Files

| Path | What |
|---|---|
| `make_fighter.py` | Builds the whole model (and optionally bakes and exports). Everything is in this one script. |
| `tools/render_stills.py` | Renders the still-loop views (Cycles, GPU) of the build, or of the old `ship.glb` in the same frame. |
| `tools/compose.py` | Stacks old and new stills side by side. |
| `tools/compare_silhouettes.py` | Top, side and front silhouette overlap (IoU) of old and new, with overlays. |
| `export/fighter.fbx` | The model for Unreal (body + canopy glass + sockets). |
| `export/textures/T_Fighter_AO.png` | Baked ambient occlusion (0.8 m), 4096 px, on UV0 of the body. |
| `export/textures/T_Fighter_Cavity.png` | Cavity / convexity mask, 4096 px, UV0: flat skin 0.5, grooves and recesses dark, convex edges bright. For darkening panel lines and wearing edges in the Unreal material. |
| `tools/compose_eye.py` | The approved cockpit concept next to eye-point renders, with angle guides. |

## Regenerate

From the repo root (Blender 5.2, about a minute without the bake, a few minutes with it):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P art/fighter/make_fighter.py -- ^
    --blend <scratch>\fighter.blend --export art/fighter/export --bake
```

Options: `--canopy A|B` picks the canopy variant (default B, the owner's choice; see below), `--blend PATH` saves the .blend (keep it out of git; it is regenerated), `--export DIR` writes
`DIR/fighter.fbx` (and unwraps UVs), `--bake` bakes the AO and cavity maps into `DIR/textures/`, `--no-grooves` skips the panel
lines (fast preview), `--dump-tris PATH` writes the triangles as JSON for `compare_silhouettes.py`.

Stills: `blender -b --factory-startup -P art/fighter/tools/render_stills.py -- --blend <file> --out <dir>/new
--views ref0,ref1,ref2,chase,side,top,close,space,eye [--cavity export/textures/T_Fighter_Cavity.png]`
(`--cavity` darkens the grooves in the paint the way the Unreal material is meant to).

## Canopy variants

- **B (default, exported; the owner chose it on 8 Nov 2026):** the deck ahead of and beside the windscreen is lowered
  (only between the windscreen and the nose midpoint, x 0.8 to 5.0 m ahead of the old origin, blended) so the glass
  edge lies on the 19 deg-down sight line, over a low dash, as in the approved cockpit concept. Side-view silhouette
  overlap with the old model drops from 0.956 to 0.933.
- **A:** the old nose line. The deck rises into the windscreen; from the eye point the glass ends about 7 deg below
  the horizon, over a glare shield at the same height. Build it with `--canopy A`.

In both, the windscreen bow is built from the eye point: the A-pillars lie on the vertical planes through the eye at
+-40 deg, the header sits above the view (its lower edge above +30 deg), so from the cockpit the forward view is one
wide panel between two slim pillars, then the side panels. The hoop is behind the pilot's head.

How it is built (so it can be tweaked): every shape comes from a table of measured values near the top of the script
(`F_HW`, `F_ZT`, `F_ZB` for the fuselage, `w_le`/`w_te`/`WING_UP`/`WING_LO` for the wing, `CAN_*` for the canopy,
`NAC_*` for the nacelles, `TR_*` for the intakes). Components are lofted as closed meshes, painted by cutting the mesh
along each colour edge (so colour boundaries are real edges), joined with Blender's Manifold boolean, then cavities
(cockpit, ducts, exhausts) and finally about 250 cutters (panel-line grooves 12 mm wide and 6 mm deep, hatches,
pockets, NACA inlets) are cast onto the outer surface from the orthographic views, like a real skin layout
(`make_cutters`). Groove walls inherit the paint they cut through.

## Size, axes and origin

- Metres. About 15.2 m from nose tip to nozzle exit (16.0 m bounding box of the old model, which included nozzle
  probes), 13.3 m span, 3.1 m tall with the blade antennas (2.65 m without).
- In Blender: nose +X, up +Z, left wing +Y. Exported with Blender's FBX defaults (forward -Z, up Y) and
  "FBX units scale", which Unreal's importer converts back so that in Unreal the nose points **+X** and up is **+Z**
  (1 m = 100 uu). Re-importing the FBX into an empty Blender scene gives nose +X, up +Z, size unchanged.
- Origin: the fuselage centre between the wing roots (middle of the wing root chord, on the fuselage centreline).

## Objects and material slots

- `Fighter_Body`: everything opaque. Slots, exactly: `M_Paint_White`, `M_Paint_Red`, `M_Paint_Grey`,
  `M_Metal_Dark` (intakes deep inside, fan, nozzle liner, gun barrels, RCS nozzles, louvres, sensor windows,
  exhaust vanes), `M_Canopy_Frame`, `M_Engine_Glow` (the hot core disk 0.62 m inside each nozzle exit). The colours in
  the FBX are previews only; final surfacing is scanned materials in Unreal.
- `Fighter_CanopyGlass`: the canopy transparency, one surface (normals outward), slot `M_Glass_Canopy`. Use a
  two-sided translucent material. Import it as its own static mesh (Nanite does not draw translucent sections).
- Detail lives in the mesh (grooves, hatches, pockets are geometry), plus `T_Fighter_AO.png` and
  `T_Fighter_Cavity.png` baked on UV0 (no overlapping islands). The visible skin gets about 6.4 mm per texel; groove
  walls, slivers and dark interiors are packed at a third of that density. Suggested Unreal import: Combine Meshes
  off, Nanite on for the body, Import Normals.
- Stencil zones (flat, undistorted UV islands for decals later): the roundel area on each upper wing between the
  spars near the tip, and the modex area on each side of the nose ahead of the RCS ports.

## Sockets (empties parented to `Fighter_Body`, X axis = the direction)

| Socket | Where | Points |
|---|---|---|
| `SOCKET_Gun_L`, `SOCKET_Gun_R` | cannon muzzles in the wing-root fairings | forward (+X) |
| `SOCKET_Missile_L`, `SOCKET_Missile_R` | front of the launch rails under the wings | forward (+X) |
| `SOCKET_Engine_L`, `SOCKET_Engine_R` | nozzle exit centres | backward (-X) |
| `SOCKET_Cockpit_Eye` | pilot's eye, 0.8 m above the seat | forward (+X) |

L is the left (port) side, +Y in Blender and -Y in Unreal.

## Proportions (measured, old model vs rebuild)

Fractions of L = nose tip to nozzle exit (15.22 m old, 15.23 m new).

| | Old | New |
|---|---|---|
| Nose tip to windscreen base | 5.13 m (0.337 L) | 5.14 m (0.337 L) |
| Canopy glazing length | 3.7 m (0.24 L) | 3.70 m (0.243 L) |
| Wing LE sweep / TE forward sweep | 31.0 / 15.6 deg | 31.0 / 15.6 deg |
| Chord at nacelle edge / near tip (y 6.2) | 4.94 / 1.76 m | 4.89 / 1.72 m |
| Wing thickness | about 12% (faceted) | 12% (faceted, same section) |
| Span | 13.32 m | 13.27 m |
| Nacelle diameter, axis y / z | 1.40 m, 1.86 / 0.21-0.38 | 1.40 m, 1.86 / 0.36 |
| Wingtip fin height | 1.90 m | 1.93 m |
| Max fuselage width | 2.76 m | 2.76 m |
| Silhouette overlap (IoU) top / side / front | | 0.964 / 0.956 / 0.898 (variant B: side 0.933) |

Triangles: about 179k (body 171k, glass 8k); variant B about 180k.

## Known limits

- Variant A: the over-the-nose view from the eye point is about 7 deg down (the concept shows about 20); variant B
  fixes this at the cost of a flatter forward fuselage.
- The cockpit tub contents are a placeholder (seat, consoles, dash, stick, throttle) until the interior job.
- UV0 uses about 46% of the map: about 4,800 islands, most of them groove walls. A hand-seamed unwrap before the
  booleans would raise the texel density of the skin.
