import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';
import { MAP_WIDTH, loadMapTexture } from './mapLoader';
import { CUBE_SPHERE_GLSL, buildChunkGeometry, faceUniforms, selectChunks } from './terrain';
import { HEIGHT_RANGE, createHeightFunction, heightGLSL, terrainUniforms, type BiomeDef, type BiomeKind, type ExpeditionBody } from './bodies';
import { usesEarthMap } from './earth';
import { usesMarsMap } from './mars';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms, eyeGain } from './surfaceShading';
import { WIND_GLSL, WIND_GUST_GLSL, WIND_UNIFORMS, updateWind } from './windField';
import { WATER_TURNS_GLSL, WATER_WAVES_GLSL } from './waterShading';
import { globeFrame, landingZoneDirection } from './sites';
import { watchView, type ExpeditionRuntime } from './runtime';
import { trackLoad } from './loadProgress';
import { directionToBody, placeBodyGroup } from './motion';
import { skyScale } from './skyScale';
import { REVIVAL_GLSL } from './revival';

// Height bands (low->mid, mid->high, blend width), steepness (rock below
// slope.x, grass above slope.y) and how strongly cliffs show strata.
// Strata only where the rock was laid down in layers (canyon walls of
// sediment); none on the Moon's breccia or on ice.
const BIOME_SHADING: Record<BiomeKind, { bands: [number, number, number]; steep: [number, number]; strata: number; variation: number }> = {
    verdant: { bands: [70, 300, 45], steep: [0.66, 0.8], strata: 0.12, variation: 1.0 },
    desert: { bands: [30, 185, 25], steep: [0.8, 0.92], strata: 0.25, variation: 0.7 },
    cratered: { bands: [-70, 120, 60], steep: [0.8, 0.93], strata: 0, variation: 0.8 },
    canyon: { bands: [-140, 90, 45], steep: [0.8, 0.92], strata: 0.45, variation: 0.8 },
    frozen: { bands: [60, 330, 50], steep: [0.74, 0.88], strata: 0.05, variation: 0.6 },
    glacier: { bands: [70, 250, 40], steep: [0.76, 0.9], strata: 0.1, variation: 0.7 },
    // Lava plains, flows and domes: no beds of sediment.
    volcanic: { bands: [40, 260, 50], steep: [0.78, 0.9], strata: 0, variation: 0.6 },
    // Titan: dark sand low down, paler ice-rich ground on the hills.
    methane: { bands: [-4, 70, 22], steep: [0.78, 0.9], strata: 0.08, variation: 0.6 },
};

/** How a world's ground is coloured by height and slope (its palette's bands; Grass.tsx matches it). */
export const terrainShading = (body: ExpeditionBody) => BIOME_SHADING[body.biome?.kind ?? 'cratered'];

export const MAX_CHUNKS = 1600;

/**
 * Photographed ground (public/textures/expedition/terrain): what covers the
 * gentle ground, the high ground and the cliffs of each kind of world, and how
 * many metres one repeat of each covers (ground close up, ground from afar,
 * rock). The ground pictures were made for the project; the cliffs are real
 * rock photographed for ambientCG (CC0), each with its normal map, so a cliff
 * has relief that catches the light. Each picture's mean colour (linear) lets
 * the shader keep the world's own colours and take only the picture's detail.
 */
type TerrainPicture = 'grass' | 'granite' | 'sand' | 'sandstone' | 'regolith' | 'mars' | 'snow' | 'ice'
    | 'rock-layered' | 'rock-red' | 'rock-dark' | 'rock-grey' | 'rock-ice' | 'basalt' | 'gravel' | 'dunes';
const PICTURE_MEAN: Record<TerrainPicture, [number, number, number]> = {
    grass: [0.0681, 0.0915, 0.0234],
    granite: [0.1854, 0.1632, 0.1345],
    sand: [0.7274, 0.2573, 0.0651],
    sandstone: [0.5671, 0.2787, 0.1128],
    regolith: [0.3051, 0.298, 0.2826],
    mars: [0.2687, 0.0554, 0.0266],
    snow: [0.4417, 0.5, 0.6029],
    ice: [0.2085, 0.329, 0.4609],
    'rock-layered': [0.1333, 0.1319, 0.126],
    'rock-red': [0.1101, 0.0808, 0.0679],
    'rock-dark': [0.0345, 0.035, 0.0316],
    'rock-grey': [0.1072, 0.1054, 0.0994],
    'rock-ice': [0.3831, 0.3837, 0.3723],
    basalt: [0.0294, 0.023, 0.0167],
    gravel: [0.301, 0.293, 0.2681],
    dunes: [0.5413, 0.3559, 0.1862],
};
/** Pictures that come with a normal map (`<name>-n.webp`). */
const HAS_NORMALS = new Set<TerrainPicture>(['rock-layered', 'rock-red', 'rock-dark', 'rock-grey', 'rock-ice', 'basalt', 'gravel', 'dunes']);
const BIOME_PICTURES: Record<BiomeKind, { ground: TerrainPicture; high?: TerrainPicture; rock: TerrainPicture; tiles: [number, number, number] }> = {
    // Earth's cliffs are the layered limestone of the river bluffs; Mars's
    // are red sediment; the Moon's and Mercury's dark breccia; ice worlds' ice.
    verdant: { ground: 'grass', rock: 'rock-layered', tiles: [2.6, 17, 8] },
    desert: { ground: 'sand', rock: 'rock-grey', tiles: [4, 23, 10] },
    cratered: { ground: 'regolith', rock: 'rock-dark', tiles: [6, 31, 9] },
    canyon: { ground: 'mars', rock: 'rock-red', tiles: [5, 27, 12] },
    frozen: { ground: 'snow', rock: 'rock-ice', tiles: [5, 29, 9] },
    glacier: { ground: 'ice', high: 'snow', rock: 'rock-ice', tiles: [7, 33, 9] },
    // Venus: gravelly basalt soil, plates of basalt on the rises, basalt cliffs.
    volcanic: { ground: 'gravel', high: 'basalt', rock: 'basalt', tiles: [3.5, 21, 7] },
    // Titan: rippled dark sand, pebble plains on the rises, grey ice bedrock.
    methane: { ground: 'dunes', high: 'gravel', rock: 'rock-grey', tiles: [4, 23, 9] },
};

