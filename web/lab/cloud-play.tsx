// The cloud lab to play with: takram's volumetric clouds and precomputed sky at Earth's real size over rolling
// country near Dallas. Drag to look; sliders for the time of day, the cloud cover and the height; a quality choice.
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { Ellipsoid, Geodetic } from '@takram/three-geospatial';
import { AerialPerspective, Atmosphere, type AtmosphereApi } from '@takram/three-atmosphere/r3f';
import type { AerialPerspectiveEffect } from '@takram/three-atmosphere';
import { Clouds } from '@takram/three-clouds/r3f';
import type { CloudsEffect } from '@takram/three-clouds';

type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

/**
 * The clouds' 3D textures (shape 128^3, detail 32^3, blue noise 128x128x64, one byte each), shipped as base64 in
 * JSON (the preview host serves no raw binary files) and made into textures as takram's own loaders make them.
 */
interface CloudTextures { shape: THREE.Data3DTexture; detail: THREE.Data3DTexture; stbn: THREE.Data3DTexture }
const bytesOf = async (url: string) => {
    const b64 = await (await fetch(url)).json() as string;
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
};
const texture3D = (data: Uint8Array, w: number, h: number, d: number, filter: THREE.MagnificationTextureFilter) => {
    const texture = new THREE.Data3DTexture(data, w, h, d);
    texture.format = THREE.RedFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = filter;
    texture.magFilter = filter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
};
const loadCloudTextures = async (): Promise<CloudTextures> => {
    const [shape, detail, stbn] = await Promise.all(['shape', 'shape_detail', 'stbn'].map((n) => bytesOf(`${TEX}${n}.b64.json`)));
    return {
        shape: texture3D(shape, 128, 128, 128, THREE.LinearFilter),
        detail: texture3D(detail, 32, 32, 32, THREE.LinearFilter),
        stbn: texture3D(stbn, 128, 128, 64, THREE.NearestFilter),
    };
};
const TEX = './textures/clouds/';
const RADIUS = 6371000;
const LAT = 32.78;
const LON = -96.8;
/** Central time in November: UTC-6. */
const UTC_OFFSET = 6;
const LIFT = 320;

const view = { yaw: 65, pitch: 10, alt: 2 };

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
        const yaw = THREE.MathUtils.degToRad(view.yaw);
        const pitch = THREE.MathUtils.degToRad(view.pitch);
        camera.position.set(0, height(0, 0) + LIFT + view.alt, 0);
        look.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)).add(camera.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(look);
    }, -1);
    return null;
};

const dateAt = (hour: number) => new Date(Date.UTC(2026, 10, 5, 0, 0, 0) + (hour + UTC_OFFSET) * 3600 * 1000);

