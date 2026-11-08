import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useEnvironmentOn, useModel } from './models';
import { applyLivery, type Livery } from './livery';
import { groundHeight } from './environment';
import type { WalkerState } from './walking';
import { solveLeg, turnBone, turnBoneAbout } from './astronautRig';

/**
 * The explorer on foot: a white and grey suit with a large backpack, a dark
 * visor, a jetpack and a handheld mining tool. Feet at the origin, facing -Z.
 *
 * The sculpted, rigged model (models/expedition/astronaut.glb) is drawn once
 * it has loaded; until then, and if it cannot load, a figure built from
 * primitives stands in. Its motions are real motion capture (the CMU Graphics
 * Lab database) and Quaternius's animation library, carried onto its skeleton
 * by source_assets/astronaut (see its README), each clip knowing its own speed
 * and stride. They are played in layers, the way games do it:
 *
 * - on foot, the walk, brisk walk, jog, run and sprint are blended by the speed
 *   over the ground and kept in step with one another (one shared stride phase),
 *   so the feet do not slide at any speed and nothing switches with a jump; in
 *   weak gravity the lunar lope (the jog, retimed for the Moon: long floating
 *   flights) takes over;
 * - standing, a breathing idle, with now and then a weight shift, a look round,
 *   a stretch or a glance at the wrist, never on a fixed beat;
 * - jumps, landings, falls, swimming, gathering and resting as one-shot or
 *   looping clips cross-faded over the top;
 * - then a procedural pass every frame: the whole body leans into acceleration
 *   and turns (a person keeps their balance that way), the chest leans into a
 *   climb and back on a descent, each foot is set on the ground under it (two-bone
 *   IK, the hips lowered so the lower foot reaches), the head and chest turn
 *   towards where the player looks, the chest breathes (faster after running),
 *   and the upper body and pack lag a little behind each footfall.
 */

const DEV = import.meta.env.DEV;

/** The rigged model is 1.77 tall; the explorer is drawn a little taller. */
const MODEL_HEIGHT = 1.9;

/** What the explorer is doing, as far as the animation is concerned. */
export type Motion = 'idle' | 'walk' | 'run' | 'swim' | 'tread' | 'air' | 'jump' | 'land' | 'down' | 'gather' | 'sit' | 'eat' | 'hang' | 'climb' | 'grab';

/** Motions that are on foot: played by the locomotion and idle layers, not as clips. */
const ON_FOOT: ReadonlySet<Motion> = new Set(['idle', 'walk', 'run']);

/**
 * Which part of which clip each action plays. A looping part repeats; a
 * one-shot part plays once from its start, each time the motion begins, and
 * holds its last frame. The jump clip is cut in two: the crouch and spring up
 * to the top of the leap (held while airborne), then the landing.
 */
interface Segment {
    clip: string; from: number; to: number; loop: boolean;
    /** Played this many times faster until the clip reaches `until` (a crouch fitted to the walker's). */
    rate?: number; until?: number;
}
// An action whose clip the model lacks falls back along this list.
const FALLBACK: Partial<Record<Motion, Motion>> = { jump: 'air', land: 'idle', down: 'air', gather: 'idle', sit: 'idle', eat: 'sit', hang: 'air', climb: 'air', grab: 'air', air: 'walk', idle: 'walk', run: 'walk', swim: 'walk', tread: 'walk' };

/** What the motion pipeline says about a clip (glTF extras, three.js clip.userData). */
interface ClipInfo {
    kind?: 'cycle' | 'loop' | 'once';
    /** Cycles: metres a second and metres a stride, at the model's own size. */
    speed?: number;
    stride?: number;
    /** Retimed for this gravity (m/s²): the lunar lope. */
    gravity?: number;
    /** Phases (0..1) where each foot is down. */
    feet?: [number, number][][];
}

interface Clip {
    action: THREE.AnimationAction;
    duration: number;
    info: ClipInfo;
    /** Phases (0..1) where the feet pass each other: where a stride can stop. */
    rests: number[];
    time: number;
    /** The action layer's own cross-fade weight for this clip. */
    actionWeight: number;
}

/** A clip of the locomotion blend: its speed and stride in the game's metres. */
interface Gait { name: string; clip: Clip; speed: number; stride: number }

interface Bones {
    hips: THREE.Bone; spine2: THREE.Bone; spine1: THREE.Bone; spine: THREE.Bone; neck: THREE.Bone; head: THREE.Bone;
    leftShoulder: THREE.Bone; rightShoulder: THREE.Bone;
    leftUpLeg: THREE.Bone; leftLeg: THREE.Bone; leftFoot: THREE.Bone;
    rightUpLeg: THREE.Bone; rightLeg: THREE.Bone; rightFoot: THREE.Bone;
}

interface Rig {
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    clips: Map<string, Clip>;
    segments: Map<Motion, Segment>;
    /** Earth gaits by speed, and the low-gravity ones. */
    gaits: Gait[];
    lopes: Gait[];
    /** A second take of a gait ('walk-b' for 'walk'): the two are mixed in a slowly wandering share, so no two strides are the same. */
    variants: Map<string, string>;
    idles: string[];
    bones: Bones | null;
    /** The ankle's height above the ground standing (model units, before scaling). */
    ankleRest: number;
    arm: THREE.Bone | null;
    forearm: THREE.Bone | null;
    hand: THREE.Bone | null;
    /** Both arms (upper arm, forearm, hand), where the rig has them. */
    arms: [THREE.Bone, THREE.Bone, THREE.Bone][];
}

/** Moments in the jump clip, measured from its hips: lift-off, the top, touchdown. */
interface JumpMarks { bottom: number; takeoff: number; apex: number; touchdown: number }

/** The longest stretch of a clip (0..1) with neither foot down, from the pipeline's contact phases. */
const flightOf = (feet: [number, number][][]) => {
    const down = (t: number) => feet.some((side) => side.some(([on, off]) => t >= on - 1e-3 && t <= off + 1e-3));
    let best: [number, number] | null = null;
    let start = -1;
    for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        const air = i < 200 && !down(t);
        if (air && start < 0) start = t;
        if (!air && start >= 0) {
            if (!best || t - start > best[1] - best[0]) best = [start, t];
            start = -1;
        }
    }
    return best;
};

/**
 * A clip made ready to play where the explorer is.
 *
 * Clips from the motion pipeline (userData.kind set) are already in place: a
 * cycle's steady travel is out of its hips, a one-shot starts over the feet.
 * Older clips get the same treatment here: any steady travel of the hips over a
 * looping clip is taken out, so the body does not slide ahead and jump back each
 * time it loops (the walker moves the explorer, the clip only moves the limbs);
 * one-shot clips start at the explorer's feet. The jump keeps its crouches but
 * not its rise: the jump itself lifts the explorer, by the world's gravity.
 */
