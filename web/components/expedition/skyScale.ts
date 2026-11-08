import * as THREE from 'three';
import { THE_SUN, findBody, type ExpeditionBody } from './bodies';
import type { ExpeditionRuntime } from './runtime';

/**
 * Moons in the sky, drawn larger than life.
 *
 * At its true size the Moon is half a degree across: about thirteen pixels on a laptop screen, a
 * speck a photograph shows but the eye does not. People see it far bigger than that (the eye
 * fixes on it; at the horizon, bigger still), so a moon is drawn up to four times its size: the
 * Moon from Earth about two degrees.
 *
 * How much larger depends only on how far the moon is (and how far its planet is), never on
 * whether the eye is on the ground: it used to be only from the ground, so climbing towards the
 * Moon it shrank to a quarter, and it looked as if it was flying away. Now its size only ever
 * grows as it comes closer: as the square root of its true size while it is far (so the boost
 * eases off as it nears), and its true size from a few of its own widths away. Far from its
 * planet (looking back at the pair from deep space) it is true size, so the Moon never looks as
 * big as the Earth. And not near the Sun: there it shrinks back to true size, so that an eclipse
 * is exactly what the geometry gives (eclipse.ts).
 */
/** Across, in the sky, where the boost has eased off to nothing (a moon this wide is true size). */
const TRUE_FROM = THREE.MathUtils.degToRad(7.7);
/** Smaller than this (a moon seen as a star) it is left alone: PlanetPoints draws it; the boost eases in above it. */
const SMALLEST = THREE.MathUtils.degToRad(0.08);
const MOST = 4;
const NEAR_SUN = THREE.MathUtils.degToRad(3);
const CLEAR_OF_SUN = THREE.MathUtils.degToRad(10);

const toBody = new THREE.Vector3();
const toSun = new THREE.Vector3();

/** How many times its true size `body` is drawn from where the camera is now (1: true size). */
export const skyScale = (runtime: ExpeditionRuntime, body: ExpeditionBody) => {
    if (body === runtime.currentBody || body.kind !== 'rocky' || !body.parent) return 1;
    const host = findBody(body.parent);
    if (!host) return 1;
    toBody.copy(body.position).sub(runtime.camera);
    const distance = toBody.length();
    if (distance <= body.radius * 4) return 1;
    const across = 2 * Math.asin(body.radius / distance);
    if (across < SMALLEST || across >= TRUE_FROM) return 1;
    // Drawn as wide as sqrt(across x TRUE_FROM): wider the closer, never more than MOST times.
    const boost = Math.min(MOST, Math.sqrt(TRUE_FROM / across));
    // Eased in from a star's size, and out far from its planet (the orbit's width, 1.5 to 3 times).
    const orbit = body.position.distanceTo(host.position);
    const fromHost = runtime.camera.distanceTo(host.position);
    const weight = THREE.MathUtils.smoothstep(across, SMALLEST, SMALLEST * 2) * (1 - THREE.MathUtils.smoothstep(fromHost, orbit * 1.5, orbit * 3));
    toSun.copy(THE_SUN.position).sub(runtime.camera);
    const clear = THREE.MathUtils.smoothstep(toBody.angleTo(toSun), NEAR_SUN, CLEAR_OF_SUN);
    return 1 + (boost - 1) * clear * weight;
};
