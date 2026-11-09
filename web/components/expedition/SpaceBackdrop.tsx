import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { BLACK_HOLE, WORMHOLES, farness } from './deepSpace';
import type { ExpeditionRuntime } from './runtime';
import { sunlitShare } from './exposure';

/**
 * Deep space behind everything: a purple and blue nebula, a faint galactic
 * band and several thousand stars (the Sun is a real body: Sun.tsx). It is drawn centred on
 * whichever camera draws it (the player's, or a cube camera photographing the
 * sky for the wormhole's lens), so it always reads as infinitely far away.
 *
 * Far out by TON 618 the sky is another galaxy's: a bright, crowded band with
 * dust lanes and a glowing core, laid behind the black hole so that it bends
 * the band into rings.
 */
const SKY_RADIUS = 2000000;

/** The universe's turn in the game's frame, shared by the nebula and the stars. */
const SKY = { value: new THREE.Matrix3() };
const skyMatrix = new THREE.Matrix4();

const nebulaVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
uniform mat3 uSky;
void main() {
    vDir = normalize(position);
    vec4 mvPosition = viewMatrix * vec4(cameraPosition + uSky * position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
}
`;

const nebulaFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform float uDetail;
uniform float uFade;
uniform float uFar;
uniform vec3 uFarBand;
uniform vec3 uFarCore;
varying vec3 vDir;

float starField(vec3 d, float scale, float threshold) {
    vec3 p = d * scale;
    vec3 cell = floor(p);
    vec3 f = fract(p) - 0.5;
    uvec3 key = uvec3(ivec3(cell) + 65536);
    float h = hashToUnit(hash3(key, 911u));
    vec3 jitter = vec3(hashToUnit(hash3(key, 912u)), hashToUnit(hash3(key, 913u)), hashToUnit(hash3(key, 914u))) - 0.5;
    float dist = length(f - jitter * 0.7);
    return step(threshold, h) * (1.0 - smoothstep(0.04, 0.14, dist)) * (0.5 + 2.5 * pow(h, 40.0));
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    int octaves = int(uDetail);
    vec3 warp = vec3(
        fbm(d * 1.6, 11u, 3, 2.0, 0.5),
        fbm(d * 1.6 + 5.2, 23u, 3, 2.0, 0.5),
        fbm(d * 1.6 + 9.7, 37u, 3, 2.0, 0.5)
    );
    float clouds = fbm(d * 2.4 + warp * 1.4, 41u, octaves, 2.1, 0.52);
    float lanes = fbm(d * 5.0 + warp * 2.0, 53u, octaves, 2.0, 0.5);
    float mask = smoothstep(-0.25, 0.55, fbm(d * 0.9, 67u, 3, 2.0, 0.5));
    float density = smoothstep(-0.2, 0.7, clouds) * mask;
    density *= 0.65 + 0.35 * smoothstep(-0.4, 0.3, lanes);

    vec3 violet = vec3(0.34, 0.12, 0.52);
    vec3 magenta = vec3(0.62, 0.2, 0.62);
    vec3 blue = vec3(0.13, 0.26, 0.62);
    vec3 col = mix(blue, violet, smoothstep(-0.3, 0.4, warp.x));
    col = mix(col, magenta, smoothstep(0.35, 0.8, clouds) * 0.5);

    // A faint galactic band across the sky.
    float bandLat = dot(d, normalize(vec3(0.25, 1.0, -0.35))) / 0.2;
    float band = exp(-bandLat * bandLat);
    vec3 bandColor = vec3(0.32, 0.3, 0.42) * band * (0.5 + 0.5 * fbm(d * 7.0, 79u, octaves, 2.0, 0.5));

    vec3 color = col * density * 0.55 + bandColor * 0.28 + vec3(0.004, 0.003, 0.012);

    if (uFar > 0.001) {
        // Another galaxy, seen from inside: its band, dust lanes and core.
        float lat = dot(d, uFarBand);
        float band = exp(-lat * lat * 30.0);
        float grain = fbm(d * 14.0, 73u, octaves, 2.0, 0.5);
        float dust = fbm(d * 6.0 + warp * 0.6, 71u, octaves, 2.0, 0.5);
        float lanes = smoothstep(0.0, 0.3, dust) * exp(-lat * lat * 260.0);
        float coreAngle = acos(clamp(dot(d, uFarCore), -1.0, 1.0));
        float core = exp(-coreAngle * coreAngle * 7.0);
        vec3 galaxy = vec3(0.5, 0.56, 0.82) * band * (0.3 + 0.7 * smoothstep(-0.3, 0.6, grain)) * 0.55;
        galaxy += vec3(1.0, 0.76, 0.5) * core * (0.75 + 0.25 * grain);
        galaxy *= 1.0 - lanes * 0.8;
        galaxy += vec3(1.0, 0.94, 0.86) * starField(d, 240.0, 0.9) * (0.15 + band * 1.6 + core);
        color = mix(color, color * 0.4 + galaxy, uFar);
    }
    color *= uFade;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// The home sky never changes, so it is drawn once into a cube texture (a few
// million pixels, once) and from then on each pixel of it is one lookup: the
// nebula's twenty-odd layers of noise per pixel per frame were half of what a
// frame cost in space and inside the giants.
const bakedFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform samplerCube uNebula;
uniform float uFade;
varying vec3 vDir;
void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(textureCube(uNebula, normalize(vDir)).rgb * uFade, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const starVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uPixelRatio;
uniform mat3 uSky;
void main() {
    vColor = aColor;
    vec4 mvPosition = viewMatrix * vec4(cameraPosition + uSky * position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * uPixelRatio;
    #include <logdepthbuf_vertex>
}
`;

const starFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
uniform float uFade;
void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * core * core * uFade, 1.0);
}
`;

const viewPoint = new THREE.Vector3();

// The far galaxy is laid out as seen from the mouth beside TON 618: its band
// passes behind the black hole, tilted to the disk, and its core glows beside it.
const farMouth = WORMHOLES.find((mouth) => mouth.id === 'wormhole-ton618')!;
const towardHole = BLACK_HOLE.position.clone().sub(farMouth.position).normalize();
const FAR_BAND = new THREE.Vector3().crossVectors(towardHole, BLACK_HOLE.diskNormal.clone().applyAxisAngle(towardHole, 0.5)).normalize();
const FAR_CORE = towardHole.clone().applyAxisAngle(FAR_BAND, 0.42).normalize();

/**
 * Which sky to draw for a viewpoint (world units): the baked one, or (by TON
 * 618) the one worked out per pixel. The wormhole's photographs set it for
 * their own viewpoint before taking each one (DeepSpace.tsx).
 */
export const SKY_SWITCH = { at: (_point: THREE.Vector3, _covered = false) => {} };
/**
 * How much of the sky something nearer covers completely (1: all of it, as
 * the haze of a gas giant does once the ship is down in it). Then the
 * backdrop is not drawn at all: it was a whole screen of work nobody saw.
 */
export const SKY_COVER = { value: 0 };

/** Cube faces of the baked sky, by detail: the nebula is soft, so a little goes a long way. */
const BAKE_SIZE = [384, 768, 1024];

export const SpaceBackdrop = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const gl = useThree((state) => state.gl);
    const starsRef = useRef<THREE.Points>(null);
    const nebula = useMemo(() => {
        const geometry = new THREE.SphereGeometry(SKY_RADIUS, 64, 48);
        const procedural = (sky: { value: THREE.Matrix3 }) => new THREE.ShaderMaterial({
            vertexShader: nebulaVertex,
            fragmentShader: nebulaFragment,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            uniforms: {
                uDetail: { value: runtime.quality === 0 ? 3 : 5 },
                uFade: { value: 1 },
                uFar: { value: 0 },
                uFarBand: { value: FAR_BAND },
                uFarCore: { value: FAR_CORE },
                uSky: sky,
            },
        });
        // Far out by TON 618 the sky is worked out per pixel (another galaxy's
        // band crosses it); everywhere else it comes from the baked cube.
        const material = procedural(SKY);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = -100;
        mesh.frustumCulled = false;
        mesh.visible = false;
        // How far out towards TON 618 the camera drawing it is.
        mesh.onBeforeRender = (_renderer, _scene, camera) => {
            viewPoint.setFromMatrixPosition(camera.matrixWorld).add(runtime.origin);
            material.uniforms.uFar.value = farness(viewPoint);
        };
        const target = new THREE.WebGLCubeRenderTarget(BAKE_SIZE[runtime.quality], {
            type: THREE.HalfFloatType,
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
        });
        const bakedMaterial = new THREE.ShaderMaterial({
            vertexShader: nebulaVertex,
            fragmentShader: bakedFragment,
            side: THREE.BackSide,
            depthWrite: false,
            depthTest: false,
            uniforms: { uNebula: { value: target.texture }, uFade: { value: 1 }, uSky: SKY },
        });
        const baked = new THREE.Mesh(geometry, bakedMaterial);
        baked.renderOrder = -100;
        baked.frustumCulled = false;
        // The bake: the same nebula, unturned, seen from the centre of a cube camera.
        const bakeMaterial = procedural({ value: new THREE.Matrix3() });
        const bakeScene = new THREE.Scene();
        bakeScene.add(new THREE.Mesh(geometry, bakeMaterial));
        const cubeCamera = new THREE.CubeCamera(1, SKY_RADIUS * 4, target);
        return { geometry, material, mesh, baked, bakedMaterial, target, bakeScene, bakeMaterial, cubeCamera, done: false };
    }, [runtime]);
    // The bake itself, once, the first time it can be drawn.
    useFrame(() => {
        if (nebula.done) return;
        nebula.done = true;
        nebula.cubeCamera.update(gl, nebula.bakeScene);
    }, -2);

    const stars = useMemo(() => {
        const count = runtime.quality === 0 ? 3500 : 7000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        let seed = 0x9e3779b9;
        const random = () => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const tint = new THREE.Color();
        for (let i = 0; i < count; i++) {
            const u = random() * 2 - 1;
            const theta = random() * Math.PI * 2;
            const s = Math.sqrt(1 - u * u);
            const r = SKY_RADIUS * 0.9;
            positions[i * 3] = Math.cos(theta) * s * r;
            positions[i * 3 + 1] = u * r;
            positions[i * 3 + 2] = Math.sin(theta) * s * r;
            const temperature = random();
            tint.setHSL(temperature < 0.7 ? 0.6 - temperature * 0.1 : 0.08, temperature < 0.7 ? 0.35 : 0.6, 0.85);
            const brightness = Math.pow(random(), 3.2) * 1.6 + 0.25;
            colors[i * 3] = tint.r * brightness;
            colors[i * 3 + 1] = tint.g * brightness;
            colors[i * 3 + 2] = tint.b * brightness;
            sizes[i] = 1.2 + Math.pow(random(), 6) * 4.5;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        // Drawn in the opaque pass right after the nebula (not as a transparent
        // object, which would be drawn after the planets and show through them).
        const material = new THREE.ShaderMaterial({
            vertexShader: starVertex,
            fragmentShader: starFragment,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }, uFade: { value: 1 }, uSky: SKY },
        });
        return { geometry, material };
    }, [runtime.quality]);

    useEffect(() => () => {
        nebula.geometry.dispose(); nebula.material.dispose();
        nebula.bakedMaterial.dispose(); nebula.bakeMaterial.dispose(); nebula.target.dispose();
        stars.geometry.dispose(); stars.material.dispose();
    }, [nebula, stars]);

    useFrame(({ camera }) => {
        // The sky turns as the game's frame follows the world the player is at (motion.ts).
        SKY.value.setFromMatrix4(skyMatrix.makeRotationFromQuaternion(runtime.motion.M));
        // A daytime sky hides the faint nebula and most stars. Under a night
        // sky the stars come out, but the nebula stays faint, as the Milky Way
        // is through air: a pale band, not the coloured clouds seen from space.
        // On airless ground in sunlight the eye is set for the bright ground:
        // a black sky, the brighter stars only, no nebula to speak of.
        const sunlitGround = (1 - runtime.atmosphere) * runtime.daylight * runtime.nearGround;
        // A sunlit world filling a few hundredths of the view sets the eye for daylight too (exposure.ts):
        // black space behind it, the brightest stars only.
        const glare = THREE.MathUtils.smoothstep(sunlitShare(runtime, camera), 0.002, 0.03);
        const fade = (1 - runtime.atmosphere * runtime.daylight * 0.85) * (1 - sunlitGround * 0.55) * (1 - glare * 0.75);
        const nebulaFade = fade * (1 - runtime.atmosphere * (1 - runtime.daylight) * 0.75) * (1 - sunlitGround * 0.7) * (1 - glare * 0.92);
        nebula.material.uniforms.uFade.value = nebulaFade;
        nebula.bakedMaterial.uniforms.uFade.value = nebulaFade;
        stars.material.uniforms.uFade.value = fade;
        // The per-pixel sky only where another galaxy's band shows (by TON 618).
        SKY_SWITCH.at(runtime.camera, SKY_COVER.value > 0.999);
    }, -1);
    useEffect(() => {
        SKY_SWITCH.at = (point, covered = false) => {
            const far = farness(point) > 0.001;
            nebula.mesh.visible = far && !covered;
            nebula.baked.visible = !far && !covered;
            if (starsRef.current) starsRef.current.visible = !covered;
        };
        return () => { SKY_SWITCH.at = () => {}; };
    }, [nebula]);

    return (
        <>
            <primitive object={nebula.mesh} />
            <primitive object={nebula.baked} />
            <points ref={starsRef} geometry={stars.geometry} material={stars.material} renderOrder={-99} frustumCulled={false} />
        </>
    );
};
