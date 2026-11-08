import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cue, type ExpeditionRuntime } from './runtime';
import { groundHeight, waterDepth } from './environment';

/**
 * What fishing looks like: the line from the explorer's tool to a float on
 * the water, slack while waiting and taut while reeling, the float dipping at
 * a bite; and now and then, in water near the explorer, a fish leaping out
 * and back with a splash, which is how you know there are fish to catch.
 */
const SEGMENTS = 24;
const up = new THREE.Vector3();
const tip = new THREE.Vector3();
const at = new THREE.Vector3();
const across = new THREE.Vector3();
const scratch = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();

/** A small fish: a body pulled to a point at each end, and a forked tail. */
const fishGeometry = () => {
    const bodyShape = new THREE.SphereGeometry(1, 12, 8);
    bodyShape.scale(0.12, 0.1, 0.42);
    const tail = new THREE.ConeGeometry(0.11, 0.2, 4);
    tail.rotateX(-Math.PI / 2);
    tail.scale(1, 0.25, 1);
    tail.translate(0, 0, -0.5);
    const merged = new THREE.BufferGeometry();
    const parts = [bodyShape.toNonIndexed(), tail.toNonIndexed()];
    const count = parts.reduce((sum, g) => sum + g.getAttribute('position').count, 0);
    const position = new Float32Array(count * 3);
    let offset = 0;
    for (const g of parts) {
        const p = g.getAttribute('position').array as Float32Array;
        position.set(p, offset);
        offset += p.length;
        g.dispose();
    }
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.computeVertexNormals();
    bodyShape.dispose();
    tail.dispose();
    return merged;
};

