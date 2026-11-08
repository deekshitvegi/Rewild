import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ExpeditionBody, NarrowRing } from './bodies';
import { ringFrame } from './rings';

/**
 * The rings of Uranus and Neptune: not Saturn's broad sheet of bright ice but
 * a few narrow hoops, a few kilometres wide. Uranus's are opaque but as dark
 * as charcoal; Neptune's are faint dust, thickest in the arcs of its outer
 * Adams ring. Each ring is drawn exactly: the share of each pixel it covers,
 * worked out from the ring's edges and the pixel's width, so a ring narrower
 * than a pixel is a faint thin line, as a telescope would see it, and never
 * flickers. Dust glows looking towards the Sun (Voyager 2's pictures from
 * behind the planets found whole rings of it that way).
 */
const MAX_RINGS = 14;
const MAX_ARCS = 6;

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec4 uRings[${MAX_RINGS}];
uniform vec4 uRingColor[${MAX_RINGS}];
uniform vec4 uArcs[${MAX_ARCS}];
uniform float uRingCount;
uniform float uArcCount;
uniform float uGain;
uniform float uFar;
uniform vec3 uAxis;
uniform vec3 uE1;
uniform vec3 uE2;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uRadius;
varying vec3 vLocal;

// The share of [x - w/2, x + w/2] that lies in [a, b].
float cover(float x, float w, float a, float b) {
    return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0);
}

void main() {
    #include <logdepthbuf_fragment>
    float r = length(vLocal) / uRadius;
    // How wide the pixel is across the rings (planet radii).
    float pixel = max(length(fwidth(vLocal)) / uRadius, 1e-7);
    float theta = atan(dot(vLocal, uE2), dot(vLocal, uE1));
    vec3 view = normalize(vLocal - uCamLocal);
    // Seen at a slant, light crosses more of a ring.
    float mu = max(abs(dot(view, uAxis)), 0.02);
    // Lit face or dark face; dust brightens looking towards the Sun.
    bool litFace = sign(dot(uSunDir, uAxis)) == sign(dot(-view, uAxis));
    float forward = pow(max(dot(view, uSunDir), 0.0), 6.0);

    vec3 col = vec3(0.0);
    float alpha = 0.0;
    for (int i = 0; i < ${MAX_RINGS}; i++) {
        if (float(i) >= uRingCount) break;
        vec4 ring = uRings[i];
        vec4 tint = uRingColor[i];
        float a = ring.x;
        float b = ring.y;
        // An eccentric ring (Uranus's epsilon) swings in and out round its orbit,
        // narrowest at its nearest point, widest at its farthest.
        if (ring.w > 0.0) {
            float far = 0.5 - 0.5 * cos(theta);
            float centre = 0.5 * (a + b) - ring.w * cos(theta);
            float halfWidth = 0.5 * mix(b - a, tint.w, far);
            a = centre - halfWidth;
            b = centre + halfWidth;
        }
        float covered = cover(r, pixel, a, b);
        if (covered <= 0.0) continue;
        float depth = ring.z;
        // Neptune's arcs: clumps of dust along the Adams ring, much thicker than the rest of it.
        if (i == int(uRingCount) - 1) {
            for (int k = 0; k < ${MAX_ARCS}; k++) {
                if (float(k) >= uArcCount) break;
                vec4 arc = uArcs[k];
                float along = atan(sin(theta - arc.x), cos(theta - arc.x));
                float inArc = smoothstep(0.0, 0.004, along) * (1.0 - smoothstep(arc.y - 0.004, arc.y, along));
                depth = max(depth, arc.z * inArc);
            }
        }
        float stop = 1.0 - exp(-depth * uGain / mu);
        float dusty = 1.0 - smoothstep(0.003, 0.05, depth);
        float light = (litFace ? 1.0 : mix(0.12, 0.5, dusty)) + dusty * forward * 8.0;
        float layer = stop * covered;
        col += (1.0 - alpha) * layer * tint.rgb * light;
        alpha += (1.0 - alpha) * layer;
    }
    if (alpha < 0.0005) discard;
    // Rings this dark (Uranus's reflect a few percent of the light) only show in
    // a long exposure, which is how every picture of them was taken: from far
    // off they are brightened, as Voyager's and Webb's cameras saw them.
    col *= 1.0 + uFar * smoothstep(1.6, 4.5, length(uCamLocal) / uRadius);

    // The planet's shadow across them.
    float b2 = dot(vLocal, uSunDir);
    float c2 = dot(vLocal, vLocal) - uRadius * uRadius;
    if (b2 < 0.0 && b2 * b2 - c2 > 0.0) col *= 0.04;

    gl_FragColor = vec4(col / max(alpha, 1e-4), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

/** The narrow rings round an ice giant, drawn in its group (the planet's centre, unrotated). */
export const IceRings = ({ body, axis, rings, eye }: {
    body: ExpeditionBody;
    axis: THREE.Vector3;
    rings: NarrowRing[];
    /** The camera, relative to the planet's centre, kept up to date by the caller. */
    eye: THREE.Vector3;
}) => {
    const ring = useMemo(() => {
        const inner = Math.min(...rings.map((r) => r.inner)) - 0.02;
        const outer = Math.max(...rings.map((r) => r.outer)) + 0.02;
        const geometry = new THREE.RingGeometry(body.radius * inner, body.radius * outer, 720, 4);
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
        const frame = ringFrame(axis);
        // The arcs belong to the last ring (Neptune's Adams ring).
        const arcs = rings[rings.length - 1].arcs ?? [];
        const material = new THREE.ShaderMaterial({
            vertexShader: vertex,
            fragmentShader: fragment,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uRings: { value: Array.from({ length: MAX_RINGS }, (_, i) => (rings[i] ? new THREE.Vector4(rings[i].inner, rings[i].outer, rings[i].depth, rings[i].swing ?? 0) : new THREE.Vector4())) },
                uRingColor: { value: Array.from({ length: MAX_RINGS }, (_, i) => {
                    if (!rings[i]) return new THREE.Vector4();
                    const c = new THREE.Color(rings[i].color);
                    return new THREE.Vector4(c.r, c.g, c.b, rings[i].farWidth ?? 0);
                }) },
                uArcs: { value: Array.from({ length: MAX_ARCS }, (_, k) => (arcs[k]
                    ? new THREE.Vector4(THREE.MathUtils.degToRad(arcs[k].at), THREE.MathUtils.degToRad(arcs[k].length), arcs[k].depth, 0)
                    : new THREE.Vector4())) },
                uRingCount: { value: Math.min(rings.length, MAX_RINGS) },
                uArcCount: { value: Math.min(arcs.length, MAX_ARCS) },
                // Neptune's dust is far too faint to see by eye: brightened, as a long exposure would.
                uGain: { value: arcs.length ? 8 : 1.2 },
                uFar: { value: arcs.length ? 2 : 6 },
                uAxis: { value: axis },
                uE1: { value: frame.e1 },
                uE2: { value: frame.e2 },
                uSunDir: { value: body.sunDirection },
                uCamLocal: { value: eye },
                uRadius: { value: body.radius },
            },
        });
        return { geometry, material };
    }, [body, axis, rings, eye]);
    useEffect(() => () => { ring.geometry.dispose(); ring.material.dispose(); }, [ring]);
    return <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={1} />;
};

/** Which narrow ring a radius (planet radii) is in, for the HUD. */
export const narrowRingAt = (rings: NarrowRing[], r: number) => rings.find((ring) => r >= ring.inner - (ring.swing ?? 0) - 0.002 && r <= ring.outer + (ring.swing ?? 0) + 0.002)?.name ?? null;
