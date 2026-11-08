// Test only: tree models drawn with the game's own tree material and Earth's lighting, side by side, so a new tree
// can be judged against the old without flying the game to a forest. ?a=<glb url>&b=<glb url>&w=&h=&sun=elev,azim
// &view=eye|far. window.__ready when drawn.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { prepareTree, createTreeMaterial } from '../components/expedition/trees';
import { findBody } from '../components/expedition/bodies';
const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 960); const H = Number(q.get('h') ?? 540);
const urls = [q.get('a'), q.get('b')].filter(Boolean) as string[];
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const body = findBody('projects')!;
const R = body.radius;
const [elev, azim] = (q.get('sun') ?? '40,215').split(',').map((v) => (Number(v) * Math.PI) / 180);
// Planet-local frame: the trees stand at (0, R, 0); up is +y there.
body.sunDirection.set(Math.cos(elev) * Math.sin(azim), Math.sin(elev), Math.cos(elev) * Math.cos(azim)).normalize();
const anchor = new THREE.Vector3(0, R, 0);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8fb3d9');
// (Ruined Earth: ?revival=0 draws the trees dead, on ash.)
const DEAD_GROUND = Number(q.get('revival') ?? 1) < 0.5;
const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: DEAD_GROUND ? '#3a3632' : '#2f4a1b' }));
scene.add(ground);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 5000);
const view = q.get('view') ?? 'eye';
if (view === 'far') { camera.position.set(0, 3, 60); camera.lookAt(0, 7, 0); }
else if (view === 'under') { camera.position.set(9, 1.7, 7); camera.lookAt(11, 8, 0); }
else if (view === 'near') { camera.position.set(11, 1.7, 13); camera.lookAt(11, 7, 0); }
else { camera.position.set(0, 1.7, 30); camera.lookAt(0, 7.5, 0); }
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const materials: THREE.ShaderMaterial[] = [];
(async () => {
    const heights = (q.get('heights') ?? '15,15').split(',').map(Number);
    for (let i = 0; i < urls.length; i++) {
        const gltf = await loader.loadAsync(urls[i]);
        const parts = prepareTree(gltf)!;
        const common = { body, lod: [1000, 1100] as [number, number], reach: 2000, sway: 0 };
        const x = urls.length === 1 ? 0 : (i === 0 ? -11 : 11);
        for (const [geometry, material] of [
            [parts.bark, createTreeMaterial({ ...common, part: 'bark', map: parts.barkMap, normalMap: parts.barkNormal })],
            [parts.leaves, createTreeMaterial({ ...common, part: 'leaves', map: parts.leafMap })],
            // (The finest twigs: the shader shows them only on a dead tree.)
            ...(parts.twigs ? [[parts.twigs, createTreeMaterial({ ...common, part: 'bark', map: parts.barkMap, normalMap: parts.barkNormal })]] : []),
        ] as [THREE.BufferGeometry, THREE.ShaderMaterial][]) {
            const mesh = new THREE.InstancedMesh(geometry, material, 1);
            mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1).multiplyScalar(heights[i] ?? 15)));
            mesh.frustumCulled = false;
            material.uniforms.uAnchorLocal.value.copy(anchor);
            (material.uniforms.uRevival as { value: number }).value = Number(q.get('revival') ?? 1);
            materials.push(material);
            scene.add(mesh);
        }
    }
    for (const m of materials) m.uniforms.uCamLocal.value.copy(camera.position).add(anchor);
    renderer.render(scene, camera);
    (window as unknown as { __ready: boolean }).__ready = true;
})();
