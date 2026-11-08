import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { groundHeight, groundSpot, updateEnvironment, waterDepth } from './environment';
import { usesEarthMap } from './earth';
import { SEA_CLOCK, seaSwell } from './seaWaves';
import { axis, consume, type ExpeditionInput } from './input';
import type { ExpeditionRuntime } from './runtime';
import { SATIETY_SECONDS, airMinutes, jetpackEndurance } from './survival';
import { coolingDrain, surfaceKelvin } from './thermal';
import { windForce } from './weather';

/**
 * Exploring on foot. The explorer walks on a sphere, so "up" is always away
 * from the planet's centre and the facing directions are kept flat against
 * the ground as the explorer moves around the curve.
 *
 * Each world pulls with its real surface gravity (bodies.ts): the same jump
 * clears two thirds of a metre on Earth, four metres on the Moon and
 * seventeen on Titania, and takes as long to come down. A fall hurts by the
 * speed it ends at, so a ledge that is harmless on the Moon can kill on
 * Earth; the jetpack can soften one. Ground steeper than about forty degrees
 * cannot be walked up (the explorer slides back down it), and a wall or
 * ledge higher than a step stops them: getting up one takes a jump, the
 * jetpack, or a climb.
 */
export interface WalkerState {
    body: ExpeditionBody;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    /** Direction the explorer faces, flat on the ground. */
    facing: THREE.Vector3;
    /** Direction the camera looks, flat on the ground, and its pitch. */
    look: THREE.Vector3;
    pitch: number;
    onGround: boolean;
    /** How hard the wind pushes, as a share of what the boots can hold (above 1 they slide). */
    windPush: number;
    jetpack: number;
    jetting: boolean;
    /** Firing the jetpack downward (X), to come back from a jump in weak gravity. */
    thrustingDown: boolean;
    gait: number;
    moving: number;
    /** 0 to 1. Falls and running out of air take it; resting, food and the ship give it back. */
    health: number;
    /** 0 to 1: the suit's own air, used where the air cannot be breathed, refilled in the ship. */
    oxygen: number;
    /** 0 to 1: the suit's cooling, run down where the ground is hotter than it can stand (thermal.ts), restored in the ship. */
    cooling: number;
    /** The ground's temperature here (K). */
    kelvin: number;
    /** Running (sprinting on the ground). */
    running: boolean;
    /** In water too deep to stand in: floating, swimming. */
    swimming: boolean;
    /** How far below the floating swimmer's place they have dived (m; 0 at the surface). */
    dive: number;
    /** Seconds since the feet last touched the ground (0 while on it). */
    airTime: number;
    /** Seconds since the last jump began, crouch included (large when there was none). */
    jumpTime: number;
    /** A jump is crouching for its spring: the leap comes JUMP_CROUCH seconds after the press. */
    jumpPending: boolean;
    /** Seconds since the feet last came down after being off the ground, and for how long they were. */
    landTime: number;
    landedFrom: number;
    /** True only on the frame the feet come down (when the jump and the drop are measured). */
    touchdown: boolean;
    /** How much the last hard landing hurt (0 to 1) and how long ago it was. */
    impact: number;
    impactTime: number;
    /** On ground too steep to stand on, sliding down it. */
    sliding: boolean;
    /** Stopped at the brink of a drop that would hurt (walking; running or jumping goes over). */
    atEdge: boolean;
    /** Seconds since the explorer was last hurt: health only comes back after a while. */
    hurtAgo: number;
    /** Health has run out: the explorer is down until brought back to the ship. */
    down: boolean;
    /** What hurt them last ('fall', 'air', 'heat', 'hunger', 'lightning', 'tornado', 'radiation', 'predator'), and when they stepped out (page seconds). */
    hurtBy: string;
    born: number;
    /** 0 to 1: how fed the explorer is. Empty, health slowly goes. */
    satiety: number;
    /** Sitting by a campfire (moving gets up): resting heals faster and keeps hunger off. */
    sitting: boolean;
    /** Eating, for this many more seconds (sitting by a fire: a cooked meal). */
    eating: number;
    /** Picking fruit, for this many more seconds. */
    gathering: number;
    /** Highest point (distance from the world's centre) since leaving the ground, and where a jump left it. */
    peak: number;
    takeoff: number;
    jumped: boolean;
    /** The last landing: how high its jump went, and how far it dropped (metres; 0 if none). */
    lastJump: number;
    lastDrop: number;
}

