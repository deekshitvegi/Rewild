import * as THREE from 'three';
import { AU, EXPEDITION_BODIES, findBody, startPosition, type ExpeditionBody } from './bodies';
import { influenceRadius } from './environment';
import { EPOCH, fromEquatorial, moonDirection, planetPosition, type PlanetName } from './orbits';

/**
 * The Solar System in motion. A clock runs at real time (or faster, with
 * the time warp), and from it every planet is where its orbit puts it, every
 * moon goes round its planet in its real period keeping one face to it, and
 * every world turns at its real rate, so the Sun rises and sets.
 *
 * Everything the game knows about a world's surface (its ground, its sites,
 * where the ship landed) is worked out in that world's own frame, as it was
 * when the expedition began. So the game's coordinates follow the world the
 * player is at (the anchor): it stays exactly where and how it was at the
 * start, unturning, and the rest of the universe (the Sun, the stars, the
 * other worlds) moves and turns round it. That is how it looks from a
 * planet's surface anyway: the sky turns overhead.
 *
 * Changing anchor (flying from one world's reach into another's) moves the
 * player's coordinates, not the player: everything is carried by one rigid
 * motion, so nothing seen changes.
 *
 * The universe frame is the one the system was laid out in: the Sun at the
 * origin, ecliptic north up. The map from it to the game's frame is a
 * rotation M and an offset d: game = M * universe + d.
 */

const HOUR = 3600;
const DAY = 86400;

/** Sidereal rotation periods of the planets, hours (negative: turning backwards). */
const SPIN_HOURS: Record<string, number> = {
    education: 1407.6,
    experience: -5832.5,
    projects: 23.9345,
    skills: 24.6229,
    research: 9.925,
    beyond: 10.656,
    freelance: -17.24,
    certifications: 16.11,
};

/** Orbital periods of the moons, days (negative: going round backwards); each keeps one face to its planet. */
const MOON_DAYS: Record<string, number> = {
    moon: 27.321661,
    phobos: 0.31891,
    deimos: 1.26244,
    io: 1.769138,
    europa: 3.551181,
    ganymede: 7.154553,
    callisto: 16.689018,
    mimas: 0.942422,
    enceladus: 1.370218,
    tethys: 1.887802,
    dione: 2.736915,
    rhea: 4.518212,
    titan: 15.945421,
    iapetus: 79.3215,
    miranda: 1.413479,
    ariel: 2.520379,
    umbriel: 4.144177,
    titania: 8.705872,
    oberon: 13.463239,
    triton: -5.876854,
    // Pluto and Charon face each other: Pluto turns in Charon's period.
    charon: 6.38723,
};

const PLANETS: Record<string, PlanetName> = {
    education: 'mercury',
    experience: 'venus',
    projects: 'earth',
    skills: 'mars',
    research: 'jupiter',
    beyond: 'saturn',
    freelance: 'uranus',
    certifications: 'neptune',
    pluto: 'pluto',
};

/** Poles (right ascension, declination) of the worlds without a map or a gas model: Venus (IAU). */
const POLES: Record<string, [number, number]> = { experience: [272.76, 67.16] };

interface Track {
    body: ExpeditionBody;
    kind: 'sun' | 'planet' | 'moon' | 'luna';
    planet?: PlanetName;
    host?: ExpeditionBody;
    /** Moons: the offset from the host at the start (universe frame). */
    offset0?: THREE.Vector3;
    /** The Moon: its real direction from the Earth at the start. */
    luna0?: THREE.Vector3;
    /** The axis it turns about (universe frame) and how fast, radians a second. */
    pole: THREE.Vector3;
    spin: number;
    /** Moons: how fast they go round, radians a second, about the host's pole. */
    orbit: number;
    /** Where it was at the start, in the game's frame (= universe then). */
    start: THREE.Vector3;
    /** Now, universe frame: position, and its turn from the start. */
    at: THREE.Vector3;
    turn: THREE.Quaternion;
}

const poleOf = (body: ExpeditionBody): THREE.Vector3 => {
    const pole = body.globe?.pole ?? body.gas?.pole ?? POLES[body.id];
    return pole ? fromEquatorial(pole[0], pole[1]) : new THREE.Vector3(0, 1, 0);
};

let tracks: Track[] | null = null;

