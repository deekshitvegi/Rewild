import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, heightGLSL, terrainUniforms, type ExpeditionBody } from './bodies';
import { usesEarthMap } from './earth';
import { NOISE_GLSL } from './noise';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';
import { SURFACE_SHADING_GLSL, UNDERWATER, createSurfaceUniforms } from './surfaceShading';
import { groundHeight, groundSpot, waterDepth } from './environment';
import { directionToBody } from './motion';
import { WATER_TURNS_GLSL, WATER_WAVES_GLSL } from './waterShading';
import { SEA_CLOCK, SEA_WAVES_GLSL } from './seaWaves';
import { liquidUniforms } from './PlanetTerrain';
import { placeBodyGroup } from './motion';
import type { ExpeditionRuntime } from './runtime';

/**
 * The water near the explorer as a surface of its own, over the bed the ground draws under it
 * (PlanetTerrain.tsx sinks its ground to the bed inside NEAR). A disc of rings round the point
 * under the camera, half a metre apart underfoot and tens of metres apart at its rim, laid at the
 * height the ground's own function gives the water there; where there is no water a point is
 * tucked just under the ground, so the shore is where the water meets the bank. Lit as the far
 * painted water is (waterShading.ts): the sky in it, the sun's glint, ripples (drawn out along a
 * river's current), see-through in the shallows and coloured with depth, white water on fast
 * shallows. Beyond NEAR the ground paints the water on itself as before.
 */

/** What the main camera sees and the water's mirror does not (userData.noMirror): grass, speed streaks. */
export const NO_MIRROR_LAYER = 2;

/** How far out the surface reaches (metres). */
const NEAR = 1600;
/** Rings and points round each, per quality. */
const GRID = [
    { rings: 120, around: 96 },
    { rings: 150, around: 128 },
    { rings: 170, around: 160 },
];
/** Drawn from this height (m) above the ground and lower. */
const CEILING = 2500;

