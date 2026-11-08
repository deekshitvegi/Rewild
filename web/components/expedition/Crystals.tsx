import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { BiomeKind } from './bodies';
import { groundHeight, waterDepth } from './environment';
import { cellKey, cellPoint, cellRandom, cellsNear } from './scatter';
import type { CrystalCluster, ExpeditionRuntime } from './runtime';

/**
 * Glowing crystal clusters scattered over the ground near the explorer, as in
 * the reference video. Mining one (hold the primary button while aiming at it)
 * breaks it into sparks and adds to the crystal count.
 */
const DENSITY: Record<BiomeKind, number> = {
    verdant: 0.05, desert: 0.07, cratered: 0.2, canyon: 0.09, frozen: 0.09, glacier: 0.12, volcanic: 0.1, methane: 0.08,
};
const MAX_SHARDS = 900;
const REACH = 240;

const makeShardGeometry = () => {
    const profile = [[0, 0], [0.17, 0.04], [0.21, 0.68], [0.1, 0.92], [0, 1]].map(([x, y]) => new THREE.Vector2(x, y));
    const geometry = new THREE.LatheGeometry(profile, 6);
    geometry.computeVertexNormals();
    return geometry;
};

const up = new THREE.Vector3();
const dir = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const shardUp = new THREE.Vector3();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const yAxis = new THREE.Vector3(0, 1, 0);

export const SurfaceCrystals = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const groupRef = useRef<THREE.Group>(null);
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const glowRef = useRef<THREE.InstancedMesh>(null);
    const anchor = useRef(new THREE.Vector3());
    const built = useRef({ key: '', version: -1 });

    const geometry = useMemo(makeShardGeometry, []);
    const glowGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
    const material = useMemo(() => new THREE.MeshStandardMaterial({
        color: '#1d6a88', emissive: '#48d6ff', emissiveIntensity: 2.6, roughness: 0.18, metalness: 0.1, flatShading: true,
    }), []);
    const glowMaterial = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        const texture = new THREE.CanvasTexture(canvas);
        return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#48d6ff' });
    }, []);
    useEffect(() => () => { geometry.dispose(); glowGeometry.dispose(); material.dispose(); glowMaterial.map?.dispose(); glowMaterial.dispose(); }, [geometry, glowGeometry, material, glowMaterial]);

    useFrame(({ camera }) => {
        const body = runtime.currentBody;
        const mesh = meshRef.current;
        const glow = glowRef.current;
        const group = groupRef.current;
        if (!mesh || !glow || !group) return;
        const nearGround = body && body.kind === 'rocky' && body.biome && runtime.altitude < 700;
        if (!nearGround || !body?.biome) {
            mesh.count = 0;
            glow.count = 0;
            runtime.surface.crystals = [];
            built.current.key = '';
            return;
        }

        const player = runtime.origin;
        const distance = player.distanceTo(body.position);
        up.copy(player).sub(body.position).divideScalar(distance);
        const depth = Math.max(6, Math.round(Math.log2((2 * 0.785 * body.radius) / 30)));
        const cellSize = 2 / 2 ** depth;
        const key = `${body.id}:${Math.floor(up.x / cellSize * 0.8)}:${Math.floor(up.y / cellSize * 0.8)}:${Math.floor(up.z / cellSize * 0.8)}`;

        if (key !== built.current.key || runtime.surface.version !== built.current.version) {
            built.current.key = key;
            built.current.version = runtime.surface.version;
            anchor.current.copy(player);
            const color = new THREE.Color(body.biome.crystal);
            material.emissive.copy(color);
            material.color.copy(color).multiplyScalar(0.35);
            glowMaterial.color.copy(color);

            const clusters: CrystalCluster[] = [];
            let shards = 0;
            const density = DENSITY[body.biome.kind];
            for (const cell of cellsNear(up, body.radius, depth, REACH)) {
                if (cellRandom(cell, body.biome.seed, 1) >= density) continue;
                const id = `${body.id}:${cellKey(cell)}`;
                if (runtime.surface.mined.has(id)) continue;
                cellPoint(cell, 0.15 + cellRandom(cell, body.biome.seed, 2) * 0.7, 0.15 + cellRandom(cell, body.biome.seed, 3) * 0.7, dir);
                if (waterDepth(body, dir) > 0) continue;
                const h = groundHeight(body, dir);
                const center = body.position.clone().addScaledVector(dir, body.radius + h);
                if (center.distanceTo(player) > REACH * 1.4) continue;
                clusters.push({ id, position: center, health: 1 });
                tangent.set(0, 1, 0).cross(dir);
                if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
                tangent.normalize();
                bitangent.crossVectors(dir, tangent);
                const count = 3 + Math.floor(cellRandom(cell, body.biome.seed, 4) * 4);
                for (let k = 0; k < count && shards < MAX_SHARDS; k++) {
                    const a = cellRandom(cell, body.biome.seed, 10 + k) * Math.PI * 2;
                    const r = k === 0 ? 0 : 0.25 + cellRandom(cell, body.biome.seed, 20 + k) * 0.55;
                    const height = (k === 0 ? 1.6 : 0.7) + cellRandom(cell, body.biome.seed, 30 + k) * 0.9;
                    position.copy(center)
                        .addScaledVector(tangent, Math.cos(a) * r)
                        .addScaledVector(bitangent, Math.sin(a) * r)
                        .addScaledVector(dir, -0.12)
                        .sub(anchor.current);
                    const tilt = k === 0 ? 0.08 : 0.25 + cellRandom(cell, body.biome.seed, 40 + k) * 0.35;
                    shardUp.copy(dir).addScaledVector(tangent, Math.cos(a) * tilt).addScaledVector(bitangent, Math.sin(a) * tilt).normalize();
                    quaternion.setFromUnitVectors(yAxis, shardUp);
                    scale.set(1, height, 1).multiplyScalar(0.9 + (k === 0 ? 0.3 : 0));
                    matrix.compose(position, quaternion, scale);
                    mesh.setMatrixAt(shards, matrix);
                    shards++;
                }
            }
            mesh.count = shards;
            mesh.instanceMatrix.needsUpdate = true;
            runtime.surface.crystals = clusters;
            glow.count = clusters.length;
        }

        group.position.copy(anchor.current).sub(runtime.origin);
        // Glows face the camera.
        runtime.surface.crystals.forEach((cluster, n) => {
            position.copy(cluster.position).sub(anchor.current).addScaledVector(dir.copy(cluster.position).sub(body.position).normalize(), 0.9);
            quaternion.copy(camera.quaternion);
            const s = 2.3 * cluster.health + 0.3;
            scale.set(s, s, s);
            matrix.compose(position, quaternion, scale);
            glow.setMatrixAt(n, matrix);
        });
        glow.count = runtime.surface.crystals.length;
        glow.instanceMatrix.needsUpdate = true;
    }, -1);

    return (
        <group ref={groupRef}>
            <instancedMesh ref={meshRef} args={[geometry, material, MAX_SHARDS]} frustumCulled={false} />
            <instancedMesh ref={glowRef} args={[glowGeometry, glowMaterial, 400]} frustumCulled={false} renderOrder={3} />
        </group>
    );
};

