import * as THREE from 'three';
import { BLACK_HOLE } from './deepSpace';
import { pinTurn } from './motion';
import { NOISE_GLSL } from './noise';

/**
 * TON 618 as a flyable black hole: a physically informed, real-time
 * approximation (not a full general-relativistic render).
 *
 * Every pixel near it follows its light ray back from the camera along a
 * Schwarzschild null geodesic. A ray stays in the plane through the hole's
 * centre that holds its starting point and direction, so its path is one
 * equation in that plane, the Binet equation u'' = -u + 1.5 u^2 (u = 1/r,
 * lengths in Schwarzschild radii), integrated with fourth-order Runge-Kutta
 * in the angle round the hole. Rays that reach u = 1 have fallen through the
 * horizon and stay black; rays that reach u = 0 have escaped, and look up
 * the real sky in the direction they left in, so the stars and the far
 * galaxy are lensed into an Einstein ring. Where the ray's plane cuts the
 * accretion disk (at angles found exactly, every half turn) it picks up the
 * disk's light: the direct image, the far side bent up over and under the
 * shadow, and the thin photon ring of the next images.
 *
 * A camera falling freely into the hole (uFall = 1) is followed through the
 * horizon and on inside, where the same equation still holds: it sees the
 * sky through its own motion, aberrated towards where it is going, redder
 * and dimmer behind and bluer and brighter ahead, round a black region that
 * grows as it goes deeper. Nothing changes at the horizon itself.
 *
 * The disk is thin and turbulent; its light is shifted by the gas's orbital
 * motion (Doppler beaming: the side turning towards the camera brighter and
 * bluer) and by gravity, and its temperature falls outwards as a thin disk's
 * does.
 */

/** Rays are traced inside this many Schwarzschild radii; outside, lensing bends them by under 0.3 degrees. */
const SHELL = 400;

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uCamLocal;
uniform float uHorizon;
uniform float uTime;
uniform float uSteps;
uniform float uDetail;
uniform samplerCube uEnv;
uniform float uHasEnv;
// From the game's frame now to the one its sky was photographed in (DeepSpace.tsx).
uniform mat3 uEnvTurn;
uniform mat3 uToWorld;
// How fully the camera is falling freely in from far away (0 in ordinary
// flight, 1 once it is falling): its speed inwards, as an observer hovering
// there would measure it, is uFall * sqrt(r_s / r).
uniform float uFall;
// A camera's exposure: down a little close in, where the disk fills the view.
uniform float uExposure;
varying vec3 vLocal;

const float SHELL = ${SHELL.toFixed(1)};
const float R_IN = 2.2;
const float R_OUT = 13.0;

// Binet equation for light round a Schwarzschild black hole (r_s = 1):
// s = (u, du/dphi).
vec2 binet(vec2 s) {
    return vec2(s.y, -s.x + 1.5 * s.x * s.x);
}

// A float in [0, 1) from a cell.
float hash13(vec3 p) {
    return hashToUnit(hash3(uvec3(ivec3(floor(p)) + NOISE_OFFSET), 1601u));
}

// A fallback sky for before the real one has been photographed.
vec3 fallbackSky(vec3 d) {
    vec3 p = d * 180.0;
    float star = step(0.985, hash13(p)) * (1.0 - smoothstep(0.1, 0.45, length(fract(p) - 0.5)));
    return vec3(star) * 1.6 + vec3(0.012, 0.01, 0.022);
}

vec3 sky(vec3 localDirection) {
    vec3 d = normalize(uToWorld * localDirection);
    return uHasEnv > 0.5 ? textureCube(uEnv, uEnvTurn * d).rgb : fallbackSky(d);
}

// Colour of thermal light at a temperature relative to the disk's hottest
// (1 = yellow-white): red, orange, yellow, white, then blue-white.
vec3 thermal(float t) {
    vec3 c = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.36, 0.07), smoothstep(0.15, 0.5, t));
    c = mix(c, vec3(1.0, 0.72, 0.36), smoothstep(0.45, 0.85, t));
    c = mix(c, vec3(1.0, 0.94, 0.84), smoothstep(0.8, 1.2, t));
    return mix(c, vec3(0.78, 0.86, 1.0), smoothstep(1.2, 1.9, t));
}