const pictures = new Map<string, Promise<THREE.Texture>>();
export const loadPicture = (name: TerrainPicture, anisotropy: number, normals = false) => {
    const file = normals ? `${name}-n` : name;
    let pending = pictures.get(file);
    if (!pending) {
        pending = trackLoad(new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/expedition/terrain/${file}.webp`)).then((texture) => {
            // A normal map is data, not colour.
            texture.colorSpace = normals ? THREE.NoColorSpace : THREE.SRGBColorSpace;
            texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = anisotropy;
            return texture;
        });
        pending.catch(() => undefined);
        pictures.set(file, pending);
    }
    return pending;
};
/** A world's cliff rock: its picture, that picture's mean colour (linear), and whether it has a normal map. */
export const rockPictureOf = (body: ExpeditionBody) => {
    const name = BIOME_PICTURES[body.biome?.kind ?? 'cratered'].rock;
    return { name, mean: PICTURE_MEAN[name], normals: HAS_NORMALS.has(name) };
};

const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.needsUpdate = true;

/** Load a world's pictures when it is this close (m); from further away they cannot be seen. */
const PICTURE_RANGE = 40000;

const vertexShader = (body: ExpeditionBody) => /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${NOISE_GLSL}
${CUBE_SPHERE_GLSL}
${heightGLSL(body)}

attribute vec4 aChunk;
uniform float uRadius;
uniform float uGridN;
uniform uint uSeed;

varying vec3 vNormalLocal;
varying vec3 vDir;
varying vec3 vLocalPos;
varying float vHeight;
varying float vVariation;
uniform float uForest;
varying float vForest;
uniform mat3 uTexFrame;
varying vec3 vTex;
// Depth of water here, and distance from the sea's shore (Earth only).
varying vec2 vWater;
#if defined(TERRAIN_EARTH) || defined(TERRAIN_STREAMS)
// Which way a river runs here (zero off rivers; it eases to nothing at the banks).
varying vec3 vFlow;
#endif
#ifdef TERRAIN_EARTH
// The river field here (earth.ts gRiver), for drawing the banks.
varying float vRiver;
#endif
#ifdef TERRAIN_GLOBE
uniform vec2 uGlobeFade;
uniform vec3 uCamLocal;
uniform float uGlobeReady;
#endif
#ifdef TERRAIN_WATER
// Inside this distance the water is drawn as its own surface (WaterSurface.tsx) and the ground
// here is the bed under it (0: it is not drawn); how far this spot is the bed.
uniform float uWaterNear;
varying float vUnder;
#ifndef TERRAIN_GLOBE
uniform vec3 uCamLocal;
#endif
#endif
// Where Earth's grass has dried golden (the field Grass.tsx dries its blades by).
varying float vDry;
#ifdef TERRAIN_MARS
// How much the ground is laid in beds of rock here, and how thick they are.
varying float vBeds;
varying float vBedT;
#endif

void main() {
    int face = int(aChunk.x + 0.5);
    vec2 uv = aChunk.yz + position.xy * aChunk.w;
    float spacing = aChunk.w * 0.785 * uRadius / uGridN;
    vec3 d = dirAt(face, uv);
    vec2 water;
    // From far off, a world with a photographed map is that photograph on a
    // smooth ball: the ground's own relief, steep enough to make walking
    // interesting, is many times the real thing at this scale and turned the
    // globe into a lumpy ball (Mars from Phobos). It rises as one comes in.
    float relief = 1.0;
    #ifdef TERRAIN_GLOBE
    relief = 1.0 - smoothstep(uGlobeFade.x, uGlobeFade.y, length(d * uRadius - uCamLocal)) * uGlobeReady;
    #endif
    float e = aChunk.w / uGridN;
    vec3 dU = dirAt(face, uv + vec2(e, 0.0));
    vec3 dV = dirAt(face, uv + vec2(0.0, e));
    #ifdef TERRAIN_MARS
    // Mars's ground is built on its measured shape: only the invented relief
    // on it leaves (where it has gone it is not worked out at all), the
    // volcanoes and canyons stay. Its regional character is worked out once
    // for this vertex and its neighbours.
    vec2 molaHere;
    vec2 llHere;
    MarsRegion region = marsRegionAt(d, molaHere, llHere);
    water = vec2(0.0, 1e4);
    float h = molaHere.x;
    float hU;
    float hV;
    vBeds = 0.0;
    vBedT = region.bedT;
    // (A skirt vertex, dropped under the ground to hide cracks between
    // tiles, needs no slope of its own.)
    bool skirt = position.z > 0.5;
    if (relief > 0.001) {
        MarsCraters bigC;
        MarsCraters smallC;
        marsCraterLists(d, spacing, region, bigC, smallC);
        vec2 ll;
        h = marsHeightWith(d, spacing, region, molaHere, bigC, smallC);
        vBeds = gBeds;
        h = molaHere.x + (h - molaHere.x) * relief;
        if (skirt) {
            hU = h;
            hV = h;
        } else {
            hU = marsHeightWith(dU, spacing, region, marsMolaNear(dU, d, llHere), bigC, smallC);
            hU = gMola + (hU - gMola) * relief;
            hV = marsHeightWith(dV, spacing, region, marsMolaNear(dV, d, llHere), bigC, smallC);
            hV = gMola + (hV - gMola) * relief;
        }
    } else {
        hU = marsMolaNear(dU, d, llHere).x;
        hV = marsMolaNear(dV, d, llHere).x;
    }
    #else
    float h = terrainSurface(d, spacing, water) * relief;
    #ifdef TERRAIN_EARTH
    vRiver = gRiver;
    #endif
    #ifdef TERRAIN_WATER
    vec2 waterU;
    vec2 waterV;
    float hU = terrainSurface(dU, spacing, waterU) * relief;
    float hV = terrainSurface(dV, spacing, waterV) * relief;
    // Near the explorer the water has a surface of its own: the ground drawn here is the bed
    // under it, rising to the surface over the last stretch of that reach, where the water is
    // painted on the ground again.
    float under = uWaterNear > 0.0 ? 1.0 - smoothstep(uWaterNear * 0.7, uWaterNear * 0.9, length(d * uRadius - uCamLocal)) : 0.0;
    h -= water.x * under;
    hU -= waterU.x * under;
    hV -= waterV.x * under;
    vUnder = under;
    #else
    float hU = terrainHeight(dU, spacing) * relief;
    float hV = terrainHeight(dV, spacing) * relief;
    #endif
    #endif
    vWater = water;
    #if defined(TERRAIN_EARTH)
    // (Only where the ground is drawn finely enough to see ripples: far off the river is just a sheen.)
    vFlow = water.x > 0.0 && water.y > 0.0 && spacing < 16.0 ? riverFlow(d) : vec3(0.0);
    #elif defined(TERRAIN_STREAMS)
    vFlow = water.x > 0.0 && spacing < 16.0 ? streamFlow(d) : vec3(0.0);
    #endif
    vec3 p = d * (uRadius + h);
    vec3 pU = dU * (uRadius + hU);
    vec3 pV = dV * (uRadius + hV);
    vNormalLocal = normalize(cross(pU - p, pV - p));
    #ifdef TERRAIN_MARS
    if (skirt && relief > 0.001) vNormalLocal = d;
    #endif

    if (position.z > 0.5) p -= d * (spacing * 2.5 + 3.0);

    vDir = d;
    vHeight = h;
    vLocalPos = p;
    // Per vertex, so rounding in this large product is smoothed, not per-pixel noise.
    vTex = uTexFrame * p;
    vVariation = gnoise(d * 140.0, uSeed + 97u) * 0.6 + gnoise(d * 900.0, uSeed + 131u) * 0.4;
    // The same forest field that places the trees (Props.tsx), so forests
    // beyond the trees' reach still read as darker woodland.
    #ifdef TERRAIN_EARTH
    vForest = smoothstep(0.2, 0.65, terrainCover(d) + fbm(d * 160.0, uSeed + 57u, 2, 2.0, 0.5) * 0.3) * step(water.x, 0.0);
    vDry = smoothstep(0.05, 0.4, fbm(d * 380.0, uSeed + 307u, 2, 2.0, 0.5));
    #else
    vDry = 0.0;
    vForest = uForest > 0.0 ? smoothstep(-0.04, 0.3, fbm(d * 40.0, uSeed + 57u, 3, 2.0, 0.5)) * uForest : 0.0;
    #endif

    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
${NOISE_GLSL}
${TEXTURE_NOISE_GLSL}
${WATER_TURNS_GLSL}
uniform sampler2D uRockNormal;
uniform float uRockBump;
// Another world seen by dark-adapted eyes (surfaceShading.ts eyeGain): brighter.
uniform float uEyes;
#if defined(TERRAIN_EARTH) || defined(TERRAIN_WATER)
uniform float uTime;
#endif
#ifdef TERRAIN_EARTH
${WIND_GLSL}
${WIND_GUST_GLSL}
#endif
#ifdef TERRAIN_WATER
// The liquid: its colour deep and shallow, the tint of the bed seen through
// it, how big its waves are (1, Earth's), and whether surf breaks on its shore.
#if defined(TERRAIN_EARTH) || defined(TERRAIN_STREAMS)
varying vec3 vFlow;
#endif
uniform vec3 uLiquidDeep;
uniform vec3 uLiquidShallow;
uniform vec3 uLiquidBed;
uniform float uWaves;
uniform float uSurf;
#endif

uniform vec3 uPal[5];
uniform vec3 uBands;
uniform vec2 uSteep;
uniform float uStrata;
uniform float uVariationAmount;

uniform sampler2D uGroundMap;
uniform sampler2D uHighMap;
uniform sampler2D uRockMap;
uniform vec3 uGroundMean;
uniform vec3 uHighMean;
uniform vec3 uRockMean;
uniform vec3 uTiles;
uniform float uDetail;
uniform float uDetailChroma;
uniform mat3 uTexFrame;
#ifdef TERRAIN_GLOBE
uniform sampler2D uGlobe;
uniform mat3 uGlobeFrame;
uniform vec2 uGlobeFade;
uniform float uGlobeReady;
uniform float uGlobeWater;
#endif
${REVIVAL_GLSL}

varying vec3 vNormalLocal;
varying vec3 vDir;
varying vec3 vLocalPos;
varying float vHeight;
varying float vVariation;
varying float vForest;
varying vec3 vTex;
varying vec2 vWater;
varying float vDry;
#ifdef TERRAIN_EARTH
varying float vRiver;
#endif
#ifdef TERRAIN_WATER
varying float vUnder;
#endif

#ifdef TERRAIN_MARS
uniform vec3 uMarsDip;
uniform vec3 uBedPal[4];
varying float vBeds;
varying float vBedT;
// Where this pixel lies in the beds of rock (beds counted up from the datum),
// and how much of a bed one pixel spans: set in main() before any branch.
float gBedX;
float gBedW;

// The rock of a cliff in layered ground (Gale crater, the walls of Valles
// Marineris, Victoria crater): each bed its own rock and tone, finely
// laminated, its hard top darker, with streaks where dust has run down it.
float valueNoise(vec2 p);

vec3 bedRock(vec3 detail) {
    float k = floor(gBedX);
    float f = gBedX - k;
    uint hk = hashU32(uint(int(k) + 4096) * 2654435761u + 77u);
    float r1 = hashToUnit(hk);
    float r2 = hashToUnit(hashU32(hk + 5u));
    // Beds come in runs of like rock (a sequence laid down as conditions
    // slowly changed), each a little different from the next.
    float run = clamp(0.5 + 0.6 * gnoise(vec3(k * 0.29, 0.5, 0.5), 79u) + 0.25 * (r1 - 0.5), 0.0, 0.999);
    vec3 c = uBedPal[int(run * 4.0)] * (0.88 + 0.24 * r2);
    float laminae = 6.0 + floor(r2 * 6.0);
    float lam = 0.5 + 0.5 * sin(gBedX * laminae * 6.2831853);
    c *= mix(1.0, 0.86 + 0.24 * lam, 1.0 - smoothstep(0.25, 0.6, gBedW * laminae));
    c *= mix(1.0, 0.8, smoothstep(0.86, 0.97, f) * (1.0 - smoothstep(0.25, 0.5, gBedW)));
    vec3 across = vLocalPos - vDir * dot(vLocalPos, vDir);
    // (Along the cliff whichever way it faces: two projections of the across-face position.)
    float streak = valueNoise(vec2(dot(across, vec3(0.45, 0.0, 0.1)), vHeight * 0.03)) + valueNoise(vec2(dot(across, vec3(0.05, 0.45, -0.2)), vHeight * 0.03 + 7.0)) - 1.0;
    c *= 0.93 + 0.14 * smoothstep(-0.5, 0.5, streak);
    return c * detail;
}
#endif

// A picture projected along the three axes of the texture frame (whose Y is
// the landing zone's up, so the ground there is one clean projection), each
// weighted by how squarely the surface faces it. The gradients come from
// main(), taken before any branch: derivatives inside a branch that differs
// from pixel to pixel are undefined.
vec3 projected(sampler2D map, vec3 q, vec3 dx, vec3 dy, vec3 w) {
    vec3 c = vec3(0.0);
    if (w.x > 0.0) c += textureGrad(map, q.zy, dx.zy, dy.zy).rgb * w.x;
    if (w.y > 0.0) c += textureGrad(map, q.xz, dx.xz, dy.xz).rgb * w.y;
    if (w.z > 0.0) c += textureGrad(map, q.xy, dx.xy, dy.xy).rgb * w.z;
    return c;
}

// A picture that does not show its repeat: patch by patch (a smooth noise a
// tile and a half across) it is read at one of eight offsets, neighbouring
// patches blending into each other (after Inigo Quilez's "texture
// repetition"). Two reads instead of one.
float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;
    f = f * f * (3.0 - 2.0 * f);
    uvec2 c = uvec2(ivec2(i) + 32768);
    float a = hashToUnit(hashU32(c.x * 73856093u ^ c.y * 19349663u));
    float b = hashToUnit(hashU32((c.x + 1u) * 73856093u ^ c.y * 19349663u));
    float d = hashToUnit(hashU32(c.x * 73856093u ^ (c.y + 1u) * 19349663u));
    float e = hashToUnit(hashU32((c.x + 1u) * 73856093u ^ (c.y + 1u) * 19349663u));
    return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

vec3 untiled(sampler2D map, vec2 uv, vec2 dx, vec2 dy) {
    float l = valueNoise(uv * 0.7) * 8.0;
    float i = floor(l);
    float f = l - i;
    vec3 a = textureGrad(map, uv + sin(vec2(3.0, 7.0) * i), dx, dy).rgb;
    vec3 b = textureGrad(map, uv + sin(vec2(3.0, 7.0) * (i + 1.0)), dx, dy).rgb;
    return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * dot(a - b, vec3(1.0))));
}

vec3 projectedUntiled(sampler2D map, vec3 q, vec3 dx, vec3 dy, vec3 w) {
    vec3 c = vec3(0.0);
    if (w.x > 0.0) c += untiled(map, q.zy, dx.zy, dy.zy) * w.x;
    if (w.y > 0.0) c += untiled(map, q.xz, dx.xz, dy.xz) * w.y;
    if (w.z > 0.0) c += untiled(map, q.xy, dx.xy, dy.xy) * w.z;
    return c;
}

// A picture's colour variation, kept only as far as the world itself has
// colour: a grey moon dressed in the Mars soil picture keeps its grain, light
// and dark, but not that picture's rust and blue.
vec3 detailChroma(vec3 d) {
    return mix(vec3(dot(d, vec3(0.2126, 0.7152, 0.0722))), d, uDetailChroma);
}

// The picture's detail about its own mean colour: 1 where it is average.
// dx, dy: the screen derivatives of vTex.
vec3 groundDetail(sampler2D map, vec3 mean, vec3 w, vec3 dx, vec3 dy) {
    // Metres of ground under one pixel, along the screen axis that sees most
    // of it: the small repeat only while its grains are bigger than a pixel
    // (seen at a slant they smear into streaks, and from the air into rows of
    // dots), beyond it the large repeat alone, and far off the picture's
    // average. Both read so that their repeat never shows (untiled).
    // (Each read only where it shows: close by the small repeat alone, far
    // off the large one alone, both only in between.)
    float footprint = max(length(dx), length(dy));
    float near = 1.0 - smoothstep(0.01 * uTiles.x, 0.05 * uTiles.x, footprint);
    vec3 fine = near > 0.0 ? projectedUntiled(map, vTex / uTiles.x, dx / uTiles.x, dy / uTiles.x, w) : mean;
    #if TERRAIN_SCALES > 1
    vec3 broad = near < 1.0 ? projectedUntiled(map, vTex / uTiles.y + vec3(0.37, 0.11, 0.71), dx / uTiles.y, dy / uTiles.y, w) : fine;
    fine = mix(broad, fine, near);
    #else
    fine = mix(mean, fine, near);
    #endif
    fine = mix(fine, mean, smoothstep(0.12 * uTiles.x, 0.5 * uTiles.x, footprint) * 0.7);
    return mix(vec3(1.0), detailChroma(fine / mean), uDetail);
}

// The cliff picture along the texture frame's three axes, each mirrored on
// the side facing away so its relief and its colour agree (Ben Golus's
// triplanar normal mapping): returns the colour; 'bump' gets the relief as a
// normal in the texture frame, whiteout-blended with the surface's own.
vec3 rockSample(sampler2D map, vec3 q, vec3 dx, vec3 dy, vec3 w, vec3 sgn) {
    vec3 c = vec3(0.0);
    if (w.x > 0.0) c += textureGrad(map, vec2(q.z * sgn.x, q.y), vec2(dx.z * sgn.x, dx.y), vec2(dy.z * sgn.x, dy.y)).rgb * w.x;
    if (w.y > 0.0) c += textureGrad(map, vec2(q.x * sgn.y, q.z), vec2(dx.x * sgn.y, dx.z), vec2(dy.x * sgn.y, dy.z)).rgb * w.y;
    if (w.z > 0.0) c += textureGrad(map, vec2(-q.x * sgn.z, q.y), vec2(-dx.x * sgn.z, dx.y), vec2(-dy.x * sgn.z, dy.y)).rgb * w.z;
    return c;
}

vec3 rockRelief(vec3 Nt, vec3 q, vec3 dx, vec3 dy, vec3 w, vec3 sgn) {
    vec3 n = vec3(0.0);
    if (w.x > 0.0) {
        vec3 t = textureGrad(uRockNormal, vec2(q.z * sgn.x, q.y), vec2(dx.z * sgn.x, dx.y), vec2(dy.z * sgn.x, dy.y)).xyz * 2.0 - 1.0;
        t.x *= sgn.x;
        t.xy *= uRockBump;
        n += vec3(abs(t.z) * Nt.x, t.y + Nt.y, t.x + Nt.z) * w.x;
    }
    if (w.y > 0.0) {
        vec3 t = textureGrad(uRockNormal, vec2(q.x * sgn.y, q.z), vec2(dx.x * sgn.y, dx.z), vec2(dy.x * sgn.y, dy.z)).xyz * 2.0 - 1.0;
        t.x *= sgn.y;
        t.xy *= uRockBump;
        n += vec3(t.x + Nt.x, abs(t.z) * Nt.y, t.y + Nt.z) * w.y;
    }
    if (w.z > 0.0) {
        vec3 t = textureGrad(uRockNormal, vec2(-q.x * sgn.z, q.y), vec2(-dx.x * sgn.z, dx.y), vec2(-dy.x * sgn.z, dy.y)).xyz * 2.0 - 1.0;
        t.x *= -sgn.z;
        t.xy *= uRockBump;
        n += vec3(t.x + Nt.x, t.y + Nt.y, abs(t.z) * Nt.z) * w.z;
    }
    return normalize(n);
}

vec3 axisSigns(vec3 Nt) {
    return vec3(Nt.x >= 0.0 ? 1.0 : -1.0, Nt.y >= 0.0 ? 1.0 : -1.0, Nt.z >= 0.0 ? 1.0 : -1.0);
}

// The cliff's colour: its picture at two sizes that repeat out of step, the
// ground's own variation (worked out per vertex, so free here) choosing
// between them so no tile shows along a long wall, and lighter and darker
// reaches along it.
vec3 rockDetail(vec3 w, vec3 dx, vec3 dy) {
    // From far enough that the picture's grain is under a pixel it is only a
    // pattern repeating across the cliff: there its average colour instead.
    float footprint = max(length(dx), length(dy));
    float far = smoothstep(0.08 * uTiles.z, 0.4 * uTiles.z, footprint);
    vec3 c = uRockMean;
    if (far < 1.0) {
        vec3 sgn = axisSigns(uTexFrame * normalize(vNormalLocal));
        vec3 a = rockSample(uRockMap, vTex / uTiles.z, dx / uTiles.z, dy / uTiles.z, w, sgn);
        float s2 = uTiles.z * 2.618;
        vec3 b = rockSample(uRockMap, vTex / s2 + vec3(0.37, 0.11, 0.71), dx / s2, dy / s2, w, sgn);
        float pick = smoothstep(-0.25, 0.25, vVariation);
        c = mix(mix(a, b, 0.25 + 0.5 * pick), uRockMean, far);
    }
    float broad = 0.84 + 0.32 * smoothstep(-0.45, 0.45, vVariation);
    return mix(vec3(1.0), detailChroma(c / uRockMean), uDetail) * broad;
}

vec3 terrainAlbedo(float h, float slope, float variation, vec3 w, vec3 dx, vec3 dy) {
    float v = variation * uVariationAmount;
    vec3 col = mix(uPal[0], uPal[1], smoothstep(uBands.x - uBands.z, uBands.x + uBands.z, h + v * 40.0));
    float high = smoothstep(uBands.y - uBands.z, uBands.y + uBands.z, h + v * 60.0);
    float gentle = smoothstep(uSteep.x, uSteep.y, slope + v * 0.03);
    vec3 ground = uDetail > 0.0 && gentle > 0.0 ? groundDetail(uGroundMap, uGroundMean, w, dx, dy) : vec3(1.0);
    #ifdef TERRAIN_HIGH_MAP
    vec3 highGround = uDetail > 0.0 && high > 0.0 && gentle > 0.0 ? groundDetail(uHighMap, uHighMean, w, dx, dy) : ground;
    #else
    vec3 highGround = ground;
    #endif
    col = mix(col * ground, uPal[2] * highGround, high);
    // Woodland floor: darker and a little bluer under the trees.
    #ifdef TERRAIN_EARTH
    // On Earth, from further than the trees are drawn, the woods read as a
    // canopy: dark green crowns with shadow between them.
    // (Read from the noise volume, the second size turned against the first
    // so their repeats never line up; only where there are woods.)
    float woods = vForest * gentle;
    if (woods > 0.0) {
        float crowns = tnoise4(vTex * 0.21).x * 0.6 + tnoise4(TURN_A * vTex * 0.55).y * 0.4;
        vec3 canopy = vec3(0.022, 0.042, 0.014) * (0.75 + 0.55 * crowns);
        col = mix(col, canopy, woods * 0.85);
    }
    #else
    col *= mix(vec3(1.0), vec3(0.6, 0.72, 0.6), vForest * gentle);
    #endif
    // The rock shows only where the ground is not gentle: nothing of it is
    // worked out for the rest (most of the screen, most of the time).
    if (gentle < 1.0) {
        // Beds of rock where the cliff is sediment: uneven in thickness, bent
        // and pinching out, not ruled lines.
        float strata = uStrata > 0.0 ? smoothstep(-0.35, 0.35, sin(h * 0.11 + v * 2.5 + tnoise4(vTex * 0.009).z * 3.2)) : 0.0;
        vec3 rock = mix(uPal[3], uPal[4], strata * uStrata);
        vec3 detail = uDetail > 0.0 ? rockDetail(w, dx, dy) : vec3(1.0);
        rock *= detail;
        #ifdef TERRAIN_MARS
        if (vBeds > 0.0) rock = mix(rock, bedRock(detail), vBeds);
        // Everything on Mars wears a coat of its dust, thickest where it can settle.
        rock = mix(rock, uPal[1] * 0.85, 0.16 + 0.3 * smoothstep(0.3, 0.75, slope));
        #endif
        col = mix(col, rock, 1.0 - gentle);
    }
    return col * (0.86 + variation * 0.3);
}

#ifdef TERRAIN_WATER
${WATER_WAVES_GLSL}

// The bed under the water's own surface (near the explorer, where WaterSurface.tsx draws the
// water over it): sand, silt and stones in the ground's light and pattern, and on the shallows the
// net of light the ripples focus the sun into.
vec3 bedColor(vec3 ground, vec2 water, vec3 up, vec3 pos, float footprint) {
    float l = dot(ground, vec3(0.299, 0.587, 0.114));
    vec3 bed = l * vec3(1.18, 1.0, 0.7) * 0.8;
    #ifdef TERRAIN_WATER_DETAIL
    float near = 1.0 - smoothstep(0.04, 0.2, footprint);
    if (near > 0.0) {
        float sunUp = smoothstep(-0.02, 0.1, dot(up, uSunDir));
        bed *= 1.0 + caustics(pos, vec3(uTime * 0.11, uTime * 0.07, -uTime * 0.05)) * 1.4 * near * sunUp * exp(-water.x * 0.6);
    }
    #endif
    return bed;
}

// Water lit by the sun and the sky: clear and green in the shallows, dark
// blue further out, mirroring the sky more the flatter it is seen, with the
// sun's glint and surf breaking on the sea's shore. 'bottom' is the lit
// ground under it, which shows through where it is shallow.
#if defined(TERRAIN_EARTH) || defined(TERRAIN_STREAMS)
vec3 vFlowDir(float speed) { return vFlow / max(speed, 1e-3); }
#else
vec3 vFlowDir(float speed) { return vec3(0.0); }
#endif
vec3 waterColor(vec3 bottom, vec2 water, vec3 up, vec3 pos, float footprint) {
    vec3 toEye = uCamLocal - pos;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-3);
    #if defined(TERRAIN_EARTH) || defined(TERRAIN_STREAMS)
    float speed;
    vec3 N = riverNormal(up, pos, footprint, vFlow, speed);
    #else
    float speed = 0.0;
    vec3 N = waterNormal(up, pos, footprint);
    #endif
    float cosV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
    vec3 R = reflect(-V, N);
    float day = surfaceDay(up);
    vec3 sky = mix(uHorizon * vec3(0.8, 0.86, 0.95), uZenith, pow(clamp(dot(R, up), 0.0, 1.0), 0.5)) * (0.08 + 0.84 * day);
    float shallow = exp(-water.x / 3.0);
    vec3 deep = mix(uLiquidDeep, uLiquidShallow, shallow);
    vec3 lit = surfaceLight(deep, up, up);
    #if defined(TERRAIN_EARTH) || defined(TERRAIN_CLEAR_WATER)
    // Clear water: the bed seen through it, wet and darker, the sun's caustics playing on it,
    // its colours taken out with depth along the way down and back (red first, then green), and
    // the water's own blue-green in their place. Bent a little by the ripples.
    {
        float sunUp = smoothstep(-0.02, 0.1, dot(up, uSunDir));
        vec3 bend = (N - up) * water.x * 0.8;
        #ifdef TERRAIN_WATER_DETAIL
        float near = 1.0 - smoothstep(0.04, 0.2, footprint);
        float glow = near > 0.0 ? caustics(pos + bend, vec3(uTime * 0.11, uTime * 0.07, -uTime * 0.05)) * near : 0.0;
        #else
        float glow = 0.0;
        #endif
        // The bed is sand, silt and stones, not the meadow: the ground's light and its pattern, in
        // their colours.
        float ground = dot(bottom, vec3(0.299, 0.587, 0.114));
        vec3 bed = ground * vec3(1.18, 1.0, 0.7) * 0.8 * (1.0 + glow * 1.2 * sunUp * exp(-water.x * 0.8));
        float path = water.x * (1.0 + 1.0 / max(dot(V, up), 0.15));
        #ifdef TERRAIN_EARTH
        // A river carries silt: its water is clear for a metre or so, not for ten.
        vec3 through = exp(-path * vec3(0.55, 0.3, 0.26));
        #else
        // Haven's sea is clear and fresh: red goes first, then green, so the shallows are jade
        // over a pale bed and the deep a dark teal (water's own absorption, per metre).
        vec3 through = exp(-path * vec3(0.45, 0.09, 0.06));
        #endif
        lit = bed * through + lit * (1.0 - through);
    }
    #else
    lit = mix(lit, bottom * uLiquidBed, (1.0 - smoothstep(0.0, 0.9, water.x)) * 0.7);
    #endif
    float sunUp = smoothstep(-0.02, 0.08, dot(up, uSunDir));
    float spec = pow(max(dot(R, uSunDir), 0.0), 420.0) * 6.0 * sunUp;
    vec3 color = mix(lit, sky, fresnel) + uSunColor * spec + uSunColor * waterGlint(N, V, up, pos, footprint, speed > 0.03 ? vFlowDir(speed) : vec3(0.0), speed) * sunUp;
    #if defined(TERRAIN_EARTH) || defined(TERRAIN_STREAMS)
    // Where a river runs fast over the shallows by its banks, white water in streaks along it.
    #ifdef TERRAIN_WATER_DETAIL
    if (speed > 0.25 && water.x < 0.9 && footprint < 2.0) {
        vec3 dir = vFlow / speed;
        vec3 q = pos - dir * dot(pos, dir) * 0.75 - dir * uTime * 1.8 * speed;
        vec4 n = tnoise4(q * 0.8);
        float streak = smoothstep(0.35, 0.75, n.z * 0.6 + n.w * 0.4 + 0.25);
        float foam = streak * (1.0 - smoothstep(0.05, 0.9, water.x)) * smoothstep(0.25, 0.8, speed) * (1.0 - smoothstep(0.5, 2.0, footprint));
        color = mix(color, surfaceLight(vec3(0.62, 0.65, 0.64), up, up), foam * 0.75);
    }
    #endif
    #endif
    // Surf: broken foam where the waves run up the sea's shore, and now and
    // then a wave breaking a little way out, torn into patches.
    float nearShore = smoothstep(-7.0, -0.5, water.y) * (1.0 - smoothstep(0.8, 3.0, footprint)) * uSurf;
    if (nearShore > 0.0) {
        float breakup = smoothstep(0.05, 0.45, tnoise4(pos * 0.35 + vec3(0.0, uTime * 0.15, 0.0)).x * 0.7 + tnoise4(TURN_B * pos * 1.4).y * 0.3);
        float wave = smoothstep(0.82, 0.98, sin(water.y * 0.7 + uTime * 1.1 + tnoise4(TURN_C * pos * 0.05).z * 3.0));
        float lap = smoothstep(-2.0, -0.3, water.y);
        float foam = nearShore * breakup * max(wave, lap * 0.8);
        color = mix(color, surfaceLight(vec3(0.55, 0.57, 0.56), up, up), clamp(foam, 0.0, 1.0) * 0.7);
    }
    return color;
}
#endif

#if defined(TERRAIN_GLOBE) && defined(TERRAIN_AIRLESS)
// Dusty airless ground seen whole, from far off (the Moon from Earth): not a
// matte ball darkening to its edge but evenly bright to the rim at full
// phase (Lommel-Seeliger: the dust lit and seen through the same depth),
// and much brighter near full than at quarter (the surge as the shadows
// between grains vanish). McEwen's lunar-Lambert, with its weight easing
// from the dust's law at full phase towards Lambert's by quarter.
vec3 regolithLight(vec3 albedo, vec3 n) {
    vec3 toEye = normalize(uCamLocal - vLocalPos);
    float mu0 = dot(n, uSunDir);
    if (mu0 <= 0.0) return albedo * vec3(0.012, 0.014, 0.022);
    float mu = max(dot(n, toEye), 0.0);
    float phase = acos(clamp(dot(uSunDir, toEye), -1.0, 1.0));
    float dust = 1.0 - 0.5 * smoothstep(0.0, 1.57, phase);
    float shape = dust * 2.0 * mu0 / (mu0 + mu + 1e-4) + (1.0 - dust) * mu0;
    float surge = exp(-0.7 * phase) * (1.0 + 0.35 * exp(-phase / 0.09));
    return albedo * uSunColor * 1.45 * shape * surge + albedo * vec3(0.012, 0.014, 0.022);
}
#endif

void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vNormalLocal);
    float slope = dot(N, vDir);
    // The water here (depth, distance from the shore) and how much of the pixel it covers; Earth
    // works these out again below from its smooth fields.
    vec2 waterHere = vWater;
    float wetHere = smoothstep(0.0, 0.12, vWater.x);
    // Projection weights: sharpened, and small ones dropped so most of the
    // ground takes one or two samples, not three.
    vec3 w = abs(uTexFrame * N);
    w *= w;
    w *= w;
    w *= w;
    w /= w.x + w.y + w.z;
    w = max(w - 0.03, 0.0);
    w /= w.x + w.y + w.z;
    vec3 texDx = dFdx(vTex);
    vec3 texDy = dFdy(vTex);
    #ifdef TERRAIN_MARS
    gBedX = (vHeight + dot(vDir, uMarsDip) * uRadius) / vBedT;
    gBedW = fwidth(gBedX);
    #endif
    vec3 albedo = terrainAlbedo(vHeight, slope, vVariation, w, texDx, texDy);
    // On the cliffs, the rock's own relief catches the light (within a couple
    // of hundred metres: further off it is finer than a pixel).
    float steepRock = (1.0 - smoothstep(uSteep.x, uSteep.y, slope)) * (1.0 - smoothstep(140.0, 240.0, length(uCamLocal - vLocalPos)));
    vec3 Nlit = N;
    if (uRockBump > 0.0 && steepRock > 0.0) {
        vec3 Nt = uTexFrame * N;
        vec3 bumped = transpose(uTexFrame) * rockRelief(Nt, vTex / uTiles.z, texDx / uTiles.z, texDy / uTiles.z, w, axisSigns(Nt));
        Nlit = normalize(mix(N, bumped, steepRock));
    }
    #ifdef TERRAIN_GLOBE
    // Far off, the world as it really looks from space: its photographed map,
    // with its seas flat and dark and glinting in the sun. (The derivative of
    // whichever longitude has no seam here keeps the mipmaps from drawing a
    // line where the map wraps.)
    vec3 g = uGlobeFrame * vDir;
    vec2 uvA = vec2(atan(g.z, g.x) / 6.2831853 + 0.5, asin(clamp(g.y, -1.0, 1.0)) / 3.14159265 + 0.5);
    vec2 uvB = vec2(fract(uvA.x + 0.5), uvA.y);
    bool useB = fwidth(uvB.x) < fwidth(uvA.x);
    vec2 gdx = useB ? dFdx(uvB) : dFdx(uvA);
    vec2 gdy = useB ? dFdy(uvB) : dFdy(uvA);
    vec3 globe = textureGrad(uGlobe, uvA, gdx, gdy).rgb;
    float far = smoothstep(uGlobeFade.x, uGlobeFade.y, length(vLocalPos - uCamLocal)) * uGlobeReady;
    float water = uGlobeWater * smoothstep(0.004, 0.03, globe.b - max(globe.r, globe.g * 0.85));
    #ifdef TERRAIN_EARTH
    // Ruined Earth from afar (revival.ts): the continents ash-grey where life has not come back.
    globe = mix(ashOf(globe), globe, max(revivalLife(vDir, 0.0), water));
    #endif
    #endif
    #ifdef TERRAIN_EARTH
    // Close up the land takes its colour from the Blue Marble, relative to the
    // palette's green: prairie olive, woods deep green, deserts tan. Rock
    // keeps its own colour.
    float gentleHere = smoothstep(uSteep.x, uSteep.y, slope);
    // Where the water's edge is, worked out per pixel from fields that run smoothly across a
    // triangle: the river field (how far from a river's centre line) and the distance from the sea's
    // shore. The depth of water at the triangle's corners is nothing on every dry corner, so it drew
    // far banks, where the corners are metres apart, as rows of teeth.
    // (The channel's depth less the bank's rise, as earth.ts terrainSurface and riverBank.)
    float riverDepth = (1.0 - smoothstep(0.012, 0.035, abs(vRiver))) * 3.2 - smoothstep(0.026, 0.07, abs(vRiver));
    float edgeDepth = max(riverDepth, -vWater.y * 0.12);
    // Out at sea, the depth at the corners (it knows the sea floor).
    waterHere.x = mix(max(edgeDepth, 0.0), vWater.x, smoothstep(30.0, 80.0, -vWater.y));
    float wetEdge = fwidth(edgeDepth) * 0.6 + 0.01;
    wetHere = mix(smoothstep(-wetEdge, wetEdge, edgeDepth), smoothstep(0.0, 0.12, vWater.x), smoothstep(30.0, 80.0, -vWater.y));
    vec3 hue = globe / max(dot(globe, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    vec3 paletteHue = uPal[0] / max(dot(uPal[0], vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    albedo = mix(albedo, albedo * clamp(hue / paletteHue, 0.25, 4.0), 0.7 * gentleHere * uGlobeReady);
    // Beaches: sand along the sea, darker where the waves wet it.
    float beach = (1.0 - smoothstep(6.0, 16.0, vWater.y)) * (1.0 - smoothstep(1.2, 2.6, vHeight)) * step(0.0, vWater.y);
    vec3 sand = vec3(0.34, 0.27, 0.16) * mix(0.55, 1.0, smoothstep(0.5, 3.5, vWater.y));
    albedo = mix(albedo, sand * (0.9 + vVariation * 0.2), beach * gentleHere);
    // The meadow beyond the blades: the same golden patches the grass dries in,
    // and the same gusts running over it (Grass.tsx), so the long grass seems
    // to go on to the far hills instead of stopping round the explorer.
    float meadowGround = gentleHere * (1.0 - beach) * (1.0 - vForest) * (1.0 - wetHere);
    if (meadowGround > 0.0) {
        albedo = mix(albedo, albedo * vec3(1.45, 1.12, 0.52), vDry * 0.75 * meadowGround);
        // (About the gusts' average, so the meadow is no lighter overall; only near enough for a
        // gust's band to be wider than a pixel or so.)
        float gust = (windGust(vLocalPos) - 0.35) * windStrength() * (1.0 - smoothstep(600.0, 1500.0, length(vLocalPos - uCamLocal)));
        albedo *= 1.0 + gust * 0.3 * meadowGround;
    }
    // Ruined Earth (revival.ts): where life has not come back, ash and dead soil, with lichen
    // yellow-green at the edges of the living patches. Rock and sand keep their own colours.
    float life = revivalLife(vDir, vHeight);
    if (life < 1.0) {
        vec3 dead = ashOf(albedo);
        vec3 lichen = dead * vec3(0.95, 1.02, 0.62);
        vec3 coming = mix(dead, lichen, smoothstep(0.0, 0.35, life) * (1.0 - smoothstep(0.35, 0.9, life)));
        albedo = mix(albedo, mix(coming, albedo, smoothstep(0.3, 1.0, life)), gentleHere * (1.0 - beach));
    }
    #endif
    #if defined(TERRAIN_WATER) && !defined(TERRAIN_EARTH)
    {
        // A lake's or sea's edge, per pixel: water.y (the height above the level, times 12) runs
        // smoothly across a triangle where the depth at its corners, nothing on every dry one,
        // drew far shores as rows of teeth.
        float edgeDepth = -vWater.y / 12.0;
        float wetEdge = fwidth(edgeDepth) * 0.6 + 0.01;
        waterHere.x = max(edgeDepth, 0.0);
        wetHere = smoothstep(-wetEdge, wetEdge, edgeDepth);
        #ifdef TERRAIN_CLEAR_WATER
        // Beaches: pale sand where the land shelves gently into the water, darker and glossier
        // where the waves wet it; steep shores keep their rock and turf.
        float gentle = smoothstep(uSteep.x, uSteep.y, slope);
        // Patchy and ragged: sand and shingle in coves, turf coming down to the water elsewhere.
        vec4 n = tnoise4(vLocalPos * 0.045);
        float patches = smoothstep(-0.15, 0.35, n.x * 0.7 + n.y * 0.3 + vVariation * 0.4);
        float reach = 6.0 + 10.0 * patches;
        float beach = (1.0 - smoothstep(reach * 0.55, reach, vWater.y + n.z * 3.0)) * step(0.0, vWater.y) * gentle;
        // Grey-buff shingle carrying the ground picture's own grain, darker where the waves wet it.
        float grain = dot(albedo, vec3(0.299, 0.587, 0.114)) / max(dot(uPal[0], vec3(0.299, 0.587, 0.114)), 1e-3);
        vec3 sand = vec3(0.25, 0.23, 0.19) * clamp(0.65 + 0.45 * grain, 0.5, 1.4) * mix(0.6, 1.0, smoothstep(0.6, 4.0, vWater.y));
        albedo = mix(albedo, sand * (0.9 + vVariation * 0.2), beach * 0.9);
        #endif
    }
    #endif
    vec3 color = surfaceLight(albedo, Nlit, vDir) + playerLights(albedo, Nlit, vLocalPos);
    #ifdef TERRAIN_WATER
    float wet = wetHere;
    // Metres of water surface under one pixel (taken outside the branch).
    float footprint = length(fwidth(vLocalPos));
    // Near the explorer this is the bed, seen through the water's own surface drawn over it.
    if (vUnder > 0.0 && wet > 0.0) color = mix(color, bedColor(color, waterHere, vDir, vLocalPos, footprint), wet * vUnder);
    wet *= 1.0 - vUnder;
    if (wet > 0.0) color = mix(color, waterColor(color, waterHere, vDir, vLocalPos, footprint) + playerLights(vec3(0.06, 0.08, 0.09), vDir, vLocalPos), wet);
    #endif
    #ifdef TERRAIN_GLOBE
    // The maps are photographs, their own relief already in their shading:
    // as the map takes over, the procedural relief leaves the light.
    N = normalize(mix(N, vDir, far));
    #ifdef TERRAIN_AIRLESS
    color = mix(color, regolithLight(globe, vDir), far);
    #else
    color = mix(color, surfaceLight(globe, N, vDir), far);
    #endif
    vec3 toEye = normalize(uCamLocal - vLocalPos);
    float glint = pow(max(dot(vDir, normalize(toEye + uSunDir)), 0.0), 160.0);
    color += uSunColor * glint * water * far * 2.2 * surfaceDay(vDir);
    #endif
    #ifndef TERRAIN_AIRLESS
    color = applyHaze(color, vLocalPos, vDir);
    #endif
    color *= uEyes;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const color = (hex: string) => new THREE.Color(hex);

/**
 * The rocks of Mars's beds, as Curiosity has seen them in Gale crater: pale
 * pinkish mudstone, brown sandstone, dark grey-brown caprock, buff
 * sulphate-bearing beds.
 */
const MARS_BEDS = ['#a2806a', '#8c6d59', '#75604f', '#b0907a'];

/** The texture frame: the landing zone's up as Y, so the ground there is sampled once. */
export const textureFrame = (body: ExpeditionBody) => {
    const y = landingZoneDirection(body);
    const x = new THREE.Vector3(0, 0, 1).cross(y);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    return new THREE.Matrix3().set(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
};

const globes = new Map<string, Promise<THREE.Texture>>();
/** A world's map (decoded in the background, at most maxWidth across: mapLoader.ts). */
export const loadGlobe = (path: string, anisotropy: number, maxWidth = Infinity) => {
    let pending = globes.get(path);
    if (!pending) {
        pending = trackLoad(loadMapTexture(`${import.meta.env.BASE_URL}${path}`, maxWidth)).then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.anisotropy = anisotropy;
            return texture;
        });
        pending.catch(() => undefined);
        globes.set(path, pending);
    }
    return pending;
};

/** A world's map out of graphics memory (and the cache): fetched again on the next approach. */
const releaseGlobe = (path: string) => {
    const pending = globes.get(path);
    if (!pending) return;
    globes.delete(path);
    pending.then((texture) => {
        texture.dispose();
        // A decoded bitmap's own memory goes too.
        (texture.image as { close?: () => void } | null)?.close?.();
    }).catch(() => undefined);
};

/** How long a world stays out of sight (under a pixel) before its map is let go (s). */
const GLOBE_RELEASE = 20;

/**
 * How much colour a world's palette has (0 grey .. 1 coloured), from the mean
 * saturation of its colours: the share of the pictures' own colour the ground
 * keeps (detailChroma). Mars, Earth, Io keep all of it; Miranda, Rhea, Ariel none.
 */
const paletteChroma = (palette: string[]) => {
    // Measured on the sRGB values as written ('#rrggbb'), not the linear ones.
    const saturation = palette.reduce((sum, hex) => {
        const n = parseInt(hex.slice(1, 7), 16);
        const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        const top = Math.max(...rgb);
        return sum + (top > 0 ? (top - Math.min(...rgb)) / top : 0);
    }, 0) / Math.max(1, palette.length);
    return THREE.MathUtils.smoothstep(saturation, 0.06, 0.24);
};

/**
 * How a world's liquid looks. Earth's water: dark blue-green, clear and green
 * in the shallows, mirroring the sky, with waves and surf. Titan's
 * methane: clear over a dark bed of organic sediment, mirroring the orange
 * sky; so calm (Cassini's radar found it smooth to millimetres) that there is
 * next to no wave and no surf.
 */
export const liquidUniforms = (biome: BiomeDef): Record<string, THREE.IUniform> => {
    const liquid = biome.liquid;
    if (!liquid) {
        return {
            uLiquidDeep: { value: new THREE.Vector3(0.003, 0.016, 0.03) },
            uLiquidShallow: { value: new THREE.Vector3(0.012, 0.075, 0.07) },
            uLiquidBed: { value: new THREE.Vector3(0.55, 0.75, 0.7) },
            uWaves: { value: 1 },
            uSurf: { value: 1 },
        };
    }
    const deep = new THREE.Color(liquid.deep);
    const shallow = new THREE.Color(liquid.shallow);
    return {
        uLiquidDeep: { value: new THREE.Vector3(deep.r, deep.g, deep.b) },
        uLiquidShallow: { value: new THREE.Vector3(shallow.r, shallow.g, shallow.b) },
        uLiquidBed: { value: new THREE.Vector3(0.82, 0.74, 0.6) },
        uWaves: { value: liquid.waves },
        uSurf: { value: liquid.surf ?? 0 },
    };
};

export const createTerrainMaterial = (body: ExpeditionBody, gridN: number, quality: 0 | 1 | 2 = 1, waterDetail = quality > 0) => {
    const biome = body.biome!;
    const shading = BIOME_SHADING[biome.kind];
    const pictures = BIOME_PICTURES[biome.kind];
    return new THREE.ShaderMaterial({
        vertexShader: vertexShader(body),
        fragmentShader,
        defines: {
            TERRAIN_SCALES: quality === 0 ? 1 : 2,
            ...(pictures.high && pictures.high !== pictures.ground ? { TERRAIN_HIGH_MAP: '' } : {}),
            ...(body.globe ? { TERRAIN_GLOBE: '' } : {}),
            ...(usesEarthMap(body) ? { TERRAIN_EARTH: '' } : {}),
            ...(usesEarthMap(body) || biome.liquid ? { TERRAIN_WATER: '' } : {}),
            ...(biome.liquid?.clear ? { TERRAIN_CLEAR_WATER: '' } : {}),
            ...(biome.streams ? { TERRAIN_STREAMS: '' } : {}),
            // Caustics on the bed and white water in a river's shallows (Settings › Graphics › Water).
            ...(waterDetail ? { TERRAIN_WATER_DETAIL: '' } : {}),
            ...(usesMarsMap(body) ? { TERRAIN_MARS: '' } : {}),
            ...(biome.airless ? { TERRAIN_AIRLESS: '' } : {}),
        },
        uniforms: {
            ...faceUniforms(),
            uGridN: { value: gridN },
            uSeed: { value: biome.seed >>> 0 },
            uPal: { value: biome.palette.map(color) },
            uBands: { value: new THREE.Vector3(...shading.bands) },
            uSteep: { value: new THREE.Vector2(...shading.steep) },
            uStrata: { value: shading.strata },
            uVariationAmount: { value: shading.variation },
            ...createSurfaceUniforms(body),
            // Woods darken the ground only where there are woods.
            uForest: { value: biome.kind === 'verdant' ? 1 : 0 },
            uGroundMap: { value: blank },
            uHighMap: { value: blank },
            uRockMap: { value: blank },
            uRockNormal: { value: blank },
            // 0 until the cliff's normal map is in.
            uRockBump: { value: 0 },
            uEyes: { value: 1 },
            uGroundMean: { value: new THREE.Vector3(...PICTURE_MEAN[pictures.ground]) },
            uHighMean: { value: new THREE.Vector3(...PICTURE_MEAN[pictures.high ?? pictures.ground]) },
            uRockMean: { value: new THREE.Vector3(...PICTURE_MEAN[pictures.rock]) },
            uTiles: { value: new THREE.Vector3(...pictures.tiles) },
            // 0 until the pictures are in, then eased up to 1.
            uDetail: { value: 0 },
            uDetailChroma: { value: paletteChroma(biome.palette) },
            uTexFrame: { value: textureFrame(body) },
            uGlobe: { value: blank },
            uGlobeFrame: { value: globeFrame(body) },
            uGlobeFade: { value: new THREE.Vector2(...(body.globe?.fade ?? [0, 1])) },
            uGlobeReady: { value: 0 },
            uGlobeWater: { value: body.globe?.water ? 1 : 0 },
            uTime: { value: 0 },
            uWaterNear: { value: 0 },
            ...liquidUniforms(biome),
            ...WIND_UNIFORMS,
            uBedPal: { value: MARS_BEDS.map(color) },
            ...textureNoiseUniforms(),
            ...terrainUniforms(body),
        },
    });
};

const scenePosition = new THREE.Vector3();
const cameraLocal = new THREE.Vector3();
const projectionView = new THREE.Matrix4();
const frustum = new THREE.Frustum();
const groupMatrix = new THREE.Matrix4();
const groupScale = new THREE.Vector3(1, 1, 1);
const localCentre = new THREE.Vector3();
const eyeDelta = new THREE.Vector3();
const windUp = new THREE.Vector3();

export const PlanetTerrain = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    // Low: coarser far off (each vertex of the ground works out its height
    // three times, whatever the resolution), as fine as before underfoot.
    const gridN = runtime.quality === 0 ? 16 : runtime.quality === 1 ? 24 : 30;
    const maxDepth = runtime.quality === 0 ? 11 : 12;
    const splitFactor = runtime.quality === 0 ? 1.7 : runtime.quality === 1 ? 2.5 : 2.9;
    const groupRef = useRef<THREE.Group>(null);
    const geometry = useMemo(() => buildChunkGeometry(gridN, MAX_CHUNKS), [gridN]);
    const waterDetail = runtime.features.waterDetail;
    const material = useMemo(() => createTerrainMaterial(body, gridN, runtime.quality, waterDetail), [body, gridN, runtime.quality, waterDetail]);
    const range = HEIGHT_RANGE[body.biome!.kind];
    const detail = useRef({ requested: false, ready: false });
    // How many times its true size it is drawn now (skyScale.ts).
    const shown = useRef(1);
    const { gl } = useThree();

    useEffect(() => {
        runtime.heightAt.set(body.id, createHeightFunction(body));
        return () => { runtime.heightAt.delete(body.id); };
    }, [body, runtime]);

    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
    // A new material starts with blank pictures: fetch (from cache) for it too.
    useEffect(() => { detail.current = { requested: false, ready: false }; }, [material]);
    // The world's map, for the view from space: fetched once it is near
    // enough to be more than a few pixels across.
    const globe = useRef({ requested: false, alive: true, hidden: 0 });
    useEffect(() => {
        globe.current = { requested: false, alive: true, hidden: 0 };
        return () => { globe.current.alive = false; };
    }, [body, material]);

    useFrame(({ camera, size, clock }, delta) => {
        const group = groupRef.current;
        if (!group) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        // Where the world is now and how it is turned (motion.ts); the camera in its own frame.
        placeBodyGroup(runtime.motion, body, group, scenePosition, camera.position, cameraLocal);
        // A small world in another's sky drawn larger than life (skyScale.ts): the same as seen
        // from that many times nearer, so the camera comes in by as much in the world's own frame.
        const scale = skyScale(runtime, body);
        group.scale.setScalar(scale);
        shown.current = scale;
        cameraLocal.divideScalar(scale);
        // A world less than a pixel across is not drawn at all (most of the
        // moons, most of the time): its marker shows where it is.
        const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
        const pixels = (body.radius / Math.max(cameraLocal.length(), 1)) * (size.height / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
        if (pixels < 0.75) {
            group.visible = false;
            // Out of sight for a while: its map leaves the graphics memory. Kept,
            // the maps of every world visited piled up (490 MB on Earth, 713 MB
            // after a tour by Jupiter and its moons).
            const kept = globe.current;
            if (body.globe && kept.requested && (kept.hidden += delta) > GLOBE_RELEASE) {
                kept.alive = false;
                releaseGlobe(body.globe.map);
                material.uniforms.uGlobe.value = blank;
                material.uniforms.uGlobeReady.value = 0;
                globe.current = { requested: false, alive: true, hidden: 0 };
            }
            return;
        }
        globe.current.hidden = 0;
        material.uniforms.uEyes.value = body === runtime.currentBody ? 1 : eyeGain(runtime.nightEyes);
        // The map as soon as the world is a few pixels across: the Moon at its
        // real size is only 8 or 9 pixels across from Earth, its seas still plain.
        if (body.globe && !globe.current.requested && pixels > 1.2) {
            globe.current.requested = true;
            const request = globe.current;
            loadGlobe(body.globe.map, Math.min(8, gl.capabilities.getMaxAnisotropy()), MAP_WIDTH[runtime.quality]).then((texture) => {
                if (!request.alive) return;
                material.uniforms.uGlobe.value = texture;
                material.uniforms.uGlobeReady.value = 1;
            }).catch(() => undefined);
        }

        // The ground pictures: fetched on approach, faded in once they are all here.
        const state = detail.current;
        if (!state.requested && cameraLocal.length() - body.radius < PICTURE_RANGE) {
            state.requested = true;
            const pictures = BIOME_PICTURES[body.biome!.kind];
            const anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
            Promise.all([
                loadPicture(pictures.ground, anisotropy),
                loadPicture(pictures.high ?? pictures.ground, anisotropy),
                loadPicture(pictures.rock, anisotropy),
            ]).then(([ground, high, rock]) => {
                material.uniforms.uGroundMap.value = ground;
                material.uniforms.uHighMap.value = high;
                material.uniforms.uRockMap.value = rock;
                state.ready = true;
            }).catch(() => undefined);
            if (HAS_NORMALS.has(pictures.rock)) {
                // Relief needs little filtering across: far off it fades out anyway.
                loadPicture(pictures.rock, Math.min(anisotropy, 2), true).then((normal) => {
                    material.uniforms.uRockNormal.value = normal;
                    material.uniforms.uRockBump.value = 0.9;
                }).catch(() => undefined);
            }
        }
        material.uniforms.uTime.value = clock.elapsedTime;
        // The wind where the explorer is: the grass's gusts (windField.ts), which the meadow carries on.
        if (body === runtime.currentBody) updateWind(runtime.weather, windUp.copy(cameraLocal).normalize(), delta);
        // Near the explorer the water has its own surface over the bed (WaterSurface.tsx).
        material.uniforms.uWaterNear.value = runtime.waterSurface?.body === body ? runtime.waterSurface.near : 0;
        if (state.ready && material.uniforms.uDetail.value < 1) {
            material.uniforms.uDetail.value = Math.min(1, material.uniforms.uDetail.value + Math.min(delta, 0.1) * 1.2);
        }
        // The view's frustum in the world's own frame, where the chunks are.
        groupMatrix.compose(scenePosition, group.quaternion, groupScale.setScalar(scale));
        projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(groupMatrix);
        frustum.setFromProjectionMatrix(projectionView);

        const attribute = geometry.getAttribute('aChunk') as THREE.InstancedBufferAttribute;
        const count = selectChunks({
            radius: body.radius,
            minHeight: range[0],
            maxHeight: range[1],
            cameraLocal,
            planetScene: localCentre,
            frustum,
            splitFactor,
            maxDepth,
        }, attribute.array as Float32Array);
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, count * 4);
        attribute.needsUpdate = true;
        geometry.instanceCount = count;
        group.visible = count > 0;
    }, -1);
    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (group) directionToBody(runtime.motion, body, eyeDelta.copy(eye).sub(group.position), material.uniforms.uCamLocal.value).divideScalar(shown.current);
    }), [runtime, material, body]);

    // Hidden (under a pixel across) it waits to be compiled until the game is up (CompileGate).
    return (
        <group ref={groupRef} userData={{ deferCompile: true }}>
            <mesh geometry={geometry} material={material} frustumCulled={false} />
        </group>
    );
};
