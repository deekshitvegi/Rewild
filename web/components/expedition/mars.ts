import * as THREE from 'three';
import { trackLoad } from './loadProgress';
import { hashToUnit, hashU32, NOISE_OFFSET, smoothstep } from './noise';
import type { ExpeditionBody } from './bodies';
import { globeFrame } from './sites';

/**
 * Mars's own ground, from NASA's Mars Orbiter Laser Altimeter rather than
 * invented: Olympus Mons, the Tharsis volcanoes, Valles Marineris, Hellas,
 * the low northern plains and the cratered south, where they really are.
 *
 * public/textures/expedition/mars-elevation.webp (2048 x 1024, equirectangular,
 * row 0 at the north pole, column 0 at longitude -180) and mars-olympus.webp
 * (64 pixels a degree over Olympus Mons) were made from the laser altimeter's
 * gridded elevation (see ATTRIBUTION.md): each pixel holds the height
 * above the datum as (metres + 8500) / 4 in 16 bits, the high byte in red and
 * the low in green.
 *
 * Here a kilometre across is 1.9 m, and heights are drawn eight times the true
 * proportion: Olympus Mons stands about 350 m over the plains round it on a
 * base 1.2 km wide, its cliff some 90 m high, its calderas 45 m deep; Valles
 * Marineris is over 100 m deep.
 *
 * On that the ground of Mars at the scale of a walker: plains that swell a
 * little, craters filled with sand to a flat floor, buttes and mesas where
 * layered rock has been worn back, and, wherever the ground is layered or the
 * map itself is steep (canyon walls, crater walls, the volcano's cliff), beds
 * of rock that stand as ledges with slopes of debris between: the beds lie
 * level (dipping a little across a region), so the same ones can be followed
 * from butte to butte, as on the real Mars.
 *
 * The CPU (landing, walking, placing things) and the GPU (drawing) build the
 * same ground from the very same numbers.
 */

const GLOBAL_URL = 'textures/expedition/mars-elevation.webp';
const OLYMPUS_URL = 'textures/expedition/mars-olympus.webp';
/** How the maps store a height: real metres = LOW + STEP * (256 R + G). */
const LOW = -8500;
const STEP = 4;
/** Heights are drawn this many times their true proportion. */
export const MARS_RELIEF = 8;
const REAL_RADIUS = 3389500;
/** The Olympus Mons patch: its edges in degrees (east longitudes as -180..180). */
const OLYMPUS = { north: 29, south: 9, west: 216 - 360, east: 236.5 - 360 };
/** Latitude and longitude (degrees) round which the landing ground is layered country. */
const LANDING_LAYERS = [-4.5, 78];
/** Thickness of a bed of rock, metres (before its regional variation). */
const BED = 6.5;

/** Two numbers a texel: the height (game metres) and the map's own slope there (rise over run). */
interface Grid { values: Float32Array; width: number; height: number; texture: THREE.DataTexture }
let globalGrid: Grid | null = null;
let olympusGrid: Grid | null = null;
let loading: Promise<boolean> | null = null;
let settled = false;

/**
 * Decode a packed elevation picture into game metres, and the slope of the
 * ground it describes, both rounded as the GPU's half floats hold them.
 * `area`: the latitudes and longitudes it covers (degrees), `radius` the
 * world's (game metres).
 */
const decode = (image: HTMLImageElement | ImageBitmap, scale: number, wrap: boolean,
    area: { north: number; south: number; west: number; east: number }, radius: number): Grid => {
    const canvas = document.createElement('canvas');
    const width = image.width;
    const height = image.height;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const bytes = context.getImageData(0, 0, width, height).data;
    const count = width * height;
    const metres = new Float32Array(count);
    for (let i = 0; i < count; i++) metres[i] = (LOW + STEP * (bytes[i * 4] * 256 + bytes[i * 4 + 1])) * scale;
    const values = new Float32Array(count * 2);
    const halves = new Uint16Array(count * 2);
    const north = (area.north - area.south) / height * Math.PI / 180 * radius;
    for (let y = 0; y < height; y++) {
        const lat = area.north - (y + 0.5) * (area.north - area.south) / height;
        const east = Math.max(0.05, Math.cos(lat * Math.PI / 180)) * (area.east - area.west) / width * Math.PI / 180 * radius;
        const up = Math.max(y - 1, 0);
        const down = Math.min(y + 1, height - 1);
        for (let x = 0; x < width; x++) {
            const left = wrap ? (x + width - 1) % width : Math.max(x - 1, 0);
            const right = wrap ? (x + 1) % width : Math.min(x + 1, width - 1);
            const gx = (metres[y * width + right] - metres[y * width + left]) / ((right - left + (right < left ? width : 0)) * east);
            const gy = (metres[up * width + x] - metres[down * width + x]) / ((down - up) * north);
            const i = y * width + x;
            const h = THREE.DataUtils.toHalfFloat(metres[i]);
            const g = THREE.DataUtils.toHalfFloat(Math.hypot(gx, gy));
            halves[i * 2] = h;
            halves[i * 2 + 1] = g;
            values[i * 2] = THREE.DataUtils.fromHalfFloat(h);
            values[i * 2 + 1] = THREE.DataUtils.fromHalfFloat(g);
        }
    }
    const texture = new THREE.DataTexture(halves, width, height, THREE.RGFormat, THREE.HalfFloatType);
    texture.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return { values, width, height, texture };
};

