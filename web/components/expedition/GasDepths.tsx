import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { TEXTURE_NOISE_GLSL, textureNoiseUniforms } from './noiseTexture';
import { SKY_COVER } from './SpaceBackdrop';
import { findBody, type ExpeditionBody } from './bodies';
import { fromEquatorial } from './orbits';
import { cue, watchView, type ExpeditionRuntime } from './runtime';
import { createZoneLook, gasModel, lightAt, seenLight, zoneAt, type GasModel } from './gasAtmosphere';
import { vortexAt } from './vortices';
import { gasMapTexture } from './gasMaps';
import { createBoltGeometry, createBoltMaterial, makeBolt, writeBolt } from './bolts';
import { compileSafely } from './compileSafely';

/**
 * Inside a gas giant (gasAtmosphere.ts): the sky turning from black to the
 * planet's own colour as the ship comes down through the haze, the cloud
 * decks as layers to fly between and through, fog inside them, the light
 * failing with depth, and lightning flickering in the water clouds below.
 */
export const GasDepths = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        let id: string | null = null;
        // Built well before the ship reaches the cloud tops, on the way in,
        // so its shaders are compiled in the background before they are needed
        // (compiling them as the ship dives in froze the game for seconds).
        if (body && body.kind === 'gas' && runtime.altitude < Math.max(gasModel(body).ceiling * 1.6, body.radius * 0.6)) id = body.id;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
            if (!id) runtime.gas = null;
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <Depths key={body.id} body={body} model={gasModel(body)} runtime={runtime} /> : null;
};

const DECK_GLSL = /* glsl */ `
vec3 rotateAbout(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}
`;

const deckVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const deckFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${DECK_GLSL}
uniform vec3 uCamLocal;
uniform vec3 uSunDir;
uniform vec3 uAxis;
uniform float uDeckRadius;
uniform vec3 uLit;
uniform vec3 uUnder;
uniform float uLightTop;
uniform float uLightBottom;
uniform float uTime;
uniform uint uSeed;
uniform float uCover;
uniform sampler2D uMap;
uniform float uUseMap;
uniform vec3 uFlashPos;
uniform float uFlash;
uniform vec3 uFog;
uniform float uVisibility;
uniform float uOpacity;
${TEXTURE_NOISE_GLSL}
varying vec3 vLocal;