const Scene = ({ hour, cover, quality, textures }: { hour: number; cover: number; quality: QualityPreset; textures: CloudTextures }) => {
    const atmosphere = useRef<AtmosphereApi>(null);
    const aerial = useRef<AerialPerspectiveEffect>(null);
    const clouds = useRef<CloudsEffect>(null);
    const geometry = useMemo(groundGeometry, []);
    useLayoutEffect(() => {
        const api = atmosphere.current;
        if (!api) return;
        const ecef = new Geodetic(THREE.MathUtils.degToRad(LON), THREE.MathUtils.degToRad(LAT), 0).toECEF();
        Ellipsoid.WGS84.getNorthUpEastFrame(ecef, api.worldToECEFMatrix);
    }, []);
    useEffect(() => {
        atmosphere.current?.updateByDate(dateAt(hour));
    }, [hour]);
    // The effect reads depth to find each pixel's place; with a logarithmic depth buffer it must be told.
    useLayoutEffect(() => {
        const effect = aerial.current;
        if (!effect) return;
        effect.defines.set('USE_LOGARITHMIC_DEPTH_BUFFER', '1');
        (effect as unknown as { setChanged: () => void }).setChanged();
    }, []);
    // Never carry a broken value (NaN) forward in the clouds' history: a broken motion vector is taken as none, and
    // anything still broken is replaced by this frame's own sample.
    useLayoutEffect(() => {
        const material = clouds.current?.cloudsPass.resolveMaterial;
        if (!material || material.fragmentShader.includes('NAN_GUARD')) return;
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
    return (
        <Atmosphere ref={atmosphere}>
            <Rig />
            <mesh geometry={geometry}>
                <meshBasicMaterial vertexColors />
            </mesh>
            <EffectComposer multisampling={0} enableNormalPass>
                <Clouds
                    ref={clouds as never}
                    qualityPreset={quality}
                    coverage={cover}
                    localWeatherTexture={`${TEX}local_weather.png`}
                    shapeTexture={textures.shape}
                    shapeDetailTexture={textures.detail}
                    turbulenceTexture={`${TEX}turbulence.png`}
                    stbnTexture={textures.stbn}
                />
                <AerialPerspective ref={aerial} sky sunLight skyLight stbnTexture={textures.stbn} />
                <ToneMapping mode={ToneMappingMode.AGX} />
            </EffectComposer>
        </Atmosphere>
    );
};

/** Frames a second, averaged over half a second. */
const useFrameRate = () => {
    const [rate, setRate] = useState<number | null>(null);
    useEffect(() => {
        let frame = 0;
        let count = 0;
        let since = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            count++;
            if (now - since > 500) {
                setRate(Math.round((count * 1000) / (now - since)));
                count = 0;
                since = now;
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);
    return rate;
};

const clock = (hour: number) => {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    const shown = ((h + 11) % 12) + 1;
    return `${shown}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
/** Height slider 0-1 to metres: fine near the ground, coarse high up. */
const heightOf = (t: number) => Math.round(2 + 11998 * t * t);

const QUALITIES: { id: QualityPreset; label: string }[] = [
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
];

const App = () => {
    const [hour, setHour] = useState(14.5);
    const [cover, setCover] = useState(0.4);
    const [lift, setLift] = useState(0);
    const [quality, setQuality] = useState<QualityPreset>('medium');
    const [open, setOpen] = useState(true);
    const [textures, setTextures] = useState<CloudTextures | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        loadCloudTextures().then(setTextures, () => setFailed(true));
    }, []);
    const rate = useFrameRate();
    const drag = useRef<{ x: number; y: number } | null>(null);
    useEffect(() => {
        view.alt = heightOf(lift);
    }, [lift]);
    return (
        <>
            <div
                className="stage"
                onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
                onPointerMove={(e) => {
                    if (!drag.current) return;
                    view.yaw = (view.yaw - (e.clientX - drag.current.x) * 0.15 + 360) % 360;
                    view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag.current.y) * 0.15, -40, 88);
                    drag.current = { x: e.clientX, y: e.clientY };
                }}
                onPointerUp={() => { drag.current = null; }}
                onPointerCancel={() => { drag.current = null; }}
            >
                <Canvas
                    dpr={[1, 1.5]}
                    gl={{ logarithmicDepthBuffer: true, antialias: false, toneMapping: THREE.NoToneMapping, powerPreference: 'high-performance' }}
                    camera={{ fov: 60, near: 1, far: 1e7 }}
                >
                    {textures && <Scene hour={hour} cover={cover} quality={quality} textures={textures} />}
                </Canvas>
            </div>
            {!textures && <p className="status">{failed ? 'The cloud textures did not load.' : 'Loading clouds…'}</p>}
            <aside className={`panel${open ? '' : ' panel--closed'}`}>
                <header>
                    <h1>Cloud lab</h1>
                    <span className="rate" aria-live="polite">{rate === null ? '' : `${rate} fps`}</span>
                    <button type="button" className="toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
                </header>
                {open && (
                    <>
                        <p className="hint">Real-size Earth near Dallas, 5 November. Drag to look around.</p>
                        <label>
                            <span>Time of day <b>{clock(hour)}</b></span>
                            <input type="range" min={6} max={19.5} step={0.05} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
                        </label>
                        <label>
                            <span>Cloud cover <b>{Math.round(cover * 100)}%</b></span>
                            <input type="range" min={0} max={1} step={0.01} value={cover} onChange={(e) => setCover(Number(e.target.value))} />
                        </label>
                        <label>
                            <span>Height <b>{heightOf(lift).toLocaleString('en-US')} m</b></span>
                            <input type="range" min={0} max={1} step={0.002} value={lift} onChange={(e) => setLift(Number(e.target.value))} />
                        </label>
                        <div className="quality" role="radiogroup" aria-label="Quality">
                            {QUALITIES.map((q) => (
                                <button key={q.id} type="button" role="radio" aria-checked={quality === q.id} onClick={() => setQuality(q.id)}>{q.label}</button>
                            ))}
                        </div>
                    </>
                )}
            </aside>
        </>
    );
};

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
