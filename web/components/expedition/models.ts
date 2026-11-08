import { useEffect, useState } from 'react';
import { trackLoad } from './loadProgress';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The Expedition's sculpted models (public/models/expedition, see its
 * ATTRIBUTION.md): meshopt-compressed glTF with WebP textures. Everything that
 * uses one keeps its procedural stand-in, drawn until the model has arrived and
 * for good if it cannot be loaded, so a slow or failed download never leaves a
 * hole in the world.
 *
 * Some hosts (the claude.ai preview) serve no .glb files and let a page fetch
 * only its own files: no data: or blob: URLs, and no WebAssembly. A build made
 * with VITE_MODEL_PACKING=json expects each model as `<name>.glb.b64.json`,
 * its (uncompressed) GLB bytes as one base64 string, which it fetches from its
 * own origin and parses in memory, decoding the pictures inside through <img>
 * elements rather than fetch().
 */
const PACKED = import.meta.env.VITE_MODEL_PACKING === 'json';
export const MODEL_FILES = {
    ship: 'ship.glb',
    astronaut: 'astronaut.glb',
    grazer: 'grazer.glb',
    strider: 'strider.glb',
    sabretooth: 'sabretooth.glb',
    boulder: 'boulder.glb',
    hoodoo: 'hoodoo.glb',
    arch: 'arch.glb',
    ice: 'ice.glb',
    // Rock and ice of the airless and icy worlds, one model for each kind of
    // ground (propPlacement.ts ROCKS).
    rockBreccia: 'rock-breccia.glb',
    rockTalus: 'rock-talus.glb',
    rockRimOutcrop: 'rock-rim-outcrop.glb',
    rockMercuryScarp: 'rock-mercury-scarp.glb',
    rockIceBlock: 'rock-europa-ice.glb',
    rockIceScarp: 'rock-ice-scarp.glb',
    rockPlutoIce: 'rock-pluto-ice.glb',
    rockIoSulfur: 'rock-io-sulfur.glb',
    rockVenusPlates: 'rock-venus-plates.glb',
    rockTitanCobbles: 'rock-titan-cobbles.glb',
    oakA: 'tree-oak-a.glb',
    oakB: 'tree-oak-b.glb',
    ashA: 'tree-ash-a.glb',
    pineA: 'tree-pine-a.glb',
    pineB: 'tree-pine-b.glb',
    bushA: 'tree-bush-a.glb',
    bushB: 'tree-bush-b.glb',
    oakWide: 'tree-oak-wide.glb',
    ashTall: 'tree-ash-tall.glb',
    mapleRed: 'tree-maple-red.glb',
    mapleOrange: 'tree-maple-orange.glb',
    aspenGold: 'tree-aspen-gold.glb',
    birch: 'tree-birch.glb',
    willow: 'tree-willow.glb',
    poplar: 'tree-poplar.glb',
    spruce: 'tree-spruce.glb',
    cedar: 'tree-cedar.glb',
    deadTree: 'tree-dead.glb',
    bushC: 'tree-bush-c.glb',
    // Haven's shrine garden and temples: Japanese maples, a niwaki black pine, Italian cypress.
    jmapleRed: 'tree-jmaple-red.glb',
    jmapleOrange: 'tree-jmaple-orange.glb',
    pineNiwaki: 'tree-pine-niwaki.glb',
    cypress: 'tree-cypress.glb',
    // Food plants the explorer picks (Forage.tsx, source_assets/forage), one per kind of ground.
    forageCurrant: 'forage-currant.glb',
    forageMelon: 'forage-melon.glb',
    forageOpuntia: 'forage-opuntia.glb',
    forageRosette: 'forage-rosette.glb',
    forageFrostberry: 'forage-frostberry.glb',
    forageIceKelp: 'forage-icekelp.glb',
    // Life on other worlds (aliens.ts).
    crawler: 'alien-crawler.glb',
    stilt: 'alien-stilt.glb',
    hunter: 'alien-hunter.glb',
    glider: 'alien-glider.glb',
    makers: 'alien-makers.glb',
    europan: 'alien-europan.glb',
    aeronaut: 'alien-aeronaut.glb',
    // The trail to the Makers and what people left in orbit (story.ts).
    floater: 'alien-floater.glb',
    jupiterHunter: 'alien-jupiter-hunter.glb',
    titanRaft: 'titan-raft.glb',
    enceladusFans: 'enceladus-fans.glb',
    seedShip: 'makers-seedship.glb',
    debrisStage: 'debris-stage.glb',
    debrisDish: 'debris-dish.glb',
    europaCrevasse: 'europa-crevasse.glb',
    phobosMonolith: 'phobos-monolith.glb',
    // What is left of the cities on Earth (revival.ts, docs/story.md).
    ruinTower: 'ruin-tower.glb',
    ruinSphere: 'ruin-sphere.glb',
    ruinHouse: 'ruin-house.glb',
    ruinCar: 'ruin-car.glb',
    ruinOverpass: 'ruin-overpass.glb',
    mothership: 'argo.glb',
    havenDome: 'haven-dome.glb',
    havenHabitat: 'haven-habitat.glb',
    havenArk: 'haven-ark.glb',
    // Haven's temples and shrines (source_assets/temples, made in Blender).
    templeGreek: 'temple-greek.glb',
    shrineTorii: 'shrine-torii.glb',
    templeNagara: 'temple-nagara.glb',
    shrineHonden: 'shrine-honden.glb',
    shrineLantern: 'shrine-lantern.glb',
    shrinePagoda: 'shrine-pagoda.glb',
    shrineGate: 'shrine-gate.glb',
    shrineBridge: 'shrine-bridge.glb',
    shrineLanternHanging: 'shrine-lantern-hanging.glb',
    templeKund: 'temple-kund.glb',
    colonistWoman: 'colonist-woman.glb',
    colonistMan: 'colonist-man.glb',
    // The last lunar base, on Shackleton's rim (HistoricSites.tsx).
    moonHabitat: 'moon-habitat.glb',
    moonSolarTower: 'moon-vsat.glb',
    moonPower: 'moon-power.glb',
} as const;

