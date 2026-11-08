/**
 * What the monoliths and data stations say in the game: records of the worlds they stand on, as the
 * Makers left them and the crews who came after added to them. Real science about each place (the
 * missions, the numbers), and the story where it touches it (docs/story.md). One for every site, by
 * its id (sites.ts); the site keeps its id, so what a player has already read stays read.
 *
 * Their names are what the inscriptions spell, so between them they hold every letter of the
 * glyph alphabet (glyphs.ts): reading them all teaches all 26.
 */
export interface SiteRecord {
    name: string;
    description: string;
    location?: string;
    about: string;
    details?: string[];
}

export const SITE_RECORDS: Record<string, SiteRecord> = {
    // Mercury
    'education:unt': {
        name: 'Caloris Basin',
        description: 'One of the largest impact basins in the Solar System, 1,550 km across.',
        about: 'An asteroid about 100 km wide struck here 3.9 billion years ago. The shock ran right through the planet and broke the ground on the far side into a jumble of hills. A day here lasts 176 Earth days: at noon the rock reaches 430 °C, at midnight -180 °C. The ozone crews camped on the basin rim, in the long dusk.',
    },
    'education:iiitdm': {
        name: 'Hollows of Kertesz',
        description: 'Bright, shallow pits found nowhere but Mercury.',
        about: 'MESSENGER found them in 2011: fresh hollows a few metres deep where something in the rock boils off into space, leaving bright blue-grey ground. They may still be forming. Under them, an iron core fills 85 percent of the planet\'s radius.',
    },
    // Venus
    'experience:hcltech': {
        name: 'Maxwell Montes',
        description: 'The highest mountains on Venus, 11 km above the plains.',
        about: 'At the summit the air is cooler, 380 °C, and metal compounds condense out of it like frost: radar sees the peaks as the brightest ground on the planet, coated in a shining snow of lead and bismuth sulphides.',
    },
    'experience:innomatics': {
        name: 'Venera Archive',
        description: 'What the Soviet landers learned, 1970 to 1985.',
        about: 'Ten Venera landers reached the ground and none outlived its second hour. Venera 7 sent the first signal ever from another planet\'s surface in December 1970, 23 minutes of it, faint. Venera 9 sent the first picture in 1975. Venera 13 lasted longest: 127 minutes.',
    },
    'experience:josh': {
        name: 'The Cloud Zephyr',
        description: 'The winds that carry Venus\'s clouds round it in four days.',
        about: 'The ground turns once in 243 Earth days, backwards, but the cloud tops race round the planet in four. Fifty-five kilometres up, where the aeronauts drift, the air is as thick as Earth\'s and about 30 °C: the gentlest place in the Solar System outside Earth.',
    },
    // Earth
    'projects:galactic': {
        name: 'The Last Broadcast',
        description: 'Recorded in the nine days before the superflare.',
        about: 'The Carrington flare of 1859 set telegraph paper alight. The trees of the year 774 hold a spike of carbon-14 from one ten times stronger. The one that came three hundred years ago was stronger still: it tore the ozone away. The last broadcast says it plainly: seal the vault, launch the Halcyon, leave the lights on.',
    },
    'projects:exoplanet_tool': {
        name: 'Exoplanet Survey',
        description: 'How a home was found round a black hole.',
        about: 'By 2025 telescopes had confirmed six thousand planets round other stars. None could be reached. Then a probe sent through the wormhole by Saturn came back with pictures of a green world circling TON 618, and a clock that had run slow: Haven.',
    },
    'projects:pose': {
        name: 'Dobson Station',
        description: 'An ozone monitor that kept measuring after its crew had gone.',
        about: 'All the ozone over a place, squeezed to sea-level pressure, would be a layer three millimetres thick. That is all that stands between the ground and the Sun\'s ultraviolet. Its record ends in a cliff: three days, and the layer was gone. Plants scorched, plankton died, and the land went to ash.',
    },
    'projects:wiki': {
        name: 'Kelp Forest Log',
        description: 'Where life came back first.',
        about: 'Under a few metres of seawater the ultraviolet fades, and the sea kept its life when the land lost it. Giant kelp grows up to half a metre a day. The divers\' last entries are of kelp forests creeping back along the coasts, and fish in them again.',
    },
    'projects:scanner': {
        name: 'Seed Exchange Records',
        description: 'The ledger of the Svalbard vault, opened in 2008.',
        about: 'The vault held a spare copy of every crop from almost every country, and was meant to be opened only after a disaster. The first time came in 2015: Syria\'s seed bank at Aleppo, lost in the war, was rebuilt from its copies here. The ledger\'s last line is for the crates the Halcyon carried away.',
    },
    // Mars
    'skills:lang': {
        name: 'Jezero Delta',
        description: 'A river delta, dry for three and a half billion years.',
        about: 'A river once ran into Jezero crater and filled it with a lake 45 km across; the fan of mud it left is still there. Perseverance landed beside it in 2021 to look for signs of life in its rock, and set its sample tubes down at Three Forks.',
    },
    'skills:web': {
        name: 'Olympus Mons',
        description: 'The largest volcano in the Solar System.',
        about: 'Twenty-two kilometres high and 600 km wide, so broad that from its summit its slopes run down past the horizon. It grew so big because Mars has no moving plates: the same hot spot kept feeding the same mountain for billions of years.',
    },
    'skills:ai': {
        name: 'Dust Devil Tracks',
        description: 'Whirlwinds that draw on the ground.',
        about: 'Mars\'s dust devils can stand higher than Everest, and leave dark trails where they lift the bright dust off the ground. In 2005 one swept the solar panels of the rover Spirit clean and gave it years more of power.',
    },
    'skills:tools': {
        name: 'Perchlorate Warning',
        description: 'Why the soil of Mars is no good to plant in.',
        about: 'Phoenix found it in 2008: up to one percent of the soil is perchlorate, a salt poisonous to people. The colony at Jezero bred bacteria that eat it and leave the ground fit for roots. Those bacteria are the Soil the crew came for.',
    },
    // Jupiter's stations
    'research:thesis-research': {
        name: 'Juno Magnetometer',
        description: 'Readings from inside the strongest field of any planet.',
        about: 'Jupiter\'s magnetic field is twenty thousand times Earth\'s. Its belts of radiation would kill a person in a day; Juno, in orbit since 2016, carries its electronics in a titanium vault and dives between the belts and the clouds once every few weeks.',
    },
    'research:drdo-research': {
        name: 'Great Red Spot Log',
        description: 'A storm watched for three hundred and fifty years.',
        about: 'In the 1800s it was about 40,000 km long; now it is about 16,000, a little wider than Earth, and rounder every year. Its winds reach 600 km/h. Nobody knows whether it is dying or will settle at its new size.',
    },
    // Saturn's stations
    'beyond:personal-music': {
        name: 'Cassini Grand Finale',
        description: 'The last dive, 15 September 2017.',
        about: 'After thirteen years in orbit, Cassini flew 22 times through the gap between the rings and the planet, then turned into Saturn\'s air on purpose, sending data until it tore apart, so that it could never fall on Enceladus or Titan and bring Earth\'s germs there.',
    },
    'beyond:personal-anime': {
        name: 'Ring Rain',
        description: 'Saturn\'s rings are falling into it.',
        about: 'Cassini measured tonnes of ring ice falling into the planet every second, drawn down along its magnetic field. At that rate the rings will be gone in a few hundred million years: we came to look at them at a lucky time.',
    },
    'beyond:personal-film': {
        name: 'Hexagon Survey',
        description: 'A six-sided jet stream round Saturn\'s north pole.',
        about: 'Each side of the hexagon is about 14,500 km long, longer than Earth is wide. It has held its shape since Voyager first saw it in 1981, turning with the planet once in ten and a half hours, with a hurricane in its middle.',
    },
    'beyond:personal-socials': {
        name: 'Titan Relay',
        description: 'Huygens, the farthest landing ever made.',
        about: 'On 14 January 2005 the Huygens probe came down through Titan\'s orange haze on a parachute and landed on damp ground strewn with pebbles of water ice, rounded by flowing liquid: methane rain on rivers of methane. It talked to Cassini for 72 minutes.',
    },
    // Titania, moon of Uranus
    'titania:freelance-eman': {
        name: 'Voyager Two Pass',
        description: 'The only visit to Uranus, 24 January 1986.',
        about: 'Voyager 2 flew past in a few hours and showed a planet of pale blue-green haze, ten new moons and two new rings. Everything known up close about Uranus and its moons comes from those hours.',
    },
    'titania:freelance-madi': {
        name: 'Messina Chasmata',
        description: 'A canyon 1,500 km long.',
        about: 'When Titania\'s ocean froze, the water inside it swelled as ice does and split the crust open: these cliffs are the cracks. The moon is half ice, half rock, and may still hide a thin layer of salty water deep down.',
    },
    'titania:freelance-vkt': {
        name: 'The Equinox of Uranus',
        description: 'A world turned on its side.',
        about: 'Uranus is tilted 98 degrees, probably by a collision with something as big as Earth. Each pole has 42 years of daylight, then 42 years of night; only at the equinoxes does the Sun rise and set across all of it.',
    },
    'titania:freelance-paripurni': {
        name: 'Diamond Rain',
        description: 'What may fall inside the ice giants.',
        about: 'Thousands of kilometres down, the pressure is millions of times Earth\'s air. Experiments with lasers in 2017 squeezed plastic hard enough to make tiny diamonds: inside Uranus and Neptune, carbon from methane may rain down as diamonds into a slushy ocean.',
    },
    'titania:freelance-sri-vari': {
        name: 'Faint Rings Quarry',
        description: 'Thirteen dark rings, found by a star.',
        about: 'In 1977 astronomers watching a star pass behind Uranus saw it blink out five times before the planet reached it: rings, narrow and as dark as coal. Their dust is ice blackened by radiation over billions of years.',
    },
    // Triton, moon of Neptune
    'triton:anthropic-ai-fluency': {
        name: 'Retrograde Orbit',
        description: 'A moon that goes round backwards.',
        about: 'Triton circles Neptune against the planet\'s spin, the only large moon that does: it was a world of the Kuiper belt, caught. Its orbit is shrinking, and in a few billion years Neptune will tear it apart into a ring.',
    },
    'triton:anthropic-claude-101': {
        name: 'Nitrogen Geysers',
        description: 'Plumes eight kilometres high.',
        about: 'Voyager 2 saw dark plumes rising from the south polar cap in 1989: nitrogen ice warmed by the faint Sun from beneath its clear surface until it bursts out, carrying dust that the thin air drags into streaks downwind.',
    },
    'triton:anthropic-claude-code': {
        name: 'Cantaloupe Terrain',
        description: 'Ground like the skin of a melon.',
        about: 'Dimpled hills a few kilometres wide, packed together across the western half of Triton, seen nowhere else. They may be blobs of warmer ice that rose through the crust, like the wax in a lava lamp.',
    },
    'triton:google-gen-ai-chatbot': {
        name: 'Coldest Surface',
        description: 'Thirty-eight degrees above absolute zero.',
        about: 'At -235 °C Triton is the coldest surface Voyager measured anywhere: cold enough to freeze nitrogen, the air we breathe most of, into a pink-tinged frost. Its air is a hundred-thousandth of Earth\'s, and still it has winds.',
    },
    'triton:google-gen-ai-foundations': {
        name: 'Makers Waypoint',
        description: 'A mark left for whoever crossed the dark next.',
        about: 'The glyphs here are older than the ice they are cut into. Read with the others, they say the same thing over and over: that the Makers rewilded worlds before ours, that the wormhole by Saturn was left open on purpose, and that the way to bring a planet back is written on its own ground.',
    },
    // The relay above Earth
    about: {
        name: 'Halcyon Relay',
        description: 'The ark\'s last message, left in orbit above home.',
        about: 'Recorded as the Halcyon left: four hundred aboard, the seeds in the hold, the wormhole ahead. For whoever comes home: we did not leave Earth because it was dead. We left so that someone could come back and wake it.',
    },
};
