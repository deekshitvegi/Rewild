import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BiomeKind, ExpeditionBody } from './bodies';
import { loadModel } from './models';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';

/**
 * The sculpted animals (public/models/expedition) and how they move.
 *
 * The models are single still meshes. They are brought to life in the vertex
 * shader, so a whole herd is still one draw call per species: each leg swings
 * about its hip and folds at the knee while it is in the air, the head drops
 * to graze and turns to look about, the tail sways. Which vertex belongs to
 * which leg is measured from the mesh when it loads (`rigCreature`), with
 * weights that fade smoothly into the body, so nothing ever tears.
 *
 * Model units: feet at y = 0, one body length from nose to tail along z, the
 * head towards +z.
 */

export type CreatureModel = 'grazer' | 'strider' | 'sabretooth' | 'crawler' | 'stilt' | 'hunter';

interface Region {
    /** z where the weight starts (0) and where it is full (1). */
    z: [number, number];
    /** The same in height. */
    y: [number, number];
}

export interface CreatureConfig {
    /** The file's animal faces -z: turn it round. */
    flip: boolean;
    /** Body lengths in metres, smallest and largest. */
    length: [number, number];
    kinds: string[];
    temperaments: string[];
    neck: Region & { pivot: [number, number]; graze: number; look: number };
    tail: Region & { pivot: [number, number]; sway: number };
    /** Knee fold while a foot is in the air, per radian of stride. */
    knee: number;
    /**
     * How many legs, found where they cross this height (body lengths) rather
     * than from the feet: for the aliens, whose sculpted stances lift a foot
     * and whose leg counts are their own (three, five).
     */
    legs?: { count: number; slice: number };
}

export const CREATURES: Record<CreatureModel, CreatureConfig> = {
    grazer: {
        flip: true,
        length: [1.7, 2.3],
        kinds: ['Grazer', 'Browser', 'Runner', 'Leaper'],
        temperaments: ['Docile', 'Skittish', 'Timid', 'Calm', 'Curious', 'Nervous'],
        neck: { pivot: [0.54, 0.26], z: [0.16, 0.27], y: [0.5, 0.66], graze: 1.25, look: 0.45 },
        tail: { pivot: [0.6, -0.42], z: [-0.4, -0.46], y: [0.4, 0.5], sway: 0.35 },
        knee: 1.4,
    },
    strider: {
        flip: false,
        length: [2.4, 3.8],
        kinds: ['Strider', 'Loper', 'Plodder', 'Crest'],
        temperaments: ['Docile', 'Skittish', 'Calm', 'Curious', 'Wary', 'Placid'],
        neck: { pivot: [0.36, 0.24], z: [0.17, 0.28], y: [0.27, 0.36], graze: 0.85, look: 0.4 },
        tail: { pivot: [0.36, -0.2], z: [-0.17, -0.3], y: [0.24, 0.29], sway: 0.22 },
        knee: 1.1,
    },
    sabretooth: {
        flip: false,
        length: [1.9, 2.6],
        kinds: ['Prowler', 'Stalker', 'Sabre', 'Snowcat'],
        temperaments: ['Wary', 'Solitary', 'Watchful', 'Calm', 'Curious', 'Territorial'],
        neck: { pivot: [0.42, 0.28], z: [0.25, 0.34], y: [0.22, 0.3], graze: 0.55, look: 0.5 },
        tail: { pivot: [0.45, -0.41], z: [-0.39, -0.45], y: [0.14, 0.22], sway: 0.3 },
        knee: 1.2,
    },
    // The aliens (aliens.ts): five-legged ice crawlers of Europa's vents,
    // three-legged stilt grazers of Mars, five-legged frost hunters of Triton.
    crawler: {
        flip: true,
        length: [1.4, 2.0],
        kinds: ['Ice crawler'],
        temperaments: ['Skittish'],
        neck: { pivot: [0.36, 0.3], z: [0.3, 0.38], y: [0.26, 0.32], graze: 0.18, look: 0.18 },
        tail: { pivot: [0.4, -0.2], z: [-0.2, -0.3], y: [0.3, 0.36], sway: 0.28 },
        knee: 1.0,
        legs: { count: 5, slice: 0.2 },
    },
    stilt: {
        flip: true,
        length: [2.6, 3.4],
        kinds: ['Stilt grazer'],
        temperaments: ['Calm'],
        neck: { pivot: [0.82, 0.12], z: [0.12, 0.22], y: [0.76, 0.86], graze: 1.15, look: 0.35 },
        tail: { pivot: [0.7, -0.3], z: [-0.3, -0.38], y: [0.6, 0.66], sway: 0.12 },
        knee: 0.8,
        legs: { count: 3, slice: 0.3 },
    },
    hunter: {
        flip: true,
        length: [2.4, 3.0],
        kinds: ['Frost hunter'],
        temperaments: ['Territorial'],
        neck: { pivot: [0.32, 0.3], z: [0.3, 0.38], y: [0.18, 0.25], graze: 0.35, look: 0.45 },
        tail: { pivot: [0.3, -0.3], z: [-0.3, -0.38], y: [0.24, 0.3], sway: 0.35 },
        knee: 1.1,
        legs: { count: 5, slice: 0.11 },
    },
};

