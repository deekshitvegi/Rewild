import * as THREE from 'three';
import { EXPEDITION_BODIES, SPREAD, type ExpeditionBody } from './bodies';
import { groundHeight, influenceRadius, updateEnvironment, waterDepth } from './environment';
import { axis, consume, type ExpeditionInput } from './input';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import type { ExpeditionRuntime } from './runtime';
import { SHIP_GEAR_HEIGHT } from './Ship';
import { courseTo, playerTakesOver, steer, type AutopilotControl, type Course } from './autopilot';
import { FIELD_RADIUS, HEAT_LIMIT, HEAT_WARNING, SUN, beltDensity, heatDamage, hullTemperature } from './hazards';
import { crushHeight, gasModel, pressureAt, windAt } from './gasAtmosphere';
import { fromEquatorial } from './orbits';
import { vortexAt } from './vortices';

/**
 * Ship flight: arcade handling in the spirit of the reference video. The ship
 * flies where it points; W/S set a held throttle, the mouse (or a touch drag)
 * moves a virtual stick, Shift boosts, and Space engages the pulse drive in open
 * space. F lands (autopilot down to the ground, gear out) or takes off.
 */
export interface ShipState {
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    quaternion: THREE.Quaternion;
    throttle: number;
    stickX: number;
    stickY: number;
    angular: THREE.Vector3;
    boost: number;
    pulse: number;
    pulseEngaged: boolean;
    gear: number;
    landed: boolean;
    landing: null | { t: number; from: THREE.Vector3; to: THREE.Vector3; fromQ: THREE.Quaternion; toQ: THREE.Quaternion };
    takeoff: number;
    shield: number;
    entry: number;
    /** Latest message for the HUD, e.g. why the pulse drive will not engage. */
    notice: string;
    noticeTime: number;
    /** Velocity the ship's own flight does not cancel: the black hole's pull, the wind. */
    drift: THREE.Vector3;
    /** The wind where the ship is (m/s, world): a giant's jet, or the weather on a world with air. */
    wind: THREE.Vector3;
    /** What last cost the shield ('heat', 'asteroid', 'impact'), for the report if the ship is lost. */
    hurtBy: string;
    /** The shield gave out and the ship is lost (Player puts a new one where the last landed); `age` counts game seconds since. */
    destroyed: null | { time: number; cause: string; age: number };
    /** When a new ship last replaced a lost one (the view fades back in). */
    replacedAt: number;
    /** Hull temperature, kelvin (hazards.ts). */
    temperature: number;
    /** The pulse drive was engaged close to the Sun: its heat cut-out is off for this run. */
    sunDive: boolean;
    /** Seconds spent crossing a belt on the pulse drive, and after how many a cluster pulls the ship out. */
    beltTime: number;
    beltLimit: number;
    /** A knock from an impact, for the camera (dies away). */
    jolt: number;
}

/** Seconds of a belt crossing before a cluster pulls the ship out: about every other crossing. */
const nextBeltLimit = () => 0.5 + Math.random() * 3.5;

export const createShipState = (position: THREE.Vector3, lookAt: THREE.Vector3, up: THREE.Vector3): ShipState => {
    const matrix = new THREE.Matrix4().lookAt(position, lookAt, up);
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
    return {
        position: position.clone(),
        velocity: forward.multiplyScalar(90),
        quaternion,
        throttle: 0.45,
        stickX: 0,
        stickY: 0,
        angular: new THREE.Vector3(),
        boost: 0,
        pulse: 0,
        pulseEngaged: false,
        gear: 0,
        landed: false,
        landing: null,
        takeoff: 0,
        shield: 1,
        entry: 0,
        notice: '',
        noticeTime: 0,
        drift: new THREE.Vector3(),
        wind: new THREE.Vector3(),
        hurtBy: '',
        destroyed: null,
        replacedAt: -99,
        temperature: 279,
        sunDive: false,
        beltTime: 0,
        beltLimit: nextBeltLimit(),
        jolt: 0,
    };
};

/** The pulse drive's lowest speed, near a world. */
export const PULSE_SPEED = 24000;

/**
 * The pulse drive's speed `gap` units from the nearest surface: faster the
 * further the ship is from everything, as a supercruise, so that crossing to
 * the next planet takes seconds and not hours. Moving at most 0.7 of the gap
 * a second, it cannot pass through a world between two frames, and it slows
 * as the world it is heading for comes near.
 */
