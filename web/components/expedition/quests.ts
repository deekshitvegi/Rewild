import { EXPEDITION_BODIES, findBody, startPosition } from './bodies';
import { groundHeight } from './environment';
import { SEED_CHAPTER_IDS } from './revival';
import { ALPHABET, type ExpeditionProgress } from './glyphs';
import { DATA_SITES, landingZoneDirection } from './sites';
import { speciesOf } from './Wildlife';
import { HISTORIC_SITES, SAMPLE_TUBES, siteFrame, tubeId } from './history';
import { FIRST_WORDS, wordsId } from './contact';
import { ALIEN_SITES, sitePosition } from './aliens';
import type * as THREE from 'three';

/**
 * The story: a trail of chapters across the system, one world after another,
 * in the spirit of Tomb Raider. A signal led the explorer to the Obelisk on
 * Earth; each chapter teaches something needed further out (living off the
 * land, low gravity, cliffs, the ice moons, the black hole) and ends with a
 * reward of crystals. The last one is reading the Obelisk's message, the
 * portfolio's hidden easter egg.
 *
 * An objective is a test of the saved progress, so it is met however it came
 * about, and stays met.
 */
export interface Objective {
    id: string;
    text: string;
    /** Done, and if it counts towards a number, how far along: [have, need]. */
    check: (progress: ExpeditionProgress) => { done: boolean; have?: number; need?: number };
    /**
     * Where to go for it, marked in gold while it is not done and the player is on that world
     * (the friends who first played never found the aliens): the world and the point on it, in
     * its frame of the start.
     */
    aim?: { body: string; name: string; label: string; at: () => THREE.Vector3 };
    /** The world it is met on, if not the chapter's own (its marker is the course while it is next). */
    world?: string;
}

export interface Chapter {
    id: string;
    title: string;
    /** The world it happens on, if one: shown on the map and in the log. */
    world: string | null;
    intro: string;
    objectives: Objective[];
    /**
     * Optional objectives, for the chapter's medal (challenges.ts): finishing
     * it earns bronze, half of these silver, all of them gold. They can be
     * met later, and the medal improves.
     */
    bonus?: Objective[];
    /** Crystals given when the chapter is finished. */
    reward: number;
    /** The Seed it brings back to Earth (docs/story.md), if one: each greens Earth further (revival.ts). */
    seed?: string;
}

const sitesRead = (progress: ExpeditionProgress, bodyId: string, kind: 'ruin' | 'station') =>
    DATA_SITES.filter((site) => site.body.id === bodyId && site.kind === kind && progress.sites.includes(site.id)).length;
const sitesOn = (bodyId: string, kind: 'ruin' | 'station') => DATA_SITES.filter((site) => site.body.id === bodyId && site.kind === kind).length;

const counted = (have: number, need: number) => ({ done: have >= need, have: Math.min(have, need), need });
const landed = (id: string): Objective => ({
    id: `land-${id}`,
    text: `Land on ${findBody(id)?.name ?? id}`,
    check: (p) => ({ done: p.stats.landed.includes(id) }),
    world: id,
});
const readOn = (id: string, need: number | 'all', kind: 'ruin' | 'station' = 'ruin'): Objective => ({
    id: `read-${id}-${kind}-${need}`,
    text: kind === 'station'
        ? `Scan ${findBody(id)?.name ?? id}'s data stations`
        : need === 'all' ? `Read every monolith on ${findBody(id)?.name ?? id}` : `Read ${need} monoliths on ${findBody(id)?.name ?? id}`,
    check: (p) => counted(sitesRead(p, id, kind), need === 'all' ? sitesOn(id, kind) : Math.min(need, sitesOn(id, kind))),
});