const WALK = 6.2;
const SPRINT = 11.5;
const SWIM = 3.4;
const SWIM_SPRINT = 5.6;
/** The jetpack's thrust, the same on every world: it lifts far more easily where gravity is weak. */
const JETPACK_THRUST = 19;
/** Take-off speed of a jump, metres per second. */
const JUMP_SPEED = 3.6;
/** How quickly boots on the ground bring the explorer up to speed or to a stop (1/s): a suited person has momentum. */
const GROUND_GRIP = 7;
/** The fastest the explorer turns to face the way they go (radians a second; about 400 degrees). */
const TURN_RATE = 7;
/** The crouch before a jump springs: the press starts it, the leap follows. */
export const JUMP_CROUCH = 0.16;
/** Water deeper than this floats the explorer: they swim instead of wading. */
const SWIM_DEPTH = 1.15;
const upBefore = new THREE.Vector3();
/** The breakers' lift at a spot on Earth's sea (0 elsewhere). */
const swellAt = (body: ExpeditionBody, up: THREE.Vector3) => {
    if (!usesEarthMap(body)) return 0;
    const spot = groundSpot(body, up);
    return spot.water > 0 && spot.shore < 0 ? seaSwell(spot.shore, spot.water, SEA_CLOCK.value) : 0;
};
let sinkWarned = 0;
/** Once in a while, why the explorer stops: the liquid would not hold them up. */
const warnSinking = (runtime: ExpeditionRuntime, body: { biome?: { liquid?: { name: string } } }) => {
    const now = performance.now() / 1000;
    const ship = runtime.hud.ship;
    if (!ship || now - sinkWarned < 8) return;
    sinkWarned = now;
    const name = body.biome?.liquid?.name ?? 'liquid';
    // Liquid methane is less than half as dense as water: a person sinks in it.
    ship.notice = `TOO DEEP · ${name.toUpperCase()} IS TOO THIN TO FLOAT IN`;
    ship.noticeTime = now;
};
/** Landing speeds: harmless below the first, fatal from the second (a fall of about 3 m and 15 m on Earth). */
const SAFE_IMPACT = 8;
const LETHAL_IMPACT = 17;
/** Rise over run of the steepest ground that can be walked up (40 degrees). */
const STEEP = Math.tan(THREE.MathUtils.degToRad(40));
/** Water whose surface slopes more than this is falling: too fast to swim in (about 30 degrees). */
const FALLS_SLOPE = Math.tan(THREE.MathUtils.degToRad(30));
const current = new THREE.Vector3();
/** The highest step taken in stride; anything higher stops the explorer. */
const STEP = 0.55;

/** The highest drop that lands softly here: from it, the landing speed is the harmless one. */
export const safeDrop = (gravity: number) => (SAFE_IMPACT * SAFE_IMPACT) / (2 * gravity);

/** The pull at the surface, m/s² (the real world's). */
export const surfaceGravity = (body: ExpeditionBody) => body.gravity ?? 9.81;

/**
 * The speed of a body in orbit just above the ground, m/s. Where a walker's
 * stride outruns it the ground curves away faster than gravity can pull
 * them back to it: Phobos, Deimos and the small icy moons.
 */
export const groundOrbitSpeed = (body: ExpeditionBody) => Math.sqrt(surfaceGravity(body) * body.radius);

/** Gravity too weak to hold a walker down: the boots' spikes hold on instead. */
export const lowGravity = (body: ExpeditionBody) => groundOrbitSpeed(body) < 25;

/**
 * Take-off speed of a jump here. A jump is held to two fifths of the escape
 * speed (sqrt(2gR)) so that nobody leaves Deimos on foot; everywhere bigger
 * than Phobos the legs give out first.
 */
export const jumpSpeed = (body: ExpeditionBody) => Math.min(JUMP_SPEED, 0.4 * Math.sqrt(2 * surfaceGravity(body) * body.radius));

