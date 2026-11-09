import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { tunnelSkies } from './Wormhole';
import { BEAT, throatLook } from './crossing';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';
import type { ExpeditionRuntime } from './runtime';

/**
 * The crossing itself, drawn by the game (its script is crossing.ts). Inside the throat the Argo flies
 * down a funnel of light: the shape of an Ellis wormhole's throat, r = sqrt(b^2 + (l / C)^2), with the
 * light of this side streaming along its walls in spirals (three nested walls of thin glowing gas,
 * each turning at its own rate, so the view has depth), thin streaks rushing past, and ahead the
 * narrowest point: a dark eye with the other side's stars in it. At the end the far side's light
 * floods out of the eye and the throat fades into the system on the other side.
 *
 * A sphere round the camera, drawn last and depth-tested, so the Argo (nearer than it) stays in view
 * and everything beyond is hidden. While it is up, the camera sees only the player's layers and this
 * one (CROSSING_LAYER): the system being taken down and the one being built behind the throat are not
 * drawn at all.
 */
export const TRANSIT_SECONDS = BEAT.end;
/** Where the crossing waits while the other system is built (region.ts): the throat keeps moving. */
export const TRANSIT_HOLD = BEAT.hold;
/** The throat's own render layer: during a crossing the camera sees only this and the player's. */
export const CROSSING_LAYER = 3;
/** The throat's radius in world units (the mouths' own, deepSpace.ts). */
const THROAT = 3200;
const RADIUS = 1800;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDirection;
void main() {
    vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${TEXTURE_NOISE_GLSL}
uniform samplerCube uAhead;
uniform samplerCube uBehind;
uniform mat3 uAheadTurn;
uniform mat3 uBehindTurn;
uniform float uHasSkies;
uniform vec3 uAxis;
uniform vec3 uSide;
uniform vec3 uUp;
// The camera relative to the Argo, in throat radii, in the throat's frame (side, up, along).
uniform vec3 uEye;
uniform float uThroat;
uniform float uClock;
uniform float uFlow;
uniform float uGlow;
uniform float uFlash;
uniform float uFade;
uniform float uStreaks;
uniform vec3 uFarLight;
uniform vec3 uFlashColor;
varying vec3 vDirection;

// How fast the funnel opens out away from the throat.
const float FLARE = 2.4;
const float TWIST = 0.62;

vec3 skyAhead(vec3 d) { return uHasSkies > 0.5 ? textureCube(uAhead, uAheadTurn * d).rgb : vec3(0.004, 0.005, 0.012); }
vec3 skyBehind(vec3 d) { return uHasSkies > 0.5 ? textureCube(uBehind, uBehindTurn * d).rgb : vec3(0.004, 0.005, 0.012); }

float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}

// First distance along the ray at which it meets the funnel wall b (or -1).
float funnel(vec3 o, vec3 d, float b) {
    float k = 1.0 / (FLARE * FLARE);
    float oz = o.z - uThroat;
    float a = d.x * d.x + d.y * d.y - d.z * d.z * k;
    float h = o.x * d.x + o.y * d.y - oz * d.z * k;
    float c = o.x * o.x + o.y * o.y - oz * oz * k - b * b;
    if (abs(a) < 1e-6) {
        float t = -c / (2.0 * h);
        return t > 1e-4 ? t : -1.0;
    }
    float disc = h * h - a * c;
    if (disc < 0.0) return -1.0;
    float s = sqrt(disc);
    float t1 = (-h - s) / a;
    float t2 = (-h + s) / a;
    float t = 1e9;
    if (t1 > 1e-4) t = t1;
    if (t2 > 1e-4) t = min(t, t2);
    return t < 1e8 ? t : -1.0;
}

