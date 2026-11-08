# The first fight (PLAN.md step 2)

Started 8 Nov 2026 ("Start the first fight"). The bar: GAME_DESIGN "the first hour", step 4, and PLAN.md step 2:
Earth from orbit, the fighter flying, guns and lock-on missiles, shields and hull, Harrow reapers with dogfight AI,
the crew as wingmen, explosions and debris, win and lose. Each milestone below is shown to the owner (stills, then
play) before the next one starts, and committed.

## Decisions so far

- **Where:** low Earth orbit, about 400 km up, Earth filling the lower half of the view. The player starts at the
  world origin; Earth's centre sits 6,771 km below it (radius 6,371 km), so everything near the fight keeps full
  precision.
- **Earth:** NASA Blue Marble Next Generation, July 2004 (public domain), 8 tiles at 500 m per pixel, resampled to
  16,384 px tiles and used as one virtual texture in Unreal; GEBCO ocean depth for the water mask (sun glint on the
  sea only). Sky Atmosphere at Earth's real figures; Volumetric Cloud from orbit.
- **Earth's night side is dark.** Nobody has lived on Earth for 300 years, so there are no city lights; the only
  lights on the night side are the Harrow's grinders, hot seams where the ore runs (later milestone).
- **The fighter:** the web version's shape (the owner chose "keep shape, rebuild"): long pointed nose, swept wings
  with canted fins, twin engine pods, white with red stripes. Rebuilt properly at real size (about 16 m long), with
  the canopy of the approved glass-forward cockpit (docs/cockpit-concepts/cockpit-approved-glass-forward.png).
- **Big generated files stay out of git:** the NASA downloads and the Earth textures made from them are rebuilt on
  each PC by `Unreal/Rewild/Scripts/earth/` (too big for GitHub's file storage).

## Earth from orbit: reference and checklist (ASSET_JOB steps 1-2)

References (NASA, public domain, viewed on Wikimedia Commons; not saved in the repo): ISS-64 "Nile River, Red Sea,
Gulf of Oman, Gulf of Aqaba, Mediterranean Sea" and ISS035-E-007148 "Nile - Sinai - Dead Sea - Wide Angle View",
both oblique views from about 400 km. Grade every still against them, line by line:

1. Space above the limb is black (RGB under 10). Never a haze, a glow or a nebula behind the planet.
2. The limb is a thin band: white-cyan at the horizon, deep blue, then black, all within about 1.5% of the
   frame height. Never a thick halo, never purple.
3. Haze thickens toward the horizon: the last 15% of the ground before the limb turns blue-white and loses more
   than half its contrast. Never a hard edge where the ground meets the sky.
4. Open sea is deep navy, the Red Sea near black (about RGB 5-25, 20-40, 50-80); turquoise only over reefs and
   shallows. Never swimming-pool blue.
5. Desert is pale tan to beige (about RGB 200, 170, 130), rust and ochre east of the Red Sea. Never saturated
   orange, never grey.
6. The Nile valley and delta are a dark green-black ribbon about 1-2% of the frame wide, crisp against the sand.
7. Sun glint, where the view meets the sun's reflection, is a broad silver sheen on the sea. Never a hot spot.
8. Exposure as a photograph: desert below 245, nothing clipped, space black.
9. The horizon is an arc: at a 60 degree view its ends sit about 5-8% of the frame height below its middle.
10. Mountains (Sinai, the Red Sea hills) read as relief in the low sun. Never flat paint.
11. Clouds (once added): white, crisp, casting shadows in a low sun; never popcorn or cotton balls.

## Milestones

1. **Earth from orbit.** References: ISS photographs of Earth (day side, terminator, limb). Checklist with numbers,
   still loop against the photographs. Shown as stills.
2. **Flying.** The rebuilt fighter, flight controls (mouse and keyboard, gamepad), chase and cockpit cameras, engine
   glow, a sense of speed against Earth. Playable from a "Play Rewild" shortcut on the PC.
3. **Fighting.** Guns that need leading, shields that recharge, hull damage, explosions and debris, practice targets.
4. **The Harrow.** Reapers (new model, ASSET_JOB), packs that flank, lock-on missiles and flares.
5. **Wingmen and the mission.** Dev, Noor, Kai and Amara on the radio, orders, the mission's start, win and lose.