/** How high a standing jump goes here, metres, and how long it stays up, seconds. */
export const jumpHeight = (body: ExpeditionBody) => jumpSpeed(body) ** 2 / (2 * surfaceGravity(body));
export const jumpTime = (body: ExpeditionBody) => (2 * jumpSpeed(body)) / surfaceGravity(body);

/**
 * How fast legs can carry a walker here, as a share of on Earth. A stride is a
 * swinging pendulum, so the speeds at which people walk and run go as the square
 * root of gravity (the Froude number: on the Moon the Apollo crews loped along at
 * about one to two metres a second), and boots grip with the body's
 * weight, so in weak gravity they also speed up and stop less sharply. Held
 * between 55% (still playable on the smallest moons) and Earth's.
 */
export const strideFactor = (body: ExpeditionBody) => THREE.MathUtils.clamp(Math.sqrt(surfaceGravity(body) / 9.81) * 1.4, 0.55, 1);

/** Firing the jetpack downward (X) brings the explorer down at this speed at most: a soft landing. */
const DOWN_SPEED = 4;

const up = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const horizontal = new THREE.Vector3();
const desired = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const push = new THREE.Vector3();
const blow = new THREE.Vector3();
/**
 * The explorer to the wind: drag area (m², drag coefficient included, a
 * person standing side-on to it) and mass with the suit (an xEMU-class suit
 * and its life-support pack weigh as much as the person in it).
 */
const WALKER_AREA = 0.8;
const WALKER_MASS = 180;
/** Grip of boots on the ground, as a share of the explorer's weight. */
const FOOTING = 0.7;
const before = new THREE.Vector3();
const tangentA = new THREE.Vector3();
const tangentB = new THREE.Vector3();
const probe = new THREE.Vector3();
const uphill = new THREE.Vector3();
const turnAxis = new THREE.Vector3();

const ahead = new THREE.Vector3();
const aheadPoint = new THREE.Vector3();
/** Height of the ground `distance` metres from `from` along `direction` (flat on the ground). */
const groundAhead = (body: ExpeditionBody, from: THREE.Vector3, direction: THREE.Vector3, distance: number) => {
    aheadPoint.copy(from).addScaledVector(direction, distance).sub(body.position).normalize();
    return groundHeight(body, aheadPoint);
};

/** Re-flattens a direction onto the ground plane after moving around the curve. */
const flatten = (v: THREE.Vector3, normal: THREE.Vector3, fallback: THREE.Vector3) => {
    v.addScaledVector(normal, -v.dot(normal));
    if (v.lengthSq() < 1e-8) v.copy(fallback).addScaledVector(normal, -fallback.dot(normal));
    return v.normalize();
};

export const createWalker = (body: ExpeditionBody, position: THREE.Vector3, facing: THREE.Vector3): WalkerState => {
    up.copy(position).sub(body.position).normalize();
    const flat = flatten(facing.clone(), up, new THREE.Vector3(1, 0, 0));
    return {
        body,
        position: position.clone(),
        velocity: new THREE.Vector3(),
        facing: flat.clone(),
        look: flat.clone(),
        pitch: -0.18,
        onGround: false,
        windPush: 0,
        jetpack: 1,
        jetting: false,
        thrustingDown: false,
        gait: 0,
        moving: 0,
        health: 1,
        oxygen: 1,
        cooling: 1,
        kelvin: surfaceKelvin(body, up),
        running: false,
        swimming: false,
        dive: 0,
        airTime: 0,
        jumpTime: 99,
        jumpPending: false,
        landTime: 99,
        landedFrom: 0,
        touchdown: false,
        impact: 0,
        impactTime: 99,
        sliding: false,
        atEdge: false,
        hurtAgo: 99,
        down: false,
        hurtBy: '',
        born: performance.now() / 1000,
        satiety: 1,
        sitting: false,
        eating: 0,
        gathering: 0,
        peak: 0,
        takeoff: 0,
        jumped: false,
        lastJump: 0,
        lastDrop: 0,
    };
};

/**
 * The slope of the ground under a spot, as the uphill direction scaled by
 * rise over run (zero on level ground), from the same height field the
 * explorer stands on.
 */
