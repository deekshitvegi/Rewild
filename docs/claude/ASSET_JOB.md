# The job description for every model, plant and film in Rewild

Read this before building any model (temples, robots, machines, ships), plant (trees, bushes, grass), place
(a garden, a town) or film. It is the method from Nyxera0x's article "How I Turn One Image Into a 3D Simulator
That Takes Itself Apart" (x.com/Nyxera0x/status/2118689860437315679, read 8 Nov 2026; the skill is `cutaway`,
installed by .claude/hooks/install-skills.sh), turned to this game. The owner judges by looking, and spots
generic "AI slop" at once: this file exists so the same mistake is never made twice.

## The rules that carry the weight

1. **Grade against the reference, never against memory.** Every build starts from a reference: real photographs
   and measured drawings of the real thing (a temple, a tree species), or one concept picture (Higgsfield GPT Image)
   when it is invented. The reference sets the look; it is never imported into the game.
2. **Nothing is shown as done, and no film is made, until a still has passed and the owner has seen it.** A film
   of a toy wastes everything after it.
3. **Every correction goes into this file**, as a sentence with a number in it, under "Lessons". The next build
   starts with all of them.

## The steps

1. **Reference.** Collect 3-6 pictures of the real thing from the angles the player will see it (from the ground,
   from the air, close). Save them outside the repo (third-party), note their sources.
2. **Checklist for this one thing,** written before the first line of code: 8-12 numbered lines, each one a reader
   could check, what this reference stands on. Use numbers ("columns 5.5 diameters tall", "blades 3-6 mm wide at
   the base, 0.15-0.25 of their length bent"), and the word "never" where the default would creep in ("the glass
   is never one more white shell"; "the crown is never a ball").
3. **Still loop, at least 3 rounds.** Render a still posed like the reference (same angle, same light where we
   can), stack reference | still side by side, grade every checklist line yes / partial / no, fix the no's, again.
   Then grade it yourself once more, against the picture, not memory: misreading the reference is a mistake too.
4. **Measure, don't eyeball.** Proportions measured off the reference (heights, widths, spacing, as fractions of
   the whole) and checked on the still. Density measured where it matters (dark-pixel share for mechanism, leaf
   coverage of a crown, blade count per square metre). A build that "looks dense enough" to its builder often is not.
5. **In the game, at the views the player has:** on foot at 2 m and 20 m, from the ship at 300 m, and from above.
   A thing that only works from one side is not done (lesson: trees from above, 8 Nov).
6. **Measured cost**, before and after, identical views, Low and High (CLAUDE.md: never ship added cost unmeasured).
7. **Film only from an approved choreography.** A film is one script (beat times and acts), rendered frame by frame
   as a pure function of time (virtual clock, never a screen recording), captured large and scaled down. Port the
   closest approved film 1:1 and change only what differs. A short version is its own script, not a trim.
8. **Save every correction** (below), then commit.

## Working in parallel

At most 2 builds at once, each its own fresh agent with this file, its reference and its checklist; look at the
work after round 2, while a note still changes the outcome. More at once is not faster (8 Nov: 5 software renderers
on 4 cores made every frame take 7 minutes).

## Lessons (one line per mistake; add yours)

- Grass made of flat strips read as "low quality 2D papers": blades are curved, tapered, with thickness and wind,
  dense near the camera (rebuilt 8 Nov, fdd8008).
- Trees seen from above read as flat slivers: far trees were pictures taken only level with the tree, turned only
  about the vertical. Every far picture needs views from above as well (8 Nov).
- Fruit bushes made of 20-sided balls and glowing spheres read as toys: real shrubs, fruit on stems, no glow.
- Higgsfield 3D models read as AI slop: models are built in Blender from code, real references and proportions,
  scanned CC0 materials, baked wear (temples 7-8 Nov).
- Lotus pads came out lime and a metre and a half across: real pads are 0.2-0.9 m and a cool blue-green.
- Waterfall spray glowed orange like fire: spray is grey-white mist at about 0.07 opacity, lit by the sky.
- An even ring of sand round every shore looks fake: shingle only in coves, grass to the water elsewhere.
- Treading water read as a T-pose: arms forward and down, elbows bent about 40 degrees, hands sculling in front.
- The Higgsfield films (wormhole crossing, opening) were disliked: films are made in the engine, from a script.
- Buildings face the light and the approach: a front in its own shadow, or turned away from where the player
  arrives, wastes the model (the shrine hall, 8 Nov).
