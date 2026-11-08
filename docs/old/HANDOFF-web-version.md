# Codex Handoff - Galactic Portfolio

Last consolidated: 2026-08-11 (Expedition summary added 2026-10-03)

## The Expedition — update 2026-11-06: two systems, and the films

- **Two systems, built one at a time** (`region.ts`): ours (`sol`: the Sun,
  planets, moons, the mouth by Saturn) and TON 618's (`ton`: the black hole,
  Haven, the far mouth). `ExpeditionWorld`, `DeepSpace`, the giants' depths,
  the Sun, the planets as points, Io's volcano, Enceladus's geysers, Jupiter's
  floaters, the orbit debris, the historic sites, the aurora and the sun flare
  are mounted only in `sol`; the colonists and TON 618 only in `ton`.
  `RegionWatch` (ExpeditionExperience.tsx) reads the region from where the
  player's ship is, so a crossing, the new ship after TON 618 and a crew member
  parked in the other system all switch it the same way.
- **The films** (`films.ts`, `FilmPlayer.tsx`, `film.css`): full screen, with
  the crew's voices, captions (cues in `films.ts`, timed from the films' own
  audio), a bar for how much has loaded that never runs backwards, and once
  everything is ready a Skip button (Enter, Space or Escape). A film ends by
  itself when it has finished and the world is ready; if it finishes first it
  holds its last frame (no caption) and says "Almost there". Volume follows
  Settings › Sound › master; if the browser refuses sound it plays muted with
  the captions.
  - **Opening** (`ExpeditionLaunch.tsx`): after Begin expedition, over the
    veil, while the world is built. A new game (no story progress in
    `expedition-progress-v1`) plays `opening-haven` (the Argo by TON 618, then
    the colony), anyone further on `opening-solar` (ruined Earth from orbit,
    Dev and Amara in the cockpit). The game is revealed when the world is ready
    and the film is over.
  - **The crossing** (`WormholeFilm.tsx`): when the Argo enters a throat the
    film covers the screen, the other system is swapped in behind it (450 ms
    later, once it is opaque), and `RegionGate` waits for its models and
    pictures (bar 10-70%), compiles what is near (`compileNear`, 75%) and waits
    until CompileGuard holds nothing back (90-100%, `regionLoad`). The crossing
    (WormholeTransit.tsx) is held at `TRANSIT_HOLD` (3.2 s, before the far
    side opens) while `runtime.loading`; the film fades back into the game,
    which opens out live. `crossing-out` / `crossing-home` (35 s: the approach
    by Saturn or by TON 618, the cockpit, the throat through the window, Kai
    and Noor in the crew bay, the Argo in the tunnel, the far side). Settings ›
    Graphics › Wormhole film (`rewild-film`) picks the crew's film or the
    short one drawn by the game (`wormhole-game-<out|home>`). The next film is
    fetched only once the Argo is docked. A switch without a crossing shows a
    plain card with the bar.
  - Films are Seedance 2.5 (Higgsfield) clips cut together: see
    `public/films/ATTRIBUTION.md`. WebM (VP9 + Opus: Chrome, Edge, Firefox,
    Android) and MP4 (H.264 + AAC: Safari, iPhone), picked by `canPlayType`.
- **Far mouth photographs**: out by TON 618, Saturn is not built, so the far
  mouth's photograph of home carries a stand-in (`saturnStandIn.ts`: map,
  rings, lit by the Sun), visible in that photograph only.
- **Re-crossing fixed**: the Argo's chase camera, 430 m behind her, could still
  be inside the mouth she had just come out of, and she went straight back
  through (old builds too). The exit mouth is disarmed until the camera is 1.5
  throat radii clear (`exitMouth` in Player.tsx).
- Measured (software rendering, 640x360, Low): starting on Haven the game opens
  in 16.7 s instead of 18.9 s, with 64 shader programs instead of 81, 10 fewer
  draw calls and 123 fewer scene objects; starting on Earth, unchanged (TON 618
  was already deferred there).

## The Expedition — update 2026-10-29

- **Speed** (measured by rendering the frozen scene object by object in
  software rendering): the space backdrop is baked once into a cube map
  (`SpaceBackdrop.tsx`, per pixel only out by TON 618) and not drawn at all
  inside a giant's haze (`SKY_COVER`); the cloud decks are one-sided shells
  with noise read from a tiling 3D texture (`noiseTexture.ts`); the ground's
  waves, canopy, surf and rock layers read the same texture instead of hashing
  noise per pixel; airless worlds skip the air haze; Low has coarser far
  terrain. Worlds' maps decode off the main thread (`mapLoader.ts`, 2048 wide at
  Low). Noise textures are read with `textureLod` (Direct3D forbids implicit
  derivatives in loops and branches).
- **The sky as it is**: moons sit at their real distances in planet radii (the
  Moon spans its true half degree from Earth, Jupiter 12 degrees from Europa;
  the Sun is still drawn four times its size from Earth). Airless worlds seen
  whole are shaded as lunar dust (lunar-Lambert with the opposition surge);
  dark-adapted eyes brighten other worlds at night (`runtime.nightEyes`,
  `surfaceShading.ts eyeGain`); clear night air dims the sky far less than by
  day (`Atmosphere.tsx`). Planets far off are points of light at their real
  magnitudes (`PlanetPoints.tsx`, Mallama and Hilton 2018 phase curves). Hold Z
  (touch: Closer) to look closer, 11 degrees.
- **The trail** (`story.ts`, `StorySites.tsx`): four stones of the Makers, each
  pointing to the next: the Phobos monolith, a raft of cells on Titan's methane
  sea, frost fans at Enceladus's tiger stripes (`EnceladusGeysers.tsx`), and the
  Makers' seed ship on Iapetus's ridge; their messages decode as glyphs are
  learned (Story tab, J). Also Jupiter's floaters in the water clouds
  (`JupiterFloaters.tsx`, after Sagan and Salpeter 1976), the cracked ridge on Europa,
  and a dead satellite in its debris cloud in low Earth orbit (`OrbitDebris.tsx`,
  solid fragments on a 100-minute orbit).
- **Expeditions** added: the monolith on Phobos, Kessler (Earth-orbit debris),
  Through the plume (Enceladus), The seed ship (Iapetus). Twelve in all.
- New Higgsfield models are listed in `public/models/expedition/ATTRIBUTION.md`.

## The Expedition — state on 2026-10-03

This section supersedes every older statement about Free Flight, the
`Choose your journey` gateway and the ignition locator: all three are gone.
**Begin expedition** on the home page now starts the Expedition directly
(`components/ExpeditionLaunch.tsx`: warp, loading screen with real progress,
hand-over). The home page itself (orbit view, galaxy, TON 618, the assistant)
is unchanged apart from a centred overview of the whole Solar System.

### What it is

A third-person game in `components/expedition/` (about 90 files, loaded as a
separate bundle). The player starts landed on Earth near Dallas with a ship.

- **Solar System**: Sun at the origin; planets at their positions for
  2026-09-30 from JPL elements (`orbits.ts`), true relative sizes (Earth's radius
  is 12 km of game units), distances scaled (1 AU = 68,000,000 units), real
  surface gravity everywhere (`bodies.ts`). Moons: the Moon, Phobos, Deimos, Io,
  Europa, Ganymede, Callisto, Mimas, Enceladus, Tethys, Dione, Rhea, Titan,
  Iapetus, Miranda, Ariel, Umbriel, Titania, Oberon, Triton, and Pluto with
  Charon; small moons are enlarged so they can be walked (since 2026-10-29
  every moon is at its real distance in planet radii). `docs/WORLDS.md` records what is real for each world.
- **Surfaces**: `PlanetTerrain.tsx` + `terrain.ts` (procedural relief per biome
  kind, triplanar ground and cliff pictures). Earth uses real data (`earth.ts`:
  coast distance, elevation, bathymetry and tree cover from Blue Marble and
  GEBCO), the moons and Pluto their USGS maps (`public/textures/expedition/moons`).
- **Giants**: `GasGiant.tsx` (Cassini/Juno maps, Saturn's rings with
  `RingParticles.tsx` ice pieces up close, the north hexagon and south decagon,
  an infrared view) and `GasDepths.tsx` + `gasAtmosphere.ts` + `cloudVolume.ts`
  (flying down through the cloud decks: pressure, heat, lightning, no floor).
- **Deep space**: wormhole near Saturn (`Wormhole.tsx`, a thin-throat metric
  traced per pixel, crossed seamlessly) to TON 618 (`BlackHole.tsx`, a
  per-pixel geodesic tracer; falling in is `fall.ts`).