/** Game metres per real metre of height on Mars. */
const heightScale = (body: ExpeditionBody) => MARS_RELIEF * body.radius / REAL_RADIUS;

/** Fetch and decode both maps once; resolves to whether they could be had. */
export const loadMarsMap = (mars: ExpeditionBody) => {
    if (!loading) {
        const scale = heightScale(mars);
        const fetch = (url: string) => trackLoad(new THREE.ImageLoader().loadAsync(`${import.meta.env.BASE_URL}${url}`));
        loading = Promise.all([fetch(GLOBAL_URL), fetch(OLYMPUS_URL)]).then(([global, olympus]) => {
            globalGrid = decode(global, scale, true, { north: 90, south: -90, west: -180, east: 180 }, mars.radius);
            olympusGrid = decode(olympus, scale, false, OLYMPUS, mars.radius);
            settled = true;
            return true;
        }).catch((error) => {
            console.warn('The Mars elevation maps could not be loaded; Mars keeps invented ground.', error);
            settled = true;
            return false;
        });
    }
    return loading;
};

/** Whether this world's ground comes from the Mars maps. */
export const usesMarsMap = (body: ExpeditionBody) => body.id === 'skills' && globalGrid !== null && olympusGrid !== null;
/** Whether the maps have either arrived or failed. */
export const marsMapSettled = () => settled;

const frames = new Map<string, THREE.Matrix3>();
const frameOf = (body: ExpeditionBody) => {
    let frame = frames.get(body.id);
    if (!frame) {
        frame = globeFrame(body);
        frames.set(body.id, frame);
    }
    return frame;
};

/**
 * Which way the beds dip: a gentle tilt (about 1 in 60) in a fixed direction,
 * so a long cliff shows them slowly rising along it.
 */
const dipOf = (body: ExpeditionBody) => {
    const m = frameOf(body).elements;
    // Down towards the north-west in the map's frame (rows: longitude 0, north, east).
    const north = new THREE.Vector3(m[1], m[4], m[7]);
    const east = new THREE.Vector3(m[2], m[5], m[8]);
    return north.multiplyScalar(0.012).addScaledVector(east, -0.009);
};

/** Uniforms for any material whose shader includes the Mars ground (see marsGLSL). */
export const marsUniforms = (body: ExpeditionBody) => ({
    uMarsGlobal: { value: globalGrid!.texture },
    uMarsOlympus: { value: olympusGrid!.texture },
    uMarsFrame: { value: frameOf(body) },
    uMarsDip: { value: dipOf(body) },
});

// ---- CPU -------------------------------------------------------------------

/** Both channels of a grid at (u, t), filtered as the GPU filters them, into `sample`. */
const sample = [0, 0];
const bilinear = (grid: Grid, u: number, t: number, wrap: boolean) => {
    const { values, width, height } = grid;
    const fx = u * width - 0.5;
    const fy = t * height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const xa = wrap ? ((x0 % width) + width) % width : Math.min(Math.max(x0, 0), width - 1);
    const xb = wrap ? (xa + 1) % width : Math.min(Math.max(x0 + 1, 0), width - 1);
    const ya = Math.min(Math.max(y0, 0), height - 1);
    const yb = Math.min(Math.max(y0 + 1, 0), height - 1);
    for (let c = 0; c < 2; c++) {
        const p = values[(ya * width + xa) * 2 + c];
        const q = values[(ya * width + xb) * 2 + c];
        const r = values[(yb * width + xa) * 2 + c];
        const s = values[(yb * width + xb) * 2 + c];
        const top = p + (q - p) * ax;
        sample[c] = top + (r + (s - r) * ax - top) * ay;
    }
    return sample;
};

