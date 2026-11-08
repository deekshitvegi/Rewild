/**
 * Breakers rolling in to a shore, the same in the picture (WaterSurface.tsx, GLSL) and in the
 * game (a swimmer rides them: walking.ts). The crests run along the coast, on lines of equal
 * distance from it (the shore field the ground already has), and travel towards the beach at
 * the speed of a wave in shallow water; they grow as the water shoals and are spent on the sand.
 * Out at sea, further than OPEN metres from the shore, they die away into the wind's waves.
 */

/** Crest to crest (m), and how fast they come in (m/s): about the speed of a wave in water a metre deep. */
export const SEA_WAVE_LENGTH = 9;
export const SEA_WAVE_SPEED = 3.1;
/** Their height off the beach (m), before shoaling; how far out they still run. */
export const SEA_WAVE_HEIGHT = 0.24;
export const SEA_WAVE_OPEN = 160;

/** The clock the waves run on (seconds; real time, not the universe's warped clock). */
export const SEA_CLOCK = { value: 0 };

const smoothstep = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

const K = (Math.PI * 2) / SEA_WAVE_LENGTH;

/** The crest's place in its cycle (0 trough .. 1 crest). */
const crest = (shore: number, time: number) => {
    const s = Math.sin(shore * K - time * K * SEA_WAVE_SPEED);
    return Math.pow((s + 1) / 2, 2.2);
};

/** Height of the sea above its still level here (m), from the distance to the shore (negative out to sea) and the depth. */
export const seaSwell = (shore: number, depth: number, time: number, waves = 1) => {
    if (shore >= 0 || depth <= 0) return 0;
    const shoal = 1 + 0.7 * (1 - smoothstep(0.6, 6, depth));
    const spent = smoothstep(0.05, 0.7, depth);
    const open = 1 - smoothstep(SEA_WAVE_OPEN * 0.5, SEA_WAVE_OPEN, -shore);
    return SEA_WAVE_HEIGHT * waves * shoal * spent * open * (crest(shore, time) * 2 - 0.55);
};


/**
 * GLSL: `float seaSwell(float shore, float depth, float t, float waves)` and its slope along the
 * shore's field, `seaSwellSlope` (m of height per m towards the land); `seaCrest` for the foam.
 */
export const SEA_WAVES_GLSL = /* glsl */ `
const float SEA_K = ${K.toFixed(6)};
const float SEA_C = ${SEA_WAVE_SPEED.toFixed(3)};
float seaCrest(float shore, float t) {
    return pow((sin(shore * SEA_K - t * SEA_K * SEA_C) + 1.0) * 0.5, 2.2);
}
float seaSwellAmp(float shore, float depth, float waves) {
    if (shore >= 0.0 || depth <= 0.0) return 0.0;
    float shoal = 1.0 + 0.7 * (1.0 - smoothstep(0.6, 6.0, depth));
    float spent = smoothstep(0.05, 0.7, depth);
    float open = 1.0 - smoothstep(${(SEA_WAVE_OPEN * 0.5).toFixed(1)}, ${SEA_WAVE_OPEN.toFixed(1)}, -shore);
    return ${SEA_WAVE_HEIGHT.toFixed(3)} * waves * shoal * spent * open;
}
float seaSwell(float shore, float depth, float t, float waves) {
    return seaSwellAmp(shore, depth, waves) * (seaCrest(shore, t) * 2.0 - 0.55);
}
float seaSwellSlope(float shore, float depth, float t, float waves) {
    float p = shore * SEA_K - t * SEA_K * SEA_C;
    float s = (sin(p) + 1.0) * 0.5;
    // d/dshore of 2 * pow(s, 2.2): 2 * 2.2 * s^1.2 * 0.5 * cos(p) * K
    return seaSwellAmp(shore, depth, waves) * 2.2 * pow(max(s, 1e-4), 1.2) * cos(p) * SEA_K;
}
`;
