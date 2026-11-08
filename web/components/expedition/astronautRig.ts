import * as THREE from 'three';

/**
 * Small pieces of the explorer's procedural animation (Astronaut.tsx): turning
 * a bone in world terms, and bending a leg so its ankle reaches a point (two-bone
 * IK). All in world space, on bones whose parents' matrices are current; each
 * call brings the bone's own subtree up to date.
 */

const worldQ = new THREE.Quaternion();
const parentQ = new THREE.Quaternion();
const turnQ = new THREE.Quaternion();

/** Turn a bone by a world-space rotation (about its own joint); its children go with it. */
export const turnBone = (bone: THREE.Object3D, rotation: THREE.Quaternion) => {
    const parent = bone.parent;
    if (!parent) return;
    parent.getWorldQuaternion(parentQ);
    worldQ.copy(parentQ).multiply(bone.quaternion).premultiply(rotation);
    bone.quaternion.copy(parentQ.invert().multiply(worldQ));
    bone.updateMatrixWorld(true);
};

/** Turn a bone about a world axis (a unit vector) by an angle in radians. */
export const turnBoneAbout = (bone: THREE.Object3D, axis: THREE.Vector3, angle: number) => {
    if (Math.abs(angle) < 1e-5) return;
    turnQ.setFromAxisAngle(axis, angle);
    turnBone(bone, turnQ);
};

/** Give a bone this world rotation; its children go with it. */
export const setWorldQuaternion = (bone: THREE.Object3D, rotation: THREE.Quaternion) => {
    const parent = bone.parent;
    if (!parent) return;
    parent.getWorldQuaternion(parentQ);
    bone.quaternion.copy(parentQ.invert().multiply(rotation));
    bone.updateMatrixWorld(true);
};

const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const T = new THREE.Vector3();
const toTarget = new THREE.Vector3();
const along = new THREE.Vector3();
const pole = new THREE.Vector3();
const knee = new THREE.Vector3();
const from = new THREE.Vector3();
const to = new THREE.Vector3();
const footQ = new THREE.Quaternion();
const r1 = new THREE.Quaternion();

/**
 * Bend a leg (hip `upper`, knee `lower`, ankle `foot`) so the ankle moves
 * `weight` of the way to `target` (world). The knee stays in the plane it bends
 * in now (or bends towards `forward` if the leg is straight); the foot keeps its
 * turn in the world.
 */
export const solveLeg = (upper: THREE.Object3D, lower: THREE.Object3D, foot: THREE.Object3D, target: THREE.Vector3, weight: number, forward: THREE.Vector3) => {
    upper.getWorldPosition(A);
    lower.getWorldPosition(B);
    foot.getWorldPosition(C);
    T.copy(C).lerp(target, weight);
    const l1 = A.distanceTo(B);
    const l2 = B.distanceTo(C);
    toTarget.subVectors(T, A);
    const reach = toTarget.length();
    if (reach < 1e-5 || l1 < 1e-5 || l2 < 1e-5) return;
    const d = THREE.MathUtils.clamp(reach, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
    toTarget.divideScalar(reach);
    // The knee's side of the hip-to-ankle line.
    along.subVectors(C, A).normalize();
    pole.subVectors(B, A);
    pole.addScaledVector(along, -pole.dot(along));
    if (pole.lengthSq() < 1e-8 * l1 * l1) pole.copy(forward);
    pole.addScaledVector(toTarget, -pole.dot(toTarget));
    if (pole.lengthSq() < 1e-10) return;
    pole.normalize();
    const cos = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sin = Math.sqrt(1 - cos * cos);
    knee.copy(A).addScaledVector(toTarget, l1 * cos).addScaledVector(pole, l1 * sin);
    foot.getWorldQuaternion(footQ);
    // Swing the thigh so the knee goes to its new place...
    from.subVectors(B, A).normalize();
    to.subVectors(knee, A).normalize();
    r1.setFromUnitVectors(from, to);
    turnBone(upper, r1);
    // ...then the shin so the ankle reaches the target.
    lower.getWorldPosition(B);
    foot.getWorldPosition(C);
    from.subVectors(C, B).normalize();
    to.copy(A).addScaledVector(toTarget, d).sub(B).normalize();
    r1.setFromUnitVectors(from, to);
    turnBone(lower, r1);
    setWorldQuaternion(foot, footQ);
};