// Light seen by a camera whose own motion shifts its frequency by g: dimmer
// and redder where it is moving away from it, brighter and whiter where it
// rushes into it. The brightening is held well short of what it would be (a
// camera's exposure would come down), and ahead it stays white, not blue.
float shiftGain(float g) {
    return clamp(pow(g, 1.5), 0.04, 1.6);
}
vec3 shifted(vec3 c, float g) {
    if (abs(g - 1.0) < 1e-3) return c;
    vec3 tint = g < 1.0 ? vec3(1.0, pow(g, 1.3), pow(g, 2.6)) : mix(vec3(1.0), vec3(0.86, 0.93, 1.0), smoothstep(1.0, 4.0, g));
    return c * tint * shiftGain(g);
}

// Light from the disk where a ray (travelling as the light does, towards the
// camera, along 'travel') leaves it at 'hit' (disk plane y = 0); 'seen' is the
// shift from the camera's own fall.
vec4 disk(vec3 hit, vec3 travel, float order, float seen) {
    float r = length(hit.xz);
    float edge = smoothstep(R_IN, R_IN + 0.5, r) * (1.0 - smoothstep(R_OUT * 0.6, R_OUT, r));
    if (edge <= 0.0) return vec4(0.0);
    // Gas orbits faster further in (Kepler), so the pattern shears into
    // spiral streaks. Noise in (cos, sin) of the angle has no seam.
    float angle = atan(hit.z, hit.x) - uTime * 0.55 * pow(r / R_IN, -1.5);
    float lr = log(r);
    vec3 q = vec3(cos(angle), sin(angle), lr * 2.2);
    float broad = fbm(q * vec3(2.2, 2.2, 1.6) + vec3(0.0, 0.0, uTime * 0.02), 1301u, 3, 2.0, 0.5);
    float streaks = fbm(vec3(cos(angle) * 5.0, sin(angle) * 5.0, lr * 26.0 + broad * 3.0), 1307u, uDetail > 0.5 ? 4 : 2, 2.0, 0.55);
    float density = edge * clamp(0.62 + broad * 0.55 + streaks * 0.5, 0.05, 1.3);
    // A thin disk's temperature: highest just outside its inner edge.
    float x = R_IN / r;
    float temperature = 1.6 * pow(x, 0.75) * pow(max(1.0 - sqrt(x) * 0.96, 0.0), 0.25);
    // Orbital speed (static observer), capped short of what the plunge region would give.
    float beta = min(sqrt(0.5 / (r - 1.0)), 0.5);
    vec3 motion = normalize(vec3(-hit.z, 0.0, hit.x));
    float g = sqrt(1.0 - 1.0 / r) * sqrt(1.0 - beta * beta) / (1.0 - beta * dot(motion, travel));
    // The camera's own fall heats the colour a little and the brightness by
    // no more than shiftGain allows.
    vec3 color = thermal(temperature * g * pow(seen, 0.3)) * density * g * g * g * shiftGain(seen) * mix(1.0, 0.8, min(order, 1.0));
    float alpha = clamp(density * 0.9, 0.0, 0.96);
    return vec4(color * 2.6, alpha);
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 ro = uCamLocal / uHorizon;
    vec3 rd = normalize(vLocal / uHorizon - ro);
    float r0 = length(ro);

    // Outside the traced shell, carry the ray in straight to it.
    float b0 = dot(ro, rd);
    float c0 = dot(ro, ro) - SHELL * SHELL;
    if (c0 > 0.0) {
        float disc = b0 * b0 - c0;
        if (disc < 0.0 || b0 > 0.0) discard;
        ro += rd * (-b0 - sqrt(disc));
        r0 = length(ro);
    }
    // Rays passing near the shell's edge blend into the unbent sky around it.
    float impact = length(cross(ro, rd));
    float blend = 1.0 - smoothstep(SHELL * 0.72, SHELL * 0.96, impact);
    if (blend < 0.002) discard;

    // The ray's plane: e1 towards the ray's start, e2 along its motion round the hole.
    vec3 e1 = ro / r0;
    vec3 normal = cross(e1, rd);
    float normalLength = length(normal);
    vec3 radiance = vec3(0.0);
    float transmittance = 1.0;
    bool captured = false;
    vec3 escape = rd;
    // The camera's fall: its speed inwards, and how that shifts the light
    // arriving along this ray (1 / (1 + v cos), cos taken from the outward).
    float a = dot(rd, e1);
    float v = uFall / sqrt(r0);
    float seen = 1.0 / max(1.0 + v * a, 1e-3);

    if (normalLength < 1e-6) {
        // Straight in or straight out.
        captured = a < 0.0;
    } else if (r0 < 1.0 && 1.0 + v * a <= 0.0) {
        // Inside the horizon, light arriving from these directions could only
        // have come up out of the hole, and none does.
        captured = true;
    } else {
        normal /= normalLength;
        vec3 e2 = cross(normal, e1);
        float b = max(dot(rd, e2), 1e-6);
        // Where it starts: u, and du/dphi for a ray seen at this angle to the
        // radial by the camera. At rest that angle is measured against a
        // hovering observer's (hence sqrt(1 - 1/r)); falling, aberration
        // carries it into theirs, and for a free fall from far away the two
        // factors cancel exactly (k = 1), which also holds inside the horizon.
        float k = uFall > 0.999 ? 1.0 : sqrt(max(1.0 - 1.0 / r0, 0.0) / max(1.0 - v * v, 1e-4));
        vec2 s = vec2(1.0 / r0, -(a + v) * k / (b * r0));
        float phi = 0.0;
        // Where the plane cuts the disk plane: y(phi) ~ e1.y cos(phi) + e2.y sin(phi) = 0,
        // every half turn from the first such angle ahead.
        float nextCross = 1e9;
        if (abs(e1.y) + abs(e2.y) > 1e-5) {
            nextCross = atan(-e1.y, e2.y);
            if (nextCross <= 1e-4) nextCross += PI;
        }
        float images = 0.0;
        // The bound is a uniform, not a constant: Direct3D's shader compiler (Windows) tries to unroll
        // a loop with a constant bound, and this one, four hundred steps with the disk inside, took it
        // long enough to stall the GPU and lose the page.
        bool escaped = false;
        int steps = int(uSteps);
        for (int i = 0; i < steps; i++) {
            // Finer steps near the photon sphere (u = 2/3), where paths wind; long ones far out
            // (beyond a few horizons the path is all but a straight line, which RK4 follows
            // closely at a fifth of a radian), where most of a ray's steps used to go.
            float h = mix(0.24, 0.075, smoothstep(0.03, 0.22, s.x));
            h = mix(h, 0.012, smoothstep(0.25, 0.62, s.x));
            // and never so long that u changes by more than a few per cent.
            h = min(h, 0.08 * max(s.x, 1.0) / max(abs(s.y), 1e-4));
            vec2 k1 = binet(s);
            vec2 k2 = binet(s + 0.5 * h * k1);
            vec2 k3 = binet(s + 0.5 * h * k2);
            vec2 k4 = binet(s + h * k3);
            vec2 next = s + h / 6.0 * (k1 + 2.0 * k2 + 2.0 * k3 + k4);
            float nextPhi = phi + h;

            if (nextPhi >= nextCross && images < 4.0) {
                float t = (nextCross - phi) / h;
                float u = mix(s.x, next.x, t);
                float du = mix(s.y, next.y, t);
                if (u > 0.0 && u < 1.0) {
                    vec3 radial = cos(nextCross) * e1 + sin(nextCross) * e2;
                    vec3 around = -sin(nextCross) * e1 + cos(nextCross) * e2;
                    vec3 hit = radial / u;
                    // Our trace runs backwards; the light travels the other way.
                    vec3 traced = normalize(radial * (-du / (u * u)) + around / u);
                    vec4 emission = disk(hit, -traced, images, seen);
                    radiance += transmittance * emission.rgb * emission.a;
                    transmittance *= 1.0 - emission.a;
                }
                images += 1.0;
                nextCross += PI;
            }
            // Heading in through the horizon (a ray that starts inside it only
            // ever heads out, until it turns).
            if (next.x >= 1.0 && next.y > 0.0) { captured = true; break; }
            if (next.x <= 0.0) {
                // Escaped: it leaves along the radial direction where u reaches 0.
                float t = s.x / max(s.x - next.x, 1e-6);
                float phiOut = phi + t * h;
                escape = cos(phiOut) * e1 + sin(phiOut) * e2;
                escaped = true;
                break;
            }
            if (transmittance < 0.01) break;
            s = next;
            phi = nextPhi;
        }
        // Out of steps or opaque: it leaves the way it was last heading round.
        if (!escaped) escape = cos(phi) * e1 + sin(phi) * e2;
    }

    vec3 color = radiance;
    if (!captured) color += transmittance * shifted(sky(escape), seen);
    color *= uExposure;
    float alpha = captured || transmittance < 0.99 ? 1.0 : blend;
    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const cameraWorld = new THREE.Vector3();
const toWorld = new THREE.Matrix4();

/** The disk lies in the plane of BLACK_HOLE.diskNormal; the shader works with it as y = 0. */
export const blackHoleOrientation = pinTurn(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), BLACK_HOLE.diskNormal));

