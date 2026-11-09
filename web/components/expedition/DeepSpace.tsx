import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SKY_SWITCH } from './SpaceBackdrop';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import { BLACK_HOLE_REACH, createBlackHole, createHoleView, HOLE_RESOLUTION } from './BlackHole';
import { fallFrame } from './fall';
import { createMouth, MOUTH_REACH, tunnelSkies } from './Wormhole';
import { mouthRegion, type Region } from './region';
import { createSaturnStandIn } from './saturnStandIn';
import type { ExpeditionRuntime } from './runtime';
import { compileSafely } from './compileSafely';
import { throatCovers, throatHidesStalls } from './crossing';
import { CROSSING_LAYER } from './WormholeTransit';

/**
 * Everything beyond the planets: TON 618, and the two mouths of the wormhole
 * that leads to it.
 *
 * Both bend light, so both need photographs of the sky around them, taken
 * with a cube camera (which does not see the player's own ship: see the layer
 * note in Player). There are two sides to photograph: `home`, the sky on
 * Saturn's side, and `far`, the sky out by TON 618. The mouth by Saturn bends
 * `home` round its edge and shows `far` through its throat; the far mouth the
 * other way round. The side the camera is on is re-photographed from the
 * camera as it moves, and once the camera is close to a mouth the other side
 * is photographed from the matching point beyond the other mouth. Crossing
 * the throat then swaps which photograph is which without anything on screen
 * changing: the crossing is seamless.
 *
 * Only the system the player is in is built (region.ts): TON 618 and its mouth out there, the
 * mouth by Saturn here. Photographs of the other side show what is there to photograph: the other
 * galaxy's sky from here, and from out there our sky with a stand-in for Saturn
 * (saturnStandIn.ts). TON 618 is never in one.
 */

type Side = 'home' | 'far';

const createSky = (size: number) => new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
});

const eye = new THREE.Vector3();
const mirror = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const frustum = new THREE.Frustum();
const projectionView = new THREE.Matrix4();
const bounds = new THREE.Sphere();
const bufferSize = new THREE.Vector2();
const clearColor = new THREE.Color();
/** Development only: `?holeres=1` traces TON 618 at another fraction of the screen, to compare. */
const HOLE_FRACTION = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('holeres')
    ? Number(new URLSearchParams(window.location.search).get('holeres'))
    : null;
const nowInverse = new THREE.Quaternion();
const turnQuaternion = new THREE.Quaternion();
const turnMatrix = new THREE.Matrix4();

/** Frames to wait before the first photographs, so the world around the start has been built. */
const SETTLE_FRAMES = 4;

