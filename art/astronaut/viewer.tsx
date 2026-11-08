// Test page, not part of the game: the explorer (components/expedition/Astronaut.tsx, with the
// model the game loads) walked along a scripted path over a checkered ground with a hill, so its
// motion can be filmed frame by frame (window.__viewer.step) and old and new compared.
//   viewer.html?scene=earth|moon|jump[&physics=old]
// The walker below follows the rules of walking.ts (speeds, grip, turning, jumps) on a ground of
// its own; `physics=old` uses walking.ts's rules as they were before the motion work (7 Nov 2026).
import { createRoot } from 'react-dom/client';
import { Canvas, advance, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Astronaut, type AstronautHandle, type Motion } from '../../components/expedition/Astronaut';

const params = new URLSearchParams(location.search);
const SCENE = params.get('scene') ?? 'earth';
const OLD = params.get('physics') === 'old';
/** `motion=tread` (or any Motion) holds the explorer in that motion, standing; `cam=front|side|back` places the camera. */
const FORCED = params.get('motion') as Motion | null;
const CAM = params.get('cam');
const MOON = SCENE === 'moon';
const GRAVITY = MOON ? 1.62 : 9.81;
const R = 200000;
const CENTRE = new THREE.Vector3(0, -R, 0);
const FPS = 30;

/** The ground: flat, a hill across the path (earth), gentle undulation (moon). */
const height = (x: number, z: number) => {
    if (MOON) return 0.18 * Math.sin(x * 0.55) * Math.sin(z * 0.8) + 0.12 * Math.sin(z * 0.31 + 1.3);
    // Up 14 degrees from z = 12 to 17, a flat top to 19, down to 24.
    const rise = Math.tan(THREE.MathUtils.degToRad(14));
    if (z <= 12 || z >= 24) return 0;
    if (z < 17) return (z - 12) * rise;
    if (z <= 19) return 5 * rise;
    return (24 - z) * rise;
};
const groundOf = (up: THREE.Vector3) => {
    const p = up.clone().multiplyScalar(R).add(CENTRE);
    return height(p.x, p.z);
};

/** One step of the script: seconds, where the stick points (degrees from +Z towards +X), how far (0..1), sprint, jump. */
interface Cue { at: number; stick?: number; yaw?: number; sprint?: boolean; jump?: boolean }
const SCRIPTS: Record<string, Cue[]> = {
    earth: [
        { at: 0, stick: 0 },
        { at: 3, stick: 0.26, yaw: 0 },
        { at: 8, stick: 0 },
        { at: 10, stick: 0.26, yaw: -60 },
        { at: 11, stick: 0.26, yaw: 40 },
        { at: 12, stick: 0.26, yaw: 0 },
        { at: 22.5, stick: 0 },
        { at: 24, stick: 0.2, yaw: 180 },
        { at: 25.5, stick: 0.26, yaw: 180 },
        { at: 27, stick: 1, yaw: 180 },
        { at: 31, stick: 1, yaw: 180, sprint: true },
        { at: 33, stick: 0 },
        { at: 46, stick: 0 },
    ],
    moon: [
        { at: 0, stick: 0 },
        { at: 2, stick: 1, yaw: 0 },
        { at: 8, stick: 0.3, yaw: 0 },
        { at: 11, stick: 0 },
        { at: 14, stick: 0 },
    ],
    still: [
        { at: 0, stick: 0 },
        { at: 6, stick: 0 },
    ],
    jump: [
        { at: 0, stick: 0 },
        { at: 1.5, stick: 0, jump: true },
        { at: 4, stick: 1, yaw: 0 },
        { at: 5.5, stick: 1, yaw: 0, jump: true },
        { at: 8, stick: 0 },
        { at: 10, stick: 0 },
    ],
};

// walking.ts's numbers.
const WALK = 6.2;
const SPRINT = 11.5;
const JUMP_SPEED = 3.6;
const JUMP_CROUCH = 0.16;

const makeWalker = () => {
    const position = new THREE.Vector3(0, height(0, 0), 0);
    return {
        body: { position: CENTRE.clone(), radius: R, gravity: GRAVITY, kind: 'rocky', id: 'viewer' },
        position,
        velocity: new THREE.Vector3(),
        facing: new THREE.Vector3(0, 0, 1),
        look: new THREE.Vector3(0, 0, 1),
        pitch: -0.18,
        onGround: true,
        jetting: false,
        gait: 0,
        moving: 0,
        running: false,
        swimming: false,
        dive: 0,
        airTime: 0,
        jumpTime: 99,
        jumpPending: false,
        landTime: 99,
        landedFrom: 0,
        touchdown: false,
        impact: 0,
        impactTime: 99,
        sliding: false,
        down: false,
        sitting: false,
        eating: 0,
        gathering: 0,
        jumped: false,
        health: 1,
    };
};
type FakeWalker = ReturnType<typeof makeWalker>;