/**
 * Which animals live on each kind of world, one entry per species (the
 * palettes in Wildlife.tsx). `recolor` pulls the model's own markings towards
 * the species' coat colour; 0 keeps them as sculpted.
 */
export const HABITATS: Record<Exclude<BiomeKind, 'cratered'>, { model: CreatureModel; recolor: number }[]> = {
    verdant: [{ model: 'grazer', recolor: 0 }, { model: 'strider', recolor: 0.2 }, { model: 'grazer', recolor: 0.35 }, { model: 'sabretooth', recolor: 0.2 }],
    desert: [{ model: 'strider', recolor: 0 }, { model: 'grazer', recolor: 0.25 }, { model: 'strider', recolor: 0.35 }],
    canyon: [{ model: 'grazer', recolor: 0.15 }, { model: 'strider', recolor: 0.3 }, { model: 'sabretooth', recolor: 0.3 }],
    frozen: [{ model: 'sabretooth', recolor: 0 }, { model: 'grazer', recolor: 0.45 }],
    glacier: [{ model: 'sabretooth', recolor: 0.25 }, { model: 'grazer', recolor: 0.4 }],
    // Venus at 465 C: aliens built for the heat (fiction), long-legged over the hot plains.
    volcanic: [{ model: 'strider', recolor: 0 }, { model: 'grazer', recolor: 0.25 }, { model: 'strider', recolor: 0.35 }],
    // Titan keeps its life for the radio to find (the floaters in the haze).
    methane: [],
};

/**
 * Per leg, up to eight in two groups of four (the four of the sculpted animals
 * are LF, RF, LB, RB): hip and knee pivots (height, z), the hip angle that
 * squares the leg up under the body from the sculpted pose, and where in the
 * stride the leg is.
 */
export interface CreatureRig {
    hipY: [THREE.Vector4, THREE.Vector4];
    hipZ: [THREE.Vector4, THREE.Vector4];
    kneeY: [THREE.Vector4, THREE.Vector4];
    kneeZ: [THREE.Vector4, THREE.Vector4];
    rest: [THREE.Vector4, THREE.Vector4];
    phase: [THREE.Vector4, THREE.Vector4];
    /** Mean hip height: the length of a leg, for the stride. */
    leg: number;
    count: number;
}

const MAX_LEGS = 8;

export interface FittedCreature {
    geometry: THREE.BufferGeometry;
    map: THREE.Texture | null;
    rig: CreatureRig | null;
    config: CreatureConfig;
    /** Height of the model in body lengths. */
    height: number;
}

const ramp = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** Groups points (x, z) into clusters whose members are within `link` of one another. */
const clusters = (points: number[], xz: (i: number) => [number, number], link: number) => {
    const parent = points.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const coords = points.map(xz);
    // Sort by x so only near neighbours need comparing.
    const order = points.map((_, i) => i).sort((a, b) => coords[a][0] - coords[b][0]);
    for (let a = 0; a < order.length; a++) {
        const i = order[a];
        for (let b = a + 1; b < order.length; b++) {
            const j = order[b];
            if (coords[j][0] - coords[i][0] > link) break;
            const dz = coords[j][1] - coords[i][1];
            if (Math.abs(dz) <= link) parent[find(i)] = find(j);
        }
    }
    const groups = new Map<number, number[]>();
    points.forEach((_, i) => {
        const root = find(i);
        const group = groups.get(root);
        if (group) group.push(i);
        else groups.set(root, [i]);
    });
    return [...groups.values()].map((members) => {
        let x = 0;
        let z = 0;
        members.forEach((m) => { x += coords[m][0]; z += coords[m][1]; });
        x /= members.length;
        z /= members.length;
        let extent = 0;
        members.forEach((m) => { extent = Math.max(extent, Math.hypot(coords[m][0] - x, coords[m][1] - z)); });
        return { members: members.map((m) => points[m]), x, z, extent };
    });
};

