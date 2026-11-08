import * as THREE from 'three';
import { createGroundFunction, findBody, startPosition, startSun, type ExpeditionBody } from './bodies';
import { groundHeight, levelGround } from './environment';
import { directionAt } from './history';
import type { ModelName } from './models';
import { landingZoneDirection, openingHeading } from './sites';

/**
 * The trail to the Makers, and what else lies out there to be found.
 *
 * The Makers (contact.ts) left a key on every world for whoever came next.
 * Before the keys, they left a trail: four stones, each pointing to the next,
 * from the nearest moon a traveller from Earth would reach to the ship they
 * came in. Each stone's message is in their script and reads as far as its
 * letters have been learned (glyphs.ts).
 *
 *   Phobos: the monolith, the real one (a boulder some 85 m across that Mars
 *     Global Surveyor photographed in 1998), points to a cold sea;
 *   Titan: a raft of living cells on its methane sea has grown round the
 *     second stone, and points to a world that breathes through its ice;
 *   Enceladus: frost fans round a vent on the tiger stripes hold the third,
 *     and point to the two-faced moon;
 *   Iapetus: on its equatorial ridge lies their seed ship. The ridge, 20 km
 *     high and 1,300 km long, is real and nobody knows what raised it.
 *
 * Other finds are not part of the trail: Jupiter's floaters, life as Carl
 * Sagan and Edwin Salpeter imagined it in 1976; the cracked ridge by the Europan's
 * vent; and in orbit round Earth, what people left there.
 */
export interface StoryFind {
    id: string;
    body: string;
    name: string;
    /** The card's small label. */
    label: string;
    blurb: string;
    /** For the log, before it is found. */
    hint: string;
    model: ModelName;
    /** Longest side, metres. */
    size: number;
    /** Where: walked from the landing zone (degrees from the Sun's side, metres), or at a place on the world's map. */
    place: { bearing: number; distance: number } | { lat: number; lon: number };
    /** Share of its height set into the ground, and its turn about the local up (degrees). */
    sink?: number;
    turn?: number;
    /** Lying down: its long axis (+z of the model) laid along the ground instead of up. */
    lying?: boolean;
    /** Afloat: on the world's sea, as near the spot asked for as there is open liquid. */
    afloat?: boolean;
    /** Closer than this (metres) it has been found. */
    reach: number;
    /** A stone of the trail: its place in it (1-4) and its message in the Makers' script. */
    trail?: number;
    script?: string;
    /** What Argo says on finding it. */
    argo: string;
}

