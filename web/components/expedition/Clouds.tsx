import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPEDITION_BODIES, findBody, type ExpeditionBody } from './bodies';
import { NOISE_GLSL } from './noise';
import { createSurfaceUniforms, SURFACE_SHADING_GLSL } from './surfaceShading';
import { watchView, type ExpeditionRuntime } from './runtime';
import { directionToBody, placeBodyGroup } from './motion';

const eyeDelta = new THREE.Vector3();

/**
 * A deck of cloud over each world with air, as in the reference video: flat,
 * torn patches of stratocumulus at one height, bright where the sun hits
 * them, grey and heavy underneath, silver at the thin edges when they are
 * backlit, and fading into the haze towards the horizon.
 *
 * The cloud pattern for the whole planet is drawn once into a cube map on the
 * GPU (large weather systems, torn by warped noise), so the deck itself costs
 * one texture lookup and a little fine detail per pixel. The pattern drifts
 * slowly with the wind.
 */

const coverageMaterial = (body: ExpeditionBody) => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
        uSeed: { value: (body.biome!.seed + 7717) >>> 0 },
        uCover: { value: body.biome!.cloudCover },
    },
    vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform uint uSeed;
        uniform float uCover;
        varying vec3 vDir;
        void main() {
            vec3 d = normalize(vDir);
            vec3 warp = vec3(
                fbm(d * 4.0, uSeed, 3, 2.0, 0.5),
                fbm(d * 4.0 + 3.1, uSeed + 1u, 3, 2.0, 0.5),
                fbm(d * 4.0 + 7.7, uSeed + 2u, 3, 2.0, 0.5));
            // Weather systems: where the sky is cloudy at all.
            float weather = fbm(d * 2.5 + warp * 0.5, uSeed + 3u, 3, 2.0, 0.5);
            // Cloud fields, stretched a little along the latitude by the wind.
            vec3 q = vec3(d.x * 26.0, d.y * 40.0, d.z * 26.0) + warp * 2.2;
            float field = fbm(q, uSeed + 5u, 6, 2.05, 0.52);
            float v = field * 0.55 + weather * 0.75;
            float threshold = 0.2 - uCover * 0.55;
            float coverage = smoothstep(threshold, threshold + 0.32, v);
            gl_FragColor = vec4(coverage, field * 0.5 + 0.5, weather * 0.5 + 0.5, 1.0);
        }`,
});

const deckMaterial = (body: ExpeditionBody, radius: number, coverage: THREE.Texture, detail: number) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
        ...createSurfaceUniforms(body),
        uCoverage: { value: coverage },
        uCloudRadius: { value: radius },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uDetail: { value: detail },
        uNear: { value: 0 },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vLocal;
        void main() {
            vLocal = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        ${SURFACE_SHADING_GLSL}
        uniform samplerCube uCoverage;
        uniform float uCloudRadius;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uDetail;
        // Inside this distance the clouds are drawn with volume (cloudScenes.ts): the deck gives way.
        uniform float uNear;
        varying vec3 vLocal;

        void main() {
            #include <logdepthbuf_fragment>
            vec3 d = normalize(vLocal);
            // The wind: the whole pattern turns slowly about the axis.
            float a = uTime * 0.00045;
            mat3 wind = mat3(cos(a), 0.0, sin(a), 0.0, 1.0, 0.0, -sin(a), 0.0, cos(a));
            vec3 w = wind * d;
            vec4 cov = textureCube(uCoverage, w);
            // Fine billows that tear the edges; only where the camera can see them.
            float fine = 0.0;
            // (From space they are far smaller than a pixel: not worked out there.)
            bool close = length(uCamLocal - vLocal) < 25000.0;
            if (uDetail > 0.5 && close) {
                fine = gnoise(w * 700.0, 71u) * 0.55 + gnoise(w * 2100.0, 73u) * 0.3;
                if (uDetail > 1.5) fine += gnoise(w * 6000.0, 79u) * 0.15;
            }
            // A storm fills the sky in.
            // (Fair-weather cumulus have crisp edges: a narrower ramp than a storm's grey murk.)
            float density = smoothstep(0.12 - uStorm * 0.54, 0.46 - uStorm * 0.24, cov.r + fine * 0.28 * (1.0 - cov.r * 0.6));
            if (density < 0.012) discard;

            // Volume from a sheet: a step towards the sun across the pattern. Where the cloud is
            // thicker that way this spot lies in its shade (the heap's far side); where thinner,
            // it faces the sun (its lit flank). One more lookup reads as rounded heaps instead
            // of paper cut-outs. (On Medium and High, the billows get it too.)
            vec3 sunAcross = uSunDir - d * dot(uSunDir, d);
            float sunLow = length(sunAcross);
            vec3 towardsSun = sunAcross / max(sunLow, 1e-4);
            float covSun = textureCube(uCoverage, wind * normalize(d + towardsSun * 0.006)).r;
            float slope = covSun - cov.r;
            if (uDetail > 0.5 && close) {
                vec3 ws = wind * normalize(d + towardsSun * 0.0009);
                slope += (gnoise(ws * 700.0, 71u) * 0.55 + gnoise(ws * 2100.0, 73u) * 0.3 - fine) * 0.35;
            }
            // Lit flank and shaded flank, strongest when the sun is low and the relief shows.
            float relief = clamp(slope * 7.0, -1.0, 1.0) * (0.35 + 0.65 * min(sunLow * 1.6, 1.0));

            vec3 toCamera = uCamLocal - vLocal;
            float distance = length(toCamera);
            vec3 view = toCamera / distance;
            bool below = length(uCamLocal) < uCloudRadius;
            // The game's worlds are smaller than the real ones, so a cloud on the horizon lies far
            // round the curve, past the terminator while the sun is still up overhead (17 degrees
            // of arc on this Earth; 1.5 on the real one). Seen from under the deck, a cloud is lit
            // mostly as the sky over the explorer is.
            float day = surfaceDay(below ? normalize(d + normalize(uCamLocal) * 4.0) : d);
            // Far off, low over the horizon, a cloud shows its sunlit side, not its grey base.
            float grazing = 1.0 - smoothstep(0.04, 0.3, abs(dot(view, d)));

            // Thick cloud is grey underneath; its top and thin edges take the sun. The sky lights
            // the shaded parts, but a cloud's own grey wins: only a hint of blue in the base.
            vec3 sunLit = uSunColor * 1.18;
            vec3 skyLit = mix(uHorizon, uZenith, 0.45) * 0.85 + vec3(0.08);
            skyLit = mix(vec3(dot(skyLit, vec3(0.3, 0.5, 0.2))), skyLit, 0.35);
            float thick = density * (0.55 + 0.45 * cov.g);
            vec3 color = below
                ? mix(sunLit * 0.95, skyLit * 0.52, smoothstep(0.12, 0.85, thick) * (1.0 - 0.65 * grazing))
                : sunLit * (0.86 + 0.18 * (1.0 - thick)) + skyLit * 0.08;
            // The heaps: the flank in shade takes sky light only, the flank facing the sun more sun.
            color = mix(color, skyLit * (below ? 0.5 : 0.75), clamp(relief, 0.0, 1.0) * 0.6 * (1.0 - 0.5 * grazing));
            color *= 1.0 + 0.22 * clamp(-relief, 0.0, 1.0);
            // Silver lining: light scattered forwards through the thin edges.
            float forward = pow(max(dot(-view, uSunDir), 0.0), 10.0);
            color += uSunColor * forward * (1.0 - thick) * 1.6;
            color *= 0.06 + 0.94 * day;
            // Storm cloud is dark underneath, lit from inside by its lightning.
            color *= 1.0 - 0.62 * uStorm;
            color += vec3(0.75, 0.78, 0.95) * uFlash * 0.9;
            color = applyHaze(color, vLocal, d);

            float alpha = density * 0.94 * uOpacity;
            // Flying through: thin out close to the camera instead of showing a flat sheet.
            alpha *= smoothstep(10.0, 110.0, distance);
            if (uNear > 0.0) alpha *= smoothstep(uNear * 0.6, uNear, distance);
            gl_FragColor = vec4(color, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const scenePosition = new THREE.Vector3();
const cameraLocal = new THREE.Vector3();
const coverTurn = new THREE.Matrix4();
const windTurn = new THREE.Matrix3();

const CloudDeck = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const biome = body.biome!;
    const radius = body.radius + biome.atmosphereHeight * 0.4;
    const size = runtime.quality === 2 ? 1024 : runtime.quality === 1 ? 768 : 384;

    // Draw the planet's cloud pattern into a cube map, once: one face a frame (all six in one
    // frame, at 1024 a face, was a stall on arrival), the deck hidden until the last is in.
    const bake = useMemo(() => {
        const cube = new THREE.WebGLCubeRenderTarget(size, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
        });
        const scene = new THREE.Scene();
        const sphereGeometry = new THREE.SphereGeometry(1, 48, 24);
        const material = coverageMaterial(body);
        scene.add(new THREE.Mesh(sphereGeometry, material));
        const camera = new THREE.CubeCamera(0.1, 10, cube);
        camera.updateMatrixWorld();
        return { cube, scene, camera, sphereGeometry, material, face: 0 };
    }, [body, size]);
    const target = bake.cube;
    useFrame(() => {
        if (bake.face >= 6) return;
        if (bake.camera.coordinateSystem !== gl.coordinateSystem) {
            bake.camera.coordinateSystem = gl.coordinateSystem;
            bake.camera.updateCoordinateSystem();
        }
        const faces = bake.camera.children as THREE.PerspectiveCamera[];
        const previous = gl.getRenderTarget();
        const autoClear = gl.autoClear;
        gl.autoClear = true;
        // Mipmaps once, after the last face.
        bake.cube.texture.generateMipmaps = bake.face === 5;
        gl.setRenderTarget(bake.cube, bake.face);
        gl.render(bake.scene, faces[bake.face]);
        gl.setRenderTarget(previous);
        gl.autoClear = autoClear;
        bake.face += 1;
        if (bake.face === 6) {
            bake.cube.texture.generateMipmaps = true;
            bake.sphereGeometry.dispose();
            bake.material.dispose();
        }
    }, -2);

    const meshRef = useRef<THREE.Mesh>(null);
    const deck = useMemo(() => {
        const geometry = new THREE.SphereGeometry(radius, 384, 192);
        // From space the deck is a smooth shell a few hundred pixels across: a tenth of the triangles.
        const far = new THREE.SphereGeometry(radius, 128, 64);
        const material = deckMaterial(body, radius, target.texture, runtime.quality);
        return { geometry, far, material };
    }, [body, radius, target, runtime.quality]);

    useEffect(() => () => {
        target.dispose();
        deck.geometry.dispose();
        deck.far.dispose();
        deck.material.dispose();
        if (bake.face < 6) {
            bake.sphereGeometry.dispose();
            bake.material.dispose();
        }
    }, [target, deck, bake]);
    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (group) directionToBody(runtime.motion, body, eyeDelta.copy(eye).sub(group.position), deck.material.uniforms.uCamLocal.value);
    }), [runtime, deck, body]);

    useFrame(({ camera, clock }) => {
        const group = groupRef.current;
        if (!group) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        placeBodyGroup(runtime.motion, body, group, scenePosition, camera.position, cameraLocal);
        const height = cameraLocal.length() - body.radius;
        // Seen from space the clouds are what the world looks like (Earth from the Moon is white
        // swirls on blue): kept until it is a small disc, 25 to 60 of its radii out. They used to
        // fade by a few radii and were gone as soon as it stopped being the world the ship was at.
        // (Not before its map is drawn.)
        const opacity = 1 - THREE.MathUtils.smoothstep(height, body.radius * 25, body.radius * 60);
        // (Not from under water: the water's surface hides the sky but for its window.)
        group.visible = opacity > 0.01 && bake.face >= 6 && runtime.underwater <= 0;
        const mesh = meshRef.current;
        if (mesh) mesh.geometry = height > body.radius * 0.6 ? deck.far : deck.geometry;
        deck.material.uniforms.uTime.value = clock.elapsedTime;
        deck.material.uniforms.uOpacity.value = opacity;
        // The cover, for the clouds with volume: from the game's frame into the world's, then the
        // wind's turn (the same as the deck's shader makes).
        if (bake.face >= 6) {
            const a = clock.elapsedTime * 0.00045;
            const shared = runtime.cloudCover?.body === body ? runtime.cloudCover : (runtime.cloudCover = { body, texture: target.texture, frame: new THREE.Matrix3(), near: 0 });
            coverTurn.makeRotationFromQuaternion(group.quaternion).transpose();
            windTurn.set(Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a));
            shared.frame.setFromMatrix4(coverTurn).premultiply(windTurn);
            deck.material.uniforms.uNear.value = shared.near;
        }
    }, -1);
    useEffect(() => () => { if (runtime.cloudCover?.body === body) runtime.cloudCover = null; }, [runtime, body]);

    return (
        <group ref={groupRef}>
            <mesh ref={meshRef} geometry={deck.geometry} material={deck.material} frustumCulled={false} renderOrder={3} />
        </group>
    );
};

const cloudy = (body: ExpeditionBody | null | undefined) => !!body && body.kind === 'rocky' && !!body.biome && body.biome.cloudCover > 0;
const CLOUDY = EXPEDITION_BODIES.filter(cloudy);

/** The cloud deck of the world the player is at, or else of the nearest cloudy world in sight. */
export const Clouds = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        let body: ExpeditionBody | null = cloudy(runtime.currentBody) ? runtime.currentBody : null;
        if (!body) {
            let best = Infinity;
            for (const world of CLOUDY) {
                const radii = runtime.camera.distanceTo(world.position) / world.radius;
                if (radii < 60 && radii < best) {
                    best = radii;
                    body = world;
                }
            }
        }
        const id = body ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <CloudDeck key={body.id} body={body} runtime={runtime} /> : null;
};
