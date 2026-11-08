import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { watchView, type ExpeditionRuntime } from './runtime';
import { directionToBody, orientationOf } from './motion';

const eyeDelta = new THREE.Vector3();
import { WEATHER_UNIFORMS } from './weather';
import { skyOf, sunlightOf } from './surfaceShading';
import { skyScale } from './skyScale';

/**
 * The air around a rocky planet: a sphere drawn from the inside, whose colour
 * and opacity come from how much air the view ray crosses. From the ground it
 * is the sky (blue, orange at sunset, dark at night); from space it is the
 * glowing rim around the planet.
 */
const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCamLocal;
uniform float uRadius;
uniform float uAtmoRadius;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunset;
uniform float uSunsetAround;
uniform float uSunGlow;
uniform float uHaze;
uniform float uLimb;
uniform vec4 uDeck;
uniform vec3 uDeckColor;
uniform float uStorm;
uniform float uDust;
uniform float uFlash;
uniform vec3 uBackTint;
uniform float uBackG;
uniform float uBackGain;
uniform vec3 uBackDeep;
uniform float uClear;
varying vec3 vLocal;

vec2 sphereHit(vec3 o, vec3 r, float radius) {
    float b = dot(o, r);
    float c = dot(o, o) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(1.0, -1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
}

// How far a ray (from o, along r, between t a0 and a1) runs between the spheres of radius lo and hi.
float shellPath(vec3 o, vec3 r, float lo, float hi, float a0, float a1) {
    vec2 outer = sphereHit(o, r, hi);
    vec2 inner = sphereHit(o, r, lo);
    float b0 = max(max(outer.x, a0), 0.0);
    float b1 = min(outer.y, a1);
    float path = max(b1 - b0, 0.0);
    if (inner.x < inner.y) path -= max(min(inner.y, b1) - max(inner.x, b0), 0.0);
    return max(path, 0.0);
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 r = normalize(vLocal - uCamLocal);
    vec2 atmo = sphereHit(uCamLocal, r, uAtmoRadius);
    float t0 = max(atmo.x, 0.0);
    float t1 = atmo.y;
    // Rays that reach the ground stop there. From inside the air this shell's far side is hidden
    // by the terrain anyway; from outside it is drawn over the world's face (Atmosphere below
    // turns it round), so the air lies over the whole disc as well as round its edge, and a world
    // seen from space is one ball, not a ball with a second ring round it.
    vec2 groundHit = sphereHit(uCamLocal, r, uRadius);
    bool overGround = groundHit.x > 0.0 && groundHit.x < groundHit.y;
    float tEnd = overGround ? min(t1, groundHit.x) : t1;
    if (tEnd <= t0) discard;

    // Optical depth from three samples of exponentially thinning air.
    float thickness = uAtmoRadius - uRadius;
    // From far out the air hugs the ground (uLimb), thickening to the layer
    // the sky needs as one comes in.
    float distant = smoothstep(uAtmoRadius * 1.02, uAtmoRadius * 1.6, length(uCamLocal));
    float scaleHeight = thickness * mix(0.2, uLimb, distant);
    float depth = 0.0;
    for (int i = 0; i < 3; i++) {
        float t = mix(t0, tEnd, (float(i) + 0.5) / 3.0);
        float h = length(uCamLocal + r * t) - uRadius;
        // Thinning to nothing at the shell's top, so it has no edge to see.
        depth += exp(-max(h, 0.0) / scaleHeight) * (1.0 - smoothstep(0.62, 1.0, h / thickness));
    }
    depth *= (tEnd - t0) / 3.0 / thickness;
    // Looking down through it from space: thin air is a faint veil over the ground (the ground's
    // own haze adds to it); a world wrapped in haze, Titan, is hidden by it.
    float aloft = smoothstep(uAtmoRadius * 0.99, uAtmoRadius * 1.08, length(uCamLocal));
    if (overGround) depth *= mix(1.0, mix(0.35, 1.0, smoothstep(1.5, 3.0, uHaze)), aloft);
    // Air scatters light towards the eye (the sky's own glow) and dims what is
    // behind it. Keeping the two apart lets a bright planet or the sun show
    // through a daytime sky, while faint stars vanish.
    float scattered = 1.0 - exp(-depth * 9.0 * uHaze);
    // Clear air dims what is beyond it far less than its glow suggests: on
    // Earth about a fifth of the light straight up, half at 15 degrees, nearly
    // all at the horizon. By day the stronger figure also stands for the
    // bright sky drowning faint things; under a night sky the Moon, planets
    // and stars come through as crisp as they do to the eye.
    float viewerDay = smoothstep(-0.28, 0.18, dot(normalize(uCamLocal), uSunDir));
    float transmittance = exp(-depth * mix(0.8, 3.2, viewerDay) * uHaze * uClear);

    vec3 mid = normalize(uCamLocal + r * mix(t0, tEnd, 0.5));
    vec3 viewUp = length(uCamLocal) < uAtmoRadius ? normalize(uCamLocal) : mid;
    float elevation = dot(r, viewUp);
    float sunHeight = dot(mid, uSunDir);
    float day = smoothstep(-0.28, 0.18, sunHeight);
    float sunset = (1.0 - smoothstep(0.0, 0.42, abs(sunHeight + 0.04))) * day;

    vec3 sky = mix(uHorizon, uZenith, smoothstep(-0.02, 0.55, elevation));
    // Seen from space the rim is the deep sky colour, paling only at its base.
    float outside = smoothstep(uAtmoRadius * 0.99, uAtmoRadius * 1.08, length(uCamLocal));
    sky = mix(sky, mix(uZenith * 1.15, uHorizon, 0.3), outside);
    float towardSun = max(dot(r, uSunDir), 0.0);
    // Earth's sunset colours the whole low sky; Mars's blue one (its dust
    // throwing blue light forwards) is a glow round the sun alone.
    sunset *= mix(1.0, pow(towardSun, 3.0) * 1.6, uSunsetAround);
    sky = mix(sky, uSunset, min(sunset * 0.55 * (1.0 - smoothstep(0.0, 0.5, elevation)), 0.85));
    vec3 glow = uSunColor * (pow(towardSun, 10.0) * 0.45 + pow(towardSun, 180.0) * 1.2) * uSunGlow;
    // (The glow round the sun is the sky's, seen through the air; from space the backlit term below takes over.)
    vec3 color = sky * (0.04 + 0.96 * day) + glow * day * (1.0 - outside);

    // Seen from space, air beyond the terminator is lit only by sunlight that has crossed the limb
    // on its way in, and lost most of itself there: the deep air there is dark, as it is in an
    // eclipse. (The ray's midpoint is its closest approach: for a ray past the limb, the air it
    // grazes.) Per channel: blue, scattered most, is lost first, so what gets through reddens.
    vec3 tauView = depth * 9.0 * uHaze * uBackTint;
    float grazing = (1.0 - smoothstep(-0.12, 0.04, sunHeight)) * outside;
    vec3 through = exp(-tauView * 0.5);
    color *= mix(vec3(1.0), through, grazing);
    // And lit from behind (the Sun beyond the world, or close past its edge) that air scatters it
    // forwards into a ring round the dark disc: a Henyey-Greenstein phase for the forward peak,
    // light scattered out of the ray by its own depth, dimmed by the way in. Not where the world
    // itself stands between that air and the Sun.
    // Its depth along the line of sight, for air thinning with height (a Chapman grazing path) at
    // the height the ray passes closest, with the deeper scale height the sky uses: real hazes
    // are layered hundreds of kilometres up, and a ring one pixel wide reads as nothing.
    vec3 closest = uCamLocal + r * mix(t0, t1, 0.5);
    float grazeHeight = length(closest) - uRadius;
    float ringScale = thickness * 0.12;
    float tauRing = 9.0 * uHaze * exp(-max(grazeHeight, 0.0) / ringScale) * sqrt(6.2832 * uRadius * ringScale) / thickness;
    vec3 tauBack = tauRing * uBackTint;
    float along = dot(closest, uSunDir);
    float shade = along > 0.0 ? 1.0 : smoothstep(uRadius * 0.995, uRadius * 1.01, length(closest - along * uSunDir));
    float g = uBackG;
    float phase = (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * dot(r, uSunDir), 1e-4), 1.5) * 0.0796;
    vec3 hazeColour = mix(vec3(1.0), uBackDeep, 1.0 - exp(-tauRing * 0.6));
    vec3 backlit = uSunColor * hazeColour * (1.0 - exp(-tauBack)) * exp(-tauBack * 0.5) * phase * uBackGain * shade * outside * step(0.0, grazeHeight);

    vec3 seen = color * scattered + backlit * 0.55;
    // Under a storm the sky is its cloud, grey and low; in a dust storm, brown.
    // Neither lets the sun or stars through. (Only from inside the air.)
    float under = 1.0 - outside;
    float cover = max(uStorm, uDust) * under;
    seen = mix(seen, vec3(0.13, 0.14, 0.16) * (0.08 + 0.92 * day), uStorm * 0.85 * under);
    seen = mix(seen, vec3(0.45, 0.29, 0.16) * (0.08 + 0.92 * day), uDust * 0.88 * under);
    seen += vec3(0.5, 0.53, 0.65) * uFlash * under;
    transmittance *= 1.0 - 0.96 * cover;

    // A deck of cloud that never breaks (Venus): from space, its sunlit tops
    // hide the ground; from under it, it is the whole sky, brighter a little
    // where the sun is above it, with only the haze of the lower air at the
    // horizon. Nothing beyond it, sun or stars, shows through.
    if (uDeck.w > 0.0) {
        // Its top is not a lid: the haze thins over the last quarter of it and a little above, so
        // seen from space the world is one soft-edged ball, not a disc with a ring round it.
        float soft = (uDeck.y - uDeck.x) * 0.25;
        float path = shellPath(uCamLocal, r, uRadius + uDeck.x, uRadius + uDeck.y - soft, t0, tEnd)
            + 0.4 * shellPath(uCamLocal, r, uRadius + uDeck.y - soft, uRadius + uDeck.y, t0, tEnd)
            + 0.1 * shellPath(uCamLocal, r, uRadius + uDeck.y, uRadius + uDeck.y + soft, t0, tEnd);
        float cloudT = exp(-max(path, 0.0) * uDeck.z);
        // What shows through it (clearSight, bodies.ts): the deck's own glow stays as it is.
        // (Not looking down on it from space: there the haze hides the ground, as Titan's does.)
        float sightT = exp(-max(path, 0.0) * uDeck.z * mix(uClear * uClear, 1.0, overGround ? aloft : 0.0));
        bool above = length(uCamLocal) > uRadius + uDeck.y;
        vec3 deck = uDeckColor * (0.06 + 0.94 * day) * (above ? 0.22 + 0.78 * pow(clamp(sunHeight, 0.0, 1.0), 0.75) : 1.0);
        deck *= mix(vec3(1.0), through, grazing);
        if (!above) {
            deck *= 0.62 * (1.0 + 0.4 * pow(max(dot(r, uSunDir), 0.0), 3.0));
            float horizon = 1.0 - smoothstep(0.0, 0.3, elevation);
            deck = mix(deck, sky * (0.04 + 0.96 * day), horizon * 0.65);
        }
        seen = mix(deck, seen, cloudT);
        transmittance *= sightT;
    }

    gl_FragColor = vec4(seen, transmittance);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const scenePosition = new THREE.Vector3();

export const Atmosphere = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const biome = body.biome!;
    const groupRef = useRef<THREE.Group>(null);
    const shown = useRef(1);
    const radius = body.radius + biome.atmosphereHeight;
    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        // result = sky glow + what is behind * transmittance (alpha)
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.SrcAlphaFactor,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,
        uniforms: {
            uCamLocal: { value: new THREE.Vector3() },
            uRadius: { value: body.radius },
            uAtmoRadius: { value: radius },
            uSunDir: { value: body.sunDirection },
            uSunColor: sunlightOf(body),
            uZenith: skyOf(body).zenith,
            uHorizon: skyOf(body).horizon,
            // Earth's orange unless the world says otherwise (linear, as the shader had it).
            uSunset: { value: biome.sunset ? new THREE.Color(biome.sunset) : new THREE.Color(1.0, 0.52, 0.28) },
            uSunsetAround: { value: biome.sunsetAroundSun ? 1 : 0 },
            uSunGlow: { value: biome.sunGlow ?? 1 },
            uHaze: { value: biome.haze },
            uLimb: { value: biome.limb ?? 0.06 },
            uDeck: { value: biome.deck ? new THREE.Vector4(biome.deck.base, biome.deck.top, biome.deck.opacity, 1) : new THREE.Vector4() },
            uDeckColor: { value: new THREE.Color(biome.deck?.color ?? '#ffffff') },
            uStorm: WEATHER_UNIFORMS.storm,
            uDust: WEATHER_UNIFORMS.dust,
            uFlash: WEATHER_UNIFORMS.flash,
            uBackTint: { value: new THREE.Vector3(...(biome.backlit?.tint ?? [0.7, 1.0, 1.6])) },
            uBackG: { value: biome.backlit?.g ?? 0.6 },
            uBackGain: { value: biome.backlit?.gain ?? 0.6 },
            uBackDeep: { value: new THREE.Vector3(...(biome.backlit?.deep ?? [1, 1, 1])) },
            uClear: { value: biome.clearSight ?? 1 },
        },
    }), [body, biome, radius]);
    const geometry = useMemo(() => new THREE.SphereGeometry(radius, 96, 64), [radius]);
    useEffect(() => () => { material.dispose(); geometry.dispose(); }, [material, geometry]);

    useFrame(({ camera, size }) => {
        const group = groupRef.current;
        if (!group) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        group.position.copy(scenePosition);
        group.quaternion.copy(orientationOf(runtime.motion, body));
        // From inside the air, its far side (the sky); from outside, its near side, drawn over the
        // world's face too (the shader stops each ray at the ground). The same sum either way, so
        // nothing jumps when the ship crosses into the air.
        material.side = material.uniforms.uCamLocal.value.length() > radius ? THREE.FrontSide : THREE.BackSide;
        // Drawn as large as its world is (skyScale.ts).
        const scale = skyScale(runtime, body);
        group.scale.setScalar(scale);
        shown.current = scale;
        // Less than a pixel across: nothing to draw.
        const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
        group.visible = (radius * scale / Math.max(scenePosition.distanceTo(camera.position), 1)) * (size.height / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2)) > 0.75;
    }, -1);
    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (group) directionToBody(runtime.motion, body, eyeDelta.copy(eye).sub(group.position), material.uniforms.uCamLocal.value).divideScalar(shown.current);
    }), [runtime, material, body]);

    return (
        <group ref={groupRef}>
            <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
        </group>
    );
};