export const STORY_FINDS: StoryFind[] = [
    {
        id: 'trail-phobos', body: 'phobos', name: 'The monolith on Phobos', label: 'The trail · 1 of 4',
        model: 'phobosMonolith', size: 40, sink: 0.08, turn: 20, reach: 26,
        place: { bearing: 35, distance: 160 },
        blurb: 'In 1998 Mars Global Surveyor photographed a bright block on Phobos casting a long shadow, a boulder perhaps 85 m across. In 2009 Buzz Aldrin told an interviewer that there was a monolith on Phobos and that someone should visit it. (Drawn about half that size here, on a Phobos drawn larger than itself.) Under the dust on its sunward face, the Makers cut a line of their script.',
        hint: 'Mars Global Surveyor photographed a monolith on Phobos in 1998. Nobody has been to look.',
        trail: 1,
        script: 'FOUR STONES TO THE DOOR. THE NEXT FLOATS ON A COLD SEA UNDER ORANGE SKY.',
        argo: 'The monolith. There is writing under the dust on its sunward face, in the Makers\' script.',
    },
    {
        id: 'trail-titan', body: 'titan', name: 'The raft on the methane sea', label: 'The trail · 2 of 4',
        model: 'titanRaft', size: 60, sink: 0.35, reach: 120, afloat: true,
        place: { bearing: 70, distance: 900 },
        blurb: 'A raft of living cells sixty metres across, floating on liquid methane at 94 K. On Earth a cell wall is fat in water; here, chemists have proposed, it could be built of acrylonitrile, which the ALMA radio telescopes found in Titan\'s air in 2017: an azotosome. The raft has grown round a stone, and the bubbles of its cells are laid out in the Makers\' script.',
        hint: 'The stone on Phobos points to a cold sea under an orange sky.',
        trail: 2,
        script: 'THE NEXT IS WHERE A WHITE WORLD BREATHES OUT THROUGH ITS ICE.',
        argo: 'A raft of cells on the methane sea, round a stone. The cells spell out the script.',
    },
    {
        id: 'trail-enceladus', body: 'enceladus', name: 'The frost fans of the tiger stripes', label: 'The trail · 3 of 4',
        model: 'enceladusFans', size: 26, sink: 0.12, reach: 40,
        place: { lat: -80, lon: 330 },
        blurb: 'Near Enceladus\'s south pole four long cracks, the tiger stripes, throw the water of its buried ocean into space; Cassini flew through the spray in 2015 and found hydrogen in it, food for microbes. Round one vent, fans of frost have grown, branched like ferns: a colony feeding on what the ocean breathes out. At its heart is the third stone.',
        hint: 'The raft on Titan points to a white world that breathes out through its ice.',
        trail: 3,
        script: 'THE SHIP THAT CARRIED US LIES ON THE RIDGE OF THE MOON WITH TWO FACES.',
        argo: 'Frost fans round the vent: a colony, alive. The third stone is at its heart.',
    },
    {
        id: 'trail-iapetus', body: 'iapetus', name: 'The seed ship', label: 'The trail · 4 of 4',
        model: 'seedShip', size: 280, lying: true, sink: 0.32, turn: 80, reach: 240,
        place: { lat: 0, lon: 90 },
        blurb: 'Iapetus has two faces, one as dark as coal and one as bright as snow, and round its equator a ridge up to 20 km high and 1,300 km long, which no one has explained. In Arthur C. Clarke\'s novel 2001 the Star Gate waited here. On the dark face, half buried in the ridge, lies a ship nearly three hundred metres long, ribbed like a seed: the one the Makers came in. Its log runs along its hull.',
        hint: 'The fans on Enceladus point to the ridge of the moon with two faces.',
        trail: 4,
        script: 'THIS SHIP CAME THROUGH THE DOOR BY THE RINGED WORLD. ITS DUST DARKENED THIS FACE. ITS FALL RAISED THIS RIDGE. WE WENT OUT TO THE EDGE TO WAIT FOR YOU.',
        argo: 'The seed ship. Two hundred and eighty metres, ribbed, dead for a very long time. Its log runs along the hull.',
    },
    {
        id: 'europa-crevasse', body: 'europa', name: 'The cracked ridge', label: 'Discovery',
        model: 'europaCrevasse', size: 46, sink: 0.3, turn: -30, reach: 50,
        place: { bearing: 52, distance: 470 },
        blurb: 'Europa\'s ice is scored all over by ridges, most of them doubled: a crack down the middle, its edges pushed up a hundred metres or more as Jupiter\'s tides open and close it once in every orbit, three and a half days. Here one has split wide. Its walls are stained reddish-brown with salts from the ocean beneath, and blue at depth where the ice is clean. The Europan came up through a crack like it from a sea some 15 to 25 km down.',
        hint: 'Whoever sent Europa\'s signal came up through the ice somewhere near it.',
        argo: 'A cracked ridge. Salt-stained walls, blue at depth. The ocean is perhaps twenty kilometres down.',
    },
];

/** A find on the trail, by its place in it. */
export const TRAIL = STORY_FINDS.filter((f) => f.trail).sort((a, b) => a.trail! - b.trail!);

export interface FindFrame { centre: THREE.Vector3; up: THREE.Vector3; east: THREE.Vector3; north: THREE.Vector3 }
const frames = new Map<string, FindFrame>();

