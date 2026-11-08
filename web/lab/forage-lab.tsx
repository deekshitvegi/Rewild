// Test only: a forage plant (Forage.tsx) drawn with the game's own plant material and a world's lighting, the whole
// plant beside its light one for afar, so a plant can be judged without walking the game to one.
// ?plant=forageCurrant&body=haven&w=&h=&sun=elev,azim&view=near|far|top&dist=metres&fruit=0. window.__ready when drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createPlantMaterial, preparePlant } from '../components/expedition/Forage';
import { findBody } from '../components/expedition/bodies';
import { modelUrl, type ModelName } from '../components/expedition/models';
const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960); const H = Number(q.get('h') ?? 540);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const body = findBody(q.get('body') ?? 'haven')!;
const R = body.radius;
const [elev, azim] = (q.get('sun') ?? '35,215').split(',').map((v) => (Number(v) * Math.PI) / 180);
// Planet-local frame: the plants stand at (0, R, 0); up is +y there.
body.sunDirection.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).normalize();
const anchor = new THREE.Vector3(0, R, 0);
const scene = new THREE.Scene();
scene.background = new THREE.Color(q.get('bg') ?? '#7f9fb8');
scene.add(new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: q.get('ground') ?? '#2c3a26' })));
const camera = new THREE.PerspectiveCamera(40, W / H, 0.05, 2000);
const dist = Number(q.get('dist') ?? 3);
const view = q.get('view') ?? 'near';
if (view === 'top') { camera.position.set(0, dist * 1.2, dist * 0.6); camera.lookAt(0, 0.2, 0); }
else { camera.position.set(0, 1.3 * Math.min(1, dist / 3), dist); camera.lookAt(0, 0.45, 0); }
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
(async () => {
    const gltf = await loader.loadAsync(modelUrl((q.get('plant') ?? 'forageCurrant') as ModelName));
    const parts = preparePlant(gltf)!;
    // Both materials dissolve at 1 km: each shows its own plant whole.
    const near = createPlantMaterial(body, parts.map, false, [1000, 1100]);
    const far = createPlantMaterial(body, parts.map, true, [-2, -1]);
    const fruit = q.get('fruit') !== '0';
    const side = view === 'far' ? 0 : Number(q.get('apart') ?? 0.8);
    const put = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, x: number) => {
        const mesh = new THREE.InstancedMesh(geometry, material, 1);
        mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, 0));
        mesh.frustumCulled = false;
        scene.add(mesh);
    };
    if (view !== 'far') { put(parts.body, near, -side); if (fruit) put(parts.fruit, near, -side); }
    if (view !== 'solo') { put(parts.bodyFar, far, side); if (fruit) put(parts.fruitFar, far, side); }
    for (const m of [near, far]) {
        m.uniforms.uCamLocal.value.copy(camera.position).add(anchor);
        m.uniforms.uAnchorLocal.value.copy(anchor);
    }
    renderer.render(scene, camera);
    (window as unknown as { __ready: boolean }).__ready = true;
})();