- Bark and skin pictures multiplied by vertex colours went near black (0.13 x 0.18 linear): one source carries the
  hue, detail pictures stay near white (mean 0.85 or more) (food plants, 8 Nov).
- Fruit at real size vanished: an 8-12 mm berry is under one pixel at 800x450 from the walk camera 5-8 m away. A bush
  in fruit needs 30+ strings and 13-16 mm berries; judge fruit at the game's camera distance, never in a close preview.
- Japanese maples on long steep leaders bunched their leaves at the tips over bare sticks: 5 level tiers with a fan of
  twigs at each, each fan shaded as a layer (lit on top, dark beneath), the most layered of 4 seeds kept.
- Niwaki pads hung at knee height until the lowest limb started 42% up the trunk: measure the lowest leaves (at least
  0.12 of the height), do not judge from a three-quarter view.
- The first cypress "looked narrow" and measured 1:5.8; a real Italian cypress is 1:8-1:10 (shipped about 1:9).
- Faces wound against their custom normals render black in Cycles and lit from the wrong side in a two-sided shader:
  when building from three axes, check (x cross y) . z and flip the winding if negative.
- Wild trees from the forest layer crowded the composed garden: a garden gets a clearing (72 m round the tarn, 48 m
  round the Greek temple) and its trees are planted by hand.
- Timing on a busy machine is noise (one Blender build doubled a frame, 15.6 -> 33.9 s): compare draw calls and
  triangles, and time one asset by hiding and showing it within the same page.
- Props are placed a few per frame: after 10 frames a view held 3.8M triangles instead of 5.2M. Set
  window.__propBudget before measuring, or before and after compare different scenes.
- Two builds placed in parallel collided: the garden pine "by the gate" stood inside the gate moved meanwhile. After
  merging, re-check every hand-placed thing against everything placed since (8 Nov).
- Reference photographs were unreachable (Wikimedia, iNaturalist, GBIF, Flickr, Unsplash blocked by the network):
  allow upload.wikimedia.org and commons.wikimedia.org for asset jobs, or the reference is film frames and botany.
- Unreal's Sky Atmosphere at its defaults washed Earth out from 400 km (Red Sea RGB 57, 86, 127 where ISS photographs
  show about 5-25, 20-40, 50-80; a lavender limb): half the aerial perspective and half the ozone match the photographs.
  Change one ingredient at a time in A/B renders and measure pixels; it took one run to find (8 Nov, Unreal).
- Blue Marble's open sea is near black (RGB 2, 5, 20); lifted by haze, its faint steps broke into compression blocks.
  Paint deep water from ocean depth and keep the map's colour only over shelves (8 Nov, Unreal).
- From 400 km up, volumetric cloud ground shadows drew long streaks (the shadow map covers 150 km round the camera)
  and at 2,500 km shadowed everything: off until the terminator work (8 Nov, Unreal).
- Clouds: a remap of full cover stays full (flat white sheets with stepped pixel edges); Unreal's default of 0
  multiple-scattering octaves leaves them grey-beige; 2.5 km detail noise at 0.3 read as sandpaper (8 Nov, Unreal).
- Fighter (8 Nov, art/fighter): measure the reference's sections, not only its views: the old wing was 12% thick
  with a flat underside, not a 5% blade; fixing it took the front-view silhouette overlap from 0.76 to 0.90.
- All three reference angles looked from above and missed that the old underside is all grey: always render the belly.
- Blender's Manifold boolean silently does nothing when one operand is non-manifold: log face counts before and after.
- A windscreen drawn as one raked plane let its pillars drift from 37 to 50 deg and left the header at +18 deg, in
  view: build the pillars on the vertical sight planes through the eye (+-40 deg), the header above +30 deg.
- An interior concept can contradict the exterior: with the old nose line the glass ended 7 deg below eye level where
  the approved cockpit shows 20 deg. Check sight lines against the hull before approving either (lowered 0.5 m, B).
- 12 mm panel grooves vanish under flat paint at chase distance; a 4,096 px cavity mask (bakes in 15 s) makes them read.
- UV use stayed at 39-46% with about 4,800 islands, most of them groove walls: unwrap before the booleans when texel
  density matters, and measure UV area directly (counting baked texels said 58%).