const jumpOn = (id: string, metres: number): Objective => ({
    id: `jump-${id}-${metres}`,
    text: `Jump ${metres} metres high on ${findBody(id)?.name ?? id}`,
    check: (p) => counted(Math.floor((p.stats.jumps[id] ?? 0) * 10) / 10, metres),
});
const dropOn = (id: string, metres: number): Objective => ({
    id: `drop-${id}-${metres}`,
    text: `Walk away from a ${metres} metre drop on ${findBody(id)?.name ?? id}`,
    check: (p) => counted(Math.floor(p.stats.drops[id] ?? 0), metres),
});
const mineOn = (id: string, crystals: number): Objective => ({
    id: `mine-${id}-${crystals}`,
    text: `Mine ${crystals} crystals on ${findBody(id)?.name ?? id}`,
    check: (p) => counted(p.stats.minedOn[id] ?? 0, crystals),
});
const vaultOpened = (id: string): Objective => ({
    id: `vault-${id}`,
    text: `Open the vault on ${findBody(id)?.name ?? id} (light its runes in order)`,
    check: (p) => ({ done: p.stats.vaults.includes(`vault-${id}`) }),
});
const fromAsteroids = (p: ExpeditionProgress) => (p.stats.minedOn.belt ?? 0) + (p.stats.minedOn.kuiper ?? 0) + (p.stats.minedOn.space ?? 0);
const ALIEN_LIFE = ['europa-microbes', 'europa-crawlers', 'europa-europan', 'titan-floaters', 'titan-gliders', 'mars-endoliths', 'mars-stilts', 'venus-aeronauts', 'triton-makers', 'triton-hunters'];
const scanned = (id: string, text: string): Objective => ({ id, text, check: (p) => ({ done: p.stats.aliens.includes(id) }) });
/** Every moon with ground to stand on. */
// Real history (history.ts): a site found, and the Mars sample tubes picked up and brought home.
/** First words with one of the peoples who can answer (contact.ts). */
const words = (id: string, text: string): Objective => ({ id: `words-${id}`, text, check: (p) => ({ done: p.stats.visited.includes(`words-${id}`) }) });
const historic = (id: string, text: string): Objective => {
    const site = HISTORIC_SITES.find((s) => s.id === id);
    return {
        id: `history-${id}`, text, check: (p) => ({ done: p.stats.visited.includes(id) }),
        // A real place on a world: marked in gold while it is the story's next stop.
        aim: site ? { body: site.body, name: site.name, label: site.mission, at: () => siteFrame(site).centre } : undefined,
    };
};
const tubesPicked = (p: ExpeditionProgress) => SAMPLE_TUBES.filter((_, i) => p.stats.visited.includes(tubeId(i))).length;

const MOONS_WITH_GROUND = EXPEDITION_BODIES.filter((body) => body.parent && body.kind === 'rocky').map((body) => body.id);

