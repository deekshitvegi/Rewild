import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { compileSafely } from './compileSafely';

/**
 * Clouds with volume: a pass after the scene that marches each view ray
 * through layers of cloud wrapped round the world below, lit by the sun,
 * with the scene's depth so anything in front of a cloud covers it and a
 * cloud in front of the ship covers the ship. Flying into a deck, the
 * ship is inside it: no flat sheets, no edges.
 *
 * The cloud shapes come from a small tiling volume of noise drawn once on the
 * GPU (billowing Perlin-Worley for the shapes, Worley for the eroded edges,
 * a slow field for where the sky is cloudy at all). Each sample costs a few
 * lookups in it, so a ray can take dozens of steps.
 */
export interface CloudLayerSpec {
    /** Base and top of the layer, above the body's radius (negative below it). */
    bottom: number;
    top: number;
    /** How much of the sky it covers, 0 to 1. */
    coverage: number;
    /** Extinction at full density, per unit of path. */
    density: number;
    /** Size of its cloud shapes, in units. */
    scale: number;
    /** How much the fine noise eats into the edges (wispy) 0 to 1. */
    erosion: number;
    /** Where in its height the tops start to round off: 0.55 heaped cumulus, 0.95 flat-topped decks. */
    anvil: number;
    /** Lightning lives in it. */
    storm: number;
    /** Colour in full light, and in its own shade. */
    lit: THREE.ColorRepresentation;
    shade: THREE.ColorRepresentation;
    /** A gas giant's top deck takes its colour from the planet's map. */
    useMap?: boolean;
    /**
     * Thunderstorms (cumulonimbus): towers of cloud on a grid of storm cells
     * this many units apart, one storm to a cell at most (coverage is the
     * chance of one), each with a flat dark base, a lumpy body that widens as
     * it climbs and, on the tallest, an anvil spreading under the top of the
     * layer with an overshooting dome above it.
     */
    towers?: number;
    /**
     * High cirrus: streaks of ice stretched east-west this many times longer
     * than they are wide, in bands of latitude; they shade the clouds below.
     */
    cirrus?: number;
    /**
     * The walls of the great vortices (vortices.ts): eyewalls round a clear eye,
     * spiral arms of towering cloud, standing from the storm deck to above the tops.
     */
    vortex?: boolean;
    /**
     * A storm cell over the ground (CloudScene.cell): a dust storm's front, a
     * wall of dust standing up off the ground, and the air inside it.
     */
    dust?: boolean;
    /**
     * A thunderstorm cell over the ground (CloudScene.cell): a cumulonimbus,
     * its flat dark base, its tower, its anvil, the rain curtain under it.
     */
    thunder?: boolean;
    /**
     * Earth's fair-weather cumulus: cloudy where its deck is (CloudScene.cover, the deck's own
     * cover map), heaped up out of it here, so from space and from under them they are the same clouds.
     */
    cover?: boolean;
}

/** A storm cell over the ground, packed for the march (cloudScenes.ts fills it). */
export interface CloudCell {
    /** Its centre (unit, from the world's centre) and its angular radius. */
    a: THREE.Vector4;
    /** Its drift (unit, along the ground at its centre) and how strong it is now, 0 to 1. */
    b: THREE.Vector4;
    /** The ground's height at the camera, the head's (or cloud top's) height, the cloud base's height (thunderstorms), how far the edge wanders in and out (m). */
    c: THREE.Vector4;
    /** A sphere round all of it (centre, radius), so rays that miss it march nothing. */
    bound: THREE.Vector4;
    /** How many times wider than long it is (across its drift), unused x3. */
    d: THREE.Vector4;
}

export interface CloudScene {
    /** The world the layers wrap, in scene coordinates (camera-relative origin). */
    centre: THREE.Vector3;
    radius: number;
    axis: THREE.Vector3;
    layers: CloudLayerSpec[];
    /** Direction to the sun, and its light (HDR). */
    sun: THREE.Vector3;
    sunColor: THREE.Color;
    /** Light from the sky above and from below. */
    skyTop: THREE.Color;
    skyBottom: THREE.Color;
    /** The haze the clouds fade into with distance, and how far one sees through it. */
    haze: THREE.Color;
    visibility: number;
    /** How far out clouds are drawn (beyond, the planet's own surface shows). */
    reach: number;
    /** The wind's offset of the cloud pattern so far. */
    wind: THREE.Vector3;
    /** A lightning stroke, relative to the world's centre, and how bright it is now. */
    flash: THREE.Vector3;
    flashLevel: number;
    map: THREE.Texture | null;
    /** How far the cirrus streaks have been carried round the planet by the wind (radians). */
    cirrusTurn: number;
    /**
     * The gas between the clouds: extinction per unit at the 1 bar level (x),
     * the height over which it grows e-fold going down (y), on (z = 1).
     */
    murk: THREE.Vector3;
    /** The giant's three cloud decks, their tops and thicknesses: the storm towers are lit by what sunlight gets past them. */
    deckTop: THREE.Vector3;
    deckThick: THREE.Vector3;
    /** The vortices nearest the camera, packed (vortices.packVortex): up to four, unused ones zero. */
    vortexA: THREE.Vector4[];
    vortexB: THREE.Vector4[];
    vortexC: THREE.Vector4[];
    /** The planet frame's first axis (vortices at a pole are measured from it). */
    e1: THREE.Vector3;
    /** The vortex layer's base and top heights (the eye widens with height between them). */
    wall: THREE.Vector2;
    /** Seconds, for the turning of the vortices. */
    time: number;
    /** 0 to 1: the infrared imager's view (heat from the depths, the clouds dark against it). */
    infrared: number;
    /** A storm cell over the ground (layers with `dust`). */
    cell: CloudCell;
    /** How far an eye in the dark opens up: everything seen, clouds and what lies behind them, is brightened this much. */
    exposure: number;
    /** The cloud deck's cover map and the turn into its frame (layers with `cover`). */
    cover: THREE.Texture | null;
    coverFrame: THREE.Matrix3;
    /** At most this many steps a ray (0: the quality's own). */
    steps: number;
}

const NOISE_SIZE = 64;

const noiseFragment = /* glsl */ `
precision highp float;
uniform float uZ;
varying vec2 vUv;

uint hashU(uvec3 v, uint seed) {
    uint h = seed * 747796405u + 2891336453u;
    h ^= v.x * 1664525u; h = h * 1013904223u + (h >> 16);
    h ^= v.y * 22695477u; h = h * 1103515245u + (h >> 13);
    h ^= v.z * 134775813u; h = h * 214013u + (h >> 11);
    h ^= h >> 15; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
    return h;
}
vec3 grad(uint h) {
    return normalize(vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 511.5 - 1.0 + 1e-4);
}
// Gradient noise that repeats every 'period' lattice cells.
float pnoise(vec3 p, float period, uint seed) {
    vec3 i = floor(p);
    vec3 f = p - i;
    vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float n[8];
    for (int k = 0; k < 8; k++) {
        vec3 c = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
        vec3 cell = mod(i + c, period);
        n[k] = dot(grad(hashU(uvec3(cell), seed)), f - c);
    }
    return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y), mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
}
// Distance to the nearest of one random point per cell, repeating every 'period' cells.
float pworley(vec3 p, float period, uint seed) {
    vec3 i = floor(p);
    vec3 f = p - i;
    float best = 9.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
        vec3 c = vec3(float(x), float(y), float(z));
        uint h = hashU(uvec3(mod(i + c, period)), seed);
        vec3 o = vec3(float(h & 1023u), float((h >> 10) & 1023u), float((h >> 20) & 1023u)) / 1023.0;
        vec3 d = c + o - f;
        best = min(best, dot(d, d));
    }
    return sqrt(best);
}
float perlinFbm(vec3 p, float period, uint seed) {
    float sum = 0.0;
    float amp = 0.5;
    for (int k = 0; k < 4; k++) {
        sum += pnoise(p, period, seed + uint(k) * 31u) * amp;
        p *= 2.0;
        period *= 2.0;
        amp *= 0.5;
    }
    return sum;
}
float worleyFbm(vec3 p, float period, uint seed) {
    return (1.0 - pworley(p, period, seed)) * 0.625
        + (1.0 - pworley(p * 2.0, period * 2.0, seed + 7u)) * 0.25
        + (1.0 - pworley(p * 4.0, period * 4.0, seed + 13u)) * 0.125;
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

void main() {
    vec3 p = vec3(vUv, uZ);
    // Shapes: billowing Perlin-Worley, as in Guerrilla's Nubis clouds.
    float perlin = clamp(perlinFbm(p * 4.0, 4.0, 11u) * 1.3 + 0.5, 0.0, 1.0);
    float cells = worleyFbm(p * 4.0, 4.0, 23u);
    float shape = clamp(remap(perlin, cells - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
    shape = clamp(remap(shape, 0.15, 1.0, 0.0, 1.0), 0.0, 1.0);
    // Edges: finer cells to erode them into wisps.
    float detail = worleyFbm(p * 8.0, 8.0, 41u);
    // Where the sky is cloudy at all: a slow field.
    float weather = clamp(perlinFbm(p * 2.0, 2.0, 59u) * 1.4 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(shape, detail, weather, 1.0);
}
`;