interface LegTrack {
    axis: { y: number; x: number; z: number }[];
    top: number;
    radius: number;
    foot: { x: number; z: number };
    /** Height of the bottom of its foot: above the ground where the sculpt lifts it. */
    bottom: number;
    /** Tracking up the leg starts above this height (where it was found, for the aliens). */
    start: number;
    active: boolean;
    claimed: number;
}

/**
 * Legs found where they cross a height under the body (the `count` largest
 * sections there), each followed down to the bottom of its foot: works when
 * the sculpted stance lifts a foot off the ground.
 */
export const legsFromSection = (position: Float32Array, count: number, wanted: number, slice: number) => {
    const X = (i: number) => position[i * 3];
    const Y = (i: number) => position[i * 3 + 1];
    const Z = (i: number) => position[i * 3 + 2];
    const xz = (i: number): [number, number] => [X(i), Z(i)];
    const band = (y: number) => {
        const list: number[] = [];
        for (let i = 0; i < count; i++) if (Math.abs(Y(i) - y) < 0.012) list.push(i);
        return clusters(list, xz, 0.025);
    };
    const sections = band(slice).sort((a, b) => b.members.length - a.members.length).slice(0, wanted);
    if (sections.length < wanted) return null;
    return sections.map((section) => {
        // The leg's line from the section down to the bottom of its foot.
        const path = [{ x: section.x, z: section.z, y: slice, extent: section.extent }];
        for (let y = slice - 0.02; y > -0.01; y -= 0.02) {
            const at = path[path.length - 1];
            let best: { x: number; z: number; extent: number } | null = null;
            let bestDistance = 0.08;
            for (const c of band(y)) {
                const d = Math.hypot(c.x - at.x, c.z - at.z);
                if (d < bestDistance) { bestDistance = d; best = c; }
            }
            if (!best) break;
            path.push({ x: best.x, z: best.z, y, extent: best.extent });
        }
        const foot = path[path.length - 1];
        return { x: foot.x, z: foot.z, bottom: Math.max(0, foot.y - 0.012), extent: foot.extent, path: path.reverse() };
    });
};

/**
 * Finds the four legs and weights every vertex to them: follow each foot up
 * the mesh slice by slice until its leg joins the body (or another leg), then
 * let its influence fade out over the thigh up to the hip.
 */
