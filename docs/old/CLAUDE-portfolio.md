# CLAUDE.md — Rewild (the game) inside Deekshitth Vegi's galactic portfolio

Project memory for Claude Code. Committed to the repo on 7 Nov 2026 so that any Claude account the
user works from (they moved to a second account, Claude Max) starts with the full context. Until then
it was local-only and was lost once with a reclaimed container. Keep it up to date in the repo: add
every new user rule and every shipped milestone, and commit it with the work.

## 8 Nov 2026: THE GAME MOVES TO UNREAL ENGINE 5 (read docs/unreal/PLAN.md first)

The owner played the three.js version and said Earth looks bad, nothing happens but sightseeing, models look
"placed" with nothing inside, aliens only talk, and there is no space war: "The game feels pretty stale." Asked to
choose, they picked: **move to Unreal Engine 5 now**; space war = **dogfights, capital ship battles, boarding ships
and stations, ground battles** (all four); **the war is the main story** (the Harrow, a species that strips dead
worlds, hold Earth; win it back with allies, then rewild it). docs/unreal/PLAN.md has the story, the order of work
and what carries over.

- Unreal needs a GPU: the work runs in Claude Code ON THE OWNER'S PC (RTX 3070 desktop, or the RTX 4070 laptop with
  Windows set to give the apps the NVIDIA chip). A cloud session can only write docs and plans.
- The Unreal project gets its own private repo with Git LFS (the owner creates it; suggested `deekshitvegi/rewild`).
  This repo keeps the website and the old game; nothing in it is deleted. Same commit rule: as the owner, no trailer.
- First on the PC: check Unreal 5, Visual Studio 2022 (Game development with C++), Git + Git LFS, the new repo; make
  a C++ project; one HighResShot test shot. Then the first slice, *Blockade* (PLAN.md step 2): Earth from orbit with
  Sky Atmosphere + Volumetric Clouds, flight, guns, lock-on missiles, shields, Harrow fighters with dogfight AI,
  crew wingmen, explosions, win/lose. Show it before anything else.
- All the owner's rules below still hold (visuals bar, ASSET_JOB.md, measure frame time, astronaut model and its
  motions kept, Liquid Glass HUD direction F, commit often).

## FIRST SESSION ON THE NEW ACCOUNT: do this before any other work