const buildTracks = () => {
    const list: Track[] = [];
    for (const body of EXPEDITION_BODIES) {
        const start = startPosition(body).clone();
        if (body.kind === 'star') {
            list.push({ body, kind: 'sun', pole: new THREE.Vector3(0, 1, 0), spin: 0, orbit: 0, start, at: start.clone(), turn: new THREE.Quaternion() });
            continue;
        }
        const planet = PLANETS[body.id];
        if (planet) {
            const pole = poleOf(body);
            // Pluto turns with Charon.
            const hours = body.id === 'pluto' ? MOON_DAYS.charon * 24 : SPIN_HOURS[body.id] ?? 24;
            list.push({ body, kind: 'planet', planet, pole, spin: (2 * Math.PI) / (hours * HOUR), orbit: 0, start, at: start.clone(), turn: new THREE.Quaternion() });
            continue;
        }
        const host = body.parent ? findBody(body.parent) ?? null : null;
        const days = MOON_DAYS[body.id];
        if (host && days) {
            // A moon turns once each time round, about the axis it goes round,
            // so the same face always looks at its planet.
            const rate = (2 * Math.PI) / (days * DAY);
            const offset0 = start.clone().sub(startPosition(host));
            if (body.id === 'moon') {
                list.push({ body, kind: 'luna', host, offset0, luna0: moonDirection(EPOCH), pole: poleOf(host), spin: rate, orbit: rate, start, at: start.clone(), turn: new THREE.Quaternion() });
            } else {
                const pole = poleOf(host);
                list.push({ body, kind: 'moon', host, offset0, pole, spin: rate, orbit: rate, start, at: start.clone(), turn: new THREE.Quaternion() });
            }
            continue;
        }
        // Anything else stays where it is, unturning.
        list.push({ body, kind: 'planet', pole: poleOf(body), spin: 0, orbit: 0, start, at: start.clone(), turn: new THREE.Quaternion() });
    }
    // Hosts before their moons.
    const rank = (t: Track) => (t.kind === 'moon' || t.kind === 'luna' ? 1 : 0);
    return list.sort((a, b) => rank(a) - rank(b));
};

export interface Motion {
    /** Seconds of the universe's clock since the expedition began, and how many it runs per real second. */
    seconds: number;
    warp: number;
    /** The game's frame: game = M * universe + d. */
    M: THREE.Quaternion;
    d: THREE.Vector3;
    /** The world the frame follows, or none (out in space). */
    anchor: ExpeditionBody | null;
    /** Each world's turn in the game's frame (identity for the anchor), by id. */
    orientation: Map<string, THREE.Quaternion>;
    /** Bumped each time the frame changes anchor (anything holding game-frame positions of the universe re-reads them). */
    reframes: number;
    /** How fast each world moved in the game's frame over the last step, units per second of the universe's clock. */
    velocity: Map<string, THREE.Vector3>;
}

/** The clock of the expedition under way (there is one at a time), for code that has no runtime to hand. */
let active: Motion | null = null;
export const activeMotion = () => active;

/**
 * A new clock, at the start: every world put back where it was then (a
 * second expedition in one visit starts from the real sky again, not from
 * wherever the last one left the planets).
 */
export const createMotion = (): Motion => {
    const motion: Motion = {
        seconds: 0,
        warp: 1,
        M: new THREE.Quaternion(),
        d: new THREE.Vector3(),
        anchor: null,
        orientation: new Map(EXPEDITION_BODIES.map((b) => [b.id, new THREE.Quaternion()])),
        reframes: 0,
        velocity: new Map(EXPEDITION_BODIES.map((b) => [b.id, new THREE.Vector3()])),
    };
    const list = placeUniverse(0);
    for (const t of list) {
        t.body.position.copy(t.start);
        if (t.body.kind !== 'star') t.body.sunDirection.copy(t.body.lightFrom ?? zeroPoint).sub(t.start).normalize();
    }
    updatePins(motion, list);
    active = motion;
    return motion;
};

/** The steps of the time warp. */
export const WARPS = [1, 10, 100, 1000, 10000, 100000];

/** The universe's date now. */
export const motionDate = (motion: Motion) => new Date(EPOCH.getTime() + motion.seconds * 1000);

const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
/** The Sun, at the universe's centre. */
const zeroPoint = new THREE.Vector3();
const v = new THREE.Vector3();

