import * as THREE from 'three';
import { EXPEDITION_BODIES, createGroundFunction, createHeightFunction, createWaterLevelFunction, type ExpeditionBody } from './bodies';
import { earthMapSettled, earthSpot, usesEarthMap, type EarthSpot } from './earth';
import { marsMapSettled } from './mars';
import type { ExpeditionRuntime } from './runtime';
import { gasModel } from './gasAtmosphere';
import { sunCover } from './eclipse';
import { setSunlight } from './surfaceShading';

/**
 * Works out where the player is: which world they are near, how high above
 * its ground, how deep in its air, and whether it is day there.
 */
const heightFunctions = new Map<string, (x: number, y: number, z: number) => number>();
export const groundHeight = (body: ExpeditionBody, up: THREE.Vector3) => {
    if (body.kind !== 'rocky') return 0;
    let fn = heightFunctions.get(body.id);
    if (!fn) {
        fn = createHeightFunction(body);
        // Earth's and Mars's ground is not kept until its map has arrived (or failed).
        if (body.globe?.water ? earthMapSettled() : body.id !== 'skills' || marsMapSettled()) heightFunctions.set(body.id, fn);
    }
    return fn(up.x, up.y, up.z);
};

const spot: EarthSpot = { water: 0, shore: 0, cover: 0, valley: 0 };
const dry: EarthSpot = { water: 0, shore: 1e4, cover: 0, valley: 0 };
const groundFunctions = new Map<string, (x: number, y: number, z: number) => number>();
const waterFunctions = new Map<string, (x: number, y: number, z: number) => number>();
/**
 * What is at a spot besides its height: how deep water (or another liquid)
 * stands over it, how far the shore is, how wooded it is. Earth has its seas
 * and rivers, Titan its lakes of methane; elsewhere the answer is always dry.
 * The object returned is reused: read it at once.
 */
export const groundSpot = (body: ExpeditionBody, up: THREE.Vector3): EarthSpot => {
    if (body.kind !== 'rocky') return dry;
    if (usesEarthMap(body)) {
        earthSpot(body, up, spot);
        return spot;
    }
    const liquid = body.biome?.liquid;
    if (!liquid) return dry;
    let fn = groundFunctions.get(body.id);
    let water = waterFunctions.get(body.id);
    if (!fn || !water) {
        fn = createGroundFunction(body);
        water = createWaterLevelFunction(body);
        groundFunctions.set(body.id, fn);
        waterFunctions.set(body.id, water);
    }
    // As terrainSurface() has it: the depth under the surface, and the
    // distance from the shore as a shore shelving 1 in 12 would put it.
    const ground = fn(up.x, up.y, up.z);
    const level = water(up.x, up.y, up.z);
    spot.water = Math.max(level - ground, 0);
    spot.shore = (ground - level) * 12;
    spot.cover = 0;
    spot.valley = 0;
    return spot;
};

/** Depth of water at a spot (0 on dry ground). */
export const waterDepth = (body: ExpeditionBody, up: THREE.Vector3) => groundSpot(body, up).water;

/** Distance within which a world's gravity and air take over. */
export const influenceRadius = (body: ExpeditionBody) => body.kind === 'star'
    ? body.radius * 1.6
    : body.kind === 'gas'
        ? body.radius * 1.5
        : body.radius + (body.biome?.atmosphereHeight ?? 0) * 5 + 4000;

const up = new THREE.Vector3();

let reanchoring = false;
export const updateEnvironment = (runtime: ExpeditionRuntime, position: THREE.Vector3) => {
    const before = runtime.currentBody;
    measureEnvironment(runtime, position);
    // Into another world's reach: the game's frame follows it now, before
    // anything is worked out on that world in the old one (motion.ts).
    if (runtime.currentBody !== before && runtime.reanchor && !reanchoring) {
        reanchoring = true;
        try {
            if (runtime.reanchor()) measureEnvironment(runtime, position);
        } finally {
            reanchoring = false;
        }
    }
};