export const Fishing = ({ runtime, tipOf }: { runtime: ExpeditionRuntime; tipOf: () => THREE.Object3D | null }) => {
    const lineRef = useRef<THREE.Line>(null);
    const floatRef = useRef<THREE.Mesh>(null);
    const fishRef = useRef<THREE.Mesh>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const line = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, []);
    const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: '#e8eef2', transparent: true, opacity: 0.75 }), []);
    const lineObject = useMemo(() => new THREE.Line(line, lineMaterial), [line, lineMaterial]);
    const floatGeometry = useMemo(() => new THREE.SphereGeometry(0.09, 10, 8), []);
    const floatMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff5a2a', roughness: 0.5, emissive: '#5a1000', emissiveIntensity: 0.4 }), []);
    const fish = useMemo(() => fishGeometry(), []);
    const fishMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a9aa0', roughness: 0.35, metalness: 0.55 }), []);
    const ringGeometry = useMemo(() => new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), []);
    const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }), []);
    useEffect(() => () => {
        line.dispose();
        lineMaterial.dispose();
        floatGeometry.dispose();
        floatMaterial.dispose();
        fish.dispose();
        fishMaterial.dispose();
        ringGeometry.dispose();
        ringMaterial.dispose();
    }, [line, lineMaterial, floatGeometry, floatMaterial, fish, fishMaterial, ringGeometry, ringMaterial]);

    // Water near the explorer, and the leap under way.
    const water = useRef<THREE.Vector3[]>([]);
    const lastProbe = useRef(-99);
    const leap = useRef<{ at: THREE.Vector3; heading: THREE.Vector3; start: number; height: number; back: boolean } | null>(null);
    const nextLeap = useRef(4);

    useFrame(({ clock }) => {
        const t = clock.elapsedTime;
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const state = runtime.fishing;
        const lineMesh = lineRef.current;
        const floatMesh = floatRef.current;
        // ---- The line and the float ----
        if (lineMesh && floatMesh) {
            const show = !!walker && !!state && state.phase !== 'done';
            lineMesh.visible = show;
            floatMesh.visible = show;
            if (show && walker && state) {
                const body = walker.body;
                const toolTip = tipOf();
                if (toolTip) toolTip.getWorldPosition(tip).add(runtime.origin);
                else tip.copy(walker.position).addScaledVector(up.copy(walker.position).sub(body.position).normalize(), 1.3);
                // The float: arcing out on the cast, bobbing, dipping at a bite, drawn in while reeling.
                up.copy(state.float).sub(body.position).normalize();
                at.copy(state.float);
                if (state.phase === 'cast') {
                    const k = Math.min(1, state.time / 0.9);
                    at.lerpVectors(tip, state.float, k).addScaledVector(up, Math.sin(k * Math.PI) * 2.5);
                } else if (state.phase === 'reel') {
                    at.lerp(tip, state.progress * 0.85).addScaledVector(up, -0.05 + Math.sin(t * 9) * 0.03 * state.tension);
                    at.addScaledVector(across.crossVectors(up, scratch.copy(tip).sub(state.float).normalize()).normalize(), Math.sin(t * 2.3) * 0.6 * (1 - state.progress));
                } else {
                    at.addScaledVector(up, state.phase === 'bite' ? -0.12 - Math.abs(Math.sin(t * 14)) * 0.1 : Math.sin(t * 2.2) * 0.025);
                }
                floatMesh.position.copy(at).sub(runtime.origin);
                // The line: a sagging curve while slack, straight when taut.
                const sag = state.phase === 'reel' ? 0.05 * (1 - state.tension) : 0.6;
                const positions = line.getAttribute('position') as THREE.BufferAttribute;
                for (let i = 0; i <= SEGMENTS; i++) {
                    const k = i / SEGMENTS;
                    scratch.lerpVectors(tip, at, k).addScaledVector(up, -Math.sin(k * Math.PI) * sag * tip.distanceTo(at) * 0.15).sub(runtime.origin);
                    positions.setXYZ(i, scratch.x, scratch.y, scratch.z);
                }
                positions.needsUpdate = true;
            }
        }

        // ---- Fish leaping in water near the explorer ----
        const fishMesh = fishRef.current;
        const ring = ringRef.current;
        if (!fishMesh || !ring) return;
        const body = walker?.body;
        if (!walker || !body) {
            fishMesh.visible = false;
            ring.visible = false;
            return;
        }
        if (t - lastProbe.current > 2) {
            // Where is the water? A few dozen points around, every couple of seconds.
            lastProbe.current = t;
            water.current = [];
            const centre = walker.position;
            const north = scratch.set(0, 1, 0);
            up.copy(centre).sub(body.position).normalize();
            const a = new THREE.Vector3().crossVectors(up, north.lengthSq() > 0 ? north : new THREE.Vector3(1, 0, 0)).normalize();
            const b = new THREE.Vector3().crossVectors(up, a).normalize();
            for (let i = -3; i <= 3; i++) {
                for (let j = -3; j <= 3; j++) {
                    const point = centre.clone().addScaledVector(a, i * 6).addScaledVector(b, j * 6);
                    const pointUp = point.clone().sub(body.position).normalize();
                    if (waterDepth(body, pointUp) > 0.8) water.current.push(body.position.clone().addScaledVector(pointUp, body.radius + groundHeight(body, pointUp)));
                }
            }
        }
        if (!leap.current && water.current.length && t > nextLeap.current && Math.random() < 0.01) {
            const spot = water.current[Math.floor(Math.random() * water.current.length)];
            up.copy(spot).sub(body.position).normalize();
            const heading = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
            heading.addScaledVector(up, -heading.dot(up)).normalize();
            leap.current = { at: spot.clone(), heading, start: t, height: 0.5 + Math.random() * 0.6, back: false };
            nextLeap.current = t + 6 + Math.random() * 10;
            cue(runtime, 'splash', THREE.MathUtils.clamp(1 - spot.distanceTo(walker.position) / 45, 0.1, 0.7));
        }
        const l = leap.current;
        fishMesh.visible = false;
        ring.visible = false;
        if (l) {
            const age = t - l.start;
            up.copy(l.at).sub(body.position).normalize();
            if (age > 2.2) {
                leap.current = null;
            } else {
                const k = age / 0.7;
                if (k < 1) {
                    // Out of the water and back in, along an arc, nose following the path.
                    at.copy(l.at).addScaledVector(l.heading, (k - 0.5) * 1.6).addScaledVector(up, Math.sin(k * Math.PI) * l.height);
                    scratch.copy(l.heading).addScaledVector(up, Math.cos(k * Math.PI) * 1.4).normalize();
                    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), scratch);
                    matrix.compose(at.sub(runtime.origin), quaternion, scale.setScalar(1));
                    fishMesh.matrix.copy(matrix);
                    fishMesh.matrixWorldNeedsUpdate = true;
                    fishMesh.visible = true;
                    if (k > 0.92 && !l.back) {
                        l.back = true;
                        cue(runtime, 'splash', THREE.MathUtils.clamp(1 - l.at.distanceTo(walker.position) / 45, 0.1, 0.6));
                    }
                }
                // Rings spreading where it went in and came out.
                ring.visible = true;
                ring.position.copy(l.at).sub(runtime.origin).addScaledVector(up, 0.03);
                ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
                ring.scale.setScalar(0.3 + age * 1.6);
                ringMaterial.opacity = Math.max(0, 0.55 * (1 - age / 2.2));
            }
        }
    });

    return (
        <group>
            <primitive object={lineObject} ref={lineRef} frustumCulled={false} visible={false} />
            <mesh ref={floatRef} geometry={floatGeometry} material={floatMaterial} visible={false} />
            <mesh ref={fishRef} geometry={fish} material={fishMaterial} visible={false} matrixAutoUpdate={false} frustumCulled={false} />
            <mesh ref={ringRef} geometry={ringGeometry} material={ringMaterial} visible={false} frustumCulled={false} />
        </group>
    );
};
