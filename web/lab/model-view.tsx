// Test only: renders ?model=<ModelName> from four sides into one strip; window.__info = bounds.
import * as THREE from 'three';
import { loadModel, modelEnvironment, type ModelName } from '../components/expedition/models';
const name = new URLSearchParams(location.search).get('model') as ModelName;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setScissorTest(true);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8a8f96');
scene.add(new THREE.HemisphereLight('#ffffff', '#404040', 1.2));
const sun = new THREE.DirectionalLight('#fff4e0', 2.6); sun.position.set(3, 5, 4); scene.add(sun);
scene.environment = modelEnvironment(renderer);
loadModel(name).then((gltf) => {
  const root = gltf.scene; scene.add(root);
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()); const centre = box.getCenter(new THREE.Vector3());
  const r = size.length() * 0.62;
  const cam = new THREE.PerspectiveCamera(35, 1, r * 0.01, r * 20);
  const views = [[0, 0.25], [Math.PI / 2, 0.25], [Math.PI, 0.25], [0.6, 1.2]];
  views.forEach(([az, el], i) => {
    cam.position.set(centre.x + Math.sin(az) * Math.cos(el) * r * 2.4, centre.y + Math.sin(el) * r * 2.4, centre.z + Math.cos(az) * Math.cos(el) * r * 2.4);
    cam.lookAt(centre); renderer.setViewport(i * 256, 0, 256, 256); renderer.setScissor(i * 256, 0, 256, 256); renderer.render(scene, cam);
  });
  (window as any).__info = { size: size.toArray().map((v) => +v.toFixed(3)), centre: centre.toArray().map((v) => +v.toFixed(3)), min: box.min.toArray().map((v) => +v.toFixed(3)) };
}).catch((e) => { (window as any).__info = { error: String(e) }; });