export const pulseSpeedFor = (gap: number) => THREE.MathUtils.clamp(gap * 0.7, PULSE_SPEED, 4e8 * SPREAD);

const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const right = new THREE.Vector3();
const planetUp = new THREE.Vector3();
const target = new THREE.Vector3();
const tmp = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const euler = new THREE.Euler();
const matrix = new THREE.Matrix4();
const heading = new THREE.Quaternion();
const zero = new THREE.Vector3();
const eastward = new THREE.Vector3();
const poles = new Map<string, THREE.Vector3>();
/** A giant's north pole (its jets blow along its latitudes). */
const poleOf = (body: ExpeditionBody) => {
    let pole = poles.get(body.id);
    if (!pole) {
        pole = body.gas ? fromEquatorial(body.gas.pole[0], body.gas.pole[1]) : new THREE.Vector3(0, 1, 0);
        poles.set(body.id, pole);
    }
    return pole;
};
/** Share of a giant's jet that carries the ship (it flies, it does not float). */
const JET_CARRY = 0.5;

// The course the autopilot flies, worked out once per course.
let course: Course | null = null;
const courseFor = (id: string) => {
    if (course?.id !== id) course = courseTo(id);
    return course;
};

const notice = (ship: ShipState, message: string, time: number) => {
    ship.notice = message;
    ship.noticeTime = time;
};

/** Nearest surface we might hit, and how far above it the ship is. */
const surfaceClearance = (ship: ShipState, body: ExpeditionBody) => {
    const distance = ship.position.distanceTo(body.position);
    planetUp.copy(ship.position).sub(body.position).divideScalar(distance);
    const ground = body.kind === 'rocky' ? groundHeight(body, planetUp) : 0;
    return distance - body.radius - ground;
};

