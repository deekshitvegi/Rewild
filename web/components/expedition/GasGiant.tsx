import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NOISE_GLSL } from './noise';
import type { ExpeditionBody, GasGiantDef } from './bodies';
import { fromEquatorial } from './orbits';
import { cue, watchView, type ExpeditionRuntime } from './runtime';
import { directionToBody, orientationOf } from './motion';
import { eyeGain } from './surfaceShading';

const eyeDelta = new THREE.Vector3();
import { gasMapTexture } from './gasMaps';
import { RING_GLSL, SATURN_SIGHTS, ringFrame } from './rings';
import { RingParticles, ringReach } from './RingParticles';
import { IceRings } from './IceRings';
import { JOVIAN_POLES, VORTEX_SIGHTS, darkSpotDirection, nearestVortices, vortexAt } from './vortices';

/**
 * Gas giants: banded, turbulent cloud tops with a soft rim of haze, and for the
 * ringed giant a broad, dusty ring system that catches the light and falls into
 * the planet's shadow.
 */
const planetVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <logdepthbuf_vertex>
}
`;


const planetFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${RING_GLSL}
// Seen by dark-adapted eyes from a moon's night side: brighter (surfaceShading.ts eyeGain).
uniform float uEyes;
uniform vec3 uBands[4];
uniform vec3 uStorm;
uniform float uHasStorm;
uniform vec3 uAxis;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uRadius;
uniform float uDetail;
uniform float uRingInner;
uniform float uRingOuter;
uniform float uHasRings;
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uSaturation;
uniform float uBrightness;
uniform float uTime;
uniform float uFine;
uniform float uPolar;
uniform float uHexagon;
uniform vec2 uMapLat;
uniform float uHazeHeight;
uniform float uHazeLength;
uniform vec3 uHazeColor;
uniform float uRelief;
uniform float uCloak;
uniform vec4 uEye;
uniform float uInfrared;
uniform float uDecagon;
// A great storm that turns (the Great Red Spot): centre and semi-axes on the
// map, and its fastest ring's angular speed (rad/s, signed) with the length of
// one flow phase (s). x = 0: none.
uniform vec4 uVortex;
uniform vec2 uVortexSpin;
// Lightning flashes now lighting the night side: direction from the centre
// (planet frame) and brightness, 0 for none.
uniform vec4 uFlashes[6];
// An ice giant (1 Uranus, 2 Neptune; 0 neither), and Neptune's dark spot (a direction in the planet's frame).
uniform float uIce;
uniform vec3 uSpot;
varying vec3 vLocal;

vec3 rotateAbout(vec3 p, vec3 axis, float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return p * c + cross(axis, p) * s + axis * dot(axis, p) * (1.0 - c);
}

// Weather finer than the map can show. An eddy field stirs the map's own
// colours (so where a belt meets a zone they tear into festoons and swirls),
// and cloud relief sits on top. Every octave fades in only once the pixels
// are small enough to hold it, so nothing shimmers from afar. The eddies are
// squeezed north-south, as the jets stretch everything east-west.
vec3 gEddy;
float gFine;
float gHeight;
float gSeen;
float gPuff = 0.0;
void weather(vec3 P, float footprint) {
    gEddy = vec3(0.0);
    gFine = 0.0;
    gHeight = 0.0;
    gSeen = 0.0;
    vec3 Q = P + uAxis * dot(P, uAxis) * 1.6;
    float base = uRadius * 0.016;
    float we = smoothstep(1.5 * footprint, 4.0 * footprint, base);
    if (we <= 0.0) return;
    vec3 q = Q / base;
    gEddy = vec3(gnoise(q, 31u), gnoise(q + 9.7, 37u), gnoise(q + 4.1, 43u)) * we;
    float w2 = smoothstep(1.5 * footprint, 4.0 * footprint, base * 0.35);
    if (w2 > 0.0) {
        vec3 q2 = q * 2.86 + gEddy * 0.8;
        gEddy += vec3(gnoise(q2, 47u), gnoise(q2 + 9.7, 53u), gnoise(q2 + 4.1, 59u)) * 0.45 * w2;
    }
    float wavelength = base * 0.5;
    float amplitude = 1.0;
    for (int k = 0; k < 10; k++) {
        if (float(k) >= uFine) break;
        float o = smoothstep(1.5 * footprint, 4.0 * footprint, wavelength);
        if (o <= 0.0) break;
        float g = gnoise(Q / wavelength + gEddy * 1.3, 61u + uint(k) * 7u);
        // Part ridged: cloud edges are filaments and sharp boundaries, not blur.
        float v = mix(g, 0.5 - abs(g) * 2.0, 0.4);
        gFine += v * o * amplitude;
        gHeight += v * o * o * wavelength;
        gSeen += o * amplitude;
        wavelength *= 0.5;
        amplitude *= 0.8;
    }
    // Divided by the sum of all the octaves' amplitudes: detail too small to
    // see averages out, so the contrast grows as it comes into view.
    gFine /= 4.46;
    gSeen /= 4.46;
}

// Relief from a height field without a tangent frame (Mikkelsen 2010): the
// surface gradient from screen-space derivatives of the height and position.
vec3 bumped(vec3 n, vec3 p, float h) {
    vec3 sx = dFdx(p);
    vec3 sy = dFdy(p);
    vec3 r1 = cross(sy, n);
    vec3 r2 = cross(n, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    return normalize(abs(det) * n - grad);
}

// Heat seen at 5 microns (the infrared view), set by the polar features on
// top of what the cloud tops' brightness gives.
float gHeat = 0.0;

// A cyclone seen from above: spiral arms wound into a calm eye.
float cyclone(vec3 n, vec3 centre, float size, float spin) {
    vec3 d = n - centre * dot(n, centre);
    float r = length(d) / size;
    if (r > 1.6) return 0.0;
    vec3 east = normalize(cross(uAxis, centre) + vec3(1e-5));
    vec3 north = cross(centre, east);
    float a = atan(dot(d, north), dot(d, east));
    float arms = sin(a * 2.0 + spin * log(r + 0.04) * 6.0 - uTime * 0.03 * spin);
    return arms * (1.0 - smoothstep(0.5, 1.6, r)) * smoothstep(0.0, 0.25, r) - (1.0 - smoothstep(0.0, 0.3, r)) * 0.6;
}

// Bright clouds of methane ice, high over the haze, drawn out east-west by
// the jets: noise squeezed north-south into streaks.
float iceStreaks(vec3 n, float scale, uint seed) {
    vec3 Q = n + uAxis * dot(n, uAxis) * 7.0;
    return gnoise(Q * scale, seed) * 0.65 + gnoise(Q * scale * 2.3 + 3.1, seed + 5u) * 0.35;
}

// Uranus and Neptune: smooth and pale under their methane haze (which takes
// the red out of the light), nearly featureless; what little shows, as Hubble,
// Keck, the VLT and Voyager 2 saw it. Not the deep blue of old pictures:
// Voyager's images were stretched for contrast, and the true colours (Irwin
// and others, 2024) are a pale greenish blue, Neptune only a little bluer.
vec3 iceGiant(vec3 n, float lat) {
    float phi = asin(clamp(lat, -1.0, 1.0));
    float soft = fbm((n + uAxis * lat * 5.0) * 3.0, 71u, 3, 2.0, 0.5);
    vec3 col = uBands[0] * (1.0 + 0.03 * sin(phi * 9.0 + 0.4) + 0.035 * soft);
    // Where the light comes from, along the surface: high clouds cast their shadows away from it.
    vec3 toSun = uSunDir - n * dot(uSunDir, n);
    toSun *= 1.0 / max(length(toSun), 1e-4);
    if (uIce < 1.5) {
        // Uranus. Its north pole is turned to the Sun now (northern summer
        // begins in 2028), under a hood of bright haze whose sharp southern
        // edge has stayed at about 43 N for years, held there by a jet.
        float hood = smoothstep(radians(41.5), radians(44.5), phi);
        col = mix(col, uBands[2], hood * 0.8);
        col += uBands[2] * 0.06 * exp(-pow((phi - radians(44.0)) / radians(1.2), 2.0));
        col *= 1.0 - 0.07 * exp(-pow((phi - radians(34.0)) / radians(5.0), 2.0));
        col = mix(col, uBands[1], smoothstep(0.0, -0.6, lat) * 0.4);
        // A few small bright methane clouds, the storms Keck catches at mid-latitudes.
        float band = smoothstep(radians(18.0), radians(24.0), phi) * (1.0 - smoothstep(radians(36.0), radians(41.0), phi))
            + 0.6 * smoothstep(radians(-38.0), radians(-32.0), phi) * (1.0 - smoothstep(radians(-24.0), radians(-18.0), phi));
        float cloud = smoothstep(0.42, 0.72, iceStreaks(n, 30.0, 83u)) * band;
        col = mix(col, vec3(0.95, 0.99, 1.0), cloud * 0.7);
        // The north polar cyclone (VLA, 2024): small bright convective clouds
        // speckle the cap poleward of 60 N, wound round a clear, dry core on the pole.
        float rho = acos(clamp(lat, -1.0, 1.0));
        if (rho < 0.55) {
            float speck = smoothstep(0.62, 0.8, gnoise(n * 140.0, 97u) * 0.6 + gnoise(n * 300.0, 98u) * 0.4 + 0.5);
            float cap = 1.0 - smoothstep(0.3, 0.52, rho);
            float arms = cyclone(n, uAxis, 0.04, -1.0) * (1.0 - smoothstep(0.04, 0.1, rho));
            float core = 1.0 - smoothstep(0.018, 0.034, rho);
            col = mix(col, vec3(0.96, 1.0, 1.0), speck * cap * 0.55);
            col *= (1.0 + arms * 0.08) * (1.0 - core * 0.12);
            gHeat += core * 0.7 + cap * 0.08;
        }
    } else {
        // Neptune. Darker towards a collar at 60 S, a paler belt round 25 S.
        col *= 1.0 - 0.1 * exp(-pow((phi + radians(60.0)) / radians(6.0), 2.0));
        col *= 1.0 + 0.06 * exp(-pow((phi + radians(25.0)) / radians(8.0), 2.0));
        // The dark spot Hubble found in 2018 in the north (the VLT saw it from
        // the ground in 2023): an anticyclone the size of the Atlantic, dark
        // haze under the clouds, with bright companion clouds along its edge.
        vec3 spotEast = normalize(cross(uAxis, uSpot));
        vec3 spotNorth = cross(uSpot, spotEast);
        vec3 d = n - uSpot * dot(n, uSpot);
        // About 11,000 by 6,000 km (vortices.ts).
        vec2 e = vec2(dot(d, spotEast) / 0.222, dot(d, spotNorth) / 0.122);
        float inSpot = dot(n, uSpot) > 0.0 ? 1.0 - smoothstep(0.7, 1.0, length(e)) : 0.0;
        col = mix(col, uBands[3], inSpot * 0.7);
        float companion = dot(n, uSpot) > 0.0 ? exp(-pow((e.x - 0.25) / 0.85, 2.0) - pow((e.y + 1.2) / 0.22, 2.0)) : 0.0;
        // High streaks of methane cirrus in bands north and south, with their
        // shadows on the cloud deck below (Voyager 2's pictures of 1989).
        float band = smoothstep(radians(22.0), radians(28.0), phi) * (1.0 - smoothstep(radians(42.0), radians(48.0), phi))
            + smoothstep(radians(-58.0), radians(-50.0), phi) * (1.0 - smoothstep(radians(-30.0), radians(-22.0), phi)) * 0.85;
        float cloud = max(smoothstep(0.3, 0.68, iceStreaks(n, 26.0, 91u)) * band, companion);
        float shadow = smoothstep(0.3, 0.68, iceStreaks(normalize(n + toSun * 0.006), 26.0, 91u)) * band;
        col *= 1.0 - 0.28 * shadow * (1.0 - cloud);
        col = mix(col, vec3(0.95, 0.98, 1.0), cloud * 0.85);
    }
    return col;
}

// Jupiter's poles, which the Cassini map does not reach, as Juno found them:
// a cyclone over each pole ringed by others, eight in the north and five in
// the south, in blue-grey haze.
// The map, with the great storm on it turning: the storm's content is carried
// round its ellipses, fastest in the collar and still at the core, which is how
// the Great Red Spot's winds run. Two copies each carried a short way and
// cross-faded (a flow map), so it turns for ever without winding into streaks.
vec3 mapSample(vec2 uv, vec2 dx, vec2 dy) {
    if (uVortexSpin.x != 0.0) {
        vec2 e = (uv - uVortex.xy) / uVortex.zw;
        float rho = length(e);
        if (rho < 1.3) {
            float spin = uVortexSpin.x * smoothstep(0.1, 0.75, rho) * (1.0 - smoothstep(0.95, 1.3, rho));
            float phase = uTime / uVortexSpin.y;
            float pa = fract(phase);
            float pb = fract(phase + 0.5);
            float ta = -spin * (pa - 0.5) * uVortexSpin.y;
            float tb = -spin * (pb - 0.5) * uVortexSpin.y;
            vec2 a = vec2(e.x * cos(ta) - e.y * sin(ta), e.x * sin(ta) + e.y * cos(ta));
            vec2 b = vec2(e.x * cos(tb) - e.y * sin(tb), e.x * sin(tb) + e.y * cos(tb));
            vec3 ca = textureGrad(uMap, uVortex.xy + a * uVortex.zw, dx, dy).rgb;
            vec3 cb = textureGrad(uMap, uVortex.xy + b * uVortex.zw, dx, dy).rgb;
            return mix(cb, ca, 1.0 - abs(2.0 * pa - 1.0));
        }
    }
    return textureGrad(uMap, uv, dx, dy).rgb;
}

// Lightning under the cloud tops, seen from above at night as a patch of cloud
// lit from inside (Galileo, Cassini and Juno all photographed them): a bright
// core and a wider glow where the light spreads through the cloud.
vec3 lightningGlow(vec3 toFrag, float pixel) {
    // A flash lights the cloud from inside: close in, its true size, a few
    // hundred kilometres; from further off a hot core a pixel or two across
    // with a small glow round it, round on screen and the same size at any
    // distance (the bloom does the rest). Measured as the angle between this
    // pixel's line of sight and the flash's, so near the limb a flash stays a
    // point instead of smearing along it. (pixel: radians per pixel.)
    float glow = 0.0;
    for (int i = 0; i < 6; i++) {
        vec4 f = uFlashes[i];
        if (f.w <= 0.0) continue;
        vec3 at = f.xyz * uRadius;
        vec3 toFlash = at - uCamLocal;
        float range = length(toFlash);
        toFlash /= range;
        // The cloud above it, more of it towards the limb; none of it from behind the planet.
        float seen = smoothstep(0.04, 0.35, dot(f.xyz, -toFlash));
        if (seen <= 0.0) continue;
        float core = max(1.3 * pixel, 0.004 * uRadius / range);
        float halo = max(4.0 * pixel, 0.014 * uRadius / range);
        float a2 = dot(toFrag - toFlash, toFrag - toFlash);
        glow += f.w * seen * (exp(-0.5 * a2 / (core * core)) * 5.0 + exp(-0.5 * a2 / (halo * halo)) * 0.3);
    }
    return glow * vec3(0.72, 0.8, 1.0);
}

// Where vortices.ts puts them (JOVIAN_POLES), so what is seen from space is
// what one flies into: 8 cyclones 7 degrees from the north pole round one on
// it, 5 at 6 degrees round one in the south, the southern ones bigger.
vec3 jovianPole(vec3 n, float lat, vec3 base) {
    float north = lat > 0.0 ? 1.0 : 0.0;
    vec3 pole = uAxis * (lat > 0.0 ? 1.0 : -1.0);
    vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(uAxis, e1);
    float ring = mix(${JOVIAN_POLES.south.count.toFixed(1)}, ${JOVIAN_POLES.north.count.toFixed(1)}, north);
    float away = mix(${JOVIAN_POLES.south.ring}, ${JOVIAN_POLES.north.ring}, north);
    float size = mix(${JOVIAN_POLES.south.size}, ${JOVIAN_POLES.north.size}, north);
    float swirl = cyclone(n, pole, size * 0.95, mix(-1.0, 1.0, north));
    for (int i = 0; i < 8; i++) {
        if (float(i) >= ring) break;
        float a = float(i) / ring * 6.2831853 + north * ${JOVIAN_POLES.north.turn};
        vec3 c = normalize(pole * cos(away) + (e1 * cos(a) + e2 * sin(a)) * sin(away));
        swirl += cyclone(n, c, size, mix(-1.0, 1.0, north));
    }
    vec3 haze = mix(base, vec3(0.55, 0.6, 0.66), 0.55);
    return haze * (0.92 + 0.16 * swirl);
}


// Saturn's north pole as Cassini saw it: the six-sided jet stream at 78 N
// with a dark moat round it, clearer, blue-green air inside with cloud bands
// that follow the hexagon's shape, and over the pole a hurricane whose eye is
// two thousand kilometres across.
vec3 saturnNorth(vec3 n, float lat, vec3 base) {
    vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(uAxis, e1);
    float a = atan(dot(n, e2), dot(n, e1));
    float rho = acos(clamp(lat, -1.0, 1.0));
    float sector = mod(a, 1.0471976) - 0.5235988;
    // 1 on the jet (the hexagon's sides at 77.6 N, its corners at 75.6 N);
    // inside, the bands relax from the hexagon's shape to circles round the pole.
    float q = rho * cos(sector) / 0.2163;
    float shape = mix(rho / 0.2163, q, smoothstep(0.25, 0.85, rho / 0.2163));
    float lum = dot(base, vec3(0.333));
    vec3 inside = mix(base, vec3(0.5, 0.62, 0.64) * lum * 1.45, 0.62);
    inside *= 0.9 + 0.1 * sin(shape * 31.0 + gEddy.x * 0.6);
    float within = 1.0 - smoothstep(0.97, 1.0, q);
    vec3 col = mix(base, inside, within);
    // The jet: a bright ribbon of cloud streaked along its length, a dark moat outside it.
    float ribbon = 1.0 - smoothstep(0.0, 0.035, abs(q - 1.0));
    // Streaked along its length by the eddies, not in regular dashes.
    float streak = 0.84 + 0.16 * clamp(gEddy.y * 1.5 + gEddy.x * 0.5, -1.0, 1.0);
    col = mix(col, vec3(0.95, 0.92, 0.84) * lum * 1.3 * streak, ribbon * 0.82);
    float moat = smoothstep(1.03, 1.06, q) * (1.0 - smoothstep(1.1, 1.18, q));
    col *= 1.0 - moat * 0.32;
    // The polar hurricane: a dark eye, a bright eyewall, arms wound round it.
    float eye = 1.0 - smoothstep(0.012, 0.019, rho);
    float wall = smoothstep(0.012, 0.02, rho) * (1.0 - smoothstep(0.022, 0.036, rho));
    float arms = cyclone(n, uAxis, 0.06, 1.0) * (1.0 - smoothstep(0.06, 0.1, rho));
    col *= (1.0 - eye * 0.55) * (1.0 + wall * 0.35) * (1.0 + arms * 0.2);
    // Clear air lets the heat out; thick cloud (the ribbon, the arms) holds it in.
    // Inside, as Cassini saw it at 5 microns: scattered thick clouds dark
    // against the glow coming up between them.
    float thick = smoothstep(0.05, 0.6, gFine * 0.8 + gEddy.y * 0.5);
    gHeat += within * (0.06 - 0.12 - 0.5 * thick) + eye * 0.7 - ribbon * 0.4 - moat * 0.1 - arms * 0.2 - wall * 0.3;
    return col;
}

// The ten-sided wave round Saturn's south pole that Hubble found taking shape
// in 2023-25 (Sanchez-Lavega et al. 2026): the jet at 60.5 S, blowing at 116
// m/s, meanders into a decagon between 58 and 63 S, about 167,000 km round,
// that itself barely moves (2.5 m/s).
vec3 saturnSouth(vec3 n, float lat, vec3 base) {
    float rho = acos(clamp(-lat, -1.0, 1.0));
    if (rho < 0.36 || rho > 0.62) return base;
    vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
    vec3 e2 = cross(uAxis, e1);
    float a = atan(dot(n, e2), dot(n, e1));
    float sector = mod(a, 0.62831853) - 0.31415927;
    float d = (rho - 0.4974 / cos(sector)) / 0.011;
    // Poleward of the jet the air is bluer and darker, fading in over a few
    // degrees (no edge of its own); equatorward a little brighter.
    float pole = (1.0 - smoothstep(-1.0, 1.0, d)) * smoothstep(0.36, 0.45, rho);
    float equator = smoothstep(-1.0, 1.0, d) * (1.0 - smoothstep(0.55, 0.62, rho));
    vec3 col = base * mix(vec3(1.0), vec3(0.66, 0.74, 0.88), pole) * (1.0 + 0.1 * equator);
    // A dark lane along its poleward side, then the jet: a bright line of
    // cloud, streaked along its length.
    float lane = smoothstep(-4.5, -2.2, d) * (1.0 - smoothstep(-1.6, -0.6, d));
    col *= 1.0 - lane * 0.24;
    float jet = 1.0 - smoothstep(0.0, 1.1, abs(d));
    float streak = 0.86 + 0.14 * clamp(gEddy.y * 1.5 + gEddy.x * 0.5, -1.0, 1.0);
    col = mix(col, base * 1.42 * streak, jet * 0.85);
    gHeat += pole * 0.08 - jet * 0.25;
    return col;
}

// The map's last few degrees round the south pole are smeared into a star
// (every column of it meets there). Cassini found a hurricane there, about
// 8,000 km across, its eye ringed by a wall of cloud 30 to 75 km high.
vec3 saturnSouthPole(vec3 n, float lat, vec3 base) {
    float rho = acos(clamp(-lat, -1.0, 1.0));
    float smear = 1.0 - smoothstep(0.1, 0.18, rho);
    if (smear <= 0.0) return base;
    vec3 polar = textureLod(uMap, vec2(0.5, 0.035), 8.0).rgb;
    polar = mix(vec3(dot(polar, vec3(0.299, 0.587, 0.114))), polar, uSaturation) * uBrightness;
    vec3 col = mix(base, polar * (1.0 + gFine * 0.25), smear);
    float eye = 1.0 - smoothstep(0.012, 0.018, rho);
    float wall = smoothstep(0.012, 0.02, rho) * (1.0 - smoothstep(0.022, 0.038, rho));
    float arms = cyclone(n, -uAxis, 0.07, -1.0) * (1.0 - smoothstep(0.07, 0.12, rho));
    col *= (1.0 - eye * 0.5) * (1.0 + wall * 0.32) * (1.0 + arms * 0.2);
    gHeat += eye * 0.6 - wall * 0.25 - arms * 0.15;
    return col;
}

// Heat as the infrared view shows it: dark, red, orange, yellow.
vec3 thermal(float h) {
    vec3 c = mix(vec3(0.0), vec3(0.42, 0.03, 0.02), smoothstep(0.0, 0.3, h));
    c = mix(c, vec3(0.95, 0.36, 0.04), smoothstep(0.25, 0.62, h));
    c = mix(c, vec3(1.0, 0.82, 0.32), smoothstep(0.58, 0.9, h));
    return mix(c, vec3(1.08, 1.02, 0.86), smoothstep(0.9, 1.0, h));
}

void main() {
    #include <logdepthbuf_fragment>
    // Coming down into the cloud tops, the clouds round the ship take over
    // from this picture of them (the volumetric pass): it thins out near by.
    if (uCloak > 0.0) {
        float near = 1.0 - smoothstep(uRadius * 0.12, uRadius * 0.22, length(uCamLocal - vLocal));
        float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (noise < uCloak * near) discard;
    }
    vec3 n = normalize(vLocal);
    // Near a hurricane, its eye opens: the clouds round the ship (the volumetric
    // pass) show the way down it, under walls of cloud.
    if (uEye.w > 0.0 && dot(n, uEye.xyz) > cos(uEye.w)) discard;
    float lat = dot(n, uAxis);
    float footprint = length(fwidth(vLocal));
    // This pixel's line of sight, and how wide a pixel is (radians).
    vec3 toFrag = normalize(vLocal - uCamLocal);
    float pixelAngle = length(fwidth(toFrag));
    weather(n * uRadius, footprint);
    gHeat = 0.0;
    vec3 col;
    if (uHasMap > 0.5) {
        // The real planet (NASA), wrapped around its own axis. The derivative of
        // whichever longitude has no seam here keeps the mipmaps from drawing a
        // line where the map wraps.
        vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
        vec3 e2 = cross(uAxis, e1);
        float u = atan(dot(n, e2), dot(n, e1)) / 6.2831853 + 0.5;
        float v = asin(clamp(lat, -1.0, 1.0)) / 3.14159265 + 0.5;
        vec2 uvA = vec2(u, v);
        vec2 uvB = vec2(fract(u + 0.5), v);
        bool useB = fwidth(uvB.x) < fwidth(uvA.x);
        vec2 dx = useB ? dFdx(uvB) : dFdx(uvA);
        vec2 dy = useB ? dFdy(uvB) : dFdy(uvA);
        // Stir the map with the eddies: up to a few of its pixels along the
        // surface, more east-west than north-south.
        vec3 east = normalize(cross(uAxis, n) + vec3(1e-6));
        vec3 northward = cross(n, east);
        float base = uRadius * 0.016;
        float cosLat = max(sqrt(max(1.0 - lat * lat, 0.0)), 0.05);
        vec2 stir = vec2(dot(gEddy, east) * base * 0.34 / (6.2831853 * uRadius * cosLat), dot(gEddy, northward) * base * 0.16 / (3.14159265 * uRadius));
        vec2 uv = uvA + stir;
        col = mapSample(uv, dx, dy);
        col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uSaturation) * uBrightness;
        // Where the map has no data (Jupiter's poles), the poles as Juno saw them.
        if (uPolar > 0.5) {
            float inside = smoothstep(uMapLat.x, uMapLat.x + 0.035, v) * (1.0 - smoothstep(uMapLat.y - 0.035, uMapLat.y, v));
            if (inside < 1.0) col = mix(jovianPole(n, lat, col), col, inside);
        }
        // Band edges churn hardest: there the jets shear past each other.
        float across = 0.004;
        float l1 = dot(textureGrad(uMap, vec2(uv.x, uv.y + across), dx, dy).rgb, vec3(0.333));
        float l2 = dot(textureGrad(uMap, vec2(uv.x, uv.y - across), dx, dy).rgb, vec3(0.333));
        float shear = smoothstep(0.0, 0.12, abs(l1 - l2));
        float bright = dot(col, vec3(0.333));
        // Bright ammonia cloud tops whiter, the deep belts browner.
        float amount = (0.55 + 0.6 * shear) * mix(1.15, 0.85, bright);
        col *= 1.0 + gFine * amount;
        // Close in, the cloud tops break into puffs with crisp edges, whitest
        // over the bright zones, and the gaps between them show deeper, browner
        // cloud: what Juno's camera sees from a few thousand kilometres.
        float seen = smoothstep(0.08, 0.45, gSeen);
        gPuff = smoothstep(-0.02, 0.2, gFine * 2.6 + (bright - 0.5) * 0.5) * seen;
        float lum = dot(col, vec3(0.333));
        col = mix(col, col * vec3(0.82, 0.74, 0.66), (1.0 - gPuff) * seen * (0.35 + 0.4 * shear));
        col = mix(col, vec3(lum) * vec3(1.06, 1.03, 0.98) * 1.08, gPuff * 0.38);
    } else if (uIce > 0.5) {
        col = iceGiant(n, lat);
    } else {
        vec3 warp = vec3(fbm(n * 3.0, 5u, 3, 2.0, 0.5), fbm(n * 3.0 + 7.1, 9u, 3, 2.0, 0.5), 0.0);
        float turbulence = fbm(vec3(n.x * 9.0, lat * 34.0, n.z * 9.0) + warp * 2.2, 17u, int(uDetail), 2.0, 0.55);
        float bandCoord = lat * 7.5 + turbulence * 0.35 + gEddy.y * 0.002;
        float b = 0.5 + 0.5 * sin(bandCoord * 3.14159);
        float b2 = 0.5 + 0.5 * sin(bandCoord * 7.3 + 1.7);
        col = mix(uBands[0], uBands[1], b);
        col = mix(col, uBands[2], smoothstep(0.55, 0.95, b2) * 0.6);
        col = mix(col, uBands[3], smoothstep(0.6, 1.0, abs(lat)) * 0.5);
        col *= 0.9 + turbulence * 0.25;
        col *= 1.0 + gFine * 0.3;
    }
    if (uHexagon > 0.5 && lat > 0.85) col = saturnNorth(n, lat, col);
    if (uDecagon > 0.5 && lat < -0.8) col = saturnSouth(n, lat, col);
    if (uDecagon > 0.5 && uHasMap > 0.5 && lat < -0.98) col = saturnSouthPole(n, lat, col);
    if (uHasStorm > 0.5 && uHasMap < 0.5) {
        vec3 stormCenter = normalize(vec3(0.62, -0.28, 0.73));
        vec3 q = n - stormCenter;
        float storm = exp(-(dot(q.xz, q.xz) * 90.0 + q.y * q.y * 260.0));
        col = mix(col, uStorm, storm * 0.85);
    }

    // What the infrared view sees: heat from deep inside escaping where the
    // clouds are thin, whatever the time of day.
    float heat = clamp(1.0 - smoothstep(0.3, 0.85, dot(col, vec3(0.333))) + gHeat + gFine * 0.12, 0.0, 1.0);

    // Sunlight, with the cloud relief standing up into it.
    float ndl = dot(n, uSunDir);
    float light = smoothstep(-0.12, 0.35, ndl) * (0.35 + 0.65 * max(ndl, 0.0));
    vec3 nb = bumped(n, vLocal, (gHeight + gPuff * uRadius * 0.0004) * uRelief);
    float relief = clamp((dot(nb, uSunDir) + 0.08) / max(ndl + 0.08, 0.03), 0.35, 1.8);
    col *= light * mix(1.0, relief, smoothstep(-0.05, 0.1, ndl));
    // Lightning shows where the sun does not drown it: on the night side.
    float night = 1.0 - smoothstep(-0.2, 0.05, ndl);
    if (night > 0.0) col += lightningGlow(toFrag, pixelAngle) * night;

    // The haze above the cloud tops, as much of it as the line of sight
    // crosses: a little looking straight down, a lot at the limb, and towards
    // the horizon when flying low over them.
    vec3 toCamera = uCamLocal - vLocal;
    float dist = length(toCamera);
    float mu = dot(n, toCamera / max(dist, 1e-3));
    float H = uHazeHeight;
    float exitPath = -uRadius * mu + sqrt(uRadius * uRadius * mu * mu + 2.0 * uRadius * H + H * H);
    float through = exp(-min(dist, exitPath) / uHazeLength);
    vec3 haze = uHazeColor * smoothstep(-0.25, 0.4, ndl) * (0.45 + 0.55 * max(ndl, 0.0));
    col = col * through + haze * (1.0 - through);

    // Shadow cast by the rings onto the cloud tops.
    if (uHasRings > 0.5) {
        float denom = dot(uSunDir, uAxis);
        if (abs(denom) > 1e-3) {
            float t = -dot(vLocal, uAxis) / denom;
            if (t > 0.0) {
                vec3 hit = vLocal + uSunDir * t;
                float r = length(hit) / uRadius;
                col *= 1.0 - ringDensity(r) * 0.7;
            }
        }
    }

    if (uInfrared > 0.0) {
        // Seen at a slant the heat comes through more cold haze: darker at the limb.
        float slant = clamp(dot(n, normalize(uCamLocal - vLocal)), 0.0, 1.0);
        col = mix(col, thermal(heat * 0.92 * (0.55 + 0.45 * slant)), uInfrared);
    }

    gl_FragColor = vec4(col * uEyes, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const ringFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
${RING_GLSL}
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform vec3 uAxis;
uniform float uRadius;
uniform vec3 uNear;
uniform float uInfrared;
varying vec3 vLocal;

void main() {
    #include <logdepthbuf_fragment>
    float r = length(vLocal) / uRadius;
    float footprint = length(fwidth(vLocal));
    // Thousands of ringlets: fine radial structure that never repeats. They
    // are circles, so close to (a few tens of metres a pixel) they would draw
    // long unbroken stripes running off to the horizon; there the clumps the
    // ring is made of take over, and the ringlets show from further away.
    float ringletShow = mix(0.2, 1.0, smoothstep(80.0, 600.0, footprint));
    float ringlets = (gnoise(vec3(r * 900.0, 0.5, 0.5), 3u) * 0.5 + gnoise(vec3(r * 3100.0, 1.5, 0.5), 7u) * 0.3) * ringletShow;
    float density = ringDensity(r) * (0.86 + ringlets * 0.22);
    if (density < 0.004) discard;

    // Close to, the ice is not smooth: in the A and B rings the pieces clump
    // into strands a few hundred metres long (self-gravity wakes) slanted
    // about twenty degrees to their orbit, and those into clumps. From a few
    // kilometres away they give the sheet its grain, before single pieces can
    // be seen. Measured round the ring from the eye, so the seam is on the
    // far side.
    float grain = 1.0 - smoothstep(12.0, 70.0, footprint);
    float shade = 1.0;
    if (grain > 0.0) {
        vec3 e1 = normalize(cross(uAxis, abs(uAxis.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
        vec3 e2 = cross(uAxis, e1);
        float turn = atan(dot(vLocal, e2), dot(vLocal, e1)) - atan(dot(uCamLocal, e2), dot(uCamLocal, e1));
        turn = atan(sin(turn), cos(turn));
        float s = r * uRadius * turn;
        float t = r * uRadius - length(uCamLocal - uAxis * dot(uCamLocal, uAxis));
        vec2 st = vec2(s * 0.94 + t * 0.34, t * 0.94 - s * 0.34);
        float w = gnoise(vec3(st.x / 90.0, st.y / 26.0, 0.0), 11u) + 0.6 * gnoise(vec3(st / 14.0, 3.0), 13u);
        float wakes = smoothstep(1.5, 1.6, r) * (1.0 - smoothstep(1.93, 1.95, r)) * 0.35 + smoothstep(2.02, 2.04, r) * (1.0 - smoothstep(2.25, 2.27, r)) * 0.6;
        density = clamp(density * (1.0 + w * wakes * grain), 0.0, 1.0);
        shade *= 1.0 + w * wakes * grain * 0.25;

        // Beyond the pieces drawn one by one (RingParticles.tsx) the ring is
        // still made of them: a carpet of ice blocks, at most one in each
        // square of 16 m, the biggest seen as blocks from a kilometre or two
        // away, the rest a glitter that melts into the sheet further off.
        float carpetView = 1.0 - smoothstep(8.0, 40.0, footprint);
        if (carpetView > 0.0) {
            vec2 q = vec2(s, t) / 16.0 + 65536.0;
            vec2 base = floor(q);
            float piece = 0.0;
            for (int j = -1; j <= 1; j++) {
                for (int i = -1; i <= 1; i++) {
                    vec2 c = base + vec2(float(i), float(j));
                    uint h = hash3(uvec3(uvec2(c), 7u), 9301u);
                    if (hashToUnit(h) > 0.75) continue;
                    vec2 centre = c + 0.15 + 0.7 * vec2(hashToUnit(hashU32(h)), hashToUnit(hashU32(h + 1u)));
                    float u = hashToUnit(hashU32(h + 2u));
                    float metres = mix(0.6, 6.0, u * u * u);
                    float d = length(q - centre) * 16.0 / metres;
                    float edge = clamp(footprint / metres, 0.05, 1.0);
                    piece = max(piece, (1.0 - smoothstep(1.0 - edge, 1.0 + edge, d)) * min(1.0, metres / max(footprint, 1e-3)));
                }
            }
            shade *= mix(1.0, 0.94 + piece * 0.9, carpetView * smoothstep(0.004, 0.05, density));
        }
    }

    // Dusty C ring grey-brown, bright B ring cream, A ring a little darker.
    vec3 cream = uColor;
    vec3 dust = vec3(0.42, 0.38, 0.33);
    float bright = smoothstep(1.5, 1.6, r) * (1.0 - smoothstep(1.93, 1.96, r));
    vec3 col = mix(dust, cream, bright * 0.9 + 0.1) * (0.9 + ringlets * 0.15);
    col = mix(col, cream * 0.85, smoothstep(2.0, 2.05, r)) * shade;

    // Sunlit from above or below, a little brighter seen against the sun.
    vec3 view = normalize(uCamLocal - vLocal);
    float sunSide = sign(dot(uSunDir, uAxis));
    float viewSide = sign(dot(view, uAxis));
    float lit = sunSide == viewSide ? 1.0 : 0.45 + 0.35 * (1.0 - density);

    // The planet's shadow across the rings.
    vec3 p = vLocal;
    float b = dot(p, uSunDir);
    float c = dot(p, p) - uRadius * uRadius;
    float shadow = (b < 0.0 && b * b - c > 0.0) ? 0.08 : 1.0;
    // Up close the sheet gives way to the pieces it is made of (RingParticles.tsx);
    // only the dust too fine to draw stays, as a faint haze.
    float alpha = clamp(density, 0.0, 0.97) * mix(uNear.z, 1.0, smoothstep(uNear.x, uNear.y, length(uCamLocal - vLocal)));
    // Ice at a hundred kelvin gives off no heat to see: in the infrared, a dark band.
    col = mix(col * lit * shadow * 1.1, vec3(0.02, 0.025, 0.035), uInfrared);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const scenePosition = new THREE.Vector3();
const eyeLocal = new THREE.Vector3();

/** Flashes lit at once (uFlashes). */
const FLASHES = 6;

interface Flash { dir: THREE.Vector3; age: number; life: number; strokes: number; power: number }

/**
 * The storms that flash, fixed on the planet like the map: three cells along
 * each of the giant's lightning latitudes, a third of the way round from one
 * another. Directions
 * are in the planet's frame, the same one the shader's map is wrapped in.
 */
const stormCells = (gas: GasGiantDef, axis: THREE.Vector3) => {
    const e1 = new THREE.Vector3().crossVectors(axis, Math.abs(axis.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1);
    let seed = 7919;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    // Three storms along each latitude, so some are always on the side in view.
    return (gas.lightning?.latitudes ?? []).flatMap((latitude) => [0, 1, 2].map((k) => ({ latitude, k }))).map(({ latitude, k }) => {
        const lat = THREE.MathUtils.degToRad(latitude);
        const lon = (k + random() * 0.8) * (Math.PI * 2 / 3);
        return e1.clone().multiplyScalar(Math.cos(lat) * Math.cos(lon))
            .addScaledVector(e2, Math.cos(lat) * Math.sin(lon))
            .addScaledVector(axis, Math.sin(lat))
            .normalize();
    });
};

const flashSide = new THREE.Vector3();

const URANUS_RINGS = 'Thirteen narrow rings, found in 1977 when they hid a star from astronomers flying in NASA\'s Kuiper Airborne Observatory, years before Voyager 2 saw them. Unlike Saturn\'s bright ice they are as dark as charcoal: chunks a metre or so across coated in carbon darkened by radiation. The brightest, epsilon, is only 20 to 96 km wide and not quite round.';

export const GasGiant = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const gas = body.gas!;
    const groupRef = useRef<THREE.Group>(null);
    // The planet's real axis, so its bands and rings are tilted as they are.
    const axis = useMemo(() => fromEquatorial(gas.pole[0], gas.pole[1]), [gas]);
    const detail = runtime.quality === 0 ? 3 : 5;
    const reach = ringReach(runtime.quality);

    // The real planet's cloud tops, from NASA imagery already in the site.
    const map = useMemo(() => (gas.map ? gasMapTexture(gas.map) : null), [gas]);

    const planet = useMemo(() => {
        const geometry = new THREE.SphereGeometry(body.radius, 128, 96);
        const material = new THREE.ShaderMaterial({
            vertexShader: planetVertex,
            fragmentShader: planetFragment,
            uniforms: {
                uBands: { value: gas.bands.map((c) => new THREE.Color(c)) },
                uStorm: { value: new THREE.Color(gas.storm ?? '#000000') },
                uHasStorm: { value: gas.storm ? 1 : 0 },
                uAxis: { value: axis },
                uSunDir: { value: body.sunDirection },
                uCamLocal: { value: new THREE.Vector3() },
                uRadius: { value: body.radius },
                uDetail: { value: detail },
                uRingInner: { value: gas.rings?.inner ?? 0 },
                uRingOuter: { value: gas.rings?.outer ?? 0 },
                uHasRings: { value: gas.rings ? 1 : 0 },
                uMap: { value: map },
                uHasMap: { value: map ? 1 : 0 },
                uSaturation: { value: gas.saturation ?? 1 },
                uBrightness: { value: gas.brightness ?? 1 },
                uTime: { value: 0 },
                uFine: { value: [6, 9, 10][runtime.quality] },
                uPolar: { value: gas.polarCyclones ? 1 : 0 },
                uHexagon: { value: gas.hexagon ? 1 : 0 },
                uMapLat: { value: new THREE.Vector2(...(gas.mapLatitudes ?? [0, 1])) },
                uHazeHeight: { value: body.radius * 0.012 },
                uHazeLength: { value: body.radius * 0.012 * (gas.haze?.clarity ?? 16) },
                uHazeColor: { value: new THREE.Color(gas.haze?.color ?? gas.bands[0]) },
                uRelief: { value: 0.05 },
                uCloak: { value: 0 },
                uEye: { value: new THREE.Vector4() },
                uInfrared: { value: 0 },
                uDecagon: { value: gas.decagon ? 1 : 0 },
                uVortex: { value: gas.vortex && map ? new THREE.Vector4(...gas.vortex.at, ...gas.vortex.size) : new THREE.Vector4() },
                uVortexSpin: { value: gas.vortex && map ? new THREE.Vector2(gas.vortex.turn * Math.PI * 2 / gas.vortex.period, 6) : new THREE.Vector2(0, 1) },
                uFlashes: { value: Array.from({ length: FLASHES }, () => new THREE.Vector4()) },
                uIce: { value: gas.ice === 'uranus' ? 1 : gas.ice === 'neptune' ? 2 : 0 },
                uSpot: { value: gas.darkSpot ? darkSpotDirection(body) : new THREE.Vector3(0, 1, 0) },
                uEyes: { value: 1 },
            },
        });
        return { geometry, material };
    }, [body, gas, axis, detail, map, runtime.quality]);

    const ring = useMemo(() => {
        if (!gas.rings) return null;
        const geometry = new THREE.RingGeometry(body.radius * gas.rings.inner, body.radius * gas.rings.outer, 512, 8);
        // RingGeometry lies in XY; turn it so its normal is the planet's axis.
        const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
        geometry.applyQuaternion(align);
        const material = new THREE.ShaderMaterial({
            vertexShader: planetVertex,
            fragmentShader: ringFragment,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            uniforms: {
                uColor: { value: new THREE.Color(gas.rings.color) },
                uSunDir: { value: body.sunDirection },
                uCamLocal: { value: new THREE.Vector3() },
                uAxis: { value: axis },
                uRadius: { value: body.radius },
                uNear: { value: new THREE.Vector3(reach * 0.45, reach * 1.05, 0.16) },
                uInfrared: { value: 0 },
            },
        });
        return { geometry, material };
    }, [body, gas, axis, reach]);
    const frame = useMemo(() => ringFrame(axis), [axis]);
    // The camera relative to the planet, for the ice giants' rings.
    const ringEye = useMemo(() => new THREE.Vector3(), []);
    const lightning = useMemo(() => (gas.lightning ? {
        cells: stormCells(gas, axis),
        flashes: Array.from({ length: FLASHES }, (): Flash => ({ dir: new THREE.Vector3(), age: 99, life: 1, strokes: 1, power: 0 })),
        next: 0,
    } : null), [gas, axis]);

    // DEV: tests read the giants' materials back (evals/flashinfo.js).
    useEffect(() => {
        if (!import.meta.env.DEV) return undefined;
        const debug = window as unknown as { __giants?: Record<string, THREE.ShaderMaterial> };
        debug.__giants = { ...(debug.__giants ?? {}), [body.id]: planet.material };
        return () => { if (debug.__giants) delete debug.__giants[body.id]; };
    }, [body, planet]);
    useEffect(() => () => {
        planet.geometry.dispose(); planet.material.dispose();
        ring?.geometry.dispose(); ring?.material.dispose();
    }, [planet, ring]);

    // Lightning seen from space: now and then a flash in one of the storms, a
    // few hundred kilometres of cloud lit from inside, flickering as the
    // stroke re-strikes two to four times in under half a second.
    const updateLightning = (state: NonNullable<typeof lightning>, dt: number) => {
        const flashes = planet.material.uniforms.uFlashes.value as THREE.Vector4[];
        directionToBody(runtime.motion, body, eyeLocal.copy(runtime.camera).sub(body.position), eyeLocal);
        const distance = eyeLocal.length();
        const watching = distance < body.radius * 40 && distance > body.radius && !runtime.infrared && state.cells.length > 0;
        if (watching) {
            state.next -= dt;
            if (state.next <= 0) {
                state.next = -Math.log(Math.max(1e-6, Math.random())) / gas.lightning!.rate;
                const slot = state.flashes.reduce((oldest, f) => (f.age > oldest.age ? f : oldest), state.flashes[0]);
                const cell = state.cells[Math.floor(Math.random() * state.cells.length)];
                // Somewhere in the storm, which is a few hundred kilometres across.
                flashSide.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
                flashSide.addScaledVector(cell, -flashSide.dot(cell)).normalize();
                slot.dir.copy(cell).addScaledVector(flashSide, Math.random() * 0.012).normalize();
                slot.age = 0;
                slot.life = 0.25 + Math.random() * 0.3;
                slot.strokes = 2 + Math.floor(Math.random() * 3);
                slot.power = 0.6 + Math.random() * 0.9;
            }
        }
        // DEV: window.__flashTest lights the six storms nearest the middle of
        // the view at once and holds them, for a screenshot.
        const test = import.meta.env.DEV && (window as unknown as { __flashTest?: boolean }).__flashTest;
        const nearest = test ? [...state.cells].sort((a, b) => b.dot(eyeLocal) - a.dot(eyeLocal)) : [];
        // DEV: window.__flashAtEye puts one flash right under the camera, the rest off.
        const atEye = import.meta.env.DEV && (window as unknown as { __flashAtEye?: boolean }).__flashAtEye;
        state.flashes.forEach((f, i) => {
            if (atEye) {
                const d = eyeLocal.clone().normalize();
                flashes[i].set(d.x, d.y, d.z, i === 0 ? 1.5 : 0);
                return;
            }
            if (test) {
                const cell = nearest[i % nearest.length];
                flashes[i].set(cell.x, cell.y, cell.z, 1.5);
                return;
            }
            f.age += dt;
            const t = f.age / f.life;
            if (!watching || t >= 1) {
                flashes[i].w = 0;
                return;
            }
            // Each stroke bright, the gaps between them dim, all of it fading.
            const stroke = (t * f.strokes) % 1 < 0.45 ? 1 : 0.18;
            flashes[i].set(f.dir.x, f.dir.y, f.dir.z, f.power * stroke * Math.sqrt(1 - t));
        });
    };

    useFrame(({ clock }, delta) => {
        const group = groupRef.current;
        if (!group) return;
        scenePosition.copy(body.position).sub(runtime.origin);
        group.position.copy(scenePosition);
        // Turning at its own rate (motion.ts); rings, storms and all.
        group.quaternion.copy(orientationOf(runtime.motion, body));
        planet.material.uniforms.uTime.value = clock.elapsedTime;
        planet.material.uniforms.uEyes.value = body === runtime.currentBody ? 1 : eyeGain(runtime.nightEyes);
        // The infrared view eases in and out.
        const infrared = planet.material.uniforms.uInfrared;
        infrared.value = THREE.MathUtils.damp(infrared.value, runtime.infrared ? 1 : 0, 6, Math.min(delta, 0.1));
        if (ring) ring.material.uniforms.uInfrared.value = infrared.value;
        if (lightning) updateLightning(lightning, Math.min(delta, 0.1));
        // Flying through Uranus's rings: dark boulders, a ring as black as coal.
        if (gas.narrowRings && gas.ice === 'uranus' && !runtime.stats.visited.includes('uranus-rings')) {
            directionToBody(runtime.motion, body, eyeLocal.copy(runtime.camera).sub(body.position), eyeLocal);
            const up = eyeLocal.dot(axis);
            const r = Math.sqrt(Math.max(0, eyeLocal.lengthSq() - up * up)) / body.radius;
            if (Math.abs(up) < 600 && r > 1.6 && r < 2.03) {
                runtime.stats.visited.push('uranus-rings');
                runtime.scan.found = { name: "Uranus's rings", blurb: URANUS_RINGS, label: 'Discovery' };
                runtime.scan.foundAt = performance.now() / 1000;
                cue(runtime, 'scan', 0.8);
            }
        }
        // Flying into one of the great vortices finds it (below the top of its walls).
        if (runtime.gas) {
            directionToBody(runtime.motion, body, eyeLocal.copy(runtime.camera).sub(body.position), eyeLocal);
            const found = vortexAt(body, eyeLocal);
            if (found && found.rel < 0.9 && !runtime.stats.visited.includes(found.vortex.sight)) {
                runtime.stats.visited.push(found.vortex.sight);
                runtime.scan.found = { ...VORTEX_SIGHTS[found.vortex.sight], label: 'Discovery' };
                runtime.scan.foundAt = performance.now() / 1000;
                cue(runtime, 'scan', 0.8);
            }
        }
        // Flying over Saturn's polar storms finds them.
        if (gas.hexagon || gas.decagon) {
            directionToBody(runtime.motion, body, eyeLocal.copy(runtime.camera).sub(body.position), eyeLocal);
            const distance = eyeLocal.length();
            if (distance < body.radius * 1.6) {
                const lat = eyeLocal.dot(axis) / distance;
                const sight = gas.hexagon && lat > 0.95 ? 'hexagon' : gas.decagon && lat < -0.82 && lat > -0.95 ? 'decagon' : null;
                if (sight && !runtime.stats.visited.includes(sight)) {
                    runtime.stats.visited.push(sight);
                    runtime.scan.found = { ...SATURN_SIGHTS[sight], label: 'Discovery' };
                    runtime.scan.foundAt = performance.now() / 1000;
                    cue(runtime, 'scan', 0.8);
                }
            }
        }
    }, -1);
    useEffect(() => watchView(runtime, (eye) => {
        const group = groupRef.current;
        if (!group) return;
        directionToBody(runtime.motion, body, eyeDelta.copy(eye).sub(group.position), planet.material.uniforms.uCamLocal.value);
        // Within the top deck, with volumetric clouds drawn, the map gives way to them.
        const height = planet.material.uniforms.uCamLocal.value.length() - body.radius;
        planet.material.uniforms.uCloak.value = runtime.quality > 0 ? 1 - THREE.MathUtils.smoothstep(height, 0, 700) : 0;
        // A hurricane's eye within sight of the clouds round the ship opens up.
        const opening = planet.material.uniforms.uEye.value as THREE.Vector4;
        opening.w = 0;
        if (runtime.quality > 0 && height < 30000) {
            const near = nearestVortices(body, planet.material.uniforms.uCamLocal.value, 2).find((n) => n.v.kind === 'eye' && n.gap < 40000);
            if (near) opening.set(near.v.dir.x, near.v.dir.y, near.v.dir.z, (near.v.eye * 1.05) / body.radius);
        }
        if (ring) ring.material.uniforms.uCamLocal.value.copy(planet.material.uniforms.uCamLocal.value);
        ringEye.copy(planet.material.uniforms.uCamLocal.value);
    }), [runtime, planet, ring, ringEye, body]);

    return (
        <group ref={groupRef}>
            <mesh geometry={planet.geometry} material={planet.material} frustumCulled={false} />
            {ring && <mesh geometry={ring.geometry} material={ring.material} frustumCulled={false} renderOrder={1} />}
            {ring && <RingParticles body={body} runtime={runtime} frame={frame} />}
            {gas.narrowRings && <IceRings body={body} axis={axis} rings={gas.narrowRings} eye={ringEye} />}
        </group>
    );
};
