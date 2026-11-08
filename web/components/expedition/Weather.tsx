import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import { groundHeight } from './environment';
import { createBoltGeometry, createBoltMaterial, makeBolt, writeBolt } from './bolts';
import { cue, type ExpeditionRuntime } from './runtime';
import { shelterCover } from './Shelters';
import { TORNADO_FACT, WEATHER_UNIFORMS, climateOf, settleWeather, stepWeather, strokeHarm, tornadoDue, tornadoHarm, tornadoSpot, type WeatherKind } from './weather';

/**
 * The weather where the player is (weather.ts): it runs the storms, decides
 * who is sheltered and what reaches them, and draws what can be seen of it:
 * rain or drizzle falling past the camera, dust blowing, dust devils,
 * lightning coming down with its thunder after it, and, in a proton storm,
 * the sparks of particles striking the camera itself.
 */

/** Falling or blowing things round the camera: count per quality, and how each kind moves and looks. */
const STREAKS = [900, 2600, 5200];
/**
 * How each kind moves and looks: fall speed (m/s), how much of the wind it
 * rides, its size (m), how opaque, its colour, the share of particles in use
 * at full strength, and `soft` (0 a thin streak, 1 a blurred puff), `low`
 * (above 0: it keeps within that many metres of the ground, like sand).
 */
interface StreakLook { fall: number; carry: number; length: number; width: number; alpha: number; colour: [number, number, number]; share: number; soft: number; low: number }
const LOOKS: Partial<Record<WeatherKind, StreakLook>> = {
    // Raindrops at nine metres a second, slanting with the wind.
    thunderstorm: { fall: 9, carry: 1, length: 0.9, width: 0.012, alpha: 0.45, colour: [0.72, 0.76, 0.82], share: 1, soft: 0, low: 0 },
    // Titan's methane: drops a centimetre across, falling at 1.6 m/s.
    drizzle: { fall: 1.6, carry: 1, length: 0.12, width: 0.02, alpha: 0.4, colour: [0.86, 0.72, 0.5], share: 0.35, soft: 0, low: 0 },
    // Mars: fine dust in the air, puffs and wisps riding the wind (the storm
    // itself is the volume of dust in the sky and the haze round everything).
    dust: { fall: 0.15, carry: 1, length: 1.6, width: 0.5, alpha: 0.07, colour: [0.62, 0.42, 0.27], share: 0.7, soft: 1, low: 0 },
};
/** Sand on the move: grains skipping along the ground in a strong wind, a metre deep. */
const SAND: StreakLook = { fall: 0, carry: 0.6, length: 0.7, width: 0.06, alpha: 0.16, colour: [0.55, 0.36, 0.22], share: 1, soft: 0.6, low: 1.2 };

const streakMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
        uVelocity: { value: new THREE.Vector3(0, -9, 0) },
        uTime: { value: 0 },
        uBox: { value: 22 },
        uLength: { value: 0.9 },
        uWidth: { value: 0.012 },
        uAmount: { value: 0 },
        uAlpha: { value: 0.4 },
        uColour: { value: new THREE.Color() },
        uLight: { value: 1 },
        uShelters: { value: [new THREE.Vector4(), new THREE.Vector4()] },
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSoft: { value: 0 },
        uLow: { value: 0 },
        uCamHeight: { value: 0 },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${NOISE_GLSL}
        attribute vec2 aCorner;
        uniform vec3 uVelocity;
        uniform float uTime;
        uniform float uBox;
        uniform float uLength;
        uniform float uWidth;
        uniform float uAmount;
        uniform vec4 uShelters[2];
        uniform vec3 uUp;
        uniform float uLow;
        uniform float uCamHeight;
        varying float vFade;
        varying float vAcross;
        varying float vAlong;
        void main() {
            uint h = hashU32(uint(gl_InstanceID) * 2654435761u + 17u);
            if (hashToUnit(h) > uAmount) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }
            vec3 seed = vec3(hashToUnit(hashU32(h + 1u)), hashToUnit(hashU32(h + 2u)), hashToUnit(hashU32(h + 3u)));
            // Each moves at the storm's speed (a little faster or slower), through a box round the camera.
            vec3 p = seed * uBox * 2.0 + uVelocity * uTime * (0.85 + 0.3 * seed.x);
            vec3 rel = mod(p - cameraPosition + uBox, uBox * 2.0) - uBox;
            // Kept near the ground: only so high above it (the camera's height over it known).
            float above = dot(rel, uUp) + uCamHeight;
            if (uLow > 0.0) {
                above = mod(above, uLow * 1.5);
                rel += uUp * (above - (dot(rel, uUp) + uCamHeight));
            }
            vec3 at = cameraPosition + rel;
            // Not under the rock of a shelter.
            for (int i = 0; i < 2; i++) {
                if (uShelters[i].w <= 0.0) continue;
                vec3 d = at - uShelters[i].xyz;
                float up = dot(d, uUp);
                if (up < 5.6 && length(d - uUp * up) < uShelters[i].w) {
                    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                    return;
                }
            }
            vec3 along = normalize(uVelocity);
            vec3 toEye = normalize(cameraPosition - at);
            vec3 across = normalize(cross(along, toEye) + vec3(1e-5));
            vec3 position3 = at + along * (aCorner.y - 0.5) * uLength + across * aCorner.x * uWidth;
            // Fade at the edge of the box and very near the eye.
            float r = length(rel) / uBox;
            vFade = (1.0 - smoothstep(0.7, 1.0, r)) * smoothstep(0.4, 1.6, length(rel));
            if (uLow > 0.0) vFade *= 1.0 - smoothstep(uLow * 0.35, uLow, above);
            vAcross = aCorner.x;
            vAlong = aCorner.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(position3, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uAlpha;
        uniform vec3 uColour;
        uniform float uLight;
        uniform float uSoft;
        varying float vFade;
        varying float vAcross;
        varying float vAlong;
        void main() {
            #include <logdepthbuf_fragment>
            float core = 1.0 - abs(vAcross);
            // A puff: soft at both ends as well as across.
            float ends = 1.0 - abs(vAlong * 2.0 - 1.0);
            float shape = mix(core, core * core * (3.0 - 2.0 * core) * ends * ends * (3.0 - 2.0 * ends), uSoft);
            gl_FragColor = vec4(uColour * uLight, uAlpha * vFade * shape);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const streakGeometry = (count: number) => {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
    geometry.setAttribute('aCorner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, -1, 1, 1, 1], 2));
    geometry.setIndex([0, 1, 2, 1, 3, 2]);
    geometry.instanceCount = count;
    return geometry;
};

/** A dust devil: a tall column of dust turning, thinning upwards. */
const devilMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uColour: { value: new THREE.Color(0.66, 0.44, 0.28) },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vModel;
        void main() {
            vModel = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        uniform float uTime;
        uniform float uAlpha;
        uniform vec3 uColour;
        varying vec3 vModel;
        void main() {
            #include <logdepthbuf_fragment>
            float h = vModel.y;
            float a = atan(vModel.x, vModel.z);
            // Bands of dust wound round the column, climbing as it turns.
            float swirl = gnoise(vec3(cos(a) * 2.0, h * 0.045 - uTime * 0.9, sin(a) * 2.0 + uTime * 0.2), 7u);
            float bands = 0.5 + 0.5 * sin(a * 3.0 + h * 0.08 - uTime * 3.2 + swirl * 2.0);
            float thin = (1.0 - smoothstep(60.0, 230.0, h)) * smoothstep(0.0, 6.0, h);
            gl_FragColor = vec4(uColour, uAlpha * thin * (0.35 + 0.65 * bands) * (0.6 + 0.4 * swirl));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

/**
 * A tornado: the condensation funnel hanging from the cloud base to the
 * ground (shaped in the vertex shader from a unit cylinder, a rope at the
 * bottom flaring to a broad cone under the cloud, bent by the wind aloft),
 * turning, darker where it is thick, and the debris cloud whirling round its foot.
 */
const tornadoMaterial = (debris: boolean) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
        uTime: { value: 0 },
        uAlpha: { value: 0 },
        uLight: { value: 1 },
        uHeight: { value: 700 },
        uBottom: { value: 22 },
        uTop: { value: 140 },
        uLean: { value: new THREE.Vector3() },
        uColour: { value: debris ? new THREE.Color(0.42, 0.36, 0.3) : new THREE.Color(0.5, 0.52, 0.55) },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uHeight;
        uniform float uBottom;
        uniform float uTop;
        uniform vec3 uLean;
        uniform float uTime;
        varying vec2 vAround;
        varying float vEdge;
        void main() {
            float y = position.y;
            float a = atan(position.x, position.z);
            // A rope at the ground flaring into a cone under the cloud.
            float r = mix(uBottom, uTop, pow(y, 2.2)) * (1.0 + 0.08 * sin(a * 3.0 + y * 14.0 - uTime * 5.0));
            vec3 p = vec3(position.x * r, y * uHeight, position.z * r);
            // Bent by the wind: the top trails, the middle bows.
            p += uLean * (y * y * 0.6 + sin(y * 3.14159) * 0.25 + 0.08 * sin(uTime * 0.7 + y * 4.0));
            vAround = vec2(a, y);
            vec4 view = modelViewMatrix * vec4(p, 1.0);
            vec3 n = normalize(mat3(modelViewMatrix) * vec3(position.x, 0.0, position.z));
            vEdge = abs(dot(n, normalize(-view.xyz)));
            gl_Position = projectionMatrix * view;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${NOISE_GLSL}
        uniform float uTime;
        uniform float uAlpha;
        uniform float uLight;
        uniform vec3 uColour;
        varying vec2 vAround;
        varying float vEdge;
        void main() {
            #include <logdepthbuf_fragment>
            float a = vAround.x;
            float y = vAround.y;
            // Bands of cloud (or dust) wound round it, climbing as it turns.
            float swirl = gnoise(vec3(cos(a) * 2.0, y * ${debris ? '3.0' : '9.0'} - uTime * 1.3, sin(a) * 2.0 + uTime * 0.4), ${debris ? '17u' : '13u'});
            float bands = 0.5 + 0.5 * sin(a * 4.0 + y * ${debris ? '6.0' : '22.0'} - uTime * 6.5 + swirl * 2.5);
            ${debris
        ? 'float shape = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.35, 1.0, y)) * (0.55 + 0.45 * swirl);'
        : 'float shape = smoothstep(0.0, 0.03, y) * (1.0 - smoothstep(0.9, 1.0, y)) * (0.75 + 0.25 * swirl);'}
            // Thick through the middle, thin at the edges seen side-on.
            float body = mix(0.35, 1.0, smoothstep(0.0, 0.6, vEdge));
            vec3 col = uColour * (0.75 + 0.35 * bands) * uLight;
            gl_FragColor = vec4(col, uAlpha * shape * body * (0.6 + 0.4 * bands));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

/** Particles striking the camera: bright single pixels and short tracks, fresh every frame. */
const sparkMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uSeed: { value: 0 }, uAmount: { value: 0 } },
    vertexShader: /* glsl */ `
        ${NOISE_GLSL}
        uniform float uSeed;
        uniform float uAmount;
        varying float vBright;
        void main() {
            uint h = hashU32(uint(gl_VertexID) * 747796405u + uint(uSeed));
            float live = step(hashToUnit(h), uAmount);
            vec2 at = vec2(hashToUnit(hashU32(h + 1u)), hashToUnit(hashU32(h + 2u))) * 2.0 - 1.0;
            vBright = live * (0.4 + 0.6 * hashToUnit(hashU32(h + 3u)));
            gl_PointSize = 1.0 + 2.0 * hashToUnit(hashU32(h + 4u));
            gl_Position = vec4(at, 0.0, 1.0);
        }`,
    fragmentShader: /* glsl */ `
        varying float vBright;
        void main() {
            if (vBright <= 0.0) discard;
            gl_FragColor = vec4(vec3(1.6, 1.6, 1.7) * vBright, 1.0);
        }`,
});

const up = new THREE.Vector3();
const local = new THREE.Vector3();
const side = new THREE.Vector3();
const ground = new THREE.Vector3();
const top = new THREE.Vector3();
const here = new THREE.Vector3();

export const Weather = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const { size } = useThree();
    const streaks = useMemo(() => {
        const count = STREAKS[runtime.quality];
        const mesh = new THREE.Mesh(streakGeometry(count), streakMaterial());
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        mesh.visible = false;
        return mesh;
    }, [runtime.quality]);
    // Sand skipping along the ground when the wind is up (Mars).
    const sand = useMemo(() => {
        const mesh = new THREE.Mesh(streakGeometry(Math.round(STREAKS[runtime.quality] * 0.6)), streakMaterial());
        mesh.frustumCulled = false;
        mesh.renderOrder = 4;
        mesh.visible = false;
        return mesh;
    }, [runtime.quality]);
    useEffect(() => () => {
        sand.geometry.dispose();
        (sand.material as THREE.Material).dispose();
    }, [sand]);
    const bolt = useMemo(() => {
        const mesh = new THREE.Mesh(createBoltGeometry(), createBoltMaterial());
        mesh.frustumCulled = false;
        mesh.renderOrder = 5;
        mesh.visible = false;
        // DEV: tests read the bolt back (evals/boltinfo.js).
        if (import.meta.env.DEV) (window as unknown as { __bolt?: THREE.Mesh }).__bolt = mesh;
        return mesh;
    }, []);
    const devils = useMemo(() => {
        const geometry = new THREE.CylinderGeometry(14, 5, 240, 32, 24, true);
        geometry.translate(0, 120, 0);
        const material = devilMaterial();
        return [0, 1, 2].map(() => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.frustumCulled = false;
            mesh.renderOrder = 4;
            mesh.visible = false;
            return mesh;
        });
    }, []);
    // A tornado (Earth): the funnel and the debris cloud round its foot.
    const tornado = useMemo(() => {
        const geometry = new THREE.CylinderGeometry(1, 1, 1, 40, 48, true);
        geometry.translate(0, 0.5, 0);
        const funnel = new THREE.Mesh(geometry, tornadoMaterial(false));
        const debris = new THREE.Mesh(geometry, tornadoMaterial(true));
        for (const mesh of [funnel, debris]) {
            mesh.frustumCulled = false;
            mesh.renderOrder = 4;
            mesh.visible = false;
        }
        return { funnel, debris };
    }, []);
    const sparks = useMemo(() => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(160 * 3).fill(0), 3));
        const points = new THREE.Points(geometry, sparkMaterial());
        points.frustumCulled = false;
        points.renderOrder = 9;
        points.visible = false;
        return points;
    }, []);
    useEffect(() => () => {
        streaks.geometry.dispose();
        (streaks.material as THREE.Material).dispose();
        bolt.geometry.dispose();
        (bolt.material as THREE.Material).dispose();
        devils[0].geometry.dispose();
        (devils[0].material as THREE.Material).dispose();
        sparks.geometry.dispose();
        (sparks.material as THREE.Material).dispose();
        tornado.funnel.geometry.dispose();
        (tornado.funnel.material as THREE.Material).dispose();
        (tornado.debris.material as THREE.Material).dispose();
    }, [streaks, bolt, devils, sparks, tornado]);
    const rumble = useRef(0);
    const tornadoSpeed = useRef(13);

    const thunder = useRef<{ at: number; volume: number }[]>([]);
    const devilState = useRef([0, 1, 2].map(() => ({ at: new THREE.Vector3(), drift: new THREE.Vector3(), age: 0, life: 0, size: 1, lean: 0 })));
    const boltAge = useRef(9);
    const clock = useRef(0);
    // Seconds spent sheltered through the storm now blowing, and which kind it is.
    const sheltered = useRef({ seconds: 0, kind: null as WeatherKind | null });

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        clock.current += dt;
        const weather = runtime.weather;
        const body = runtime.currentBody;
        // Weather happens near the ground: higher up (or away) it is calm, and
        // landing again starts the calm over.
        const near = body && body.kind === 'rocky' && runtime.altitude < 2500 && climateOf(body).length ? body : null;
        if (near !== weather.body) settleWeather(weather, near);
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const ship = runtime.hud.ship;
        // Sheltered: aboard the ship, or under rock.
        weather.shelter = walker ? (runtime.inDome ? 1 : shelterCover(runtime.shelters, walker.position)) : ship && !ship.destroyed ? 1 : 0;
        const exposed = !!walker && weather.shelter < 0.5;
        const from = walker ? walker.position : ship ? ship.position : runtime.camera;
        if (near) here.copy(from).sub(near.position);
        const events = runtime.menuOpen || !near ? { began: null, stroke: false, strokeAt: null } : stepWeather(weather, dt, exposed, here);
        if (events.began === 'warning') cue(runtime, 'radio', 0.8);
        // Sitting a storm out in shelter (the story counts it once it has passed).
        if (weather.phase === 'storm' && weather.kind) {
            sheltered.current.kind = weather.kind;
            // (A dust storm hurts no one: seeing it through is enough.)
            if (weather.shelter >= 0.5 || weather.kind === 'dust') sheltered.current.seconds += dt;
        }
        if (events.began === 'calm') {
            const { seconds, kind: was } = sheltered.current;
            const key = `weathered-${was}`;
            if (was && was !== 'drizzle' && seconds > 30 && !(walker?.down) && !runtime.stats.visited.includes(key)) runtime.stats.visited.push(key);
            sheltered.current = { seconds: 0, kind: null };
        }
        if (events.began === 'storm' && ship) {
            ship.notice = weather.kind === 'radiation' ? 'PROTON STORM ARRIVING' : weather.kind === 'dust' ? 'DUST STORM ARRIVING' : weather.kind === 'drizzle' ? 'METHANE DRIZZLE' : 'STORM ARRIVING';
            ship.noticeTime = performance.now() / 1000;
            cue(runtime, 'notice', 0.7);
        }
        if (events.began === 'calm' && weather.dose > 0.02 && ship) {
            ship.notice = `PROTON STORM OVER · DOSE ${Math.round(weather.dose * 100)}% OF LETHAL`;
            ship.noticeTime = performance.now() / 1000;
        }

        // What reaches the explorer: the dose climbing, a stroke of lightning.
        if (walker && weather.rate > 0 && exposed) {
            walker.health = Math.max(0, walker.health - weather.rate * dt);
            walker.hurtBy = 'radiation';
            walker.hurtAgo = 0;
        }
        if (events.stroke && near && events.strokeAt) {
            up.copy(from).sub(near.position).normalize();
            // Where it comes down: out of the storm cell (weather.ts). DEV:
            // window.__strikeAhead puts it ahead of the camera, in view.
            ground.copy(events.strokeAt);
            const view = runtime.view.camera;
            const ahead = import.meta.env.DEV && (window as unknown as { __strikeAhead?: boolean }).__strikeAhead;
            if (view && ahead) {
                side.set(0, 0, -1).applyQuaternion(view.quaternion);
                side.addScaledVector(up, -side.dot(up)).normalize().applyAxisAngle(up, (Math.random() - 0.5) * 0.3);
                ground.copy(from).sub(near.position).addScaledVector(side, 450 + Math.random() * 400);
            }
            ground.normalize();
            ground.multiplyScalar(near.radius + groundHeight(near, ground));
            const distance = ground.distanceTo(here);
            side.copy(ground).sub(here).addScaledVector(up, -up.dot(side.copy(ground).sub(here))).normalize();
            top.copy(ground).normalize().multiplyScalar(near.radius + (near.biome?.atmosphereHeight ?? 1000) * 0.4);
            top.addScaledVector(side, (Math.random() - 0.5) * 600);
            writeBolt(bolt.geometry, makeBolt(top, ground));
            boltAge.current = 0;
            weather.flash = Math.max(weather.flash, THREE.MathUtils.clamp(1.3 - distance / 3000, 0.35, 1.3));
            weather.strike = { at: ground.clone().add(near.position), age: 0, distance, id: (weather.strike?.id ?? 0) + 1 };
            thunder.current.push({ at: clock.current + distance / 343, volume: THREE.MathUtils.clamp(1.4 - distance / 2500, 0.25, 1.4) });
            if (walker && exposed) {
                const harm = strokeHarm(distance, weather.severity);
                if (harm > 0) {
                    walker.health = Math.max(0, walker.health - harm);
                    walker.hurtBy = 'lightning';
                    walker.impact = Math.min(1, harm * 2);
                    walker.impactTime = 0;
                    walker.hurtAgo = 0;
                    walker.velocity.addScaledVector(up, 2.5);
                    if (ship) {
                        ship.notice = distance < 3 ? 'STRUCK BY LIGHTNING' : 'LIGHTNING STRIKE NEARBY · GET UNDER COVER';
                        ship.noticeTime = performance.now() / 1000;
                    }
                }
            }
        }
        for (let i = thunder.current.length - 1; i >= 0; i--) {
            if (clock.current >= thunder.current[i].at) {
                cue(runtime, 'thunder', thunder.current[i].volume);
                thunder.current.splice(i, 1);
            }
        }

        // The sky and everything under it (surfaceShading, Atmosphere, Clouds).
        const kind = weather.kind;
        WEATHER_UNIFORMS.storm.value = kind === 'thunderstorm' ? weather.strength : kind === 'drizzle' ? weather.strength * 0.35 : 0;
        WEATHER_UNIFORMS.dust.value = kind === 'dust' ? weather.strength : 0;
        WEATHER_UNIFORMS.flash.value = weather.flash;

        // The bolt itself, for a quarter of a second, flickering as it re-strikes.
        // DEV: window.__weatherHold keeps a bolt lit for a screenshot.
        if (!(import.meta.env.DEV && (window as unknown as { __weatherHold?: boolean }).__weatherHold)) boltAge.current += dt;
        bolt.visible = !!near && boltAge.current < 0.28;
        if (bolt.visible && near) {
            bolt.position.copy(near.position).sub(runtime.origin);
            const m = bolt.material as THREE.ShaderMaterial;
            m.uniforms.uViewport.value.set(size.width, size.height);
            m.uniforms.uLevel.value = (1 - boltAge.current / 0.28) * (0.65 + 0.35 * Math.sin(boltAge.current * 95));
        }

        // Rain, drizzle or dust past the camera, and sand along the ground.
        const look = kind ? LOOKS[kind] : undefined;
        const camHeight = near ? runtime.camera.distanceTo(near.position) - near.radius - groundHeight(near, local.copy(runtime.camera).sub(near.position).normalize()) : 0;
        const drive = (mesh: THREE.Mesh, style: StreakLook | undefined, amount: number) => {
            mesh.visible = !!near && !!style && amount > 0.02;
            if (!mesh.visible || !style || !near) return;
            const u = (mesh.material as THREE.ShaderMaterial).uniforms;
            up.copy(runtime.camera).sub(near.position).normalize();
            // Falling, and carried by the wind as it is now (weather.ts), gusts and all.
            u.uVelocity.value.copy(up).multiplyScalar(-style.fall).addScaledVector(weather.wind, style.carry);
            u.uTime.value = clock.current;
            u.uLength.value = style.length;
            u.uWidth.value = style.width;
            u.uAmount.value = amount * style.share;
            u.uAlpha.value = style.alpha;
            u.uSoft.value = style.soft;
            u.uLow.value = style.low;
            u.uCamHeight.value = camHeight;
            u.uColour.value.setRGB(...style.colour);
            u.uLight.value = (0.25 + 0.75 * runtime.daylight) * (1 - 0.5 * WEATHER_UNIFORMS.storm.value) * (1 - 0.55 * WEATHER_UNIFORMS.dust.value) + weather.flash * 1.5;
            u.uUp.value.copy(up);
            const shelters = u.uShelters.value as THREE.Vector4[];
            shelters.forEach((v, i) => {
                const s = runtime.shelters[i];
                if (s) v.set(s.centre.x - runtime.origin.x, s.centre.y - runtime.origin.y, s.centre.z - runtime.origin.z, 7.6);
                else v.set(0, 0, 0, 0);
            });
        };
        drive(streaks, look, weather.strength);
        // Sand moves once the wind passes about 12 m/s at the ground here (in Mars's thin air it takes a gale).
        const blowing = near?.id === 'skills' && camHeight < 40 ? THREE.MathUtils.smoothstep(weather.windSpeed, 12, 26) : 0;
        drive(sand, SAND, blowing);

        // Dust devils on Mars: on sunny afternoons as much as in storms, each
        // born somewhere out on the plain at random, wandering with the wind,
        // living a minute or three and dying away.
        const mars = near?.id === 'skills';
        devils.forEach((mesh, k) => {
            const state = devilState.current[k];
            if (!near || !mars) {
                mesh.visible = false;
                state.life = 0;
                return;
            }
            const origin = walker ? walker.position : runtime.camera;
            up.copy(origin).sub(near.position).normalize();
            state.age += dt;
            if (state.age >= state.life) {
                // The next one forms after a random wait: often in a storm, now and then in sunshine.
                const rate = (kind === 'dust' ? 1 / 25 : 0) + runtime.daylight / 160;
                if (Math.random() < rate * dt) {
                    side.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).addScaledVector(up, -0.0);
                    side.addScaledVector(up, -side.dot(up)).normalize();
                    state.at.copy(origin).addScaledVector(side, 250 + Math.random() * 1100);
                    state.age = 0;
                    state.life = 60 + Math.random() * 150;
                    state.size = 0.6 + Math.random() * 0.9;
                    state.lean = (Math.random() - 0.5) * 0.25;
                }
            }
            const alive = state.age < state.life;
            const fade = alive ? THREE.MathUtils.smoothstep(state.age, 0, 8) * (1 - THREE.MathUtils.smoothstep(state.age, state.life - 12, state.life)) : 0;
            mesh.visible = fade > 0.01;
            if (!mesh.visible) return;
            // Drifting with the wind (a little faster than the air at the ground), meandering.
            state.drift.copy(weather.wind).multiplyScalar(1.2);
            side.crossVectors(up, weather.wind).normalize();
            state.drift.addScaledVector(side, Math.sin(clock.current * 0.2 + k * 4.1) * 2.5);
            state.at.addScaledVector(state.drift, dt);
            local.copy(state.at).sub(near.position).normalize();
            state.at.copy(near.position).addScaledVector(local, near.radius + groundHeight(near, local));
            mesh.position.copy(state.at).sub(runtime.origin);
            mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, local);
            mesh.rotateZ(state.lean);
            mesh.scale.set(state.size, state.size * (0.8 + 0.4 * Math.sin(state.age * 0.05 + k)), state.size);
            const m = mesh.material as THREE.ShaderMaterial;
            m.uniforms.uTime.value = clock.current;
            m.uniforms.uAlpha.value = fade * (0.32 + 0.18 * (kind === 'dust' ? weather.strength : 0)) * (0.3 + 0.7 * runtime.daylight) * (1 - 0.6 * WEATHER_UNIFORMS.dust.value);
        });

        // A tornado out of a severe thunderstorm on Earth: it touches down a
        // kilometre or so off, crosses the plain at a car's speed and passes the
        // explorer by (not always widely), and lifts as the storm moves on.
        // DEV: window.__tornadoAt = metres puts one down that far ahead of the camera now.
        const forced = import.meta.env.DEV ? (window as unknown as { __tornadoAt?: number }).__tornadoAt : undefined;
        if (near && ((forced && near.id === 'projects') || (tornadoDue(weather) && Math.random() < dt / 35))) {
            up.copy(from).sub(near.position).normalize();
            let speed = 13;
            const heading = new THREE.Vector3();
            const at = new THREE.Vector3();
            if (forced) {
                // A test's tornado: that far ahead of the camera, crossing in front.
                const view = runtime.view.camera;
                side.set(0, 0, -1);
                if (view) side.applyQuaternion(view.quaternion);
                side.addScaledVector(up, -side.dot(up)).normalize().applyAxisAngle(up, 0.3);
                at.copy(from).addScaledVector(side, forced);
                heading.copy(side).negate().applyAxisAngle(up, 0.25).normalize();
                delete (window as unknown as { __tornadoAt?: number }).__tornadoAt;
            } else {
                // Out of the cell's leading flank, moving with it: where it goes is the storm's business.
                speed = tornadoSpot(weather, at, heading);
                at.add(near.position);
            }
            weather.tornado = { at, heading, distance: at.distanceTo(from), bearing: '', age: forced ? 6 : 0, life: 60 + Math.random() * 120, strength: 0 };
            tornadoSpeed.current = speed;
            weather.touchedDown = true;
            if (weather.tornado.distance < 8000) {
                cue(runtime, 'radio', 0.9);
                if (ship) {
                    ship.notice = 'TORNADO ON THE GROUND · TAKE COVER';
                    ship.noticeTime = performance.now() / 1000;
                }
            }
        }
        const twister = weather.tornado;
        if (twister && near) {
            twister.age += dt;
            const ending = weather.phase === 'calm' || twister.age > twister.life;
            twister.strength = Math.min(1, twister.age / 6) * Math.max(0, Math.min(1, (twister.life - twister.age) / 10));
            if (ending && twister.strength <= 0.01) {
                weather.tornado = null;
            } else {
                // Across the ground with its storm, wobbling, kept on it.
                twister.at.addScaledVector(twister.heading, tornadoSpeed.current * dt);
                twister.heading.applyAxisAngle(local.copy(twister.at).sub(near.position).normalize(), Math.sin(clock.current * 0.31 + twister.life) * 0.05 * dt);
                local.copy(twister.at).sub(near.position).normalize();
                twister.at.copy(near.position).addScaledVector(local, near.radius + groundHeight(near, local));
                twister.heading.addScaledVector(local, -twister.heading.dot(local)).normalize();
                twister.distance = twister.at.distanceTo(from);
                // Its winds: round it and in towards it, falling off with distance
                // (the walker and the ship feel them through weather.wind).
                if (twister.distance < 600 && twister.distance > 1) {
                    top.copy(twister.at).sub(from);
                    top.addScaledVector(local, -top.dot(local));
                    const r = Math.max(top.length(), 8);
                    top.divideScalar(r);
                    side.crossVectors(local, top);
                    const v = 75 * twister.strength * Math.min(1, 30 / r);
                    weather.wind.addScaledVector(side, v).addScaledVector(top, v * 0.45);
                    weather.windSpeed = weather.wind.length();
                }
                // Which way it is, from where the camera looks.
                const view = runtime.view.camera;
                if (view) {
                    side.set(0, 0, -1).applyQuaternion(view.quaternion);
                    side.addScaledVector(local, -side.dot(local)).normalize();
                    top.copy(twister.at).sub(from);
                    top.addScaledVector(local, -top.dot(local)).normalize();
                    const angle = Math.atan2(top.dot(ground.crossVectors(local, side)), top.dot(side));
                    twister.bearing = Math.abs(angle) < 0.6 ? 'ahead' : Math.abs(angle) > 2.5 ? 'behind you' : angle > 0 ? 'to your left' : 'to your right';
                }
                // What it does to someone in the open, and to the ship.
                if (walker && exposed) {
                    const harm = tornadoHarm(twister.distance, twister.strength);
                    if (harm > 0) {
                        walker.health = Math.max(0, walker.health - harm * dt);
                        walker.hurtBy = 'tornado';
                        walker.hurtAgo = 0;
                        walker.impact = Math.min(1, harm);
                        walker.impactTime = 0;
                        // Pulled round it and lifted.
                        top.copy(walker.position).sub(twister.at);
                        side.crossVectors(local, top).normalize();
                        walker.velocity.addScaledVector(side, 9 * harm * dt * 10).addScaledVector(local, 4 * harm * dt * 10);
                    }
                }
                if (ship && !walker && !ship.destroyed) {
                    const reach = ship.position.distanceTo(twister.at);
                    if (reach < 70 && runtime.altitude < 900) {
                        ship.shield = Math.max(0, ship.shield - 0.12 * twister.strength * (1 - reach / 70) * dt);
                        ship.jolt = Math.max(ship.jolt, 0.6 * twister.strength);
                        ship.hurtBy = 'impact';
                    }
                }
                if (twister.distance < 2200 && !runtime.stats.visited.includes('tornado')) {
                    runtime.stats.visited.push('tornado');
                    runtime.scan.found = { name: 'Tornado', blurb: TORNADO_FACT, label: 'Discovery' };
                    runtime.scan.foundAt = performance.now() / 1000;
                }
                // Its roar, a long low rumble, louder near.
                rumble.current -= dt;
                if (rumble.current <= 0) {
                    rumble.current = 2.2;
                    cue(runtime, 'thunder', THREE.MathUtils.clamp(1.3 - twister.distance / 1600, 0.12, 1.1) * twister.strength);
                }
            }
        }
        const showTwister = !!weather.tornado && !!near;
        tornado.funnel.visible = showTwister;
        tornado.debris.visible = showTwister;
        if (weather.tornado && near) {
            const t = weather.tornado;
            local.copy(t.at).sub(near.position).normalize();
            const light = (0.25 + 0.75 * runtime.daylight) * (1 - 0.45 * WEATHER_UNIFORMS.storm.value) + weather.flash * 1.2;
            for (const [mesh, alpha] of [[tornado.funnel, 0.88], [tornado.debris, 0.62]] as const) {
                mesh.position.copy(t.at).sub(runtime.origin);
                mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, local);
                const u = (mesh.material as THREE.ShaderMaterial).uniforms;
                u.uTime.value = clock.current;
                u.uAlpha.value = alpha * t.strength;
                u.uLight.value = light;
            }
            // The funnel reaches the cloud base; the debris whirls round its foot.
            const f = (tornado.funnel.material as THREE.ShaderMaterial).uniforms;
            f.uHeight.value = 720;
            f.uBottom.value = 16 + 10 * t.strength;
            f.uTop.value = 150;
            (f.uLean.value as THREE.Vector3).set(70, 0, 30);
            const d = (tornado.debris.material as THREE.ShaderMaterial).uniforms;
            d.uHeight.value = 70;
            d.uBottom.value = 45;
            d.uTop.value = 75;
            (d.uLean.value as THREE.Vector3).set(0, 0, 0);
        }

        // Protons striking the camera's sensor, out in the open in a proton storm.
        const spark = sparks.material as THREE.ShaderMaterial;
        spark.uniforms.uAmount.value = weather.rate * (exposed ? 40 : 4);
        spark.uniforms.uSeed.value = (spark.uniforms.uSeed.value + 7919) % 1e6;
        sparks.visible = spark.uniforms.uAmount.value > 0.002;
    });

    return (
        <>
            <primitive object={streaks} />
            <primitive object={sand} />
            <primitive object={bolt} />
            {devils.map((mesh, k) => <primitive key={k} object={mesh} />)}
            <primitive object={sparks} />
            <primitive object={tornado.funnel} />
            <primitive object={tornado.debris} />
        </>
    );
};
