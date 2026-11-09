import * as THREE from 'three';

/**
 * What the effects that bend space share (the crossing of the wormhole, the fall into TON 618, the
 * pulse drive's bubble): how the player's ship is stretched and doubled, and how the finished frame
 * is bent on screen. Each effect writes here every frame it is running and clears what it wrote when
 * it stops; Player.tsx (the ship), Afterimages.tsx (the ghosts) and ScreenWarp.tsx (the frame) read it.
 * When nothing is running, nothing here costs a draw: the ghosts and the screen pass are not mounted
 * and the ship's stretch is the identity.
 */

/** The ship (and the Argo with it, when she is the one flying) stretched along one line and doubled along it. */
export interface BodyWarp {
    /** How far the ship is drawn stretched along `axis` (1: not at all). Volume is kept: squeezed across by 1/sqrt. */
    stretch: number;
    /** The line it is stretched along (game frame, unit length). */
    axis: THREE.Vector3;
    /** A small turn of the drawn ship about its centre (the crossing's tumble), on top of the real heading. */
    wobble: THREE.Quaternion;
    /** The point it is stretched and turned about (scene coordinates: the floating origin's frame). */
    centre: THREE.Vector3;
    /** Afterimages: how many, how far apart (world units along `axis`, negative: behind), the first one's strength. */
    ghosts: number;
    ghostStep: number;
    ghostStrength: number;
    /** Each ghost stretched this much more than the one before it. */
    ghostStretch: number;
    /** Each ghost also shifted this far sideways (world units, across `axis`), fanning the trail out. */
    ghostSpread: THREE.Vector3;
    /** Colour of the afterimages' light (linear, may exceed 1 to bloom). */
    ghostColor: THREE.Color;
    /** How dark the ship is drawn against a bright light, 0..1 (a silhouette). */
    shade: number;
}

export const bodyWarp: BodyWarp = {
    stretch: 1,
    axis: new THREE.Vector3(0, 0, -1),
    wobble: new THREE.Quaternion(),
    centre: new THREE.Vector3(),
    ghosts: 0,
    ghostStep: 0,
    ghostStrength: 0,
    ghostStretch: 0,
    ghostSpread: new THREE.Vector3(),
    ghostColor: new THREE.Color(0.55, 0.8, 1.6),
    shade: 0,
};

export const clearBodyWarp = () => {
    bodyWarp.stretch = 1;
    bodyWarp.wobble.identity();
    bodyWarp.ghosts = 0;
    bodyWarp.ghostStrength = 0;
    bodyWarp.ghostSpread.set(0, 0, 0);
    bodyWarp.shade = 0;
};

export const bodyWarpActive = () => bodyWarp.stretch !== 1 || bodyWarp.ghosts > 0 || bodyWarp.shade > 0 || bodyWarp.wobble.w < 0.999999;

const along = new THREE.Matrix4();
const turn = new THREE.Matrix4();
const shift = new THREE.Matrix4();

/**
 * A stretch of `s` along the unit `axis` about `centre`, keeping volume (1/sqrt(s) across), after a
 * turn about the same centre: the tidal deformation of a body to first order, which is a stretch along
 * the line to the mass and a squeeze across it.
 */
export const stretchMatrix = (axis: THREE.Vector3, s: number, centre: THREE.Vector3, wobble: THREE.Quaternion | null, out: THREE.Matrix4) => {
    const across = 1 / Math.sqrt(s);
    const k = s - across;
    const x = axis.x;
    const y = axis.y;
    const z = axis.z;
    // across * I + (s - across) * a a^T
    along.set(
        across + k * x * x, k * x * y, k * x * z, 0,
        k * y * x, across + k * y * y, k * y * z, 0,
        k * z * x, k * z * y, across + k * z * z, 0,
        0, 0, 0, 1,
    );
    if (wobble) along.multiply(turn.makeRotationFromQuaternion(wobble));
    shift.makeTranslation(-centre.x, -centre.y, -centre.z);
    out.copy(along).multiply(shift);
    shift.makeTranslation(centre.x, centre.y, centre.z);
    return out.premultiply(shift);
};

/** Ripples in space on screen: a ring that runs out from a point. */
export interface Ripple {
    /** Where it starts, in the frame's 0..1 coordinates. */
    centre: THREE.Vector2;
    /** Seconds since it began, and how long it runs. */
    age: number;
    life: number;
    /** Radius it starts from and runs out to, in screen heights. */
    from: number;
    to: number;
    /** How hard it bends the light, at its start. */
    strength: number;
}

/**
 * How the finished frame is bent (ScreenWarp.tsx). Coordinates are the frame's 0..1; lengths are in
 * screen heights.
 */
export interface ScreenFx {
    /** The warp bubble: the sky outside it drawn in towards the heading (`apex`), by this much (may go below 0 for a moment as it snaps back). */
    compress: number;
    apex: THREE.Vector2;
    /** The bubble round the ship: nothing inside it is moved; its wall is a thin lens. */
    bubble: THREE.Vector2;
    bubbleRadius: number;
    wall: number;
    /** Doppler shift of the light outside the bubble: blue towards the heading, red away from it (0..1). */
    shift: number;
    ripples: Ripple[];
    /** The whole frame washed with white (0..1). */
    flash: number;
}

export const screenFx: ScreenFx = {
    compress: 0,
    apex: new THREE.Vector2(0.5, 0.5),
    bubble: new THREE.Vector2(0.5, 0.5),
    bubbleRadius: 0.1,
    wall: 0,
    shift: 0,
    ripples: [],
    flash: 0,
};

/** Start a ripple (at most two run at once: the oldest makes way). */
export const addRipple = (centre: THREE.Vector2, strength: number, life = 0.75, from = 0.05, to = 1.3) => {
    if (screenFx.ripples.length >= 2) screenFx.ripples.shift();
    screenFx.ripples.push({ centre: centre.clone(), age: 0, life, from, to, strength });
};

/** Is the frame being bent at all (the screen pass is mounted only while it is)? */
export const screenFxActive = () => Math.abs(screenFx.compress) > 0.004 || screenFx.wall > 0.004 || screenFx.ripples.length > 0
    || screenFx.flash > 0.002 || screenFx.shift > 0.004;

/** Age the ripples (once a frame, by the screen pass). */
export const ageRipples = (dt: number) => {
    for (const ripple of screenFx.ripples) ripple.age += dt;
    screenFx.ripples = screenFx.ripples.filter((ripple) => ripple.age < ripple.life);
};

const projected = new THREE.Vector3();
/** Where a point (scene coordinates) falls in the frame, 0..1; false when it is behind the camera. */
export const toFrame = (point: THREE.Vector3, camera: THREE.Camera, out: THREE.Vector2) => {
    projected.copy(point).applyMatrix4(camera.matrixWorldInverse);
    const behind = projected.z > 0;
    projected.applyMatrix4(camera.projectionMatrix);
    out.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
    return !behind;
};
