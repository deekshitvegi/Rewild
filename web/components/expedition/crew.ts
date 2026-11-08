import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import type { ShipState } from './flight';
import { directionToBody, directionToGame, gameToBody, bodyToGame, toUniverse, universePoint, orientationOf, type Motion } from './motion';
import type { WalkerState } from './walking';

/**
 * The crew of four (docs/story.md): two women and two men, each playable, each with a ship of
 * their own. Switch to any of them at any time, as in GTA V (keys 1-4, or the crew panel): each
 * stays where they were left, on whatever world, on foot or in their ship.
 *
 * Each has a ship of their own, the same fighter, so one can be left on Mars and another on Titan.
 * (The names are placeholders until the owner picks them.) The big ship they came home in, the
 * Argo, is mothership.ts.
 */
export type CrewId = 'dev' | 'noor' | 'kai' | 'amara';

export interface CrewDef {
    id: CrewId;
    name: string;
    role: string;
    /** Their colour on the crew panel. */
    colour: string;
    /** public/textures/crew/<id>.webp (and <id>-full.webp, 720 x 964) */
    portrait: string;
    /** What they are best at, for the crew page. */
    strength: string;
}

export const CREW: CrewDef[] = [
    { id: 'dev', name: 'Dev Arora', role: 'Commander, pilot', colour: '#ffb547', portrait: 'dev', strength: 'Flying: longer pulse jumps, the autopilot, landing in storms.' },
    { id: 'noor', name: 'Noor Haddad', role: 'Botanist', colour: '#7fd18b', portrait: 'noor', strength: 'Growing: reads the soil, and does the most to bring Earth back.' },
    { id: 'kai', name: 'Kai Mendes', role: 'Engineer', colour: '#7fb8ff', portrait: 'kai', strength: 'Building: habitats and repairs; salvages more from wrecks.' },
    { id: 'amara', name: 'Amara Okafor', role: 'Physicist', colour: '#c69bff', portrait: 'amara', strength: 'The Makers\' technology: reads their glyphs, runs the wormhole.' },
];

/** A ship (and maybe someone on foot) left somewhere while it is not being played. */
export interface Held {
    ship: ShipState;
    walker: WalkerState | null;
    home: ExpeditionBody | null;
    parked: boolean;
}

export interface CrewMember extends Held {
    def: CrewDef;
    /** Their own ship, where they left it (the active member's is the live one, kept in Player). */
    ship: ShipState;
    /** On foot, where they stand; null aboard. */
    walker: WalkerState | null;
    /**
     * While not being played, their ship and walker are held in the frame of the world they were
     * left at (from its centre, turned with it), so they go round the Sun and turn with it like
     * the ground they stand on; null holds them in the universe's frame (out in space).
     */
    home: ExpeditionBody | null;
    /** Held as above (true), or live in the game's frame (false: the one being played). */
    parked: boolean;
}

export interface CrewState {
    members: CrewMember[];
    /** The one being played. */
    active: number;
    /** Bumped on every switch, for whatever shows the crew. */
    version: number;
    /** The others' ships have been set down beside the first one. */
    placed: boolean;
}

/** Where the other three ships stand at the start, in the first one's frame (metres; forward -Z). */
export const START_OFFSETS: [number, number, number][] = [[-16, 0, 4], [16, 0, 4], [0, 0, 20]];

/** Copy every part of one ship's state into another. */
export const copyShip = (from: ShipState, to: ShipState) => {
    to.position.copy(from.position);
    to.velocity.copy(from.velocity);
    to.quaternion.copy(from.quaternion);
    to.angular.copy(from.angular);
    to.drift.copy(from.drift);
    to.wind.copy(from.wind);
    to.throttle = from.throttle;
    to.stickX = from.stickX;
    to.stickY = from.stickY;
    to.boost = from.boost;
    to.pulse = from.pulse;
    to.pulseEngaged = from.pulseEngaged;
    to.gear = from.gear;
    to.landed = from.landed;
    to.landing = from.landing
        ? { t: from.landing.t, from: from.landing.from.clone(), to: from.landing.to.clone(), fromQ: from.landing.fromQ.clone(), toQ: from.landing.toQ.clone() }
        : null;
    to.takeoff = from.takeoff;
    to.shield = from.shield;
    to.entry = from.entry;
    to.notice = from.notice;
    to.noticeTime = from.noticeTime;
    to.hurtBy = from.hurtBy;
    to.destroyed = from.destroyed ? { ...from.destroyed } : null;
    to.replacedAt = from.replacedAt;
    to.temperature = from.temperature;
    to.sunDive = from.sunDive;
    to.beltTime = from.beltTime;
    to.beltLimit = from.beltLimit;
    to.jolt = from.jolt;
    return to;
};

/** A ship state of its own, the same as `from`. */
export const cloneShip = (from: ShipState): ShipState => copyShip(from, {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion(), angular: new THREE.Vector3(),
    drift: new THREE.Vector3(), wind: new THREE.Vector3(),
} as ShipState);

/** Dev flying (or about to); the other three ships set down beside his (placeBeside, once the world is known). */
export const createCrew = (start: ShipState): CrewState => ({
    members: CREW.map((def) => ({ def, ship: cloneShip(start), walker: null, home: null, parked: false })),
    active: 0,
    version: 0,
    placed: false,
});