const slopeAt = (body: ExpeditionBody, at: THREE.Vector3, out: THREE.Vector3) => {
    up.copy(at).sub(body.position).normalize();
    tangentA.set(0, 1, 0).cross(up);
    if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0).cross(up);
    tangentA.normalize();
    tangentB.crossVectors(up, tangentA);
    const h0 = groundHeight(body, up);
    const radius = body.radius + h0;
    const span = 0.8;
    probe.copy(up).multiplyScalar(radius).addScaledVector(tangentA, span).normalize();
    const hA = groundHeight(body, probe);
    probe.copy(up).multiplyScalar(radius).addScaledVector(tangentB, span).normalize();
    const hB = groundHeight(body, probe);
    return out.copy(tangentA).multiplyScalar((hA - h0) / span).addScaledVector(tangentB, (hB - h0) / span);
};

export const updateWalker = (walker: WalkerState, input: ExpeditionInput, runtime: ExpeditionRuntime, dt: number) => {
    const body = walker.body;
    const gravity = surfaceGravity(body);
    walker.touchdown = false;
    up.copy(walker.position).sub(body.position).normalize();
    flatten(walker.facing, up, walker.look);
    flatten(walker.look, up, walker.facing);
    const control = !walker.down && !walker.sitting && walker.eating <= 0 && walker.gathering <= 0;

    // Look around.
    rotation.setFromAxisAngle(up, -input.lookX * 0.0032);
    walker.look.applyQuaternion(rotation);
    walker.pitch = THREE.MathUtils.clamp(walker.pitch - input.lookY * 0.0026, -1.1, 0.75);
    input.lookX = 0;
    input.lookY = 0;

    // Move relative to where the camera looks.
    right.crossVectors(walker.look, up).normalize();
    const forwardAmount = control ? axis(input, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) + input.moveY : 0;
    const strafe = control ? axis(input, ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) + input.moveX : 0;
    move.copy(walker.look).multiplyScalar(forwardAmount).addScaledVector(right, strafe);
    const moveLength = Math.min(1, move.length());
    if (moveLength > 0.01) move.normalize();
    const sprinting = control && (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || input.pressed.has('Sprint'));
    const depth = waterDepth(body, up);
    // Diving: X takes a swimmer down, Space brings them up; let go and they rise slowly back to the
    // surface. No deeper than a body's length above the bed.
    if (walker.swimming || walker.dive > 0) {
        const diving = control && (input.keys.has('KeyX') || input.pressed.has('Dive'));
        const rising = control && (input.keys.has('Space') || input.pressed.has('Jet'));
        const rate = diving ? 1.6 : rising ? -2.2 : -0.45;
        walker.dive = THREE.MathUtils.clamp(walker.dive + rate * dt, 0, Math.max(0, depth - SWIM_DEPTH - 0.6));
    } else {
        walker.dive = 0;
    }
    // Swimming once the water is deeper than the explorer can stand in (and
    // they are down in it, not flying over it). Not in a liquid too thin to
    // hold a person up (Titan's methane): there they can only wade.
    const aboveWater = walker.position.distanceTo(body.position) - body.radius - groundHeight(body, up);
    const floats = body.biome?.liquid?.floats ?? true;
    walker.swimming = floats && depth > SWIM_DEPTH && aboveWater < 0.3;
    // A river pouring down a steep slope is a fall or a cascade, not somewhere to swim: the water
    // sweeps the explorer down it to the pool below, where they can swim again.
    let inFalls = false;
    if (depth > 0.3 && aboveWater < 0.6) {
        slopeAt(body, walker.position, current);
        const steepness = current.length();
        if (steepness > FALLS_SLOPE) {
            walker.swimming = false;
            inFalls = true;
            current.divideScalar(-steepness);
        }
    }
    // Wading into another world's sea (Titan's methane) is a place visited.
    const liquid = body.biome?.liquid;
    if (liquid && depth > 0.3 && aboveWater < 0.3 && !runtime.stats.visited.includes(liquid.name)) runtime.stats.visited.push(liquid.name);
    // Off the ground where gravity is weak there is nothing to push against:
    // drifting across faster than an orbit just above the ground would carry
    // the explorer off over the horizon.
    const weak = lowGravity(body);
    const airCap = weak && !walker.onGround && !walker.swimming ? groundOrbitSpeed(body) * 0.8 : Infinity;
    const legs = strideFactor(body);
    // On foot, turning round comes first: little speed until the body faces the way it is going
    // (a quarter of it going straight back), as a person plants a foot and pivots.
    const facingWay = walker.swimming || moveLength < 0.01 ? 1 : 0.25 + 0.75 * Math.max(0, walker.facing.dot(move));
    const targetSpeed = Math.min(airCap, moveLength * (walker.swimming ? (sprinting ? SWIM_SPRINT : SWIM) : (sprinting ? SPRINT : WALK) * legs * facingWay));

    horizontal.copy(walker.velocity).addScaledVector(up, -walker.velocity.dot(up));
    let vertical = walker.velocity.dot(up);
    desired.copy(move).multiplyScalar(targetSpeed);

    // Ground too steep to stand on: no walking up it, and sliding down it.
    walker.sliding = false;
    if (walker.onGround && !walker.swimming) {
        slopeAt(body, walker.position, uphill);
        const steepness = uphill.length();
        if (steepness > STEEP) {
            uphill.divideScalar(steepness);
            const climb = desired.dot(uphill);
            if (climb > 0) desired.addScaledVector(uphill, -climb);
            walker.sliding = true;
            // Down the slope at gravity times its sine, less what friction holds back.
            const sine = steepness / Math.sqrt(1 + steepness * steepness);
            horizontal.addScaledVector(uphill, -gravity * Math.max(0, sine - 0.5) * 1.6 * dt);
        }
    }
    // In a fall the water has hold of them: little grip, and pushed downhill with the flow.
    const grip = inFalls ? 0.8 : walker.sliding ? 1.5 : walker.onGround ? GROUND_GRIP * legs : 2.2;
    horizontal.lerp(desired, 1 - Math.exp(-dt * grip));
    if (inFalls) horizontal.addScaledVector(current, Math.min(gravity * 0.7, 7) * dt);

    // The wind leans on the explorer (weather.ts): standing, the boots hold
    // against all but a violent gust, though walking into it is slower and
    // with it faster; once the push beats the grip (a tornado's inflow) it
    // shoves them across the ground; in the air it carries them. In Mars's
    // thin air even a dust storm is a breath.
    const weather = runtime.weather;
    walker.windPush = 0;
    if (weather.body === body && weather.density > 0 && !walker.swimming) {
        windForce(weather, horizontal, WALKER_AREA, WALKER_MASS, blow);
        blow.addScaledVector(up, -blow.dot(up));
        const force = blow.length();
        const hold = FOOTING * gravity;
        walker.windPush = force / hold;
        if (!walker.onGround) horizontal.addScaledVector(blow, dt);
        else if (force > hold) horizontal.addScaledVector(blow, (1 - hold / force) * 2 * dt + 0.35 * dt);
        else horizontal.addScaledVector(blow, 1.2 * dt);
    }

    // Jump: tap Space on the ground. Keep holding it, and once clear of the
    // ground the jetpack fires; pressed in mid-air (falling off a ledge, say)
    // it fires at once. X fires it downward, to come back from a jump that
    // would otherwise take minutes where gravity is weak.
    walker.jumpTime += dt;
    const space = control && (input.keys.has('Space') || input.pressed.has('Jet'));
    const downward = control && input.keys.has('KeyX');
    if (control && consume(input, 'Space') && walker.onGround && !walker.swimming && !walker.jumpPending) {
        // A short crouch, then the spring.
        walker.jumpPending = true;
        walker.jumpTime = 0;
    }
    if (walker.jumpPending && walker.jumpTime >= JUMP_CROUCH) {
        walker.jumpPending = false;
        // Running uphill the body is already rising with the ground; the spring adds to that.
        // (Without it the ground climbs under the stride faster than a weak-gravity jump leaves it.)
        slopeAt(body, walker.position, uphill);
        const rising = Math.max(0, horizontal.dot(uphill));
        vertical = Math.max(vertical, 0) + jumpSpeed(body) + rising;
        walker.onGround = false;
        walker.airTime = 0;
        walker.jumped = true;
        walker.takeoff = walker.position.distanceTo(body.position);
    }
    walker.jetting = space && !walker.onGround && !walker.swimming && !walker.jumpPending && (walker.airTime > 0.25 || walker.jumpTime > JUMP_CROUCH + 0.25) && walker.jetpack > 0.02;
    if (walker.jetting) {
        vertical += JETPACK_THRUST * dt;
        walker.jetpack = Math.max(0, walker.jetpack - dt * 0.42 / jetpackEndurance(runtime.supplies));
    } else if (walker.onGround) {
        walker.jetpack = Math.min(1, walker.jetpack + dt * 0.5);
    }
    walker.thrustingDown = downward && !walker.onGround && !walker.swimming && !walker.jetting && walker.jetpack > 0.02 && vertical > -DOWN_SPEED;
    if (walker.thrustingDown) {
        vertical = Math.max(-DOWN_SPEED, vertical - JETPACK_THRUST * dt);
        walker.jetpack = Math.max(0, walker.jetpack - dt * 0.42 / jetpackEndurance(runtime.supplies));
    }
    vertical -= gravity * dt;
    // The jetpack lifts to 9 m/s at most, and where gravity is weak no faster
    // than a fair share of the speed that would leave the world behind;
    // nothing falls faster than 60.
    const climb = weak ? Math.min(9, Math.max(jumpSpeed(body), 0.45 * Math.sqrt(2 * gravity * body.radius))) : Math.max(9, JUMP_SPEED);
    vertical = THREE.MathUtils.clamp(vertical, -60, climb);

    const wasOnGround = walker.onGround;
    const falling = -vertical;
    before.copy(walker.position);
    const beforeGround = before.distanceTo(body.position);
    walker.velocity.copy(horizontal).addScaledVector(up, vertical);
    walker.position.addScaledVector(walker.velocity, dt);

    // Rocks, trunks and pillars are solid; their tops can be stood on.
    let standing = false;
    for (const obstacles of [runtime.surface.obstacles, runtime.surface.fixtures, runtime.surface.shelters]) {
        for (let i = 0; i < obstacles.length; i += 5) {
            push.set(walker.position.x - obstacles[i], walker.position.y - obstacles[i + 1], walker.position.z - obstacles[i + 2]);
            const reach = obstacles[i + 3] + 0.45;
            const gap = push.lengthSq();
            if (gap >= reach * reach || gap < 1e-8) continue;
            const length = Math.sqrt(gap);
            push.divideScalar(length);
            walker.position.addScaledVector(push, reach - length);
            const into = walker.velocity.dot(push);
            if (into < 0) walker.velocity.addScaledVector(push, -into);
            if (push.dot(up) > 0.6) standing = true;
        }
    }

    // Stand on the ground.
    let distance = walker.position.distanceTo(body.position);
    up.copy(walker.position).sub(body.position).divideScalar(distance);
    // In water the explorer wades, sunk in it as far as the chest; diving, deeper; at sea, lifted
    // and dropped by the breakers coming in (seaWaves.ts, the same as the picture's).
    let groundRadius = body.radius + groundHeight(body, up) - Math.min(waterDepth(body, up), 1.1) - walker.dive + swellAt(body, up);
    // What a stride may climb: a step, plus walkable slope over the ground covered.
    const stride = Math.sqrt(Math.max(0, walker.position.distanceToSquared(before) - (vertical * dt) ** 2));
    const wall = distance <= groundRadius + 0.02 && groundRadius - distance > STEP + stride * STEEP && !walker.swimming;
    // Walking (not running) stops at the edge of a drop that would hurt, as in
    // Tomb Raider: run, or jump, to go over it. A cliff in the ground is a
    // slope a few metres wide, so the ground is looked at a little way ahead.
    let edge = false;
    if (wasOnGround && !sprinting && !walker.swimming && !walker.jumpPending && vertical <= 0.01 && horizontal.lengthSq() > 0.09) {
        ahead.copy(horizontal).normalize();
        const here = beforeGround - body.radius;
        edge = here - groundAhead(body, before, ahead, 1.5) > 1.2 && here - groundAhead(body, before, ahead, 4) > safeDrop(gravity);
    }
    walker.atEdge = edge;
    // Wading out into a liquid that will not float them: no further than chest deep.
    const sinks = !floats && waterDepth(body, up) > SWIM_DEPTH && waterDepth(body, up) > waterDepth(body, upBefore.copy(before).sub(body.position).normalize());
    if (sinks) warnSinking(runtime, body);
    if (wall || edge || sinks) {
        // A wall, a ledge higher than a step, or the brink of a drop: it stops
        // the explorer where they were, still free to move up or down.
        walker.position.copy(before).addScaledVector(up, vertical * dt);
        walker.velocity.copy(up).multiplyScalar(vertical);
        distance = walker.position.distanceTo(body.position);
        up.copy(walker.position).sub(body.position).divideScalar(distance);
        groundRadius = body.radius + groundHeight(body, up) - Math.min(waterDepth(body, up), 1.1) - walker.dive + swellAt(body, up);
    }
    if (distance <= groundRadius + 0.02) {
        walker.position.copy(body.position).addScaledVector(up, groundRadius);
        const into = walker.velocity.dot(up);
        if (into < 0) walker.velocity.addScaledVector(up, -into);
        // Still rising from a jump where the ground climbs as fast: lifted onto it, but not landed
        // (landing here let the boots' grip below pin the walker and cancel the jump).
        walker.onGround = !(walker.jumped && into > 0.01);
    } else {
        // Within a few centimetres counts as on the ground, except while rising (a jump leaving it).
        walker.onGround = standing || (distance - groundRadius < 0.08 && walker.velocity.dot(up) <= 0.01);
        // Where gravity cannot hold a walker down, the ground falls away under
        // a stride faster than they fall after it: the boots' spikes keep them
        // on it over walkable ground, and latch on as they come within a step
        // of it (not over a drop, nor rising from a jump).
        if (!walker.onGround && (wasOnGround || (!walker.jumped && vertical <= 0.01)) && !walker.jetting && !walker.swimming && weak
            && distance - groundRadius < STEP + stride * STEEP) {
            walker.position.copy(body.position).addScaledVector(up, groundRadius);
            const out = walker.velocity.dot(up);
            if (out > 0) walker.velocity.addScaledVector(up, -out);
            walker.onGround = true;
        }
    }

    // Off the ground, keep the highest point; coming down, remember when, from
    // how long in the air (for the landing), how high a jump went and how far
    // the drop was (for the story's challenges).
    const radiusNow = walker.position.distanceTo(body.position);
    if (!walker.onGround) {
        if (wasOnGround && !walker.jumped) walker.peak = radiusNow;
        walker.peak = Math.max(walker.peak, radiusNow);
    }
    if (walker.onGround && !wasOnGround) {
        walker.landedFrom = walker.airTime;
        walker.landTime = 0;
        walker.touchdown = true;
        walker.lastJump = walker.jumped ? Math.max(0, walker.peak - walker.takeoff) : 0;
        walker.lastDrop = walker.jetting ? 0 : Math.max(0, walker.peak - radiusNow);
        walker.jumped = false;
    } else if (walker.onGround) {
        walker.peak = radiusNow;
    }
    walker.landTime += dt;
    // A hard landing hurts by the speed it ends at; deep water takes most of it.
    if (walker.onGround && !wasOnGround && falling > SAFE_IMPACT) {
        const cushion = waterDepth(body, up) > SWIM_DEPTH ? 0.25 : 1;
        const harm = Math.pow(THREE.MathUtils.clamp((falling * cushion - SAFE_IMPACT) / (LETHAL_IMPACT - SAFE_IMPACT), 0, 1.5), 1.5);
        if (harm > 0.01) {
            walker.health = Math.max(0, walker.health - harm);
            walker.hurtBy = 'fall';
            walker.impact = Math.min(1, harm);
            walker.impactTime = 0;
            walker.hurtAgo = 0;
        }
    }
    walker.impactTime += dt;

    // Face the way we move, turning as a person turns: quickly, but not in an instant.
    if (moveLength > 0.05) {
        const angle = walker.facing.angleTo(move);
        if (angle > 1e-4) {
            turnAxis.crossVectors(walker.facing, move);
            if (turnAxis.lengthSq() < 1e-8) turnAxis.copy(up);
            turnAxis.normalize();
            walker.facing.applyAxisAngle(turnAxis, Math.min(angle * (1 - Math.exp(-dt * 10)), TURN_RATE * dt));
        }
        flatten(walker.facing, up, walker.look);
    }
    const speed = horizontal.length();
    walker.moving = walker.onGround || walker.swimming ? Math.min(1, speed / (walker.swimming ? SWIM : WALK * legs)) : 0.15;
    walker.running = sprinting && walker.onGround && !walker.swimming && speed > WALK * legs * 1.15;
    walker.airTime = walker.onGround || walker.swimming ? 0 : walker.airTime + dt;
    walker.gait += speed * dt * 1.55;

    // Air: the suit's own where the air cannot be breathed; with none left,
    // health goes. Health comes back slowly once unhurt for a while, faster
    // standing still.
    // Inside a dome (Domes.tsx) there is air, as on a world where there is.
    if (body.breathable || runtime.inDome) walker.oxygen = Math.min(1, walker.oxygen + dt / 20);
    else walker.oxygen = Math.max(0, walker.oxygen - dt / (airMinutes(runtime.supplies) * 60));
    // Heat: the suit's cooling holds out for minutes on the hottest ground,
    // and comes back slowly once out of it.
    walker.kelvin = surfaceKelvin(body, up);
    const drain = runtime.inDome ? 0 : coolingDrain(walker.kelvin);
    walker.cooling = drain > 0 ? Math.max(0, walker.cooling - dt * drain) : Math.min(1, walker.cooling + dt / 240);
    // Hunger: a full stomach lasts a quarter of an hour; sitting by a fire it waits.
    if (!walker.sitting) walker.satiety = Math.max(0, walker.satiety - dt / SATIETY_SECONDS);
    if (walker.eating > 0) walker.eating = Math.max(0, walker.eating - dt);
    if (walker.gathering > 0) walker.gathering = Math.max(0, walker.gathering - dt);
    walker.hurtAgo += dt;
    if (walker.oxygen <= 0 || walker.satiety <= 0 || (walker.cooling <= 0 && drain > 0)) {
        walker.health = Math.max(0, walker.health - dt * (walker.oxygen <= 0 ? 0.04 : walker.cooling <= 0 && drain > 0 ? 0.03 : 0.006));
        walker.hurtBy = walker.oxygen <= 0 ? 'air' : walker.cooling <= 0 && drain > 0 ? 'heat' : 'hunger';
        walker.hurtAgo = 0;
    } else if (walker.sitting && !walker.down) {
        walker.health = Math.min(1, walker.health + dt * 0.03);
    } else if (walker.hurtAgo > 6 && !walker.down) {
        const resting = walker.onGround && walker.moving < 0.1;
        walker.health = Math.min(1, walker.health + dt * (resting || runtime.inDome ? 0.01 : 0.002));
    }
    if (walker.health <= 0) walker.down = true;

    consume(input, 'KeyF');
    updateEnvironment(runtime, walker.position);
};

