import * as THREE from 'three';

/**
 * Cube-sphere terrain: each of the six cube faces is a quadtree of square
 * chunks. Chunks near the camera split into four smaller ones, so the ground
 * gains detail smoothly from orbit down to walking height, all drawn as one
 * instanced draw call per planet. The GPU displaces each chunk's grid onto the
 * sphere using the planet's height function.
 */

// Face frames: point on the cube = N + u * T + v * B, with T x B = N so every
// face winds the same way (counter-clockwise seen from outside).
export const FACE_N: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const FACE_T: [number, number, number][] = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
export const FACE_B: [number, number, number][] = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];

/** Unit direction for face coordinates (u, v) in [-1, 1]. Matches dirAt() in GLSL. */
export const faceDirection = (face: number, u: number, v: number, out: THREE.Vector3) => {
    const n = FACE_N[face];
    const t = FACE_T[face];
    const b = FACE_B[face];
    const x = n[0] + u * t[0] + v * b[0];
    const y = n[1] + u * t[1] + v * b[1];
    const z = n[2] + u * t[2] + v * b[2];
    const x2 = x * x;
    const y2 = y * y;
    const z2 = z * z;
    out.set(
        x * Math.sqrt(Math.max(0, 1 - y2 / 2 - z2 / 2 + (y2 * z2) / 3)),
        y * Math.sqrt(Math.max(0, 1 - z2 / 2 - x2 / 2 + (z2 * x2) / 3)),
        z * Math.sqrt(Math.max(0, 1 - x2 / 2 - y2 / 2 + (x2 * y2) / 3)),
    );
    return out.normalize();
};

export const CUBE_SPHERE_GLSL = /* glsl */ `
uniform vec3 uFaceN[6];
uniform vec3 uFaceT[6];
uniform vec3 uFaceB[6];

vec3 dirAt(int face, vec2 uv) {
    vec3 c = uFaceN[face] + uv.x * uFaceT[face] + uv.y * uFaceB[face];
    vec3 c2 = c * c;
    vec3 s = vec3(
        c.x * sqrt(max(0.0, 1.0 - c2.y * 0.5 - c2.z * 0.5 + c2.y * c2.z / 3.0)),
        c.y * sqrt(max(0.0, 1.0 - c2.z * 0.5 - c2.x * 0.5 + c2.z * c2.x / 3.0)),
        c.z * sqrt(max(0.0, 1.0 - c2.x * 0.5 - c2.y * 0.5 + c2.x * c2.y / 3.0))
    );
    return normalize(s);
}
`;

export const faceUniforms = () => ({
    uFaceN: { value: FACE_N.map((v) => new THREE.Vector3(...v)) },
    uFaceT: { value: FACE_T.map((v) => new THREE.Vector3(...v)) },
    uFaceB: { value: FACE_B.map((v) => new THREE.Vector3(...v)) },
});

/**
 * One chunk's grid, shared by every chunk of a planet. `position` holds the
 * grid coordinate (x, y in [0, 1]) and z = 1 for skirt vertices, which the
 * shader drops below the surface to hide cracks between chunks of different
 * sizes.
 */
export const buildChunkGeometry = (gridSize: number, maxChunks: number) => {
    const n = gridSize;
    const positions: number[] = [];
    const indices: number[] = [];
    const vertex = (i: number, j: number, skirt: number) => {
        positions.push(i / n, j / n, skirt);
        return positions.length / 3 - 1;
    };
    const grid: number[][] = [];
    for (let j = 0; j <= n; j++) {
        grid[j] = [];
        for (let i = 0; i <= n; i++) grid[j][i] = vertex(i, j, 0);
    }
    for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
            const a = grid[j][i];
            const b = grid[j][i + 1];
            const c = grid[j + 1][i + 1];
            const d = grid[j + 1][i];
            indices.push(a, b, c, a, c, d);
        }
    }
    // Skirts, wound to face outwards from the chunk.
    const bottom = grid[0].map((_, i) => vertex(i, 0, 1));
    const top = grid[n].map((_, i) => vertex(i, n, 1));
    const left = grid.map((_, j) => vertex(0, j, 1));
    const right = grid.map((_, j) => vertex(n, j, 1));
    for (let i = 0; i < n; i++) {
        const a = grid[0][i], b = grid[0][i + 1], a2 = bottom[i], b2 = bottom[i + 1];
        indices.push(a, a2, b2, a, b2, b);
        const c = grid[n][i], d = grid[n][i + 1], c2 = top[i], d2 = top[i + 1];
        indices.push(c, d2, c2, c, d, d2);
    }
    for (let j = 0; j < n; j++) {
        const a = grid[j][0], b = grid[j + 1][0], a2 = left[j], b2 = left[j + 1];
        indices.push(a, b2, a2, a, b, b2);
        const c = grid[j][n], d = grid[j + 1][n], c2 = right[j], d2 = right[j + 1];
        indices.push(c, c2, d2, c, d2, d);
    }

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const chunkData = new Float32Array(maxChunks * 4);
    const chunkAttribute = new THREE.InstancedBufferAttribute(chunkData, 4);
    chunkAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aChunk', chunkAttribute);
    geometry.instanceCount = 0;
    // The mesh is never frustum-culled as a whole; chunks are culled here.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    return geometry;
};

