import * as THREE from 'three';
import { BLACK_HOLE } from './deepSpace';
import type { ShipState } from './flight';

/**
 * Falling into TON 618, drawn by the game's own black hole renderer rather
 * than a separate film: once the ship is inside FALL_TRIGGER horizon radii
 * nothing it can do will stop it, so it spirals in, prograde, past the
 * photon sphere and through the horizon (no wall, no flash), then on inside,
 * where the renderer keeps tracing what a falling camera would see: the dark
 * below it grows, the sky behind reddens and dims, and the last light is
 * squeezed into a bright ring. The log then ends; a new ship leaves the
 * wormhole by Saturn. Nothing comes back out.
 *
 * The path is a scripted approximation of a plunging orbit, not a solution
 * of the equations of motion.
 *
 * The times are the real ones, told on the ship's clock and shown much faster. TON 618 is about 66
 * billion Suns: its horizon is r_s = 2GM/c^2 = 1.95e11 km (1,300 AU) from the centre. Falling in
 * from far away, the ship's own time from 1.8 r_s to the horizon is (2/3)(r_s/c)(1.8^1.5 - 1) = 7.1
 * days, and from the horizon to the centre (2/3) r_s/c = 5.0 days. The tidal stretch across a 10 m
 * hull, 2GM L / r^3, is 2.4e-11 m/s^2 at the horizon (a hole this big lets you in whole); it reaches
 * a hundred g only at r = 2.9e-5 r_s, in the last 0.07 s of the five days. That last moment,
 * spaghettification, is shown slowed down: the ship drawn out along the line to the centre and
 * squeezed from the sides (spacetime.ts), with afterimages. There is no smaller black hole in the
 * game, where the stretching would come before the horizon.
 */
export const FALL_TRIGGER = 1.8;
/** Seconds from the trigger to the horizon, inside it, the five days passing, the end (slowed), fading out, and the card. */
export const FALL_SPIRAL = 10;
export const FALL_INSIDE = 6.0;
export const FALL_SKIP = 6.6;
export const FALL_STRETCH = 3.8;
export const FALL_FADE = 1.2;
export const FALL_CARD = 4.5;
/** When the end begins, and when the log ends (the fade to black), seconds into the fall. */
export const FALL_STRETCH_AT = FALL_SPIRAL + FALL_INSIDE + FALL_SKIP;
export const FALL_LOST_AT = FALL_STRETCH_AT + FALL_STRETCH;
export const FALL_TOTAL = FALL_LOST_AT + FALL_FADE + FALL_CARD;

/** TON 618's horizon in light-seconds (r_s / c). */
export const HORIZON_SECONDS = 1.949e14 / 2.998e8;
/** The ship's own time left before the centre from r (in r_s), falling in from far away. */
const timeLeftAt = (r: number) => (2 / 3) * HORIZON_SECONDS * Math.pow(Math.max(r, 0), 1.5);
/** The last stretch is this long on the ship's clock (100 g across a 10 m hull), shown over FALL_STRETCH seconds. */
const LAST_MOMENT = 0.07;

export interface FallState {
    active: boolean;
    /** Seconds since the fall began. */
    time: number;
    /** Where it began, in horizon radii from the centre. */
    start: number;
    /** Distance now, in horizon radii. */
    radius: number;
    /** Angle round the hole so far, in the plane of e1 (outwards at the start) and e2 (the way the ship was going). */
    angle: number;
    e1: THREE.Vector3;
    e2: THREE.Vector3;
    /** Test harnesses only: hold the fall where it is (see seekFall). */
    hold?: boolean;
    /** The death has been counted (once, at the end or when skipped). */
    counted?: boolean;
}

export const createFall = (): FallState => ({
    active: false, time: 0, start: FALL_TRIGGER, radius: FALL_TRIGGER, angle: 0,
    e1: new THREE.Vector3(1, 0, 0), e2: new THREE.Vector3(0, 0, 1),
});

export interface FallStage { at: number; title: string; body: string }

