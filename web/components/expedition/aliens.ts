import * as THREE from 'three';
import { findBody, startSun, type ExpeditionBody } from './bodies';
import { groundHeight, levelGround } from './environment';
import { landingZoneDirection, openingHeading } from './sites';

/**
 * Life beyond Earth, where scientists really think it most likely to be in
 * the Solar System, and as it would most likely be found:
 *
 * - Europa hides a salt-water ocean under its ice, and plumes may vent it to
 *   space. Sampling such a plume is how life there would first be found.
 * - Titan's air is thicker than Earth's and its gravity a seventh of it:
 *   things could float. Carl Sagan imagined "floaters" for Jupiter's clouds;
 *   Titan's haze suits them better.
 * - On Mars, if anything lives now it lives inside rock, out of the
 *   radiation, as lichens and bacteria do in Antarctica's Dry Valleys.
 *
 * Each site sits a walk from its world's landing zone, and sends the signal
 * the ship's radio picks up (radio.ts). Looking at a life form long enough
 * scans it: first contact.
 */
export type LifeKind = 'plume' | 'frozen' | 'floater' | 'endolith' | 'walker' | 'glider' | 'aeronaut' | 'maker' | 'europan';

export interface LifeForm {
    id: string;
    name: string;
    kind: LifeKind;
    /** What the scan says about it. */
    blurb: string;
    /**
     * Animals that walk (Wildlife.tsx draws and moves them, as it does a
     * world's own): which rigged model, how many keep near the site, how they
     * take to the explorer, and their walking pace (m/s).
     */
    herd?: { model: 'crawler' | 'stilt' | 'hunter'; count: number; mind: 'tolerant' | 'curious' | 'skittish' | 'predator'; walk: number };
}

export interface AlienSite {
    /** Also the id of the radio source it sends. */
    id: string;
    body: string;
    /**
     * Degrees from the Sun's direction as seen at the landing zone (positive:
     * to its right), and metres from the zone. Walking towards the Sun's side
     * keeps a site in daylight: on a moon a few kilometres across, a kilometre
     * is a sixth of the way round to night.
     */
    bearing: number;
    distance: number;
    /** Metres above the ground, for life that never touches it (and the signal it sends). */
    altitude?: number;
    life: LifeForm[];
}

