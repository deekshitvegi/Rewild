import * as THREE from 'three';
import { revivalUniform } from './revival';
import type { ExpeditionBody } from './bodies';
import { WEATHER_UNIFORMS } from './weather';
import { spaceViewOf } from './earthSky';

/**
 * The eye under water, shared by every material that hazes with distance: the water's colour
 * (rgb) and the eye's depth under its surface (w, 0 in the air). Set by WaterSurface.tsx.
 */
export const UNDERWATER = { value: new THREE.Vector4(0, 0, 0, 0) };

/**
 * Lighting and aerial perspective shared by everything that stands on a
 * world: the terrain, rocks, trees, arches, creatures. Using one model means a
 * tree on a far hill fades into the haze exactly as the hill behind it does,
 * instead of standing out as a dark cut-out.
 *
 * Positions are in the planet's local frame (planet centre at the origin).
 */
export const SURFACE_SHADING_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uHaze;
uniform float uRadius;
uniform float uAtmoRadius;
uniform vec3 uCamLocal;
uniform vec3 uTorchPos;
uniform vec3 uTorchDir;
uniform float uTorch;
uniform vec3 uFirePos;
uniform float uFire;
uniform float uAerial;
uniform float uOvercast;
// The ground's colour: sunlight thrown back up off it lights what faces away
// from the sun (on an airless world, the only light in a shadow).
uniform vec3 uBounce;
uniform vec4 uDeck;
uniform vec3 uDeckColor;
// The weather (weather.ts): storm cloud overhead, blowing dust, a lightning flash.
uniform float uStorm;
// The eye under water (WaterSurface.tsx): the water's colour as lit here, and how far under the
// surface the eye is (0: in the air).
uniform vec4 uUnderwater;
uniform float uDust;
uniform float uFlash;
// Earth from above its weather (earthSky.ts): the air seen from orbit takes over from this haze (0 elsewhere).
uniform float uSpaceShare;
// The share of the sun's direct light a surface gets here: less in a cloud's shadow (Earth's ground sets it from
// cloudShadow.ts before it is lit; 1 everywhere else).
float gSunShade = 1.0;

// The explorer's torch, or the ship's lamps: a cone of warm white light from
// uTorchPos along uTorchDir (both in the planet's frame), with a little spill
// round its edge, falling off over a few tens of metres.
vec3 torchLight(vec3 albedo, vec3 N, vec3 localPos) {
    if (uTorch <= 0.0) return vec3(0.0);
    vec3 toPoint = localPos - uTorchPos;
    float dist = length(toPoint);
    vec3 L = toPoint / max(dist, 1e-3);
    float along = dot(L, uTorchDir);
    float cone = smoothstep(0.86, 0.97, along) + smoothstep(0.55, 0.88, along) * 0.14;
    float falloff = 1.0 / (1.0 + dist * dist * 0.004);
    float facing = max(dot(N, -L), 0.0) * 0.85 + 0.15;
    return albedo * vec3(1.0, 0.93, 0.82) * cone * falloff * facing * 2.2 * uTorch;
}

// A campfire's flickering glow, reaching ten metres or so.
vec3 fireLight(vec3 albedo, vec3 N, vec3 localPos) {
    if (uFire <= 0.0) return vec3(0.0);
    vec3 toFire = uFirePos - localPos;
    float dist = length(toFire);
    float falloff = 1.0 / (1.0 + dist * dist * 0.07);
    float facing = max(dot(N, toFire / max(dist, 1e-3)), 0.0) * 0.8 + 0.2;
    return albedo * vec3(1.0, 0.52, 0.2) * falloff * facing * 1.9 * uFire;
}

// Everything the player carries or makes that gives light.
vec3 playerLights(vec3 albedo, vec3 N, vec3 localPos) {
    return torchLight(albedo, N, localPos) + fireLight(albedo, N, localPos);
}

