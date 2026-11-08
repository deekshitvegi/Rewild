import * as THREE from 'three';
import { EXPEDITION_BODIES, findBody, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { BLACK_HOLE, WORMHOLES, findWormhole } from './deepSpace';
import { DATA_SITES, landingZoneDirection, openingHeading } from './sites';
import type { ExpeditionInput } from './input';
import { activeMotion, fromStart, startOf } from './motion';

/**
 * The autopilot (G, or "Auto" on the system map) flies the ship to the
 * course set on the map. It climbs out of the air, turns for the target and
 * goes around any world in the way, engages the pulse drive when it is
 * allowed, and drops out of it on arrival like a pilot would. On a world with
 * ground it comes down over the landing zone, where the monoliths stand, and
 * sets down; at a gas giant it stops by the data stations, and at the Sun,
 * a wormhole or TON 618 it stops at a safe distance. Any steering, throttle
 * or pulse input hands the controls back.
 */
export interface Course {
    id: string;
    name: string;
    /** 'land': come down over a landing zone and set down. 'reach': stop `stop` units short of the goal. */
    kind: 'land' | 'reach';
    /** For 'land', the world; for 'reach', the body the goal belongs to, if any. */
    body: ExpeditionBody | null;
    /** Fixed goal (a landing spot on the ground, or a station); null to stop short of `centre` on the side the ship comes from. */
    point: THREE.Vector3 | null;
    centre: THREE.Vector3;
    /** Distance from the goal (or from `centre`, when there is no fixed point) to stop at. */
    stop: number;
}

/** Resolve a course id (a world, a wormhole mouth or TON 618) to what the autopilot flies to. */
export const courseTo = (id: string): Course | null => {
    const body = findBody(id);
    if (body) {
        if (body.kind === 'rocky') {
            // Where the expedition sets down: beside the landing zone's centre.
            const zone = landingZoneDirection(body);
            const spot = zone.clone().multiplyScalar(body.radius).addScaledVector(openingHeading(body), -26).normalize();
            // Points on a world are held in its frame of the start (motion.ts).
            const point = startOf(body).clone().addScaledVector(spot, body.radius + groundHeight(body, spot));
            return { id, name: body.name, kind: 'land', body, point, centre: body.position, stop: 0 };
        }
        if (body.kind === 'gas') {
            const station = DATA_SITES.find((site) => site.kind === 'station' && site.body === body);
            if (station) return { id, name: body.name, kind: 'reach', body, point: station.position, centre: body.position, stop: 380 };
            // No stations: high over the sunlit side.
            const point = startOf(body).clone().addScaledVector(body.sunDirection, body.radius * 1.7);
            return { id, name: body.name, kind: 'reach', body, point, centre: body.position, stop: body.radius * 0.1 };
        }
        // The Sun: stop well outside the heat.
        return { id, name: body.name, kind: 'reach', body, point: null, centre: body.position, stop: body.radius * 2.2 };
    }
    const mouth = WORMHOLES.find((w) => w.id === id);
    if (mouth) return { id, name: 'Wormhole', kind: 'reach', body: null, point: null, centre: mouth.position, stop: mouth.radius * 14 };
    if (id === BLACK_HOLE.id) return { id, name: BLACK_HOLE.name, kind: 'reach', body: null, point: null, centre: BLACK_HOLE.position, stop: BLACK_HOLE.horizon * 80 };
    return null;
};

/** Further than this from TON 618 is home: the Solar System's side of the wormhole. */
const FAR_SIDE = 2e9;

/** Keys and moves that mean the player is flying the ship themselves. */
const MANUAL_KEYS = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];
export const playerTakesOver = (input: ExpeditionInput) =>
    Math.abs(input.lookX) + Math.abs(input.lookY) > 36
    || Math.abs(input.moveX) > 0.35
    || Math.abs(input.moveY) > 0.35
    || input.pressed.has('Space')
    || input.pressed.has('Boost')
    || MANUAL_KEYS.some((key) => input.keys.has(key));

/** How far around a body to stay when passing it. */
const clearance = (body: ExpeditionBody) => body.kind === 'star'
    ? body.radius * 2
    : body.kind === 'gas'
        ? body.radius * (body.gas?.rings ? body.gas.rings.outer + 0.15 : 1.3)
        : body.radius + (body.biome?.atmosphereHeight ?? 0) * 3 + 1500;
/** Nearer than this a body is dangerous: its ground and air, a giant's clouds, the Sun's heat. */
const hardLimit = (body: ExpeditionBody) => body.kind === 'star'
    ? body.radius * 1.6
    : body.kind === 'gas'
        ? body.radius * 1.06
        : body.radius + (body.biome?.atmosphereHeight ?? 0) * 1.3;

const along = new THREE.Vector3();
const toCentre = new THREE.Vector3();
const side = new THREE.Vector3();
const raised = new THREE.Vector3();
const up = new THREE.Vector3();