const cameraTarget = new THREE.Vector3();
const viewDir = new THREE.Vector3();
const cameraUp = new THREE.Vector3();

/** Third-person camera behind and above the explorer; returns world positions. */
export const walkerCamera = (walker: WalkerState, outPosition: THREE.Vector3, outTarget: THREE.Vector3) => {
    cameraUp.copy(walker.position).sub(walker.body.position).normalize();
    cameraTarget.copy(walker.position).addScaledVector(cameraUp, 1.55);
    viewDir.copy(walker.look).multiplyScalar(Math.cos(walker.pitch)).addScaledVector(cameraUp, Math.sin(walker.pitch)).normalize();
    outPosition.copy(cameraTarget).addScaledVector(viewDir, -5.4).addScaledVector(cameraUp, 0.45);
    // Keep the camera out of the ground: out of the water too, unless the explorer has dived, when
    // it follows them down (no lower than the bed).
    const distance = outPosition.distanceTo(walker.body.position);
    const camUp = outPosition.clone().sub(walker.body.position).divideScalar(distance);
    const under = walker.dive > 0.3 ? waterDepth(walker.body, camUp) : 0;
    const minimum = walker.body.radius + groundHeight(walker.body, camUp) - under + 0.7;
    if (distance < minimum) outPosition.copy(walker.body.position).addScaledVector(camUp, minimum);
    outTarget.copy(cameraTarget).addScaledVector(viewDir, 8);
    return cameraUp;
};
