import * as THREE from 'three';
import { gnoise } from './noise';
import { createSeededRandom } from '../../utils/seededRandom';

/**
 * Low-poly models for what grows and stands on the worlds: trees, bushes,
 * cacti, boulders, sandstone pillars, rock arches and ice spires. They are
 * built from code (no downloads), flat-shaded with a colour per face like the
 * stylised props in the reference video, and sized in "model units" that the
 * scatter scales up per instance.
 *
 * Every builder returns a non-indexed geometry with `position` and `color`
 * (linear RGB) whose normals are the face normals.
 */

export type Part = { position: number[]; color: number[] };

export const part = (geometry: THREE.BufferGeometry): Part => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = Array.from(flat.getAttribute('position').array as ArrayLike<number>);
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
    return { position, color: new Array(position.length).fill(1) };
};

export const finish = (parts: Part[]) => {
    const position = parts.flatMap((p) => p.position);
    const color = parts.flatMap((p) => p.color);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
};

/** Moves every vertex by a function of where it was, so shared corners stay joined. */
const displace = (p: Part, fn: (v: THREE.Vector3) => void) => {
    const v = new THREE.Vector3();
    for (let i = 0; i < p.position.length; i += 3) {
        v.set(p.position[i], p.position[i + 1], p.position[i + 2]);
        fn(v);
        p.position[i] = v.x;
        p.position[i + 1] = v.y;
        p.position[i + 2] = v.z;
    }
    return p;
};

export const transform = (p: Part, matrix: THREE.Matrix4) => displace(p, (v) => v.applyMatrix4(matrix));

export const at = (x: number, y: number, z: number, sx = 1, sy = sx, sz = sx, ry = 0, rz = 0, rx = 0) =>
    new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
        new THREE.Vector3(sx, sy, sz),
    );

const faceNormal = new THREE.Vector3();
const edgeA = new THREE.Vector3();
const edgeB = new THREE.Vector3();

/** One colour per triangle, from its centre and normal. */
export const paint = (p: Part, fn: (centre: THREE.Vector3, normal: THREE.Vector3, index: number) => THREE.Color) => {
    const centre = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0, t = 0; i < p.position.length; i += 9, t++) {
        a.fromArray(p.position, i);
        b.fromArray(p.position, i + 3);
        c.fromArray(p.position, i + 6);
        centre.copy(a).add(b).add(c).divideScalar(3);
        faceNormal.crossVectors(edgeA.subVectors(b, a), edgeB.subVectors(c, a)).normalize();
        const color = fn(centre, faceNormal, t);
        for (let k = 0; k < 3; k++) {
            p.color[i + k * 3] = color.r;
            p.color[i + k * 3 + 1] = color.g;
            p.color[i + k * 3 + 2] = color.b;
        }
    }
    return p;
};

const palette = (hexes: string[]) => hexes.map((hex) => new THREE.Color(hex));
const scratch = new THREE.Color();
const pick = (colors: THREE.Color[], t: number) => colors[Math.min(colors.length - 1, Math.max(0, Math.floor(t * colors.length)))];
export const hashUnit = (n: number, seed: number) => {
    const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
};

/** A lumpy rock, flattened and sunk a little so it sits in the ground. */
export const lump = (seed: number, detail: number, roughness: number) => displace(part(new THREE.IcosahedronGeometry(1, detail)), (v) => {
    const n = v.normalize();
    const r = 1 + roughness * gnoise(n.x * 1.7 + 3.1, n.y * 1.7, n.z * 1.7, seed) + roughness * 0.35 * gnoise(n.x * 4.2, n.y * 4.2, n.z * 4.2, seed + 1);
    v.multiplyScalar(r);
});

export const boulderGeometry = (seed: number, colors: string[], snow = false) => {
    const rock = palette(colors);
    const white = new THREE.Color('#e9f1f5');
    const p = displace(lump(seed, 1, 0.3), (v) => { v.y = v.y * 0.62 - 0.14; });
    paint(p, (centre, normal, i) => {
        scratch.copy(pick(rock, hashUnit(i, seed))).multiplyScalar(0.82 + 0.3 * THREE.MathUtils.clamp(centre.y + 0.4, 0, 1));
        if (snow && normal.y > 0.5) scratch.lerp(white, THREE.MathUtils.smoothstep(normal.y, 0.5, 0.75));
        return scratch;
    });
    return finish([p]);
};