The user will only say "read CLAUDE.md and understand everything before beginning". Read this whole
file AND `docs/claude/HISTORY.md` (every request the user has made, what was done, what is open, and all
the visual references and links they gave: the user must never have to explain it again), skim
HANDOFF.md's top section, AGENTS.md, docs/story.md, docs/stargaze.md, then go through this list. Do the
checks yourself; for anything only the user can do, tell them in plain words, one short list, with
where to click. Then report what is ready and ask what to start on (default: #57 Haven).

1. **GitHub.** Check you can fetch and push `deekshitvegi/deekshitthvegiportfolio` (`git fetch origin main`;
   pushes go to `main` and `claude/dreamy-bohr-x6gs4e`, as the user, see Standing rules). If GitHub
   access is missing, the user connects GitHub on this account (claude.ai › Settings › Connectors, or the
   GitHub link the session's tools give) and starts the session with this repo selected.
2. **Skills.** `ls ~/.claude/skills` should show the 58 skills listed under "Skills" below. If not, run
   `bash .claude/hooks/install-skills.sh` (needs github.com reachable) and tell the user to start a new
   session so they load. Anthropic's standard skills (docx, pdf, pptx, xlsx, skill-creator, canvas-design...)
   should appear in the skill list; if not, the user switches them on in claude.ai › Settings › Capabilities.
3. **Higgsfield.** Check the Higgsfield tools exist (search the deferred tools for "Higgsfield", call
   `balance`). If not, the user connects Higgsfield on this account (claude.ai › Settings › Connectors).
   All generated art, films, voices and 3D models came from it; old job ids still work only from the
   account that made them, so on a new account re-downloads may fail: keep the finished files in the repo.
   Optional connectors: Google Drive, Claude Docs; Appllama MCP (https://mcp.appllama.io/mcp) needs sign-in.
4. **The game preview.** The user plays in the Claude app through the preview artifact
   https://claude.ai/artifact/HTkaQLR6kVXmTCcTpfmwS6 (owned by the FIRST account). Try
   `Artifact action=read` on it: if the result says you are a "writer", keep publishing to that URL.
   If not, ask the user to open that link on the old account and share it with the new account with
   edit access (the page's Share menu); or, if they prefer, publish a new preview (tools/claude/prep_site.sh,
   then a full publish of /tmp/rewild/site with page.html as the page) and give them the new link, and
   update the PREVIEW line in this file.
5. **Tools.** `mkdir -p /tmp/rewild && cp -r tools/claude/. /tmp/rewild/ && (cd /tmp/rewild/hf/tools && npm install)`,
   `npm install` in the repo, start the dev server (see Setting up below), and check
   `lab/fly-lab.html?start=projects&landed=1&q=0` loads (one screenshot is enough).
6. **Pending question for the user:** may `public/films/wormhole-cinematic.*` (6.6 MB, no longer played)
   be deleted? Ask once; record the answer here.
7. **Update this file** as you go (it is committed now): new user rules, shipped commits, open questions.
   Commit it with the work.

## Start here (a new session or a new account)

**Who and what.** The user is Deekshitth Vegi (GitHub `deekshitvegi`). The repo is a Vite + React 19
+ TypeScript site: a galactic portfolio home page (`App.tsx`, `components/`) with a full 3D space game
behind "Begin expedition" (three.js 0.181 via @react-three/fiber 9, `components/expedition/`, ~140 files).
The game is now its own product, working title **Rewild**: the user plans to ship it separately (Steam,
App Store, Play Store) as well as on the website, so nothing in the game may be about the portfolio.
The user is not a programmer by trade; they judge by playing and by screenshots/videos. Show, don't tell.

**The story.** 300 years after a superflare burned Earth's ozone, the ark Halcyon carried 400 people
through the wormhole by Saturn to Haven, a green world circling the black hole TON 618 (1 day there =
10 years on Earth). Haven's orbit is failing. Four crew go home in the Argo (the Halcyon's tender,
a big ship only she can cross the wormhole; each crew member also has a small fighter that docks in
her bay): Dev Arora, Noor Haddad, Kai Mendes, Amara Okafor. ARGO is her AI. Bring Earth back to life
(recovery stages, Seven Seeds, 13 chapters), meet alien life, then tell Haven to come home.
Details: `docs/story.md`. Prologue on Haven; new players start there.

**Where everything lives.**
- `components/expedition/ExpeditionExperience.tsx` (root: Canvas, regions, gates, HUD), `Player.tsx`
  (flight/walking/docking/wormhole), `ExpeditionWorld.tsx`, `bodies.ts` (every world), `region.ts`
  (two systems: `sol` and `ton`, only one built at a time), `runtime.ts` (shared mutable game state),
  `story.ts` / `expeditions.ts` / `argo.ts` / `contact.ts` (story, challenges, ARGO lines, aliens),
  `crew.ts` + `mothership.ts` (crew and the Argo), `graphics.ts` (detail levels, effects settings),
  `ui.css` (THE design layer for the HUD), `films.ts` + `FilmPlayer.tsx` (loading films).
- `components/ExpeditionLaunch.tsx`: the home page -> game transition and the opening film.
- `lab/*.html|tsx`: dev-only test pages (`lab/fly-lab.html?start=<world>&landed=1&q=0|1|2` is what most
  tests drive; it exposes `window.__expedition`, `window.__three`). Not part of the build.
- `public/films`, `public/models/expedition`, `public/textures/*`: assets (ATTRIBUTION files beside them).
- `source_assets/trees`: Blender tree generator (README has every command).
- `tools/claude/`: Claude's build/test/preview/film scripts. Read `tools/claude/README.md` first;
  they expect to be copied to `/tmp/rewild` (that is what `$SP` means in the notes below).
- `HANDOFF.md` (top section = latest systems), `AGENTS.md` (the user's permanent rules from Codex),
  `docs/claude/HISTORY.md` (all requests, decisions, references, open list; keep adding to it).

**Setting up a fresh cloud session.**
1. `npm install` in the repo. Skills install themselves (`.claude/settings.json` SessionStart hook).
2. `mkdir -p /tmp/rewild && cp -r tools/claude/. /tmp/rewild/ && (cd /tmp/rewild/hf/tools && npm install)`.
3. Dev server: `npx vite --config /tmp/rewild/vite.repo.config.mjs --port 4187 --host 127.0.0.1`.
4. `git fetch origin main` and check `git log` against "Shipped" below (the user also commits from Codex).

**Skills (all of them, on any account).** Same set as on the first account:
- 58 third-party skills, installed automatically into `~/.claude/skills` at the start of every cloud
  session by `.claude/settings.json` -> `.claude/hooks/session-start.sh` -> `.claude/hooks/install-skills.sh`
  (each from its GitHub repo at a pinned commit, with its licence; needs github.com reachable, which the
  default cloud network allows). If they are missing (`ls ~/.claude/skills`), run
  `bash .claude/hooks/install-skills.sh` and start a new session. The list:
  anti-ai-slop-writing, anti-slop, appllama-app-design-skill, appllama-usage, audio-design, camera-systems,
  codebase-design, create-game-assets, deslop, diagnosing-bugs, diagram-design, dialogue-systems,
  ffmpeg-skill, frontend-a11y, game-feel, game-ui-ux, grill-me, grilling, humanize, humanizer,
  humanizer-aboudjem, input-systems, karpathy-guidelines, level-design, make-interfaces-feel-better,
  no-ai-slop, performance-optimization, physics-tuning, ppt-master, procedural-gen, prototype,
  react-patterns, react-performance, save-systems, shader-programming, slopbeth, stop-slop,
  survival-crafting, tdd, teardown, threejs-gltf-loading, threejs-materials-lighting, threejs-scene-setup,
  typescript-patterns, unslop, unslop-writing, verification-loop, vite-patterns, wait-what,
  writing-for-agents; added 7 Nov: game-ai, ai-behavior-trees-utility-ai, rpg, steam-publish, itch-publish
  (awesome-gamedev), ui-ux-pro-max + design-system (nextlevelbuilder, offline tables), cutaway (Nyxera0x).
  Not installed on purpose: awesome-gamedev's Unity/Unreal/Godot/Roblox/Phaser/Pixi/Bevy/etc. skills (the game
  is three.js), UI/UX Pro Max's logo/banner/brand/slides skills (paid image APIs, marketing).
- Anthropic's standard skills come with every claude.ai account (Settings › Capabilities › Skills; make sure
  they are switched on there): algorithmic-art, brand-guidelines, built-in-browser, canvas-design, chrome-browser, computer-use, deep-research, doc-coauthoring, docs, docx, google-workspace, import-memory, internal-comms, learn, mcp-builder, morning, pdf, pptx, skill-creator, theme-factory, web-artifacts-builder, xlsx.
- Built into Claude Code: session-start-hook, artifact-design, artifact-capabilities, code-review, simplify,
  verification and the rest. Which skill to use for which job is in "Claude Code skills" further down.
- Connectors the first account had (connect them on the new one at claude.ai › Settings › Connectors as needed):
  GitHub (required), Higgsfield (all generated art, video, voices, 3D), Google Drive, Claude Docs; Appllama MCP
  (https://mcp.appllama.io/mcp, for the mobile app work) was planned but needs the user to sign in.

**What does NOT carry over to another account (tell the user when it matters).**
- The preview artifact https://claude.ai/artifact/HTkaQLR6kVXmTCcTpfmwS6 belongs to the first account.
  A new account can only update it if the user shares it with edit access; otherwise publish a new
  preview artifact (prep_site.sh -> full publish of /tmp/rewild/site, page file page.html) and give the
  user the new link. The user plays in the Claude app, so the preview is how they test.
- Connectors are per account: Higgsfield (images, video, audio, 3D; the user said "use credits, don't
  think about them", each call still asks them) and GitHub must be connected on the new account.
- The old scratch folder is gone: raw film clips, voice lines, keyframes and portraits live on Higgsfield
  (job ids in `tools/claude/film2/media.txt`, `public/films/ATTRIBUTION.md`) and can be downloaded again.

**How the user likes to work.** Short plain updates, outcome first, no jargon. Render it and show it
(screenshots, contact sheets, videos) before claiming it looks right. Commit and push each finished
milestone and tell them the commit id. When they say something looks wrong, find the cause; they notice
"AI slop" in visuals, UI and video immediately. Ask before deleting anything they made or approved.

**Answered 7 Nov:** `public/films/wormhole-cinematic.*` deleted (157b468). The user did NOT like the
Higgsfield films either (crossing and opening): replace them with a different approach (in-engine).

**The magical world (asked again 7 Nov: "are we getting that as well? Like another world like a magical world near
blackhole"):** yes, planned as a second world in TON 618's system. Reference: the Contour-void garden post
(x.com/threejs/status/2110563791922770264): a dark world drawn in glowing contour lines where a garden grows from the
void wherever you walk, and stays. Proposed story: "the Garden", a world the Makers left unfinished (their blueprint
of a living world), which wakes where living things walk. Our own colours (TON 618's gold-white light), not that
post's neon green. Shares the growth/trail mask with the grass rebuild. Order: proposed right after Haven.
On the Garden the explorer changes style (user, 7 Nov: "when we enter that planet our character turns into similar
animated character"): the suit dissolves into light and the explorer becomes a cloaked wanderer in the post's style
(dark figure, gold-white rim light, swaying cloak); back to the astronaut on leaving. Build it as a new Blender body
skinned to astronaut.glb's skeleton so every existing motion works. This is the ONLY exception to "never replace the
astronaut model": everywhere else the astronaut stays.

**Next in the agreed order:** #57 Haven made beautiful (seas, lakes, rivers, waterfalls; temples and
shrines from many cultures: Indian temple, Japanese shrine, Greek colonnade...), then #31 aurora rebuild
(user dislikes the current look), then #52/#53 real-size Earth + takram volumetric clouds
(`docs/real-scale.md`, lab/cloud-lab.tsx). Later: Haven cities, people and interaction, breathable air,
a magical planet, the war story (an alien species holds ruined Earth), store wrappers, mobile budgets.

## Read these first
- `AGENTS.md` (the user's permanent rules from Codex: visual invariants, physics truthfulness, Galactic
  Years contract, asset/licence rules). Do not edit its identity section without the user's say-so.
- `HANDOFF.md`, `docs/PLANET_CONTENT_MAP.md`, `docs/WORLDS.md`, `docs/scene.md` (survival/story design
  + research notes; `docs/scene/` frames are third-party private reference: remove before going public).

## Standing rules (user)
- (Changed 7 Nov 2026 at the user's request: this file IS committed now, so a second account has it.)
- Work only from GitHub `deekshitvegi/deekshitthvegiportfolio`. `main` before 36fdff1 is an old version.
- The user also works in Codex: `git fetch origin main` before every push and reconcile.
- Commit to `main` AND keep `claude/dreamy-bohr-x6gs4e` in sync. Push every finished, rendered milestone
  right away ("do the commits into github a little more often"); tell the user the commit ids.
  7 Nov (new account): "yes push to main too"; also push the session's own branch. "I need as many commits
  as possible to my repository... keep pushing all the changes so I get more commits on my account": commit
  each small working step separately (one logical change per commit) and push after each.
- Visuals must be "very good/top notch" everywhere; the X posts in docs/claude/HISTORY.md (studied in
  docs/visual-references.md) are the bar: "they are really important for visuals... dont forget about this".
- The fruit bushes (forage, where fruit is picked) look bad: rebuild them. Higgsfield films disliked: new approach.
- 7 Nov, VISUALS FIRST: "I'm just doing the browser thing temporarily just for testing and I want a game with top
  notch visuals the browser one is not so important". The browser/Claude-app preview is a test harness; the target
  is a desktop game with top visuals. High/Ultra may cost what a good desktop GPU (RTX 3070/4070) can carry; keep a
  Low path working for the Intel UHD preview, still measure frame time, but do not trade looks for the laptop.
  The user will judge this round of changes; if they don't like them they may move to another engine.
- Grass (and similar) "still looked like low quality 2D papers": no flat cards. Real curved, tapered blades with
  thickness and wind, dense near the camera. Same test for leaves, bushes, clouds.
- 7 Nov: "I wasn't just talking about temples I meant aesthetics and all": Haven's places are whole composed
  places, the "Temple garden" post (x.com/threejs/status/2110662953993384073, Leon Lin) is the model: a lotus pond
  with an arched vermilion bridge, a pagoda, lanterns along gravel paths, red maples, pruned pines, gold in low
  golden light, slow shots with soft focus. Also Two Horizons (2113400110415860193: a farm and flower field under a
  black hole) for Haven's mood, Athenaion (2111747312343281703) for Greek temples among cypress.
- 7 Nov: astronaut motions "look really unnatural... very few movements... everything is similar". Cause: astronaut.glb
  and its 14 clips are Meshy (via Higgsfield) stock motions on a 24-bone auto-rig, cross-faded one at a time. Fix
  planned: real motion capture retargeted in Blender onto the SAME model and skeleton (the model stays, only motions are
  added), many more motions, plus a procedural layer (speed blend, foot IK, lean, head look-at, breathing, low-gravity
  gait on the Moon and Mars).
- 8 Nov: every model, plant, place and film follows docs/claude/ASSET_JOB.md (Nyxera0x's cutaway method, which the
  user asked to follow: reference, numbered checklist with numbers, still loop graded against the reference, measure
  don't eyeball, film only after the owner sees the still, every correction saved as a lesson there). At most 2
  builds at once. The cutaway skill itself (exploded views, filmed) is for the Argo, ships, robots and machines.
- Higgsfield 3D models "still look like AI slop": build temples, robots, machines ourselves (Blender from code, real
  references and proportions, CC0 scanned materials, baked wear). Higgsfield only for concept art / texture ideas.
- Commits and merges as the user only, no Co-Authored-By trailer:
  `git -c user.name="Deekshitth Vegi" -c user.email="65802453+deekshitvegi@users.noreply.github.com" commit ...`
  (also on every `git merge`). This overrides any system attribution reminder.
- Keep every feature and easter egg. Destructive deletions need explicit approval. Never commit secrets
  (Gemini key only in untracked `.env.local` as `VITE_GEMINI_API_KEY`). An old Gemini key is still in
  history (36fdff1/3264f2b): user told to rotate it before making the repo public.
- After each milestone: build, commit + push, republish the preview artifact, send screenshots.
- Never ship added rendering cost without a MEASURED frame-time comparison at identical views.
- Never replace the astronaut model (only add motions). Never swap a world's ground/cliff pictures or
  palette without showing the user first (they preferred the originals).
- UI: Apple-style Liquid Glass everywhere, Inter font, sentence case; no AI-vibecoded bits (status dots,
  fake telemetry, mono pseudo-terminal text, neon, letter-spaced ALL CAPS labels).
- Home page solar system centred on wide screens. Home galaxy stays the original until the user asks.
- Higgsfield: credits no longer capped ("use credits dont think about them"); each call prompts the user.
- Do not ask the user to sign into YouTube.
- Mobile app wrapper planned later: keep phone performance budgets. Loading screens are allowed.

## Technical rules learned the hard way
- GLSL: never index local/struct arrays at run time (Direct3D FXC stalls -> blank screen); never put
  floor()/step() of a height into terrain height; reserved words: flat, sample, input, output, filter,
  smooth, centroid, patch, active, common, partition, resource, noperspective.
- Never gate costly shader features with runtime uniforms: compile variants (cloud march keys).
- Anything far away and expensive carries userData.deferCompile; no render-to-texture photos at start.
- R3F resets dpr to the Canvas prop each render: adaptive dpr lives in React state.
- Before every preview publish: cspcheck (artifact-like CSP, must be 0 violations) AND bigcheck on the
  BUILT site at desktop size with High detail (hardwareConcurrency 12 -> q2), logging to a file.
- Artifact host: no .glb (use .glb.b64.json via VITE_MODEL_PACKING=json), CSP connect-src 'self',
  no WebAssembly. Before nulling old bundles in a new session the tool may require reading them.
- Headless tests: SwiftShader is slow; use frame-count waits; the HUD lags one frame (wait for the
  DOM); cards that last N real seconds may be gone by screenshot time. Never `pkill -f` a pattern
  contained in your own command; kill by PID. Dev servers need their own Vite cache dir per worktree.
- Motion (c770774): universe frame -> game = M u + d; the anchor world stays at its START position
  unturned; points laid out on worlds are in the start frame (fromStart/turnFromStart/turnWithWorld);
  universe objects pinned (pinPoint/pinDirection/pinTurn). DEV `?still` holds the clock for old evals.
- World ids are portfolio sections: Mercury education, Venus experience, Earth projects, Mars skills, Jupiter research,
  Saturn beyond, Uranus freelance, Neptune certifications (moons use their own names). fly-lab ?start=earth is special.

## What the user asked for (open items, newest last)
- Visuals like the reference videos (jurlycat No Man's Sky-like; just_a_techy grass/forests; maxt3chno
  lagoon): realistic grass, many tree species, forests, mountains, water, shadows (#58, partly parked:
  shadow maps / grass tufts were reverted for cost — must be measured before shipping again).
- Real solar system, reachable Sun, all major moons + Pluto/Charon (done); planets revolve/rotate in
  real time with time warp (done).
- Gas giants: distinct interiors (done d2f580b), real storms/cyclones (done), Uranus/Neptune rings.
- Weather: random, evolving, winds that push (done 1d9f655); storm warnings + shelter (done).
- Survival/story like RDR2, Tomb Raider, GTA, God of War, Chase-dies-in-space videos, Martian,
  Interstellar...: medals, challenges, vaults, expeditions (done below), aliens' story (#84, part done).
- Home page: better galaxy/star systems/TON 618 later (galaxy reverted to original at user request).
- Lag on PC: fixed (92d0e57, a66377f, eb10b6b GPU detection); deployed on deekshitvegi.com (Hostinger).
  Offered a GitHub Action `live` branch for auto-deploy: not set up unless asked.

## Shipped (oldest first; newest at the bottom of this file: main = claude branch = f0bfe6c on 6 Nov)
- d2f580b giant interiors; c770774 real orbits/spin/time warp; d802aa2 Inter + glass HUD
  (package.json gained @fontsource-variable/inter: `npm install` before building).
- c926c12 story mode: argo.ts/Argo.tsx (ARGO subtitles with real numbers), expeditions.ts, deaths
  counted with cause + death card, J log Expeditions tab.
- 03559d6 + 42d6b60: 8 expeditions — jupiter-deep, venus-venera (127 minutes), saturn-cassini,
  sun-parker (Helios 2 0.29 AU / Parker 0.0459 AU / 5 M km), moon-1972 (forced X-class flare at
  Tranquility Base, medal by dose), mars-depot (Three Forks vs a forced dust front; forceWeather
  `arrive` seconds sets its pace — a far start put it half way round small Mars), io-plume (Galileo
  2001 plume flythrough, Volcano.tsx ventUp), neptune-spot (dive under the dark spot). ExpeditionDef
  .target -> gold HUD marker. contact.ts "first words": aeronauts (radio on hydrogen line, E sends 13
  pulses), Europan (torch flashes), Makers (needs 18 glyphs); Story tab "What they told us" decodes
  as glyphs are learned; chapter bonuses. Markers behind the Sun / deep in giants hidden.
- PREVIEW (second account, from 7 Nov): https://claude.ai/artifact/CWGQyhLzPfprRkdnnaMi7a — version 6 = c229803 (8 Nov; v5 = 792274a, v4 = 4a0dec0, v3 = ec39d06)
  (uploaded in 3 parts: the host takes <= 64 MB and <= 255 files per publish; sources must sit under the scratchpad,
  so copy /tmp/rewild/site there and pass `root`). Files and sizes as published: tools/claude/published-preview.txt
  (lines "path size"); use filesdelta.py against it for a delta publish.
- OLD PREVIEW (first account only, not editable from the second): https://claude.ai/artifact/HTkaQLR6kVXmTCcTpfmwS6 — version 50 = f0bfe6c (6 Nov; delta list $SP/published-v50.txt, lines "path size"; after a restart, list the files before publishing).
  Built with `VITE_MODEL_PACKING=json npx vite build --base ./`, then glTF -> .glb.b64.json packing;
  the page file has no doctype/html/head/body. Tools: tools/claude/ (prep_site.sh, cspserve.py,
  sitecheck.mjs, filesdelta.py); published-v50.txt was not kept: list the artifact's files before a delta publish.

## Session 29 Oct 2026 (in progress)
- f5463d4 perf: baked nebula cube (SKY_SWITCH; per-pixel only by TON 618), SKY_COVER hides backdrop/stars/planet
  points inside a giant's haze; decks one-sided + 192x96 + texture noise (noiseTexture.ts: 64^3 periodic volumes,
  tnoise4/tslope via textureLod — never texture() in loops/branches, FXC); Depths mounts early + compileAsync
  (unhide for the call: compile skips invisible); terrain texture noise, TERRAIN_AIRLESS skips haze, Low grid 16
  split 1.7; mapLoader.ts createImageBitmap (Low maps 2048 wide). SwiftShader numbers: Jupiter in 1305->220 ms,
  Earth landed 5.2->2.8 s, Moon 4.2->2.2 s (640x360 q0). Black frame or two right after a test teleport into a
  giant happens in old and new builds (compile), not a regression.
- 3373caf realism: moons at real distance in host radii (SYSTEM_SCALE = KM; squeeze removed; Sun still 4x);
  lunar-Lambert regolithLight for airless far globes; runtime.nightEyes/nearGround, uEyes gain (NIGHT_EYES_GAIN 7);
  night extinction 0.8 vs 3.2 by day (Atmosphere.tsx); PlanetPoints.tsx (magnitudes, Mallama phase curves);
  nebula faint from the ground at night, sky black on sunlit airless ground; hold Z / touch Closer = 11 deg FOV.
- Test tools in $SP: frame.mjs (place+time+canvas), views.mjs, solo.mjs (each drawable alone), variants.mjs
  (shader edits), probe60.mjs, bench.mjs (groups, only:true), peek.mjs (below: deg), list.mjs, evals/skyview.js
  (seeded), evals/mags.js, evals/eyes.js. Base worktree $SP/base on :4188 needs vite.base.config.mjs (own cacheDir)
  or React/three load twice.

- Story (uncommitted at time of writing): story.ts STORY_FINDS (trail-phobos/titan/enceladus/iapetus + europa-crevasse
  'cracked ridge'), StorySites.tsx (fromStart/turnFromStart placement, found card + ARGO + next hint), JupiterFloaters.tsx
  (+3 hunters, Higgsfield 29 Oct job 2a328e0f), OrbitDebris.tsx (DEBRIS orbit 1600 u, 100 min, fragments solid),
  EnceladusGeysers.tsx; expeditions phobos-monolith, earth-kessler, enceladus-plume, iapetus-seed (12 total);
  Story tab 'The trail'. Iapetus dark face is lon 90 in directionAt (not 270). Pits can't be cut into heightfield terrain.
  Editing src while a headless render runs makes Vite reload the page (Execution context destroyed): wait.
- Preview tooling rebuilt: $SP/prep_site.sh (build + hf/tools/pack.mjs meshopt-decode -> .glb.b64.json + page.html),
  cspserve.py (port arg), sitecheck.mjs (label W H detail seconds port), filesdelta.py site published-v38.txt.

## Claude Code skills (user asked 30 Oct 2026: "install all these skills too and use them wisely and properly")
- 36 vetted skills in ~/.claude/skills (container-local, lost when reclaimed). Reinstall with
  $SP/install-claude-skills.sh (pinned commits, tested: identical tree). Offered to commit it as a SessionStart hook.
- Use them where they fit; this file's rules win on any conflict (e.g. measured frame times, Liquid Glass UI):
  lag work -> performance-optimization, threejs-scene-setup/-materials-lighting/-gltf-loading, shader-programming,
  diagnosing-bugs; terrain/worlds -> procedural-gen, level-design; ship/astronaut -> game-feel, camera-systems,
  input-systems, physics-tuning; HUD/panels -> game-ui-ux, make-interfaces-feel-better, frontend-a11y; ARGO/contact ->
  dialogue-systems; stats/progress -> save-systems; expeditions -> survival-crafting; Higgsfield assets ->
  create-game-assets; React/TS/Vite -> react-patterns, react-performance, typescript-patterns, vite-patterns;
  before pushes -> verification-loop; always -> karpathy-guidelines; video/trailers -> ffmpeg-skill;
  docs diagrams -> diagram-design; decks -> ppt-master; also tdd, codebase-design, prototype, grilling, grill-me,
  wait-what, writing-for-agents. Aliens/creatures/colonists -> game-ai, ai-behavior-trees-utility-ai; quests/stats
  -> rpg; store builds -> steam-publish, itch-publish; HUD/menus -> also ui-ux-pro-max (its suggestions lose to the
  Liquid Glass rules); exploded views of ships/machines -> cutaway, teardown.
- Skipped on purpose: claude-mem (hooks on every tool call, spends plan usage on summaries, memory lost with the
  container), the rest of ECC (314 skills + hooks/MCP/agents), mattpocock code-review (clashes with built-in
  /code-review), research (spawns background agents), handoff (writes to /tmp), git-guardrails (hooks would block
  pushes), tracker skills. Not skills: VoiceStudio (local voice app), God's Eye View (3D globe app), See-Through-Walls
  (AR demo), REA (reverse-engineering MCP), Paperclip (agent-management app).

## Session 30 Oct 2026
- Skills hook committed (38c558b, 78026bc): .claude/settings.json SessionStart -> .claude/hooks/session-start.sh (cloud
  only, hash-skip) -> install-skills.sh (pinned commits, 49 skills incl. unslop, 10 anti-slop writing skills, Appllama x2).
  Appllama MCP (https://mcp.appllama.io/mcp) needs sign-in: user must add it at claude.ai/customize/connectors.
- User: "the UI you built looks like AI slop in all device ratios and it's not even properly responsive". UI rules now:
  components/expedition/ui.css is THE design layer (loaded after expedition.css + hud.css). Direction (unslop): flight
  deck at night; quiet ink glass, text roles --t1/--t2/--t3, ONE accent --sun (#f2c46b) only for what you head for
  (current chapter, target, medals, done objectives); semantic --warn/--bad/--good only; keycaps on desktop only;
  type scale 12/13/14/16/20/24/28 px, weights 500/600, no text under 12px anywhere (phones sideways show LESS, never
  smaller text); no coloured glows (dark 1px edge instead); radii: keycap 5, controls 10, rows 12, cards 16-20,
  panels 24; capsules only for toolbar, segmented tabs, prompts. Touch buttons: lucide icon over label.
  User's Liquid Glass rule wins over unslop's "no glass". Test: $SP/uishots.mjs <outdir> [viewports] [panels].
- User plays in the Claude app (artifact preview), not a browser. Asked for the FPS readout text again.
- True-size Sun: AU = 282M units (was 68M, Sun looked 4x too wide); SPREAD scales the pulse-drive cap; camera far 1e11.
  User wants to SEE it first: render + preview before pushing to main.

## Session 31 Oct - 1 Nov 2026
- Sun at true size pushed to main (675ce8f). teardown skill added to the hook (9849521).
- HUD: user disliked the quiet unslop look "for a game". Mockups: A cinematic, B cockpit, C game glass, then blends
  E cockpit glass / F glass with instruments ($SP/hudmock/mock.html, shoot.mjs). User picked F (said E in the
  question, then "I liked f glass with instruments"). F = rounded frosted glass, amber (#ffb547) tab strip on
  cards, real-world badge on the chapter card (public/textures/badges, badges.ts), diamond objectives (next one
  amber), 10-step segment meters (CSS mask), speed dial bottom centre on desktop (log scale, amber on pulse),
  icon tiles for cargo (lucide), amber round keycaps on prompts. Liquid Glass rule stands; unslop rules still
  apply inside it (no glows, no gradient orbs, one accent, nothing under 12px).
- Stargaze (@Stargaze_youtube, 148 videos): YouTube bot-checks this machine for video; never circumvent and never
  ask the user to sign in. Used public thumbnails + hq1/hq2/hq3 frames ($SP/stargaze/review/sheet-*.jpg).
  Findings and the work order in docs/stargaze.md (8d6dd2c): eclipses + corona, backlit haze rings, Titan blue
  haze + rain on canopy, ring-plane boulders, ice grains in giants, Triton geysers, Europa vents.

- Eclipses (2136a79): eclipse.ts sunCover(eye, exclude current body) -> runtime.eclipse/runtime.sunlight; daylight *= sunlight;
  surfaceShading sunlightOf(body) = ONE shared uSunColor uniform per world (terrain, grass, trees, props, clouds, sky);
  setSunlight dims only the current world. Sun.tsx corona uEclipse (only when ratio >= 1). Totality expedition at
  0.94 of the Moon's umbra (ratio 1.064). From the ground at mean distance it is annular (Moon 0.2633 vs Sun 0.2665 deg).
  Next: elliptical lunar orbit for real totality on Earth; backlit haze rings. Test: $SP/eclipseframe.mjs + evals/eclipseview.js.
- User's PC: Intel UHD (integrated), Low, Resolution 100% = 2105x1478, 25 fps in the Claude app. Auto would draw ~1.7 MP.

## Next (not started)
- #84 more of the aliens' story (Titan colony, Jupiter floaters, Enceladus vent life, the signal chain
  leading to the Makers); more expeditions (Europa under the ice, Titan wings over Kraken Mare, Phobos
  escape speed, Mercury terminator, Earth-orbit debris).
- #58 landscapes (measured), #76 Uranus/Neptune rings polish, #41 home page graphics when asked.

## Session 1 Nov 2026 (later)
- 6578f1c: N = music, B = sounds (separate buses; music reverb send fixed); uphill jump fix (walking.ts:
  jump carries the slope's climb; ground catching a rising jump is not a landing; test $SP/jumptest/jump.ts);
  only the course + marked worlds carry markers (Mark button in the system map, L shows all); world labels are
  descriptors (Planet, Moon of Saturn), no portfolio sections in the game; key hints fade after 8 s (H shows).
- 75e9cb9: backlit haze rings (Atmosphere.tsx backlit HG term; biome.backlit {tint,g,gain,deep}).
- 164a879: skyScale.ts (small worlds 2 deg from the ground, true size near the Sun); clouds shaded as heaps,
  Earth cover 0.36; Titan clearSight 0.25 (Saturn through the haze and deck), Titan cloudCover 0.
- 7349a58: docs/story.md, the new story (Rewild working title): Haven by TON 618 (1 day = 10 years), crew of
  four (Dev Arora, Noor Haddad, Kai Mendes, Amara Okafor), Earth recovery 0-100% in stages, Seven Seeds,
  chapters, ARGO assistant (offline + optional server LLM). Portraits/key art in $SP/story/raw (Higgsfield
  1 Nov, nano_banana_pro). User said: the game ships separately (Steam, App Store, Play Store) and on the
  website; nothing in it should be about the portfolio. Higgsfield credits (7094 on 1 Nov) expire in a few days.
- Possible "small bar always on screen": the 2.2 km light beams over data sites (DataSites.tsx) - ask the user.
- Test tools added: $SP/skyframe.mjs (evals/skyview.js), covers.mjs/coverspx.mjs (what covers a pixel),
  poke2.mjs, uniforms.mjs, sheet.py (contact sheets).

## Session 1-2 Nov 2026 (crew + Argo) — 9a0eb59 on main and claude branch
- USER RULE: the four crew ships must NOT merge into one ("I didnt say those 4 dock into 1 big ship"). What they
  want: a very big ship in space that a single ship docks into, and only that big ship can travel through the
  wormhole (Interstellar's Endurance idea). Built as the Argo (mothership.ts, MothershipView.tsx, argo.glb, Tripo
  879b4e0e from image 7abb6fa3; MODEL_TURN y=pi; bay (0,0,-166); 320 m; waits 4200 u over the landing site, held in
  Earth's frame). U docks at the bay (<160 m, <60 m/s, 4 s run-in) -> live ShipState becomes hers; U undocks.
  Docked: agility 0.35, camera (0,175,430), floor 1800 u above ground, F/autopilot landing blocked. Wormhole gate in
  Player: lone fighter pushed back at 1.35 x mouth radius with a notice. Names: the Argo is the Halcyon's tender;
  ARGO = her mind; the ark Halcyon stays at Haven (lands at Earth's 'Home' stage).
- Crew (crew.ts): 4 members each with own fighter (Held: ship/walker/home/parked; park/unpark = world frame), other
  three parked beside the start ship (START_OFFSETS), keys 1-4 switch (blocked while docked to the Argo), CrewFleet
  draws parked ships + crew on foot. Portraits public/textures/crew (prep_site.sh now copies textures/crew).
- Tests: $SP/halcytest.mjs (dock/undock/gate/crossing), crewtest.mjs, argoshots.mjs. Measured start view: same frame
  time, +2 calls, +10% tris. NEVER pgrep -f a pattern in a wait loop's own command line (loop never ends); wait on a
  PID. ANY file edit in the repo (even docs/*.md) reloads dev-server test pages.

## Session 5 Nov 2026 (visual quality: trees, water edges, grass)
- User: trees' leaves look bad ("you dont know how a tree looks? ... look at them"), grass/clouds look 2D, far river
  banks are sawtooth, use Blender. Outer Wilds is a reference for structures.
- Trees now made in Blender: source_assets/trees (maketree2.py presets + textures.py + treepack.mjs + pictures/,
  README has every command; seeds 7, deadTree 11). Forms: broad, excurrent (birch/aspen/poplar), weeping (arches
  + strand curtains), conifer (spruce/cedar flat sprays lit as layers; pine tufts), bush, dead. Last twig level has
  no tube (sprays carry stems) to keep tris near the old trees (oak ~15k, spruce ~30k). Blender 4.2.9 at
  /opt/blender-4.2.9-linux-x64; create the colour attribute BEFORE fetching UV layer data.
- trees.ts: leaf cards seen edge-on thin away (face normal from dFdx/dFdy), also in the impostor bake.
- Water edges (earth.ts gRiver global + PlanetTerrain vRiver): painted from the signed river field and shore
  distance per pixel; the corner depth is 0 on every dry corner and drew far banks as teeth.
- Grass.tsx: tufts of 3 thin folded blades (same vertex count), per-blade tint incl. straw, root shade, sheen.
- A/B harness: $SP/abA (HEAD) :4188, $SP/abB (+trees) :4189, $SP/treeview.mjs (landed, ?revival=1, 4 ways + 35 m).
  SwiftShader Earth q2 400x225 ~20 s/frame: keep settle frames low.
- Next: volumetric-looking Earth clouds (CloudVolumeEffect layers exist for storms/giants), ruined-Earth ash vs dry
  comparison for the user, Earth scale/speed question, approach freezes.

## Session 5 Nov 2026 (later): water, reflections, graphics effects
- Water: WaterSurface.tsx (disc of rings, NEAR 1600 m, CEILING 2500 m) over the bed PlanetTerrain sinks inside uWaterNear;
  seaWaves.ts breakers (JS mirror for the swimmer, SEA_CLOCK); diving (walking.ts walker.dive, X down / Space up);
  UNDERWATER uniform drives fog in applyHaze; ship downdraft uShip. Test: $SP/beachtest.mjs, $SP/divetest.mjs.
- Settings › Graphics › Effects (graphics.ts FeatureSetting/Features, resolveFeatures, featuresKey in the scene key):
  clouds flat/3D, water simple/detailed, grass off/light/full, reflections sky/mirror. Auto follows the detail level.
- Mirror (WaterSurface.tsx): Reflector-style planar mirror drawn in the water mesh's onBeforeRender (this frame's
  positions), oblique near plane at the water, once per scene render (renderer.info.render.frame), half-res HalfFloat.
  Only with the effects pass (Medium/High): drawn straight to screen (Low) every material would compile a second
  program (no tone mapping/linear output into a target). Objects with userData.noMirror go on NO_MIRROR_LAYER 2
  (grass, speed streaks); the main camera enables layer 2. Test: $SP/mirrortest.mjs (REFL=mirror|sky, PORT).
- GPU probe asks for powerPreference high-performance like the game's canvas. User's laptop: RTX 4070 but the Claude
  app runs on the Intel chip (Windows per-app graphics setting); PC RTX 3070 runs well; phone iPhone 15 Pro Max.
- 5 Nov (late) user: clouds "not even 1%" good -> rebuild. Candidate: @takram/three-clouds 0.7.6 + three-atmosphere 0.19.1
  (MIT, peers satisfied: react 19, three 0.181, fiber 9, postprocessing 6.39, drei 10); they assume real-size Earth
  (atmosphere LUTs at 6360 km): game Earth is 12,000 u radius (1 u ~ 531 m across the globe, 1 m underfoot).
- User asked: Texas->LA ping reads 4.5 ku (real ~2,000-2,400 km); asked whether that is right (scale question open).
- Lag "a lot": laptop RTX 4070 runs Claude on the Intel chip. Store launch question (Steam/App Store/Play Store).
- Hostinger zip delivered: releases/deekshitvegi-hostinger-2026-11-05-1e1c046.zip (git-archive build of 1e1c046,
  base /, normal .glb). releases/ is NOT ignored (only releases/verify-*): keep zips in $SP/releases. Upload: public_html, extract.
- Haven: user loves it; wants many humans, touchable objects, doors, enter domes, Type 1 civilisation cities;
  breathable scientific air (N2/O2, ~1 bar). Magical planet: wanted. War story: another intelligent species holds
  ruined Earth (visit but cannot stay), win Earth back in a war, recruit alien allies from other worlds.
- Cloud lab (takram): lab/cloud-lab.tsx (test shots, $SP/cloudlab.mjs: views, SKIP1B, ONLY) and lab/cloud-play.tsx
  (interactive; built standalone from $SP/cloudplay with its own vite config, base ./). Published for the user:
  https://claude.ai/artifact/JRbVCvz8tomm6hD8VarebD (v1). Needed: AerialPerspective `defines.set(
  'USE_LOGARITHMIC_DEPTH_BUFFER','1')` + setChanged (three adds no log-depth define to postprocessing materials:
  ground came out black); NaN guard patched into cloudsPass.resolveMaterial.fragmentShader at runtime (a big camera
  turn left NaN motion vectors that spread as black patches); 3D textures shipped as .b64.json (host serves no .bin),
  built as Data3DTexture (R8, shape 128^3 linear, detail 32^3 linear, stbn 128x128x64 nearest, repeat, NoColorSpace).
  Precomputed sky tables are generated at runtime (no 24 MB download). Real-size plan: $SP/real-scale-plan.md.
- Trees (user, screenshot of ruined Earth): "tubes and cylinders". Cause: dead trees = living models minus leaves/impostor
  (twig level only lives in the sprays -> bare thick limbs), taper only to 28%, smooth wobble; far dead trees dither out
  with no impostor -> dots. Fix: dead-tree models with twig geometry + charred bark + their own impostors; taper to tips.
- 6 Nov user: dislikes the aurora look; Haven has no oceans/lakes/rivers/waterfalls -> make Haven really
  beautiful, with shrines and temples; split the game into two systems (our Solar System / the black hole one),
  loaded separately, with a video of going through the wormhole as the loading screen ("what do you think?").
- Trees shipped: 88d5e2c + 884bd8d (main = claude branch). Measured ruined + recovered forest A/B ($SP/treeAB):
  same or faster on all 10 views; ruined tris 7.5M -> 7.3M (dead trees draw no leaves), recovered 7.5M -> 8.1M.
- User picks (6 Nov): Haven temples = a mix from many cultures (Indian temple, Japanese shrine, Greek colonnade...);
  wormhole loading video = try both (render from the game AND Higgsfield cinematic), user picks.
  Order proposed: 1 split systems + wormhole video, 2 Haven water + temples, 3 aurora, 4 real-size Earth + clouds.

## Session 6 Nov 2026: two systems + the film of the crossing (#56)
- region.ts: 'sol' | 'ton'; only the current system is mounted (ExpeditionWorld/DeepSpace/PostEffects/Player take
  `region`). RegionWatch reads it from runtime.player.ship.position (any teleport switches it); onCross shows the film,
  swaps the region 450 ms later; RegionGate (loads settled -> compileNear -> CompileGuard holds 0) -> ready; the film
  clears runtime.loading as it fades. Transit held at TRANSIT_HOLD 3.2 s while loading (far side opens ~4 s).
- WormholeFilm.tsx: public/films/wormhole-<game|cinematic>-<out|home>.{webm,mp4} (VP9 / H.264 picked by canPlayType;
  headless Chromium has no H.264). Fetched only once the Argo is docked.
- saturnStandIn.ts: Saturn for the far mouth's home photograph out by TON 618 (only visible during that photo).
- exitMouth guard (Player.tsx): the Argo re-crossed at once (old builds too): chase cam 430 m behind is inside the exit.
- Measured (SwiftShader 640x360 Low): Haven start 18.9 -> 16.7 s to open, programs 81 -> 64, calls 83 -> 73; Earth same.
- Tools: $SP/loadtime.mjs (window.__compiledAt hook = CompileGate done), crosstest.mjs, bouncetest.mjs, mouthview.mjs,
  filmcap.mjs (virtual clock: rAF/performance.now/Date.now replaced; frames read in the same task as the render).
  Baseline copy $SP/abS0 (884bd8d + __compiledAt hook) on :4188; repo dev server :4187 ($SP/vite.repo.config.mjs).
- Higgsfield cinematic: seedance_2_5 jobs bb0864a2 / edb120ac (8 s 1080p, no audio). User picks game vs cinematic.

## Session 6 Nov 2026 (later): the films (#58) — f0bfe6c on main and claude branch, preview v50
- User: films of the crew talking / on the radio, the wormhole inside like Interstellar (original, not copied), an opening film
  after Begin expedition, loading bars on both; "do it with seedance 2.5 I dont want the video to look like AI slop".
- films.ts (FILMS + cues, filmUrl webm/mp4, readCrossingFilm 'crew'|'quick', openingFilm by story progress), FilmPlayer.tsx
  (bar never backwards, captions, Skip/Enter once ready, holds last frame with no caption, volume = Settings master),
  film.css, WormholeFilm.tsx (crossing; LoadingCard for no-film switches), ExpeditionLaunch.tsx OpeningFilm.
- Films = Seedance 2.5 omni_reference clips (jobs in public/films/ATTRIBUTION.md). Seedance RE-VOICES every line (no waveform
  match with the reference audio) and once garbled ARGO's long line; ARGO is off screen, so Seedance's ARGO is muted and
  the recorded ARGO lines laid over (one voice everywhere). Clip C had the crew fading in over empty seats for 3.9 s: cut.
  Tools: $SP/film2/assemble2.py (cut, loudness match -18 / ARGO -16.5 after its filter, radio stretch, bed), install.py
  (copies films + writes cues into films.ts), $SP/stt venv (faster-whisper small.en: sttbin/stt.py, sttw.py, sttv.py VAD).
- Tests: $SP/openingtest.mjs <out> new|returning, crosstest2.mjs (FilmPlayer version), autoplaytest.mjs (no autoplay flag:
  plays with sound after the click). Headless screenshots can show a stale video frame while SwiftShader stalls.
- Not deleted (needs the user's OK): public/films/wormhole-cinematic.* (no longer played).

## 7 Nov 2026: moved to a second account
- User bought Claude Max on another account and continues there. CLAUDE.md, lab/ (minus lab/trees/*.glb
  comparison models) and tools/claude/ were committed so the new account has the context and tools.

## 8 Nov 2026: shipped on the second account (main = claude branches)
- Haven: sea in basins (ce6d912), tarn + stream + waterfall gorge (89a1eee, streams.ts), Waterfalls.tsx (4393b1b),
  glints + stream flow (1812566), building pads (e32d815), Lotus.tsx (677517d), Greek temple on the bay headland and
  torii in the tarn (1511ea1; models from source_assets/temples, merged bca33bb). docs/visual-references.md (f40abd7).
- Explorer motions (merge 66703a9): CMU mocap + Quaternius UAL (CC0) retargeted onto the SAME astronaut.glb rig by
  source_assets/astronaut (README), 24 clips, speed-blended gaits, foot IK, lean, look, breathing (astronautRig.ts);
  walking.ts: gentler grip/turns, speed scales with sqrt(gravity) (Moon 3.5 m/s). Weak spots: the default W pace
  is mostly the hand-keyed sprint; the lunar lope is a retimed jog; no start/stop/turn clips; fall/climb/sit/eat
  still Meshy.
- Grass rebuilt (merge fdd8008): real curved tapered blades in tussocks on 2 m tiles drawn in rings (Grass.tsx), one
  gust field for grass and Earth's meadow driven by runtime.weather.wind (windField.ts). Low costs the same or less;
  Medium grass-only +54..79%, High 2.5x (about 2% of a SwiftShader frame at Medium). Weak spots: gusts subtle, no gust
  tint on Haven's ground, no midrib under 0.5 m, Haven blades a bit greener than its teal ground.
- Haven garden (de14575): gate (west shore) -> torii (in the tarn) -> honden (south-east shore) on one line facing
  TON 618; 8 stone lanterns; Nagara temple on its terrace (models 4f19a23, 7d6a2eb, e8b4d42). mapMark(x, y) places
  landmarks in map metres; `exact` keeps one beside water. Treading water no longer a T-pose (39bcd0e).
- 8 Nov later: shrine garden complete (pagoda on the tarn's north shore, gate at (100.8,-312.4) on the gate-torii-hall
  line, drum bridge over the outlet stream at level 45.2 with hanging lanterns; kund packed, not placed: needs a
  square sunken pad and its own water). Far trees: a picture from above on a card across the crown (c4cbffc) and
  soft ground shadows (4a0dec0). Recovery: model downloads retried (2b57c7c), scene rebuilt after a GPU reset
  (bd60e83), compileSafely replaces three's compileAsync (792274a: a disposed material made its promise hang).
  Waterfall foam shaded (e83b8db); lotus NaN fixed (956dc6b). Cliff teeth by the falls: the terrain grid cannot draw
  a sheer 45 m drop; needs rock-face models (not started).
- Fruit bushes and garden trees (plants agent, merged 8 Nov): source_assets/forage (makeplant.py bpy, pictures.py,
  plantpack.mjs; six plants, near model `body`/`fruit` + far `bodyFar`/`fruitFar`, dissolve 7-11 / 14-20 / 22-30 m by
  detail level), Forage.tsx rewritten (gameplay unchanged), lab/forage-lab.html; maketree2.py forms tiered (Japanese
  maple), niwaki, cypress; garden layers in propPlacement.ts (MAPLES, PINES, CYPRESSES; landmarks may name `variant`);
  lakes/pads take `garden` (no wild trees within that many metres). Cost at Medium: +2..12 draw calls, triangles
  -1.5..+3%. Weak spots: maples small from 50-70 m on foot, drawn (not photographed) leaf pictures, cypress uses the
  spruce picture darkened, desert/ice plants unseen in game.
- Temple bake queue: all baked and packed (8 Nov). finish.sh <preset> <file> <1024|2048> packs one (REPO env = target repo).

## 7 Nov 2026: first session on the second account (checklist results)
- GitHub: fetch works; push works to the session's own branch (`claude/youthful-wright-tgzy9w`, created at 46724b8).
  The cloud session is told to push only to its own branch, so pushes to `main` / `claude/dreamy-bohr-x6gs4e`
  wait for the user's answer on which branch to use (asked 7 Nov).
- Skills: all 50 in ~/.claude/skills (hook ran). grill-me, unslop-writing, wait-what are user-only
  (disable-model-invocation), so they do not show in Claude's skill list: expected. Anthropic skills present:
  docs, docx, pdf, pptx, xlsx, skill-creator, google-workspace, import-memory, morning. Missing (user switches on in
  Settings › Capabilities if wanted): canvas-design, algorithmic-art, theme-factory, web-artifacts-builder,
  mcp-builder, brand-guidelines, doc-coauthoring, internal-comms, deep-research, learn. (Browser/computer-use
  skills are desktop-app only.)
- Connectors: NONE on this account (no Higgsfield, Drive, Docs). User connects at https://claude.ai/customize/connectors,
  then starts a new session.
- Preview artifact HTkaQLR6kVXmTCcTpfmwS6: not readable from this account. User chose a NEW preview:
  https://claude.ai/artifact/CWGQyhLzPfprRkdnnaMi7a (see PREVIEW under Shipped).
- Tools: /tmp/rewild set up, npm install done, dev server on :4187, fly-lab `start=projects&landed=1&q=0` renders
  with no page errors (960x540 q0: 2.9 s/frame SwiftShader, 97 calls, 1.19M tris).
- User's answers (7 Nov, same day): push to main too; start Haven; publish a NEW preview (old one stays with the
  first account); delete wormhole-cinematic (done 157b468); replace the Higgsfield films with another approach;
  rebuild the fruit bushes; install every skill from the links again plus a UI/UX design skill and
  Nyxera0x/cutaway; asked whether max effort / ultracode / Blender MCP / Unity / Unreal would give better visuals.
- Higgsfield on this account: first a limited connector (no generation), then later the same day the full one
  (mcp__Higgsfield__*: generate_image/video/audio/3d, media_upload, jobs_wait...). Google Drive/Docs/Gmail too.
- New personal environment "deekshitthvegiportfolio" (env_01C1sqG8ACZ1ayUnEER3uhba) for this repo: allows
  api.fxtwitter.com, video.twimg.com, pbs.twimg.com, download.blender.org + package registries; setup script =
  npm install + /tmp/rewild tools (unproven until a fresh session starts on it). 8 Nov: api.polyhaven.com,
  dl.polyhaven.org, upload.wikimedia.org and commons.wikimedia.org added (CC0 materials; reference photographs).
- Network (Default env, limited): github git + npm + PyPI work; api.fxtwitter.com, api.vxtwitter.com,
  download.blender.org are blocked. Blender: `pip install bpy` (5.2.x for Python 3.13) works from PyPI.