export const DeepSpace = ({ runtime, region }: { runtime: ExpeditionRuntime; region: Region }) => {
    const { gl, scene, camera: mainCamera } = useThree();
    const quality = runtime.quality;

    const skies = useMemo(() => {
        // Photographs are not antialiased, so they need to be sharp enough
        // that edges seen through the lens (Saturn's limb) do not step.
        const size = quality === 2 ? 768 : quality === 1 ? 512 : 256;
        return {
            home: createSky(size),
            far: createSky(size),
            // TON 618's own sky, without it, for its rays to escape into.
            hole: createSky(quality === 2 ? 1024 : quality === 1 ? 512 : 256),
        };
    }, [quality]);
    const cubeCamera = useMemo(() => new THREE.CubeCamera(1, 1e10, skies.home), [skies]);

    // Both compiled once the game is up, not while it starts (CompileGate): they are far off.
    const blackHole = useMemo(() => {
        const hole = createBlackHole(quality, skies.hole.texture);
        hole.mesh.userData.deferCompile = true;
        // Traced inside the horizon too, where the camera sees only the ship and the traced sky (Player.tsx).
        hole.mesh.layers.enable(CROSSING_LAYER);
        return hole;
    }, [quality, skies]);
    // TON 618 is traced into a picture of its own at a fraction of the screen's pixels, before the
    // frame, and laid into the sky from there (HOLE_RESOLUTION).
    const holeScene = useMemo(() => {
        const holeOnly = new THREE.Scene();
        holeOnly.add(blackHole.mesh);
        return holeOnly;
    }, [blackHole]);
    const holeView = useMemo(() => {
        const view = createHoleView();
        view.mesh.visible = false;
        // Still drawn inside the horizon, where the camera sees only the ship and the traced sky (Player.tsx).
        view.mesh.layers.enable(CROSSING_LAYER);
        return view;
    }, []);
    useEffect(() => () => { holeView.target.dispose(); holeView.material.dispose(); holeView.geometry.dispose(); }, [holeView]);
    // Its shader is compiled ahead of the first look (it is not in the scene the start compiles):
    // in the background where the browser compiles off the main thread, else on the way in; it is
    // left out until it is ready rather than stall a frame on it.
    const holeReady = useRef(false);
    const holeCompiling = useRef(false);
    const prepareHole = () => {
        if (holeCompiling.current) return;
        holeCompiling.current = true;
        compileSafely(gl, holeScene, mainCamera).then(() => { holeReady.current = true; });
    };
    useEffect(() => {
        if (region !== 'ton' || !gl.extensions.get('KHR_parallel_shader_compile')) return undefined;
        const timer = window.setTimeout(prepareHole, 20000);
        return () => window.clearTimeout(timer);
    });
    const mouths = useMemo(() => WORMHOLES.map((mouth) => {
        const side: Side = mouth.id === 'wormhole-saturn' ? 'home' : 'far';
        const other: Side = side === 'home' ? 'far' : 'home';
        const made = createMouth(mouth, skies[side].texture, skies[other].texture);
        made.mesh.userData.deferCompile = true;
        return { def: mouth, side, other, region: mouthRegion(mouth.id), ...made };
    }), [skies]);

    // Out by TON 618 Saturn is not built: a stand-in for it in the photographs of home.
    const saturnStandIn = useMemo(createSaturnStandIn, []);
    useEffect(() => () => saturnStandIn.dispose(), [saturnStandIn]);

    useEffect(() => () => {
        skies.home.dispose();
        skies.far.dispose();
        skies.hole.dispose();
        blackHole.material.dispose();
        blackHole.geometry.dispose();
        mouths.forEach((mouth) => { mouth.material.dispose(); mouth.geometry.dispose(); });
    }, [skies, blackHole, mouths]);

    // Where each side was last photographed from (world units), and when.
    const taken = useRef<{ home: THREE.Vector3 | null; far: THREE.Vector3 | null; at: number; frames: number }>({
        home: null, far: null, at: 0, frames: 0,
    });
    const photographs = useRef(0);
    // Photographs asked for this frame. They are taken just before the frame
    // is drawn, once everything in the scene has been moved for it (things
    // move in their own useFrame callbacks, some of which run after this one).
    const queue = useRef<{ target: THREE.WebGLCubeRenderTarget; from: THREE.Vector3; withHole: boolean }[]>([]);

    useEffect(() => {
        if (!import.meta.env.DEV) return undefined;
        const debug = window as unknown as { __deepSpace?: unknown };
        debug.__deepSpace = { taken: taken.current, skies, photographs };
        return () => { delete debug.__deepSpace; };
    }, [skies]);

    // How the game's frame was turned when each sky was photographed: the shaders turn their
    // lookups by the difference, so the photographs need not be retaken when the frame turns.
    const turns = useMemo(() => new Map<THREE.WebGLCubeRenderTarget, THREE.Quaternion>([
        [skies.home, new THREE.Quaternion()], [skies.far, new THREE.Quaternion()], [skies.hole, new THREE.Quaternion()],
    ]), [skies]);

    /** Photograph the sky from a world point, without the mouths and, unless asked for, without TON 618. */
    const photograph = (target: THREE.WebGLCubeRenderTarget, from: THREE.Vector3, withHole: boolean) => {
        turns.get(target)?.copy(runtime.motion.M);
        // (TON 618 itself is never in a photograph: it is traced only for the player's view, into
        // a picture made for that view, which would be wrong from anywhere else.)
        void withHole;
        const viewWasVisible = holeView.mesh.visible;
        holeView.mesh.visible = false;
        const mouthsWereVisible = mouths.map((mouth) => mouth.mesh.visible);
        mouths.forEach((mouth) => { mouth.mesh.visible = false; });
        cubeCamera.renderTarget = target;
        cubeCamera.position.copy(from).sub(runtime.origin);
        const standIn = region === 'ton' && target === skies.home;
        if (standIn) {
            saturnStandIn.place(runtime.motion, runtime.origin);
            saturnStandIn.group.visible = true;
        }
        // The post-processing composer turns auto-clear off for good; each
        // face must start clear, or it keeps the last photograph's depth.
        const autoClear = gl.autoClear;
        gl.autoClear = true;
        // The sky as it is from there (another galaxy's, from beside TON 618).
        SKY_SWITCH.at(from);
        const started = import.meta.env.DEV ? performance.now() : 0;
        cubeCamera.update(gl, scene);
        if (import.meta.env.DEV) {
            gl.getContext().finish();
            console.info(`sky photograph ${target.width}px: ${Math.round(performance.now() - started)} ms`);
        }
        SKY_SWITCH.at(runtime.camera);
        saturnStandIn.group.visible = false;
        gl.autoClear = autoClear;
        photographs.current += 1;
        holeView.mesh.visible = viewWasVisible;
        mouths.forEach((mouth, i) => { mouth.mesh.visible = mouthsWereVisible[i]; });
    };

    // Before every render: the photographs asked for (before the player's
    // view only), then telling shaders that depend on where they are seen from
    // which camera is drawing, including each face of each photograph.
    useEffect(() => {
        const previous = scene.onBeforeRender;
        let busy = false;
        scene.onBeforeRender = (_renderer, _scene, camera) => {
            // One a frame: the first sight of TON 618 or a mouth asks for three, eighteen draws of the
            // whole scene, which in one frame was a stall of its own as the player arrived.
            if (camera === mainCamera && !busy && queue.current.length > 0 && throatHidesStalls(runtime.transit)) {
                busy = true;
                const shot = queue.current.shift()!;
                photograph(shot.target, shot.from, shot.withHole);
                busy = false;
            }
            // (Not behind the throat of a crossing, which covers it.)
            if (camera === mainCamera && !busy && holeView.mesh.visible && !throatCovers(runtime.transit)) {
                busy = true;
                traceHole(camera);
                busy = false;
            }
            eye.setFromMatrixPosition(camera.matrixWorld);
            runtime.viewers.forEach((update) => update(eye));
        };
        return () => { scene.onBeforeRender = previous; };
    });

    /** TON 618 as the player's camera sees it, traced into its own picture just before the frame. */
    const traceHole = (camera: THREE.Camera) => {
        gl.getDrawingBufferSize(bufferSize);
        const fraction = HOLE_FRACTION ?? HOLE_RESOLUTION[quality];
        const width = Math.max(1, Math.round(bufferSize.x * fraction));
        const height = Math.max(1, Math.round(bufferSize.y * fraction));
        if (holeView.target.width !== width || holeView.target.height !== height) holeView.target.setSize(width, height);
        (holeView.material.uniforms.uSize.value as THREE.Vector2).copy(bufferSize);
        const previous = gl.getRenderTarget();
        const autoClear = gl.autoClear;
        gl.getClearColor(clearColor);
        const clearAlpha = gl.getClearAlpha();
        gl.setRenderTarget(holeView.target);
        gl.setClearColor(0x000000, 0);
        gl.clear(true, false, false);
        gl.autoClear = false;
        gl.render(holeScene, camera);
        gl.autoClear = autoClear;
        gl.setClearColor(clearColor, clearAlpha);
        gl.setRenderTarget(previous);
    };

    const ask = (target: THREE.WebGLCubeRenderTarget, from: THREE.Vector3, withHole: boolean) => {
        queue.current.push({ target, from: from.clone(), withHole });
    };

    useFrame(({ camera }, delta) => {
        // Each photograph's lookups, turned from the frame now to the frame it was taken in.
        nowInverse.copy(runtime.motion.M).invert();
        const turnOf = (target: THREE.WebGLCubeRenderTarget, out: THREE.Matrix3) =>
            out.setFromMatrix4(turnMatrix.makeRotationFromQuaternion(turnQuaternion.copy(turns.get(target)!).multiply(nowInverse)));
        turnOf(skies.hole, blackHole.material.uniforms.uEnvTurn.value as THREE.Matrix3);
        for (const mouth of mouths) {
            turnOf(skies[mouth.side], mouth.material.uniforms.uLocalTurn.value as THREE.Matrix3);
            turnOf(skies[mouth.other], mouth.material.uniforms.uThroughTurn.value as THREE.Matrix3);
            // For a crossing from this mouth: the far side ahead, this side behind.
            const tunnel = tunnelSkies(mouth.def.to);
            tunnel.ahead = skies[mouth.other].texture;
            tunnel.behind = skies[mouth.side].texture;
            turnOf(skies[mouth.other], tunnel.aheadTurn);
            turnOf(skies[mouth.side], tunnel.behindTurn);
        }
        blackHole.mesh.position.copy(BLACK_HOLE.position).sub(runtime.origin);
        blackHole.material.uniforms.uTime.value += Math.min(delta, 0.05);
        // Only near it: from the planets it is a far, faint speck anyway.
        const fromHole = runtime.camera.distanceTo(BLACK_HOLE.position) / BLACK_HOLE.horizon;
        const out = region === 'ton';
        if (out && fromHole < BLACK_HOLE_REACH * 1.5) prepareHole();
        holeView.mesh.visible = out && fromHole < BLACK_HOLE_REACH && holeReady.current;
        // Falling in, the camera sees through its own fall; close in, where
        // the disk fills the view, its exposure comes down.
        blackHole.material.uniforms.uFall.value = fallFrame(runtime.fall);
        const holeDistance = runtime.camera.distanceTo(BLACK_HOLE.position) / BLACK_HOLE.horizon;
        blackHole.material.uniforms.uExposure.value = THREE.MathUtils.lerp(0.5, 1, THREE.MathUtils.smoothstep(holeDistance, 1.6, 5));
        // In a daytime sky the other side is veiled like the moon by day.
        const haze = runtime.atmosphere * runtime.daylight * 0.9;
        for (const mouth of mouths) {
            mouth.mesh.position.copy(mouth.def.position).sub(runtime.origin);
            mouth.mesh.visible = mouth.region === region && runtime.camera.distanceTo(mouth.def.position) < mouth.def.radius * 3000;
            mouth.material.uniforms.uHaze.value = haze;
        }

        const state = taken.current;
        state.frames += 1;
        if (state.frames < SETTLE_FRAMES) return;
        const now = performance.now() / 1000;
        // Once a mouth or TON 618 comes within sight (not at the start: the
        // first frame after landing would draw the whole scene eighteen times
        // over and wait on the black hole's shader, a freeze of seconds just
        // as the expedition appears): TON 618's own sky and the far side from
        // its mouth, then home from where the camera is.
        // (When the sky turns because the game's frame follows another world, the photographs
        // are not retaken, which drew the whole scene eighteen times each time and froze the
        // game round Saturn: the shaders turn their lookups instead, uLocalTurn and the rest.)
        if (state.far === null) {
            if (!holeView.mesh.visible && !mouths.some((mouth) => mouth.mesh.visible)) return;
            const far = WORMHOLES.find((mouth) => mouth.id === 'wormhole-ton618')!;
            const near = WORMHOLES.find((mouth) => mouth.id === 'wormhole-saturn')!;
            ask(skies.hole, far.position, false);
            blackHole.material.uniforms.uHasEnv.value = 1;
            // A game can begin on Haven, by TON 618: then the camera is on the far side, and home
            // is photographed out in space beyond the mouth by Saturn. (Taken from the camera it
            // was Haven's own ground, a green disc with islands in it, seen through the mouth.)
            const beyond = runtime.camera.distanceTo(BLACK_HOLE.position) < runtime.camera.distanceTo(near.position);
            if (beyond) {
                ask(skies.far, runtime.camera, false);
                state.far = runtime.camera.clone();
                ask(skies.home, near.exit.position, false);
                state.home = near.exit.position.clone();
            } else {
                // The far side as it is seen through the mouth by Saturn: the other galaxy's stars, as
                // in Interstellar, without TON 618 (its disk inside the sphere read as a ring in a
                // ring, a portal). Coming out of the far mouth, the black hole is there to meet.
                ask(skies.far, far.position, false);
                state.far = far.position.clone();
                ask(skies.home, runtime.camera, false);
                state.home = runtime.camera.clone();
            }
            mouths.forEach((mouth) => { mouth.material.uniforms.uHasLocal.value = 1; });
            state.at = now;
            return;
        }

        // The mouth the camera is nearest, in throat radii.
        let nearest = mouths[0];
        let nearestDistance = Infinity;
        for (const mouth of mouths) {
            if (mouth.region !== region) continue;
            const distance = runtime.camera.distanceTo(mouth.def.position) / mouth.def.radius;
            if (distance < nearestDistance) {
                nearest = mouth;
                nearestDistance = distance;
            }
        }
        // Far off, the mouth is small and the last photographs do; and at most
        // a few photographs a second.
        if (nearestDistance > 40 || now - state.at < 0.25) return;
        // Not while it is off screen.
        if (nearestDistance > MOUTH_REACH) {
            projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            frustum.setFromProjectionMatrix(projectionView);
            bounds.set(nearest.mesh.position, nearest.def.radius * MOUTH_REACH);
            if (!frustum.intersectsSphere(bounds)) return;
        }
        const spacing = Math.max(nearestDistance * 0.1, 0.25) * nearest.def.radius;
        // In an atmosphere the whole world is in the photograph: less often.
        const air = runtime.atmosphere > 0.02 ? 3 : 1;
        const here = state[nearest.side];
        if (!here || here.distanceTo(runtime.camera) > spacing * air) {
            ask(skies[nearest.side], runtime.camera, false);
            state[nearest.side] = runtime.camera.clone();
            state.at = now;
            return;
        }
        if (nearestDistance < 6) {
            // The matching point beyond the other mouth: as far from its
            // throat, in the linked direction, on the far side of it.
            const other = WORMHOLES.find((mouth) => mouth.id === nearest.def.to)!;
            toCamera.copy(runtime.camera).sub(nearest.def.position);
            const distance = Math.max(toCamera.length(), nearest.def.radius);
            toCamera.normalize().applyQuaternion(nearest.def.link);
            mirror.copy(other.position).addScaledVector(toCamera, -distance);
            const there = state[nearest.other];
            if (!there || there.distanceTo(mirror) > spacing) {
                ask(skies[nearest.other], mirror, false);
                state[nearest.other] = mirror.clone();
                state.at = now;
            }
        }
    }, -1);

    return (
        <>
            {region === 'ton' && <primitive object={holeView.mesh} />}
            {region === 'ton' && <primitive object={saturnStandIn.group} />}
            {mouths.filter((mouth) => mouth.region === region).map((mouth) => <primitive key={mouth.def.id} object={mouth.mesh} />)}
        </>
    );
};