/** Draws the tiling noise volume the clouds are cut from, once, on the GPU. */
export const createCloudNoise = (renderer: THREE.WebGLRenderer, size = NOISE_SIZE) => {
    const target = new THREE.WebGL3DRenderTarget(size, size, size, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
        depthBuffer: false,
    });
    const texture = target.texture;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    const material = new THREE.ShaderMaterial({
        uniforms: { uZ: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: noiseFragment,
        depthTest: false,
        depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previous = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    for (let z = 0; z < size; z++) {
        material.uniforms.uZ.value = (z + 0.5) / size;
        renderer.setRenderTarget(target, z);
        renderer.render(scene, camera);
    }
    renderer.setRenderTarget(previous);
    renderer.autoClear = autoClear;
    material.dispose();
    quad.geometry.dispose();
    return target;
};

// ---- The march: each pixel of a half-size picture walks its view ray through
// the layers. Each frame starts its steps at a different offset, and the
// resolve pass below blends the frames together, so a few dozen steps a frame
// add up to the detail of many more.
const marchFragment = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 outLight;
layout(location = 1) out vec4 outDepth;
uniform sampler3D cvNoise;
uniform sampler2D cvMap;
#ifdef CV_EARTH
uniform samplerCube cvCoverMap;
uniform mat3 cvCoverFrame;
#endif
uniform sampler2D cvDepthTex;
uniform float cvFar;
uniform float cvFrame;
uniform vec3 cvCam;
uniform mat4 cvInvProj;
uniform mat4 cvCamWorld;
uniform float cvRadius;
uniform vec3 cvAxis;
uniform mat4 cvLayer0;
uniform mat4 cvLayer1;
uniform mat4 cvLayer2;
uniform mat4 cvLayer3;
uniform mat4 cvLayer4;
uniform float cvLayers;
uniform float cvCirrus;
uniform float cvCirrusTurn;
uniform vec3 cvSun;
uniform vec3 cvSunColor;
uniform vec3 cvSkyTop;
uniform vec3 cvSkyBottom;
uniform vec3 cvWind;
uniform vec4 cvFlash;
uniform vec4 cvHaze;
uniform float cvReach;
uniform float cvSteps;
uniform vec3 cvDeckTop;
uniform vec3 cvDeckThick;
uniform vec4 cvVA0; uniform vec4 cvVA1; uniform vec4 cvVA2; uniform vec4 cvVA3;
uniform vec4 cvVB0; uniform vec4 cvVB1; uniform vec4 cvVB2; uniform vec4 cvVB3;
uniform vec4 cvVC0; uniform vec4 cvVC1; uniform vec4 cvVC2; uniform vec4 cvVC3;
uniform vec3 cvE1;
uniform vec2 cvWall;
uniform float cvTime;
uniform vec4 cvCellA;
uniform vec4 cvCellB;
uniform vec4 cvCellC;
uniform vec4 cvCellBound;
uniform vec4 cvCellD;

// How far round the curve a point is from a storm cell's centre, in angle,
// measured on the cell's ellipse (its half-length along its drift is the
// angular radius cvCellA.w; across, cvCellD.x times that). 'lead' comes back
// +1 on its leading side, -1 behind.
float cvCellAngle(vec3 up, out float lead) {
    float c = dot(up, cvCellA.xyz);
    vec3 off = up - cvCellA.xyz * c;
    float o2 = max(dot(off, off), 1e-12);
    float along = dot(off, cvCellB.xyz);
    lead = along * inversesqrt(o2);
    float across2 = max(o2 - along * along, 0.0);
    float squash = sqrt((along * along + across2 / (cvCellD.x * cvCellD.x)) / o2);
    return acos(clamp(c, -1.0, 1.0)) * squash;
}

// A layer, packed in a matrix: [0] base, top, coverage, density;
// [1] shape size, erosion, where the tops round off, storm;
// [2] lit colour, kind (0 deck, 1 deck coloured by the map, 2 storm towers, 3 cirrus, 4 vortex walls, 5 a dust storm, 6 a thunderstorm cell);
// [3] shaded colour, storm cell size (towers) or stretch (cirrus).
mat4 cvLayer(int i) { return i == 0 ? cvLayer0 : (i == 1 ? cvLayer1 : (i == 2 ? cvLayer2 : (i == 3 ? cvLayer3 : cvLayer4))); }

float cvRemap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

uint cvHash(uvec3 v, uint seed) {
    uint h = seed * 747796405u + 2891336453u;
    h ^= v.x * 1664525u; h = h * 1013904223u + (h >> 16);
    h ^= v.y * 22695477u; h = h * 1103515245u + (h >> 13);
    h ^= v.z * 134775813u; h = h * 214013u + (h >> 11);
    h ^= h >> 15; h *= 2246822519u; h ^= h >> 13; h *= 3266489917u; h ^= h >> 16;
    return h;
}
float cvUnit(uint h) { return float(h >> 8) / 16777216.0; }
uint cvNext(uint h) { return h * 747796405u + 2891336453u ^ (h >> 11); }

// Sunlight left at a height, under the decks above it (gasAtmosphere.lightAt).
float cvLightAt(float h) {
    vec3 above = clamp((cvDeckTop - h) / max(cvDeckThick, vec3(1.0)), 0.0, 1.0);
    vec3 pass = 1.0 - above * 0.5;
    return pass.x * pass.y * pass.z * exp(-max(0.0, -h) / 20000.0);
}

// ---- Thunderstorms (only compiled in for a giant that has them: CV_STORMS) ----
#ifdef CV_STORMS
// Storm cells lie on a grid on each face of a cube wrapped round the planet
// (equal-angle, so a cell keeps nearly one size everywhere), at most one storm
// to a cell and none in the cells along a face's edge, so no storm is cut by a
// seam. The storms of the 3 x 3 cells round a sample that can reach it are
// found once and kept while the ray stays in the same cell; an anvil never
// reaches further than that, so nothing is missed. They are kept in six
// fixed slots, not an array: Direct3D's shader compiler (Chrome and Edge on
// Windows) stalls on arrays indexed at run time.
// Kept nearest first (by how far each storm's reach stays from the cell), so
// when more than six could reach, the ones dropped are those least likely to
// (a storm cut off by a full list would show a square edge). Each is kept as
// four numbers and the rest worked out from them when needed: six storms of
// eight numbers each, held through the whole march, do not fit in registers,
// and the spilling cost more than all the storms' arithmetic.
// A storm's life, seconds: growing, mature, collapsing (cvFindStorms).
#define CV_STORM_LIFE 420.0
vec4 cvS0; vec4 cvS1; vec4 cvS2; vec4 cvS3; vec4 cvS4; vec4 cvS5;   // centre (cells), size (0-1), top (fraction of the layer; 0: no storm)
vec3 cvStormKey;

vec3 cvCubeFace(vec3 n) {
    vec3 a = abs(n);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) { uv = n.yz / a.x; face = n.x > 0.0 ? 0.0 : 1.0; }
    else if (a.y >= a.z) { uv = n.zx / a.y; face = n.y > 0.0 ? 2.0 : 3.0; }
    else { uv = n.xy / a.z; face = n.z > 0.0 ? 4.0 : 5.0; }
    return vec3(atan(uv) * 0.63661977 + 0.5, face);
}

void cvClearStorms() {
    cvS0 = vec4(0.0); cvS1 = vec4(0.0); cvS2 = vec4(0.0); cvS3 = vec4(0.0); cvS4 = vec4(0.0); cvS5 = vec4(0.0);
}

// The rest of a storm, from its four numbers. Its anvil's lean (which way and
// how far the winds aloft carry it) comes from its position, random already.
float cvStormHash(vec4 A) { return fract(dot(A.xy, vec2(0.7548777, 0.5698403)) * 7.0); }
vec2 cvStormLean(vec4 A) {
    float u = cvStormHash(A);
    float a = u * 6.2831853;
    return vec2(cos(a), sin(a)) * mix(0.08, 0.3, fract(u * 13.37 + 0.31));
}
float cvStormAnvil(vec4 A) { return mix(0.5, 0.93, A.z); }
// How far any part of it reaches from its centre (cells), billows included.
float cvStormReach(vec4 A) { return cvStormAnvil(A) * 1.35 + mix(0.08, 0.3, fract(cvStormHash(A) * 13.37 + 0.31)); }

// Put a storm in the slot its gap earns, moving the farther ones down (fixed
// code, no arrays). The slots' gaps (g0: slots 0-3, g1: 4-5) are needed only
// while the slots are filled, so they are not kept with the storms.
void cvInsertStorm(vec4 A, float gap, inout vec4 g0, inout vec2 g1) {
    if (gap >= g1.y) return;
    cvS5 = A; g1.y = gap;
    if (gap < g1.x) { cvS5 = cvS4; g1.y = g1.x; cvS4 = A; g1.x = gap; } else return;
    if (gap < g0.w) { cvS4 = cvS3; g1.x = g0.w; cvS3 = A; g0.w = gap; } else return;
    if (gap < g0.z) { cvS3 = cvS2; g0.w = g0.z; cvS2 = A; g0.z = gap; } else return;
    if (gap < g0.y) { cvS2 = cvS1; g0.z = g0.y; cvS1 = A; g0.y = gap; } else return;
    if (gap < g0.x) { cvS1 = cvS0; g0.y = g0.x; cvS0 = A; g0.x = gap; }
}

void cvFindStorms(vec3 key, float cells, float chance) {
    cvStormKey = key;
    cvClearStorms();
    vec4 g0 = vec4(1e9);
    vec2 g1 = vec2(1e9);
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 c = key.xy + vec2(float(i), float(j));
            if (c.x < 1.0 || c.y < 1.0 || c.x > cells - 2.0 || c.y > cells - 2.0) continue;
            // Storms live and die. Each cell has its turns, a few minutes
            // each and out of step with its neighbours'; in each turn a storm
            // may grow there or not, somewhere else in it, at another size.
            float clock = cvTime / CV_STORM_LIFE + cvUnit(cvHash(uvec3(uvec2(c), uint(key.z)), 9137u));
            float turn = floor(clock);
            float age = clock - turn;
            uint h = cvHash(uvec3(uvec2(c), uint(key.z) + 6u * uint(turn)), 7331u);
            if (cvUnit(h) >= chance) continue;
            uint h1 = cvNext(h); uint h2 = cvNext(h1); uint h3 = cvNext(h2); uint h4 = cvNext(h3);
            // A tower boils up out of the deck, round-topped while it grows;
            // the tallest spread an anvil once they reach the top; then it
            // sinks back and is gone.
            float life = smoothstep(0.0, 0.32, age) * (1.0 - smoothstep(0.78, 1.0, age));
            vec4 A = vec4(c + 0.3 + 0.4 * vec2(cvUnit(h1), cvUnit(h2)), cvUnit(h4), mix(0.5, 1.0, sqrt(cvUnit(h3))) * life);
            if (A.w < 0.02) continue;
            // Only storms whose anvil can reach the cell round the sample.
            float gap = length(key.xy + 0.5 - A.xy) - (cvStormAnvil(A) + length(cvStormLean(A)));
            if (gap > 0.75) continue;
            cvInsertStorm(A, gap, g0, g1);
        }
    }
}

