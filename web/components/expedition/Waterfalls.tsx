import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPEDITION_BODIES, type ExpeditionBody } from './bodies';
import type { ExpeditionRuntime } from './runtime';
import { FALL_SLOPE, type StreamRiver } from './streams';
import { createSurfaceUniforms, SURFACE_SHADING_GLSL } from './surfaceShading';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';

/**
 * The waterfalls of a world's rivers (streams.ts): wherever a river drops more than it runs, its
 * water leaves the lip in a sheet, falls in a real arc under the world's gravity (fast enough to
 * clear the rock it has cut), and lands in the pool at the foot, where foam spreads out in rings
 * and spray hangs in the air. Glassy at the lip, it tears into white streaks as it falls; the
 * streaks stretch as the water speeds up (each point of the sheet knows when water reaching it
 * left the lip). Lit like the ground round it, hazed like the hills; bright with the light behind.
 */
interface Fall {
    body: ExpeditionBody;
    /** Planet-local point at the lip, the frame the sheet is built in. */
    anchor: THREE.Vector3;
    sheet: THREE.BufferGeometry;
    pool: THREE.BufferGeometry;
    spray: THREE.BufferGeometry;
    /** The foot of the fall, from the anchor. */
    foot: THREE.Vector3;
    height: number;
}

const SHOW = 2600;
const ALONG = 28;
const ACROSS = 8;
const SPRAY = [90, 180, 320];

const falls = (body: ExpeditionBody, quality: 0 | 1 | 2): Fall[] => {
    const streams = body.biome?.streams;
    if (!streams) return [];
    const gravity = body.gravity ?? 9.8;
    const out: Fall[] = [];
    streams.rivers.forEach((river: StreamRiver) => {
        for (let i = 0; i < river.points.length - 1; i++) {
            const a = new THREE.Vector3(...river.points[i]);
            const b = new THREE.Vector3(...river.points[i + 1]);
            const run = a.distanceTo(b) * body.radius;
            const drop = river.levels[i] - river.levels[i + 1];
            if (drop / Math.max(run, 1e-6) <= FALL_SLOPE) continue;
            out.push(buildFall(body, a, b, river.levels[i], river.levels[i + 1], run, drop, river.width, gravity, quality));
        }
    });
    return out;
};

