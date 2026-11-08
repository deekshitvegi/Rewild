import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MOTHERSHIP, mothershipPose } from './mothership';
import { modelEnvironment, useEnvironmentOn, useModel } from './models';
import type { ExpeditionRuntime } from './runtime';

/**
 * The Argo drawn where she is (mothership.ts): the sculpted model (models/expedition/argo.glb)
 * once it has loaded, a built one until then. Forward -Z, her hub and docking bay at the front,
 * inside the habitat ring; the engines at the back. A light on the bay blinks so the way in can
 * be found, green when the fighter is close and slow enough to dock.
 */
const SEEN = 400000;

const hull = new THREE.MeshStandardMaterial({ color: '#d6d8da', metalness: 0.3, roughness: 0.5 });
const panel = new THREE.MeshStandardMaterial({ color: '#9ca1a7', metalness: 0.45, roughness: 0.5 });
const dark = new THREE.MeshStandardMaterial({ color: '#3a3f45', metalness: 0.55, roughness: 0.45 });
const accent = new THREE.MeshStandardMaterial({ color: '#b3262c', metalness: 0.3, roughness: 0.45 });
const solar = new THREE.MeshStandardMaterial({ color: '#1b2740', metalness: 0.7, roughness: 0.3 });
const engineGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 3.2, 4.4), toneMapped: false });
const bayLight = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 0.8), toneMapped: false });

/** The ring's middle, in her frame. */
const RING_Z = -142;
const RING_RADIUS = 58;
const ENGINES: [number, number][] = [[-11, -11], [11, -11], [-11, 11], [11, 11]];
const ENGINE_Z = 152;

/** Fit the sculpted model: it comes with its ring and docking collar at +Z, so turn it to face -Z. */
const MODEL_TURN = new THREE.Euler(0, Math.PI, 0);

const Built = ({ ringRef }: { ringRef: React.RefObject<THREE.Group> }) => {
    const g = useMemo(() => ({
        spine: new THREE.BoxGeometry(12, 12, 230),
        pod: new THREE.BoxGeometry(18, 14, 34),
        module: new THREE.BoxGeometry(24, 18, 16),
        tube: new THREE.CylinderGeometry(2.2, 2.2, 1, 10),
        spoke: new THREE.CylinderGeometry(1.4, 1.4, RING_RADIUS - 10, 8),
        hub: new THREE.CylinderGeometry(10, 12, 36, 24).rotateX(Math.PI / 2),
        collar: new THREE.TorusGeometry(6.5, 1.4, 10, 28),
        engine: new THREE.CylinderGeometry(6, 8.5, 26, 20).rotateX(Math.PI / 2),
        bell: new THREE.CylinderGeometry(8.5, 10.5, 10, 20, 1, true).rotateX(Math.PI / 2),
        disc: new THREE.CircleGeometry(8, 20),
        array: new THREE.BoxGeometry(46, 0.6, 18),
        stripe: new THREE.BoxGeometry(12.4, 0.8, 120),
    }), []);
    useEffect(() => () => Object.values(g).forEach((geometry) => geometry.dispose()), [g]);
    const ringModules = useMemo(() => Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2), []);
    return (
        <group>
            <mesh geometry={g.spine} material={hull} position={[0, 0, 40]} />
            <mesh geometry={g.stripe} material={accent} position={[0, 6.2, 40]} />
            {[-1, 1].map((side) => [10, 52, 94].map((z) => (
                <mesh key={`${side}-${z}`} geometry={g.pod} material={z === 52 ? panel : hull} position={[side * 15, 0, z]} />
            )))}
            {[-1, 1].map((side) => (
                <mesh key={`array-${side}`} geometry={g.array} material={solar} position={[side * 48, 0, 70]} />
            ))}
            <mesh geometry={g.hub} material={hull} position={[0, 0, RING_Z]} />
            <mesh geometry={g.collar} material={dark} position={[0, 0, RING_Z - 18]} />
            <mesh geometry={g.spine} material={hull} position={[0, 0, -20]} scale={[0.6, 0.6, 0.6]} />
            {ENGINES.map(([x, y]) => (
                <group key={`${x}-${y}`} position={[x, y, ENGINE_Z]}>
                    <mesh geometry={g.engine} material={panel} />
                    <mesh geometry={g.bell} material={dark} position={[0, 0, 16]} />
                    <mesh geometry={g.disc} material={engineGlow} position={[0, 0, 13]} />
                </group>
            ))}
            <group ref={ringRef} position={[0, 0, RING_Z]}>
                {ringModules.map((a) => (
                    <group key={a} rotation={[0, 0, a]}>
                        <mesh geometry={g.module} material={hull} position={[0, RING_RADIUS, 0]} />
                        <mesh geometry={g.tube} material={panel} position={[RING_RADIUS * Math.sin(Math.PI / 12), RING_RADIUS * Math.cos(Math.PI / 12), 0]} rotation={[0, 0, -Math.PI / 2 - Math.PI / 12]} scale={[1, 9, 1]} />
                    </group>
                ))}
                {[0, 1, 2, 3].map((i) => (
                    <mesh key={i} geometry={g.spoke} material={panel} rotation={[0, 0, (i * Math.PI) / 2]} position={[-Math.sin((i * Math.PI) / 2) * (RING_RADIUS / 2 + 5), Math.cos((i * Math.PI) / 2) * (RING_RADIUS / 2 + 5), 0]} />
                ))}
            </group>
        </group>
    );
};

