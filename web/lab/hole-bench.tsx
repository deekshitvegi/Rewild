// Test only: TON 618's shader alone, seen from Haven: how long it takes to compile, and to draw a frame
// at full resolution and at a fraction (?w=&h=&q=). window.__bench holds the numbers.
import * as THREE from 'three';
import { createBlackHole } from '../components/expedition/BlackHole';
import { BLACK_HOLE } from '../components/expedition/deepSpace';
import { findBody } from '../components/expedition/bodies';
const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 320); const H = Number(params.get('h') ?? 200); const q = Number(params.get('q') ?? 2) as 0 | 1 | 2;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const gl = new THREE.WebGLRenderer({ canvas, logarithmicDepthBuffer: true });
gl.setSize(W, H, false);
const sky = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType });
const hole = createBlackHole(q, sky.texture);
if (params.has('steps')) {
    const m = hole.material;
    m.fragmentShader = m.fragmentShader
        .replace('void main() {', 'float stepsTaken = 0.0;\nvoid main() {')
        .replace('for (int i = 0; i < steps; i++) {', 'for (int i = 0; i < steps; i++) { stepsTaken += 1.0;')
        .replace('gl_FragColor = vec4(color, alpha);', 'gl_FragColor = vec4(stepsTaken < 1.0 ? vec3(0.0, 0.0, 0.3) : vec3(stepsTaken / 150.0, stepsTaken / 300.0, 0.0), 1.0);');
    m.needsUpdate = true;
}
const scene = new THREE.Scene(); scene.add(hole.mesh);
hole.mesh.position.copy(BLACK_HOLE.position);
const haven = findBody('haven')!;
const camera = new THREE.PerspectiveCamera(60, W / H, 1, 1e11);
camera.position.copy(haven.position).addScaledVector(haven.position.clone().sub(BLACK_HOLE.position).normalize(), haven.radius + 2);
const finish = () => { const px = new Uint8Array(4); const c = gl.getContext(); c.readPixels(0, 0, 1, 1, c.RGBA, c.UNSIGNED_BYTE, px); };
const out: Record<string, number> = {};
const time = (label: string, f: () => void) => { const t = performance.now(); f(); finish(); out[label] = Math.round(performance.now() - t); };
time('compile', () => gl.compile(scene, camera));
const look = (toward: boolean) => { camera.lookAt(toward ? BLACK_HOLE.position : camera.position.clone().multiplyScalar(2).sub(BLACK_HOLE.position)); camera.updateMatrixWorld(); };
look(true); time('firstDraw', () => gl.render(scene, camera));
time('drawToward', () => gl.render(scene, camera));
look(false); time('drawAway', () => gl.render(scene, camera));
look(true);
const target = new THREE.WebGLRenderTarget(Math.round(W * 0.6), Math.round(H * 0.6), { type: THREE.HalfFloatType });
time('drawToward60pc', () => { gl.setRenderTarget(target); gl.render(scene, camera); gl.setRenderTarget(null); });
gl.render(scene, camera); finish();
(window as unknown as { __bench: unknown }).__bench = out;
