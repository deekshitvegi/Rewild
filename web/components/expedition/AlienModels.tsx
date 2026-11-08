import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { useEnvironmentOn, useModel } from './models';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { cue, type ExpeditionRuntime } from './runtime';
import type { LifeForm } from './aliens';

/**
 * The sculpted aliens that do not walk on the ground (aliens.ts, Aliens.tsx
 * places them): Titan's gliders riding the thick air, Venus's aeronauts
 * drifting between its cloud decks, the Makers waiting on Triton and the
 * Europan by its vent.
 *
 * The gliders and aeronauts are still meshes brought to life in their vertex
 * shader, one draw call per kind: wings and fins beat and glide, tendrils and
 * arms trail. The Maker is rigged (idle, walk and bow clips) and played like
 * the explorer; so is the Europan who comes up Europa's vent.
 */

/** A model's mesh as a plain geometry: turned so it faces +z, centred, longest side 1. */
const fitModel = (gltf: GLTF, turn: number) => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
    });
    if (!mesh) return null;
    const source = (mesh as THREE.Mesh).geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
        const attribute = source.getAttribute(name);
        if (!attribute) continue;
        const values = new Float32Array(attribute.count * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++) {
            for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4((mesh as THREE.Mesh).matrixWorld);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.rotateY(turn);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 1e-6);
    geometry.translate(-centre.x, -centre.y, -centre.z);
    geometry.scale(1 / longest, 1 / longest, 1 / longest);
    geometry.computeBoundingSphere();
    const material = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
    return { geometry, map: material.map ?? null, size: size.divideScalar(longest) };
};

type Livery = 'glider' | 'aeronaut';

/**
 * The world's own lighting and haze on a sculpted alien, with its motion in
 * the vertex shader: `aBeat` = (phase of the wing beat, how far the wings
 * beat, how far they are held up) per instance.
 */