const offset = new THREE.Vector3();
/** A spot in a ship's frame, in the world: where one of the others stands at the start. */
export const besidePose = (leader: ShipState, slot: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion) => {
    const [x, y, z] = START_OFFSETS[slot % START_OFFSETS.length];
    offset.set(x, y, z).applyQuaternion(leader.quaternion);
    outPosition.copy(leader.position).add(offset);
    outQuaternion.copy(leader.quaternion);
};

const turn = new THREE.Quaternion();
const point = (motion: Motion, home: ExpeditionBody | null, p: THREE.Vector3, outward: boolean) => {
    if (home) return outward ? bodyToGame(motion, home, p, p) : gameToBody(motion, home, p, p);
    return outward ? universePoint(motion, p, p) : toUniverse(motion, p, p);
};
const direction = (motion: Motion, home: ExpeditionBody | null, d: THREE.Vector3, outward: boolean) => {
    if (home) return outward ? directionToGame(motion, home, d, d) : directionToBody(motion, home, d, d);
    turn.copy(motion.M);
    if (!outward) turn.invert();
    return d.applyQuaternion(turn);
};
/** The world's turn (or the universe's) to apply to an attitude, held (outward false) or put back in play. */
const attitude = (motion: Motion, home: ExpeditionBody | null, q: THREE.Quaternion, outward: boolean) => {
    turn.copy(home ? orientationOf(motion, home) : motion.M);
    if (!outward) turn.invert();
    return q.premultiply(turn);
};

const moveShip = (ship: ShipState, motion: Motion, home: ExpeditionBody | null, outward: boolean) => {
    point(motion, home, ship.position, outward);
    direction(motion, home, ship.velocity, outward);
    direction(motion, home, ship.drift, outward);
    direction(motion, home, ship.wind, outward);
    direction(motion, home, ship.angular, outward);
    attitude(motion, home, ship.quaternion, outward);
    ship.landing = null;
};
const moveWalker = (walker: WalkerState, motion: Motion, home: ExpeditionBody | null, outward: boolean) => {
    point(motion, home, walker.position, outward);
    direction(motion, home, walker.velocity, outward);
    direction(motion, home, walker.facing, outward);
    direction(motion, home, walker.look, outward);
};

/** Leave a member where they are (their ship and walker in the game's frame now) at `home`. */
export const park = (member: Held, motion: Motion, home: ExpeditionBody | null) => {
    if (member.parked) return;
    member.home = home;
    moveShip(member.ship, motion, home, false);
    if (member.walker) moveWalker(member.walker, motion, home, false);
    member.parked = true;
};

/** Bring a parked member's ship and walker back into the game's frame, as they are now. */
export const unpark = (member: Held, motion: Motion) => {
    if (!member.parked) return;
    moveShip(member.ship, motion, member.home, true);
    if (member.walker) moveWalker(member.walker, motion, member.home, true);
    member.parked = false;
};

/** Where a parked member's ship is in the game's frame now (without unparking it). */
export const shipPose = (member: Held, motion: Motion, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion) => {
    outPosition.copy(member.ship.position);
    outQuaternion.copy(member.ship.quaternion);
    if (member.parked) {
        point(motion, member.home, outPosition, true);
        attitude(motion, member.home, outQuaternion, true);
    }
};

/** Where a parked member stands in the game's frame now, and the way they face. */
export const walkerPose = (member: Held, motion: Motion, outPosition: THREE.Vector3, outFacing: THREE.Vector3) => {
    const walker = member.walker;
    if (!walker) return false;
    outPosition.copy(walker.position);
    outFacing.copy(walker.facing);
    if (member.parked) {
        point(motion, member.home, outPosition, true);
        direction(motion, member.home, outFacing, true);
    }
    return true;
};

/** A distance between crew, for a notice: metres, then kilometres, then millions of km. */
export const formatMetres = (metres: number) => {
    if (metres < 1000) return `${Math.round(metres)} M`;
    if (metres < 1e9) return `${(metres / 1000).toLocaleString('en-GB', { maximumFractionDigits: metres < 1e5 ? 1 : 0 })} KM`;
    return `${(metres / 1e9).toFixed(1)} MILLION KM`;
};

export interface CrewCard {
    id: CrewId;
    name: string;
    role: string;
    strength: string;
    /** Where they are and what they are doing, in a few words. */
    status: string;
    active: boolean;
}

/** The crew for the HUD's crew panel. */
export const crewCards = (crew: CrewState, onFoot: boolean, here: ExpeditionBody | null, landed: boolean, aboardMothership: boolean): CrewCard[] => crew.members.map((m, i) => {
    let status: string;
    if (i === crew.active) status = aboardMothership ? `Flying the Argo${here ? ` · ${here.name}` : ''}` : onFoot ? `On foot · ${here?.name ?? 'space'}` : landed && here ? `Landed · ${here.name}` : here ? `Flying · ${here.name}` : 'Flying · deep space';
    else if (m.walker) status = `On foot · ${m.home?.name ?? 'space'}`;
    else if (m.ship.landed && m.home) status = `Landed · ${m.home.name}`;
    else status = m.home ? `Near ${m.home.name}` : 'Deep space';
    return { id: m.def.id, name: m.def.name, role: m.def.role, strength: m.def.strength, status, active: i === crew.active };
});