// Air between the camera and a point, weighted so that thin high air counts
// for little: looking down from orbit barely hazes the ground, looking along
// the ground at the horizon hazes it a lot.
float airDepth(vec3 origin, vec3 target) {
    vec3 ray = target - origin;
    float len = length(ray);
    vec3 r = ray / max(len, 1e-4);
    float b = dot(origin, r);
    float c = dot(origin, origin) - uAtmoRadius * uAtmoRadius;
    float disc = b * b - c;
    if (disc <= 0.0) return 0.0;
    float s = sqrt(disc);
    float t0 = max(0.0, -b - s);
    float t1 = min(len, -b + s);
    if (t1 <= t0) return 0.0;
    float thickness = uAtmoRadius - uRadius;
    float scaleHeight = thickness * 0.2;
    float depth = 0.0;
    for (int i = 0; i < 3; i++) {
        float t = mix(t0, t1, (float(i) + 0.5) / 3.0);
        float h = length(origin + r * t) - uRadius;
        depth += exp(-max(h, 0.0) / scaleHeight);
    }
    return depth * (t1 - t0) / 3.0 / thickness;
}

float surfaceDay(vec3 up) {
    return smoothstep(-0.18, 0.22, dot(up, uSunDir));
}

// Sun plus sky light on a surface with normal N at a place whose local up is
// 'up'. 'wrap' lets light reach round the terminator, for leaves.
vec3 surfaceLightWrap(vec3 albedo, vec3 N, vec3 up, float wrap) {
    float sunUp = dot(up, uSunDir);
    float day = surfaceDay(up);
    float direct = max((dot(N, uSunDir) + wrap) / (1.0 + wrap), 0.0) * smoothstep(-0.05, 0.1, sunUp) * gSunShade;
    vec3 skyAmbient = mix(uHorizon, uZenith, 0.55);
    float hemi = 0.55 + 0.45 * dot(N, up);
    // Under a deck of cloud (Venus) most of the light comes from the whole sky,
    // not from the sun's direction: soft, and the colour of the cloud.
    direct *= 1.0 - 0.8 * uOvercast;
    // Storm cloud overhead takes most of the sun and greys the sky's light;
    // blowing dust takes it too, and browns it.
    direct *= (1.0 - 0.82 * uStorm) * (1.0 - 0.85 * uDust);
    skyAmbient = mix(skyAmbient, vec3(0.2, 0.21, 0.24), uStorm * 0.6) * (1.0 - 0.4 * uStorm);
    skyAmbient = mix(skyAmbient, vec3(0.42, 0.27, 0.15), uDust * 0.5);
    // Light off the sunlit ground round about: as much as the ground's albedo,
    // over the half of the sky below a surface's horizon.
    float bounce = max(sunUp, 0.0) * (0.5 - 0.5 * dot(N, up)) * (1.0 - 0.8 * uOvercast) * (1.0 - 0.82 * uStorm) * gSunShade;
    vec3 light = uSunColor * direct * 1.45 + skyAmbient * hemi * (0.06 + 0.3 * day) * (1.0 + 2.4 * uOvercast) + vec3(0.012, 0.014, 0.022)
        + uSunColor * uBounce * bounce * 1.45;
    // A flash of lightning lights everything for an instant, from above.
    light += vec3(0.8, 0.84, 1.0) * uFlash * (0.5 + 0.5 * hemi);
    return albedo * light;
}

vec3 surfaceLight(vec3 albedo, vec3 N, vec3 up) {
    return surfaceLightWrap(albedo, N, up, 0.0);
}

// Length of the stretch from the camera to 'target' that lies in the shell
// between two radii (the cloud deck).
float shellPath(vec3 origin, vec3 target, float inner, float outer) {
    vec3 ray = target - origin;
    float len = length(ray);
    vec3 r = ray / max(len, 1e-4);
    float b = dot(origin, r);
    float o2 = dot(origin, origin);
    float discOuter = b * b - (o2 - outer * outer);
    if (discOuter <= 0.0) return 0.0;
    float so = sqrt(discOuter);
    float a0 = max(-b - so, 0.0);
    float a1 = min(-b + so, len);
    if (a1 <= a0) return 0.0;
    float inside = a1 - a0;
    float discInner = b * b - (o2 - inner * inner);
    if (discInner > 0.0) {
        float si = sqrt(discInner);
        float i0 = max(-b - si, a0);
        float i1 = min(-b + si, a1);
        inside -= max(i1 - i0, 0.0);
    }
    return inside;
}