export const ALIEN_SITES: AlienSite[] = [
    {
        id: 'europa-signal', body: 'europa', bearing: 40, distance: 420,
        life: [
            {
                id: 'europa-microbes', name: 'Vent-spray microbes', kind: 'plume',
                blurb: 'Single cells riding the plume up from the ocean under the ice, glowing faintly blue. They live on chemistry from the sea floor and have never seen the Sun.',
            },
            {
                id: 'europa-crawlers', name: 'Ice crawlers', kind: 'walker',
                blurb: 'Five-legged grazers with shells like frosted glass, picking salts and frozen cells off the ice where the vent spills ocean water. They startle easily and skitter off on their spread claws. The sea below holds more than microbes.',
                herd: { model: 'crawler', count: 6, mind: 'skittish', walk: 1.6 },
            },
            {
                id: 'europa-europan', name: 'A Europan', kind: 'europan',
                blurb: 'It came up the vent from the ocean under the ice, in a suit of shell plates its people grow, and it is looking at you as hard as you are looking at it. Whoever sent the signal was not the microbes.',
            },
        ],
    },
    {
        id: 'titan-signal', body: 'titan', bearing: -40, distance: 600,
        life: [
            {
                id: 'titan-floaters', name: 'Titan floaters', kind: 'floater',
                blurb: 'Gas bags metres across, drifting in air four times as dense as Earth\'s under a seventh of its gravity. They feed on the haze and pulse with light at their bases.',
            },
            {
                id: 'titan-gliders', name: 'Titan gliders', kind: 'glider',
                blurb: 'Leathery kites eight metres across, riding the thick, slow air on their wings alone: on Titan a person could fly with wings strapped to their arms. They trail long tendrils to taste the haze.',
            },
        ],
    },
    {
        id: 'mars-signal', body: 'skills', bearing: 60, distance: 800,
        life: [
            {
                id: 'mars-endoliths', name: 'Martian endoliths', kind: 'endolith',
                blurb: 'A green layer a few millimetres under the surface of split rocks: microbes living inside stone, out of the radiation, as they do in Antarctica\'s Dry Valleys.',
            },
            {
                id: 'mars-stilts', name: 'Stilt grazers', kind: 'walker',
                blurb: 'Three-legged and taller than a person, they pick their way across the canyon floor on legs like dry reeds, probing split rock with a long beak for the green layer inside. Slow, and unafraid of you.',
                herd: { model: 'stilt', count: 4, mind: 'tolerant', walk: 1.1 },
            },
        ],
    },
    {
        // Out at Neptune: where the vaults end, the ones who built them.
        id: 'triton-signal', body: 'triton', bearing: 55, distance: 520,
        life: [
            {
                id: 'triton-makers', name: 'The Makers', kind: 'maker',
                blurb: 'Tall, robed, unhurried. They built the vaults and spelled out their keys in a script that runs from SKY to END, and one of them has been waiting at the edge of the system for someone who could read it all.',
            },
            {
                id: 'triton-hunters', name: 'Frost hunters', kind: 'walker',
                blurb: 'Pale five-legged predators of the nitrogen frost, hunting by the warmth of anything that moves. They keep their distance from the Makers. They do not like the mining beam either.',
                herd: { model: 'hunter', count: 2, mind: 'predator', walk: 1.8 },
            },
        ],
    },
    {
        // Venus: fifty kilometres up the air is mild and about as thick as
        // Earth's at sea level, the likeliest place on the planet for life.
        id: 'venus-signal', body: 'experience', bearing: -25, distance: 900, altitude: 980,
        life: [
            {
                id: 'venus-aeronauts', name: 'Venusian aeronauts', kind: 'aeronaut',
                blurb: 'Living airships ten metres long that have never touched the ground: down there it is hot enough to melt lead. They drift in the mild air between the cloud decks, weave nets of crystal fibre to catch what the winds carry, and talk to one another in radio pulses. That was the signal you followed.',
            },
        ],
    },
];

/** Every life form, by id. */
export const LIFE_FORMS = ALIEN_SITES.flatMap((site) => site.life);

const directions = new Map<string, THREE.Vector3>();

/** The unit direction of a site on its world. */
export const siteDirection = (site: AlienSite) => {
    let direction = directions.get(site.id);
    if (!direction) {
        const body = findBody(site.body) as ExpeditionBody;
        const zone = landingZoneDirection(body);
        // The Sun's direction along the ground at the zone (the way the explorer faces, if it is overhead).
        const sun = startSun(body).clone().addScaledVector(zone, -startSun(body).dot(zone));
        const toward = sun.lengthSq() > 1e-6 ? sun.normalize() : openingHeading(body);
        const heading = toward.applyAxisAngle(zone, -THREE.MathUtils.degToRad(site.bearing));
        // Walk `distance` along the surface from the zone, in the bearing's direction.
        const axis = new THREE.Vector3().crossVectors(zone, heading).normalize();
        // On level ground near there: a site stands where people can walk to it, not on a ridge.
        direction = levelGround(body, zone.clone().applyAxisAngle(axis, site.distance / body.radius).normalize(), site.distance * 0.7, 35);
        directions.set(site.id, direction);
    }
    return direction;
};

/** Where a site is (on the ground, or up in the air for life that floats), world units. */
export const sitePosition = (site: AlienSite, out = new THREE.Vector3()) => {
    const body = findBody(site.body) as ExpeditionBody;
    const direction = siteDirection(site);
    return out.copy(body.position).addScaledVector(direction, body.radius + groundHeight(body, direction) + (site.altitude ?? 0));
};

/** The walking life of a world's alien sites, with where each lives. */
export const alienHerdsOn = (body: ExpeditionBody | null) => (body
    ? ALIEN_SITES.filter((site) => site.body === body.id).flatMap((site) => site.life.filter((life) => life.herd).map((life) => ({ site, life })))
    : []);

export const siteOn = (body: ExpeditionBody | null) => (body ? ALIEN_SITES.find((site) => site.body === body.id) ?? null : null);
