import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { tunnelSkies } from './Wormhole';
import type { ExpeditionRuntime } from './runtime';

/**
 * The crossing itself (Interstellar's, as Thorne describes it in The Science of Interstellar):
 * not a door but a short flight down the throat. The far side's sky opens ahead as a disc that
 * grows with an Einstein ring at its edge, this side's light streams past along the walls,
 * stretched by the lensing, and closes behind. A sphere round the camera, drawn after the scene
 * and depth-tested, so the ship (nearer than it) stays in view and everything beyond is hidden.
 * Player starts it (runtime.transit) and has already carried the ship to the other mouth.
 */
export const TRANSIT_SECONDS = 7;
/** Where the crossing waits while the film covers it and the other system is built (WormholeFilm.tsx): before the far side opens out. */
export const TRANSIT_HOLD = 3.2;
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
uniform samplerCube uAhead;
uniform samplerCube uBehind;
uniform mat3 uAheadTurn;
uniform mat3 uBehindTurn;
uniform float uHasSkies;
uniform vec3 uAxis;
uniform vec3 uSide;
uniform vec3 uUp;
uniform float uProgress;
uniform float uTime;
varying vec3 vDirection;

float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
}
float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 skyAhead(vec3 d) { return uHasSkies > 0.5 ? textureCube(uAhead, uAheadTurn * d).rgb : vec3(0.02, 0.02, 0.04); }
vec3 skyBehind(vec3 d) { return uHasSkies > 0.5 ? textureCube(uBehind, uBehindTurn * d).rgb : vec3(0.03, 0.03, 0.05); }

void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDirection);
    float c = dot(d, uAxis);
    vec3 across = d - uAxis * c;
    float s = length(across);
    vec3 radial = s > 1e-5 ? across / s : uSide;
    float theta = atan(s, c);
    float phi = atan(dot(radial, uUp), dot(radial, uSide));

    // The way out: a disc of the far sky that opens as the crossing goes on, the whole far
    // hemisphere squeezed into it (the lensing), with a thin bright ring at its rim.
    float open = mix(0.05, 1.55, smoothstep(0.05, 0.95, uProgress));
    float rho = theta / open;
    vec3 farDirection = normalize(uAxis * cos(min(rho, 1.0) * 1.5708) + radial * sin(min(rho, 1.0) * 1.5708));
    vec3 ahead = skyAhead(farDirection) * 1.6;
    float ring = exp(-pow((rho - 1.0) * 14.0, 2.0)) * 2.4;

    // The way in, closing behind.
    float shut = mix(1.2, 0.04, smoothstep(0.0, 0.7, uProgress));
    float back = (3.14159 - theta) / shut;
    vec3 nearDirection = normalize(-uAxis * cos(min(back, 1.0) * 1.5708) + radial * sin(min(back, 1.0) * 1.5708));
    vec3 behind = skyBehind(nearDirection);

    // The walls: this side's light drawn out along the tunnel, streaming past. Distance along
    // the wall is cot(theta); streaks are long in it and narrow round it.
    float along = c / max(s, 0.02);
    float flow = along * 0.6 - uTime * 3.2;
    float streak = noise2(vec2(phi * 18.0, flow * 0.35)) * noise2(vec2(phi * 55.0, flow * 0.9 + 7.0));
    streak = pow(streak, 2.5) * 3.0;
    vec3 tint = skyBehind(normalize(radial + uAxis * sin(flow * 0.5))) * 6.0 + vec3(0.05, 0.06, 0.09);
    vec3 wall = tint * (0.25 + streak) + vec3(0.6, 0.7, 1.0) * streak * 0.25;
    // Ripples of bent space passing over everything.
    float ripple = 0.85 + 0.15 * sin(along * 3.0 - uTime * 6.0 + phi * 2.0);

    float inAhead = 1.0 - smoothstep(0.92, 1.0, rho);
    float inBehind = 1.0 - smoothstep(0.85, 1.0, back);
    vec3 color = wall * ripple;
    color = mix(color, behind, inBehind);
    color = mix(color, ahead, inAhead);
    color += vec3(1.0, 0.92, 0.8) * ring;
    // Out the far end: the tunnel fades into the far sky.
    float fade = smoothstep(0.88, 1.0, uProgress);
    color = mix(color, skyAhead(d) * 1.0, fade);
    gl_FragColor = vec4(color, 1.0 - smoothstep(0.96, 1.0, uProgress));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const basisA = new THREE.Vector3();
const basisB = new THREE.Vector3();
export const WormholeTransit = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const material = useMemo(() => new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        uniforms: {
            uAhead: { value: null },
            uBehind: { value: null },
            uAheadTurn: { value: new THREE.Matrix3() },
            uBehindTurn: { value: new THREE.Matrix3() },
            uHasSkies: { value: 0 },
            uAxis: { value: new THREE.Vector3(0, 0, -1) },
            uSide: { value: new THREE.Vector3(1, 0, 0) },
            uUp: { value: new THREE.Vector3(0, 1, 0) },
            uProgress: { value: 0 },
            uTime: { value: 0 },
        },
    }), []);
    const geometry = useMemo(() => new THREE.SphereGeometry(RADIUS, 64, 48), []);

    useFrame(({ camera }, delta) => {
        const mesh = meshRef.current;
        const transit = runtime.transit;
        if (!mesh) return;
        mesh.visible = !!transit;
        if (!transit) return;
        mesh.position.copy(camera.position);
        const u = material.uniforms;
        u.uProgress.value = Math.min(1, transit.t / TRANSIT_SECONDS);
        u.uTime.value += Math.min(delta, 0.1);
        u.uAxis.value.copy(transit.axis);
        basisA.set(0, 1, 0);
        if (Math.abs(basisA.dot(transit.axis)) > 0.9) basisA.set(1, 0, 0);
        basisB.crossVectors(transit.axis, basisA).normalize();
        basisA.crossVectors(basisB, transit.axis).normalize();
        u.uSide.value.copy(basisB);
        u.uUp.value.copy(basisA);
        const skies = tunnelSkies(transit.to);
        u.uHasSkies.value = skies.ahead && skies.behind ? 1 : 0;
        u.uAhead.value = skies.ahead;
        u.uBehind.value = skies.behind;
        u.uAheadTurn.value.copy(skies.aheadTurn);
        u.uBehindTurn.value.copy(skies.behindTurn);
    });

    return <mesh ref={meshRef} geometry={geometry} material={material} renderOrder={10000} frustumCulled={false} visible={false} />;
};