// How far inside one storm a point is (0 outside, 1 deep inside), at 'g'
// (cells on the face) and 'hf' (fraction of the layer's height).
float cvStorm(vec2 g, float hf, float billow, vec4 A) {
    // No early ways out: only the two storms nearest a sample are worked out
    // (cvTowerShape), and branches cost more than they save there. An empty
    // slot (all zero) and anything above the top come out as nothing.
    float t = hf / max(A.w, 1e-3);
    float mature = smoothstep(0.8, 0.95, A.w);
    float body = mix(0.16, 0.26, A.z) * step(1e-3, A.w);
    // The body widens a little as it climbs; a mature storm spreads into an
    // anvil, flaring out under the top of the layer, its top flat.
    float anvil = smoothstep(0.72, 0.93, t) * mature;
    float R = mix(body * (0.72 + 0.4 * t), cvStormAnvil(A), anvil * anvil);
    // A flat base; a young tower's rounded top.
    R *= smoothstep(0.0, 0.035, hf) * mix(sqrt(clamp((1.0 - t) / 0.16, 0.0, 1.0)), 1.0, mature);
    // Above the anvil, where the updraft punches through it, a dome.
    float dome = body * 0.6 * sqrt(max(0.0, 1.0 - (t - 1.0) * (t - 1.0) / 0.01)) * mature;
    R = t > 1.0 ? dome : R;
    // The anvil streams off to one side, as the winds aloft carry it.
    vec2 c = A.xy + cvStormLean(A) * smoothstep(0.45, 1.0, t);
    float Rb = R * (0.68 + 0.64 * billow);
    return clamp((Rb - length(g - c)) / max(Rb * 0.3, 1e-3), 0.0, 1.0);
}

// The storm a sample is in (the one deepest in), kept for its light: the
// sunlight reaching a sample is shaded by that storm alone, one storm's shape
// worked out towards the sun instead of all six.
vec4 cvInA;
void cvKeep(vec2 g, vec4 A, inout float d1, inout vec4 A1, inout float d2, inout vec4 A2) {
    float d = A.w > 0.0 ? length(g - A.xy) - cvStormReach(A) : 1e9;
    if (d < d1) { d2 = d1; A2 = A1; d1 = d; A1 = A; }
    else if (d < d2) { d2 = d; A2 = A; }
}
// Of the six storms kept for the cell, the two whose reach the sample is
// nearest are worked out in full (a third almost never overlaps them).
float cvTowerShape(vec2 g, float hf, float billow) {
    float d1 = 1e9; float d2 = 1e9;
    vec4 A1 = vec4(0.0); vec4 A2 = vec4(0.0);
    cvKeep(g, cvS0, d1, A1, d2, A2);
    cvKeep(g, cvS1, d1, A1, d2, A2);
    cvKeep(g, cvS2, d1, A1, d2, A2);
    cvKeep(g, cvS3, d1, A1, d2, A2);
    cvKeep(g, cvS4, d1, A1, d2, A2);
    cvKeep(g, cvS5, d1, A1, d2, A2);
    float v1 = cvStorm(g, hf, billow, A1);
    float v2 = cvStorm(g, hf, billow, A2);
    cvInA = v1 >= v2 ? A1 : A2;
    return max(v1, v2);
}

vec2 cvTowerCell(vec3 p, mat4 L) {
    vec3 fc = cvCubeFace(normalize(p + cvWind * 0.6));
    float cells = floor(cvRadius * 1.5707963 / L[3].w);
    vec2 g = fc.xy * cells;
    vec3 key = vec3(floor(g), fc.z);
    if (key != cvStormKey) cvFindStorms(key, cells, L[0].z);
    return g;
}
#endif

