import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { say } from './argo';
import { createZoneLook, gasModel, lightAt, seenLight, zoneAt } from './gasAtmosphere';
import { directionToBody, directionToGame } from './motion';
import { useModel } from './models';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { hash3, hashToUnit, hashU32 } from './noise';
import { cue, type ExpeditionRuntime } from './runtime';
import { FLOATERS } from './story';

/**
 * Jupiter's floaters (story.ts): herds of gas bags at the top of the water
 * clouds, wherever the ship comes down. They are scattered on a grid in
 * Jupiter's own frame, a herd or none in each cell, so the same ones are
 * there on the way back up. Lit by what little light reaches that deep,
 * fading into the haze like the decks, their tendrils swaying; their bases
 * flash together, counting in primes.
 */
/** At most this many drawn (Low, Medium, High): each is 16,000 triangles. */
const MAX_BY_QUALITY = [10, 24, 36];
const MAX = 36;
const SHOW = 16000;

/** The light at their bases: flashes in groups of two, three, five and seven, then a pause. */
const PRIMES = [2, 3, 5, 7];
const FLASH = 0.32;
const CYCLE = (() => PRIMES.reduce((t, n) => t + n * FLASH * 2 + 1.4, 0) + 3)();
const primeGlow = (time: number) => {
    let t = time % CYCLE;
    for (const n of PRIMES) {
        const span = n * FLASH * 2;
        if (t < span) {
            const f = (t / (FLASH * 2)) % 1;
            return f < 0.5 ? Math.sin(f * 2 * Math.PI) : 0;
        }
        t -= span + 1.4;
    }
    return 0;
};

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vLow;
varying float vDepth;
void main() {
    vec3 p = position;
    // Below the bladder the tendrils hang and sway.
    float hang = smoothstep(-0.05, -0.45, p.y);
    p.x += hang * 0.05 * sin(uTime * 0.7 + p.y * 9.0 + aPhase * 6.28);
    p.z += hang * 0.05 * cos(uTime * 0.6 + p.y * 7.0 + aPhase * 4.0);
    // The bladder breathes, slowly.
    p.xz *= 1.0 + (1.0 - hang) * 0.02 * sin(uTime * 0.4 + aPhase * 6.28);
    vUv = uv;
    vLow = hang;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform float uLight;
uniform float uGlow;
uniform vec3 uFog;
uniform float uVisibility;
varying vec2 vUv;
varying float vLow;
varying float vDepth;
void main() {
    #include <logdepthbuf_fragment>
    vec3 albedo = texture2D(uMap, vUv).rgb;
    vec3 color = albedo * (0.05 + 0.95 * uLight);
    // The light at their bases, warm, and the tendrils catching it.
    color += vec3(1.0, 0.72, 0.38) * uGlow * (0.25 + 1.6 * vLow) * (0.35 + 0.65 * albedo.r);
    float fog = 1.0 - exp(-vDepth / uVisibility);
    color = mix(color, uFog, clamp(fog, 0.0, 0.97));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const local = new THREE.Vector3();
const cellAt = new THREE.Vector3();
const spot = new THREE.Vector3();
const toGame = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const scale = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const radial = new THREE.Vector3();
const fogColor = new THREE.Color();

/** A model's mesh as one instanced geometry (centred, longest side 1) and its material, lit as the decks are. */
const instancedParts = (gltf: GLTF, count: number) => {
    let source: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (!source && (o as THREE.Mesh).isMesh) source = o as THREE.Mesh; });
    if (!source) return null;
    const mesh = source as THREE.Mesh;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.scale(1 / longest, 1 / longest, 1 / longest);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = (i * 0.618) % 1;
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    const map = (mesh.material as THREE.MeshStandardMaterial).map ?? null;
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
            uMap: { value: map },
            uTime: { value: 0 },
            uLight: { value: 0.3 },
            uGlow: { value: 0 },
            uFog: { value: new THREE.Color() },
            uVisibility: { value: 4000 },
        },
    });
    return { geometry, material };
};

/**
 * Sagan and Salpeter's third kind: hunters, fast swimmers that catch
 * floaters. A few circle the nearest herd, jetting round it and banking in.
 */