export const rigLegs = (position: Float32Array, count: number, config: CreatureConfig) => {
    const X = (i: number) => position[i * 3];
    const Y = (i: number) => position[i * 3 + 1];
    const Z = (i: number) => position[i * 3 + 2];
    const xz = (i: number): [number, number] => [X(i), Z(i)];

    let legs: LegTrack[];
    // Where in the stride each leg is (radians).
    let phases: number[];
    if (config.legs) {
        const found = legsFromSection(position, count, Math.min(config.legs.count, MAX_LEGS), config.legs.slice);
        if (!found) return null;
        // Front to back.
        found.sort((a, b) => b.z - a.z);
        // Each leg's line is known from its foot up to the section; tracking
        // carries on up from there.
        legs = found.map((foot) => ({
            axis: foot.path.map((at) => ({ y: at.y, x: at.x, z: at.z })),
            top: 0,
            radius: foot.path.reduce((sum, at) => sum + at.extent, 0) / foot.path.length,
            foot: { x: foot.x, z: foot.z },
            bottom: foot.bottom,
            start: config.legs.slice,
            active: true,
            claimed: -1,
        }));
        if (legs.length === 3) {
            // Three legs: each in turn, a third of a stride apart.
            phases = legs.map((_, k) => (k * 2 * Math.PI) / 3);
        } else {
            // Down each side front to back, every other leg together, the two
            // sides out of step: a trot for four legs, alternating tripods for six.
            const rank = { left: 0, right: 0 };
            phases = legs.map((leg) => {
                const side = leg.foot.x < 0 ? 'left' : 'right';
                const k = rank[side]++;
                return Math.PI * ((k + (side === 'right' ? 1 : 0)) % 2);
            });
        }
    } else {
        const feetPoints: number[] = [];
        for (let i = 0; i < count; i++) if (Y(i) < 0.03) feetPoints.push(i);
        const feet = clusters(feetPoints, xz, 0.03).sort((a, b) => b.members.length - a.members.length).slice(0, 4);
        if (feet.length < 4 || feet[3].members.length < 8) return null;
        // Front pair (largest z) then back pair, each left (smaller x) then right.
        feet.sort((a, b) => b.z - a.z);
        const front = feet.slice(0, 2).sort((a, b) => a.x - b.x);
        const back = feet.slice(2).sort((a, b) => a.x - b.x);
        legs = [...front, ...back].map((foot) => ({
            axis: [{ y: 0.015, x: foot.x, z: foot.z }],
            top: 0,
            radius: foot.extent,
            foot: { x: foot.x, z: foot.z },
            bottom: 0,
            start: 0,
            active: true,
            claimed: -1,
        }));
        // A trot: left fore with right hind, right fore with left hind.
        phases = [0, Math.PI, Math.PI, 0];
    }
    const widths: number[][] = legs.map(() => []);

    const STEP = 0.02;
    const byHeight = Array.from({ length: count }, (_, i) => i).sort((a, b) => Y(a) - Y(b));
    let cursor = 0;
    for (let y = STEP; y < 1 && legs.some((leg) => leg.active); y += STEP) {
        const slice: number[] = [];
        while (cursor < byHeight.length && Y(byHeight[cursor]) < y) cursor++;
        for (let c = cursor; c < byHeight.length && Y(byHeight[c]) < y + STEP; c++) slice.push(byHeight[c]);
        const found = clusters(slice, xz, 0.025);
        legs.forEach((leg) => { leg.claimed = -1; });
        legs.forEach((leg) => {
            // Below where its tracking starts (a lifted foot, or a leg already traced up to its section).
            if (!leg.active || y < leg.start + STEP) return;
            const last = leg.axis[leg.axis.length - 1];
            let best = -1;
            let bestDistance = 0.08;
            found.forEach((cluster, index) => {
                const d = Math.hypot(cluster.x - last.x, cluster.z - last.z);
                if (d < bestDistance) { bestDistance = d; best = index; }
            });
            leg.claimed = best;
        });
        // Counted before any leg stops, so both of two legs that meet stop together.
        const claims = new Map<number, number>();
        legs.forEach((leg) => { if (leg.active && leg.claimed >= 0) claims.set(leg.claimed, (claims.get(leg.claimed) ?? 0) + 1); });
        legs.forEach((leg, k) => {
            if (!leg.active || y < leg.start + STEP) return;
            const index = leg.claimed;
            // Lost, joined another leg, or swollen into the body: the leg ends here.
            const shared = index >= 0 && (claims.get(index) ?? 0) > 1;
            if (index < 0 || shared || found[index].extent > Math.max(0.09, leg.radius * 2.6)) {
                leg.active = false;
                leg.top = y;
                return;
            }
            const cluster = found[index];
            leg.axis.push({ y: y + STEP / 2, x: cluster.x, z: cluster.z });
            widths[k].push(cluster.extent);
        });
    }
    legs.forEach((leg, k) => {
        if (leg.active) leg.top = leg.axis[leg.axis.length - 1].y;
        const sorted = widths[k].slice().sort((a, b) => a - b);
        leg.radius = sorted.length ? sorted[Math.floor(sorted.length / 2)] * 1.3 : leg.radius;
    });
    if (legs.some((leg) => leg.top < leg.bottom + 0.06)) return null;

    const axisAt = (leg: LegTrack, y: number) => {
        const axis = leg.axis;
        if (y <= axis[0].y) return axis[0];
        for (let a = 1; a < axis.length; a++) {
            if (y <= axis[a].y) {
                const t = (y - axis[a - 1].y) / (axis[a].y - axis[a - 1].y);
                return { y, x: axis[a - 1].x + (axis[a].x - axis[a - 1].x) * t, z: axis[a - 1].z + (axis[a].z - axis[a - 1].z) * t };
            }
        }
        return axis[axis.length - 1];
    };

    // The hip sits halfway between where the leg meets the body and the back.
    const hips = legs.map((leg) => {
        const at = axisAt(leg, leg.top);
        let back = leg.top;
        for (let i = 0; i < count; i++) {
            if (Math.hypot(X(i) - at.x, Z(i) - at.z) < 0.08) back = Math.max(back, Y(i));
        }
        return { y: leg.top + (back - leg.top) * 0.5, z: at.z };
    });

    // How far each leg's influence reaches sideways before it meets a neighbour's.
    const falls = legs.map((leg, k) => {
        const at = axisAt(leg, leg.top);
        let gap = Infinity;
        legs.forEach((other, j) => {
            if (j === k) return;
            const o = axisAt(other, other.top);
            gap = Math.min(gap, Math.hypot(o.x - at.x, o.z - at.z));
        });
        return Math.max(0.015, Math.min(0.05, gap / 2 - leg.radius));
    });

    const weights = new Float32Array(count * MAX_LEGS);
    for (let i = 0; i < count; i++) {
        const y = Y(i);
        let sum = 0;
        for (let k = 0; k < legs.length; k++) {
            const leg = legs[k];
            const at = axisAt(leg, Math.min(y, leg.top));
            const d = Math.hypot(X(i) - at.x, Z(i) - at.z);
            const across = 1 - ramp(leg.radius, leg.radius + falls[k], d);
            const along = y <= leg.top ? 1 : 1 - ramp(leg.top, hips[k].y, y);
            const w = across * along;
            weights[i * MAX_LEGS + k] = w;
            sum += w;
        }
        if (sum > 1) for (let k = 0; k < legs.length; k++) weights[i * MAX_LEGS + k] /= sum;
    }

    // (A Vector4 starts at w = 1: every unset leg would be turned by a radian.)
    const pair = () => [new THREE.Vector4(0, 0, 0, 0), new THREE.Vector4(0, 0, 0, 0)] as [THREE.Vector4, THREE.Vector4];
    const set = (v: [THREE.Vector4, THREE.Vector4], k: number, value: number) => v[k >> 2].setComponent(k & 3, value);
    const rest = pair();
    const kneeY = pair();
    const kneeZ = pair();
    const hipY = pair();
    const hipZ = pair();
    const phase = pair();
    // Square the sculpted stride up: move each foot to its pair's mean (the
    // sculpted animals; the aliens keep their own stance).
    if (!config.legs) {
        [[0, 1], [2, 3]].forEach(([a, b]) => {
            const mean = (legs[a].foot.z + legs[b].foot.z) / 2;
            [a, b].forEach((k) => set(rest, k, Math.atan2(legs[k].foot.z - mean, hips[k].y)));
        });
    }
    legs.forEach((leg, k) => {
        const knee = leg.bottom + (hips[k].y - leg.bottom) * 0.42;
        set(kneeY, k, knee);
        set(kneeZ, k, axisAt(leg, Math.min(knee, leg.top)).z);
        set(hipY, k, hips[k].y);
        set(hipZ, k, hips[k].z);
        set(phase, k, phases[k]);
    });
    return {
        weights,
        rig: {
            hipY,
            hipZ,
            kneeY,
            kneeZ,
            rest,
            phase,
            leg: hips.reduce((sum, hip, k) => sum + hip.y - legs[k].bottom, 0) / legs.length,
            count: legs.length,
        } satisfies CreatureRig,
    };
};

