import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { cue, type ExpeditionRuntime } from './runtime';
import { DERELICT, pulse } from './radio';
import { glowTexture } from './Wreck';
import { modelEnvironment } from './models';

/**
 * The survey ship Kepler, whose automatic beacon still calls on 406 MHz from
 * the asteroid belt (radio.ts): a long-haul ship laid out like NASA's design
 * studies for crewed Mars missions, a truss spine with the crew module at one
 * end and the reactor and engine at the other, a ring that spun for gravity,
 * solar wings and a dish. A rock went through the ring. It tumbles slowly,
 * its beacon still blinking; coming alongside salvages what is left of its
 * stores and its last log.
 */
const SHOW_WITHIN = 150_000;
const SALVAGE_WITHIN = 360;
const SALVAGE = 25;

export const Derelict = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [near, setNear] = useState(false);
    const nearRef = useRef(false);
    useFrame(() => {
        const now = runtime.camera.distanceTo(DERELICT) < SHOW_WITHIN;
        if (now !== nearRef.current) {
            nearRef.current = now;
            setNear(now);
        }
    });
    return near ? <Hulk runtime={runtime} /> : null;
};

const DEBRIS = 70;
const BRACES = 31;
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const scale = new THREE.Vector3();
const at = new THREE.Vector3();
const TUMBLE_AXIS = new THREE.Vector3(0.3, 1, 0.15).normalize();

/** Solar cells: dark blue squares in a silver grid. */
const cellTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#9aa3ad';
    ctx.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
            ctx.fillStyle = (x + y) % 3 ? '#14203a' : '#1a2848';
            ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 2);
    texture.anisotropy = 4;
    return texture;
};

