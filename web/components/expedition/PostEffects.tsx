import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ShaderPass, ToneMappingMode } from 'postprocessing';
import { CloudVolumeEffect, createCloudNoise } from './cloudVolume';
import { cloudMarchBase, cloudMarchBases, createCloudScene, updateCloudScene } from './cloudScenes';
import { EXPEDITION_BODIES } from './bodies';
import { regionOf, type Region } from './region';
import type { ExpeditionRuntime } from './runtime';

/**
 * A NaN or an infinity anywhere in the HDR frame (a shader taking pow() of a
 * negative number, a glint too bright for a half float) would be spread by the
 * bloom's blur into a black block that comes and goes as that one pixel does.
 * Before anything reads the frame, this turns +infinity into a very bright
 * light and anything else that is not a number into black, one pixel each.
 * It tests the bits: a shader compiler may assume every float is finite and
 * drop isnan() and isinf().
 */
const createSanitizePass = () => new ShaderPass(new THREE.ShaderMaterial({
    name: 'SanitizeMaterial',
    uniforms: { inputBuffer: { value: null } },
    blending: THREE.NoBlending,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = position.xy * 0.5 + 0.5;
            gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,
    fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        varying vec2 vUv;
        float finite(float x, float top) {
            uint bits = floatBitsToUint(x);
            if ((bits & 0x7f800000u) != 0x7f800000u) return clamp(x, 0.0, top);
            return bits == 0x7f800000u ? top : 0.0;
        }
        void main() {
            vec4 c = texture2D(inputBuffer, vUv);
            gl_FragColor = vec4(finite(c.r, 4096.0), finite(c.g, 4096.0), finite(c.b, 4096.0), finite(c.a, 1.0));
        }`,
}));

/**
 * The camera, as in the reference video: the scene is rendered in HDR, then
 * anything brighter than white (the sun, engine glows, sunlit snow and cloud
 * tops, crystals) blooms, the image is tone mapped like film, and a light
 * vignette and grain take the edge off the computer-generated look.
 *
 * Phones (quality 0) skip it and use the renderer's own tone mapping.
 */
export const PostEffects = ({ quality, runtime, region }: { quality: 0 | 1 | 2; runtime: ExpeditionRuntime; region: Region }) => {
    const gl = useThree((state) => state.gl);
    // The composer resizes itself with the window, not with the pixel ratio
    // (AdaptiveResolution changes that alone): resize it then too.
    const composerRef = useRef<{ setSize: (width: number, height: number) => void } | null>(null);
    const size = useThree((state) => state.size);
    const dpr = useThree((state) => state.viewport.dpr);
    useEffect(() => { composerRef.current?.setSize(size.width, size.height); }, [dpr, size]);
    const sanitize = useMemo(() => (quality === 0 ? null : createSanitizePass()), [quality]);
    useEffect(() => () => sanitize?.dispose(), [sanitize]);
    // Volumetric clouds (cloudVolume.ts): the noise they are cut from is drawn once.
    const clouds = useMemo(() => {
        if (quality === 0) return null;
        const noise = createCloudNoise(gl);
        return { noise, effect: new CloudVolumeEffect(noise.texture), scene: createCloudScene() };
    }, [quality, gl]);
    useEffect(() => () => { clouds?.effect.dispose(); clouds?.noise.dispose(); }, [clouds]);
    // Every giant's clouds compiled in the background a little after landing (or arriving through
    // the wormhole), where the browser compiles off the main thread, so none is still compiling
    // when a giant is reached. Only the system the player is in (region.ts).
    useEffect(() => {
        if (!clouds || !gl.extensions.get('KHR_parallel_shader_compile')) return undefined;
        const timer = window.setTimeout(() => {
            cloudMarchBases(EXPEDITION_BODIES.filter((body) => regionOf(body) === region)).forEach((base) => clouds.effect.prepare(gl, base));
        }, 20000);
        return () => window.clearTimeout(timer);
    }, [clouds, gl, region]);
    useFrame(({ camera }, delta) => {
        if (!clouds) return;
        clouds.effect.prepare(gl, cloudMarchBase(runtime));
        const steps = quality === 2 ? 56 : 36;
        if (updateCloudScene(runtime, clouds.scene, Math.min(delta, 0.1))) clouds.effect.set(clouds.scene, camera, clouds.scene.steps > 0 ? Math.min(steps, clouds.scene.steps) : steps);
        else clouds.effect.off();
    });
    if (!sanitize) return null;
    const effects = [
        <primitive key="sanitize" object={sanitize} />,
        ...(clouds ? [<primitive key="clouds" object={clouds.effect} />] : []),
        <Bloom key="bloom" mipmapBlur intensity={quality === 2 ? 1.05 : 0.85} luminanceThreshold={1.0} luminanceSmoothing={0.35} radius={0.78} />,
        <ToneMapping key="tone" mode={ToneMappingMode.ACES_FILMIC} />,
        <Vignette key="vignette" offset={0.3} darkness={0.52} />,
        <Noise key="grain" premultiply opacity={0.05} blendFunction={BlendFunction.SOFT_LIGHT} />,
    ];
    if (quality === 1) effects.push(<SMAA key="smaa" />);
    return (
        <EffectComposer ref={(composer) => { composerRef.current = composer; if (import.meta.env.DEV) (window as unknown as { __composer?: unknown }).__composer = composer; }} multisampling={quality === 2 ? 4 : 0} frameBufferType={THREE.HalfFloatType}>
            {effects}
        </EffectComposer>
    );
};