/** The first story, The Signal: its chapters are kept, their objectives carried into the new story's (below). */
const LEGACY: Chapter[] = [
    {
        id: 'landfall',
        title: 'Landfall',
        world: 'projects',
        intro: 'A signal led you here, to an obelisk older than the system. Before you follow it, learn to live off this world.',
        reward: 12,
        bonus: [
            { id: 'landfall-fish', text: 'Catch a fish (E facing open water)', check: (p) => ({ done: p.stats.fish > 0 }) },
            { id: 'landfall-feed', text: 'Feed an animal by hand (E, with food)', check: (p) => ({ done: p.stats.fed > 0 }) },
            { id: 'landfall-cook', text: 'Eat a hot meal sitting by your campfire (R)', check: (p) => ({ done: p.stats.cooked > 0 }) },
            { id: 'landfall-storm', text: 'Sit out a thunderstorm in the ship or a rock shelter', check: (p) => ({ done: p.stats.visited.includes('weathered-thunderstorm') }) },
            vaultOpened('projects'),
        ],
        objectives: [
            { id: 'obelisk', text: 'Read the Obelisk', check: (p) => ({ done: p.sites.includes('obelisk') }) },
            { id: 'mine', text: 'Mine crystals: hold click on a glowing crystal', check: (p) => counted(p.stats.mined, 6) },
            { id: 'forage', text: 'Pick wild berries (E by a bush)', check: (p) => counted(p.stats.gathered, 2) },
            { id: 'camp', text: 'Make a campfire (C, 4 crystals), then sit by it (E)', check: (p) => ({ done: (p.stats.crafted.campfire ?? 0) > 0 && p.stats.rested >= 8 }) },
            readOn('projects', 2),
        ],
    },
    {
        id: 'moon',
        title: 'Low Gravity',
        world: 'moon',
        intro: 'The Moon pulls with a sixth of Earth\'s gravity. Out there, every step is a leap.',
        reward: 15,
        bonus: [jumpOn('moon', 8), dropOn('moon', 20), vaultOpened('moon'), { id: 'moon-flare', text: 'Take shelter from a solar proton storm', check: (p) => ({ done: p.stats.visited.includes('weathered-radiation') }) }, historic('apollo11', 'Find Tranquility Base, where Apollo 11 landed')],
        objectives: [
            landed('moon'),
            { id: 'moon-jump', text: 'Jump three metres high on the Moon', check: (p) => counted(Math.floor((p.stats.jumps.moon ?? 0) * 10) / 10, 3) },
            { id: 'moon-mine', text: 'Mine crystals on the Moon', check: (p) => counted(p.stats.minedOn.moon ?? 0, 8) },
        ],
    },
    {
        id: 'mars',
        title: 'Red Canyons',
        world: 'skills',
        intro: 'Mars is a cold desert of layered rock: buttes and mesas worn back bed by bed, craters drowned in sand, and, far to the west, the biggest volcano in the Solar System. Its gravity forgives a long drop; its cliffs do not forgive a longer one.',
        reward: 20,
        bonus: [
            dropOn('skills', 30),
            mineOn('skills', 20),
            vaultOpened('skills'),
            { id: 'mars-life', text: 'Find what lives inside Mars\'s rocks (listen on the hydrogen line)', check: (p) => ({ done: p.stats.aliens.includes('mars-endoliths') }) },
            scanned('mars-stilts', 'Scan a stilt grazer near the rock dwellers'),
            { id: 'mars-dust', text: 'Weather a Martian dust storm', check: (p) => ({ done: p.stats.visited.includes('weathered-dust') }) },
            { id: 'history-tubes', text: 'Pick up the ten sample tubes Perseverance left at Three Forks', check: (p) => counted(tubesPicked(p), SAMPLE_TUBES.length) },
            { id: 'olympus-mons', text: 'Reach the summit calderas of Olympus Mons', check: (p) => ({ done: p.stats.visited.includes('olympus-mons') }) },
            { id: 'valles-marineris', text: 'Go down into Valles Marineris', check: (p) => ({ done: p.stats.visited.includes('valles-marineris') }) },
        ],
        objectives: [
            landed('skills'),
            readOn('skills', 'all'),
            { id: 'mars-drop', text: 'Walk away from a 15 metre drop on Mars', check: (p) => counted(Math.floor(p.stats.drops.skills ?? 0), 15) },
            {
                id: 'mars-fauna',
                text: 'Scan an animal on Mars',
                check: (p) => ({ done: speciesOf(findBody('skills')!).some((s) => p.fauna.includes(s.id)) }),
            },
        ],
    },
    {
        id: 'venus',
        title: 'Under the Haze',
        world: 'experience',
        intro: 'Venus hides under clouds of sulphuric acid that never part. Down on its lava plains, in air hot enough to melt lead, something lives anyway, and three monoliths are waiting. And something up in the clouds is sending pulses.',
        reward: 15,
        bonus: [
            mineOn('experience', 15),
            vaultOpened('experience'),
            { id: 'venus-pulses', text: 'Follow the pulses into the clouds (hydrogen line)', check: (p) => ({ done: p.stats.signals.includes('venus-signal') }) },
            scanned('venus-aeronauts', 'Scan an aeronaut, between the cloud decks'),
            words('aeronauts', 'Answer the aeronauts: count with them on the radio (E, hydrogen line)'),
            historic('venera13', 'Reach Venera 13, the lander that sent the first colour pictures from Venus'),
            {
                id: 'venus-fauna',
                text: 'Scan every species on Venus',
                check: (p) => {
                    const all = speciesOf(findBody('experience')!);
                    return counted(all.filter((s) => p.fauna.includes(s.id)).length, all.length);
                },
            },
        ],
        objectives: [landed('experience'), readOn('experience', 'all')],
    },
    {
        id: 'mercury',
        title: 'Close to the Sun',
        world: 'education',
        intro: 'Mercury has no air to scatter the light: a black sky, a huge Sun, and ground baked hard. Closer in, the Sun itself is the test: dive, and turn back before the heat shield fails.',
        reward: 15,
        bonus: [
            { id: 'sun-graze', text: 'Dive within a tenth of a solar radius of the Sun', check: (p) => ({ done: p.stats.sunPass <= 0.1 }) },
            mineOn('education', 10),
            vaultOpened('education'),
        ],
        objectives: [
            landed('education'),
            readOn('education', 'all'),
            { id: 'sun-skim', text: 'Dive within 0.3 solar radii of the Sun\'s surface, and get away', check: (p) => ({ done: p.stats.sunPass <= 0.3 }) },
        ],
    },
    {
        id: 'giants',
        title: 'The Stations',
        world: null,
        intro: 'The way out crosses the asteroid belt. Nothing lands on a gas giant: their records wait on stations in orbit, on their sunlit sides.',
        reward: 25,
        bonus: [
            { id: 'belt-haul', text: 'Mine 10 crystals from asteroids', check: (p) => counted(fromAsteroids(p), 10) },
            { id: 'derelict', text: 'Answer the distress call in the belt (radio, distress band)', check: (p) => ({ done: p.stats.signals.includes('derelict-belt') }) },
            { id: 'jovian', text: 'Hear Jupiter roar (radio, jovian band)', check: (p) => ({ done: p.stats.heard.includes('jupiter-roar') }) },
            { id: 'rings', text: 'Fly into Saturn\'s rings and see what they are made of', check: (p) => ({ done: p.stats.visited.includes('rings') }) },
            { id: 'hexagon', text: 'Fly over the hexagon at Saturn\'s north pole', check: (p) => ({ done: p.stats.visited.includes('hexagon') }) },
            { id: 'decagon', text: 'Find the decagon round Saturn\'s south pole', check: (p) => ({ done: p.stats.visited.includes('decagon') }) },
            { id: 'inside-jupiter', text: 'Dive below Jupiter\'s cloud tops', check: (p) => ({ done: p.stats.visited.includes('inside-research') }) },
            { id: 'jovian-cyclones', text: 'Fly into one of the cyclones round Jupiter\'s poles', check: (p) => ({ done: p.stats.visited.includes('jovian-cyclones') }) },
            { id: 'great-red-spot', text: 'Fly into the Great Red Spot', check: (p) => ({ done: p.stats.visited.includes('great-red-spot') }) },
            { id: 'saturn-eyes', text: 'Go down into the eye of both of Saturn\'s polar hurricanes', check: (p) => counted(['saturn-north-eye', 'saturn-south-eye'].filter((id) => p.stats.visited.includes(id)).length, 2) },
        ],
        objectives: [
            { id: 'belt-mine', text: 'Mine an asteroid in the main belt, between Mars and Jupiter', check: (p) => ({ done: (p.stats.minedOn.belt ?? 0) > 0 }) },
            readOn('research', 'all', 'station'),
            readOn('beyond', 'all', 'station'),
        ],
    },
    {
        id: 'static',
        title: 'Static',
        world: null,
        intro: 'Out by the giants the ship\'s radio picks up pulses on the hydrogen line, where SETI listens: two, three, five, seven, eleven. Nature does not count in primes.',
        reward: 15,
        bonus: [
            {
                id: 'all-three',
                text: 'Hear all three narrowband signals',
                check: (p) => counted(['europa-signal', 'titan-signal', 'mars-signal'].filter((id) => p.stats.heard.includes(id)).length, 3),
            },
            { id: 'wow', text: 'Hear the Wow! signal: point the radio at Sagittarius', check: (p) => ({ done: p.stats.signals.includes('wow') }) },
        ],
        objectives: [
            {
                id: 'hear',
                text: 'Tune the radio to the hydrogen line (V) and find the signal',
                check: (p) => ({ done: ['europa-signal', 'titan-signal', 'mars-signal'].some((id) => p.stats.heard.includes(id)) }),
            },
        ],
    },
    {
        id: 'under-ice',
        title: 'Under the Ice',
        world: 'europa',
        intro: 'The strongest signal comes from Europa, Jupiter\'s moon, whose ice hides an ocean holding twice the water of Earth\'s.',
        reward: 30,
        bonus: [jumpOn('europa', 10), mineOn('europa', 10), vaultOpened('europa'), words('europans', 'Flash your torch at the Europan and read its answer')],
        objectives: [
            landed('europa'),
            { id: 'europa-source', text: 'Follow the signal to its source', check: (p) => ({ done: p.stats.signals.includes('europa-signal') }) },
            { id: 'europa-microbes', text: 'Scan the plume (look at it)', check: (p) => ({ done: p.stats.aliens.includes('europa-microbes') }) },
            scanned('europa-crawlers', 'Scan an ice crawler by the vent'),
            scanned('europa-europan', 'Meet whoever came up the vent'),
        ],
    },
    {
        id: 'haze',
        title: 'The Haze',
        world: 'titan',
        intro: 'A second signal, from Saturn\'s Titan: air thicker than Earth\'s, lakes of methane, and something moving in the orange haze.',
        reward: 30,
        bonus: [jumpOn('titan', 10), mineOn('titan', 10), vaultOpened('titan'), scanned('titan-gliders', 'Scan a glider circling over the haze')],
        objectives: [
            landed('titan'),
            { id: 'titan-source', text: 'Follow the second signal', check: (p) => ({ done: p.stats.signals.includes('titan-signal') }) },
            { id: 'titan-floaters', text: 'Scan a floater', check: (p) => ({ done: p.stats.aliens.includes('titan-floaters') }) },
            { id: 'titan-sea', text: 'Wade into a sea of methane (fly north to Kraken Mare)', check: (p) => ({ done: p.stats.visited.includes('methane') }) },
        ],
    },
    {
        id: 'ice',
        title: 'Edges of the System',
        world: 'titania',
        intro: 'Far out, the ice giants\' moons keep the last of the record, under skies their planets fill.',
        reward: 25,
        bonus: [
            readOn('titania', 'all'), readOn('triton', 'all'), jumpOn('titania', 30), vaultOpened('titania'), vaultOpened('triton'),
            { id: 'triton-voice', text: 'Follow the faintest signal of all, on Triton', check: (p) => ({ done: p.stats.signals.includes('triton-signal') }) },
            scanned('triton-makers', 'Meet the Makers'),
            words('makers', 'Read what the Makers have to say (learn 18 glyphs first)'),
            scanned('triton-hunters', 'Scan a frost hunter, and keep your distance'),
        ],
        objectives: [landed('titania'), readOn('titania', 3), landed('triton'), readOn('triton', 3)],
    },
    {
        id: 'horizon',
        title: 'Event Horizon',
        world: null,
        intro: 'Beside Saturn hangs a wormhole. On its far side, 590 AU away, is TON 618.',
        reward: 30,
        bonus: [
            { id: 'kuiper', text: 'Mine an asteroid in the Kuiper belt, beyond Neptune', check: (p) => ({ done: (p.stats.minedOn.kuiper ?? 0) > 0 }) },
            { id: 'plunge', text: 'Cross TON 618\'s event horizon (nothing comes back)', check: (p) => ({ done: p.stats.visited.includes('horizon') }) },
        ],
        objectives: [
            { id: 'wormhole', text: 'Go through the wormhole', check: (p) => ({ done: p.stats.visited.includes('wormhole') }) },
            { id: 'ton618', text: 'Reach TON 618', check: (p) => ({ done: p.stats.visited.includes('ton618') }) },
        ],
    },
    {
        id: 'tour',
        title: 'The Grand Tour',
        world: null,
        intro: 'Every planet past Earth keeps moons, and beyond Neptune Pluto keeps one half its own size. Walk on the strangest of them.',
        reward: 30,
        bonus: [
            {
                id: 'every-moon',
                text: 'Land on every moon there is ground to stand on',
                check: (p) => counted(MOONS_WITH_GROUND.filter((id) => p.stats.landed.includes(id)).length, MOONS_WITH_GROUND.length),
            },
            jumpOn('phobos', 40),
            { id: 'io-plume', text: 'Watch one of Io\'s volcanoes erupt', check: (p) => ({ done: p.stats.visited.includes('io-plume') }) },
            landed('charon'),
            landed('iapetus'),
            historic('samples-home', 'Bring the Mars samples home to Earth'),
            { id: 'uranus-rings', text: 'Fly through the dark rings of Uranus', check: (p) => ({ done: p.stats.visited.includes('uranus-rings') }) },
            { id: 'inside-ice', text: 'Dive into both ice giants, Uranus and Neptune', check: (p) => counted(['inside-freelance', 'inside-certifications'].filter((id) => p.stats.visited.includes(id)).length, 2) },
            { id: 'ice-storms', text: 'Fly into Uranus\'s polar cyclone and Neptune\'s dark spot', check: (p) => counted(['uranus-cyclone', 'neptune-spot'].filter((id) => p.stats.visited.includes(id)).length, 2) },
        ],
        objectives: [landed('phobos'), landed('io'), landed('enceladus'), landed('miranda'), landed('pluto')],
    },
    {
        id: 'signal',
        title: 'The Signal',
        world: 'projects',
        intro: 'Every monolith taught you part of the script. Learn all of it, and the Obelisk will speak.',
        reward: 50,
        bonus: [
            { id: 'all-life', text: 'Find every alien life form', check: (p) => counted(ALIEN_LIFE.filter((id) => p.stats.aliens.includes(id)).length, ALIEN_LIFE.length) },
            { id: 'all-words', text: 'Hear the first words of all three peoples who can answer', check: (p) => counted(FIRST_WORDS.filter((w) => p.stats.visited.includes(wordsId(w))).length, FIRST_WORDS.length) },
            {
                id: 'all-monoliths',
                text: 'Read every monolith in the system',
                check: (p) => counted(DATA_SITES.filter((site) => site.kind === 'ruin' && p.sites.includes(site.id)).length, DATA_SITES.filter((site) => site.kind === 'ruin').length),
            },
        ],
        objectives: [
            { id: 'glyphs', text: 'Learn every glyph', check: (p) => counted(p.letters.length, ALPHABET.length) },
            { id: 'message', text: 'Read the Obelisk\'s message', check: (p) => ({ done: p.letters.length >= ALPHABET.length && p.sites.includes('obelisk') }) },
        ],
    },
];

