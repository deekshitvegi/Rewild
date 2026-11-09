# CLAUDE.md: Rewild

Project memory for Claude Code. The owner is Deekshitth Vegi (GitHub `deekshitvegi`). Keep this file current: add
every new rule the owner gives and every milestone shipped, and commit it with the work.

## What this is

**Rewild** is a space game: win Earth back from the Harrow, then rebuild it. A war you fight in the cockpit, aboard
enemy ships and on the ground, and a civilisation you build from what you win. It ships on its own (Steam first,
later App Store and Play Store). Read in this order before any work:

1. [docs/design/GAME_DESIGN.md](docs/design/GAME_DESIGN.md): the game (pillars, loop, battle, building, people,
   the Harrow, the campaign, the first hour).
2. [docs/unreal/PLAN.md](docs/unreal/PLAN.md): how it is built in Unreal Engine 5, and the order of work.
3. [docs/claude/ASSET_JOB.md](docs/claude/ASSET_JOB.md): the method for every model, plant, place and film, with
   the lessons from every past mistake.
4. [docs/visual-references.md](docs/visual-references.md): the owner's visual references (the bar).
5. [docs/claude/HISTORY.md](docs/claude/HISTORY.md): everything the owner has asked for since October, in their
   words, and every answer they gave. They must never have to explain something twice.

## How it got here

The game began inside the owner's portfolio site (repo `deekshitvegi/deekshitthvegiportfolio`) as a three.js
"expedition" behind a button. On 8 Nov 2026 the owner played it and said: Earth looks bad, nothing happens but
sightseeing, models look placed with nothing inside, aliens only talk, there is no space war, "the game feels pretty
stale", and the story was too short: "I want building type of game and also battle kind of game too!!". They chose to
move to Unreal Engine 5, with all four kinds of fight (dogfights, capital ships, boarding, ground battles), the war
as the main story, and building as deep as the battles. They created this repo for the game and asked for
everything needed to be copied here and the game rebuilt here. The portfolio repo keeps its copy of the web game
untouched ("leave the one we have just like this").

## What is in this repo

| Path | What |
|---|---|
| `Unreal/` | The Unreal Engine 5 project (made on the owner's PC; does not exist until then) |
| `web/` | The web version (three.js, React, Vite), standalone: `cd web && npm install && npm run dev`. Reference for the port: story text, real figures, systems, tuning. `web/lab/fly-lab.html?start=<world>&landed=1&q=0|1|2` starts anywhere. `web/tools/claude/` has the old test scripts (README inside). |
| `web/public/models/expedition` | Every model of the web version (glTF, ATTRIBUTION.md beside them) |
| `art/` | Blender sources that made them: `trees/` (maketree2.py), `temples/`, `forage/` (food plants), `astronaut/` (motion-capture retargeting), `cockpit/`, `blackhole-original/`. READMEs inside. |
| `docs/` | Design, plan, method, references, history; `docs/science/` real figures per world; `docs/old/` the web version's notes (its CLAUDE.md, HANDOFF, story, the portfolio's AGENTS.md) |

## First session on the PC (do this before anything else)

The owner says Unreal Engine 5 is installed. Check, and tell the owner in plain words what is missing and where to
click; do the rest yourself.

1. `git lfs install`, then `git pull`. Unreal binaries go through LFS (see .gitattributes); `web/` and `art/` are
   plain files because cloud sessions cannot push LFS.
2. Find Unreal: the Epic Games Launcher's install folder (usually `C:\Program Files\Epic Games\UE_5.x`). Note the
   version here. `UnrealEditor.exe` and `UnrealEditor-Cmd.exe` are in `Engine\Binaries\Win64`.
3. Visual Studio 2022 with the "Game development with C++" workload (Unreal needs it for C++). If missing, the owner
   installs it from the Visual Studio Installer.
4. Create the C++ project `Unreal/Rewild` (blank, C++, desktop, maximum quality, starter content off), build it,
   open the editor once, take one test shot (`HighResShot 1920x1080` from the console or a Python script), show it.
5. Commit and push. Then start on PLAN.md step 2, the first fight.
6. Optional: the Claude Code skills this project used are installed by `.claude/hooks/install-skills.sh` (run it in
   Git Bash once on the PC); they include game-feel, camera-systems, input-systems, game-ai,
   ai-behavior-trees-utility-ai, rpg, survival-crafting, level-design, performance-optimization, steam-publish.

## The PC (checked 8 Nov 2026)