/** The rounded broadleaf trees of the green world. About 3.7 units tall. */
export const roundTreeGeometry = (seed: number, leaves: string[], bark = '#5b4030') => {
    const random = createSeededRandom(seed);
    const trunkColor = new THREE.Color(bark);
    const trunk = transform(part(new THREE.CylinderGeometry(0.12, 0.2, 2.2, 6, 1, true)), at(0, 1.1, 0));
    paint(trunk, () => trunkColor);
    const greens = palette(leaves);
    const blobs = [
        [0, 2.65, 0, 1.12],
        [0.55 + random() * 0.2, 2.3, 0.25, 0.78],
        [-0.5, 2.35 + random() * 0.2, -0.3, 0.8],
        [0.05, 3.15, -0.1, 0.72],
    ].map(([x, y, z, r], n) => {
        const blob = transform(lump(seed + n * 7, 1, 0.22), at(x, y, z, r, r * 0.86, r));
        return paint(blob, (centre, normal, i) => {
            const shade = 0.8 + 0.22 * THREE.MathUtils.clamp((centre.y - 1.6) / 2, 0, 1) + normal.y * 0.08;
            return scratch.copy(pick(greens, hashUnit(i + n * 131, seed))).multiplyScalar(shade);
        });
    });
    return finish([trunk, ...blobs]);
};

/** A conifer of three stacked cones. About 4.4 units tall. */
export const coniferGeometry = (seed: number, needles: string[], bark = '#4a3426', snow = false) => {
    const trunkColor = new THREE.Color(bark);
    const trunk = paint(transform(part(new THREE.CylinderGeometry(0.1, 0.16, 1.2, 5, 1, true)), at(0, 0.6, 0)), () => trunkColor);
    const greens = palette(needles);
    const white = new THREE.Color('#eef6f8');
    const tiers = [[1.3, 2.0, 0.8], [1.02, 1.75, 1.75], [0.72, 1.55, 2.75]].map(([r, h, y], n) => {
        const cone = transform(part(new THREE.ConeGeometry(r, h, 7, 1, false)), at(0, y + h / 2, 0, 1, 1, 1, n * 0.45));
        return paint(cone, (centre, normal, i) => {
            scratch.copy(pick(greens, hashUnit(i + n * 17, seed))).multiplyScalar(0.8 + 0.25 * (centre.y / 4.4));
            if (snow && normal.y > 0.35) scratch.lerp(white, 0.75);
            return scratch;
        });
    });
    return finish([trunk, ...tiers]);
};

/** A low leafy (or dry) bush. About 1 unit tall. */
export const bushGeometry = (seed: number, leaves: string[]) => {
    const greens = palette(leaves);
    const parts = [[0, 0.45, 0, 0.7], [0.45, 0.35, 0.2, 0.5], [-0.35, 0.32, -0.25, 0.5]].map(([x, y, z, r], n) =>
        paint(transform(lump(seed + n, 0, 0.25), at(x, y, z, r, r * 0.8, r)), (centre, _normal, i) =>
            scratch.copy(pick(greens, hashUnit(i + n * 31, seed))).multiplyScalar(0.8 + centre.y * 0.3)));
    return finish(parts);
};

/**
 * A clump of reeds and bulrushes for the water's edge: tall thin leaves
 * leaning out from the middle, and a few stems carrying brown seed heads.
 * About 1 unit tall.
 */
