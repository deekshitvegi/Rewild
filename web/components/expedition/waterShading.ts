/**
 * The shading of a world's water shared by the ground's far-off painted water (PlanetTerrain.tsx)
 * and the water's own surface near the explorer (WaterSurface.tsx): its waves and ripples as
 * slopes, a river's flow-mapped ripples, and the caustics on a shallow bed. The shader including
 * these declares uTime and uWaves and includes TEXTURE_NOISE_GLSL (tslope, tnoise4) first.
 */

export const WATER_TURNS_GLSL = /* glsl */ `
// Three fixed turns (about unrelated axes) to read the noise volume at
// different angles, so the repeats of different sizes never line up.
const mat3 TURN_A = mat3(0.4926, 0.7926, -0.3593, -0.6365, 0.6097, 0.4724, 0.5935, -0.0040, 0.8049);
const mat3 TURN_B = mat3(0.4446, -0.2510, -0.8599, -0.8599, -0.3886, -0.3312, -0.2510, 0.8866, -0.3886);
const mat3 TURN_C = mat3(0.9160, 0.2940, 0.2730, -0.3947, 0.7816, 0.4829, -0.0714, -0.5501, 0.8320);
`;

export const WATER_WAVES_GLSL = /* glsl */ `
// Slope of a drifting noise field at p (scaled by 'scale' per metre), read
// from the slope volume (one read where finite differences of gnoise took
// four noise evaluations). 'turn' sets each size of wave at its own angle,
// so the volume's repeat never lines up between them.
vec3 waveSlope(vec3 pos, float scale, vec3 drift, mat3 turn) {
    return transpose(turn) * tslope(turn * (pos * scale) + drift) * scale;
}

// The water's surface: the local up, tilted by wind waves a few metres long
// and small ripples on them, each faded out once a pixel covers much of a
// wave, so the far water is smooth instead of shimmering.
vec3 waterNormal(vec3 up, vec3 pos, float footprint) {
    float swell = 1.0 - smoothstep(2.0, 8.0, footprint);
    float waves = 1.0 - smoothstep(0.4, 1.6, footprint);
    float ripples = 1.0 - smoothstep(0.06, 0.3, footprint);
    vec3 grad = vec3(0.0);
    if (swell > 0.0) grad += waveSlope(pos, 0.07, vec3(uTime * 0.02, uTime * 0.006, uTime * 0.015), TURN_A) * 0.35 * swell;
    if (waves > 0.0) grad += waveSlope(pos, 0.34, vec3(uTime * 0.09, uTime * 0.02, uTime * 0.06), TURN_B) * 0.1 * waves;
    if (ripples > 0.0) grad += waveSlope(pos, 1.3, vec3(-uTime * 0.25, uTime * 0.31, uTime * 0.12), TURN_C) * 0.035 * ripples;
    grad *= uWaves;
    grad -= up * dot(grad, up);
    return normalize(up - grad);
}

// Ripples a few metres long, as slopes, read where they are.
vec3 rippleSlope(vec3 p, float footprint) {
    float waves = 1.0 - smoothstep(0.4, 1.6, footprint);
    return waves > 0.0 ? waveSlope(p, 0.45, vec3(0.0), TURN_B) * 0.13 * waves : vec3(0.0);
}

// A river's surface: its ripples drawn out along the current and carried downstream. The same
// ripples are read at two places slid along the flow by turns, each fading out as it reaches the
// end of its slide while the other is mid-way, so nothing jumps (flow mapping). Still water (no
// flow) keeps the wind's waves.
vec3 riverNormal(vec3 up, vec3 pos, float footprint, vec3 flow, out float speed) {
    speed = length(flow);
    if (speed < 0.03) return waterNormal(up, pos, footprint);
    vec3 dir = flow / speed;
    // Drawn out along the current: the ripples' lengthwise size stretched two and a half times.
    vec3 p = pos - dir * dot(pos, dir) * 0.6;
    const float period = 1.6;
    float phase = uTime / period;
    float a = fract(phase);
    float b = fract(phase + 0.5);
    float wa = 1.0 - abs(2.0 * a - 1.0);
    // Metres the water moves in one slide (about 1.5 m/s mid-stream).
    float travel = 2.4 * period * speed;
    vec3 grad = rippleSlope(p - dir * travel * a, footprint) * wa
        + rippleSlope(p - dir * travel * b + vec3(5.13, 2.71, 3.37), footprint) * (1.0 - wa);
    // The finest ripples, too small to follow the current, just carried along with it.
    float ripples = 1.0 - smoothstep(0.06, 0.3, footprint);
    if (ripples > 0.0) grad += waveSlope(p, 1.7, -dir * uTime * 1.7 * speed, TURN_C) * 0.05 * ripples;
    grad *= 0.6 + 0.8 * speed;
    grad -= up * dot(grad, up);
    return normalize(up - grad);
}

// Glints: the light caught on the steepest of the finest ripples, a scatter of pinpoints that move
// with the water (carried down a river by its flow, drifting with the wind elsewhere) and fade out
// before a pixel covers a ripple, so far water never speckles. Over 1, so the bloom spreads them
// (Medium and High); on Low they are small white sparks.
float waterGlint(vec3 N, vec3 V, vec3 up, vec3 pos, float footprint, vec3 dir, float speed) {
    float near = 1.0 - smoothstep(0.02, 0.12, footprint);
    if (near <= 0.0) return 0.0;
    vec3 p = speed > 0.03 ? pos - dir * uTime * 1.6 * speed : pos + vec3(uTime * 0.07, -uTime * 0.05, uTime * 0.04);
    vec3 g = waveSlope(p, 3.0, vec3(0.0, uTime * 0.11, 0.0), TURN_A) * 0.22 + waveSlope(p, 7.0, vec3(uTime * 0.19, 0.0, 0.0), TURN_B) * 0.12;
    g -= up * dot(g, up);
    vec3 R = reflect(-V, normalize(N - g));
    return pow(max(dot(R, uSunDir), 0.0), 1400.0) * 40.0 * near;
}

// The bright net the ripples focus the sun into on a shallow bed: two webs of ridged noise
// (two channels of one read) crossing each other as they drift.
float caustics(vec3 p, vec3 drift) {
    vec4 n = tnoise4(p * 0.9 + drift);
    return pow(min(1.0 - abs(n.x), 1.0 - abs(n.y)), 6.0);
}
`;