void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vLocal);
    float lat = dot(n, uAxis);
    float footprint = length(fwidth(vLocal));
    // The jets carry the deck round, faster or slower band by band.
    float jet = sin(lat * 19.0) * 0.65 + sin(lat * 7.3 + 1.3) * 0.35;
    vec3 Q = rotateAbout(n * uDeckRadius, uAxis, uTime * jet * 0.0004);
    Q += uAxis * dot(Q, uAxis) * 1.8;
    // Noise read from a tiling volume (16 lattice cells across): one lookup an
    // octave instead of eight hashes, the same kind of noise as gnoise.
    vec3 seedShift = vec3(float(uSeed % 97u), float(uSeed % 89u), float(uSeed % 83u)) * 5.92;
    vec3 q = Q / 7000.0 + seedShift;
    float big = tnoise4(q).r;
    big += tnoise4(q * 2.0).g * 0.5;
    big += tnoise4(q * 4.0).b * 0.25;
    float fine = 0.0;
    float norm = 0.0;
    float wavelength = 1400.0;
    for (int k = 0; k < DECK_FINE; k++) {
        float w = smoothstep(1.5 * footprint, 4.0 * footprint, wavelength);
        if (w <= 0.0) break;
        fine += tnoise4(Q / wavelength + seedShift + float(k) * 3.7).a * w;
        norm += 1.0;
        wavelength *= 0.5;
    }
    fine = norm > 0.0 ? fine / norm : 0.0;
    float bias = 0.0;
    vec3 mapTint = vec3(-1.0);
    if (uUseMap > 0.5) {
        // The top deck is what is seen from space: thick over the bright zones, torn over the dark belts.
        vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
        vec3 e2 = cross(uAxis, e1);
        vec2 uv = vec2(atan(dot(n, e2), dot(n, e1)) / 6.2831853 + 0.5, asin(clamp(lat, -1.0, 1.0)) / 3.14159265 + 0.5);
        vec3 underneath = textureLod(uMap, uv, 3.0).rgb;
        float zone = dot(underneath, vec3(0.333));
        bias = (zone - 0.55) * 1.6;
        // Seen from above, the high puffs are the colour of the clouds under them, only brighter.
        mapTint = mix(vec3(zone), underneath, 0.7) * 1.18;
    }
    float cover = smoothstep(0.0, 0.42, big * 0.9 + fine * 0.45 + bias + uCover);
    if (cover < 0.01) discard;

    vec3 toCamera = uCamLocal - vLocal;
    float distance = length(toCamera);
    bool below = length(uCamLocal) < uDeckRadius;
    float day = smoothstep(-0.15, 0.3, dot(n, uSunDir));
    vec3 col = below ? uUnder * uLightBottom : (mapTint.x >= 0.0 ? mix(uLit, mapTint, 0.75) : uLit) * uLightTop;
    col *= 0.05 + 0.95 * day;
    // Thick cloud is darker in its folds.
    col *= 0.82 + 0.3 * fine;
    // Lightning, lighting the deck from inside.
    float flashDistance = length(vLocal - uFlashPos);
    col += vec3(0.78, 0.84, 1.0) * uFlash * exp(-flashDistance / 2200.0) * 2.4;
    // Seen through the murk between: the deck fades into the haze with distance.
    float seen = exp(-distance / uVisibility);
    col = mix(uFog, col, seen);
    float alpha = cover * uOpacity * smoothstep(25.0, 180.0, distance) * mix(0.55, 1.0, seen);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// The sky dome is a real sphere round the camera (SKY_RADIUS), not a backdrop
// at the far plane. It is drawn first of the see-through things, so the ship's
// exhaust and the cloud decks near the camera are drawn over it; and once the
// air is thick enough to hide the sky it also writes its depth, so the rings,
// moons and stars beyond it are hidden instead of showing through the murk.
const skyVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const SKY_RADIUS = 29000;

const skyFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uUp;
uniform vec3 uSunDir;
uniform vec3 uHigh;
uniform vec3 uDeep;
uniform float uLight;
uniform float uDay;
uniform float uAlpha;
uniform float uFlash;
uniform float uGlow;
varying vec3 vDir;
void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    float up = dot(d, uUp);
    // The sky overhead in what sunlight is left; below, the glow coming up
    // from the depths (deep down, the planet's own heat), day or night.
    float below = 1.0 - smoothstep(-0.45, 0.75, up);
    vec3 col = uHigh * (1.0 - below) * (0.08 + 0.92 * uLight) * (0.06 + 0.94 * uDay)
        + uDeep * below * max((0.08 + 0.92 * uLight) * (0.06 + 0.94 * uDay), uGlow);
    float sun = max(dot(d, uSunDir), 0.0);
    col += vec3(1.0, 0.94, 0.82) * (pow(sun, 10.0) * 0.55 + pow(sun, 120.0) * 1.5) * uLight * uDay;
    col += vec3(0.6, 0.7, 1.0) * uFlash * 0.18 * (0.6 - 0.4 * up);
    gl_FragColor = vec4(col, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const fogFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
void main() {
    gl_FragColor = vec4(uColor, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const scenePosition = new THREE.Vector3();
const cameraLocal = new THREE.Vector3();
const up = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tangentA = new THREE.Vector3();
const tangentB = new THREE.Vector3();
const facing = new THREE.Vector3();

interface Flash { position: THREE.Vector3; age: number; strength: number; distance: number; hit: boolean }

const Depths = ({ body, model, runtime }: { body: ExpeditionBody; model: GasModel; runtime: ExpeditionRuntime }) => {
    const gas = body.gas!;
    const axis = useMemo(() => fromEquatorial(gas.pole[0], gas.pole[1]), [gas]);
    const groupRef = useRef<THREE.Group>(null);
    const skyRef = useRef<THREE.Mesh>(null);
    const fogRef = useRef<THREE.Mesh>(null);
    const deckRefs = useRef<(THREE.Mesh | null)[]>([]);
    const insideRefs = useRef<(THREE.Mesh | null)[]>([]);
    const rootRef = useRef<THREE.Group>(null);

    const map = useMemo(() => (gas.map ? gasMapTexture(gas.map) : null), [gas]);

    const decks = useMemo(() => model.decks.map((deck, i) => {
        const radius = body.radius + deck.top - deck.thickness * 0.5;
        // Only drawn at low detail (above it the volume takes over): a lighter
        // sphere, and fewer layers of noise, far from the camera none are seen.
        const geometry = new THREE.SphereGeometry(radius, 192, 96);
        // One side of the shell is ever seen: its inside from below, its outside
        // from above. Two materials (sharing everything) so each is drawn once,
        // the other side culled: a two-sided see-through shell is drawn twice.
        const uniforms = {
                uCamLocal: { value: new THREE.Vector3() },
                uSunDir: { value: body.sunDirection },
                uAxis: { value: axis },
                uDeckRadius: { value: radius },
                uLit: { value: new THREE.Color(deck.lit) },
                uUnder: { value: new THREE.Color(deck.under) },
                uLightTop: { value: lightAt(model, deck.top + 1) },
                uLightBottom: { value: lightAt(model, deck.top - deck.thickness) },
                uTime: { value: 0 },
                uSeed: { value: (4211 + i * 977) >>> 0 },
                uCover: { value: i === 0 ? -0.12 : 0.25 },
                uMap: { value: map },
                uUseMap: { value: i === 0 && map ? 1 : 0 },
                uFlashPos: { value: new THREE.Vector3(0, 0, 1e9) },
                uFlash: { value: 0 },
                uFog: { value: new THREE.Color(model.skyDeep) },
                uVisibility: { value: 9000 },
                uOpacity: { value: 1 },
                ...textureNoiseUniforms(),
        };
        const make = (side: THREE.Side) => new THREE.ShaderMaterial({
            vertexShader: deckVertex,
            fragmentShader: deckFragment,
            transparent: true,
            depthWrite: false,
            side,
            defines: { DECK_FINE: 4 },
            uniforms,
        });
        const material = make(THREE.FrontSide);
        const inside = make(THREE.BackSide);
        return { deck, radius, geometry, material, inside };
    }), [body, model, axis, map]);

    const sky = useMemo(() => ({
        geometry: new THREE.SphereGeometry(1, 48, 32),
        material: new THREE.ShaderMaterial({
            vertexShader: skyVertex,
            fragmentShader: skyFragment,
            side: THREE.BackSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uUp: { value: new THREE.Vector3(0, 1, 0) },
                uSunDir: { value: body.sunDirection },
                uHigh: { value: new THREE.Color(model.skyHigh) },
                uDeep: { value: new THREE.Color(model.skyDeep) },
                uLight: { value: 1 },
                uDay: { value: 1 },
                uAlpha: { value: 0 },
                uFlash: { value: 0 },
                uGlow: { value: 0 },
            },
        }),
    }), [body, model]);

    const fog = useMemo(() => ({
        geometry: new THREE.PlaneGeometry(2, 2),
        material: new THREE.ShaderMaterial({
            vertexShader: /* glsl */ `
                #include <common>
                #include <logdepthbuf_pars_vertex>
                void main() {
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    #include <logdepthbuf_vertex>
                }`,
            fragmentShader: /* glsl */ `
                #include <common>
                #include <logdepthbuf_pars_fragment>
                ${fogFragment.replace('void main() {', 'void main() {\n    #include <logdepthbuf_fragment>')}`,
            transparent: true,
            depthWrite: false,
            uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } },
        }),
    }), []);

    useEffect(() => () => {
        SKY_COVER.value = 0;
        decks.forEach((d) => { d.geometry.dispose(); d.material.dispose(); d.inside.dispose(); });
        sky.geometry.dispose();
        sky.material.dispose();
        fog.geometry.dispose();
        fog.material.dispose();
    }, [decks, sky, fog]);

    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (!group) return;
        decks.forEach((d) => d.material.uniforms.uCamLocal.value.copy(eye).sub(group.position));
    }), [runtime, decks]);

    // The bolt of the latest stroke, drawn while it flickers.
    const bolt = useMemo(() => ({ geometry: createBoltGeometry(), material: createBoltMaterial() }), []);
    useEffect(() => () => { bolt.geometry.dispose(); bolt.material.dispose(); }, [bolt]);
    const boltRef = useRef<THREE.Mesh>(null);
    const { gl } = useThree();
    const flash = useRef<Flash | null>(null);
    const strike = useRef(false);
    const nextFlash = useRef((model.lightning?.[0] ?? 2) * (0.6 + Math.random()));
    const thunders = useRef<{ at: number; volume: number }[]>([]);
    const fogColor = useMemo(() => new THREE.Color(), []);
    const look = useMemo(createZoneLook, []);
    // Compile everything here in the background (where the browser can) as soon as it exists.
    const { camera: viewCamera, scene: mainScene } = useThree();
    // (Compiling skips what is hidden, and nearly all of it starts hidden: shown
    // just for the call, which gathers the materials before it returns.)
    useEffect(() => {
        const root = rootRef.current;
        if (!root || !gl.extensions.get('KHR_parallel_shader_compile')) return;
        const hidden: THREE.Object3D[] = [];
        root.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
        compileSafely(gl, root, viewCamera, mainScene);
        hidden.forEach((o) => { o.visible = false; });
    }, [gl, viewCamera, mainScene]);

    useFrame(({ camera, clock }, delta) => {
        const dt = Math.min(delta, 0.1);
        const group = groupRef.current;
        if (!group) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        group.position.copy(scenePosition);
        cameraLocal.copy(camera.position).sub(scenePosition);
        const radius = cameraLocal.length();
        const height = radius - body.radius;
        // Still on the way in: nothing to draw yet.
        const active = height < model.ceiling * 1.6;
        const root = rootRef.current;
        if (root) root.visible = active;
        if (!active) {
            if (runtime.gas?.body === body) runtime.gas = null;
            SKY_COVER.value = 0;
            return;
        }
        up.copy(cameraLocal).divideScalar(radius);
        const air = THREE.MathUtils.clamp(1 - height / model.ceiling, 0, 1);
        const light = lightAt(model, height);
        const day = THREE.MathUtils.smoothstep(up.dot(body.sunDirection), -0.2, 0.25);

        // Lightning, now and then, somewhere in the storm deck within a few kilometres.
        const storm = model.decks.find((d) => d.storms);
        let flashLevel = 0;
        const cadence = model.lightning;
        if (storm && cadence && height < model.ceiling) {
            // DEV: window.__strike sets off a stroke now; window.__boltHold freezes it at its brightest.
            const debug = window as unknown as { __strike?: boolean; __boltHold?: boolean };
            let forced = false;
            if (import.meta.env.DEV && debug.__strike) {
                debug.__strike = false;
                nextFlash.current = 0;
                forced = true;
            } else if (!(import.meta.env.DEV && debug.__boltHold)) {
                nextFlash.current -= dt;
            }
            if (nextFlash.current <= 0) {
                // Jupiter flashes every few seconds; Saturn's storms less often; on
                // Uranus and Neptune, lightning has only ever been heard on the radio.
                nextFlash.current = cadence[0] + Math.random() * (cadence[1] - cadence[0]) * (height < storm.top + 2500 ? 0.6 : 1);
                // Juno found most of Jupiter's lightning up by the poles, in and
                // round the polar cyclones: flying in one, it flashes far oftener.
                const cyclone = vortexAt(body, cameraLocal);
                if (cyclone && cyclone.vortex.kind === 'spiral') nextFlash.current *= 0.35;
                tangentA.set(0, 1, 0).cross(up);
                if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0);
                tangentA.normalize();
                tangentB.crossVectors(up, tangentA);
                // Most strokes are deep in the water clouds; some, as Juno found,
                // much higher, in clouds of ammonia and water ("shallow
                // lightning"). More than half come close enough to see the bolt.
                const reach = forced ? 1500 + Math.random() * 700 : Math.random() < 0.6 ? 900 + Math.random() * 3200 : 1500 + Math.random() * 12000;
                // Strokes happen all round; most of those that are drawn are
                // the ones in front of the camera (the rest only light the cloud).
                camera.getWorldDirection(facing).addScaledVector(up, -facing.dot(up));
                const ahead = facing.lengthSq() > 1e-6 ? Math.atan2(facing.dot(tangentB), facing.dot(tangentA)) : 0;
                const angle = forced
                    ? ahead + THREE.MathUtils.degToRad(30) * (Math.random() - 0.5)
                    : Math.random() < 0.65 ? ahead + THREE.MathUtils.degToRad(110) * (Math.random() - 0.5) : Math.random() * Math.PI * 2;
                const above = model.decks[model.decks.indexOf(storm) - 1];
                // Where the stroke runs: inside the water deck (hidden, the cloud
                // glows); arcing over its tops in the clear air above them; or
                // higher, in the ammonia and water clouds.
                const where = forced ? 0.5 : Math.random();
                const shallow = !!above && where >= 0.75;
                const overTops = where >= 0.35 && where < 0.75;
                const strokeHeight = shallow && above
                    ? THREE.MathUtils.lerp(storm.top, above.top - above.thickness, 0.3 + Math.random() * 0.6)
                    : overTops
                        ? storm.top + 150 + Math.random() * 750
                        : storm.top - storm.thickness * (0.3 + Math.random() * 0.5);
                let position = tmp.copy(up).multiplyScalar(body.radius)
                    .addScaledVector(tangentA, Math.cos(angle) * reach)
                    .addScaledVector(tangentB, Math.sin(angle) * reach)
                    .normalize()
                    .multiplyScalar(body.radius + strokeHeight)
                    .clone();
                // Flying through the storm deck itself, now and then a stroke finds the ship.
                const ship = runtime.hud.ship;
                const shipLocal = ship && runtime.mode === 'ship' ? ship.position.clone().sub(body.position) : null;
                const shipHeight = shipLocal ? shipLocal.length() - body.radius : Infinity;
                const hit = !!shipLocal && shipHeight < storm.top + 300 && shipHeight > storm.top - storm.thickness - 300 && Math.random() < 0.16;
                if (hit && shipLocal) position = shipLocal.addScaledVector(up, 40);
                const distance = position.distanceTo(cameraLocal);
                flash.current = { position, age: 0, strength: hit ? 1.4 : 0.6 + Math.random() * 0.8, distance, hit };
                strike.current = hit;
                // The channel itself: from cloud to cloud, mostly down and across,
                // a kilometre or two long; or to the ship.
                if (distance < 12000) {
                    const strokeUp = tmp.copy(position).normalize().clone();
                    const across = tangentA.clone().multiplyScalar(Math.random() - 0.5).addScaledVector(tangentB, Math.random() - 0.5);
                    const length = 900 + Math.random() * 1500;
                    // Over the cloud tops a stroke runs mostly level, cloud to cloud.
                    const rise = overTops ? 0.12 : 0.35 + Math.random() * 0.25;
                    const from = position.clone().addScaledVector(strokeUp, length * rise);
                    const to = hit ? position.clone() : position.clone().addScaledVector(strokeUp, -length * (overTops ? 0.15 : 0.6)).addScaledVector(across, length * (overTops ? 1.8 : 0.9));
                    writeBolt(bolt.geometry, makeBolt(from, to));
                    if (boltRef.current) boltRef.current.visible = true;
                }
                // Thunder arrives later: sound travels about a kilometre a second in hydrogen.
                thunders.current.push({ at: clock.elapsedTime + distance / 1000, volume: THREE.MathUtils.clamp(1.4 - distance / 9000, 0.15, 1.2) });
            }
            const f = flash.current;
            if (f) {
                if (!(import.meta.env.DEV && (window as unknown as { __boltHold?: boolean }).__boltHold)) f.age += dt;
                // A bright stroke, a flicker, a fading glow.
                flashLevel = f.strength * (f.age < 0.08 ? 1 : f.age < 0.16 ? 0.25 : f.age < 0.24 ? 0.8 : Math.max(0, 1 - (f.age - 0.24) / 0.5) * 0.4);
                if (f.age > 0.8) flash.current = null;
            }
        }
        // The bolt burns while the stroke does.
        const boltMesh = boltRef.current;
        if (boltMesh) {
            bolt.material.uniforms.uLevel.value = flashLevel;
            gl.getDrawingBufferSize(bolt.material.uniforms.uViewport.value);
            if (!flash.current || flashLevel <= 0.001) boltMesh.visible = false;
        }
        while (thunders.current.length && thunders.current[0].at <= clock.elapsedTime) {
            const t = thunders.current.shift()!;
            cue(runtime, 'thunder', t.volume);
        }

        // The sky closes in over the ship as it comes down.
        const skyMesh = skyRef.current;
        if (skyMesh) {
            skyMesh.position.copy(camera.position);
            skyMesh.scale.setScalar(SKY_RADIUS);
            const u = sky.material.uniforms;
            zoneAt(model, height, look);
            u.uHigh.value.copy(look.sky);
            u.uDeep.value.copy(look.glow);
            u.uGlow.value = 0.32 * THREE.MathUtils.smoothstep(-height, 2000, 11000);
            u.uUp.value.copy(up);
            u.uLight.value = seenLight(light);
            u.uDay.value = day;
            u.uAlpha.value = THREE.MathUtils.smoothstep(air, 0.0, 0.85);
            u.uFlash.value = flashLevel * THREE.MathUtils.clamp(1 - Math.abs(height - (storm?.top ?? 0)) / 9000, 0, 1);
            skyMesh.visible = u.uAlpha.value > 0.003;
            sky.material.depthWrite = u.uAlpha.value > 0.98;
            SKY_COVER.value = u.uAlpha.value;
        }

        // Decks: drawn far to near, so the ones the camera is between layer properly.
        zoneAt(model, height, look);
        const visibility = look.visibility * 0.5;
        fogColor.copy(look.haze).multiplyScalar(seenLight(0.12 + 0.88 * light) * (0.05 + 0.95 * day));
        const order = decks.map((d, i) => ({ i, gap: Math.abs(radius - d.radius) })).sort((a, b) => b.gap - a.gap);
        order.forEach(({ i }, k) => {
            const mesh = deckRefs.current[i];
            if (mesh) mesh.renderOrder = 4 + k;
            const inside = insideRefs.current[i];
            if (inside) inside.renderOrder = 4 + k;
        });
        decks.forEach((d) => {
            const u = d.material.uniforms;
            u.uTime.value = clock.elapsedTime;
            u.uFlash.value = flashLevel;
            if (flash.current) u.uFlashPos.value.copy(flash.current.position);
            u.uVisibility.value = visibility;
            u.uFog.value.copy(fogColor);
            // From high above, the cloud tops are the planet's own map: the decks
            // ease in only once the ship is down among them.
            u.uOpacity.value = 1 - THREE.MathUtils.smoothstep(height, model.decks[0].top, model.decks[0].top + 2200);
        });
        // With volumetric clouds (quality 1 and up) the shells and the fog sheet stand down.
        const shells = runtime.quality === 0;
        const showDecks = shells && decks[0].material.uniforms.uOpacity.value > 0.002;
        decks.forEach((d, i) => {
            const below = radius < d.radius;
            const outer = deckRefs.current[i];
            const inner = insideRefs.current[i];
            if (outer) outer.visible = showDecks && !below;
            if (inner) inner.visible = showDecks && below;
        });

        // Inside a deck: the world goes grey-white (or brown) around the ship.
        const fogMesh = fogRef.current;
        if (fogMesh) {
            let inside = 0;
            let deckColour: THREE.Color | null = null;
            for (const d of decks) {
                const top = body.radius + d.deck.top;
                const bottom = top - d.deck.thickness;
                const depthIn = Math.min(radius - bottom, top - radius);
                if (depthIn > -120) {
                    const amount = THREE.MathUtils.clamp((depthIn + 120) / 350, 0, 1);
                    if (amount > inside) {
                        inside = amount;
                        deckColour = new THREE.Color(radius > d.radius ? d.deck.lit : d.deck.under);
                    }
                }
            }
            const u = fog.material.uniforms;
            if (deckColour) u.uColor.value.copy(deckColour).multiplyScalar((0.12 + 0.88 * light) * (0.05 + 0.95 * day)).lerp(new THREE.Color(0.78, 0.84, 1.0), Math.min(1, flashLevel * 0.6));
            u.uAlpha.value = inside * 0.82;
            fogMesh.visible = runtime.quality === 0 && inside > 0.01;
            // A sheet just beyond the ship, facing the camera: what is beyond it is in the cloud, the ship is not.
            fogMesh.position.copy(camera.position);
            fogMesh.quaternion.copy(camera.quaternion);
            fogMesh.translateZ(-60);
            const persp = camera as THREE.PerspectiveCamera;
            const halfHeight = Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 60) / 2) * 60 * 1.2;
            fogMesh.scale.set(halfHeight * (persp.aspect ?? 1.8), halfHeight, 1);
        }

        // The first time below the cloud tops: what kind of world this is.
        const firstVisit = `inside-${body.id}`;
        if (height < model.decks[0].top && !runtime.stats.visited.includes(firstVisit)) {
            runtime.stats.visited.push(firstVisit);
            runtime.scan.found = { name: `Inside ${body.name}`, blurb: model.inside, label: model.kind === 'ice' ? 'Ice giant' : 'Gas giant' };
            runtime.scan.foundAt = performance.now() / 1000;
            cue(runtime, 'scan', 0.7);
        }

        // What the ship and the HUD read: depth, pressure, heat, the deck it is in.
        const f = flash.current;
        runtime.gas = {
            body,
            height,
            light,
            deck: model.decks.find((d) => height <= d.top && height >= d.top - d.thickness)?.name ?? null,
            // The stroke (world position), how bright it is now, and whether it
            // found the ship (flight.ts takes that from the shield, once).
            flash: f ? {
                position: f.position.clone().add(body.position),
                strength: f.strength,
                level: flashLevel,
                hit: strike.current,
            } : null,
        };
        strike.current = false;
    }, -1);

    return (
        <group ref={rootRef} visible={false}>
            <mesh ref={skyRef} geometry={sky.geometry} material={sky.material} renderOrder={-98} frustumCulled={false} />
            <group ref={groupRef}>
                <mesh ref={boltRef} geometry={bolt.geometry} material={bolt.material} frustumCulled={false} visible={false} renderOrder={6} />
                {decks.map((d, i) => (
                    <group key={i}>
                        <mesh ref={(m) => { deckRefs.current[i] = m; }} geometry={d.geometry} material={d.material} frustumCulled={false} />
                        <mesh ref={(m) => { insideRefs.current[i] = m; }} geometry={d.geometry} material={d.inside} frustumCulled={false} visible={false} />
                    </group>
                ))}
            </group>
            <mesh ref={fogRef} geometry={fog.geometry} material={fog.material} renderOrder={40} frustumCulled={false} />
        </group>
    );
};
