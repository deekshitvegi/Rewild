import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';
import { FIRE } from './surfaceShading';

/**
 * The campfire the explorer makes with the fabricator: a ring of stones,
 * crossed logs, a flickering fire with embers rising off it, and a log to
 * sit on facing it. It lights its surroundings with a warm, unsteady glow:
 * through the shared surface shading for the ground, grass and trees (FIRE),
 * and through a point light for the explorer, the ship and the stones.
 */
const stone = new THREE.MeshStandardMaterial({ color: '#6d6a66', roughness: 0.92, metalness: 0.02 });
const bark = new THREE.MeshStandardMaterial({ color: '#7a5636', roughness: 0.9, metalness: 0 });
const charred = new THREE.MeshStandardMaterial({ color: '#1c1410', roughness: 1, metalness: 0, emissive: '#ff5a14', emissiveIntensity: 0.6 });

const flameTexture = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 96, 2, 32, 80, 60);
        g.addColorStop(0, 'rgba(255,250,220,1)');
        g.addColorStop(0.25, 'rgba(255,200,90,0.9)');
        g.addColorStop(0.55, 'rgba(255,110,30,0.55)');
        g.addColorStop(1, 'rgba(255,60,10,0)');
        ctx.fillStyle = g;
        // A tongue of flame: wide at the base, drawn to a point.
        ctx.beginPath();
        ctx.moveTo(32, 4);
        ctx.bezierCurveTo(52, 50, 62, 92, 32, 124);
        ctx.bezierCurveTo(2, 92, 12, 50, 32, 4);
        ctx.fill();
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    };
})();

const EMBERS = 40;
const yAxis = new THREE.Vector3(0, 1, 0);
const scratch = new THREE.Vector3();

export const Campfire = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const groupRef = useRef<THREE.Group>(null);
    const lightRef = useRef<THREE.PointLight>(null);
    const flames = useRef<THREE.Sprite[]>([]);
    const embersRef = useRef<THREE.Points>(null);
    const flameMaterial = useMemo(() => new THREE.SpriteMaterial({ map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const geometry = useMemo(() => ({
        stone: new THREE.DodecahedronGeometry(0.16, 0),
        log: new THREE.CylinderGeometry(0.07, 0.08, 0.95, 8),
        seat: new THREE.CylinderGeometry(0.2, 0.22, 1.7, 12),
    }), []);
    const embers = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EMBERS * 3), 3));
        return g;
    }, []);
    const emberMaterial = useMemo(() => new THREE.PointsMaterial({ color: '#ffb35a', size: 0.06, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const emberSeeds = useMemo(() => Array.from({ length: EMBERS }, () => ({ phase: Math.random(), speed: 0.5 + Math.random() * 0.7, swirl: Math.random() * Math.PI * 2, radius: 0.05 + Math.random() * 0.2 })), []);
    useEffect(() => () => {
        flameMaterial.dispose();
        Object.values(geometry).forEach((g) => g.dispose());
        embers.dispose();
        emberMaterial.dispose();
    }, [flameMaterial, geometry, embers, emberMaterial]);

    const stones = useMemo(() => Array.from({ length: 10 }, (_, n) => {
        const a = (n / 10) * Math.PI * 2;
        return { x: Math.cos(a) * 0.55, z: Math.sin(a) * 0.55, r: n * 1.7, s: 0.85 + ((n * 37) % 10) / 25 };
    }), []);

    useFrame(({ clock }) => {
        const group = groupRef.current;
        const camp = runtime.camp;
        const here = camp && runtime.currentBody === camp.body && camp.position.distanceTo(runtime.origin) < 900;
        if (!group) return;
        group.visible = !!here;
        if (!camp || !here) {
            FIRE.strength.value = 0;
            if (lightRef.current) lightRef.current.visible = false;
            return;
        }
        const t = clock.elapsedTime;
        group.position.copy(camp.position).sub(runtime.origin);
        group.quaternion.setFromUnitVectors(yAxis, camp.up);
        // Firelight that never holds still.
        const flicker = 0.82 + Math.sin(t * 9.1) * 0.07 + Math.sin(t * 23.7 + 1.3) * 0.05 + Math.sin(t * 4.3) * 0.06;
        FIRE.position.value.copy(camp.position).sub(camp.body.position).addScaledVector(camp.up, 0.5);
        FIRE.strength.value = flicker;
        const light = lightRef.current;
        if (light) {
            light.visible = true;
            light.intensity = 9 * flicker;
        }
        flames.current.forEach((sprite, n) => {
            const k = 0.85 + Math.sin(t * (7 + n * 2.3) + n) * 0.15;
            sprite.scale.set(0.5 * k + n * 0.04, 0.95 * k + (n % 2) * 0.25, 1);
            sprite.position.set(Math.sin(n * 2.1 + t * 1.3) * 0.07, 0.42 + (n % 2) * 0.08, Math.cos(n * 1.7 + t) * 0.07);
        });
        // Embers rise, drift and fade, then start again from the fire.
        const positions = embers.getAttribute('position') as THREE.BufferAttribute;
        emberSeeds.forEach((seed, n) => {
            const life = (t * seed.speed * 0.45 + seed.phase) % 1;
            const swirl = seed.swirl + life * 6;
            scratch.set(Math.cos(swirl) * seed.radius * (1 + life), 0.3 + life * 2.6, Math.sin(swirl) * seed.radius * (1 + life));
            positions.setXYZ(n, scratch.x, scratch.y, scratch.z);
        });
        positions.needsUpdate = true;
    });

    return (
        <group ref={groupRef} visible={false}>
            {stones.map((s, n) => (
                <mesh key={n} geometry={geometry.stone} material={stone} position={[s.x, 0.05, s.z]} rotation={[s.r, s.r * 0.7, 0]} scale={s.s} />
            ))}
            {[0, 1, 2, 3].map((n) => (
                <mesh key={n} geometry={geometry.log} material={n % 2 ? charred : bark} position={[0, 0.2, 0]} rotation={[0.95, (n / 4) * Math.PI * 2, 0]} />
            ))}
            {[0, 1, 2, 3].map((n) => (
                <sprite key={n} ref={(sprite) => { if (sprite) flames.current[n] = sprite; }} material={flameMaterial} />
            ))}
            <points ref={embersRef} geometry={embers} material={emberMaterial} frustumCulled={false} />
            <SeatLog runtime={runtime} geometry={geometry.seat} />
            <pointLight ref={lightRef} color="#ff9a4a" distance={16} decay={1.6} intensity={0} position={[0, 0.7, 0]} />
        </group>
    );
};

/** The log to sit on, across the seat's direction from the fire. */
const SeatLog = ({ runtime, geometry }: { runtime: ExpeditionRuntime; geometry: THREE.BufferGeometry }) => {
    const ref = useRef<THREE.Mesh>(null);
    useFrame(() => {
        const mesh = ref.current;
        const camp = runtime.camp;
        if (!mesh || !camp) return;
        // In the group's frame (its y is the camp's up): the seat direction, flattened.
        const inverse = new THREE.Quaternion().setFromUnitVectors(yAxis, camp.up).invert();
        const seat = camp.seat.clone().applyQuaternion(inverse);
        seat.y = 0;
        seat.normalize();
        mesh.position.set(seat.x * 1.25, 0.18, seat.z * 1.25);
        // Lying along the ground, square to the way the sitter faces.
        mesh.rotation.set(0, Math.atan2(seat.x, seat.z), Math.PI / 2);
    });
    return <mesh ref={ref} geometry={geometry} material={bark} />;
};