// What the readout says, and from when (seconds).
export const FALL_STAGES: FallStage[] = [
    { at: 0, title: 'Past the last stable orbit', body: 'Nothing can orbit this close. The ship is falling, and its engines cannot stop it.' },
    { at: 3.6, title: 'Photon sphere', body: 'Here light itself can circle the hole: the far side of the disk is bent up over the shadow.' },
    { at: FALL_SPIRAL - 1.2, title: 'Event horizon', body: 'No wall and no flash. Across the hull the tidal stretch is two trillionths of a g: a hole this big lets you in whole. From here every path, even light’s, leads inward.' },
    { at: FALL_SPIRAL + 0.8, title: 'Inside TON 618', body: 'The universe is still in view: dim and red behind, squeezed into a ring of blinding light round the growing dark. About five days to the centre.' },
    { at: FALL_SPIRAL + FALL_INSIDE, title: 'Five days pass', body: 'Shown fast. The pull at the nose and at the tail is no longer the same, and the difference grows as the centre comes closer.' },
    { at: FALL_STRETCH_AT, title: 'Spaghettification', body: 'In its last tenth of a second the ship is drawn out along the line to the centre and squeezed from the sides. Shown fifty times slower.' },
    { at: FALL_LOST_AT, title: 'Signal lost', body: 'The log ends here. A new ship leaves the wormhole by Saturn.' },
];

/** The ship's own clock during the fall: time since it crossed the horizon (negative before), and time left before the centre, in seconds. */
export const fallClock = (fall: FallState) => {
    const t = fall.time;
    let left: number;
    if (t < FALL_SPIRAL + FALL_INSIDE) left = timeLeftAt(fall.radius);
    else if (t < FALL_STRETCH_AT) {
        // The rest of the five days, quickly: from what is left at the end of the part inside down to the last moment.
        const from = timeLeftAt(INSIDE_END);
        const k = THREE.MathUtils.smoothstep(t, FALL_SPIRAL + FALL_INSIDE, FALL_STRETCH_AT);
        left = Math.exp(THREE.MathUtils.lerp(Math.log(from), Math.log(LAST_MOMENT), k));
    } else left = LAST_MOMENT * Math.max(0, 1 - (t - FALL_STRETCH_AT) / FALL_STRETCH);
    return { sinceHorizon: timeLeftAt(1) - left, left };
};

/** A ship's-clock duration as it reads in the log: days and hours, minutes, or seconds. */
export const formatShipTime = (seconds: number) => {
    const s = Math.abs(seconds);
    if (s >= 86400) return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
    if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
    if (s >= 60) return `${Math.floor(s / 60)} min ${Math.floor(s % 60)} s`;
    if (s >= 1) return `${s.toFixed(1)} s`;
    return `${s.toFixed(3)} s`;
};

export const fallStage = (time: number) => {
    let stage = FALL_STAGES[0];
    for (const s of FALL_STAGES) if (time >= s.at) stage = s;
    return stage;
};

const toShip = new THREE.Vector3();
const radial = new THREE.Vector3();
const around = new THREE.Vector3();
const previous = new THREE.Vector3();
const basis = new THREE.Matrix4();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const forward = new THREE.Vector3();
const normalAxis = new THREE.Vector3();

// The plunge's plane leans this far out of the disk's, on the side the ship
// is on, so the disk spreads out below it instead of cutting the view in two.
const INCLINATION = THREE.MathUtils.degToRad(24);
// The nose points this far round from straight in, along the way it is going:
// far enough that the shadow (about 32 to 42 degrees across its half, seen
// falling) sits below the middle of the view with its ring of bent light
// through it, turning further round inside the horizon as the dark grows, to
// keep the last light in view.
const NOSE_START = THREE.MathUtils.degToRad(52);
const NOSE_END = THREE.MathUtils.degToRad(74);

