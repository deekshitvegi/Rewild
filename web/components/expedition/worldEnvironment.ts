import * as THREE from 'three';

/**
 * What the models' metal, glass and paint reflect: the world they stand in. Until 9 Nov every model reflected a
 * studio light box (RoomEnvironment), the same white room on Haven, on Mars and in deep space, one reason the
 * owner saw them as "objects placed over there". Here a sky dome is drawn from the light the world actually has
 * (zenith, horizon and ground colours, the sun's direction, colour and strength), photographed into a cube and
 * prefiltered (PMREM) into one shared map that every model points at. WorldLight (Player.tsx) refreshes it a few
 * times a second; between refreshes nothing is drawn.
 */
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uUp;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
varying vec3 vDir;
void main() {
    vec3 d = normalize(vDir);
    float h = dot(d, uUp);
    vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));
    vec3 below = mix(uHorizon * 0.55, uGround, smoothstep(0.0, -0.25, h));
    vec3 color = h >= 0.0 ? sky : below;
    float toSun = max(dot(d, uSun), 0.0);
    // The disc (about a degree across, very bright) and the glow round it, which the rough paint picks up.
    color += uSunColor * (pow(toSun, 2400.0) * 60.0 + pow(toSun, 24.0) * 0.6 + pow(toSun, 4.0) * 0.08);
    gl_FragColor = vec4(color, 1.0);
}`;

export interface WorldLook {
    up: THREE.Vector3;
    sun: THREE.Vector3;
    sunColor: THREE.Color;
    zenith: THREE.Color;
    horizon: THREE.Color;
    ground: THREE.Color;
}

interface Environment {
    pmrem: THREE.PMREMGenerator;
    cube: THREE.WebGLCubeRenderTarget;
    camera: THREE.CubeCamera;
    scene: THREE.Scene;
    uniforms: Record<string, THREE.IUniform>;
    target: THREE.WebGLRenderTarget;
    epoch: number;
}

const environments = new WeakMap<THREE.WebGLRenderer, Environment>();

const CUBE = 64;

const create = (renderer: THREE.WebGLRenderer): Environment => {
    const uniforms: Record<string, THREE.IUniform> = {
        uUp: { value: new THREE.Vector3(0, 1, 0) },
        uSun: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
        uZenith: { value: new THREE.Color(0.18, 0.32, 0.55) },
        uHorizon: { value: new THREE.Color(0.55, 0.62, 0.7) },
        uGround: { value: new THREE.Color(0.12, 0.11, 0.1) },
    };
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, side: THREE.BackSide, depthWrite: false }),
    ));
    const cube = new THREE.WebGLCubeRenderTarget(CUBE, { type: THREE.HalfFloatType, generateMipmaps: false });
    const camera = new THREE.CubeCamera(0.1, 100, cube);
    const pmrem = new THREE.PMREMGenerator(renderer);
    camera.update(renderer, scene);
    const target = pmrem.fromCubemap(cube.texture);
    return { pmrem, cube, camera, scene, uniforms, target, epoch: -1 };
};

/** The shared reflection map for this renderer (made on first use; the same texture for the page's life). */
export const worldEnvironment = (renderer: THREE.WebGLRenderer, epoch: number) => {
    let env = environments.get(renderer);
    if (!env || env.epoch !== epoch) {
        env = create(renderer);
        env.epoch = epoch;
        environments.set(renderer, env);
    }
    return env.target.texture;
};

/** Draws the world's light into the shared map again (a cube of 64 px and its prefiltering: a millisecond or two). */
export const updateWorldEnvironment = (renderer: THREE.WebGLRenderer, epoch: number, look: WorldLook) => {
    worldEnvironment(renderer, epoch);
    const env = environments.get(renderer)!;
    const u = env.uniforms;
    (u.uUp.value as THREE.Vector3).copy(look.up);
    (u.uSun.value as THREE.Vector3).copy(look.sun);
    (u.uSunColor.value as THREE.Color).copy(look.sunColor);
    (u.uZenith.value as THREE.Color).copy(look.zenith);
    (u.uHorizon.value as THREE.Color).copy(look.horizon);
    (u.uGround.value as THREE.Color).copy(look.ground);
    env.camera.update(renderer, env.scene);
    // (three's types ask for a cube target here; the prefiltered map it reuses is a plain one, as fromCubemap returns.)
    env.pmrem.fromCubemap(env.cube.texture, env.target as unknown as THREE.WebGLCubeRenderTarget);
};
