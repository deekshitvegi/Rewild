import { fbm, smoothstep } from './noise';

/**
 * Lakes standing at their own levels and rivers running down from them, laid out by hand on an
 * invented world (Haven), in the world's own frame: points are unit directions from its centre,
 * levels and sizes in metres. A river is a line of points with the water's level at each; where it
 * drops more than FALL_SLOPE metres for every metre it runs, it is a waterfall: the ground is cut
 * as a chute and no water surface lies on it (Waterfalls.tsx draws the falling water).
 *
 * Everything here is written twice, once in JavaScript (walking, placement, the map) and once in
 * GLSL (the drawn ground, the water, the grass), and the two must agree exactly. The GLSL is
 * emitted with every lake and every river segment unrolled as constants: no array is indexed at
 * run time (Direct3D's compiler stalls on that).
 */
export type Vec3 = [number, number, number];
export interface StreamLake {
    name: string; at: Vec3; radius: number; level: number; depth: number;
    /** A garden round it: no wild trees or bushes within this many metres of its middle (its trees are planted). */
    garden?: number;
}
export interface StreamRiver {
    name: string;
    points: Vec3[];
    levels: number[];
    /** Width of the water, metres. */
    width: number;
    /** How far the bed lies under the water in mid-stream, metres. */
    depth: number;
    /** How steeply the banks rise from the water (metres up per metre out). */
    bank: number;
    /** How far out from the water's edge the valley is carved, metres. */
    valley: number;
}
/** Level ground for a building: flat at `level` within `radius` metres, easing back to the land over `blend`. */
export interface StreamPad {
    name: string; at: Vec3; radius: number; level: number; blend: number;
    /** Planted round: no wild trees or bushes within this many metres of its middle. */
    garden?: number;
}
export interface Streams { lakes: StreamLake[]; rivers: StreamRiver[]; pads?: StreamPad[] }

export const FALL_SLOPE = 0.8;
/** How far past its shore a lake's surface reaches (a rim of dry ground is raised there). */
const LAKE_REACH = 1.25;

const smin = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
};

/** Whether a river's segment is a waterfall: it drops more than FALL_SLOPE metres per metre it runs. */
const isFall = (river: StreamRiver, i: number, radius: number) => {
    const [a, b] = [river.points[i], river.points[i + 1]];
    const run = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * radius;
    return (river.levels[i] - river.levels[i + 1]) / Math.max(run, 1e-6) > FALL_SLOPE;
};

/** The nearest point of a river to a direction: metres to it, the water's level there, 1 on a waterfall. */
export const riverNear = (x: number, y: number, z: number, river: StreamRiver, radius: number) => {
    let best = 1e9;
    let level = 0;
    let fall = 0;
    for (let i = 0; i < river.points.length - 1; i++) {
        const [a, b] = [river.points[i], river.points[i + 1]];
        const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
        const t = Math.min(Math.max(((x - a[0]) * vx + (y - a[1]) * vy + (z - a[2]) * vz) / (vx * vx + vy * vy + vz * vz), 0), 1);
        const m = Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t, z - a[2] - vz * t) * radius;
        if (m < best) {
            best = m;
            level = river.levels[i] + (river.levels[i + 1] - river.levels[i]) * t;
            fall = isFall(river, i, radius) ? 1 : 0;
        }
    }
    return { dist: best, level, fall };
};

const lakeReach = (x: number, y: number, z: number, lake: StreamLake, radius: number, seed: number) => {
    const ragged = fbm(x * 60, y * 60, z * 60, seed + 81, 2) * 0.22;
    return Math.hypot(x - lake.at[0], y - lake.at[1], z - lake.at[2]) * radius / lake.radius + ragged;
};

