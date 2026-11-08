import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPEDITION_BODIES, type ExpeditionBody } from './bodies';
import { groundSpot } from './environment';
import type { ExpeditionRuntime } from './runtime';
import { createSurfaceUniforms, SURFACE_SHADING_GLSL } from './surfaceShading';

/**
 * Lotus on a world's still lakes (streams.ts lakes; Haven's tarn): round pads with the notch where
 * the stalk meets them, floating in drifts in the shallows, a few held up on their stalks above
 * the water, and the flowers among them: white cupped petals flushed pink at the tips round a
 * gold seed head. They rise and fall a little on the ripples. Lit like the ground round them,
 * hazed like the hills; the petals glow with the light behind them.
 */
const SHOW = 900;
const PADS = [90, 180, 280];
const FLOWERS = [10, 22, 34];

const rand = (seed: number) => {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
};

/** A pad: a disc a metre across, cupped a little, with a wedge cut to its centre. */
const padGeometry = () => {
    const rings = 5;
    const spokes = 28;
    const notch = 0.3;
    const positions: number[] = [0, 0.004, 0];
    const uvs: number[] = [0.5, 0.5];
    const index: number[] = [];
    for (let r = 1; r <= rings; r++) {
        const f = r / rings;
        for (let k = 0; k <= spokes; k++) {
            const a = notch / 2 + (k / spokes) * (Math.PI * 2 - notch);
            // The rim turns up a little; the middle sits in the water.
            const y = 0.004 + 0.035 * f ** 3;
            positions.push(Math.cos(a) * 0.5 * f, y, Math.sin(a) * 0.5 * f);
            uvs.push(0.5 + Math.cos(a) * 0.5 * f, 0.5 + Math.sin(a) * 0.5 * f);
        }
    }
    const row = spokes + 1;
    for (let k = 0; k < spokes; k++) index.push(0, 1 + k + 1, 1 + k);
    for (let r = 1; r < rings; r++) {
        for (let k = 0; k < spokes; k++) {
            const a = 1 + (r - 1) * row + k;
            const b = a + row;
            index.push(a, a + 1, b, a + 1, b + 1, b);
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
};

/** A flower: three rings of cupped petals round a seed head, 0.25 m across. */
const flowerGeometry = () => {
    const parts: THREE.BufferGeometry[] = [];
    const petal = (length: number, width: number, tilt: number, turn: number, lift: number) => {
        const g = new THREE.PlaneGeometry(width, length, 4, 6);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i);
            const y = p.getY(i) + length / 2;
            // (Clamped: float rounding puts the base a hair below 0, and a negative to the 0.7 is NaN.)
            const v = Math.min(Math.max(y / length, 0), 1);
            // Pointed oval, cupped across and curled in at the tip.
            const w = Math.sin(Math.min(v, 0.999) * Math.PI) ** 0.7 * (1 - v * 0.35);
            p.setXYZ(i, x * w, y, -(x * x) * 1.6 - v * v * length * 0.25);
        }
        g.rotateX(-tilt);
        g.translate(0, lift, 0);
        g.rotateY(turn);
        g.computeVertexNormals();
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, 1);
        return g;
    };
    for (let k = 0; k < 8; k++) parts.push(petal(0.13, 0.07, 1.05, (k / 8) * Math.PI * 2, 0.03));
    for (let k = 0; k < 8; k++) parts.push(petal(0.12, 0.065, 0.62, (k / 8 + 1 / 16) * Math.PI * 2, 0.04));
    for (let k = 0; k < 6; k++) parts.push(petal(0.1, 0.055, 0.28, (k / 6) * Math.PI * 2, 0.05));
    const pod = new THREE.CylinderGeometry(0.03, 0.022, 0.035, 12, 1);
    pod.translate(0, 0.07, 0);
    const uv = pod.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 0);
    parts.push(pod);
    const merged = new THREE.BufferGeometry();
    let count = 0;
    parts.forEach((g) => { count += g.attributes.position.count; });
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const index: number[] = [];
    let base = 0;
    parts.forEach((g) => {
        const gi = g.index ? Array.from(g.index.array) : Array.from({ length: g.attributes.position.count }, (_, i) => i);
        position.set(g.attributes.position.array as Float32Array, base * 3);
        normal.set(g.attributes.normal.array as Float32Array, base * 3);
        uvs.set(g.attributes.uv.array as Float32Array, base * 2);
        gi.forEach((i) => index.push(i + base));
        base += g.attributes.position.count;
        g.dispose();
    });
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    merged.setIndex(index);
    return merged;
};

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uAnchorLocal;
uniform float uTime;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vShade;
void main() {
    vec4 local = instanceMatrix * vec4(position, 1.0);
    // Riding the ripples: each one rises and tips a little on its own beat.
    float phase = dot(instanceMatrix[3].xyz, vec3(0.37, 0.53, 0.29));
    local.xyz += normalize(uAnchorLocal + instanceMatrix[3].xyz) * sin(uTime * 1.3 + phase) * 0.012;
    vLocalPos = uAnchorLocal + local.xyz;
    vNormalLocal = normalize(mat3(instanceMatrix) * normal);
    vUv = uv;
    vShade = fract(sin(phase * 91.7) * 4375.85);
    gl_Position = projectionMatrix * modelViewMatrix * local;
    #include <logdepthbuf_vertex>
}`;

const PAD_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vShade;
void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(vLocalPos);
    vec3 N = normalize(vNormalLocal);
    vec3 V = normalize(uCamLocal - vLocalPos);
    if (dot(N, V) < 0.0) N = -N;
    vec2 q = vUv - 0.5;
    float r = length(q) * 2.0;
    float ang = atan(q.y, q.x);
    // Veins from the centre, a paler hub, the rim darker where it turns up; some pads older and yellower.
    float veins = smoothstep(0.82, 1.0, abs(sin(ang * 11.0))) * smoothstep(0.1, 0.4, r) * 0.18;
    // Lotus leaves are a cool blue-green under a waxy bloom, not lime.
    vec3 green = mix(vec3(0.045, 0.12, 0.065), vec3(0.09, 0.19, 0.085), vShade);
    vec3 albedo = green * (1.0 + veins) * mix(1.12, 0.88, r) * mix(1.0, 0.72, smoothstep(0.9, 1.0, r));
    albedo = mix(albedo, vec3(0.17, 0.18, 0.07), step(0.9, vShade) * 0.45);
    vec3 color = surfaceLightWrap(albedo, N, up, 0.25);
    // A waxy sheen: lotus leaves shed water.
    vec3 H = normalize(V + uSunDir);
    color += uSunColor * pow(max(dot(N, H), 0.0), 60.0) * 0.25 * smoothstep(-0.05, 0.1, dot(up, uSunDir));
    color = applyHaze(color + playerLights(albedo, N, vLocalPos), vLocalPos, up);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

const FLOWER_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec2 vUv;
varying float vShade;
void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(vLocalPos);
    vec3 N = normalize(vNormalLocal);
    vec3 V = normalize(uCamLocal - vLocalPos);
    if (dot(N, V) < 0.0) N = -N;
    vec3 albedo;
    if (vUv.x > 0.5) {
        // Petal: white at the base, flushed pink to the tip.
        float tip = smoothstep(0.35, 1.0, vUv.y);
        albedo = mix(vec3(0.82, 0.78, 0.74), mix(vec3(0.78, 0.32, 0.48), vec3(0.85, 0.45, 0.6), vShade), tip);
    } else {
        albedo = vec3(0.62, 0.52, 0.12);
    }
    // Thin petals let the light through when it is behind them.
    float through = pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.8;
    vec3 color = surfaceLightWrap(albedo, N, up, 0.5) + uSunColor * albedo * through * smoothstep(-0.05, 0.1, dot(up, uSunDir));
    color = applyHaze(color + playerLights(albedo, N, vLocalPos), vLocalPos, up);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

interface Bed { body: ExpeditionBody; anchor: THREE.Vector3; pads: THREE.Matrix4[]; flowers: THREE.Matrix4[] }

/** Where lotus grow on a lake: in drifts in the shallows, a metre or two deep, clear of the middle. */
const beds = (quality: 0 | 1 | 2): Bed[] => {
    const out: Bed[] = [];
    for (const body of EXPEDITION_BODIES) {
        const lakes = body.biome?.streams?.lakes ?? [];
        lakes.forEach((lake, n) => {
            const centre = new THREE.Vector3(...lake.at);
            const anchor = centre.clone().multiplyScalar(body.radius + lake.level);
            const up = centre.clone();
            const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
            const north = new THREE.Vector3().crossVectors(up, east);
            const r = rand(7001 + n * 31);
            const place = (count: number, out_: THREE.Matrix4[], size: [number, number], raise: number) => {
                // Drifts: a few clusters round the shore, each a scatter of plants.
                const drifts = Array.from({ length: 5 }, () => r() * Math.PI * 2);
                let tries = 0;
                while (out_.length < count && tries++ < count * 30) {
                    const a = drifts[Math.floor(r() * drifts.length)] + (r() - 0.5) * 0.9;
                    const d = lake.radius * (0.55 + r() * 0.42);
                    const spot = up.clone().multiplyScalar(body.radius).addScaledVector(east, Math.cos(a) * d).addScaledVector(north, Math.sin(a) * d).normalize();
                    const w = groundSpot(body, spot).water;
                    if (w < 0.25 || w > 2.6) continue;
                    const pos = spot.clone().multiplyScalar(body.radius + lake.level).sub(anchor);
                    const s = size[0] + r() * (size[1] - size[0]);
                    // A few held up on their stalks above the water.
                    const lift = r() < raise ? 0.15 + r() * 0.45 : 0;
                    pos.addScaledVector(spot, lift);
                    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), spot);
                    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2));
                    if (lift > 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (r() - 0.5) * 0.5));
                    out_.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s, s, s)));
                }
            };
            const pads: THREE.Matrix4[] = [];
            const flowers: THREE.Matrix4[] = [];
            place(PADS[quality], pads, [0.3, 0.85], 0.18);
            place(FLOWERS[quality], flowers, [0.9, 1.4], 1);
            out.push({ body, anchor, pads, flowers });
        });
    }
    return out;
};

const BedView = ({ bed, runtime }: { bed: Bed; runtime: ExpeditionRuntime }) => {
    const group = useRef<THREE.Group>(null);
    const padRef = useRef<THREE.InstancedMesh>(null);
    const flowerRef = useRef<THREE.InstancedMesh>(null);
    const { padGeo, flowerGeo, padMat, flowerMat } = useMemo(() => {
        const shared = () => ({ ...createSurfaceUniforms(bed.body), uAnchorLocal: { value: bed.anchor.clone() }, uTime: { value: 0 } });
        return {
            padGeo: padGeometry(),
            flowerGeo: flowerGeometry(),
            padMat: new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: PAD_FRAGMENT, uniforms: shared(), side: THREE.DoubleSide }),
            flowerMat: new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FLOWER_FRAGMENT, uniforms: shared(), side: THREE.DoubleSide }),
        };
    }, [bed]);
    useEffect(() => {
        bed.pads.forEach((m, i) => padRef.current?.setMatrixAt(i, m));
        bed.flowers.forEach((m, i) => flowerRef.current?.setMatrixAt(i, m));
        if (padRef.current) padRef.current.instanceMatrix.needsUpdate = true;
        if (flowerRef.current) flowerRef.current.instanceMatrix.needsUpdate = true;
        return () => { padGeo.dispose(); flowerGeo.dispose(); padMat.dispose(); flowerMat.dispose(); };
    }, [bed, padGeo, flowerGeo, padMat, flowerMat]);
    const camLocal = useMemo(() => new THREE.Vector3(), []);
    useFrame(({ clock, camera }) => {
        const g = group.current;
        if (!g) return;
        const near = runtime.currentBody === bed.body && runtime.camera.distanceTo(bed.body.position.clone().add(bed.anchor)) < SHOW;
        g.visible = near;
        if (!near) return;
        g.position.copy(bed.body.position).add(bed.anchor).sub(runtime.origin);
        camLocal.copy(camera.position).add(runtime.origin).sub(bed.body.position);
        for (const m of [padMat, flowerMat]) {
            m.uniforms.uCamLocal.value.copy(camLocal);
            m.uniforms.uTime.value = clock.elapsedTime;
        }
    });
    return (
        <group ref={group} visible={false}>
            <instancedMesh ref={padRef} args={[padGeo, padMat, Math.max(1, bed.pads.length)]} count={bed.pads.length} frustumCulled={false} />
            <instancedMesh ref={flowerRef} args={[flowerGeo, flowerMat, Math.max(1, bed.flowers.length)]} count={bed.flowers.length} frustumCulled={false} />
        </group>
    );
};

export const Lotus = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const list = useMemo(() => beds(runtime.quality), [runtime.quality]);
    return <>{list.map((bed, i) => <BedView key={i} bed={bed} runtime={runtime} />)}</>;
};
