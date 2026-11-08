import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, heightGLSL, terrainUniforms, type ExpeditionBody } from './bodies';
import { usesEarthMap } from './earth';
import { NOISE_GLSL } from './noise';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { REVIVAL_GLSL, revivalLifeAt, revivalUniform } from './revival';
import { WIND_GLSL, WIND_GUST_GLSL, WIND_UNIFORMS } from './windField';
import { loadGlobe, terrainShading } from './PlanetTerrain';
import { globeFrame } from './sites';
import { MAP_WIDTH } from './mapLoader';
import { groundHeight } from './environment';
import type { ExpeditionRuntime } from './runtime';

/**
 * Grass: a meadow of single blades round the explorer on a green world, each a curved strip that
 * tapers to a point, rooted in the ground, bending in the gusts that roll across the field and lit
 * by the same sun, sky and haze as the ground under it.
 *
 * The ground round the camera is cut into square tiles. Every tile draws the same patch of blades
 * (turned or mirrored one of eight ways, so neighbours differ), and the patch's blades are in an
 * order whose every beginning is spread evenly over the tile: a tile far off draws only the first
 * few hundred, a tile underfoot all of them. Tiles out of the camera's view are not drawn at all.
 * The tiles are drawn in rings by distance, one draw each, the near rings with more joints per
 * blade (smooth curves) and the far ones with fewer. Within a ring each blade works out from its
 * own distance whether it grows: it shrinks away smoothly as the camera leaves it, so nothing pops,
 * and the blades left grow wider to keep the meadow from thinning, until far off they sink into
 * the ground's own colour.
 *
 * Positions are measured on a plane touching the planet (a gnomonic projection about an anchor near
 * the camera) and carried back onto the sphere. Every frame the ground's height, slope, how grassy
 * it is and its colour are drawn into two small textures round the camera with the terrain's own
 * functions, so each blade reads its root and its colour from there.
 */

interface GrassLevel {
    /** Blades per square metre close by. */
    near: number;
    /** Every blade grows this close (metres); beyond, they thin out over `falloff` metres or so. */
    plateau: number;
    falloff: number;
    /** No blades beyond this, metres. */
    reach: number;
    /** Size of the ground textures round the camera. */
    map: number;
    /** The rings of tiles: [out to this distance (m), joints per blade]. */
    rings: [number, number][];
}

// Settings › Graphics › Grass: light, the detail level's own, full.
const LEVELS: GrassLevel[] = [
    { near: 200, plateau: 2, falloff: 5, reach: 22, map: 128, rings: [[2, 4], [4, 4], [6, 3], [9, 3], [13, 2], [17, 2], [22, 1]] },
    { near: 400, plateau: 3, falloff: 7, reach: 36, map: 160, rings: [[2, 6], [4, 5], [6, 5], [8, 5], [11, 4], [14, 4], [18, 3], [24, 3], [30, 2], [36, 2]] },
    { near: 720, plateau: 4, falloff: 8, reach: 50, map: 224, rings: [[2, 7], [4, 7], [6, 6], [8, 6], [11, 5], [14, 5], [18, 4], [23, 4], [29, 3], [36, 3], [43, 2], [50, 2]] },
];
/** The tiles' side, metres. */
const TILE = 2;
/** Clumps (tussocks) across a tile's side. */
const CLUMPS = 6;

// How far the camera may drift from the anchor before it is moved: a tenth of the world's radius at
// most, so the plane bends the ground by under 1%.
const REANCHOR = 1500;

/** The share of a tile's blades that grow `distance` metres from the camera (before the reach). */
const shareAt = (level: GrassLevel, distance: number) => 1 / (1 + (Math.max(distance - level.plateau, 0) / level.falloff) ** 2);

const fieldVertex = /* glsl */ `
out vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fieldFragment = (body: ExpeditionBody) => /* glsl */ `
${NOISE_GLSL}
${heightGLSL(body)}
${REVIVAL_GLSL}
${TEXTURE_NOISE_GLSL}
${WIND_GLSL}
${WIND_GUST_GLSL}
uniform vec3 uAnchor;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uRadius;
uniform vec2 uOrigin;
uniform float uSize;
uniform float uTexel;
uniform float uRef;
uniform uint uSeed;
uniform vec2 uSteep;
uniform vec3 uPal0;
uniform vec3 uPal1;
uniform vec3 uPal2;
uniform vec3 uBands;
uniform float uVariationAmount;
#ifdef GRASS_EARTH
uniform sampler2D uGlobe;
uniform mat3 uGlobeFrame;
uniform float uGlobeReady;
#endif
in vec2 vUv;
layout(location = 0) out vec4 outField;
layout(location = 1) out vec4 outGround;

