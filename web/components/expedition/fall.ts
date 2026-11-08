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
 */
export const FALL_TRIGGER = 1.8;
/** Seconds from the trigger to the horizon, inside it, and fading out. */
export const FALL_SPIRAL = 10;
export const FALL_INSIDE = 4;
export const FALL_FADE = 1.6;
export const FALL_TOTAL = FALL_SPIRAL + FALL_INSIDE + FALL_FADE;

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
    { at: FALL_SPIRAL - 1.2, title: 'Event horizon', body: 'No wall and no flash. From here every path, even light’s, leads inward.' },
    { at: FALL_SPIRAL + 0.8, title: 'Inside TON 618', body: 'The universe is still in view: dim and red behind, squeezed into a ring of blinding light round the growing dark.' },
    { at: FALL_SPIRAL + FALL_INSIDE - 0.4, title: 'Signal lost', body: 'The log ends here. A new ship leaves the wormhole by Saturn.' },
];

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
    fall.active = true;
};

const ease = (x: number) => x * x * (3 - 2 * x);

/** Move the ship along the plunge for `dt` seconds. Returns true when the log has ended. */
export const advanceFall = (fall: FallState, ship: ShipState, dt: number) => {
    fall.time += dt;
    const t = fall.time;
    if (t < FALL_SPIRAL) {
        fall.radius = THREE.MathUtils.lerp(fall.start, 0.97, ease(t / FALL_SPIRAL));
    } else {
        const k = Math.min(1, (t - FALL_SPIRAL) / FALL_INSIDE);
        fall.radius = THREE.MathUtils.lerp(0.97, 0.06, Math.pow(k, 0.8));
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
    const nose = THREE.MathUtils.lerp(NOSE_START, NOSE_END, THREE.MathUtils.smoothstep(t, FALL_SPIRAL - 2, FALL_TOTAL - FALL_FADE));
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