/** Traced within this many horizon radii of TON 618 (farther, it is left out). */
export const BLACK_HOLE_REACH = 3000;

/**
 * TON 618's mesh: a sphere of SHELL Schwarzschild radii, seen from inside, in
 * which every pixel's ray is traced. `sky` is a photograph of the sky around
 * it (without it), which the escaping rays look up.
 */
export const createBlackHole = (quality: 0 | 1 | 2, sky: THREE.Texture) => {
    const inverse = new THREE.Quaternion();
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        uniforms: {
            uCamLocal: { value: new THREE.Vector3() },
            uHorizon: { value: BLACK_HOLE.horizon },
            uTime: { value: 0 },
            uSteps: { value: quality === 2 ? 400 : quality === 1 ? 280 : 170 },
            uDetail: { value: quality === 0 ? 0 : 1 },
            uEnv: { value: sky },
            uEnvTurn: { value: new THREE.Matrix3() },
            uHasEnv: { value: 0 },
            uToWorld: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(blackHoleOrientation)) },
            uFall: { value: 0 },
            uExposure: { value: 1 },
        },
    });
    const geometry = new THREE.SphereGeometry(BLACK_HOLE.horizon * SHELL, 96, 64);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    // Behind any air (Haven is deep inside the traced shell): drawn first of the see-through
    // things after the starry backdrop, so Haven's sky is laid over it as it is over the stars,
    // instead of the lensed sky being painted over Haven's day.
    mesh.renderOrder = -50;
    mesh.quaternion.copy(blackHoleOrientation);
    // Traced from whichever camera draws it: the player's, or a cube camera
    // photographing the sky beyond the wormhole.
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
        // The disk turns with the sky as the game's frame follows a world (motion.ts).
        mesh.quaternion.copy(blackHoleOrientation);
        mesh.updateMatrixWorld();
        inverse.copy(blackHoleOrientation).invert();
        (material.uniforms.uToWorld.value as THREE.Matrix3).setFromMatrix4(toWorld.makeRotationFromQuaternion(blackHoleOrientation));
        cameraWorld.setFromMatrixPosition(camera.matrixWorld).sub(mesh.position).applyQuaternion(inverse);
        material.uniforms.uCamLocal.value.copy(cameraWorld);
    };
    return { mesh, material, geometry };
};