const buildFall = (
    body: ExpeditionBody, a: THREE.Vector3, b: THREE.Vector3, top: number, bottom: number,
    run: number, drop: number, width: number, gravity: number, quality: 0 | 1 | 2,
): Fall => {
    const R = body.radius;
    const anchor = a.clone().multiplyScalar(R + top);
    const up = a.clone();
    const ahead = b.clone().sub(a).addScaledVector(up, -b.clone().sub(a).dot(up)).normalize();
    const side = new THREE.Vector3().crossVectors(up, ahead).normalize();
    // Leaves the lip fast enough to land a little past the foot of the chute, clear of the rock.
    const fallTime = Math.sqrt((2 * drop) / gravity);
    const speed = (run * 1.08) / fallTime;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const arrive: number[] = [];
    const index: number[] = [];
    for (let j = 0; j <= ALONG; j++) {
        // Spaced by time, so the sheet's rows are closer where the water is slow, at the lip.
        const t = (j / ALONG) * fallTime;
        const forward = speed * t;
        const down = 0.5 * gravity * t * t;
        const spread = width * (0.5 + 0.18 * (j / ALONG));
        // The sheet's direction of travel, for its normal.
        const dir = ahead.clone().multiplyScalar(speed).addScaledVector(up, -gravity * t).normalize();
        for (let k = 0; k <= ACROSS; k++) {
            const u = k / ACROSS;
            const across = (u - 0.5) * 2 * spread;
            // Bowed a little forward in the middle, as a sheet over a worn lip is.
            const bow = (1 - (2 * u - 1) ** 2) * 0.35;
            const p = ahead.clone().multiplyScalar(forward + bow).addScaledVector(up, -down).addScaledVector(side, across);
            positions.push(p.x, p.y, p.z);
            const n = new THREE.Vector3().crossVectors(side, dir).normalize();
            normals.push(n.x, n.y, n.z);
            uvs.push(u, j / ALONG);
            arrive.push(t);
        }
    }
    for (let j = 0; j < ALONG; j++) {
        for (let k = 0; k < ACROSS; k++) {
            const i0 = j * (ACROSS + 1) + k;
            const i1 = i0 + 1;
            const i2 = i0 + ACROSS + 1;
            const i3 = i2 + 1;
            index.push(i0, i2, i1, i1, i2, i3);
        }
    }
    const sheet = new THREE.BufferGeometry();
    sheet.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    sheet.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    sheet.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    sheet.setAttribute('arrive', new THREE.Float32BufferAttribute(arrive, 1));
    sheet.setIndex(index);
    sheet.boundingSphere = new THREE.Sphere(new THREE.Vector3(), drop + run + width);
    // The foot: where the sheet meets the pool.
    const footTime = Math.sqrt((2 * (top - bottom)) / gravity);
    const foot = ahead.clone().multiplyScalar(speed * footTime).addScaledVector(up, -(top - bottom) + 0.05);
    // The pool's foam: a disc lying on the water round the foot.
    const pool = new THREE.CircleGeometry(width * 1.6, 40);
    const lay = new THREE.Matrix4().makeBasis(side, ahead, up);
    pool.applyMatrix4(lay);
    pool.translate(foot.x, foot.y, foot.z);
    // Spray: points scattered round the foot, each with its own phase, rising and drifting.
    const count = SPRAY[quality];
    const seeds = new Float32Array(count * 4);
    let s = 1234567;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < count; i++) seeds.set([rand(), rand(), rand(), rand()], i * 4);
    const spray = new THREE.BufferGeometry();
    spray.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(0), 3));
    spray.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 4));
    spray.boundingSphere = new THREE.Sphere(foot.clone(), width * 6);
    return { body, anchor, sheet, pool, spray, foot, height: drop };
};

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uAnchorLocal;
attribute float arrive;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vArrive;
void main() {
    vLocalPos = uAnchorLocal + position;
    vNormalLocal = normal;
    vUv = uv;
    vArrive = arrive;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}`;

const SHEET_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
${TEXTURE_NOISE_GLSL}
uniform float uTime;
uniform float uFallTime;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vArrive;
void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(vLocalPos);
    vec3 V = normalize(uCamLocal - vLocalPos);
    vec3 N = normalize(vNormalLocal);
    if (dot(N, V) < 0.0) N = -N;
    float fell = vUv.y;
    // Streaks: water that left the lip at the same moment arrives together, so the pattern is
    // read at (across, time it left): it stretches out as the water speeds up.
    float left = uTime - vArrive;
    vec4 n1 = tnoise4(vec3(vUv.x * 9.0, left * 1.6, 0.37));
    vec4 n2 = tnoise4(vec3(vUv.x * 23.0, left * 3.1, 4.1));
    float streak = n1.x * 0.6 + n2.y * 0.4;
    // Glassy and dark where it pours over the lip, aerated white lower down.
    float white = smoothstep(0.05, 0.45, fell) * (0.55 + 0.45 * smoothstep(-0.25, 0.35, streak));
    vec3 glass = mix(uHorizon, uZenith, 0.5) * 0.5 + vec3(0.03, 0.07, 0.07);
    vec3 albedo = mix(vec3(0.16, 0.3, 0.28), vec3(0.86, 0.9, 0.9), white);
    // Light through the thin sheet when it stands between the eye and the light.
    float through = pow(max(dot(-V, uSunDir), 0.0), 4.0) * (1.0 - white * 0.5);
    vec3 color = surfaceLightWrap(albedo, N, up, 0.6) + uSunColor * through * 0.6 * albedo;
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    color = mix(color, glass, fresnel * (1.0 - white));
    // Frayed at its edges, gaps opening lower down; denser in the middle.
    float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
    float body = smoothstep(0.0, 0.18 + 0.25 * fell, edge + (streak - 0.1) * 0.35 * (0.3 + fell));
    float alpha = body * mix(0.72, 0.95, white) * (0.75 + 0.25 * smoothstep(-0.3, 0.3, streak));
    color = applyHaze(color, vLocalPos, up);
    gl_FragColor = vec4(color * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const POOL_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
${TEXTURE_NOISE_GLSL}
uniform float uTime;
uniform vec3 uFoot;
uniform float uRadius0;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vArrive;
void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(vLocalPos);
    vec3 off = vLocalPos - uFoot;
    float r = length(off - up * dot(off, up)) / uRadius0;
    // Foam beaten up where the fall lands, carried outward in rings that break apart.
    vec4 n = tnoise4(off * 0.55 + vec3(0.0, 0.0, uTime * 0.25));
    float rings = smoothstep(0.35, 0.8, sin(r * 9.0 - uTime * 3.2 + n.x * 3.0) * 0.5 + 0.5);
    float foam = (1.0 - smoothstep(0.15, 1.0, r)) * mix(0.55, 1.0, rings) * smoothstep(-0.2, 0.4, n.y + 0.25 - r * 0.5);
    // The foot of a fall lies down in its gorge, out of most of the sun: shaded foam, not a lamp.
    vec3 color = surfaceLight(vec3(0.5, 0.53, 0.53), up, up) * 0.75;
    color = applyHaze(color, vLocalPos, up);
    float alpha = clamp(foam, 0.0, 1.0) * 0.7;
    gl_FragColor = vec4(color * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const SPRAY_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uAnchorLocal;
uniform vec3 uFoot;
uniform vec3 uUp;
uniform vec3 uAhead;
uniform vec3 uSide;
uniform float uTime;
uniform float uSize;
uniform float uScale;
attribute vec4 seed;
varying float vFade;
varying vec3 vLocalPos;
void main() {
    // Each droplet cloud lives a few seconds: thrown out from the foot, rising and spreading, thinning.
    float life = 3.5 + seed.w * 3.0;
    float age = fract(uTime / life + seed.x) ;
    float ang = seed.y * 6.2831853;
    vec3 out_ = (uSide * cos(ang) + uAhead * sin(ang)) * (1.5 + 9.0 * age * (0.4 + seed.z));
    vec3 p = uFoot + out_ + uUp * (0.4 + 14.0 * age * (0.3 + 0.7 * seed.w));
    vFade = sin(age * 3.14159) * (0.5 + 0.5 * seed.z);
    vLocalPos = uAnchorLocal + p;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + age * 1.6) * uScale / max(-mv.z, 0.1);
    #include <logdepthbuf_vertex>
}`;