const latLon = { lat: 0, lon: 0 };
/** MOLA at a unit direction: its height (game metres) and slope into `mola`; latLon is filled in (degrees). */
const mola = { height: 0, steep: 0 };
const molaAt = (m: Float32Array | number[], x: number, y: number, z: number) => {
    const gx = m[0] * x + m[3] * y + m[6] * z;
    const gy = m[1] * x + m[4] * y + m[7] * z;
    const gz = m[2] * x + m[5] * y + m[8] * z;
    const lon = Math.atan2(gz, gx);
    const lat = Math.asin(Math.min(1, Math.max(-1, gy)));
    latLon.lat = lat * 180 / Math.PI;
    latLon.lon = lon * 180 / Math.PI;
    const g = bilinear(globalGrid!, lon / (Math.PI * 2) + 0.5, 0.5 - lat / Math.PI, true);
    mola.height = g[0];
    mola.steep = g[1];
    const ou = (latLon.lon - OLYMPUS.west) / (OLYMPUS.east - OLYMPUS.west);
    const ov = (OLYMPUS.north - latLon.lat) / (OLYMPUS.north - OLYMPUS.south);
    if (ou > 0 && ou < 1 && ov > 0 && ov < 1) {
        const w = smoothstep(0, 0.06, Math.min(ou, 1 - ou, ov, 1 - ov));
        const o = bilinear(olympusGrid!, ou, ov, false);
        mola.height += (o[0] - mola.height) * w;
        mola.steep += (o[1] - mola.steep) * w;
    }
    return mola;
};

/**
 * Mars's own noise: gradient noise as noise.ts has it, but each lattice corner
 * hashed once (its coordinates mixed by three odd constants) rather than three
 * times over. A third as much work, which is most of the terrain's cost; the
 * other worlds keep noise.ts's, so their ground does not move.
 */
const corner = (x: number, y: number, z: number, seed: number) =>
    hashU32((Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed) >>> 0);
const gradDot = (h: number, x: number, y: number, z: number) =>
    ((h & 1023) * (2 / 1023) - 1) * x
    + (((h >>> 10) & 1023) * (2 / 1023) - 1) * y
    + (((h >>> 20) & 1023) * (2 / 1023) - 1) * z;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mnoise = (px: number, py: number, pz: number, seed: number) => {
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
    return lerp(
        lerp(lerp(gradDot(corner(ix, iy, iz, seed), x, y, z), gradDot(corner(ix + 1, iy, iz, seed), x - 1, y, z), u),
            lerp(gradDot(corner(ix, iy + 1, iz, seed), x, y - 1, z), gradDot(corner(ix + 1, iy + 1, iz, seed), x - 1, y - 1, z), u), v),
        lerp(lerp(gradDot(corner(ix, iy, iz + 1, seed), x, y, z - 1), gradDot(corner(ix + 1, iy, iz + 1, seed), x - 1, y, z - 1), u),
            lerp(gradDot(corner(ix, iy + 1, iz + 1, seed), x, y - 1, z - 1), gradDot(corner(ix + 1, iy + 1, iz + 1, seed), x - 1, y - 1, z - 1), u), v),
        w,
    );
};
const mfbm = (x: number, y: number, z: number, seed: number, octaves: number) => {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        sum += amplitude * mnoise(x * frequency, y * frequency, z * frequency, (seed + i * 1013) >>> 0);
        frequency *= 2;
        amplitude *= 0.5;
    }
    return sum;
};
const mridged = (x: number, y: number, z: number, seed: number, octaves: number) => {
    let sum = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(mnoise(x * frequency, y * frequency, z * frequency, (seed + i * 1013) >>> 0));
        n *= n * weight;
        weight = Math.min(1, Math.max(0, n * 2));
        sum += n * amplitude;
        frequency *= 2;
        amplitude *= 0.5;
    }
    return sum;
};