export const updateShip = (
    ship: ShipState,
    input: ExpeditionInput,
    runtime: ExpeditionRuntime,
    dt: number,
    time: number,
    touchLook: number,
) => {
    // Where are we? Needed even while landed (to step out) or landing.
    updateEnvironment(runtime, ship.position);
    ship.temperature = hullTemperature(ship.position);
    runtime.heat = ship.temperature;
    ship.jolt = Math.max(0, ship.jolt - dt * 2.5);

    // The shield gave out: the ship is lost. The wreck drifts while Player
    // readies a new one where the last one landed.
    if (!ship.destroyed && ship.shield <= 0 && !ship.landed && !ship.landing) {
        ship.destroyed = { time, cause: ship.hurtBy || 'impact', age: 0 };
        ship.pulseEngaged = false;
        ship.pulse = 0;
        ship.boost = 0;
        ship.jolt = 1;
        runtime.autopilot = false;
    }
    if (ship.destroyed) {
        ship.velocity.multiplyScalar(Math.exp(-dt * 0.5));
        ship.position.addScaledVector(ship.velocity, dt);
        input.lookX = 0;
        input.lookY = 0;
        input.primary = false;
        return;
    }
    const body = runtime.currentBody;
    const inAtmosphere = runtime.atmosphere > 0.02;
    forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    up.set(0, 1, 0).applyQuaternion(ship.quaternion);
    right.set(1, 0, 0).applyQuaternion(ship.quaternion);

    // ---- Autopilot: G flies to the course set on the map ----------------------
    if (consume(input, 'KeyG')) {
        if (runtime.autopilot) {
            runtime.autopilot = false;
            notice(ship, 'AUTOPILOT OFF · YOU HAVE THE CONTROLS', time);
        } else if (!runtime.waypoint || !courseFor(runtime.waypoint)) {
            notice(ship, 'SET A COURSE ON THE MAP FIRST (M)', time);
        } else if (inField(runtime, ship.position)) {
            notice(ship, 'FLY CLEAR OF THE ASTEROID CLUSTER FIRST', time);
        } else if (!ship.landing) {
            runtime.autopilot = true;
            notice(ship, `AUTOPILOT ENGAGED · ${courseFor(runtime.waypoint)!.name.toUpperCase()}`, time);
        }
    }
    const plotted = runtime.autopilot && runtime.waypoint ? courseFor(runtime.waypoint) : null;
    if (runtime.autopilot && (!plotted || ship.landing || runtime.fall.active)) runtime.autopilot = false;
    if (runtime.autopilot && playerTakesOver(input)) {
        runtime.autopilot = false;
        notice(ship, 'AUTOPILOT OFF · YOU HAVE THE CONTROLS', time);
    }
    if (!runtime.autopilot) runtime.autopilotStatus = null;

    // ---- Landed: sit still until take-off -----------------------------------
    if (ship.landed) {
        ship.velocity.set(0, 0, 0);
        ship.throttle = 0;
        ship.gear = Math.min(1, ship.gear + dt);
        if (consume(input, 'KeyF') || input.keys.has('KeyW') || input.moveY > 0.5 || runtime.autopilot) {
            ship.landed = false;
            ship.takeoff = 1.6;
            ship.throttle = 0.25;
        }
        input.lookX = 0;
        input.lookY = 0;
        return;
    }

    // ---- Landing autopilot --------------------------------------------------
    if (ship.landing) {
        const landing = ship.landing;
        landing.t = Math.min(1, landing.t + dt / 3.0);
        const ease = landing.t * landing.t * (3 - 2 * landing.t);
        ship.position.lerpVectors(landing.from, landing.to, ease);
        ship.quaternion.slerpQuaternions(landing.fromQ, landing.toQ, Math.min(1, ease * 1.4));
        ship.gear = Math.min(1, landing.t * 2.2);
        ship.velocity.set(0, 0, 0);
        if (landing.t >= 1) {
            ship.landing = null;
            ship.landed = true;
        }
        input.lookX = 0;
        input.lookY = 0;
        return;
    }

    // ---- Steering: the autopilot, or a virtual stick moved by the mouse -------
    let pilot: AutopilotControl | null = null;
    if (runtime.autopilot && plotted) {
        // Turn smoothly onto the way the autopilot wants to go.
        pilot = steer(plotted, ship.position, ship.velocity, up, inAtmosphere ? body : null, runtime.altitude, body);
        runtime.autopilotStatus = { phase: pilot.phase, remaining: pilot.remaining, name: plotted.name };
        ship.stickX = 0;
        ship.stickY = 0;
        input.lookX = 0;
        input.lookY = 0;
        ship.angular.multiplyScalar(Math.exp(-dt * 4));
        matrix.lookAt(zero, pilot.aim, pilot.up);
        heading.setFromRotationMatrix(matrix);
        ship.quaternion.rotateTowards(heading, (ship.pulse > 0.05 ? 0.4 : inAtmosphere ? 0.75 : 1.1) * dt);
        forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    } else {
        const sensitivity = 0.0042;
        ship.stickX = THREE.MathUtils.clamp(ship.stickX + input.lookX * sensitivity * touchLook, -1, 1);
        ship.stickY = THREE.MathUtils.clamp(ship.stickY + input.lookY * sensitivity * touchLook, -1, 1);
        input.lookX = 0;
        input.lookY = 0;
        const spring = Math.exp(-dt * 2.6);
        ship.stickX *= spring;
        ship.stickY *= spring;

        const keyYaw = axis(input, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
        const keyPitch = axis(input, ['ArrowDown'], ['ArrowUp']);
        const roll = axis(input, ['KeyE'], ['KeyQ']);
        const pulseFactor = 1 - ship.pulse * 0.75;
        const targetPitch = (-ship.stickY + keyPitch) * 1.25 * pulseFactor;
        const targetYaw = (-ship.stickX + keyYaw * 0.8 - input.moveX * 0.9) * 1.0 * pulseFactor;
        const targetRoll = roll * 2.1;
        const response = 1 - Math.exp(-dt * 5.5);
        ship.angular.x += (targetPitch - ship.angular.x) * response;
        ship.angular.y += (targetYaw - ship.angular.y) * response;
        ship.angular.z += (targetRoll - ship.angular.z) * response;

        // Inside a world's air, level the wings towards its horizon unless rolling,
        // and bank into turns.
        let levelRoll = 0;
        if (body && body.kind === 'rocky' && runtime.altitude < (body.biome?.atmosphereHeight ?? 0) * 2.5) {
            planetUp.copy(ship.position).sub(body.position).normalize();
            // Positive roll lifts the right wing; turning left should lift it a little.
            const bankTarget = ship.angular.y * 0.55;
            const sideTilt = Math.asin(THREE.MathUtils.clamp(right.dot(planetUp), -1, 1));
            levelRoll = -(sideTilt - bankTarget) * 1.8 * (roll === 0 ? 1 : 0);
        }

        euler.set(ship.angular.x * dt, ship.angular.y * dt, (ship.angular.z + levelRoll) * dt, 'XYZ');
        rotation.setFromEuler(euler);
        ship.quaternion.multiply(rotation).normalize();
        forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    }

    // ---- Throttle, boost and pulse ----------------------------------------------
    if (pilot) {
        // The speed the autopilot wants, from the throttle and boost.
        const cruiseNow = inAtmosphere ? 230 : 950;
        const boostNow = inAtmosphere ? 560 : 2600;
        const wantThrottle = Math.min(1, pilot.speed / cruiseNow);
        const wantBoost = THREE.MathUtils.clamp((pilot.speed - cruiseNow) / boostNow, 0, 1);
        ship.throttle += (wantThrottle - ship.throttle) * (1 - Math.exp(-dt * 2));
        ship.boost += (wantBoost - ship.boost) * (1 - Math.exp(-dt * 3));
    } else {
        const throttleInput = axis(input, ['KeyS'], ['KeyW']) + input.moveY;
        ship.throttle = THREE.MathUtils.clamp(ship.throttle + throttleInput * dt * 0.75, -0.2, 1);
        const boosting = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || input.pressed.has('Boost');
        ship.boost += ((boosting ? 1 : 0) - ship.boost) * (1 - Math.exp(-dt * 3));
    }

    // Close to the Sun, engaging the drive is a dive: its heat cut-out is off.
    if (!ship.pulseEngaged) ship.sunDive = false;
    const massLocked = inField(runtime, ship.position);
    const nearestGap = nearestSurfaceGap(ship.position, ship.sunDive);
    const pulseAllowed = !inAtmosphere && !massLocked && nearestGap.gap > nearestGap.safe;
    const nearSun = nearestGap.body === SUN && ship.temperature > HEAT_WARNING;
    if (pilot) {
        // The autopilot engages the drive once lined up, and drops it short of the goal.
        // Engaged closer than about twice the safe distance, the drive would
        // trip its own arrival rule as it spooled up, and flicker on and off.
        const facing = forward.dot(pilot.aim);
        if (!ship.pulseEngaged && pilot.pulse && pulseAllowed && nearestGap.gap > nearestGap.safe * 2.2 && facing > 0.995 && pilot.remaining > 60000) {
            ship.pulseEngaged = true;
            notice(ship, 'PULSE DRIVE ENGAGED', time);
        } else if (ship.pulseEngaged && (!pilot.pulse || facing < 0.94 || pilot.remaining < 30000)) {
            ship.pulseEngaged = false;
        }
    } else if (consume(input, 'Space')) {
        if (ship.pulseEngaged) {
            ship.pulseEngaged = false;
        } else if (massLocked) {
            notice(ship, 'MASS LOCKED · FLY CLEAR OF THE ASTEROID CLUSTER', time);
        } else if (nearSun && !inAtmosphere && nearestGap.gap > SUN.radius * 0.02) {
            ship.pulseEngaged = true;
            ship.sunDive = true;
            notice(ship, `SUN DIVE · HEAT CUT-OUT OFF · SHIELD RATED TO ${HEAT_LIMIT} K`, time);
        } else if (pulseAllowed) {
            ship.pulseEngaged = true;
            notice(ship, 'PULSE DRIVE ENGAGED', time);
        } else {
            notice(ship, inAtmosphere ? 'LEAVE THE ATMOSPHERE TO USE THE PULSE DRIVE' : 'TOO CLOSE TO A WORLD FOR THE PULSE DRIVE', time);
        }
    }
    // Drop out of the pulse drive before plunging into a world (or, near
    // the Sun, before the hull passes its rating, unless diving).
    const moving = ship.velocity.length();
    if (ship.pulseEngaged && nearestGap.gap < nearestGap.safe + ship.pulse * moving * 0.7) {
        ship.pulseEngaged = false;
        notice(ship, nearestGap.body === SUN && !ship.sunDive
            ? 'HEAT LIMIT AHEAD · PULSE DRIVE DROPPED · SPACE AGAIN TO DIVE CLOSER'
            : `ARRIVING · ${nearestGap.body?.name.toUpperCase() ?? ''}`, time);
    }
    if (ship.pulseEngaged && massLocked) {
        ship.pulseEngaged = false;
        notice(ship, 'MASS LOCKED · ASTEROID CLUSTER', time);
    }
    // Crossing a belt on the pulse drive can pull the ship out into a dense
    // cluster, about every other crossing; the autopilot plots round them.
    if (ship.pulseEngaged && !pilot && beltDensity(ship.position) > 0.25) {
        ship.beltTime += dt;
        if (ship.beltTime > ship.beltLimit) {
            ship.beltTime = 0;
            ship.beltLimit = nextBeltLimit();
            ship.pulseEngaged = false;
            ship.pulse = 0;
            ship.velocity.copy(forward).multiplyScalar(650);
            ship.jolt = 1;
            runtime.asteroidField = {
                center: ship.position.clone().addScaledVector(forward, FIELD_RADIUS * 0.45),
                radius: FIELD_RADIUS,
                seed: Math.floor(Math.random() * 1e6),
                entry: ship.position.clone(),
            };
            notice(ship, 'INTERDICTED · DENSE ASTEROID CLUSTER · FLY CLEAR TO USE THE PULSE DRIVE', time);
        }
    } else if (!ship.pulseEngaged || beltDensity(ship.position) < 0.05) {
        if (ship.beltTime > 0) ship.beltLimit = nextBeltLimit();
        ship.beltTime = 0;
    }
    // ...or into a wormhole, or too close to TON 618.
    if (ship.pulseEngaged) {
        for (const mouth of WORMHOLES) {
            if (ship.position.distanceTo(mouth.position) < mouth.radius * 12 + ship.pulse * moving * 0.7) {
                ship.pulseEngaged = false;
                notice(ship, 'WORMHOLE AHEAD', time);
            }
        }
        if (ship.position.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * 40 + ship.pulse * moving * 0.7) {
            ship.pulseEngaged = false;
            notice(ship, `ARRIVING · ${BLACK_HOLE.name}`, time);
        }
    }
    ship.pulse += ((ship.pulseEngaged ? 1 : 0) - ship.pulse) * (1 - Math.exp(-dt * (ship.pulseEngaged ? 0.9 : 2.8)));
    if (ship.pulse < 0.001) ship.pulse = 0;

    const cruise = inAtmosphere ? 230 : 950;
    const boostSpeed = inAtmosphere ? 560 : 2600;
    let speed = ship.throttle * cruise + ship.boost * boostSpeed * Math.max(ship.throttle, 0.35);
    speed = THREE.MathUtils.lerp(speed, pulseSpeedFor(Math.min(nearestGap.gap, distanceToDeepSpace(ship.position), pilot ? pilot.remaining : Infinity)), ship.pulse * ship.pulse);
    if (ship.takeoff > 0) {
        ship.takeoff -= dt;
        planetUp.copy(ship.position).sub(body?.position ?? tmp.set(0, 0, 0)).normalize();
        target.copy(planetUp).multiplyScalar(26).addScaledVector(forward, 30);
        ship.gear = Math.max(0, ship.gear - dt * 0.8);
    } else {
        target.copy(forward).multiplyScalar(speed);
        ship.gear = Math.max(0, ship.gear - dt * 0.8);
    }
    const grip = ship.pulse > 0.05 ? 3.5 : inAtmosphere ? 2.2 : 1.2;
    ship.velocity.lerp(target, 1 - Math.exp(-dt * grip));
    ship.position.addScaledVector(ship.velocity, dt);

    // TON 618 pulls. Its pull is not something the flight controls cancel, so
    // it builds up as drift the engines have to work against.
    tmp.copy(BLACK_HOLE.position).sub(ship.position);
    const blackHoleDistance = tmp.length();
    if (blackHoleDistance < BLACK_HOLE.horizon * 60) {
        const x = BLACK_HOLE.horizon / blackHoleDistance;
        ship.drift.addScaledVector(tmp.divideScalar(blackHoleDistance), 2600 * x * x * dt);
        if (blackHoleDistance < BLACK_HOLE.horizon * 6 && time - ship.noticeTime > 2.5) notice(ship, 'GRAVITY CRITICAL · BOOST AWAY', time);
    }
    // Inside a gas giant there is no ground, only air thickening with depth
    // (gasAtmosphere.ts). Its gravity pulls the ship down unless it keeps up
    // speed, gusts knock it about, and past the hull's rating the pressure
    // starts to crush it.
    if (body && body.kind === 'gas' && inAtmosphere) {
        const model = gasModel(body);
        planetUp.copy(ship.position).sub(body.position).normalize();
        const held = THREE.MathUtils.clamp(ship.velocity.length() / 180, 0, 1) * 0.8;
        ship.drift.addScaledVector(planetUp, -(body.gravity ?? 10) * 1.5 * (1 - held) * runtime.atmosphere * dt);
        let rough = THREE.MathUtils.clamp(0.3 - runtime.altitude / 7000, 0.1, 1) * runtime.atmosphere;
        // The jets: each band carries the ship east or west at its own speed
        // (Saturn's equator faster than any hurricane, Neptune's backwards),
        // and where neighbouring bands shear past each other it is rough.
        const pole = poleOf(body);
        const sinLat = planetUp.dot(pole);
        const jet = windAt(model, sinLat);
        eastward.crossVectors(pole, planetUp);
        if (eastward.lengthSq() > 1e-8) {
            eastward.normalize();
            ship.wind.copy(eastward).multiplyScalar(jet * runtime.atmosphere);
            ship.drift.addScaledVector(eastward, jet * JET_CARRY * runtime.atmosphere * 1.5 * dt);
            const shear = Math.abs(windAt(model, Math.min(1, sinLat + 0.015)) - windAt(model, Math.max(-1, sinLat - 0.015)));
            rough += Math.min(0.5, shear / 400) * runtime.atmosphere;
        }
        // In one of the great vortices the wind carries the ship round it: calm
        // in a hurricane's eye, violent in its eyewall.
        tmp.copy(ship.position).sub(body.position);
        const vortex = vortexAt(body, tmp);
        if (vortex) {
            const v = vortex.vortex;
            const r = vortex.rel * v.reach;
            const around = r < v.eye ? r / v.eye : Math.pow(v.eye / Math.max(r, 1), 0.6);
            const wind = v.wind * around * (1 - THREE.MathUtils.smoothstep(vortex.rel, 0.85, 1.35));
            planetUp.copy(tmp).normalize();
            // Round the centre: anticlockwise seen from above for a positive wind.
            const radial = tmp.copy(planetUp).addScaledVector(v.dir, -planetUp.dot(v.dir));
            if (radial.lengthSq() > 1e-12) {
                const tangent = radial.normalize().cross(v.dir).negate();
                ship.drift.addScaledVector(tangent, wind * 0.5 * runtime.atmosphere * dt);
            }
            if (v.kind === 'eye') rough *= r < v.eye * 0.85 ? 0.3 : r < v.eye * 2.2 ? 2.6 : 1.3;
            else rough *= 1.6;
            rough = Math.min(rough, 1);
        }
        if (Math.random() < dt * 1.4 * rough) {
            ship.jolt = Math.max(ship.jolt, 0.12 + Math.random() * 0.4 * rough);
            tmp.randomDirection().multiplyScalar(40 * rough);
            ship.drift.add(tmp);
        }
        const pressure = pressureAt(model, runtime.altitude);
        if (pressure > model.hullRating) {
            ship.shield = Math.max(0, ship.shield - (0.04 + (pressure / model.hullRating - 1) * 0.5) * dt);
            ship.hurtBy = 'pressure';
            if (time - ship.noticeTime > 2.2) notice(ship, `HULL BUCKLING · ${Math.round(pressure)} BAR · RATED ${model.hullRating} · CLIMB`, time);
        } else if (pressure > model.hullRating * 0.6 && time - ship.noticeTime > 6) {
            notice(ship, `${Math.round(pressure)} BAR · THE HULL IS RATED TO ${model.hullRating}`, time);
        }
        // A stroke of lightning that finds the ship (GasDepths picks them).
        const flash = runtime.gas?.flash;
        if (flash?.hit) {
            flash.hit = false;
            ship.shield = Math.max(0, ship.shield - 0.06 - flash.strength * 0.08);
            ship.hurtBy = 'lightning';
            ship.jolt = 1;
            notice(ship, 'LIGHTNING STRIKE · SHIELD HIT', time);
        }
    }
    // On a world with air the weather's wind drifts the ship, hardest when it
    // hovers or lands slowly (it flies through the air, so at speed it is
    // carried less), and gusts shake it. Mars's thin air barely moves it.
    const weather = runtime.weather;
    if (body && body.kind === 'rocky' && weather.body === body && weather.density > 0) {
        ship.wind.copy(weather.wind);
        if (inAtmosphere && !ship.landed) {
            const slow = 1 - Math.min(0.8, ship.velocity.length() / 200);
            const carry = Math.min(3, weather.density / 1.225) * 0.5 * slow;
            ship.drift.addScaledVector(weather.wind, carry * 1.5 * dt);
            const rough = Math.min(1, (weather.density / 1.225) * Math.abs(weather.gust) * weather.windSpeed / 12);
            if (Math.random() < dt * 2 * rough) ship.jolt = Math.max(ship.jolt, 0.05 + Math.random() * 0.25 * rough);
        }
    } else if (!(body && body.kind === 'gas' && inAtmosphere)) {
        ship.wind.set(0, 0, 0);
    }
    ship.drift.multiplyScalar(Math.exp(-dt * (blackHoleDistance < BLACK_HOLE.horizon * 60 ? 0.25 : 1.5)));
    ship.position.addScaledVector(ship.drift, dt);

    // ---- Collisions ----------------------------------------------------------
    for (const other of EXPEDITION_BODIES) {
        const distance = ship.position.distanceTo(other.position);
        if (distance > influenceRadius(other) * 1.2) continue;
        const clearance = surfaceClearance(ship, other);
        // A gas giant's floor is far below where its pressure has crushed the hull.
        const minimum = other.kind === 'star' ? other.radius * 0.01 : other.kind === 'gas' ? crushHeight(gasModel(other)) - 2600 : 2.4;
        if (clearance < minimum) {
            planetUp.copy(ship.position).sub(other.position).normalize();
            ship.position.addScaledVector(planetUp, minimum - clearance);
            const into = ship.velocity.dot(planetUp);
            if (into < 0) {
                if (into < -90) {
                    ship.shield = Math.max(0, ship.shield + into / 1200);
                    ship.hurtBy = other.kind === 'star' ? 'heat' : 'impact';
                    ship.jolt = Math.min(1, -into / 700);
                    notice(ship, 'HULL IMPACT', time);
                }
                ship.velocity.addScaledVector(planetUp, -into * 1.2);
            }
            ship.pulseEngaged = false;
        }
    }
    // Pillars, arches, big rocks and rock shelters near the ground.
    for (const obstacles of [runtime.surface.obstacles, runtime.surface.shelters])
    for (let i = 0; i < obstacles.length; i += 5) {
        if (!obstacles[i + 4]) continue;
        tmp.set(ship.position.x - obstacles[i], ship.position.y - obstacles[i + 1], ship.position.z - obstacles[i + 2]);
        const reach = obstacles[i + 3] + 2.6;
        const gap = tmp.lengthSq();
        if (gap >= reach * reach || gap < 1e-8) continue;
        const length = Math.sqrt(gap);
        tmp.divideScalar(length);
        ship.position.addScaledVector(tmp, reach - length);
        const into = ship.velocity.dot(tmp);
        if (into < 0) {
            if (into < -90) {
                ship.shield = Math.max(0, ship.shield + into / 1200);
                ship.hurtBy = 'impact';
                ship.jolt = Math.min(1, -into / 700);
                notice(ship, 'HULL IMPACT', time);
            }
            ship.velocity.addScaledVector(tmp, -into * 1.2);
        }
    }

    // ---- The Sun's heat -----------------------------------------------------------
    // Past its rating the heat shield burns away, faster the hotter the hull.
    const burn = heatDamage(ship.temperature);
    if (burn > 0) {
        ship.shield = Math.max(0, ship.shield - burn * dt);
        ship.hurtBy = 'heat';
        if (time - ship.noticeTime > 2.2) notice(ship, `HEAT SHIELD FAILING · HULL ${Math.round(ship.temperature)} K · TURN AWAY`, time);
    } else {
        if (ship.temperature > HEAT_WARNING && time - ship.noticeTime > 4) notice(ship, `HULL ${Math.round(ship.temperature)} K · SHIELD RATED TO ${HEAT_LIMIT} K`, time);
        ship.shield = Math.min(1, ship.shield + dt * 0.03);
    }

    // Atmospheric entry heats the nose when arriving fast.
    const entryTarget = inAtmosphere ? THREE.MathUtils.clamp((ship.velocity.length() - 260) / 900, 0, 1) * runtime.atmosphere * 2 : 0;
    ship.entry += (Math.min(1, entryTarget) - ship.entry) * (1 - Math.exp(-dt * 3));

    // ---- Landing request -------------------------------------------------------
    if (consume(input, 'KeyF')) {
        if (body && body.kind === 'rocky' && runtime.altitude < 220 && ship.velocity.length() < 260) {
            if (!startLanding(ship, body)) notice(ship, 'WATER BELOW · FIND DRY GROUND TO LAND', time);
        } else if (body && body.kind === 'rocky') {
            notice(ship, 'FLY LOWER AND SLOWER TO LAND', time);
        } else {
            notice(ship, 'NO SURFACE TO LAND ON', time);
        }
    }

    // ---- The autopilot's arrival: set down, or hand back the controls ---------
    if (pilot && runtime.autopilot && plotted) {
        if (pilot.state === 'land' && body && body.kind === 'rocky' && !runtime.mothership?.docked) {
            runtime.autopilot = false;
            runtime.waypoint = null;
            if (startLanding(ship, body)) notice(ship, `AUTOPILOT · LANDING ON ${body.name.toUpperCase()}`, time);
            else notice(ship, 'WATER BELOW · FIND DRY GROUND TO LAND', time);
        } else if (pilot.state === 'arrived' || (pilot.state === 'land' && runtime.mothership?.docked)) {
            runtime.autopilot = false;
            runtime.waypoint = null;
            ship.throttle = Math.min(ship.throttle, 0.3);
            notice(ship, `ARRIVED · ${plotted.name.toUpperCase()} · YOU HAVE THE CONTROLS`, time);
        }
    }

    updateEnvironment(runtime, ship.position);
};

/** Distance to the nearest wormhole mouth or TON 618, which the pulse drive also slows for. */
const distanceToDeepSpace = (position: THREE.Vector3) => {
    let d = position.distanceTo(BLACK_HOLE.position) - BLACK_HOLE.horizon * 40;
    for (const mouth of WORMHOLES) d = Math.min(d, position.distanceTo(mouth.position) - mouth.radius * 12);
    return Math.max(d, 0);
};

/**
 * The surface nearest the ship, how far off it is, and how close the pulse
 * drive may take the ship to it. For the Sun that is where the hull would
 * near its heat rating, unless the pilot chose to dive: then it is the
 * corona, and the heat is theirs to watch.
 */
const nearestSurfaceGap = (position: THREE.Vector3, sunDive = false) => {
    let best: ExpeditionBody | null = null;
    let gap = Infinity;
    let safe = 0;
    for (const body of EXPEDITION_BODIES) {
        const g = position.distanceTo(body.position) - body.radius;
        if (g < gap) {
            gap = g;
            best = body;
            safe = body.kind === 'star' ? body.radius * (sunDive ? 0.02 : 0.55) : body.kind === 'gas' ? body.radius * 0.45 : (body.biome?.atmosphereHeight ?? 1000) * 3 + 2000;
        }
    }
    return { body: best, gap, safe };
};

const startLanding = (ship: ShipState, body: ExpeditionBody) => {
    planetUp.copy(ship.position).sub(body.position).normalize();
    // Look ahead a little so the ship settles in front of where it was.
    forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    tmp.copy(forward).addScaledVector(planetUp, -forward.dot(planetUp));
    if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0).addScaledVector(planetUp, -planetUp.x);
    tmp.normalize();
    const spot = ship.position.clone().addScaledVector(tmp, 45);
    const spotUp = spot.clone().sub(body.position).normalize();
    if (waterDepth(body, spotUp) > 0) return false;
    const ground = groundHeight(body, spotUp);
    const to = body.position.clone().addScaledVector(spotUp, body.radius + ground + SHIP_GEAR_HEIGHT);
    matrix.lookAt(new THREE.Vector3(), tmp.clone().addScaledVector(spotUp, -tmp.dot(spotUp)).normalize(), spotUp);
    const toQ = new THREE.Quaternion().setFromRotationMatrix(matrix);
    ship.landing = { t: 0, from: ship.position.clone(), to, fromQ: ship.quaternion.clone(), toQ };
    ship.pulseEngaged = false;
    ship.throttle = 0;
    return true;
};

/** Inside the dense asteroid cluster the ship was pulled out into (the pulse drive is mass locked). */
const inField = (runtime: ExpeditionRuntime, position: THREE.Vector3) =>
    !!runtime.asteroidField && position.distanceTo(runtime.asteroidField.center) < runtime.asteroidField.radius;