// Thin glowing gas on one wall: clouds and filaments wound in spirals round the way through, streaming
// past, with dark between them. Returns the gas's light (rgb) and how much it covers (a).
vec4 gas(vec3 hit, float layer, float spin, float flow, float detail) {
    float l = hit.z - uThroat;
    float phi = atan(hit.y, hit.x);
    float sigma = phi + TWIST * l + spin;
    float along = (l + flow) * 0.8;
    vec3 p = vec3(cos(sigma) * 2.3, sin(sigma) * 2.3, along) + vec3(layer * 5.7, layer * 3.1, 0.0);
    // Billows: the coordinates pushed about by a slower field first.
    vec4 w = tnoise4(p * 0.5 + vec3(0.0, 0.0, uClock * 0.05));
    p += vec3(w.x, w.y, w.z * 0.7) * 1.15;
    vec4 n1 = tnoise4(p);
    vec4 n2 = tnoise4(p * 2.03 + 11.0);
    vec4 n3 = tnoise4(p * 4.11 + 23.0);
    vec4 n4 = tnoise4(p * 8.37 + 37.0);
    float f = 0.5 * n1.x + 0.27 * n2.y + 0.15 * n3.z * detail + 0.08 * n4.w * detail;
    // Cloud texture: folds of turbulence (absolute noise) inside the body.
    float folds = 1.0 - (0.45 * abs(n2.x) + 0.33 * abs(n3.y) * detail + 0.22 * abs(n4.z) * detail) * 1.6;
    // Long thin filaments along the spirals: ridged noise of the angle alone, stretched along them.
    vec4 r = tnoise4(vec3(cos(sigma) * 7.0, sin(sigma) * 7.0, along * 0.35) + layer * 2.0);
    float ridge = 1.0 - abs(r.w);
    ridge = ridge * ridge * ridge;
    // Wide dark lanes between the clouds: a slow field cuts the gas apart.
    float lanes = smoothstep(-0.4, 0.16, w.w * 0.8 + n1.z * 0.45 + 0.08);
    float body = smoothstep(-0.08, 0.42, f) * lanes;
    float strand = ridge * smoothstep(-0.15, 0.3, f) * (0.35 + 0.65 * lanes) * 0.45;
    float density = clamp(body * (0.55 + 0.45 * folds) + strand, 0.0, 1.0);
    float core = smoothstep(0.3, 0.7, f + strand * 0.3) * lanes * (0.6 + 0.4 * folds);
    // The hottest knots, white-blue, a few per cent of the wall.
    float knot = smoothstep(0.28, 0.6, f + 0.25 * n4.x * detail) * lanes;
    // Deep in the throat the light is gathered: brighter, and warmer towards the far side's light.
    float near = exp(-abs(l) * 0.75);
    vec3 cool = mix(vec3(0.002, 0.014, 0.13), vec3(0.016, 0.22, 1.55), density);
    vec3 light = cool + vec3(0.2, 0.55, 1.6) * core * 1.3 + vec3(0.9, 1.4, 2.4) * knot * 1.6;
    light *= 0.5 + 1.8 * near;
    light = mix(light, uFarLight * (0.8 + 2.0 * core) * (0.4 + density), clamp(near * (0.15 + uGlow * 0.8), 0.0, 1.0));
    return vec4(light, density);
}

// Thin streaks of light rushing past, on a cylinder of radius R round the way through. No early
// returns before the derivatives: fwidth in a branch that differs between neighbouring pixels is
// undefined, and Direct3D refuses some of it.
vec3 streaks(vec3 o, vec3 d, float R, float tMax) {
    float a = max(d.x * d.x + d.y * d.y, 1e-6);
    float h = o.x * d.x + o.y * d.y;
    float c = o.x * o.x + o.y * o.y - R * R;
    float t = (-h + sqrt(max(h * h - a * c, 0.0))) / a;
    vec3 hit = o + d * t;
    float columns = 150.0;
    float u = atan(hit.y, hit.x) / 6.2831853 * columns;
    float u2 = atan(-hit.y, -hit.x) / 6.2831853 * columns;
    float fw = max(min(fwidth(u), fwidth(u2)), 1e-4);
    float column = floor(u);
    float seed = hash12(vec2(column, 3.7));
    // Off the column's own line, in pixels: about one and a half wide.
    float line = (fract(u) - (0.2 + 0.6 * hash12(vec2(column, 9.1)))) / fw;
    float width = 1.0 - smoothstep(0.35, 1.1, abs(line));
    float period = 2.6 + 2.0 * hash12(vec2(column, 1.3));
    float speed = 1.0 + 0.8 * hash12(vec2(column, 5.9));
    float s = fract((hit.z + uFlow * 4.0 * speed) / period + seed * 13.0);
    float len = 0.035 + 0.04 * hash12(vec2(column, 7.7));
    // A hot head and a steep fade back along it.
    float head = exp(-6.0 * s / len) * step(s, len);
    float fadeFar = exp(-t * 0.18);
    float shown = step(seed, 0.42) * step(1e-4, t) * step(t, tMax);
    return vec3(1.4, 1.65, 2.2) * width * head * fadeFar * uStreaks * shown;
}

