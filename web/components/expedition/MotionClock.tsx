import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import { WARPS, chooseAnchor, reframePoint, reframeVelocity, stepMotion, type Reframe } from './motion';
import { updateEnvironment } from './environment';
import type { ExpeditionRuntime } from './runtime';

/**
 * Runs the Solar System's clock before anything else each frame (motion.ts):
 * every world moves on along its orbit and turns, and when the player passes
 * from one world's reach into another's, the player is carried into the new
 * world's frame by one rigid move, so nothing seen changes.
 *
 * The time warp (. faster, , slower) speeds up the clock only: the ship and
 * the explorer still move at their own pace. Like a pilot's, it is held back
 * while flying anything that needs the real pace: the pulse drive, the
 * autopilot, a landing, the depths of a giant, the wormhole and TON 618.
 */
export const warpLimit = (runtime: ExpeditionRuntime) => {
    const ship = runtime.player?.ship;
    if (runtime.fall.active || runtime.autopilot) return 1;
    if (ship && runtime.mode === 'ship' && (ship.pulseEngaged || ship.pulse > 0.05 || ship.landing)) return 1;
    const eye = runtime.camera;
    if (eye.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * 400) return 1;
    for (const mouth of WORMHOLES) if (eye.distanceTo(mouth.position) < mouth.radius * 60) return 1;
    // Inside a giant the clouds are drawn a little each frame: the Sun must not race.
    if (runtime.gas) return 100;
    return WARPS[WARPS.length - 1];
};

/** Change the warp by `steps` (within what is allowed now); returns the new warp. */
export const changeWarp = (runtime: ExpeditionRuntime, steps: number) => {
    const motion = runtime.motion;
    const limit = warpLimit(runtime);
    let index = WARPS.indexOf(motion.warp);
    if (index < 0) index = 0;
    index = THREE.MathUtils.clamp(index + steps, 0, WARPS.length - 1);
    let warp = WARPS[index];
    if (warp > limit) {
        warp = WARPS.filter((w) => w <= limit).pop() ?? 1;
        const ship = runtime.player?.ship;
        if (ship && steps > 0) {
            ship.notice = 'TIME WARP HELD · NOT WHILE FLYING THIS';
            ship.noticeTime = performance.now() / 1000;
        }
    }
    motion.warp = warp;
    return warp;
};

/** Everything held in the game's frame that goes with the player when the frame changes. */
const STILL = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('still');

const carry = (runtime: ExpeditionRuntime, r: Reframe) => {
    const keep = runtime.player;
    if (keep) {
        const ship = keep.ship;
        reframePoint(r, ship.position);
        reframeVelocity(r, ship.velocity);
        ship.drift.applyQuaternion(r.rotation);
        ship.wind.applyQuaternion(r.rotation);
        ship.quaternion.premultiply(r.rotation);
        ship.angular.applyQuaternion(r.rotation);
        if (ship.landing) {
            reframePoint(r, ship.landing.from);
            reframePoint(r, ship.landing.to);
            ship.landing.fromQ.premultiply(r.rotation);
            ship.landing.toQ.premultiply(r.rotation);
        }
        const walker = keep.walker.current;
        if (walker) {
            reframePoint(r, walker.position);
            reframeVelocity(r, walker.velocity);
            walker.facing.applyQuaternion(r.rotation);
            walker.look.applyQuaternion(r.rotation);
        }
        keep.camera.current.quaternion.premultiply(r.rotation);
    }
    reframePoint(r, runtime.origin);
    reframePoint(r, runtime.camera);
    for (const rock of runtime.asteroids) reframePoint(r, rock.position);
    const field = runtime.asteroidField;
    if (field) {
        reframePoint(r, field.center);
        reframePoint(r, field.entry);
    }
    if (runtime.gas?.flash) reframePoint(r, runtime.gas.flash.position);
    const rotation = r.rotation.clone();
    const from = r.from.clone();
    const to = r.to.clone();
    runtime.moved = {
        count: runtime.moved.count + 1,
        carry: (p) => { p.sub(from).applyQuaternion(rotation).add(to); },
    };
};

export const MotionClock = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (runtime.sites.open) return;
            if (event.code === 'Period') changeWarp(runtime, 1);
            else if (event.code === 'Comma') changeWarp(runtime, -1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [runtime]);

    // Into another world's reach: follow it at once (updateEnvironment asks).
    useEffect(() => {
        runtime.reanchor = () => {
            const motion = runtime.motion;
            const keep = runtime.player;
            const walker = keep?.walker.current;
            const position = keep ? (runtime.mode === 'walk' && walker ? walker.position : keep.ship.position) : runtime.origin;
            const reframe = stepMotion(motion, 0, chooseAnchor(motion, runtime.currentBody, position));
            if (!reframe) return false;
            motion.warp = 1;
            carry(runtime, reframe);
            return true;
        };
        return () => { runtime.reanchor = null; };
    }, [runtime]);

    useEffect(() => {
        if (!import.meta.env.DEV) return undefined;
        const debug = window as unknown as { __motion?: unknown };
        debug.__motion = runtime.motion;
        return () => { delete debug.__motion; };
    }, [runtime]);

    useFrame((_, delta) => {
        const motion = runtime.motion;
        // A data log or the plunge into TON 618 stops the clock with the game.
        // (Test pages can hold it still with ?still, so the worlds stay where they start.)
        const dt = runtime.sites.open || runtime.fall.active || STILL ? 0 : Math.min(delta, 0.1);
        const limit = warpLimit(runtime);
        if (motion.warp > limit) motion.warp = WARPS.filter((w) => w <= limit).pop() ?? 1;
        const keep = runtime.player;
        const walker = keep?.walker.current;
        const position = keep ? (runtime.mode === 'walk' && walker ? walker.position : keep.ship.position) : runtime.origin;
        // At the very start the world the player is at is the frame already.
        if (motion.seconds === 0 && !motion.anchor && !runtime.currentBody) updateEnvironment(runtime, position);
        const anchor = chooseAnchor(motion, runtime.currentBody, position);
        const reframe = stepMotion(motion, dt, anchor);
        if (reframe) {
            // A new frame: back to the real pace (whatever was closing on the
            // new world keeps closing as it was at that pace).
            motion.warp = 1;
            carry(runtime, reframe);
        }
    }, -3);
    return null;
};