/** The mining beam, and sparks from broken crystals. */
const SPARKS = 48;
export const MiningEffects = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const beamRef = useRef<THREE.Mesh>(null);
    const sparksRef = useRef<THREE.Points>(null);
    const beamGeometry = useMemo(() => new THREE.CylinderGeometry(0.035, 0.07, 1, 8, 1, true).translate(0, 0.5, 0), []);
    const beamMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.9, 2.4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
    const sparkGeometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 8 * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        return g;
    }, []);
    const sparkMaterial = useMemo(() => new THREE.PointsMaterial({ color: '#9fefff', size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
    const directions = useMemo(() => Array.from({ length: SPARKS }, () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 6)), []);
    useEffect(() => () => { beamGeometry.dispose(); beamMaterial.dispose(); sparkGeometry.dispose(); sparkMaterial.dispose(); }, [beamGeometry, beamMaterial, sparkGeometry, sparkMaterial]);

    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const along = new THREE.Vector3();
    const localUp = new THREE.Vector3();
    const q = new THREE.Quaternion();

    useFrame(({ clock }) => {
        const beam = beamRef.current;
        if (beam) {
            const b = runtime.surface.beam;
            beam.visible = !!b;
            if (b) {
                from.copy(b.from).sub(runtime.origin);
                to.copy(b.to).sub(runtime.origin);
                along.copy(to).sub(from);
                const length = along.length();
                beam.position.copy(from);
                q.setFromUnitVectors(yAxis, along.divideScalar(length));
                beam.quaternion.copy(q);
                beam.scale.set(1 + Math.sin(clock.elapsedTime * 60) * 0.25, length, 1);
            }
        }
        const sparks = sparksRef.current;
        if (sparks) {
            const now = performance.now() / 1000;
            runtime.surface.bursts = runtime.surface.bursts.filter((burst) => now - burst.start < 1.1);
            const positions = sparkGeometry.getAttribute('position') as THREE.BufferAttribute;
            let n = 0;
            for (const burst of runtime.surface.bursts.slice(-8)) {
                const t = now - burst.start;
                localUp.copy(burst.position).sub(runtime.currentBody?.position ?? burst.position).normalize();
                const rise = 3.2 * t - 4.5 * t * t;
                for (let i = 0; i < SPARKS; i++) {
                    const d = directions[i];
                    positions.setXYZ(n++,
                        burst.position.x - runtime.origin.x + d.x * t * 0.8 + localUp.x * rise,
                        burst.position.y - runtime.origin.y + d.y * t * 0.8 + localUp.y * rise,
                        burst.position.z - runtime.origin.z + d.z * t * 0.8 + localUp.z * rise,
                    );
                }
            }
            sparkGeometry.setDrawRange(0, n);
            positions.needsUpdate = true;
            sparkMaterial.opacity = runtime.surface.bursts.length ? 1 : 0;
        }
    });

    return (
        <>
            <mesh ref={beamRef} geometry={beamGeometry} material={beamMaterial} visible={false} frustumCulled={false} renderOrder={6} />
            <points ref={sparksRef} geometry={sparkGeometry} material={sparkMaterial} frustumCulled={false} renderOrder={6} />
        </>
    );
};