const prepareClip = (source: THREE.AnimationClip, name: string, rest: THREE.Vector3) => {
    const copy = source.clone();
    const made = !!(source.userData as ClipInfo).kind;
    let marks: JumpMarks | null = null;
    const oneShot = name === 'jump' || name === 'grab' || name === 'knockdown' || name === 'pickup';
    for (const track of copy.tracks) {
        if (!/hips\.position$/i.test(track.name) || track.times.length < 2) continue;
        const values = track.values;
        const count = track.times.length;
        const last = (count - 1) * 3;
        const span = track.times[count - 1] - track.times[0];
        if (!made && oneShot) {
            // Start over the feet.
            const dx = values[0] - rest.x;
            const dz = values[2] - rest.z;
            for (let i = 0; i < count; i++) { values[i * 3] -= dx; values[i * 3 + 2] -= dz; }
        }
        const drift = (axis: number) => {
            const amount = values[last + axis] - values[axis];
            for (let i = 0; i < count; i++) values[i * 3 + axis] -= amount * ((track.times[i] - track.times[0]) / span);
        };
        if (!made && !oneShot) { drift(0); drift(2); }
        if (!made && name === 'climb') drift(1);
        if (name === 'jump' || name === 'land-heavy') {
            const standing = values[1];
            let bottom = 0;
            for (let i = 1; i < count * 0.5; i++) if (values[i * 3 + 1] < values[bottom * 3 + 1]) bottom = i;
            let apex = bottom;
            for (let i = bottom; i < count; i++) if (values[i * 3 + 1] > values[apex * 3 + 1]) apex = i;
            let takeoff = bottom;
            while (takeoff < apex && values[takeoff * 3 + 1] < standing + 2) takeoff++;
            let touchdown = apex;
            while (touchdown < count - 1 && values[touchdown * 3 + 1] > standing + 2) touchdown++;
            let times = { bottom: track.times[bottom], takeoff: track.times[takeoff], apex: track.times[apex], touchdown: track.times[touchdown] };
            // Captured clips know when the feet leave the ground and come back to it: better than the hips' height.
            const flight = made && source.userData.feet ? flightOf((source.userData as ClipInfo).feet!) : null;
            if (flight) {
                const span = track.times[count - 1];
                const at = (t: number) => Math.min(count - 1, Math.max(0, Math.round((t / span) * (count - 1))));
                const lift = at(flight[0] * span);
                const land = at(flight[1] * span);
                let low = 0;
                for (let i = 0; i < lift; i++) if (values[i * 3 + 1] < values[low * 3 + 1]) low = i;
                let top = lift;
                for (let i = lift; i <= land; i++) if (values[i * 3 + 1] > values[top * 3 + 1]) top = i;
                times = { bottom: track.times[low], takeoff: flight[0] * span, apex: track.times[top], touchdown: flight[1] * span };
            }
            if (name === 'jump') marks = times;
            // Keep the crouches, drop the leap: never higher than standing.
            for (let i = 0; i < count; i++) values[i * 3 + 1] = Math.min(values[i * 3 + 1], standing);
        }
    }
    return { clip: copy, marks };
};

/** Moments (0..1 of the clip) where the two ankles are closest: the feet passing, where a stride can stop. */
const findRests = (rig: { root: THREE.Object3D; mixer: THREE.AnimationMixer }, clips: Map<string, Clip>, clip: Clip, left: THREE.Object3D, right: THREE.Object3D) => {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    clips.forEach((c) => c.action.setEffectiveWeight(c === clip ? 1 : 0));
    const samples: { t: number; gap: number }[] = [];
    const n = 60;
    for (let i = 0; i < n; i++) {
        clip.action.time = (i / n) * clip.duration;
        rig.mixer.update(0);
        rig.root.updateMatrixWorld(true);
        samples.push({ t: i / n, gap: left.getWorldPosition(a).distanceTo(right.getWorldPosition(b)) });
    }
    const gaps = samples.map((s) => s.gap);
    const low = Math.min(...gaps);
    const high = Math.max(...gaps);
    const rests: number[] = [];
    samples.forEach((s, i) => {
        const before = samples[(i + n - 1) % n].gap;
        const after = samples[(i + 1) % n].gap;
        if (s.gap < before && s.gap <= after && s.gap < low + (high - low) * 0.4) {
            const last = rests[rests.length - 1];
            if (last === undefined || s.t - last > 0.2) rests.push(s.t);
        }
    });
    return rests.length ? rests : [0];
};

/**
 * A copy of the model with its own skeleton and animation mixer, every clip
 * ready to blend; the gaits sorted by speed.
 */
