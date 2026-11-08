# Original black-hole source asset

This directory contains the original multi-file Sketchfab/Fab export. It is
kept outside `public/` intentionally so Vite and Hostinger do not copy it into
the deployed site.

- `scene.gltf` references `scene.bin` and every file under `textures/`.
- The complete source is about 29 MB, 466,186 uploaded vertices, and 534,196
  triangles, with transmission and transparent materials.
- The source validates correctly, but loading it alongside the portfolio's
  existing WebGL universe can exhaust memory or lose the WebGL context on
  weaker/mobile devices.
- Do not use the similarly named files under `temp_model/`; that copy has a
  truncated binary buffer and corrupted PNG signatures.

The deployment-safe geometry asset remains at:

`public/models/blackhole/blackhole.glb`

The live portfolio black hole uses the procedural shader in
`components/InterstellarBlackHoleVisuals.tsx`, because a static GLB cannot
gravitationally lens the scene or background stars.
