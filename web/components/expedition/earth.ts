import * as THREE from 'three';
import { trackLoad } from './loadProgress';
import { fbm, ridged, smoothstep } from './noise';
import type { ExpeditionBody } from './bodies';
import { globeFrame } from './sites';

/**
 * Earth's own ground, from NASA's maps rather than invented: where the seas
 * are, how high the land stands, and where it is wooded.
 *
 * public/textures/expedition/earth-data.webp (4096 x 2048, equirectangular,
 * row 0 at the north pole, column 0 at longitude -180; see its ATTRIBUTION.md)
 * was made from NASA Visible Earth's GEBCO 2008 elevation and bathymetry and
 * the Blue Marble of September 2004:
 *   R  distance to the coast in game metres, 128 + s / 4.6, land positive
 *   G  the continent's height in game metres (land), or the sea's depth
 *   B  tree cover, 0 to 255, from the Blue Marble's colour
 *
 * On that the ground is built the same way on the CPU (landing, walking,
 * placing things) and on the GPU (drawing it): a shore that rises gently from
 * the sea to the continent's height, plains that roll a little and uplands
 * that rise into ridges, and rivers wherever the zero lines of a warped,
 * smooth noise field run across the land, each in a flat valley with its
 * channel cut below the river's level. The river's level follows the continent's height down to
 * the sea. Under the sea, and in the rivers, the ground reported is the
 * water's surface; how deep the water is there is reported alongside.
 *
 * The map is loaded before the expedition starts (loadEarthMap); if it cannot
 * be, Earth keeps the invented ground the other worlds have.
 */

const DATA_URL = 'textures/expedition/earth-data.webp';
/** Game metres per step of the map's coast distance. */
const COAST_STEP = 4.6;
/**
 * Where the river field is sampled from: chosen (by probing, see riverProbe)
 * so that a river winds across the view from the landing spot by Dallas.
 */
const RIVER_SHIFT: [number, number, number] = [33.663, 32.484, 22.607];

interface EarthMap { bytes: Uint8ClampedArray; width: number; height: number; texture: THREE.DataTexture }
let map: EarthMap | null = null;
let loading: Promise<EarthMap | null> | null = null;

/** Fetch and decode the map once; resolves to null if it cannot be had. */
export const loadEarthMap = () => {
    if (!loading) {
        loading = trackLoad(new THREE.ImageLoader().loadAsync(`${import.meta.env.BASE_URL}${DATA_URL}`)).then((image) => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d', { willReadFrequently: true })!;
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(0, 0, image.width, image.height);
            // The GPU reads the very bytes the CPU does, so both build the same ground.
            const texture = new THREE.DataTexture(new Uint8Array(pixels.data.buffer), image.width, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.magFilter = THREE.LinearFilter;
            texture.minFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
            map = { bytes: pixels.data, width: image.width, height: image.height, texture };
            settled = true;
            return map;
        }).catch((error) => {
            console.warn('The Earth map could not be loaded; Earth keeps invented ground.', error);
            settled = true;
            return null;
        });
    }
    return loading;
};

/** Whether this world's ground comes from the Earth map. */
export const usesEarthMap = (body: ExpeditionBody) => !!body.globe?.water && map !== null;

/** Whether the map has either arrived or failed (until then Earth's ground is not settled). */
let settled = false;
export const earthMapSettled = () => settled;

const frames = new Map<string, THREE.Matrix3>();
const frameOf = (body: ExpeditionBody) => {
    let frame = frames.get(body.id);
    if (!frame) {
        frame = globeFrame(body);
        frames.set(body.id, frame);
    }
    return frame;
};

/** Uniforms for any material whose shader includes the Earth ground (see earthGLSL). */
export const earthUniforms = (body: ExpeditionBody) => ({
    uEarthData: { value: map!.texture },
    uEarthFrame: { value: frameOf(body) },
});

// ---- CPU -------------------------------------------------------------------