// Player.tsx's motionOf.
const motionOf = (walker: FakeWalker): Motion => {
    if (walker.jetting) return 'air';
    if (walker.jumpPending || (!walker.onGround && walker.jumpTime < 0.9)) return 'jump';
    if (!walker.onGround && walker.airTime > 0.22) return 'air';
    if (walker.onGround && walker.landTime < 0.5 && walker.landedFrom > 0.3 && walker.moving < 0.5) return 'land';
    if (walker.running) return 'run';
    return walker.moving > 0.08 ? 'walk' : 'idle';
};

const cueAt = (script: Cue[], t: number) => {
    let cue = script[0];
    for (const c of script) if (c.at <= t) cue = c;
    return cue;
};

const move = new THREE.Vector3();
const desired = new THREE.Vector3();
const horizontal = new THREE.Vector3();
const turnAxis = new THREE.Vector3();
const stepWalker = (walker: FakeWalker, script: Cue[], t: number, dt: number, jumped: Set<Cue>) => {
    const cue = cueAt(script, t);
    const stick = cue.stick ?? 0;
    const yaw = THREE.MathUtils.degToRad(cue.yaw ?? 0);
    move.set(Math.sin(yaw), 0, Math.cos(yaw));
    // walking.ts: speeds go as the square root of gravity (strideFactor); boots grip less where it is weak.
    const legs = OLD ? 1 : THREE.MathUtils.clamp(Math.sqrt(GRAVITY / 9.81) * 1.4, 0.55, 1);
    const facingWay = OLD ? 1 : 0.25 + 0.75 * Math.max(0, walker.facing.dot(move));
    const target = stick * (cue.sprint ? SPRINT : WALK) * legs * facingWay;
    desired.copy(move).multiplyScalar(target);
    horizontal.set(walker.velocity.x, 0, walker.velocity.z);
    let vertical = walker.velocity.y;
    const grip = walker.onGround ? (OLD ? 10 : 7 * legs) : 2.2;
    horizontal.lerp(desired, 1 - Math.exp(-dt * grip));
    walker.jumpTime += dt;
    if (cue.jump && !jumped.has(cue) && walker.onGround) {
        jumped.add(cue);
        walker.jumpPending = true;
        walker.jumpTime = 0;
    }
    if (walker.jumpPending && walker.jumpTime >= JUMP_CROUCH) {
        walker.jumpPending = false;
        vertical = Math.max(vertical, 0) + JUMP_SPEED;
        walker.onGround = false;
        walker.airTime = 0;
        walker.jumped = true;
    }
    vertical -= GRAVITY * dt;
    const wasOnGround = walker.onGround;
    walker.velocity.set(horizontal.x, vertical, horizontal.z);
    walker.position.addScaledVector(walker.velocity, dt);
    const ground = height(walker.position.x, walker.position.z);
    if (walker.position.y <= ground + 0.02) {
        walker.position.y = ground;
        if (walker.velocity.y < 0) walker.velocity.y = 0;
        walker.onGround = !(walker.jumped && vertical > 0.01);
    } else if (wasOnGround && walker.position.y - ground < 0.3 && vertical <= 0.01 && !walker.jumped) {
        // Walking down the hill: the boots stay on it.
        walker.position.y = ground;
        walker.velocity.y = 0;
        walker.onGround = true;
    } else {
        walker.onGround = false;
    }
    walker.touchdown = false;
    if (walker.onGround && !wasOnGround) {
        walker.landedFrom = walker.airTime;
        walker.landTime = 0;
        walker.touchdown = true;
        walker.jumped = false;
    }
    walker.landTime += dt;
    if (stick > 0.05) {
        if (OLD) {
            walker.facing.lerp(move, 1 - Math.exp(-dt * 10));
        } else {
            const angle = walker.facing.angleTo(move);
            if (angle > 1e-4) {
                turnAxis.crossVectors(walker.facing, move);
                if (turnAxis.lengthSq() < 1e-8) turnAxis.set(0, 1, 0);
                walker.facing.applyAxisAngle(turnAxis.normalize(), Math.min(angle * (1 - Math.exp(-dt * 10)), 7 * dt));
            }
        }
        walker.facing.y = 0;
        walker.facing.normalize();
    }
    walker.look.copy(walker.facing);
    const speed = horizontal.length();
    walker.moving = walker.onGround ? Math.min(1, speed / (WALK * legs)) : 0.15;
    walker.running = !!cue.sprint && walker.onGround && speed > WALK * legs * 1.15;
    walker.airTime = walker.onGround ? 0 : walker.airTime + dt;
    walker.gait += speed * dt * 1.55;
};