const measureEnvironment = (runtime: ExpeditionRuntime, position: THREE.Vector3) => {
    let nearest: ExpeditionBody | null = null;
    let nearestGap = Infinity;
    for (const body of EXPEDITION_BODIES) {
        const distance = position.distanceTo(body.position);
        const gap = distance - body.radius;
        if (distance < influenceRadius(body) && gap < nearestGap) {
            nearest = body;
            nearestGap = gap;
        }
    }
    runtime.currentBody = nearest;
    if (nearest && nearest.kind === 'rocky' && nearest.biome) {
        const distance = position.distanceTo(nearest.position);
        up.copy(position).sub(nearest.position).divideScalar(distance);
        const ground = groundHeight(nearest, up);
        runtime.altitude = distance - nearest.radius - ground;
        const airHeight = distance - nearest.radius;
        runtime.atmosphere = THREE.MathUtils.clamp(1 - airHeight / nearest.biome.atmosphereHeight, 0, 1)
            * Math.min(1, nearest.biome.haze);
        runtime.daylight = THREE.MathUtils.smoothstep(up.dot(nearest.sunDirection), -0.2, 0.25);
        runtime.nearGround = THREE.MathUtils.clamp(1 - runtime.altitude / (nearest.radius * 0.5), 0, 1);
        runtime.nightEyes = (1 - runtime.daylight) * runtime.nearGround;
    } else if (nearest && nearest.kind === 'gas') {
        // A gas giant has no ground: the height is from its 1 bar level (the
        // cloud tops seen from space), and below it the air only thickens.
        const distance = position.distanceTo(nearest.position);
        up.copy(position).sub(nearest.position).divideScalar(distance);
        runtime.altitude = distance - nearest.radius;
        runtime.atmosphere = THREE.MathUtils.clamp(1 - runtime.altitude / gasModel(nearest).ceiling, 0, 1);
        runtime.daylight = THREE.MathUtils.smoothstep(up.dot(nearest.sunDirection), -0.2, 0.25);
        runtime.nightEyes = 0;
        runtime.nearGround = 0;
    } else {
        runtime.altitude = nearest ? position.distanceTo(nearest.position) - nearest.radius : Infinity;
        runtime.atmosphere = 0;
        runtime.daylight = 1;
        runtime.nightEyes = 0;
        runtime.nearGround = 0;
    }
    // An eclipse: another world across the Sun takes its share of the light, the sky's glow with
    // it (the shared sunlight of the world underfoot), and the eyes adapt as they do at dusk.
    sunCover(runtime.camera, nearest, runtime.eclipse);
    runtime.sunlight = 1 - runtime.eclipse.coverage;
    if (runtime.sunlight < 1) {
        runtime.daylight *= runtime.sunlight;
        if (runtime.nearGround > 0) runtime.nightEyes = (1 - runtime.daylight) * runtime.nearGround;
    }
    setSunlight(nearest, runtime.sunlight);
};

/**
 * The most level dry ground within `search` metres of `ideal` (a unit
 * direction): the spot whose surroundings out to `ring` metres vary least in
 * height, a little in favour of the spot asked for. Places that people walk
 * to (an alien site, a vault and its runes) are put there, not on a ridge.
 */
export const levelGround = (body: ExpeditionBody, ideal: THREE.Vector3, search: number, ring: number) => {
    const radius = body.radius;
    const tangent = new THREE.Vector3(0, 1, 0).cross(ideal);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0).cross(ideal);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(ideal, tangent);
    const at = (from: THREE.Vector3, da: number, db: number) =>
        from.clone().multiplyScalar(radius).addScaledVector(tangent, da).addScaledVector(bitangent, db).normalize();
    let best = ideal.clone();
    let bestScore = Infinity;
    const rings = 6;
    for (let r = 0; r <= rings; r++) {
        const reach = (r / rings) * search;
        const count = r === 0 ? 1 : 6 + r * 4;
        for (let k = 0; k < count; k++) {
            const angle = (k / count) * Math.PI * 2 + r * 0.41;
            const spot = at(ideal, Math.cos(angle) * reach, Math.sin(angle) * reach);
            if (waterDepth(body, spot) > 0) continue;
            const floor = groundHeight(body, spot);
            let low = floor;
            let high = floor;
            let wet = false;
            for (const m of [ring * 0.5, ring]) {
                for (let j = 0; j < 8; j++) {
                    const a = (j / 8) * Math.PI * 2 + m;
                    const probe = at(spot, Math.cos(a) * m, Math.sin(a) * m);
                    const h = groundHeight(body, probe);
                    low = Math.min(low, h);
                    high = Math.max(high, h);
                    if (waterDepth(body, probe) > 0) wet = true;
                }
            }
            const score = (high - low) / ring + (wet ? 1 : 0) + 0.15 * (reach / Math.max(search, 1));
            if (score < bestScore) {
                bestScore = score;
                best = spot;
            }
        }
    }
    return best;
};

/**
 * How much of the sky beyond shows from where the camera is: 1, except under
 * a deck of cloud that never breaks (Venus), where neither the Sun nor the
 * stars are ever seen (0 below its base, easing in through it).
 */
export const skyBeyond = (runtime: { currentBody: ExpeditionBody | null; camera: THREE.Vector3 }) => {
    const body = runtime.currentBody;
    const deck = body?.biome?.deck;
    if (!body || !deck) return 1;
    const height = runtime.camera.distanceTo(body.position) - body.radius;
    return THREE.MathUtils.smoothstep(height, deck.base, deck.top + 120);
};