const sample = [0, 0, 0];
/** The map at a direction (bilinear, as the GPU filters it): coast distance, height, cover. */
const readMap = (frame: THREE.Matrix3, x: number, y: number, z: number) => {
    const m = frame.elements;
    // Rows of the frame: longitude 0, north, longitude 90 east (column-major storage).
    const gx = m[0] * x + m[3] * y + m[6] * z;
    const gy = m[1] * x + m[4] * y + m[7] * z;
    const gz = m[2] * x + m[5] * y + m[8] * z;
    const u = Math.atan2(gz, gx) / (Math.PI * 2) + 0.5;
    const t = 0.5 - Math.asin(Math.min(1, Math.max(-1, gy))) / Math.PI;
    const { bytes, width, height } = map!;
    const fx = u * width - 0.5;
    const fy = t * height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const xa = ((x0 % width) + width) % width;
    const xb = (xa + 1) % width;
    const ya = Math.min(Math.max(y0, 0), height - 1);
    const yb = Math.min(Math.max(y0 + 1, 0), height - 1);
    for (let c = 0; c < 3; c++) {
        const p = bytes[(ya * width + xa) * 4 + c];
        const q = bytes[(ya * width + xb) * 4 + c];
        const r = bytes[(yb * width + xa) * 4 + c];
        const s = bytes[(yb * width + xb) * 4 + c];
        const top = p + (q - p) * ax;
        sample[c] = top + (r + (s - r) * ax - top) * ay;
    }
    sample[0] = (sample[0] - 128) * COAST_STEP;
    sample[2] /= 255;
    return sample;
};

/** What lies at a spot on Earth besides its height. */
export interface EarthSpot {
    /** Depth of water over the ground (0 on dry land). */
    water: number;
    /** Distance from the sea's shore, metres (negative out to sea). */
    shore: number;
    /** Tree cover, 0 to 1. */
    cover: number;
    /** 1 on a river's valley floor, falling to 0 on its banks. */
    valley: number;
}

/**
 * How far a river's valley floor stands above the water, by the river field's reach: it shelves
 * gently into the water instead of standing a metre above it. (A metre's step at the edge, drawn
 * between corners metres apart that are either under water or on the floor, was a row of short
 * steep faces along the bank: dark teeth on every far shore.)
 */
const riverBank = (reach: number) => smoothstep(0.026, 0.07, reach);

/**
 * The ground on Earth at a unit direction: its height (the water's surface
 * where there is water), with `spot` filled in. Mirrors terrainSurface() in
 * earthGLSL exactly, at full detail.
 */
const surface = (frame: THREE.Matrix3, seed: number, x: number, y: number, z: number, spot: EarthSpot) => {
    const [coast, cont, cover] = readMap(frame, x, y, z);
    const s = coast + fbm(x * 350, y * 350, z * 350, seed + 61, 2) * 20;
    spot.shore = s;
    spot.cover = cover;
    spot.valley = 0;
    if (s < 0) {
        spot.water = Math.min(-s * 0.12, cont);
        return 0;
    }
    const land = Math.min(s * 0.07, cont);
    const rough = 1 + 6 * smoothstep(40, 150, cont);
    const hills = fbm(x * 60, y * 60, z * 60, seed + 11, 5) * 7 * rough;
    const ridgeAmount = smoothstep(90, 170, cont);
    const ridge = ridgeAmount > 0 ? ridged(x * 24, y * 24, z * 24, seed + 23, 4) * ridgeAmount * 70 : 0;
    const detail = fbm(x * 320, y * 320, z * 320, seed + 37, 4) * 2.2;
    let h = Math.max(land + (hills + ridge + detail) * smoothstep(0, 70, s), 0);
    // Rivers.
    const qx0 = x * 38 + RIVER_SHIFT[0];
    const qy0 = y * 38 + RIVER_SHIFT[1];
    const qz0 = z * 38 + RIVER_SHIFT[2];
    const wx = fbm(qx0 * 0.6, qy0 * 0.6, qz0 * 0.6, seed + 71, 2);
    const wy = fbm(qx0 * 0.6 + 17, qy0 * 0.6 + 17, qz0 * 0.6 + 17, seed + 73, 2);
    const n = Math.abs(fbm(qx0 + wx * 0.9, qy0 + wy * 0.9, qz0, seed + 79, 1));
    // Where rivers may run; towards the edge of that they narrow to nothing
    // (rather than growing shallow), so each ends cleanly.
    const allow = smoothstep(-0.25, 0.05, fbm(x * 9, y * 9, z * 9, seed + 83, 2)) * smoothstep(-5, 5, s);
    const reach = n / Math.max(allow, 1e-3);
    const valley = 1 - smoothstep(0.05, 0.16, reach);
    const channel = 1 - smoothstep(0.012, 0.035, reach);
    const level = Math.max(land - 1.2, 0);
    h += (level + riverBank(reach) - h) * valley;
    const bed = h - channel * 3.2;
    spot.valley = valley;
    if (channel > 0 && bed < level) {
        spot.water = level - bed;
        return level;
    }
    spot.water = 0;
    return h;
};

