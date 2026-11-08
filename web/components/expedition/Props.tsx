import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { trackLoad } from './loadProgress';
import { findBody, type ExpeditionBody } from './bodies';
import { cellKey, cellPoint, cellsNear, type SurfaceCell } from './scatter';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { landingZoneDirection } from './sites';
import { LANDMARK_KEY, generateCell, generateLandmarks, kit, layerModels, type Collider, type LayerState, type ModelFit, type PropLayer, type PropModel } from './propPlacement';
import { bakeImpostor, createTreeMaterial, createTreeShadowMaterial, impostorGeometry, prepareTree, treeShadowGeometry, type TreeImpostor, type TreeParts } from './trees';
import { gpuEpoch, loadModel, type ModelName } from './models';
import { usesEarthMap } from './earth';
import { revivalUniform, treeAlive } from './revival';
import type { ExpeditionRuntime } from './runtime';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * What stands on each world: trees and red rock arches on the green world,
 * sandstone pillars on the desert, boulders on the moon, ice spires on the ice
 * worlds, as in the reference video.
 *
 * Placement is deterministic. The surface is cut into cells (scatter.ts); each
 * cell always holds the same props, so a tree is where it was when you come
 * back. Only cells around the player are generated, a few per frame, nearest
 * first, and instances fade into the ground at the edge of their reach so
 * nothing pops.
 */

/**
 * Placement shader: lit and hazed like the terrain, fading into the ground at
 * the edge of its reach. Built shapes carry their colours per vertex; a
 * sculpted model brings its own colour texture (`map`), tinted to its world,
 * or is painted with a ground picture projected in model space (`triplanar`);
 * a photographed plant (`cutout`) is cut out along its picture's alpha.
 */
