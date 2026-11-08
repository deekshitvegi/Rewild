import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { directionAt } from './history';
import { directionToBody, orientationOf } from './motion';
import type { ExpeditionRuntime } from './runtime';

/**
 * The northern and southern lights: Earth's aurora ovals, curtains of light 100 to 250 km up
 * (here 750 to 1500 game metres: above the cloud deck, as the real ones are), in a ring about 23 degrees round each geomagnetic pole (80.8 N
 * 72.6 W, and its opposite in the south), pushed a few degrees further from the pole on the night
 * side, as the solar wind shapes them. Green below (oxygen at 557.7 nm), fading to red at the top
 * (oxygen at 630 nm), with a violet lower fringe (nitrogen) where it is bright; folded, rayed and
 * slowly drifting. Lit only where it is night (sunlit air hides them), so from the ground they
 * are a night sight at high latitudes and from orbit a thin green ring on the night side.
 *
 * One mesh for both ovals (a ribbon each, 720 steps round), additive, no depth writes; its shape
 * moves in the vertex shader, so nothing is rebuilt.
 */
const SEGMENTS = 720;
const BOTTOM = 750;
const TOP = 1500;
/** Geomagnetic north pole (IGRF, 2025). */
const POLE: [number, number] = [80.8, -72.6];

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec2 ring;
uniform vec3 uPole;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform vec3 uSunDir;
uniform float uRadius;
uniform float uTime;
varying float vAround;
varying float vUp;
varying float vNight;
void main() {
    // ring.x: 0..1 round the oval; ring.y: 0 at the bottom of the curtain, 1 at the top.
    // position.x: +1 for the northern oval, -1 for the southern.
    float hemi = position.x;
    vec3 pole = uPole * hemi;
    float a = ring.x * 6.2831853;
    vec3 out1 = uEast * cos(a) + uNorth * sin(a) * hemi;
    // Night side: where the oval reaches furthest from the pole.
    vec3 night = -uSunDir + pole * dot(uSunDir, pole);
    float nightward = length(night) > 1e-4 ? dot(out1, normalize(night)) : 0.0;
    float folds = sin(a * 7.0 + uTime * 0.021 + hemi) * 0.9 + sin(a * 23.0 - uTime * 0.05) * 0.45 + sin(a * 61.0 + uTime * 0.09) * 0.2;
    float colat = radians(21.0 + 3.5 * nightward + folds);
    vec3 dir = pole * cos(colat) + out1 * sin(colat);
    float height = mix(${BOTTOM.toFixed(1)}, ${TOP.toFixed(1)}, ring.y);
    vec3 p = dir * (uRadius + height);
    vAround = ring.x;
    vUp = ring.y;
    // Dark enough for them to show: the Sun well below the horizon under the curtain.
    vNight = 1.0 - smoothstep(-0.16, -0.02, dot(dir, uSunDir));
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
}
`;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uStrength;
varying float vAround;
varying float vUp;
varying float vNight;
void main() {
    #include <logdepthbuf_fragment>
    if (vNight <= 0.0) discard;
    float a = vAround * 6.2831853;
    // Rays: fine vertical streaks, drifting along the curtain.
    float rays = 0.55 + 0.25 * sin(a * 1400.0 + uTime * 0.35) + 0.2 * sin(a * 530.0 - uTime * 0.22);
    // Brighter and fainter stretches, slowly moving: the curtain is never even.
    float patches = smoothstep(0.15, 0.85, 0.5 + 0.3 * sin(a * 9.0 + uTime * 0.03) + 0.2 * sin(a * 31.0 - uTime * 0.07));
    // A sharp lower edge, fading upward.
    float base = smoothstep(0.0, 0.05, vUp);
    float fade = exp(-vUp * 2.6);
    vec3 green = vec3(0.32, 1.0, 0.55);
    vec3 red = vec3(0.85, 0.22, 0.38);
    vec3 violet = vec3(0.55, 0.3, 1.0);
    vec3 color = mix(green, red, smoothstep(0.3, 0.85, vUp));
    color = mix(color, violet, (1.0 - smoothstep(0.0, 0.08, vUp)) * patches * 0.5);
    float glow = base * (fade + 0.12 * smoothstep(0.35, 0.8, vUp) * (1.0 - vUp)) * rays * (0.25 + 0.75 * patches);
    gl_FragColor = vec4(color * glow * uStrength * vNight, 1.0);
}
`;

const buildGeometry = () => {
    // Two ribbons: each vertex holds which oval (position.x) and where on it (ring).
    const positions: number[] = [];
    const rings: number[] = [];
    const index: number[] = [];
    for (const hemi of [1, -1]) {
        const start = positions.length / 3;
        for (let i = 0; i <= SEGMENTS; i++) {
            for (const v of [0, 1]) {
                positions.push(hemi, 0, 0);
                rings.push(i / SEGMENTS, v);
            }
        }
        for (let i = 0; i < SEGMENTS; i++) {
            const a = start + i * 2;
            index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('ring', new THREE.Float32BufferAttribute(rings, 2));
    geometry.setIndex(index);
    return geometry;
};

const sunLocal = new THREE.Vector3();

export const Aurora = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const earth = useMemo(() => findBody('projects') as ExpeditionBody, []);
    const meshRef = useRef<THREE.Mesh>(null);
    const geometry = useMemo(buildGeometry, []);
    const material = useMemo(() => {
        const pole = directionAt(earth, POLE[0], POLE[1]);
        // Any two directions square to the pole, to go round it by.
        const east = new THREE.Vector3(0, 1, 0).cross(pole);
        if (east.lengthSq() < 1e-6) east.set(1, 0, 0).cross(pole);
        east.normalize();
        const north = new THREE.Vector3().crossVectors(pole, east);
        return new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uPole: { value: pole },
                uEast: { value: east },
                uNorth: { value: north },
                uSunDir: { value: new THREE.Vector3(1, 0, 0) },
                uRadius: { value: earth.radius },
                uTime: { value: 0 },
                uStrength: { value: 1 },
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
        });
    }, [earth]);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

    useFrame((_, delta) => {
        const mesh = meshRef.current;
        if (!mesh) return;
        // Only near Earth (out past a few of its widths the ring is a hair's breadth).
        const distance = runtime.camera.distanceTo(earth.position);
        mesh.visible = distance < earth.radius * 12 && !runtime.gas;
        if (!mesh.visible) return;
        mesh.position.copy(earth.position).sub(runtime.origin);
        mesh.quaternion.copy(orientationOf(runtime.motion, earth));
        const u = material.uniforms;
        u.uSunDir.value.copy(directionToBody(runtime.motion, earth, earth.sunDirection, sunLocal)).normalize();
        u.uTime.value += Math.min(delta, 0.1);
        // Storms come and go over hours; a solar storm (a flare's protons) lights them up.
        const t = u.uTime.value;
        const storm = runtime.weather.kind === 'radiation' && runtime.weather.body === earth ? 1 : 0;
        u.uStrength.value = (1.1 + 0.45 * Math.sin(t * 0.0011) + 0.25 * Math.sin(t * 0.0073)) * (1 + storm * 1.2);
    });

    return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
};