// Blend towards the sky colour with the air between the camera and localPos.
vec3 applyHaze(vec3 color, vec3 localPos, vec3 up) {
    // Rain thickens the air; a dust storm closes it to a few hundred metres.
    float thick = 1.0 + uStorm * 2.2 + uDust * 9.5;
    float haze = 1.0 - exp(-airDepth(uCamLocal, localPos) * 0.9 * uHaze * uAerial * thick);
    // (From orbit Earth's air is drawn over the ground as real air, Atmosphere.tsx: not twice.)
    haze *= 1.0 - uSpaceShare;
    vec3 viewDir = normalize(localPos - uCamLocal);
    // Looking down through the air it is sky-blue, along the ground it is the
    // pale horizon colour.
    vec3 hazeColor = mix(uHorizon, uZenith, clamp(-dot(viewDir, up) * 1.6, 0.0, 1.0) * 0.8 + 0.12);
    float day = surfaceDay(up);
    float sunScatter = pow(max(dot(viewDir, uSunDir), 0.0), 6.0);
    hazeColor = hazeColor * (0.12 + 0.88 * day) + uSunColor * sunScatter * 0.25 * day * (1.0 - max(uStorm, uDust));
    hazeColor = mix(hazeColor, vec3(0.2, 0.21, 0.23) * (0.15 + 0.85 * day), uStorm * 0.7);
    hazeColor = mix(hazeColor, vec3(0.5, 0.33, 0.19) * (0.15 + 0.85 * day), uDust * 0.85);
    hazeColor += vec3(0.6, 0.63, 0.75) * uFlash * 0.5;
    color = mix(color, hazeColor, clamp(haze, 0.0, mix(0.94, 0.99, uDust)));
    // A deck of cloud between (Venus, from above it): the cloud tops, sunlit.
    if (uDeck.w > 0.0) {
        float path = shellPath(uCamLocal, localPos, uRadius + uDeck.x, uRadius + uDeck.y);
        float cover = 1.0 - exp(-path * uDeck.z);
        // Brightest under the sun, darkening towards the terminator.
        float lit = sqrt(clamp(dot(up, uSunDir), 0.0, 1.0));
        vec3 tops = uDeckColor * (0.05 + 0.95 * lit * day) * (length(uCamLocal) > uRadius + uDeck.y ? 1.0 : 0.55);
        color = mix(color, tops, cover);
    }
    // Under water the water's own colour closes in within a few tens of metres (a river's silt;
    // clear sea water lets one see a little further, its colour already says how far).
    if (uUnderwater.w > 0.0) color = mix(uUnderwater.rgb, color, exp(-length(localPos - uCamLocal) * 0.075));
    return color;
}
`;

/**
 * The torch's uniforms, one set shared by every surface material, so the
 * player's torch reaches the ground, grass, trees, rocks and animals alike.
 * Positions are in the frame of the world the player is on.
 */
/**
 * How much brighter another world looks to eyes adapted to the dark: the Moon
 * from a night-time field is a brilliant white disc, though it reflects only
 * an eighth of the sunlight, because the eye has opened up for the dark land
 * all round. (Seen from space, or by day, the eye is set for sunlight and the
 * Moon is the grey of its rock.) For the world the player is on: 1.
 */
export const NIGHT_EYES_GAIN = 7;
export const eyeGain = (nightEyes: number) => 1 + (NIGHT_EYES_GAIN - 1) * nightEyes;

export const TORCH = {
    position: { value: new THREE.Vector3(0, 0, 0) },
    direction: { value: new THREE.Vector3(0, 0, 1) },
    strength: { value: 0 },
};

/** The campfire's light, shared like the torch's. */
export const FIRE = {
    position: { value: new THREE.Vector3(0, 0, 0) },
    strength: { value: 0 },
};

/**
 * Each world's sunlight: one uniform shared by every material on it (ground, grass, trees, rocks,
 * clouds, sky), so that an eclipse dims all of it in one place. Its colour is the world's own
 * (reddened under Venus's air, and so on), times the share of the Sun left uncovered.
 */
const SUNLIGHT = new Map<string, { value: THREE.Color; base: THREE.Color }>();

export const sunlightOf = (body: ExpeditionBody) => {
    let light = SUNLIGHT.get(body.id);
    if (!light) {
        const base = new THREE.Color(body.biome?.sunColor ?? '#fff1dc');
        light = { value: base.clone(), base };
        SUNLIGHT.set(body.id, light);
    }
    return light;
};

/**
 * Each world's sky colours, shared the same way by its sky (Atmosphere.tsx) and everything lit by
 * it or fading into its haze, so they can change together: Earth's, while it is still ash, dusty
 * grey (setAshSky).
 */
const SKIES = new Map<string, { zenith: { value: THREE.Color }; horizon: { value: THREE.Color }; baseZenith: THREE.Color; baseHorizon: THREE.Color }>();
export const skyOf = (body: ExpeditionBody) => {
    let sky = SKIES.get(body.id);
    if (!sky) {
        const baseZenith = new THREE.Color(body.biome?.zenith ?? '#000000');
        const baseHorizon = new THREE.Color(body.biome?.horizon ?? '#000000');
        sky = { zenith: { value: baseZenith.clone() }, horizon: { value: baseHorizon.clone() }, baseZenith, baseHorizon };
        SKIES.set(body.id, sky);
    }
    return sky;
};
const ASH_ZENITH = new THREE.Color('#5f6a76');
const ASH_HORIZON = new THREE.Color('#a59d90');
/** Ash in the air (0 none, 1 thick): the sky greyed towards dust. */
export const setAshSky = (body: ExpeditionBody, ash: number) => {
    const sky = skyOf(body);
    sky.zenith.value.copy(sky.baseZenith).lerp(ASH_ZENITH, ash);
    sky.horizon.value.copy(sky.baseHorizon).lerp(ASH_HORIZON, ash);
};

let dimmed: string | null = null;
/** The light on `body` is `share` of the Sun's (only the world the camera is on is ever in the shadow). */
export const setSunlight = (body: ExpeditionBody | null, share: number) => {
    if (dimmed && dimmed !== body?.id) {
        const was = SUNLIGHT.get(dimmed);
        if (was) was.value.copy(was.base);
        dimmed = null;
    }
    if (!body) return;
    const light = SUNLIGHT.get(body.id);
    if (!light) return;
    if (share >= 1 && dimmed !== body.id) return;
    light.value.copy(light.base).multiplyScalar(share);
    dimmed = share >= 1 ? null : body.id;
};

export const createSurfaceUniforms = (body: ExpeditionBody) => {
    const biome = body.biome;
    return {
        uTorchPos: TORCH.position,
        uTorchDir: TORCH.direction,
        uTorch: TORCH.strength,
        uFirePos: FIRE.position,
        uFire: FIRE.strength,
        uSunDir: { value: body.sunDirection },
        uSunColor: sunlightOf(body),
        uOvercast: { value: biome?.overcast ?? 0 },
        uDeck: { value: biome?.deck ? new THREE.Vector4(biome.deck.base, biome.deck.top, biome.deck.opacity, 1) : new THREE.Vector4(0, 0, 0, 0) },
        uDeckColor: { value: new THREE.Color(biome?.deck?.color ?? '#ffffff') },
        uZenith: skyOf(body).zenith,
        uHorizon: skyOf(body).horizon,
        uHaze: { value: biome?.airless ? 0 : biome?.haze ?? 0 },
        uAerial: { value: biome?.aerial ?? 1 },
        uBounce: { value: new THREE.Color(biome?.palette[1] ?? '#000000') },
        uRadius: { value: body.radius },
        uAtmoRadius: { value: body.radius + (biome?.atmosphereHeight ?? 1) },
        // Earth's recovery (revival.ts); 1 on every other world.
        uRevival: revivalUniform(body.id),
        uCamLocal: { value: new THREE.Vector3() },
        uStorm: WEATHER_UNIFORMS.storm,
        uUnderwater: UNDERWATER,
        uDust: WEATHER_UNIFORMS.dust,
        uFlash: WEATHER_UNIFORMS.flash,
        uSpaceShare: biome?.space ? spaceViewOf(body).uSpaceShare : { value: 0 },
    };
};
