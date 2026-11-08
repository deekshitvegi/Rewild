import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { say } from './argo';
import { universeDirection } from './motion';
import { modelEnvironment, useEnvironmentOn, useModel } from './models';
import { cue, type ExpeditionRuntime } from './runtime';
import { DEBRIS, debrisOffset } from './story';

/**
 * The dead satellite in low Earth orbit (story.ts DEBRIS): the torn dish, a
 * spent upper stage beside it, and a cloud of fragments going round with
 * them, once every hundred minutes. The fragments are solid: the shield takes
 * a hit from each one the ship runs into, harder the faster it is going
 * relative to them (matching their orbit makes them harmless).
 */
const SHOW = 40000;

const random = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

/** A torn scrap of metal: a squashed, jagged stone shape, lit flat. */
const fragmentGeometry = () => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const r = random(77);
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.6 + r() * 0.8), p.getY(i) * (0.15 + r() * 0.3), p.getZ(i) * (0.6 + r() * 0.8));
    g.computeVertexNormals();
    return g;
};

const offset = new THREE.Vector3();
const velocityU = new THREE.Vector3();
const centre = new THREE.Vector3();
const velocity = new THREE.Vector3();
const piece = new THREE.Vector3();
const away = new THREE.Vector3();
const relative = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const scale = new THREE.Vector3();
const axis = new THREE.Vector3();

