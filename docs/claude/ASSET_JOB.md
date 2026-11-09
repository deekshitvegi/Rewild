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
- Nanite drew part of a 6,371 km Earth as a flat slab jutting above the limb, but only in play (camera banking and
  moving), never in the level-camera stills: grade in the game too. The planet is a plain 262k-triangle mesh (8 Nov).
- In orbit, shadowed sides went black against black space (a fin vanished): Earthshine, from the sky light's lower
  half seeing the atmosphere's ground at Earth's 30% reflectance, lights them as in real photographs (8 Nov).
- Engine glow at an emissive of 4,000 read as dull brown rings at EV 14.5; it needs about 100,000 (8 Nov).
- An explosion as one glowing sphere read first as a flat orange disc, then (with fine turbulent noise) as a glitter
  ball: overlap several soft-edged billows with slow noise, add a short white-hot core, and grade it zoomed in (8 Nov).
- Bolts and sparks thinner than a pixel break into dashes or vanish at 300-700 m: keep them about two pixels wide by
  scaling width with distance; a tracer is about one frame of travel long (25 m at 1,500 m/s) (8 Nov).
- A streak lit evenly end to end looks like a toy rod. Fade it from a hot head; at EV 14.5 an emissive of 6e5 is 20x
  over mid-grey, so a gentle fade still blows out: it needs a steep one (exp(-6), 5% at the middle) (8 Nov).
- Materials on instanced meshes need the instanced-mesh usage set in the editor; a game run silently fell back to the
  default grey material (8 Nov).
- The autopilot never hit until it stopped using the player's stick dead zone and fired only within the target's
  angular size: test aim code with a bot before judging hit feedback (8 Nov).
- The chase camera sees a target mostly from behind: a drone painted orange only at the front read 70% white and gold
  there. Measure colour shares from the chase view with flat-colour renders, not from the hero view (8 Nov).
- Gold foil shaded flat on a square grid read as pixels; a jittered triangle grid with 15-25 deg facets reads as foil,
  but smoothing above about 6 deg turned it to smudges (8 Nov).
- Unwrap before cutting debris, so the fragments keep the whole model's UVs and maps; make tanks hollow, or a cut
  shows a solid black cross-section (8 Nov).
- Stills levels are shared: clear every other model's stills actors before shooting (the drone's first close-ups
  showed the fighter parked on the same spot) (8 Nov).
- Weapons are Rewild's own designs, never copies of real ones: a brief to copy a real missile (the AIM-9X) in detail
  was stopped twice by a safety check (9 Nov). Real hardware may guide proportions, never the specific weapon.
- An AI concept can be geometrically impossible: fit a camera to the real model and report the leftover error (the
  Reaper's blades matched within 7 px, its drum sat 150-190 px off anywhere a centred engine can be) (9 Nov).
- Plate lips 15-20 cm proud vanished under dark paint at the concept distance; 30-40 cm lips with 5 cm rounded rims
  read. Heat tint over 19% of the map at metallic 0.9 read as polished brass: desaturated temper colours, metallic
  0.55-0.75 and roughness 0.6 read as dark cast iron (Reaper, 9 Nov).
- Cycles reads a mesh attribute named "heat" as its smoke field: the tint bake came out 0.9% white, 19% once renamed.
- Smoke trails made of stretched spheres read as a string of beads (each fades at its ends): strips turned to face
  the camera, 20% longer than their stretch with the last tenth faded at each end, read as one trail (9 Nov).
- A missile flame drawn as a cylinder read as a glowing rod: a cone from the nozzle, faded toward its silhouette,
  with the white-hot point as its own small orb, reads as exhaust in vacuum (9 Nov).
- Flares thrown back or down left the chase view: the camera sits above and behind and sees only 21 deg below the
  middle. Thrown out at wing level they fan out in view (9 Nov).
- A shield flash lighting the whole bubble read as a hard-edged glass egg, and at 3x brightness a white blob over
  half the screen: a 1.5 m spot and a 1 m ring spreading 7 m from the hit, peaking near 1.5x mid-grey (9 Nov).
- Save the checklist and the script into the repo folder before any long run: a power cut on 9 Nov lost two
  builds' work except what was already on disk.
- The throat's gas: round 1 measured 10-26% dark (satin, no lanes), round 2 80-93% (lanes too wide); the reel's tunnel frames
  measure 23-60% dark (mean 47%), mid-tones RGB (25, 90, 205). Measure the dark share every round: one threshold moved it 40 points
  (wormhole crossing, 9 Nov).
- Afterimages that write no depth vanished behind the throat, which is drawn last and paints wherever nothing wrote depth: anything
  see-through inside a sky sphere is ordered after it (9 Nov).
- Afterimages as added rim light were invisible on bright blue gas; see-through shaded copies (alpha 0.5, each 0.7 of the last) read.
  Making the ship's own materials transparent would have compiled new shader variants mid-crossing (three's OPAQUE define) (9 Nov).