const legacy = (id: string) => LEGACY.find((chapter) => chapter.id === id)!;
/** All of an old chapter's objectives, to be met for a new one's medal. */
const allOf = (...ids: string[]) => ids.flatMap((id) => [...legacy(id).objectives, ...(legacy(id).bonus ?? [])]);
/** Each objective once (the old chapters share a few with the new ones). */
const unique = (list: Objective[], without: Objective[] = []) => {
    const seen = new Set(without.map((o) => o.id));
    return list.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
};
const signal = (id: string, text: string): Objective => ({ id: `signal-${id}`, text, check: (p) => ({ done: p.stats.signals.includes(id) }) });
const visited = (id: string, text: string): Objective => ({ id: `visited-${id}`, text, check: (p) => ({ done: p.stats.visited.includes(id) }) });
/** An alien site's gold marker (aliens.ts). */
const alienAim = (siteId: string, name: string, label: string): Objective['aim'] => {
    const site = ALIEN_SITES.find((s) => s.id === siteId)!;
    return { body: site.body, name, label, at: () => sitePosition(site) };
};
const withAim = (objective: Objective, aim: Objective['aim']): Objective => ({ ...objective, aim });
/** The middle of Haven's colony, on the ground (in the frame of the start, like every point on a world). */
export const havenColony = () => {
    const haven = findBody('haven')!;
    const direction = landingZoneDirection(haven);
    return startPosition(haven).clone().addScaledVector(direction, haven.radius + groundHeight(haven, direction));
};

