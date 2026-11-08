import * as THREE from 'three';
import { findBody, startPosition, type ExpeditionBody } from './bodies';
import { groundHeight, levelGround } from './environment';
import { earthMapSettled } from './earth';
import { marsMapSettled } from './mars';
import { fromEquatorial } from './orbits';
import { globeFrame, landingZoneDirection } from './sites';

/**
 * Real history on the worlds: the places spacecraft and astronauts actually
 * reached, at their real latitudes and longitudes on each world's map, with
 * what was left there. Each is a find for its chapter's medal; the Mars
 * sample tubes are also a job, the one NASA and ESA planned as Mars Sample
 * Return: pick up the ten tubes Perseverance left, and bring them to Earth.
 */
export interface HistoricSite {
    id: string;
    body: string;
    /** The place, and who reached it. */
    name: string;
    mission: string;
    /** Degrees, north and east (planetocentric, as each world's own maps have them). */
    lat: number;
    lon: number;
    /** What the discovery card says. */
    blurb: string;
    /** Metres: closer than this, it has been found. */
    reach: number;
}

export const HISTORIC_SITES: HistoricSite[] = [
    {
        id: 'apollo11', body: 'moon', name: 'Tranquility Base', mission: 'Apollo 11', lat: 0.6741, lon: 23.473, reach: 40,
        blurb: 'On 20 July 1969 Neil Armstrong and Buzz Aldrin landed the lunar module Eagle here and walked for two and a half hours. The descent stage stayed behind as the launch pad for their climb back to orbit; its plaque reads "Here men from the planet Earth first set foot upon the Moon, July 1969 A.D. We came in peace for all mankind." Aldrin saw the flag blown over as they left. The laser reflector they set up is still used to measure the distance to the Moon to the centimetre.',
    },
    {
        id: 'venera13', body: 'experience', name: 'Venera 13', mission: 'Venera 13', lat: -7.5, lon: 303, reach: 30,
        blurb: 'On 1 March 1982 the Soviet lander came down here and worked for 127 minutes, four times its design life, in 457 °C and 89 times Earth\'s air pressure before the heat won. It sent back the first colour pictures of the surface of another planet, and drilled a sample of this rock: basalt, like the lava fields of Earth.',
    },
    {
        id: 'three-forks', body: 'skills', name: 'Three Forks', mission: 'Perseverance', lat: 18.4447, lon: 77.4508, reach: 45,
        blurb: 'Between December 2022 and January 2023 the Perseverance rover set ten sealed sample tubes down here in Jezero crater, 5 to 15 m apart in a zigzag so that the helicopters meant to fetch them could pick each one up safely: seven cores of the crater\'s rocks, a scoop of its soil, a sample of its air, and a witness tube that shows what came with them from Earth. They wait for a mission to bring them home. Pick them up (E), and take them to Earth.',
    },
    {
        id: 'seed-vault', body: 'projects', name: 'Svalbard Global Seed Vault', mission: 'The Seed Vault', lat: 78.2357, lon: 15.4913, reach: 30,
        blurb: 'Dug 120 m into the sandstone of Platåberget on Spitsbergen, 130 m above the sea so that it stays dry even if the ice caps melt, and kept at -18 °C, the vault opened in 2008 to hold a spare copy of every crop on Earth: more than a million packets of seed from almost every country, sealed in foil. It was meant for exactly this. The permafrost held. Noor has the first crates aboard; the greenhouse can start.',
    },
    {
        id: 'shackleton', body: 'moon', name: 'Shackleton rim', mission: 'Eternal Light', lat: -89.68, lon: -166.0, reach: 35,
        blurb: 'On the rim of Shackleton crater at the Moon\'s south pole the Sun never quite sets: the Moon\'s axis is tilted only 1.5 degrees, so here it circles just above the horizon and some ridges are lit more than 80 percent of the year. The crater floor, 4 km down, has not seen sunlight in billions of years and holds ice. The last lunar base stood its solar masts here for that light. Turned to the Sun again, they can beam power home to Earth\'s greenhouses.',
    },
];

/** The ten tubes at Three Forks, in the order Perseverance set them down (Mars 2020 sample names). */
export const SAMPLE_TUBES = [
    'Malay · igneous rock core', 'Mageik · sedimentary rock core', 'Crosswind Lake · soil', 'Roubion · Martian air',
    'Coulettes · igneous rock core', 'Montdenier · igneous rock core', 'Bearwallow · sedimentary rock core',
    'Skyland · sedimentary rock core', 'Atsah · igneous rock core', 'Amalik · witness tube',
];
export const tubeId = (i: number) => `tube-${i + 1}`;

// Venus has no map to be true to (its ground is hidden under cloud from
// space): its real pole, turned so that Venera 13's longitude runs through
// where the ship sets down, the lander due south of it.
const VENUS_POLE: [number, number] = [272.76, 67.16];

const frames = new Map<string, { zero: THREE.Vector3; north: THREE.Vector3; east: THREE.Vector3 }>();