const buildRig = (gltf: GLTF): Rig | null => {
    if (!gltf.animations.length) return null;
    const root = cloneSkinned(gltf.scene);
    root.traverse((object) => { object.frustumCulled = false; });
    const mixer = new THREE.AnimationMixer(root);
    const bone = (name: string) => (root.getObjectByName(name) as THREE.Bone | undefined) ?? null;
    const rest = bone('Hips')?.position.clone() ?? new THREE.Vector3();
    const clips = new Map<string, Clip>();
    let jumpMarks: JumpMarks | null = null;
    gltf.animations.forEach((source, index) => {
        // The model as first shipped had one unnamed walk.
        const name = gltf.animations.length === 1 && index === 0 ? 'walk' : source.name;
        const { clip: animation, marks } = prepareClip(source, name, rest);
        if (marks) jumpMarks = marks;
        const action = mixer.clipAction(animation);
        action.play();
        action.setEffectiveWeight(0);
        clips.set(name, { action, duration: animation.duration, info: animation.userData as ClipInfo, rests: [0], time: 0, actionWeight: 0 });
    });

    // The gaits: every cycle with a speed, slowest first.
    const gaits: Gait[] = [];
    const lopes: Gait[] = [];
    const variants = new Map<string, string>();
    clips.forEach((clip, name) => {
        const { kind, speed, stride, gravity } = clip.info;
        if (kind !== 'cycle' || !speed || !stride) return;
        const base = name.endsWith('-b') ? name.slice(0, -2) : null;
        if (base && clips.has(base)) { variants.set(base, name); return; }
        (gravity && gravity < 5 ? lopes : gaits).push({ name, clip, speed, stride });
    });
    gaits.sort((x, y) => x.speed - y.speed);
    lopes.sort((x, y) => x.speed - y.speed);
    const leftFoot = bone('LeftFoot');
    const rightFoot = bone('RightFoot');
    if (leftFoot && rightFoot) for (const g of [...gaits, ...lopes]) g.clip.rests = findRests({ root, mixer }, clips, g.clip, leftFoot, rightFoot);
    const idles = [...clips.keys()].filter((n) => n.startsWith('idle-'));

    // Each action's part of its clip.
    const segments = new Map<Motion, Segment>();
    const whole = (motion: Motion, clip: string, loop: boolean) => {
        const c = clips.get(clip);
        if (c) segments.set(motion, { clip, from: 0, to: c.duration, loop });
    };
    whole('walk', 'walk', true);
    whole('run', 'run', true);
    whole('idle', 'idle', true);
    whole('swim', 'swim', true);
    whole('tread', 'tread', true);
    whole('air', 'fall', true);
    whole('down', 'knockdown', false);
    whole('gather', 'pickup', false);
    whole('sit', 'rest', true);
    whole('eat', 'eat', true);
    whole('hang', 'hang', true);
    whole('climb', 'climb', true);
    whole('grab', 'grab', false);
    const jump = clips.get('jump');
    const marks = jumpMarks as JumpMarks | null;
    if (jump && marks) {
        // From just before the deepest crouch, sped up so the feet leave the ground when the walker does.
        const from = Math.max(0, Math.min(marks.takeoff - JUMP_LEAD, marks.bottom - 0.1));
        segments.set('jump', { clip: 'jump', from, to: marks.apex, loop: false, rate: Math.max(1, (marks.takeoff - from) / JUMP_LEAD), until: marks.takeoff });
        segments.set('land', { clip: 'jump', from: Math.max(marks.apex, marks.touchdown - 0.06), to: jump.duration, loop: false });
    }

    const need = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'].map(bone);
    const bones = need.every(Boolean) ? (() => {
        const [hips, spine2, spine1, spine, neck, head, leftShoulder, rightShoulder, leftUpLeg, leftLeg, leftFoot2, rightUpLeg, rightLeg, rightFoot2] = need as THREE.Bone[];
        return { hips, spine2, spine1, spine, neck, head, leftShoulder, rightShoulder, leftUpLeg, leftLeg, leftFoot: leftFoot2, rightUpLeg, rightLeg, rightFoot: rightFoot2 };
    })() : null;

    // Standing still, where the ankles are: the height the foot IK keeps them at.
    clips.forEach((c) => c.action.setEffectiveWeight(0));
    mixer.update(0);
    root.updateMatrixWorld(true);
    const ankle = new THREE.Vector3();
    const ankleRest = leftFoot ? leftFoot.getWorldPosition(ankle).y : 0.14;

    const start = clips.get('idle') ?? clips.get('walk')!;
    start.action.setEffectiveWeight(1);
    mixer.update(0);
    const arms = (['Left', 'Right'] as const)
        .map((side) => [bone(`${side}Arm`), bone(`${side}ForeArm`), bone(`${side}Hand`)])
        .filter((chain): chain is [THREE.Bone, THREE.Bone, THREE.Bone] => chain.every(Boolean));
    return { root, mixer, clips, segments, gaits, lopes, variants, idles, bones, ankleRest, arm: bone('RightArm'), forearm: bone('RightForeArm'), hand: bone('RightHand'), arms };
};

/** How long before lift-off the jump clip starts: the crouch the explorer springs from. */
export const JUMP_LEAD = 0.16;

/** The part to play for an action, following the fallbacks for clips the model lacks. */
const segmentFor = (rig: Rig, motion: Motion) => {
    let m: Motion | undefined = motion;
    for (let i = 0; i < 6 && m; i++) {
        const segment = rig.segments.get(m);
        if (segment) return segment;
        m = FALLBACK[m];
    }
    return rig.segments.get('walk') ?? rig.segments.values().next().value!;
};

/** The part an action plays: a heavy landing has a clip of its own. */
const actionSegmentFor = (rig: Rig, motion: Motion, heavy: boolean): Segment => {
    if (motion === 'land' && heavy) {
        const clip = rig.clips.get('land-heavy');
        if (clip) return { clip: 'land-heavy', from: 0, to: clip.duration, loop: false };
    }
    return segmentFor(rig, motion);
};

/**
 * Weights of the gaits for a speed (written into `out`), and the stride to keep
 * them in step: the neighbours either side of the speed share it by distance.
 * Slower than the slowest gait, its steps shorten; faster than the fastest, its
 * cadence rises.
 */
const blendGaits = (gaits: Gait[], speed: number, scale: number, share: number, out: Map<string, number>) => {
    if (!gaits.length || share <= 0) return 0;
    const first = gaits[0];
    if (speed <= first.speed * scale) {
        out.set(first.name, (out.get(first.name) ?? 0) + share);
        return first.stride * scale * (0.55 + 0.45 * Math.max(0, speed / (first.speed * scale)));
    }
    for (let i = 0; i < gaits.length - 1; i++) {
        const a = gaits[i];
        const b = gaits[i + 1];
        if (speed <= b.speed * scale) {
            const w = (speed - a.speed * scale) / ((b.speed - a.speed) * scale);
            out.set(a.name, (out.get(a.name) ?? 0) + share * (1 - w));
            out.set(b.name, (out.get(b.name) ?? 0) + share * w);
            return (a.stride + (b.stride - a.stride) * w) * scale;
        }
    }
    const last = gaits[gaits.length - 1];
    out.set(last.name, (out.get(last.name) ?? 0) + share);
    return last.stride * scale;
};

const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};
const approach = (value: number, target: number, rate: number, dt: number) => value + (target - value) * (1 - Math.exp(-rate * dt));

/** A critically damped spring towards a target (value, velocity); stiffness in 1/s. */
const spring = (s: { x: number; v: number }, target: number, stiffness: number, dt: number) => {
    const k = stiffness * stiffness;
    const c = 2 * stiffness;
    const steps = dt > 0.02 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
        s.v += (k * (target - s.x) - c * s.v) * h;
        s.x += s.v * h;
    }
    return s.x;
};

/** A damped oscillator settling to zero (value, velocity): natural frequency in rad/s, damping ratio. */
const oscillate = (s: { x: number; v: number }, frequency: number, damping: number, dt: number) => {
    const steps = dt > 0.02 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
        s.v += (-frequency * frequency * s.x - 2 * damping * frequency * s.v) * h;
        s.x += s.v * h;
    }
    return s.x;
};

const armFrom = new THREE.Vector3();
const armTo = new THREE.Vector3();
const aim = new THREE.Vector3();
const turn = new THREE.Quaternion();
const worldQuaternion = new THREE.Quaternion();
const parentQuaternion = new THREE.Quaternion();
const handWorld = new THREE.Vector3();
const toolAxis = new THREE.Vector3();
const limbWant = new THREE.Vector3();
const limbTurn = new THREE.Quaternion();
const noTurn = new THREE.Quaternion();