export type ModelName = keyof typeof MODEL_FILES;

export const modelUrl = (name: ModelName) => `${import.meta.env.BASE_URL}models/expedition/${MODEL_FILES[name]}${PACKED ? '.b64.json' : ''}`;

let loader: Promise<GLTFLoader> | null = null;
const createLoader = async () => {
    const gltf = new GLTFLoader();
    if (PACKED) {
        // Pictures by <img>, which may show blob: URLs, not by fetch(), which may not.
        gltf.register((parser) => {
            parser.textureLoader = new THREE.TextureLoader(parser.options.manager);
            return { name: 'image-elements' };
        });
    } else {
        const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
        gltf.setMeshoptDecoder(MeshoptDecoder);
    }
    return gltf;
};

const loadPacked = async (gltf: GLTFLoader, url: string) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const text = atob((await response.json()) as string);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return gltf.parseAsync(bytes.buffer, '');
};

const cache = new Map<ModelName, Promise<GLTF>>();

/**
 * How many times the graphics device has been reset and restored. Whatever lives only on the graphics
 * card (photographs baked into render targets, prefiltered environments) is remade when this changes.
 */
export let gpuEpoch = 0;
export const markGpuRestored = () => { gpuEpoch += 1; };

/** A download, tried again after 1.5, 3 and 6 seconds if it fails (a stalled network, a busy page). */
const withRetries = async <T>(attempt: () => Promise<T>, tries = 4): Promise<T> => {
    for (let n = 0; ; n++) {
        try {
            return await attempt();
        } catch (error) {
            if (n >= tries - 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1500 * 2 ** n));
        }
    }
};

/**
 * Pictures waiting to go up to the graphics card (TextureUploads). three uploads a texture the
 * first time something that uses it is drawn, so a world's trees, rocks and ruins coming into view
 * together sent all their models' pictures up in that one frame: the freeze on the way in to a
 * world. Each model's pictures are queued here as soon as it has loaded, and go up a few a frame.
 */
export const textureQueue: THREE.Texture[] = [];
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'] as const;
const queueTextures = (root: THREE.Object3D) => {
    root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
            for (const slot of TEXTURE_SLOTS) {
                const texture = (material as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
                if (texture && !textureQueue.includes(texture)) textureQueue.push(texture);
            }
        });
    });
};

export const loadModel = (name: ModelName): Promise<GLTF> => {
    let pending = cache.get(name);
    if (!pending) {
        if (!loader) loader = createLoader();
        const url = modelUrl(name);
        pending = trackLoad(loader.then((gltf) => withRetries(() => (PACKED ? loadPacked(gltf, url) : gltf.loadAsync(url)))));
        // After its retries a failure is remembered for a while (the stand-in stays), then forgotten,
        // so the next time the scene is built the model is fetched again.
        const failed = pending;
        pending.then((gltf) => queueTextures(gltf.scene)).catch(() => {
            setTimeout(() => { if (cache.get(name) === failed) cache.delete(name); }, 20000);
        });
        cache.set(name, pending);
    }
    return pending;
};

/** The model once it has loaded, or null while it loads (or if it cannot). */
export const useModel = (name: ModelName | null): GLTF | null => {
    const [model, setModel] = useState<GLTF | null>(null);
    useEffect(() => {
        if (!name) return undefined;
        let alive = true;
        loadModel(name).then((gltf) => { if (alive) setModel(gltf); }).catch(() => undefined);
        return () => { alive = false; };
    }, [name]);
    return model;
};

const environments = new WeakMap<THREE.WebGLRenderer, { texture: THREE.Texture; epoch: number }>();

/**
 * Something for the models' metal and glass to reflect: a soft studio light
 * box, prefiltered once per renderer. Only the models use it; the worlds are
 * lit by their own shaders.
 */
export const modelEnvironment = (renderer: THREE.WebGLRenderer) => {
    const known = environments.get(renderer);
    if (known && known.epoch === gpuEpoch) return known.texture;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    environments.set(renderer, { texture, epoch: gpuEpoch });
    return texture;
};

/** Point every standard material in a model at the reflections above. */
export const useEnvironmentOn = (root: THREE.Object3D | null, renderer: THREE.WebGLRenderer, intensity: number) => {
    useEffect(() => {
        if (!root) return;
        const env = modelEnvironment(renderer);
        root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            materials.forEach((material) => {
                const standard = material as THREE.MeshStandardMaterial;
                if (!standard.isMeshStandardMaterial) return;
                standard.envMap = env;
                standard.envMapIntensity = intensity;
                standard.needsUpdate = true;
            });
        });
    }, [root, renderer, intensity]);
};