/**
 * The story (docs/story.md): three hundred years after a superflare stripped Earth bare, the last
 * people live on Haven, by TON 618, where a day is ten years here. A crew of four comes home
 * through the wormhole to bring Earth back. Each chapter brings back one of the Seven Seeds it is
 * missing, and Earth greens a step (revival.ts); the last takes the news to Haven. The first
 * story's chapters live on in these: their objectives are the new chapters' bonus objectives, so
 * everything that could be done still counts for a medal.
 */
export const CHAPTERS: Chapter[] = [
    {
        id: 'ten-years',
        title: 'Ten Years a Day',
        world: 'haven',
        intro: 'Haven, by TON 618: four hundred people on a world whose orbit is failing, where a day is ten years at home. Hear them out. Then fly up to the Argo waiting over the colony, dock, and take her through the wormhole home to Earth.',
        reward: 10,
        objectives: [
            withAim(visited('haven-talk', 'Talk to the people of Haven (E beside one)'), { body: 'haven', name: 'The colony', label: 'Haven · the people of the Halcyon', at: () => havenColony() }),
            visited('argo-docked', 'Board your ship (E), take off (F), and dock with the Argo above the colony (U at her bay)'),
            visited('crossed-wormhole-saturn', 'Take the Argo through the wormhole to the Solar System'),
            landed('projects'),
        ],
    },
    {
        id: 'ash',
        title: 'Ash',
        world: 'projects',
        intro: 'Three hundred years after the superflare, you are the first people to stand on Earth since the Halcyon left it. The ground is ash and the trees are dead, but Kai swears something moved out there. Find out what lived through it, and learn to live here yourselves.',
        reward: 10,
        objectives: [
            {
                id: 'ash-life',
                text: 'Find two kinds of animal that survived (look at them)',
                check: (p) => {
                    const all = speciesOf(findBody('projects')!);
                    return counted(all.filter((s) => p.fauna.includes(s.id)).length, Math.min(2, all.length));
                },
            },
            { id: 'forage', text: 'Pick wild berries (E by a bush)', check: (p) => counted(p.stats.gathered, 2) },
            { id: 'camp', text: 'Make a campfire (C, 4 crystals), then sit by it (E)', check: (p) => ({ done: (p.stats.crafted.campfire ?? 0) > 0 && p.stats.rested >= 8 }) },
            { id: 'obelisk', text: 'Read the Obelisk the Makers left (the gold marker)', check: (p) => ({ done: p.sites.includes('obelisk') }) },
        ],
        bonus: unique(allOf('landfall'), []),
    },
    {
        id: 'vault',
        title: 'The Vault',
        world: 'projects',
        seed: 'Seeds',
        intro: 'Before the end, the world\'s crops were sealed into a vault in the Arctic permafrost on Svalbard, 78 degrees north. If any seeds lived through the three hundred years, they are there. Noor needs them for the first greenhouse. Fly north: the gold marker shows the way.',
        reward: 15,
        objectives: [historic('seed-vault', 'Reach the Svalbard Global Seed Vault'), readOn('projects', 2)],
        bonus: [{ id: 'vault-storm', text: 'Sit out a thunderstorm in the ship or a rock shelter', check: (p) => ({ done: p.stats.visited.includes('weathered-thunderstorm') }) }],
    },
    {
        id: 'eternal-light',
        title: 'Eternal Light',
        world: 'moon',
        seed: 'Power',
        intro: 'On the rim of Shackleton crater, at the Moon\'s south pole, the Sun never quite sets. The solar farm the last lunar base left there could power the greenhouses on Earth, if it can be restarted. A sixth of Earth\'s gravity: every step is a leap.',
        reward: 15,
        objectives: [
            landed('moon'),
            historic('shackleton', 'Reach the solar farm on Shackleton\'s rim, at the south pole'),
            { id: 'moon-jump', text: 'Jump three metres high on the Moon', check: (p) => counted(Math.floor((p.stats.jumps.moon ?? 0) * 10) / 10, 3) },
        ],
        bonus: unique(allOf('moon'), [landed('moon')]),
    },
    {
        id: 'soil',
        title: 'The Soil Lab',
        world: 'skills',
        seed: 'Soil',
        intro: 'In Jezero crater on Mars, Perseverance left ten sealed tubes of rock, soil and air at Three Forks. The soil in them holds what Earth\'s ash is missing. Pick them up and bring them home, and watch the sky: Mars\'s dust storms swallow whole regions.',
        reward: 20,
        objectives: [
            landed('skills'),
            { id: 'history-tubes', text: 'Pick up the ten sample tubes at Three Forks', check: (p) => counted(tubesPicked(p), SAMPLE_TUBES.length) },
            historic('samples-home', 'Bring the samples home to Earth'),
        ],
        bonus: unique(allOf('mars'), [landed('skills')]),
    },
    {
        id: 'under-ice',
        title: 'Under the Ice',
        world: 'europa',
        seed: 'Plankton',
        intro: 'Europa\'s ice hides an ocean with twice the water of Earth\'s, and something in it is signalling. The plankton round its vents could restart Earth\'s dead seas. Whatever is signalling may be someone. They talk in light: answer with your torch.',
        reward: 20,
        objectives: [
            landed('europa'),
            withAim(signal('europa-signal', 'Follow the signal to its source'), alienAim('europa-signal', 'The signal', 'Europa · something is calling')),
            scanned('europa-microbes', 'Scan the vent plume (look at it)'),
            withAim(scanned('europa-europan', 'Meet a Europan'), alienAim('europa-signal', 'The Europans', 'they talk in light')),
        ],
        bonus: unique([...allOf('under-ice'), ...allOf('static')], [landed('europa')]),
    },
    {
        id: 'nitrogen',
        title: 'Nitrogen',
        world: 'titan',
        seed: 'Air',
        intro: 'Earth\'s air lost its ozone, and three hundred years of ash have fouled the rest. Titan\'s air is nine-tenths nitrogen, clean and cold. Fill the tanks. Something drifts in the orange haze, and something out on the methane seas hunts.',
        reward: 20,
        objectives: [
            landed('titan'),
            withAim(signal('titan-signal', 'Follow the second signal'), alienAim('titan-signal', 'The signal', 'Titan · something in the haze')),
            scanned('titan-floaters', 'Scan a floater'),
            { id: 'titan-sea', text: 'Wade into a sea of methane (fly north to Kraken Mare)', check: (p) => ({ done: p.stats.visited.includes('methane') }) },
        ],
        bonus: unique(allOf('haze'), [landed('titan')]),
    },
    {
        id: 'aeronauts',
        title: 'The Aeronauts',
        world: 'experience',
        seed: 'Shield',
        intro: 'High in Venus\'s clouds, where the air is mild, live airships that have never touched the ground. They have kept the clouds between them and the Sun for longer than we have had fire: they know how a sky is shielded. Win their trust. They count in radio pulses.',
        reward: 20,
        objectives: [
            withAim(signal('venus-signal', 'Follow the pulses into the clouds (hydrogen line)'), alienAim('venus-signal', 'The pulses', 'Venus · between the cloud decks')),
            withAim(scanned('venus-aeronauts', 'Meet an aeronaut, between the cloud decks'), alienAim('venus-signal', 'The aeronauts', 'living airships')),
            words('aeronauts', 'Answer them: count with them on the radio (E, hydrogen line)'),
        ],
        bonus: unique([...allOf('venus'), ...allOf('giants')], []),
    },
    {
        id: 'mirrors',
        title: 'Mirrors',
        world: 'education',
        seed: 'Ozone',
        intro: 'Ozone is made by sunlight. The mirror arrays on Mercury that once beamed power home could drive the ozone makers on Earth, if someone flies close enough to the Sun to turn them round and gets away again.',
        reward: 20,
        objectives: legacy('mercury').objectives,
        bonus: unique(legacy('mercury').bonus ?? [], legacy('mercury').objectives),
    },
    {
        id: 'makers',
        title: 'The Makers',
        world: 'triton',
        intro: 'The faintest signal of all comes from Triton, Neptune\'s backward moon. Whoever left the wormhole by Saturn left something here too: they rewilded worlds before ours, and remember how.',
        reward: 30,
        objectives: [
            landed('triton'),
            withAim(signal('triton-signal', 'Follow the faintest signal'), alienAim('triton-signal', 'The faintest signal', 'Triton')),
            withAim(scanned('triton-makers', 'Meet the Makers'), alienAim('triton-signal', 'The Makers', 'who left the wormhole')),
            words('makers', 'Read what the Makers have to say (learn 18 glyphs first)'),
        ],
        bonus: unique(allOf('ice'), [landed('triton')]),
    },
    {
        id: 'the-call',
        title: 'The Call',
        world: 'haven',
        intro: 'Earth is greening. Now the Halcyon has to be told. Dock your fighter with the Argo (U at her bay), take her through the wormhole by Saturn, and land on Haven, where every hour is five months at home.',
        reward: 40,
        objectives: [
            { ...visited('crossed-wormhole-ton618', 'Take the Argo back through the wormhole by Saturn (U to dock with her)'), world: 'beyond' },
            landed('haven'),
            withAim(visited('haven-news', 'Tell the people of Haven that Earth is ready (E beside one)'), { body: 'haven', name: 'The colony', label: 'Haven · the people of the Halcyon', at: havenColony }),
        ],
        bonus: unique(allOf('horizon'), []),
    },
    // After the story: the first story's last two chapters, as they were.
    legacy('tour'),
    legacy('signal'),
];