/** Swing a bone `weight` of the way from where it points (towards `child`) to `direction` (world, unit). */
const swingBone = (bone: THREE.Bone, child: THREE.Object3D, direction: THREE.Vector3, weight: number) => {
    bone.getWorldPosition(armFrom);
    child.getWorldPosition(armTo);
    const current = armTo.sub(armFrom).normalize();
    limbTurn.setFromUnitVectors(current, direction);
    turnBone(bone, noTurn.identity().slerp(limbTurn, weight));
};

/** Turn a bone (in world terms) so the segment to its child points along `direction`. */
const aimBone = (bone: THREE.Bone, child: THREE.Object3D, direction: THREE.Vector3) => {
    bone.getWorldPosition(armFrom);
    child.getWorldPosition(armTo);
    const current = armTo.sub(armFrom).normalize();
    turn.setFromUnitVectors(current, direction);
    bone.getWorldQuaternion(worldQuaternion).premultiply(turn);
    if (bone.parent) {
        bone.parent.getWorldQuaternion(parentQuaternion);
        bone.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion));
    }
    bone.updateMatrixWorld(true);
};

/** The height of the ground along a direction from the world's centre (environment.ts groundHeight by default). */
export type GroundProbe = (up: THREE.Vector3) => number;

export interface AstronautHandle {
    group: THREE.Group;
    /** Walk cycle: phase in radians and how strongly to swing (0..1). */
    setGait: (phase: number, amount: number) => void;
    /** What the explorer is doing: picks the clip. */
    setMotion: (motion: Motion) => void;
    setJetpack: (on: boolean) => void;
    setMining: (on: boolean) => void;
    /**
     * The walker this figure is (the one being played): its speed, turning,
     * the slope and the ground under each foot, the world's gravity and where
     * the player looks shape the motion. Without one, the figure stands and breathes.
     */
    setWalker: (walker: WalkerState | null, ground?: GroundProbe) => void;
    /** Where the mining beam leaves the tool, in world space. */
    toolTip: THREE.Object3D | null;
}

const suit = new THREE.MeshStandardMaterial({ color: '#e7e9ec', metalness: 0.1, roughness: 0.62 });
const suitDark = new THREE.MeshStandardMaterial({ color: '#7a8088', metalness: 0.3, roughness: 0.55 });
const visor = new THREE.MeshStandardMaterial({ color: '#2a1a08', metalness: 0.9, roughness: 0.12, emissive: '#6b3a10', emissiveIntensity: 0.35 });
const trim = new THREE.MeshStandardMaterial({ color: '#b3262c', metalness: 0.2, roughness: 0.5 });
const toolGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.2, 2.6), toneMapped: false });

const flameTexture = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,240,1)');
        g.addColorStop(0.3, 'rgba(255,190,90,0.85)');
        g.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    };
})();

// Scratch for the per-frame pass.
const groupWorld = new THREE.Vector3();
const groupQuat = new THREE.Quaternion();
const groupQuatInv = new THREE.Quaternion();
const upWorld = new THREE.Vector3();
const forwardWorld = new THREE.Vector3();
const rightWorld = new THREE.Vector3();
const velocityLocal = new THREE.Vector3();
const accel = new THREE.Vector3();
const footWorld = new THREE.Vector3();
const probe = new THREE.Vector3();
const centre = new THREE.Vector3();
const target = new THREE.Vector3();
const hipsWorld = new THREE.Vector3();
const normal = new THREE.Vector3();
const tilt = new THREE.Quaternion();
const footTilt = new THREE.Quaternion();
const lookFlat = new THREE.Vector3();
const weights = new Map<string, number>();

/** Per figure: what the layers and the procedural pass remember from frame to frame. */
const makeMemory = () => ({
    phase: 0,
    speed: 0,
    locomotion: 0,
    action: 0,
    idleTime: Math.random() * 8,
    variation: null as string | null,
    variationTime: 0,
    variationWeight: 0,
    lastVariation: '',
    still: 0,
    nextVariation: 3 + Math.random() * 5,
    lowGravity: 0,
    leap: false,
    variety: 0,
    seed: Math.random() * 10,
    forward: new THREE.Vector3(),
    hasForward: false,
    yawRate: 0,
    velocity: new THREE.Vector3(),
    hasVelocity: false,
    accel: new THREE.Vector3(),
    pitch: { x: 0, v: 0 },
    roll: { x: 0, v: 0 },
    slope: 0,
    drop: 0,
    lookYaw: { x: 0, v: 0 },
    lookPitch: { x: 0, v: 0 },
    glance: 0,
    glanceYaw: 0,
    glancePitch: 0,
    breath: Math.random() * Math.PI * 2,
    exertion: 0,
    pack: { x: 0, v: 0 },
    hipsY: 0,
    hipsV: 0,
    hipsHas: false,
    ik: 0,
    heavy: false,
});

