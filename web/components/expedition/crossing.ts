import * as THREE from 'three';

/**
 * The crossing of the wormhole as a sequence drawn by the game (WormholeTransit.tsx draws the throat;
 * this is its script; what is said, and the score, are in voiceLines.ts). The Argo has already been
 * carried to the far mouth (Player.tsx) and waits there with the controls locked; the camera, the light
 * and the Argo as drawn follow these beats, each long enough for its line:
 *
 *   0    break-in: the throat's surface gives way, a ripple runs through space   (Kai: the hull's singing)
 *   1.2  tumble: down the spiral of light, the camera rolling round her
 *   5.0  (held here, still moving, while the other system is built behind the throat)
 *   5.0  the eye: a wide view, the throat ahead a dark eye ringed with light      (Noor: look at the light)
 *   9.9  pressure: lensing draws her out along the way through, afterimages      (ARGO: three g)
 *  12.8  rush: the far side's light, a point in the eye                           (Amara: there, the other side)
 *  15.6  white: the light floods in; she is a shadow against it; then out        (Dev: bringing us out)
 *
 * Times are sequence seconds (transit.t), which stop at the hold while loading; `clock` keeps running
 * and drives everything that must never stop moving (the gas, the drift of the camera).
 */
export const BEAT = {
    tumble: 1.2,
    hold: 5.0,
    eye: 5.0,
    pressure: 9.9,
    rush: 12.8,
    white: 15.6,
    out: 16.4,
    end: 17.0,
} as const;

export interface Transit {
    /** Sequence seconds (held at BEAT.hold while the other system loads). */
    t: number;
    /** Seconds since the crossing began, never held. */
    clock: number;
    /** Seconds spent held. */
    held: number;
    /** The mouth it comes out of. */
    to: string;
    /** The way through (game frame), and an up across it. */
    axis: THREE.Vector3;
    up: THREE.Vector3;
    /** Test harnesses only: freeze the sequence where it is. */
    hold?: boolean;
}

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

/** A camera pose about the Argo, in her lengths and degrees, in the throat's frame. */
interface Pose { dist: number; polar: number; az: number; roll: number; look: number; fov: number }

// Polar: angle from straight ahead (180: dead astern). Azimuth: round the way through from `up`.
const KEYS: { at: number; pose: Pose }[] = [
    { at: 0, pose: { dist: 1.46, polar: 158, az: 0, roll: 0, look: 0.4, fov: 64 } },
    { at: BEAT.tumble, pose: { dist: 1.38, polar: 148, az: 28, roll: -24, look: 0.5, fov: 70 } },
    { at: BEAT.hold, pose: { dist: 1.12, polar: 84, az: 128, roll: -72, look: 0.2, fov: 72 } },
    { at: BEAT.eye + 0.9, pose: { dist: 3.3, polar: 128, az: 214, roll: -66, look: 2.6, fov: 68 } },
    { at: BEAT.pressure - 0.4, pose: { dist: 3.0, polar: 124, az: 226, roll: -52, look: 2.4, fov: 68 } },
    { at: BEAT.pressure + 0.6, pose: { dist: 2.7, polar: 92, az: 300, roll: -28, look: -0.45, fov: 64 } },
    { at: BEAT.rush - 0.2, pose: { dist: 2.5, polar: 96, az: 318, roll: -18, look: -0.4, fov: 64 } },
    { at: BEAT.rush + 0.5, pose: { dist: 1.3, polar: 156, az: 372, roll: -60, look: 3.0, fov: 80 } },
    { at: BEAT.white + 0.7, pose: { dist: 1.22, polar: 158, az: 380, roll: -150, look: 3.0, fov: 84 } },
    { at: BEAT.out + 0.12, pose: { dist: 1.46, polar: 158, az: 360, roll: -360, look: 0.4, fov: 64 } },
];

const pose = (t: number, held: number, calm: boolean): Pose => {
    let i = 0;
    while (i < KEYS.length - 1 && t >= KEYS[i + 1].at) i++;
    const a = KEYS[i];
    const b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const k = b.at > a.at ? smooth(0, 1, (t - a.at) / (b.at - a.at)) : 1;
    const mix = (x: number, y: number) => x + (y - x) * k;
    const p: Pose = {
        dist: mix(a.pose.dist, b.pose.dist), polar: mix(a.pose.polar, b.pose.polar), az: mix(a.pose.az, b.pose.az),
        roll: mix(a.pose.roll, b.pose.roll), look: mix(a.pose.look, b.pose.look), fov: mix(a.pose.fov, b.pose.fov),
    };
    // Held: still drifting round her, never still, never on a loop you can see.
    if (t >= BEAT.hold) p.az += 9 * Math.min(held, 1e4);
    if (held > 0) {
        // (Faded out over the second after the hold, from where it was: no jump.)
        const fade = smooth(0, 1.5, held) * (1 - smooth(BEAT.hold, BEAT.hold + 0.9, t));
        p.polar += fade * (16 * Math.sin(held * 0.21) + 6 * Math.sin(held * 0.53));
        p.roll += fade * (28 * Math.sin(held * 0.31));
        p.dist *= 1 + fade * 0.14 * Math.sin(held * 0.27);
    }
    // The tumble, a slow sway of the whole view on top.
    p.roll += 9 * Math.sin(t * 0.9) * smooth(0.6, 2, t) * (1 - smooth(BEAT.out - 0.4, BEAT.out, t));
    if (calm) {
        p.roll = 0;
        p.az = Math.min(p.az, 120);
    }
    return p;
};