/** The up at a find (start frame of its world, like the landing zone), on level ground near the spot asked for. */
const findUp = (body: ExpeditionBody, find: StoryFind) => {
    if ('lat' in find.place) return levelGround(body, directionAt(body, find.place.lat, find.place.lon), find.size * 1.5, Math.max(6, find.size * 0.3));
    const zone = landingZoneDirection(body);
    const sun = startSun(body).clone().addScaledVector(zone, -startSun(body).dot(zone));
    const toward = sun.lengthSq() > 1e-6 ? sun.normalize() : openingHeading(body);
    const heading = toward.applyAxisAngle(zone, -THREE.MathUtils.degToRad(find.place.bearing));
    const axis = new THREE.Vector3().crossVectors(zone, heading).normalize();
    const ideal = zone.clone().applyAxisAngle(axis, find.place.distance / body.radius).normalize();
    return find.afloat ? openLiquid(body, ideal) ?? ideal : levelGround(body, ideal, find.size * 1.5, Math.max(6, find.size * 0.3));
};

/**
 * The nearest spot to `ideal` with liquid at least a few metres deep all round
 * it (out on the sea, not in the shallows), searched in widening rings.
 */
const openLiquid = (body: ExpeditionBody, ideal: THREE.Vector3) => {
    const level = body.biome?.liquid?.level;
    if (level === undefined) return null;
    const ground = createGroundFunction(body);
    const tangent = new THREE.Vector3(0, 1, 0).cross(ideal);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0).cross(ideal);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(ideal, tangent);
    const at = new THREE.Vector3();
    const deep = (d: THREE.Vector3) => ground(d.x, d.y, d.z) < level - 4;
    for (let ring = 0; ring <= 40; ring++) {
        const r = ring * 60;
        const steps = ring === 0 ? 1 : 12 + ring * 2;
        for (let k = 0; k < steps; k++) {
            const a = (k / steps) * Math.PI * 2;
            at.copy(ideal).multiplyScalar(body.radius).addScaledVector(tangent, Math.cos(a) * r).addScaledVector(bitangent, Math.sin(a) * r).normalize();
            if (!deep(at)) continue;
            // Open water round it too: the raft is 60 m across.
            let clear = true;
            for (let j = 0; j < 8 && clear; j++) {
                const b = (j / 8) * Math.PI * 2;
                const probe = at.clone().multiplyScalar(body.radius).addScaledVector(tangent, Math.cos(b) * 45).addScaledVector(bitangent, Math.sin(b) * 45).normalize();
                clear = deep(probe);
            }
            if (clear) return at.clone();
        }
    }
    return null;
};

