# Earth from orbit and from low flight (web game, 9 Nov 2026): reference, checklist, grades

The owner, 8 and 9 Nov: "I didnt like the way the earth looks at all like it's too bad", "the way the earth looks was
bad". Renders of the old look: docs/images/old-earth-from-orbit.jpg. Code: web/components/expedition/earthSky.ts (the air
seen from space, the deck settling), Clouds.tsx (the real cloud map), Atmosphere.tsx (the space shell), cloudShadow.ts,
exposure.ts (black space behind a sunlit world), PlanetTerrain.tsx (cloud shadows, sea glint, sunlight through the air).

## References (third party, kept outside the repo)

- Apollo 17's whole disc, "The Earth seen from Apollo 17.jpg" (NASA AS17-148-22727, public domain).
- "Top of Atmosphere.jpg" (NASA ISS photograph, public domain): the blue band above cloud tops.
- "ISS-40 Thunderheads near Borneo.jpg" (NASA, public domain): cloud fields, shadows, sun glint, the limb.
- The game's own clouds now come from "Solarsystemscope texture 8k earth clouds.jpg" (Solar System Scope, CC BY 4.0,
  from NASA imagery), web/public/textures/expedition/earth-clouds.webp (ATTRIBUTION.md beside it).

Measured off them: space behind the sunlit planet RGB 0-4; Apollo 17: 22.7% of the lit disc brighter than 200/255,
median 130, 132, 155, darkest quarter 59, 67, 87; ISS sea 51, 72, 97 to 51, 75, 103; ISS limb black to deep blue
(21, 67, 129) to pale blue-white (154, 177, 219) over 2.1% of the frame height.

## Checklist

1. Space behind a sunlit Earth is black (mean RGB <= 10 where the day side fills >= 5% of the frame); never the nebula.
2. Cloud fields are real weather: fronts, comma spirals, broken tropical cumulus, clear subtropical belts; never noise
   blobs of one size.
3. Cloud edges soft and fibrous at every view; never a hard cut-out edge.
4. Whole planet: 50-70% of the disc carries cloud; 15-30% of the lit disc brighter than 200/255 (Apollo 17: 22.7%).
5. Sunlit tops near white (brightest >= 220); thick brighter than thin; relief near the terminator.
6. Cloud shadows on sea and land, moving with the clouds.
7. Open sea from orbit dark navy (about 50-65, 70-75, 90-100); a broad soft sun glint, never a white disc.
8. The limb a thin blue band fading to black within about 2% of the frame at the ISS-like view; clouds inside it,
   never standing above it.
9. A light blue veil over the disc, growing towards the edge.
10. Terminator a narrow warm band; night side black (<= 12) with no glowing veil.
11. From low altitude the ground is not grey mush: its pattern and texture show, blue-grey depth with distance.
12. Works for the ruined stage and the recovered one; ground pictures and palette unchanged.

The grades of each round, the contact sheets and the measured costs are in the builder's report (9 Nov).
