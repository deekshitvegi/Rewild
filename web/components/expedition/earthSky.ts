import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';

/**
 * Earth seen from above its weather (Earth only: `biome.space` in bodies.ts), graded against NASA's photographs
 * (Apollo 17's whole disc, the ISS's limb over cloud tops and its cloud fields near Borneo):
 *
 * - The air is real air, scattering as air does: Rayleigh's blue, a little haze (Mie) bright round the sun,
 *   and sunlight reddened by the long way in at the terminator. Single scattering along the view, the sunlight
 *   reaching each point worked out with Schüler's approximation of the Chapman function, so the night side is
 *   black, the limb a thin blue line fading to black, and the terminator a narrow warm band. Its depth straight
 *   down is the real one (Rayleigh 0.05, 0.11, 0.26 in red, green, blue).
 * - The game's Earth is small (12 km across a walk, 531 m a unit across the globe) and its air and clouds are
 *   tall for it, so a walker gets a sky: from a few hundred metres up the clouds are drawn at 560 m. Seen from
 *   orbit at that height they stood far above a real limb and the air round them was a broad pale ring. So as
 *   the camera climbs above the clouds both settle towards the ground (`liftAt`): the deck and its shadows, the
 *   cumulus, and the air's scale height, keeping the clouds inside the blue line at every distance.
 * - Above `SPACE_FROM` metres this model takes over from the walker's sky (Atmosphere.tsx), fully by `SPACE_TO`;
 *   the ground's own haze (surfaceShading applyHaze) gives way to it over the same climb.
 */

/** The cloud deck's height above the ground as a share of the air's (Clouds.tsx), seen from below. */
export const DECK_SHARE = 0.4;
/** Climbing through these heights (m) the space view takes over from the walker's sky. */
export const SPACE_FROM = 450;
export const SPACE_TO = 1100;
/** From this height (m) the clouds and the air begin to settle; by about four times it they are at LIFT_FAR. */
const LIFT_FROM = 650;
const LIFT_FAR = 0.22;

/** How far the deck (and the air with it) has settled for a camera this high above the ground: 1 near, LIFT_FAR far. */
export const liftAt = (height: number) => THREE.MathUtils.clamp(Math.pow(LIFT_FROM / Math.max(height, 1), 1.2), LIFT_FAR, 1);

/** The share of the space view for a camera this high (0 the walker's sky, 1 the view from orbit). */
export const spaceShare = (height: number) => THREE.MathUtils.smoothstep(height, SPACE_FROM, SPACE_TO);

/** The air's scale height (m) in the space view for a camera this high: the deck stands 2.4 of them up. */
export const scaleHeightAt = (body: ExpeditionBody, height: number) =>
    body.biome!.atmosphereHeight * DECK_SHARE * liftAt(height) / 2.4;

/** Real vertical optical depths of Earth's air (Rayleigh at 680, 550, 440 nm; haze at 550 nm). */
const RAYLEIGH_DEPTH = new THREE.Vector3(0.0464, 0.1085, 0.2648);
const HAZE_DEPTH = 0.06;

/**
 * The uniforms of the space view, shared by the air (Atmosphere.tsx) and the clouds (Clouds.tsx) of one world
 * and set once a frame by setSpaceView. `uSpaceShare` is also every Earth surface material's (applyHaze).
 */
const VIEWS = new Map<string, ReturnType<typeof makeView>>();
const makeView = () => ({
    uSpaceShare: { value: 0 },
    uSpaceH: { value: 100 },
    uSpaceBetaR: { value: new THREE.Vector3() },
    uSpaceBetaM: { value: 0 },
    uSpaceHM: { value: 15 },
});
export const spaceViewOf = (body: ExpeditionBody) => {
    let view = VIEWS.get(body.id);
    if (!view) {
        view = makeView();
        VIEWS.set(body.id, view);
    }
    return view;
};