/** Craters of Mars: bowls that sand has filled to a flat floor, rims worn low, some old and shallow. */
const marsCraters = (px: number, py: number, pz: number, seed: number, density: number) => {
    const bx = Math.floor(px + 0.5) - 1;
    const by = Math.floor(py + 0.5) - 1;
    const bz = Math.floor(pz + 0.5) - 1;
    let height = 0;
    for (let dz = 0; dz <= 1; dz++) {
        for (let dy = 0; dy <= 1; dy++) {
            for (let dx = 0; dx <= 1; dx++) {
                const cx = bx + dx + NOISE_OFFSET;
                const cy = by + dy + NOISE_OFFSET;
                const cz = bz + dz + NOISE_OFFSET;
                const h = corner(cx, cy, cz, seed);
                if (hashToUnit(h) >= density) continue;
                const h2 = hashU32((h + 0x9e3779b9) >>> 0);
                const ox = bx + dx + (h2 & 1023) / 1023;
                const oy = by + dy + ((h2 >>> 10) & 1023) / 1023;
                const oz = bz + dz + ((h2 >>> 20) & 1023) / 1023;
                const h3 = hashU32(h2);
                const radius = 0.08 + hashToUnit(h3) * 0.2;
                const ddx = px - ox;
                const ddy = py - oy;
                const ddz = pz - oz;
                const r = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / radius;
                if (r >= 1.7) continue;
                const h4 = hashU32((h3 + 17) >>> 0);
                const fill = 0.4 + 0.45 * hashToUnit(h4);
                const fresh = 0.45 + 0.55 * hashToUnit(hashU32((h4 + 29) >>> 0));
                height += fresh * (r < 1 ? Math.max(-1 + 1.3 * r * r, -fill) : 0.3 * (1 - smoothstep(1, 1.7, r)));
            }
        }
    }
    return height;
};

/** The larger of two heights, rounded off over `k` metres where they meet. */
const smax = (a: number, b: number, k: number) => {
    const h = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.max(a, b) + h * h * k * 0.25;
};

/**
 * Level beds of rock: a ledge where each bed's harder top stands, and at its
 * foot the debris fallen from it, banked up to half the bed's height.
 */
const beds = (h: number, offset: number, thickness: number, seed: number) => {
    const x = (h + offset) / thickness;
    const k = Math.floor(x);
    const f = x - k;
    const share = 0.45 + 0.4 * hashToUnit(hashU32((Math.imul((k + 4096) >>> 0, 747796405) + seed) >>> 0));
    // The walker's ground is the finest drawn (vertices under half a metre
    // apart): the ledge's narrowest share of the bed's width.
    const riser = smoothstep(0.94 - 0.16, 0.94, f);
    const stepped = (k + (1 - share) * f + share * riser) * thickness - offset;
    return smax(stepped, h - 0.5 * thickness, 1.5);
};

/** What is under a spot on Mars besides its height (the bed system), for shaders and tests. */
export interface MarsSpot { beds: number; thickness: number; volcanic: number; layered: number }

const surface = (body: ExpeditionBody, x: number, y: number, z: number, spot: MarsSpot | null) => {
    const m = frameOf(body).elements;
    const s = body.biome!.seed >>> 0;
    const R = body.radius;
    // The map's height, and its own slope: steep where a canyon, a crater or the volcano's cliff is.
    const { height: ground, steep } = molaAt(m, x, y, z);
    const lat = latLon.lat;
    const lon = latLon.lon;

    const km = ground / Number((heightScale(body) * 1000).toFixed(4));
    const box = (s0: number, n0: number, w0: number, e0: number, edge: number) =>
        smoothstep(s0 - edge, s0 + edge, lat) * (1 - smoothstep(n0 - edge, n0 + edge, lat))
        * smoothstep(w0 - edge, w0 + edge, lon) * (1 - smoothstep(e0 - edge, e0 + edge, lon));
    const volcanic = Math.max(box(-25, 40, -140, -95, 6) * smoothstep(0, 3, km), box(12, 38, 135, 160, 4) * smoothstep(-2, 0.5, km));
    const lowland = 1 - smoothstep(-3.6, -1.6, km);
    const highland = (1 - lowland) * (1 - volcanic);
    const field = mfbm(x * 3.5, y * 3.5, z * 3.5, s + 3, 2);
    // Round the landing ground (south of Jezero) the country is layered for a kilometre or so.
    const dLat = lat - LANDING_LAYERS[0];
    const dLon = (lon - LANDING_LAYERS[1]) * Math.cos(lat * Math.PI / 180);
    const home = 1 - smoothstep(9, 16, Math.sqrt(dLat * dLat + dLon * dLon));
    const layered = Math.max(smoothstep(-0.05, 0.2, field), home) * (1 - volcanic) * (1 - 0.7 * lowland);

    const swell = mfbm(x * 16, y * 16, z * 16, s, 3) * (4 + 8 * highland + 2 * volcanic);
    const big = marsCraters(x * 20, y * 20, z * 20, s + 3, 0.18 + 0.3 * highland) * (14 + 12 * highland);
    const erosion = mfbm(x * 42, y * 42, z * 42, s + 5, 4);
    const stack = smoothstep(0.06, 0.26, erosion) * layered * (24 + 12 * mnoise(x * 2.5, y * 2.5, z * 2.5, s + 13));
    const flows = volcanic > 0 ? mridged(x * 26, y * 26, z * 26, s + 17, 3) * 5 * volcanic : 0;
    let h = ground + swell + big + stack + flows;
    const bedMask = Math.max(layered, smoothstep(0.55, 1.1, steep));
    const thickness = BED * (1 + 0.3 * mnoise(x * 2, y * 2, z * 2, s + 23));
    if (bedMask > 0) {
        // Each bed worn back by its own amount: the noise is read at the
        // height too, so every level of the cliff has its own outline.
        h += 2.5 * bedMask * mnoise(x * 300, y * 300 + h * 0.15, z * 300, s + 61);
        const dip = dips.get(body.id)!;
        const offset = (dip.x * x + dip.y * y + dip.z * z) * R;
        h += (beds(h, offset, thickness, s) - h) * bedMask;
    }
    const small = marsCraters(x * 120, y * 120, z * 120, s + 7, 0.12 + 0.12 * highland) * 3.5;
    const detail = mfbm(x * 190, y * 190, z * 190, s + 41, 3) * 1.4;
    if (spot) {
        spot.beds = bedMask;
        spot.thickness = thickness;
        spot.volcanic = volcanic;
        spot.layered = layered;
    }
    return h + small + detail;
};

