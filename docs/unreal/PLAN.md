# Building Rewild in Unreal Engine 5

Decided by the owner on 8 Nov 2026 after playing the web version: move to Unreal Engine 5 now; space war means
dogfights, capital ship battles, boarding and ground battles; the war is the main story, with building as deep as
the battles. What the game is: [docs/design/GAME_DESIGN.md](../design/GAME_DESIGN.md).

## Why the web version looked "placed" and felt stale (do not repeat it)

1. Nothing to do but sightsee: every chapter was "fly to the gold marker, a card appears"; aliens answered in text;
   nothing fought back and nothing could be lost.
2. No shadows between objects and the ground, no contact shading, no bounce light: models floated.
3. Surfaces painted in code, not scanned from real stone, wood, soil and metal.
4. Buildings were solid shells: no doors, no insides, nothing to do there.
5. Earth: flat cut-out clouds, a pale flat haze, a purple nebula behind the planet where space is black, grey mush
   from low altitude (docs/images/old-earth-from-orbit.jpg).

Unreal's answers: Lumen (bounce light and shadows everywhere), virtual shadow maps, Nanite, Quixel Megascans through
Fab (scanned materials, free in Unreal), Sky Atmosphere and Volumetric Cloud (physically based, ground to orbit),
MetaHumans for people. Every place is built to be entered and used, with a fight, a person or a reason in the story.

## How the work is done

- Unreal needs a graphics card, so the work runs in Claude Code on the owner's PC (RTX 3070 desktop; or the RTX 4070
  laptop with Windows set to run Unreal and the Claude app on the NVIDIA chip). A cloud session can write design
  and docs, and work on `web/`, but cannot open Unreal.
- The Unreal project lives in `Unreal/` in this repository. Its binary files (.uasset, .umap, models, pictures,
  sound) go through Git LFS (rules in .gitattributes). Run `git lfs install` once on the PC.
- Claude builds with C++ and Unreal's Python editor scripting (levels, materials, imports, test shots) and judges
  every step from screenshots taken in the engine (HighResShot) at the views the player has.
- docs/claude/ASSET_JOB.md applies to every model, place and film. Frame times measured on the RTX PC.
- Licence: Unreal is free until a game earns USD 1 million, then 5% royalty. Fab Megascans are free in Unreal.

## What carries over (all of it is in this repo)

| From | Into Unreal |
|---|---|
| The story, crew, ARGO's lines, the real figures (`web/components/expedition/bodies.ts`, `expeditions.ts`, `story.ts`, `contact.ts`) | Data tables and dialogue |
| Models in `web/public/models/expedition` and their Blender sources in `art/` (ship, Argo, astronaut with its motion-capture clips, temples, shrine garden, trees, food plants) | Imported (glTF/FBX), re-lit; the astronaut keeps its skeleton and motions |
| HUD direction F (glass with instruments, amber accent; `web/components/expedition/ui.css`) | UMG widgets |
| Music and sounds | Imported, MetaSounds |
| Real places: Svalbard Seed Vault, Shackleton's rim, Jezero | Rebuilt as walk-in levels |

Rebuilt from scratch: flight, walking, planets and terrain, weather, water, and everything drawn.

## Planets: the trade-off

Unreal has no ready-made round, landable planet.

1. **Space and ground as separate levels:** fly down through cloud while the ground level streams in. Fast to build,
   every landing site hand-made to a high standard.
2. **Seamless round planets** (land anywhere, like the web version): a planet system (Voxel Plugin 2, or our own
   quadtree terrain on a sphere). Weeks before the first landing looks good.

Start with 1. Decide on 2 with the owner once the battles are fun.

## Order of work (each step playable, shown to the owner, then committed)

1. **Set-up on the PC:** check Unreal 5 (latest 5.x), Visual Studio 2022 with "Game development with C++", Git and
   Git LFS. Create the C++ project in `Unreal/` (name: Rewild). One HighResShot test shot. Commit.
2. **The first fight** (GAME_DESIGN "the first hour", step 4): Earth from orbit with Sky Atmosphere and Volumetric
   Cloud, the fighter flying, guns and lock-on missiles, shields and hull, Harrow reapers with dogfight AI, the crew
   as wingmen, explosions and debris, win and lose. Show it before anything else.
3. **Farside:** the first base built piece by piece on the Moon (the building system's core: placing modules,
   drones building them, power and people).
4. **The Argo under fire:** capital ship, turrets, the Harrow carrier, weak points.
5. **On foot:** the astronaut with its motions, weapons, cover, the Seed Vault interior.
6. **Boarding:** dock with a Harrow barge, fight inside.
7. Then the prologue on Haven, and the rest of the campaign one mission at a time.