/** The chapters that bring back a Seed (revival.ts counts them). */
export const SEED_CHAPTERS = CHAPTERS.filter((chapter) => chapter.seed).map((chapter) => chapter.id);
if (import.meta.env?.DEV && SEED_CHAPTERS.join() !== SEED_CHAPTER_IDS.join()) {
    console.warn('revival.ts SEED_CHAPTER_IDS differs from the chapters with a seed:', SEED_CHAPTERS);
}

export interface StoryState {
    /** The chapter in progress, or null when the story is over. */
    chapter: Chapter | null;
    index: number;
    /** Each of its objectives, checked. */
    objectives: { objective: Objective; done: boolean; have?: number; need?: number }[];
    /** Every chapter finished now that was not before (to reward and announce). */
    finished: Chapter[];
}

/** Where the story stands for this progress: the first chapter not yet finished. */
export const storyState = (progress: ExpeditionProgress): StoryState => {
    const finished: Chapter[] = [];
    for (let index = 0; index < CHAPTERS.length; index++) {
        const chapter = CHAPTERS[index];
        const objectives = chapter.objectives.map((objective) => ({ objective, ...objective.check(progress) }));
        if (progress.story.includes(chapter.id)) continue;
        // The prologue came later: anyone already further on has been through it.
        if (chapter.id === 'ten-years' && progress.story.length > 0) continue;
        if (objectives.every((o) => o.done)) {
            finished.push(chapter);
            continue;
        }
        return { chapter, index, objectives, finished };
    }
    return { chapter: null, index: CHAPTERS.length, objectives: [], finished };
};
