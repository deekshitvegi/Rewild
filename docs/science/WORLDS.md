# The worlds of the Expedition: what is real, and how the game shows it

Research notes for each planet and moon the Expedition lets you visit. Each
world lists what is known of the real place (with sources), what the game draws
now, and what is still to change. Game scale: every world has its true size
relative to Earth (Earth's radius is 12 km in the game); heights and the depths
of atmospheres are stretched so there is room to fly and walk.

## Venus

**Real**
- Surface 465 °C, 92 bar of carbon dioxide. A deck of sulphuric-acid cloud,
  about 48 to 70 km up, covers the whole planet and never breaks. The acid falls
  as rain that evaporates long before it reaches the ground ("virga"), so there
  are **no lakes or seas of any kind** on Venus. HCl is only a trace gas.
- The ground, as the Venera 13 and 14 landers photographed it in 1982: plates of
  rock like broken flagstones, thought to be basalt (Venera 13's sample matched
  oceanic tholeiitic basalt), with dark soil between them, on a barren plain.
  The rocks are dull grey; the light that gets through the clouds has lost its
  blue, so everything looks yellow to orange. The Sun is never seen as a disc
  from the ground. [LPI: Surface view from Venera 13][venera-lpi],
  [Smithsonian: Venera 13 images][venera-si], [Venera 14][venera14].
- About 80 % of the surface is volcanic plains; there are large shield
  volcanoes (Maat Mons), flat-topped lava domes ("pancake domes"), long lava
  channels and highly deformed highlands (tesserae). Nothing lives on the
  surface; whether anything could live in the cloud layer is debated.

**In the game (from this change)**
- Its own kind of world (`volcanic`): gravelly basalt soil, basalt plates and
  scattered rock (`SLAB`, flattened boulders), outcrops of the flows, broad
  shield volcanoes with summit pits and pancake domes in the terrain
  (`shields()`, `domes()` in `noise.ts`, identical on CPU and GPU).
- A cloud deck that never breaks (`BiomeDef.deck`): from orbit the yellowish
  cloud tops hide the ground; under it the whole sky is the cloud's underside,
  the Sun and its flare are hidden (`skyBeyond`), and the light comes from the
  whole sky (`overcast`: little direct light, soft shadows), coloured
  yellow-orange (`sunColor`).
- No cacti, shrubs or fruit. Alien animals built for the heat graze the plains:
  fiction, since nothing known could live at 465 °C, but the game's to find and
  scan. Crystals and the data sites stay: they are the game.
- Still to do: heat as a hazard on foot (the suit's cooling), a slow descent
  through the acid cloud, and the cloud-dwelling species (task #56).

## Mars

**Real**
- Thin carbon-dioxide air, about 0.6 % of Earth's pressure. The sky by day is
  butterscotch from suspended dust; sunsets are blue, the blue light staying
  close to the Sun while the rest of the sky stays yellow-orange
  [NASA: sunrises and sunsets on Mars][mars-sunset], [Curiosity sundown][mars-sundown].
- Rust-red dust over dark basaltic rock and sand (dunes of dark sand), layered
  sedimentary rock in the craters (Mount Sharp rises 5 km in Gale Crater)
  [NASA: Mount Sharp in white-balanced colours][mount-sharp]; polar caps of
  water ice and carbon-dioxide ice; dust devils and dust storms. Olympus Mons
  (about 22 km) and Valles Marineris (about 4,000 km long, up to 7 km deep).
- No life has been found. If any exists, it is microbial and underground.

**In the game**
- Canyons and mesas of red layered rock (cliffs now use a photographed layered
  rock, `rock-red`, with real relief), butterscotch sky, blue sunsets
  (`BiomeDef.sunset`), dust storms and dust devils (weather.ts). No deck of
  white cloud: Mars's water-ice clouds are rare, thin wisps, and a deck drew
  the globe blotched white from orbit.
- Still to do: dunes of dark sand, polar ice, the real relief from MOLA
  (Olympus Mons, Valles Marineris).

## Earth (landing at Dallas)

**In the game**: real continents, seas and rivers from NASA's Blue Marble and
GEBCO maps; woods of oak, ash and pine; long grass round the explorer; cliffs
of layered limestone, as along the river bluffs. Still to do: more kinds of
tree, and sun shadows that cost little enough to keep the game smooth.

## The Moon and Mercury

**Real**: no air, so a black sky with stars and hard black shadows; grey
regolith over basalt (the Moon's dark maria) and anorthosite (its bright
highlands); craters of every size. Mercury: a Sun about 2.5 to 3 times as wide
as from Earth, 430 °C by day and −180 °C by night, long cliffs (lobate scarps)
and bright "hollows".

**In the game**: cratered grey worlds; cliffs now photographed dark rock.
Still to do: Earth in the Moon's sky at its real size, Mercury's scarps and
hollows, the heat of Mercury's day.

## Titan (Saturn)

**Real**
- The only world besides Earth with stable liquid on its surface: lakes and
  seas of liquid methane and ethane, almost 2 % of the surface. Three large
  seas near the north pole (Kraken Mare about 1,200 km, Ligeia Mare about
  500 km and over 100 m deep, mostly methane, Punga Mare about 390 km) and many
  smaller lakes; one large lake in the south (Ontario Lacus)
  [Planetary Society: Titan's lakes][titan-lakes], [JPL: Titan's north][titan-north],
  [ESA: profile of a methane sea][titan-sea].
- 1.5 bar of nitrogen with a few percent methane, −179 °C. Methane rain,
  river channels, dunes of dark organic sand round the equator, rounded pebbles
  of water ice where Huygens landed in 2005.
- A thick organic haze extends all the way to the ground and hides the surface
  from space in visible light; from the ground **Saturn would not be seen**
  through it [ESA: Huygens, hazy Titan][titan-haze].

**In the game (from this change)**: Titan is its own kind of world
(`methane`). Long dunes of dark sand run east-west round the equator, where
you land (as Huygens did, at 10°S), over plains of ice pebbles. Lakes and seas
of liquid methane fill the low ground round the poles, and the great seas are
where Cassini mapped them: Kraken Mare (68°N), Ligeia Mare (79°N), Punga Mare
(85°N) and, in the south, Ontario Lacus (72°S), with ragged coasts of bays,
headlands and islands. They are marked on the HUD. The methane is clear over
a dark bed, mirrors the orange sky and lies glassy calm. It will not hold a
person up (liquid methane is less than half as dense as water), so the
explorer can wade in to the chest and no further. The thick haze dims Saturn
almost to nothing from the ground. The floaters in the haze are fiction (see
aliens.ts). Still to do: methane rain.

## Europa (Jupiter)

**Real**: a shell of water ice over a salt-water ocean; ridges and cracks
(lineae) stained reddish-brown, "chaos" terrain where the crust broke into
blocks; possible plumes of water vapour; about −160 °C; Jupiter about 12° wide
in its sky.

**In the game**: chaos-terrain ice blocks, a plume, vent microbes and frozen
drifters (fiction, for the radio to find). Still to do: reddish lineae.

## Titania (Uranus)

**Real**: an airless moon of ice and rock, cut by enormous canyons: Messina
Chasmata runs 1,492 km, formed when the interior expanded and the crust cracked
[Messina Chasmata][messina]. Nothing grows: there is no air.

**In the game (from this change)**: airless: a black sky over grey, faintly
reddish ice and rock, blocks of ice and boulders, no trees or plants. Alien
animals roam the ice (fiction, for the game). Still to do: the great canyons
and craters in the terrain.

## Triton (Neptune)

**Real**: nitrogen ice; "cantaloupe terrain" raised by rising blobs of ice
(diapirs); active geysers whose plumes rose about 8 km and laid dark streaks
downwind, seen by Voyager 2 in 1989 [Planetary Society: Triton][triton].

**In the game (from this change)**: a near-black sky (its nitrogen air is a
millionth of Earth's) over pinkish nitrogen frost and grey-blue ice, with alien
animals on the ice (fiction, for the game). Still to do: geysers with dark
streaks, cantaloupe terrain.

## Jupiter and Saturn (flying in)

**Real**
- No surface. Cloud decks in order: ammonia ice on top (the white zones),
  ammonium hydrosulphide below (the brown belts), water clouds deepest. NASA's
  Galileo probe fell into Jupiter in 1995 and stopped at about 23 bar.
- Lightning lives in the water clouds; Juno also found "shallow lightning"
  higher up, in clouds of ammonia and water, where storms throw ice crystals
  more than 25 km above the water clouds, and slushy hail ("mushballs") falls
  back down [SwRI: shallow lightning and mushballs][juno-lightning],
  [JPL: Juno and Jupiter's lightning][juno-jpl].
- Storms: the Great Red Spot and white ovals on Jupiter, clusters of cyclones
  round both poles; Saturn's hexagon round its north pole and its great white
  storms.

**In the game**: the decks as volumetric clouds, pressure and heat that crush
the hull. Each giant is its own model (gasAtmosphere.ts): Saturn's decks lie
deeper than Jupiter's (weaker gravity, colder) under a thick yellow haze that
shortens how far one sees; Jupiter has the most storms, Saturn fewer but
larger ones. Thunderstorms are cumulonimbus, not columns: on a grid of storm
cells (at most one storm to a cell) each has a flat dark base, a lumpy body
that widens as it climbs and, when mature, an anvil spreading under the top
deck with an overshooting dome where the updraft punches through it, its
anvil carried off to one side. Lightning is drawn as branching bolts, most
often in clear air over the water clouds' tops, as well as lighting the cloud
round it; Jupiter's flash every few seconds, Saturn's less often. Still to do:
the walls of the great vortices (the Great Red Spot, Saturn's hexagon) from
inside.

## Uranus and Neptune: the ice giants

**Real**
- Ice giants, not gas giants: only an outer skin of hydrogen and helium, over
  a deep, hot, dense fluid of water, ammonia and methane round a rocky core.
  Under the pressure deep inside Neptune, methane may give up its carbon as
  diamond.
- Methane in the air absorbs red light, so both are blue-green. Voyager 2's
  pictures were stretched for contrast; reprocessed to true colour (Irwin and
  others, 2024) both are a pale greenish blue, Neptune only a little bluer
  [Oxford: true colours of Uranus and Neptune][irwin-colour].
- Clouds: methane ice at about 1.2 bar (Uranus) and 1.5-2 bar (Neptune), over
  hydrogen sulphide ice (Uranus's clouds would smell of rotten eggs), with
  ammonium hydrosulphide and water deeper.
- Uranus lies on its side (98 degrees), so each pole has 42 years of day and
  then of night. Its north pole is turned to the Sun now, under a bright hood
  of haze whose sharp southern edge has held at about 43 N for years
  [NASA: 20 years of Hubble at Uranus][uranus-hubble]. It has almost no heat
  of its own: calm air, few clouds, rare storms.
- Neptune radiates 2.6 times the heat it gets from the Sun and has the fastest
  winds measured, about 400 m/s westward at the equator, eastward at high
  latitudes. Voyager 2 photographed bright methane cirrus 50-100 km above the
  blue deck, casting shadows on it. The current dark spot, NDS-2018, is in the
  north; the VLT saw it from the ground in 2023 with a bright cloud beside it
  [ESO: dark spot on Neptune][eso-spot].
- Lightning has been heard on the radio at both (Voyager 2), never seen.
- Rings: Uranus has thirteen narrow, nearly opaque rings as dark as charcoal,
  the brightest (epsilon) 20 to 96 km wide and slightly eccentric, with two
  faint dusty rings far out (nu reddish, mu bluish). Neptune has five faint,
  dusty rings; the outermost, Adams, holds the arcs Fraternite, Egalite,
  Liberte and Courage within about 40 degrees of longitude
  [PDS: Neptune's rings][neptune-rings].

**In the game**: from space both are drawn from those observations (no real
map of either exists; the old Neptune picture was an artist's texture with
Jupiter-like swirls): Uranus pale cyan, faint bands, the bright polar hood to
43 N and a few small methane clouds; Neptune a little bluer, darker towards a
collar at 60 S, NDS-2018 with its companion cloud, bands of white streaks with
their shadows. The rings are drawn at their real radii and widths, each one
the share of the pixel it covers, so a ring a few kilometres wide is a faint
thin line from afar; Neptune's dust is brightened, as in a long exposure.
Inside, Uranus is a cyan haze with thin clouds and almost no storms; Neptune
has streaks of cirrus far above its blue deck, carried by the fastest winds,
their shadows on the clouds below. Uranus's moons are drawn closer in than
the real ones (to fit the game); Miranda stays outside the dense rings.

## Saturn's rings and poles

**Real**
- The rings are water ice, nearly pure, in pieces from grains of dust to
  boulders the size of a house, spread in a layer generally only about ten
  metres thick across 280,000 km. The A and B rings are clumped into
  "self-gravity wakes": strands of pieces tens to hundreds of metres long,
  slanted about 20 degrees to their orbit. Cassini's final orbits in 2017
  weighed them; by one reading they are only tens of millions of years old.
- The hexagon: a jet stream at 78 N running in a six-sided ring, each side
  longer than Earth is wide, seen since Voyager in 1981, with a hurricane over
  the pole whose eye is about 2,000 km across. Cassini also imaged it at 5
  microns, by the heat of the deep atmosphere shining through gaps in the
  clouds, which needs no sunlight. It is now heading into the north's long
  winter.
- The decagon: in 2023-25 Hubble saw the jet at 60.5 S (116 m/s) bend into a
  ten-sided wave between 58 and 63 S, about 167,000 km round, drifting at only
  2.5 m/s [Sanchez-Lavega et al., Science Advances 2026][decagon-paper],
  [STScI release][decagon-stsci].
- Over the south pole itself Cassini found a hurricane-like vortex about
  8,000 km across, with a well-defined eye ringed by cloud towers 30 to 75 km
  high.

**In the game**
- From afar the rings are the smooth sheet they look like, with fine
  ringlets; within a few kilometres the sheet takes on the grain of the wakes
  and a carpet of the biggest blocks (the ringlets, circles that would draw long
  stripes to the horizon from close by, fade there); within a few hundred
  metres of the ring plane it gives way to the pieces themselves: boulders and
  gravel of ice in a layer 50 m thick, as dense as the ring is there (none in
  the Cassini Division), each placed by a hash of its cell so the field is the
  same on every visit (`RingParticles.tsx`). The boulders are solid: flying fast
  through the B ring costs shield.
- Saturn's north pole draws the hexagon (clearer, bluer air inside, the bright
  jet with a dark moat outside, the polar hurricane); the south draws the
  decagon at its measured latitude (bluer air poleward, a dark lane, the bright
  jet) and the south polar vortex, which also covers the map's smear at the
  pole. Both polygons are marked once near Saturn, and
  finding them (and flying into the rings) are bonus objectives.
- The infrared imager (I, near a giant) shows a giant by its own heat: belts
  and gaps in the clouds glow, thick cloud and the cold rings are dark, the
  night side as clear as the day side.

## The other moons, and Pluto with Charon

**Real**
- Phobos (22 km) and Deimos (12 km): dark, probably captured asteroids or
  debris of an impact on Mars. Phobos is spiralling in and will break up into
  a ring; gravity there is under a thousandth of Earth's, so a walking pace is
  close to the speed of an orbit just above the ground.
- Io: the most volcanic world known (some 400 active volcanoes, heated by
  Jupiter's tides), sulphur-coloured, with umbrella plumes up to about 400 km
  high and red rings of fallout (Pele). Ganymede, the largest moon, has its own
  magnetic field and an ocean under its ice; Callisto is the most cratered
  surface known and lies outside Jupiter's worst radiation.
- Saturn's mid-sized moons are mostly water ice: Mimas and its 139 km crater
  Herschel; Enceladus, the most reflective world, venting its ocean from the
  tiger stripes at its south pole; Tethys, less dense than water; Dione's ice
  cliffs; Rhea; two-faced Iapetus with its equatorial ridge.
- Uranus's moons were seen only by Voyager 2, and only their southern halves:
  Miranda's broken terrains and the cliff Verona Rupes; Ariel's rift valleys;
  dark Umbriel with the bright ring of Wunda; Oberon's dark crater floors.
  Uranus lies on its side, so their poles have 42-year days and nights.
- Pluto (New Horizons, 2015): the bright heart, Sputnik Planitia, a glacier
  of nitrogen ice 1,000 km across, overturning in cells tens of kilometres wide,
  ringed by mountains of water ice; a thin blue haze. Charon is half its size;
  the two are locked face to face, and Charon's red pole is stained by gas
  escaping from Pluto.

**In the game**
- Each is landable, at its real gravity. Worlds of 1,400 units (about 740 km)
  across and more are true to size; smaller ones are enlarged less and less, so
  there is ground to walk; their hills are cut to about a tenth of their radius.
- From space each shows its real map (NASA/USGS mosaics; none exist for
  Uranus's moons, so theirs are drawn), kept with one face to its planet, and
  Pluto with longitude 0 facing Charon. Charon is placed so that Pluto's
  landing zone falls in Sputnik Planitia. Pluto's haze glows blue along the
  terminator, as it did against the Sun in New Horizons' departing picture.
- The ground pictures keep only as much of their own colour as the world's
  palette has, so grey moons (Miranda, Rhea, Ariel) are grey, not rust-mottled.
- Where gravity is too weak to hold a walker down (an orbit just above the
  ground slower than 25 m/s: Phobos, Deimos and the small icy moons), the
  boots grip the ground; a jump is capped at two fifths of the escape speed and
  can take minutes to come down, so X fires the jetpack downward.
- Io erupts on the horizon from the landing site: grains on ballistic arcs
  under Io's gravity, 400 km high at the game's scale.
- The Grand Tour chapter: land on Phobos, Io, Enceladus, Miranda and Pluto;
  every moon with ground, Charon, Iapetus, a 40 m jump on Phobos and Io's
  volcano are its bonuses.

[venera-lpi]: https://www.lpi.usra.edu/publications/slidesets/venus/slide_3.html
[venera-si]: https://airandspace.si.edu/multimedia-gallery/image/web12184-2011640jpg
[venera14]: https://en.wikipedia.org/wiki/Venera_14
[mars-sunset]: https://science.nasa.gov/solar-system/planets/mars/what-does-a-sunrise-sunset-look-like-on-mars/
[mars-sundown]: https://www.jpl.nasa.gov/news/nasas-curiosity-rover-views-serene-sundown-on-mars/
[mount-sharp]: https://science.nasa.gov/resource/mount-sharp-panorama-in-white-balanced-colors/?site=insight
[titan-lakes]: https://www.planetary.org/articles/0315-titans-lakes-the-basics
[titan-north]: https://www.jpl.nasa.gov/images/pia17655-titans-north/
[titan-sea]: https://www.esa.int/Science_Exploration/Space_Science/Cassini-Huygens/Profile_of_a_methane_sea_on_Titan
[titan-haze]: https://sci.esa.int/web/cassini-huygens/-/55227-science-highlights-from-huygens-6-hazy-titan
[messina]: https://en.wikipedia.org/wiki/Messina_Chasmata
[triton]: https://www.planetary.org/worlds/triton
[juno-lightning]: https://www.swri.org/newsroom/press-releases/swri-led-juno-mission-discovers-shallow-lightning-mushballs-jupiter
[juno-jpl]: https://www.jpl.nasa.gov/news/nasas-juno-spacecraft-updates-quarter-century-jupiter-mystery/
[decagon-paper]: https://www.science.org/doi/10.1126/sciadv.aee4251
[decagon-stsci]: https://www.stsci.edu/contents/news-releases/2026/news-2026-022
[irwin-colour]: https://www.ox.ac.uk/news/2024-01-05-new-images-reveal-what-neptune-and-uranus-really-look-0
[uranus-hubble]: https://science.nasa.gov/missions/hubble/20-year-hubble-study-of-uranus-yields-new-atmospheric-insights/
[eso-spot]: https://eso.org/public/news/eso2314/
[neptune-rings]: https://pds-rings.seti.org/neptune/neptune_rings_table.html