/** A world's map frame: longitude 0, north, and longitude 90 east. */
const frameOf = (body: ExpeditionBody) => {
    let frame = frames.get(body.id);
    if (frame) return frame;
    if (body.globe) {
        const m = globeFrame(body).elements;
        frame = { zero: new THREE.Vector3(m[0], m[3], m[6]), north: new THREE.Vector3(m[1], m[4], m[7]), east: new THREE.Vector3(m[2], m[5], m[8]) };
    } else {
        const north = fromEquatorial(VENUS_POLE[0], VENUS_POLE[1]);
        const zone = landingZoneDirection(body);
        const site = HISTORIC_SITES.find((s) => s.body === body.id);
        const meridian = zone.clone().addScaledVector(north, -zone.dot(north)).normalize();
        const zero = meridian.applyAxisAngle(north, -THREE.MathUtils.degToRad(site?.lon ?? 0));
        frame = { zero, north, east: new THREE.Vector3().crossVectors(north, zero) };
    }
    frames.set(body.id, frame);
    return frame;
};

/** The unit direction from a world's centre to a latitude and longitude on it. */
export const directionAt = (body: ExpeditionBody, lat: number, lon: number, out = new THREE.Vector3()) => {
    const { zero, north, east } = frameOf(body);
    const p = THREE.MathUtils.degToRad(lat);
    const l = THREE.MathUtils.degToRad(lon);
    return out.copy(zero).multiplyScalar(Math.cos(p) * Math.cos(l)).addScaledVector(east, Math.cos(p) * Math.sin(l)).addScaledVector(north, Math.sin(p)).normalize();
};

/** Latitude and longitude (degrees) of a direction from a world's centre. */
export const latLonOf = (body: ExpeditionBody, direction: THREE.Vector3) => {
    const { zero, north, east } = frameOf(body);
    return {
        lat: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(direction.dot(north), -1, 1))),
        lon: THREE.MathUtils.radToDeg(Math.atan2(direction.dot(east), direction.dot(zero))),
    };
};

export interface SiteFrame {
    centre: THREE.Vector3;
    up: THREE.Vector3;
    /** Along the ground: east and north there. */
    east: THREE.Vector3;
    north: THREE.Vector3;
    /** Where each tube lies (Three Forks only), on the ground. */
    tubes: THREE.Vector3[];
}

const siteFrames = new Map<string, SiteFrame>();

// In the game's frame of the start, like everything laid out on a world (motion.ts).
const onGround = (body: ExpeditionBody, direction: THREE.Vector3) =>
    startPosition(body).clone().addScaledVector(direction, body.radius + groundHeight(body, direction));

export const siteFrame = (site: HistoricSite): SiteFrame => {
    let frame = siteFrames.get(site.id);
    if (frame) return frame;
    const body = findBody(site.body) as ExpeditionBody;
    // On the most level ground within a few tens of metres of the real spot
    // (here a metre is half a kilometre of the real world): the lander's legs,
    // or the depot's zigzag, all on the ground.
    const up = levelGround(body, directionAt(body, site.lat, site.lon), 80, site.id === 'three-forks' ? 50 : site.id === 'shackleton' ? 22 : site.id === 'seed-vault' ? 16 : 6);
    const axes = frameOf(body);
    const east = axes.east.clone().addScaledVector(up, -axes.east.dot(up));
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0).addScaledVector(up, -up.x);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const tubes: THREE.Vector3[] = [];
    if (site.id === 'three-forks') {
        // The real depot's zigzag across a flat stretch, about 5 to 15 m between tubes.
        for (let i = 0; i < SAMPLE_TUBES.length; i++) {
            const along = (i - 4.5) * 9;
            const across = (i % 2 ? 1 : -1) * (5 + (i * 7 % 5));
            const spot = up.clone().multiplyScalar(body.radius).addScaledVector(east, along).addScaledVector(north, across).normalize();
            tubes.push(onGround(body, spot));
        }
    }
    frame = { centre: onGround(body, up), up, east, north, tubes };
    // Kept once the ground under it is final (Earth's and Mars's maps load after the start).
    if (body.id === 'projects' ? earthMapSettled() : body.id === 'skills' ? marsMapSettled() : true) siteFrames.set(site.id, frame);
    return frame;
};

const clearings = new Map<string, { direction: THREE.Vector3; cos: number }[]>();
/**
 * Where nothing is scattered on a world (propPlacement.ts): round each historic site, wide enough
 * for wherever level ground put it (80 m search) and what stands there, so no tree grows through
 * the seed vault and no boulder sits on the lander.
 */
export const siteClearings = (body: ExpeditionBody) => {
    let list = clearings.get(body.id);
    if (!list) {
        list = sitesOn(body).map((site) => ({ direction: directionAt(body, site.lat, site.lon), cos: Math.cos(140 / body.radius) }));
        clearings.set(body.id, list);
    }
    return list;
};

export const sitesOn = (body: ExpeditionBody | null) => (body ? HISTORIC_SITES.filter((site) => site.body === body.id) : []);
