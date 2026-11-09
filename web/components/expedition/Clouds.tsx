import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EXPEDITION_BODIES, findBody, type ExpeditionBody } from './bodies';
import { NOISE_GLSL } from './noise';
import { createSurfaceUniforms, SURFACE_SHADING_GLSL } from './surfaceShading';
import { watchView, type ExpeditionRuntime } from './runtime';
import { directionToBody, placeBodyGroup } from './motion';
import { globeFrame } from './sites';
import { loadMapTexture, MAP_WIDTH } from './mapLoader';
import { trackLoad } from './loadProgress';
import { CLOUD_SHADOW } from './cloudShadow';
import { DECK_SHARE, liftAt, SPACE_AIR_GLSL, spaceViewOf } from './earthSky';

const eyeDelta = new THREE.Vector3();

/**
 * A deck of cloud over each world with air, as in the reference video: flat,
 * torn patches of stratocumulus at one height, bright where the sun hits
 * them, grey and heavy underneath, silver at the thin edges when they are
 * backlit, and fading into the haze towards the horizon.
 *
 * The cloud pattern for the whole planet is drawn once into a cube map on the
 * GPU, so the deck itself costs one texture lookup and a little fine detail per
 * pixel. Earth's pattern is its real weather: a satellite map of its cloud cover
 * (globe.clouds), with fronts, spirals, the tropics' broken cumulus and the clear
 * belts between, soft and fibrous at every scale. Other worlds' is invented
 * (large weather systems, torn by warped noise). The pattern drifts slowly east
 * with the wind.
 *
 * Earth from above its weather (earthSky.ts): the deck settles towards the
 * ground as the camera climbs (so from orbit it lies inside the thin blue limb,
 * as clouds do), takes sunlight reddened by the air near the terminator, and is
 * veiled by the air above it rather than by the walker's haze. Its shadows fall
 * on the ground (cloudShadow.ts).
 */