/** The space view for a camera `height` above `body`'s ground, with `ash` (0-1) of the ruined world's dust aloft. */
export const setSpaceView = (body: ExpeditionBody, height: number, ash = 0) => {
    const view = spaceViewOf(body);
    const H = scaleHeightAt(body, height);
    view.uSpaceShare.value = spaceShare(height);
    view.uSpaceH.value = H;
    view.uSpaceBetaR.value.copy(RAYLEIGH_DEPTH).divideScalar(H);
    // Haze sits low (a sixth of the air's scale height); the ruined world's dust thickens it.
    const HM = Math.max(H / 6, 2);
    view.uSpaceHM.value = HM;
    view.uSpaceBetaM.value = (HAZE_DEPTH + 0.22 * ash) / HM;
};

/**
 * GLSL for the space view: needs uRadius, uSunDir, uSunColor and uSpaceShare (SURFACE_SHADING_GLSL declares
 * them) and the uniforms above. All in the world's frame (its centre at the origin), lengths in metres.
 */
export const SPACE_AIR_GLSL = /* glsl */ `
uniform float uSpaceH;
uniform vec3 uSpaceBetaR;
uniform float uSpaceBetaM;
uniform float uSpaceHM;

// The column of air (length times ground-level density) from radius r along a ray at cosine mu from its zenith,
// out to space, for air thinning with scale height H: the Chapman function, through the bounds on erfc
// (sqrt(2x) / (y + sqrt(y^2 + 4/pi)), y = sqrt(x/2) mu): within 5% of the exact integral from overhead to grazing
// (checked numerically, 9 Nov). Downward rays use the identity through their lowest point.
float spaceColumnUp(float r, float mu, float H) {
    float x = r / H;
    float y = sqrt(0.5 * x) * mu;
    return H * sqrt(2.0 * x) / (y + sqrt(y * y + 1.2732395)) * exp(-(r - uRadius) / H);
}
float spaceColumn(float r, float mu, float H) {
    if (mu >= 0.0) return spaceColumnUp(r, mu, H);
    // (Where that point is under the ground the column only grows: the light is cut off there anyway.)
    float lowest = r * sqrt(1.0 - mu * mu);
    float rt = max(lowest, uRadius);
    return 2.0 * spaceColumnUp(rt, 0.0, H) * exp(min((rt - lowest) / H, 60.0)) - spaceColumnUp(r, -mu, H);
}

// Optical depth (red, green, blue) from a point at radius r, along a ray at cosine mu from its zenith, out of
// the air: air and haze together.
vec3 spaceDepth(float r, float mu) {
    return uSpaceBetaR * spaceColumn(r, mu, uSpaceH) + vec3(uSpaceBetaM * 1.1 * spaceColumn(r, mu, uSpaceHM));
}

// Sunlight reaching a point at radius r with local up 'up': reddened through the air, and cut off where the line
// to the sun passes under the ground (softened over a fraction of a scale height: the sun is not a point).
vec3 spaceSunlight(float r, vec3 up) {
    float mu = dot(up, uSunDir);
    float lowest = mu >= 0.0 ? r : r * sqrt(1.0 - mu * mu);
    return exp(-spaceDepth(r, mu)) * smoothstep(uRadius - uSpaceH * 0.15, uRadius + uSpaceH * 0.35, lowest);
}

float spacePhaseR(float c) { return 0.0596831 * (1.0 + c * c); }
float spacePhaseM(float c) {
    const float g = 0.76;
    return 0.1193662 * (1.0 - g * g) * (1.0 + c * c) / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * c, 1e-4), 1.5));
}

// Air between the eye (far above) and a point at 'pos' seen along unit 'view' (from the eye towards it): what
// gets through (returned in 'through') and the light the air adds. Cheap: one column each way, for clouds.
vec3 spaceVeil(vec3 pos, vec3 view, out vec3 through) {
    float r = length(pos);
    vec3 up = pos / r;
    vec3 tau = spaceDepth(r, -dot(up, view));
    through = exp(-tau);
    float c = dot(view, uSunDir);
    vec3 sun = spaceSunlight(r + uSpaceH * 0.7, up);
    vec3 ratio = (uSpaceBetaR * spacePhaseR(c) + vec3(uSpaceBetaM * spacePhaseM(c))) / (uSpaceBetaR + vec3(uSpaceBetaM * 1.1));
    return uSunColor * 1.45 * 3.14159 * 1.6 * sun * ratio * (1.0 - through);
}
`;
