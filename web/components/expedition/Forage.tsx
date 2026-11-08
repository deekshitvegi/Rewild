import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { findBody, type BiomeKind, type ExpeditionBody } from './bodies';
import { groundHeight, waterDepth } from './environment';
import { useModel, type ModelName } from './models';
import { cellKey, cellPoint, cellRandom, cellsNear } from './scatter';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import type { ExpeditionRuntime } from './runtime';
import type { ForagePlant } from './survival';

/**
 * Food that grows: plants bearing fruit, scattered near the explorer on every
 * world with ground (redcurrants on Earth and Haven, melons in a desert,
 * prickly pears in Mars's canyons, seed pods on the Moon and Mercury, frost
 * berries and ice-kelp bulbs on the far moons). Walk up to one and press E to
 * pick it; its fruit grows back after a few minutes.
 *
 * Each plant is a model grown in Blender (source_assets/forage): stems, every
 * leaf a blade of its own, the fruit where that plant bears it, as a mesh of
 * its own so a picked plant is drawn without it. Near the explorer the whole
 * plant is drawn; further off a lighter one (a few large leaves), the two
 * dissolving into each other. Lit like the ground round them.
 */
interface Look { model: ModelName | null; density: number }
const LOOKS: Record<BiomeKind, Look> = {
    verdant: { model: 'forageCurrant', density: 0.34 },
    desert: { model: 'forageMelon', density: 0.16 },
    canyon: { model: 'forageOpuntia', density: 0.16 },
    cratered: { model: 'forageRosette', density: 0.18 },
    frozen: { model: 'forageFrostberry', density: 0.2 },
    glacier: { model: 'forageIceKelp', density: 0.18 },
    // Nothing grows on Venus (the world is lifeless; this is never drawn).
    volcanic: { model: null, density: 0 },
    // Nor on Titan.
    methane: { model: null, density: 0 },
};
/** Fruit grows back after this long. */
const REGROW = 300;
const REACH = 140;
const MAX_PLANTS = 90;
/** Where the whole plant dissolves into the light one, per quality level (metres). */
const NEAR: [number, number][] = [[7, 11], [14, 20], [22, 30]];
/** The camera moves at most this far between sorting the plants into near and far. */
const LOD_STEP = 4;

const up = new THREE.Vector3();
const dir = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const turn = new THREE.Quaternion();
const scale = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const toPlant = new THREE.Vector3();
const camLocal = new THREE.Vector3();
const eye = new THREE.Vector3();
const tint = new THREE.Color();

interface PlantParts {
    body: THREE.BufferGeometry;
    fruit: THREE.BufferGeometry;
    bodyFar: THREE.BufferGeometry;
    fruitFar: THREE.BufferGeometry;
    map: THREE.Texture | null;
}

/** A part of the model as a plain geometry with its node transform baked in (glTF y up: the plant's own up). */
const partGeometry = (mesh: THREE.Mesh) => {
    const source = mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    const count = source.getAttribute('position').count;
    const copy = (from: string, to: string, size: number) => {
        const attribute = source.getAttribute(from);
        const values = new Float32Array(count * size);
        if (attribute) {
            for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) values[i * size + c] = attribute.getComponent(i, c);
        } else if (to === 'color') values.fill(1);
        geometry.setAttribute(to, new THREE.BufferAttribute(values, size));
    };
    copy('position', 'position', 3);
    copy('normal', 'normal', 3);
    copy('uv', 'uv', 2);
    copy('color', 'color', 3);
    // How each vertex is lit (makeplant.py KIND): the second UV map's u, times 4.
    copy('uv1', 'aKind', 1);
    const kind = geometry.getAttribute('aKind') as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) kind.setX(i, Math.round(kind.getX(i) * 4));
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingSphere();
    return geometry;
};

export const preparePlant = (gltf: GLTF): PlantParts | null => {
    const found: Record<string, THREE.Mesh> = {};
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) found[mesh.name || mesh.parent?.name || ''] = mesh;
    });
    const { body, fruit, bodyFar, fruitFar } = found;
    if (!body || !fruit || !bodyFar || !fruitFar) return null;
    return {
        body: partGeometry(body),
        fruit: partGeometry(fruit),
        bodyFar: partGeometry(bodyFar),
        fruitFar: partGeometry(fruitFar),
        map: (body.material as THREE.MeshStandardMaterial).map ?? null,
    };
};

const VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform vec3 uAnchorLocal;
uniform vec3 uCamLocal;
uniform float uTime;
attribute float aKind;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec3 vColor;
varying vec2 vUv;
varying float vKind;
varying float vDist;
void main() {
    vUv = uv;
    vColor = color;
    #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
    #endif
    vKind = aKind;
    vec3 origin = vec3(instanceMatrix[3]);
    vec3 placed = uAnchorLocal + origin;
    vDist = length(placed - uCamLocal);
    // Wind: the plant leans and springs back, more toward its top; each leaf flutters on its own.
    vec3 m = position;
    float phase = dot(placed, vec3(0.31, 0.47, 0.23));
    float wind = sin(uTime * 1.5 + phase) * 0.6 + sin(uTime * 2.9 + phase * 1.7) * 0.3;
    m.xz += vec2(0.6, 0.4) * wind * m.y * m.y * 0.05;
    float leaf = 1.0 - step(0.5, abs(aKind - 1.0));
    m += normal * leaf * sin(uTime * 6.0 + dot(position, vec3(37.0, 59.0, 23.0)) + phase) * 0.004;
    vec4 local = instanceMatrix * vec4(m, 1.0);
    vLocalPos = uAnchorLocal + local.xyz;
    vNormalLocal = normalize(mat3(instanceMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * local;
    #include <logdepthbuf_vertex>
}`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${SURFACE_SHADING_GLSL}
uniform sampler2D uMap;
uniform vec2 uMapSize;
uniform vec2 uLod;
varying vec3 vLocalPos;
varying vec3 vNormalLocal;
varying vec3 vColor;
varying vec2 vUv;
varying float vKind;
varying float vDist;
float lodDither() {
    return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
void main() {
    #include <logdepthbuf_fragment>
    // Dissolve between the whole plant and its light one.
    float t = smoothstep(uLod.x, uLod.y, vDist);
    #ifdef FORAGE_FAR
    if (lodDither() >= t) discard;
    #else
    if (lodDither() < t) discard;
    #endif
    // What this is (makeplant.py): 0 stem or skin, 1 leaf, 2 glossy fruit, 3 glossy and translucent, 4 waxy bloom.
    float leaf = 1.0 - step(0.5, abs(vKind - 1.0));
    float gloss = step(1.5, vKind) * step(vKind, 3.5);
    float juicy = 1.0 - step(0.5, abs(vKind - 3.0));
    float bloom = step(3.5, vKind);
    vec4 picture = texture2D(uMap, vUv);
    vec2 texel = vUv * uMapSize;
    vec2 ddx = dFdx(texel);
    vec2 ddy = dFdy(texel);
    float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
    vec3 V = normalize(uCamLocal - vLocalPos);
    // A leaf seen edge-on thins away rather than show as a line.
    vec3 faceN = normalize(cross(dFdx(vLocalPos), dFdy(vLocalPos)));
    float facing = abs(dot(faceN, V));
    if (picture.a * (1.0 + mip * 0.25) * mix(1.0, smoothstep(0.04, 0.22, facing), leaf) < 0.5) discard;
    vec3 up = normalize(vLocalPos);
    vec3 N = normalize(vNormalLocal);
    vec3 albedo = picture.rgb * vColor;
    // Two-sided: the far face is lit from its own side, and a leaf's underside is paler.
    if (!gl_FrontFacing) {
        N = -N;
        albedo *= mix(vec3(1.0), vec3(1.22, 1.26, 1.12), leaf);
    }
    float day = surfaceDay(up);
    vec3 color = surfaceLightWrap(albedo, N, up, mix(0.12, 0.3, leaf)) + playerLights(albedo, N, vLocalPos);
    // Skylight reaches in among the leaves from every side.
    color += albedo * mix(uHorizon, uZenith, 0.5) * 0.22 * leaf * day;
    // Light through thin leaves and juicy fruit, when the sun is behind them.
    float through = pow(max(dot(-V, uSunDir), 0.0), 3.0) * day;
    color += albedo * uSunColor * through * (0.55 * leaf + 0.9 * juicy);
    // Fruit skins: a sharp highlight on the glossy ones; a broad soft sheen and a pale rim on a waxy bloom.
    vec3 H = normalize(V + uSunDir);
    float nh = max(dot(N, H), 0.0);
    float sunUp = smoothstep(-0.05, 0.1, dot(up, uSunDir));
    // (A leaf's cuticle catches the sun too, faintly: the facets of the bush read as facets.)
    color += uSunColor * (gloss * pow(nh, 90.0) * 0.7 + bloom * pow(nh, 6.0) * 0.06 + leaf * pow(nh, 24.0) * 0.1) * sunUp;
    color += bloom * mix(uHorizon, uZenith, 0.5) * pow(1.0 - max(dot(N, V), 0.0), 2.0) * 0.35 * day;
    color = applyHaze(color, vLocalPos, up);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}`;

export const createPlantMaterial = (body: ExpeditionBody, map: THREE.Texture | null, far: boolean, lod: [number, number]) => new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: true,
    side: THREE.DoubleSide,
    defines: far ? { FORAGE_FAR: '' } : {},
    uniforms: {
        ...createSurfaceUniforms(body),
        uAnchorLocal: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uMap: { value: map },
        uMapSize: { value: new THREE.Vector2((map?.image as { width?: number } | undefined)?.width ?? 1024, (map?.image as { height?: number } | undefined)?.height ?? 1024) },
        uLod: { value: new THREE.Vector2(lod[0], lod[1]) },
    },
});

