/**
 * Gradient noise that gives the same values in JavaScript and in GLSL.
 *
 * The terrain is displaced on the GPU, while landing, walking and collisions
 * sample the ground height on the CPU. Both sides therefore run this exact
 * algorithm: an integer hash of the lattice corner, a gradient read from the
 * hash bits, and quintic interpolation. Lattice coordinates are shifted by
 * NOISE_OFFSET so they are always positive before being hashed as unsigned
 * integers, which keeps the two implementations bit-compatible.
 */

export const NOISE_OFFSET = 65536;

export const hashU32 = (value: number): number => {
    let x = value >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x7feb352d) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 0x846ca68b) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
};

export const hash3 = (x: number, y: number, z: number, seed: number): number =>
    hashU32((x ^ hashU32((y ^ hashU32((z ^ seed) >>> 0)) >>> 0)) >>> 0);

/** A float in [0, 1) from a hash, identical to hashToUnit() in GLSL. */
export const hashToUnit = (h: number) => (h & 0xffffff) / 16777216;

const gradDot = (h: number, x: number, y: number, z: number) =>
    ((h & 1023) * (2 / 1023) - 1) * x
    + (((h >>> 10) & 1023) * (2 / 1023) - 1) * y
    + (((h >>> 20) & 1023) * (2 / 1023) - 1) * z;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 3D gradient noise, roughly in [-1, 1]. */
export const gnoise = (px: number, py: number, pz: number, seed: number): number => {
    const fx = Math.floor(px);
    const fy = Math.floor(py);
    const fz = Math.floor(pz);
    const x = px - fx;
    const y = py - fy;
    const z = pz - fz;
    const ix = fx + NOISE_OFFSET;
    const iy = fy + NOISE_OFFSET;
    const iz = fz + NOISE_OFFSET;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const n000 = gradDot(hash3(ix, iy, iz, seed), x, y, z);
    const n100 = gradDot(hash3(ix + 1, iy, iz, seed), x - 1, y, z);
    const n010 = gradDot(hash3(ix, iy + 1, iz, seed), x, y - 1, z);
    const n110 = gradDot(hash3(ix + 1, iy + 1, iz, seed), x - 1, y - 1, z);
    const n001 = gradDot(hash3(ix, iy, iz + 1, seed), x, y, z - 1);
    const n101 = gradDot(hash3(ix + 1, iy, iz + 1, seed), x - 1, y, z - 1);
    const n011 = gradDot(hash3(ix, iy + 1, iz + 1, seed), x, y - 1, z - 1);
    const n111 = gradDot(hash3(ix + 1, iy + 1, iz + 1, seed), x - 1, y - 1, z - 1);

    return lerp(
        lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
        lerp(lerp(n001, n101, u), lerp(n011, n111, u), v),
        w,
    );
};

/**
 * Gradient noise that repeats every `period` lattice cells (the same noise as
 * gnoise, hashed modulo the period), sampled `size / period` times per cell:
 * a tiling field to read noise from with one texture lookup instead of eight
 * hashes. The corner gradients are hashed once per lattice point and kept,
 * so building a 64³ volume takes tens of milliseconds, not half a second.
 */