const SPRAY_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
varying float vFade;
varying vec3 vLocalPos;
void main() {
    #include <logdepthbuf_fragment>
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float soft = 1.0 - smoothstep(0.2, 1.0, dot(q, q));
    vec3 up = normalize(vLocalPos);
    vec3 V = normalize(uCamLocal - vLocalPos);
    // Fine spray scatters light forwards: brighter with the light behind it, but a mist, never a glow.
    float forward = 0.7 + 0.5 * pow(max(dot(-V, uSunDir), 0.0), 3.0);
    // (Down in the gorge, mostly in shade, like the foam under it.)
    vec3 lit = surfaceLight(vec3(0.62, 0.66, 0.68), up, up) * 0.7;
    // The warm light off TON 618 greyed, as it is through cloud.
    lit = mix(lit, vec3(dot(lit, vec3(0.3, 0.5, 0.2))), 0.55);
    vec3 color = applyHaze(lit * forward, vLocalPos, up);
    float alpha = soft * vFade * 0.05;
    gl_FragColor = vec4(color * alpha, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const blend = {
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

const FallView = ({ fall, runtime }: { fall: Fall; runtime: ExpeditionRuntime }) => {
    const group = useRef<THREE.Group>(null);
    const { sheet, pool, spray } = useMemo(() => {
        const surface = () => createSurfaceUniforms(fall.body);
        const shared = { uAnchorLocal: { value: fall.anchor.clone() }, uTime: { value: 0 } };
        const up = fall.anchor.clone().normalize();
        const ahead = fall.foot.clone().addScaledVector(up, -fall.foot.dot(up)).normalize();
        return {
            sheet: new THREE.ShaderMaterial({
                vertexShader: VERTEX, fragmentShader: SHEET_FRAGMENT, side: THREE.DoubleSide, ...blend,
                uniforms: { ...surface(), ...textureNoiseUniforms(), ...shared, uFallTime: { value: 1 } },
            }),
            pool: new THREE.ShaderMaterial({
                vertexShader: VERTEX.replace('attribute float arrive;', '').replace('vArrive = arrive;', 'vArrive = 0.0;'),
                fragmentShader: POOL_FRAGMENT, ...blend,
                uniforms: { ...surface(), ...textureNoiseUniforms(), ...shared, uFoot: { value: fall.anchor.clone().add(fall.foot) }, uRadius0: { value: 1 } },
            }),
            spray: new THREE.ShaderMaterial({
                vertexShader: SPRAY_VERTEX, fragmentShader: SPRAY_FRAGMENT, ...blend,
                uniforms: {
                    ...surface(), ...shared,
                    uFoot: { value: fall.foot.clone() }, uUp: { value: up },
                    uAhead: { value: ahead }, uSide: { value: new THREE.Vector3().crossVectors(up, ahead).normalize() },
                    uSize: { value: 9 }, uScale: { value: 1 },
                },
            }),
        };
    }, [fall]);
    useEffect(() => {
        pool.uniforms.uRadius0.value = (fall.pool.boundingSphere ?? (fall.pool.computeBoundingSphere(), fall.pool.boundingSphere!)).radius;
        return () => { sheet.dispose(); pool.dispose(); spray.dispose(); };
    }, [fall, sheet, pool, spray]);
    const camLocal = useMemo(() => new THREE.Vector3(), []);
    useFrame(({ clock, camera, size }) => {
        const g = group.current;
        if (!g) return;
        const near = runtime.currentBody === fall.body && runtime.camera.distanceTo(fall.body.position.clone().add(fall.anchor)) < SHOW;
        g.visible = near;
        if (!near) return;
        g.position.copy(fall.body.position).add(fall.anchor).sub(runtime.origin);
        camLocal.copy(camera.position).add(runtime.origin).sub(fall.body.position);
        for (const m of [sheet, pool, spray]) {
            m.uniforms.uCamLocal.value.copy(camLocal);
            m.uniforms.uTime.value = clock.elapsedTime;
        }
        spray.uniforms.uScale.value = size.height * 0.5;
    });
    return (
        <group ref={group} visible={false}>
            <mesh geometry={fall.sheet} material={sheet} renderOrder={3} frustumCulled={false} />
            <mesh geometry={fall.pool} material={pool} renderOrder={3} frustumCulled={false} />
            <points geometry={fall.spray} material={spray} renderOrder={4} frustumCulled={false} />
        </group>
    );
};

export const Waterfalls = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const list = useMemo(() => EXPEDITION_BODIES.flatMap((body) => falls(body, runtime.quality)), [runtime.quality]);
    useEffect(() => () => list.forEach((f) => { f.sheet.dispose(); f.pool.dispose(); f.spray.dispose(); }), [list]);
    return <>{list.map((fall, i) => <FallView key={i} fall={fall} runtime={runtime} />)}</>;
};