const scratch: EarthSpot = { water: 0, shore: 0, cover: 0, valley: 0 };

/**
 * Test harnesses only: how near a river's channel runs to a spot for a given
 * shift of the river field (0 far from any; 1 in the middle of one).
 */
export const riverProbe = (x: number, y: number, z: number, shift: [number, number, number], seed = 1201) => {
    const qx0 = x * 38 + shift[0];
    const qy0 = y * 38 + shift[1];
    const qz0 = z * 38 + shift[2];
    const wx = fbm(qx0 * 0.6, qy0 * 0.6, qz0 * 0.6, seed + 71, 2);
    const wy = fbm(qx0 * 0.6 + 17, qy0 * 0.6 + 17, qz0 * 0.6 + 17, seed + 73, 2);
    const n = Math.abs(fbm(qx0 + wx * 0.9, qy0 + wy * 0.9, qz0, seed + 79, 1));
    const allow = smoothstep(-0.25, 0.05, fbm(x * 9, y * 9, z * 9, seed + 83, 2));
    return 1 - smoothstep(0.012, 0.035, n / Math.max(allow, 1e-3));
};

/** Earth's height function (see createHeightFunction). */
export const earthHeightFunction = (body: ExpeditionBody) => {
    const frame = frameOf(body);
    const seed = body.biome!.seed >>> 0;
    return (x: number, y: number, z: number) => surface(frame, seed, x, y, z, scratch);
};

/** Everything about a spot on Earth: height, and `spot` filled in. */
export const earthSpot = (body: ExpeditionBody, direction: THREE.Vector3, spot: EarthSpot) =>
    surface(frameOf(body), body.biome!.seed >>> 0, direction.x, direction.y, direction.z, spot);

// ---- GPU -------------------------------------------------------------------

/**
 * GLSL for Earth's ground: `float terrainSurface(vec3 d, float spacing, out
 * vec2 water)` (water.x the depth of water, water.y the distance from the
 * shore), `float terrainHeight(vec3 d, float spacing)` and `float
 * terrainCover(vec3 d)`. Needs NOISE_GLSL and earthUniforms().
 */
