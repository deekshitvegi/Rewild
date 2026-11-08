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
  The owner chose canopy B: the deck in front of the windscreen lowered so the glass reaches 19 deg below eye level.
  Built by art/fighter/make_fighter.py (Blender, 180k triangles, panel lines as real grooves, AO and cavity maps).
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

## Earth: where it stands (8 Nov 2026, evening)

Graded against the checklist above. Passing: 1 (black space), 2 (limb white-cyan to blue to black), 3 (haze toward
the horizon), 4 (sea: deep navy painted from ocean depth; the Red Sea a little light), 5 (desert), 6 (the Nile), 7
(a broad silver sun glint), 8 (exposure), 9 (the arc), 10 (relief from GEBCO elevation). Not yet: 11, clouds. They
sit where the cloud map puts them and fray at the edges, but they read grainy and beige, not white and soft.

Open, in order:
1. Clouds: render stills with Movie Render Queue (many samples per frame); HighResShot captures at a size the
   viewport has no history for, so the clouds' ray-marching noise never settles. Then judge their shape again.
2. A thin pale line follows some coasts offshore (Argentina, storm study): the water mask, the depth map and Blue
   Marble disagree at the shore.
3. Mask Antarctica and Greenland out of the cloud map (their ice is baked in as cloud).
4. The night side (dark, the Harrow's grinders glowing) and the terminator, with cloud ground shadows back on.

Rebuild everything: `fetch_earth.py`, `prepare_earth.py`, `make_planet_mesh.py` (Blender), then `build_earth.py` in
the editor (command line in Scripts/rewild_shots.py). `REWILD_BELOW="lat,lon"` moves the stills elsewhere.

## Flying: where it stands (8 Nov 2026, night)

Playable: double-click `Play Rewild.bat` in the repo (needs the D: drive). Mouse steers (a virtual stick: the ring
shows where it points), W/S throttle, A/D roll, Shift boost (overheats after 4 s), C chase or cockpit camera,
Alt+Enter full screen, Esc quit; a gamepad works too. Shots of an autopilot run: docs/images/first-flight-*.jpg.

- The fighter: `Scripts/firstfight/import_fighter.py` imports art/fighter/export into /Game/FirstFight/Fighter and
  makes its materials (paint darkened in grooves by the cavity map, clear glass, an engine glow the throttle drives).
- The flight: `Source/Rewild/RewildFighter.*` (C++): flight assist with a little drift, boost and heat, chase camera
  with capped lag, cockpit camera at the pilot's eye, specks streaming past for speed. `RewildHUD` draws only the
  aim reticle for now. `RewildGameMode` flies it.
- The level: `Scripts/firstfight/build_fight_level.py` builds /Game/FirstFight/Maps/L_FirstFight from the Earth
  stack (build_earth.py) and a start 400 km above Egypt. It is the project's default map.
- Stills of the game as played: run it with `-RewildDemo` (flies a scripted turn, takes five shots, quits).

Open: the paint is clean but plain up close (scanned paint, decals and wear next); the cockpit interior is a
placeholder; the HUD (direction F); the clouds (above). Then milestone 3, fighting.

## Fighting: where it stands (8 Nov 2026, late night)

Playable from `Play Rewild.bat`: left mouse (or right trigger) fires the twin cannons. A training range of seven
drones waits ahead: two that hold still, three that circle at 60, 90 and 120 m/s, and two armed ones that weave and
shoot pale blue training bolts back. Each respawns 6 s after it dies; so do you, 4 s after.

- Guns: 12 rounds a second from alternating wing guns, bolts at 1,500 m/s converging at 700 m, so you lead a
  moving target. The amber pip shows where to aim; the reticle ticks when you hit. The guns heat up and must cool.
- Shields soak hits first and recharge after 3 s without a hit (a blue ripple shows where they were hit); then the
  hull takes damage. The HUD shows shield, hull and gun heat as arcs around the reticle, amber when low.
- Explosions in vacuum: a white-hot core, a lumpy fireball of five billows that burns out in under a second (no
  air, no smoke), sparks streaking outward, dark shards and the wreck's own pieces flying on with its speed.
  Impacts are small orange sparks on a hull, a blue flash on a shield.
- Tracers are 20 m streaks with a hot head fading down the tail; sparks and tracers never get thinner than about
  two pixels on screen, so they do not break into dashes far away.
- Code: `Source/Rewild/RewildBolts.*` (every bolt in flight, traced each frame), `RewildHealthComponent`,
  `RewildExplosion`, `RewildDrone` (drones and the range), `RewildFighter` (guns, lead, death), `RewildHUD`.
  Materials: `Scripts/firstfight/make_fx.py` (`make_fx_only.py` remakes just those, fast).
- `-RewildDemo` now hunts the drones on autopilot and takes shots at each kill: three kills in about 23 s.

- The drones: `art/drone/make_drone.py` builds the practice drone in Blender from code (an orange and white target
  drone after the BQM-167, with gold insulation blankets, thruster pods, a turret and antennas; 12 torn fragments
  for its explosion); `Scripts/firstfight/import_drone.py` brings it into the game. Stills:
  docs/images/first-fight-drone.jpg and first-fight-drone-apart.jpg.

Open: the fireball's edge shows a little stepping up close; decals and markings on the drone; sound; then milestone
4, the Harrow.

## Milestones

1. **Earth from orbit.** References: ISS photographs of Earth (day side, terminator, limb). Checklist with numbers,
   still loop against the photographs. Shown as stills.
2. **Flying.** The rebuilt fighter, flight controls (mouse and keyboard, gamepad), chase and cockpit cameras, engine
   glow, a sense of speed against Earth. Playable from a "Play Rewild" shortcut on the PC.
3. **Fighting.** Guns that need leading, shields that recharge, hull damage, explosions and debris, practice targets.
4. **The Harrow.** Reapers (new model, ASSET_JOB), packs that flank, lock-on missiles and flares.
5. **Wingmen and the mission.** Dev, Noor, Kai and Amara on the radio, orders, the mission's start, win and lose.