/** One plant as laid out: where it stands (relative to the anchor), and whether it has fruit on it. */
interface Slot { matrix: THREE.Matrix4; at: THREE.Vector3; ripe: boolean; shade: number }

export const ForagePlants = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const groupRef = useRef<THREE.Group>(null);
    // The whole plant and its fruit, the light plant and its fruit.
    const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([null, null, null, null]);
    const anchor = useRef(new THREE.Vector3());
    const built = useRef({ key: '', version: -1, regrowCheck: 0 });
    const slots = useRef<Slot[]>([]);
    const banded = useRef({ at: new THREE.Vector3(), dirty: true });
    // The world whose plants are drawn (its model and its light).
    const [bodyId, setBodyId] = useState<string | null>(null);
    const shown = useRef<string | null>(null);
    const body = bodyId ? findBody(bodyId) ?? null : null;
    const look = body?.biome ? LOOKS[body.biome.kind] : null;
    const gltf = useModel(look?.model ?? null);
    const quality = runtime.quality;
    const parts = useMemo(() => (gltf ? preparePlant(gltf) : null), [gltf]);
    const materials = useMemo(() => {
        if (!parts || !body) return null;
        return { near: createPlantMaterial(body, parts.map, false, NEAR[quality]), far: createPlantMaterial(body, parts.map, true, NEAR[quality]) };
    }, [parts, body, quality]);
    useEffect(() => () => {
        if (!parts) return;
        parts.body.dispose();
        parts.fruit.dispose();
        parts.bodyFar.dispose();
        parts.fruitFar.dispose();
    }, [parts]);
    useEffect(() => {
        banded.current.dirty = true;
        return () => { materials?.near.dispose(); materials?.far.dispose(); };
    }, [materials]);

    useFrame(({ camera, clock }) => {
        const current = runtime.currentBody;
        const group = groupRef.current;
        // Nothing grows on Europa or Titan that the explorer could eat.
        const onGround = current && current.kind === 'rocky' && current.biome && !current.lifeless && runtime.altitude < 600;
        const id = onGround ? current.id : null;
        if (id !== shown.current) {
            shown.current = id;
            setBodyId(id);
        }
        if (!onGround || !current?.biome) {
            slots.current = [];
            banded.current.dirty = true;
            runtime.forage.plants = [];
            runtime.forage.target = null;
            built.current.key = '';
            if (group) group.visible = false;
            return;
        }
        const density = LOOKS[current.biome.kind].density;
        const now = performance.now() / 1000;
        const player = runtime.origin;
        const distance = player.distanceTo(current.position);
        up.copy(player).sub(current.position).divideScalar(distance);
        const depth = Math.max(6, Math.round(Math.log2((2 * 0.785 * current.radius) / 24)));
        const cellSize = 2 / 2 ** depth;
        const key = `${current.id}:${Math.floor(up.x / cellSize * 0.8)}:${Math.floor(up.y / cellSize * 0.8)}:${Math.floor(up.z / cellSize * 0.8)}`;
        // Fruit grows back while the player is around: look again now and then.
        const regrow = now - built.current.regrowCheck > 10;

        if (key !== built.current.key || runtime.forage.version !== built.current.version || regrow) {
            built.current.key = key;
            built.current.version = runtime.forage.version;
            built.current.regrowCheck = now;
            anchor.current.copy(player);
            const plants: ForagePlant[] = [];
            const laid: Slot[] = [];
            const seed = current.biome.seed + 7919;
            for (const cell of cellsNear(up, current.radius, depth, REACH)) {
                if (laid.length >= MAX_PLANTS) break;
                if (cellRandom(cell, seed, 1) >= density) continue;
                const plantId = `${current.id}:food:${cellKey(cell)}`;
                cellPoint(cell, 0.1 + cellRandom(cell, seed, 2) * 0.8, 0.1 + cellRandom(cell, seed, 3) * 0.8, dir);
                if (waterDepth(current, dir) > 0) continue;
                const h = groundHeight(current, dir);
                const center = current.position.clone().addScaledVector(dir, current.radius + h);
                if (center.distanceTo(player) > REACH * 1.3) continue;
                const picked = runtime.forage.picked.get(plantId);
                const ripe = picked === undefined || now - picked > REGROW;
                if (ripe && picked !== undefined) runtime.forage.picked.delete(plantId);
                if (ripe) plants.push({ id: plantId, position: center, yield: current.biome.kind === 'verdant' ? 2 : 1 });
                // Standing upright, turned at random, a little bigger or smaller; sunk a few centimetres.
                tangent.set(0, 1, 0).cross(dir);
                if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
                tangent.normalize();
                bitangent.crossVectors(dir, tangent);
                const size = 0.95 + cellRandom(cell, seed, 4) * 0.4;
                quaternion.setFromUnitVectors(yAxis, dir).multiply(turn.setFromAxisAngle(yAxis, cellRandom(cell, seed, 5) * Math.PI * 2));
                position.copy(center).addScaledVector(dir, -0.03 * size).sub(anchor.current);
                scale.setScalar(size);
                laid.push({
                    matrix: new THREE.Matrix4().compose(position, quaternion, scale),
                    at: center.clone(),
                    ripe,
                    shade: 0.88 + cellRandom(cell, seed, 6) * 0.22,
                });
            }
            slots.current = laid;
            banded.current.dirty = true;
            runtime.forage.plants = plants;
        }

        // Sort the plants into near and far (both, where they dissolve into each other) as the camera moves:
        // distances from the eye, as the shader dissolves them.
        const meshes = meshRefs.current;
        eye.copy(camera.position).add(runtime.origin);
        if (materials && meshes.every(Boolean) && (banded.current.dirty || banded.current.at.distanceToSquared(eye) > LOD_STEP * LOD_STEP)) {
            banded.current.dirty = false;
            banded.current.at.copy(eye);
            const [start, end] = NEAR[quality];
            const counts = [0, 0, 0, 0];
            for (const slot of slots.current) {
                const d = slot.at.distanceTo(eye);
                const near = d < end + LOD_STEP;
                const far = d > start - LOD_STEP;
                tint.setRGB(slot.shade, slot.shade, slot.shade);
                const put = (k: number) => {
                    const mesh = meshes[k]!;
                    mesh.setMatrixAt(counts[k], slot.matrix);
                    mesh.setColorAt(counts[k], tint);
                    counts[k] += 1;
                };
                if (near) { put(0); if (slot.ripe) put(1); }
                if (far) { put(2); if (slot.ripe) put(3); }
            }
            meshes.forEach((mesh, k) => {
                mesh!.count = counts[k];
                mesh!.instanceMatrix.needsUpdate = true;
                if (mesh!.instanceColor) mesh!.instanceColor.needsUpdate = true;
            });
        }
        if (group) {
            group.visible = true;
            group.position.copy(anchor.current).sub(runtime.origin);
        }
        if (materials) {
            camLocal.copy(camera.position).add(runtime.origin).sub(current.position);
            for (const material of [materials.near, materials.far]) {
                material.uniforms.uCamLocal.value.copy(camLocal);
                material.uniforms.uAnchorLocal.value.copy(anchor.current).sub(current.position);
                material.uniforms.uTime.value = clock.elapsedTime;
            }
        }

        // The plant in reach: close, and in front of the explorer.
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        let target: ForagePlant | null = null;
        if (walker) {
            let best = Infinity;
            for (const plant of runtime.forage.plants) {
                toPlant.copy(plant.position).sub(walker.position);
                const d = toPlant.length();
                if (d > 2.8) continue;
                const ahead = toPlant.divideScalar(Math.max(d, 1e-3)).dot(walker.facing);
                if (ahead < 0.2 && d > 1.4) continue;
                if (d < best) { best = d; target = plant; }
            }
        }
        runtime.forage.target = target;
    });

    const instanced = (k: number, geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial) => (
        <instancedMesh
            ref={(mesh) => {
                meshRefs.current[k] = mesh;
                if (mesh && !mesh.instanceColor) {
                    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLANTS * 3).fill(1), 3);
                    mesh.count = 0;
                }
            }}
            args={[geometry, material, MAX_PLANTS]}
            frustumCulled={false}
        />
    );
    return (
        <group ref={groupRef} visible={false}>
            {parts && materials && (
                <group key={materials.near.uuid}>
                    {instanced(0, parts.body, materials.near)}
                    {instanced(1, parts.fruit, materials.near)}
                    {instanced(2, parts.bodyFar, materials.far)}
                    {instanced(3, parts.fruitFar, materials.far)}
                </group>
            )}
        </group>
    );
};