/**
 * The model's mesh as a plain geometry in model units, with the rig's
 * weights as attributes: `aLegs` (one weight per leg) and `aParts` (head,
 * tail).
 */
export const rigCreature = (gltf: GLTF, config: CreatureConfig): FittedCreature | null => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
    });
    if (!mesh) return null;
    const source = (mesh as THREE.Mesh).geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
        const attribute = source.getAttribute(name);
        if (!attribute) continue;
        const values = new Float32Array(attribute.count * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++) {
            for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4((mesh as THREE.Mesh).matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const length = Math.max(box.max.z - box.min.z, 1e-6);
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    geometry.scale(1 / length, 1 / length, 1 / length);
    if (config.flip) geometry.rotateY(Math.PI);
    const height = (box.max.y - box.min.y) / length;

    const position = geometry.getAttribute('position').array as Float32Array;
    const count = position.length / 3;
    const legs = rigLegs(position, count, config);
    const legWeights = (group: number) => {
        const out = new Float32Array(count * 4);
        if (legs) for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = legs.weights[i * MAX_LEGS + group * 4 + c];
        return new THREE.BufferAttribute(out, 4);
    };
    geometry.setAttribute('aLegs', legWeights(0));
    geometry.setAttribute('aLegsB', legWeights(1));
    const parts = new Float32Array(count * 2);
    const { neck, tail } = config;
    for (let i = 0; i < count; i++) {
        const y = position[i * 3 + 1];
        const z = position[i * 3 + 2];
        parts[i * 2] = ramp(neck.z[0], neck.z[1], z) * ramp(neck.y[0], neck.y[1], y);
        parts[i * 2 + 1] = ramp(tail.z[0], tail.z[1], z) * ramp(tail.y[0], tail.y[1], y);
    }
    geometry.setAttribute('aParts', new THREE.BufferAttribute(parts, 2));
    geometry.computeBoundingSphere();
    const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    return { geometry, map: material.map ?? null, rig: legs ? legs.rig : null, config, height };
};

const fitted = new Map<CreatureModel, Promise<FittedCreature | null>>();

/** A creature model, loaded and rigged once per visit. */
export const loadCreature = (name: CreatureModel) => {
    let pending = fitted.get(name);
    if (!pending) {
        pending = loadModel(name).then((gltf) => rigCreature(gltf, CREATURES[name]));
        pending.catch(() => undefined);
        fitted.set(name, pending);
    }
    return pending;
};

/**
 * Per-animal pose, written every frame: `aAnim` = (stride phase, stride
 * amplitude in radians, head pitch, head yaw), `aTail` = tail yaw.
 */
export const creatureInstanceGeometry = (base: FittedCreature, capacity: number) => {
    // A copy, not shared attributes: disposing one species' geometry must not
    // pull the buffers out from under another species drawn with the same model.
    const geometry = base.geometry.clone();
    geometry.setAttribute('aAnim', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aTail', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    return geometry;
};

export const createCreatureMaterial = (body: ExpeditionBody, creature: FittedCreature, coat: THREE.Color, recolor: number) => {
    const rig = creature.rig;
    return new THREE.ShaderMaterial({
        defines: { ...(creature.map ? { USE_CREATURE_MAP: '' } : {}), ...(rig ? { USE_CREATURE_RIG: '' } : {}) },
        uniforms: {
            ...createSurfaceUniforms(body),
            uOrigin: { value: new THREE.Vector3() },
            uMap: { value: creature.map },
            uCoat: { value: coat.clone() },
            uRecolor: { value: recolor },
            uHipY: { value: rig?.hipY[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uHipZ: { value: rig?.hipZ[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uKneeY: { value: rig?.kneeY[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uKneeZ: { value: rig?.kneeZ[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uRest: { value: rig?.rest[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uPhase: { value: rig?.phase[0] ?? new THREE.Vector4(0, 0, 0, 0) },
            uHipYB: { value: rig?.hipY[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uHipZB: { value: rig?.hipZ[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uKneeYB: { value: rig?.kneeY[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uKneeZB: { value: rig?.kneeZ[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uRestB: { value: rig?.rest[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uPhaseB: { value: rig?.phase[1] ?? new THREE.Vector4(0, 0, 0, 0) },
            uKneeFold: { value: creature.config.knee },
            uNeck: { value: new THREE.Vector2(...creature.config.neck.pivot) },
            uTailPivot: { value: new THREE.Vector2(...creature.config.tail.pivot) },
        },
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            attribute vec4 aLegs;
            attribute vec4 aLegsB;
            attribute vec2 aParts;
            attribute vec4 aAnim;
            attribute float aTail;
            uniform vec3 uOrigin; // floating origin, relative to the planet centre
            uniform vec4 uHipY;
            uniform vec4 uHipZ;
            uniform vec4 uKneeY;
            uniform vec4 uKneeZ;
            uniform vec4 uRest;
            uniform vec4 uPhase;
            uniform vec4 uHipYB;
            uniform vec4 uHipZB;
            uniform vec4 uKneeYB;
            uniform vec4 uKneeZB;
            uniform vec4 uRestB;
            uniform vec4 uPhaseB;
            uniform float uKneeFold;
            uniform vec2 uNeck;
            uniform vec2 uTailPivot;
            varying vec3 vLocalPos;
            varying vec3 vNormalLocal;
            varying vec2 vUv;

            // Turn about a horizontal axis across the body through (height, z):
            // positive swings what is below the pivot backwards.
            void pitchAbout(inout vec3 p, inout vec3 n, vec2 pivot, float angle) {
                float c = cos(angle);
                float s = sin(angle);
                vec2 d = vec2(p.y - pivot.x, p.z - pivot.y);
                p.yz = pivot + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
                n.yz = vec2(n.y * c - n.z * s, n.y * s + n.z * c);
            }
            // Turn about the vertical line through z.
            void yawAbout(inout vec3 p, inout vec3 n, float z, float angle) {
                float c = cos(angle);
                float s = sin(angle);
                vec2 d = vec2(p.x, p.z - z);
                p.xz = vec2(d.x * c + d.y * s, z - d.x * s + d.y * c);
                n.xz = vec2(n.x * c + n.z * s, -n.x * s + n.z * c);
            }

            void main() {
                vec3 p = position;
                vec3 n = normal;
                #ifdef USE_CREATURE_RIG
                float legs = dot(aLegs, vec4(1.0)) + dot(aLegsB, vec4(1.0));
                if (legs > 0.0005) {
                    // Each leg at its own place in the stride (a trot for four).
                    vec4 phase = vec4(aAnim.x) + uPhase;
                    vec4 phaseB = vec4(aAnim.x) + uPhaseB;
                    float stride = aAnim.y;
                    // Folded at the knee only while the foot swings forward, in the air.
                    vec4 below = smoothstep(uKneeY + 0.03, uKneeY - 0.03, vec4(p.y));
                    vec4 belowB = smoothstep(uKneeYB + 0.03, uKneeYB - 0.03, vec4(p.y));
                    float knee = (dot(aLegs * below, max(cos(phase), 0.0)) + dot(aLegsB * belowB, max(cos(phaseB), 0.0))) * stride * uKneeFold;
                    vec2 kneeAt = vec2(dot(aLegs, uKneeY) + dot(aLegsB, uKneeYB), dot(aLegs, uKneeZ) + dot(aLegsB, uKneeZB)) / legs;
                    pitchAbout(p, n, kneeAt, knee);
                    float hip = dot(aLegs, uRest - stride * sin(phase)) + dot(aLegsB, uRestB - stride * sin(phaseB));
                    vec2 hipAt = vec2(dot(aLegs, uHipY) + dot(aLegsB, uHipYB), dot(aLegs, uHipZ) + dot(aLegsB, uHipZB)) / legs;
                    pitchAbout(p, n, hipAt, hip);
                }
                #endif
                if (aParts.x > 0.0005) {
                    yawAbout(p, n, uNeck.y, aAnim.w * aParts.x);
                    pitchAbout(p, n, uNeck, aAnim.z * aParts.x);
                }
                if (aParts.y > 0.0005) yawAbout(p, n, uTailPivot.y, aTail * aParts.y);
                vec4 world = instanceMatrix * vec4(p, 1.0);
                vLocalPos = uOrigin + world.xyz;
                vNormalLocal = mat3(instanceMatrix) * n;
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * world;
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            ${SURFACE_SHADING_GLSL}
            uniform sampler2D uMap;
            uniform vec3 uCoat;
            uniform float uRecolor;
            varying vec3 vLocalPos;
            varying vec3 vNormalLocal;
            varying vec2 vUv;
            void main() {
                #include <logdepthbuf_fragment>
                vec3 albedo = uCoat;
                #ifdef USE_CREATURE_MAP
                albedo = texture2D(uMap, vUv).rgb;
                // Another species of the same build: its markings in its own colours.
                float luma = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
                vec3 dyed = uCoat * luma / max(dot(uCoat, vec3(0.2126, 0.7152, 0.0722)), 0.05);
                albedo = mix(albedo, dyed, uRecolor);
                #endif
                vec3 up = normalize(vLocalPos);
                vec3 color = applyHaze(surfaceLightWrap(albedo, normalize(vNormalLocal), up, 0.2) + playerLights(albedo, normalize(vNormalLocal), vLocalPos), vLocalPos, up);
                gl_FragColor = vec4(color, 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
};