const periodicNoiseField = (size: number, period: number, seed: number) => {
    const gradients = new Float32Array(period * period * period * 3);
    for (let z = 0; z < period; z++) {
        for (let y = 0; y < period; y++) {
            for (let x = 0; x < period; x++) {
                const h = hash3(x + NOISE_OFFSET, y + NOISE_OFFSET, z + NOISE_OFFSET, seed >>> 0);
                const o = ((z * period + y) * period + x) * 3;
                gradients[o] = (h & 1023) * (2 / 1023) - 1;
                gradients[o + 1] = ((h >>> 10) & 1023) * (2 / 1023) - 1;
                gradients[o + 2] = ((h >>> 20) & 1023) * (2 / 1023) - 1;
            }
        }
    }
    const corner = (x: number, y: number, z: number, dx: number, dy: number, dz: number) => {
        const o = ((z % period) * period * period + (y % period) * period + (x % period)) * 3;
        return gradients[o] * dx + gradients[o + 1] * dy + gradients[o + 2] * dz;
    };
    const field = new Float32Array(size * size * size);
    const cell = period / size;
    for (let z = 0; z < size; z++) {
        const pz = z * cell, fz = Math.floor(pz), az = pz - fz, w = fade(az);
        for (let y = 0; y < size; y++) {
            const py = y * cell, fy = Math.floor(py), ay = py - fy, v = fade(ay);
            for (let x = 0; x < size; x++) {
                const px = x * cell, fx = Math.floor(px), ax = px - fx, u = fade(ax);
                field[(z * size + y) * size + x] = lerp(
                    lerp(lerp(corner(fx, fy, fz, ax, ay, az), corner(fx + 1, fy, fz, ax - 1, ay, az), u),
                        lerp(corner(fx, fy + 1, fz, ax, ay - 1, az), corner(fx + 1, fy + 1, fz, ax - 1, ay - 1, az), u), v),
                    lerp(lerp(corner(fx, fy, fz + 1, ax, ay, az - 1), corner(fx + 1, fy, fz + 1, ax - 1, ay, az - 1), u),
                        lerp(corner(fx, fy + 1, fz + 1, ax, ay - 1, az - 1), corner(fx + 1, fy + 1, fz + 1, ax - 1, ay - 1, az - 1), u), v),
                    w,
                );
            }
        }
    }
    return field;
};

const toByte = (n: number) => Math.max(0, Math.min(255, Math.round((0.5 + n * 0.5) * 255)));

/**
 * Four unrelated periodic noise fields (periodicNoiseField) in the four
 * channels of one volume, each stored as 0.5 + n / 2 (n roughly within -1..1).
 */
export const periodicNoiseVolume = (size = 64, period = 16, seed = 7001) => {
    const data = new Uint8Array(size * size * size * 4);
    for (let c = 0; c < 4; c++) {
        const field = periodicNoiseField(size, period, (seed + c * 7919) >>> 0);
        for (let i = 0; i < field.length; i++) data[i * 4 + c] = toByte(field[i]);
    }
    return { data, size, period };
};

/** How steep the noise can get (per unit), as stored: slopes are kept as 0.5 + slope / (2 * SLOPE_RANGE). */
export const NOISE_SLOPE_RANGE = 3;

/**
 * One periodic noise field with its slope: RGB the gradient (d/dx, d/dy,
 * d/dz, per unit, from central differences on the field), A the value. For
 * surfaces lit by a noise (water's waves): one read gives the normal's tilt
 * where finite differences of gnoise took four noise evaluations.
 */
export const periodicSlopeVolume = (size = 64, period = 16, seed = 9001) => {
    const field = periodicNoiseField(size, period, seed);
    const data = new Uint8Array(size * size * size * 4);
    const at = (x: number, y: number, z: number) => field[(((z + size) % size) * size + ((y + size) % size)) * size + ((x + size) % size)];
    const scale = size / period / 2 / NOISE_SLOPE_RANGE;
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const o = ((z * size + y) * size + x) * 4;
                data[o] = toByte((at(x + 1, y, z) - at(x - 1, y, z)) * scale);
                data[o + 1] = toByte((at(x, y + 1, z) - at(x, y - 1, z)) * scale);
                data[o + 2] = toByte((at(x, y, z + 1) - at(x, y, z - 1)) * scale);
                data[o + 3] = toByte(at(x, y, z));
            }
        }
    }
    return { data, size, period };
};

/** Fractal sum of gnoise octaves. */
export const fbm = (
    x: number, y: number, z: number,
    seed: number, octaves: number, lacunarity = 2.0, gain = 0.5,
): number => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amplitude * gnoise(x * frequency, y * frequency, z * frequency, (seed + i * 1013) >>> 0);
        frequency *= lacunarity;
        amplitude *= gain;
    }
    return sum;
};

/** Ridged fractal noise: sharp crests, in roughly [0, 1]. */
export const ridged = (
    x: number, y: number, z: number,
    seed: number, octaves: number,
): number => {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(gnoise(x * frequency, y * frequency, z * frequency, (seed + i * 1013) >>> 0));
        n *= n * weight;
        weight = Math.min(1, Math.max(0, n * 2));
        sum += n * amplitude;
        frequency *= 2;
        amplitude *= 0.5;
    }
    return sum;
};

