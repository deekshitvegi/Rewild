import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ExpeditionBody } from './bodies';
import { gnoise, hash3, hashToUnit, hashU32, NOISE_GLSL, NOISE_OFFSET } from './noise';
import { cue, watchView, type ExpeditionRuntime } from './runtime';
import { RING_GLSL, SATURN_SIGHTS, ringDensity } from './rings';

/**
 * Saturn's rings up close. From afar they are a smooth sheet (GasGiant.tsx);
 * what the sheet is made of is water ice, in pieces from grains to the size
 * of a house, most of its area in pieces a metre or so across, in a layer
 * only tens of metres thick. Near the ring plane those pieces are drawn round
 * the camera: each cell of the plane holds a few, placed by a hash of the
 * cell, so the field costs no memory, is the same on every visit and never
 * ends; pieces shrink away with distance, where the sheet takes over.
 *
 * Two layers: boulders out to a few hundred metres, and gravel close by that
 * shows how fast the ship is going. The ship can hit the boulders (the same
 * hash runs on the CPU, ringPiecesNear), so threading the B ring fast costs
 * shield.
 */

interface Layer {
    /** Cell size (metres), cells per side, and the most pieces one cell holds. */
    cell: number;
    grid: number;
    per: number;
    /** Smallest and largest piece (radius, metres); between them sizes fall off as size^-3, as measured. */
    size: [number, number];
    /** Icosphere detail of a piece. */
    detail: number;
    seed: number;
}

const BOULDERS = 9101;
const GRAVEL = 9203;

// Per quality level: boulders, then gravel.
const LAYERS: Layer[][] = [
    [{ cell: 36, grid: 18, per: 3, size: [0.8, 9], detail: 1, seed: BOULDERS }, { cell: 7, grid: 14, per: 2, size: [0.06, 0.45], detail: 0, seed: GRAVEL }],
    [{ cell: 32, grid: 28, per: 3, size: [0.7, 10], detail: 1, seed: BOULDERS }, { cell: 6, grid: 22, per: 3, size: [0.05, 0.45], detail: 0, seed: GRAVEL }],
    [{ cell: 28, grid: 40, per: 3, size: [0.6, 10], detail: 1, seed: BOULDERS }, { cell: 5, grid: 30, per: 3, size: [0.05, 0.45], detail: 0, seed: GRAVEL }],
];

/** Half the thickness of the ring layer, metres (the main rings are some ten to thirty metres thick). */
export const RING_THICKNESS = 26;

/** How far round the camera the boulders reach at a quality level, metres. */
export const ringReach = (quality: number) => {
    const layer = LAYERS[quality][0];
    return (layer.cell * layer.grid) / 2;
};

/** A lumpy piece of ice about one unit in radius, smooth shaded. */
const pieceGeometry = (detail: number) => {
    const sphere = new THREE.IcosahedronGeometry(1, detail);
    sphere.deleteAttribute('normal');
    sphere.deleteAttribute('uv');
    const geometry = mergeVertices(sphere);
    sphere.dispose();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i);
        const n = gnoise(v.x * 1.3, v.y * 1.3, v.z * 1.3, 5101 + detail) * 0.28 + gnoise(v.x * 3.1, v.y * 3.1, v.z * 3.1, 5131) * 0.09;
        v.multiplyScalar(0.84 + n);
        position.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    const instanced = new THREE.InstancedBufferGeometry();
    instanced.index = geometry.index;
    instanced.setAttribute('position', geometry.getAttribute('position'));
    instanced.setAttribute('normal', geometry.getAttribute('normal'));
    return instanced;
};

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${NOISE_GLSL}
${RING_GLSL}
uniform ivec2 uCamCell;
// The eye within its cell (x, y, metres) and its height above the ring plane (z).
uniform vec3 uCamFrac;
// The eye in the ring plane from the planet's centre (metres), for each piece's radius.
uniform vec2 uCamPlane;
// The eye from the planet's centre, for the light.
uniform vec3 uEyeLocal;
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec3 uAxis;
uniform float uRadius;
uniform float uCell;
uniform int uGrid;
uniform int uPer;
uniform vec2 uSize;
uniform float uThick;
uniform float uReach;
uniform float uTime;
uniform uint uSeed;
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying vec3 vToEye;
varying float vTone;
varying float vRing;