export interface ChunkSelection {
    radius: number;
    minHeight: number;
    maxHeight: number;
    /** Camera position relative to the planet centre. */
    cameraLocal: THREE.Vector3;
    /** Planet centre in scene coordinates, for frustum tests. */
    planetScene: THREE.Vector3;
    frustum: THREE.Frustum;
    splitFactor: number;
    maxDepth: number;
}

const direction = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();
const sphere = new THREE.Sphere();

/**
 * Walks the six quadtrees and writes the chunks to draw into `out` as
 * (face, u0, v0, size) quadruples. Returns how many were written.
 */
export const selectChunks = (params: ChunkSelection, out: Float32Array) => {
    const { radius, minHeight, maxHeight, cameraLocal, planetScene, frustum, splitFactor, maxDepth } = params;
    const maxChunks = out.length / 4;
    const cameraDistance = cameraLocal.length();
    cameraDirection.copy(cameraLocal).divideScalar(Math.max(cameraDistance, 1e-6));
    const rMin = radius + minHeight;
    const rMax = radius + maxHeight;
    const horizon = cameraDistance > rMin
        ? Math.acos(Math.min(1, rMin / cameraDistance)) + Math.acos(Math.min(1, rMin / rMax))
        : Math.PI;
    let count = 0;

    const visit = (face: number, u0: number, v0: number, size: number, depth: number) => {
        if (count >= maxChunks) return;
        faceDirection(face, u0 + size / 2, v0 + size / 2, direction);
        const worldSize = size * 0.785 * radius;
        const angularRadius = Math.min(Math.PI, (worldSize * 0.8) / radius);
        const angle = Math.acos(THREE.MathUtils.clamp(direction.dot(cameraDirection), -1, 1));
        if (angle - angularRadius > horizon) return;

        sphere.center.copy(direction).multiplyScalar(radius).add(planetScene);
        sphere.radius = worldSize * 0.8 + (maxHeight - minHeight);
        if (!frustum.intersectsSphere(sphere)) return;

        const dx = direction.x * radius - cameraLocal.x;
        const dy = direction.y * radius - cameraLocal.y;
        const dz = direction.z * radius - cameraLocal.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (depth < maxDepth && distance < splitFactor * worldSize) {
            const half = size / 2;
            visit(face, u0, v0, half, depth + 1);
            visit(face, u0 + half, v0, half, depth + 1);
            visit(face, u0, v0 + half, half, depth + 1);
            visit(face, u0 + half, v0 + half, half, depth + 1);
            return;
        }
        const offset = count * 4;
        out[offset] = face;
        out[offset + 1] = u0;
        out[offset + 2] = v0;
        out[offset + 3] = size;
        count += 1;
    };

    for (let face = 0; face < 6; face++) visit(face, -1, -1, 2, 0);
    return count;
};

/** Converts a unit direction to (face, u, v). Used to find the chunk under a point. */
export const directionToFace = (d: THREE.Vector3) => {
    const ax = Math.abs(d.x);
    const ay = Math.abs(d.y);
    const az = Math.abs(d.z);
    if (ax >= ay && ax >= az) return d.x > 0 ? 0 : 1;
    if (ay >= az) return d.y > 0 ? 2 : 3;
    return d.z > 0 ? 4 : 5;
};