const liveryMaterial = (body: ExpeditionBody, map: THREE.Texture | null, livery: Livery) => new THREE.ShaderMaterial({
    defines: { ...(map ? { USE_LIVERY_MAP: '' } : {}), ...(livery === 'glider' ? { GLIDER: '' } : { AERONAUT: '' }) },
    side: THREE.DoubleSide,
    uniforms: {
        ...createSurfaceUniforms(body),
        uOrigin: { value: new THREE.Vector3() },
        uMap: { value: map },
        uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aBeat;
        uniform vec3 uOrigin;
        uniform float uTime;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec2 vUv;
        void main() {
            vec3 p = position;
            vec3 n = normal;
            float span = abs(p.x);
            #ifdef GLIDER
            // The wings beat from the shoulders, bending most at the tips, or
            // are held up in a shallow V to glide; the tendrils trail behind.
            float wing = smoothstep(0.06, 0.45, span);
            float lift = sin(aBeat.x) * aBeat.y + aBeat.z;
            p.y += lift * wing * span;
            n = normalize(n + vec3(-sign(p.x) * lift * wing, 0.0, 0.0) * 0.6);
            float trail = smoothstep(-0.02, -0.4, p.y) * (1.0 - wing);
            p.z -= trail * (0.12 + 0.05 * sin(aBeat.x * 0.5 + p.y * 9.0));
            p.x += trail * 0.03 * sin(uTime * 1.3 + p.y * 7.0 + aBeat.x);
            #else
            // Fins sculling slowly; the arms and their net swaying under the bladder.
            float fin = smoothstep(0.16, 0.48, span);
            float lift = sin(aBeat.x) * aBeat.y + aBeat.z;
            p.y += lift * fin * span;
            float arms = smoothstep(-0.04, -0.3, p.y);
            p.z += arms * 0.035 * sin(aBeat.x * 0.6 + p.y * 5.0);
            p.x += arms * 0.02 * sin(uTime * 0.9 + p.y * 6.0);
            #endif
            vec4 world = instanceMatrix * vec4(p, 1.0);
            vLocalPos = uOrigin + world.xyz;
            vNormalLocal = mat3(instanceMatrix) * n;
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * world;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        uniform sampler2D uMap;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec2 vUv;
        void main() {
            #include <logdepthbuf_fragment>
            vec3 albedo = vec3(0.6, 0.45, 0.3);
            #ifdef USE_LIVERY_MAP
            albedo = texture2D(uMap, vUv).rgb;
            #endif
            vec3 N = normalize(vNormalLocal);
            if (!gl_FrontFacing) N = -N;
            vec3 up = normalize(vLocalPos);
            // Thin wings and fins let the light through: lit a little from behind too.
            vec3 color = surfaceLightWrap(albedo, N, up, 0.45) + playerLights(albedo, N, vLocalPos);
            gl_FragColor = vec4(applyHaze(color, vLocalPos, up), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const up = new THREE.Vector3();
const east = new THREE.Vector3();
const north = new THREE.Vector3();
const heading = new THREE.Vector3();
const side = new THREE.Vector3();
const basis = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const bank = new THREE.Quaternion();
const scale = new THREE.Vector3();
const local = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const zAxis = new THREE.Vector3(0, 0, 1);

/** Two directions along the ground at `up`. */
const tangents = (at: THREE.Vector3) => {
    up.copy(at);
    east.set(0, 1, 0).cross(up);
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    east.normalize();
    north.crossVectors(up, east).normalize();
};

const seeded = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

export interface FlierProps {
    body: ExpeditionBody;
    /** The site's centre (on the ground or up in the air), world units. */
    centre: THREE.Vector3;
    runtime: ExpeditionRuntime;
    life: LifeForm;
    register: (list: { life: LifeForm; position: THREE.Vector3 }[]) => void;
}

/**
 * Titan's gliders: kites eight metres across circling over the site on the thick air,
 * a few slow beats and then long glides, banking into their turns.
 */
export const Gliders = ({ body, centre, runtime, life, register }: FlierProps) => {
    const gltf = useModel('glider');
    // The model flies along -x: turned to face +z.
    const fitted = useMemo(() => (gltf ? fitModel(gltf, Math.PI / 2) : null), [gltf]);
    const count = [4, 6, 8][runtime.quality];
    const birds = useMemo(() => {
        const r = seeded(4471);
        return Array.from({ length: count }, () => ({
            radius: 25 + r() * 55, height: 14 + r() * 36, speed: 6 + r() * 3, phase: r() * Math.PI * 2,
            size: 7 + r() * 3, sense: r() < 0.5 ? -1 : 1, offset: (r() - 0.5) * 80, beat: r() * 10,
        }));
    }, [count]);
    const positions = useMemo(() => birds.map(() => new THREE.Vector3()), [birds]);
    useEffect(() => { register(positions.map((position) => ({ life, position }))); }, [positions, life, register]);
    const material = useMemo(() => (fitted ? liveryMaterial(body, fitted.map, 'glider') : null), [fitted, body]);
    const geometry = useMemo(() => {
        if (!fitted) return null;
        const g = fitted.geometry.clone();
        g.setAttribute('aBeat', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [fitted, count]);
    useEffect(() => () => { geometry?.dispose(); material?.dispose(); }, [geometry, material]);
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const ground = useMemo(() => {
        const d = centre.clone().sub(body.position).normalize();
        return body.position.clone().addScaledVector(d, body.radius + groundHeight(body, d));
    }, [centre, body]);

    useFrame(({ clock }) => {
        const mesh = meshRef.current;
        if (!mesh || !geometry || !material) return;
        const t = clock.elapsedTime;
        tangents(local.copy(ground).sub(body.position).normalize());
        const beats = geometry.getAttribute('aBeat') as THREE.InstancedBufferAttribute;
        birds.forEach((b, n) => {
            const angle = b.phase + (b.sense * t * b.speed) / b.radius;
            const position = positions[n]
                .copy(ground)
                .addScaledVector(east, Math.cos(angle) * b.radius + b.offset)
                .addScaledVector(north, Math.sin(angle) * b.radius)
                .addScaledVector(up, b.height + Math.sin(t * 0.3 + b.phase) * 6);
            heading.copy(east).multiplyScalar(-Math.sin(angle) * b.sense).addScaledVector(north, Math.cos(angle) * b.sense).normalize();
            side.crossVectors(up, heading).normalize();
            basis.makeBasis(side, up, heading);
            quaternion.setFromRotationMatrix(basis);
            // Banked into the turn.
            quaternion.multiply(bank.setFromAxisAngle(zAxis, -0.32 * b.sense));
            matrix.compose(local.copy(position).sub(runtime.origin), quaternion, scale.setScalar(b.size));
            mesh.setMatrixAt(n, matrix);
            // A few beats every ten seconds or so, then a long glide.
            const cycle = (t + b.beat) % 10;
            const flapping = cycle < 2.4 ? Math.sin((cycle / 2.4) * Math.PI) : 0;
            beats.setXYZ(n, t * 5.2 + b.phase, 0.42 * flapping, 0.08 * (1 - flapping));
        });
        mesh.instanceMatrix.needsUpdate = true;
        beats.needsUpdate = true;
        material.uniforms.uOrigin.value.copy(runtime.origin).sub(body.position);
        material.uniforms.uCamLocal.value.copy(runtime.camera).sub(body.position);
        material.uniforms.uTime.value = t;
    });
    if (!geometry || !material) return null;
    return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

/**
 * Venus's aeronauts: living airships ten metres long drifting in slow loops
 * between the cloud decks, fins sculling, nets trailing under them.
 */
export const Aeronauts = ({ body, centre, runtime, life, register }: FlierProps) => {
    const gltf = useModel('aeronaut');
    // The model's head is at -z: turned round to face +z.
    const fitted = useMemo(() => (gltf ? fitModel(gltf, Math.PI) : null), [gltf]);
    const count = [3, 4, 5][runtime.quality];
    const ships = useMemo(() => {
        const r = seeded(9343);
        return Array.from({ length: count }, (_, k) => ({
            radius: 70 + r() * 110, height: (r() - 0.5) * 90, speed: 1.6 + r() * 1.2, phase: (k / count) * Math.PI * 2 + r(),
            size: 9 + r() * 4, sense: k % 2 ? -1 : 1, offset: (r() - 0.5) * 120, scull: r() * 6,
        }));
    }, [count]);
    const positions = useMemo(() => ships.map(() => new THREE.Vector3()), [ships]);
    useEffect(() => { register(positions.map((position) => ({ life, position }))); }, [positions, life, register]);
    const material = useMemo(() => (fitted ? liveryMaterial(body, fitted.map, 'aeronaut') : null), [fitted, body]);
    const geometry = useMemo(() => {
        if (!fitted) return null;
        const g = fitted.geometry.clone();
        g.setAttribute('aBeat', new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [fitted, count]);
    useEffect(() => () => { geometry?.dispose(); material?.dispose(); }, [geometry, material]);
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const voice = useRef(3);

    useFrame(({ clock }, delta) => {
        const mesh = meshRef.current;
        if (!mesh || !geometry || !material) return;
        const t = clock.elapsedTime;
        tangents(local.copy(centre).sub(body.position).normalize());
        const beats = geometry.getAttribute('aBeat') as THREE.InstancedBufferAttribute;
        ships.forEach((s, n) => {
            const angle = s.phase + (s.sense * t * s.speed) / s.radius;
            const position = positions[n]
                .copy(centre)
                .addScaledVector(east, Math.cos(angle) * s.radius + s.offset)
                .addScaledVector(north, Math.sin(angle) * s.radius)
                .addScaledVector(up, s.height + Math.sin(t * 0.21 + s.phase) * 3);
            heading.copy(east).multiplyScalar(-Math.sin(angle) * s.sense).addScaledVector(north, Math.cos(angle) * s.sense).normalize();
            side.crossVectors(up, heading).normalize();
            basis.makeBasis(side, up, heading);
            quaternion.setFromRotationMatrix(basis);
            // A slow roll and pitch on the wind.
            quaternion.multiply(bank.setFromAxisAngle(zAxis, Math.sin(t * 0.33 + s.phase) * 0.05));
            matrix.compose(local.copy(position).sub(runtime.origin), quaternion, scale.setScalar(s.size));
            mesh.setMatrixAt(n, matrix);
            beats.setXYZ(n, t * 0.9 + s.scull, 0.06, 0.02);
        });
        mesh.instanceMatrix.needsUpdate = true;
        beats.needsUpdate = true;
        material.uniforms.uOrigin.value.copy(runtime.origin).sub(body.position);
        material.uniforms.uCamLocal.value.copy(runtime.camera).sub(body.position);
        material.uniforms.uTime.value = t;
        // Now and then one calls to the others: the pulses the radio picked up.
        voice.current -= Math.min(delta, 0.1);
        if (voice.current <= 0) {
            voice.current = 6 + Math.random() * 9;
            if (runtime.camera.distanceTo(centre) < 900) cue(runtime, 'call', 0.45, 2);
        }
    });
    if (!geometry || !material) return null;
    return <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />;
};

const greetRange = 26;

/**
 * The rigged figures, played like the explorer: where each stands from its
 * site's centre (metres east), how high its head is (what the scanner looks
 * at), and the clip it greets with.
 */
const FIGURES = {
    // A formal bow: a wave would lift the robe with the arm.
    maker: { model: 'makers', aside: 7, head: 2.0, greet: ['bow', 'wave'] },
    // Up from the vent, on the far side of the plume from the Maker's spot.
    europan: { model: 'europan', aside: -9, head: 1.6, greet: ['wave'] },
} as const;

/**
 * A rigged figure standing at its site: still, turning (unhurried) to look as
 * the explorer comes, and greeting them once.
 */
const Figure = ({ body, centre, runtime, life, register, figure }: FlierProps & { figure: keyof typeof FIGURES }) => {
    const config = FIGURES[figure];
    const gltf = useModel(config.model);
    const { gl } = useThree();
    const rig = useMemo(() => {
        if (!gltf) return null;
        const root = cloneSkinned(gltf.scene);
        root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh) mesh.frustumCulled = false;
        });
        const mixer = new THREE.AnimationMixer(root);
        const action = (name: string) => {
            const clip = gltf.animations.find((a) => a.name === name);
            return clip ? mixer.clipAction(clip) : null;
        };
        const idle = action('idle');
        let greet: THREE.AnimationAction | null = null;
        for (const name of config.greet as readonly string[]) greet = greet ?? action(name);
        if (greet) {
            greet.setLoop(THREE.LoopOnce, 1);
            greet.clampWhenFinished = false;
        }
        idle?.play();
        return { root, mixer, idle, greet };
    }, [gltf, config]);
    useEnvironmentOn(rig?.root ?? null, gl, 0.6);
    useEffect(() => () => { rig?.mixer.stopAllAction(); }, [rig]);
    // Where it stands: a few metres from the site's centre, on the ground.
    const where = useMemo(() => {
        const d = centre.clone().sub(body.position).normalize();
        tangents(d);
        const spot = d.clone().multiplyScalar(body.radius).addScaledVector(east, config.aside).normalize();
        return body.position.clone().addScaledVector(spot, body.radius + groundHeight(body, spot));
    }, [centre, body, config]);
    const head = useMemo(() => new THREE.Vector3(), []);
    useEffect(() => { register([{ life, position: head }]); }, [head, life, register]);
    const state = useRef({ yaw: 0, greeted: false });
    const group = useRef<THREE.Group>(null);

    useFrame((_, delta) => {
        // Where its head is, drawn or not, loaded or not (the scanner and first words need it from afar).
        tangents(local.copy(where).sub(body.position).normalize());
        head.copy(where).addScaledVector(up, config.head);
        const g = group.current;
        if (!rig || !g) return;
        // Past a few hundred metres it is a few pixels tall: not drawn, not animated.
        g.visible = runtime.camera.distanceTo(where) < 400;
        g.position.copy(where).sub(runtime.origin);
        if (!g.visible) return;
        const dt = Math.min(delta, 0.1);
        rig.mixer.update(dt);
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const s = state.current;
        if (walker && walker.body === body) {
            const to = local.copy(walker.position).sub(where);
            to.addScaledVector(up, -to.dot(up));
            const distance = to.length();
            if (distance < 60 && distance > 0.1) {
                // Turn, unhurried, to face the explorer.
                const want = Math.atan2(to.dot(east), to.dot(north));
                let turn = want - s.yaw;
                turn = Math.atan2(Math.sin(turn), Math.cos(turn));
                s.yaw += turn * Math.min(1, dt * 0.9);
            }
            if (distance < greetRange && !s.greeted && rig.greet) {
                s.greeted = true;
                rig.idle?.fadeOut(0.4);
                rig.greet.reset().fadeIn(0.4).play();
                cue(runtime, 'chapter', 0.6);
                const done = (event: { action: THREE.AnimationAction }) => {
                    if (event.action !== rig.greet) return;
                    rig.mixer.removeEventListener('finished', done);
                    rig.idle?.reset().fadeIn(0.6).play();
                };
                rig.mixer.addEventListener('finished', done);
            }
        }
        heading.copy(north).multiplyScalar(Math.cos(s.yaw)).addScaledVector(east, Math.sin(s.yaw)).normalize();
        side.crossVectors(up, heading).normalize();
        basis.makeBasis(side, up, heading);
        g.quaternion.setFromRotationMatrix(basis);
        g.position.copy(where).sub(runtime.origin);
    });
    if (!rig) return null;
    return (
        <group ref={group}>
            <primitive object={rig.root} />
        </group>
    );
};

/** One of the Makers, waiting on Triton at the end of the vaults' script. */
export const Maker = (props: FlierProps) => <Figure {...props} figure="maker" />;

/** A Europan, come up the vent from the ocean under the ice to see what landed. */
export const Europan = (props: FlierProps) => <Figure {...props} figure="europan" />;
