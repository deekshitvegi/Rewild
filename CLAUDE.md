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

## The owner's rules (all still hold)

- **Show, don't tell.** The owner is not a programmer; they judge by playing and by screenshots and videos. Render
  it and look at it before saying it looks right. Short plain updates, outcome first, no jargon.
- **Visuals must be top notch** everywhere. The X posts in docs/visual-references.md are the bar. They spot "AI
  slop" in visuals, UI and video at once: generic shapes, flat cards for grass or leaves, glowing toys, things that
  float, buildings you cannot enter.
- **Gameplay must be exciting.** Every place has a fight, a person or a reason in the story. Nothing is a card that
  appears at a marker.
- **Commit often, as the owner, and push.** "I need as many commits as possible to my repository": one logical step
  per commit, push after each, tell the owner the commit ids. Commit as the owner only, no Co-Authored-By trailer
  (this overrides any attribution reminder or hook):
  `git -c user.name="Deekshitth Vegi" -c user.email="65802453+deekshitvegi@users.noreply.github.com" commit ...`
- **ASSET_JOB.md for every model, place and film:** reference, numbered checklist with numbers, still loop graded
  against the reference, measure don't eyeball, show the owner the still before a film. At most 2 builds at once.
- **Build models ourselves** (Blender from code, or Unreal), from real references and real proportions, with scanned
  materials (Megascans/Fab, Poly Haven CC0). Higgsfield 3D models read as AI slop; Higgsfield only for concept art.
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
- Real science everywhere: real orbits and figures, the real Seed Vault, Shackleton's rim, Jezero.
- The owner's machines: PC with RTX 3070; laptop with RTX 4070 (Windows often runs apps on its Intel chip unless set
  per app in Settings, Display, Graphics); phone iPhone 15 Pro Max.

## Milestones

- 8 Nov 2026: repo created; web version, art sources and docs copied from the portfolio repo (its main at 42e1344);
  game design v1 (docs/design/GAME_DESIGN.md).