/**
 * How much of the screen's resolution TON 618 is traced at, by detail. Every pixel near it follows a
 * light ray for up to a few hundred steps; from Haven or the far mouth (inside the traced shell)
 * that is every pixel of the sky, which on a laptop's graphics took seconds a frame and could stall
 * the GPU until the browser gave up the page. Traced at about half the width and height (a quarter
 * of the pixels) and smoothly enlarged, the hole and its disk look the same; only the hair-thin
 * photon ring is a touch softer.
 */
export const HOLE_RESOLUTION = [0.4, 0.5, 0.6] as const;

/**
 * Where the traced picture goes on screen: a sphere round the camera, further than anything near the
 * hole, that copies each pixel from the picture. It is drawn among the see-through things before any
 * air, so Haven's sky lies over it, and nothing nearer (Haven's ground, a mouth) is drawn over by it.
 */
export const createHoleView = () => {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: /* glsl */ `
            #include <common>
            #include <logdepthbuf_pars_fragment>
            uniform sampler2D uHole;
            uniform vec2 uSize;
            void main() {
                #include <logdepthbuf_fragment>
                gl_FragColor = texture2D(uHole, gl_FragCoord.xy / uSize);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        side: THREE.BackSide,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        uniforms: { uHole: { value: target.texture }, uSize: { value: new THREE.Vector2(1, 1) } },
    });
    const geometry = new THREE.SphereGeometry(1, 32, 16);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -50;
    mesh.scale.setScalar(1e10);
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
        mesh.position.setFromMatrixPosition(camera.matrixWorld);
        mesh.updateMatrixWorld();
    };
    return { target, material, geometry, mesh };
};

