import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ageRipples, screenFx, screenFxActive } from './spacetime';
import { compileSafely } from './compileSafely';

/**
 * Bending the finished frame (spacetime.ts screenFx): the pulse drive's bubble and the sky squeezed
 * towards the heading, ripples in space, the crossing's flash. After everything else has drawn the
 * frame (the post-processing at Medium and High, the plain render at Low), the frame is copied into a
 * texture and drawn back through one full-screen triangle that samples it bent. It works on the frame
 * as shown (tone mapped, sRGB), so nothing else in the scene needs another shader for it.
 *
 * Mounted only while something is bending the frame: when nothing is, there is no copy and no draw
 * (ScreenWarpWatch). A frame callback above priority 0 draws the frame itself in React Three Fiber;
 * at Low, where nothing else does, this one renders the scene first.
 */

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uFrame;
uniform float uAspect;
uniform vec2 uApex;
uniform float uCompress;
uniform vec2 uBubble;
uniform float uBubbleRadius;
uniform float uWall;
uniform float uShift;
uniform vec4 uRippleA;
uniform vec4 uRippleB;
uniform vec2 uRippleWidth;
uniform float uFlash;
varying vec2 vUv;

// Frame coordinates (0..1) <-> screen heights about the middle.
vec2 toScreen(vec2 uv) { return vec2((uv.x - 0.5) * uAspect, uv.y - 0.5); }
vec2 toUv(vec2 p) { return vec2(p.x / uAspect + 0.5, p.y + 0.5); }

// A ring running out: the light just inside it is pushed out and just outside it pulled in (one wave).
vec2 ripple(vec2 p, vec4 r, float width) {
    if (r.w <= 0.0) return vec2(0.0);
    vec2 c = toScreen(r.xy);
    vec2 d = p - c;
    float len = max(length(d), 1e-4);
    float x = (len - r.z) / width;
    float wave = -x * exp(-x * x);
    return d / len * wave * r.w * width;
}