vec3 onSphere(vec2 plane) {
    return normalize(uAnchor + (plane.x / uRadius) * uEast + (plane.y / uRadius) * uNorth);
}

void main() {
    vec2 plane = uOrigin + vUv * uSize;
    vec3 d = onSphere(plane);
    vec2 water;
    float h = terrainSurface(d, 0.5, water);
    vec3 dx = onSphere(plane + vec2(uTexel, 0.0));
    vec3 dz = onSphere(plane + vec2(0.0, uTexel));
    vec3 p = d * (uRadius + h);
    vec3 px = dx * (uRadius + terrainHeight(dx, 0.5));
    vec3 pz = dz * (uRadius + terrainHeight(dz, 0.5));
    vec3 n = normalize(cross(pz - p, px - p));
    float slope = abs(dot(n, d));
    // Grass where the terrain draws grass (gentle ground), thinner under the
    // trees, in patches, and never on the rock, in water or on the beach.
    float gentle = smoothstep(uSteep.x, uSteep.y, slope);
    float forest = ${usesEarthMap(body)
        ? 'smoothstep(0.2, 0.65, terrainCover(d) + fbm(d * 160.0, uSeed + 57u, 2, 2.0, 0.5) * 0.3)'
        : 'smoothstep(-0.04, 0.3, fbm(d * 40.0, uSeed + 57u, 3, 2.0, 0.5))'};
    float patches = smoothstep(-0.35, 0.25, fbm(d * 900.0, uSeed + 211u, 3, 2.0, 0.5));
    float dry = (1.0 - smoothstep(0.0, 0.05, water.x)) * smoothstep(8.0, 18.0, water.y);
    float grows = gentle * (1.0 - forest * 0.35) * dry;
    // Where it has dried golden: the same field the terrain's meadow uses (PlanetTerrain).
    float golden = smoothstep(0.05, 0.4, fbm(d * 380.0, uSeed + 307u, 2, 2.0, 0.5));
    // The gusts here (windField.ts), worked out once per texel rather than for every vertex.
    outField = vec4(h - uRef, grows, patches, windGust(p));

    // The ground's own colour here, as the terrain paints it (PlanetTerrain's terrainAlbedo, its
    // picture taken at its average): the blades take theirs from it, so near and far they belong to
    // the ground they grow from.
    float v = gnoise(d * 140.0, uSeed + 97u) * 0.6 + gnoise(d * 900.0, uSeed + 131u) * 0.4;
    float vv = v * uVariationAmount;
    vec3 col = mix(uPal0, uPal1, smoothstep(uBands.x - uBands.z, uBands.x + uBands.z, h + vv * 40.0));
    col = mix(col, uPal2, smoothstep(uBands.y - uBands.z, uBands.y + uBands.z, h + vv * 60.0));
    float gentleV = smoothstep(uSteep.x, uSteep.y, slope + vv * 0.03);
    #ifdef GRASS_EARTH
    // Earth's land takes its hue from the Blue Marble, relative to the palette's green.
    vec3 g = uGlobeFrame * d;
    vec3 globe = textureLod(uGlobe, vec2(atan(g.z, g.x) / 6.2831853 + 0.5, asin(clamp(g.y, -1.0, 1.0)) / 3.14159265 + 0.5), 0.0).rgb;
    vec3 hue = globe / max(dot(globe, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    vec3 paletteHue = uPal0 / max(dot(uPal0, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    col = mix(col, col * clamp(hue / paletteHue, 0.25, 4.0), 0.7 * gentleV * uGlobeReady);
    col = mix(col, col * vec3(1.45, 1.12, 0.52), golden * 0.75);
    #else
    col *= mix(vec3(1.0), vec3(0.6, 0.72, 0.6), forest * gentleV);
    #endif
    col *= 0.86 + v * 0.3;
    // Ruined Earth (revival.ts): how far life has come back here.
    outGround = vec4(col, revivalLife(d, h));
}
`;

const bladeVertex = (level: GrassLevel) => /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${WIND_GLSL}
attribute vec4 aBlade;
attribute vec4 aClump;
attribute vec3 aTile;
uniform vec3 uAnchor;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uRadius;
uniform vec3 uCamLocal;
uniform vec3 uOriginLocal;
uniform sampler2D uField;
uniform sampler2D uGround;
uniform vec2 uFieldOrigin;
uniform float uFieldSize;
uniform float uRef;
uniform float uTime;
uniform float uBladeScale;
// Rock shelters (planet frame, and the radius of their floor): no grass inside.
uniform vec4 uNoGrass0;
uniform vec4 uNoGrass1;
varying vec3 vLocalPos;
varying vec3 vUp;
varying vec3 vFace;
varying vec3 vEdge;
varying vec3 vAlongDir;
varying vec4 vColor;
varying vec3 vGround;
varying vec2 vShade;

const float TILE_SIDE = ${TILE.toFixed(1)};
const float REACH = ${level.reach.toFixed(1)};
const float FALLOFF = ${level.falloff.toFixed(2)};
const float PLATEAU = ${level.plateau.toFixed(2)};

void main() {
    // This tile's turn of the shared patch: one of eight, so neighbours never repeat each other.
    vec2 local = aBlade.xy - 0.5 * TILE_SIDE;
    vec2 lean = aClump.xy;
    float swap = step(0.5, aTile.z);
    vec2 flip = vec2(step(0.5, fract(aTile.z * 2.0)), step(0.5, fract(aTile.z * 4.0))) * 2.0 - 1.0;
    local = mix(local, local.yx, swap) * flip;
    lean = mix(lean, lean.yx, swap) * flip;
    vec2 plane = aTile.xy + 0.5 * TILE_SIDE + local;
    vec2 fieldUv = (plane - uFieldOrigin) / uFieldSize;
    vec4 field = textureLod(uField, fieldUv, 0.0);
    vec4 ground = textureLod(uGround, fieldUv, 0.0);
    vec3 up = normalize(uAnchor + (plane.x / uRadius) * uEast + (plane.y / uRadius) * uNorth);
    vec3 root = up * (uRadius + field.r + uRef - 0.04);
    float dist = length(root - uCamLocal);

    // How many of the tile's blades grow here: all close by, fewer further off, none past the
    // reach; fewer where the ground is less grassy, none on Earth's ash. A blade near the cut
    // shrinks away instead of vanishing.
    float beyond = max(dist - PLATEAU, 0.0) / FALLOFF;
    float share = 1.0 / (1.0 + beyond * beyond);
    float lush = field.b;
    float cut = share * (1.0 - smoothstep(REACH * 0.7, REACH, dist)) * field.g * (0.8 + 0.2 * lush) * min(1.0, ground.a * 1.04);
    if (uNoGrass0.w > 0.0 && distance(root, uNoGrass0.xyz) < uNoGrass0.w) cut = 0.0;
    if (uNoGrass1.w > 0.0 && distance(root, uNoGrass1.xyz) < uNoGrass1.w) cut = 0.0;
    float grow = clamp((cut - aBlade.z) / max(cut * 0.25, 1e-3), 0.0, 1.0);
    // A blade that does not grow here goes no further: every vertex of it lands outside the view,
    // so its triangles are dropped. (The blades are in rank order, so those of a tile that do not
    // grow are all together at its end, and the vertices worked on side by side mostly agree.)
    if (grow <= 0.0) {
        gl_Position = vec4(0.0, 0.0, -2.0, 1.0);
        return;
    }
    grow = grow * grow * (3.0 - 2.0 * grow);

    // This blade's own traits.
    vec4 own = fract(aBlade.w * vec4(1.0, 7.31, 13.17, 29.71) + vec4(0.0, 0.37, 0.61, 0.83));
    float fromMiddle = length(lean);
    float height = mix(0.32, 0.78, own.x * own.x) * aClump.z * (0.62 + 0.5 * lush) * (0.6 + 0.4 * field.g) * uBladeScale;
    // Tussocks: tallest in the middle.
    height *= (1.0 - 0.3 * smoothstep(0.04, 0.22, fromMiddle)) * grow;
    // Wider further off, where fewer are drawn, so the meadow does not thin out (to 2.6 times).
    float widen = clamp(pow(max(share, 1e-3), -0.4), 1.0, 2.6);
    float width = mix(0.024, 0.048, own.y) * mix(1.0, 0.8, own.x) * widen * grow;

    vec3 east = normalize(uEast - up * dot(uEast, up));
    vec3 north = cross(up, east);
    // Each blade leans out from its tussock's middle, a little its own way.
    float spin = own.z * 6.2831853;
    vec2 ownWay = vec2(cos(spin), sin(spin));
    vec2 way = lean * 5.0 + ownWay * 0.55;
    way /= max(length(way), 1e-4);
    vec3 leanDir = east * way.x + north * way.y;
    float tilt = 0.08 + 1.1 * fromMiddle + own.w * 0.18;
    float curl = 0.25 + own.y * 0.6 + step(0.955, own.w) * (1.5 + own.x * 0.8);

    // The wind: one field of gusts for the whole meadow (windField.ts) and each blade's flutter.
    vec3 windDir = normalize(uWindDir - up * dot(uWindDir, up) + east * 1e-4);
    float gust = field.a;
    float push = windStrength() * (0.15 + 1.3 * gust);
    push += sin(uTime * (4.5 + own.y * 3.5) + own.z * 40.0 + gust * 2.0) * 0.07 * (0.3 + gust) * windStrength();
    // One plane for the whole curve: the blade's own lean and the wind's, added.
    vec3 bendRoot = leanDir * tilt + windDir * push * 0.45;
    vec3 bendAlong = leanDir * curl + windDir * push * 1.25;
    vec3 sum = bendRoot + bendAlong;
    vec3 dir = sum / max(length(sum), 1e-4);
    float a0 = dot(bendRoot, dir);
    float bend = clamp(dot(bendAlong, dir), 0.02, max(2.75 - a0, 0.03));

    // The midrib: an arc whose angle from the vertical grows steadily along it, so the blade bends
    // without stretching (its length stays its height).
    float u = position.y;
    float angle = a0 + bend * u;
    vec3 rib = root + height * (up * (sin(angle) - sin(a0)) + dir * (cos(a0) - cos(angle))) / bend;
    vec3 along = up * cos(angle) + dir * sin(angle);
    vec3 across = normalize(cross(up, dir));
    // The side that faces the sky as the blade bends over.
    vec3 face = cross(along, across);
    // Seen edge-on a blade turns a little towards the eye, so it never thins to a line.
    vec3 toEye = uCamLocal - root;
    toEye -= up * dot(toEye, up);
    toEye /= max(length(toEye), 1e-3);
    float edgeOn = 1.0 - abs(dot(dir, toEye));
    vec3 side = cross(toEye, up);
    side *= dot(side, across) >= 0.0 ? 1.0 : -1.0;
    vec3 spread = normalize(mix(across, side, smoothstep(0.5, 1.0, edgeOn) * 0.55));
    // Narrow to a point at the tip.
    float halfWidth = 0.5 * width * (1.0 - pow(u, 1.6));
    vec3 p = rib + spread * position.x * halfWidth;

    vLocalPos = p;
    vUp = up;
    vFace = face;
    // A blade's cross-section is rounded: the light falls off towards its edges.
    vEdge = across * position.x * 0.55;
    vAlongDir = along;

    // Its colour: the ground's, varied blade to blade and tussock to tussock; now and then one dried
    // to straw, and more of them where life is only coming back (Earth's recovery).
    vec3 base = ground.rgb;
    vec3 tint = vec3(0.8 + own.x * 0.4);
    tint *= mix(vec3(1.0), vec3(1.1, 1.05, 0.8), own.y * own.y);
    tint *= mix(vec3(0.95, 1.0, 1.06), vec3(1.06, 1.02, 0.88), aClump.w);
    float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
    vec3 straw = vec3(lum) * vec3(1.3, 1.25, 0.72);
    float dead = max(step(0.97, fract(own.w * 7.7 + own.x * 3.1)), 1.0 - smoothstep(0.4, 0.95, ground.a));
    vColor = vec4(mix(base * tint, straw * (0.85 + own.x * 0.3), dead * 0.75), u);
    vGround = base;
    // Far off they shade and colour like the ground they sink into.
    vShade = vec2(smoothstep(REACH * 0.3, REACH * 0.92, dist), gust * windStrength());
    gl_Position = projectionMatrix * viewMatrix * vec4(p - uOriginLocal, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const bladeFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
varying vec3 vLocalPos;
varying vec3 vUp;
varying vec3 vFace;
varying vec3 vEdge;
varying vec3 vAlongDir;
varying vec4 vColor;
varying vec3 vGround;
varying vec2 vShade;
void main() {
    #include <logdepthbuf_fragment>
    float u = vColor.a;
    float far = vShade.x;
    // The side towards the eye, rounded towards its edges, and a little towards the sky; far off
    // all towards the sky, as the ground under it is lit.
    vec3 N = normalize(vFace * (gl_FrontFacing ? 1.0 : -1.0) + vEdge);
    N = normalize(N + vUp * mix(0.45, 4.0, far));
    // Dark down among the blades, where little light reaches; lighter at the tips.
    float ao = mix(0.3, 1.0, smoothstep(0.0, 0.7, u));
    vec3 albedo = vColor.rgb * ao * mix(vec3(0.9), vec3(1.42, 1.4, 1.12), u * sqrt(u));
    // Laid over by a gust, a blade shows its paler side: the gusts show as bands across the field.
    albedo *= 1.0 + vShade.y * 1.3 * u;
    // Far off, the ground's own colour without the dark roots, so where the blades end and the bare
    // ground begins there is no darker band.
    albedo = mix(albedo, vGround, smoothstep(0.0, 0.85, far));
    vec3 color = surfaceLightWrap(albedo, N, vUp, 0.3 * (1.0 - far)) + playerLights(albedo, N, vLocalPos);
    vec3 V = normalize(vLocalPos - uCamLocal);
    float day = surfaceDay(vUp) * (1.0 - 0.85 * max(uStorm, uOvercast)) * (1.0 - far);
    // Sunlight through the blade towards the eye: thin tips glow against the sun.
    float through = pow(max(dot(V, uSunDir), 0.0), 4.0) * 0.9 + max(-dot(N, uSunDir), 0.0) * 0.25;
    color += albedo * vec3(1.15, 1.22, 0.78) * uSunColor * through * day * u * 1.9;
    // The waxy sheen along a blade where the light skims down it.
    vec3 H = normalize(uSunDir - V);
    float th = dot(normalize(vAlongDir), H);
    float sheen = pow(max(1.0 - th * th, 0.0), 24.0) * max(dot(N, uSunDir) + 0.2, 0.0);
    color += uSunColor * sheen * 0.08 * u * day;
    color = applyHaze(color, vLocalPos, vUp);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** A small fixed random sequence (mulberry32), so every patch is the same each time. */
const randomFrom = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/**
 * One tile's blades: where each stands, its rank (blades are drawn in this order, and every
 * beginning of it is spread evenly over the tile: Roberts's R2 sequence), its random, and its
 * tussock (from the tussock's middle to the blade, the tussock's height and random). Tussocks wrap
 * round the tile's edges, so a tile's own pattern has no seam.
 */
const makePatch = (count: number, seed: number) => {
    const random = randomFrom(seed);
    const cell = TILE / CLUMPS;
    const clumps: { x: number; z: number; height: number; tint: number }[] = [];
    for (let j = 0; j < CLUMPS; j++) {
        for (let i = 0; i < CLUMPS; i++) {
            clumps.push({ x: (i + 0.15 + random() * 0.7) * cell, z: (j + 0.15 + random() * 0.7) * cell, height: 0.72 + random() * 0.56, tint: random() });
        }
    }
    const g = 1.32471795724474602596;
    const spacing = TILE / Math.sqrt(count);
    const blades = new Float32Array(count * 8);
    for (let n = 0; n < count; n++) {
        const x = ((((0.5 + (n + 1) / g) % 1) * TILE + (random() - 0.5) * spacing * 0.6) + TILE) % TILE;
        const z = ((((0.5 + (n + 1) / (g * g)) % 1) * TILE + (random() - 0.5) * spacing * 0.6) + TILE) % TILE;
        // The nearest tussock, round the tile's edges.
        const ci = Math.floor(x / cell);
        const cj = Math.floor(z / cell);
        let best = clumps[0];
        let bx = 0;
        let bz = 0;
        let bd = Infinity;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                const i = (ci + di + CLUMPS) % CLUMPS;
                const j = (cj + dj + CLUMPS) % CLUMPS;
                const c = clumps[j * CLUMPS + i];
                let ox = x - c.x;
                let oz = z - c.z;
                ox -= Math.round(ox / TILE) * TILE;
                oz -= Math.round(oz / TILE) * TILE;
                const d = ox * ox + oz * oz;
                if (d < bd) {
                    bd = d;
                    best = c;
                    bx = ox;
                    bz = oz;
                }
            }
        }
        blades.set([x, z, n / count, random(), bx, bz, best.height, best.tint], n * 8);
    }
    return blades;
};

/** The first `count` blades of a patch, each a strip of `joints` segments tapering to a point. */
const ringGeometry = (patch: Float32Array, count: number, joints: number, maxTiles: number) => {
    const perBlade = joints * 2 + 1;
    const position = new Float32Array(count * perBlade * 3);
    const blade = new Float32Array(count * perBlade * 4);
    const clump = new Float32Array(count * perBlade * 4);
    const index: number[] = [];
    for (let n = 0; n < count; n++) {
        const base = n * perBlade;
        for (let v = 0; v < perBlade; v++) {
            const row = Math.floor(v / 2);
            const o = (base + v) * 3;
            const tip = v === perBlade - 1;
            position[o] = tip ? 0 : v % 2 === 0 ? -1 : 1;
            position[o + 1] = tip ? 1 : row / joints;
            for (let k = 0; k < 4; k++) {
                blade[(base + v) * 4 + k] = patch[n * 8 + k];
                clump[(base + v) * 4 + k] = patch[n * 8 + 4 + k];
            }
        }
        // Wound so that a triangle's front is the blade's upper side (the shader's 'face').
        for (let r = 0; r < joints - 1; r++) {
            const a = base + r * 2;
            index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        }
        const a = base + (joints - 1) * 2;
        index.push(a, base + perBlade - 1, a + 1);
    }
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aBlade', new THREE.BufferAttribute(blade, 4));
    geometry.setAttribute('aClump', new THREE.BufferAttribute(clump, 4));
    geometry.setIndex(index);
    const tiles = new THREE.InstancedBufferAttribute(new Float32Array(maxTiles * 3), 3);
    tiles.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTile', tiles);
    geometry.instanceCount = 0;
    return geometry;
};

const cameraLocal = new THREE.Vector3();
const direction = new THREE.Vector3();
const viewProjection = new THREE.Matrix4();
const frustum = new THREE.Frustum();
const originLocal = new THREE.Vector3();
const corner = new THREE.Vector3();

const GrassField = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    // How thick the grass grows (Settings › Graphics › Grass; the detail level's by default).
    const level = LEVELS[Math.max(0, runtime.features.grass)];
    const fieldSize = 2 * (level.reach + TILE * 1.5) + 2;
    const frame = useRef({ anchor: new THREE.Vector3(), east: new THREE.Vector3(), north: new THREE.Vector3(), ready: false });
    // The ground's height at the middle of each tile met so far (by tile), for the culling, and on
    // ruined Earth the tiles where nothing grows yet (at this stage of its recovery).
    const heights = useRef(new Map<number, number>());
    const dead = useRef({ tiles: new Set<number>(), revival: -1 });
    const revival = revivalUniform(body.id);
    const earth = usesEarthMap(body);

    const field = useMemo(() => {
        const target = new THREE.WebGLRenderTarget(level.map, level.map, {
            count: 2,
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            generateMipmaps: false,
        });
        target.textures.forEach((texture) => { texture.colorSpace = THREE.NoColorSpace; });
        const shading = terrainShading(body);
        const palette = body.biome!.palette.map((hex) => new THREE.Color(hex));
        const material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: fieldVertex,
            fragmentShader: fieldFragment(body),
            defines: earth ? { GRASS_EARTH: '' } : {},
            depthTest: false,
            depthWrite: false,
            uniforms: {
                uAnchor: { value: frame.current.anchor },
                uEast: { value: frame.current.east },
                uNorth: { value: frame.current.north },
                uRadius: { value: body.radius },
                uOrigin: { value: new THREE.Vector2() },
                uSize: { value: fieldSize },
                uTexel: { value: fieldSize / level.map },
                uRef: { value: 0 },
                uSeed: { value: body.biome!.seed >>> 0 },
                uSteep: { value: new THREE.Vector2(0.72, 0.84) },
                uPal0: { value: palette[0] },
                uPal1: { value: palette[1] },
                uPal2: { value: palette[2] },
                uBands: { value: new THREE.Vector3(...shading.bands) },
                uVariationAmount: { value: shading.variation },
                uGlobe: { value: null as THREE.Texture | null },
                uGlobeFrame: { value: globeFrame(body) },
                uGlobeReady: { value: 0 },
                uRevival: (createSurfaceUniforms(body) as { uRevival: { value: number } }).uRevival,
                ...textureNoiseUniforms(),
                ...WIND_UNIFORMS,
                ...terrainUniforms(body),
            },
        });
        const scene = new THREE.Scene();
        const triangle = new THREE.BufferGeometry();
        triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        const mesh = new THREE.Mesh(triangle, material);
        mesh.frustumCulled = false;
        scene.add(mesh);
        return { target, material, scene, camera: new THREE.Camera(), triangle };
    }, [body, level, fieldSize, earth]);

    // Earth's blades take their hue from the same map as its ground.
    useEffect(() => {
        if (!earth || !body.globe) return;
        let alive = true;
        loadGlobe(body.globe.map, Math.min(8, gl.capabilities.getMaxAnisotropy()), MAP_WIDTH[runtime.quality]).then((texture) => {
            if (!alive) return;
            field.material.uniforms.uGlobe.value = texture;
            field.material.uniforms.uGlobeReady.value = 1;
        }).catch(() => undefined);
        return () => { alive = false; };
    }, [earth, body, field, gl, runtime.quality]);

    const rings = useMemo(() => {
        const perTile = Math.ceil(level.near * TILE * TILE);
        const patch = makePatch(perTile, body.biome!.seed * 17 + 5);
        const maxTiles = Math.ceil(((2 * level.reach) / TILE + 3) ** 2);
        const material = new THREE.ShaderMaterial({
            vertexShader: bladeVertex(level),
            fragmentShader: bladeFragment,
            side: THREE.DoubleSide,
            uniforms: {
                ...createSurfaceUniforms(body),
                ...WIND_UNIFORMS,
                uAnchor: { value: frame.current.anchor },
                uEast: { value: frame.current.east },
                uNorth: { value: frame.current.north },
                uOriginLocal: { value: new THREE.Vector3() },
                uField: { value: field.target.textures[0] },
                uGround: { value: field.target.textures[1] },
                uFieldOrigin: { value: new THREE.Vector2() },
                uFieldSize: { value: fieldSize },
                uRef: { value: 0 },
                uTime: { value: 0 },
                uBladeScale: { value: 1 },
                uNoGrass0: { value: new THREE.Vector4() },
                uNoGrass1: { value: new THREE.Vector4() },
            },
        });
        let inner = 0;
        const list = level.rings.map(([outer, joints], k) => {
            // A ring's tiles are all at least `inner` metres away: only the blades that can grow there.
            const count = Math.min(perTile, Math.ceil(shareAt(level, inner) * perTile));
            const geometry = ringGeometry(patch, count, joints, maxTiles);
            geometry.setDrawRange(0, (joints * 2 - 1) * 3 * count);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false;
            // Near rings first, so the far blades behind them are hidden before they are shaded.
            mesh.renderOrder = 1 + k;
            // Left out of the water's mirror (WaterSurface.tsx): blades are most of a meadow's cost
            // and stand too low to show in it from where anyone looks.
            mesh.userData.noMirror = true;
            const ring = { outer, inner, geometry, mesh, tiles: geometry.getAttribute('aTile') as THREE.InstancedBufferAttribute, count: 0 };
            inner = outer;
            return ring;
        });
        const group = new THREE.Group();
        group.userData.noMirror = true;
        list.forEach((ring) => group.add(ring.mesh));
        return { material, list, group };
    }, [body, level, field, fieldSize]);

    useEffect(() => () => {
        field.target.dispose(); field.material.dispose(); field.triangle.dispose();
        rings.material.dispose();
        rings.list.forEach((ring) => ring.geometry.dispose());
    }, [field, rings]);

    useFrame(({ camera, clock }) => {
        cameraLocal.copy(camera.position).add(runtime.origin).sub(body.position);
        const distance = cameraLocal.length();
        const near = runtime.currentBody === body && runtime.altitude < 120;
        rings.group.visible = near;
        if (!near) return;
        const f = frame.current;
        direction.copy(cameraLocal).divideScalar(distance);
        // A new anchor under the camera when it has wandered far from the old one.
        if (!f.ready || direction.angleTo(f.anchor) * body.radius > Math.min(REANCHOR, body.radius * 0.1)) {
            f.anchor.copy(direction);
            f.east.set(0, 1, 0).cross(f.anchor);
            if (f.east.lengthSq() < 1e-6) f.east.set(1, 0, 0);
            f.east.normalize();
            f.north.crossVectors(f.anchor, f.east).normalize();
            f.ready = true;
            heights.current.clear();
            dead.current.tiles.clear();
        }
        const R = body.radius;
        const t = 1 / direction.dot(f.anchor);
        const camX = direction.dot(f.east) * t * R;
        const camZ = direction.dot(f.north) * t * R;
        // The ground textures, on a grid that moves in whole texels.
        const texel = fieldSize / level.map;
        const originX = Math.floor((camX - fieldSize / 2) / texel) * texel;
        const originZ = Math.floor((camZ - fieldSize / 2) / texel) * texel;
        // Heights are stored relative to the ground under the camera, where a
        // half float is precise to millimetres.
        const ref = groundHeight(body, direction);
        const u = field.material.uniforms;
        u.uOrigin.value.set(originX, originZ);
        u.uRef.value = ref;
        const previous = gl.getRenderTarget();
        gl.setRenderTarget(field.target);
        gl.render(field.scene, field.camera);
        gl.setRenderTarget(previous);

        const b = rings.material.uniforms;
        b.uFieldOrigin.value.set(originX, originZ);
        b.uRef.value = ref;
        b.uTime.value = clock.elapsedTime;
        originLocal.copy(runtime.origin).sub(body.position);
        b.uOriginLocal.value.copy(originLocal);
        b.uCamLocal.value.copy(cameraLocal);
        b.uNoGrass0.value.set(0, 0, 0, 0);
        b.uNoGrass1.value.set(0, 0, 0, 0);
        runtime.shelters.slice(0, 2).forEach((shelter, i) => {
            (i === 0 ? b.uNoGrass0 : b.uNoGrass1).value.set(shelter.centre.x - body.position.x, shelter.centre.y - body.position.y, shelter.centre.z - body.position.z, 7.2);
        });

        // The tiles in reach and in sight, each to the ring its nearest point is in. The camera's
        // view is last frame's (this runs before the camera moves), so the test is a little loose.
        viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(viewProjection);
        const planes = frustum.planes;
        const above = distance - R - ref;
        const reach = level.reach;
        const list = rings.list;
        for (const ring of list) ring.count = 0;
        const ax = f.anchor.x, ay = f.anchor.y, az = f.anchor.z;
        const ex = f.east.x / R, ey = f.east.y / R, ez = f.east.z / R;
        const nx = f.north.x / R, ny = f.north.y / R, nz = f.north.z / R;
        const ix0 = Math.floor((camX - reach) / TILE), ix1 = Math.floor((camX + reach) / TILE);
        const iz0 = Math.floor((camZ - reach) / TILE), iz1 = Math.floor((camZ + reach) / TILE);
        const known = heights.current;
        let budget = 64;
        // Ruined Earth: tiles on ground still dead are not drawn at all (worked out with each tile's
        // height, again whenever the recovery moves on).
        const barren = dead.current;
        if (barren.revival !== revival.value) {
            barren.revival = revival.value;
            barren.tiles.clear();
            known.clear();
        }
        const ruined = revival.value < 0.999;
        const xs = [0, 0, 0, 0, 0, 0, 0, 0];
        const ys = [0, 0, 0, 0, 0, 0, 0, 0];
        const zs = [0, 0, 0, 0, 0, 0, 0, 0];
        for (let iz = iz0; iz <= iz1; iz++) {
            const z0 = iz * TILE;
            const dz = Math.max(z0 - camZ, 0, camZ - z0 - TILE);
            for (let ix = ix0; ix <= ix1; ix++) {
                const x0 = ix * TILE;
                const dx = Math.max(x0 - camX, 0, camX - x0 - TILE);
                const across = Math.hypot(dx, dz);
                if (across > reach) continue;
                // The ground's height in the tile's middle: known, or worked out now (a few a frame),
                // or else guessed from under the camera, give or take more further off.
                const key = (ix + 32768) * 65536 + (iz + 32768);
                let h = known.get(key);
                if (h === undefined && budget > 0) {
                    budget--;
                    const mx = x0 + TILE / 2;
                    const mz = z0 + TILE / 2;
                    corner.set(ax + mx * ex + mz * nx, ay + mx * ey + mz * ny, az + mx * ez + mz * nz).normalize();
                    h = groundHeight(body, corner);
                    known.set(key, h);
                    if (ruined && revivalLifeAt(corner.x, corner.y, corner.z, h, revival.value, 0.06) <= 0) barren.tiles.add(key);
                }
                if (ruined && barren.tiles.has(key)) continue;
                const middle = h ?? ref;
                // A tile on grassy ground (no steeper than the grass grows) rises or falls a metre or so.
                const below = h === undefined ? 2 + 0.15 * across : 1.2;
                const over = h === undefined ? 3 + 0.15 * across : 2;
                const nearest = Math.hypot(across, Math.max(0, h === undefined ? Math.abs(above) - below : Math.abs(distance - R - middle) - 1.2));
                if (nearest > reach) continue;
                // The tile as a box from below the ground to above the tallest blade.
                let c = 0;
                for (let k = 0; k < 4; k++) {
                    const px = x0 + (k & 1 ? TILE : 0);
                    const pz = z0 + (k & 2 ? TILE : 0);
                    corner.set(ax + px * ex + pz * nx, ay + px * ey + pz * ny, az + px * ez + pz * nz).normalize();
                    for (let side = 0; side < 2; side++) {
                        const r = R + middle + (side ? over : -below);
                        xs[c] = corner.x * r - originLocal.x;
                        ys[c] = corner.y * r - originLocal.y;
                        zs[c] = corner.z * r - originLocal.z;
                        c++;
                    }
                }
                const pad = 0.6 + 0.1 * across;
                let seen = true;
                for (const plane of planes) {
                    const n = plane.normal;
                    let inside = false;
                    for (let k = 0; k < 8; k++) {
                        if (n.x * xs[k] + n.y * ys[k] + n.z * zs[k] + plane.constant > -pad) { inside = true; break; }
                    }
                    if (!inside) { seen = false; break; }
                }
                if (!seen) continue;
                let r = 0;
                while (r < list.length - 1 && nearest >= list[r].outer) r++;
                const ring = list[r];
                const hash = Math.abs(Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453) % 1;
                const o = ring.count * 3;
                const array = ring.tiles.array as Float32Array;
                if (o + 3 > array.length) continue;
                array[o] = x0;
                array[o + 1] = z0;
                array[o + 2] = hash;
                ring.count++;
            }
        }
        for (const ring of list) {
            ring.geometry.instanceCount = ring.count;
            ring.mesh.visible = ring.count > 0;
            if (ring.count > 0) {
                ring.tiles.clearUpdateRanges();
                ring.tiles.addUpdateRange(0, ring.count * 3);
                ring.tiles.needsUpdate = true;
            }
        }
    }, -1);

    return <primitive object={rings.group} />;
};

/** Grass on the green world the player is on. */
export const Grass = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        const id = runtime.features.grass >= 0 && body && body.kind === 'rocky' && body.biome?.kind === 'verdant' ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <GrassField key={body.id} body={body} runtime={runtime} /> : null;
};