/** If the straight line from `from` to `to` passes within `radius` of `centre`, a point to go round it by; otherwise null. */
const detour = (from: THREE.Vector3, to: THREE.Vector3, centre: THREE.Vector3, radius: number, out: THREE.Vector3) => {
    along.copy(to).sub(from);
    const length = along.length();
    if (length < 1) return null;
    along.divideScalar(length);
    toCentre.copy(centre).sub(from);
    const t = toCentre.dot(along);
    if (t < 0 || t > length) return null;
    const miss = Math.sqrt(Math.max(0, toCentre.lengthSq() - t * t));
    if (miss >= radius) return null;
    // Round the side the ship is already on.
    side.copy(from).sub(centre);
    side.addScaledVector(along, -side.dot(along));
    if (side.lengthSq() < 1e-6) side.set(0, 1, 0).cross(along);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(along);
    side.normalize();
    return out.copy(centre).addScaledVector(side, radius * 1.25);
};

export interface AutopilotControl {
    /** The way to point the nose. */
    aim: THREE.Vector3;
    /** The ship's up to keep while turning (level with the ground in air). */
    up: THREE.Vector3;
    /** Speed wanted, units per second, outside the pulse drive. */
    speed: number;
    /** Use the pulse drive when it is allowed and the nose is on target. */
    pulse: boolean;
    /** 'fly', or done: 'land' (set down now), 'arrived' (hand back). */
    state: 'fly' | 'land' | 'arrived';
    /** Distance left to the goal. */
    remaining: number;
    /** What the autopilot is doing, for the log. */
    phase: string;
}

const goal = new THREE.Vector3();
const aim = new THREE.Vector3();
const probe = new THREE.Vector3();
const probeUp = new THREE.Vector3();
const flat = new THREE.Vector3();
const target = new THREE.Vector3();
const way = new THREE.Vector3();
const control: AutopilotControl = { aim: new THREE.Vector3(), up: new THREE.Vector3(), speed: 0, pulse: false, state: 'fly', remaining: 0, phase: '' };

/**
 * One step of the autopilot: where to point and how fast to go, for a ship
 * at `position` whose up is `shipUp`, inside the air of `airBody` (or not),
 * `altitude` above the ground of `altitudeBody`.
 */
