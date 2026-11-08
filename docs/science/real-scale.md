# Real-size worlds: plan

The user chose a real-size Earth (5 Nov 2026). Today every world is 1/531 of real (EARTH_RADIUS = 12,000 units,
AU = 282 M units; one unit is a metre underfoot, ~531 m across the globe). Texas to LA is 4.5 km; it becomes ~2,000 km.

## Why it is a rebuild, not a constant

`EARTH_RADIUS` drives AU, SYSTEM_SCALE and KM, but most world values were tuned by hand to the small worlds:
air thickness (Earth `atmosphereHeight` 1,400 u; real air is ~100 km), terrain amplitudes and noise frequencies,
cloud decks and storm cells, river widths from the Earth map, landing/expedition/story-site offsets, the Argo's
station (4,200 u over the landing site), flight speeds (cruise 230 m/s), weather `arrive` times, LOD depths.

The hard technical part is precision. Shaders compute positions from the planet's centre in 32-bit floats
(`p = d * (uRadius + h)` in PlanetTerrain, WaterSurface, Grass, ContactShadows, Aurora). 32-bit floats carry ~7
digits: at 6.4 million metres a position lands to ~0.5 m, so the ground would shake and crack underfoot. Noise
sampled by direction has the same limit (a metre is 1.6e-7 of a unit direction).

## Stages (each one shippable, measured, and shown before it reaches main)

1. **Eye-relative positions (no visual change).** Terrain chunks carry their centre relative to the camera,
   worked out in 64-bit on the CPU each frame; the vertex shader adds only the small local offset. Height noise is
   sampled from a chunk-local origin split into a coarse part (CPU) and a fine part (GPU). Water disc, grass,
   contact shadows and aurora move to the same scheme. Test: the current small Earth must look identical, and a
   stress test at 6.4e6 radius must not shake at 1 cm.
2. **Scale switch.** `WORLD_SCALE` (1 today, 531 real) applied to radii, orbits and the AU; the hand-tuned values
   become physical (air 100 km scale heights, real mountain heights from the Earth map, real river widths) under
   that switch. LOD depth grows (12 -> ~21 levels); camera far and log depth re-checked.
3. **Earth's sky and clouds from takram** (three-atmosphere: Bruneton precomputed scattering; three-clouds:
   volumetric cumulus/stratus/cirrus with shadows): the cloud lab (lab/cloud-lab.tsx) shows them working at real
   size, with the game's logarithmic depth (AerialPerspective needs USE_LOGARITHMIC_DEPTH_BUFFER set by hand).
   The game's own Atmosphere/cloud deck stay for other worlds (takram is Earth-only).
4. **Travel at real distances.** In the air: subsonic -> hypersonic cruise with altitude; a suborbital hop
   (Texas to LA in ~15 min of play time, time-compressed in the ascent and coast); orbit at 7.8 km/s; pulse drive
   between worlds scaled with the AU. Walking/swimming unchanged.
5. **Placements and story.** Landing sites, expeditions, story finds, crew parking, the Argo, Haven, the
   wormhole re-laid in real units; forced weather timings re-derived.
6. **Performance pass at real size** on the user's devices (RTX 3070 PC, laptop on its 4070, iPhone 15 Pro Max).