// Small bright flecks drifting in the gas (called for every pixel: derivatives inside).
float flecks(vec3 hit, float flow) {
    float l = hit.z - uThroat;
    float sigma = atan(hit.y, hit.x) + TWIST * l * 0.5;
    float sigma2 = atan(-hit.y, -hit.x) + TWIST * l * 0.5;
    vec2 g = vec2(sigma / 6.2831853 * 220.0, (l + flow) * 9.0);
    vec2 g2 = vec2(sigma2 / 6.2831853 * 220.0, g.y);
    vec2 fw = max(min(fwidth(g), fwidth(g2)), vec2(1e-4));
    vec2 cell = floor(g);
    vec2 f = fract(g) - vec2(hash12(cell + 0.17), hash12(cell + 7.31));
    float on = step(0.935, hash12(cell + 3.3));
    float dpx = length(f / fw);
    return on * (1.0 - smoothstep(0.4, 1.1, dpx)) * (0.6 + 1.6 * hash12(cell + 9.9));
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 world = normalize(vDirection);
    vec3 d = vec3(dot(world, uSide), dot(world, uUp), dot(world, uAxis));
    vec3 o = uEye;

    float tInner = funnel(o, d, 0.6);
    float tMiddle = funnel(o, d, 0.8);
    float tOuter = funnel(o, d, 1.0);

    vec3 color = vec3(0.0);
    float through = 1.0;
    float spin = uClock * 0.32;

    if (tInner > 0.0) {
        vec3 hit = o + d * tInner;
        vec4 g = gas(hit, 0.0, spin * 1.35, uFlow * 1.3, clamp(2.0 / (tInner + 0.5), 0.0, 1.0));
        float a = g.a * 0.5;
        color += through * g.rgb * a;
        through *= 1.0 - a;
    }
    float fleck = flecks(o + d * max(tMiddle, 0.0), uFlow);
    if (tMiddle > 0.0) {
        vec3 hit = o + d * tMiddle;
        vec4 g = gas(hit, 1.0, spin, uFlow, clamp(2.0 / (tMiddle + 0.5), 0.0, 1.0));
        float a = g.a * 0.72;
        color += through * (g.rgb * a + vec3(0.7, 0.85, 1.25) * fleck * 0.9);
        through *= 1.0 - a;
    }
    if (tOuter > 0.0) {
        vec3 hit = o + d * tOuter;
        vec4 g = gas(hit, 2.0, spin * 0.7, uFlow * 0.8, clamp(2.0 / (tOuter + 0.5), 0.0, 1.0));
        float a = clamp(g.a * 0.95 + 0.25, 0.0, 1.0);
        // The wall itself, between the gas: deep blue-black, never empty black.
        color += through * (g.rgb * g.a + vec3(0.002, 0.006, 0.03) * (1.0 - g.a)) ;
        through *= 1.0 - a;
    } else {
        // Out through the narrowest point: the other side, and its light.
        float toAxis = acos(clamp(d.z, -1.0, 1.0));
        vec3 beyond = d.z > 0.0 ? skyAhead(world) * 0.9 : skyBehind(world) * 0.35;
        // The way out: a small hot point of the far side's light that grows, before it floods out.
        float spot = 0.015 + 0.16 * uGlow * uGlow;
        beyond += mix(uFarLight, vec3(1.0), 0.6) * smoothstep(0.0, 0.2, uGlow) * (exp(-toAxis * toAxis / (spot * spot)) * 6.0 + exp(-toAxis * toAxis / (spot * spot * 9.0)) * 0.8);
        color += through * beyond;
        through = 0.0;
    }
    color += through * vec3(0.002, 0.005, 0.02);

    float nearest = min(min(tInner > 0.0 ? tInner : 1e9, tMiddle > 0.0 ? tMiddle : 1e9), tOuter > 0.0 ? tOuter : 1e9);
    color += streaks(o, d, 0.5, nearest);

    // The far side's light pouring out of the eye as the throat is passed: a white disc that grows.
    float toAxis = acos(clamp(d.z, -1.0, 1.0));
    float disc = uFlash * 2.6;
    float white = 1.0 - smoothstep(disc * 0.75, disc + 0.15, toAxis);
    color = mix(color, uFlashColor, clamp(white * smoothstep(0.0, 0.25, uFlash), 0.0, 1.0));

    gl_FragColor = vec4(color, uFade);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const toEye = new THREE.Vector3();
const farLightTon = new THREE.Color(1.0, 0.82, 0.55);
const farLightSol = new THREE.Color(1.0, 0.93, 0.82);
const breakIn = new THREE.Color(0.75, 0.95, 1.6);

export const WormholeTransit = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const { scene } = useThree();
    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        uniforms: {
            ...textureNoiseUniforms(),
            uAhead: { value: null },
            uBehind: { value: null },
            uAheadTurn: { value: new THREE.Matrix3() },
            uBehindTurn: { value: new THREE.Matrix3() },
            uHasSkies: { value: 0 },
            uAxis: { value: new THREE.Vector3(0, 0, -1) },
            uSide: { value: new THREE.Vector3(1, 0, 0) },
            uUp: { value: new THREE.Vector3(0, 1, 0) },
            uEye: { value: new THREE.Vector3() },
            uThroat: { value: 4.6 },
            uClock: { value: 0 },
            uFlow: { value: 0 },
            uGlow: { value: 0 },
            uFlash: { value: 0 },
            uFade: { value: 1 },
            uStreaks: { value: 0.5 },
            uFarLight: { value: new THREE.Color() },
            uFlashColor: { value: new THREE.Color() },
        },
    }), []);
    const geometry = useMemo(() => new THREE.SphereGeometry(RADIUS, 64, 48), []);
    useEffect(() => () => { material.dispose(); geometry.dispose(); }, [material, geometry]);
    const flow = useRef(0);
    const layers = useRef<number | null>(null);
    const side = useMemo(() => new THREE.Vector3(), []);

    useFrame(({ camera }, delta) => {
        const mesh = meshRef.current;
        const transit = runtime.transit;
        if (!mesh) return;
        mesh.visible = !!transit;
        mesh.layers.set(CROSSING_LAYER);
        if (!transit) {
            flow.current = 0;
            // The camera sees the whole scene again.
            if (layers.current !== null) {
                camera.layers.mask = layers.current;
                layers.current = null;
            }
            return;
        }
        // While the throat covers everything, only the Argo and the throat are drawn: neither system
        // behind it, the one being taken down nor the one being built. The lights stay in view (on
        // this layer too) so nothing drawn changes its shader. Shown again as the throat fades.
        const covered = transit.t < BEAT.out;
        if (covered && layers.current === null) {
            layers.current = camera.layers.mask;
            scene.traverse((object) => { if ((object as THREE.Light).isLight) object.layers.enable(CROSSING_LAYER); });
            camera.layers.mask = (1 << 1) | (1 << 2) | (1 << CROSSING_LAYER);
        } else if (!covered && layers.current !== null) {
            camera.layers.mask = layers.current;
            layers.current = null;
        }
        mesh.position.copy(camera.position);
        const look = throatLook(transit.t);
        flow.current += Math.min(delta, 0.1) * look.flow;
        const u = material.uniforms;
        u.uClock.value = transit.clock;
        u.uFlow.value = flow.current;
        u.uThroat.value = look.throat;
        u.uGlow.value = look.glow;
        u.uFlash.value = look.flash;
        u.uFade.value = look.fade;
        u.uStreaks.value = look.streaks;
        (u.uFarLight.value as THREE.Color).copy(transit.to === 'wormhole-ton618' ? farLightTon : farLightSol);
        // Breaking in, a flash of this side's cold light; coming out, the far side's.
        if (transit.t < 1) (u.uFlashColor.value as THREE.Color).copy(breakIn);
        else (u.uFlashColor.value as THREE.Color).copy(u.uFarLight.value as THREE.Color).multiplyScalar(0.9).addScalar(0.95);
        u.uAxis.value.copy(transit.axis);
        side.crossVectors(transit.axis, transit.up).normalize();
        u.uSide.value.copy(side);
        u.uUp.value.copy(transit.up);
        // The camera from the Argo's centre (the floating origin follows her), in throat radii.
        const ship = runtime.player?.ship;
        toEye.copy(camera.position);
        if (ship) toEye.add(runtime.origin).sub(ship.position);
        toEye.divideScalar(THROAT);
        u.uEye.value.set(toEye.dot(side), toEye.dot(transit.up), toEye.dot(transit.axis));
        const skies = tunnelSkies(transit.to);
        u.uHasSkies.value = skies.ahead && skies.behind ? 1 : 0;
        u.uAhead.value = skies.ahead;
        u.uBehind.value = skies.behind;
        u.uAheadTurn.value.copy(skies.aheadTurn);
        u.uBehindTurn.value.copy(skies.behindTurn);
    });

    return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={10000} frustumCulled={false} visible={false} />;
};
