import * as THREE from 'three';
import type { CrewId } from './crew';

/**
 * Each crew member's colours, so their fighter and their suit can be told apart at a glance: the
 * red accents the models were made with are repainted in the member's own colour, and the white
 * of the hull (and, more lightly, of the suit) is tinted. One shader change shared by all four
 * (the colours are uniforms), so switching costs no new shader.
 */
export interface Livery {
    /** Stripes, fins, trim. */
    accent: string;
    /** Multiplies the hull's white. */
    hull: string;
    /** How much of the hull tint reaches a suit (suits stay mostly white). */
    suit: number;
}

export const LIVERIES: Record<CrewId, Livery> = {
    dev: { accent: '#ff9a1f', hull: '#ffffff', suit: 0 },
    noor: { accent: '#3fbf5f', hull: '#bfd0ae', suit: 0.55 },
    kai: { accent: '#2f8cff', hull: '#7e8792', suit: 0.4 },
    amara: { accent: '#a66cff', hull: '#b6aed6', suit: 0.55 },
};

const LIVERY_GLSL = /* glsl */ `
    {
        // The model's red accents (red well above green and blue) become the livery's colour, kept
        // as light or dark as they were; everything else takes the hull's tint.
        float red = diffuseColor.r - max(diffuseColor.g, diffuseColor.b);
        float accent = smoothstep(0.1, 0.28, red);
        float light = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        vec3 painted = uLiveryAccent * (0.45 + light * 1.1);
        diffuseColor.rgb = mix(diffuseColor.rgb * uLiveryHull, painted, accent);
    }
`;

/**
 * Give a model's meshes materials of their own in `livery`'s colours (the originals are shared
 * with every other copy of the model, so they are cloned, once per call). `suit` uses the
 * livery's lighter suit tint.
 */
export const applyLivery = (root: THREE.Object3D, livery: Livery, suit = false) => {
    const accent = new THREE.Color(livery.accent);
    const hull = new THREE.Color(1, 1, 1).lerp(new THREE.Color(livery.hull), suit ? livery.suit : 1);
    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const swap = (material: THREE.Material) => {
            const standard = material as THREE.MeshStandardMaterial;
            if (!standard.isMeshStandardMaterial) return material;
            const copy = standard.clone();
            const uniforms = { uLiveryAccent: { value: accent }, uLiveryHull: { value: hull } };
            copy.onBeforeCompile = (shader) => {
                Object.assign(shader.uniforms, uniforms);
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nuniform vec3 uLiveryAccent;\nuniform vec3 uLiveryHull;')
                    .replace('#include <map_fragment>', `#include <map_fragment>\n${LIVERY_GLSL}`);
            };
            copy.customProgramCacheKey = () => 'livery';
            return copy;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    });
    return root;
};