const dips = new Map<string, THREE.Vector3>();

/** Mars's height function (see createHeightFunction). */
export const marsHeightFunction = (body: ExpeditionBody) => {
    if (!dips.has(body.id)) dips.set(body.id, dipOf(body));
    return (x: number, y: number, z: number) => surface(body, x, y, z, null);
};

/** Everything about a spot on Mars: its height, with `spot` filled in. */
export const marsSpot = (body: ExpeditionBody, direction: THREE.Vector3, spot: MarsSpot) => {
    if (!dips.has(body.id)) dips.set(body.id, dipOf(body));
    return surface(body, direction.x, direction.y, direction.z, spot);
};

// ---- GPU -------------------------------------------------------------------

/**
 * GLSL for Mars's ground: `terrainSurface`, `terrainHeight`, `terrainCover`,
 * as the other worlds have them. Each call also leaves the bed system of the
 * spot in gBeds (how much the ground is laid in beds there) and gBedT (their
 * thickness), for the vertex shader to pass on, and in gMola the map's own
 * height there. Needs NOISE_GLSL and marsUniforms().
 */
export const marsGLSL = (body: ExpeditionBody) => {
    const s = `${body.biome!.seed >>> 0}u`;
    const R = body.radius.toFixed(1);
    const f = (v: number) => v.toFixed(4);
    const oct = (freq: number, max: number) => `octaves(${freq.toFixed(1)}, ${max}, spacing)`;
    return /* glsl */ `
uniform sampler2D uMarsGlobal;
uniform sampler2D uMarsOlympus;
uniform mat3 uMarsFrame;
uniform vec3 uMarsDip;
float gBeds;
float gBedT;
float gMola;

int octaves(float baseFreq, int maxOctaves, float spacing) {
    float feature = ${R} / (baseFreq * 1.5 * max(spacing, 0.01));
    return clamp(int(floor(log2(max(feature, 1.0)))) + 1, 1, maxOctaves);
}

// MOLA at a direction: its height (game metres) and its own slope (rise over
// run); ll gets latitude and longitude (degrees).
vec2 marsMola(vec3 d, out vec2 ll) {
    vec3 g = uMarsFrame * d;
    float lon = atan(g.z, g.x);
    float lat = asin(clamp(g.y, -1.0, 1.0));
    ll = vec2(lat, lon) * 57.29577951;
    vec2 h = textureLod(uMarsGlobal, vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265), 0.0).rg;
    vec2 o = vec2((ll.y - (${f(OLYMPUS.west)})) / ${f(OLYMPUS.east - OLYMPUS.west)}, (${f(OLYMPUS.north)} - ll.x) / ${f(OLYMPUS.north - OLYMPUS.south)});
    if (o.x > 0.0 && o.x < 1.0 && o.y > 0.0 && o.y < 1.0) {
        float w = smoothstep(0.0, 0.06, min(min(o.x, 1.0 - o.x), min(o.y, 1.0 - o.y)));
        h = mix(h, textureLod(uMarsOlympus, o, 0.0).rg, w);
    }
    return h;
}

// The map at a direction a vertex's width from one whose latitude and
// longitude are known: those carried over to first order, without the
// arctangent and arcsine (for the neighbours a vertex's slope is taken from).
vec2 marsMolaNear(vec3 d, vec3 dRef, vec2 llRef) {
    vec3 g = uMarsFrame * d;
    vec3 r = uMarsFrame * dRef;
    float lon = radians(llRef.y) + (r.x * (g.z - r.z) - r.z * (g.x - r.x)) / max(r.x * r.x + r.z * r.z, 1e-12);
    float lat = radians(llRef.x) + (g.y - r.y) / sqrt(max(1.0 - r.y * r.y, 1e-12));
    vec2 ll = degrees(vec2(lat, lon));
    vec2 h = textureLod(uMarsGlobal, vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.14159265), 0.0).rg;
    vec2 o = vec2((ll.y - (${f(OLYMPUS.west)})) / ${f(OLYMPUS.east - OLYMPUS.west)}, (${f(OLYMPUS.north)} - ll.x) / ${f(OLYMPUS.north - OLYMPUS.south)});
    if (o.x > 0.0 && o.x < 1.0 && o.y > 0.0 && o.y < 1.0) {
        float w = smoothstep(0.0, 0.06, min(min(o.x, 1.0 - o.x), min(o.y, 1.0 - o.y)));
        h = mix(h, textureLod(uMarsOlympus, o, 0.0).rg, w);
    }
    return h;
}

// Gradient noise with each lattice corner hashed once (see mnoise in mars.ts).
uint marsCorner(uvec3 i, uint seed) {
    return hashU32((i.x * 0x8da6b343u) ^ (i.y * 0xd8163841u) ^ (i.z * 0xcb1ab31fu) ^ seed);
}

float mnoise(vec3 p, uint seed) {
    vec3 fl = floor(p);
    vec3 f = p - fl;
    uvec3 i = uvec3(ivec3(fl) + NOISE_OFFSET);
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n000 = gradDot(marsCorner(i, seed), f);
    float n100 = gradDot(marsCorner(i + uvec3(1u, 0u, 0u), seed), f - vec3(1.0, 0.0, 0.0));
    float n010 = gradDot(marsCorner(i + uvec3(0u, 1u, 0u), seed), f - vec3(0.0, 1.0, 0.0));
    float n110 = gradDot(marsCorner(i + uvec3(1u, 1u, 0u), seed), f - vec3(1.0, 1.0, 0.0));
    float n001 = gradDot(marsCorner(i + uvec3(0u, 0u, 1u), seed), f - vec3(0.0, 0.0, 1.0));
    float n101 = gradDot(marsCorner(i + uvec3(1u, 0u, 1u), seed), f - vec3(1.0, 0.0, 1.0));
    float n011 = gradDot(marsCorner(i + uvec3(0u, 1u, 1u), seed), f - vec3(0.0, 1.0, 1.0));
    float n111 = gradDot(marsCorner(i + uvec3(1u, 1u, 1u), seed), f - vec3(1.0, 1.0, 1.0));
    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z
    );
}

float mfbm(vec3 p, uint seed, int octaves) {
    float sum = 0.0;
    float amplitude = 1.0;
    float frequency = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        sum += amplitude * mnoise(p * frequency, seed + uint(i) * 1013u);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return sum;
}

float mridged(vec3 p, uint seed, int octaves) {
    float sum = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    float weight = 1.0;
    for (int i = 0; i < 8; i++) {
        if (i >= octaves) break;
        float n = 1.0 - abs(mnoise(p * frequency, seed + uint(i) * 1013u));
        n *= n * weight;
        weight = clamp(n * 2.0, 0.0, 1.0);
        sum += n * amplitude;
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return sum;
}

// The craters that reach a point, found once (up to four: centre and radius
// in a0..a3, how far sand has filled each and how fresh it is in b01 and b23;
// radius 0 = an empty slot), so a vertex and its two neighbours, a fraction
// of a metre apart, share the search. Fixed slots, not arrays: Direct3D's
// shader compiler (Chrome and Edge on Windows) stalls on arrays indexed at
// run time, long enough for the browser to reset the graphics card.
struct MarsCraters { vec4 a0; vec4 a1; vec4 a2; vec4 a3; vec4 b01; vec4 b23; };

MarsCraters marsNoCraters() {
    MarsCraters list;
    list.a0 = vec4(0.0);
    list.a1 = vec4(0.0);
    list.a2 = vec4(0.0);
    list.a3 = vec4(0.0);
    list.b01 = vec4(0.0);
    list.b23 = vec4(0.0);
    return list;
}

MarsCraters marsCraterList(vec3 p, uint seed, float density) {
    MarsCraters list = marsNoCraters();
    vec3 base = floor(p + 0.5) - 1.0;
    for (int k = 0; k < 8; k++) {
        vec3 c = base + vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
        uint h = marsCorner(uvec3(ivec3(c) + NOISE_OFFSET), seed);
        if (hashToUnit(h) >= density) continue;
        uint h2 = hashU32(h + 0x9e3779b9u);
        uint h3 = hashU32(h2);
        uint h4 = hashU32(h3 + 17u);
        vec4 a = vec4(c + vec3(float(h2 & 1023u), float((h2 >> 10u) & 1023u), float((h2 >> 20u) & 1023u)) / 1023.0, 0.08 + hashToUnit(h3) * 0.2);
        // Only a crater whose rim reaches this point (with a margin for the neighbours).
        if (length(p - a.xyz) >= a.w * 1.8) continue;
        vec2 b = vec2(0.4 + 0.45 * hashToUnit(h4), 0.45 + 0.55 * hashToUnit(hashU32(h4 + 29u)));
        list.a3 = list.a2;
        list.a2 = list.a1;
        list.a1 = list.a0;
        list.a0 = a;
        list.b23 = vec4(list.b01.zw, list.b23.xy);
        list.b01 = vec4(b, list.b01.xy);
    }
    return list;
}

// One crater: a bowl that sand has filled to a flat floor, its rim worn low.
float marsCrater(vec3 p, vec4 a, vec2 b) {
    if (a.w <= 0.0) return 0.0;
    float r = length(p - a.xyz) / a.w;
    if (r >= 1.7) return 0.0;
    return b.y * (r < 1.0 ? max(-1.0 + 1.3 * r * r, -b.x) : 0.3 * (1.0 - smoothstep(1.0, 1.7, r)));
}

// Bowls that sand has filled to a flat floor, rims worn low, some old and shallow.
float marsCraterSum(vec3 p, MarsCraters list) {
    return marsCrater(p, list.a0, list.b01.xy) + marsCrater(p, list.a1, list.b01.zw)
        + marsCrater(p, list.a2, list.b23.xy) + marsCrater(p, list.a3, list.b23.zw);
}

// Level beds: a ledge where each bed's harder top stands, a slope of debris
// below it. Where vertices are sparse the ledge widens, so far-off cliffs do
// not alias into teeth.
float marsSmax(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return max(a, b) + h * h * k * 0.25;
}

float marsBeds(float h, float offset, float thickness, float spacing) {
    float x = (h + offset) / thickness;
    float k = floor(x);
    float f = x - k;
    float share = 0.45 + 0.4 * hashToUnit(hashU32(uint(int(k) + 4096) * 747796405u + ${s}));
    float width = clamp(0.16 + max(spacing - 0.5, 0.0) * 0.9 / thickness, 0.16, 0.9);
    float riser = smoothstep(0.94 - width, 0.94, f);
    float stepped = (k + (1.0 - share) * f + share * riser) * thickness - offset;
    return marsSmax(stepped, h - 0.5 * thickness, 1.5);
}

// The slowly changing character of the ground (what kind of country it is,
// whether it is layered, how tall its stacks of beds stand and how thick the
// beds are), which changes over kilometres: the terrain's vertex shader works
// it out once for a vertex and its two neighbours.
struct MarsRegion { float volcanic; float highland; float layered; float stack; float bedT; };

MarsRegion marsRegion(vec3 d, float km, vec2 ll) {
    MarsRegion r;
    float tharsis = smoothstep(-31.0, -19.0, ll.x) * (1.0 - smoothstep(34.0, 46.0, ll.x)) * smoothstep(-146.0, -134.0, ll.y) * (1.0 - smoothstep(-101.0, -89.0, ll.y));
    float elysium = smoothstep(8.0, 16.0, ll.x) * (1.0 - smoothstep(34.0, 42.0, ll.x)) * smoothstep(131.0, 139.0, ll.y) * (1.0 - smoothstep(156.0, 164.0, ll.y));
    r.volcanic = max(tharsis * smoothstep(0.0, 3.0, km), elysium * smoothstep(-2.0, 0.5, km));
    float lowland = 1.0 - smoothstep(-3.6, -1.6, km);
    r.highland = (1.0 - lowland) * (1.0 - r.volcanic);
    float field = mfbm(d * 3.5, ${s} + 3u, 2);
    vec2 fromHome = vec2(ll.x - ${f(-4.5)}, (ll.y - ${f(78)}) * cos(radians(ll.x)));
    float home = 1.0 - smoothstep(9.0, 16.0, length(fromHome));
    r.layered = max(smoothstep(-0.05, 0.2, field), home) * (1.0 - r.volcanic) * (1.0 - 0.7 * lowland);
    r.stack = 24.0 + 12.0 * mnoise(d * 2.5, ${s} + 13u);
    r.bedT = ${f(BED)} * (1.0 + 0.3 * mnoise(d * 2.0, ${s} + 23u));
    return r;
}

// The map at a direction, and the region round it: rg and mola come back.
MarsRegion marsRegionAt(vec3 d, out vec2 mola, out vec2 ll) {
    mola = marsMola(d, ll);
    return marsRegion(d, mola.x / ${f(heightScale(body) * 1000)}, ll);
}

// The three sizes of crater round a direction (none where the vertices are too far apart to draw them).
void marsCraterLists(vec3 d, float spacing, MarsRegion rg, out MarsCraters big, out MarsCraters small) {
    big = marsNoCraters();
    small = marsNoCraters();
    if (spacing < 24.0) big = marsCraterList(d * 20.0, ${s} + 3u, 0.18 + 0.3 * rg.highland);
    if (spacing < 5.0) small = marsCraterList(d * 120.0, ${s} + 7u, 0.12 + 0.12 * rg.highland);
}

// The height at a direction, given the map there (height, slope), the region and the craters round it.
float marsHeightWith(vec3 d, float spacing, MarsRegion rg, vec2 mola, MarsCraters bigC, MarsCraters smallC) {
    gMola = mola.x;
    float swell = mfbm(d * 16.0, ${s}, ${oct(16, 3)}) * (4.0 + 8.0 * rg.highland + 2.0 * rg.volcanic);
    float big = marsCraterSum(d * 20.0, bigC) * (14.0 + 12.0 * rg.highland) * (1.0 - smoothstep(12.0, 24.0, spacing));
    float erosion = mfbm(d * 42.0, ${s} + 5u, ${oct(42, 4)});
    float stack = smoothstep(0.06, 0.26, erosion) * rg.layered * rg.stack;
    float flows = rg.volcanic > 0.0 ? mridged(d * 26.0, ${s} + 17u, ${oct(26, 3)}) * 5.0 * rg.volcanic : 0.0;
    float h = mola.x + swell + big + stack + flows;
    gBeds = max(rg.layered, smoothstep(0.55, 1.1, mola.y));
    gBedT = rg.bedT;
    if (gBeds > 0.0) {
        if (spacing < 12.0) h += 2.5 * gBeds * mnoise(d * 300.0 + vec3(0.0, h * 0.15, 0.0), ${s} + 61u);
        h = mix(h, marsBeds(h, dot(d, uMarsDip) * ${R}, gBedT, spacing), gBeds);
    }
    float small = marsCraterSum(d * 120.0, smallC) * 3.5 * (1.0 - smoothstep(2.5, 5.0, spacing));
    float detail = spacing < 30.0 ? mfbm(d * 190.0, ${s} + 41u, ${oct(190, 3)}) * 1.4 : 0.0;
    return h + small + detail;
}

float marsHeightAt(vec3 d, float spacing, MarsRegion rg, vec2 mola) {
    MarsCraters bigC;
    MarsCraters smallC;
    marsCraterLists(d, spacing, rg, bigC, smallC);
    return marsHeightWith(d, spacing, rg, mola, bigC, smallC);
}

float terrainHeight(vec3 d, float spacing) {
    vec2 mola;
    vec2 ll;
    MarsRegion rg = marsRegionAt(d, mola, ll);
    return marsHeightAt(d, spacing, rg, mola);
}

float terrainSurface(vec3 d, float spacing, out vec2 water) {
    water = vec2(0.0, 1e4);
    return terrainHeight(d, spacing);
}

float terrainCover(vec3 d) {
    return 0.0;
}
`;
};