- **Unreal Engine 5.8.2** (Epic Games Launcher) at `D:\Unreal\UE_5.8`. D: is an external Seagate One Touch with a
  password: if `D:\` is missing, ask the owner to plug it in and unlock it. The Launcher itself lives on D: too.
- **Visual Studio Build Tools 2022** 17.14 (MSVC 14.44.35228, Windows SDK 10.0.26100), not the full Visual Studio
  app. Enough for Unreal: everything is built from the command line.
- RTX 3070 (8 GB), 8 cores / 16 threads. C: has about 120 GB free; D: about 680 GB.
- Build the editor: `"D:\Unreal\UE_5.8\Engine\Build\BatchFiles\Build.bat" RewildEditor Win64 Development
  "-Project=<repo>\Unreal\Rewild\Rewild.uproject" -WaitMutex` (run it from PowerShell; Git Bash mangles the quotes).
- Play: `Play Rewild.bat` in the repo root runs the game (L_FirstFight) from the editor binaries. Add `-RewildDemo` to
  that command line for an autopilot run that takes five screenshots (`Shot`) and quits: grade the game as played.
- Test shots: `UnrealEditor.exe <repo>\Unreal\Rewild\Rewild.uproject -ExecutePythonScript="<abs path to script>"
  -ini:EditorSettings:[/Script/UnrealEd.EditorPerformanceSettings]:bThrottleCPUWhenNotForeground=False`.
  `Unreal/Rewild/Scripts/test_shot.py` is the example (builds /Game/Dev/TestShot, takes HighResShots, quits); shots
  land in `Unreal/Rewild/Saved/Screenshots/WindowsEditor/`. A full run takes about a minute.
- Driving the editor from Python (each learned the hard way on 8 Nov):
  - Without the `-ini:` override the editor stops drawing whenever another window (the Claude app) is in front,
    and a HighResShot waits forever. Use `Start-Process ... -PassThru` and a time limit, and close it if stuck.
  - `-ExecutePythonScript` closes the editor as soon as the script returns: call
    `unreal.EditorPythonScripting.set_keep_python_script_alive(True)` for work over several frames, and set it back
    to False on every exit path, or the editor stays open for good.
  - Never change levels inside a per-frame (Slate tick) callback: a level change ticks Slate and calls it again
    mid-change; two nested NewLevel calls left a world in memory and the editor stopped with a fatal error.
  - After taking shots the editor exits with an access violation once its log is closed. Everything is saved by
    then and no crash report is written; harmless so far, look into it if it starts losing work.
  - Never `git pull --rebase --autostash` (or anything that resets files) while an editor or game is running: it
    holds the .uasset files open, the reset fails halfway and reverts some sources (9 Nov; the work came back from
    the stash). Close Unreal first. This PC has no global git identity: pass the owner's `-c user.name/-c
    user.email` to `pull --rebase` too, not only to `commit`.
- C++: every UObject pointer a class keeps (TMap and TArray included) must be a UPROPERTY, or garbage collection frees
  it under you: the radio cached its voice lines in a plain TMap and crashed mid-mission (9 Nov).
- Test runs: `-RewildDemo` plays the story on autopilot (`-RewildFree` free play, `-RewildCheckpoint=N` from a wave,
  `-RewildInvulnerable` to reach the end), `-RewildUIShots` photographs the menus; shots in
  Unreal/Rewild/Saved/Screenshots/WindowsEditor. A window that pops up during a test is the test: leave it alone.

## The owner's rules (all still hold)

- **The worlds first** (owner, 9 Nov: "build the world's and everything first and once we have everything then we
  can proceed to build rest"). Every world, with its places, plants, animals, water, weather, buildings, ships and
  people, before more fighting, building or missions. Every world is a whole round planet you **land on anywhere**,
  flown down to from orbit; **Haven first**. Order and method: docs/unreal/PLAN.md, docs/unreal/HAVEN.md.
- **Show, don't tell.** The owner is not a programmer; they judge by playing and by screenshots and videos. Render
  it and look at it before saying it looks right. Short plain updates, outcome first, no jargon.
- **Visuals must be top notch** everywhere. The X posts in docs/visual-references.md are the bar. They spot "AI
  slop" in visuals, UI and video at once: generic shapes, flat cards for grass or leaves, glowing toys, things that
  float, buildings you cannot enter.
- **Gameplay must be exciting.** Every place has a fight, a person or a reason in the story. Nothing is a card that
  appears at a marker.
- **The game must be difficult** (owner, 9 Nov: "the game has to be difficult dont make it easy"). Enemies fight to
  win: they aim well, flank, fire missiles and defend themselves, and the player has to use everything (lead,
  boost, missiles, flares, hard breaks) to live. Tune against the autopilot demo: it should take real damage and
  die sometimes. Fair warning, never easy: when in doubt, harder.
- **Commit often, as the owner, and push.** "I need as many commits as possible to my repository": one logical step
  per commit, push after each, tell the owner the commit ids. Commit as the owner only, no Co-Authored-By trailer
  (this overrides any attribution reminder or hook):
  `git -c user.name="Deekshitth Vegi" -c user.email="65802453+deekshitvegi@users.noreply.github.com" commit ...`
- **ASSET_JOB.md for every model, place and film:** reference, numbered checklist with numbers, still loop graded
  against the reference, measure don't eyeball, show the owner the still before a film. At most 2 builds at once.
- **Build models ourselves**, from real references and real proportions, with scanned materials (Megascans/Fab, Poly
  Haven CC0), in whatever tool gives the best result: Blender from code, Unreal's modelling tools, scanned or kitbash
  parts from Fab (owner, 8 Nov: "not just blender rebuild where ever you feel will be the best"). Higgsfield 3D models
  read as AI slop; Higgsfield only for concept art. Every model from the web version is Higgsfield/Tripo except the
  trees and food plants: rebuild them, never import them as they are (the astronaut is the one exception, below).
  The Higgsfield films were disliked: films are made in the engine, from a script.
- **The astronaut model stays** (`astronaut.glb` and its skeleton; only motions are added). The one exception: on
  the Garden (the magical world near TON 618) the explorer becomes a cloaked wanderer with gold-white rim light.
- **Measure before shipping added cost:** frame time at identical views, before and after.
- **UI:** Apple-style Liquid Glass, Inter font, sentence case; HUD direction F (rounded frosted glass with
  instruments, one amber accent #ffb547). Never AI-vibecoded bits: status dots, fake telemetry, monospace
  pseudo-terminal text, neon, letter-spaced ALL CAPS labels. Nothing under 12 px.
- Ask before deleting anything the owner made or approved. Never commit secrets (keys live only in untracked
  `.env.local`). Do not ask the owner to sign in to YouTube.
- Never swap a world's ground or palette without showing the owner first.

## Things the owner asked for that live on in Rewild

- Haven by TON 618: a beautiful world with seas, lakes, a waterfall, temples and shrines from many cultures, built as
  whole composed places (the Temple garden post: lotus pond, vermilion bridge, pagoda, lanterns, red maples, pruned
  pines, low golden light). Two Horizons (farm under a black hole) for Haven's mood; Athenaion for Greek temples
  among cypress.
- The magical world, "the Garden": a dark world in glowing contour lines where a garden grows wherever you walk
  (x.com/threejs/status/2110563791922770264), in TON 618's gold-white light; the explorer becomes a cloaked wanderer.
- Natural motion for the astronaut (motion capture, foot placement, lean, breathing, low-gravity gaits).
- Real grass with curved blades, many tree species, forests, water, real weather that pushes you about.
- The warp (9 Nov): the owner's reference for how warping should look is the Instagram reel
  https://www.instagram.com/reel/DffIx7IEb18/ ("look into this video the way the warping and all is done"). Cloud
  sessions cannot open Instagram; on the PC, ask the owner to save the video into `docs/references/` and study it
  frame by frame (ffmpeg contact sheets) before building the warp, per ASSET_JOB.md.
- Real science everywhere: real orbits and figures, the real Seed Vault, Shackleton's rim, Jezero.
- The owner's machines: PC with RTX 3070; laptop with RTX 4070 (Windows often runs apps on its Intel chip unless set
  per app in Settings, Display, Graphics); phone iPhone 15 Pro Max.

## The web game (three.js, `web/`): worked on in the cloud chat while the PC builds Unreal

The owner (9 Nov): "I'll work on the three.js version in this chat while the other chat works on the unreal engine".
The cloud session improves `web/` here (the portfolio repo keeps its own frozen copy). State on 9 Nov:
- **Crashes fixed** (b8685d7, 874e23f): nothing used to be freed; one trip round the worlds grew the page to ~3.5 GB
  and the Claude app reloaded it. Models are now held while shown and freed 30 s after (models.ts
  acquireModel/releaseModel, onModelEvicted for tree photographs and rigged animals); pictures follow the detail level
  (detailBudget.ts: model pictures 1024 px Low, 2048 Medium); giants' maps freed out by TON 618. Low peaks ~570 MB.
- **Models lit by their world** (merge ae9ff76): worldEnvironment.ts replaces the studio light box; strength set by the
  hour to match the ground (surfaceShading), two thirds neutral; the fighter's hull is painted, not metal.
- **Crossing, fall and warp drawn by the game** (merge 4786e41): crossing.ts + WormholeTransit.tsx replace the AI
  crossing film (Settings › Graphics › Wormhole crossing can bring the film back); fall.ts + Afterimages.tsx: falling
  into TON 618 (whole at the horizon, spaghettified at the end, death card); spacetime.ts + ScreenWarp.tsx: the pulse
  drive bends the stars. Voices.tsx + voiceLines.ts play the owner's cast; files in `web/public/audio`. Weak spots:
  afterimages read as a comb, the warp's centre turns to a dark disc at full pulse, the break-in is a flash not a
  shatter, the exit silhouette greys under bloom on Medium/High, the fall keeps the chapter HUD.
- **Earth rebuilt from orbit** (merge 7605f1b; docs/claude/EARTH_LOOK.md): real clouds from a satellite map
  (earth-clouds.webp, CC BY 4.0), air seen from space (earthSky.ts, Atmosphere `biome.space`), black space behind a
  sunlit world (exposure.ts), cloud shadows, broad sun glint, rivers no wider than they are; High's volume cumulus only
  below 800 m. Low +10-20% in space views, High same or less near the ground. Weak spots: ruined continents flat
  ash-grey (palette rule: ask the owner), the deck is one flat layer, clouds never form or clear.
- **In progress:** new opening film from the game (docs/films/OPENING.md).
- **Sound** (art/audio): owner's cast ARGO voice A, Dev 2, Amara 3, Kai 1, Noor 2 (`art/audio/lines`); music takes on
  https://claude.ai/artifact/WRxDSjrEv6LtXYHjRTQbaK (owner still to pick A/B).
- **Windows app** of the web game: `web/desktop` (Electron; `npm run app:win` on the PC). The owner chose a Windows app
  only for now (no website hosting). A Hostinger zip of the portfolio site with the improved game is wanted later.
- **Preview** (the owner plays it in the Claude app): https://claude.ai/artifact/CWGQyhLzPfprRkdnnaMi7a, version 8 =
  7605f1b (9 Nov; v7 = ae9ff76), now built from this repo's `web/` (`web/tools/claude/prep_site_rw.sh`: packed models, page.html);
  published files in `web/tools/claude/published-preview.txt` for delta publishes (filesdelta.py). Before each
  publish: the strict-CSP check (cspserve.py + sitecheck, 0 violations).
- Test tools: memory test, light pictures and crash checks under the session scratchpad; dev servers web/ on 4201
  (working copy) and 4202 (`rewild-main` worktree, main).

## Platforms (owner asked 8 Nov: "I dont need a browser game now right? I can install the game and play on any device?")

- No browser game is needed. Unreal 5 cannot run in a browser (its web export was removed years ago), so the Claude
  app preview is gone as a test harness: the owner plays builds on the PC. The web version stays on the website.
- Windows (Steam) first. Steam Deck runs Windows builds. Mac and iPhone builds need a Mac with Xcode and an Apple
  developer account; Android builds can be made on the Windows PC (Android SDK/NDK) and need a Play developer account.
- Phones cannot run the PC look (Lumen, Nanite, virtual shadows are desktop features): a phone version is its own
  scaled build with its own lighting and lighter assets, planned after the PC game works. Consoles need approval and
  dev kits from Sony, Microsoft or Nintendo.
- Before every push: `git pull --rebase` first (the owner may commit from another machine or session).

## Milestones

- 8 Nov 2026: repo created; web version, art sources and docs copied from the portfolio repo (its main at 42e1344);
  game design v1 (docs/design/GAME_DESIGN.md).
- 8 Nov 2026: first session on the PC (PLAN.md step 1). The C++ project `Unreal/Rewild` on Unreal 5.8.2 builds; the
  first test shots from the engine (Sky Atmosphere and Volumetric Cloud only, no ground yet):
  docs/images/unreal-test-shot-golden-hour.jpg and docs/images/unreal-test-shot-orbit.jpg.
- 8 Nov 2026: the first fight, milestones 1-3 (docs/unreal/FIRST_FIGHT.md): a real-size Earth from orbit (NASA Blue
  Marble), the rebuilt fighter flying over it, and fighting: guns with lead, shields, hull, explosions, a range of
  practice drones. Play: `Play Rewild.bat`.
- 9 Nov 2026 (web version): spacetime effects drawn by the game, after the owner's reel and the black hole videos
  (web/components/expedition): the wormhole crossing (crossing.ts, WormholeTransit.tsx: a 17 s sequence down a spiral
  throat of blue gas, the dark eye, the Argo stretched with afterimages, a white exit; replaces the Higgsfield film,
  which stays selectable), the fall into TON 618 to spaghettification with the real times on the ship's clock and a
  death card (fall.ts), the pulse drive's warp bubble (ScreenWarp.tsx), and the cast's voices and take A of the scores
  with captions (Voices.tsx, voiceLines.ts, web/public/audio). The same beats are the reference for the Unreal warp.
- 9 Nov 2026: first fight milestones 4-5: the Harrow's Reapers (the sickle the owner chose) in flanking packs,
  lock-on missiles and flares, tuned hard; Noor, Kai and Amara as wingmen with orders; 53 voiced radio lines; the
  first story mission, First contact; the main menu (Continue, Story, Free play) with saving.