const Hulk = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const beaconRef = useRef<THREE.Sprite>(null);
    const sparkRef = useRef<THREE.Sprite>(null);
    const bracesRef = useRef<THREE.InstancedMesh>(null);
    const debrisRef = useRef<THREE.InstancedMesh>(null);

    const parts = useMemo(() => {
        const env = modelEnvironment(gl);
        const standard = (color: string, metalness: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
            new THREE.MeshStandardMaterial({ color, metalness, roughness, envMap: env, envMapIntensity: 0.5, ...extra });
        const cells = cellTexture();
        return {
            materials: {
                hull: standard('#d9d5ca', 0.25, 0.55),
                metal: standard('#7f858e', 0.85, 0.38),
                foil: standard('#c9993c', 1, 0.32),
                panel: standard('#ffffff', 0.35, 0.3, { map: cells }),
                scorch: standard('#3a332c', 0.2, 0.9),
            },
            cells,
            geometries: {
                rail: new THREE.BoxGeometry(0.5, 0.5, 124),
                brace: new THREE.BoxGeometry(0.28, 0.28, 3.9),
                crew: new THREE.CylinderGeometry(4, 4, 16, 28).rotateX(Math.PI / 2),
                nose: new THREE.CylinderGeometry(1.6, 4, 6, 28).rotateX(Math.PI / 2),
                hub: new THREE.CylinderGeometry(5, 5, 6, 28).rotateX(Math.PI / 2),
                // The ring, with a fifth of it gone where the rock went through.
                ring: new THREE.TorusGeometry(24, 2.8, 14, 72, Math.PI * 2 * 0.8),
                spoke: new THREE.CylinderGeometry(0.8, 0.8, 1, 10),
                tank: new THREE.SphereGeometry(4.6, 24, 16),
                reactor: new THREE.CylinderGeometry(3.6, 3.6, 9, 24).rotateX(Math.PI / 2),
                bell: new THREE.CylinderGeometry(2.2, 6.5, 10, 28, 1, true).rotateX(Math.PI / 2),
                panel: new THREE.BoxGeometry(16, 0.25, 8),
                boom: new THREE.CylinderGeometry(0.3, 0.3, 8, 8),
                dish: new THREE.SphereGeometry(6, 28, 10, 0, Math.PI * 2, 0, 0.62),
                piece: new THREE.BoxGeometry(1, 0.25, 0.7),
            },
            beacon: new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(3, 0.25, 0.15), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: false }),
            spark: new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(2.2, 1.1, 0.4), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
        };
    }, [gl]);
    useEffect(() => () => {
        Object.values(parts.materials).forEach((m) => m.dispose());
        Object.values(parts.geometries).forEach((g) => g.dispose());
        parts.cells.dispose();
        parts.beacon.dispose();
        parts.spark.dispose();
    }, [parts]);

    // Where the ring is broken: its open end sits at 0.8 of a turn.
    const gapAngle = Math.PI * 2 * 0.9;
    const gap = useMemo(() => new THREE.Vector3(Math.cos(gapAngle) * 24, Math.sin(gapAngle) * 24, -40), [gapAngle]);
    const debris = useMemo(() => {
        let s = 4127;
        const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        return Array.from({ length: DEBRIS }, () => ({
            offset: new THREE.Vector3((r() - 0.5) * 70, (r() - 0.5) * 70, (r() - 0.5) * 50),
            drift: new THREE.Vector3((r() - 0.5) * 0.6, (r() - 0.5) * 0.6, (r() - 0.5) * 0.6),
            spin: new THREE.Vector3(r() * 0.6, r() * 0.6, r() * 0.6),
            size: 0.4 + r() * r() * 3.2,
        }));
    }, []);

    useEffect(() => {
        const braces = bracesRef.current;
        if (!braces) return;
        // Diagonal bracing on the top and bottom faces of the spine.
        for (let i = 0; i < BRACES; i++) {
            for (let face = 0; face < 2; face++) {
                const z = -60 + i * 4;
                quaternion.setFromEuler(euler.set(0, (i % 2 ? 1 : -1) * 0.79, 0));
                matrix.compose(at.set(0, face ? 1.4 : -1.4, z), quaternion, scale.set(1, 1, 1));
                braces.setMatrixAt(i * 2 + face, matrix);
            }
        }
        braces.instanceMatrix.needsUpdate = true;
    }, []);

    const salvaged = useRef(runtime.stats.visited.includes('kepler'));
    useFrame(({ clock }) => {
        const group = groupRef.current;
        if (!group) return;
        const t = clock.elapsedTime;
        group.position.copy(DERELICT).sub(runtime.origin);
        group.quaternion.setFromAxisAngle(TUMBLE_AXIS, t * 0.012 + 1.1);
        // The beacon, in time with what the radio hears.
        const beacon = beaconRef.current;
        if (beacon) {
            const on = pulse('beacon', performance.now() / 1000);
            beacon.material.opacity = 0.15 + on * 0.85;
            const size = 0.012 + on * 0.016;
            beacon.scale.set(size, size, 1);
        }
        // Severed wiring sparks at the break now and then.
        const spark = sparkRef.current;
        if (spark) {
            const flicker = Math.max(0, Math.sin(t * 13.7) * Math.sin(t * 3.1 + 1) - 0.55) * 2.2;
            spark.material.opacity = flicker;
            spark.scale.setScalar(3 + flicker * 4);
        }
        const pieces = debrisRef.current;
        if (pieces) {
            debris.forEach((d, i) => {
                at.copy(gap).add(d.offset).addScaledVector(d.drift, Math.sin(t * 0.05 + i) * 18);
                quaternion.setFromEuler(euler.set(d.spin.x * t, d.spin.y * t, d.spin.z * t));
                matrix.compose(at, quaternion, scale.setScalar(d.size));
                pieces.setMatrixAt(i, matrix);
            });
            pieces.instanceMatrix.needsUpdate = true;
        }
        // Coming alongside: salvage, once.
        const ship = runtime.hud.ship;
        if (!salvaged.current && ship && runtime.mode === 'ship' && !ship.destroyed && ship.position.distanceTo(DERELICT) < SALVAGE_WITHIN) {
            salvaged.current = true;
            if (!runtime.stats.visited.includes('kepler')) runtime.stats.visited.push('kepler');
            runtime.inventory.crystals += SALVAGE;
            cue(runtime, 'chapter', 0.9);
            ship.notice = `SALVAGED THE KEPLER · +${SALVAGE} CRYSTALS`;
            ship.noticeTime = performance.now() / 1000;
            runtime.scan.found = {
                label: `Salvage · +${SALVAGE} crystals`,
                name: 'Survey ship Kepler',
                blurb: 'Its last log, day 412: "A rock through the ring. Crew to the lander, making for Ceres. The beacon stays on. If you hear this, we made it, or we did not."',
            };
            runtime.scan.foundAt = performance.now() / 1000;
        }
    });

    const { materials: m, geometries: g } = parts;
    const spokes = [0.15, 0.4, 0.65].map((turn) => turn * Math.PI * 2);
    return (
        <group ref={groupRef}>
            {[[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]].map(([x, y], i) => (
                <mesh key={i} geometry={g.rail} material={m.metal} position={[x, y, 0]} />
            ))}
            <instancedMesh ref={bracesRef} args={[g.brace, m.metal, BRACES * 2]} />
            {/* Crew module, wrapped in gold foil, and its nose. */}
            <mesh geometry={g.crew} material={m.foil} position={[0, 0, -66]} />
            <mesh geometry={g.nose} material={m.hull} position={[0, 0, -77]} />
            <sprite ref={beaconRef} material={parts.beacon} position={[0, 4.6, -66]} />
            {/* The dish, on a boom off the crew module. */}
            <mesh geometry={g.boom} material={m.metal} position={[0, 7.5, -60]} />
            <mesh geometry={g.dish} material={m.hull} position={[0, 11.5, -60]} rotation={[-0.9, 0, 0]} />
            {/* The ring that spun for gravity, its hub and spokes; one spoke snapped short. */}
            <mesh geometry={g.hub} material={m.hull} position={[0, 0, -40]} />
            <mesh geometry={g.ring} material={m.hull} position={[0, 0, -40]} />
            {spokes.map((angle, i) => (
                <mesh key={i} geometry={g.spoke} material={m.metal} position={[Math.cos(angle) * 14.5, Math.sin(angle) * 14.5, -40]} rotation={[0, 0, angle - Math.PI / 2]} scale={[1, 19, 1]} />
            ))}
            <mesh geometry={g.spoke} material={m.scorch} position={[Math.cos(gapAngle) * 9, Math.sin(gapAngle) * 9, -40]} rotation={[0, 0, gapAngle - Math.PI / 2]} scale={[1, 8, 1]} />
            <sprite ref={sparkRef} material={parts.spark} position={[Math.cos(gapAngle) * 13, Math.sin(gapAngle) * 13, -40]} />
            {/* Solar wings: one bent back at its root and short a panel. */}
            {[0, 1, 2].map((k) => (
                <mesh key={`r${k}`} geometry={g.panel} material={m.panel} position={[14 + k * 17, 0, 8]} />
            ))}
            <group position={[-5, 0, 8]} rotation={[0.35, 0, -0.55]}>
                {[0, 1].map((k) => (
                    <mesh key={`l${k}`} geometry={g.panel} material={m.panel} position={[-9 - k * 17, 0, 0]} rotation={[k * 0.2, 0, 0]} />
                ))}
            </group>
            {/* Propellant tanks, the reactor and the engine bell. */}
            {[[6.5, 6.5], [-6.5, 6.5], [6.5, -6.5], [-6.5, -6.5]].map(([x, y], i) => (
                <mesh key={`t${i}`} geometry={g.tank} material={i === 3 ? m.scorch : m.foil} position={[x, y, 28]} />
            ))}
            <mesh geometry={g.reactor} material={m.hull} position={[0, 0, 54]} />
            <mesh geometry={g.bell} material={m.metal} position={[0, 0, 64]} />
            {/* What the rock knocked loose, still drifting with the ship. */}
            <instancedMesh ref={debrisRef} args={[g.piece, m.hull, DEBRIS]} frustumCulled={false} />
        </group>
    );
};