export const earthGLSL = (body: ExpeditionBody) => {
    const s = `${body.biome!.seed >>> 0}u`;
    const R = body.radius.toFixed(1);
    const oct = (freq: number, max: number) => `octaves(${freq.toFixed(1)}, ${max}, spacing)`;
    return /* glsl */ `
uniform sampler2D uEarthData;
uniform mat3 uEarthFrame;

int octaves(float baseFreq, int maxOctaves, float spacing) {
    float feature = ${R} / (baseFreq * 1.5 * max(spacing, 0.01));
    return clamp(int(floor(log2(max(feature, 1.0)))) + 1, 1, maxOctaves);
}

// The Earth map at a direction: distance to the coast (m, land positive),
// the continent's height or the sea's depth (m), tree cover (0..1).
vec3 earthMap(vec3 d) {
    vec3 g = uEarthFrame * d;
    vec2 uv = vec2(atan(g.z, g.x) / 6.2831853 + 0.5, 0.5 - asin(clamp(g.y, -1.0, 1.0)) / 3.14159265);
    vec3 v = textureLod(uEarthData, uv, 0.0).rgb * 255.0;
    return vec3((v.r - 128.0) * ${COAST_STEP.toFixed(1)}, v.g, v.b / 255.0);
}

// Set by terrainSurface: which side of the nearest river's centre line a spot is on and how far,
// in the river field's own units (its channel is where |gRiver| < 0.035). Unlike the depth of water,
// which is nothing on every dry spot, it runs smoothly across a river and out past its banks, so it
// can be drawn between far-apart corners without the bank turning into a row of teeth.
float gRiver = 1.0;

// How far a river's valley floor stands above the water (riverBank in earth.ts).
float riverBank(float reach) {
    return smoothstep(0.026, 0.07, reach);
}

float terrainSurface(vec3 d, float spacing, out vec2 water) {
    vec3 e = earthMap(d);
    float s = e.x + fbm(d * 350.0, ${s} + 61u, 2, 2.0, 0.5) * 20.0;
    water = vec2(0.0, s);
    gRiver = 1.0;
    if (s < 0.0) {
        water.x = min(-s * 0.12, e.y);
        return 0.0;
    }
    float land = min(s * 0.07, e.y);
    float rough = 1.0 + 6.0 * smoothstep(40.0, 150.0, e.y);
    float hills = fbm(d * 60.0, ${s} + 11u, ${oct(60, 5)}, 2.0, 0.5) * 7.0 * rough;
    float ridgeAmount = smoothstep(90.0, 170.0, e.y);
    float ridge = ridgeAmount > 0.0 ? ridged(d * 24.0, ${s} + 23u, ${oct(24, 4)}) * ridgeAmount * 70.0 : 0.0;
    float detail = spacing < 30.0 ? fbm(d * 320.0, ${s} + 37u, ${oct(320, 4)}, 2.0, 0.5) * 2.2 : 0.0;
    float h = max(land + (hills + ridge + detail) * smoothstep(0.0, 70.0, s), 0.0);
    vec3 q = d * 38.0 + vec3(${RIVER_SHIFT.map((v) => v.toFixed(3)).join(', ')});
    vec2 warp = vec2(fbm(q * 0.6, ${s} + 71u, 2, 2.0, 0.5), fbm(q * 0.6 + 17.0, ${s} + 73u, 2, 2.0, 0.5));
    float signedN = fbm(q + vec3(warp * 0.9, 0.0), ${s} + 79u, 1, 2.0, 0.5);
    float n = abs(signedN);
    float allow = smoothstep(-0.25, 0.05, fbm(d * 9.0, ${s} + 83u, 2, 2.0, 0.5)) * smoothstep(-5.0, 5.0, s);
    float reach = n / max(allow, 1e-3);
    gRiver = signedN / max(allow, 1e-3);
    float valley = 1.0 - smoothstep(0.05, 0.16, reach);
    float channel = 1.0 - smoothstep(0.012, 0.035, reach);
    float level = max(land - 1.2, 0.0);
    h += (level + riverBank(reach) - h) * valley;
    float bed = h - channel * 3.2;
    if (channel > 0.0 && bed < level) {
        water.x = level - bed;
        return level;
    }
    return h;
}

float terrainHeight(vec3 d, float spacing) {
    vec2 water;
    return terrainSurface(d, spacing, water);
}

float terrainCover(vec3 d) {
    return earthMap(d).z;
}

// The field the rivers follow (terrainSurface keeps to where it is near zero): signed.
float riverField(vec3 d) {
    vec3 q = d * 38.0 + vec3(${RIVER_SHIFT.map((v) => v.toFixed(3)).join(', ')});
    vec2 warp = vec2(fbm(q * 0.6, ${s} + 71u, 2, 2.0, 0.5), fbm(q * 0.6 + 17.0, ${s} + 73u, 2, 2.0, 0.5));
    return fbm(q + vec3(warp * 0.9, 0.0), ${s} + 79u, 1, 2.0, 0.5);
}

// Which way a river runs here, along the ground (a unit direction from Earth's centre's frame):
// along the line its field is zero on, so across that field's slope, and the way that goes
// towards the sea (down the map's distance from the coast).
vec3 riverFlow(vec3 d) {
    vec3 t1 = normalize(cross(abs(d.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), d));
    vec3 t2 = cross(d, t1);
    const float e = 3e-5;
    float f0 = riverField(d);
    vec3 slope = t1 * (riverField(normalize(d + t1 * e)) - f0) + t2 * (riverField(normalize(d + t2 * e)) - f0);
    vec3 along = cross(d, slope);
    float size = length(along);
    if (size < 1e-12) return vec3(0.0);
    along /= size;
    const float reach = 2.5e-3;
    float ahead = earthMap(normalize(d + along * reach)).x;
    float behind = earthMap(normalize(d - along * reach)).x;
    return ahead > behind ? -along : along;
}
`;
};