/**
 * Crater field. Each lattice cell may hold one crater with a random centre and
 * radius (at most 0.3 cells, rim included under 0.5), so only the 2x2x2 block
 * of cells around the point can reach it. Returns a height offset in about
 * [-1, 0.35]: bowls below zero, raised rims above.
 */
export const craters = (px: number, py: number, pz: number, seed: number, density: number): number => {
    const bx = Math.floor(px + 0.5) - 1;
    const by = Math.floor(py + 0.5) - 1;
    const bz = Math.floor(pz + 0.5) - 1;
    let height = 0;
    for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const cx = bx + dx;
                const cy = by + dy;
                const cz = bz + dz;
                const h = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, seed);
                if (hashToUnit(h) >= density) continue;
                const h2 = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, (seed + 7919) >>> 0);
                const ox = cx + (h2 & 1023) / 1023;
                const oy = cy + ((h2 >>> 10) & 1023) / 1023;
                const oz = cz + ((h2 >>> 20) & 1023) / 1023;
                const radius = 0.08 + hashToUnit(hashU32(h2)) * 0.22;
                const ddx = px - ox;
                const ddy = py - oy;
                const ddz = pz - oz;
                const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / radius;
                if (dist >= 1.6) continue;
                const rim = 0.35;
                height += dist < 1
                    ? lerp(-1, rim, dist * dist)
                    : rim * (1 - smoothstep(1, 1.6, dist));
            }
        }
    }
    return height;
};

/**
 * Craters as they are: depth in proportion to size. `cell` is the lattice
 * cell's size in world units; each crater is 0.08 to 0.3 of a cell across in
 * radius. A small one is a bowl a fifth as deep as it is wide, its rim raised
 * a little; one bigger than `complexAt` (radius, units) has slumped: a flat
 * floor, its walls in terraces, a central peak, and is a tenth as deep as it
 * is wide. Old craters are shallower and softer. Returns world units.
 */
const craterProfile = (dist: number, radius: number, complexAt: number, fresh: number) => {
    const complex = smoothstep(complexAt * 0.8, complexAt * 1.25, radius);
    const depth = radius * lerp(0.4, 0.2, complex) * lerp(0.45, 1, fresh);
    if (dist >= 1.8) return 0;
    if (dist >= 1) {
        // The rim falls away into the ejecta blanket.
        const t = 1 - smoothstep(1, 1.8, dist);
        return 0.2 * depth * t * t;
    }
    const bowl = dist * dist;
    // Slumped walls: the bowl's curve with three terraces stepped into it, a flat floor, a peak.
    const w = Math.min(1, Math.max(0, (dist - 0.42) / 0.58));
    const k = w * 3;
    const terraces = (Math.floor(k) + smoothstep(0.7, 1, k - Math.floor(k))) / 3;
    const wall = lerp(w * w, terraces, 0.55);
    const peak = 0.55 * (1 - smoothstep(0, 0.2, dist));
    const shape = lerp(bowl, wall + peak, complex);
    return lerp(-0.8, 0.2, shape) * depth;
};

export const craterField = (px: number, py: number, pz: number, seed: number, density: number, cell: number, complexAt: number): number => {
    const bx = Math.floor(px + 0.5) - 1;
    const by = Math.floor(py + 0.5) - 1;
    const bz = Math.floor(pz + 0.5) - 1;
    let height = 0;
    for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const cx = bx + dx;
                const cy = by + dy;
                const cz = bz + dz;
                const h = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, seed);
                if (hashToUnit(h) >= density) continue;
                const h2 = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, (seed + 7919) >>> 0);
                const ox = cx + (h2 & 1023) / 1023;
                const oy = cy + ((h2 >>> 10) & 1023) / 1023;
                const oz = cz + ((h2 >>> 20) & 1023) / 1023;
                const h3 = hashU32(h2);
                const radius = 0.08 + hashToUnit(h3) * 0.22;
                const ddx = px - ox;
                const ddy = py - oy;
                const ddz = pz - oz;
                const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / radius;
                if (dist >= 1.8) continue;
                height += craterProfile(dist, radius * cell, complexAt, hashToUnit(hashU32(h3 + 1)));
            }
        }
    }
    return height;
};

