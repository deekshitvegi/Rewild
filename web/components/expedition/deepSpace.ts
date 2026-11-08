import * as THREE from 'three';
import { TON618_HORIZON, TON618_POSITION, findBody } from './bodies';
import { ECLIPTIC_NORTH, fromEquatorial } from './orbits';
import { pinDirection, pinPoint, pinTurn } from './motion';

/**
 * Beyond the planets: a wormhole hanging near Saturn, as in Interstellar,
 * whose other mouth opens beside TON 618, a black hole far outside the
 * system. World units, like everything else in the expedition.
 */
export interface BlackHoleDef {
    id: string;
    name: string;
    position: THREE.Vector3;
    /** Schwarzschild radius: the event horizon. The accretion disk reaches about 6.25 of these. */
    horizon: number;
    /** Normal of the accretion disk. */
    diskNormal: THREE.Vector3;
}

export interface WormholeMouth {
    id: string;
    name: string;
    position: THREE.Vector3;
    /** Radius of the throat. */
    radius: number;
    /** The other mouth. */
    to: string;
    /**
     * How the mouths are joined: this rotation takes a direction at this mouth
     * to the direction it continues in at the other one, for a ray or a ship
     * going straight through the middle.
     */
    link: THREE.Quaternion;
    /** Where a ship is put out of this mouth (after falling into TON 618), and which way it faces. */
    exit: { position: THREE.Vector3; facing: THREE.Vector3 };
}

const saturn = findBody('beyond')!;

// TON 618 lies where it is in our sky (in Canes Venatici), far outside the
// system: 40 billion units out, about 590 of the system's AU. Only the
// wormhole reaches it in reasonable time.
const blackHolePosition = TON618_POSITION.clone();
const HORIZON = TON618_HORIZON;

// Near Saturn, on its sunlit side a little above the rings: seen from the
// inner system it hangs beside the giant like a crystal ball.
const towardSun = saturn.sunDirection.clone();
const nearSaturn = saturn.position.clone()
    .addScaledVector(towardSun, saturn.radius * 3.4)
    .addScaledVector(ECLIPTIC_NORTH, saturn.radius * 0.55);

// Beside TON 618, on the side facing home, 30 horizon radii out and a
// little above its disk: from there the disk is seen a few degrees from edge
// on, the way Gargantua is usually shown. The disk's plane holds the line
// home, tilted to nothing in particular in the system's own frame.
const towardHome = saturn.position.clone().sub(blackHolePosition).normalize();
const across = new THREE.Vector3(0, 1, 0).cross(towardHome).normalize();
const diskNormal = new THREE.Vector3().crossVectors(towardHome, across).normalize();
const nearBlackHole = blackHolePosition.clone().addScaledVector(towardHome, HORIZON * 30).addScaledVector(diskNormal, HORIZON * 4);

const WORMHOLE_RADIUS = 3200;

const viewFromMouth = blackHolePosition.clone().sub(nearBlackHole).normalize();

export const BLACK_HOLE: BlackHoleDef = {
    id: 'ton618',
    name: 'TON 618',
    position: blackHolePosition,
    horizon: HORIZON,
    diskNormal,
};

// Flying in from the Sun's side of the Saturn mouth, you come out of the far
// mouth heading straight at TON 618; so flying back into the far mouth from
// the black hole's side, you come out by Saturn heading towards the Sun.
const SATURN_TO_FAR = new THREE.Quaternion().setFromUnitVectors(towardSun.clone().negate(), viewFromMouth);

export const WORMHOLES: WormholeMouth[] = [
    {
        id: 'wormhole-saturn',
        name: 'Wormhole',
        position: nearSaturn,
        radius: WORMHOLE_RADIUS,
        to: 'wormhole-ton618',
        link: SATURN_TO_FAR,
        exit: {
            // Out towards Saturn, with the Sun behind.
            position: nearSaturn.clone().addScaledVector(towardSun, -WORMHOLE_RADIUS * 3.4),
            facing: towardSun.clone().negate(),
        },
    },
    {
        id: 'wormhole-ton618',
        name: 'Wormhole',
        position: nearBlackHole,
        radius: WORMHOLE_RADIUS,
        to: 'wormhole-saturn',
        link: SATURN_TO_FAR.clone().invert(),
        exit: {
            // Out towards the black hole.
            position: nearBlackHole.clone().addScaledVector(viewFromMouth, WORMHOLE_RADIUS * 3.4),
            facing: viewFromMouth.clone(),
        },
    },
];

export const findWormhole = (id: string) => WORMHOLES.find((w) => w.id === id);

// All of it belongs to the universe, not to the world the player is at: as
// the game's frame follows that world, these turn and move with the sky
// (motion.ts). The mouth by Saturn goes round the Sun with Saturn.
pinPoint(BLACK_HOLE.position);
pinDirection(BLACK_HOLE.diskNormal);
for (const mouth of WORMHOLES) {
    const host = mouth.id === 'wormhole-saturn' ? saturn : null;
    pinPoint(mouth.position, host);
    pinPoint(mouth.exit.position, host);
    pinDirection(mouth.exit.facing);
    pinTurn(mouth.link, true);
}

/**
 * Crossing a throat. The wormhole is an Ellis wormhole: two copies of space,
 * each with a ball of the throat's radius taken out, glued along the throat.
 * Something that crosses the throat of one mouth at the point n (a unit vector
 * from its centre) carries on out of the other mouth from the point -link·n:
 * distances from the throat carry over, the radial part of every direction
 * turns round and the rest is rotated by link. Together that is a rigid
 * rotation, `turn`, so the ship, the camera behind it and their velocities all
 * keep their places relative to each other.
 *
 * `point` has just gone `depth` inside the throat's ball; it comes out as far
 * outside the other one.
 */
export const crossThroat = (mouth: WormholeMouth, point: THREE.Vector3) => {
    const other = findWormhole(mouth.to)!;
    const n = point.clone().sub(mouth.position);
    const distance = n.length();
    n.divideScalar(Math.max(distance, 1e-6));
    const depth = Math.max(0, mouth.radius - distance);
    // A half turn about n flips the radial part of a direction; link then rotates it.
    const halfTurn = new THREE.Quaternion(n.x, n.y, n.z, 0);
    const turn = mouth.link.clone().multiply(halfTurn);
    const out = n.clone().applyQuaternion(mouth.link).multiplyScalar(-(other.radius + depth)).add(other.position);
    return { other, turn, point: out };
};

/**
 * How far out towards TON 618 a point is: 0 anywhere near home, 1 close
 * enough to the black hole that its galaxy fills the sky and its disk, not the
 * sun, is what lights things.
 */
export const farness = (point: THREE.Vector3) => {
    const distance = point.distanceTo(BLACK_HOLE.position);
    return 1 - THREE.MathUtils.smoothstep(distance, BLACK_HOLE.horizon * 150, BLACK_HOLE.horizon * 400);
};

/** Gravitational time dilation for someone hovering at distance r (Schwarzschild). */
export const timeDilation = (r: number) => {
    const x = BLACK_HOLE.horizon / Math.max(r, BLACK_HOLE.horizon * 1.0001);
    return 1 / Math.sqrt(1 - x);
};
