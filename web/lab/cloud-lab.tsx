// Test only: clouds and sky at Earth's real size, from takram's three-clouds and three-atmosphere, over a stretch of
// rolling country wrapped onto the real curvature, so they can be judged (and compared with the game's) before the
// game's Earth is made real-size. URL: ?lat=&lon= (degrees) &alt= (m above the ground) &yaw= (deg from north, east
// positive) &pitch= (deg) &t= (ISO time) &cover= (0-1) &q=low|medium|high|ultra &w=&h=.
// window.__lab.view(yaw, pitch, alt) / .time(iso) change it without a reload; window.__frames counts frames.
import { StrictMode, useLayoutEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { Ellipsoid, Geodetic } from '@takram/three-geospatial';
import { AerialPerspective, Atmosphere, type AtmosphereApi } from '@takram/three-atmosphere/r3f';
import type { AerialPerspectiveEffect } from '@takram/three-atmosphere';
import type { CloudsEffect } from '@takram/three-clouds';
import { Clouds } from '@takram/three-clouds/r3f';
type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

const q = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (q.has(key) ? Number(q.get(key)) : fallback);
const W = num('w', 960);
const H = num('h', 540);
const LAT = num('lat', 32.78);
const LON = num('lon', -96.8);
const state = {
    alt: num('alt', 2),
    yaw: num('yaw', 250),
    pitch: num('pitch', 8),
    time: q.get('t') ?? '2026-11-05T20:30:00Z',
    cover: num('cover', 0.4),
};
const PRESET = (q.get('q') ?? 'medium') as QualityPreset;
const LOGDEPTH = q.get('log') !== '0';
const TEX = '/textures/clouds/';
const RADIUS = 6371000;
/** The country's height above sea level, besides its hills (m). */
const LIFT = 320;

declare global {
    interface Window { __frames: number; __lab: { view: (yaw: number, pitch: number, alt: number) => void; time: (iso: string) => void } }
}
window.__frames = 0;

// Rolling country: a few octaves of value noise, metres.
const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
};
const value = (x: number, y: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const height = (x: number, z: number) => {
    let h = 0;
    let amp = 260;
    let f = 1 / 9000;
    for (let i = 0; i < 6; i++) {
        h += (value(x * f, z * f) - 0.5) * amp;
        amp *= 0.45;
        f *= 2.3;
    }
    return h;
};

/** Ground out to 300 km round the origin, laid on the sphere (local frame: x north, y up, z east). */
const groundGeometry = () => {
    const rings = 190;
    const around = 220;
    const ratio = Math.pow(300000 / 4, 1 / rings);
    const position: number[] = [];
    const color: number[] = [];
    const index: number[] = [];
    // (All of it above sea level: the sky's model leaves anything under the ground's sphere unlit.)
    // Albedos as real ground has them (linear): grassland ~0.2, dry fields ~0.3, woods ~0.1.
    const grass = new THREE.Color().setRGB(0.13, 0.2, 0.06, THREE.LinearSRGBColorSpace);
    const field = new THREE.Color().setRGB(0.33, 0.28, 0.16, THREE.LinearSRGBColorSpace);
    const dark = new THREE.Color().setRGB(0.05, 0.09, 0.03, THREE.LinearSRGBColorSpace);
    const c = new THREE.Color();
    const add = (d: number, a: number) => {
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        const h = height(x, z) + LIFT;
        const theta = d / RADIUS;
        const r = RADIUS + h;
        position.push(Math.sin(theta) * Math.cos(a) * r, Math.cos(theta) * r - RADIUS, Math.sin(theta) * Math.sin(a) * r);
        const patch = value(x / 1800, z / 1800);
        c.copy(grass).lerp(field, THREE.MathUtils.smoothstep(patch, 0.55, 0.7)).lerp(dark, THREE.MathUtils.smoothstep(value(x / 600 + 9, z / 600), 0.6, 0.85) * 0.7);
        color.push(c.r, c.g, c.b);
    };
    add(0, 0);
    for (let i = 1; i <= rings; i++) {
        const d = 4 * Math.pow(ratio, i);
        for (let k = 0; k < around; k++) add(d, (k / around) * Math.PI * 2);
    }
    for (let k = 0; k < around; k++) index.push(0, 1 + ((k + 1) % around), 1 + k);
    for (let i = 1; i < rings; i++) {
        const a0 = 1 + (i - 1) * around;
        const b0 = 1 + i * around;
        for (let k = 0; k < around; k++) {
            const k1 = (k + 1) % around;
            index.push(a0 + k, a0 + k1, b0 + k1, a0 + k, b0 + k1, b0 + k);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

const look = new THREE.Vector3();
const Rig = () => {
    const camera = useThree((s) => s.camera);
    useFrame(() => {
        window.__frames++;
        const yaw = THREE.MathUtils.degToRad(state.yaw);
        const pitch = THREE.MathUtils.degToRad(state.pitch);
        camera.position.set(0, height(0, 0) + LIFT + state.alt, 0);
        look.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).add(camera.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(look);
    }, -1);
    return null;
};

const Scene = () => {
    const atmosphere = useRef<AtmosphereApi>(null);
    const aerial = useRef<AerialPerspectiveEffect>(null);
    const clouds = useRef<CloudsEffect>(null);
    // The clouds are drawn a sixteenth at a time and the rest carried over from earlier frames. Turning the camera
    // far at once can leave a broken value (NaN) in what is carried over, and it then spreads frame after frame as
    // black patches: never keep one.
    useLayoutEffect(() => {
        const material = clouds.current?.cloudsPass.resolveMaterial;
        if (!material || material.fragmentShader.includes('NAN_GUARD')) return;
        // A broken motion vector passes the "off screen" test (every comparison with NaN is false) and reads garbage
        // from the history: take it as no motion. And whatever still comes out broken is replaced by this frame's
        // own sample of the clouds.
        let source = material.fragmentShader.split('vec2 velocity = depthVelocity.gb;').join(
            'vec2 velocity = depthVelocity.gb; if (any(isnan(velocity)) || any(isinf(velocity))) velocity = vec2(0.0);');
        const at = source.lastIndexOf('}');
        source = source.slice(0, at)
            + '  // NAN_GUARD\n  if (any(isnan(outputColor)) || any(isinf(outputColor))) outputColor = texture(colorBuffer, vUv);\n'
            + '  if (any(isnan(outputColor)) || any(isinf(outputColor))) outputColor = vec4(0.0);\n'
            + source.slice(at);
        material.fragmentShader = source;
        material.needsUpdate = true;
    }, []);
    // The effect reads depth to find each pixel's place; with a logarithmic depth buffer it has to be told so
    // (its shader checks a define that three does not add to post-processing materials).
    useLayoutEffect(() => {
        const effect = aerial.current;
        if (!effect || !LOGDEPTH) return;
        effect.defines.set('USE_LOGARITHMIC_DEPTH_BUFFER', '1');
        (effect as unknown as { setChanged: () => void }).setChanged();
    }, []);
    const geometry = useMemo(groundGeometry, []);
    useLayoutEffect(() => {
        const api = atmosphere.current;
        if (!api) return;
        const ecef = new Geodetic(THREE.MathUtils.degToRad(LON), THREE.MathUtils.degToRad(LAT), 0).toECEF();
        Ellipsoid.WGS84.getNorthUpEastFrame(ecef, api.worldToECEFMatrix);
        api.updateByDate(new Date(state.time));
        window.__lab = {
            view: (yaw, pitch, alt) => { state.yaw = yaw; state.pitch = pitch; state.alt = alt; },
            time: (iso) => { state.time = iso; atmosphere.current?.updateByDate(new Date(iso)); },
        };
    }, []);
    return (
        <Atmosphere ref={atmosphere}>
            <Rig />
            <mesh geometry={geometry}>
                <meshBasicMaterial vertexColors />
            </mesh>
            <EffectComposer multisampling={0} enableNormalPass>
                <Clouds
                    ref={clouds as never}
                    qualityPreset={PRESET}
                    coverage={state.cover}
                    localWeatherTexture={`${TEX}local_weather.png`}
                    shapeTexture={`${TEX}shape.bin`}
                    shapeDetailTexture={`${TEX}shape_detail.bin`}
                    turbulenceTexture={`${TEX}turbulence.png`}
                    stbnTexture={`${TEX}stbn.bin`}
                />
                <AerialPerspective ref={aerial} sky sunLight skyLight stbnTexture={`${TEX}stbn.bin`} />
                <ToneMapping mode={ToneMappingMode.AGX} />
            </EffectComposer>
        </Atmosphere>
    );
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <div style={{ width: W, height: H }}>
            <Canvas
                dpr={1}
                gl={{ logarithmicDepthBuffer: LOGDEPTH, antialias: false, preserveDrawingBuffer: true, toneMapping: THREE.NoToneMapping }}
                camera={{ fov: 60, near: 1, far: 1e7 }}
            >
                <Scene />
            </Canvas>
        </div>
    </StrictMode>,
);