const createPropMaterial = (
    body: ExpeditionBody, reach: number, sway: number, map: THREE.Texture | null = null, tint: THREE.ColorRepresentation = '#ffffff', cutout = false,
    triplanar: PropModel['triplanar'] = undefined, normalMap: THREE.Texture | null = null,
) => new THREE.ShaderMaterial({
    vertexColors: true,
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    defines: {
        ...(map && !triplanar ? { USE_PROP_MAP: '' } : {}),
        ...(map && triplanar ? { USE_PROP_TRIPLANAR: '' } : {}),
        ...(cutout ? { USE_PROP_CUTOUT: '' } : {}),
        ...(map && !triplanar && normalMap ? { USE_PROP_NORMAL_MAP: '' } : {}),
    },
    uniforms: {
        ...createSurfaceUniforms(body),
        uAnchorLocal: { value: new THREE.Vector3() },
        uReach: { value: reach },
        uSway: { value: sway },
        uWrap: { value: sway > 0 ? 0.55 : 0 },
        uTime: { value: 0 },
        uMap: { value: map },
        uNormalMap: { value: normalMap },
        uMapSize: { value: new THREE.Vector2((map?.image as { width?: number } | undefined)?.width ?? 1, (map?.image as { height?: number } | undefined)?.height ?? 1) },
        uTint: { value: new THREE.Color(tint) },
        uTriplanar: { value: new THREE.Vector2(triplanar?.repeat ?? 1, triplanar?.cap ?? 9) },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uAnchorLocal;
        uniform vec3 uCamLocal;
        uniform float uReach;
        uniform float uSway;
        uniform float uTime;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        #ifdef USE_PROP_MAP
        varying vec2 vPropUv;
        #endif
        #ifdef USE_PROP_NORMAL_MAP
        varying vec3 vFromEye;
        #endif
        #ifdef USE_PROP_TRIPLANAR
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        #endif
        void main() {
            #ifdef USE_PROP_MAP
            vPropUv = uv;
            #endif
            #ifdef USE_PROP_TRIPLANAR
            vModelPos = position;
            vModelNormal = normal;
            #endif
            vec3 origin = vec3(instanceMatrix[3]);
            vec3 placed = uAnchorLocal + origin;
            float dist = length(placed - uCamLocal);
            float fade = 1.0 - smoothstep(uReach * 0.72, uReach, dist);
            vec3 p = position;
            if (uSway > 0.0) {
                float phase = dot(placed, vec3(0.013, 0.017, 0.011));
                float wind = sin(uTime * 1.3 + phase) * 0.6 + sin(uTime * 2.3 + phase * 1.7) * 0.3;
                float bend = uSway * 0.012 * p.y * p.y;
                p.x += wind * bend;
                p.z += wind * bend * 0.6;
            }
            vec4 local = instanceMatrix * vec4(p, 1.0);
            // Shrink into the ground at the edge of the reach, and settle a little
            // with distance, where the terrain is drawn with less detail.
            vec3 upDir = normalize(placed);
            local.xyz = origin + (local.xyz - origin) * fade - upDir * dist * 0.003;
            vLocalPos = uAnchorLocal + local.xyz;
            #ifdef USE_PROP_NORMAL_MAP
            // From the eye, small numbers: the planet-local position is too
            // coarse in single precision for the pixel-to-pixel differences
            // the normal map's frame is built from.
            vFromEye = (uAnchorLocal - uCamLocal) + local.xyz;
            #endif
            vNormalLocal = mat3(instanceMatrix) * normal;
            vColor = color;
            #ifdef USE_INSTANCING_COLOR
            vColor *= instanceColor;
            #endif
            gl_Position = projectionMatrix * modelViewMatrix * local;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        uniform float uWrap;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        #ifdef USE_PROP_MAP
        uniform sampler2D uMap;
        uniform vec2 uMapSize;
        uniform vec3 uTint;
        varying vec2 vPropUv;
        #endif
        #ifdef USE_PROP_NORMAL_MAP
        uniform sampler2D uNormalMap;
        varying vec3 vFromEye;
        #endif
        #ifdef USE_PROP_TRIPLANAR
        uniform sampler2D uMap;
        uniform vec3 uTint;
        uniform vec2 uTriplanar;
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        #endif
        void main() {
            #include <logdepthbuf_fragment>
            vec3 up = normalize(vLocalPos);
            vec3 N = normalize(vNormalLocal);
            vec3 albedo = vColor;
            #ifdef USE_PROP_MAP
            vec4 picture = texture2D(uMap, vPropUv);
            #ifdef USE_PROP_CUTOUT
            // Smaller mip levels average the leaves with the gaps between them:
            // lift their alpha so a distant tree keeps its body, not just a haze.
            vec2 texel = vPropUv * uMapSize;
            vec2 ddx = dFdx(texel);
            vec2 ddy = dFdy(texel);
            float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
            if (picture.a * (1.0 + mip * 0.25) < 0.5) discard;
            #endif
            albedo *= picture.rgb * uTint;
            #endif
            #ifdef USE_PROP_NORMAL_MAP
            // The detail of the full sculpture, baked into a normal map, put
            // back on the simplified mesh (a frame from the pixel derivatives,
            // as three does without stored tangents; glTF's v runs down).
            vec3 mapN = texture2D(uNormalMap, vPropUv).xyz * 2.0 - 1.0;
            mapN.y = -mapN.y;
            vec3 q0 = dFdx(vFromEye);
            vec3 q1 = dFdy(vFromEye);
            vec2 st0 = dFdx(vPropUv);
            vec2 st1 = dFdy(vPropUv);
            vec3 q1perp = cross(q1, N);
            vec3 q0perp = cross(N, q0);
            vec3 T = q1perp * st0.x + q0perp * st1.x;
            vec3 B = q1perp * st0.y + q0perp * st1.y;
            float det = max(dot(T, T), dot(B, B));
            float frame = det == 0.0 ? 0.0 : inversesqrt(det);
            N = normalize(T * (mapN.x * frame) + B * (mapN.y * frame) + N * mapN.z);
            #endif
            #ifdef USE_PROP_TRIPLANAR
            // The picture projected along the model's three axes; its v runs up
            // the side projections, so strata lie level.
            vec3 facing = pow(abs(normalize(vModelNormal)), vec3(4.0));
            facing /= facing.x + facing.y + facing.z;
            vec3 q = vModelPos * uTriplanar.x;
            vec3 rock = texture2D(uMap, q.zy).rgb * facing.x + texture2D(uMap, q.xz).rgb * facing.y + texture2D(uMap, q.xy).rgb * facing.z;
            albedo *= rock * uTint;
            // The cap stone: harder, darker rock that sheltered the column below.
            albedo *= mix(vec3(1.0), vec3(0.5, 0.4, 0.34), smoothstep(uTriplanar.y - 0.012, uTriplanar.y + 0.012, vModelPos.y));
            #endif
            vec3 color = applyHaze(surfaceLightWrap(albedo, N, up, uWrap) + playerLights(albedo, N, vLocalPos), vLocalPos, up);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

/**
 * A sculpted model's mesh as a plain geometry in a layer's model units: its
 * compressed attributes unpacked to floats with its node transform baked in,
 * then fitted (ModelFit), with white vertex colours so the per-instance tint
 * still applies. A model made in two levels of detail (nodes "lod0" and
 * "lod1", rocklod.mjs) brings its far level as well, fitted by the same
 * measure so the two line up exactly.
 */
const fitModel = (gltf: GLTF, fit: ModelFit) => {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
    });
    const near = meshes.find((m) => m.name === 'lod0') ?? meshes[0];
    if (!near) return null;
    const far = meshes.find((m) => m.name === 'lod1') ?? null;
    const unpack = (mesh: THREE.Mesh) => {
        const source = mesh.geometry;
        const geometry = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) {
            const attribute = source.getAttribute(name);
            if (!attribute) continue;
            const values = new Float32Array(attribute.count * attribute.itemSize);
            for (let i = 0; i < attribute.count; i++) {
                for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
            }
            geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
        }
        if (source.index) geometry.setIndex(source.index.clone());
        geometry.applyMatrix4(mesh.matrixWorld);
        return geometry;
    };
    const geometry = unpack(near);
    const farGeometry = far ? unpack(far) : null;
    geometry.computeBoundingBox();
    let box = geometry.boundingBox!;
    const axisX = fit.axis ? fit.axis[0] : (box.min.x + box.max.x) / 2;
    const axisZ = fit.axis ? fit.axis[1] : (box.min.z + box.max.z) / 2;
    const scale = fit.scale ?? (fit.height ? fit.height / Math.max(box.max.y - box.min.y, 1e-6) : 1);
    const transform = new THREE.Matrix4().makeScale(scale, scale * (fit.squash ?? 1), scale).multiply(new THREE.Matrix4().makeTranslation(-axisX, 0, -axisZ));
    geometry.applyMatrix4(transform);
    geometry.computeBoundingBox();
    box = geometry.boundingBox!;
    const lift = fit.bottom !== undefined ? fit.bottom - box.min.y : fit.middle !== undefined ? fit.middle - (box.min.y + box.max.y) / 2 : 0;
    transform.premultiply(new THREE.Matrix4().makeTranslation(0, lift, 0));
    geometry.translate(0, lift, 0);
    farGeometry?.applyMatrix4(transform);
    for (const g of [geometry, farGeometry]) {
        if (!g) continue;
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
        g.computeBoundingSphere();
    }
    const material = near.material as THREE.MeshStandardMaterial;
    return { geometry, far: farGeometry, map: material.map ?? null, normalMap: material.normalMap ?? null };
};

/**
 * Crossed upright cards for a photographed plant, `height` model units tall,
 * trunk on the axis. The normals fan out from the crown, so the cards are lit
 * as one rounded tree rather than as flat boards.
 */
const billboardGeometry = (height: number, aspect: number) => {
    const width = height * aspect;
    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    const columns = 2;
    const rows = 4;
    const n = new THREE.Vector3();
    for (let card = 0; card < 3; card++) {
        const angle = (card * Math.PI) / 3;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const base = position.length / 3;
        for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= columns; c++) {
                const u = c / columns;
                const v = r / rows;
                const across = (u - 0.5) * width;
                const y = v * height;
                position.push(across * cos, y, across * sin);
                n.set((across / (width / 2)) * cos, (y - height * 0.55) / (height / 2) + 0.35, (across / (width / 2)) * sin).normalize();
                normal.push(n.x, n.y, n.z);
                uv.push(u, v);
            }
        }
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                const a = base + r * (columns + 1) + c;
                const b = a + columns + 1;
                index.push(a, a + 1, b, a + 1, b + 1, b);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(position.length).fill(1), 3));
    geometry.setIndex(index);
    geometry.computeBoundingSphere();
    return geometry;
};

