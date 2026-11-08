import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { cloneShip, park, shipPose, unpark, type Held } from './crew';
import type { ShipState } from './flight';
import type { Motion } from './motion';

/**
 * The Argo: the big ship the crew came home in (docs/story.md), waiting in the sky over the
 * landing site. The fighter can go anywhere in the Solar System on its own, but the wormhole's
 * throat would tear it apart: only the Argo is built to cross. Fly up to her, slow down by
 * the docking bay at the front of her hub and press U: the fighter is drawn in and clamped, and
 * from then on the ship being flown is her, with the fighter in her bay. U again lets it go.
 * She cannot land (U to undock and fly the fighter down).
 *
 * While docked, the live ShipState in Player is hers (her centre and attitude). Undocked, she is
 * held in her world's frame like a parked crew ship (crew.ts), so she goes round with it.
 */
export const MOTHERSHIP = {
    name: 'Argo',
    /** Bow to stern, metres. */
    length: 320,
    /** Where the fighter's centre sits when docked, in her frame (forward -Z): in the collar at the hub's nose, ahead of the ring. */
    bay: new THREE.Vector3(0, 0, -166),
    /** How close to the bay (m) a docking can start, and how slowly the fighter must be moving (m/s). */
    reach: 160,
    closing: 60,
    /** Seconds the run-in into the bay takes. */
    runIn: 4,
    /** How far above the landing site she waits at the start (units; Earth's air ends at 1400). */
    waitAltitude: 4200,
    /** The lowest she will go above a world's ground (units): she is no lander. */
    floor: 1800,
    /** Steering while flying her: she turns slowly. */
    agility: 0.35,
};

export interface Mothership extends Held {
    /** The fighter is in her bay, and the ship being flown is her. */
    docked: boolean;
    /** Drawing the fighter in: progress 0..1, and where it began (game frame). */
    docking: { t: number; from: THREE.Vector3; fromQ: THREE.Quaternion } | null;
    /** She has been put in the sky over the start. */
    placed: boolean;
}

export const createMothership = (start: ShipState): Mothership => ({
    ship: cloneShip(start),
    walker: null,
    home: null,
    parked: false,
    docked: false,
    docking: null,
    placed: false,
});

const up = new THREE.Vector3();
/** Put her in the sky over the start: level, facing the way the fighter faces, `waitAltitude` up. */
export const placeMothership = (mothership: Mothership, start: ShipState, body: ExpeditionBody | null, motion: Motion) => {
    const s = mothership.ship;
    s.quaternion.copy(start.quaternion);
    s.velocity.set(0, 0, 0);
    s.landed = false;
    s.gear = 0;
    s.throttle = 0;
    if (body) {
        up.copy(start.position).sub(body.position).normalize();
        s.position.copy(start.position).addScaledVector(up, MOTHERSHIP.waitAltitude);
    } else {
        s.position.copy(start.position).add(up.set(0, MOTHERSHIP.waitAltitude, 0));
    }
    mothership.parked = false;
    park(mothership, motion, body);
    mothership.placed = true;
};

const at = new THREE.Vector3();
const turn = new THREE.Quaternion();
/** Where she is now (game frame): the live ship while docked, else where she was left. */
export const mothershipPose = (mothership: Mothership, live: ShipState, motion: Motion, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion) => {
    if (mothership.docked) {
        outPosition.copy(live.position);
        outQuaternion.copy(live.quaternion);
    } else {
        shipPose(mothership, motion, outPosition, outQuaternion);
    }
};

/** Her docking bay (game frame), given where she is. */
export const bayPose = (position: THREE.Vector3, quaternion: THREE.Quaternion, outPosition: THREE.Vector3) =>
    outPosition.copy(MOTHERSHIP.bay).applyQuaternion(quaternion).add(position);

/** How far the fighter is from her bay now, and whether it may dock. */
export const dockingCheck = (mothership: Mothership, ship: ShipState, motion: Motion) => {
    shipPose(mothership, motion, at, turn);
    const bay = bayPose(at, turn, new THREE.Vector3());
    const metres = bay.distanceTo(ship.position);
    const speed = ship.velocity.length();
    return { metres, speed, ok: !mothership.docked && !mothership.docking && metres < MOTHERSHIP.reach && speed < MOTHERSHIP.closing && !ship.landed && !ship.landing && !ship.destroyed };
};

/** Begin drawing the fighter in. */
export const beginDocking = (mothership: Mothership, ship: ShipState) => {
    mothership.docking = { t: 0, from: ship.position.clone(), fromQ: ship.quaternion.clone() };
    ship.pulseEngaged = false;
    ship.pulse = 0;
    ship.boost = 0;
    ship.throttle = 0;
};

const bay = new THREE.Vector3();
/**
 * Draw the fighter on into the bay (eased), held still meanwhile. Once in, she becomes the ship
 * being flown: the live state is set to hers. Returns true on the frame it docks.
 */
export const advanceDocking = (mothership: Mothership, ship: ShipState, motion: Motion, dt: number) => {
    const run = mothership.docking;
    if (!run) return false;
    run.t = Math.min(1, run.t + dt / MOTHERSHIP.runIn);
    const k = run.t * run.t * (3 - 2 * run.t);
    shipPose(mothership, motion, at, turn);
    bayPose(at, turn, bay);
    ship.position.lerpVectors(run.from, bay, k);
    ship.quaternion.slerpQuaternions(run.fromQ, turn, k);
    ship.velocity.set(0, 0, 0);
    ship.angular.set(0, 0, 0);
    ship.drift.set(0, 0, 0);
    if (run.t < 1) return false;
    mothership.docking = null;
    unpark(mothership, motion);
    ship.position.copy(mothership.ship.position);
    ship.quaternion.copy(mothership.ship.quaternion);
    ship.velocity.set(0, 0, 0);
    ship.landed = false;
    ship.gear = 0;
    ship.throttle = 0;
    mothership.docked = true;
    return true;
};

const forward = new THREE.Vector3();
/**
 * Let the fighter go: she is left where she is (held in `home`'s frame), and the fighter comes
 * out of the bay ahead of her, moving off slowly.
 */
export const undock = (mothership: Mothership, ship: ShipState, motion: Motion, home: ExpeditionBody | null) => {
    if (!mothership.docked) return;
    const s = mothership.ship;
    s.position.copy(ship.position);
    s.quaternion.copy(ship.quaternion);
    s.velocity.set(0, 0, 0);
    s.angular.set(0, 0, 0);
    s.drift.set(0, 0, 0);
    s.landed = false;
    mothership.docked = false;
    mothership.parked = false;
    forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    bayPose(s.position, s.quaternion, bay);
    ship.position.copy(bay).addScaledVector(forward, 30);
    ship.velocity.copy(forward).multiplyScalar(25);
    ship.throttle = 0.15;
    ship.pulseEngaged = false;
    ship.pulse = 0;
    park(mothership, motion, home);
};
