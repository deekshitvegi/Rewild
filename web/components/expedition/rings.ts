import * as THREE from 'three';

/**
 * Saturn's rings, by radius in planet radii: the faint C ring, the bright,
 * nearly opaque B ring, the dark Cassini Division, the A ring with the Encke
 * Gap, and the thin F ring outside it. The same function in JavaScript (for
 * the ice the ship can hit) and in GLSL (for drawing): keep them in step.
 */
export const ringDensity = (r: number) => {
    const s = (a: number, b: number, x: number) => {
        const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    const c = s(1.23, 1.26, r) * (1 - s(1.51, 1.53, r)) * (0.16 + 0.05 * Math.sin(r * 420));
    const b = s(1.52, 1.57, r) * (1 - s(1.93, 1.95, r)) * (0.82 + 0.12 * Math.sin(r * 260) * Math.sin(r * 37));
    let a = s(2.02, 2.04, r) * (1 - s(2.25, 2.27, r)) * (0.58 + 0.08 * Math.sin(r * 310));
    a *= 1 - (1 - s(0, 0.006, Math.abs(r - 2.214))) * 0.95;
    const fr = (r - 2.325) / 0.0045;
    const f = Math.exp(-fr * fr) * 0.45;
    return Math.min(1, Math.max(0, c + b + a + f));
};

export const RING_GLSL = /* glsl */ `
float ringDensity(float r) {
    float c = smoothstep(1.23, 1.26, r) * (1.0 - smoothstep(1.51, 1.53, r)) * (0.16 + 0.05 * sin(r * 420.0));
    float b = smoothstep(1.52, 1.57, r) * (1.0 - smoothstep(1.93, 1.95, r)) * (0.82 + 0.12 * sin(r * 260.0) * sin(r * 37.0));
    float a = smoothstep(2.02, 2.04, r) * (1.0 - smoothstep(2.25, 2.27, r)) * (0.58 + 0.08 * sin(r * 310.0));
    a *= 1.0 - (1.0 - smoothstep(0.0, 0.006, abs(r - 2.214))) * 0.95;
    float fr = (r - 2.325) / 0.0045;
    float f = exp(-fr * fr) * 0.45;
    return clamp(c + b + a + f, 0.0, 1.0);
}
`;

/** Which ring a radius (planet radii) falls in, for the HUD. */
export const ringName = (r: number) => {
    if (r < 1.23 || r > 2.34) return null;
    if (r < 1.52) return 'C ring';
    if (r < 1.95) return 'B ring';
    if (r < 2.02) return 'Cassini Division';
    if (Math.abs(r - 2.214) < 0.004) return 'Encke Gap';
    if (r < 2.27) return 'A ring';
    if (Math.abs(r - 2.325) < 0.01) return 'F ring';
    return null;
};

/** What finding each of Saturn's sights says (the discovery card). */
export const SATURN_SIGHTS: Record<'hexagon' | 'decagon' | 'rings', { name: string; blurb: string }> = {
    hexagon: {
        name: 'The hexagon',
        blurb: 'A jet stream at 78 degrees north that runs in a six-sided ring, each side longer than Earth is wide. Voyager saw it in 1981 and it has kept its shape ever since; spin a tank of fluid with a fast jet in it and it settles into polygons the same way. At its centre a hurricane with an eye 2,000 km across. It is polar winter there now: the infrared imager (I) sees it by its own heat.',
    },
    decagon: {
        name: 'The decagon',
        blurb: 'The jet stream round the south pole at 60 degrees blows at 116 m/s, yet it has bent into ten sides, about 167,000 km round, that barely move. Hubble caught hints of it in 2023 and the whole decagon in 2025, as the south turned into summer light: a younger twin of the hexagon in the north.',
    },
    rings: {
        name: 'Inside the rings',
        blurb: 'Water ice, nearly pure, in pieces from grains of dust to boulders the size of a house, all orbiting together in a layer mostly ten to thirty metres thick. From a few kilometres off it is a sheet; from inside, a slow storm of snowballs. Cassini\'s last orbits weighed them: by one reading they are only tens of millions of years old, younger than many dinosaurs.',
    },
};

/** A right-handed frame on the ring plane: two directions in it and the planet's axis. */
export const ringFrame = (axis: THREE.Vector3) => {
    const e1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();
    return { e1, e2, axis: axis.clone() };
};