/** Where everything is in the universe frame at the clock's time. */
const placeUniverse = (seconds: number) => {
    tracks ??= buildTracks();
    const date = new Date(EPOCH.getTime() + seconds * 1000);
    for (const t of tracks) {
        if (t.kind === 'sun') continue;
        if (t.kind === 'planet' && t.planet) {
            t.at.copy(planetPosition(t.planet, date)).multiplyScalar(AU);
            t.turn.setFromAxisAngle(t.pole, t.spin * seconds);
        } else if (t.kind === 'moon' && t.host && t.offset0) {
            const host = tracks.find((h) => h.body === t.host)!;
            q.setFromAxisAngle(t.pole, t.orbit * seconds);
            t.at.copy(t.offset0).applyQuaternion(q).add(host.at);
            t.turn.copy(q);
        } else if (t.kind === 'luna' && t.host && t.offset0 && t.luna0) {
            const host = tracks.find((h) => h.body === t.host)!;
            q.setFromUnitVectors(t.luna0, moonDirection(date));
            t.at.copy(t.offset0).applyQuaternion(q).add(host.at);
            t.turn.copy(q);
        } else {
            t.at.copy(t.start);
        }
    }
    return tracks;
};

/**
 * Things that belong to the universe, not to any world (the wormhole's mouths,
 * TON 618, the derelict, the Wow! signal), held as game-frame vectors that the
 * rest of the game reads directly. They are pinned once at load (when the
 * game's frame is still the universe's) and rewritten from their universe
 * values each time the frame moves. A pinned point may ride with a world
 * (moved along as it goes round the Sun, not turned with its spin): the
 * mouth by Saturn.
 */
interface PinnedPoint { target: THREE.Vector3; universe: THREE.Vector3; host: ExpeditionBody | null; direction: boolean }
interface PinnedTurn { target: THREE.Quaternion; universe: THREE.Quaternion; link: boolean }
const pinnedPoints: PinnedPoint[] = [];
const pinnedTurns: PinnedTurn[] = [];
/** Pin a point (or, with `direction`, a direction) of the universe; with `host`, it rides along with that world. */
export const pinPoint = (target: THREE.Vector3, host: ExpeditionBody | null = null) => {
    pinnedPoints.push({ target, universe: host ? target.clone().sub(startPosition(host)) : target.clone(), host, direction: false });
    return target;
};
export const pinDirection = (target: THREE.Vector3) => {
    pinnedPoints.push({ target, universe: target.clone(), host: null, direction: true });
    return target;
};
/** Pin an orientation (game = M q), or with `link` a rotation between two directions of the universe (game = M q M^-1). */
export const pinTurn = (target: THREE.Quaternion, link = false) => {
    pinnedTurns.push({ target, universe: target.clone(), link });
    return target;
};

const Minv = new THREE.Quaternion();
const updatePins = (motion: Motion, list: Track[]) => {
    Minv.copy(motion.M).invert();
    for (const pin of pinnedPoints) {
        if (pin.direction) {
            pin.target.copy(pin.universe).applyQuaternion(motion.M);
            continue;
        }
        pin.target.copy(pin.universe);
        if (pin.host) {
            const host = list.find((t) => t.body === pin.host);
            if (host) pin.target.add(host.at);
        }
        pin.target.applyQuaternion(motion.M).add(motion.d);
    }
    for (const pin of pinnedTurns) {
        pin.target.copy(motion.M).multiply(pin.universe);
        if (pin.link) pin.target.multiply(Minv);
    }
};

/**
 * The rigid move of the game's frame when it changes anchor, applied to a
 * point (positions) or a direction (rotate only): x' = R (x - from) + to.
 * `velocity` is how the new anchor was moving in the old frame (units per
 * second of the universe's clock): a velocity carried over loses it, so that
 * whatever was closing on the world keeps closing as fast.
 */
export interface Reframe { rotation: THREE.Quaternion; from: THREE.Vector3; to: THREE.Vector3; velocity: THREE.Vector3 }
export const reframePoint = (r: Reframe, p: THREE.Vector3) => p.sub(r.from).applyQuaternion(r.rotation).add(r.to);
export const reframeVelocity = (r: Reframe, v: THREE.Vector3) => v.sub(r.velocity).applyQuaternion(r.rotation);