/** Where a find stands, in its world's start frame (the game's frame while the player is at that world). */
export const findFrame = (find: StoryFind): FindFrame => {
    let frame = frames.get(find.id);
    if (frame) return frame;
    const body = findBody(find.body) as ExpeditionBody;
    const up = findUp(body, find);
    const east = new THREE.Vector3(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize().applyAxisAngle(up, THREE.MathUtils.degToRad(find.turn ?? 0));
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const centre = startPosition(body).clone().addScaledVector(up, body.radius + groundHeight(body, up));
    frame = { centre, up, east, north };
    frames.set(find.id, frame);
    return frame;
};

export const findsOn = (body: ExpeditionBody | null) => (body ? STORY_FINDS.filter((f) => f.body === body.id) : []);
export const storyFind = (id: string) => STORY_FINDS.find((f) => f.id === id) ?? null;

// ---- Jupiter's floaters ---------------------------------------------------------------------------

/**
 * In 1976 Carl Sagan and Edwin Salpeter worked out what could live in
 * Jupiter's clouds: "sinkers" falling slowly through them, and "floaters",
 * gas bags up to kilometres across that keep themselves warm and aloft in
 * the water clouds, where the temperature and pressure are those of Earth.
 */
export const FLOATERS = {
    id: 'jupiter-floaters',
    name: 'Jupiter floaters',
    label: 'Discovery · Life',
    blurb: 'Gas bags hundreds of metres across, drifting at the top of Jupiter\'s water clouds, where it is about as warm and the air as dense as on Earth: the "floaters" Carl Sagan and Edwin Salpeter imagined in 1976, keeping themselves aloft by warming their own hydrogen. Their bases pulse with light, two, three, five, seven: they count in primes, as the aeronauts of Venus do. Someone taught them both.',
    argo: 'Floaters. Gas bags two hundred and sixty metres across, at the top of the water clouds. Their light pulses in primes.',
    /** Height range they keep to (game units from the 1 bar level). */
    top: -4300,
    bottom: -6200,
    /** Spacing of the grid their herds are scattered on, and how far off they are drawn. */
    cell: 7000,
    size: 260,
};

// ---- Earth orbit ------------------------------------------------------------------------------------

/**
 * A dead communications satellite in a decaying low orbit among the debris
 * of a collision, like the one on 10 February 2009 when Iridium 33 and the
 * dead Kosmos 2251 met at 11.7 km/s, 789 km over Siberia, and made over two
 * thousand fragments large enough to track. In 1978 Donald Kessler warned
 * that enough of that would set off a cascade, each collision making the
 * fragments for the next.
 *
 * The orbit is a real one at the game's scale: 1,600 units up (above the
 * game's air), going round once every 100 minutes, as a satellite at that
 * height does; the debris cloud drifts along it with the dish.
 */
export const DEBRIS = {
    id: 'earth-debris',
    body: 'projects',
    altitude: 1600,
    period: 100 * 60,
    /** Degrees: the orbit's tilt to Earth's equator, and where along it the cloud is at the start. */
    inclination: 86.4,
    node: 40,
    phase: 0,
    /** The cloud: fragments within this many metres of the dish. */
    spread: 320,
    fragments: 220,
    name: 'A dead satellite',
    label: 'Discovery · Earth orbit',
    blurb: 'A dead communications satellite, its dish torn, tumbling slowly in a cloud of fragments: pieces of it, of a spent upper stage, and of whatever hit them. Over 30,000 pieces larger than a fist are tracked round Earth, and at orbital speed a centimetre of aluminium hits as hard as a hand grenade. Donald Kessler warned in 1978 that collisions could feed on each other until some orbits are unusable for generations.',
    argo: 'The dead satellite, and its debris. Everything here is moving at seven and a half kilometres a second. Match it, or be hit by it.',
};

const orbitAxis = new THREE.Vector3();
const orbitStart = new THREE.Vector3();
const tilt = new THREE.Quaternion();

/**
 * Where the dish is (universe frame, relative to Earth's centre) at clock
 * time `seconds`, and its orbital velocity.
 */
export const debrisOffset = (seconds: number, out: THREE.Vector3, velocity?: THREE.Vector3) => {
    const earth = findBody(DEBRIS.body) as ExpeditionBody;
    const r = earth.radius + DEBRIS.altitude;
    // Tilted from the ecliptic (the universe's +y): near polar, as Iridium's orbits are.
    const node = THREE.MathUtils.degToRad(DEBRIS.node);
    orbitStart.set(Math.cos(node), 0, Math.sin(node));
    tilt.setFromAxisAngle(orbitStart, THREE.MathUtils.degToRad(DEBRIS.inclination));
    orbitAxis.set(0, 1, 0).applyQuaternion(tilt);
    const omega = (2 * Math.PI) / DEBRIS.period;
    const angle = THREE.MathUtils.degToRad(DEBRIS.phase) + omega * seconds;
    out.copy(orbitStart).applyAxisAngle(orbitAxis, angle).multiplyScalar(r);
    if (velocity) velocity.crossVectors(orbitAxis, out).multiplyScalar(omega);
    return out;
};
