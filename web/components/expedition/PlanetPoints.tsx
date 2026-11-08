import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { AU, findBody, type ExpeditionBody } from './bodies';
import type { ExpeditionRuntime } from './runtime';
import { SKY_COVER } from './SpaceBackdrop';

/**
 * The planets as the eye sees them from far off: points of light among the
 * stars, as bright as they really are. From Earth Venus outshines everything
 * but the Sun and the Moon, Jupiter and Mars come next, Saturn is a steady
 * yellowish star, Uranus at the edge of sight, Neptune not at all; from Mars,
 * Earth is a bright blue evening star with the Moon beside it.
 *
 * A world smaller than a pixel or two is not drawn at all (PlanetTerrain,
 * GasGiant): this is the point that stands for it, fading out as its disc
 * grows big enough to be seen.
 */

/**
 * Absolute magnitudes (the brightness 1 AU from both the Sun and the viewer,
 * fully lit), from the JPL Horizons tables; Saturn's without its rings,
 * which add about half a magnitude when open.
 */
const ABSOLUTE: Record<string, number> = {
    education: -0.61, // Mercury
    experience: -4.38, // Venus
    projects: -3.99, // Earth
    moon: 0.28,
    skills: -1.60, // Mars
    research: -9.40, // Jupiter
    io: -1.68,
    europa: -1.41,
    ganymede: -2.09,
    callisto: -1.05,
    beyond: -9.4, // Saturn, rings included
    titan: -1.28,
    freelance: -7.11, // Uranus
    certifications: -7.0, // Neptune
    triton: -1.2,
    pluto: -0.76,
};

const IDS = Object.keys(ABSOLUTE);

/**
 * How much fainter each world is at phase angle a (degrees) than fully lit:
 * the fits to a century of photometry in Mallama and Hilton (2018) for the
 * planets (Venus's forward scattering makes its crescent far brighter than a
 * matte ball's), Allen's for the Moon, and about 0.03 magnitudes a degree for
 * the others' dusty or icy faces.
 */
const PHASE: Record<string, (a: number) => number> = {
    education: (a) => 6.328e-2 * a - 1.6336e-3 * a ** 2 + 3.3644e-5 * a ** 3 - 3.4265e-7 * a ** 4 + 1.6893e-9 * a ** 5 - 3.0334e-12 * a ** 6,
    experience: (a) => a <= 163.7
        ? -1.044e-3 * a + 3.687e-4 * a ** 2 - 2.814e-6 * a ** 3 + 8.938e-9 * a ** 4
        : 240.44228 - 2.81914 * a + 8.39034e-3 * a ** 2,
    projects: (a) => -1.06e-3 * a + 2.054e-4 * a ** 2,
    skills: (a) => (a <= 50 ? 2.267e-2 * a - 1.302e-4 * a ** 2 : -0.02573 * a + 3.445e-4 * a ** 2 + 1.2),
    research: (a) => -3.7e-4 * a + 6.16e-4 * a ** 2,
    beyond: (a) => -3.7e-4 * a + 6.16e-4 * a ** 2,
    freelance: (a) => 6.587e-3 * a + 1.045e-4 * a ** 2,
    certifications: () => 0,
    moon: (a) => 0.026 * a + 4e-9 * a ** 4,
};
const dusty = (a: number) => 0.03 * a;

/** The apparent magnitude from the distances (AU) and the phase angle (radians). */
export const apparentMagnitude = (id: string, fromSun: number, fromViewer: number, phase: number) =>
    ABSOLUTE[id] + 5 * Math.log10(Math.max(fromSun * fromViewer, 1e-12)) + (PHASE[id] ?? dusty)(THREE.MathUtils.radToDeg(phase));

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aColor;
attribute float aSize;
varying vec3 vColor;
uniform float uPixelRatio;
void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uPixelRatio;
    #include <logdepthbuf_vertex>
}
`;

// A sharp core and a soft glow round it (the glow grows with brightness, so
// Venus reads as brighter than the screen's white can show).
const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0;
    float light = exp(-d2 * 14.0) + exp(-d2 * 3.5) * 0.22;
    gl_FragColor = vec4(vColor * light, 1.0);
}
`;

/** Where the points are drawn: far out along each world's direction, inside the sky sphere. */
const SHELL = 1500000;

const toBody = new THREE.Vector3();
const toSun = new THREE.Vector3();
const toViewer = new THREE.Vector3();
const tint = new THREE.Color();

export const PlanetPoints = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const { size } = useThree();
    const ref = useRef<THREE.Points>(null);
    const points = useMemo(() => {
        const bodies = IDS.map((id) => findBody(id)).filter((b): b is ExpeditionBody => !!b);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bodies.length * 3), 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(bodies.length * 3), 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(bodies.length), 1));
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
        });
        // Each world's colour as the eye sees it: its own, paled towards white.
        const colors = bodies.map((b) => new THREE.Color(b.color).lerp(new THREE.Color(1, 1, 1), 0.45));
        return { bodies, geometry, material, colors, sun: findBody('sun')! };
    }, []);
    useEffect(() => () => { points.geometry.dispose(); points.material.dispose(); }, [points]);

    useFrame(({ camera }) => {
        const position = points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const color = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
        const sizes = points.geometry.getAttribute('aSize') as THREE.BufferAttribute;
        // Inside a gas giant's haze nothing beyond it shows.
        if (ref.current) ref.current.visible = SKY_COVER.value < 0.999;
        const eye = runtime.camera;
        const fov = THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov ?? 60);
        const pixelsPerRadian = (size.height / 2) / Math.tan(fov / 2);
        // A daytime sky drowns all but the brightest (as for the stars), and
        // dark-adapted eyes see fainter ones.
        const sky = 1 - runtime.atmosphere * runtime.daylight * 0.85;
        points.bodies.forEach((body, i) => {
            toBody.copy(body.position).sub(eye);
            const distance = toBody.length();
            const across = (2 * body.radius / Math.max(distance, 1)) * pixelsPerRadian;
            // Gone once its disc is big enough to see, and never for the world one is on.
            const show = body === runtime.currentBody ? 0 : 1 - THREE.MathUtils.smoothstep(across, 1.5, 4);
            toSun.copy(points.sun.position).sub(body.position);
            const phase = toSun.angleTo(toViewer.copy(toBody).negate());
            const magnitude = apparentMagnitude(body.id, toSun.length() / AU, distance / AU, phase);
            // The screen cannot show Venus 60 times brighter than a bright star:
            // brightness compressed, and the brightest drawn larger as well.
            const flux = Math.pow(10, -0.4 * magnitude);
            const bright = Math.min(2.4, 1.3 * Math.pow(flux, 0.42)) * sky * show;
            const glow = 2.6 + 3.2 * Math.pow(Math.max(-magnitude, 0), 0.8);
            toBody.multiplyScalar(SHELL / Math.max(distance, 1)).add(eye).sub(runtime.origin);
            position.setXYZ(i, toBody.x, toBody.y, toBody.z);
            tint.copy(points.colors[i]).multiplyScalar(bright);
            color.setXYZ(i, tint.r, tint.g, tint.b);
            sizes.setX(i, bright > 0.002 ? glow : 0);
        });
        position.needsUpdate = true;
        color.needsUpdate = true;
        sizes.needsUpdate = true;
    }, -1);

    // Drawn right after the stars, before the worlds: a nearer world covers its point.
    return <points ref={ref} geometry={points.geometry} material={points.material} renderOrder={-98} frustumCulled={false} />;
};