const HUNTERS = 3;
const HUNTER = {
    id: 'jupiter-hunters',
    name: 'Jupiter hunters',
    label: 'Discovery · Life',
    blurb: 'Sagan and Salpeter\'s third kind, after the sinkers and the floaters: hunters, swimmers fifty metres long that jet through the hydrogen and take floaters the way sharks take seals. They circle a herd, banking in, a row of lights down each flank. Where there are floaters, they are never far off.',
    argo: 'Something fast, circling the herd. Fifty metres, jet-driven. A hunter.',
};
const centreOfHerd = new THREE.Vector3();
const herdUp = new THREE.Vector3();
const herdEast = new THREE.Vector3();
const herdNorth = new THREE.Vector3();
const along = new THREE.Vector3();
const forwardDir = new THREE.Vector3();
const bank = new THREE.Quaternion();
const aim = new THREE.Matrix4();
const AXIS_Z = new THREE.Vector3(0, 0, 1);

export const JupiterFloaters = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const jupiter = useMemo(() => findBody('research') as ExpeditionBody, []);
    const model = useMemo(() => gasModel(jupiter), [jupiter]);
    const look = useMemo(createZoneLook, []);
    const gltf = useModel('floater');
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const parts = useMemo(() => (gltf ? instancedParts(gltf, MAX) : null), [gltf]);
    const hunterModel = useModel('jupiterHunter');
    const hunters = useMemo(() => (hunterModel ? instancedParts(hunterModel, HUNTERS) : null), [hunterModel]);
    const huntersRef = useRef<THREE.InstancedMesh>(null);
    useEffect(() => () => { hunters?.geometry.dispose(); hunters?.material.dispose(); }, [hunters]);
    useEffect(() => () => { parts?.geometry.dispose(); parts?.material.dispose(); }, [parts]);

    useFrame(({ clock }) => {
        const mesh = meshRef.current;
        if (!mesh || !parts) return;
        const gas = runtime.gas;
        const inside = !!gas && gas.body === jupiter && gas.height < FLOATERS.top + 4000 && gas.height > FLOATERS.bottom - 4000;
        mesh.visible = inside;
        if (!inside || !gas) return;
        directionToBody(runtime.motion, jupiter, local.copy(runtime.camera).sub(jupiter.position), local);
        const cell = FLOATERS.cell;
        cellAt.set(Math.floor(local.x / cell), Math.floor(local.y / cell), Math.floor(local.z / cell));
        let count = 0;
        let nearest = Infinity;
        const limit = MAX_BY_QUALITY[runtime.quality];
        zoneAt(model, gas.height, look);
        for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            const ix = cellAt.x + dx, iy = cellAt.y + dy, iz = cellAt.z + dz;
            const h = hash3(ix + 65536, iy + 65536, iz + 65536, 4241);
            // About one cell in three has a herd, of up to four.
            if (hashToUnit(h) > 0.34) continue;
            const herd = 1 + Math.floor(hashToUnit(hashU32(h + 3)) * 4);
            for (let k = 0; k < herd && count < limit; k++) {
                const hk = hash3(ix + 65536, iy + 65536, iz + 65536, 9001 + k * 37);
                spot.set((ix + hashToUnit(hk)) * cell, (iy + hashToUnit(hashU32(hk + 1))) * cell, (iz + hashToUnit(hashU32(hk + 2))) * cell);
                // On to the shell they keep to: the top of the water clouds.
                const height = THREE.MathUtils.lerp(FLOATERS.bottom, FLOATERS.top, hashToUnit(hashU32(hk + 4)));
                radial.copy(spot).normalize();
                if (radial.lengthSq() < 0.5) continue;
                spot.copy(radial).multiplyScalar(jupiter.radius + height + Math.sin(clock.elapsedTime * 0.07 + k) * 25);
                const distance = spot.distanceTo(local);
                // Past four times the visibility the haze has hidden them anyway.
                if (distance > Math.min(SHOW, Math.max(look.visibility * 2, 3000))) continue;
                if (distance < nearest) {
                    nearest = distance;
                    centreOfHerd.copy(spot);
                }
                // In the game's frame, upright to Jupiter's up there, each turned its own way.
                directionToGame(runtime.motion, jupiter, toGame.copy(spot), toGame).add(jupiter.position).sub(runtime.origin);
                directionToGame(runtime.motion, jupiter, radial, radial);
                turn.setFromUnitVectors(up, radial).multiply(spin.setFromAxisAngle(up, hashToUnit(hashU32(hk + 13)) * 6.28));
                const s = FLOATERS.size * (0.7 + 0.6 * hashToUnit(hashU32(hk + 5)));
                matrix.compose(toGame, turn, scale.setScalar(s));
                mesh.setMatrixAt(count++, matrix);
            }
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        // Lit as the decks are at this depth, hazed the same way.
        const light = lightAt(model, gas.height);
        // (The sun's direction is in the game's frame, like the camera.)
        const day = THREE.MathUtils.smoothstep(cellAt.copy(runtime.camera).sub(jupiter.position).normalize().dot(jupiter.sunDirection), -0.2, 0.25);
        zoneAt(model, gas.height, look);
        fogColor.copy(look.haze).multiplyScalar(seenLight(0.12 + 0.88 * light) * (0.05 + 0.95 * day));
        const u = parts.material.uniforms;
        u.uTime.value = clock.elapsedTime;
        u.uLight.value = seenLight(light) * (0.06 + 0.94 * day);
        u.uGlow.value = 0.25 + 1.4 * primeGlow(clock.elapsedTime);
        (u.uFog.value as THREE.Color).copy(fogColor);
        u.uVisibility.value = Math.max(look.visibility * 0.5, 600);
        // The hunters, round the nearest herd (in Jupiter's frame, then the game's).
        const hunterMesh = huntersRef.current;
        if (hunterMesh && hunters) {
            hunterMesh.visible = Number.isFinite(nearest);
            let closest = Infinity;
            if (hunterMesh.visible) {
                herdUp.copy(centreOfHerd).normalize();
                herdEast.set(0, 1, 0).cross(herdUp).normalize();
                herdNorth.crossVectors(herdUp, herdEast);
                const count = runtime.quality === 0 ? 2 : HUNTERS;
                for (let i = 0; i < count; i++) {
                    const radius = 750 + i * 260;
                    const speed = 38 + i * 6;
                    const angle = clock.elapsedTime * (speed / radius) * (i % 2 ? -1 : 1) + i * 2.1;
                    spot.copy(centreOfHerd).addScaledVector(herdEast, Math.cos(angle) * radius).addScaledVector(herdNorth, Math.sin(angle) * radius)
                        .addScaledVector(herdUp, 120 * Math.sin(clock.elapsedTime * 0.11 + i * 1.7));
                    along.copy(herdEast).multiplyScalar(-Math.sin(angle)).addScaledVector(herdNorth, Math.cos(angle)).multiplyScalar(i % 2 ? -1 : 1);
                    closest = Math.min(closest, spot.distanceTo(local));
                    directionToGame(runtime.motion, jupiter, toGame.copy(spot), toGame).add(jupiter.position).sub(runtime.origin);
                    directionToGame(runtime.motion, jupiter, forwardDir.copy(along), forwardDir);
                    directionToGame(runtime.motion, jupiter, radial.copy(herdUp), radial);
                    // Facing along its circle (the model's nose is +z), banked in towards the herd.
                    aim.lookAt(forwardDir, cellAt.set(0, 0, 0), radial);
                    turn.setFromRotationMatrix(aim).multiply(bank.setFromAxisAngle(AXIS_Z, (i % 2 ? 1 : -1) * 0.45));
                    matrix.compose(toGame, turn, scale.setScalar(55));
                    hunterMesh.setMatrixAt(i, matrix);
                }
                hunterMesh.count = count;
                hunterMesh.instanceMatrix.needsUpdate = true;
                const hu = hunters.material.uniforms;
                hu.uTime.value = clock.elapsedTime;
                hu.uLight.value = u.uLight.value;
                hu.uGlow.value = 0.35;
                (hu.uFog.value as THREE.Color).copy(fogColor);
                hu.uVisibility.value = u.uVisibility.value;
            }
            if (closest < 900 && !runtime.stats.visited.includes(HUNTER.id)) {
                runtime.stats.visited.push(HUNTER.id);
                cue(runtime, 'chapter', 0.9);
                runtime.scan.found = { label: HUNTER.label, name: HUNTER.name, blurb: HUNTER.blurb };
                runtime.scan.foundAt = performance.now() / 1000;
                say(runtime.argo, HUNTER.argo, 'warn');
            }
        }
        // Found: one close enough to make out.
        if (nearest < 1500 && !runtime.stats.visited.includes(FLOATERS.id)) {
            runtime.stats.visited.push(FLOATERS.id);
            cue(runtime, 'chapter', 0.9);
            runtime.scan.found = { label: FLOATERS.label, name: FLOATERS.name, blurb: FLOATERS.blurb };
            runtime.scan.foundAt = performance.now() / 1000;
            say(runtime.argo, FLOATERS.argo, 'info');
        }
    });

    return (
        <>
            {parts && <instancedMesh ref={meshRef} args={[parts.geometry, parts.material, MAX]} frustumCulled={false} renderOrder={3} />}
            {hunters && <instancedMesh ref={huntersRef} args={[hunters.geometry, hunters.material, HUNTERS]} frustumCulled={false} renderOrder={3} visible={false} />}
        </>
    );
};
