import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { THE_SUN } from './bodies';
import { NOISE_GLSL } from './noise';
import { farness } from './deepSpace';
import { skyBeyond } from './environment';
import { watchView, type ExpeditionRuntime } from './runtime';

/**
 * The Sun: a real star at the middle of the system, 109 Earths across, that
 * can be flown to. Its photosphere boils with granulation over a slower
 * mottling of supergranules, darkens and reddens towards the limb, carries a
 * few sunspot groups with dark umbrae and lighter penumbrae, and has bright
 * faculae near the edge; a corona glows round it.
 *
 * Seen from far away it is a blinding star, left for the bloom to turn into
 * glare, and never smaller than a few pixels (the sphere is drawn larger when
 * it would shrink below that). Seen close up its brightness comes down, as a
 * camera's exposure would, so its surface can be seen instead of a white
 * wall. Low in a planet's sky, the air reddens and dims it.
 */

const surfaceVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uScale;
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * uScale, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const surfaceFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uCamLocal;
uniform float uScale;
uniform float uTime;
uniform float uIntensity;
uniform float uLow;
uniform float uFar;
varying vec3 vLocal;

// Distance to the nearest of a lattice of jittered points: bright cells with
// dark lanes between them, the pattern of convection granules.
float cells(vec3 p, uint seed) {
    vec3 base = floor(p);
    float best = 8.0;
    for (int z = -1; z <= 1; z++) {
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec3 c = base + vec3(float(x), float(y), float(z));
                uvec3 key = uvec3(ivec3(c) + NOISE_OFFSET);
                uint h = hash3(key, seed);
                vec3 o = vec3(float(h & 1023u), float((h >> 10u) & 1023u), float((h >> 20u) & 1023u)) / 1023.0;
                best = min(best, length(p - c - o));
            }
        }
    }
    return best;
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vLocal);
    vec3 view = normalize(uCamLocal - vLocal * uScale);
    float mu = clamp(dot(n, view), 0.0, 1.0);

    // How much of the surface one pixel covers (radians): each scale of
    // detail fades out as its cells shrink towards a pixel, rather than
    // shimmering.
    float footprint = length(fwidth(n));
    float drift = uTime * 0.004;

    // Convection at four scales: supergranules, large and small granules and
    // the finest cells: bright rising gas with darker lanes between.
    float convection = 0.0;
    float weight = 0.0;
    float scales[4] = float[4](24.0, 90.0, 320.0, 1100.0);
    float amounts[4] = float[4](0.55, 0.8, 1.0, 0.7);
    for (int i = 0; i < 4; i++) {
        float f = scales[i];
        float visible = 1.0 - smoothstep(0.6 / f, 2.4 / f, footprint);
        if (visible <= 0.0) continue;
        vec3 q = n * f + vec3(drift * f * 0.02, float(i) * 17.0, -drift * f * 0.015);
        float d = cells(q + vec3(0.0, uTime * 0.03, 0.0), 317u + uint(i) * 13u);
        convection += (smoothstep(0.05, 0.85, 1.0 - d) - 0.55) * amounts[i] * visible;
        weight += amounts[i] * visible;
    }
    float mottle = fbm(n * 6.0 + vec3(drift, 0.0, -drift), 311u, 4, 2.1, 0.5);
    float brightness = 1.0 + mottle * 0.1 + convection * 0.32;

    // Sunspot groups: a dark umbra inside a lighter, streaked penumbra.
    float spots = 0.0;
    for (int i = 0; i < 9; i++) {
        uint h = hashU32(uint(i) * 7919u + 17u);
        float lat = (hashToUnit(h) - 0.5) * 0.8;
        float lon = hashToUnit(hashU32(h)) * 6.2831853 + uTime * 0.0006;
        vec3 centre = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
        float size = 0.01 + hashToUnit(hashU32(h + 5u)) * 0.035;
        float d = length(n - centre) / size;
        float wobble = gnoise(n * 260.0, 401u + uint(i)) * 0.3;
        float penumbra = 1.0 - smoothstep(0.7, 1.0 + wobble, d);
        float umbra = 1.0 - smoothstep(0.28, 0.42 + wobble * 0.3, d);
        spots = max(spots, penumbra * 0.5 + umbra * 0.42);
    }
    brightness *= 1.0 - spots;

    // Limb darkening, and bright faculae that show near the limb.
    float limb = 0.28 + 0.72 * pow(mu, 0.6);
    float faculae = smoothstep(0.3, 0.8, fbm(n * 55.0, 353u, 3, 2.0, 0.5)) * (1.0 - mu) * 0.8;
    brightness *= limb * (1.0 + faculae);
    // Hotter gas is whiter; the lanes, the spots and the limb are deeper orange.
    vec3 hot = vec3(1.0, 0.86, 0.6);
    vec3 cool = vec3(0.95, 0.42, 0.1);
    vec3 color = mix(cool, hot, clamp(brightness * 1.05 - 0.15, 0.0, 1.0)) * brightness;
    // Low in a sky, the air reddens and dims it.
    color *= mix(vec3(1.0), vec3(1.0, 0.5, 0.22), uLow);
    // From out by TON 618 the Sun is just another star.
    color *= uIntensity * mix(1.0, 0.02, uFar);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const coronaVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uSize;