export const steer = (course: Course, position: THREE.Vector3, velocity: THREE.Vector3, shipUp: THREE.Vector3, airBody: ExpeditionBody | null, altitude: number, altitudeBody: ExpeditionBody | null): AutopilotControl => {
    control.state = 'fly';
    control.pulse = true;
    control.up.copy(shipUp);

    // The goal: a fixed point, or the stopping point short of the centre on this side.
    // (A fixed point is held on its world as it was at the start: where it is now, motion.ts.)
    const motion = activeMotion();
    if (course.point) {
        goal.copy(course.point);
        if (course.body && motion) fromStart(motion, course.body, goal, goal);
    } else goal.copy(position).sub(course.centre).normalize().multiplyScalar(course.stop).add(course.centre);

    // TON 618 is 590 AU out: the way there, and back, is through the wormhole.
    const atHome = position.distanceTo(BLACK_HOLE.position) > FAR_SIDE;
    const goalAtHome = goal.distanceTo(BLACK_HOLE.position) > FAR_SIDE;
    const mouth = atHome === goalAtHome ? null : WORMHOLES.find((w) => (w.position.distanceTo(BLACK_HOLE.position) > FAR_SIDE) === atHome)!;

    if (mouth) {
        // Straight into the throat: crossing it is seamless, and the course carries on beyond.
        aim.copy(mouth.position).sub(position);
        const toThroat = aim.length();
        control.remaining = toThroat + goal.distanceTo(findWormhole(mouth.to)!.position);
        control.phase = 'Taking the wormhole';
        control.speed = toThroat > 40000 ? 3500 : 900;
        control.pulse = toThroat > 90000;
    } else if (course.kind === 'land' && course.body) {
        const body = course.body;
        up.copy(goal).sub(body.position).normalize();
        // Distance along the ground, near enough, and a glide path down to the spot.
        const fromCentre = position.distanceTo(body.position);
        const height = fromCentre - body.radius;
        way.copy(position).sub(body.position).divideScalar(fromCentre);
        const arc = Math.acos(THREE.MathUtils.clamp(way.dot(up), -1, 1)) * body.radius;
        const lift = THREE.MathUtils.clamp(arc * 0.32, 160, 1e9);
        raised.copy(goal).addScaledVector(up, lift);
        control.remaining = Math.hypot(arc, Math.max(0, height - (goal.distanceTo(body.position) - body.radius)));
        // Low over the world (in its air, or just above an airless one): fly level and slow.
        const near = airBody === body || height < Math.max((body.biome?.atmosphereHeight ?? 0) * 1.6, 2400);
        // On the wrong side of the world: go round, high enough to stay out of the air.
        const round = detour(position, raised, body.position, body.radius + Math.min(height * 0.5, (body.biome?.atmosphereHeight ?? 0) * 2), aim);
        if (round) {
            control.phase = 'Rounding the world';
            aim.sub(position);
        } else {
            aim.copy(raised).sub(position);
            control.phase = near ? 'Descending to the landing zone' : `Approaching ${body.name}`;
        }
        // Speed falls with the distance left, so the ship can always stop in time.
        const toAim = position.distanceTo(raised);
        control.speed = THREE.MathUtils.clamp(toAim * 0.5, 110, near ? 560 : 3500);
        // A dive is flattened so the ship comes down no faster than its height
        // allows (a pilot's sink rate); straight overhead, it slows instead.
        const above = altitudeBody === body ? altitude : height;
        aim.normalize();
        const sink = -aim.dot(way) * control.speed;
        // A quarter of the height a second: with the ship's response that comes
        // down without overshooting (the old 0.4 swung through the ground).
        const allowed = THREE.MathUtils.clamp(above * 0.25, 10, 3000);
        const sinking = -velocity.dot(way);
        const close = above < 20000;
        if (!close) {
            // Far out the pulse drive and its own arrival rule set the pace.
        } else if (sinking > allowed * 1.25) {
            // Coming down too fast already: level out and brake.
            flat.copy(aim).addScaledVector(way, -aim.dot(way));
            if (flat.lengthSq() < 1e-4) flat.copy(velocity).addScaledVector(way, -velocity.dot(way));
            if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0).addScaledVector(way, -way.x);
            aim.copy(flat.normalize()).addScaledVector(way, 0.35).normalize();
            control.speed = Math.min(control.speed, allowed);
            control.phase = 'Braking';
        } else if (sink > allowed) {
            const vertical = aim.dot(way);
            flat.copy(aim).addScaledVector(way, -vertical);
            const level = flat.length();
            if (level > 0.05) {
                const down = -allowed / control.speed;
                aim.copy(flat).multiplyScalar(Math.sqrt(1 - down * down) / level).addScaledVector(way, down);
            } else {
                control.speed = Math.max(allowed, 12);
            }
        }
        if (near) {
            // Level with the ground, slowing down for the landing, and never
            // closer to it than the way down allows: the ground a couple of
            // seconds ahead is checked, and a rim or ridge there is climbed over.
            control.up.copy(way);
            control.pulse = false;
            const reach = THREE.MathUtils.clamp(control.speed * 2.5, 60, 1500);
            probe.copy(aim).normalize().multiplyScalar(reach).add(position);
            const probeDistance = probe.distanceTo(body.position);
            probeUp.copy(probe).sub(body.position).divideScalar(probeDistance);
            const probeHeight = probeDistance - body.radius - groundHeight(body, probeUp);
            const clearance = arc > 250 ? 90 : 25;
            const short = Math.max(clearance - probeHeight, clearance - altitude);
            if (short > 0) aim.normalize().addScaledVector(way, Math.min(2, short / clearance));
            if (arc < 70 && altitude < 320) {
                control.state = 'land';
                control.phase = 'Landing';
            }
        } else {
            control.pulse = toAim > 60000;
        }
    } else {
        aim.copy(goal).sub(position);
        control.remaining = Math.max(0, aim.length() - (course.point ? course.stop : 0));
        control.phase = `Flying to ${course.name}`;
        control.speed = THREE.MathUtils.clamp(control.remaining * 0.5, 80, 3500);
        control.pulse = control.remaining > 60000;
        // Already as close as the course asks (out of the far mouth by TON 618, say): arrived.
        const within = !course.point && position.distanceTo(course.centre) <= course.stop + 40;
        if (within || control.remaining < 40 || (course.point && position.distanceTo(goal) < course.stop)) control.state = 'arrived';
    }

    // Climb out of a world's air before turning for somewhere else.
    if (airBody && course.body !== airBody && airBody.kind === 'rocky') {
        way.copy(position).sub(airBody.position).normalize();
        aim.normalize().add(way.multiplyScalar(1.6));
        control.phase = `Climbing out of ${airBody.name}'s air`;
        control.pulse = false;
        control.speed = 560;
    } else {
        // Go round anything else in the way (the target's own world is handled above).
        // Already close to one, go round it at about the height the ship is at.
        let nearest = Infinity;
        target.copy(position).add(aim);
        for (const other of EXPEDITION_BODIES) {
            if (other === course.body && course.kind === 'land') continue;
            if (other === course.body && !course.point) continue;
            const distance = position.distanceTo(other.position);
            const reach = Math.min(clearance(other), Math.max(distance * 0.97, hardLimit(other)));
            if (!detour(position, target, other.position, reach, way)) continue;
            if (distance < nearest) {
                nearest = distance;
                aim.copy(way).sub(position);
                control.phase = `Going round ${other.name}`;
            }
        }
    }
    control.aim.copy(aim).normalize();
    return control;
};
