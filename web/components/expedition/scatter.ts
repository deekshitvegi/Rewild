import * as THREE from 'three';
import { hash3, hashToUnit } from './noise';
import { faceDirection, FACE_N, FACE_T, FACE_B } from './terrain';

/**
 * Deterministic placement of things on a planet's surface. The surface is cut
 * into small square cells on the cube-sphere faces; every cell hashes to the
 * same contents on every visit, so a crystal or a tree is always in the same
 * place, and only cells near the player are ever looked at.
 */
export interface SurfaceCell {
    face: number;
    i: number;
    j: number;
    /** Size of a cell in face coordinates. */
    size: number;
}

/** Plain (gnomonic) face coordinates of a direction on one face's plane, or null if it faces away. */
const gnomonic = (face: number, d: THREE.Vector3) => {
    const n = FACE_N[face];
    const along = d.x * n[0] + d.y * n[1] + d.z * n[2];
    if (along <= 0.2) return null;
    const t = FACE_T[face];
    const b = FACE_B[face];
    const px = d.x / along;
    const py = d.y / along;
    const pz = d.z / along;
    return {
        u: px * t[0] + py * t[1] + pz * t[2],
        v: px * b[0] + py * b[1] + pz * b[2],
    };
};

const probe = new THREE.Vector3();

/**
 * Face coordinates (u, v) whose faceDirection() is `d`. The cube-to-sphere
 * warp has no simple inverse, so start from the plain projection and correct
 * it a few times; the warp is gentle and this converges quickly.
 */
export const faceCoordinates = (face: number, d: THREE.Vector3) => {
    const target = gnomonic(face, d);
    if (!target) return null;
    let u = target.u;
    let v = target.v;
    for (let k = 0; k < 6; k++) {
        const g = gnomonic(face, faceDirection(face, u, v, probe));
        if (!g) break;
        u += target.u - g.u;
        v += target.v - g.v;
    }
    return { u, v };
};

/** Cells of a given depth within `reach` world units of a direction. */
export const cellsNear = (direction: THREE.Vector3, radius: number, depth: number, reach: number): SurfaceCell[] => {
    const size = 2 / 2 ** depth;
    const worldSize = size * 0.785 * radius;
    const span = Math.ceil(reach / worldSize) + 1;
    const cells: SurfaceCell[] = [];
    for (let face = 0; face < 6; face++) {
        const p = faceCoordinates(face, direction);
        if (!p) continue;
        if (Math.abs(p.u) > 1 + (span * size) || Math.abs(p.v) > 1 + (span * size)) continue;
        const ci = Math.floor((p.u + 1) / size);
        const cj = Math.floor((p.v + 1) / size);
        const count = 2 ** depth;
        for (let j = cj - span; j <= cj + span; j++) {
            if (j < 0 || j >= count) continue;
            for (let i = ci - span; i <= ci + span; i++) {
                if (i < 0 || i >= count) continue;
                cells.push({ face, i, j, size });
            }
        }
    }
    return cells;
};

export const cellKey = (cell: SurfaceCell) => `${cell.face}:${cell.i}:${cell.j}`;

/** A stable random number in [0, 1) for slot `n` of a cell and a salt. */
export const cellRandom = (cell: SurfaceCell, seed: number, salt: number) =>
    hashToUnit(hash3(cell.i + 131072 * (cell.face + 1), cell.j + 7 * salt, salt * 977 + 13, seed >>> 0));

/** Unit direction of a point at fraction (fu, fv) inside the cell. */
export const cellPoint = (cell: SurfaceCell, fu: number, fv: number, out: THREE.Vector3) =>
    faceDirection(cell.face, -1 + (cell.i + fu) * cell.size, -1 + (cell.j + fv) * cell.size, out);