export const reedGeometry = (seed: number, leaves: string[]) => {
    const greens = palette(leaves);
    const random = createSeededRandom(seed);
    const head = new THREE.Color('#5a3b22');
    const pieces: Part[] = [];
    const blades = 16;
    for (let n = 0; n < blades; n++) {
        const angle = random() * Math.PI * 2;
        const lean = 0.08 + random() * 0.32;
        const height = 0.6 + random() * 0.45;
        const width = 0.022 + random() * 0.018;
        const root = new THREE.Vector3(Math.cos(angle) * random() * 0.12, 0, Math.sin(angle) * random() * 0.12);
        const out = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const side = new THREE.Vector3(-out.z, 0, out.x).multiplyScalar(width);
        // Three segments bending outwards, narrowing to a point.
        const point = (t: number) => root.clone().addScaledVector(out, lean * t * t * height).add(new THREE.Vector3(0, height * t, 0));
        const position: number[] = [];
        for (let k = 0; k < 3; k++) {
            const t0 = k / 3, t1 = (k + 1) / 3;
            const a = point(t0), b = point(t1);
            const w0 = 1 - t0 * 0.85, w1 = 1 - t1 * 0.85;
            const a0 = a.clone().addScaledVector(side, -w0), a1 = a.clone().addScaledVector(side, w0);
            const b0 = b.clone().addScaledVector(side, -w1), b1 = b.clone().addScaledVector(side, w1);
            position.push(...a0.toArray(), ...a1.toArray(), ...b1.toArray(), ...a0.toArray(), ...b1.toArray(), ...b0.toArray());
        }
        pieces.push(paint({ position, color: new Array(position.length).fill(1) }, (centre, _normal, i) =>
            scratch.copy(pick(greens, hashUnit(i + n * 7, seed))).multiplyScalar(0.7 + centre.y * 0.45)));
    }
    // Bulrush heads on straight stems.
    const heads = 2 + Math.floor(random() * 3);
    for (let n = 0; n < heads; n++) {
        const x = (random() - 0.5) * 0.18, z = (random() - 0.5) * 0.18;
        const top = 0.85 + random() * 0.3;
        pieces.push(paint(transform(part(new THREE.CylinderGeometry(0.008, 0.01, top, 4)), at(x, top / 2, z)), () => scratch.copy(greens[0]).multiplyScalar(0.8)));
        pieces.push(paint(transform(part(new THREE.CylinderGeometry(0.028, 0.028, 0.16, 6)), at(x, top - 0.1, z)), () => head));
    }
    return finish(pieces);
};

/**
 * Water lilies: round floating leaves, each with its notch, lying flat on the
 * water, and now and then a flower. One unit across, flat at y = 0.
 */
export const lilyGeometry = (seed: number, leaves: string[], flower = '#f2d7e0') => {
    const greens = palette(leaves);
    const random = createSeededRandom(seed);
    const bloom = new THREE.Color(flower);
    const centre = new THREE.Color('#f2c94c');
    const pieces: Part[] = [];
    const pads = 4 + Math.floor(random() * 4);
    for (let n = 0; n < pads; n++) {
        const r = 0.12 + random() * 0.14;
        const x = (random() - 0.5) * 0.8, z = (random() - 0.5) * 0.8;
        // A disc with a wedge cut out, facing up.
        const notch = 0.5;
        const disc = new THREE.CircleGeometry(r, 10, notch / 2, Math.PI * 2 - notch).rotateX(-Math.PI / 2);
        pieces.push(paint(transform(part(disc), at(x, 0.004 * n, z, 1, 1, 1, random() * Math.PI * 2)), () =>
            scratch.copy(pick(greens, random())).multiplyScalar(0.85 + random() * 0.25)));
        if (random() < 0.3) {
            // A flower: two rings of pointed petals round a yellow middle.
            for (let ring = 0; ring < 2; ring++) {
                const petals = 7;
                const position: number[] = [];
                for (let k = 0; k < petals; k++) {
                    const a = (k + ring * 0.5) / petals * Math.PI * 2;
                    const len = 0.07 - ring * 0.015, rise = 0.03 + ring * 0.025;
                    const w = 0.022;
                    const tip = new THREE.Vector3(x + Math.cos(a) * len, 0.02 + rise, z + Math.sin(a) * len);
                    const l = new THREE.Vector3(x + Math.cos(a + 1.2) * w, 0.015, z + Math.sin(a + 1.2) * w);
                    const rr = new THREE.Vector3(x + Math.cos(a - 1.2) * w, 0.015, z + Math.sin(a - 1.2) * w);
                    position.push(...l.toArray(), ...rr.toArray(), ...tip.toArray());
                }
                pieces.push(paint({ position, color: new Array(position.length).fill(1) }, () => scratch.copy(bloom).multiplyScalar(0.9 + ring * 0.12)));
            }
            pieces.push(paint(transform(part(new THREE.SphereGeometry(0.018, 5, 3)), at(x, 0.035, z)), () => centre));
        }
    }
    return finish(pieces);
};