/** The ground with the lakes' basins and the rivers' valleys cut into it (never raised but at a lake's rim). */
export const streamCarve = (x: number, y: number, z: number, g: number, streams: Streams, radius: number, seed: number) => {
    for (const pad of streams.pads ?? []) {
        const dist = Math.hypot(x - pad.at[0], y - pad.at[1], z - pad.at[2]) * radius;
        const w = 1 - smoothstep(pad.radius, pad.radius + pad.blend, dist);
        g += (pad.level - g) * w;
    }
    for (const lake of streams.lakes) {
        const e = lakeReach(x, y, z, lake, radius, seed);
        const inside = 1 - smoothstep(0.8, 1, e);
        const bowl = lake.level - lake.depth * Math.max(1 - e * e, 0);
        g += (Math.min(g, bowl) - g) * inside;
        // A rim of dry ground just outside the shore, so the water never stands on open slope.
        const rim = smoothstep(0.9, 1, e) * (1 - smoothstep(1.3, 1.8, e));
        g += (Math.max(g, lake.level + 0.4 + (e - 1) * lake.radius * 0.08) - g) * rim;
    }
    for (const river of streams.rivers) {
        const near = riverNear(x, y, z, river, radius);
        const half = river.width * 0.5;
        const over = Math.max(near.dist - half, 0);
        const w = 1 - smoothstep(river.valley * 0.6, river.valley, over);
        if (w <= 0) continue;
        // The banks rise unevenly: here a ledge, there a steeper wall.
        const rough = 0.7 + 0.6 * (fbm(x * 140, y * 140, z * 140, seed + 83, 2) * 0.5 + 0.5);
        g += (smin(g, near.level + over * river.bank * rough, 2) - g) * w;
        g -= river.depth * (1 - smoothstep(half * 0.4, half, near.dist)) * w;
    }
    return g;
};

/** The level water stands at over a direction: the sea's, or a lake's or river's where one is. */
export const streamWater = (x: number, y: number, z: number, sea: number, streams: Streams, radius: number, seed: number) => {
    let level = sea;
    for (const lake of streams.lakes) {
        if (lakeReach(x, y, z, lake, radius, seed) < LAKE_REACH) level = Math.max(level, lake.level);
    }
    for (const river of streams.rivers) {
        const near = riverNear(x, y, z, river, radius);
        if (near.fall < 0.5 && near.dist < river.width * 0.75) level = Math.max(level, near.level);
    }
    return level;
};

const f = (v: number) => v.toFixed(7);
const vec = (p: Vec3) => `vec3(${p.map(f).join(', ')})`;

