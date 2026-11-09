# Music and voice takes (9 Nov 2026)

Made with the owner's Higgsfield credits (ElevenLabs Music v2.5, instrumental; ElevenLabs v4 speech) for the web
game's new films and its worlds, the day those credits were due to expire. The owner picks on the listening page
https://claude.ai/artifact/WRxDSjrEv6LtXYHjRTQbaK; the chosen takes are then mixed into the films and the game.

| File | What | Higgsfield job |
|---|---|---|
| music-opening-a/b | Opening film, 65 s | 2f99cc9f / c13c7e80 |
| music-wormhole-a/b | Wormhole crossing, 40 s | f442060f / 68486a43 |
| music-blackhole-a/b | Falling into TON 618, 60 s | 57af22d2 / fd1d8310 |
| music-haven-a/b | Haven's shrine garden, 120 s loop | 35231ba3 / 4923dd6c |
| music-space-a/b | Between the planets, 120 s loop | 49250d9d / 1d23f43d |
| music-title | Title screen, 90 s loop | 38a84406 |
| music-earth-ruined | Ruined Earth, 120 s loop | c64a56be |
| music-mars-storm | Mars dust storm, 90 s | f4a2d30f |
| music-europa | Under Europa's ice, 120 s loop | 46e2f152 |
| music-jupiter | Jupiter's depths, 120 s loop | 7903c343 |
| music-venus | Venus, the aeronauts, 120 s loop | 5b515296 |
| music-titan | Titan's seas, 120 s loop | fdb23273 |
| music-danger | Danger stinger, 30 s | 5399a874 |
| voice-*-argoA / argoB | Film lines with ARGO voice A (preset "Vesper") or B ("Alistair"); Dev "Orion", Amara "Maya", Kai "Andre", Noor "Ines" | 8d1d4da1, 6ea2b0a9, 38ab2021, b41766b0, 4db1735d, 9ff80137, 8ca22ca4, 544147e4 |

**Owner's picks (9 Nov):** ARGO is voice A ("Vesper"). The first crew voices sounded like AI slop to the owner; recast
auditions `aud-<dev|amara|kai|noor>-<1..3>.mp3` (dry) and `-com.mp3` (over the ship's intercom, as in the films):
Dev: Julian, Xavier, Marcus; Amara: Imogen, Sloane, Naomi; Kai: Caspian, Gideon, Callum; Noor: Elena, Nora, Hana.
Intercom chain: high-pass 320 Hz, low-pass 3.4 kHz, 5:1 compression, tanh soft clip, faint band-limited pink noise.

The lines are in docs/films/OPENING.md and web/components/expedition/films.ts (crossing), plus four new ones for
the fall into TON 618.
