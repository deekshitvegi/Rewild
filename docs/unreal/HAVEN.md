# Haven, and the planet system (PLAN.md steps 3-4)

Started 9 Nov 2026. The owner chose to build the worlds before the rest of the game, every world as a whole round
planet you can land on anywhere, and **Haven first** (first on their list since 7 Nov). Haven is where the game
starts: the colony by the black hole TON 618 (GAME_DESIGN.md, Prologue; the first hour, step 1).

## Haven's figures (decided 9 Nov; the web version's where it had them)

- **Size:** radius 5,730 km (0.9 of Earth's). Surface gravity 8.9 m/s² (the web version's figure); at Earth's density
  that is what a world 0.9 Earth's size weighs, so the two agree.
- **The light:** Haven goes round TON 618 turned always the same face to it, as the Moon is to Earth, so the hole
  hangs fixed in the sky and its accretion disk is the daylight: warm (#ffd8b0), from a wide source, so shadows are
  soft. The colony stands where the hole sits about 35 degrees up. The far hemisphere is in night for ever, lit only
  by the stars of the other galaxy.
- **The air:** nitrogen and oxygen, breathable (the web version: `breathable`). A dusky sky, dark enough by day for
  the hole to show.
- **The ground:** gentle teal grassland where the colony is (slopes mostly under 15 degrees), seas in a few great
  basins, a bay at the foot of the colony's hill (so facing TON 618 from the colony you look out over open water).
- **The water:** clear fresh water, jade in the shallows (#2f6d63), dark teal where it is deep (#0b2629).
- **The places** (the web version's layout, kept): the colony on its hill; the tarn on the bench south of it, its
  stream running east to the lip of the bluff and falling 48 m into a gorge down to the sea; the Japanese garden
  round the tarn (hall, pagoda, gate, torii in the water); the Greek temple on the bay's headland facing TON 618
  over the sea; the Indian temple and its stepped tank on the terrace north-east of the colony.

## References (ASSET_JOB step 1)

- **Haven's key art** (the concept picture, invented world): `web/public/textures/story/haven.webp`. Teal rolling
  grassland, still pools mirroring the sky, the domes, TON 618 huge above them.
- **Two Horizons** (x.com status 2113400110415860193): a world lit by a giant black hole; Haven's mood.
- **Temple garden** (Leon Lin, 2110662953993384073) and **Athenaion** (2111747312343281703): whole composed places,
  water leading to the temples, golden light, haze (docs/visual-references.md).
- Measured off the key art (sRGB, mean): zenith 10, 19, 22; sky at the horizon 35, 41, 44, warmer under the hole;
  near grass 15, 61, 53 (10th-90th percentile 1-30, 34-89, 29-79); far hills 22, 48, 44.

## Step 3, the planet system on Haven: checklist (ASSET_JOB step 2)

Graded on stills from orbit (1,000 km), from 20 km, from 300 m (the ship) and from 2 m (on foot), the key art
beside them:

1. Haven is round from every height: from orbit a whole globe with a thin teal-blue limb; at 300 m the horizon
   still curves a little. Never a flat plane with an edge.
2. The ground holds detail all the way down: at 2 m a point every 0.5 m or closer, and the surface pictures sharp
   (at least 500 pixels a metre). Never a blurred ground, a repeating pattern visible across 100 m, a crack or a
   step between tiles.
3. No popping you can see: tiles change detail beyond the distance where a change is smaller than 2 pixels at
   1080p. Never a hill that jumps as you fly.
4. Rolling grassland where the colony is: hills 20-80 m high over 300-800 m, slopes mostly under 15 degrees; bare
   rock only on slopes over 35 degrees. Never noise that looks like noise (even bumps everywhere): valleys drain,
   ridges branch.
5. Seas in a few great basins, about 40% of the surface. The sea is dark teal where deep, jade over the shallows,
   with the sky in it. Never a seam or flicker where water meets shore.
6. The sky from the ground: zenith near 10, 19, 22, the horizon near 35, 41, 44, warmer under TON 618. From orbit,
   space is black above the limb.
7. The light is warm (#ffd8b0) and soft (a wide source): grass in the open near 15, 61, 53. Never a white noon sun,
   never hard black shadows.
8. Flying: from orbit to the ground in about two minutes (travel speed grows with height; near the ground the
   fighter flies as it does in the first fight), no stutter while tiles build.
9. Cost: 60 frames a second at 1080p on the RTX 3070 (16.6 ms) flying at 1 km, measured.

Later in step 4 (each its own checklist when it starts): the colony and its domes; the bay, tarn and falls pressed
into the ground and eroded; real grass, trees and rocks; the shrine garden and the temples; TON 618 drawn in the sky
(the black hole and its disk); the water moving (waves, the falls, mist); weather; birds and fish; the colony's
people.

## Where it stands

- 9 Nov: the plan and this checklist.
- 9 Nov, later: **the planet system works on Haven** (24ed5c5 and after). `Play Haven.bat` starts 400 km up; the
  autopilot (`-RewildWorldFly`) flies down to 800 m over the colony in 107 s. Stills: docs/images/haven-*.jpg
  (globe, 1,000 km, flying in at 100 km, the ship at 300 m, on foot, low over the bay). Ten rounds of stills.

  Graded against the checklist and the key art (sRGB means, 1080p):
  1. Round from every height: **yes** (the globe, the limb from 1,000 km, the horizon curving from 300 m).
  2. Detail to your feet: **partial**. Points every 27 cm, no cracks seen. But the ground is a gravel photograph
     tinted teal (1,024 px over 2 m, 512 px a metre) until the real grass, and needs scanned 4K ground sets.
  3. No visible popping: **not checked in motion yet** (tiles split where their error passes 1.5 px).
  4. Rolling grassland: **partial**. Hills of 20-80 m round the colony, but the land elsewhere reads as noise, and
     the colour patches seen from the air look like noise too: valleys do not drain yet (erosion is step 4).
  5. Seas: **yes**, 39.9% of the surface. Dark teal deep, the shallows teal-jade (27, 73, 68 against #2f6d63:
     47, 109, 99). A faint brightness step at a tile edge in the glint toward TON 618 seen from 20 km (open).
  6. Sky: **partial**. Zenith 19, 31, 34 (key art 10, 19, 22); the band of light along the sea's horizon is too
     bright and cyan.
  7. Light: **partial**. Grass 36, 61, 53 (key art 15, 61, 53): the red is still high.
  8. Flying: **yes**. 400 km to 800 m in 107 s, frames steady.
  9. Cost: **yes**. 8-9 ms a frame through the whole descent (110-125 a second), 1080p, RTX 3070: no grass, trees
     or clouds yet.

  Settled on the way (the reasons are in the code): the light is a little less warm than #ffd8b0 (255, 228, 200)
  and 2.5 degrees wide; a third of Earth's haze and an eighth of its air; the sea's water shading only within
  about 50 km (beyond, a plain deep-water surface), because the depth buffer has no precision left thousands of
  km away; the sky light fades out above 30 km (from space it lit the planet's own night side).

  Next, step 4 in order: TON 618 drawn in the sky; scanned ground (needs the owner's yes to download); erosion and
  the colony's ground pressed in (bay, tarn, falls); real grass, trees and rocks; clouds; then the places.