export const Astronaut = forwardRef<AstronautHandle, { livery?: Livery }>(function Astronaut({ livery }, ref) {
    const { gl } = useThree();
    const model = useModel('astronaut');
    // The same suit for everyone, in its wearer's colours (livery.ts).
    const rig = useMemo(() => {
        const made = model ? buildRig(model) : null;
        if (made && livery) applyLivery(made.root, livery, true);
        return made;
    }, [model, livery]);
    const modelScale = useMemo(() => {
        if (!rig) return 1;
        const box = new THREE.Box3().setFromObject(rig.root);
        return MODEL_HEIGHT / Math.max(box.max.y - box.min.y, 0.01);
    }, [rig]);
    useEnvironmentOn(rig?.root ?? null, gl, 0.4);
    useEffect(() => () => { rig?.mixer.stopAllAction(); }, [rig]);
    const lastPhase = useRef(0);
    const lastMotion = useRef<Motion>('idle');
    const memory = useRef(makeMemory());
    const toolRef = useRef<THREE.Group>(null!);
    const groupRef = useRef<THREE.Group>(null!);
    const leanRef = useRef<THREE.Group>(null!);
    const leftArm = useRef<THREE.Group>(null!);
    const rightArm = useRef<THREE.Group>(null!);
    const leftLeg = useRef<THREE.Group>(null!);
    const rightLeg = useRef<THREE.Group>(null!);
    const body = useRef<THREE.Group>(null!);
    const flames = useRef<THREE.Sprite[]>([]);
    const toolTipRef = useRef<THREE.Object3D>(null);
    const state = useRef({ phase: 0, amount: 0, jet: false, mining: false, motion: 'idle' as Motion, walker: null as WalkerState | null, ground: null as GroundProbe | null });

    const geometries = useMemo(() => ({
        torso: new THREE.CapsuleGeometry(0.27, 0.42, 6, 14),
        helmet: new THREE.SphereGeometry(0.25, 24, 18),
        visor: new THREE.SphereGeometry(0.2, 20, 14, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.22, Math.PI * 0.5),
        pack: new THREE.BoxGeometry(0.5, 0.62, 0.3, 2, 2, 2),
        nozzle: new THREE.CylinderGeometry(0.07, 0.09, 0.14, 10),
        limb: new THREE.CapsuleGeometry(0.085, 0.42, 4, 10),
        leg: new THREE.CapsuleGeometry(0.1, 0.5, 4, 10),
        boot: new THREE.BoxGeometry(0.2, 0.12, 0.3),
        tool: new THREE.BoxGeometry(0.1, 0.12, 0.42),
        toolTip: new THREE.CylinderGeometry(0.035, 0.05, 0.1, 8).rotateX(Math.PI / 2),
        stripe: new THREE.BoxGeometry(0.56, 0.05, 0.02),
    }), []);
    const flameMaterial = useMemo(() => new THREE.SpriteMaterial({ map: flameTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
    useEffect(() => () => { Object.values(geometries).forEach((g) => g.dispose()); flameMaterial.dispose(); }, [geometries, flameMaterial]);

    useImperativeHandle(ref, () => ({
        get group() { return groupRef.current; },
        setGait: (phase: number, amount: number) => { state.current.phase = phase; state.current.amount = amount; },
        setMotion: (motion: Motion) => { state.current.motion = motion; },
        setJetpack: (on: boolean) => { state.current.jet = on; },
        setMining: (on: boolean) => { state.current.mining = on; },
        setWalker: (walker: WalkerState | null, ground?: GroundProbe) => {
            state.current.walker = walker;
            state.current.ground = ground ?? null;
        },
        get toolTip() { return toolTipRef.current; },
    }), []);

    useFrame(({ clock }, delta) => {
        const { phase, amount, jet, mining } = state.current;
        const flicker = 0.8 + Math.sin(clock.elapsedTime * 50) * 0.2;
        flames.current.forEach((f) => {
            f.visible = jet;
            f.scale.set(0.34 * flicker, 0.6 * flicker, 1);
        });
        if (rig) {
            const started = DEV ? performance.now() : 0;
            const dt = Math.min(delta, 0.1);
            if (dt <= 0) return;
            const mem = memory.current;
            const walker = state.current.walker;
            const group = groupRef.current;
            const motion = state.current.motion;

            // ---- what the body is doing
            const step = Math.max(0, phase - lastPhase.current);
            lastPhase.current = phase;
            group.updateMatrixWorld();
            group.getWorldPosition(groupWorld);
            group.getWorldQuaternion(groupQuat);
            groupQuatInv.copy(groupQuat).invert();
            upWorld.set(0, 1, 0).applyQuaternion(groupQuat);
            forwardWorld.set(0, 0, -1).applyQuaternion(groupQuat);
            rightWorld.set(1, 0, 0).applyQuaternion(groupQuat);
            let speed: number;
            let gravity = 9.81;
            if (walker) {
                velocityLocal.copy(walker.velocity).applyQuaternion(groupQuatInv);
                speed = Math.hypot(velocityLocal.x, velocityLocal.z);
                gravity = walker.body.gravity ?? 9.81;
            } else {
                // Only the stride phase is known: 1.55 radians a metre (walking.ts).
                velocityLocal.set(0, 0, 0);
                speed = amount > 0.05 ? step / (1.55 * dt) : 0;
            }
            // A jump from a run is a leap: the stride carries on through the air, slowed, instead of the standing jump.
            if (motion === 'jump' && lastMotion.current !== 'jump') mem.leap = mem.speed > 2.2;
            const leaping = mem.leap && motion === 'jump';
            const onFoot = (ON_FOOT.has(motion) && (!walker || walker.onGround)) || leaping;
            mem.speed = approach(mem.speed, onFoot ? speed : 0, 10, dt);
            // The Moon and the moons lope; Mars (3.7) still runs.
            mem.lowGravity = approach(mem.lowGravity, smooth(3.2, 1.8, gravity), 3, dt);
            const lowG = rig.lopes.length ? mem.lowGravity : 0;
            // Everything driven by gravity (a swinging arm, a settling body) is slower where it is weak.
            const pace = 1 - 0.3 * mem.lowGravity;

            // ---- the action layer (anything not on foot)
            const action = !ON_FOOT.has(motion) && !leaping;
            mem.action = approach(mem.action, action ? 1 : 0, motion === 'jump' ? 16 : 8, dt);
            if (motion !== lastMotion.current) {
                lastMotion.current = motion;
                if (action) {
                    // A long drop or a hard landing comes down heavily: the knees give, a hand goes out.
                    mem.heavy = motion === 'land' && !!walker && (walker.landedFrom > 0.9 || walker.impactTime < 0.2);
                    const segment = actionSegmentFor(rig, motion, mem.heavy);
                    const clip = rig.clips.get(segment.clip);
                    if (clip && !segment.loop) clip.time = segment.from;
                    else if (clip && (clip.time < segment.from || clip.time > segment.to)) clip.time = segment.from;
                }
            }
            let actionClip: string | null = null;
            let actionSegment: Segment | null = null;
            if (action || mem.action > 0.002) {
                const shown = action ? motion : 'idle';
                actionSegment = actionSegmentFor(rig, shown, mem.heavy);
                actionClip = actionSegment.clip;
            }
            rig.clips.forEach((clip, name) => {
                clip.actionWeight = approach(clip.actionWeight, name === actionClip && action ? 1 : 0, 8, dt);
                if (clip.actionWeight < 0.002) clip.actionWeight = 0;
            });
            if (action && actionSegment && actionClip) {
                const clip = rig.clips.get(actionClip)!;
                const quick = actionSegment.rate && actionSegment.until !== undefined && clip.time < actionSegment.until ? actionSegment.rate : 1;
                clip.time += dt * pace * quick;
                if (actionSegment.loop) {
                    const length = actionSegment.to - actionSegment.from;
                    if (clip.time > actionSegment.to) clip.time = actionSegment.from + ((clip.time - actionSegment.from) % length);
                } else {
                    clip.time = Math.min(clip.time, actionSegment.to);
                }
            }
            rig.clips.forEach((clip, name) => {
                // Clips fading out of the action layer run on to their end.
                if (clip.actionWeight > 0 && name !== actionClip) clip.time = Math.min(clip.time + dt, clip.duration - 1e-3);
            });

            // ---- the locomotion layer: gaits blended by speed, in step
            weights.clear();
            const scale = modelScale;
            // Each gait and its second take share its weight, the share wandering over seconds
            // (their strides differ a little: the one the feet keep is the mix's).
            mem.variety += dt;
            const mix = 0.5 + 0.3 * Math.sin(mem.variety * 0.37 + mem.seed) + 0.2 * Math.sin(mem.variety * 0.91 + mem.seed * 2.3);
            let stride = blendGaits(rig.gaits, mem.speed, scale, 1 - lowG, weights);
            let lengthen = 0;
            rig.variants.forEach((variant, base) => {
                const share = weights.get(base);
                const a = rig.clips.get(base)?.info.stride;
                const b = rig.clips.get(variant)?.info.stride;
                if (share && a && b) lengthen += share * (b / a - 1) * mix;
            });
            stride *= 1 + lengthen;
            const lopeStride = blendGaits(rig.lopes, mem.speed, scale, lowG, weights);
            stride = stride * (1 - lowG) + lopeStride * lowG;
            const moving = smooth(0.06, 0.5, mem.speed);
            // Turning round on the spot: the feet step it round (a stride for every ~3 radians).
            if (!mem.hasForward) { mem.forward.copy(forwardWorld); mem.hasForward = true; }
            const swing = Math.atan2(lookFlat.crossVectors(mem.forward, forwardWorld).dot(upWorld), mem.forward.dot(forwardWorld));
            mem.forward.copy(forwardWorld);
            mem.yawRate = approach(mem.yawRate, swing / dt, 12, dt);
            const turning = onFoot ? smooth(1.0, 3.0, Math.abs(mem.yawRate)) * (1 - moving) : 0;
            const wasStill = mem.locomotion < 0.02;
            const locoTarget = onFoot ? Math.max(moving, turning * 0.75) : 0;
            mem.locomotion = approach(mem.locomotion, locoTarget, locoTarget > mem.locomotion ? 6 : 4, dt);
            if (wasStill && locoTarget > 0.02) {
                // Setting off from standing: the left foot is about to swing.
                mem.phase = 0.82;
            }
            if (stride > 0) {
                let advance = ((mem.speed * dt) / stride) * (leaping && walker && !walker.onGround ? 0.35 : 1) + turning * Math.abs(mem.yawRate) * dt * 0.33;
                if (mem.speed < 0.5 && mem.locomotion > 0.03 && turning < 0.1) {
                    // Slowing to a stop: finish the step under way, to where the feet pass.
                    const rests = rig.gaits[0]?.clip.rests ?? [0];
                    const next = rests.find((r) => r >= mem.phase - 1e-4) ?? rests[0] + 1;
                    advance = Math.min(Math.max(advance, 0.9 * dt), Math.max(0, next - mem.phase));
                }
                mem.phase = (mem.phase + advance) % 1;
            }

            // ---- the idle layer: breathing stance, now and then something else
            mem.idleTime += dt * pace;
            const idle = rig.clips.get('idle');
            if (idle) idle.time = mem.idleTime % idle.duration;
            const standing = onFoot && mem.locomotion < 0.05;
            mem.still = standing ? mem.still + dt : 0;
            if (!mem.variation && rig.idles.length && mem.still > mem.nextVariation) {
                const choices = rig.idles.filter((n) => n !== mem.lastVariation);
                mem.variation = choices[Math.floor(Math.random() * choices.length)] ?? rig.idles[0];
                mem.lastVariation = mem.variation;
                mem.variationTime = 0;
            }
            if (mem.variation) {
                const clip = rig.clips.get(mem.variation)!;
                mem.variationTime += dt * pace;
                clip.time = Math.min(mem.variationTime, clip.duration - 1e-3);
                const ending = mem.variationTime > clip.duration - 0.8 || !standing;
                mem.variationWeight = approach(mem.variationWeight, ending ? 0 : 1, ending && !standing ? 6 : 2.2, dt);
                if (ending && mem.variationWeight < 0.01) {
                    mem.variation = null;
                    mem.variationWeight = 0;
                    mem.still = 0;
                    mem.nextVariation = 5 + Math.random() * 9;
                }
            }

            // ---- weights of every clip, and their times
            const ground = 1 - mem.action;
            const loco = mem.locomotion;
            let total = 0;
            rig.variants.forEach((variant, base) => {
                const share = weights.get(base);
                if (!share) return;
                weights.set(base, share * (1 - mix));
                weights.set(variant, share * mix);
            });
            rig.clips.forEach((clip, name) => {
                let w = clip.actionWeight * mem.action;
                const gaitShare = weights.get(name);
                if (gaitShare) {
                    w += ground * loco * gaitShare;
                    clip.time = mem.phase * clip.duration;
                }
                if (name === 'idle') w += ground * (1 - loco) * (1 - mem.variationWeight);
                if (name === mem.variation) w += ground * (1 - loco) * mem.variationWeight;
                clip.action.time = clip.time;
                clip.action.setEffectiveWeight(w);
                total += w;
            });
            if (total < 1e-3 && idle) idle.action.setEffectiveWeight(1);
            rig.mixer.update(0);

            // ---- lean: the body tips into acceleration and into turns, as a person balances
            const lean = leanRef.current;
            if (walker && !mem.hasVelocity) { mem.velocity.copy(walker.velocity); mem.hasVelocity = true; }
            if (walker) {
                accel.copy(walker.velocity).sub(mem.velocity).divideScalar(dt);
                mem.velocity.copy(walker.velocity);
                accel.applyQuaternion(groupQuatInv);
                accel.y = 0;
                mem.accel.lerp(accel, 1 - Math.exp(-dt * 10));
            } else {
                mem.accel.set(0, 0, 0);
            }
            const g = Math.max(gravity, 1);
            const grounded = ground * (walker ? (walker.onGround && !walker.swimming ? 1 : 0) : 1);
            const limit = 0.22 + 0.12 * mem.lowGravity;
            const pitchTarget = THREE.MathUtils.clamp(Math.atan2(mem.accel.z, g) * 0.75, -limit, limit) * grounded;
            const rollTarget = THREE.MathUtils.clamp(-Math.atan2(mem.accel.x, g) * 0.8, -limit, limit) * grounded;
            const pitch = spring(mem.pitch, pitchTarget, 9 * pace, dt);
            const roll = spring(mem.roll, rollTarget, 9 * pace, dt);
            if (lean) {
                lean.rotation.set(pitch, 0, roll);
                lean.updateMatrixWorld(true);
            } else {
                rig.root.updateMatrixWorld(true);
            }

            const bones = rig.bones;
            const layered = DEV ? performance.now() : 0;
            if (bones && !(DEV && (window as unknown as { __astronautPlain?: boolean }).__astronautPlain)) {
                // ---- the ground under each foot
                const probeGround = state.current.ground ?? (walker ? (u: THREE.Vector3) => groundHeight(walker.body, u) : null);
                let ikTarget = 0;
                let h0 = 0;
                let hx = 0;
                let hz = 0;
                const radial = walker ? centre.copy(walker.position).sub(walker.body.position) : null;
                if (walker && probeGround && radial) {
                    const r = radial.length();
                    probe.copy(radial).divideScalar(r);
                    h0 = probeGround(probe);
                    // Only on bare ground: not wading, not on a rock's top, not in the air.
                    const standingOn = Math.abs(r - walker.body.radius - h0) < 0.08;
                    ikTarget = walker.onGround && !walker.swimming && standingOn ? grounded : 0;
                    if (ikTarget > 0 || mem.ik > 0.01) {
                        // The ground half a metre to the right and ahead: its tilt (for the soles) and
                        // the slope along the way the explorer faces (for the chest's lean).
                        probe.copy(radial).addScaledVector(rightWorld, 0.5).normalize();
                        hx = probeGround(probe) - h0;
                        probe.copy(radial).addScaledVector(forwardWorld, 0.5).normalize();
                        hz = probeGround(probe) - h0;
                    }
                    mem.slope = approach(mem.slope, ikTarget > 0 ? hz / 0.5 : 0, 5, dt);
                }
                mem.ik = approach(mem.ik, ikTarget, 8, dt);
                if (mem.ik > 0.01 && walker && probeGround && radial) {
                    // Each foot's ground relative to the walker's: lift or lower it that much.
                    const offsets = [0, 0];
                    const feet = [bones.leftFoot, bones.rightFoot];
                    for (let side = 0; side < 2; side++) {
                        feet[side].getWorldPosition(footWorld);
                        probe.copy(radial).add(footWorld).sub(groupWorld).normalize();
                        offsets[side] = THREE.MathUtils.clamp(probeGround(probe) - h0, -0.6, 0.6);
                    }
                    // The hips come down so the lower foot reaches its ground.
                    mem.drop = approach(mem.drop, Math.max(-0.45, Math.min(0, offsets[0], offsets[1])) * mem.ik, 12, dt);
                    bones.hips.getWorldPosition(hipsWorld).addScaledVector(upWorld, mem.drop);
                    bones.hips.parent!.worldToLocal(hipsWorld);
                    bones.hips.position.copy(hipsWorld);
                    bones.hips.updateMatrixWorld(true);
                    // The ground's tilt under the explorer, for planting the soles flat on it.
                    normal.copy(upWorld).addScaledVector(rightWorld, -hx / 0.5).addScaledVector(forwardWorld, -hz / 0.5).normalize();
                    tilt.setFromUnitVectors(upWorld, normal);
                    const ankleRest = rig.ankleRest * scale;
                    for (let side = 0; side < 2; side++) {
                        const [upper, lower, foot] = side === 0 ? [bones.leftUpLeg, bones.leftLeg, bones.leftFoot] : [bones.rightUpLeg, bones.rightLeg, bones.rightFoot];
                        foot.getWorldPosition(target);
                        // How high the clip holds this ankle off its ground (walker's ground plane).
                        const lift = hipsWorld.subVectors(target, groupWorld).dot(upWorld) - mem.drop;
                        target.addScaledVector(upWorld, offsets[side] - mem.drop);
                        solveLeg(upper, lower, foot, target, mem.ik, forwardWorld);
                        // A foot down on the ground lies flat on it.
                        const planted = 1 - smooth(ankleRest + 0.03, ankleRest + 0.14, lift);
                        if (planted > 0.01) turnBone(foot, footTilt.identity().slerp(tilt, planted * mem.ik));
                    }
                }

                // ---- the chest leans into a climb, back on a descent
                const climbing = mem.slope * smooth(0.2, 1.5, mem.speed);
                const chest = THREE.MathUtils.clamp(climbing > 0 ? climbing * 0.55 : climbing * 0.3, -0.18, 0.3) * grounded;
                // ---- breathing: deeper and quicker for a while after running
                mem.exertion = approach(mem.exertion, smooth(2.5, 6.5, mem.speed), mem.speed > 2.5 ? 0.25 : 0.05, dt);
                mem.breath += dt * Math.PI * 2 * (0.24 + 0.42 * mem.exertion) * pace;
                const inhale = Math.sin(mem.breath);
                const breath = (0.012 + 0.03 * mem.exertion) * inhale;
                // ---- the pack and upper body lag the hips' bounce a little
                bones.hips.getWorldPosition(hipsWorld);
                const hy = hipsWorld.dot(upWorld);
                if (!mem.hipsHas) { mem.hipsY = hy; mem.hipsV = 0; mem.hipsHas = true; }
                const hv = (hy - mem.hipsY) / dt;
                const ha = (hv - mem.hipsV) / dt;
                mem.hipsY = hy;
                mem.hipsV = hv;
                // The upper body as a lightly damped pendulum on the hips: they jolt up at each footfall, it bows.
                mem.pack.v += THREE.MathUtils.clamp(ha, -40, 40) * 0.45 * dt + (walker?.touchdown ? Math.min(0.6, walker.landedFrom * 0.5) : 0);
                const pack = THREE.MathUtils.clamp(oscillate(mem.pack, 11 * pace, 0.45, dt), -0.07, 0.07);
                // Forward is a turn about the body's right (negative angle bows the chest forward).
                turnBoneAbout(bones.spine2, rightWorld, -(chest * 0.45));
                turnBoneAbout(bones.spine1, rightWorld, -(chest * 0.55) + breath * 0.5);
                turnBoneAbout(bones.spine, rightWorld, breath * 0.5 - pack);
                turnBoneAbout(bones.neck, rightWorld, -breath * 0.6 + pack * 0.8);
                turnBoneAbout(bones.leftShoulder, forwardWorld, -breath * 0.9);
                turnBoneAbout(bones.rightShoulder, forwardWorld, breath * 0.9);

                // ---- the head (and a little of the chest) turns to where the player looks
                let yawTarget = 0;
                let pitchTargetLook = 0;
                if (walker) {
                    lookFlat.copy(walker.look).applyQuaternion(groupQuatInv);
                    const angle = Math.atan2(-lookFlat.x, -lookFlat.z);
                    const weight = smooth(2.3, 1.7, Math.abs(angle)) * (1 - 0.6 * smooth(2.5, 7, mem.speed)) * grounded;
                    yawTarget = THREE.MathUtils.clamp(angle, -1.25, 1.25) * weight;
                    pitchTargetLook = THREE.MathUtils.clamp((walker.pitch + 0.18) * 0.6, -0.45, 0.35) * weight;
                }
                // Standing about, the eyes wander.
                mem.glance -= dt;
                if (mem.glance <= 0) {
                    mem.glance = 1.5 + Math.random() * 3.5;
                    const wander = Math.random() < 0.35;
                    mem.glanceYaw = wander ? (Math.random() - 0.5) * 0.9 : 0;
                    mem.glancePitch = wander ? (Math.random() - 0.6) * 0.3 : 0;
                }
                const idleShare = (1 - mem.locomotion) * ground * (1 - mem.variationWeight);
                const yaw = spring(mem.lookYaw, yawTarget + mem.glanceYaw * idleShare, 5, dt);
                const nod = spring(mem.lookPitch, pitchTargetLook + mem.glancePitch * idleShare, 5, dt);
                turnBoneAbout(bones.spine, upWorld, yaw * 0.2);
                turnBoneAbout(bones.neck, upWorld, yaw * 0.35);
                turnBoneAbout(bones.head, upWorld, yaw * 0.45);
                turnBoneAbout(bones.neck, rightWorld, nod * 0.4);
                turnBoneAbout(bones.head, rightWorld, nod * 0.6);
            }

            // ---- treading water: the clip holds the arms straight out at the shoulders, which reads as
            // a T-pose; a swimmer keeps them lower and forward, elbows bent, hands sculling in front.
            const tread = rig.clips.get('tread')?.actionWeight ?? 0;
            if (tread > 0.01) {
                for (const [upper, fore, hand] of rig.arms) {
                    fore.getWorldPosition(armTo);
                    upper.getWorldPosition(armFrom);
                    limbWant.subVectors(armTo, armFrom).normalize()
                        .addScaledVector(upWorld, -0.75).addScaledVector(forwardWorld, 0.7).normalize();
                    swingBone(upper, fore, limbWant, tread);
                    hand.getWorldPosition(armTo);
                    fore.getWorldPosition(armFrom);
                    limbWant.subVectors(armTo, armFrom).normalize()
                        .addScaledVector(forwardWorld, 1.1).addScaledVector(upWorld, 0.15).normalize();
                    swingBone(fore, hand, limbWant, tread * 0.8);
                }
            }

            if (DEV) {
                // Test pages read what the motion costs: clip layers, and the procedural pass after them.
                const cost = ((window as unknown as { __astronautCost?: { frames: number; layers: number; pass: number } }).__astronautCost ??= { frames: 0, layers: 0, pass: 0 });
                const now = performance.now();
                cost.frames += 1;
                cost.layers += layered - started;
                cost.pass += now - layered;
            }
            if (mining && rig.arm && rig.forearm && rig.hand && group) {
                // Hold the tool out at the crystal: forward and a little down.
                aim.set(0, -0.28, -1).normalize().applyQuaternion(group.getWorldQuaternion(worldQuaternion));
                aimBone(rig.arm, rig.forearm, aim);
                aimBone(rig.forearm, rig.hand, aim);
            }
            // The tool sits in the right hand, pointing where the forearm points.
            const tool = toolRef.current;
            // Stowed while swimming: nobody swims holding a cutter.
            if (tool) tool.visible = mining || !walker?.swimming;
            if (tool && tool.visible && rig.hand && rig.forearm && group) {
                rig.hand.getWorldPosition(handWorld);
                rig.forearm.getWorldPosition(toolAxis);
                toolAxis.subVectors(handWorld, toolAxis).normalize();
                group.worldToLocal(tool.position.copy(handWorld));
                group.getWorldQuaternion(worldQuaternion).invert();
                toolAxis.applyQuaternion(worldQuaternion);
                tool.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), toolAxis);
            }
            return;
        }
        const swing = Math.sin(phase) * 0.7 * amount;
        if (leftLeg.current) leftLeg.current.rotation.x = swing;
        if (rightLeg.current) rightLeg.current.rotation.x = -swing;
        if (leftArm.current) leftArm.current.rotation.x = -swing * 0.8;
        if (rightArm.current) rightArm.current.rotation.x = mining ? 1.35 : swing * 0.8;
        if (body.current) body.current.position.y = Math.abs(Math.cos(phase)) * 0.05 * amount;
    });

    if (rig) {
        return (
            <group ref={groupRef}>
                <group ref={leanRef}>
                    <primitive object={rig.root} rotation={[0, Math.PI, 0]} scale={modelScale} />
                </group>
                {[-0.12, 0.12].map((x, n) => (
                    <group key={x} position={[x, 0.98, 0.27]}>
                        <sprite ref={(s) => { if (s) flames.current[n] = s; }} material={flameMaterial} position={[0, -0.3, 0]} visible={false} />
                    </group>
                ))}
                <group ref={toolRef}>
                    <mesh geometry={geometries.tool} material={suitDark} position={[0, 0, -0.1]} />
                    <mesh geometry={geometries.toolTip} material={toolGlow} position={[0, 0, -0.34]} />
                    <object3D ref={toolTipRef} position={[0, 0, -0.4]} />
                </group>
            </group>
        );
    }

    return (
        <group ref={groupRef}>
            <group ref={body}>
                <mesh geometry={geometries.torso} material={suit} position={[0, 1.18, 0]} />
                <mesh geometry={geometries.stripe} material={trim} position={[0, 1.3, -0.26]} />
                <mesh geometry={geometries.helmet} material={suit} position={[0, 1.72, 0]} />
                <mesh geometry={geometries.visor} material={visor} position={[0, 1.72, -0.07]} rotation={[0, -Math.PI / 2, 0]} scale={[1.05, 1, 1.05]} />
                <group position={[0, 1.24, 0.27]}>
                    <mesh geometry={geometries.pack} material={suitDark} />
                    {[-0.13, 0.13].map((x, n) => (
                        <group key={x} position={[x, -0.36, 0.02]}>
                            <mesh geometry={geometries.nozzle} material={suitDark} />
                            <sprite ref={(s) => { if (s) flames.current[n] = s; }} material={flameMaterial} position={[0, -0.32, 0]} visible={false} />
                        </group>
                    ))}
                </group>
                <group ref={leftArm} position={[-0.36, 1.42, 0]}>
                    <mesh geometry={geometries.limb} material={suit} position={[0, -0.3, 0]} />
                </group>
                <group ref={rightArm} position={[0.36, 1.42, 0]}>
                    <mesh geometry={geometries.limb} material={suit} position={[0, -0.3, 0]} />
                    <group position={[0, -0.6, -0.05]}>
                        <mesh geometry={geometries.tool} material={suitDark} position={[0, 0, -0.12]} />
                        <mesh geometry={geometries.toolTip} material={toolGlow} position={[0, 0, -0.36]} />
                        <object3D ref={toolTipRef} position={[0, 0, -0.42]} />
                    </group>
                </group>
            </group>
            <group ref={leftLeg} position={[-0.15, 0.82, 0]}>
                <mesh geometry={geometries.leg} material={suit} position={[0, -0.38, 0]} />
                <mesh geometry={geometries.boot} material={suitDark} position={[0, -0.76, -0.04]} />
            </group>
            <group ref={rightLeg} position={[0.15, 0.82, 0]}>
                <mesh geometry={geometries.leg} material={suit} position={[0, -0.38, 0]} />
                <mesh geometry={geometries.boot} material={suitDark} position={[0, -0.76, -0.04]} />
            </group>
        </group>
    );
});