/** A branching cactus. About 3 units tall. */
export const cactusGeometry = (seed: number, skin: string[]) => {
    const greens = palette(skin);
    const random = createSeededRandom(seed);
    const pieces: Part[] = [];
    const add = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4) => pieces.push(transform(part(geometry), matrix));
    add(new THREE.CylinderGeometry(0.22, 0.26, 2.6, 7, 2), at(0, 1.3, 0));
    add(new THREE.SphereGeometry(0.22, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), at(0, 2.6, 0));
    const armHeight = [1.2 + random() * 0.4, 1.5 + random() * 0.5];
    [-1, 1].forEach((side, n) => {
        add(new THREE.CylinderGeometry(0.14, 0.14, 0.6, 6), at(side * 0.45, armHeight[n], 0, 1, 1, 1, 0, Math.PI / 2));
        add(new THREE.CylinderGeometry(0.14, 0.15, 0.9, 6), at(side * 0.72, armHeight[n] + 0.4, 0));
        add(new THREE.SphereGeometry(0.14, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), at(side * 0.72, armHeight[n] + 0.85, 0));
    });
    return finish(pieces.map((p, n) => paint(p, (_c, normal, i) =>
        scratch.copy(pick(greens, hashUnit(i + n * 13, seed))).multiplyScalar(0.85 + normal.y * 0.12))));
};

/**
 * A column of eroded rock, one unit tall, following a radius profile, with
 * horizontal strata. Used for desert pillars, hoodoos and buttes.
 */
const column = (seed: number, profile: [number, number][], colors: string[], sides = 9, roughness = 0.16, strataFrequency = 9) => {
    const rock = palette(colors);
    const rings = profile.map(([y, r], ring) => Array.from({ length: sides }, (_, j) => {
        const angle = (j / sides) * Math.PI * 2 + ring * 0.21;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const radius = r * (1 + roughness * gnoise(c * 1.4 + 5, s * 1.4, y * 5, seed) + roughness * 0.4 * gnoise(c * 3.1, s * 3.1, y * 13, seed + 3));
        return new THREE.Vector3(c * radius, y, s * radius);
    }));
    const position: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let ring = 0; ring < rings.length - 1; ring++) {
        for (let j = 0; j < sides; j++) {
            const a = rings[ring][j];
            const b = rings[ring][(j + 1) % sides];
            const c = rings[ring + 1][j];
            const d = rings[ring + 1][(j + 1) % sides];
            tri(a, c, b);
            tri(b, c, d);
        }
    }
    const top = rings[rings.length - 1];
    const peak = new THREE.Vector3(0, profile[profile.length - 1][0] + 0.004, 0);
    for (let j = 0; j < sides; j++) tri(top[j], peak, top[(j + 1) % sides]);
    const p: Part = { position, color: new Array(position.length).fill(1) };
    return paint(p, (centre, normal, i) => {
        const band = 0.5 + 0.5 * Math.sin(centre.y * strataFrequency * Math.PI * 2 + gnoise(centre.x * 4, centre.y * 2, centre.z * 4, seed + 9) * 1.4);
        scratch.copy(pick(rock, band)).multiplyScalar(0.86 + hashUnit(i, seed) * 0.16 + (normal.y > 0.6 ? 0.1 : 0));
        return scratch;
    });
};

/** Tall thin pillar: height 1, about 0.3 wide. */
export const spireGeometry = (seed: number, colors: string[]) => finish([column(seed, [
    [-0.06, 0.17], [0.06, 0.15], [0.18, 0.115], [0.34, 0.105], [0.5, 0.092], [0.62, 0.1],
    [0.74, 0.085], [0.86, 0.07], [0.94, 0.078], [1.0, 0.05],
], colors, 9, 0.18, 6)]);

/** A hoodoo: a narrow neck under a wider cap stone. Height 1, about 0.5 wide. */
export const hoodooGeometry = (seed: number, colors: string[]) => finish([column(seed, [
    [-0.06, 0.26], [0.08, 0.23], [0.22, 0.17], [0.4, 0.16], [0.55, 0.13], [0.68, 0.14],
    [0.78, 0.12], [0.84, 0.19], [0.93, 0.21], [1.0, 0.17],
], colors, 10, 0.16, 5)]);

/** A flat-topped butte. Height 1, about 1.8 wide. */
export const butteGeometry = (seed: number, colors: string[]) => finish([column(seed, [
    [-0.08, 1.0], [0.1, 0.86], [0.3, 0.78], [0.55, 0.74], [0.7, 0.72], [0.8, 0.76],
    [0.9, 0.7], [0.97, 0.66], [1.0, 0.6],
], colors, 13, 0.12, 4)]);

