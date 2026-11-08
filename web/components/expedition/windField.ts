import * as THREE from 'three';
import type { WeatherState } from './weather';

/**
 * One wind for everything that grows on the world the explorer is on. The grass's blades (Grass.tsx)
 * and the meadow beyond them (PlanetTerrain.tsx) read the same field of gusts, so the bands that lay
 * the blades over carry on across the far grass, and both lean the way the weather's wind blows
 * (weather.ts), harder as it rises.
 *
 * The gusts are bands of stronger wind, long across the wind and short along it, that travel
 * downwind at about the wind's speed: you can watch one come across a field towards you.
 *
 * Shared uniform objects: every material that includes WIND_GLSL (and WIND_GUST_GLSL, after
 * TEXTURE_NOISE_GLSL, to read the gusts) spreads them into its uniforms; updateWind sets them once
 * a frame.
 */
export const WIND_UNIFORMS = {
    /** The wind's direction along the ground where the explorer is (planet frame, unit). */
    uWindDir: { value: new THREE.Vector3(0.8, 0, 0.6) },
    /** Its steady speed, m/s (eased, so the blades do not snap when it changes). */
    uWindSpeed: { value: 3 },
    /** How far the gusts have travelled downwind, m. */
    uWindPhase: { value: 0 },
};

export const WIND_GLSL = /* glsl */ `
uniform vec3 uWindDir;
uniform float uWindSpeed;
uniform float uWindPhase;
// How hard the wind leans what grows, 0 (still air) to about 1 (a gale).
float windStrength() {
    return clamp(0.12 + uWindSpeed * 0.07, 0.0, 1.2);
}
`;

/** The gusts themselves (after TEXTURE_NOISE_GLSL and WIND_GLSL). */
export const WIND_GUST_GLSL = /* glsl */ `
// The gusts at p (planet frame, metres): 0 in the lulls, 1 in the middle of a gust. Two reads of
// the noise volume, stretched along the wind so each gust is a band across it.
float windGust(vec3 p) {
    float along = dot(p, uWindDir);
    vec3 q = p + uWindDir * (along * 1.6 - uWindPhase * 2.6);
    float g = tnoise4(q * 0.032).x * 0.7 + tnoise4(q * 0.083 + vec3(5.3, 1.7, 9.1)).y * 0.3;
    return smoothstep(-0.12, 0.42, g);
}
`;

const along = new THREE.Vector3();

/**
 * The wind where the explorer stands (`up`: the planet frame's up there), from the weather. The
 * direction turns slowly, so a wind that swings round does not swing the whole field at once.
 */
export const updateWind = (weather: WeatherState, up: THREE.Vector3, delta: number) => {
    const dt = Math.min(delta, 0.1);
    along.copy(weather.wind).addScaledVector(up, -weather.wind.dot(up));
    const speed = along.length();
    const dir = WIND_UNIFORMS.uWindDir.value;
    // Keep the old direction on the ground here (the explorer may have walked round the world).
    dir.addScaledVector(up, -dir.dot(up));
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0).addScaledVector(up, -up.x);
    dir.normalize();
    if (speed > 0.05) dir.lerp(along.divideScalar(speed), Math.min(1, dt * 0.6)).normalize();
    const eased = WIND_UNIFORMS.uWindSpeed;
    eased.value += (speed - eased.value) * Math.min(1, dt * 1.5);
    // The gusts ride the wind, never quite still.
    WIND_UNIFORMS.uWindPhase.value += dt * Math.max(eased.value, 0.8);
};
