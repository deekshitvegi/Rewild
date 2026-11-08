import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { groundHeight, waterDepth } from './environment';
import type { ShipState } from './flight';
import type { WalkerState } from './walking';
import { SHIP_GEAR_HEIGHT } from './Ship';

/**
 * Calling the ship (G on foot): it lifts off where it was left, flies low over the ground and
 * sets down beside the explorer, facing them. Lost on a big world a long way from it, the player
 * no longer has to find the way back across the map: the ship comes to them, as in No Man's Sky.
 *
 * The flight is drawn, not simulated (the ship has nobody aboard to fly it): its place over the
 * ground is eased along the great circle between the two spots, lifted in an arc above whatever
 * ground it passes over.
 */
export interface ShipRecall {
    body: ExpeditionBody;
    t: number;
    duration: number;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
    fromClear: number;
    lift: number;
    fromQ: THREE.Quaternion;
    toQ: THREE.Quaternion;
    /** The great-circle turn from the start to the landing spot. */
    turn: THREE.Quaternion;
}

/** Closer than this the ship is simply there; further, it flies in. */
const NEAR = 40;
const LAND_FROM_EXPLORER = 22;
const SPEED = 160;

const flat = new THREE.Vector3();
const spotUp = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const origin = new THREE.Vector3();
const axis = new THREE.Vector3();

/** A pose standing on the ground at `up`, facing `forward` (flattened). */
const standing = (up: THREE.Vector3, forward: THREE.Vector3) => {
    flat.copy(forward).addScaledVector(up, -forward.dot(up));
    if (flat.lengthSq() < 1e-8) flat.set(1, 0, 0).addScaledVector(up, -up.x);
    flat.normalize();
    matrix.lookAt(origin, flat, up);
    return new THREE.Quaternion().setFromRotationMatrix(matrix);
};

/** Where on the ground near the explorer the ship can set down (dry, not too steep), or null. */
const landingSpot = (body: ExpeditionBody, walker: WalkerState, towards: THREE.Vector3) => {
    const up = walker.position.clone().sub(body.position).normalize();
    const dir = towards.clone().addScaledVector(up, -towards.dot(up));
    if (dir.lengthSq() < 1e-8) dir.copy(walker.facing);
    dir.normalize();
    for (let k = 0; k < 8; k++) {
        const angle = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 4);
        const d = dir.clone().applyAxisAngle(up, angle);
        const point = walker.position.clone().addScaledVector(d, LAND_FROM_EXPLORER);
        spotUp.copy(point).sub(body.position).normalize();
        if (waterDepth(body, spotUp) > 0.2) continue;
        // Not on a slope it would slide off: the ground a few metres either side within reason.
        const h = groundHeight(body, spotUp);
        const side = point.clone().addScaledVector(d, 5).sub(body.position).normalize();
        if (Math.abs(groundHeight(body, side) - h) > 3) continue;
        return spotUp.clone();
    }
    return null;
};

/** Start the ship towards the explorer. Returns what to tell the player. */
export const callShip = (ship: ShipState, walker: WalkerState): { recall: ShipRecall | null; notice: string } => {
    const body = walker.body;
    if (!ship.landed) return { recall: null, notice: 'YOUR SHIP IS ALREADY ON ITS WAY' };
    const shipUp = ship.position.clone().sub(body.position).normalize();
    // Left on another world: it cannot cross space by itself.
    if (ship.position.distanceTo(body.position) > body.radius * 1.5) return { recall: null, notice: 'YOUR SHIP IS NOT ON THIS WORLD' };
    const distance = ship.position.distanceTo(walker.position);
    if (distance < NEAR) return { recall: null, notice: 'YOUR SHIP IS RIGHT HERE · E TO BOARD' };
    const toShip = ship.position.clone().sub(walker.position);
    const toUp = landingSpot(body, walker, toShip);
    if (!toUp) return { recall: null, notice: 'NOWHERE FLAT AND DRY FOR YOUR SHIP HERE' };
    // It arrives the way it came, facing the explorer.
    const facing = walker.position.clone().sub(body.position.clone().addScaledVector(toUp, body.radius));
    const toQ = standing(toUp, facing);
    const turn = new THREE.Quaternion().setFromUnitVectors(shipUp, toUp);
    const arc = shipUp.angleTo(toUp) * body.radius;
    const recall: ShipRecall = {
        body,
        t: 0,
        duration: THREE.MathUtils.clamp(arc / SPEED + 3, 5, 24),
        fromUp: shipUp,
        toUp,
        fromClear: ship.position.distanceTo(body.position) - body.radius - groundHeight(body, shipUp),
        lift: THREE.MathUtils.clamp(arc * 0.12, 25, 420),
        fromQ: ship.quaternion.clone(),
        toQ,
        turn,
    };
    const away = arc >= 1000 ? `${(arc / 1000).toFixed(1)} KM` : `${Math.round(arc)} M`;
    return { recall, notice: `YOUR SHIP IS COMING · ${away} AWAY` };
};

const identity = new THREE.Quaternion();
const step = new THREE.Quaternion();
const upNow = new THREE.Vector3();
const ahead = new THREE.Vector3();
const travel = new THREE.Quaternion();

/** One step of the flight in; true once the ship has landed. */
export const advanceRecall = (recall: ShipRecall, ship: ShipState, dt: number) => {
    recall.t = Math.min(1, recall.t + dt / recall.duration);
    const t = recall.t;
    const e = t * t * (3 - 2 * t);
    const body = recall.body;
    step.slerpQuaternions(identity, recall.turn, e);
    upNow.copy(recall.fromUp).applyQuaternion(step).normalize();
    // Up off the ground, over in an arc, down onto the gear.
    const clearance = THREE.MathUtils.lerp(recall.fromClear, SHIP_GEAR_HEIGHT, e) + recall.lift * Math.sin(Math.PI * Math.min(1, t * 1.08));
    ship.position.copy(body.position).addScaledVector(upNow, body.radius + groundHeight(body, upNow) + clearance);
    // Facing the way it flies; turning to its landing pose over the last fifth.
    step.slerpQuaternions(identity, recall.turn, Math.min(1, e + 0.02));
    ahead.copy(recall.fromUp).applyQuaternion(step).sub(upNow);
    axis.copy(upNow);
    if (ahead.lengthSq() > 1e-12) travel.copy(standing(axis, ahead));
    else travel.copy(recall.toQ);
    if (t < 0.15) ship.quaternion.slerpQuaternions(recall.fromQ, travel, t / 0.15);
    else if (t > 0.8) ship.quaternion.slerpQuaternions(travel, recall.toQ, (t - 0.8) / 0.2);
    else ship.quaternion.copy(travel);
    ship.gear = t < 0.15 ? 1 - t / 0.15 : t > 0.8 ? (t - 0.8) / 0.2 : 0;
    ship.throttle = t < 0.9 ? 0.6 : 0;
    ship.velocity.set(0, 0, 0);
    if (t >= 1) {
        ship.position.copy(body.position).addScaledVector(recall.toUp, body.radius + groundHeight(body, recall.toUp) + SHIP_GEAR_HEIGHT);
        ship.quaternion.copy(recall.toQ);
        ship.gear = 1;
        ship.throttle = 0;
        return true;
    }
    return false;
};
