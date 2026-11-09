# Reaper (the Harrow's fighter)

The Harrow's fighter for the first fight (milestone 4, docs/unreal/FIRST_FIGHT.md), built from code in Blender 5.2 from
the owner's chosen concept, `docs/reaper-concepts/reaper-concept-sickle-2.png` (sickle-1 is a second view). Two
crescent blades sweep out of a compact armoured core and curve forward past the nose to needle points; the core is a
stack of overlapping cast plates with a beaked head of forward-pointing talons, a dark toothed jaw holding the two guns,
louvred flank openings and a short furnace drum at the back. Dark cast alloy, fused without rivets, with recessed hot
seams where the ore runs (docs/design/GAME_DESIGN.md, "The Harrow").

What it has, all built as geometry:

- Blades: lofted from two measured plan curves, 72+ stations; a sharp honed inner edge (3.5% of the width, 6 cm at
  mid-blade, `M_Alloy_Bare`), an inner bevel rising to a spine ridge 47% across, a steep convex outer bevel falling to
  a short blunt back, a shallower keel underneath; 1.25 m thick and 4.65 m long where each grows from the core's rear
  flank, 1.77 m wide and 0.47 m thick at mid-length, under 4 cm in the last 0.5 m; drooping 10 deg outward at the root
  and 22 deg at the tip; two forged joints (lip steps at 38% and 68% of the length, where they break); a domed
  shoulder plate and an outer root plate over each root.
- Core: a superelliptic hull 3.12 m wide and 2.44 m tall (7.6 m with drum and head; 3.6 x 3.1 m with its plates),
  hollow (8 cm wall) behind a solid nose; 20 cast plates (3 dorsal, 2 side carapace, 3 rows of flank plates, chin,
  belly, keel), each a wedge with a thick free edge forward (24-40 cm lips tapering to 5-8 cm), a crown, 5 cm rounded
  rims; the head: beak, two pairs of talons converging on it, a brow on top; the jaw with 9 downward teeth and two
  gun barrels with breech collars; a recessed louvre each side (7 vanes raked 30 deg); the missile cradle under the
  belly (3.0 x 0.58 x 0.30 m, two rails, three clamp ribs).
- Furnace drum at the back: 1.92 m across, 1.37 m long, 14 ribs with the hot chamber glowing between them, a thick
  rear lip, a grate of 7 horizontal bars and a vertical bar in front of the chamber's recessed back face, gripped by
  7 curved collar claws.
