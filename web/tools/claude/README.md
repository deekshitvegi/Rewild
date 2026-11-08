# Claude's working tools

Scripts Claude Code used to build, test and preview the game. They were kept in a cloud
session's scratch folder and are saved here so any new session (or account) has them.
None of this is part of the site build.

**Setup in a fresh cloud session**

```bash
mkdir -p /tmp/rewild && cp -r tools/claude/. /tmp/rewild/
(cd /tmp/rewild/hf/tools && npm install)          # gltf-transform, meshoptimizer, sharp (prep_site.sh needs them)
npm install                                         # the site itself (from the repo root)
# Dev server for tests (own Vite cache dir; tests default to PORT 4187):
npx vite --config /tmp/rewild/vite.repo.config.mjs --port 4187 --host 127.0.0.1 &
```

Every script expects to live in `/tmp/rewild` (paths are written that way; the repo is at
`/home/user/deekshitthvegiportfolio`). Playwright and Chromium come preinstalled in cloud sessions
(`/opt/node-tools/node_modules/playwright`). Headless Chromium uses SwiftShader (software GPU): slow,
so frame times are only comparable between two runs at identical views, never to real hardware.

**Preview build and publish** (the user plays the Claude-app artifact preview)

- `prep_site.sh`: `VITE_MODEL_PACKING=json vite build --base ./` into `/tmp/rewild/site`, packs glTF
  models to `.glb.b64.json` (the artifact host serves no .glb), writes `page.html` (no doctype/html/head/body).
- `cspserve.py <site-dir> <port>`: serves the built site under a CSP like the artifact host's.
- `sitecheck.mjs <label> <W> <H> <detail 0|1|2> <seconds> <port>`: begins the expedition on the served
  build, flies, reports CSP violations / page errors / frame times. Must show 0 CSP violations before a publish.
- `filesdelta.py <site-dir> <published-list.txt>`: which files changed since the last published version
  (list lines are "path size"), as a `files` map for a delta publish (+ paths to null).

**Game tests** (against the dev server; most open `lab/fly-lab.html`)

- `frame.mjs`, `views.mjs`, `solo.mjs`, `bench.mjs`, `variants.mjs`, `peek.mjs`, `probe60.mjs`: place the ship,
  render, time frames, A/B shader variants. `evals/*.js` are page snippets they inject.
- `loadtime.mjs` (waits for the DEV `window.__compiledAt` hook), `crosstest2.mjs` (wormhole crossing both ways
  with the film), `openingtest.mjs <out> new|returning` (Begin expedition + opening film), `autoplaytest.mjs`,
  `bouncetest.mjs`, `mouthview.mjs`, `halcytest.mjs` (Argo dock/undock/gate), `crewtest.mjs`, `argoshots.mjs`,
  `beachtest.mjs`, `divetest.mjs`, `mirrortest.mjs`, `treeview.mjs`, `eclipseframe.mjs`, `skyframe.mjs`,
  `covers.mjs`/`coverspx.mjs` (what covers a pixel), `uniforms.mjs`, `uishots.mjs` (HUD at many screen shapes),
  `cloudlab.mjs`, `filmcap.mjs` (renders a film from the game on a virtual clock). `sheet.py`: contact sheets.

**Films** (`public/films`, see its ATTRIBUTION.md)

- `film2/assemble2.py <name|all>`: cuts the Seedance clips (expected in `/tmp/rewild/film2/sd`, download them
  again from the Higgsfield job ids in `film2/media.txt` and ATTRIBUTION.md) into the four films; ARGO's lines
  come from `film2/lines/trim` (Higgsfield seed_audio jobs in media.txt). `film2/install.py` copies them into
  `public/films` and writes the captions into `components/expedition/films.ts`.
- `sttbin/*.py`: faster-whisper transcription (`python3 -m venv /tmp/rewild/stt && /tmp/rewild/stt/bin/pip install faster-whisper`).

**Testing while editing** (any edit in the repo reloads pages on the repo's dev server and kills a test in flight)

- A test snapshot: `git worktree add --detach /tmp/rewild/snap HEAD && ln -s /home/user/deekshitthvegiportfolio/node_modules /tmp/rewild/snap/node_modules`,
  served by `npx vite --config /tmp/rewild/vite.snap.config.mjs --port 4194 --host 127.0.0.1` (from /tmp/rewild/snap; the
  config allows the shared node_modules). `snapsync.sh` makes it match the repo's working tree (commit + uncommitted edits
  + new files). Run tests against PORT=4194 and keep editing the repo.
- `havenview.mjs <out> <W> <H> [views-json]` (PORT, Q): on Haven on foot, views by bearing from TON 618 or by map
  coordinates `{x, y}` (metres east/north of the landing zone, facing = azimuth from north), with frame time, calls, tris.