/**
 * A natural rock arch: a thick eroded span between two legs. Spans one unit
 * along x, stands about 0.9 tall, and its feet continue below the ground.
 */
export const archGeometry = (seed: number, colors: string[]) => {
    const rock = palette(colors);
    const rings = 30;
    const sides = 10;
    const path = (t: number) => {
        const s = Math.sin(Math.PI * t);
        return new THREE.Vector3((t - 0.5) * 1.0, -0.12 + 1.02 * Math.pow(s, 0.62), 0.04 * Math.sin(t * 7 + seed));
    };
    const radius = (t: number) => 0.095 + 0.11 * Math.pow(1 - Math.sin(Math.PI * t), 1.5);
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const grid = Array.from({ length: rings + 1 }, (_, i) => {
        const t = i / rings;
        const centre = path(t);
        tangent.copy(path(Math.min(1, t + 0.01))).sub(path(Math.max(0, t - 0.01))).normalize();
        side.crossVectors(zAxis, tangent).normalize();
        const r = radius(t);
        return Array.from({ length: sides }, (_, j) => {
            const angle = (j / sides) * Math.PI * 2;
            const bump = 1 + 0.22 * gnoise(t * 6 + 1, Math.cos(angle) * 1.3, Math.sin(angle) * 1.3, seed) + 0.08 * gnoise(t * 19, Math.cos(angle) * 3, Math.sin(angle) * 3, seed + 5);
            return centre.clone()
                .addScaledVector(side, Math.cos(angle) * r * bump)
                .addScaledVector(zAxis, Math.sin(angle) * r * 1.9 * bump);
        });
    });
    const position: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < rings; i++) {
        for (let j = 0; j < sides; j++) {
            const a = grid[i][j];
            const b = grid[i][(j + 1) % sides];
            const c = grid[i + 1][j];
            const d = grid[i + 1][(j + 1) % sides];
            tri(a, b, c);
            tri(b, d, c);
        }
    }
    const p: Part = { position, color: new Array(position.length).fill(1) };
    paint(p, (centre, normal, i) => {
        const band = 0.5 + 0.42 * Math.sin(centre.y * 13 + gnoise(centre.x * 5, centre.y * 3, centre.z * 5, seed + 7) * 2.2);
        scratch.copy(pick(rock, band)).multiplyScalar(0.86 + hashUnit(i, seed) * 0.14 + (normal.y > 0.55 ? 0.1 : 0));
        return scratch;
    });
    return finish([p]);
};

/** Collision spheres along the arch, in model units: [x, y, z, radius]. */
export const archColliders = (() => {
    const spheres: [number, number, number, number][] = [];
    for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const s = Math.sin(Math.PI * t);
        spheres.push([(t - 0.5) * 1.0, -0.12 + 1.02 * Math.pow(s, 0.62), 0, (0.095 + 0.11 * Math.pow(1 - s, 1.5)) * 1.3]);
    }
    return spheres;
})();

/** A cluster of tall faceted ice crystals. About 1 unit tall. */
export const iceSpireGeometry = (seed: number, colors: string[]) => {
    const random = createSeededRandom(seed);
    const ice = palette(colors);
    const count = 4 + Math.floor(random() * 3);
    const pieces = Array.from({ length: count }, (_, n) => {
        const height = n === 0 ? 1 : 0.35 + random() * 0.45;
        const width = height * (0.1 + random() * 0.05);
        const angle = random() * Math.PI * 2;
        const lean = n === 0 ? 0.05 : 0.2 + random() * 0.3;
        const distance = n === 0 ? 0 : 0.08 + random() * 0.12;
        const shaft = part(new THREE.CylinderGeometry(width * 0.8, width, height * 0.8, 6, 1, true));
        const tip = transform(part(new THREE.ConeGeometry(width * 0.8, height * 0.22, 6, 1, true)), at(0, height * 0.51, 0));
        const matrix = at(Math.cos(angle) * distance, height * 0.36, Math.sin(angle) * distance, 1, 1, 1, angle, Math.cos(angle) * lean, Math.sin(angle) * -lean);
        return [transform(shaft, matrix), transform(tip, matrix)].map((p, k) =>
            paint(p, (_c, normal, i) => scratch.copy(pick(ice, hashUnit(i + n * 19 + k * 7, seed))).multiplyScalar(0.85 + Math.max(0, normal.y) * 0.3)));
    }).flat();
    return finish(pieces);
};
