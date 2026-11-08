# The explorer's motions

`public/models/expedition/astronaut.glb` is the explorer: the suited figure (mesh, skin and its
24-bone rig, made with Meshy through Higgsfield) and its animation clips. The mesh, skin, rig and
pictures are never changed here; this folder only replaces the clips, with real motion capture
carried onto that same skeleton. `components/expedition/Astronaut.tsx` plays them (layers blended
by speed, idle variations, actions) and adds a procedural pass every frame (lean, foot IK, look,
breathing, the pack's lag, low gravity).

Sources (see `public/models/expedition/ATTRIBUTION.md` for the licences and which clip is which take):

- the CMU Graphics Lab Motion Capture Database, in the BVH conversion by B. Hahne, from
  github.com/una-dinosauria/cmu-mocap (only the takes `clips.py` names are fetched);
- Quaternius's Universal Animation Library, standard (free, CC0), from
  github.com/J-Ponzo/gltf-universal-animation-library.

## Tools

- Python with Blender's `bpy` 5.2 and numpy (the retarget uses Blender's Python and does its own
  maths in numpy; no Blender window or renderer is needed): `python -m venv bpyenv && bpyenv/bin/pip install bpy`
  (from PyPI; Python 3.13). Below, `$PY` is that `bpyenv/bin/python`.
- Node with `@gltf-transform/core`, `@gltf-transform/extensions` and `meshoptimizer` (the ones in
  `tools/claude/hf/tools`: `cd tools/claude/hf/tools && npm install`, then
  `ln -s "$PWD/node_modules" source_assets/astronaut/node_modules`).
- To film the result: the repo's dev server and Playwright's Chromium (as in `tools/claude`).

## Rebuild the motions

```sh
cd source_assets/astronaut
W=/tmp/astronaut-work                      # anywhere outside the repo
sh fetch.sh $W                             # the two sources (pinned commits), only the takes used
cp ../../public/models/expedition/astronaut.glb $W/astronaut-original.glb   # keep the original
node decode.mjs $W/astronaut-original.glb $W/astronaut-decoded.glb         # meshopt undone (read by the retarget)
$PY retarget.py -- $W                      # every clip in clips.py -> $W/motions.json (name clips to redo only those)
node build.mjs $W/astronaut-original.glb $W/motions.json ../../public/models/expedition/astronaut.glb \
  --keep fall,grab,hang,climb,eat,rest,knockdown
node compare.mjs $W/astronaut-original.glb ../../public/models/expedition/astronaut.glb   # must say "identical"
```

`build.mjs` drops the old clips except those named in `--keep` (Meshy clips not yet replaced) and
writes the new ones as 16-bit quaternion keys, 30 a second, meshopt-compressed (lossless for the
mesh). Each clip carries its facts as glTF extras (three.js `clip.userData`): `kind` (`cycle`,
`loop`, `once`), `duration`, for cycles `speed` (m/s) and `stride` (m) at the model's own size, the
phases each foot is down (`feet`), and `gravity` for the lunar lope.

## How a clip is made (retarget.py, motionlib.py)

1. **Cut and clean.** The take is cut (`frames`, in the source's frames), low-passed (a 5-frame
   moving average of each joint's rotation at 120 a second) and resampled to 30 a second. Some
   CMU sessions (subjects 77, 139, 140, 141, 143) were captured at 60 frames a second although the
   BVH files say 120: free fall in their jumps comes out at four times Earth's gravity, and their
   strides at half the time a stride can take. `retarget.py` plays them at 60.
2. **Turn.** Walks and runs are turned to travel along +Z (the model's forward); standing takes so
   the hips face +Z at the start (or on average).
3. **Retarget.** Bone by bone, in world space. The trunk (hips, three spine bones, neck, head) takes
   the source's change from its reference pose (the BVH's T-pose, frame 0) on top of the model's own
   rest posture. Each limb bone is first turned from the model's rest onto the source's reference
   direction, using a frame made of the bone's direction and the body's forward (feet and toes: up),
   so the model's A-pose (arms 65 degrees down) and the capture's T-pose line up, twist included;
   then it moves as the source's bone moves. The hips move as the source's, scaled by leg length
   (hips to ankle: the explorer's 85.5 cm against the actor's). Arms are held out 6 degrees from the
   body, to clear the suit's bulk and the pack.
4. **Feet.** Two-bone IK bends each leg so the ankle follows the source's own ankle, scaled the
   same way: a planted foot stays exactly where the actor's stayed (no sliding), whatever the
   difference in thigh and shin lengths. Contacts (a foot low and still) are found on the result.
5. **Loops.** A cycle is cut from one left-heel strike to the next (a short take: right to right,
   then started at the left strike), the end frame nudged to the best pose match, and closed: the
   remaining difference is spread over the clip, the steady travel taken out of the hips and kept as
   the clip's speed and stride. Every gait starts at the left-heel strike, so the game can blend
   any two of them in step. A loop made in place (Quaternius) gets its speed from how fast the
   planted foot is swept back. A standing loop is cut where its end best matches its start.
6. **Lunar lope** (`moon`): the jog, retimed: each moment with both feet off the ground lasts 2.8
   times as long, each on the ground 1.3 times; in the air the hips keep the speed they left the
   ground with (longer bounds) and fly the parabola of the Moon's gravity.
7. **Glance at the wrist** (`wrist`): a standing take with the left forearm brought up across the
   body and the head bowed and turned to it (keyed on top; no capture of this).

## Look at it

- `preview.py out.png clip $W/motions.json <name>`: stick figures of a clip on the explorer
  (side and front, contact dots); `preview.py out.png bvh <file.bvh> [first last step]` for a take.
- `viewer.html` (served by the dev server: `/source_assets/astronaut/viewer.html?scene=earth|moon|jump`)
  walks the real `Astronaut` component along a scripted path (idle, walk, stop, turns, a 14-degree
  hill, run, sprint, a long idle; the Moon; jumps), and `film.mjs <out> <scene> [W H port]` films it
  frame by frame on a virtual clock (30 a second of game time) to JPEGs for ffmpeg. In DEV,
  `window.__astronautCost` sums the time spent in the clip layers and the procedural pass, and
  `window.__astronautPlain = true` switches the procedural pass off (for A/B timing).