/** Where the game's frame follows a world: its own reach (a giant's takes in its rings), and the reach it keeps the frame within once it has it. */
const ringsOuter = (body: ExpeditionBody) => body.gas?.rings?.outer ?? Math.max(0, ...(body.gas?.narrowRings ?? []).map((r) => r.outer));
const anchorReach = (body: ExpeditionBody) => body.kind === 'gas' ? body.radius * Math.max(2.5, ringsOuter(body) + 0.2) : influenceRadius(body);
const KEEP = 1.25;

/**
 * The world the game's frame follows: the one whose gravity the player is
 * in; else the last one, while the player is still near it; else a giant
 * whose rings the player is among; else none (out in space, where the frame
 * holds still).
 */
export const chooseAnchor = (motion: Motion, current: ExpeditionBody | null, position: THREE.Vector3): ExpeditionBody | null => {
    if (current && current.kind !== 'star') return current;
    const last = motion.anchor;
    if (last && position.distanceTo(last.position) < anchorReach(last) * KEEP) return last;
    let best: ExpeditionBody | null = null;
    let bestGap = Infinity;
    for (const body of EXPEDITION_BODIES) {
        if (body.kind !== 'gas') continue;
        const distance = position.distanceTo(body.position);
        if (distance < anchorReach(body) && distance - body.radius < bestGap) {
            best = body;
            bestGap = distance - body.radius;
        }
    }
    return best;
};

const previous = new THREE.Vector3();
const placeFrame = (motion: Motion, track: Track) => {
    // The anchor stays put, unturned: the universe turns and moves round it.
    motion.M.copy(track.turn).invert();
    motion.d.copy(track.start).sub(v.copy(track.at).applyQuaternion(motion.M));
};

/**
 * Advance the clock by `dt` real seconds and put every world where it is
 * now. `anchor` is the world the frame is to follow (chooseAnchor); a change
 * of it returns the rigid move to apply to the player and anything else held
 * in the game's frame, else null.
 */
export const stepMotion = (motion: Motion, dt: number, anchor: ExpeditionBody | null): Reframe | null => {
    const step = dt * motion.warp;
    motion.seconds += step;
    const list = placeUniverse(motion.seconds);
    // The frame as the old anchor has it now.
    const old = motion.anchor ? list.find((t) => t.body === motion.anchor) ?? null : null;
    if (old) placeFrame(motion, old);
    const track = anchor ? list.find((t) => t.body === anchor) ?? null : null;
    let reframe: Reframe | null = null;
    if (anchor !== motion.anchor) {
        if (track) {
            // From where the world is now in the old frame (and how it is
            // turned there), to where it was at the start, unturned.
            const from = v.copy(track.at).applyQuaternion(motion.M).add(motion.d).clone();
            previous.copy(track.body.position);
            // How it was moving in the old frame (at a standstill of the clock, as over the last step).
            const velocity = step > 0
                ? from.clone().sub(previous).divideScalar(step)
                : (motion.velocity.get(track.body.id) ?? new THREE.Vector3()).clone();
            const turned = q2.copy(motion.M).multiply(track.turn);
            const rotation = turned.clone().invert();
            reframe = { rotation, from, to: track.start.clone(), velocity };
            motion.reframes += 1;
        }
        motion.anchor = anchor;
        if (track) placeFrame(motion, track);
    }
    for (const t of list) {
        const body = t.body;
        previous.copy(body.position);
        body.position.copy(t.at).applyQuaternion(motion.M).add(motion.d);
        if (step > 0 && !reframe) motion.velocity.get(body.id)?.copy(body.position).sub(previous).divideScalar(step);
        const o = motion.orientation.get(body.id)!;
        o.copy(motion.M).multiply(t.turn);
        if (body.kind !== 'star') {
            // The Sun's direction in the world's own frame (as at the start).
            body.sunDirection.copy(body.lightFrom ?? zeroPoint).sub(t.at).normalize().applyQuaternion(q.copy(t.turn).invert());
        }
    }
    updatePins(motion, list);
    return reframe;
};

/** Where a world was at the start (its place in the game's frame whenever it is the anchor). */
export const startOf = (body: ExpeditionBody) => startPosition(body);

/**
 * A point on or near a world, worked out (as all of a world's surface is)
 * in the game's frame of the start, when that world was where it then was,
 * unturned: where it is in the game's frame now. The identity for the anchor.
 */