- **Play**: chapters with medals (`quests.ts`), challenge trades
  (`challenges.ts`), data sites with the glyph script (`DataSites.tsx`,
  `glyphs.ts`), vaults (`vaults.ts`), survival and crafting (`survival.ts`,
  `CraftPanel.tsx`), animals (`Wildlife.tsx`, `creatures.ts`: models rigged and
  walked in the vertex shader at load), fishing, aliens (`Aliens.tsx`,
  `AlienModels.tsx`), the radio (`radio.ts`), weather with storm warnings and
  shelters (`weather.ts`, `Weather.tsx`, `Shelters.tsx`), hazards (`hazards.ts`:
  asteroid fields, the Sun's heat), sound (`audio.ts`).

### Rules that came out of building it

- Never add rendering cost without a measured frame-time comparison against the
  previous version at identical views, plus screenshots side by side. A batch of
  shadow maps and picture-card grass was reverted on 2026-10-02 because it made
  the game slower and flatter on the owner's PC.
- Shader portability: no `pow()` of a possibly negative base (NaN on Direct3D,
  spread into black blocks by the bloom); `PostEffects.tsx` sanitises the HDR
  frame anyway. Avoid GLSL ES 3 reserved words as names (`flat`, `sample`,
  `input`, `output`, `filter`, `smooth`, `common`, ...).
- Ribbons drawn as screen-facing quads must be wound counter-clockwise on
  screen (`bolts.ts`): the clockwise order culled every lightning quad, and no
  bolt was drawn from 2026-10-02 to 2026-10-03.
- The explorer model (`astronaut.glb`) is the owner's choice: add motions to it,
  never replace it.
- The interface is the site's liquid glass, in sentence case, with no fake
  telemetry, status dots or pseudo-terminal text.

### Developing and testing

- `npm run dev`, then the home page's **Begin expedition**. In development the
  game exposes `window.__expedition` (the runtime, the bodies, `beginFall`,
  `forceWeather`; `runtime.actions.place` puts the ship anywhere) and a few test switches (`window.__strike`,
  `window.__strikeAhead`, `window.__weatherHold`, `window.__boltHold`).
- Hosts that only serve a page's own files (no `data:`, no WebAssembly) need the
  models packed as base64 JSON: build with `VITE_MODEL_PACKING=json` (see
  `components/expedition/models.ts`).

## Birthday star systems made stable — 2026-09-28

This section supersedes older statements about how the distant (rogue) systems are counted and placed.

- The author's age now comes from `getAuthorAge()` in `data.ts`, which reads the same
  local-time clock as Galactic Years (`utils/galacticTime.ts`). Previously the birthday
  was parsed as UTC, so in Texas the star count went up on the evening of 14 September,
  a day before Galactic Years did.
- `getStarSystemTypes(age)` replays the author's life one birthday at a time. Every
  birthday adds exactly one star, so the total always equals the age. Every eighth
  birthday the new star becomes the companion of an existing single star (a binary);
  when that system is fated to be a trinary, the next birthday's star completes it.
  Slot 1 is still Neutron Star J1748 and never takes a companion. At age 26 the mix is
  unchanged: 18 single, 1 binary, 2 trinary (21 systems).
- Each system slot keeps one orbit forever (radius from a golden-ratio sequence that
  skips the Solar System's band, plus a seeded phase, speed, tilt and height), so a
  birthday adds a system without moving or re-typing the others. Before, the shuffle
  and the band size both depended on the total count, so every birthday rearranged
  the whole set, and the orbits were re-rolled with `Math.random()` on every load.
- `RogueSystems` re-reads the age every minute, so a tab left open across local
  midnight on 15 September gains the new star without a reload.
- Each Galactic Year's newborn system (the `STELLAR IGNITION DETECTED` one) is now
  seeded by its year: same place, colour, star count and planets on every visit.
- The ignition locator no longer covers the assistant button (desktop) or the
  CHOOSE YOUR JOURNEY button (phones, portrait and landscape).

## Repository housekeeping — 2026-09-28

- The project is now under Git on GitHub (`deekshitvegi/deekshitthvegiportfolio`,
  branch `main`). Older statements below that there is "no Git metadata" are historical.
- `README.md` was rewritten from the current code (the AI Studio template is gone).
- Removed at the owner's request, recoverable from commit `36fdff1`:
  `temp_model/` (corrupt copy), `migrated_prompt_history/` (AI Studio chat logs),
  `download.cjs`, `findzip.cjs`, `app/applet/` (one-off download scripts), `test.png`
  (empty), `components/Radar.tsx` (imported but never rendered), the four extracted
  `releases/verify-*` folders and the seven superseded Hostinger zips. The last
  packaged release, `releases/galactic-portfolio-hostinger-2026-08-10-inspection-return-portable-v4.zip`,
  was kept.
- `.gitignore` now also ignores `.env` and `.env.*` (except `.env.example`) so an API
  key cannot be committed, and keeps the removed leftovers from being re-added.

## Latest formation, naming, and flight-immersion pass — 2026-08-11

This section supersedes older young-system and black-hole-fall status below when they conflict.

### Implemented

- Newly formed systems now use the established distant-system visual size family (`25000 × visual class × 1.1 × UNIVERSE_SCALE`) and the same `1.5–3.5` visual-class range instead of the oversized `13200 × UNIVERSE_SCALE` group multiplier. This is visual-only: mass, gravity, orbital radii, and movement physics were not changed.
- The Galactic Years lifecycle is now explicit and implemented in `getYoungSystemFormationState`:
  - `spawnYear + 0.000` to `+0.100`: gas collapse and stellar ignition;
  - a particle burst, expanding translucent shock shell, light flash, and bright core peak around `+0.100`;
  - `+0.100` to `+0.500`: planets appear sequentially and settle from wide capture paths into final orbits;
  - `+0.500`: the system is complete.
- Fast-forward still controls the scientific stage, but a minimum 12-second presentation clock keeps the event from being visually crushed into a one-frame flash.
- A restrained, clickable `STELLAR IGNITION DETECTED` locator appears when the system spawns. It displays the current designation and navigates to the birth terminal.
- Young-system names now come from real confirmed planetary-system host names in the NASA Exoplanet Archive:
  - the browser reads same-origin `/api/recent-systems.php` once per day and caches successful data in local storage;
  - `public/api/recent-systems.php` queries the official TAP `pscomppars` table and caches the response for six hours on PHP-capable Hostinger hosting;
  - `vite.config.ts` provides the same endpoint during local dev/preview;
  - bundled real 2026 host names remain as a static fallback when PHP or NASA is unavailable.
- The naming is scientifically honest: these are real recently catalogued host-system designations applied to the portfolio's simulated formation event. The site does not claim that NASA observed a star forming during the user's session.
- Free Flight now has lightweight cockpit canopy struts, lower dashboard framing, a central attitude marker on touch devices, and speed-reactive peripheral motion streaks. Reduced-motion users do not receive the streak animation.
- The cockpit stacking layer now sits above the mobile look surface, fixing the prior mobile bug where flashlight, settings, comms, and disengage looked visible but the full-screen look layer intercepted their taps. Coarse-pointer tablets through 1100 px use touch controls.
- The failed-capture shader now uses an 18.5-second eased camera path, almost two close orbital sweeps, stronger directional Doppler beaming, star smearing, multiple lensed disk images, a later/smoother horizon fill, and cockpit framing. It remains a lightweight physically informed cinematic rather than a full general-relativity ray tracer.

### Files added or modified in this pass

- Added `utils/recentStarSystems.ts`.
- Added `public/api/recent-systems.php`.
- Modified `vite.config.ts`.
- Modified `components/Scene.tsx`.
- Modified `components/CosmicPhenomena.tsx`.
- Modified `components/BlackHoleFlightExperience.tsx`.
- Modified `App.tsx`.
- Modified `index.css`.
- Modified `HANDOFF.md`.

### Validation on 2026-08-11

- `npx.cmd tsc --noEmit --pretty false` — passed with no diagnostics.
- `npm.cmd run build` — passed; Vite 6.4.3 transformed 2,275 modules. Current assets are `dist/assets/index-DTR0_kJQ.css` (212.50 kB, 36.44 kB gzip) and `dist/assets/index-CvUu6DVb.js` (1,520.46 kB, 431.12 kB gzip).
- `curl http://127.0.0.1:4173/api/recent-systems.php` — HTTP 200, source `NASA Exoplanet Archive PSCompPars`, 64 deduplicated recent hosts; first results included `TOI-791`, `TOI-707`, and `TOI-4427`.
- Live app hard-reloaded at `http://127.0.0.1:4173/`; no browser console errors.
- Live fast-forward reached `26.003`; the locator rendered `STELLAR IGNITION DETECTED · GY 26.000` with real name `Gaia23braL`, navigated to the in-scene system, and exposed its terminal action.
- A later endpoint refresh selected `TOI-791`, confirming the app does not depend on the fallback list.
- The development-only `?blackHoleFallTest=1` path rendered the actual realtime capture shader at inbound-trajectory and horizon-approach stages, completed after 18.5 seconds, and produced no WebGL shader compile/link error or browser error entry. Context-lost log entries in the accumulated dev log corresponded to intentional HMR/navigation canvas disposal.
- Free Flight was launched through the real gateway; the cockpit, canopy frame, manual-control prompt, flight HUD, portfolio markers, and exit control all rendered together.
- The current browser task's viewport could not be resized through the available browser binding, so this pass did not repeat the prior full phone/tablet viewport matrix. The CSS changes retain 44 px cockpit targets and include explicit mobile/reduced-motion rules; re-run the matrix before packaging.

### Important limitations

- Static hosting without PHP cannot perform the live NASA refresh. It will safely use the bundled/cache list. The user's stated Hostinger target normally supports PHP, but the real server environment still needs confirmation.
- NASA Exoplanet Archive updates describe confirmed exoplanet host systems, not newly born stars. This is the closest authoritative live naming source that supports the requested post-deployment updates.
- The formation spawn/locator and full 18.5-second black-hole fall were live-rendered. The entire 12-second formation event and both experiences should still be video-recorded on representative desktop and phone hardware for final visual acceptance.

## Latest authoritative launch state — 2026-08-10

This section supersedes every older status statement below when they conflict.

### Current public product scope

- The deployable portfolio exposes the established orbit experience and **Free Flight only**. Historical game and Cosmic Lab source files remain available for future work, but Vite builds only `index.html` and the public gateway contains no game/lab entry.
- The approved portfolio mapping remains:
  - Mercury — Education
  - Venus — Experience
  - Earth — Projects
  - Mars — Skills
  - Jupiter — Research
  - Saturn — Beyond the Code
  - Uranus — Freelance Work
  - Neptune — Certifications
- The established galaxy, planets, navigation, black-hole shader, orbital behavior, Free Flight physics, and content organization were preserved during this launch pass.
- Hostinger upload remains a user-owned external step. The user explicitly said they will upload the package themselves.

### Completed launch fixes

- Galactic Years remains wall-clock anchored and evaluates to exactly `26.000` at local midnight on 2026-09-15.
- The landing fast-forward control is now a true press-and-hold control:
  - pointer, touch, Space, or Enter press accelerates Galactic Years only while held;
  - release, pointer cancellation, lost pointer capture, or focus loss stops acceleration;
  - the accumulated value remains visible for the rest of the current page session instead of snapping backward;
  - a reload/new page session clears that session offset and resynchronizes to the wall-clock-only value;
  - focusing a body, leaving orbit, or unmounting the HUD stops acceleration without discarding the accumulated session value.
- The Free Flight gateway now moves keyboard focus to its close button, traps Tab/Shift+Tab inside the modal, closes with Escape, and restores focus to the visible `CHOOSE YOUR JOURNEY` trigger.
- The redundant `Choose your journey` kicker above the Free Flight gateway title was removed at the user's request.
- Inspecting a planet, star, rogue system, young system, or black hole from Free Flight no longer ends the exploration session:
  - opening the terminal releases manual controls but retains `viewMode='spaceship'` and `launchState='flying'`;
  - closing the terminal exposes `RETURN TO FLIGHT`, not the misleading `RETURN TO ORBIT` label;
  - returning clears only the focused object and presents the manual-control prompt, while the ship session remains active;
  - collision, wormhole, arcade, black-hole-pull, and translation interactions are suspended while the inspection target is open.
- The public portfolio assistant no longer exposes a missing-key configuration failure:
  - without `VITE_GEMINI_API_KEY`, it answers and navigates using the verified data already present in `data.ts`;
  - it covers the eight portfolio sections, Deekshitth's biography/contact summary, binary/trinary systems, pulsar availability, wormholes, and TON 618 navigation;
  - with a key, the Google GenAI library is loaded only on demand;
  - if a live request fails, the same verified local guide provides the recovery answer;
  - the chat region, message log, input, close/send/toggle controls, and suggestion controls now have accessible labels/focus behavior and at least 44 px touch targets.
- `public/videos/launch.mp4` does not exist. Free Flight now starts the existing procedural launch animation directly instead of making a guaranteed failed video request before falling back.
- Core liquid controls now use a 44 px minimum target; the floating assistant control retains its intended 56 px target. The 390 px phone and short-landscape layouts still have no horizontal overflow.
- The public Free Flight flow now uses the approved restrained, clear liquid-glass language throughout instead of the rejected neon/AI-generated color wash:
  - the gateway shell, Free Flight card, close control, and entry action use real SVG-refraction lenses with neutral low-opacity fallbacks;
  - launch/countdown cards, cockpit telemetry, the manual-control panel, settings, status/toast panels, encounter telemetry, and the in-flight assistant use the same lens system;
  - the manual-control state no longer blurs the entire space scene, so planets, stars, and the galaxy remain crisp outside the glass surface;
  - no navigation, planet texture, galaxy geometry, Galactic Years target, orbital physics, or Free Flight physics changed in this visual pass.
- `public/THIRD_PARTY_NOTICES.md` was added so the deployable output carries the MIT notice already preserved in `docs/THIRD_PARTY_NOTICES.md`. Existing NASA attribution files remain in the archive.

### Current validation evidence

Run from the exact repository root:

~~~powershell
Set-Location -LiteralPath 'C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio'
~~~

Validation completed on 2026-08-10:

- `npx.cmd tsc --noEmit --pretty false` — passed with no diagnostics.
- `npm.cmd run build` — passed with Vite 6.4.3; 2,274 modules transformed.
- Current production assets:
  - `dist/assets/index-BWWtTgQT.css` — 206.91 kB, 35.10 kB gzip.
  - `dist/assets/index-_Y7DKjdB.js` — 1,513.19 kB, 428.72 kB gzip.
- Galactic clock boundary check:
  - 2026-09-15 00:00:00 local — exactly `26`.
  - one millisecond before — `25.99999999996829`.
  - one millisecond after — `26.00000000003171`.
- Live fast-forward QA at `http://127.0.0.1:4173/`:
  - desktop hold advanced from `25.902` to `26.272`; release removed the active/pressed state and the counter remained `26.272` after 1.8 seconds;
  - reloading restored the wall-clock-only `25.902` baseline;
  - Space press/release exercised the keyboard path and left the control idle rather than latched;
  - at 390 × 844, the control measured 44 × 44 px; a held pointer gesture advanced from `25.902` to `26.200`, then remained at `26.200` after two seconds;
  - the page logged no browser warnings or errors during the interaction checks.
- Controlled clock-state verification confirmed that a 100 ms 5000x hold added `0.0397887389` Galactic Years, release and a further two seconds retained the offset (apart from real wall-clock progression), reload matched wall time, and the 2026-09-15 boundary remained exactly `26`.
- Gateway keyboard QA:
  - initial focus landed on `Close experience selector`;
  - Shift+Tab wrapped to `Enter free flight`;
  - Tab wrapped back to close;
  - Escape closed the dialog and restored focus to `CHOOSE YOUR JOURNEY`.
- Assistant QA without a key returned verified Neptune certification data and Uranus freelance-site data, navigated to the correct planets, and logged no configuration error.
- Production preview QA at `http://127.0.0.1:4174/` verified the launch page, assistant fallback, gateway focus, direct procedural Free Flight launch, manual-control screen, zero horizontal overflow, no `launch.mp4` element/request path, and no browser warnings/errors.
- Responsive QA verified:
  - 390 × 844 launch: 390 px document/body width and zero overflow;
  - 390 × 844 gateway: visible 44 px close and Free Flight controls;
  - 390 × 844 assistant: 16 px input text, 44 px chat controls/chips, 56 px floating toggle, and zero page overflow;
  - 844 × 390 launch: visible CTA, assistant, Galactic Years, and zero horizontal overflow.
- The latest liquid-glass pass was visually checked in the live app at `http://127.0.0.1:4173/` on desktop, 390 × 844 portrait, and 844 × 390 landscape. The gateway remained transparent over the solar system, the countdown and cockpit panels reported active refraction lenses, there was no page overflow, and short-landscape flight controls remained at least 44 px.
- The exact current archive was extracted and served at `http://127.0.0.1:4176/`. Its launch, gateway, and Free Flight cockpit rendered successfully; both detected cockpit glass panels reported ready lens state. In the extracted package, a 700 ms pointer hold advanced Galactic Years from `25.902` to `25.906`, and the value was still `25.906` after release plus a 1.3 second wait.
- Live inspection-return QA at `http://127.0.0.1:4173/` entered Free Flight, opened the Sun terminal from the flight canvas, closed it, verified that only `RETURN TO FLIGHT` appeared, and used it. `DISENGAGE SYSTEM` and the manual-control prompt remained present afterward, while the landing `CHOOSE YOUR JOURNEY` control did not return.
- The current v4 archive was extracted and served at `http://127.0.0.1:4177/`; its launch and gateway loaded successfully, the removed kicker was absent, and `Enter free flight` remained available.

### Final Hostinger upload artifact

Use this archive, not any earlier package:

~~~text
C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio\releases\galactic-portfolio-hostinger-2026-08-10-inspection-return-portable-v4.zip
~~~

Verified properties:

- Size: 4,965,912 bytes.
- SHA-256: `28360F9F40FDB85E6C35FDAD9A784C668E73ED7925FB348FB62ECCD37B583D0B`.
- `index.html`, `.htaccess`, and `THIRD_PARTY_NOTICES.md` are directly at archive root.
- The archive contains 15 deployable files plus directory entries; asset paths use portable `/` separators.
- `assets/`, `models/`, `textures/`, NASA attribution files, the black-hole derivative model, and all six NASA planet textures are present.

Upload/extract the contents into Hostinger `public_html` so `index.html` is directly inside `public_html`, then remove the ZIP from the server and test the real HTTPS domain. No credential or Hostinger access is required from Codex for the local project to be considered complete.

### Files changed in the final launch pass

- `components/HUD.tsx` — pointer/touch/keyboard press-and-hold fast-forward behavior, release/cancel/blur cleanup, accessible state, and focus-return markers on launch buttons.
- `utils/galacticTime.ts` — wall-clock synchronization, retained page-session fast-forward offset, reload resynchronization, and exact anniversary calculation used by the verified counter.
- `components/Chatbot.tsx` — verified local fallback, lazy optional live-AI import, navigation responses, labels, focus, touch accessibility, and actual refraction-lens glass for both orbit and in-flight chat surfaces.
- `components/BlackHoleFlightExperience.tsx` — encounter telemetry now uses the shared clear refraction-lens surface; encounter behavior and physics are unchanged.
- `components/ExperienceGateway.tsx` — modal focus management, keyboard trap, and removal of the redundant gateway kicker.
- `App.tsx` — direct procedural launch, gateway focus restoration, shared lens-backed Free Flight panels, and inspection-state continuity that returns focused objects to the active flight session.
- `components/Scene.tsx` — suspends active flight hazards and black-hole interaction while a Free Flight object terminal is being inspected; orbital/exploration physics are otherwise unchanged.
- `index.css` — active fast-forward styling, final control/touch-target hardening, restrained neutral gateway treatment, and responsive clear-glass Free Flight styling without full-scene blur.
- `public/THIRD_PARTY_NOTICES.md` — deployable MIT notice.
- `AGENTS.md` — durable clock, assistant, launch, and notice guidance.
- `HANDOFF.md` — this authoritative launch state.

No product source file was deleted. The old standalone game/lab files remain intentionally disconnected from the public build and gateway.

## Latest authoritative launch state — 2026-08-06

This section supersedes any older task-status or product-direction statement below when the two conflict. Older sections remain as implementation history and reference material.

### Current user-approved public scope

- The portfolio gateway exposes **Free Flight only**. Do not reconnect Rift Runner, ECHO // 26, Black Hole Heist, or Cosmic Lab to the public gateway unless the user explicitly revives one of them.
- Preserve the current website UI, navigation, Galactic Years behavior, planet textures, orbital/exploration physics, black-hole shader, and approved planet-content organization.
- The approved content architecture is:
  - Mars — Skills
  - Saturn — Beyond the Code
  - Uranus — Freelance Work
  - Neptune — Certifications
- Pluto was discussed but deliberately not added.
- `docs/PLANET_CONTENT_MAP.md` is the current detailed content map.

### Verified current implementation

- `data.ts` contains the approved Saturn personal-content moons, five Uranus freelance-client moons, and five Neptune credential moons.
- Uranus uses a dedicated smooth, low-contrast cyan/blue-green procedural surface style.
- Live freelance sites use `Visit Live Website`; credentials use `Verify Credential`; pre-launch client work remains unlinked.
- The public Experience Gateway contains one card and one action: **Free Flight / Enter free flight**.
- The project still builds as the single public `index.html` entry. Standalone historical game files may remain in the repository, but they are not part of the public gateway or production entry.

### Current validation evidence

Run from:

~~~powershell
Set-Location -LiteralPath 'C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio'
~~~

Results on 2026-08-06:

- `npx.cmd tsc --noEmit --pretty false` — passed with no diagnostics.
- `npm.cmd run build` — passed with Vite 6.4.3; 2,274 modules transformed.
- Production assets:
  - `dist/assets/index-BWO_S2gG.css` — 201.59 kB
  - `dist/assets/index-Cd13s6B0.js` — 1,563.93 kB, 444.74 kB gzip
- Browser QA at `http://127.0.0.1:4173/`:
  - launch view rendered correctly;
  - the gateway showed only Free Flight;
  - Free Flight reached the manual-control screen;
  - Saturn, Uranus, and Neptune displayed the approved labels;
  - no browser console warnings or errors were recorded.
- Earlier same-day browser QA also verified Saturn’s four personal moons, Uranus’s five freelance moons and revised surface, Neptune’s five credential moons, credential/live-site labels, desktop behavior, 390 px phone behavior, 844 × 390 landscape behavior, and no horizontal overflow.

### Hostinger-ready artifact

Use the newest archive:

~~~text
C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio\releases\galactic-portfolio-hostinger-2026-08-06-portable-v2.zip
~~~

Verified properties:

- 4,979,746 bytes
- 14 entries
- `index.html` is at archive root
- `assets/`, `models/`, and `textures/` are present
- all ZIP entry paths use `/`, with no Windows backslashes
- `.htaccess` contains guarded SPA fallback, compression, immutable hashed CSS/JS caching, media caching, no-cache HTML, directory-index protection, and conservative security headers
- SHA-256: `E7B52C8422154469433B7545AD4A431A3D786214481A5347C4C74C4E6E7B9E58`

The exact archive contents were also extracted to an isolated temporary directory and served at `http://127.0.0.1:4175/`:

- root `index.html` returned HTTP 200;
- desktop launch and the Free Flight-only gateway rendered without console warnings/errors;
- desktop Free Flight reached its manual-control screen;
- at 390 × 844, launch, gateway, and mobile Free Flight had a 390 px document/body width with no horizontal overflow;
- the mobile gateway action was visible, and the flight view exposed velocity plus touch movement, fire, boost, and tilt controls.

`public/.htaccess` is the source for these Hostinger/Apache rules; `dist/.htaccess` is generated output.

### Remaining external step

The local site and upload archive are ready. Hostinger deployment itself is not complete because `https://hpanel.hostinger.com/` currently opens at the login screen in the available browser session. The user must sign in before Codex can upload the archive and validate the real domain. Do not request, inspect, or store the user’s password.

After the user signs in and explicitly resumes deployment:

1. Open the intended website’s File Manager.
2. Back up the current `public_html` contents if the site is already live.
3. Upload the **portable-v2** archive to `public_html`.
4. Extract it so `index.html` is directly inside `public_html`, not inside a nested folder.
5. Remove the uploaded ZIP after successful extraction.
6. Open the real HTTPS domain and verify the launch view, planet navigation, Free Flight, assets, mobile layout, and browser console/network errors.

### Higgsfield MCP request

Tool discovery on 2026-08-06 found no connected Higgsfield MCP namespace or callable Higgsfield tools. No media was generated. This is an environment-availability result, not an application defect.

This is the root, self-contained handoff for a fresh Codex session. It consolidates the useful content in docs/CODEX_HANDOFF.md with the full product history available in the prior session. The narrower docs/CODEX_HANDOFF.md was intentionally preserved.

## Status-label convention

- **[Verified current]** Directly checked in the repository or environment on 2026-07-15.
- **[Verified historical]** Recorded as successfully checked in the preceding session, but not rerun during this handoff-only turn.
- **[User requirement]** Explicitly requested by the user; it is not necessarily implemented or accepted.
- **[Unverified]** Plausible or reported, but not established by a current end-to-end check.
- **[Assumption]** A design interpretation that should be confirmed if it affects behavior.

Do not convert an unverified or historical claim into a current “done” claim without checking it.

## Current game direction — Black Hole Heist (2026-07-30)

**[User decision]** Pause the Universe-Sandbox-style expansion of Cosmic Lab. Rift Runner was rejected and removed from the intended gateway direction. ECHO // 26 was also rejected after its standalone prototype was completed. The user asked to try a different game; the active replacement is **Black Hole Heist**.

**[Verified current]** Black Hole Heist is implemented as a new isolated Vite entry:

~~~text
http://127.0.0.1:4173/heist.html
~~~

It is a short-form third-person orbital salvage roguelite around TON 618. The player steals moving quantum cores, builds a close-orbit score multiplier, survives debris and gravity pulses, and chooses between a safe extraction and risking bonus cargo. It is intentionally faster and more replayable than ECHO // 26.

**[Verified current implementation]**

- Stylized Newtonian gravity flight with a safe tangential launch orbit, brake-driven orbital tightening, boost energy/heat, hull damage, capture, destruction, and timeout outcomes.
- Moving normal and high-value deep-orbit cores; randomized seeded layouts; four rotating contract templates with different goals, timers, debris density, pulse timing, gravity, and payout multipliers.
- Optional bonus cargo after the extraction gate powers up, a close-orbit tidal multiplier, score grades, salvage payouts, best score/time, extraction record, and persistent run count.
- Three permanent upgrade trees: vector drive, tidal shield, and core magnet, each with four levels and escalating credit costs.
- Instanced orbital debris, expanding pulse VFX, procedural ship geometry, engine trails, camera response, impact feedback, a gate direction/distance locator, and the existing procedural `InterstellarBlackHoleVisuals` renderer.
- Desktop controls (WASD, drag, arrows, Q/E, Shift, Space), touch joystick/boost/brake controls, pause, guide, mute, reduced-motion behavior, and responsive hangar/result UI.
- Procedural WebAudio only; no downloaded game assets and no new GLB/GLTF dependency.
- Development-only completion/damage/reset controls are guarded by `import.meta.env.DEV && ?qa=1`; their labels are absent from the production JavaScript.
- The game remains standalone and is not connected to Choose Your Journey. No portfolio UI, navigation, galaxy, planet, Galactic Years, Free Flight, Cosmic Lab, or black-hole encounter physics file was changed for this game.

**[Verified current validation]**

- `npx.cmd tsc --noEmit --pretty false` passed after the final physics and responsive changes.
- `npm.cmd run build` passed with Vite 6.4.3 and 2308 modules.
- Production output includes `dist/heist.html`, a roughly 39.6 kB game entry (12.6 kB gzip), and roughly 25.3 kB stylesheet (5.9 kB gzip), plus shared Three/React code.
- Development QA verified hangar, guide, launch, core collection, gate-ready state, gate locator, damage, extraction, failure, payout, upgrade purchase, pause, abandon, and repeat-contract flows.
- A production hands-off flight remained alive after 18 seconds once passive space drag was removed; the launch is now a safe tangential orbit instead of a six-second automatic plunge.
- Exact 390 × 844 checks verified the scrollable hangar, visible launch controls, full guide, live HUD, joystick, brake, boost, objective, and pause control.
- Production preview at `http://127.0.0.1:4174/heist.html` loaded without QA controls and with no console warnings/errors.
- Production bundle scans found no development control strings, Google Fonts request, GLB, or GLTF reference in the heist entry.

**[Files created or modified for Black Hole Heist]**

- `heist.html` — standalone HTML entry.
- `heist.tsx` — standalone React entry.
- `components/BlackHoleHeistGame.tsx` — flight simulation, procedural world, contracts, progression, audio, QA harness, and UI.
- `components/BlackHoleHeistGame.css` — standalone responsive HUD, hangar, guide, touch controls, and result styling.
- `docs/BLACK_HOLE_HEIST_DESIGN.md` — product loop, controls, replay systems, technical boundaries, and acceptance checks.
- `vite.config.ts` — added the `heist.html` multi-page entry; existing main and ECHO entries remain.

**[Remaining product gate]** Ask the user to play `/heist.html`. If accepted, replace the rejected game card in `components/ExperienceGateway.tsx` with a link to `/heist.html` in a separate, narrow change. Until then, do not wire it into the portfolio or remove the older standalone ECHO files.

## Previous rejected game direction — ECHO // 26 (historical)

**[User decision]** Pause the Universe-Sandbox-style expansion of Cosmic Lab. The user rejected Rift Runner and asked for a completely different game. Do not resume Cosmic Lab or restore Rift Runner unless explicitly requested.

**[Verified current]** A new isolated game, **ECHO // 26**, is implemented at:

~~~text
http://127.0.0.1:4173/echo26.html
~~~

It is an original first-person, zero-gravity, eight-minute time-loop mystery aboard a station orbiting TON 618. The main mechanic is cooperating with the recorded movement and actions of the previous loop to power an archive relay while the current player enters a persistent four-symbol code. It is not an endless runner, wave shooter, or Universe Sandbox clone.

**[Important product decision]** ECHO // 26 is deliberately not connected to Choose Your Journey yet. The user previously reported regressions and asked that unrelated portfolio systems not be disturbed. Keep the game standalone until the user plays and accepts this direction; only then replace a gateway entry in a separate, narrowly scoped change.

**[Verified current implementation]**

- Five connected station spaces, zero-g desktop and touch flight, pointer-lock plus drag-look fallback, station collision bounds, objective beacon, eight-minute reset loop, recorded temporal echo, cooperative relay puzzle, success/failure/retry flow, procedural audio, reduced-motion support, daily anomaly variation, optional horizon observation, persistence, best metrics, archives, and streaks.
- Six anomaly-specific mastery protocols now create meaningful run variation: observation, time trial, observation-plus-time, error-free relay entry, exact-loop recursion, and observation-plus-exact-loop.
- Completing protocols permanently decodes six classified story signals. The archive UI exposes locked clues, recovered lore, 0/6–6/6 progress, and correct repeated-success/missed-protocol states.
- “Start new mission” now creates a clean loop-one run while preserving learned code, archives, records, transmissions, and streaks; it no longer continues an already solved loop chain.
- The main procedural `InterstellarBlackHoleVisuals` shader is reused for the vista. ECHO // 26 has no GLB/GLTF black-hole dependency.
- Mobile caps the black-hole shader at medium LOD; desktop can use the focused highest tier.
- Development-only QA controls are guarded by `import.meta.env.DEV && ?qa=1` and are absent from production output.
- Heavy game code loads from the standalone `echo26.html` Vite entry and does not increase the initial portfolio route.

**[Verified current validation]**

- `npx.cmd tsc --noEmit --pretty false` — passed.
- `npm.cmd run build` — passed with Vite 6.4.3 and 2304 modules.
- Production output includes `dist/echo26.html`, an approximately 43.4 kB game entry (13.25 kB gzip), and an approximately 21.6 kB game stylesheet (4.91 kB gzip), plus shared Three/React code.
- Desktop normal movement reached the scanner; collision testing visibly held the cryo-bay side wall.
- Development QA completed the full scanner → horizon observation → junction charge → reset → echo power → relay code → transmit route.
- Development QA completed every one of the six mastery variants from a clean save and verified the full 6/6 archive; a deliberately wrong-code run verified the negative precision result.
- Exact 390 × 844 briefing and live touch controls rendered without overflow or runtime log errors.
- Exact 390 × 844 mastery briefing, archive, and scrollable completion result were verified; all result actions remained reachable.
- Production preview at `http://127.0.0.1:4174/echo26.html` booted the real canvas with no QA controls and no console warnings/errors.
- Production preview at `http://127.0.0.1:4174/` still rendered the established portfolio canvas, Choose Your Journey, and Galactic Years, with no runtime warnings/errors.
- Bundle scan found no QA UI strings in production and no black-hole GLB/GLTF/original-source-asset reference in the ECHO // 26 bundle. The wider portfolio still intentionally contains an unrelated NASA asteroid GLB; do not misreport that as an ECHO dependency.

**[Files created or modified for ECHO // 26]**

- `echo26.html` — standalone HTML entry.
- `echo26.tsx` — standalone React entry.
- `components/Echo26Game.tsx` — world, movement, loop, echo, puzzle, UI, audio hooks, persistence, QA harness.
- `components/Echo26Game.css` — standalone responsive visual system.
- `docs/ECHO_26_DESIGN.md` — product, controls, loop, performance, and acceptance specification.
- `vite.config.ts` — multi-page Vite inputs for the portfolio and ECHO // 26.
- `components/InterstellarBlackHoleVisuals.tsx` — added optional `maxLod` prop; the portfolio default remains full LOD.

**[Historical disposition]** The user rejected this direction and asked for something different. Preserve the standalone files for rollback/reference, but do not wire ECHO // 26 into the gateway unless the user explicitly revives it.

## Critical repository identity

**[Verified current]** Work in exactly:

~~~text
C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio
~~~

The ambient Codex directory shown in the previous session was:

~~~text
C:\Users\deeks\Desktop\DV\Projects\portfolio-gem
~~~

That is a different project. Always set the working directory explicitly before reading, editing, running, or validating anything.

**[Verified current]** This repository and its parent do not contain Git metadata. Git status, historical diffs, original authorship, and a complete deletion history therefore cannot be reconstructed. Preserve files carefully and never claim a Git-backed diff.

## Original goals

### Original product goal

**[User requirement]** Continue the existing galactic portfolio without redesigning its established website UI, navigation, Galactic Years behavior, or space-exploration/orbital physics unless a later request explicitly authorizes a tightly scoped change.

The original centerpiece request was one real, interactive black-hole shader in components/InterstellarBlackHoleVisuals.tsx, already mounted from components/Scene.tsx:

- Combine crisp circular gravitational lensing and distorted background stars with turbulent orange-gold accretion flow.
- Show an opaque black event horizon.
- Resemble the cinematic visual language of the black hole in Interstellar without copying a protected asset.
- Do not use a GLB, a flat image, a billboard, a “black ball with a skirt,” concentric cartoon rings, hard yellow bars, or a blue science-fiction glow.
- Remain convincing from the front, back, top, bottom, and oblique angles.
- Use a lightweight distant representation and high detail only while focused or near.
- Inspect the live result at http://127.0.0.1:4173/ before calling it done.

### Separate first request

**[User requirement]** Before the product work, the user also asked to check whether a Higgsfield MCP server was available, list its tools, and generate nothing.

**[Unverified]** The available history does not prove that this MCP inventory was completed. It is not an application-code requirement, but it remains an unanswered request if the user still wants it.

## Complete consolidated requirement inventory

### Scope and regression guardrails

- **[User requirement]** Preserve existing website UI, navigation, Galactic Years, planet textures, and exploration/orbital physics except where the user later explicitly requested a change.
- **[User requirement]** Restrict changes to the subsystem being discussed; the user explicitly asked not to damage unrelated parts of the project while changing the galaxy or game.
- **[User requirement]** Visual size changes must not silently change masses, orbital radii, encounter radii, or simulation behavior.
- **[User requirement]** Empty-space clicks must not select TON 618; planets and other intended objects must still select themselves.
- **[User requirement]** The final site should be responsive on any device, with working desktop, mobile, and touch behavior.
- **[Technical accessibility invariant]** Preserve a usable reduced-motion path for motion-heavy experiences.

### Black-hole rendering

- **[User requirement]** Use a procedural live shader, not a GLB or flat image.
- **[User requirement]** Produce crisp, circular gravitational lensing with visibly distorted background stars.
- **[User requirement]** Use turbulent orange-gold plasma with a brighter yellow inner accretion region.
- **[User requirement]** Keep the event horizon fully opaque and visually larger than the initial version.
- **[User requirement]** Bend the disk above and below the shadow so it reads as lensed three-dimensional geometry, not a flat plane or “skirt.”
- **[User requirement]** Avoid cartoon rings, hard lines, a yellow vertical line, a blue glow, or an obvious circular sprite cutoff.
- **[User requirement]** Make all viewing angles coherent. The result must not simply flip or appear upside down from the opposite side.
- **[User requirement]** Smooth all focus, near/far, top/bottom, and orientation transitions; the user specifically rejected snapping and “jiggling.”
- **[User requirement]** Preserve a recognizable lensed silhouette from a distance rather than degrading to a black ball with a thin orange strip.
- **[User requirement]** Keep the galaxy visible and bright while TON 618 is focused.
- **[User requirement]** Use level of detail: inexpensive while distant and higher-detail only when focused or near.
- **[User requirement]** Investigate the large black-hole GLTF/GLB found in the project and the Hostinger crash, but do not replace the live shader with that asset.
- **[User requirement]** Be honest about physics. The user wants physically motivated lensing and infall, but a realtime portfolio must not be described as a full numerical general-relativity simulation.

### Black-hole interaction and Free Flight

- **[User requirement]** Make Engage Manual Control actually work.
- **[Technical interaction decision]** Support pointer-lock flight and a usable fallback when pointer lock is unavailable.
- **[User requirement]** Provide a guided black-hole approach and a powered near-horizon skim.
- **[User requirement]** Let the ship try to escape; failed attempts should lose the fight against gravity and fall inward.
- **[Product/physics decision]** Do not trigger capture until the physical event horizon is crossed.
- **[User requirement]** Add an explicit button-mashing escape challenge: the player must repeatedly press a specific control or be sucked in.
- **[Implementation/accessibility decision]** Ignore a held key or keyboard auto-repeat so the player must make distinct presses.
- **[User requirement]** Make the fall/capture sequence substantially closer to the supplied NASA video than a generic warp tunnel:
  - https://youtu.be/dGEIsnBRWGs?si=odJxWlAYTiI49AQF
  - Requested cues include extreme lensing, repeated/warped disk images, photon-ring behavior, redshift, horizon growth, orbital roll, and a convincing crossing.
- **[User requirement]** Let the player skim/travel close to the horizon and attempt to get out.
- **[Technical constraint]** A literal stationary ride on or escape from inside an event horizon would be physically misleading. The implemented interpretation is a powered skim outside it.

### Galaxy

- **[User requirement]** Make the galaxy organic, volumetric, and photographic in feel rather than a flat 2D plane.
- **[User requirement]** Use a warm yellow/cream center that transitions to pale white and blue outer arms.
- **[User requirement]** Avoid hard luminous spiral lines, mesh-like bands, a scene-wide gray haze, or solar-system washout.
- **[User requirement]** Restore at least the previous 140,000 white galaxy points, with more if necessary.
- **[User requirement]** Even out density and brightness on all sides; eliminate the visibly light or empty quadrant.
- **[User requirement]** Soften the outer edge so it does not resemble a circle drawn with a hard line.
- **[User requirement]** Add only a small amount of subtle space dust.
- **[User requirement]** Preserve the galaxy’s apparent rotation/spiral sense. The user noted that the galaxy read as anticlockwise while a modified fast-forward icon spun clockwise.
- **[User requirement]** Do not dim the galaxy when viewing the black hole.
- **[User requirement]** Do not let the galaxy layer wash out the solar system or hide planet textures.
- **[Product truth]** The galaxy is a procedural visual particle field. It is not a 168,000-body gravitational simulation, and should not be presented as one.

### Stars, planets, and systems

- **[User requirement]** Show star formation beautifully and make the forming location easy to find.
- **[User requirement]** Do not use the rejected young-system visual made from large opaque blue cones and a cartoon gold ring.
- **[User requirement]** Prefer a compact collapsing cloud, a thin accretion disk, restrained translucent jets, and subtle partial arcs.
- **[User requirement]** Increase rogue/new star-system visuals by 10 percent without changing their physics.
- **[User requirement]** Always show the parent star for generated systems, specifically CYGNUS-2097.
- **[User requirement]** Correct depth and occlusion: a Sun, star, or black hole that is behind Earth must not render in front of it.
- **[User requirement]** Sun and other stellar cores must not be transparent or see-through.
- **[User requirement]** Preserve all established planet textures/materials.
- **[User requirement]** Make Saturn’s rings larger and use a physically plausible orientation.
- **[User requirement]** Preserve the earlier solar-system appearance rather than letting the galaxy create a gray mesh/haze over it.

### Interface and visual design

- **[User requirement]** Keep the established navigation and portfolio layout.
- **[User requirement]** Apply clearer, more transparent liquid glass to Choose Your Journey, its gateway shell, cards, controls, and the landing CTA.
- **[User requirement]** Keep glass readable and interactive; transparency must not break contrast, layout, callbacks, or responsive behavior.
- **[User requirement]** Restore the original fast-forward button appearance/orientation and preserve its handlers.
- **[User requirement]** Galactic Years must follow wall-clock time even if the site remains open continuously and must display exactly 26 at local midnight on September 15, 2026.
- **[Latest user requirement]** Fast-forward must work only while pressed/held. Releasing it stops acceleration but preserves the advanced number for the current page session; a reload resynchronizes to wall-clock time.

### Experiences and games

- **[User requirement]** The user disliked the earlier Nova Run and Gravity Sling concepts.
- **[User requirement]** The gateway should expose Rift Runner 3D, Free Flight, and Cosmic Lab 3D.
- **[User requirement]** Rift Runner must be genuinely 3D, animated, VFX-rich, exciting, replayable, and less repetitive, with good UI and responsive controls.
- **[User requirement]** The user wants a reason to return: varied runs, escalating challenges, satisfying feedback, and eventually progression/unlocks rather than only one repeated loop.
- **[User requirement]** Free/licensed online assets may be considered, but licenses and attributions must be preserved.
- **[User requirement]** Cosmic Lab 3D should move toward the exploratory depth of Universe Sandbox while remaining an original implementation; do not copy its brand, UI, assets, or code.
- **[User requirement]** Cosmic Lab should support real interactive 3D gravity, body creation, collisions, trails, time controls, and useful editing/analysis.

### Deployment and acceptance

- **[User requirement]** The site must not crash when deployed to Hostinger.
- **[User requirement]** Keep large source/reference assets out of the production loading path.
- **[User requirement]** Inspect the actual page at http://127.0.0.1:4173/ before claiming any visual or interaction is finished.
- **[User requirement]** Validate the relevant desktop and mobile flows, not just compilation.

## Work completed so far

### Black-hole shader and level of detail

**[Verified current by source inspection in the preceding audit]**

- components/InterstellarBlackHoleVisuals.tsx contains the live black-hole shader; the active portfolio does not use the source GLTF as its renderer.
- It has focused/high-detail and distant/lower-cost behavior.
- The visible opaque shadow constant was increased from 0.275 to 0.305, approximately 11 percent, while the physical encounter radius was left unchanged.
- The rendering path includes an opaque shadow, animated orange-gold accretion flow, lensed disk folds, and a lensed surrounding star treatment.

**[Unverified acceptance]** The user liked a later close-up, but repeatedly identified angle, distance, smoothness, and realism problems in earlier versions. The final current shader has not been re-approved by the user across all camera angles and devices.

### Galaxy

**[Verified current by source inspection in the preceding audit]**

- components/Scene.tsx no longer uses the rejected flat PlaneGeometry galaxy surface.
- High-quality mode creates 168,000 visible galaxy points:
  - 106,000 disk/arm points
  - 28,000 filler points
  - 30,000 bulge points
  - 4,000 halo points
- The separate 80,000-point general universe star field remains.
- A restrained 12,000-point dust layer is present.
- Sampling uses broader 3D spread, stochastic tails, jitter, balanced arm energy, and a softened/nonuniform edge rather than one hard circular cutoff.
- Decorative galaxy point objects have no-op raycasts, preventing background clicks from bubbling into TON 618 selection.
- The main galaxy remains at full opacity while TON 618 is focused.
- Rogue and newly formed systems have a visual-only 10 percent scale increase.

**[Unverified acceptance]** Final visual balance, edge softness, photographic depth, and yellow-to-blue color progression still require live user-facing inspection. The user rejected multiple earlier galaxy versions.

### Star birth, stellar opacity, planets, and Saturn

**[Verified current by source inspection in the preceding audit]**

- components/CosmicPhenomena.tsx replaced the large opaque cones, solid gold torus, and expanding shock rings with a compact collapsing particle cloud, a thin particle disk, short translucent jets, partial arcs, and restrained core glow.
- Its RealisticStarVisuals core is depth-tested, depth-writing, and opaque.
- components/Scene.tsx renders the real parent star for every generated rogue system, including the deterministic branch that previously hid CYGNUS-2097.
- components/CelestialBody.tsx still loads data.texture with TextureLoader and applies the established planet texture maps.
- The referenced NASA texture files exist under public/textures/nasa/.
- Saturn currently uses ring radii approximately 1.1 to 2.3 times the planet radius and a 26.7-degree tilt.

**[Unverified acceptance]**

- The complete timed star-birth event has not been directly observed in its real scene.
- A discoverability/locator treatment for where a star is forming is not clearly implemented.
- Saturn’s current visual size and screen-space orientation have not been accepted by the user.
- Earth occluding the Sun/stars/black hole and all planet textures should be rechecked after a hard reload.

### Free Flight black-hole encounter

**[Verified current by source inspection in the preceding audit]**

- App.tsx, components/Scene.tsx, components/BlackHoleFlightExperience.tsx, and index.css implement the encounter flow.
- Telemetry phases include approach, critical, skim, escape, escaped, and captured.
- O starts guided approach inside four horizon radii and settles into a tangential skim at 1.18 horizon radii.
- P releases guidance.
- Entering the critical region begins a six-second escape challenge.
- The current tuning requires 16 distinct R keydown pulses; keyboard auto-repeat is ignored.
- A large mouse/touch HUD button uses the same pulse action.
- Translation and ordinary boost are locked during the challenge.
- Success applies an outward live-scene slingshot trajectory.
- Failure reduces lateral control, pulls the camera inward, and starts capture only after crossing the physical 1.0-radius horizon.
- The capture overlay is a 15-second raw-WebGL sequence, 5.2 seconds under reduced motion. It includes coherent star lensing, Doppler-asymmetric plasma, repeated/reversed disk images, a broken photon band, orbital roll, horizon expansion, a forward caustic, redshift, and interior darkness.
- The sequence crossfades over the live scene and caps resolution for performance.
- The touch mash target is at least 64 pixels high.

**[Verified historical]**

- Isolated encounter QA rendered close-orbit, multiple-image, and horizon frames without a WebGL shader compile/link error.
- The accessible mash control advanced from 5/16 to 6/16.
- The encounter HUD fit a 390x844 mobile viewport.

**[Incomplete]** The current experience has not been validated through both complete branches in the actual portfolio: approach, successful mash escape, second approach, failed mash, physical crossing, and uninterrupted 15-second capture. The user explicitly rejected the prior fall animation as unlike the linked NASA video, so isolated rendering is not enough to claim completion.

### Galactic Years and fast-forward control

**[Verified current by source inspection in the preceding audit]**

- utils/galacticTime.ts derives the displayed value from Date.now() and local September 15 anniversary boundaries.
- The intended invariant is exactly 26 at local 2026-09-15 00:00.
- Fast-forward accumulates a page-session offset only while the control is held; release stops acceleration without discarding the accumulated value.
- A reload/new page session discards the session offset and returns to the wall-clock value, preserving the exact September 15 anniversary behavior.
- The original fast-forward icon appearance/orientation is preserved, with pointer/touch cancellation and Space/Enter release handling.

**[Verified historical]** An exact boundary check returned 26 at local midnight on September 15, 2026.

### Experience Gateway and liquid glass

**[Verified current by source inspection in the preceding audit]**

- components/ExperienceGateway.tsx presents Rift Runner 3D, Free Flight, and Cosmic Lab 3D.
- index.css applies clearer, lower-opacity glass to the shell, cards, close control, icons, badges, action buttons, and landing CTA.

**[Verified historical]** The prior session reported that existing layout, text, callbacks, navigation, and timing were preserved. Headless browser inspection opened the gateway and confirmed the intended computed glass styles. Without a Git baseline, preservation cannot be independently proven from current source alone.

### Rift Runner 3D

**[Verified current by source inspection in the preceding audit]**

components/OrbitalSiege.tsx is a playable 3D implementation rather than a stub. It includes:

- An approximately 82-second, four-wave run and a Rift Warden boss phase.
- Slalom walls, meteor fans, route choices, needle gates, mine spirals, shock fronts, and boss volleys.
- Three starting protocols.
- Near-miss chains, phase defense, repair/energy/overdrive pickups, risk/reward gates, combo scoring, and persistent high score.
- 3D banking, a follow camera, shake and boost FOV, warp visuals, speed lines, explosions, procedural audio, a responsive HUD, pause/retry, and keyboard/mouse/touch controls.

**[Verified historical]** Headless QA launched the dedicated game canvas without a runtime exception. The only reported browser noise was a favicon 404 and autoplay AudioContext warnings.

**[Incomplete]**

- No complete 82-second run through the Rift Warden has been verified.
- Mobile/touch feel, audio unlock, HUD responsiveness, balance, and repeated-run variety need real playtesting.
- There is no campaign, meta-progression, unlock system, daily challenge, or other long-term retention loop.
- It is therefore inaccurate to call the game fully finished or “addictive.”

### Cosmic Lab 3D

**[Verified current by source inspection in the preceding audit]**

components/UniverseLab3D.tsx is a functional N-body sandbox rather than a stub. It provides:

- Four presets.
- Body creation.
- Softened Newtonian gravity.
- Merge and bounce collision modes.
- Time controls.
- Trails, vectors, and a grid.
- Telemetry.
- Mass/radius editing, velocity controls, circularization, duplication, and removal.

**[Verified historical]** Headless QA launched its dedicated WebGL canvas without a runtime exception.

**[Incomplete]** It is not Universe Sandbox parity. Missing areas include calibrated astrophysical units, relativistic black-hole behavior, save/load, rewind, direct drag/placement, materials/composition/temperature, fragmentation, stellar evolution, and advanced analysis. docs/ORBIT_LAB_CONCEPT.md contains an earlier phased concept.

### Asset safety

**[Verified current]**

- source_assets/blackhole-original is approximately 29 MB and contains a very dense source model, reported at about 466,186 vertices and 534,196 triangles. Loading it directly can exhaust mobile/WebGL resources.
- public/models/blackhole/blackhole.glb is approximately 352,356 bytes and is the deployment-safe derivative, but the live black-hole renderer does not depend on it.
- temp_model is corrupt or truncated and must not be used.
- public/models/nasa/ contains a NASA asteroid asset.
- public/textures/nasa/ contains planet textures and attribution material.
- docs/THIRD_PARTY_NOTICES.md records third-party licensing/attribution.

## Work that remains incomplete

In priority terms, the major unfinished outcomes are:

1. **Black-hole encounter acceptance:** Prove and tune both real Free Flight branches end to end, especially the NASA-inspired failed-capture sequence and the button-mash feel.
2. **Black-hole visual acceptance:** Inspect near/far and every meaningful viewing angle for snap, jiggle, billboard behavior, flat disk folds, hard lines, or poor distant silhouette.
3. **Regression verification:** Recheck click targeting, planet/star texture visibility, Earth occlusion, CYGNUS-2097’s parent star, galaxy brightness in TON focus, manual-control engagement, and fast-forward behavior after a hard reload.
4. **Galaxy acceptance:** Verify organic depth, even density, soft edge, restrained dust, and no solar-system washout on desktop and mobile.
5. **Star-birth acceptance and discovery:** Watch a full timed birth event and design a subtle locator if the event remains hard to find.
6. **Responsive-site verification:** Audit all major portfolio pages, gateway, Free Flight, both experiences, and overlays at representative phone, tablet, desktop, ultrawide, touch, keyboard, and reduced-motion settings.
7. **Rift Runner completion:** Finish a full boss run, tune difficulty and control feel, then add meaningful run variety/progression only after the base loop is proven fun.
8. **Cosmic Lab roadmap:** Decide which missing sandbox capabilities actually support the portfolio before attempting broad parity.
9. **Hostinger deployment:** Test the real production build on the target host/device matrix and confirm that no heavy source model is requested.
10. **Higgsfield MCP request:** If still desired, check server availability and list its tools without generating anything.

## Important technical and product decisions

1. **Shader, not source model.** The live black hole remains procedural. The heavy original model is reference/source material only.
2. **Visual size is separate from physical size.** Enlarging the black-hole shadow, planets, rings, or rogue systems must not alter encounter thresholds, masses, orbit equations, or navigation unless explicitly requested.
3. **Near-horizon skim is outside the horizon.** The guided orbit is 1.18 horizon radii. The physical capture boundary is 1.0. This preserves a playable escape attempt without claiming escape from inside an event horizon.
4. **The encounter is a realtime approximation.** Describe it as a Schwarzschild-style cinematic approximation informed by NASA visualization, not full GR ray tracing or exact spacecraft physics.
5. **Current escape tuning is an implementation choice.** Six seconds, 16 distinct R presses, and the R key are current values, not a clearly user-approved permanent specification.
6. **Galaxy is volumetric particles.** Do not reintroduce the rejected full-screen/flat galaxy plane or hard luminous spiral meshes.
7. **Decorative particles do not receive clicks.** Galaxy/dust points use no-op raycasts; intended selectable bodies own selection.
8. **Depth handling is material-specific.** Opaque stellar cores depth-test and depth-write. The transparent composite black-hole shader currently depth-tests but intentionally does not globally depth-write; forcing its full quad to write depth could create a flat rectangular occlusion artifact. If a separate opaque horizon proxy is introduced, validate its depth writing live.
9. **Galactic Years is wall-clock anchored.** The display must resynchronize from Date.now(), including after background throttling, and hit 26 at local midnight on 2026-09-15.
10. **Dedicated experiences load separately.** Rift Runner and Cosmic Lab are separate/lazy WebGL surfaces so the main portfolio remains responsive.
11. **Universe Sandbox is a benchmark, not a claim.** Keep the implementation original and scope additions by portfolio value.
12. **Accessibility and device fallback matter.** Preserve touch controls, large targets, pointer-lock fallback, and reduced-motion paths.
13. **Assets need provenance.** Preserve license and attribution files, and never put the 29 MB source model on the live loading path.

## Files created, modified, or deleted

Because there is no Git history, this section distinguishes what was observed from what can be proven.

### Created by this handoff-only turn

**[Verified current]**

- HANDOFF.md
- AGENTS.md

No application code, styles, assets, generated output, or existing documentation were intentionally changed during this handoff-only turn.

### Material files known to contain accumulated project work

**[Verified current: present]**

- App.tsx
- index.css
- data.ts
- types.ts
- vite.config.ts
- vite-env.d.ts
- components/Scene.tsx
- components/CelestialBody.tsx
- components/Chatbot.tsx
- components/HUD.tsx
- components/InterstellarBlackHoleVisuals.tsx
- components/BlackHoleFlightExperience.tsx
- components/CosmicPhenomena.tsx
- components/ExperienceGateway.tsx
- components/ArcadeHUD.tsx
- components/OrbitalSiege.tsx
- components/UniverseLab3D.tsx
- components/OrbitLab.tsx
- components/ProceduralPlanetTexture.ts
- components/GlobalErrorBoundary.tsx
- components/LocalErrorBoundary.tsx
- utils/galacticTime.ts
- docs/CODEX_HANDOFF.md
- docs/ORBIT_LAB_CONCEPT.md
- docs/THIRD_PARTY_NOTICES.md
- public/models/blackhole/blackhole.glb
- public/models/nasa/
- public/textures/nasa/
- source_assets/blackhole-original/

**[Unverified authorship]** Files with later filesystem creation times may have been created during the accumulated redesign, but without Git it is unsafe to state which session or author created each one.

### Files known to have been modified during the accumulated work

**[Verified by current implementation plus the prior handoff, not by Git diff]**

- App.tsx
- index.css
- components/Scene.tsx
- components/CelestialBody.tsx
- components/CosmicPhenomena.tsx
- components/ExperienceGateway.tsx
- components/InterstellarBlackHoleVisuals.tsx
- components/BlackHoleFlightExperience.tsx
- components/OrbitalSiege.tsx
- components/UniverseLab3D.tsx
- utils/galacticTime.ts
- relevant data/types and public attribution/assets

Do not treat this as a complete historical diff.

### Known deletions

**[Verified historical]** Temporary QA entry files black-hole-qa.html and black-hole-qa.tsx were removed after isolated testing.

**[Unknown]** No other deletion history can be proven without Git metadata.

### Generated or local-only paths

- node_modules/
- dist/
- .codex-vite.out.log
- .codex-vite.err.log

Do not hand-edit these paths. dist is build output, and the log files may contain stale diagnostic noise.

## Known issues and limitations

- **[Verified current] No Git metadata.** There is no safe repository diff or rollback mechanism unless the user has another copy.
- **[Verified current] Dev server stopped.** Nothing was listening on 127.0.0.1:4173 during this handoff. The ambient browser tab alone is not proof that the current app is served.
- **[Verified current] No test or lint scripts.** package.json exposes dev, build, and preview only.
- **[Verified current] Chatbot environment-name mismatch.**
  - components/Chatbot.tsx reads import.meta.env.VITE_GEMINI_API_KEY.
  - README.md describes GEMINI_API_KEY.
  - One Chatbot error-help branch still tells the user to set API_KEY.
  - Do not “fix” this while doing unrelated visual work; reconcile it in a dedicated change.
- **[Verified current] Nonfatal HMR warning.** Existing logs show Fast Refresh invalidating components/BlackHoleFlightExperience.tsx because EMPTY_BLACK_HOLE_ENCOUNTER is an incompatible export. This causes reload/invalidation during development, not a known production crash.
- **[Verified current] Stale optimization warnings.** .codex-vite.err.log contains older optimize-deps missing-file warnings generated by QA probing.
- **[Verified historical] Browser warnings.** Headless experience launches produced a favicon 404 and autoplay AudioContext warnings.
- **[Verified historical] Large bundle.** The last reported main minified bundle was approximately 1.56 MB, about 442 KB gzip. Device performance remains a real validation requirement.
- **[Technical limitation] Physics fidelity.** The galaxy is visual, Cosmic Lab uses softened Newtonian gravity, and the black-hole sequence is cinematic. None is a full astrophysical or relativistic solver.
- **[Product limitation] QTE acceptance.** The R/16/6 tuning and the capture animation remain subject to user approval.
- **[Product limitation] Game retention.** Rift Runner has one finite run with rerolled patterns and persistent high score, but no long-term progression.
- **[Product limitation] Lab depth.** Cosmic Lab is functional but far short of full Universe Sandbox breadth.
- **[Unverified] Hostinger.** No real Hostinger deployment was performed in the available session.
- **[Unverified] Full responsiveness.** Only selected desktop checks and a 390x844 encounter check were recorded.

## Unresolved questions

These should not block read-only QA, but they should be resolved before broad new implementation:

1. Is R the desired permanent mash button, and are 16 presses in six seconds accessible and fun on keyboard, mouse, and touch?
2. Does the user want the supplied YouTube flyby look, the companion NASA plunge look, or a deliberate blend for failed capture?
3. What subtle locator should identify a forming star without changing the established navigation UI?
4. Is the current Saturn ring scale/orientation visually accepted after live inspection?
5. Which Cosmic Lab features have the highest portfolio value: save/load, direct manipulation, units, stellar evolution, fragmentation, or analysis?
6. Should Rift Runner prioritize procedural run variety, meta-progression, or a shorter polished score-attack loop?
7. Which timezone is authoritative for the September 15 Galactic Years milestone? The current implementation uses the browser’s local timezone.
8. What are the actual Hostinger plan limits and target mobile devices?
9. Is the earlier Higgsfield MCP inventory still wanted?

## Validation already performed

### Current handoff-only checks

**[Verified current, 2026-07-15]**

~~~powershell
Set-Location -LiteralPath 'C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio'
npx.cmd tsc --noEmit --pretty false
~~~

Result: exit code 0, no TypeScript diagnostics, approximately 11.7 seconds.

Read-only environment and repository checks also established:

- Root HANDOFF.md and AGENTS.md did not previously exist.
- docs/CODEX_HANDOFF.md existed and was preserved.
- No .git directory exists in the project or its parent.
- No .openai/hosting.json exists.
- 127.0.0.1:4173 had no listener; an HTTP request failed with “Unable to connect to the remote server.”

The build was deliberately not rerun during this turn because the user authorized only the two Markdown updates and npm run build rewrites dist.

### Historical validation recorded by the prior session

**[Verified historical]**

- npx.cmd tsc --noEmit --pretty false passed after the escape-QTE and WebGL plunge changes.
- npm.cmd run build passed; 2,275 modules were transformed.
- Last recorded output chunks included:
  - dist/assets/index-DOH4RnrR.css
  - dist/assets/rotate-ccw-CbOW_Lbx.js
  - dist/assets/UniverseLab3D-BTmos3uk.js
  - dist/assets/OrbitalSiege-DAfp_143.js
  - dist/assets/index-CPxQr7wi.js
- Headless Chrome loaded localhost, opened the Experience Gateway, and inspected clear-liquid-glass computed styles.
- Headless Chrome launched Rift Runner and Cosmic Lab into dedicated WebGL canvases without a runtime exception.
- In-app QA checked the restored fast-forward orientation, bright TON background, larger black-hole shadow, intact visible textures, Free Flight startup, and the pointer-lock drag fallback.
- Isolated black-hole QA verified the mash counter, 390x844 layout, representative close-orbit/multiple-image/horizon frames, and absence of WebGL shader compile/link errors.
- The Galactic Years boundary calculation returned exactly 26 at local 2026-09-15 00:00.

These historical results do not replace a fresh live regression pass after the next code change.

## Environment and commands

**[Verified current]**

- OS: Microsoft Windows NT 10.0.26200.0
- Shell: Windows PowerShell 5.1.26100.8875
- Node.js: v24.15.0
- npm: 11.12.1
- React: 19.2.1
- react-dom: 19.2.1
- three: 0.181.2
- @react-three/fiber: 9.4.2
- @react-three/drei: 10.7.7
- Vite configured package range: ^6.2.0; previous runtime/log: 6.4.3
- TypeScript configured range: approximately 5.8.2
- Tailwind CSS: 4.2.4

vite.config.ts currently sets:

- base: /
- dev host: 0.0.0.0
- dev port: 4173
- strictPort: true
- HMR unless DISABLE_HMR=true
- chunk-size warning limit: 3500
- legacy process.env.API_KEY definition from API_KEY or GEMINI_API_KEY

Start the live app with:

~~~powershell
Set-Location -LiteralPath 'C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio'
npm.cmd run dev -- --host 127.0.0.1 --port 4173
~~~

Then open:

~~~text
http://127.0.0.1:4173/
~~~

Validate source without rewriting dist:

~~~powershell
npx.cmd tsc --noEmit --pretty false
~~~

Validate a production build when code changes are authorized:

~~~powershell
npm.cmd run build
~~~

Preview that build:

~~~powershell
npm.cmd run preview -- --host 127.0.0.1 --port 4173
~~~

Chatbot secret:

~~~text
VITE_GEMINI_API_KEY
~~~

Use a local environment variable or ignored .env.local. Never commit a key. README and one error-help message are currently stale as described above.

## Exact recommended next steps, in priority order

1. **Re-establish a safe baseline.**
   - Set the exact working directory.
   - Read AGENTS.md and this file.
   - Confirm the requested scope before editing because there is no Git rollback.
   - Run the no-emit TypeScript check.
2. **Start the app and hard-reload it.**
   - Use the exact dev command above.
   - Confirm the page is actually served at 127.0.0.1:4173 rather than trusting an old browser tab.
   - Keep DevTools console open and note WebGL, React, asset, and AudioContext errors separately.
3. **Run the black-hole encounter end to end before changing it.**
   - Enter Free Flight and engage manual control.
   - Verify pointer lock and drag fallback.
   - Press O for guided approach and observe the 1.18-radius skim.
   - Complete one successful 16-pulse escape.
   - Repeat, fail the challenge, cross the 1.0-radius horizon, and watch the entire 15-second sequence.
   - Record desktop and mobile video. Compare motion and lensing to the supplied NASA reference.
4. **Verify regressions that previously upset the user.**
   - Empty background clicks do nothing.
   - Planets select themselves.
   - Only the actual black-hole target focuses TON 618.
   - Earth correctly occludes the Sun, black hole, and other stars when nearer.
   - Stellar cores are opaque.
   - Earth, Mars, Jupiter, Saturn, and Neptune textures remain visible.
   - CYGNUS-2097 displays its parent star.
   - Galaxy stars stay bright while TON is focused.
   - Fast-forward release stops acceleration and preserves the advanced value for the current page session; reloading/new navigation returns to wall time and uses the restored appearance.
5. **Perform black-hole visual QA at controlled camera paths.**
   - Inspect distant, medium, and close LODs.
   - Orbit above, below, front, back, and edge-on.
   - Look for snapping, jitter, upside-down flips, flat-sheet silhouettes, hard bars, blue glow, circular sprite edges, and a poor distant silhouette.
   - Change only components/InterstellarBlackHoleVisuals.tsx or the encounter component unless evidence identifies another owner.
6. **Perform galaxy and star-birth visual QA.**
   - Inspect face-on, tilted, and edge-on galaxy views on dark and bright displays.
   - Check quadrant balance, edge softness, dust restraint, warm-to-blue progression, and solar-system contrast.
   - Trigger and observe a full star-birth event.
   - If it remains hard to locate, propose a restrained locator before implementing it.
7. **Run a responsive matrix.**
   - At minimum: 390x844 phone, a tablet viewport, 1366x768, 1920x1080, and ultrawide.
   - Test touch, keyboard/mouse, reduced motion, gateway modal overflow, HUD collision, and orientation changes.
8. **Finish gameplay validation before expanding Rift Runner.**
   - Complete the entire 82-second run and boss.
   - Test retry, pause, audio unlock, mouse, keyboard, and touch.
   - Tune readability and difficulty.
   - Then choose one retention direction rather than adding several untested systems at once.
9. **Choose a bounded Cosmic Lab milestone.**
   - Use docs/ORBIT_LAB_CONCEPT.md as context.
   - Prioritize one coherent increment such as direct body placement plus save/load, then validate it.
   - Do not promise full Universe Sandbox parity.
10. **Build and deploy only after live acceptance.**
    - Run TypeScript and production build checks.
    - Inspect the production preview and network panel.
    - Confirm the 29 MB source model is never requested.
    - Deploy to a Hostinger staging path and test representative desktop/mobile hardware.
11. **Close the standalone tooling request if still relevant.**
    - Check whether the Higgsfield MCP server is available.
    - List its tools.
    - Do not generate media unless the user separately asks.

## Safe continuation summary

The current codebase contains substantial working implementations, but visual acceptance and complete playthrough QA remain the gating work. The latest unresolved user dissatisfaction centers on the failed black-hole capture not feeling like the supplied NASA video and the desire for a real mash-to-escape interaction. Do not broaden the next edit into another galaxy, planet, UI, or physics rewrite unless live evidence and the user’s current instruction require it.