/** Start the fall from wherever the ship is, turning the way the disk turns. */
export const beginFall = (fall: FallState, ship: ShipState) => {
    toShip.copy(ship.position).sub(BLACK_HOLE.position);
    const distance = toShip.length();
    fall.e1.copy(toShip).divideScalar(distance);
    // Round the way the disk's gas goes, leaning up out of its plane.
    const normal = BLACK_HOLE.diskNormal;
    const above = toShip.dot(normal) >= 0 ? 1 : -1;
    fall.e2.copy(normal).cross(fall.e1);
    if (fall.e2.lengthSq() < 1e-6) fall.e2.copy(ship.velocity).addScaledVector(fall.e1, -ship.velocity.dot(fall.e1));
    if (fall.e2.lengthSq() < 1e-6) fall.e2.set(0, 1, 0).cross(fall.e1);
    fall.e2.normalize();
    fall.e2.multiplyScalar(Math.cos(INCLINATION)).addScaledVector(normal, Math.sin(INCLINATION) * above);
    fall.e2.addScaledVector(fall.e1, -fall.e2.dot(fall.e1)).normalize();
    fall.start = distance / BLACK_HOLE.horizon;
    fall.radius = fall.start;
    fall.angle = 0;
    fall.time = 0;
    fall.hold = false;
    fall.counted = false;
    fall.active = true;
};

const ease = (x: number) => x * x * (3 - 2 * x);
/** Distance (horizon radii) at the end of the part inside, and as drawn at the very end: the tracer is not taken nearer. */
const INSIDE_END = 0.3;
const LAST_DRAWN = 0.035;

/** Move the ship along the plunge for `dt` seconds. Returns true when the log has ended. */
export const advanceFall = (fall: FallState, ship: ShipState, dt: number) => {
    fall.time += dt;
    const t = fall.time;
    if (t < FALL_SPIRAL) {
        fall.radius = THREE.MathUtils.lerp(fall.start, 0.97, ease(t / FALL_SPIRAL));
    } else if (t < FALL_SPIRAL + FALL_INSIDE) {
        const k = Math.min(1, (t - FALL_SPIRAL) / FALL_INSIDE);
        fall.radius = THREE.MathUtils.lerp(0.97, INSIDE_END, Math.pow(k, 0.8));
    } else {
        const k = THREE.MathUtils.smoothstep(t, FALL_SPIRAL + FALL_INSIDE, FALL_LOST_AT);
        fall.radius = THREE.MathUtils.lerp(INSIDE_END, LAST_DRAWN, Math.sqrt(k));
    }
    // Round faster the deeper it goes, as an orbit would.
    fall.angle += Math.min(0.34 / Math.pow(fall.radius, 1.5), 1.4) * dt;
    previous.copy(ship.position);
    radial.copy(fall.e1).multiplyScalar(Math.cos(fall.angle)).addScaledVector(fall.e2, Math.sin(fall.angle));
    ship.position.copy(BLACK_HOLE.position).addScaledVector(radial, fall.radius * BLACK_HOLE.horizon);
    if (dt > 0) ship.velocity.copy(ship.position).sub(previous).divideScalar(dt);
    ship.drift.set(0, 0, 0);
    ship.pulse = 0;
    ship.pulseEngaged = false;
    ship.boost = 0;
    // Nose down towards the hole and along the way round, the hole below:
    // the ship dives at it, its shadow, the ring of bent light and the disk
    // ahead and below.
    around.copy(fall.e1).multiplyScalar(-Math.sin(fall.angle)).addScaledVector(fall.e2, Math.cos(fall.angle));
    const nose = THREE.MathUtils.lerp(NOSE_START, NOSE_END, THREE.MathUtils.smoothstep(t, FALL_SPIRAL - 2, FALL_LOST_AT));
    forward.copy(radial).multiplyScalar(-Math.cos(nose)).addScaledVector(around, Math.sin(nose)).normalize();
    up.copy(radial).addScaledVector(forward, -radial.dot(forward));
    if (up.lengthSq() < 1e-6) {
        normalAxis.crossVectors(fall.e1, fall.e2);
        up.copy(normalAxis);
    }
    up.normalize();
    right.crossVectors(forward, up).normalize();
    basis.makeBasis(right, up, forward.negate());
    ship.quaternion.setFromRotationMatrix(basis);
    return t >= FALL_TOTAL;
};