vec3 turnAbout(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

vec3 tenBits(uint h) {
    return vec3(float(h & 1023u), float((h >> 10u) & 1023u), float((h >> 20u) & 1023u)) / 1023.0;
}

void main() {
    int id = gl_InstanceID;
    int k = id % uPer;
    int c = id / uPer;
    ivec2 offset = ivec2(c % uGrid, c / uGrid) - ivec2(uGrid / 2);
    ivec2 cell = uCamCell + offset;
    // One hash per piece; everything else about it from hashes of that.
    uint base = hash3(uvec3(uint(cell.x + NOISE_OFFSET), uint(cell.y + NOISE_OFFSET), uint(k)), uSeed);
    uint h1 = hashU32(base + 1u);
    uint h2 = hashU32(base + 2u);
    // Where in its cell, and how high in the layer (most near the middle).
    vec2 along = (vec2(offset) + vec2(float(h1 & 0xffffu), float(h1 >> 16u)) / 65536.0) * uCell - uCamFrac.xy;
    float height = ((float(h2 & 0xffffu) + float(h2 >> 16u)) / 65536.0 - 1.0) * uThick - uCamFrac.z;
    vec3 rel = uE1 * along.x + uE2 * along.y + uAxis * height;
    float fade = 1.0 - smoothstep(uReach * 0.55, uReach, length(rel));
    float r = length(uCamPlane + along) / uRadius;
    // As many pieces as the ring is dense there: none in the gaps. The rest are clipped away.
    if (fade <= 0.0 || hashToUnit(base) >= ringDensity(r)) {
        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
        return;
    }
    uint h3 = hashU32(base + 3u);
    uint h4 = hashU32(base + 4u);
    uint h5 = hashU32(base + 5u);
    uint h6 = hashU32(base + 6u);
    uint h7 = hashU32(base + 7u);
    float size = min(uSize.x * inversesqrt(max(hashToUnit(h3), 1e-4)), uSize.y) * fade;
    vec3 axis = normalize(tenBits(h4) - 0.5 + 1e-3);
    float angle = float(h5 & 0xffffu) / 65536.0 * 6.2831853 + uTime * (float(h5 >> 16u) / 65536.0 - 0.5) * 0.5;
    vec3 shape = vec3(0.75, 0.6, 0.8) + tenBits(h6) * vec3(0.5, 0.4, 0.4);
    vec3 p = turnAbout(position * shape, axis, angle) * size;
    vNormalLocal = turnAbout(normal / shape, axis, angle);
    vLocal = uEyeLocal + rel + p;
    vToEye = -(rel + p);
    vTone = 0.72 + hashToUnit(h7) * 0.36;
    vRing = r;
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + rel + p, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform float uRadius;
uniform vec3 uIce;
uniform vec3 uPlanetLight;
uniform float uInfrared;
varying vec3 vLocal;
varying vec3 vNormalLocal;
varying vec3 vToEye;
varying float vTone;
varying float vRing;

void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalLocal);
    vec3 v = normalize(vToEye);
    // In Saturn's shadow?
    float b = dot(vLocal, uSunDir);
    float c = dot(vLocal, vLocal) - uRadius * uRadius;
    float sunlit = (b < 0.0 && b * b - c > 0.0) ? 0.0 : 1.0;
    // Water ice, a little reddish with dust; the C ring's pieces darker and greyer.
    vec3 albedo = uIce * vTone;
    albedo = mix(albedo * vec3(0.6, 0.58, 0.56), albedo, smoothstep(1.48, 1.56, vRing));
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 h = normalize(uSunDir + v);
    float glint = pow(max(dot(n, h), 0.0), 48.0) * 0.3;
    // Saturn's day side lights them from the planet's direction.
    vec3 up = normalize(vLocal);
    float shine = 0.07 * (0.5 + 0.5 * dot(up, uSunDir)) * max(dot(n, -up), 0.0);
    vec3 col = albedo * (ndl * sunlit * 1.1 + 0.012) + uPlanetLight * albedo * shine + vec3(glint * sunlit);
    // Ice at a hundred kelvin: dark to the infrared imager.
    col = mix(col, vec3(0.025, 0.03, 0.04), uInfrared);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const local = new THREE.Vector3();
const at = new THREE.Vector3();
const away = new THREE.Vector3();
const outward = new THREE.Vector3();

export interface RingFrame {
    e1: THREE.Vector3;
    e2: THREE.Vector3;
    axis: THREE.Vector3;
}

/** Where `point` (planet-local, metres) is in the ring frame: in the plane (x, y) and above it (z). */
export const toRing = (point: THREE.Vector3, frame: RingFrame, out = new THREE.Vector3()) =>
    out.set(point.dot(frame.e1), point.dot(frame.e2), point.dot(frame.axis));

/**
 * The boulders round a point in the ring frame (metres) with what the shader
 * draws there: position in the ring frame and radius. For the ship to hit.
 */
export const ringPiecesNear = (at: THREE.Vector3, planetRadius: number, quality: number, reach: number) => {
    const layer = LAYERS[quality][0];
    const pieces: { position: THREE.Vector3; radius: number }[] = [];
    if (Math.abs(at.z) > RING_THICKNESS + reach) return pieces;
    const cx = Math.floor(at.x / layer.cell);
    const cy = Math.floor(at.y / layer.cell);
    const span = Math.ceil(reach / layer.cell);
    for (let dx = -span; dx <= span; dx++) {
        for (let dy = -span; dy <= span; dy++) {
            const x = cx + dx + NOISE_OFFSET;
            const y = cy + dy + NOISE_OFFSET;
            for (let k = 0; k < layer.per; k++) {
                const base = hash3(x, y, k, layer.seed);
                const h1 = hashU32((base + 1) >>> 0);
                const h2 = hashU32((base + 2) >>> 0);
                const px = (cx + dx + (h1 & 0xffff) / 65536) * layer.cell;
                const py = (cy + dy + (h1 >>> 16) / 65536) * layer.cell;
                const r = Math.hypot(px, py) / planetRadius;
                if (hashToUnit(base) >= ringDensity(r)) continue;
                const z = (((h2 & 0xffff) + (h2 >>> 16)) / 65536 - 1) * RING_THICKNESS;
                const radius = Math.min(layer.size[0] / Math.sqrt(Math.max(hashToUnit(hashU32((base + 3) >>> 0)), 1e-4)), layer.size[1]);
                pieces.push({ position: new THREE.Vector3(px, py, z), radius: radius * 0.8 });
            }
        }
    }
    return pieces;
};

export const RingParticles = ({ body, runtime, frame }: { body: ExpeditionBody; runtime: ExpeditionRuntime; frame: RingFrame }) => {
    const gas = body.gas!;
    const layers = LAYERS[runtime.quality];
    const meshes = useMemo(() => layers.map((layer) => {
        const geometry = pieceGeometry(layer.detail);
        geometry.instanceCount = layer.grid * layer.grid * layer.per;
        const material = new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms: {
                uCamCell: { value: new THREE.Vector2() },
                uCamFrac: { value: new THREE.Vector3() },
                uCamPlane: { value: new THREE.Vector2() },
                uEyeLocal: { value: new THREE.Vector3() },
                uE1: { value: frame.e1 },
                uE2: { value: frame.e2 },
                uAxis: { value: frame.axis },
                uRadius: { value: body.radius },
                uCell: { value: layer.cell },
                uGrid: { value: layer.grid },
                uPer: { value: layer.per },
                uSize: { value: new THREE.Vector2(...layer.size) },
                uThick: { value: RING_THICKNESS },
                uReach: { value: (layer.cell * layer.grid) / 2 },
                uTime: { value: 0 },
                uSeed: { value: layer.seed },
                uSunDir: { value: body.sunDirection },
                uIce: { value: new THREE.Color(gas.rings!.color) },
                uPlanetLight: { value: new THREE.Color(gas.bands[0]) },
                uInfrared: { value: 0 },
            },
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.visible = false;
        return { mesh, layer };
    }), [layers, body, gas, frame]);
    useEffect(() => () => meshes.forEach(({ mesh }) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
    }), [meshes]);

    // Only near the ring plane and over the rings, for the player's own view.
    useFrame(({ clock }, delta) => {
        local.copy(runtime.camera).sub(body.position);
        const height = Math.abs(local.dot(frame.axis));
        const r = Math.hypot(local.dot(frame.e1), local.dot(frame.e2)) / body.radius;
        const inner = gas.rings!.inner;
        const outer = gas.rings!.outer;
        for (const { mesh, layer } of meshes) {
            const reach = (layer.cell * layer.grid) / 2;
            const margin = reach / body.radius;
            mesh.visible = height < RING_THICKNESS + reach && r > inner - margin && r < outer + margin;
            const u = (mesh.material as THREE.ShaderMaterial).uniforms;
            u.uTime.value = clock.elapsedTime;
            u.uInfrared.value = THREE.MathUtils.damp(u.uInfrared.value, runtime.infrared ? 1 : 0, 6, Math.min(delta, 0.1));
        }

        // The boulders are solid: the ship can hit them (the pieces the shader draws there).
        const ship = runtime.hud.ship;
        if (!ship || ship.destroyed || runtime.mode !== 'ship' || runtime.fall.active) return;
        toRing(local.copy(ship.position).sub(body.position), frame, at);
        if (Math.abs(at.z) > RING_THICKNESS + 12) return;
        if (!runtime.stats.visited.includes('rings') && ringDensity(Math.hypot(at.x, at.y) / body.radius) > 0.3) {
            runtime.stats.visited.push('rings');
            runtime.scan.found = { ...SATURN_SIGHTS.rings, label: 'Discovery' };
            runtime.scan.foundAt = performance.now() / 1000;
            cue(runtime, 'scan', 0.8);
        }
        for (const piece of ringPiecesNear(at, body.radius, runtime.quality, 16)) {
            const reach = piece.radius + 4.5;
            away.copy(at).sub(piece.position);
            const gap = away.length();
            if (gap >= reach || gap < 1e-6) continue;
            away.divideScalar(gap);
            outward.copy(frame.e1).multiplyScalar(away.x).addScaledVector(frame.e2, away.y).addScaledVector(frame.axis, away.z);
            ship.position.addScaledVector(outward, reach - gap);
            at.addScaledVector(away, reach - gap);
            const into = ship.velocity.dot(outward);
            if (into >= 0) continue;
            if (into < -60) {
                // The shield takes the blow, harder the faster: ring ice is as hard as rock at this speed.
                ship.shield = Math.max(0, ship.shield + into / 1600);
                ship.hurtBy = 'ice';
                ship.jolt = Math.min(1, -into / 700);
                cue(runtime, 'impact', Math.min(1.3, -into / 500));
                ship.notice = ship.shield > 0 ? `RING ICE · SHIELD ${Math.round(ship.shield * 100)}%` : 'RING ICE';
                ship.noticeTime = performance.now() / 1000;
            }
            ship.velocity.addScaledVector(outward, -into * 1.3);
        }
    });
    // Every camera that draws them (the player's, the wormhole's photographs) gets the field round its own eye.
    useEffect(() => watchView(runtime, (eye) => {
        local.copy(eye).add(runtime.origin).sub(body.position);
        const x = local.dot(frame.e1);
        const y = local.dot(frame.e2);
        const z = local.dot(frame.axis);
        for (const { mesh, layer } of meshes) {
            if (!mesh.visible) continue;
            const u = (mesh.material as THREE.ShaderMaterial).uniforms;
            const cx = Math.floor(x / layer.cell);
            const cy = Math.floor(y / layer.cell);
            u.uCamCell.value.set(cx, cy);
            u.uCamFrac.value.set(x - cx * layer.cell, y - cy * layer.cell, z);
            u.uCamPlane.value.set(x, y);
            u.uEyeLocal.value.copy(local);
        }
    }), [runtime, body, frame, meshes]);

    return (
        <>
            {meshes.map(({ mesh, layer }) => <primitive key={layer.seed} object={mesh} />)}
        </>
    );
};