// ---- Cirrus: streaks of ice running east-west, in bands of latitude (CV_CIRRUS). ----
#ifdef CV_CIRRUS
// Mapped by longitude and latitude; the streaks' length divides the way round
// into a whole number of the noise's tiles, so there is no seam.
float cvCirrusAt(vec3 p, mat4 L, float hf) {
    vec3 n = normalize(p);
    vec3 e1 = normalize(cross(cvAxis, abs(cvAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(cvAxis, e1);
    float lon = atan(dot(n, e2), dot(n, e1)) + cvCirrusTurn;
    float lat = asin(clamp(dot(n, cvAxis), -1.0, 1.0));
    float tiles = max(1.0, floor(cvRadius * 6.2831853 / (L[1].x * L[3].w)));
    vec3 q = vec3(lon / 6.2831853 * tiles, lat * cvRadius / L[1].x, hf * 0.35);
    float streak = texture(cvNoise, q).r * 0.7 + texture(cvNoise, q * vec3(2.0, 2.6, 1.0) + 0.37).r * 0.3;
    // Bands: Neptune's bright clouds keep to a few latitudes.
    float band = 0.5 + 0.5 * sin(lat * 7.0 + 0.6) * cos(lat * 2.0);
    float sky = texture(cvNoise, q * vec3(0.25, 0.3, 1.0) + vec3(0.31, 0.17, 0.53)).b;
    float cover = clamp(L[0].z + (band - 0.5) * 0.7 + (sky - 0.5) * 0.6, 0.0, 1.0);
    float profile = smoothstep(0.0, 0.3, hf) * (1.0 - smoothstep(0.65, 1.0, hf));
    return clamp(cvRemap(streak * profile, 1.0 - cover, 1.0, 0.0, 1.0), 0.0, 1.0);
}
#endif

// ---- The great vortices (vortices.ts): up to four near the camera, in fixed
// slots (no arrays: Direct3D's compiler stalls on them). A = centre (a unit
// vector from the planet's centre), reach (units); B = eye or core radius,
// wind at the eyewall (units/s, positive anticlockwise seen from above), kind
// (0 a cyclone with an eye, 1 spiral arms round a core, 2 a clearing in the
// top deck, 3 an oval), eyewall height (share of the vortex layer);
// C = north-south over east-west size, how tightly the arms wind, how many.
vec4 gVA; vec4 gVB; vec4 gVC;
vec3 gVEast; vec3 gVNorth;
float gVr;     // distance from the centre, units (ovals: scaled to east-west)
float gVrel;   // that over the reach (9 when in none)
float gVang;   // angle round the centre

// Compiled in only while a vortex is within reach (CV_VORTEX): every shader
// carries the code of all its branches, so a march without them stays lean.
#ifdef CV_VORTEX
// Every one of the vortex's values is written for every sample, in or out of
// it: a value written only sometimes is carried from one step of the march to
// the next, and the march holds too much already.
void cvTryVortex(vec3 n, vec4 A, vec4 B, vec4 C) {
    vec3 at = A.w > 0.0 ? A.xyz : cvAxis;   // (an empty slot: anything that is not zero)
    float c = dot(n, at);
    vec3 east = normalize(cross(abs(dot(cvAxis, at)) > 0.995 ? cvE1 : cvAxis, at));
    vec3 north = cross(at, east);
    vec3 d = n - at * c;
    vec2 e = vec2(dot(d, east), dot(d, north) / C.x) * cvRadius;
    float r = length(e);
    float rel = r / max(A.w, 1.0);
    gVrel = A.w > 0.0 && c > 0.5 && rel < 1.35 ? rel : 9.0;
    gVr = r; gVang = atan(e.y, e.x);
    gVA = A; gVB = B; gVC = C; gVEast = east; gVNorth = north;
}

// Can any point of the stretch a-b of a ray (inside a layer centred at radius
// 'mid', 'slack' thick either side) be within a vortex's reach? Conservative:
// such a point lies within slack + mid * (its angle from the centre) of the
// vortex's centre at that radius.
bool cvVortexNear(vec3 a, vec3 b, float mid, float slack, vec4 A, vec4 C) {
    if (A.w <= 0.0) return false;
    vec3 c = A.xyz * mid;
    vec3 ab = b - a;
    float t = clamp(dot(c - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float angle = asin(min(1.0, 1.35 * A.w * max(1.0, C.x) / cvRadius));
    return length(a + ab * t - c) < slack + mid * angle * 1.1;
}

// How far a direction is from a vortex's centre, measured in its own reach
// (roughly the square of the angle over the angle its reach spans).
float cvVortexScore(vec3 n, vec4 A, vec4 C) {
    if (A.w <= 0.0) return 1e9;
    return (1.0 - dot(n, A.xyz)) / (A.w * A.w * max(1.0, C.x * C.x));
}

// Only the nearest of the four is worked out in full.
void cvFindVortex(vec3 p) {
    vec3 n = normalize(p);
    float best = cvVortexScore(n, cvVA0, cvVC0);
    vec4 A = cvVA0; vec4 B = cvVB0; vec4 C = cvVC0;
    float score = cvVortexScore(n, cvVA1, cvVC1);
    if (score < best) { best = score; A = cvVA1; B = cvVB1; C = cvVC1; }
    score = cvVortexScore(n, cvVA2, cvVC2);
    if (score < best) { best = score; A = cvVA2; B = cvVB2; C = cvVC2; }
    score = cvVortexScore(n, cvVA3, cvVC3);
    if (score < best) { A = cvVA3; B = cvVB3; C = cvVC3; }
    cvTryVortex(n, A, B, C);
}

// Where the cloud now at p was 'seconds' ago, carried round the vortex: turning
// as a solid through the eye, fastest at the eyewall, slower further out (an
// oval: still at the core, fastest in its collar, as the Great Red Spot).
vec3 cvSwirl(vec3 p, float seconds) {
    float eye = gVB.x;
    float v = gVB.y * (gVr < eye ? gVr / eye : pow(eye / max(gVr, 1.0), 0.6)) * (1.0 - smoothstep(0.85, 1.35, gVrel));
    if (gVB.z > 2.5) v = gVB.y * smoothstep(0.1, 0.75, gVrel) * (1.0 - smoothstep(0.95, 1.3, gVrel));
    // Plus a fixed twist growing outwards with the logarithm of the distance:
    // it shears the cloud into filaments wound the way the arms wind.
    float twist = sign(gVB.y) * gVC.y * 0.5 * log(max(gVr, gVB.x * 0.4) / gVB.x);
    float a = -v * seconds / max(gVr, 1.0) + twist;
    vec2 e = vec2(cos(gVang), sin(gVang)) * gVr;
    vec2 turned = vec2(e.x * cos(a) - e.y * sin(a), e.x * sin(a) + e.y * cos(a));
    vec2 moved = turned - e;
    return p + gVEast * moved.x + gVNorth * (moved.y * gVC.x);
}

// Spiral arms wound into the centre (-1 between them, 1 on them), the pattern
// turning slowly as a whole, much slower than the wind in it.
float cvArms() {
    float spin = sign(gVB.y);
    float wound = log(max(gVr, gVB.x * 0.4) / gVB.x) * gVC.y;
    float turn = cvTime * gVB.y / max(gVB.x * 8.0, 1.0);
    return sin(gVC.z * (gVang - turn) + spin * wound);
}

// How wide the eye is at a height: wider going up (the stadium seen from inside a hurricane's eye).
float cvEyeAt(float h) {
    float up = clamp((h - cvWall.x) / max(cvWall.y - cvWall.x, 1.0), 0.0, 1.0);
    return gVB.x * (1.0 + 0.55 * up);
}

// The cover of a deck inside a vortex.
float cvVortexCover(float cover, float h, mat4 L) {
    if (gVrel >= 1.35) return cover;
    float kind = gVB.z;
    float inside = 1.0 - smoothstep(0.75, 1.3, gVrel);
    float arms = cvArms();
    if (kind < 0.5) {
        // Banded round the eye, the eyewall solid, the eye itself clear all the way down.
        float rw = cvEyeAt(h);
        float banded = clamp(0.2 + 0.7 * smoothstep(-0.4, 0.6, arms), 0.0, 1.0);
        cover = mix(cover, banded, inside * smoothstep(rw * 1.2, rw * 2.0, gVr));
        float wall = smoothstep(rw * 0.95, rw * 1.1, gVr) * (1.0 - smoothstep(rw * 1.5, rw * 2.1, gVr));
        cover = max(cover, wall * 0.95);
        cover *= smoothstep(rw * 0.82, rw * 1.0, gVr);
    } else if (kind < 1.5) {
        // Arms of cloud round a dense core, darker lanes between them where one sees deeper.
        float core = 1.0 - smoothstep(gVB.x * 0.7, gVB.x * 1.6, gVr);
        float lanes = smoothstep(-0.35, 0.55, arms);
        cover = mix(cover, clamp(0.12 + 0.8 * lanes + 0.6 * core, 0.0, 1.0), inside);
    } else if (kind < 2.5) {
        // A clearing: the top deck is missing over it, the decks below show through, banded.
        bool top = abs(L[0].y - cvDeckTop.x) < 1.0;
        if (top) cover *= smoothstep(0.62, 1.02, gVrel);
        else cover = mix(cover, clamp(0.55 + 0.3 * arms, 0.0, 1.0), inside * 0.7);
    } else {
        // An oval: thick, banded cloud wound round a calmer core.
        cover = mix(cover, clamp(0.35 + 0.55 * smoothstep(-0.5, 0.6, arms), 0.0, 1.0), inside);
    }
    return cover;
}

// The vortex walls (layer kind 4): an eyewall round a clear eye with rain bands
// winding out of it low down, or towering arms round a core.
float cvVortexWall(float hf, float billow) {
    if (gVrel >= 1.35) return 0.0;
    float kind = gVB.z;
    float eye = gVB.x;
    float base = smoothstep(0.0, 0.05, hf);
    if (kind < 0.5) {
        float rw = eye * (1.0 + 0.55 * hf);
        float w = eye * mix(0.9, 0.5, hf);
        float x = (gVr - rw) / w;
        float ring = smoothstep(-0.25, 0.1, x) * (1.0 - smoothstep(0.35 + 0.5 * billow, 1.3, x));
        float top = gVB.w * (0.9 + 0.1 * billow);
        ring *= base * (1.0 - smoothstep(top - 0.12, top, hf));
        float bands = smoothstep(0.3, 0.85, cvArms()) * smoothstep(eye * 1.8, eye * 2.6, gVr)
            * (1.0 - smoothstep(0.7, 1.15, gVrel)) * (1.0 - smoothstep(0.3, 0.55, hf)) * base;
        return max(ring, bands) * (0.55 + 0.9 * billow);
    }
    if (kind < 1.5) {
        float core = 1.0 - smoothstep(eye * 0.6, eye * 1.4, gVr);
        float arm = smoothstep(0.45, 0.95, cvArms()) * (1.0 - smoothstep(0.7, 1.15, gVrel)) * smoothstep(eye * 0.8, eye * 1.6, gVr);
        float top = mix(0.42, gVB.w, core);
        return max(core, arm * 0.85) * base * (1.0 - smoothstep(top - 0.14, top, hf)) * (0.45 + billow);
    }
    return 0.0;
}
#endif

// ---- A storm cell over the ground (CV_DUST): a dust storm's front, a wall
// of dust a kilometre or more high, scalloped into lobes, boiling up at its
// head and lower behind it; inside, the air itself is dust. Only compiled in
// for a world with dust storms, and marched only along rays that reach it.
#ifdef CV_DUST
float cvCellShape(vec3 p, float billow, float slow, out float hf) {
    float r = length(p);
    vec3 up = p / r;
    float h = r - cvRadius - cvCellC.x;
    // How far inside its edge, along the ground; the edge wandering in and out
    // in lobes. Its leading edge is a sharp wall, its back a thinning haze.
    float lead;
    float inside = (cvCellA.w - cvCellAngle(up, lead)) * cvRadius + (slow - 0.5) * cvCellC.w;
    float front = smoothstep(-0.3, 0.7, lead);
    // The head: tallest just behind the front, lower further in, lowest at the back.
    float top = cvCellC.y * mix(0.4, 1.0, front) * mix(0.55, 1.0, exp(-max(inside, 0.0) / 1500.0)) * (0.7 + 0.6 * slow);
    hf = clamp(h / top, 0.0, 1.0);
    float edge = mix(1500.0, 260.0, front);
    float wall = smoothstep(-0.5 * edge, 0.5 * edge, inside);
    if (wall <= 0.0 || h >= top) return 0.0;
    // Thick at the ground and thinning upwards, the top heaped into billows;
    // inside, a floor of dust everywhere (the air is full of it).
    float profile = (1.0 - smoothstep(0.55, 1.0, hf)) * (0.6 + 0.4 * exp(-hf * 3.0));
    float heaped = clamp(cvRemap(billow * profile, 0.18, 0.85, 0.0, 1.0), 0.0, 1.0);
    float floorDust = 1.3 * (1.0 - smoothstep(0.0, 0.6, hf)) * smoothstep(0.0, 400.0, inside);
    return max(heaped, floorDust) * wall * cvCellB.w;
}
#endif

// ---- A thunderstorm cell (CV_THUNDER): a cumulonimbus. A flat dark base a
// few hundred metres up, a heaped tower widening as it climbs, an anvil of
// ice spread under the top and pushed out ahead of the storm, and under the
// core a grey curtain of rain reaching the ground.
#ifdef CV_THUNDER
float cvStormCell(vec3 p, float billow, float slow, out float hf) {
    float r = length(p);
    vec3 up = p / r;
    float h = r - cvRadius - cvCellC.x;
    float lead;
    float rr = cvCellAngle(up, lead) * cvRadius;
    float R = cvCellA.w * cvRadius;
    float base = cvCellC.z;
    float top = cvCellC.y * (0.85 + 0.3 * slow);
    hf = clamp((h - base) / max(top - base, 1.0), 0.0, 1.0);
    // The tower, half the cell across, lumpy, a little wider going up; the
    // anvil out to the whole cell under the top, further on its leading side.
    // (Its lumps push the edge in and out by a fifth of the cell: cauliflower, not a column.)
    float tower = R * (0.6 + 0.08 * hf) * (0.8 + 0.35 * slow);
    float anvil = smoothstep(0.78, 0.9, hf);
    float spread = mix(tower, R * (1.0 + 0.6 * max(lead, 0.0)), anvil);
    float edge = rr + (billow - 0.55) * R * 0.45;
    float within = 1.0 - smoothstep(spread * 0.88, spread * 1.02, edge);
    float cloud = 0.0;
    if (h > base && h < top) {
        // A base cut flat, a top rounded off under the anvil.
        float profile = smoothstep(0.0, 0.006, hf) * (1.0 - smoothstep(0.9, 1.0, hf));
        cloud = within * profile * clamp(0.55 + 0.9 * (billow - 0.4), 0.2, 1.0);
        // The anvil's overhang is thin ice, not the tower's water.
        cloud *= mix(1.0, 0.4, anvil * smoothstep(tower, tower * 1.6, rr));
    }
    // Rain under the core, from the base to the ground, in shafts.
    float rain = 0.0;
    if (h <= base) {
        float core = 1.0 - smoothstep(tower * 0.35, tower * 0.8, rr + (slow - 0.5) * tower * 0.7);
        rain = core * 0.3 * (0.55 + 0.45 * billow) * (1.0 - smoothstep(base * 0.85, base, h));
    }
    return max(cloud, rain) * cvCellB.w;
}
#endif

float cvCover;

float cvHeight(vec3 p, mat4 L) { return (length(p) - cvRadius - L[0].x) / (L[0].y - L[0].x); }

// The noise the cloud is cut from at p: shapes (r) and erosion (g), with a
// larger, turned copy of the shapes mixed in to break up the tiling cells.
vec4 cvShapes(vec3 p, mat4 L, bool vortex) {
    vec3 q = (p + cvWind) / L[1].x;
    vec4 n = texture(cvNoise, q);
    float broad = texture(cvNoise, q.zxy * 0.37 + vec3(0.61, 0.29, 0.83)).r;
    gVrel = 9.0;
#ifdef CV_VORTEX
    if (vortex) cvFindVortex(p);
    if (vortex && gVrel < 1.35) {
        // Inside a vortex the cloud is finer (its own size sets the scale, so
        // its arms can show) and carried round it: two copies, each carried
        // for a few seconds and faded into the other (a flow map), so it turns
        // for ever without winding itself into streaks.
        float scale = min(L[1].x, gVA.w * 0.22);
        float phase = fract(cvTime / 8.0);
        float other = fract(phase + 0.5);
        vec3 qa = (cvSwirl(p, (phase - 0.5) * 8.0) + cvWind) / scale;
        vec3 qb = (cvSwirl(p, (other - 0.5) * 8.0) + cvWind) / scale;
        float wa = 1.0 - abs(2.0 * phase - 1.0);
        vec4 nv = mix(texture(cvNoise, qb), texture(cvNoise, qa), wa);
        // The slow field of the same two lookups stands in for the larger shapes (two lookups, not four).
        float bv = nv.b;
        float within = 1.0 - smoothstep(0.9, 1.35, gVrel);
        n = mix(n, nv, within);
        broad = mix(broad, bv, within);
    }
#endif
    n.r = n.r * 0.62 + broad * 0.38;
    return n;
}

// Wispier at the base, firm at the tops.
float cvErode(float shape, vec4 n, mat4 L, float hf) {
    if (shape <= 0.0) return 0.0;
    return clamp(cvRemap(shape, n.g * L[1].y * mix(0.85, 0.3, hf), 1.0, 0.0, 1.0), 0.0, 1.0);
}

// The cloud at p. 'kind' (0 deck, 1 deck coloured by the map, 2 storm towers,
// 3 cirrus, 4 vortex walls) and 'vortex' (a vortex can be in reach) are
// constants at every call (cvMarch, from main), so each compiles to the code
// of that kind of cloud alone.
float cvDensity(int kind, bool vortex, vec3 p, mat4 L, out float hf) {
    hf = cvHeight(p, L);
    if (hf <= 0.0 || hf >= 1.0) return 0.0;
#ifdef CV_CIRRUS
    if (kind == 3) return cvCirrusAt(p, L, hf);
#endif
#ifdef CV_EARTH
    // Earth's cumulus: cloudy where the deck seen from afar is (Clouds.tsx). Clear sky is most of
    // it: nothing more to work out there. (Towards the reach the march thins them out, where the
    // deck takes over again.)
    float earthCover = 0.0;
    if (kind == 0) {
        // (A few mip levels down: the photographed cover's fine fibres, constant up a column, built the puffs
        // into vertical walls; smoothed to cells a couple of hundred metres across, the noise shapes them.)
        earthCover = smoothstep(0.08, 0.6, textureLod(cvCoverMap, cvCoverFrame * normalize(p), 3.5).r) * L[0].z;
        if (earthCover < 0.01) { cvCover = 0.0; return 0.0; }
    }
#endif
    vec4 n = cvShapes(p, L, vortex);
#ifdef CV_DUST
    if (kind == 5) {
        cvCover = 1.0;
        // The lobes of the front: the slow field, a few kilometres across, carried with the cell.
        float slow = texture(cvNoise, (p + cvWind) / 3600.0).b;
        float d = cvCellShape(p, n.r, slow, hf);
        return d > 0.0 ? cvErode(d, n, L, hf) : 0.0;
    }
#endif
#ifdef CV_THUNDER
    if (kind == 6) {
        cvCover = 1.0;
        float slow = texture(cvNoise, (p + cvWind) / 4200.0).b;
        float d = cvStormCell(p, n.r, slow, hf);
        return d > 0.0 ? cvErode(d, n, L, hf) : 0.0;
    }
#endif
#ifdef CV_VORTEX
    if (kind == 4) {
        cvCover = 1.0;
        return cvErode(cvVortexWall(hf, n.r), n, L, hf);
    }
#endif
#ifdef CV_STORMS
    if (kind == 2) {
        cvCover = 1.0;
        return cvErode(cvTowerShape(cvTowerCell(p, L), hf, n.r), n, L, hf);
    }
#endif
#ifdef CV_EARTH
    float cover = earthCover;
#else
    vec3 q = (p + cvWind) / L[1].x;
    float sky = texture(cvNoise, q * 0.13 + vec3(0.31, 0.17, 0.53)).b;
    float cover = clamp(L[0].z + (sky - 0.5) * 0.8, 0.0, 1.0);
#endif
#ifdef CV_VORTEX
    if (vortex) cover = cvVortexCover(cover, length(p) - cvRadius, L);
#endif
    cvCover = cover;
    // Flat bases, tops that round off (heaped) or stay level (decks).
    float profile = smoothstep(0.0, 0.08, hf) * (1.0 - smoothstep(L[1].z, 1.0, hf));
    return cvErode(cvRemap(n.r * profile, 1.0 - cover, 1.0, 0.0, 1.0), n, L, hf);
}

// The same cloud, cheaply, for the light reaching a sample: one lookup, the
// cover of the sample itself (a storm: its shape alone, from the storms found).
float cvDensityLight(int kind, vec3 p, mat4 L, float cover) {
    float hf = cvHeight(p, L);
    if (hf <= 0.0 || hf >= 1.0) return 0.0;
#ifdef CV_VORTEX
    if (kind == 4) return cvVortexWall(hf, 0.5);
#endif
#ifdef CV_DUST
    if (kind == 5) return cvCellShape(p, texture(cvNoise, (p + cvWind) / L[1].x).r, 0.5, hf);
#endif
#ifdef CV_THUNDER
    if (kind == 6) return cvStormCell(p, texture(cvNoise, (p + cvWind) / L[1].x).r, 0.5, hf);
#endif
    if (kind == 3) return 0.0;
#ifdef CV_STORMS
    if (kind == 2) {
        vec3 fc = cvCubeFace(normalize(p + cvWind * 0.6));
        return cvStorm(fc.xy * floor(cvRadius * 1.5707963 / L[3].w), hf, 0.5, cvInA);
    }
#endif
    float n = texture(cvNoise, (p + cvWind) / L[1].x).r;
    float profile = smoothstep(0.0, 0.08, hf) * (1.0 - smoothstep(L[1].z, 1.0, hf));
    return clamp(cvRemap(n * profile, 1.0 - max(cover, 0.01), 1.0, 0.0, 1.0), 0.0, 1.0);
}

// Sunlight left after the cirrus above: where the ray to the sun crosses the
// cirrus layer, how thick the streaks are there (Voyager's shadows on Neptune).
float cvCirrusShade(vec3 p) {
#ifndef CV_CIRRUS
    return 1.0;
#else
    if (cvCirrus < 0.0) return 1.0;
    mat4 C = cvLayer(int(cvCirrus));
    float r = cvRadius + (C[0].x + C[0].y) * 0.5;
    float b = dot(p, cvSun);
    float c = dot(p, p) - r * r;
    if (c > 0.0) return 1.0;
    float s = -b + sqrt(max(b * b - c, 0.0));
    float d = cvCirrusAt(p + cvSun * s, C, 0.5);
    // Thin ice: its shadow takes a third to two thirds of the light, not all of it.
    return exp(-d * (C[0].y - C[0].x) * C[0].w * 0.28);
#endif
}

vec2 cvSphere(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float lo = length(o);
    float c = (lo - r) * (lo + r);
    float disc = b * b - c;
    if (disc < 0.0) return vec2(1e20, -1e20);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
}

float cvPhase(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

vec3 cvMapColour(vec3 p) {
    vec3 n = normalize(p);
    float lat = dot(n, cvAxis);
    vec3 e1 = normalize(cross(cvAxis, abs(cvAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(cvAxis, e1);
    vec2 uv = vec2(atan(dot(n, e2), dot(n, e1)) / 6.2831853 + 0.5, asin(clamp(lat, -1.0, 1.0)) / 3.14159265 + 0.5);
    return textureLod(cvMap, uv, 1.5).rgb;
}

// One stretch of a ray through one layer, nearest first. 'kind' and 'vortex'
// are constants at every call (main), so each call compiles to a march for
// that kind of cloud alone, with the vortex's work only where one can be in
// reach (decks, both kinds, share one: the map colour is a small branch).
#ifdef CV_DEBUG
// DEV (?cvdbg=1): the most dense sample met, the stretch marched, the steps taken.
vec4 cvDbg = vec4(0.0);
#endif
void cvMarch(int kind, bool vortex, float a, float b, mat4 L, vec3 dir, float jitter, float phase, inout float budget,
        inout vec3 light, inout float through, inout float seenWeight, inout float seenDistance) {
    float thickness = L[0].y - L[0].x;
    float span = b - a;
    // Finer steps close by, longer ones far out.
    float wanted = clamp(span / max(thickness * 0.05, a * 0.012), 4.0, 40.0);
    float n = min(wanted, budget);
    budget -= n;
    // A stretch that starts near the eye crowds its steps towards the eye
    // (spaced as the square), so the cloud round the ship is fine-grained.
    bool nearby = a < span * 0.5;
    vec3 lit = L[2].rgb;
    vec3 shade = L[3].rgb;
    float extinction = L[0].w;
    bool coloured = L[2].w > 0.5 && L[2].w < 1.5;
    // Storm towers and vortex walls reach from the depths to the tops: lit by what sunlight is left at each height.
    bool deep = kind == 2 || kind == 4;
    for (int s = 0; s < 40; s++) {
        if (float(s) >= n || through < 0.02) break;
        float u = (float(s) + jitter) / n;
        float t = nearby ? a + span * u * u : a + span * u;
        float dt = nearby ? span * (2.0 * (float(s) + jitter) + 1.0) / (n * n) : span / n;
        vec3 p = cvCam + dir * t;
        float hf;
        float d = cvDensity(kind, vortex, p, L, hf);
#ifdef CV_DEBUG
        cvDbg.x = max(cvDbg.x, d); cvDbg.z += 1.0;
#endif
        if (d <= 0.0) continue;
        // Fading out at the edge of the reach, where the planet's own picture takes over.
        d *= 1.0 - smoothstep(cvReach * 0.6, cvReach, t);
        // Sunlight reaching it through the cloud on the sun's side.
        vec3 up = normalize(p);
        float day = smoothstep(-0.12, 0.18, dot(up, cvSun));
        // (Storm towers and vortex walls are costly to sample: one look towards the sun, not two.)
        float sunPath = deep
            ? cvDensityLight(kind, p + cvSun * thickness * 0.12, L, cvCover) * 0.2
            : cvDensityLight(kind, p + cvSun * thickness * 0.06, L, cvCover) * 0.06
                + cvDensityLight(kind, p + cvSun * thickness * 0.2, L, cvCover) * 0.14;
        float tau = sunPath * thickness * extinction * 1.4;
        // Dust and storm cloud over the ground are thick and scatter nearly
        // all the light they stop: what comes in after many bounces (a cheap
        // second octave) keeps their depths from going black.
        float sunThrough = (kind >= 5 ? max(exp(-tau), 0.4 * exp(-tau * 0.09)) : exp(-tau)) * day * (kind == 3 ? 1.0 : cvCirrusShade(p));
        float depthLight = deep ? cvLightAt(length(p) - cvRadius) : 1.0;
#ifdef CV_VORTEX
        // A hurricane's eye is open to the sky: the inside of its wall gets
        // the sunlight that comes down it, not what is left under the decks.
        if (vortex && deep && gVrel < 1.35 && gVB.z < 0.5) depthLight = mix(depthLight, 1.0, 1.0 - smoothstep(gVB.x * 1.05, gVB.x * 1.7, gVr));
#endif
        // A thin edge facing the sun is darker than its depth would say (powder).
        float powder = 1.0 - exp(-d * thickness * extinction * 0.08);
        vec3 albedo = coloured ? mix(lit, cvMapColour(p) * 1.25, 0.8) : lit;
        vec3 ambient = mix(cvSkyBottom, cvSkyTop, hf) * mix(shade / max(lit, vec3(1e-3)), vec3(1.0), hf * 0.6);
        vec3 radiance = albedo * (cvSunColor * sunThrough * phase * mix(0.78, 1.0, powder) * depthLight + ambient * mix(0.25, 1.0, depthLight));
        // Lightning inside the storm deck lights the cloud round it.
        if (L[1].w > 0.0 && cvFlash.w > 0.0) {
            float fd = length(p - cvFlash.xyz);
            radiance += vec3(0.78, 0.84, 1.0) * cvFlash.w * L[1].w * 9.0 * exp(-fd / 1600.0);
        }
        // Further off, it melts into the haze.
        radiance = mix(radiance, cvHaze.rgb, 1.0 - exp(-t / cvHaze.w));
        float stepThrough = exp(-d * extinction * dt);
        float taken = through * (1.0 - stepThrough);
        light += taken * radiance;
        seenWeight += taken;
        seenDistance += taken * t;
        through *= stepThrough;
    }
}


void main() {
    vec4 nearPoint = cvInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec3 viewDir = normalize(nearPoint.xyz / nearPoint.w);
    vec3 dir = normalize((cvCamWorld * vec4(viewDir, 0.0)).xyz);
    // How far the scene is along this ray, from the logarithmic depth buffer.
    float raw = textureLod(cvDepthTex, vUv, 0.0).r;
    float sceneDistance = raw >= 0.999999 ? 1e20 : (exp2(raw * log2(cvFar + 1.0)) - 1.0) / max(-viewDir.z, 1e-4);
    float limit = min(sceneDistance, cvReach);
    outDepth = vec4(min(limit, 60000.0), min(sceneDistance, 60000.0), 0.0, 1.0);

    // The stretches of this ray inside each layer, in order.
    float starts[10];
    float ends[10];
    int owner[10];
    int count = 0;
#ifdef CV_STORMS
    cvStormKey = vec3(-1.0);
    cvClearStorms();
#endif
    for (int i = 0; i < 5; i++) {
        if (float(i) >= cvLayers) break;
        mat4 L = cvLayer(i);
        vec2 outer = cvSphere(cvCam, dir, cvRadius + L[0].y);
        if (outer.x > outer.y || outer.y < 0.0) continue;
        vec2 inner = cvSphere(cvCam, dir, cvRadius + L[0].x);
        float a = max(outer.x, 0.0);
        if (inner.x < inner.y && inner.y > 0.0) {
            if (inner.x > a) { starts[count] = a; ends[count] = min(inner.x, limit); owner[count] = i; count++; }
            if (inner.y < outer.y) { starts[count] = max(inner.y, 0.0); ends[count] = min(outer.y, limit); owner[count] = i; count++; }
        } else {
            starts[count] = a; ends[count] = min(outer.y, limit); owner[count] = i; count++;
        }
    }
    if (count == 0) {
        outLight = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    // Nearest first.
    for (int i = 1; i < 10; i++) {
        if (i >= count) break;
        for (int j = i; j > 0; j--) {
            if (starts[j] >= starts[j - 1]) break;
            float s = starts[j]; starts[j] = starts[j - 1]; starts[j - 1] = s;
            float e = ends[j]; ends[j] = ends[j - 1]; ends[j - 1] = e;
            int o = owner[j]; owner[j] = owner[j - 1]; owner[j - 1] = o;
        }
    }

    // A different offset each frame (interleaved gradient noise, moved on by
    // the frame number), which the resolve pass averages away.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * cvFrame, vec2(0.06711056, 0.00583715))));
    float cosSun = dot(dir, cvSun);
    float phase = mix(cvPhase(cosSun, 0.6), cvPhase(cosSun, -0.25), 0.35) * 12.566;
    vec3 light = vec3(0.0);
    float through = 1.0;
    float budget = cvSteps;
    float seenWeight = 0.0;
    float seenDistance = 0.0;
    for (int k = 0; k < 10; k++) {
        if (k >= count || through < 0.02 || budget <= 0.0) break;
        float a = starts[k];
        float b = ends[k];
        if (b <= a) continue;
        mat4 L = cvLayer(owner[k]);
        // One march for each kind of cloud: a stretch of deck runs none of the
        // storm towers' code, and only a stretch that passes near a vortex the vortex's.
        int kind = int(L[2].w + 0.5);
#if defined(CV_DUST) || defined(CV_THUNDER)
        // A storm cell over the ground: only the part of the ray that comes near it.
        if (kind >= 5) {
            vec2 reached = cvSphere(cvCam - cvCellBound.xyz, dir, cvCellBound.w);
            float a5 = max(a, reached.x);
            float b5 = min(b, reached.y);
#ifdef CV_DEBUG
            cvDbg.y = max(cvDbg.y, b5 - a5); cvDbg.w = max(cvDbg.w, b - a);
#endif
            if (b5 > a5) {
#ifdef CV_DUST
                if (kind == 5) cvMarch(5, false, a5, b5, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance);
#endif
#ifdef CV_THUNDER
                if (kind == 6) cvMarch(6, false, a5, b5, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance);
#endif
            }
            continue;
        }
#endif
#ifdef CV_VORTEX
        float mid = cvRadius + (L[0].x + L[0].y) * 0.5;
        float slack = (L[0].y - L[0].x) * 0.5;
        vec3 pa = cvCam + dir * a;
        vec3 pb = cvCam + dir * b;
        bool vortex = cvVortexNear(pa, pb, mid, slack, cvVA0, cvVC0) || cvVortexNear(pa, pb, mid, slack, cvVA1, cvVC1)
            || cvVortexNear(pa, pb, mid, slack, cvVA2, cvVC2) || cvVortexNear(pa, pb, mid, slack, cvVA3, cvVC3);
        if (kind == 4) { cvMarch(4, true, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance); continue; }
#ifdef CV_STORMS
        if (kind == 2 && vortex) { cvMarch(2, true, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance); continue; }
#endif
        if (kind != 2 && kind != 3 && vortex) { cvMarch(0, true, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance); continue; }
#endif
#ifdef CV_STORMS
        if (kind == 2) { cvMarch(2, false, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance); continue; }
#endif
#ifdef CV_CIRRUS
        if (kind == 3) { cvMarch(3, false, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance); continue; }
#endif
        cvMarch(0, false, a, b, L, dir, jitter, phase, budget, light, through, seenWeight, seenDistance);
    }
    outLight = vec4(light, through);
#ifdef CV_DEBUG
    // Red: the densest sample; green: the stretch marched near the cell (per 10 km); blue: steps (per 40).
    outLight = vec4(cvDbg.x * 4.0, cvDbg.y / 10000.0, cvDbg.z / 40.0, 0.0);
#endif
    // Where the cloud that was seen lies (for carrying last frame's picture over).
    if (seenWeight > 1e-3) outDepth.x = min(seenDistance / seenWeight, 60000.0);
}
`;

// ---- The resolve: last frame's picture, moved to where it now appears on the
// screen and held within the range of this frame's neighbouring pixels (so it
// cannot smear what changed), blended with this frame's.
const resolveFragment = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outLight;
layout(location = 1) out vec4 outDepth;
uniform sampler2D tLight;
uniform sampler2D tDepth;
uniform sampler2D hLight;
uniform mat4 cvInvProj;
uniform mat4 cvCamWorld;
uniform mat4 cvPrevViewProj;
uniform vec3 cvCamDelta;
uniform float cvBlend;
uniform vec2 cvTexel;

void main() {
    vec4 cur = texture(tLight, vUv);
    vec4 dep = texture(tDepth, vUv);
    vec4 lo = cur;
    vec4 hi = cur;
    #define CV_NEAR(dx, dy) { vec4 s = texture(tLight, vUv + vec2(dx, dy) * cvTexel); lo = min(lo, s); hi = max(hi, s); }
    CV_NEAR(-1.0, -1.0) CV_NEAR(0.0, -1.0) CV_NEAR(1.0, -1.0)
    CV_NEAR(-1.0, 0.0) CV_NEAR(1.0, 0.0)
    CV_NEAR(-1.0, 1.0) CV_NEAR(0.0, 1.0) CV_NEAR(1.0, 1.0)
    vec4 nearPoint = cvInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
    vec3 viewDir = normalize(nearPoint.xyz / nearPoint.w);
    vec3 dir = normalize((cvCamWorld * vec4(viewDir, 0.0)).xyz);
    // The cloud seen here, from where the camera was last frame.
    vec4 clip = cvPrevViewProj * vec4(dir * dep.x + cvCamDelta, 1.0);
    vec2 prev = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
    bool inside = clip.w > 0.0 && prev.x >= 0.0 && prev.y >= 0.0 && prev.x <= 1.0 && prev.y <= 1.0;
    vec4 history = clamp(texture(hLight, prev), lo, hi);
    outLight = inside ? mix(history, cur, cvBlend) : cur;
    outDepth = dep;
}
`;

// ---- The composite (full size): the scene seen through the gas, and the
// clouds over it, each pixel taking the half-size clouds of whichever of its
// four neighbours ended at the same distance (so the ship keeps a clean edge).
const compositeFragment = /* glsl */ `
uniform sampler2D cvLight;
uniform sampler2D cvLowDepth;
uniform vec2 cvLowSize;
uniform float cvActive;
uniform float cvClouds;
uniform vec3 cvCam;
uniform mat4 cvInvProj;
uniform mat4 cvCamWorld;
uniform float cvRadius;
uniform vec4 cvHaze;
uniform vec3 cvMurk;
uniform float cvInfrared;
uniform float cvExposure;

// How much of what lies 'dist' along the ray gets through the gas between the
// clouds: an exponential atmosphere, thicker going down, taken as level over
// the short distances that matter (the sky, from below the cloud tops, never).
float cvMurkThrough(vec3 dir, float dist) {
    if (cvMurk.z < 0.5) return 1.0;
    float h0 = length(cvCam) - cvRadius;
    float mu = dot(dir, normalize(cvCam));
    float H = cvMurk.y;
    float sigma0 = cvMurk.x * exp(min(-h0 / H, 60.0));
    float tau;
    if (dist > 1e19) {
        // The sky: up through what is left of the gas above; or along a ray
        // that grazes the planet, through the air at its lowest point (a
        // Chapman path), which from below the cloud tops is all of it.
        float r0 = cvRadius + h0;
        float low = r0 * sqrt(max(1.0 - mu * mu, 0.0)) - cvRadius;
        float graze = cvMurk.x * exp(min(-(mu > 0.0 ? h0 : low) / H, 60.0)) * sqrt(6.2831853 * max(cvRadius + low, 1.0) * H);
        tau = mu > 0.0 ? min(sigma0 * H / max(mu, 1e-4), graze) : graze;
    } else if (abs(mu) < 1e-3) {
        tau = sigma0 * dist;
    } else {
        tau = sigma0 * H / mu * (1.0 - exp(min(-mu * dist / H, 60.0)));
    }
    return exp(-min(tau, 60.0));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    outputColor = inputColor;
    if (cvActive < 0.5) return;
    // (The eye's adaptation to the dark, applied to everything seen.)
    vec4 nearPoint = cvInvProj * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
    vec3 viewDir = normalize(nearPoint.xyz / nearPoint.w);
    vec3 dir = normalize((cvCamWorld * vec4(viewDir, 0.0)).xyz);
    float raw = texture2D(depthBuffer, uv).r;
    float sceneDistance = raw >= 0.999999 ? 1e20 : (exp2(raw * log2(cameraFar + 1.0)) - 1.0) / max(-viewDir.z, 1e-4);
    // Whatever is behind the clouds, seen through the gas.
    vec3 behind = mix(cvHaze.rgb, inputColor.rgb, cvMurkThrough(dir, sceneDistance));
    if (cvClouds < 0.5) {
        outputColor = vec4(behind * cvExposure, inputColor.a);
        return;
    }
    float mine = min(sceneDistance, 60000.0);
    vec2 at = uv * cvLowSize - 0.5;
    vec2 f = fract(at);
    vec2 base = (floor(at) + 0.5) / cvLowSize;
    vec2 texel = 1.0 / cvLowSize;
    vec4 sum = vec4(0.0);
    float total = 0.0;
    #define CV_TAP(ox, oy, wb) { vec2 q = base + vec2(ox, oy) * texel; float d = texture2D(cvLowDepth, q).g; float w = (wb) / (1e-3 + abs(d - mine) / max(mine, 1.0)); sum += texture2D(cvLight, q) * w; total += w; }
    CV_TAP(0.0, 0.0, (1.0 - f.x) * (1.0 - f.y))
    CV_TAP(1.0, 0.0, f.x * (1.0 - f.y))
    CV_TAP(0.0, 1.0, (1.0 - f.x) * f.y)
    CV_TAP(1.0, 1.0, f.x * f.y)
    vec4 clouds = total > 1e-6 ? sum / total : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 seen = behind * clouds.a + clouds.rgb;
    if (cvInfrared > 0.0) {
        // At 5 microns the depths glow with their own heat and the clouds are
        // cold silhouettes against it, by night as by day (Cassini's VIMS saw
        // Saturn's polar storms this way through the long polar night).
        float mu = dot(dir, normalize(cvCam));
        float down = smoothstep(0.15, -0.6, mu);
        vec3 glow = mix(vec3(0.05, 0.004, 0.002), mix(vec3(0.85, 0.3, 0.04), vec3(1.0, 0.78, 0.3), down * down), 0.2 + 0.8 * down);
        // Things close by (the ship) stay as they are.
        float far = smoothstep(600.0, 2500.0, sceneDistance);
        seen = mix(seen, mix(inputColor.rgb, glow, far) * clouds.a, cvInfrared);
    }
    outputColor = vec4(seen * cvExposure, inputColor.a);
}
`;

const layerMatrix = (layer: CloudLayerSpec | undefined, out: THREE.Matrix4) => {
    if (!layer) return out.identity();
    const lit = new THREE.Color(layer.lit);
    const shade = new THREE.Color(layer.shade);
    // Matrix4.set takes rows; the shader reads columns, so each column here is one row of set().
    return out.set(
        layer.bottom, layer.scale, lit.r, shade.r,
        layer.top, layer.erosion, lit.g, shade.g,
        layer.coverage, layer.anvil, lit.b, shade.b,
        layer.density, layer.storm, layer.useMap ? 1 : layer.towers ? 2 : layer.cirrus ? 3 : layer.vortex ? 4 : layer.dust ? 5 : layer.thunder ? 6 : 0, layer.towers ?? layer.cirrus ?? 0,
    );
};

const quadVertex = /* glsl */ `
precision highp float;
in vec3 position;
out vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Half-float light (rgb) and what gets through (a), and the distances: where the cloud seen lies, where the scene is. */
const makeTarget = () => {
    const target = new THREE.WebGLRenderTarget(1, 1, {
        count: 2,
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    });
    target.textures[1].minFilter = THREE.NearestFilter;
    target.textures[1].magFilter = THREE.NearestFilter;
    return target;
};

/** The features a set of layers needs compiled into the march: S storm towers, C cirrus, D a dust storm, T a thunderstorm cell, E Earth's cumulus (V, a vortex in reach, is added by the scene). */
export const marchKey = (layers: CloudLayerSpec[]) =>
    (layers.some((layer) => !!layer.towers) ? 'S' : '') + (layers.some((layer) => !!layer.cirrus) ? 'C' : '') + (layers.some((layer) => !!layer.dust) ? 'D' : '') + (layers.some((layer) => !!layer.thunder) ? 'T' : '')
    + (layers.some((layer) => !!layer.cover) ? 'E' : '');

/** How much of a new frame goes into the picture (the rest is the frames before). */
const BLEND = 0.08;

export class CloudVolumeEffect extends Effect {
    private readonly march = makeTarget();
    private readonly history = [makeTarget(), makeTarget()];
    private current = 0;
    /** The march's uniforms, shared by every version of its shader. */
    private readonly marchUniforms: Record<string, THREE.IUniform>;
    /** Its shader in versions with only the features a giant has (see marchKey). */
    private readonly variants = new Map<string, { material: THREE.RawShaderMaterial; ready: boolean; pending: boolean }>();
    private wanted = '';
    private readonly resolveMaterial: THREE.RawShaderMaterial;
    private readonly quad: THREE.Mesh;
    private readonly quadScene = new THREE.Scene();
    private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private camera: THREE.PerspectiveCamera | null = null;
    private scene: CloudScene | null = null;
    private clouds = false;
    private fresh = true;
    private frame = 0;
    private readonly cam = new THREE.Vector3();
    private readonly prevCam = new THREE.Vector3();
    private readonly prevViewProj = new THREE.Matrix4();
    private prevRadius = 0;
    private readonly rotation = new THREE.Matrix4();

    constructor(noise: THREE.Data3DTexture | THREE.Texture) {
        super('CloudVolumeEffect', compositeFragment, {
            attributes: EffectAttribute.DEPTH,
            blendFunction: BlendFunction.NORMAL,
            uniforms: new Map<string, THREE.Uniform>([
                ['cvLight', new THREE.Uniform(null)],
                ['cvLowDepth', new THREE.Uniform(null)],
                ['cvLowSize', new THREE.Uniform(new THREE.Vector2(1, 1))],
                ['cvActive', new THREE.Uniform(0)],
                ['cvClouds', new THREE.Uniform(0)],
                ['cvCam', new THREE.Uniform(new THREE.Vector3())],
                ['cvInvProj', new THREE.Uniform(new THREE.Matrix4())],
                ['cvCamWorld', new THREE.Uniform(new THREE.Matrix4())],
                ['cvRadius', new THREE.Uniform(1)],
                ['cvHaze', new THREE.Uniform(new THREE.Vector4(0.5, 0.5, 0.5, 1e9))],
                ['cvMurk', new THREE.Uniform(new THREE.Vector3())],
                ['cvInfrared', new THREE.Uniform(0)],
                ['cvExposure', new THREE.Uniform(1)],
            ]),
        });
        this.marchUniforms = {
                cvNoise: { value: noise },
                cvMap: { value: null },
                cvCoverMap: { value: null },
                cvCoverFrame: { value: new THREE.Matrix3() },
                cvDepthTex: { value: null },
                cvFar: { value: 1e10 },
                cvFrame: { value: 0 },
                cvCam: { value: new THREE.Vector3() },
                cvInvProj: { value: new THREE.Matrix4() },
                cvCamWorld: { value: new THREE.Matrix4() },
                cvRadius: { value: 1 },
                cvAxis: { value: new THREE.Vector3(0, 1, 0) },
                cvLayer0: { value: new THREE.Matrix4() },
                cvLayer1: { value: new THREE.Matrix4() },
                cvLayer2: { value: new THREE.Matrix4() },
                cvLayer3: { value: new THREE.Matrix4() },
                cvLayer4: { value: new THREE.Matrix4() },
                cvLayers: { value: 0 },
                cvCirrus: { value: -1 },
                cvCirrusTurn: { value: 0 },
                cvSun: { value: new THREE.Vector3(0, 1, 0) },
                cvSunColor: { value: new THREE.Color(1, 1, 1) },
                cvSkyTop: { value: new THREE.Color() },
                cvSkyBottom: { value: new THREE.Color() },
                cvWind: { value: new THREE.Vector3() },
                cvFlash: { value: new THREE.Vector4() },
                cvHaze: { value: new THREE.Vector4(0.5, 0.5, 0.5, 1e9) },
                cvReach: { value: 60000 },
                cvSteps: { value: 48 },
                cvDeckTop: { value: new THREE.Vector3(1e9, 1e9, 1e9) },
                cvDeckThick: { value: new THREE.Vector3(1, 1, 1) },
                cvVA0: { value: new THREE.Vector4() }, cvVA1: { value: new THREE.Vector4() }, cvVA2: { value: new THREE.Vector4() }, cvVA3: { value: new THREE.Vector4() },
                cvVB0: { value: new THREE.Vector4() }, cvVB1: { value: new THREE.Vector4() }, cvVB2: { value: new THREE.Vector4() }, cvVB3: { value: new THREE.Vector4() },
                cvVC0: { value: new THREE.Vector4(1, 0, 0, 0) }, cvVC1: { value: new THREE.Vector4(1, 0, 0, 0) }, cvVC2: { value: new THREE.Vector4(1, 0, 0, 0) }, cvVC3: { value: new THREE.Vector4(1, 0, 0, 0) },
                cvE1: { value: new THREE.Vector3(1, 0, 0) },
                cvWall: { value: new THREE.Vector2(0, 1) },
                cvTime: { value: 0 },
                cvCellA: { value: new THREE.Vector4() },
                cvCellB: { value: new THREE.Vector4() },
                cvCellC: { value: new THREE.Vector4() },
                cvCellBound: { value: new THREE.Vector4() },
                cvCellD: { value: new THREE.Vector4(1, 0, 0, 0) },
        };
        this.resolveMaterial = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: quadVertex,
            fragmentShader: resolveFragment,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                tLight: { value: null },
                tDepth: { value: null },
                hLight: { value: null },
                cvInvProj: { value: new THREE.Matrix4() },
                cvCamWorld: { value: new THREE.Matrix4() },
                cvPrevViewProj: { value: new THREE.Matrix4() },
                cvCamDelta: { value: new THREE.Vector3() },
                cvBlend: { value: 1 },
                cvTexel: { value: new THREE.Vector2(1, 1) },
            },
        });
        this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.resolveMaterial);
        this.quad.frustumCulled = false;
        this.quadScene.add(this.quad);
    }

    override setDepthTexture(depthTexture: THREE.Texture) {
        this.marchUniforms.cvDepthTex.value = depthTexture;
    }

    private variant(key: string) {
        let variant = this.variants.get(key);
        if (!variant) {
            const defines: Record<string, number> = {};
            if (key.includes('S')) defines.CV_STORMS = 1;
            if (key.includes('C')) defines.CV_CIRRUS = 1;
            if (key.includes('V')) defines.CV_VORTEX = 1;
            if (key.includes('D')) defines.CV_DUST = 1;
            if (key.includes('T')) defines.CV_THUNDER = 1;
            if (key.includes('E')) defines.CV_EARTH = 1;
            if (import.meta.env.DEV && new URLSearchParams(location.search).has('cvdbg')) defines.CV_DEBUG = 1;
            const material = new THREE.RawShaderMaterial({
                glslVersion: THREE.GLSL3,
                defines,
                vertexShader: quadVertex,
                fragmentShader: marchFragment,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
                uniforms: this.marchUniforms,
            });
            variant = { material, ready: false, pending: false };
            this.variants.set(key, variant);
        }
        return variant;
    }

    /**
     * Compile, in the background, the versions of the march a giant needs
     * (its features, with and without a vortex in reach), long before its
     * clouds are drawn: the first frame among them, or the moment a cyclone
     * comes within reach, never waits on a shader compiler.
     */
    prepare(renderer: THREE.WebGLRenderer, base: string | null) {
        if (base === null) return;
        this.compile(renderer, base);
        // (The worlds with ground have no vortices.)
        if (!base.includes('D') && !base.includes('T') && !base.includes('E')) this.compile(renderer, `${base}V`);
    }

    private compile(renderer: THREE.WebGLRenderer, key: string) {
        const variant = this.variant(key);
        if (variant.ready || variant.pending) return variant;
        variant.pending = true;
        const mesh = new THREE.Mesh(this.quad.geometry, variant.material);
        mesh.frustumCulled = false;
        const done = () => { variant.ready = true; variant.pending = false; };
        compileSafely(renderer, mesh, this.quadCamera).then(done);
        return variant;
    }

    /**
     * The version of the march to draw with: the one wanted; while it is still
     * compiling, a ready one that has all its features; failing that, none:
     * the clouds wait for the compiler, the frame never does. (Waited on, the
     * march's compile froze the game for seconds on Windows when a giant was
     * reached sooner than its shaders were ready, under the pulse drive.)
     */
    private marchMaterial(renderer: THREE.WebGLRenderer) {
        const wanted = this.compile(renderer, this.wanted);
        if (wanted.ready) return wanted.material;
        for (const [key, variant] of this.variants) {
            if (variant.ready && [...this.wanted].every((c) => key.includes(c))) return variant.material;
        }
        return null;
    }

    override setSize(width: number, height: number) {
        const w = Math.max(1, Math.ceil(width / 2));
        const h = Math.max(1, Math.ceil(height / 2));
        this.march.setSize(w, h);
        this.history[0].setSize(w, h);
        this.history[1].setSize(w, h);
        (this.uniforms.get('cvLowSize')!.value as THREE.Vector2).set(w, h);
        (this.resolveMaterial.uniforms.cvTexel.value as THREE.Vector2).set(1 / w, 1 / h);
        this.fresh = true;
    }

    /** Nothing to draw: the pass costs one texture read per pixel. */
    off() {
        this.uniforms.get('cvActive')!.value = 0;
        this.clouds = false;
        this.fresh = true;
    }

    /** Describe the clouds round the camera for this frame. */
    set(scene: CloudScene, camera: THREE.Camera, steps: number) {
        this.scene = scene;
        this.camera = camera as THREE.PerspectiveCamera;
        const clouds = scene.layers.length > 0;
        if (clouds && !this.clouds) this.fresh = true;
        this.clouds = clouds;
        this.uniforms.get('cvActive')!.value = 1;
        this.uniforms.get('cvClouds')!.value = clouds ? 1 : 0;
        this.wanted = marchKey(scene.layers) + (scene.vortexA[0].w > 0 ? 'V' : '');
        // DEV: ?cvkey= forces a version of the march (frame-time tests), and window.__cvKey shows the one wanted.
        if (import.meta.env.DEV) { const force = new URLSearchParams(location.search).get('cvkey'); if (force !== null) this.wanted = force === '-' ? '' : force; (window as unknown as { __cvKey?: string }).__cvKey = this.wanted; }
        const m = this.marchUniforms;
        m.cvRadius.value = scene.radius;
        (m.cvAxis.value as THREE.Vector3).copy(scene.axis);
        layerMatrix(scene.layers[0], m.cvLayer0.value as THREE.Matrix4);
        layerMatrix(scene.layers[1], m.cvLayer1.value as THREE.Matrix4);
        layerMatrix(scene.layers[2], m.cvLayer2.value as THREE.Matrix4);
        layerMatrix(scene.layers[3], m.cvLayer3.value as THREE.Matrix4);
        layerMatrix(scene.layers[4], m.cvLayer4.value as THREE.Matrix4);
        m.cvLayers.value = Math.min(5, scene.layers.length);
        m.cvCirrus.value = scene.layers.findIndex((layer, i) => i < 5 && !!layer.cirrus);
        m.cvCirrusTurn.value = scene.cirrusTurn;
        (m.cvSun.value as THREE.Vector3).copy(scene.sun);
        (m.cvSunColor.value as THREE.Color).copy(scene.sunColor);
        (m.cvSkyTop.value as THREE.Color).copy(scene.skyTop);
        (m.cvSkyBottom.value as THREE.Color).copy(scene.skyBottom);
        (m.cvWind.value as THREE.Vector3).copy(scene.wind);
        (m.cvFlash.value as THREE.Vector4).set(scene.flash.x, scene.flash.y, scene.flash.z, scene.flashLevel);
        (m.cvHaze.value as THREE.Vector4).set(scene.haze.r, scene.haze.g, scene.haze.b, scene.visibility);
        (this.uniforms.get('cvHaze')!.value as THREE.Vector4).set(scene.haze.r, scene.haze.g, scene.haze.b, scene.visibility);
        m.cvReach.value = scene.reach;
        m.cvSteps.value = steps;
        m.cvMap.value = scene.map;
        m.cvCoverMap.value = scene.cover;
        (m.cvCoverFrame.value as THREE.Matrix3).copy(scene.coverFrame);
        (m.cvDeckTop.value as THREE.Vector3).copy(scene.deckTop);
        (m.cvDeckThick.value as THREE.Vector3).copy(scene.deckThick);
        for (let i = 0; i < 4; i++) {
            (m[`cvVA${i}`].value as THREE.Vector4).copy(scene.vortexA[i]);
            (m[`cvVB${i}`].value as THREE.Vector4).copy(scene.vortexB[i]);
            (m[`cvVC${i}`].value as THREE.Vector4).copy(scene.vortexC[i]);
        }
        (m.cvE1.value as THREE.Vector3).copy(scene.e1);
        (m.cvWall.value as THREE.Vector2).copy(scene.wall);
        m.cvTime.value = scene.time;
        (m.cvCellA.value as THREE.Vector4).copy(scene.cell.a);
        (m.cvCellB.value as THREE.Vector4).copy(scene.cell.b);
        (m.cvCellC.value as THREE.Vector4).copy(scene.cell.c);
        (m.cvCellBound.value as THREE.Vector4).copy(scene.cell.bound);
        (m.cvCellD.value as THREE.Vector4).copy(scene.cell.d);
        (this.uniforms.get('cvMurk')!.value as THREE.Vector3).copy(scene.murk);
        this.uniforms.get('cvRadius')!.value = scene.radius;
        this.uniforms.get('cvInfrared')!.value = scene.infrared;
        this.uniforms.get('cvExposure')!.value = scene.exposure;
    }

    /** Just before the frame is drawn, with the camera where it will be seen from: march, then blend. */
    override update(renderer: THREE.WebGLRenderer) {
        const camera = this.camera;
        const scene = this.scene;
        if (!camera || !scene || this.uniforms.get('cvActive')!.value < 0.5) return;
        this.cam.copy(camera.position).sub(scene.centre);
        (this.uniforms.get('cvCam')!.value as THREE.Vector3).copy(this.cam);
        (this.uniforms.get('cvInvProj')!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (this.uniforms.get('cvCamWorld')!.value as THREE.Matrix4).copy(camera.matrixWorld);
        if (!this.clouds) return;
        const m = this.marchUniforms;
        (m.cvCam.value as THREE.Vector3).copy(this.cam);
        (m.cvInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (m.cvCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
        m.cvFar.value = camera.far;
        m.cvFrame.value = this.frame;
        const r = this.resolveMaterial.uniforms;
        // A jump (a new world, a teleport) starts the picture afresh.
        if (scene.radius !== this.prevRadius || this.cam.distanceTo(this.prevCam) > 3000) this.fresh = true;
        (r.cvInvProj.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
        (r.cvCamWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
        (r.cvPrevViewProj.value as THREE.Matrix4).copy(this.prevViewProj);
        (r.cvCamDelta.value as THREE.Vector3).copy(this.cam).sub(this.prevCam);
        r.cvBlend.value = this.fresh ? 1 : BLEND;

        const material = this.marchMaterial(renderer);
        if (!material) {
            this.uniforms.get('cvClouds')!.value = 0;
            this.fresh = true;
            return;
        }
        const previous = renderer.getRenderTarget();
        this.quad.material = material;
        renderer.setRenderTarget(this.march);
        renderer.render(this.quadScene, this.quadCamera);
        const read = this.history[this.current];
        const write = this.history[1 - this.current];
        r.tLight.value = this.march.textures[0];
        r.tDepth.value = this.march.textures[1];
        r.hLight.value = read.textures[0];
        this.quad.material = this.resolveMaterial;
        renderer.setRenderTarget(write);
        renderer.render(this.quadScene, this.quadCamera);
        renderer.setRenderTarget(previous);
        this.current = 1 - this.current;
        this.uniforms.get('cvLight')!.value = write.textures[0];
        this.uniforms.get('cvLowDepth')!.value = write.textures[1];

        // For the next frame: where this one was seen from (rotation only; the
        // camera's movement is carried separately, relative to the planet).
        this.rotation.copy(camera.matrixWorld).setPosition(0, 0, 0).invert();
        this.prevViewProj.multiplyMatrices(camera.projectionMatrix, this.rotation);
        this.prevCam.copy(this.cam);
        this.prevRadius = scene.radius;
        this.fresh = false;
        this.frame = (this.frame + 1) % 64;
    }

    override dispose() {
        this.march.dispose();
        this.history[0].dispose();
        this.history[1].dispose();
        for (const variant of this.variants.values()) variant.material.dispose();
        this.resolveMaterial.dispose();
        this.quad.geometry.dispose();
        super.dispose();
    }
}
