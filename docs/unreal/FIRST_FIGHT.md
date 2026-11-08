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

## Milestones

1. **Earth from orbit.** References: ISS photographs of Earth (day side, terminator, limb). Checklist with numbers,
   still loop against the photographs. Shown as stills.
2. **Flying.** The rebuilt fighter, flight controls (mouse and keyboard, gamepad), chase and cockpit cameras, engine
   glow, a sense of speed against Earth. Playable from a "Play Rewild" shortcut on the PC.
3. **Fighting.** Guns that need leading, shields that recharge, hull damage, explosions and debris, practice targets.
4. **The Harrow.** Reapers (new model, ASSET_JOB), packs that flank, lock-on missiles and flares.
5. **Wingmen and the mission.** Dev, Noor, Kai and Amara on the radio, orders, the mission's start, win and lose.