vec3 sampleFrame(vec2 uv) {
    // Sampled within the frame (its edge held, faded below).
    return texture2D(uFrame, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
    vec2 p = toScreen(vUv);
    vec2 b = toScreen(uBubble);
    float rb = length(p - b);
    // 0 inside the bubble (flat space round the ship), 1 outside it.
    float outside = smoothstep(uBubbleRadius * 0.92, uBubbleRadius * 1.18, rb);

    // The sky outside drawn in towards the heading. Distance from the apex is taken as a fraction rho of
    // the way to the frame's edge in that direction, and a point at rho shows what lies at rho + k rho (1 - rho):
    // everything moves in, most half way out, and nothing is fetched from beyond the edge (no dark border).
    vec2 a = toScreen(uApex);
    vec2 fromApex = p - a;
    float r = length(fromApex);
    vec2 u = fromApex / max(r, 1e-5);
    vec2 halfSize = vec2(0.5 * uAspect, 0.5);
    vec2 safeU = sign(u) * max(abs(u), vec2(1e-4)) + vec2(u.x == 0.0 ? 1e-4 : 0.0, u.y == 0.0 ? 1e-4 : 0.0);
    vec2 exits = max((halfSize - a) / safeU, (-halfSize - a) / safeU);
    float reach = max(min(exits.x, exits.y), 1e-3);
    float rho = clamp(r / reach, 0.0, 1.0);
    float k = clamp(uCompress, -1.0, 1.0) * 0.9 * outside;
    vec2 q = a + u * (rho + k * rho * (1.0 - rho)) * reach;
    if (r > reach) q = p;

    // The bubble's wall: a thin lens, light just outside it bent round the ship.
    vec2 radial = (p - b) / max(rb, 1e-4);
    float x = (rb - uBubbleRadius) / max(uBubbleRadius * 0.11, 1e-4);
    q += radial * (-x * exp(-x * x)) * uWall * uBubbleRadius * 0.16;

    q += ripple(p, uRippleA, uRippleWidth.x) + ripple(p, uRippleB, uRippleWidth.y);

    vec2 uv = toUv(q);
    // Bent light comes apart a little by colour, as it does through any lens.
    vec2 moved = uv - vUv;
    vec3 color = vec3(sampleFrame(uv + moved * 0.08).r, sampleFrame(uv).g, sampleFrame(uv - moved * 0.08).b);

    // Doppler: light from ahead bluer and brighter, from the sides redder and dimmer (outside the bubble).
    if (uShift > 0.0) {
        vec3 lin = color * color;
        float toward = 1.0 - smoothstep(0.05, 0.9, r);
        float D = mix(1.0 - 0.24 * uShift, 1.0 + 0.7 * uShift, toward);
        D = mix(1.0, D, outside);
        vec3 blue = vec3(0.5, 0.8, 1.45);
        vec3 red = vec3(1.28, 0.84, 0.62);
        vec3 tint = D >= 1.0 ? mix(vec3(1.0), blue, clamp((D - 1.0) * 2.4, 0.0, 1.0)) : mix(vec3(1.0), red, clamp((1.0 - D) * 4.5, 0.0, 1.0));
        lin *= tint * pow(D, 1.6);
        color = sqrt(max(lin, 0.0));
    }
    color = mix(color, vec3(1.0), clamp(uFlash, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
}
`;

const size = new THREE.Vector2();

/** The pass's scene: one triangle over the frame. Made once and kept, so its shader is compiled once. */
let shared: { material: THREE.ShaderMaterial; geometry: THREE.BufferGeometry; scene: THREE.Scene; camera: THREE.OrthographicCamera } | null = null;
const passScene = () => {
    if (!shared) {
        const material = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            uniforms: {
                uFrame: { value: null },
                uAspect: { value: 1 },
                uApex: { value: new THREE.Vector2(0.5, 0.5) },
                uCompress: { value: 0 },
                uBubble: { value: new THREE.Vector2(0.5, 0.5) },
                uBubbleRadius: { value: 0.1 },
                uWall: { value: 0 },
                uShift: { value: 0 },
                uRippleA: { value: new THREE.Vector4() },
                uRippleB: { value: new THREE.Vector4() },
                uRippleWidth: { value: new THREE.Vector2(0.05, 0.05) },
                uFlash: { value: 0 },
            },
        });
        // One triangle over the whole frame.
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        const scene = new THREE.Scene();
        scene.add(mesh);
        shared = { material, geometry, scene, camera: new THREE.OrthographicCamera() };
    }
    return shared;
};

const ScreenWarpPass = ({ manual }: { manual: boolean }) => {
    const gl = useThree((state) => state.gl);
    const frame = useRef<THREE.FramebufferTexture | null>(null);
    const pass = useMemo(passScene, []);
    useEffect(() => () => {
        frame.current?.dispose();
        frame.current = null;
    }, []);

    useFrame(({ scene, camera }, delta) => {
        if (manual) gl.render(scene, camera);
        ageRipples(Math.min(delta, 0.1));
        gl.getDrawingBufferSize(size);
        let texture = frame.current;
        if (!texture || texture.image.width !== size.x || texture.image.height !== size.y) {
            texture?.dispose();
            texture = new THREE.FramebufferTexture(size.x, size.y);
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            frame.current = texture;
        }
        const previous = gl.getRenderTarget();
        gl.setRenderTarget(null);
        gl.copyFramebufferToTexture(texture);
        const u = pass.material.uniforms;
        u.uFrame.value = texture;
        u.uAspect.value = size.x / Math.max(size.y, 1);
        (u.uApex.value as THREE.Vector2).copy(screenFx.apex);
        u.uCompress.value = screenFx.compress;
        (u.uBubble.value as THREE.Vector2).copy(screenFx.bubble);
        u.uBubbleRadius.value = screenFx.bubbleRadius;
        u.uWall.value = screenFx.wall;
        u.uShift.value = screenFx.shift;
        const rippleUniform = (i: number, target: THREE.Vector4) => {
            const ripple = screenFx.ripples[i];
            if (!ripple) {
                target.set(0, 0, 0, 0);
                return 0.05;
            }
            const k = ripple.age / ripple.life;
            const eased = 1 - (1 - k) * (1 - k);
            target.set(ripple.centre.x, ripple.centre.y, THREE.MathUtils.lerp(ripple.from, ripple.to, eased), ripple.strength * (1 - k) * (1 - k));
            return 0.035 + 0.09 * eased;
        };
        (u.uRippleWidth.value as THREE.Vector2).set(rippleUniform(0, u.uRippleA.value), rippleUniform(1, u.uRippleB.value));
        u.uFlash.value = screenFx.flash;
        const autoClear = gl.autoClear;
        gl.autoClear = false;
        gl.render(pass.scene, pass.camera);
        gl.autoClear = autoClear;
        gl.setRenderTarget(previous);
    }, 2);
    return null;
};

/**
 * Mounts the screen pass while the frame is being bent, and for a moment after (so a ripple that
 * comes and goes does not mount and unmount it frame by frame).
 */
export const ScreenWarpWatch = ({ quality }: { quality: 0 | 1 | 2 }) => {
    const [on, setOn] = useState(false);
    const last = useRef(0);
    // Its shader compiled in the background soon after the start, not on the first engage of the drive.
    const gl = useThree((state) => state.gl);
    useEffect(() => {
        if (!gl.extensions.get('KHR_parallel_shader_compile')) return undefined;
        const timer = window.setTimeout(() => { const pass = passScene(); compileSafely(gl, pass.scene, pass.camera); }, 15000);
        return () => window.clearTimeout(timer);
    }, [gl]);
    useFrame(({ clock }) => {
        const now = clock.elapsedTime;
        if (screenFxActive()) last.current = now;
        const want = now - last.current < 1;
        if (want !== on) setOn(want);
    });
    return on ? <ScreenWarpPass manual={quality === 0} /> : null;
};