/**
 * Volcanic features, one per lattice cell at most (as craters): `shields` are
 * broad volcanoes (radius up to 0.45 cells, a steep-walled caldera at the summit), `domes` the
 * flat-topped, steep-sided lava domes Venus is dotted with ("pancake domes").
 * Where two overlap, the higher wins. Returns 0 to about 1.
 */
const volcanic = (px: number, py: number, pz: number, seed: number, density: number, shield: boolean): number => {
    const bx = Math.floor(px + 0.5) - 1;
    const by = Math.floor(py + 0.5) - 1;
    const bz = Math.floor(pz + 0.5) - 1;
    let height = 0;
    for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const cx = bx + dx;
                const cy = by + dy;
                const cz = bz + dz;
                const h = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, seed);
                if (hashToUnit(h) >= density) continue;
                const h2 = hash3(cx + NOISE_OFFSET, cy + NOISE_OFFSET, cz + NOISE_OFFSET, (seed + 7919) >>> 0);
                const ox = cx + (h2 & 1023) / 1023;
                const oy = cy + ((h2 >>> 10) & 1023) / 1023;
                const oz = cz + ((h2 >>> 20) & 1023) / 1023;
                const size = hashToUnit(hashU32(h2));
                const radius = shield ? 0.25 + size * 0.2 : 0.15 + size * 0.15;
                const ddx = px - ox;
                const ddy = py - oy;
                const ddz = pz - oz;
                const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / radius;
                if (dist >= 1) continue;
                let form: number;
                if (shield) {
                    const t = 1 - dist;
                    form = t * t * (3 - 2 * t) * (0.55 + 0.45 * size) - 0.32 * (1 - smoothstep(0.07, 0.1, dist));
                } else {
                    form = (1 - smoothstep(0.72, 1, dist)) * (0.6 + 0.4 * size) - 0.08 * (1 - smoothstep(0, 0.15, dist));
                }
                height = Math.max(height, form);
            }
        }
    }
    return height;
};
export const shields = (px: number, py: number, pz: number, seed: number, density: number) => volcanic(px, py, pz, seed, density, true);
export const domes = (px: number, py: number, pz: number, seed: number, density: number) => volcanic(px, py, pz, seed, density, false);

export const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/**
 * Linear dunes, as on Titan's equatorial sand seas: long parallel ridges
 * running east-west (along the parallels of a unit direction whose north is
 * +y), 1/46 of the radius apart, meandering and now and then merging where
 * the meander takes a whole step. 0 in the corridors between them, 1 on a crest.
 */
export const linearDunes = (x: number, y: number, z: number, seed: number) => {
    const warp = fbm(x * 9, y * 9, z * 9, seed + 41, 2) * 0.9 + fbm(x * 40, y * 40, z * 40, seed + 43, 2) * 0.25;
    const phase = y * 46 + warp;
    const across = 1 - Math.abs(2 * (phase - Math.floor(phase)) - 1);
    return Math.pow(smoothstep(0.25, 1, across), 1.6);
};