const coverageMaterial = (body: ExpeditionBody, map: THREE.Texture | null) => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    defines: map ? { CLOUD_MAP: '' } : {},
    uniforms: {
        uSeed: { value: (body.biome!.seed + 7717) >>> 0 },
        uCover: { value: body.biome!.cloudCover },
        uMap: { value: map },
        uFrame: { value: globeFrame(body) },
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
        uniform sampler2D uMap;
        uniform mat3 uFrame;
        varying vec3 vDir;
        void main() {
            vec3 d = normalize(vDir);
            #ifdef CLOUD_MAP
            // The photograph, in the same projection as the world's map (PlanetTerrain's globe).
            vec3 g = uFrame * d;
            vec2 uv = vec2(atan(g.z, g.x) / 6.2831853 + 0.5, asin(clamp(g.y, -1.0, 1.0)) / 3.14159265 + 0.5);
            float m = textureLod(uMap, uv, 0.0).r;
            gl_FragColor = vec4(m, m, 0.5, 1.0);
            #else
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
            #endif
        }`,
});

const deckMaterial = (body: ExpeditionBody, radius: number, coverage: THREE.Texture, detail: number, map: boolean) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: {
        ...(map ? { CLOUD_MAP: '' } : {}),
        ...(body.biome?.space ? { CLOUD_SPACE: '' } : {}),
    },
    uniforms: {
        ...createSurfaceUniforms(body),
        ...(body.biome?.space ? spaceViewOf(body) : {}),
        uCoverage: { value: coverage },
        uCloudRadius: { value: radius },
        uShrink: { value: 1 },
        uWind: { value: new THREE.Matrix3() },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uDetail: { value: detail },
        uNear: { value: 0 },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uShrink;
        varying vec3 vLocal;
        void main() {
            // (Settled towards the ground from far off: earthSky.ts.)
            vec3 p = position * uShrink;
            vLocal = p;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        ${SURFACE_SHADING_GLSL}
        #ifdef CLOUD_SPACE
        ${SPACE_AIR_GLSL}
        #endif
        uniform samplerCube uCoverage;
        uniform float uCloudRadius;
        // The wind's drift: from the world's frame into the cover map's.
        uniform mat3 uWind;
        uniform float uTime;
        uniform float uOpacity;
        uniform float uDetail;
        // Inside this distance the clouds are drawn with volume (cloudScenes.ts): the deck gives way.
        uniform float uNear;
        varying vec3 vLocal;

        void main() {
            #include <logdepthbuf_fragment>
            vec3 d = normalize(vLocal);
            vec3 w = uWind * d;
            vec4 cov = textureCube(uCoverage, w);
            // Fine billows that tear the edges; only where the camera can see them.
            float fine = 0.0;
            // (From space they are far smaller than a pixel: not worked out there.)
            bool close = length(uCamLocal - vLocal) < 25000.0;
            if (uDetail > 0.5 && close) {
                fine = gnoise(w * 700.0, 71u) * 0.55 + gnoise(w * 2100.0, 73u) * 0.3;
                if (uDetail > 1.5) fine += gnoise(w * 6000.0, 79u) * 0.15;
            }
            #ifdef CLOUD_MAP
            // The photographed cover: how bright a cloud is from above is how much light it throws back,
            // so it is also how opaque it is over the dark sea (the photograph's values are gamma-encoded:
            // nearer the square of them in light). Thin veils stay thin; the billows (close up) tear the
            // edges and open holes in the thin parts, not in the thick.
            float m = cov.r;
            float density = pow(clamp((m - 0.05) / 0.72, 0.0, 1.0), 1.6);
            density = clamp(density + fine * 0.5 * (1.0 - density * 0.6) * smoothstep(0.02, 0.2, density), 0.0, 1.0);
            // A storm fills the sky in.
            density += (1.0 - density) * uStorm * 0.85;
            #else
            // A storm fills the sky in.
            // (Fair-weather cumulus have crisp edges: a narrower ramp than a storm's grey murk.)
            float density = smoothstep(0.12 - uStorm * 0.54, 0.46 - uStorm * 0.24, cov.r + fine * 0.28 * (1.0 - cov.r * 0.6));
            #endif
            if (density < 0.012) discard;

            // Volume from a sheet: a step towards the sun across the pattern. Where the cloud is
            // thicker that way this spot lies in its shade (the heap's far side); where thinner,
            // it faces the sun (its lit flank). One more lookup reads as rounded heaps instead
            // of paper cut-outs. (On Medium and High, the billows get it too.)
            vec3 sunAcross = uSunDir - d * dot(uSunDir, d);
            float sunLow = length(sunAcross);
            vec3 towardsSun = sunAcross / max(sunLow, 1e-4);
            float covSun = textureCube(uCoverage, uWind * normalize(d + towardsSun * 0.006)).r;
            float slope = covSun - cov.r;
            if (uDetail > 0.5 && close) {
                vec3 ws = uWind * normalize(d + towardsSun * 0.0009);
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
            #ifdef CLOUD_MAP
            float thick = density * (0.45 + 0.55 * m);
            // From above, thick cloud throws back more light than thin.
            vec3 topLit = sunLit * (0.8 + 0.24 * smoothstep(0.2, 0.9, m));
            #else
            float thick = density * (0.55 + 0.45 * cov.g);
            vec3 topLit = sunLit * (0.86 + 0.18 * (1.0 - thick)) + skyLit * 0.08;
            #endif
            vec3 color = below
                ? mix(sunLit * 0.95, skyLit * 0.52, smoothstep(0.12, 0.85, thick) * (1.0 - 0.65 * grazing))
                : topLit;
            // The heaps: the flank in shade takes sky light only, the flank facing the sun more sun.
            color = mix(color, skyLit * (below ? 0.5 : 0.75), clamp(relief, 0.0, 1.0) * 0.6 * (1.0 - 0.5 * grazing));
            color *= 1.0 + 0.22 * clamp(-relief, 0.0, 1.0);
            // Silver lining: light scattered forwards through the thin edges.
            float forward = pow(max(dot(-view, uSunDir), 0.0), 10.0);
            color += uSunColor * forward * (1.0 - thick) * 1.6;
            // Storm cloud is dark underneath, lit from inside by its lightning.
            color *= 1.0 - 0.62 * uStorm;
            vec3 base = color;
            color = color * (0.06 + 0.94 * day) + vec3(0.75, 0.78, 0.95) * uFlash * 0.9;
            color = applyHaze(color, vLocal, d);
            #ifdef CLOUD_SPACE
            // From above the weather: lit by sunlight that has come through the air (reddened, then
            // cut off, at the terminator), seen through the air above the cloud.
            if (uSpaceShare > 0.0 && !below) {
                vec3 through;
                vec3 sun = spaceSunlight(length(vLocal), d);
                vec3 veil = spaceVeil(vLocal, -view, through);
                vec3 space = (base * sun + skyLit * 0.015) * through + veil;
                color = mix(color, space, uSpaceShare);
            }
            #endif

            #ifdef CLOUD_MAP
            float alpha = density * 0.97 * uOpacity;
            #else
            float alpha = density * 0.94 * uOpacity;
            #endif
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
const frameTurn = new THREE.Matrix3();
const frameBack = new THREE.Matrix3();

/** Development only: `?still` holds the clouds where they are, so renders compare. */
const STILL = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('still');
/** How fast the weather drifts east (radians a second: once round in about four hours). */
const DRIFT = 0.00045;

/** The wind's turn after `seconds`: from the world's frame into the cover map's (about the map's own pole). */
const windAfter = (seconds: number, frame: THREE.Matrix3 | null, out: THREE.Matrix3) => {
    const a = STILL ? 0 : seconds * DRIFT;
    // About the map's pole, eastwards: into the frame (rows: longitude 0, north, east), turned, back again.
    // (An invented pattern turns about the world's own y, as it always has.)
    const s = frame ? Math.sin(a) : -Math.sin(a);
    out.set(Math.cos(a), 0, s, 0, 1, 0, -s, 0, Math.cos(a));
    if (frame) out.multiply(frameTurn.copy(frame)).premultiply(frameBack.copy(frame).transpose());
    return out;
};

const CloudDeck = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const biome = body.biome!;
    const deckHeight = biome.atmosphereHeight * DECK_SHARE;
    const radius = body.radius + deckHeight;
    const mapPath = body.globe?.clouds;
    const size = mapPath
        // The photograph has detail to keep: a texel about one of its own (20 m on Earth) on High.
        ? (runtime.quality === 0 ? 512 : 1024)
        : runtime.quality === 2 ? 1024 : runtime.quality === 1 ? 768 : 384;

    // The photographed cover, decoded in the background; drawn into the cube map, then let go.
    const [map, setMap] = useState<{ texture: THREE.Texture | null; failed: boolean }>({ texture: null, failed: !mapPath });
    useEffect(() => {
        if (!mapPath) return undefined;
        let alive = true;
        let loaded: THREE.Texture | null = null;
        trackLoad(loadMapTexture(`${import.meta.env.BASE_URL}${mapPath}`, MAP_WIDTH[runtime.quality])).then((texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.generateMipmaps = false;
            texture.minFilter = THREE.LinearFilter;
            loaded = texture;
            if (alive) setMap({ texture, failed: false });
            else texture.dispose();
        }).catch((error) => {
            console.warn('The cloud map could not be loaded; the clouds are invented.', error);
            if (alive) setMap({ texture: null, failed: true });
        });
        return () => { alive = false; loaded?.dispose(); };
    }, [mapPath, runtime.quality]);
    const useMap = !!map.texture;
    const ready = useMap || map.failed;

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
        const material = coverageMaterial(body, map.texture);
        scene.add(new THREE.Mesh(sphereGeometry, material));
        const camera = new THREE.CubeCamera(0.1, 10, cube);
        camera.updateMatrixWorld();
        return { cube, scene, camera, sphereGeometry, material, face: 0 };
    }, [body, size, map.texture]);
    const target = bake.cube;
    useFrame(() => {
        if (bake.face >= 6 || !ready) return;
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
            // The photograph is in the cube now: its own copy is not needed on the graphics card.
            map.texture?.dispose();
        }
    }, -2);

    const meshRef = useRef<THREE.Mesh>(null);
    const deck = useMemo(() => {
        const geometry = new THREE.SphereGeometry(radius, 384, 192);
        // From space the deck is a smooth shell a few hundred pixels across: a tenth of the triangles.
        const far = new THREE.SphereGeometry(radius, 128, 64);
        const material = deckMaterial(body, radius, target.texture, runtime.quality, useMap);
        return { geometry, far, material };
    }, [body, radius, target, runtime.quality, useMap]);

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
    const frame = useMemo(() => (useMap ? globeFrame(body) : null), [body, useMap]);

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
        const uniforms = deck.material.uniforms;
        uniforms.uTime.value = clock.elapsedTime;
        uniforms.uOpacity.value = opacity;
        // From above its weather Earth's deck settles towards the ground (earthSky.ts).
        const lifted = biome.space ? deckHeight * liftAt(height) : deckHeight;
        uniforms.uShrink.value = (body.radius + lifted) / radius;
        uniforms.uCloudRadius.value = body.radius + lifted;
        windAfter(clock.elapsedTime, frame, uniforms.uWind.value as THREE.Matrix3);
        // The cover, for the clouds with volume: from the game's frame into the world's, then the
        // wind's turn (the same as the deck's shader makes).
        if (bake.face >= 6) {
            const shared = runtime.cloudCover?.body === body ? runtime.cloudCover : (runtime.cloudCover = { body, texture: target.texture, frame: new THREE.Matrix3(), near: 0 });
            coverTurn.makeRotationFromQuaternion(group.quaternion).transpose();
            windTurn.copy(uniforms.uWind.value as THREE.Matrix3);
            shared.frame.setFromMatrix4(coverTurn).premultiply(windTurn);
            uniforms.uNear.value = shared.near;
            // Its shadows on the ground (Earth's ground draws them: PlanetTerrain.tsx).
            if (useMap) {
                CLOUD_SHADOW.uCloudShadowMap.value = target.texture;
                CLOUD_SHADOW.uCloudShadowTurn.value.copy(windTurn);
                CLOUD_SHADOW.uCloudShadowHeight.value = lifted;
                CLOUD_SHADOW.uCloudShadowStrength.value = group.visible ? opacity : 0;
            }
        }
    }, -1);
    useEffect(() => () => { if (runtime.cloudCover?.body === body) runtime.cloudCover = null; }, [runtime, body]);
    useEffect(() => () => {
        if (CLOUD_SHADOW.uCloudShadowMap.value === target.texture) {
            CLOUD_SHADOW.uCloudShadowMap.value = null;
            CLOUD_SHADOW.uCloudShadowStrength.value = 0;
        }
    }, [target]);

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
