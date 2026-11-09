import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';
import { EXPEDITION_BODIES, type ExpeditionBody } from './bodies';

/**
 * How much of the picture a sunlit world fills (0 to 1, by its lit share of the frame): a camera (or an eye)
 * set for that bright ground shows space behind it black, with only the brightest stars, as in every
 * photograph of Earth from orbit (Apollo 17's whole disc, the ISS over Borneo: RGB 0-4 behind the limb). The
 * faint nebula behind a sunlit Earth was the first thing that read as fake (SpaceBackdrop.tsx dims it by this).
 */
const toWorld = new THREE.Vector3();
const forward = new THREE.Vector3();

/** The world that looks largest from the camera (the one it is at, or the nearest in sight). */
const largest = (runtime: ExpeditionRuntime) => {
    let best: ExpeditionBody | null = null;
    let size = 0;
    for (const body of EXPEDITION_BODIES) {
        if (body.kind === 'star') continue;
        const s = body.radius / Math.max(body.position.distanceTo(runtime.camera), 1);
        if (s > size) {
            size = s;
            best = body;
        }
    }
    return best;
};

export const sunlitShare = (runtime: ExpeditionRuntime, camera: THREE.Camera) => {
    const body = runtime.currentBody ?? largest(runtime);
    if (!body || body.kind === 'star' || !body.sunDirection) return 0;
    toWorld.copy(body.position).sub(runtime.camera);
    const distance = toWorld.length();
    if (distance <= body.radius) return 0;
    toWorld.divideScalar(distance);
    // The world's disc: its angular radius, and how far its centre is from the middle of the view.
    const alpha = Math.asin(Math.min(body.radius / distance, 1));
    camera.getWorldDirection(forward);
    const theta = Math.acos(THREE.MathUtils.clamp(forward.dot(toWorld), -1, 1));
    const perspective = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(perspective.fov ?? 60);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (perspective.aspect ?? 1.6));
    // (The frame taken as a cone out to the middle of its sides and corners.)
    const reach = (vfov + hfov) / 4;
    const inView = THREE.MathUtils.clamp((reach + alpha - theta) / (2 * alpha), 0, 1);
    const disc = 2 * Math.PI * (1 - Math.cos(alpha));
    const frame = vfov * hfov;
    // The lit share of the face turned to the camera (its phase).
    const lit = (1 - toWorld.dot(body.sunDirection)) / 2;
    return Math.min(1, disc * inView / frame) * lit * runtime.sunlight;
};