varying vec2 vUv;
void main() {
    vUv = uv * 2.0 - 1.0;
    // A card at the Sun's centre, facing the camera.
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
}
`;

const coronaFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uRatio;
uniform float uStrength;
uniform float uLow;
uniform float uEclipse;
varying vec2 vUv;
void main() {
    #include <logdepthbuf_fragment>
    // Radius in units of the Sun's (drawn) radius.
    float r = length(vUv) * uRatio;
    if (r < 0.98) discard;
    float angle = atan(vUv.y, vUv.x);
    // Streamers: the corona is brighter in a few broad rays.
    float rays = 0.75 + 0.25 * sin(angle * 5.0 + 1.3) * sin(angle * 3.0 - 0.4);
    float glow = exp(-(r - 1.0) * 5.5) * 0.9 + exp(-(r - 1.0) * 1.4) * 0.28 * rays;
    glow *= 1.0 - smoothstep(uRatio * 0.7, uRatio, r);
    vec3 color = mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.5, 0.22), uLow) * glow * uStrength;
    // In totality the glare is gone and the corona itself shows, a millionth as bright as the
    // disc: pearly white, combed into fine streamers, with broad helmet streamers along the
    // equator reaching two or three radii, and red prominences just off the limb.
    if (uEclipse > 0.0) {
        float fine = pow(0.5 + 0.5 * sin(angle * 11.0 + 0.7), 6.0) * 0.6 + pow(0.5 + 0.5 * sin(angle * 23.0 - 1.9), 10.0) * 0.4;
        float helmet = pow(0.5 + 0.5 * cos(2.0 * angle - 0.35), 3.0);
        float reach = 0.6 + 2.4 * helmet + 1.0 * fine;
        float outer = exp(-(r - 1.0) * 2.0 / reach) * (0.3 + 0.7 * max(fine, helmet));
        float inner = exp(-(r - 1.0) * 10.0);
        float corona = (inner * 1.3 + outer * 0.85) * (1.0 - smoothstep(uRatio * 0.75, uRatio, r));
        float tongues = smoothstep(0.86, 1.0, sin(angle * 7.0 + 2.1) * sin(angle * 3.0 - 0.8));
        float prominence = tongues * smoothstep(0.995, 1.012, r) * (1.0 - smoothstep(1.03, 1.1, r));
        vec3 seen = vec3(0.93, 0.95, 1.0) * corona + vec3(1.0, 0.22, 0.36) * prominence * 2.4;
        color = mix(color, seen, uEclipse);
    }
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

// The smallest the Sun is drawn, as an angular radius (radians): about 0.12 degrees.
const MIN_ANGLE = 0.0021;

const eyeLocal = new THREE.Vector3();
const localUp = new THREE.Vector3();
const toSun = new THREE.Vector3();

export const Sun = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const groupRef = useRef<THREE.Group>(null);
    const radius = THE_SUN.radius;

    const surface = useMemo(() => {
        const geometry = new THREE.SphereGeometry(radius, 160, 120);
        const material = new THREE.ShaderMaterial({
            vertexShader: surfaceVertex,
            fragmentShader: surfaceFragment,
            uniforms: {
                uCamLocal: { value: new THREE.Vector3() },
                uScale: { value: 1 },
                uTime: { value: 0 },
                uIntensity: { value: 30 },
                uLow: { value: 0 },
                uFar: { value: 0 },
            },
        });
        return { geometry, material };
    }, [radius]);

    const corona = useMemo(() => {
        const geometry = new THREE.PlaneGeometry(2, 2);
        const material = new THREE.ShaderMaterial({
            vertexShader: coronaVertex,
            fragmentShader: coronaFragment,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uSize: { value: radius * 4 },
                uRatio: { value: 4 },
                uStrength: { value: 1 },
                uLow: { value: 0 },
                uEclipse: { value: 0 },
            },
        });
        return { geometry, material };
    }, [radius]);

    useEffect(() => () => {
        surface.geometry.dispose(); surface.material.dispose();
        corona.geometry.dispose(); corona.material.dispose();
    }, [surface, corona]);

    useFrame(({ clock }) => {
        const group = groupRef.current;
        if (!group) return;
        group.position.copy(THE_SUN.position).sub(runtime.origin);
        surface.material.uniforms.uTime.value = clock.elapsedTime;
        // How near the horizon the Sun stands, seen from where the camera is.
        const body = runtime.currentBody;
        let low = 0;
        if (body && body.kind === 'rocky') {
            localUp.copy(runtime.camera).sub(body.position).normalize();
            toSun.copy(THE_SUN.position).sub(runtime.camera).normalize();
            low = (1 - THREE.MathUtils.smoothstep(localUp.dot(toSun), 0.0, 0.45)) * THREE.MathUtils.clamp(runtime.atmosphere * (body.biome?.haze ?? 0), 0, 1);
        }
        surface.material.uniforms.uLow.value = low;
        corona.material.uniforms.uLow.value = low;
        // Out by TON 618 the Sun is only a star.
        surface.material.uniforms.uFar.value = farness(runtime.camera);
        // Totality: only when a world can cover the whole disc (a ring of fire never shows the corona).
        const cover = runtime.eclipse;
        corona.material.uniforms.uEclipse.value = cover.ratio >= 1 ? THREE.MathUtils.smoothstep(cover.coverage, 0.985, 0.9995) : 0;
    }, -1);

    // Per camera (the player's, or a photograph's): how large and how bright.
    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (!group) return;
        eyeLocal.copy(eye).sub(group.position);
        const distance = Math.max(eyeLocal.length(), radius * 1.0001);
        const angle = Math.asin(radius / distance);
        // Never smaller than a few pixels: drawn larger, and a star from afar.
        const scale = angle < MIN_ANGLE ? MIN_ANGLE / angle : 1;
        const s = surface.material.uniforms;
        s.uCamLocal.value.copy(eyeLocal);
        s.uScale.value = scale;
        // A camera's exposure: blinding from afar, its surface visible close up.
        // Under a gas giant's cloud decks the Sun fades out, and under Venus's
        // clouds it is never seen at all.
        const veil = (runtime.gas ? THREE.MathUtils.clamp(runtime.gas.light * 1.4 - 0.1, 0, 1) : 1) * skyBeyond(runtime);
        s.uIntensity.value = THREE.MathUtils.lerp(34, 1.1, THREE.MathUtils.smoothstep(angle, 0.02, 0.6)) * veil;
        const c = corona.material.uniforms;
        const drawn = radius * scale;
        c.uSize.value = drawn * 4;
        c.uRatio.value = 4;
        // The corona fades as the camera comes inside it, and is faint beside
        // the glare when the Sun is small.
        c.uStrength.value = THREE.MathUtils.lerp(0.9, 2.2, THREE.MathUtils.smoothstep(angle, 0.01, 0.2))
            * THREE.MathUtils.smoothstep(distance / radius, 1.6, 3.2) * veil;
    }), [runtime, surface, corona, radius]);

    return (
        <group ref={groupRef}>
            <mesh geometry={surface.geometry} material={surface.material} frustumCulled={false} renderOrder={-10} />
            <mesh geometry={corona.geometry} material={corona.material} frustumCulled={false} renderOrder={-9} />
        </group>
    );
};