const pictures = new Map<string, Promise<THREE.Texture>>();

/** A picture under textures/expedition, loaded once; ground pictures repeat. */
const loadPicture = (path: string) => {
    let pending = pictures.get(path);
    if (!pending) {
        pending = trackLoad(new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}textures/expedition/${path}`)).then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            if (path.startsWith('terrain/')) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            return texture;
        });
        pending.catch(() => undefined);
        pictures.set(path, pending);
    }
    return pending;
};

/** Where each layer's picture lives: a plant's card, or the ground picture a rock is painted with. */
const picturePath = (layer: PropLayer) => {
    if (layer.tree) return null;
    if (layer.billboard) return `${layer.billboard.name}.webp`;
    const triplanar = layerModels(layer)[0]?.triplanar;
    if (triplanar) return `terrain/${triplanar.picture}.webp`;
    return null;
};

/** The pictures a world's layers use, as each arrives. */
const useLayerPictures = (layers: PropLayer[]) => {
    const [loaded, setLoaded] = useState<Map<string, THREE.Texture>>(() => new Map());
    useEffect(() => {
        let alive = true;
        const paths = [...new Set(layers.flatMap((layer) => { const path = picturePath(layer); return path ? [path] : []; }))];
        paths.forEach((path) => {
            loadPicture(path).then((texture) => {
                if (alive) setLoaded((current) => new Map(current).set(path, texture));
            }).catch(() => undefined);
        });
        return () => { alive = false; };
    }, [layers]);
    return loaded;
};

/** The sculpted models a world's layers use, as each arrives. */
const useLayerModels = (layers: PropLayer[]) => {
    const [models, setModels] = useState<Map<ModelName, GLTF>>(() => new Map());
    useEffect(() => {
        let alive = true;
        const names = [...new Set(layers.flatMap((layer) => [...layerModels(layer).map((model) => model.name), ...(layer.tree?.models ?? [])]))];
        names.forEach((name) => {
            loadModel(name).then((gltf) => {
                if (alive) setModels((current) => new Map(current).set(name, gltf));
            }).catch(() => undefined);
        });
        return () => { alive = false; };
    }, [layers]);
    return models;
};

/**
 * A tree model's parts and its impostor, prepared once per model and renderer; with photographs of it dead too
 * where trees can be dead (ruined Earth).
 */
type TreeEntry = { parts: TreeParts; impostor: TreeImpostor; renderer: THREE.WebGLRenderer; epoch: number } | null;
const trees = new WeakMap<GLTF, Map<boolean, TreeEntry>>();
const treeOf = (gltf: GLTF, renderer: THREE.WebGLRenderer, tile: number, dead: boolean) => {
    let kinds = trees.get(gltf);
    if (!kinds) trees.set(gltf, (kinds = new Map()));
    let entry = kinds.get(dead);
    // Photographed again for another renderer, or after the graphics device was reset (the photographs lived on it).
    if (entry === undefined || (entry && (entry.renderer !== renderer || entry.epoch !== gpuEpoch))) {
        const parts = prepareTree(gltf);
        entry = parts ? { parts, impostor: bakeImpostor(renderer, parts, tile, dead), renderer, epoch: gpuEpoch } : null;
        kinds.set(dead, entry);
    }
    return entry;
};

/**
 * One instanced draw of a layer: a variant's geometry and material, holding
 * the instances whose distance from the player (when they are uploaded) lies
 * in `band`, or all of them.
 */
interface Draw {
    geometry: THREE.BufferGeometry;
    material: THREE.ShaderMaterial;
    variant: number;
    band: [number, number] | null;
    /** Trees on ruined Earth: only the living (leaves) or only the dead (bare twigs); unset, all of them. */
    life?: 'alive' | 'dead';
}

interface LayerVisual {
    draws: Draw[];
    colliders?: Collider[];
    /** Geometries this visual made and must dispose of. */
    owned: THREE.BufferGeometry[];
}

// Pixels per impostor photograph, per quality level.
const IMPOSTOR_TILE = [96, 128, 176];

// The player moves at most this far between re-uploads of a layer drawn in
// levels of detail, so each level's band is widened by it.
const LOD_STEP = 24;

const probe = new THREE.Vector3();
const dir = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const scaleVector = new THREE.Vector3();
const tint = new THREE.Color();
const treeAt = new THREE.Vector3();
const up = new THREE.Vector3();
const cameraWorld = new THREE.Vector3();
const colliderPoint = new THREE.Vector3();

const PropLayers = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const groupRef = useRef<THREE.Group>(null);
    const meshRefs = useRef<(THREE.InstancedMesh | null)[][]>([]);
    const anchor = useRef(new THREE.Vector3());
    const lastUpload = useRef(0);
    const revivalAt = useRef(-1);
    const lodCenter = useRef(new THREE.Vector3());
    const zone = useMemo(() => landingZoneDirection(body), [body]);
    const quality = runtime.quality;

    const layers = useMemo(() => kit(body), [body]);
    const models = useLayerModels(layers);
    const pictures = useLayerPictures(layers);
    // What each layer draws: real trees, its sculpted model or picture once
    // loaded, else built shapes.
    const visuals = useMemo(() => layers.map((layer, index): LayerVisual => {
        const reach = layer.reach[quality];
        const tree = layer.tree;
        const grown = tree && tree.models.every((name) => models.get(name))
            ? tree.models.map((name) => treeOf(models.get(name)!, gl, IMPOSTOR_TILE[quality], usesEarthMap(body)))
            : null;
        if (tree && grown && grown.every(Boolean)) {
            const [start, end] = tree.near[quality];
            const draws: Draw[] = [];
            // On Earth, which may be ruined, each tree is alive or dead (worked out per tree as they are laid out):
            // the leaves are drawn for the living, the bare twigs for the dead, and nothing is drawn only to be
            // thrown away in the shader. Elsewhere every tree is alive and none has twigs drawn.
            const ruinable = usesEarthMap(body);
            grown.forEach((entry, variant) => {
                const { parts, impostor } = entry!;
                const common = { body, lod: [start, end] as [number, number], reach, sway: layer.sway, life: ruinable };
                const near: [number, number] = [0, end + LOD_STEP];
                draws.push(
                    { geometry: parts.bark, variant, band: near, material: createTreeMaterial({ ...common, part: 'bark', map: parts.barkMap, normalMap: parts.barkNormal }) },
                    { geometry: parts.leaves, variant, band: near, life: ruinable ? 'alive' : undefined, material: createTreeMaterial({ ...common, part: 'leaves', map: parts.leafMap, snow: tree.snow, tint: tree.tint }) },
                    ...(ruinable && parts.twigs ? [{ geometry: parts.twigs, variant, band: near, life: 'dead' as const, material: createTreeMaterial({ ...common, part: 'bark', map: parts.barkMap, normalMap: parts.barkNormal }) }] : []),
                    {
                        geometry: impostorGeometry(), variant, band: [Math.max(0, start - LOD_STEP), Infinity],
                        material: createTreeMaterial({ ...common, part: 'impostor', map: impostor.albedo, normalAtlas: impostor.normal, deadAtlas: impostor.dead, halfWidth: impostor.halfWidth, snow: tree.snow, tint: tree.tint }),
                    },
                    // Its shadow on the ground, from some way off out to its reach (trees.ts).
                    { geometry: treeShadowGeometry(), variant, band: [40, Infinity], material: createTreeShadowMaterial({ body, reach, impostor, life: ruinable }) },
                );
            });
            return { draws, colliders: layer.colliders, owned: draws.filter((d) => d.band && d.band[1] === Infinity).map((d) => d.geometry) };
        }
        const path = picturePath(layer);
        const picture = path ? pictures.get(path) : undefined;
        const single = (geometries: THREE.BufferGeometry[], material: THREE.ShaderMaterial, colliders: Collider[] | undefined, owned: THREE.BufferGeometry[]): LayerVisual => ({
            draws: geometries.map((geometry, variant) => ({ geometry, material, variant, band: null })),
            colliders,
            owned,
        });
        if (layer.billboard && picture && !tree) {
            const image = picture.image as { width: number; height: number };
            const geometry = billboardGeometry(layer.billboard.height, image.width / image.height);
            return single(Array.from({ length: layer.variants }, () => geometry),
                createPropMaterial(body, reach, layer.sway, picture, layer.billboard.tint, true), layer.colliders, [geometry]);
        }
        // A painted model waits for its picture as well, rather than show up white.
        // With several models, each variant is drawn with its own, once all have come.
        const sculpted = layerModels(layer);
        const ready = sculpted.length > 0 && sculpted.every((model) => models.get(model.name) && (!model.triplanar || picture));
        const fitted = ready ? sculpted.map((model) => fitModel(models.get(model.name)!, model.fit)) : null;
        if (fitted && fitted.every(Boolean)) {
            const materials = sculpted.map((model, m) => createPropMaterial(
                body, reach, layer.sway, model.triplanar ? picture! : fitted[m]!.map, model.tint, false, model.triplanar, fitted[m]!.normalMap));
            // Beyond `detail` metres a model's far level, where it has one.
            const draws: Draw[] = [];
            for (let variant = 0; variant < layer.variants; variant++) {
                const m = variant % sculpted.length;
                const { geometry, far } = fitted[m]!;
                if (far && layer.detail) {
                    draws.push({ geometry, material: materials[m], variant, band: [0, layer.detail] });
                    draws.push({ geometry: far, material: materials[m], variant, band: [layer.detail, Infinity] });
                } else {
                    draws.push({ geometry, material: materials[m], variant, band: null });
                }
            }
            return {
                draws,
                colliders: sculpted.length === 1 ? sculpted[0].colliders ?? layer.colliders : layer.colliders,
                owned: fitted.flatMap((entry) => (entry!.far ? [entry!.geometry, entry!.far] : [entry!.geometry])),
            };
        }
        // Real trees are awaited as nothing at all: a built stand-in would pop.
        if (tree) return { draws: [], colliders: layer.colliders, owned: [] };
        const seed = body.biome!.seed * 31 + index * 977;
        const geometries = Array.from({ length: layer.variants }, (_, v) => layer.build(seed + v * 101));
        return single(geometries, createPropMaterial(body, reach, layer.sway), layer.colliders, geometries);
    }), [layers, models, pictures, body, quality, gl]);
    const resources = useMemo(() => layers.map((layer) => {
        const cellTarget = layer.cell;
        const depth = Math.max(3, Math.round(Math.log2((2 * 0.785 * body.radius) / cellTarget)));
        const cellWorld = (2 / 2 ** depth) * 0.785 * body.radius;
        const reach = layer.reach[quality];
        const perCell = layer.perCell * (cellWorld / cellTarget) ** 2;
        // Enough instances for a band's area (or the whole reach).
        const capacity = (band: [number, number] | null) => {
            const outer = Math.min(reach, band ? band[1] : reach);
            const area = Math.PI * outer * outer;
            // A layer whose variants grow in stands may show mostly one of them.
            const share = layer.crowd ?? 1 / layer.variants;
            return Math.min(16000, Math.ceil((area / (cellWorld * cellWorld)) * Math.min(perCell, 6) * 1.6 * share) + 8 + (layer.landmarks?.length ?? 0));
        };
        const state: LayerState = { layer, depth, cellWorld, reach, perCell, cache: new Map(), pending: [], center: null, dirty: true };
        return { layer, capacity, state };
    }), [layers, body, quality]);

    useEffect(() => {
        // New meshes are made for new visuals: upload the instances to them.
        resources.forEach((r) => { r.state.dirty = true; });
        return () => {
            visuals.forEach((v) => {
                v.owned.forEach((g) => g.dispose());
                new Set(v.draws.map((d) => d.material)).forEach((m) => m.dispose());
            });
        };
    }, [visuals, resources]);

    useFrame(({ camera, clock }) => {
        const group = groupRef.current;
        if (!group) return;
        const player = runtime.origin;
        const distance = player.distanceTo(body.position);
        up.copy(player).sub(body.position).divideScalar(distance);
        const altitude = runtime.currentBody === body ? runtime.altitude : distance - body.radius;
        const start = performance.now();
        // DEV: a test can lift the budget (window.__propBudget, ms) to place everything at once.
        const budget = (import.meta.env.DEV && (window as unknown as { __propBudget?: number }).__propBudget) || (quality === 2 ? 4 : 2.5);

        resources.forEach(({ state }) => {
            const { layer } = state;
            if (altitude > state.reach) return;
            // Work out which cells are needed when the player has moved far enough.
            const moveThreshold = Math.max(state.cellWorld * 2, state.reach * 0.08);
            const groundPoint = probe.copy(body.position).addScaledVector(up, body.radius);
            if (!state.center || state.center.distanceTo(groundPoint) > moveThreshold) {
                state.center = groundPoint.clone();
                const margin = moveThreshold + state.cellWorld;
                const needed = cellsNear(up, body.radius, state.depth, state.reach + margin);
                const keep = new Set<string>([LANDMARK_KEY]);
                const missing: { cell: SurfaceCell; distance: number }[] = [];
                for (const cell of needed) {
                    cellPoint(cell, 0.5, 0.5, dir);
                    const d = dir.distanceTo(up) * body.radius;
                    if (d > state.reach + margin) continue;
                    const key = cellKey(cell);
                    keep.add(key);
                    if (!state.cache.has(key)) missing.push({ cell, distance: d });
                }
                for (const key of state.cache.keys()) {
                    if (!keep.has(key)) { state.cache.delete(key); state.dirty = true; }
                }
                missing.sort((p, q) => p.distance - q.distance);
                state.pending = missing.map((m) => m.cell);
                if (layer.landmarks && !state.cache.has(LANDMARK_KEY)) {
                    state.cache.set(LANDMARK_KEY, generateLandmarks(body, layer, zone));
                    state.dirty = true;
                }
            }
            while (state.pending.length && performance.now() - start < budget) {
                const cell = state.pending.shift()!;
                state.cache.set(cellKey(cell), generateCell(body, state, cell, zone));
                state.dirty = true;
            }
        });
        if (import.meta.env.DEV) (window as unknown as { __propsPending?: number }).__propsPending = resources.reduce((n, r) => n + r.state.pending.length, 0);
        // Layers drawn in levels of detail re-sort their instances into the
        // levels as the player moves.
        if (lodCenter.current.distanceToSquared(player) > LOD_STEP * LOD_STEP * 0.8) {
            lodCenter.current.copy(player);
            visuals.forEach((visual, layerIndex) => {
                if (visual.draws.some((d) => d.band)) resources[layerIndex].state.dirty = true;
            });
        }

        // As Earth recovers, trees come back to life: lay them out again.
        const revival = revivalUniform(body.id).value;
        if (Math.abs(revival - revivalAt.current) > 0.001) {
            revivalAt.current = revival;
            visuals.forEach((visual, layerIndex) => {
                if (visual.draws.some((d) => d.life)) resources[layerIndex].state.dirty = true;
            });
        }

        // Upload instances (relative to a fresh anchor) when something changed.
        const now = clock.elapsedTime;
        const anyPending = resources.some((r) => r.state.pending.length > 0);
        const anyDirty = resources.some((r) => r.state.dirty);
        if (anyDirty && (!anyPending || now - lastUpload.current > 0.3)) {
            lastUpload.current = now;
            anchor.current.copy(player);
            lodCenter.current.copy(player);
            const obstacles: number[] = [];
            resources.forEach(({ state, capacity }, layerIndex) => {
                const meshes = meshRefs.current[layerIndex] ?? [];
                const draws = visuals[layerIndex]?.draws ?? [];
                const counts = new Array(draws.length).fill(0);
                const limits = draws.map((d) => capacity(d.band));
                // Each variant's draws (a tree has its bark, leaves and impostor).
                const byVariant: number[][] = [];
                draws.forEach((draw, k) => { (byVariant[draw.variant] ??= []).push(k); });
                const living = draws.some((d) => d.life);
                for (const instances of state.cache.values()) {
                    for (const instance of instances) {
                        const d = instance.position.distanceTo(player);
                        let placed = false;
                        // (Whether this tree is alive, when the layer's draws ask: the same answer for all of them.)
                        let alive = true;
                        if (living) {
                            treeAt.copy(instance.position).sub(body.position);
                            alive = treeAlive(treeAt.x, treeAt.y, treeAt.z, body.radius, revival);
                        }
                        for (const k of byVariant[instance.variant] ?? []) {
                            const draw = draws[k];
                            if (draw.band && (d < draw.band[0] || d > draw.band[1])) continue;
                            if (draw.life && (draw.life === 'alive') !== alive) continue;
                            const mesh = meshes[k];
                            if (!mesh || counts[k] >= limits[k]) continue;
                            if (!placed) {
                                position.copy(instance.position).sub(anchor.current);
                                scaleVector.setScalar(instance.scale);
                                matrix.compose(position, instance.quaternion, scaleVector);
                                // (A tree's colour: the tint in red, alive in blue; trees.ts TREE_LIFE.)
                                tint.setRGB(instance.tint, instance.tint, living ? (alive ? 1 : 0) : instance.tint);
                                placed = true;
                            }
                            mesh.setMatrixAt(counts[k], matrix);
                            mesh.setColorAt(counts[k], tint);
                            counts[k] += 1;
                        }
                        const colliders = visuals[layerIndex]?.colliders;
                        if (colliders && d < 400) {
                            for (const [x, y, z, r] of colliders) {
                                colliderPoint.set(x, y, z).multiplyScalar(instance.scale).applyQuaternion(instance.quaternion).add(instance.position);
                                obstacles.push(colliderPoint.x, colliderPoint.y, colliderPoint.z, r * instance.scale, state.layer.shipSolid ? 1 : 0);
                            }
                        }
                    }
                }
                meshes.forEach((mesh, k) => {
                    if (!mesh) return;
                    mesh.count = counts[k] ?? 0;
                    mesh.instanceMatrix.needsUpdate = true;
                    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                });
                state.dirty = false;
            });
            runtime.surface.obstacles = obstacles;
        }

        group.position.copy(anchor.current).sub(runtime.origin);
        cameraWorld.copy(camera.position).add(runtime.origin).sub(body.position);
        resources.forEach(({ state }, layerIndex) => {
            visuals[layerIndex]?.draws.forEach(({ material }) => {
                material.uniforms.uCamLocal.value.copy(cameraWorld);
                material.uniforms.uAnchorLocal.value.copy(anchor.current).sub(body.position);
                material.uniforms.uTime.value = clock.elapsedTime;
                material.visible = altitude < state.reach;
            });
        });
    }, -1);

    return (
        <group ref={groupRef}>
            {resources.map(({ capacity }, layerIndex) => visuals[layerIndex].draws.map((draw, k) => (
                <instancedMesh
                    key={`${layerIndex}:${k}:${draw.material.uuid}`}
                    ref={(mesh) => {
                        meshRefs.current[layerIndex] = meshRefs.current[layerIndex] ?? [];
                        meshRefs.current[layerIndex][k] = mesh;
                        if (mesh && !mesh.instanceColor) {
                            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity(draw.band) * 3).fill(1), 3);
                            mesh.count = 0;
                        }
                    }}
                    args={[draw.geometry, draw.material, capacity(draw.band)]}
                    frustumCulled={false}
                />
            )))}
        </group>
    );
};

/** Props for the rocky world the player is on (or flying over). */
export const SurfaceProps = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        const id = body && body.kind === 'rocky' && body.biome ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
            runtime.surface.obstacles = [];
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <PropLayers key={body.id} body={body} runtime={runtime} /> : null;
};

