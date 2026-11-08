import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPEDITION_BODIES, THE_SUN, sunDirectionAt } from './bodies';
import { farness } from './deepSpace';
import { skyBeyond } from './environment';
import { groundHeight } from './environment';
import type { ExpeditionRuntime } from './runtime';

/**
 * Faint lens ghosts along the line from the sun through the middle of the
 * frame, as a real camera shows when it looks towards the sun. They appear
 * only while the sun is on screen and not behind a world or its horizon, and
 * stay subtle: the glare itself comes from the bloom.
 */
const GHOSTS: { t: number; size: number; color: string; alpha: number; ring?: boolean }[] = [
    { t: 0.42, size: 5, color: '255, 222, 186', alpha: 0.1 },
    { t: 0.78, size: 2.4, color: '186, 214, 255', alpha: 0.13 },
    { t: 1.18, size: 8.5, color: '170, 255, 214', alpha: 0.05 },
    { t: 1.52, size: 3.4, color: '255, 184, 128', alpha: 0.1 },
    { t: 1.95, size: 15, color: '205, 222, 255', alpha: 0.07, ring: true },
];

const sunPoint = new THREE.Vector3();
const toCenter = new THREE.Vector3();
const toSun = new THREE.Vector3();

const blocked = (runtime: ExpeditionRuntime) => {
    const eye = runtime.camera;
    for (const body of EXPEDITION_BODIES) {
        if (body.kind === 'star') continue;
        toCenter.copy(body.position).sub(eye);
        const along = toCenter.dot(toSun);
        // Only what stands between the camera and the Sun.
        if (along < 0 || along > eye.distanceTo(THE_SUN.position)) continue;
        let radius = body.radius;
        if (body === runtime.currentBody && body.kind === 'rocky') {
            // The local horizon: the ground under the camera, a little lower.
            const up = eye.clone().sub(body.position).normalize();
            radius += groundHeight(body, up) - 2;
        }
        if (toCenter.lengthSq() - along * along < radius * radius) return true;
    }
    return false;
};

export const SunFlare = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const nodes = useRef<HTMLSpanElement[]>([]);
    const container = useRef<HTMLDivElement | null>(null);
    const strength = useRef(0);

    useEffect(() => {
        const parent = gl.domElement.parentElement;
        if (!parent) return undefined;
        const layer = document.createElement('div');
        layer.className = 'expedition-flare';
        layer.setAttribute('aria-hidden', 'true');
        nodes.current = GHOSTS.map((ghost) => {
            const span = document.createElement('span');
            const size = `${ghost.size}vmin`;
            span.style.width = size;
            span.style.height = size;
            span.style.background = ghost.ring
                ? `radial-gradient(circle, rgba(${ghost.color}, 0) 58%, rgba(${ghost.color}, 1) 66%, rgba(${ghost.color}, 0) 76%)`
                : `radial-gradient(circle, rgba(${ghost.color}, 1) 0%, rgba(${ghost.color}, 0.55) 38%, rgba(${ghost.color}, 0) 70%)`;
            layer.appendChild(span);
            return span;
        });
        parent.appendChild(layer);
        container.current = layer;
        return () => { layer.remove(); container.current = null; };
    }, [gl]);

    useFrame(({ camera, size }, delta) => {
        const layer = container.current;
        if (!layer) return;
        sunDirectionAt(runtime.camera, toSun);
        sunPoint.copy(camera.position).addScaledVector(toSun, 1000).project(camera);
        const onScreen = sunPoint.z < 1 && Math.abs(sunPoint.x) < 1.15 && Math.abs(sunPoint.y) < 1.15;
        const visible = onScreen && !blocked(runtime);
        // Fade in and out rather than blinking as the sun passes behind things.
        // Out by TON 618 the sun is only a star.
        // In an eclipse, only the share of the Sun still showing makes ghosts.
        const target = visible ? (1 - Math.min(1, Math.hypot(sunPoint.x, sunPoint.y) / 1.5)) * (1 - runtime.atmosphere * 0.35) * (1 - farness(runtime.camera)) * skyBeyond(runtime) * runtime.sunlight ** 2 : 0;
        strength.current += (target - strength.current) * (1 - Math.exp(-delta * 8));
        layer.style.opacity = strength.current.toFixed(3);
        if (strength.current < 0.01) return;
        const sx = (sunPoint.x * 0.5 + 0.5) * size.width;
        const sy = (-sunPoint.y * 0.5 + 0.5) * size.height;
        const cx = size.width / 2;
        const cy = size.height / 2;
        GHOSTS.forEach((ghost, n) => {
            const node = nodes.current[n];
            if (!node) return;
            const x = sx + (cx - sx) * ghost.t;
            const y = sy + (cy - sy) * ghost.t;
            node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
            node.style.opacity = String(ghost.alpha);
        });
    });

    return null;
};