/**
 * Spaghettification as drawn (spacetime.ts bodyWarp): how far the ship is stretched along the line to
 * the centre, and how strong its afterimages are, `k` 0..1 through the last moment.
 */
export const spaghetti = (fall: FallState) => {
    const k = THREE.MathUtils.clamp((fall.time - FALL_STRETCH_AT) / FALL_STRETCH, 0, 1);
    // The stretch grows as 1/r^3 does near the end: slowly, then all at once (drawn to 8x, a thread).
    const stretch = 1 + 7 * Math.pow(k, 2);
    const ghosts = THREE.MathUtils.smoothstep(k, 0.08, 0.3);
    return { k, stretch, ghosts };
};

const towardCentre = new THREE.Vector3();
const orbitNormal = new THREE.Vector3();
const sideways = new THREE.Vector3();
const holeScene = new THREE.Vector3();
const chaseFrom = new THREE.Vector3();

/**
 * The camera for the end of the fall: as the five days pass it swings out to look at the ship side-on,
 * across the line to the centre, so the stretch along that line is seen whole. False before then (the
 * chase camera stays). Scene coordinates (about `origin`); `length` is the ship's.
 */
export const spaghettiShot = (fall: FallState, ship: ShipState, origin: THREE.Vector3, out: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3 }, length = 9) => {
    const swing = THREE.MathUtils.smoothstep(fall.time, FALL_SPIRAL + FALL_INSIDE + 0.2, FALL_STRETCH_AT + 0.4);
    if (swing <= 0) return false;
    const { stretch } = spaghetti(fall);
    holeScene.copy(BLACK_HOLE.position).sub(origin);
    const centre = out.target.copy(ship.position).sub(origin);
    towardCentre.copy(holeScene).sub(centre).normalize();
    orbitNormal.crossVectors(fall.e1, fall.e2).normalize();
    sideways.crossVectors(orbitNormal, towardCentre).normalize();
    // From the side and a little further in, looking back out at her: the last of the outside light, squeezed into a
    // ring round the way out, is behind her, and the line to the centre runs across the view (60 degrees from it).
    const distance = length * (2.4 + stretch * 0.75);
    out.position.copy(orbitNormal).multiplyScalar(0.84).addScaledVector(sideways, 0.2).addScaledVector(towardCentre, 0.5).normalize().multiplyScalar(distance).add(centre);
    // From behind and above the ship (about where the chase camera was), swung out.
    chaseFrom.copy(centre).addScaledVector(towardCentre, -length * 1.6).addScaledVector(orbitNormal, length * 0.4);
    out.position.lerp(chaseFrom, 1 - swing);
    // The line to the centre runs down the frame at a slant.
    out.up.copy(towardCentre).negate().multiplyScalar(Math.cos(0.55)).addScaledVector(sideways, Math.sin(0.55)).normalize();
    return true;
};

/** Count the fall as a death, once (at its end, or when it is skipped). */
export const countFallDeath = (fall: FallState, stats: { deaths: number; deathsOn: Record<string, number> }, at: number) => {
    if (fall.counted) return null;
    fall.counted = true;
    stats.deaths = (stats.deaths ?? 0) + 1;
    stats.deathsOn = stats.deathsOn ?? {};
    stats.deathsOn.ton618 = (stats.deathsOn.ton618 ?? 0) + 1;
    return { world: 'ton618', cause: 'spaghettified', survived: 0, count: stats.deaths, at };
};

/**
 * How fully the camera sees as one falling freely in from far away (the
 * renderer's uFall): eased in over the first moments, so the view does not
 * jump when the fall takes hold.
 */
export const fallFrame = (fall: FallState) => (fall.active ? THREE.MathUtils.smoothstep(fall.time, 0, 1.5) : 0);

/** Test harnesses only: replay a fall that has begun from its start to `time` seconds, and hold it there. */
export const seekFall = (fall: FallState, ship: ShipState, time: number) => {
    fall.time = 0;
    fall.angle = 0;
    fall.radius = fall.start;
    while (fall.time < time) advanceFall(fall, ship, Math.min(1 / 60, time - fall.time));
    fall.hold = true;
};