const side = new THREE.Vector3();
const around = new THREE.Vector3();
const offset = new THREE.Vector3();
const forward = new THREE.Vector3();
const rollTurn = new THREE.Quaternion();

/**
 * Where the camera is in the crossing (scene coordinates), what it looks at and its up and field of
 * view: about the Argo's centre, `length` her length.
 */
export const crossingCamera = (transit: Transit, centre: THREE.Vector3, length: number, calm: boolean, out: { position: THREE.Vector3; target: THREE.Vector3; up: THREE.Vector3; fov: number }) => {
    const p = pose(transit.t, transit.held, calm);
    const A = transit.axis;
    side.crossVectors(A, transit.up).normalize();
    const az = THREE.MathUtils.degToRad(p.az);
    const polar = THREE.MathUtils.degToRad(p.polar);
    around.copy(transit.up).multiplyScalar(Math.cos(az)).addScaledVector(side, Math.sin(az));
    offset.copy(A).multiplyScalar(Math.cos(polar)).addScaledVector(around, Math.sin(polar)).multiplyScalar(p.dist * length);
    out.position.copy(centre).add(offset);
    out.target.copy(centre).addScaledVector(A, p.look * length);
    // Up: away from the way through on the camera's side, turned by the roll about the line of sight.
    forward.copy(out.target).sub(out.position).normalize();
    out.up.copy(around).addScaledVector(forward, -around.dot(forward)).normalize();
    if (out.up.lengthSq() < 0.5) out.up.copy(transit.up);
    rollTurn.setFromAxisAngle(forward, THREE.MathUtils.degToRad(p.roll));
    out.up.applyQuaternion(rollTurn);
    out.fov = p.fov;
    return out;
};

/** How the throat is drawn at this moment (WormholeTransit.tsx). */
export interface ThroatLook {
    /** Distance from the Argo to the narrowest point, in throat radii. */
    throat: number;
    /** How brightly the far side's light pours out of the eye (0..1), and the frame washed white (0..1). */
    glow: number;
    flash: number;
    /** The throat as a whole fading out to show the other side. */
    fade: number;
    /** The streaks of light rushing past. */
    streaks: number;
    /** How fast the gas streams past (throat radii a second). */
    flow: number;
}

export const throatLook = (t: number): ThroatLook => {
    const approach = smooth(BEAT.pressure, BEAT.white + 0.4, t);
    return {
        throat: THREE.MathUtils.lerp(4.6, 0.25, approach * approach) - smooth(BEAT.white + 0.2, BEAT.out, t) * 0.9,
        glow: smooth(BEAT.rush, BEAT.white + 0.5, t) * 0.7 + smooth(BEAT.white, BEAT.white + 0.6, t) * 0.6,
        flash: smooth(BEAT.white + 0.45, BEAT.white + 0.75, t) * (1 - smooth(BEAT.out + 0.05, BEAT.end, t)) + 0.14 * (1 - smooth(0.0, 0.3, t)),
        fade: 1 - smooth(BEAT.out - 0.05, BEAT.out + 0.25, t),
        streaks: 0.55 + 0.45 * smooth(BEAT.pressure, BEAT.rush, t),
        flow: 0.9 + 1.6 * smooth(BEAT.pressure, BEAT.rush + 0.5, t),
    };
};

/** How the Argo is drawn: stretched by the lensing, doubled into afterimages, dark against the light. */
export const argoLook = (t: number, clock: number, calm: boolean) => {
    const pressure = smooth(BEAT.pressure, BEAT.pressure + 1.4, t) * (1 - smooth(BEAT.rush - 0.2, BEAT.rush + 0.5, t));
    const wobbleAmount = calm ? 0 : THREE.MathUtils.degToRad(5 + 5 * smooth(BEAT.rush, BEAT.white, t)) * smooth(0.3, 1.5, t) * (1 - smooth(BEAT.out - 0.3, BEAT.out, t));
    return {
        stretch: 1 + 0.9 * pressure,
        ghosts: pressure > 0.02 ? 6 : 0,
        ghostStrength: 0.5 * pressure,
        ghostStretch: 0.1 * pressure,
        shade: smooth(BEAT.white, BEAT.white + 0.5, t) * (1 - smooth(BEAT.out - 0.1, BEAT.out + 0.2, t)),
        yaw: wobbleAmount * Math.sin(clock * 0.83),
        pitch: wobbleAmount * 0.8 * Math.sin(clock * 0.61 + 1.3),
        roll: wobbleAmount * 1.4 * Math.sin(clock * 0.47 + 2.1),
    };
};

/**
 * While the throat covers the screen nothing behind it is drawn, but the sky photographs of the other
 * side (DeepSpace.tsx) still draw the whole scene six times each: a stall in the middle of the
 * flight. They wait for the moment the screen is white, where a stall cannot be seen.
 */
export const throatHidesStalls = (transit: Transit | null) => !transit || transit.t >= BEAT.white + 0.74;
/** The throat covers everything behind it (until it fades out at the far side). */
export const throatCovers = (transit: Transit | null) => !!transit && transit.t < BEAT.out - 0.1;