/** GLSL: streamCarve(vec3 d, float g) and streamWater(vec3 d, float sea), as above. */
export const streamsGLSL = (streams: Streams, radius: number, seed: number) => {
    const R = f(radius);
    const s = `${seed >>> 0}u`;
    const rivers = streams.rivers.map((river, r) => {
        const lines: string[] = [];
        for (let i = 0; i < river.points.length - 1; i++) {
            const fall = isFall(river, i, radius) ? '1.0' : '0.0';
            lines.push(`    a = ${vec(river.points[i])}; v = ${vec(river.points[i + 1])} - a;`);
            lines.push(`    t = clamp(dot(d - a, v) / dot(v, v), 0.0, 1.0); m = length(d - a - v * t) * ${R};`);
            lines.push(`    if (m < best.x) best = vec3(m, mix(${f(river.levels[i])}, ${f(river.levels[i + 1])}, t), ${fall});`);
        }
        return /* glsl */ `
vec3 riverNear${r}(vec3 d) {
    vec3 best = vec3(1e9, 0.0, 0.0);
    vec3 a; vec3 v; float t; float m;
${lines.join('\n')}
    return best;
}`;
    });
    const lakeE = (lake: StreamLake) =>
        `length(d - ${vec(lake.at)}) * ${R} / ${f(lake.radius)} + fbm(d * 60.0, ${s} + 81u, 2, 2.0, 0.5) * 0.22`;
    const carvePads = (streams.pads ?? []).map((pad) => /* glsl */ `
    g = mix(g, ${f(pad.level)}, 1.0 - smoothstep(${f(pad.radius)}, ${f(pad.radius + pad.blend)}, length(d - ${vec(pad.at)}) * ${R}));`).join('');
    const carveLakes = streams.lakes.map((lake) => /* glsl */ `
    {
        float e = ${lakeE(lake)};
        float inside = 1.0 - smoothstep(0.8, 1.0, e);
        float bowl = ${f(lake.level)} - ${f(lake.depth)} * max(1.0 - e * e, 0.0);
        g = mix(g, min(g, bowl), inside);
        float rim = smoothstep(0.9, 1.0, e) * (1.0 - smoothstep(1.3, 1.8, e));
        g = mix(g, max(g, ${f(lake.level)} + 0.4 + (e - 1.0) * ${f(lake.radius * 0.08)}), rim);
    }`).join('');
    const carveRivers = streams.rivers.map((river, r) => /* glsl */ `
    {
        vec3 near = riverNear${r}(d);
        float over = max(near.x - ${f(river.width * 0.5)}, 0.0);
        float w = 1.0 - smoothstep(${f(river.valley * 0.6)}, ${f(river.valley)}, over);
        if (w > 0.0) {
            float rough = 0.7 + 0.6 * (fbm(d * 140.0, ${s} + 83u, 2, 2.0, 0.5) * 0.5 + 0.5);
            float target = near.y + over * ${f(river.bank)} * rough;
            float k = max(2.0 - abs(g - target), 0.0) / 2.0;
            g = mix(g, min(g, target) - k * k * 0.5, w);
            g -= ${f(river.depth)} * (1.0 - smoothstep(${f(river.width * 0.2)}, ${f(river.width * 0.5)}, near.x)) * w;
        }
    }`).join('');
    // Which way the water runs over a direction, as a vector along the ground (length: how fast,
    // about 1 for 1.5 m/s): along the nearest stretch of river, quicker where it drops more; nothing
    // off the rivers, on waterfalls, or on lakes.
    const flows = streams.rivers.map((river) => {
        const lines: string[] = [];
        for (let i = 0; i < river.points.length - 1; i++) {
            const a = river.points[i];
            const b = river.points[i + 1];
            const run = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * radius;
            const slope = (river.levels[i] - river.levels[i + 1]) / Math.max(run, 1e-6);
            const speed = isFall(river, i, radius) ? 0 : Math.min(Math.max(0.45 + slope * 40, 0.4), 1.6);
            lines.push(`    a = ${vec(a)}; v = ${vec(b)} - a;`);
            lines.push(`    t = clamp(dot(d - a, v) / dot(v, v), 0.0, 1.0); m = length(d - a - v * t) * ${R};`);
            lines.push(`    if (m < best) { best = m; flow = normalize(v - d * dot(v, d)) * ${f(speed)} * (1.0 - smoothstep(${f(river.width * 0.3)}, ${f(river.width * 0.6)}, m)); }`);
        }
        return [
            '    best = 1e9;',
            ...lines,
            '    if (best < nearest) { nearest = best; out_ = flow; }',
        ].join('\n');
    });
    const waterLakes = streams.lakes.map((lake) =>
        `    if (${lakeE(lake)} < ${f(LAKE_REACH)}) level = max(level, ${f(lake.level)});`).join('\n');
    const waterRivers = streams.rivers.map((river, r) => /* glsl */ `
    {
        vec3 near = riverNear${r}(d);
        if (near.z < 0.5 && near.x < ${f(river.width * 0.75)}) level = max(level, near.y);
    }`).join('');
    return `${rivers.join('\n')}
float streamCarve(vec3 d, float g) {${carvePads}${carveLakes}${carveRivers}
    return g;
}
vec3 streamFlow(vec3 d) {
    vec3 out_ = vec3(0.0);
    float nearest = 1e9;
    float best; vec3 flow = vec3(0.0); vec3 a; vec3 v; float t; float m;
${flows.join('\n')}
    return out_;
}
float streamWater(vec3 d, float sea) {
    float level = sea;
${waterLakes}${waterRivers}
    return level;
}
`;
};
