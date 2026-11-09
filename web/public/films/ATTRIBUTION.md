# The loading films

Played by `components/expedition/FilmPlayer.tsx`: the crossing of the wormhole while the other system is built,
when the player picks a film over the crossing the game draws (Settings › Graphics).

- `crossing-out.*`, `crossing-home.*`: generated with
  Higgsfield (Seedance 2.5, image and audio references: the crew's portraits, the Argo, the
  cockpit and crew bay sets, the recorded lines), 6 Nov 2026. Jobs: crossing 425738ec
  (approach by Saturn), d5e642a7 (approach by TON 618), b90813f8 (the throat), e812db3a (the far
  side). The crew speak with the voices Seedance gave
  them; ARGO's lines are the recorded ones (Higgsfield seed_audio), laid over in the edit.
  Cut together, loudness matched and scaled to 1280 x 720 at 24 fps.
- `wormhole-game-out.*`, `wormhole-game-home.*`: the short crossing (Settings › Graphics), rendered
  from the game itself (the Argo in the throat, WormholeTransit.tsx), frame by frame on a virtual
  clock in a headless browser, 60 frames a second blended in pairs to 30 for motion blur.

Each comes as WebM (VP9 + Opus) and MP4 (H.264 + AAC).

The AI-generated opening films (`opening-haven.*`, `opening-solar.*`, Higgsfield jobs 24fb466f and 1a028ea4) were
removed on 9 Nov 2026 at the owner's request; an opening made from the game replaces them (docs/films/OPENING.md).