export const OrbitDebris = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const earth = useMemo(() => findBody(DEBRIS.body) as ExpeditionBody, []);
    const dish = useModel('debrisDish');
    const stage = useModel('debrisStage');
    const gl = useThree((state) => state.gl);
    const groupRef = useRef<THREE.Group>(null);
    const dishRef = useRef<THREE.Group>(null);
    const stageRef = useRef<THREE.Group>(null);
    const piecesRef = useRef<THREE.InstancedMesh>(null);

    const fragments = useMemo(() => {
        const r = random(2009);
        return Array.from({ length: DEBRIS.fragments }, () => {
            // Spread along the orbit more than across it, as a debris cloud does.
            const along = (r() - 0.5) * 2 * DEBRIS.spread * 1.6;
            const across = (r() - 0.5) * 2 * DEBRIS.spread * 0.5;
            const up = (r() - 0.5) * 2 * DEBRIS.spread * 0.35;
            return {
                at: new THREE.Vector3(across, up, along),
                size: 0.4 + Math.pow(r(), 3) * 3.2,
                spin: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
                rate: 0.2 + r() * 1.6,
                phase: r() * 6.28,
            };
        });
    }, []);
    const pieces = useMemo(() => ({
        geometry: fragmentGeometry(),
        material: new THREE.MeshStandardMaterial({ color: '#a6a8ab', metalness: 0.7, roughness: 0.45, flatShading: true, envMap: modelEnvironment(gl), envMapIntensity: 0.6 }),
    }), [gl]);
    useEffect(() => () => { pieces.geometry.dispose(); pieces.material.dispose(); }, [pieces]);

    const dishRoot = useMemo(() => (dish ? fit(dish.scene, 12) : null), [dish]);
    const stageRoot = useMemo(() => (stage ? fit(stage.scene, 18) : null), [stage]);
    useEnvironmentOn(dishRoot, gl, 0.6);
    useEnvironmentOn(stageRoot, gl, 0.6);

    useFrame(({ clock }) => {
        const group = groupRef.current;
        if (!group) return;
        // Where the cloud is now: its orbit in the universe's frame, turned into the game's.
        debrisOffset(runtime.motion.seconds, offset, velocityU);
        universeDirection(runtime.motion, offset, centre).add(earth.position);
        universeDirection(runtime.motion, velocityU, velocity);
        const distance = centre.distanceTo(runtime.camera);
        group.visible = distance < SHOW;
        if (!group.visible) return;
        group.position.copy(centre).sub(runtime.origin);
        // The cloud's own frame: z along the orbit, y away from Earth.
        const forward = away.copy(velocity).normalize();
        const outward = piece.copy(centre).sub(earth.position).normalize();
        matrix.makeBasis(axis.crossVectors(outward, forward).normalize(), outward, forward);
        group.quaternion.setFromRotationMatrix(matrix);
        const t = clock.elapsedTime;
        if (dishRef.current) dishRef.current.rotation.set(t * 0.031, t * 0.047, t * 0.019);
        if (stageRef.current) stageRef.current.rotation.set(0.4 + t * 0.012, t * 0.021, 0.2);

        const mesh = piecesRef.current;
        if (mesh) {
            fragments.forEach((f, i) => {
                turn.setFromAxisAngle(f.spin, f.phase + t * f.rate);
                matrix.compose(f.at, turn, scale.setScalar(f.size));
                mesh.setMatrixAt(i, matrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
        }

        // Found: close enough to make it out.
        if (distance < 320 && !runtime.stats.visited.includes(DEBRIS.id)) {
            runtime.stats.visited.push(DEBRIS.id);
            cue(runtime, 'chapter', 0.8);
            runtime.scan.found = { label: DEBRIS.label, name: DEBRIS.name, blurb: DEBRIS.blurb };
            runtime.scan.foundAt = performance.now() / 1000;
            say(runtime.argo, DEBRIS.argo, 'warn');
        }

        // The fragments are solid: what the ship runs into, it feels.
        const ship = runtime.hud.ship;
        if (!ship || ship.destroyed || runtime.mode !== 'ship' || distance > DEBRIS.spread * 3) return;
        relative.copy(ship.velocity).sub(velocity);
        const solids = [...fragments.map((f) => ({ at: f.at, reach: f.size + 4.5 })), { at: zero, reach: 9 }, { at: STAGE_AT, reach: 10 }];
        for (const solid of solids) {
            piece.copy(solid.at).applyQuaternion(group.quaternion).add(centre);
            away.copy(ship.position).sub(piece);
            const gap = away.length();
            if (gap >= solid.reach || gap < 1e-6) continue;
            away.divideScalar(gap);
            ship.position.addScaledVector(away, solid.reach - gap);
            const into = relative.dot(away);
            if (into >= 0) continue;
            if (into < -25) {
                ship.shield = Math.max(0, ship.shield + into / 900);
                ship.hurtBy = 'debris';
                ship.jolt = Math.min(1, -into / 400);
                cue(runtime, 'impact', Math.min(1.3, -into / 300));
                ship.notice = ship.shield > 0 ? `DEBRIS IMPACT · SHIELD ${Math.round(ship.shield * 100)}%` : 'DEBRIS IMPACT';
                ship.noticeTime = performance.now() / 1000;
            }
            ship.velocity.addScaledVector(away, -into * 1.3);
        }
    });

    return (
        <group ref={groupRef} visible={false}>
            {dishRoot && <group ref={dishRef}><primitive object={dishRoot} /></group>}
            {stageRoot && <group ref={stageRef} position={STAGE_AT}><primitive object={stageRoot} /></group>}
            <instancedMesh ref={piecesRef} args={[pieces.geometry, pieces.material, DEBRIS.fragments]} frustumCulled={false} />
        </group>
    );
};

const zero = new THREE.Vector3();
/** The spent stage drifts a little way ahead of the dish. */
const STAGE_AT = new THREE.Vector3(26, 8, 60);

/** A model centred and scaled so its longest side is `size` metres. */
const fit = (scene: THREE.Object3D, size: number) => {
    const copy = scene.clone(true);
    copy.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(copy);
    const extent = box.getSize(new THREE.Vector3());
    const middle = box.getCenter(new THREE.Vector3());
    copy.position.copy(middle).multiplyScalar(-1);
    const holder = new THREE.Group();
    holder.add(copy);
    holder.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z, 1e-6));
    return holder;
};