const pose = new THREE.Vector3();
const turn = new THREE.Quaternion();
export const MothershipView = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const ringRef = useRef<THREE.Group>(null);
    const lightRef = useRef<THREE.Mesh>(null);
    const model = useModel('mothership');
    const sculpted = useMemo(() => {
        if (!model) return null;
        const root = model.scene.clone(true);
        root.rotation.copy(MODEL_TURN);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = MOTHERSHIP.length / Math.max(size.z, 1e-6);
        const holder = new THREE.Group();
        root.position.sub(centre);
        holder.add(root);
        holder.scale.setScalar(scale);
        return holder;
    }, [model]);
    useEnvironmentOn(sculpted, gl, 0.45);
    useEffect(() => {
        const env = modelEnvironment(gl);
        [hull, panel, dark, accent, solar].forEach((m) => {
            m.envMap = env;
            m.envMapIntensity = 0.45;
            m.needsUpdate = true;
        });
    }, [gl]);

    useFrame(({ clock }, delta) => {
        const group = groupRef.current;
        const mothership = runtime.mothership;
        const live = runtime.player?.ship;
        if (!group || !mothership || !live || !mothership.placed) {
            if (group) group.visible = false;
            return;
        }
        mothershipPose(mothership, live, runtime.motion, pose, turn);
        const seen = pose.distanceTo(runtime.camera) < SEEN;
        group.visible = seen;
        if (!seen) return;
        group.position.copy(pose).sub(runtime.origin);
        group.quaternion.copy(turn);
        // The habitat ring turns slowly for its gravity (the built one; the sculpted one is one piece).
        if (ringRef.current) ringRef.current.rotation.z += Math.min(delta, 0.1) * 0.12;
        const light = lightRef.current;
        if (light) {
            const near = !mothership.docked && live.position.distanceTo(pose) < MOTHERSHIP.length * 1.5;
            light.visible = !mothership.docked && (Math.sin(clock.elapsedTime * 4) > -0.2 || near);
            const ready = near && live.velocity.length() < MOTHERSHIP.closing;
            (light.material as THREE.MeshBasicMaterial).color.setRGB(ready ? 0.6 : 3, ready ? 3.2 : 2.2, ready ? 1 : 0.8);
        }
    });

    return (
        <group ref={groupRef} visible={false}>
            {sculpted ? <primitive object={sculpted} /> : <Built ringRef={ringRef} />}
            <mesh ref={lightRef} position={[MOTHERSHIP.bay.x, MOTHERSHIP.bay.y + 9, MOTHERSHIP.bay.z]} material={bayLight}>
                <sphereGeometry args={[1.6, 12, 8]} />
            </mesh>
        </group>
    );
};