- Ghosts strung only along the line of a stretch hide inside the stretched hull: fan them across it, and look side-on (9 Nov).
- A camera 0.66 lengths behind a ship stretched 2x sat inside the hull: place cameras from the stretched length (9 Nov).
- A direction taken from the ship's velocity was zero under a test hold and the afterimages collapsed: take directions from the
  geometry (the fall's orbit plane), not from what the last frame happened to do (9 Nov).
- Inside the horizon Haven and the far mouth were drawn as plain discs in the sky: in there only light bent in by the tracer reaches
  the eye, so the camera draws only the ship and the traced sky (9 Nov).
- Squeezing the sky towards the heading fetched pixels from beyond the frame: black borders at full pulse. Measure distance as a
  fraction of the way to the frame's edge in that direction and map rho -> rho + k rho (1 - rho): nothing past the edge (9 Nov).
- A sky photograph (six draws of the whole scene) in the middle of the crossing is a visible stall once no film covers it: queue such
  work for the frames that are full white (9 Nov).
- The wormhole score's peak is at 33 s by its brightness (spectral centroid 1,460 Hz), not the 28 s it was described with: measure a
  track's loudness and brightness per second before syncing a picture to it (9 Nov).
- Voiced lines are 1.5-6.5 s each: ten lines did not fit an 11.6 s sequence. Time the beats from the lines' measured lengths, and give
  lines that belong before the event (the approach) a trigger of their own (time to the throat) (9 Nov).
- On a virtual clock the audio clock still runs in real time: a score that keeps itself in sync re-syncs every test frame. Mix test
  films from the logged starts, not from what the browser played (9 Nov).
- UI: Slate's auto-wrap squeezed the subtitle panel to one word a line; give subtitles a fixed wrap width (840) and
  a minimum panel width (360). Glass at 0.4 opacity let a white hull show through the buttons: 0.6-0.78 (9 Nov).
- Wingmen flying level with or behind the player sat outside the chase camera's view (70 deg): fly them 60-110 m
  ahead and 45-95 m out, so the player sees the wing (9 Nov).
- Earth from orbit (web game, 9 Nov): a faint nebula behind a sunlit planet was the first thing that read as fake.
  Every photograph shows space at RGB 0-4 there; dim the backdrop by the lit world's share of the frame (gone by 3%).
- Invented cloud noise made blobs all of one size with hard edges ("paper"): a real satellite cloud map (3,840 px,
  CC BY 4.0) gave fronts, spirals and soft fibrous edges at once. Its greys are gamma-encoded: as opacity they need a
  linear ramp from 0.08 to 0.55. A 1.6 power left 1.7% of the disc above 200/255 (Apollo 17: 22.7%); a floor of 0.04
  laid a white veil over all the sea (darkest quarter 82, 106, 129 against 59, 67, 87).
- The game's clouds stand at 4.7% of Earth's radius (560 m on a 12 km world) where a real limb is about 1%: seen from
  orbit they stood above the blue line. Clouds and air settle towards the ground as the camera climbs (to 22% of
  their height by four times it), so the limb stays thin with the clouds inside it. Volume cumulus drawn from 1,200 m
  up stood over the limb like a fence and hid the deck's weather within 13 km: from above the weather, the deck alone.
- Rivers narrower than a pixel drew as broad teal nets over whole continents from high up: weight a river's water
  by the share of the pixel it covers (a 14 m channel over the pixel's footprint).
- A Chapman approximation from memory was 20% low at grazing; the erfc-bound form sqrt(2x)/(y+sqrt(y^2+4/pi)) is
  within 5% from overhead to grazing. Check an approximation numerically before tuning colours on top of it.
- Single scattering saturates wrongly with few samples: integrate segment by segment as (scattering / extinction) x
  the drop in transmittance. Even then the clouds along the limb came out orange (their light seen through a long
  column keeps only its red); real limbs over cloud are white-blue (light scattered many times): keep half the
  colour of the extinction and give the air's light at least a hazy horizon's brightness.
- Volume cumulus read from the photographed cover at full detail grew into vertical walls (the cover is the same all
  the way up a column, and the photograph is all fine fibres): read it a few mip levels down (cells of a couple of
  hundred metres) and let the 3D noise shape the puffs. Look up from the ground on High after any cover change.
- Background dev servers in a cloud session stop after two hours (one stopped in the middle of a nine-view render):
  restart them before a long run.
- Wikimedia refuses this machine's API searches and full-size files (rate limit); its standard thumbnail widths
  (1280, 3840) still download one at a time.
