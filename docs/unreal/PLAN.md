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

## Planets: land anywhere (decided by the owner, 9 Nov 2026)

Unreal has no ready-made round, landable planet. The two ways were: separate levels for space and for a few
hand-built landing sites, or seamless round planets you can land on anywhere. The owner chose **land anywhere**:
every world is a whole round planet at its real size, flown down to from orbit without a loading screen, and the
hand-built places (the shrine garden, the Seed Vault, Jezero) sit inside it.

How it is built (our own C++, `Unreal/Rewild/Source/Rewild/Planet*`; no paid plugin):

- **The ground** is a sphere made of six square faces, each split into tiles that get finer as you come closer
  (a quadtree): from orbit a few hundred tiles cover the planet, at your feet each tile is a few metres across with
  a point every 25-50 cm. Tiles are built on worker threads, so flying never stutters.
- **The height** comes from one function of position, used by everything (the ground, the sea, collision, where
  grass and trees grow): the world's own map (real elevation for Earth, the Moon and Mars; designed and eroded for
  Haven and the invented worlds), finer detail added below what the map holds, and **hand-built places** pressed
  in where the story needs them (a bay, a tarn and its falls, level ground for a temple).
- **Surfaces** are scanned materials (ambientCG, Poly Haven, Megascans; never painted) chosen by slope, height and
  climate, seen from above as the world's own colour map.
- **Light** is Lumen with hardware ray tracing (the ground is built while you play, so it has no precomputed
  distance fields), virtual shadow maps, Sky Atmosphere and Volumetric Cloud at the planet's real size.
- **Life** (grass, plants, trees, rocks) is placed around the player from the same height function, so the same
  spot always grows the same trees.
- **The sea** is a second sphere at sea level, drawn only where the ground dips below it.

## Order of work (each step playable, shown to the owner, then committed)

Owner, 9 Nov 2026: "I know you want to build the fighting and all but I'd prefer to build the world's and
everything first and once we have everything then we can proceed to build rest". So: **the worlds first, all of
them, with everything in them; then the rest of the game.**

Done:

1. **Set-up on the PC** (8 Nov): Unreal 5.8.2, the C++ project, the first test shots.
2. **The first fight** (8-9 Nov, docs/unreal/FIRST_FIGHT.md): Earth from orbit, the fighter, guns, missiles and
   flares, shields and hull, the Harrow's Reapers, the crew as wingmen, the radio, the first story mission, the main
   menu and saves. It stays playable as it is; its open items (missile models, sound effects, music, the full HUD)
   wait for the second part.

**Part one: the worlds.** Each world is done when it can be flown down to from orbit and walked, and its places,
plants, animals, water, weather and the buildings, ships and people that belong there are built (ASSET_JOB.md for
every one), shown to the owner as stills, then as a fly-down they can play in free play.

3. **The planet system, on Haven** (docs/unreal/HAVEN.md): a round Haven flown down to from orbit and landed on
   anywhere, ground detail from orbit to the player's feet, scanned surfaces, the sea, the sky.
4. **Haven** (the prologue's world, first on the owner's list): the colony and its domes, the bay, the tarn and the
   waterfall gorge, the shrine garden, the Greek and Indian temples, forests and real grass, TON 618 in the sky,
   weather, birds and fish, the people of the colony.
5. **The Garden**, the magical world by TON 618 (a story secret): glowing contour lines, a garden that grows where
   you walk, the cloaked wanderer.
6. **Earth**, rebuilt on the planet system from its real elevation and Blue Marble: clouds from orbit to the ground,
   Svalbard and the Seed Vault (inside too), a ruined city, the Pacific, forests grown back over 300 years, the
   Harrow's grinders.
7. **The Moon**: Farside, Shackleton's rim (real LOLA heights).
8. **Mars**: Jezero and the abandoned colony (real MOLA heights), dust storms, blue sunsets.
9. **The rest of the worlds**: Venus and the Aeronauts' cloud city, Europa (the ice, the crack, the sea under it),
   Titan's methane seas, Jupiter's deep, Saturn and its rings with the wormhole's mouth, Triton and the Makers'
   archive (a story secret), TON 618 and the wormhole.
10. **The ships and people** that the worlds do not already hold: the Argo inside and out, the Harrow carrier,
    barges and grinders, the crew, Vesk and the allies as people.

**Part two: the rest of the game**, once the worlds are done:

11. **Building**: bases built piece by piece (Farside first): placing modules, drones building them, power, people.
12. **The Argo under fire**: capital ships, turrets, the Harrow carrier, weak points.
13. **On foot**: the astronaut with its motions, weapons, cover, fighting in the Seed Vault.
14. **Boarding**: dock with a Harrow barge, fight inside.
15. The campaign one mission at a time, sound and music, the full HUD.