/** The same functions in GLSL. Keep every line in step with the code above. */
export const NOISE_GLSL = /* glsl */ `
const int NOISE_OFFSET = ${NOISE_OFFSET};

uint hashU32(uint x) {
    x ^= x >> 16u;
    x *= 0x7feb352du;
    x ^= x >> 15u;
    x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
}

uint hash3(uvec3 p, uint seed) {
    return hashU32(p.x ^ hashU32(p.y ^ hashU32(p.z ^ seed)));
}

float hashToUnit(uint h) {
    return float(h & 0xffffffu) / 16777216.0;
}

float gradDot(uint h, vec3 p) {
    vec3 g = vec3(float(h & 1023u), float((h >> 10u) & 1023u), float((h >> 20u) & 1023u)) * (2.0 / 1023.0) - 1.0;
    return dot(g, p);
}

float gnoise(vec3 p, uint seed) {
    vec3 fl = floor(p);
    vec3 f = p - fl;
    uvec3 i = uvec3(ivec3(fl) + NOISE_OFFSET);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = gradDot(hash3(i, seed), f);
    float n100 = gradDot(hash3(i + uvec3(1u, 0u, 0u), seed), f - vec3(1.0, 0.0, 0.0));
    float n010 = gradDot(hash3(i + uvec3(0u, 1u, 0u), seed), f - vec3(0.0, 1.0, 0.0));
    float n110 = gradDot(hash3(i + uvec3(1u, 1u, 0u), seed), f - vec3(1.0, 1.0, 0.0));
    float n001 = gradDot(hash3(i + uvec3(0u, 0u, 1u), seed), f - vec3(0.0, 0.0, 1.0));
    float n101 = gradDot(hash3(i + uvec3(1u, 0u, 1u), seed), f - vec3(1.0, 0.0, 1.0));
    float n011 = gradDot(hash3(i + uvec3(0u, 1u, 1u), seed), f - vec3(0.0, 1.0, 1.0));
    float n111 = gradDot(hash3(i + uvec3(1u, 1u, 1u), seed), f - vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    );
}

float fbm(vec3 p, uint seed, int octaves, float lacunarity, float gain) {
    float sum = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int i = 0; i < 12; i++) {
        if (i >= octaves) break;
        sum += amplitude * gnoise(p * frequency, seed + uint(i) * 1013u);
        frequency *= lacunarity;
        amplitude *= gain;
    }
    return sum;
}

float ridged(vec3 p, uint seed, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float weight = 1.0;
    for (int i = 0; i < 12; i++) {
        if (i >= octaves) break;
        float n = 1.0 - abs(gnoise(p * frequency, seed + uint(i) * 1013u));
        n *= n * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        sum += n * amplitude;
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return sum;
}

float craters(vec3 p, uint seed, float density) {
    vec3 b = floor(p + 0.5) - 1.0;
    float height = 0.0;
    for (int dz = 0; dz <= 1; dz++) {
        for (int dy = 0; dy <= 1; dy++) {
            for (int dx = 0; dx <= 1; dx++) {
                vec3 c = b + vec3(float(dx), float(dy), float(dz));
                uvec3 ci = uvec3(ivec3(c) + NOISE_OFFSET);
                uint h = hash3(ci, seed);
                if (hashToUnit(h) >= density) continue;
                uint h2 = hash3(ci, seed + 7919u);
                vec3 o = c + vec3(float(h2 & 1023u), float((h2 >> 10u) & 1023u), float((h2 >> 20u) & 1023u)) / 1023.0;
                float radius = 0.08 + hashToUnit(hashU32(h2)) * 0.22;
                float dist = length(p - o) / radius;
                if (dist >= 1.6) continue;
                float rim = 0.35;
                height += dist < 1.0 ? mix(-1.0, rim, dist * dist) : rim * (1.0 - smoothstep(1.0, 1.6, dist));
            }
        }
    }
    return height;
}

float craterProfile(float dist, float radius, float complexAt, float fresh) {
    float complexity = smoothstep(complexAt * 0.8, complexAt * 1.25, radius);
    float depth = radius * mix(0.4, 0.2, complexity) * mix(0.45, 1.0, fresh);
    if (dist >= 1.8) return 0.0;
    if (dist >= 1.0) {
        float t = 1.0 - smoothstep(1.0, 1.8, dist);
        return 0.2 * depth * t * t;
    }
    float bowl = dist * dist;
    float w = clamp((dist - 0.42) / 0.58, 0.0, 1.0);
    float k = w * 3.0;
    float terraces = (floor(k) + smoothstep(0.7, 1.0, k - floor(k))) / 3.0;
    float wall = mix(w * w, terraces, 0.55);
    float peak = 0.55 * (1.0 - smoothstep(0.0, 0.2, dist));
    float shape = mix(bowl, wall + peak, complexity);
    return mix(-0.8, 0.2, shape) * depth;
}

float craterField(vec3 p, uint seed, float density, float cell, float complexAt) {
    vec3 b = floor(p + 0.5) - 1.0;
    float height = 0.0;
    for (int dz = 0; dz <= 1; dz++) {
        for (int dy = 0; dy <= 1; dy++) {
            for (int dx = 0; dx <= 1; dx++) {
                vec3 c = b + vec3(float(dx), float(dy), float(dz));
                uvec3 ci = uvec3(ivec3(c) + NOISE_OFFSET);
                uint h = hash3(ci, seed);
                if (hashToUnit(h) >= density) continue;
                uint h2 = hash3(ci, seed + 7919u);
                vec3 o = c + vec3(float(h2 & 1023u), float((h2 >> 10u) & 1023u), float((h2 >> 20u) & 1023u)) / 1023.0;
                uint h3 = hashU32(h2);
                float radius = 0.08 + hashToUnit(h3) * 0.22;
                float dist = length(p - o) / radius;
                if (dist >= 1.8) continue;
                height += craterProfile(dist, radius * cell, complexAt, hashToUnit(hashU32(h3 + 1u)));
            }
        }
    }
    return height;
}

// craterField for craters too small ever to slump (all under where complex
// craters begin): plain bowls, the same height for less work.
float craterBowls(vec3 p, uint seed, float density, float cell) {
    vec3 b = floor(p + 0.5) - 1.0;
    float height = 0.0;
    for (int dz = 0; dz <= 1; dz++) {
        for (int dy = 0; dy <= 1; dy++) {
            for (int dx = 0; dx <= 1; dx++) {
                vec3 c = b + vec3(float(dx), float(dy), float(dz));
                uvec3 ci = uvec3(ivec3(c) + NOISE_OFFSET);
                uint h = hash3(ci, seed);
                if (hashToUnit(h) >= density) continue;
                uint h2 = hash3(ci, seed + 7919u);
                vec3 o = c + vec3(float(h2 & 1023u), float((h2 >> 10u) & 1023u), float((h2 >> 20u) & 1023u)) / 1023.0;
                uint h3 = hashU32(h2);
                float radius = 0.08 + hashToUnit(h3) * 0.22;
                float dist = length(p - o) / radius;
                float depth = radius * cell * 0.4 * mix(0.45, 1.0, hashToUnit(hashU32(h3 + 1u)));
                float t = 1.0 - smoothstep(1.0, 1.8, dist);
                height += dist < 1.0 ? mix(-0.8, 0.2, dist * dist) * depth : 0.2 * depth * t * t;
            }
        }
    }
    return height;
}

float volcanic(vec3 p, uint seed, float density, bool shield) {
    vec3 b = floor(p + 0.5) - 1.0;
    float height = 0.0;
    for (int dz = 0; dz <= 1; dz++) {
        for (int dy = 0; dy <= 1; dy++) {
            for (int dx = 0; dx <= 1; dx++) {
                vec3 c = b + vec3(float(dx), float(dy), float(dz));
                uvec3 ci = uvec3(ivec3(c) + NOISE_OFFSET);
                uint h = hash3(ci, seed);
                if (hashToUnit(h) >= density) continue;
                uint h2 = hash3(ci, seed + 7919u);
                vec3 o = c + vec3(float(h2 & 1023u), float((h2 >> 10u) & 1023u), float((h2 >> 20u) & 1023u)) / 1023.0;
                float size = hashToUnit(hashU32(h2));
                float radius = shield ? 0.25 + size * 0.2 : 0.15 + size * 0.15;
                float dist = length(p - o) / radius;
                if (dist >= 1.0) continue;
                float form;
                if (shield) {
                    float t = 1.0 - dist;
                    form = t * t * (3.0 - 2.0 * t) * (0.55 + 0.45 * size) - 0.32 * (1.0 - smoothstep(0.07, 0.1, dist));
                } else {
                    form = (1.0 - smoothstep(0.72, 1.0, dist)) * (0.6 + 0.4 * size) - 0.08 * (1.0 - smoothstep(0.0, 0.15, dist));
                }
                height = max(height, form);
            }
        }
    }
    return height;
}
float shields(vec3 p, uint seed, float density) { return volcanic(p, seed, density, true); }
float domes(vec3 p, uint seed, float density) { return volcanic(p, seed, density, false); }

float linearDunes(vec3 d, uint seed) {
    float warp = fbm(d * 9.0, seed + 41u, 2, 2.0, 0.5) * 0.9 + fbm(d * 40.0, seed + 43u, 2, 2.0, 0.5) * 0.25;
    float phase = d.y * 46.0 + warp;
    float across = 1.0 - abs(2.0 * fract(phase) - 1.0);
    return pow(smoothstep(0.25, 1.0, across), 1.6);
}
`;