const Ground = () => {
    const geometry = useMemo(() => {
        const g = new THREE.PlaneGeometry(40, 120, 80, 240).rotateX(-Math.PI / 2);
        const p = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
        g.computeVertexNormals();
        return g;
    }, []);
    const texture = useMemo(() => {
        const c = document.createElement('canvas');
        c.width = c.height = 128;
        const x = c.getContext('2d')!;
        const [a, b] = MOON ? ['#8d8a86', '#7a7773'] : ['#c9c4b6', '#a9a496'];
        x.fillStyle = a; x.fillRect(0, 0, 128, 128);
        x.fillStyle = b; x.fillRect(0, 0, 64, 64); x.fillRect(64, 64, 64, 64);
        const t = new THREE.CanvasTexture(c);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(20, 60);
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
    }, []);
    return (
        <>
            <mesh geometry={geometry} receiveShadow>
                <meshStandardMaterial map={texture} roughness={0.95} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} position-y={-0.02} receiveShadow>
                <planeGeometry args={[400, 400]} />
                <meshStandardMaterial color={MOON ? '#77736f' : '#a8a394'} roughness={1} />
            </mesh>
        </>
    );
};

const right = new THREE.Vector3();
const up = new THREE.Vector3();
const back = new THREE.Vector3();
const basis = new THREE.Matrix4();
const cameraAt = new THREE.Vector3();

const Driver = ({ handle, light }: { handle: React.RefObject<AstronautHandle | null>; light: React.RefObject<THREE.DirectionalLight | null> }) => {
    const { camera } = useThree();
    const walker = useMemo(makeWalker, []);
    const script = SCRIPTS[SCENE] ?? SCRIPTS.earth;
    const jumped = useMemo(() => new Set<Cue>(), []);
    const clock = useRef(0);
    useEffect(() => {
        (window as any).__viewer = {
            walker,
            duration: script[script.length - 1].at,
            ready: () => {
                let skinned = false;
                handle.current?.group?.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) { skinned = true; o.castShadow = true; } });
                return skinned;
            },
            time: () => clock.current,
            step: (frames: number) => {
                for (let i = 0; i < frames; i++) {
                    const dt = 1 / FPS;
                    stepWalker(walker, script, clock.current, dt, jumped);
                    clock.current += dt;
                    const h = handle.current;
                    if (h?.group) {
                        up.copy(walker.position).sub(walker.body.position).normalize();
                        back.copy(walker.facing).negate();
                        right.crossVectors(up, back).normalize();
                        basis.makeBasis(right, up, back);
                        h.group.position.copy(walker.position);
                        h.group.quaternion.setFromRotationMatrix(basis);
                        h.setGait(walker.gait, walker.moving);
                        h.setJetpack(false);
                        if (FORCED) walker.swimming = FORCED === 'swim' || FORCED === 'tread';
                        h.setMotion(FORCED ?? motionOf(walker));
                        (h as any).setWalker?.(walker, groundOf);
                    }
                    // Camera: beside the path, a little ahead, following.
                    if (CAM === 'front') cameraAt.copy(walker.position).addScaledVector(walker.facing, 4.2).y += 1.2;
                    else if (CAM === 'side') cameraAt.copy(walker.position).addScaledVector(right, 4.2).y += 1.2;
                    else if (CAM === 'back') cameraAt.copy(walker.position).addScaledVector(walker.facing, -4.2).y += 1.4;
                    else cameraAt.set(walker.position.x + 3.7, walker.position.y + 1.3, walker.position.z + 1.9);
                    camera.position.copy(cameraAt);
                    camera.lookAt(walker.position.x, walker.position.y + 0.9, walker.position.z);
                    const l = light.current;
                    if (l) {
                        l.position.set(walker.position.x + 4, walker.position.y + 9, walker.position.z + 3);
                        l.target.position.copy(walker.position);
                        l.target.updateMatrixWorld();
                    }
                    advance(clock.current);
                }
            },
        };
    }, [walker, script, jumped, handle, camera, light]);
    return null;
};

const App = () => {
    const handle = useRef<AstronautHandle>(null);
    const light = useRef<THREE.DirectionalLight>(null);
    return (
        <Canvas frameloop="never" shadows dpr={1} camera={{ fov: 40, near: 0.1, far: 500 }} gl={{ preserveDrawingBuffer: true, antialias: true }}
            onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; }}>
            <color attach="background" args={[MOON ? '#101216' : '#aeb9c4']} />
            <hemisphereLight args={[MOON ? '#5a5f6a' : '#dfe8f2', MOON ? '#2a2826' : '#6d6656', MOON ? 0.5 : 1.1]} />
            <directionalLight ref={light} intensity={MOON ? 3.2 : 2.4} color="#fff3e2" castShadow shadow-mapSize={[1024, 1024]}
                shadow-camera-left={-5} shadow-camera-right={5} shadow-camera-top={5} shadow-camera-bottom={-5} shadow-camera-near={1} shadow-camera-far={30} shadow-bias={-0.0004} />
            <Ground />
            <Driver handle={handle} light={light} />
            <Astronaut ref={handle} />
        </Canvas>
    );
};

createRoot(document.getElementById('root')!).render(<App />);
