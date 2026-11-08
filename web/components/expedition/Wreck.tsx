import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';

/**
 * The ship coming apart when its shield gives out: in vacuum there is no
 * rolling fireball, only a flash, a glowing cloud of gas that expands and
 * dims in a couple of seconds, a spray of sparks, and the wreckage, which
 * tumbles away and keeps going.
 */
export const glowTexture = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.18, 'rgba(255,236,190,0.9)');
        g.addColorStop(0.45, 'rgba(255,150,60,0.42)');
        g.addColorStop(1, 'rgba(255,80,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 128);
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    };
})();

const SPARKS = 180;
const PIECES = 26;
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const at = new THREE.Vector3();

export const Wreck = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const flashRef = useRef<THREE.Sprite>(null);
    const cloudRef = useRef<THREE.Sprite>(null);
    const sparksRef = useRef<THREE.Points>(null);
    const piecesRef = useRef<THREE.InstancedMesh>(null);
    const lightRef = useRef<THREE.PointLight>(null);
    const blast = useRef<{ time: number; center: THREE.Vector3; drift: THREE.Vector3 } | null>(null);
    // Ages are game seconds since the loss (ShipState.destroyed.age), so the blast plays in step with the game.
    const flashMaterial = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff4dc', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const cloudMaterial = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a4a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const sparks = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        return g;
    }, []);
    const sparkMaterial = useMemo(() => new THREE.PointsMaterial({ map: glowTexture(), color: '#ffc27a', size: 1.6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const pieceGeometry = useMemo(() => new THREE.TetrahedronGeometry(1, 0), []);
    const pieceMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.55, metalness: 0.6, flatShading: true }), []);
    // Every spark and piece flies its own way: a direction, a speed, a tumble.
    const motion = useMemo(() => ({
        sparks: Array.from({ length: SPARKS }, () => ({
            direction: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
            speed: 25 + Math.random() * 140,
        })),
        pieces: Array.from({ length: PIECES }, () => ({
            direction: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
            speed: 4 + Math.random() * 34,
            axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
            spin: (Math.random() - 0.5) * 6,
            size: 0.25 + Math.random() ** 2 * 1.6,
        })),
    }), []);
    useEffect(() => () => {
        flashMaterial.dispose();
        cloudMaterial.dispose();
        sparks.dispose();
        sparkMaterial.dispose();
        pieceGeometry.dispose();
        pieceMaterial.dispose();
    }, [flashMaterial, cloudMaterial, sparks, sparkMaterial, pieceGeometry, pieceMaterial]);

    useFrame(() => {
        const ship = runtime.hud.ship;
        const lost = ship?.destroyed ?? null;
        if (lost && (!blast.current || blast.current.time !== lost.time)) {
            blast.current = { time: lost.time, center: ship!.position.clone(), drift: ship!.velocity.clone() };
        }
        if (!lost) blast.current = null;
        const b = blast.current;
        const visible = !!b;
        for (const object of [flashRef.current, cloudRef.current, sparksRef.current, piecesRef.current]) if (object) object.visible = visible;
        if (lightRef.current) lightRef.current.visible = visible;
        if (!b) return;
        const age = lost!.age;
        // The whole cloud carries on the way the ship was going, slowing as the wreck does.
        const carried = (1 - Math.exp(-age * 0.5)) / 0.5;
        at.copy(b.center).addScaledVector(b.drift, carried).sub(runtime.origin);

        const flash = flashRef.current;
        if (flash) {
            flash.position.copy(at);
            flash.scale.setScalar(6 + 34 * Math.min(1, age / 0.2));
            flashMaterial.opacity = Math.max(0, 1 - age / 0.6);
        }
        const cloud = cloudRef.current;
        if (cloud) {
            cloud.position.copy(at);
            cloud.scale.setScalar(8 + 40 * (1 - Math.exp(-age * 1.2)));
            cloudMaterial.opacity = Math.max(0, 0.85 * Math.exp(-age * 0.9));
            cloudMaterial.color.setRGB(1, 0.62 * Math.exp(-age * 0.35), 0.3 * Math.exp(-age * 0.6));
        }
        const positions = sparks.getAttribute('position') as THREE.BufferAttribute;
        motion.sparks.forEach((spark, n) => {
            const travelled = spark.speed * (1 - Math.exp(-age * 0.8)) / 0.8;
            positions.setXYZ(n, at.x + spark.direction.x * travelled, at.y + spark.direction.y * travelled, at.z + spark.direction.z * travelled);
        });
        positions.needsUpdate = true;
        sparkMaterial.opacity = Math.max(0, 1 - age / 2.6);
        const pieces = piecesRef.current;
        if (pieces) {
            motion.pieces.forEach((piece, n) => {
                quaternion.setFromAxisAngle(piece.axis, age * piece.spin);
                scale.setScalar(piece.size);
                matrix.compose(at.clone().addScaledVector(piece.direction, piece.speed * age), quaternion, scale);
                pieces.setMatrixAt(n, matrix);
            });
            pieces.instanceMatrix.needsUpdate = true;
        }
        const light = lightRef.current;
        if (light) {
            light.position.copy(at);
            light.intensity = 4000 * Math.exp(-age * 2.2);
        }
    });

    return (
        <group>
            <sprite ref={flashRef} material={flashMaterial} visible={false} />
            <sprite ref={cloudRef} material={cloudMaterial} visible={false} />
            <points ref={sparksRef} geometry={sparks} material={sparkMaterial} visible={false} frustumCulled={false} />
            <instancedMesh ref={piecesRef} args={[pieceGeometry, pieceMaterial, PIECES]} visible={false} frustumCulled={false} />
            <pointLight ref={lightRef} color="#ffb070" distance={600} decay={1.4} intensity={0} visible={false} />
        </group>
    );
};
