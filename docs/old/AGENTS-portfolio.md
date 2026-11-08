# Permanent Repository Guidance

## Repository identity

- The only correct project root is:
  C:\Users\deeks\Desktop\DV\Projects\galactic portfolio Chatgpt\deekshitth vegi---galactic portfolio
- Do not confuse it with C:\Users\deeks\Desktop\DV\Projects\portfolio-gem.
- Always set the working directory explicitly before reading, editing, running, or validating.
- This project currently has no Git metadata. Do not assume Git rollback is available, use destructive Git commands, or claim a Git-backed diff.

## Scope discipline

- Make narrow, evidence-driven changes in the subsystem the user names.
- Preserve unrelated navigation, portfolio UI, camera behavior, planet textures, Galactic Years, and exploration/orbital physics.
- A visual-only request must not change mass, orbital radius, encounter thresholds, navigation, or simulation equations.
- Inspect the live result before claiming a visual or interaction is complete.
- Treat HANDOFF.md as task/status context; keep temporary progress and session notes out of this file.

## Architecture map

- App.tsx coordinates top-level modes and lazy experience loading.
- components/Scene.tsx owns the main R3F scene, galaxy, selectable systems, camera interaction, and Free Flight integration.
- components/CelestialBody.tsx owns planet/star body materials and NASA texture use.
- components/InterstellarBlackHoleVisuals.tsx owns the live TON 618 shader and its distance/focus level of detail.
- components/BlackHoleFlightExperience.tsx owns the black-hole encounter HUD and capture cinematic.
- components/CosmicPhenomena.tsx owns star-birth and other transient cosmic visuals.
- utils/recentStarSystems.ts owns the recent-system naming cache/fallback; public/api/recent-systems.php owns the Hostinger/NASA TAP proxy.
- components/ExperienceGateway.tsx owns the Choose Your Journey modal.
- components/BlackHoleHeistGame.tsx and heist.tsx own the isolated Black Hole Heist game entry.
- components/Echo26Game.tsx and echo26.tsx own the isolated ECHO // 26 game entry.
- components/OrbitalSiege.tsx is Rift Runner 3D.
- components/UniverseLab3D.tsx is Cosmic Lab 3D.
- utils/galacticTime.ts owns the wall-clock Galactic Years calculation.
- data.ts and types.ts define shared celestial data and types.

## Permanent visual and interaction invariants

- Keep the galaxy volumetric and particle-based. Do not reintroduce a full-screen flat galaxy plane, hard luminous spiral bands, or a gray wash over the solar system.
- Decorative galaxy and dust particles must not capture pointer raycasts. Only intended selectable objects may own selection.
- Keep galaxy points at their intended brightness/opacity while TON 618 is focused; do not reintroduce focus dimming.
- Preserve planet textures and their established material paths.
- Generated systems must retain a visible parent star, including the deterministic CYGNUS-2097 case.
- Opaque stellar cores must depth-test and depth-write. The transparent composite black-hole shader must depth-test so nearer opaque bodies occlude it, but do not force the whole transparent shader quad to depth-write. A separate opaque horizon proxy may depth-write only after live occlusion QA.
- Keep TON 618 as a real interactive shader, not a flat image, billboard, or runtime dependency on the heavy source GLTF.
- The black-hole shader must retain a cheap distant mode and higher-detail focused/near mode.
- Avoid cartoon rings, “black ball with a skirt” silhouettes, hard yellow bars, and blue science-fiction glow.
- Preserve the compact, translucent star-birth treatment; do not restore opaque cone jets or a cartoon gold ring.
- Young-system formation is Galactic-Years driven: gas/ignition from +0.000 to +0.100 and sequential planet assembly through +0.500. Finished young stars must stay in the established distant-system visual-size family; do not change mass/orbits to resize them.
- Preserve the original fast-forward icon appearance/orientation. The control is press-and-hold: pointer or keyboard press accelerates Galactic Years, and release/cancel/blur stops acceleration without snapping the displayed session value backward.
- Preserve the clear, low-opacity liquid-glass treatment in the Experience Gateway while keeping text readable and controls usable.
- Preserve touch controls, adequate target sizes, pointer-lock fallback, and reduced-motion behavior.
- Keep the main portfolio responsive; load heavyweight game/lab experiences separately or lazily.

## Physics and product truthfulness

- Do not describe the procedural galaxy as an N-body simulation.
- NASA Exoplanet Archive host names are catalogue designations attached to simulated births; never imply those systems were observed physically forming during the session.
- Do not describe the realtime black-hole renderer/cinematic as full general relativity. It is a physically informed cinematic approximation.
- A playable near-horizon skim must remain outside the capture radius; do not claim a craft can hover on or escape from inside an event horizon.
- Cosmic Lab uses an original, simplified simulation. Do not claim Universe Sandbox parity or copy that product’s UI, assets, code, or branding.
- When enlarging a visual body or shadow, keep physical values unchanged unless the user explicitly requests a physics change.

## Galactic Years invariant

- Galactic Years is wall-clock anchored through utils/galacticTime.ts.
- It must equal exactly 26 at local midnight on 2026-09-15.
- It must resynchronize from the current clock after a backgrounded or long-running tab.
- Fast-forward accumulates a page-session offset while held. Releasing the control, leaving orbit, or focusing a body stops acceleration but preserves that accumulated offset for the current page session. A reload/new page session clears the offset and resynchronizes to the wall-clock-only value.

## Assets, deployment, and licensing

- Keep source_assets/blackhole-original out of the production loading path; it is too heavy for reliable mobile/WebGL deployment.
- Do not use temp_model; it is corrupt/truncated.
- Runtime public assets should be referenced through Vite-safe public or BASE_URL-relative paths.
- Preserve docs/THIRD_PARTY_NOTICES.md and all asset attribution/license files.
- Keep public/THIRD_PARTY_NOTICES.md synchronized with the source notice so the deployable archive carries the required MIT notice.
- Do not hand-edit node_modules/, dist/, or local Vite log files.
- Verify production network requests and mobile memory before deployment.

## Secrets and environment

- The chatbot can optionally read VITE_GEMINI_API_KEY for live AI, but the public portfolio must remain useful through its deterministic built-in data/navigation fallback when no key is present.
- Use an environment variable or ignored .env.local; never commit API keys.
- Avoid exposing secrets in terminal output, screenshots, documentation, or generated files.
- The current deployable site has no public/videos/launch.mp4. Free Flight intentionally starts the existing procedural launch animation directly; do not restore a guaranteed missing-video request unless a real, licensed asset is added and validated.

## Validation expectations

For an authorized code change, run from the exact repository root:

~~~powershell
npx.cmd tsc --noEmit --pretty false
npm.cmd run build
~~~

Then serve the actual app and inspect it:

~~~powershell
npm.cmd run dev -- --host 127.0.0.1 --port 4173
~~~

- Check http://127.0.0.1:4173/ after a hard reload.
- Test the changed path on representative desktop and mobile viewports.
- Check the browser console for React, WebGL shader, asset-loading, and runtime errors.
- For scene changes, explicitly test raycast ownership, depth/occlusion, camera angles, distant/near level-of-detail transitions, touch input, and reduced motion.
- Compilation alone is never sufficient evidence that a visual, control, game, or simulation is finished.