const vertexShader = (body: ExpeditionBody) => /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${NOISE_GLSL}
${heightGLSL(body)}
uniform vec3 uFoot;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uRadius;
uniform float uTime;
uniform float uWaves;
varying vec3 vLocalPos;
varying vec3 vDir;
varying vec2 vWater;
varying float vSpacing;
#if defined(WATER_EARTH) || defined(WATER_STREAMS)
varying vec3 vFlow;
#endif
#ifdef WATER_EARTH
${SEA_WAVES_GLSL}
varying float vRiver;
// The breakers' slope (as a gradient along the ground) and how near a crest this is.
varying vec3 vTilt;
varying float vCrest;
#endif
void main() {
    // A point of the disc: its place on the plane touching the world under the camera, carried
    // back onto the sphere.
    vec2 plane = position.xy;
    vec3 d = normalize(uFoot + (plane.x / uRadius) * uEast + (plane.y / uRadius) * uNorth);
    float spacing = max(position.z, 0.4);
    vec2 water;
    float h = terrainSurface(d, spacing, water);
    #ifdef WATER_EARTH
    vRiver = gRiver;
    // (Only where it is drawn finely enough to see ripples.)
    vFlow = water.x > 0.0 && water.y > 0.0 && spacing < 16.0 ? riverFlow(d) : vec3(0.0);
    #endif
    #ifdef WATER_STREAMS
    vFlow = water.x > 0.0 && spacing < 16.0 ? streamFlow(d) : vec3(0.0);
    #endif
    // No water here: tucked just under the ground, so the triangles reaching it from the water go
    // under the bank and the shore is drawn where the water meets it.
    if (water.x <= 0.0) h -= 0.35 + spacing * 0.12;
    #ifdef WATER_EARTH
    // Breakers rolling in to the shore (seaWaves.ts): risen here, sloped landward, the slope found
    // from the shore field's own slope at two points a little way off.
    vTilt = vec3(0.0);
    vCrest = 0.0;
    if (water.x > 0.0 && water.y < 0.0 && water.y > -170.0) {
        h += seaSwell(water.y, water.x, uTime, uWaves);
        float e = max(spacing * 0.5, 0.5);
        vec2 w1;
        vec2 w2;
        terrainSurface(normalize(d + uEast * (e / uRadius)), spacing, w1);
        terrainSurface(normalize(d + uNorth * (e / uRadius)), spacing, w2);
        vec3 landward = (uEast * (w1.y - water.y) + uNorth * (w2.y - water.y)) / e;
        vTilt = landward * seaSwellSlope(water.y, water.x, uTime, uWaves);
        vCrest = seaCrest(water.y, uTime) * step(0.0, seaSwellAmp(water.y, water.x, uWaves) - 0.001);
    }
    #endif
    vec3 p = d * (uRadius + h);
    vLocalPos = p;
    vDir = d;
    vWater = water;
    vSpacing = spacing;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
${TEXTURE_NOISE_GLSL}
${WATER_TURNS_GLSL}
uniform float uTime;
uniform float uWaves;
uniform float uSurf;
uniform vec3 uLiquidDeep;
uniform vec3 uLiquidShallow;
uniform float uNear;
uniform float uEyes;
// A ship hovering low over the water (WaterSurface.tsx): the point under it on the surface, and
// how hard its downdraft beats on the water (0 to 1).
uniform vec4 uShip;
#ifdef WATER_MIRROR
// The world as seen from under the water's plane (WaterSurface.tsx): the picture, where a point of
// the disc falls in it, whether there is one this frame, how far out it holds, and the eye's right
// and straight-ahead along the water (for the ripples to shake it).
uniform sampler2D uMirror;
uniform mat4 uMirrorMatrix;
uniform float uMirrorOn;
uniform float uMirrorReach;
uniform vec3 uMirrorRight;
uniform vec3 uMirrorAhead;
#endif
varying vec3 vLocalPos;
varying vec3 vDir;
varying vec2 vWater;
varying float vSpacing;
#if defined(WATER_EARTH) || defined(WATER_STREAMS)
varying vec3 vFlow;
#endif
#ifdef WATER_EARTH
varying float vRiver;
varying vec3 vTilt;
varying float vCrest;
#endif
${WATER_WAVES_GLSL}

void main() {
    #include <logdepthbuf_fragment>
    vec3 up = vDir;
    vec3 pos = vLocalPos;
    // How deep the water is here. On Earth, worked out from the river's field and the distance
    // from the sea's shore, which run smoothly between the points (as the ground does).
    float depth = vWater.x;
    #ifdef WATER_EARTH
    float riverDepth = (1.0 - smoothstep(0.012, 0.035, abs(vRiver))) * 3.2 - smoothstep(0.026, 0.07, abs(vRiver));
    float edge = max(riverDepth, -vWater.y * 0.12);
    depth = mix(max(edge, 0.0), vWater.x, smoothstep(30.0, 80.0, -vWater.y));
    #else
    // The depth from the height over the water's level, which runs smoothly between the points:
    // the depth at the points is nothing at every dry one, and would draw the shore as teeth.
    depth = max(-vWater.y / 12.0, 0.0);
    #endif
    if (depth <= 0.002) discard;
    vec3 toEye = uCamLocal - pos;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-3);
    float footprint = length(fwidth(pos));
    #if defined(WATER_EARTH)
    float speed;
    vec3 N = riverNormal(up, pos, footprint, vFlow, speed);
    // The breakers' slopes.
    N = normalize(N - (vTilt - up * dot(vTilt, up)));
    vec3 flowDir = vFlow / max(speed, 1e-3);
    #elif defined(WATER_STREAMS)
    float speed;
    vec3 N = riverNormal(up, pos, footprint, vFlow, speed);
    vec3 flowDir = vFlow / max(speed, 1e-3);
    #else
    float speed = 0.0;
    vec3 N = waterNormal(up, pos, footprint);
    vec3 flowDir = vec3(0.0);
    #endif
    // A ship's downdraft: rings of ripples running out from under it, the water under it beaten
    // flat and white, spray torn off in a ring where the blast meets the surface.
    float churn = 0.0;
    if (uShip.w > 0.0) {
        vec3 off = pos - uShip.xyz;
        off -= up * dot(off, up);
        float r = length(off);
        float reach = 10.0 + 22.0 * uShip.w;
        if (r < reach * 2.2 && r > 0.01) {
            vec3 outward = off / r;
            // Gusty: the rings broken up and bent by the turbulence in the blast.
            vec4 gust = tnoise4(pos * 0.18 + vec3(uTime * 0.7, 0.0, uTime * 0.5));
            float ring = sin(r * 1.6 - uTime * 9.0 + gust.x * 4.0) * exp(-r / (reach * 0.7)) * smoothstep(0.0, 2.5, r);
            N = normalize(N - (outward + vec3(gust.y, gust.z, gust.w) * 0.6) * ring * 0.4 * uShip.w);
            float blast = 1.0 - smoothstep(reach * 0.25, reach * 0.55, r);
            float torn = tnoise4(pos * 0.6 + vec3(0.0, uTime * 1.3, 0.0)).x * 0.5 + 0.5;
            churn = clamp(uShip.w * (blast * (0.35 + 0.65 * torn) + smoothstep(0.5, 0.95, torn) * exp(-r / reach) * 0.6), 0.0, 1.0);
        }
    }
    float cosV = max(dot(N, V), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
    vec3 R = reflect(-V, N);
    float day = surfaceDay(up);
    vec3 sky = mix(uHorizon * vec3(0.8, 0.86, 0.95), uZenith, pow(clamp(dot(R, up), 0.0, 1.0), 0.5)) * (0.08 + 0.84 * day);
    #ifdef WATER_MIRROR
    // The world mirrored: banks, trees, hills, the ship, broken up by the ripples (their tilt moves
    // where the picture is read, most up close), giving way to the sky's own colours far out, where
    // one flat mirror no longer fits a round world.
    if (uMirrorOn > 0.0) {
        vec4 c = uMirrorMatrix * vec4(pos, 1.0);
        vec3 tilt = N - up * dot(N, up);
        vec2 wobble = vec2(dot(tilt, uMirrorRight), dot(tilt, uMirrorAhead)) * (0.025 + 0.9 / (dist + 10.0));
        vec2 uv = clamp(c.xy / c.w + wobble, vec2(0.002), vec2(0.998));
        float m = uMirrorOn * (1.0 - smoothstep(uMirrorReach * 0.5, uMirrorReach, dist));
        sky = mix(sky, texture2D(uMirror, uv).rgb / max(uEyes, 1e-3), m);
    }
    #endif
    float sunUp = smoothstep(-0.02, 0.08, dot(up, uSunDir));
    float spec = pow(max(dot(R, uSunDir), 0.0), 420.0) * 6.0 * sunUp;
    // The water itself: light scattered back out of it, its own colour, deep or shallow; and how
    // much of the bed behind shows through, the path down and back through the water taking the
    // red out first (a river's silt: clear for a metre or so).
    float shallow = exp(-depth / 3.0);
    vec3 body = surfaceLight(mix(uLiquidDeep, uLiquidShallow, shallow), up, up);
    float path = depth * (1.0 + 1.0 / max(dot(V, up), 0.15));
    #if defined(WATER_EARTH)
    vec3 through = exp(-path * vec3(0.55, 0.3, 0.26));
    #elif defined(WATER_CLEAR)
    // Clear fresh water (Haven): red goes first, then green (as PlanetTerrain's waterColor).
    vec3 through = exp(-path * vec3(0.45, 0.09, 0.06));
    #else
    vec3 through = exp(-path * vec3(0.32, 0.4, 0.5));
    #endif
    float cover = 1.0 - dot(through, vec3(0.3, 0.5, 0.2));
    // Premultiplied: the sky and the sun mirrored, the water's own light where it hides the bed.
    vec3 color = sky * fresnel + uSunColor * spec + body * (1.0 - fresnel) * cover
        + uSunColor * waterGlint(N, V, up, pos, footprint, flowDir, speed) * sunUp;
    float alpha = fresnel + (1.0 - fresnel) * cover;
    #if defined(WATER_EARTH) || defined(WATER_STREAMS)
    // White water in streaks along a fast river's shallows.
    if (speed > 0.25 && depth < 0.9 && footprint < 2.0) {
        vec3 dir = vFlow / speed;
        vec3 q = pos - dir * dot(pos, dir) * 0.75 - dir * uTime * 1.8 * speed;
        vec4 n = tnoise4(q * 0.8);
        float streak = smoothstep(0.35, 0.75, n.z * 0.6 + n.w * 0.4 + 0.25);
        float foam = streak * (1.0 - smoothstep(0.05, 0.9, depth)) * smoothstep(0.25, 0.8, speed) * (1.0 - smoothstep(0.5, 2.0, footprint)) * 0.75;
        color = mix(color, surfaceLight(vec3(0.62, 0.65, 0.64), up, up), foam);
        alpha = mix(alpha, 1.0, foam);
    }
    #endif
    // The ship's churn: white water beaten up under it.
    if (churn > 0.0) {
        color = mix(color, surfaceLight(vec3(0.7, 0.72, 0.72), up, up), churn * 0.8);
        alpha = mix(alpha, 1.0, churn * 0.8);
    }
    // Surf: a breaker's crest turning white as it comes into the shallows, the foam it leaves
    // lapping at the sand, torn into patches.
    float nearShore = smoothstep(-40.0, -0.5, vWater.y) * (1.0 - smoothstep(0.8, 3.0, footprint)) * uSurf;
    if (nearShore > 0.0) {
        float breakup = smoothstep(-0.15, 0.4, tnoise4(pos * 0.35 + vec3(0.0, uTime * 0.15, 0.0)).x * 0.7 + tnoise4(TURN_B * pos * 1.4).y * 0.3);
        #ifdef WATER_EARTH
        float wave = smoothstep(0.6, 0.95, vCrest) * (1.0 - smoothstep(0.8, 3.0, depth));
        #else
        float wave = 0.0;
        #endif
        float lap = smoothstep(-2.0, -0.3, vWater.y);
        float foam = clamp(nearShore * breakup * max(wave, lap * 0.8), 0.0, 1.0) * 0.88;
        color = mix(color, surfaceLight(vec3(0.6, 0.62, 0.61), up, up), foam);
        alpha = mix(alpha, 1.0, foam);
    }
    // Seen from under the water: straight up, inside the circle a diver sees the sky through (48.6
    // degrees across, bent by the surface), the sky and the sun, bright; outside it the surface
    // mirrors the water below, dark. The water's colour closes in with distance (applyHaze).
    if (dot(uCamLocal - pos, up) < 0.0) {
        float c = max(dot(-N, V), 0.0);
        float window = smoothstep(0.6, 0.7, c);
        vec3 through = mix(uHorizon, uZenith, 0.6) * (0.1 + 1.1 * day) + uSunColor * pow(max(dot(-V, uSunDir), 0.0), 60.0) * 3.0 * sunUp;
        vec3 under = uLiquidShallow * (0.2 + 0.8 * day) * 0.6;
        vec3 seen = applyHaze(mix(under, through, window), pos, up);
        gl_FragColor = vec4(seen * uEyes, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        return;
    }
    // A soft shore, and the surface giving way to the painted water at the edge of its reach.
    // (The haze over it is worked out on its own colour, then weighted again.)
    color = applyHaze(color / max(alpha, 1e-3), pos, up) * alpha;
    float fade = smoothstep(0.0, 0.06, depth) * (1.0 - smoothstep(uNear * 0.7, uNear * 0.9, dist));
    color *= fade * uEyes;
    alpha *= fade;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** The disc: rings growing outwards by a constant ratio, each point carrying the spacing round it (z). */
const discGeometry = (rings: number, around: number) => {
    const ratio = Math.pow(NEAR / 0.45, 1 / rings);
    const radii = [0];
    for (let r = 0.45; radii.length <= rings; r *= ratio) radii.push(r);
    const position: number[] = [];
    const index: number[] = [];
    position.push(0, 0, 0.45);
    for (let i = 1; i <= rings; i++) {
        const r = radii[i];
        const spacing = Math.max(r - radii[i - 1], (2 * Math.PI * r) / around);
        for (let k = 0; k < around; k++) {
            const a = (k / around) * Math.PI * 2;
            position.push(Math.cos(a) * r, Math.sin(a) * r, spacing);
        }
    }
    for (let k = 0; k < around; k++) index.push(0, 1 + k, 1 + ((k + 1) % around));
    for (let i = 1; i < rings; i++) {
        const a0 = 1 + (i - 1) * around;
        const b0 = 1 + i * around;
        for (let k = 0; k < around; k++) {
            const k1 = (k + 1) % around;
            index.push(a0 + k, b0 + k, b0 + k1, a0 + k, b0 + k1, a0 + k1);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index);
    return geometry;
};

const scenePosition = new THREE.Vector3();
const cameraLocal = new THREE.Vector3();
const foot = new THREE.Vector3();
const shipLocal = new THREE.Vector3();
/** Sea water seen from inside it, by day near the surface. */
const SEA_TONE = new THREE.Vector3(0.016, 0.07, 0.11);
const shipFoot = new THREE.Vector3();
// The mirror's working values.
const planePoint = new THREE.Vector3();
const planeNormal = new THREE.Vector3();
const eye = new THREE.Vector3();
const toPlane = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const aim = new THREE.Vector3();
const turn = new THREE.Matrix4();
const unturn = new THREE.Matrix4();
const clipPlane = new THREE.Plane();
const clip = new THREE.Vector4();
const corner = new THREE.Vector4();
const drawSize = new THREE.Vector2();
const probe = new THREE.Vector3();
const side = new THREE.Vector3();
/**
 * Spray: drops torn off the water by a ship's downdraft, thrown out and up from the ring where the
 * blast meets the surface, falling back under gravity. Points in the world's own frame, lit as the
 * water's white water is.
 */
const SPRAY = 1400;
const sprayVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aLife;
attribute float aSize;
uniform float uViewHeight;
varying float vLife;
varying vec3 vUp;
varying float vNear;
void main() {
    vLife = aLife;
    vUp = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aLife < 1.0 ? clamp(aSize * projectionMatrix[1][1] * uViewHeight * 0.5 / max(-mv.z, 0.1), 0.0, 24.0) : 0.0;
    // Drops right by the eye would be blurred discs: gone within a few metres.
    vNear = smoothstep(2.0, 6.0, -mv.z);
    #include <logdepthbuf_vertex>
}
`;
const sprayFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
varying float vLife;
varying vec3 vUp;
varying float vNear;
void main() {
    #include <logdepthbuf_fragment>
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0 || vLife >= 1.0) discard;
    // Soft-edged, thick where it was torn off, thinning as it spreads and falls.
    float a = exp(-r2 * 3.0) * (1.0 - r2) * smoothstep(0.0, 0.06, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife)) * 0.55 * vNear;
    vec3 c = surfaceLight(vec3(0.72, 0.74, 0.75), vUp, vUp);
    gl_FragColor = vec4(c * a, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;
const sprayBasisA = new THREE.Vector3();
const sprayBasisB = new THREE.Vector3();
const sprayAt = new THREE.Vector3();
const drawHeight = new THREE.Vector2();

/** How far out (m) the mirror is looked for, ring by ring, when the eye is not over water. */
const MIRROR_RINGS = [12, 30, 70, 150, 300];
const MIRROR_AROUND = 12;
/** The mirror's share of the screen's pixels each way. */
const MIRROR_SCALE = [0.4, 0.4, 0.5];

/**
 * Where the mirror lies: the still water under the eye, or the nearest water seen round it (one
 * plane for all the water in view, so it is the level of the water nearest the eye, which is the
 * water whose reflection is seen best). Returns false if there is none near.
 */
const findMirror = (body: ExpeditionBody, foot: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3, point: THREE.Vector3, normal: THREE.Vector3) => {
    if (waterDepth(body, foot) > 0) {
        normal.copy(foot);
        point.copy(foot).multiplyScalar(body.radius + groundHeight(body, foot));
        return true;
    }
    for (const r of MIRROR_RINGS) {
        for (let k = 0; k < MIRROR_AROUND; k++) {
            const a = ((k + (r % 7) * 0.37) / MIRROR_AROUND) * Math.PI * 2;
            side.copy(east).multiplyScalar(Math.cos(a)).addScaledVector(north, Math.sin(a));
            probe.copy(foot).addScaledVector(side, r / body.radius).normalize();
            if (waterDepth(body, probe) > 0.05) {
                normal.copy(probe);
                point.copy(probe).multiplyScalar(body.radius + groundHeight(body, probe));
                return true;
            }
        }
    }
    return false;
};


interface Spray { points: THREE.Points; position: Float32Array; velocity: Float32Array; life: Float32Array; span: Float32Array; size: Float32Array; next: number; carry: number; alive: number }

/**
 * Drops thrown from the ring where a ship's downdraft (ship: the point under it, and its strength
 * in w) meets the water, as many as the blast is strong; each flies out and up, slows in the air,
 * falls, and is gone in a second or two.
 */
const updateSpray = (spray: Spray, body: ExpeditionBody, ship: THREE.Vector4, dt: number) => {
    const { position, velocity, life, span, size } = spray;
    if (ship.w > 0.02) {
        sprayAt.set(ship.x, ship.y, ship.z);
        const up = sprayBasisA.copy(sprayAt).normalize();
        const east = sprayBasisB.set(0, 1, 0).cross(up);
        if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
        east.normalize();
        const north = scratchNorth.crossVectors(up, east);
        const reach = 10 + 22 * ship.w;
        spray.carry = Math.min(spray.carry + 1100 * ship.w * ship.w * dt, 80);
        for (; spray.carry >= 1; spray.carry -= 1) {
            const i = spray.next;
            spray.next = (spray.next + 1) % SPRAY;
            const a = Math.random() * Math.PI * 2;
            const r = reach * (0.28 + Math.random() * 0.3);
            const c = Math.cos(a);
            const s = Math.sin(a);
            const out = (3 + Math.random() * 7) * (0.5 + ship.w);
            const lift = (2 + Math.random() * 6) * (0.4 + ship.w);
            for (let k = 0; k < 3; k++) {
                const o = k === 0 ? 'x' : k === 1 ? 'y' : 'z';
                const along = east[o] * c + north[o] * s;
                position[i * 3 + k] = sprayAt[o] + along * r + up[o] * 0.2;
                velocity[i * 3 + k] = along * out + up[o] * lift;
            }
            life[i] = 0;
            span[i] = 0.8 + Math.random() * 0.9;
            size[i] = 0.1 + Math.random() * Math.random() * 0.35;
        }
        (spray.points.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    }
    let alive = 0;
    const drag = Math.exp(-0.9 * dt);
    for (let i = 0; i < SPRAY; i++) {
        if (life[i] >= 1) continue;
        life[i] = Math.min(1, life[i] + dt / span[i]);
        const j = i * 3;
        const x = position[j];
        const y = position[j + 1];
        const z = position[j + 2];
        const inv = 9.8 * dt / Math.hypot(x, y, z);
        velocity[j] = velocity[j] * drag - x * inv;
        velocity[j + 1] = velocity[j + 1] * drag - y * inv;
        velocity[j + 2] = velocity[j + 2] * drag - z * inv;
        position[j] = x + velocity[j] * dt;
        position[j + 1] = y + velocity[j + 1] * dt;
        position[j + 2] = z + velocity[j + 2] * dt;
        if (life[i] < 1) alive++;
    }
    if (alive > 0 || spray.alive > 0) {
        (spray.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (spray.points.geometry.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    }
    spray.alive = alive;
};
const scratchNorth = new THREE.Vector3();

const WaterDisc = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const groupRef = useRef<THREE.Group>(null);
    const meshRef = useRef<THREE.Mesh>(null);
    const mainCamera = useThree((state) => state.camera);
    const grid = GRID[runtime.quality];
    const geometry = useMemo(() => discGeometry(grid.rings, grid.around), [grid]);
    // (Settings › Graphics › Reflections; the scene is rebuilt when it changes.)
    const mirrored = runtime.features.mirror;
    const mirror = useMemo(() => mirrored ? {
        target: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true }),
        camera: new THREE.PerspectiveCamera(),
        matrix: new THREE.Matrix4(),
        point: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        /** Water found near enough to mirror (and the eye not under it); frames to the next search; the renderer's count after the last picture. */
        found: false,
        due: false,
        search: 0,
        drawn: -1,
    } : null, [mirrored]);
    const material = useMemo(() => {
        const earth = usesEarthMap(body);
        return new THREE.ShaderMaterial({
            vertexShader: vertexShader(body),
            fragmentShader,
            defines: {
                ...(earth ? { WATER_EARTH: '' } : {}),
                ...(!earth && body.biome?.liquid?.clear ? { WATER_CLEAR: '' } : {}),
                ...(!earth && body.biome?.streams ? { WATER_STREAMS: '' } : {}),
                ...(mirror ? { WATER_MIRROR: '' } : {}),
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
            uniforms: {
                ...createSurfaceUniforms(body),
                ...textureNoiseUniforms(),
                ...terrainUniforms(body),
                ...liquidUniforms(body.biome!),
                uFoot: { value: new THREE.Vector3(0, 1, 0) },
                uEast: { value: new THREE.Vector3(1, 0, 0) },
                uNorth: { value: new THREE.Vector3(0, 0, 1) },
                uRadius: { value: body.radius },
                uSeed: { value: body.biome!.seed >>> 0 },
                uTime: { value: 0 },
                uNear: { value: NEAR },
                uEyes: { value: 1 },
                uShip: { value: new THREE.Vector4() },
                uMirror: { value: mirror?.target.texture ?? null },
                uMirrorMatrix: { value: mirror?.matrix ?? new THREE.Matrix4() },
                uMirrorOn: { value: 0 },
                uMirrorReach: { value: 600 },
                uMirrorRight: { value: new THREE.Vector3(1, 0, 0) },
                uMirrorAhead: { value: new THREE.Vector3(0, 0, 1) },
            },
        });
    }, [body, mirror]);
    const spray = useMemo(() => {
        const position = new Float32Array(SPRAY * 3);
        const life = new Float32Array(SPRAY).fill(1);
        const size = new Float32Array(SPRAY);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(life, 1).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
            vertexShader: sprayVertex,
            fragmentShader: sprayFragment,
            // (The water's own light: the same uniforms, so they move together.)
            uniforms: { ...material.uniforms, uViewHeight: { value: 720 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
        }));
        points.frustumCulled = false;
        points.renderOrder = 3;
        return { points, position, life, size, velocity: new Float32Array(SPRAY * 3), span: new Float32Array(SPRAY).fill(1), next: 0, carry: 0, alive: 0 };
    }, [material]);
    useEffect(() => () => {
        geometry.dispose();
        material.dispose();
        mirror?.target.dispose();
        spray.points.geometry.dispose();
        (spray.points.material as THREE.Material).dispose();
        if (runtime.waterSurface?.body === body) runtime.waterSurface = null;
        UNDERWATER.value.set(0, 0, 0, 0);
        runtime.underwater = 0;
    }, [geometry, material, runtime, body, mirror, spray]);

    // The mirror: the scene drawn again from the eye's reflection under the water's plane, cut off
    // at the plane (an oblique near plane, as three's Reflector does: nothing under the water gets
    // into the picture), at a share of the screen's size, while the water is being drawn, so it is
    // this frame's world, after everything has moved. Grass and speed streaks are left out.
    useEffect(() => {
        const mesh = meshRef.current;
        if (!mesh || !mirror) return undefined;
        mesh.onBeforeRender = (renderer, scene, camera) => {
            // Once for each time the scene is drawn for the screen (the renderer counts the mirror's
            // own drawing too, so the count right after it marks this one done).
            if (!mirror.due || camera !== mainCamera || renderer.info.render.frame === mirror.drawn) return;
            const u = material.uniforms;
            planePoint.copy(mirror.point).applyMatrix4(mesh.matrixWorld);
            planeNormal.copy(mirror.normal).transformDirection(mesh.matrixWorld);
            eye.setFromMatrixPosition(camera.matrixWorld);
            toPlane.subVectors(planePoint, eye);
            const height = -toPlane.dot(planeNormal);
            if (height <= 0.05 || height > 500) {
                u.uMirrorOn.value = 0;
                return;
            }
            const view = mirror.camera;
            view.position.copy(toPlane).reflect(planeNormal).negate().add(planePoint);
            turn.extractRotation(camera.matrixWorld);
            lookAt.set(0, 0, -1).applyMatrix4(turn).add(eye);
            aim.subVectors(planePoint, lookAt).reflect(planeNormal).negate().add(planePoint);
            view.up.set(0, 1, 0).applyMatrix4(turn).reflect(planeNormal);
            view.lookAt(aim);
            view.near = (camera as THREE.PerspectiveCamera).near;
            view.far = (camera as THREE.PerspectiveCamera).far;
            view.layers.mask = camera.layers.mask & ~(1 << NO_MIRROR_LAYER);
            view.updateMatrixWorld();
            view.projectionMatrix.copy(camera.projectionMatrix);
            mirror.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
                .multiply(view.projectionMatrix).multiply(view.matrixWorldInverse).multiply(mesh.matrixWorld);
            // The eye's right and straight-ahead along the water, in the world's own frame.
            unturn.copy(mesh.matrixWorld).invert();
            const right = u.uMirrorRight.value as THREE.Vector3;
            right.set(1, 0, 0).transformDirection(camera.matrixWorld).transformDirection(unturn);
            const ahead = u.uMirrorAhead.value as THREE.Vector3;
            ahead.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(unturn);
            ahead.addScaledVector(mirror.normal, -ahead.dot(mirror.normal));
            if (ahead.lengthSq() > 1e-6) ahead.normalize();
            // Cut off at the water's plane.
            clipPlane.setFromNormalAndCoplanarPoint(planeNormal, planePoint).applyMatrix4(view.matrixWorldInverse);
            clip.set(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
            const e = view.projectionMatrix.elements;
            corner.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
            clip.multiplyScalar(2 / clip.dot(corner));
            e[2] = clip.x;
            e[6] = clip.y;
            e[10] = clip.z + 1;
            e[14] = clip.w;
            // Drawn at a share of the screen's own size.
            renderer.getDrawingBufferSize(drawSize);
            const scale = MIRROR_SCALE[runtime.quality];
            const w = Math.max(64, Math.round(drawSize.x * scale));
            const h = Math.max(64, Math.round(drawSize.y * scale));
            if (mirror.target.width !== w || mirror.target.height !== h) mirror.target.setSize(w, h);
            const before = renderer.getRenderTarget();
            const shadows = renderer.shadowMap.autoUpdate;
            const xr = renderer.xr.enabled;
            const counts = renderer.info.autoReset;
            renderer.shadowMap.autoUpdate = false;
            renderer.xr.enabled = false;
            // (Counted in with the frame's own draw calls, not starting the count again.)
            renderer.info.autoReset = false;
            mesh.visible = false;
            renderer.setRenderTarget(mirror.target);
            // (The depth buffer must be writable to be cleared.)
            renderer.state.buffers.depth.setMask(true);
            if (!renderer.autoClear) renderer.clear();
            renderer.render(scene, view);
            mirror.drawn = renderer.info.render.frame;
            renderer.info.autoReset = counts;
            mesh.visible = true;
            renderer.shadowMap.autoUpdate = shadows;
            renderer.xr.enabled = xr;
            renderer.setRenderTarget(before);
            u.uMirrorOn.value = 1;
        };
        return () => {
            mesh.onBeforeRender = () => {};
        };
    }, [mirror, material, mainCamera, runtime]);

    useFrame(({ camera, clock, gl }, delta) => {
        const group = groupRef.current;
        const mesh = meshRef.current;
        if (!group || !mesh) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        placeBodyGroup(runtime.motion, body, group, scenePosition, camera.position, cameraLocal);
        const near = runtime.currentBody === body && runtime.altitude < CEILING;
        mesh.visible = near;
        spray.points.visible = near && spray.alive > 0;
        runtime.waterSurface = near ? { body, near: NEAR } : runtime.waterSurface?.body === body ? null : runtime.waterSurface;
        if (!near) {
            UNDERWATER.value.w = 0;
            runtime.underwater = 0;
            return;
        }
        const u = material.uniforms;
        // The disc's frame: the point under the camera, and east and north there.
        foot.copy(cameraLocal).normalize();
        (u.uFoot.value as THREE.Vector3).copy(foot);
        const east = u.uEast.value as THREE.Vector3;
        east.set(0, 1, 0).cross(foot);
        if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
        east.normalize();
        (u.uNorth.value as THREE.Vector3).crossVectors(foot, east).normalize();
        (u.uCamLocal.value as THREE.Vector3).copy(cameraLocal);
        u.uTime.value = clock.elapsedTime;
        // The mirror's plane, looked for a few times a second; its picture drawn with the water.
        if (mirror) {
            if (--mirror.search <= 0) {
                mirror.search = 10;
                mirror.found = findMirror(body, foot, east, u.uNorth.value as THREE.Vector3, mirror.point, mirror.normal);
            }
            mirror.due = mirror.found && runtime.underwater <= 0;
            if (!mirror.due) u.uMirrorOn.value = 0;
        }
        // The breakers' clock, for the swimmer riding them (walking.ts).
        SEA_CLOCK.value = clock.elapsedTime;
        // The eye under the water: how deep, and the water's colour around it, darker deeper down
        // and by night.
        const surface = groundHeight(body, foot);
        const under = waterDepth(body, foot) > 0 ? Math.max(0, surface - (cameraLocal.length() - body.radius)) : 0;
        runtime.underwater = under;
        if (under > 0) {
            // (As the shaders read the sun: uSunDir is the world's sunDirection.)
            const day = THREE.MathUtils.smoothstep(foot.dot(body.sunDirection), -0.1, 0.25);
            const dim = (0.12 + 0.88 * day) * Math.exp(-under * 0.08) * 0.9;
            // The sea is blue, a river's silty water green (Titan's methane, its own colour).
            const sea = usesEarthMap(body) && groundSpot(body, foot).shore < 0;
            const tone = sea ? SEA_TONE : (u.uLiquidShallow.value as THREE.Vector3);
            UNDERWATER.value.set(tone.x * dim, tone.y * dim, tone.z * dim, under);
        } else {
            UNDERWATER.value.w = 0;
        }
        // A ship hovering low over the water: its downdraft on the surface under it.
        const ship = runtime.hud.ship;
        const shipVec = u.uShip.value as THREE.Vector4;
        shipVec.w = 0;
        if (ship && !ship.landed && runtime.mode === 'ship') {
            directionToBody(runtime.motion, body, shipLocal.copy(ship.position).sub(body.position), shipLocal);
            const shipUp = shipFoot.copy(shipLocal).normalize();
            if (waterDepth(body, shipUp) > 0.3) {
                const top = body.radius + groundHeight(body, shipUp);
                const height = shipLocal.length() - top;
                const beat = 1 - THREE.MathUtils.smoothstep(height, 3, 40);
                if (beat > 0) shipVec.set(shipUp.x * top, shipUp.y * top, shipUp.z * top, beat);
            }
        }
        updateSpray(spray, body, shipVec, Math.min(delta, 0.05));
        if (spray.alive > 0) {
            spray.points.visible = true;
            gl.getDrawingBufferSize(drawHeight);
            (spray.points.material as THREE.ShaderMaterial).uniforms.uViewHeight.value = drawHeight.y;
        }
    });

    return (
        <group ref={groupRef}>
            <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
            <primitive object={spray.points} />
        </group>
    );
};

/** The water's own surface on the world the explorer is at, if it has water. */
export const WaterSurface = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        // (Settings › Graphics › Water: Simple keeps the water painted on the ground.)
        const id = runtime.features.waterSurface && body && body.kind === 'rocky' && (usesEarthMap(body) || !!body.biome?.liquid) ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <WaterDisc key={body.id} body={body} runtime={runtime} /> : null;
};
