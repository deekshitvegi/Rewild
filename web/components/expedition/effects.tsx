import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';

/**
 * White exhaust trails behind the engines, as in the reference video when the
 * ship boosts. Points are kept in world units so the trail stays put while the
 * floating origin moves with the ship.
 */
const TRAIL_POINTS = 44;

export const ExhaustTrails = ({ runtime, nozzles, intensity }: {
    runtime: ExpeditionRuntime;
    nozzles: () => THREE.Object3D[];
    intensity: () => number;
}) => {
    const trails = useMemo(() => [0, 1].map(() => {
        const points = Array.from({ length: TRAIL_POINTS }, () => new THREE.Vector3());
        const positions = new Float32Array(TRAIL_POINTS * 2 * 3);
        const alphas = new Float32Array(TRAIL_POINTS * 2);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
        const index: number[] = [];
        for (let i = 0; i < TRAIL_POINTS - 1; i++) {
            const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
            index.push(a, b, c, b, d, c);
        }
        geometry.setIndex(index);
        geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        return { points, geometry, count: 0 };
    }), []);

    const material = useMemo(() => new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            attribute float alpha;
            varying float vAlpha;
            void main() {
                vAlpha = alpha;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            varying float vAlpha;
            void main() {
                #include <logdepthbuf_fragment>
                gl_FragColor = vec4(vec3(1.9, 2.15, 2.6) * vAlpha, 1.0);
            }`,
    }), []);

    useEffect(() => () => { trails.forEach((t) => t.geometry.dispose()); material.dispose(); }, [trails, material]);

    const world = new THREE.Vector3();
    const side = new THREE.Vector3();
    const toCamera = new THREE.Vector3();
    const segment = new THREE.Vector3();
    const moved = useRef(runtime.moved.count);

    useFrame(({ camera }) => {
        const strength = intensity();
        const list = nozzles();
        // Through a wormhole the trail comes too; after a jump it starts afresh.
        const jumped = moved.current !== runtime.moved.count;
        moved.current = runtime.moved.count;
        trails.forEach((trail, n) => {
            const nozzle = list[n];
            if (!nozzle) return;
            if (jumped) {
                const carry = runtime.moved.carry;
                if (carry) trail.points.forEach((point) => carry(point));
                else trail.count = 0;
            }
            nozzle.getWorldPosition(world).add(runtime.origin);
            // Shift the history and add the newest point.
            for (let i = TRAIL_POINTS - 1; i > 0; i--) trail.points[i].copy(trail.points[i - 1]);
            trail.points[0].copy(world);
            trail.count = Math.min(TRAIL_POINTS, trail.count + 1);

            const positions = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
            const alphas = trail.geometry.getAttribute('alpha') as THREE.BufferAttribute;
            for (let i = 0; i < TRAIL_POINTS; i++) {
                const p = trail.points[Math.min(i, trail.count - 1)];
                const next = trail.points[Math.min(i + 1, trail.count - 1)];
                segment.copy(p).sub(next);
                if (segment.lengthSq() < 1e-6) segment.set(0, 0, 1);
                const sx = p.x - runtime.origin.x;
                const sy = p.y - runtime.origin.y;
                const sz = p.z - runtime.origin.z;
                toCamera.set(camera.position.x - sx, camera.position.y - sy, camera.position.z - sz);
                side.crossVectors(segment, toCamera).normalize();
                const fade = 1 - i / (TRAIL_POINTS - 1);
                const width = 0.16 + (1 - fade) * 0.55;
                side.multiplyScalar(width);
                positions.setXYZ(i * 2, sx + side.x, sy + side.y, sz + side.z);
                positions.setXYZ(i * 2 + 1, sx - side.x, sy - side.y, sz - side.z);
                const alpha = fade * fade * strength * (i < trail.count ? 1 : 0);
                alphas.setX(i * 2, alpha);
                alphas.setX(i * 2 + 1, alpha);
            }
            positions.needsUpdate = true;
            alphas.needsUpdate = true;
        });
    });

    return (
        <>
            {trails.map((trail, i) => (
                <mesh key={i} geometry={trail.geometry} material={material} frustumCulled={false} renderOrder={4} />
            ))}
        </>
    );
};

/**
 * Stars stretching into streaks around the ship while the pulse drive is on,
 * and faint dust flecks at high speed.
 */
const STREAKS = 420;

export const SpeedStreaks = ({ velocity, strength }: { velocity: () => THREE.Vector3; strength: () => number }) => {
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('shade', new THREE.BufferAttribute(new Float32Array(STREAKS * 2), 1).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        return g;
    }, []);
    const seeds = useMemo(() => Array.from({ length: STREAKS }, () => new THREE.Vector3(
        (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, Math.random(),
    )), []);
    const material = useMemo(() => new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_vertex>
            attribute float shade;
            varying float vShade;
            void main() {
                vShade = shade;
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mv;
                #include <logdepthbuf_vertex>
            }`,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            varying float vShade;
            void main() {
                #include <logdepthbuf_fragment>
                gl_FragColor = vec4(vec3(0.78, 0.84, 1.0) * vShade, 1.0);
            }`,
    }), []);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

    const dir = new THREE.Vector3();
    const basisX = new THREE.Vector3();
    const basisY = new THREE.Vector3();
    const phase = useRef(0);

    useFrame(({ camera }, delta) => {
        const s = strength();
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        const shades = geometry.getAttribute('shade') as THREE.BufferAttribute;
        if (s < 0.01) {
            shades.array.fill(0);
            shades.needsUpdate = true;
            return;
        }
        const v = velocity();
        dir.copy(v).normalize();
        if (dir.lengthSq() < 0.5) dir.set(0, 0, -1);
        basisX.set(0, 1, 0).cross(dir);
        if (basisX.lengthSq() < 1e-4) basisX.set(1, 0, 0);
        basisX.normalize();
        basisY.crossVectors(dir, basisX).normalize();
        phase.current = (phase.current + delta * (0.6 + s * 2.4)) % 1;
        const range = 260;
        for (let i = 0; i < STREAKS; i++) {
            const seed = seeds[i];
            const along = ((seed.z + phase.current) % 1) * range * 2 - range * 0.4;
            const radius = 18 + Math.abs(seed.x) * 90;
            const angle = seed.y * Math.PI;
            const ox = Math.cos(angle) * radius;
            const oy = Math.sin(angle) * radius;
            const length = 6 + s * 110;
            const cx = camera.position.x + basisX.x * ox + basisY.x * oy + dir.x * along;
            const cy = camera.position.y + basisX.y * ox + basisY.y * oy + dir.y * along;
            const cz = camera.position.z + basisX.z * ox + basisY.z * oy + dir.z * along;
            positions.setXYZ(i * 2, cx, cy, cz);
            positions.setXYZ(i * 2 + 1, cx - dir.x * length, cy - dir.y * length, cz - dir.z * length);
            const fadeIn = Math.min(1, (along + range * 0.4) / (range * 0.5));
            const shade = s * (0.35 + Math.abs(seed.x) * 0.65) * fadeIn;
            shades.setX(i * 2, shade);
            shades.setX(i * 2 + 1, 0);
        }
        positions.needsUpdate = true;
        shades.needsUpdate = true;
    });

    // (Streaks round the eye: nothing for the water to mirror.)
    return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={6} userData={{ noMirror: true }} />;
};