- Hot seams, recessed (never proud): 6 main runs 50 mm wide and 40 mm deep (each blade's spine, round each shoulder
  plate onto the core, the free edges of the two big dorsal plates), 14 secondary runs 22 mm wide and 25 mm deep (the
  blade joints, the flank plates' edges, the gaps between the head plates). Glowing floor `M_Seam_Hot`, heat-tinted
  walls `M_Alloy_Tint`.
- Inside (seen in the debris): hull wall, 4 ring frames, 4 longerons, an ore conduit trunk from the jaw to the
  furnace with branches to the blade roots; each blade hollow to 60% of its length (7 cm walls) with 5 ribs and a
  conduit under the spine. Fracture faces are bare metal; where a fracture crosses a conduit's core it glows.

The method was docs/claude/ASSET_JOB.md: the concept's silhouette traced (`tools/concept_trace.json`), a camera fitted
to it, the checklist below written before the first line of code, then 5 graded rounds of stills with flat-colour ID
renders for silhouette overlap and material shares.

## Checklist and final grades (round 5)

Measured in the concept pose (the camera fitted to the concept: azimuth 50.4 deg off the nose, elevation 32.7 deg,
roll -3.9 deg, horizontal FOV 43.5 deg, 19.5 m; `concept` view in `tools/render_stills.py`).

| # | Line (written before the first render) | Measured | Grade |
|---|---|---|---|
| 1 | Silhouette IoU >= 0.80 with the traced concept; tips and beak within 20 px | IoU 0.76; far tip 4 px, near tip 6 px, beak 7 px | partial |
| 2 | 14.0 m long, 11.0 m span, tips 4.8 m apart turned 25-35 deg in, beak 6.4 m behind the tips | 14.02 m, 11.22 m, 4.80 m, 32.7 deg, 6.4 m | yes |
| 3 | Root >= 1.0 m thick and 3.5 m long; mid-blade 0.30-0.40 m thick, ~1.8 m wide (t/w 0.18-0.22); < 5 cm in the last 0.5 m; spine 40-55% across; honed edge 3-8 cm | 1.25 m, 4.65 m; 0.47 m x 1.77 m (t/w 0.27); yes; 47%; 6 cm | partial (thicker: the concept's outer bevel reads as a wide dark band) |
| 4 | Core 3.0 x 2.2 m hull, 12-20 plates, lips 10-18 cm, edges rounded 2-4 cm; never a blob or a box | hull 3.12 x 2.44 m, 20 plates, lips 24-40 cm, 5 cm rims | partial (lips 15-20 cm vanished at the concept distance) |
| 5 | Beak 0.5-0.7 m below the centre line, 2 talons each side, dark jaw with 5-7 slats each side and the guns | beak 0.9 m below (placed on the concept's beak), 2 talons + brow, 9 teeth, 2 guns | partial |
| 6 | One louvred opening each side, 6-8 ribs, ~1.4 x 0.6 m | 1 each side, 7 vanes, 1.1 x 0.6 m | yes |
| 7 | Drum 1.7-1.9 m across, 1.4 m long, 14-18 ribs, grate, collar; hot engine <= 1% of the ship in the concept pose; never a glowing disc | 1.92 x 1.37 m, 14 ribs, grate, 7 claws; 0.16% | partial (from straight behind at 120 m the grate blurs to a glowing round, 2.4% of the ship) |
| 8 | 6-12 main seams 40-60 mm, secondary 15-25 mm, recessed 30-50 mm; hot 0.3-1.5% of the ship; never tubes or a grid | 6 main 50 mm, 14 secondary 22 mm, 40/25 mm deep; 0.42% (concept 0.52%) | yes |
| 9 | Median luminance within 0.04 of 0.135; warm and cool each >= 15% | 0.143; warm 41%, cool 29% (concept 47%, 30%) | yes (preview material) |
| 10 | Chase 120 m and 400 m: the crescents and the gap read; hot 1-5% from behind | level from behind it is a flat bar 127 x 34 px; banked 50 deg the crescent reads; hot 1.7-2.4% (120 m), 1.0% (400 m) | partial |
| 11 | Belly: plates, blade keels, a recessed cradle ~3.2 x 0.6 x 0.3 m | belly, chin and keel plates, keels, cradle 3.0 x 0.58 x 0.30 m | yes |
| 12 | 12-16 fragments, each blade in 2-3, every cut shows frame and conduits; never a solid black section | 13, each blade in 3, hull wall, frames, longerons, conduits with glowing ends, hollow blades with ribs | yes (fragments 02 and 04 have 6 and 8 open edges) |

Why line 1 stops at 0.76: the concept's engine drum and rear plates are drawn 150-190 px right of where any centred
engine can appear with these blades. A joint fit of camera, core length and blade height against the real geometry
needed a core 1.5-2 times longer and still missed the drum by 105 px; the concept is not geometrically consistent there.
The blades, beak and head match; the remaining concept-only area (16%) is mostly that drum.

## Files

| Path | What |
|---|---|
| `make_reaper.py` | Builds everything (model, interior, seams, UVs, bakes, debris, sockets, export) in one script. |
| `export/reaper.fbx` | The whole ship: `Reaper_Body` (64,879 triangles) and its 4 sockets. |
| `export/reaper_debris.fbx` | 13 fragments, `Debris_01` to `Debris_13` (97,799 triangles together). |
| `export/reaper_debris.json` | Per fragment: triangles, volume, centre of volume, bounding box, slots, open edges. |
| `export/textures/T_Reaper_AO.png` | Ambient occlusion (0.6 m), 2048 px, UV0. |
| `export/textures/T_Reaper_Cavity.png` | Cavity, 2048 px: flat 0.5, recesses dark, convex edges bright. |
| `export/textures/T_Reaper_Normal.png` | Tangent-space normal map, 2048 px, **DirectX convention (green = -Y, Unreal's own: no flip)**: hammered and cast surface (smooth Voronoi dimples 8-20 cm, cast pitting 1-2 cm, slow undulation) on 2.5 cm rounded plate edges, baked from the procedural high-detail shading (Cycles Bevel + Bump) onto the low mesh. |
| `export/textures/T_Reaper_Tint.png` | Heat-tint mask, 2048 px: white where the ore's heat tempered the alloy (near the seams, round the drum, toward the blade roots) in irregular forge blooms, black elsewhere (19% of texels above 0.3). |
| `tools/render_stills.py` | Still-loop views (Cycles, GPU), with the maps applied as the Unreal material is meant to (`--tex`). |
| `tools/measure.py` | Silhouette IoU against the traced concept, material shares, luminance and colour shares. |
| `tools/compose.py` | Contact sheets, concept pairs, crops, the final JPEGs. |
| `tools/verify_fbx.py` | Re-imports both FBX files and prints objects, slots, sockets, size. |
| `tools/concept_trace.json` | The concept's silhouette, traced by hand (1344 x 752 px). |
| `stills/reaper_concept_pose.jpg`, `stills/reaper_chase.jpg` | Final stills (the chase still is the game frame at 120 m, banked, with a 5x inset). |

## Rebuild and export

From the repo root (about 46 s with the bakes on the RTX 3070; 30 s of it is UV packing):

```
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P art/reaper/make_reaper.py -- ^
    --blend <scratch>\reaper.blend --export art/reaper/export --bake
```

`--blend` saves the scene (keep it out of git), `--export DIR` writes the FBX files and the JSON, `--bake` the four
maps into `DIR/textures`, `--tex 4096` changes the map size, `--fast` skips the debris. The log prints every boolean's
face counts, triangles, the core's size, blade widths and thicknesses, the tip heading and the volume check.

Stills: `blender -b --factory-startup -P art/reaper/tools/render_stills.py -- --blend <scratch>\reaper.blend
--out <dir>\r --tex art/reaper/export/textures --views concepte,id_concept,chase120,chase120b,chase400,head200,belly,exploded,cut`,
then `python -I art/reaper/tools/measure.py iou <dir>\r_id_concept.png` (and `shares`, `lum`).
Check: `blender -b --factory-startup -P art/reaper/tools/verify_fbx.py -- art/reaper/export`.

How it is built (to tweak it): the plan is `BLADE_OUT` / `BLADE_IN` (left blade, design frame), sections
`section_uv()`, thickness `BLADE_H`, droop `BLADE_BANK`, joints `JOINTS`; the hull is `HULL_X/A/ZT/ZB`; plates are
outlines in (x, theta) in `build_plates()` (`crowned()` sets their wedge and crown); the head is `build_head()`; seams
are paths dropped onto the surface by ray casts in `make_seams()`; the drum is `build_engine()`.

## Size, axes and origin

- Metres. 14.02 m from blade tips to the furnace lip, 11.22 m span, 3.14 m tall overall.
- Front +X, up +Z, left blade +Y; exported like the drone and the fighter (FBX forward -Z, up Y, "FBX units scale"),
  so in Unreal the front points +X and up is +Z (1 m = 100 uu). Re-importing gives the same size and axes.
- Origin: the core's centre of volume (built in a design frame and shifted; the offset is stored on `Reaper_Body` as
  `design_offset`).

## Material slots

`M_Alloy_Dark` (cast plates), `M_Alloy_Tint` (seam walls, conduits, drum liner), `M_Alloy_Bare` (honed blade edges
and the fracture faces of the debris), `M_Seam_Hot` (seam floors, conduit cut ends; emissive, hotter with damage),
`M_Engine_Hot` (the furnace chamber; emissive, by throttle), `M_Dark_Interior` (jaw, louvre and cradle pockets, the
hull's inside). The FBX colours are previews only.

Suggested Unreal material (what `render_stills.py --tex` previews): oxide skin of charcoal mottled to rust-brown and
blue-grey scale, roughness about 0.6, metallic about 0.55; `T_Reaper_Tint` blends in temper colours by its value
(bronze at the fringe, straw, purple, blue-grey nearest the seams), metallic 0.75, roughness 0.48; `T_Reaper_Cavity`
above 0.56 wears edges to bare steel (roughness 0.36), below 0.46 darkens recesses to 35%; `T_Reaper_AO` multiplies
(0.3-1.0); a tiling cast-iron detail texture adds the pitting. Preview emission: seams strength 3.5, engine 5.

## Sockets (empties parented to `Reaper_Body`, X axis = the direction)

| Socket | Where (m) | Points |
|---|---|---|
| `SOCKET_Gun_L`, `SOCKET_Gun_R` | gun muzzles in the jaw (3.44, +-0.30, -0.79) | forward (+X) |
| `SOCKET_Engine` | centre of the furnace mouth's exit (-3.48, 0, 0.11) | backward (-X) |
| `SOCKET_Missile` | in the cradle under the core (1.04, 0, -1.14) | forward (+X) |

## Fragments (reaper_debris.fbx)

Every fragment's pivot is the Reaper's origin and its vertices stay where they are in the whole ship, so the game can
swap `Reaper_Body` for the fragments at the same transform and push them apart along each centroid (JSON). They keep
the ship's UVs and maps (unwrapped before cutting). Volumes add up to 100.0% of the core and both blades.
01: the furnace drum; 02-07: the core in six (left / right, front / back, and the front halves split once more low under the head); 08 and 11:
the blade roots with shoulders; 09 and 12: the blades' middle thirds; 10 and 13: the tips.

## Known limits

- Silhouette IoU 0.76 in the concept pose (above): the concept's drum cannot be matched by a symmetric ship.
- From straight behind and level the blades are edge-on (a flat bar); the crescent reads when it banks.
- Mid-blade 27% thick for its width and plate lips 24-40 cm: heavier than the checklist's numbers, chosen to read like
  the concept at its distance.
- Fragments 02 and 04 carry 6 and 8 open edges from the cuts through the head; harmless for rendering.
- UV0 uses 47% of the map (about 1,200 small groove and slat islands, shrunk); the plates get roughly 9 mm per texel (estimated from the surface area).
- The concept's skin is more broken (flaking, scratches) than the baked maps: that is the Unreal material's detail
  texture's job.
