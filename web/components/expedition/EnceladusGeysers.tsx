import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { fromStart, orientationOf } from './motion';
import type { ExpeditionRuntime } from './runtime';
import { findFrame, storyFind } from './story';

/**
 * Enceladus's geysers: jets of ice grains and water vapour from the tiger
 * stripes, a hundred or so of them along the four cracks, rising at hundreds
 * of metres a second, faster than the little moon's escape speed (240 m/s),
 * so most of the spray never comes back down: it feeds Saturn's E ring.
 * Here five of them stand in a line along the crack by the frost fans,
 * fanning out and fading as they rise. Seen against the Sun, the fine grains
 * shine (they scatter light forwards), as they did in Cassini's pictures.
 */
const VENTS = 5;
const SPACING = 70;
/** How high the spray is drawn before it has thinned to nothing (game units; the real plume is visible to hundreds of km). */
export const PLUME_TOP = 1700;
const SPEED = 110;
const CONE = THREE.MathUtils.degToRad(9);
const COUNT = [1400, 2600, 4000];
const SHOW = 14000;

const random = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

let puffTexture: THREE.Texture | null = null;
const puff = () => {
    if (puffTexture) return puffTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    puffTexture = new THREE.CanvasTexture(canvas);
    return puffTexture;
};

/** The vents along the crack, and the crack's frame (start frame of Enceladus). */
export const geyserVents = () => {
    const find = storyFind('trail-enceladus')!;
    const frame = findFrame(find);
    return Array.from({ length: VENTS }, (_, i) => frame.centre.clone()
        .addScaledVector(frame.east, (i - (VENTS - 1) / 2) * SPACING + 22)
        .addScaledVector(frame.north, 14));
};

const at = new THREE.Vector3();
const toEye = new THREE.Vector3();
const up = new THREE.Vector3();

export const EnceladusGeysers = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const body = useMemo(() => findBody('enceladus') as ExpeditionBody | undefined, []);
    const frame = useMemo(() => findFrame(storyFind('trail-enceladus')!), []);
    const vents = useMemo(() => geyserVents(), []);
    const count = COUNT[runtime.quality];
    const pointsRef = useRef<THREE.Points>(null);
    const grains = useMemo(() => {
        const r = random(1500);
        const side = frame.east;
        const across = frame.north;
        return Array.from({ length: count }, () => {
            const theta = Math.acos(1 - r() * (1 - Math.cos(CONE)));
            const phi = r() * Math.PI * 2;
            const dir = frame.up.clone().multiplyScalar(Math.cos(theta))
                .addScaledVector(side, Math.sin(theta) * Math.cos(phi))
                .addScaledVector(across, Math.sin(theta) * Math.sin(phi));
            return { vent: Math.floor(r() * VENTS), dir, speed: SPEED * (0.7 + 0.6 * r()), phase: r() };
        });
    }, [frame, count]);
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [count]);
    const material = useMemo(() => new THREE.PointsMaterial({
        map: puff(), size: 18, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), []);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

    useFrame(({ clock }) => {
        const points = pointsRef.current;
        if (!points || !body) return;
        fromStart(runtime.motion, body, frame.centre, at);
        const near = runtime.currentBody === body && at.distanceTo(runtime.camera) < SHOW;
        points.visible = near;
        if (!near) return;
        // Bright with the Sun behind the spray, faint with it behind you.
        toEye.copy(runtime.camera).sub(at).normalize();
        const backlit = 0.35 + 1.4 * Math.pow(Math.max(0, -toEye.dot(body.sunDirection)), 3);
        const position = geometry.getAttribute('position') as THREE.BufferAttribute;
        const colour = geometry.getAttribute('color') as THREE.BufferAttribute;
        const life = PLUME_TOP / SPEED;
        const t = clock.elapsedTime;
        const turn = orientationOf(runtime.motion, body);
        grains.forEach((g, i) => {
            const age = ((t / life + g.phase) % 1) * life;
            const rise = g.speed * age;
            fromStart(runtime.motion, body, vents[g.vent], at).addScaledVector(up.copy(g.dir).applyQuaternion(turn), rise).sub(runtime.origin);
            position.setXYZ(i, at.x, at.y, at.z);
            // Thinning as it rises and spreads.
            const fade = Math.max(0, 1 - rise / PLUME_TOP) ** 1.6 * backlit * 0.16;
            colour.setXYZ(i, 0.82 * fade, 0.9 * fade, fade);
        });
        position.needsUpdate = true;
        colour.needsUpdate = true;
    });

    return body ? <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={7} visible={false} /> : null;
};