export const fromStart = (motion: Motion, body: ExpeditionBody, point: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(point).sub(startOf(body)).applyQuaternion(orientationOf(motion, body)).add(body.position);

/**
 * A point given as a world's centre (where it is now) plus an offset in the
 * world's own frame, which is how places on a world are often worked out:
 * the offset turned as the world is now. In place; the identity for the anchor.
 */
export const turnWithWorld = (motion: Motion, body: ExpeditionBody, point: THREE.Vector3) =>
    point.sub(body.position).applyQuaternion(orientationOf(motion, body)).add(body.position);

/** The other way: a point in the game's frame now, in a world's frame of the start. */
export const toStart = (motion: Motion, body: ExpeditionBody, point: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(point).sub(body.position).applyQuaternion(q.copy(orientationOf(motion, body)).invert()).add(startOf(body));

/** A rotation (a ship's attitude) held in a world's frame of the start, now. */
export const turnFromStart = (motion: Motion, body: ExpeditionBody, turn: THREE.Quaternion, out: THREE.Quaternion) =>
    out.copy(orientationOf(motion, body)).multiply(turn);

/** A point in the game's frame, in the universe's (the Sun at the centre, ecliptic north up). */
export const toUniverse = (motion: Motion, point: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(point).sub(motion.d).applyQuaternion(q.copy(motion.M).invert());

/**
 * For things drawn on a world in its frame of the start, relative to the
 * floating origin (props, sites, a volcano's plume): the matrix that puts
 * them where the world is now. The identity for the anchor.
 */
export const startFrameMatrix = (motion: Motion, body: ExpeditionBody, origin: THREE.Vector3, out: THREE.Matrix4) => {
    const start = startOf(body);
    const o = orientationOf(motion, body);
    out.makeRotationFromQuaternion(o);
    // x -> o (x - (start - origin)) + (position - origin)
    v.copy(start).sub(origin).applyQuaternion(o).negate().add(body.position).sub(origin);
    out.setPosition(v);
    return out;
};

/** A point given in a world's own frame (from its centre), in the game's frame now. */
export const bodyToGame = (motion: Motion, body: ExpeditionBody, local: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(local).applyQuaternion(motion.orientation.get(body.id) ?? q.identity()).add(body.position);

/** A point in the game's frame, in a world's own frame (from its centre). */
export const gameToBody = (motion: Motion, body: ExpeditionBody, point: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(point).sub(body.position).applyQuaternion(q.copy(motion.orientation.get(body.id) ?? q.identity()).invert());

/** A direction given in the universe frame (the stars, a radio source), in the game's frame now. */
export const universeDirection = (motion: Motion, direction: THREE.Vector3, out: THREE.Vector3) => out.copy(direction).applyQuaternion(motion.M);

/** A point given in the universe frame, in the game's frame now. */
export const universePoint = (motion: Motion, point: THREE.Vector3, out: THREE.Vector3) => out.copy(point).applyQuaternion(motion.M).add(motion.d);

const identity = new THREE.Quaternion();
/** How a world is turned in the game's frame now (identity for the anchor). */
export const orientationOf = (motion: Motion, body: ExpeditionBody) => motion.orientation.get(body.id) ?? identity;

/**
 * For a world's renderer: put its group where the world is and turned as
 * it is, and give back the camera in the world's own frame (its shaders work
 * there, from its centre).
 */
export const placeBodyGroup = (motion: Motion, body: ExpeditionBody, group: THREE.Object3D, scenePosition: THREE.Vector3, camera: THREE.Vector3, cameraLocal: THREE.Vector3) => {
    const o = orientationOf(motion, body);
    group.position.copy(scenePosition);
    group.quaternion.copy(o);
    return cameraLocal.copy(camera).sub(scenePosition).applyQuaternion(q.copy(o).invert());
};

/** A direction in the game's frame, in a world's own frame. */
export const directionToBody = (motion: Motion, body: ExpeditionBody, direction: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(direction).applyQuaternion(q.copy(orientationOf(motion, body)).invert());

/** A direction in a world's own frame, in the game's frame. */
export const directionToGame = (motion: Motion, body: ExpeditionBody, direction: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(direction).applyQuaternion(orientationOf(motion, body));

// The worlds' starting places are taken now, before anything moves them.
tracks = buildTracks();
