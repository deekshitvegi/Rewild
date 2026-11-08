import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { REVIVAL_GLSL } from './revival';
import type { ExpeditionBody } from './bodies';

/**
 * Real trees: three-dimensional trunks, branches and leaf sprays grown in
 * Blender (source_assets/trees, public/models/expedition/ATTRIBUTION.md), drawn as they are near
 * the explorer and, further off, as impostors: pictures of the very same tree
 * taken from sixteen sides when it loads, so the distant forest is the near
 * one and a tree does not change its shape when it swaps over.
 */

export interface TreeParts {
    /** The wood but for the finest twigs. */
    bark: THREE.BufferGeometry;
    /** The finest twigs (the same vertices, their own triangles): drawn only on dead trees. Null if the model has none. */
    twigs: THREE.BufferGeometry | null;
    leaves: THREE.BufferGeometry;
    barkMap: THREE.Texture | null;
    barkNormal: THREE.Texture | null;
    leafMap: THREE.Texture | null;
    /** Half the crown's width, as a fraction of the tree's height. */
    halfWidth: number;
}

/** A part of the model as a plain geometry with its node transform baked in. */
const partGeometry = (mesh: THREE.Mesh) => {
    const source = mesh.geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv', 'color']) {
        const attribute = source.getAttribute(name);
        if (!attribute) continue;
        const size = name === 'color' ? 3 : attribute.itemSize;
        const values = new Float32Array(attribute.count * size);
        for (let i = 0; i < attribute.count; i++) {
            for (let c = 0; c < size; c++) values[i * size + c] = attribute.getComponent(i, c);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    if (!geometry.getAttribute('color')) {
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(source.getAttribute('position').count * 3).fill(1), 3));
    }
    // The finest twigs are marked in a second UV map, u = 1 (maketree2.py): a living tree leaves them to its leaf
    // sprays, whose photographs have their own stems; a dead one shows them.
    const marks = source.getAttribute('uv1');
    const twig = new Float32Array(source.getAttribute('position').count);
    if (marks) for (let i = 0; i < twig.length; i++) twig[i] = marks.getX(i) > 0.5 ? 1 : 0;
    geometry.setAttribute('aTwig', new THREE.BufferAttribute(twig, 1));
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4(mesh.matrixWorld);
    return geometry;
};

/**
 * The tree 1 unit tall with the foot of its trunk at the origin, so a layer's
 * scale is its height in metres.
 */
export const prepareTree = (gltf: GLTF): TreeParts | null => {
    let bark: THREE.Mesh | null = null;
    let leaves: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const name = `${mesh.name} ${mesh.parent?.name ?? ''}`;
        if (/leaves/.test(name)) leaves = mesh;
        else if (/bark/.test(name)) bark = mesh;
    });
    if (!bark || !leaves) return null;
    const barkGeometry = partGeometry(bark);
    const leafGeometry = partGeometry(leaves);
    // The trunk's foot: the middle of the bark's lowest ring.
    const positions = barkGeometry.getAttribute('position');
    barkGeometry.computeBoundingBox();
    const box = barkGeometry.boundingBox!.clone();
    leafGeometry.computeBoundingBox();
    box.union(leafGeometry.boundingBox!);
    const low = box.min.y + (box.max.y - box.min.y) * 0.01;
    let fx = 0;
    let fz = 0;
    let n = 0;
    for (let i = 0; i < positions.count; i++) {
        if (positions.getY(i) > low) continue;
        fx += positions.getX(i);
        fz += positions.getZ(i);
        n += 1;
    }
    if (n > 0) { fx /= n; fz /= n; }
    const height = box.max.y - box.min.y;
    const matrix = new THREE.Matrix4().makeScale(1 / height, 1 / height, 1 / height)
        .multiply(new THREE.Matrix4().makeTranslation(-fx, -box.min.y, -fz));
    barkGeometry.applyMatrix4(matrix);
    leafGeometry.applyMatrix4(matrix);
    barkGeometry.computeBoundingSphere();
    leafGeometry.computeBoundingSphere();
    // The widest the crown reaches from the trunk, in any direction.
    let reach = 0;
    for (const geometry of [barkGeometry, leafGeometry]) {
        const p = geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) reach = Math.max(reach, Math.hypot(p.getX(i), p.getZ(i)));
    }
    // The finest twigs as a geometry of their own, sharing the bark's vertices: a living tree's leaf sprays show its
    // twigs, so only a dead tree draws them.
    let twigs: THREE.BufferGeometry | null = null;
    const index = barkGeometry.getIndex();
    const mark = barkGeometry.getAttribute('aTwig');
    if (index && mark) {
        const wood: number[] = [];
        const fine: number[] = [];
        for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i);
            const b = index.getX(i + 1);
            const c = index.getX(i + 2);
            (mark.getX(a) > 0.5 && mark.getX(b) > 0.5 && mark.getX(c) > 0.5 ? fine : wood).push(a, b, c);
        }
        if (fine.length > 0) {
            twigs = new THREE.BufferGeometry();
            for (const [name, attribute] of Object.entries(barkGeometry.attributes)) twigs.setAttribute(name, attribute);
            twigs.setIndex(fine);
            twigs.boundingSphere = barkGeometry.boundingSphere!.clone();
            barkGeometry.setIndex(wood);
        }
    }
    const material = (mesh: THREE.Mesh) => mesh.material as THREE.MeshStandardMaterial;
    return {
        bark: barkGeometry,
        twigs,
        leaves: leafGeometry,
        barkMap: material(bark).map ?? null,
        barkNormal: material(bark).normalMap ?? null,
        leafMap: material(leaves).map ?? null,
        halfWidth: reach,
    };
};

/** Sides the impostor is photographed from, all round the tree. */
export const IMPOSTOR_FRAMES = 16;
/** Pictures in a strip: the sides, then one from straight above (for a tree seen from the air). */
export const IMPOSTOR_TILES = IMPOSTOR_FRAMES + 1;
/** The height (of the tree's 1) where the picture from above lies: the middle of a crown. */
const TOP_CARD = 0.62;

export interface TreeImpostor {
    albedo: THREE.Texture;
    normal: THREE.Texture;
    /** The same tree dead (ruined Earth): bark and every twig, no leaves. */
    dead: { albedo: THREE.Texture; normal: THREE.Texture } | null;
    targets: THREE.WebGLRenderTarget[];
    halfWidth: number;
    /** Pixels per photograph, square. */
    tile: number;
}

/**
 * How a crown's leaves are shaded before any light falls on them: the
 * occlusion baked into the model made deeper, so the inside of a crown is
 * dark as in a photograph, and broad patches across it of lighter and darker,
 * yellower and greener leaves. `ao` is the baked occlusion, `m` the position
 * in the tree's own units (1 tall). Shared by the near trees and the bake of
 * their impostors so the two match.
 */
const LEAF_SHADE_GLSL = /* glsl */ `
vec3 leafShade(vec3 ao, vec3 m) {
    vec3 shade = pow(max(ao, vec3(0.0)), vec3(1.7));
    float patchy = sin(m.x * 11.0 + m.y * 7.0 + m.z * 3.0) * sin(m.z * 9.0 - m.y * 6.0 + m.x * 2.0);
    return shade * (1.0 + 0.16 * patchy) * mix(vec3(1.0), vec3(1.08, 1.04, 0.86), 0.5 + 0.5 * patchy);
}
`;

const bakeMaterial = (map: THREE.Texture | null, cutout: boolean, output: 'albedo' | 'normal') => new THREE.ShaderMaterial({
    side: cutout ? THREE.DoubleSide : THREE.FrontSide,
    defines: { ...(cutout ? { CUTOUT: '' } : {}), ...(output === 'normal' ? { NORMALS: '' } : {}) },
    uniforms: { uMap: { value: map } },
    vertexShader: /* glsl */ `
        ${LEAF_SHADE_GLSL}
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
            vUv = uv;
            #ifdef CUTOUT
            vColor = leafShade(color, position);
            #else
            vColor = color;
            #endif
            vNormal = normal;
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            vView = view.xyz;
            gl_Position = projectionMatrix * view;
        }`,
    fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
            vec4 picture = texture2D(uMap, vUv);
            #ifdef CUTOUT
            // As in the game: a spray seen edge-on is left out, not drawn as a streak.
            float facing = abs(normalize(cross(dFdx(vView), dFdy(vView))).z);
            if (picture.a * smoothstep(0.05, 0.28, facing) < 0.5) discard;
            #endif
            #ifdef NORMALS
            gl_FragColor = vec4(normalize(vNormal) * 0.5 + 0.5, 1.0);
            #else
            gl_FragColor = vec4(picture.rgb * vColor, 1.0);
            #endif
        }`,
    vertexColors: true,
});

/**
 * Photographs the tree from IMPOSTOR_FRAMES sides, level with it, and once
 * from straight above, into two strips: its colour (with the ambient occlusion
 * baked into the model) and its normals, so the impostor is lit by the world's
 * own sun. Frame i looks from the direction (sin a, 0, cos a) in the tree's own
 * frame, a = 2 pi i / N; the last frame looks down, +X to the right and -Z up.
 */
export const bakeImpostor = (renderer: THREE.WebGLRenderer, parts: TreeParts, tile = 160, dead = false): TreeImpostor => {
    const halfWidth = Math.max(parts.halfWidth * 1.04, 0.2);
    const make = () => {
        const target = new THREE.WebGLRenderTarget(tile * IMPOSTOR_TILES, tile, {
            generateMipmaps: true,
            minFilter: THREE.LinearMipmapLinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: true,
        });
        target.texture.colorSpace = THREE.NoColorSpace;
        return target;
    };
    const albedo = make();
    const normal = make();
    const deadAlbedo = dead ? make() : null;
    const deadNormal = dead ? make() : null;
    const scene = new THREE.Scene();
    const bark = new THREE.Mesh(parts.bark);
    const leaves = new THREE.Mesh(parts.leaves);
    const twigs = new THREE.Mesh(parts.twigs ?? new THREE.BufferGeometry());
    scene.add(bark, leaves, twigs);
    // Orthographic, the tree filling the tile: 1 unit tall, halfWidth either side.
    const aspect = halfWidth * 2;
    const camera = new THREE.OrthographicCamera(-aspect / 2, aspect / 2, 1.0, 0.0, 0.01, 10);
    // From above: the crown's whole width each way, the tree's full height in depth.
    const above = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfWidth, -halfWidth, 0.01, 10);
    above.position.set(0, 4, 0);
    above.up.set(0, 0, -1);
    above.lookAt(0, 0, 0);
    above.updateMatrixWorld();
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    const previousScissor = renderer.getScissorTest();
    renderer.autoClear = false;
    const passes: [THREE.WebGLRenderTarget, 'albedo' | 'normal', THREE.Color, boolean][] = [
        // Cleared to a dark foliage colour, not black, so the mip levels do not
        // darken the edges of distant trees.
        [albedo, 'albedo', new THREE.Color(0.1, 0.12, 0.06), false],
        [normal, 'normal', new THREE.Color(0.5, 0.5, 1.0), false],
        // Dead: the bark with every twig and no leaves, cleared to the wood's own dark grey.
        ...(deadAlbedo && deadNormal ? [
            [deadAlbedo, 'albedo', new THREE.Color(0.1, 0.09, 0.08), true],
            [deadNormal, 'normal', new THREE.Color(0.5, 0.5, 1.0), true],
        ] as [THREE.WebGLRenderTarget, 'albedo' | 'normal', THREE.Color, boolean][] : []),
    ];
    const materials: THREE.Material[] = [];
    for (const [target, output, clear, bare] of passes) {
        const barkMaterial = bakeMaterial(parts.barkMap, false, output);
        const leafMaterial = bakeMaterial(parts.leafMap, true, output);
        materials.push(barkMaterial, leafMaterial);
        bark.material = barkMaterial;
        twigs.material = barkMaterial;
        leaves.material = leafMaterial;
        leaves.visible = !bare;
        twigs.visible = bare && !!parts.twigs;
        renderer.setRenderTarget(target);
        renderer.setScissorTest(false);
        renderer.setClearColor(clear, 0);
        renderer.clear(true, true, false);
        renderer.setScissorTest(true);
        for (let i = 0; i < IMPOSTOR_FRAMES; i++) {
            const a = (i / IMPOSTOR_FRAMES) * Math.PI * 2;
            camera.position.set(Math.sin(a) * 4, 0, Math.cos(a) * 4);
            camera.lookAt(0, 0, 0);
            camera.updateMatrixWorld();
            target.viewport.set(i * tile, 0, tile, tile);
            target.scissor.set(i * tile, 0, tile, tile);
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
        }
        target.viewport.set(IMPOSTOR_FRAMES * tile, 0, tile, tile);
        target.scissor.set(IMPOSTOR_FRAMES * tile, 0, tile, tile);
        renderer.setRenderTarget(target);
        renderer.render(scene, above);
    }
    renderer.setScissorTest(previousScissor);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    renderer.autoClear = previousAutoClear;
    materials.forEach((material) => material.dispose());
    const targets = [albedo, normal, ...(deadAlbedo && deadNormal ? [deadAlbedo, deadNormal] : [])];
    for (const target of targets) {
        target.viewport.set(0, 0, tile * IMPOSTOR_TILES, tile);
        target.scissor.set(0, 0, tile * IMPOSTOR_TILES, tile);
    }
    return {
        albedo: albedo.texture,
        normal: normal.texture,
        dead: deadAlbedo && deadNormal ? { albedo: deadAlbedo.texture, normal: deadNormal.texture } : null,
        targets,
        halfWidth,
        tile,
    };
};

/**
 * An impostor's two cards: one standing, 1 unit tall on the tree's axis, which the vertex shader
 * turns to the camera; one lying across the crown (aTop 1) with the picture from above. Seen from
 * the side the first is drawn, from the air the second, and in between both, dissolving.
 */
export const impostorGeometry = () => {
    const side = new THREE.PlaneGeometry(1, 1, 1, 1);
    side.translate(0, 0.5, 0);
    const top = new THREE.PlaneGeometry(1, 1, 1, 1);
    const geometry = mergeGeometries([side, top])!;
    side.dispose();
    top.dispose();
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(8 * 3).fill(1), 3));
    geometry.setAttribute('aTop', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]), 1));
    return geometry;
};

/** A tree's shadow: one card, lying on the ground, shaped and placed by the shader (createTreeShadowMaterial). */
export const treeShadowGeometry = () => {
    const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4 * 3).fill(1), 3));
    return geometry;
};

/**
 * The soft shadow a crown casts on the ground: its outline from above (the impostor's last picture,
 * blurred), thrown away from the sun and drawn out as the sun sinks. It lies on the ground's level at
 * the trunk, so near the camera, where a slope would show it floating or cut, it fades away; from the
 * air, where a wood of trees without shadows looks pasted on the land, it is what gives the wood depth.
 */
export const createTreeShadowMaterial = ({ body, reach, impostor, life = false }: { body: ExpeditionBody; reach: number; impostor: TreeImpostor; life?: boolean }) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    defines: { FRAMES: `${IMPOSTOR_FRAMES}.0`, TILES: `${IMPOSTOR_TILES}.0`, TOP_CARD: `${TOP_CARD}`, ...(life ? { TREE_LIFE: '' } : {}) },
    uniforms: {
        ...createSurfaceUniforms(body),
        uAnchorLocal: { value: new THREE.Vector3() },
        uReach: { value: reach },
        uTime: { value: 0 },
        uMap: { value: impostor.albedo },
        uHalfWidth: { value: impostor.halfWidth },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uAnchorLocal;
        uniform vec3 uCamLocal;
        uniform vec3 uSunDir;
        uniform float uReach;
        uniform float uHalfWidth;
        varying vec3 vLocalPos;
        varying vec2 vTop;
        varying float vStrength;
        void main() {
            vec3 origin = vec3(instanceMatrix[3]);
            vec3 placed = uAnchorLocal + origin;
            vec3 up = normalize(placed);
            mat3 basis = mat3(instanceMatrix);
            float scale = length(basis[1]);
            vec3 axisX = basis[0] / scale;
            vec3 axisZ = basis[2] / scale;
            float rise = dot(uSunDir, up);
            float dist = length(placed - uCamLocal);
            // Dead trees (ruined Earth) cast only a thin lace of twigs.
            float alive = 1.0;
            #if defined(TREE_LIFE) && defined(USE_INSTANCING_COLOR)
            alive = step(0.5, instanceColor.b);
            #endif
            vStrength = smoothstep(0.04, 0.2, rise) * smoothstep(55.0, 110.0, dist)
                * (1.0 - smoothstep(uReach * 0.7, uReach, dist)) * mix(0.25, 1.0, alive);
            if (vStrength < 0.004) {
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                return;
            }
            // Along the ground away from the sun, the crown's shadow lies its height over the slope of the light
            // beyond the trunk, and drawn out as long as the light is low (to three times its width).
            vec3 away = -(uSunDir - up * rise);
            away = length(away) > 1e-4 ? normalize(away) : axisX;
            vec3 across = normalize(cross(up, away));
            float sinE = max(rise, 0.05);
            float cosE = sqrt(max(1.0 - sinE * sinE, 0.0));
            float hw = uHalfWidth * scale;
            float reachOut = min(TOP_CARD * scale * cosE / sinE, 2.5 * scale);
            float drawn = clamp(1.0 / sinE, 1.0, 3.0);
            vec2 q = (uv - 0.5) * 2.0 * hw;
            vec3 crown = across * q.x + away * q.y;
            vec3 local = origin + away * (reachOut + q.y * (drawn - 1.0)) + crown + up * 0.3;
            // Where on the picture from above (+X right, -Z up) this point of the crown is.
            vTop = vec2(0.5 + dot(crown, axisX) / (2.0 * hw), 0.5 - dot(crown, axisZ) / (2.0 * hw));
            vLocalPos = uAnchorLocal + local;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        uniform sampler2D uMap;
        varying vec3 vLocalPos;
        varying vec2 vTop;
        varying float vStrength;
        void main() {
            #include <logdepthbuf_fragment>
            if (any(lessThan(vTop, vec2(0.0))) || any(greaterThan(vTop, vec2(1.0)))) discard;
            // The crown's cover from above, softened (a few mip levels down: the edge of a shadow is never sharp).
            float cover = textureLod(uMap, vec2((FRAMES + vTop.x) / TILES, vTop.y), 2.5).a;
            vec3 up = normalize(vLocalPos);
            // Sky light fills a shadow in: it darkens the ground by about half where the crown is thick, and the
            // air between thins it like everything else far off.
            float thick = 1.0 + uStorm * 2.2 + uDust * 9.5;
            float haze = 1.0 - exp(-airDepth(uCamLocal, vLocalPos) * 0.9 * uHaze * uAerial * thick);
            float shade = cover * 0.5 * vStrength * surfaceDay(up) * (1.0 - haze) * (1.0 - 0.8 * max(uStorm, uOvercast));
            if (shade < 0.004) discard;
            gl_FragColor = vec4(0.0, 0.0, 0.0, shade);
        }`,
});

// Interleaved gradient noise: a fixed screen-space pattern for dissolving one
// level of detail into the other without a seam and without transparency.
const DITHER_GLSL = /* glsl */ `
float lodDither() {
    return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`;

export type TreePart = 'bark' | 'leaves' | 'impostor';

export interface TreeMaterialOptions {
    body: ExpeditionBody;
    part: TreePart;
    /** Near: drawn until `lod` [start, end] (dissolving across it); impostor: from it. */
    lod: [number, number];
    /** The impostor fades into the ground at the edge of the layer's reach. */
    reach: number;
    sway: number;
    map: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    halfWidth?: number;
    /** The impostor's normals, photographed with its colours. */
    normalAtlas?: THREE.Texture | null;
    /** The impostor of the same tree dead (ruined Earth), colours and normals. */
    deadAtlas?: { albedo: THREE.Texture; normal: THREE.Texture } | null;
    /** Snow on the upward faces of the crown. */
    snow?: number;
    tint?: string;
    /**
     * Whether each tree is alive comes with the instance (its colour's blue: Props.tsx works it out on the CPU), not
     * from the shader's own revival rule: so a dead tree's leaves and a living tree's twigs are not drawn at all.
     */
    life?: boolean;
}

/** Material for one part of a tree layer. Positions are relative to the layer's anchor. */
export const createTreeMaterial = ({ body, part, lod, reach, sway, map, normalMap = null, normalAtlas = null, deadAtlas = null, halfWidth = 0.4, snow = 0, tint = '#ffffff', life = false }: TreeMaterialOptions) => new THREE.ShaderMaterial({
    vertexColors: true,
    side: part === 'bark' ? THREE.FrontSide : THREE.DoubleSide,
    defines: {
        ...(part === 'bark' ? { TREE_BARK: '' } : {}),
        ...(part === 'leaves' ? { TREE_LEAVES: '' } : {}),
        ...(part === 'impostor' ? { TREE_IMPOSTOR: '', FRAMES: `${IMPOSTOR_FRAMES}.0`, TILES: `${IMPOSTOR_TILES}.0`, TOP_CARD: `${TOP_CARD}` } : {}),
        ...(normalMap ? { TREE_NORMAL_MAP: '' } : {}),
        ...(part === 'impostor' && deadAtlas ? { TREE_DEAD_IMPOSTOR: '' } : {}),
        ...(life ? { TREE_LIFE: '' } : {}),
    },
    uniforms: {
        ...createSurfaceUniforms(body),
        uAnchorLocal: { value: new THREE.Vector3() },
        uLod: { value: new THREE.Vector2(lod[0], lod[1]) },
        uReach: { value: reach },
        uSway: { value: sway },
        uTime: { value: 0 },
        uMap: { value: map },
        uNormalMap: { value: normalMap },
        uNormalAtlas: { value: normalAtlas },
        uDeadMap: { value: deadAtlas?.albedo ?? null },
        uDeadNormalAtlas: { value: deadAtlas?.normal ?? null },
        uMapSize: { value: new THREE.Vector2((map?.image as { width?: number } | undefined)?.width ?? 256, (map?.image as { height?: number } | undefined)?.height ?? 256) },
        uHalfWidth: { value: halfWidth },
        uSnow: { value: snow },
        uTint: { value: new THREE.Color(tint) },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${LEAF_SHADE_GLSL}
        uniform vec3 uAnchorLocal;
        uniform vec3 uCamLocal;
        uniform float uReach;
        uniform float uSway;
        uniform float uTime;
        uniform float uHalfWidth;
        uniform float uRadius;
        ${REVIVAL_GLSL}
        attribute float aTwig;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vDist;
        varying float vHeight;
        varying float vDead;
        #ifdef TREE_IMPOSTOR
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying float vFrame;
        varying float vTop;
        varying float vShow;
        attribute float aTop;
        #endif
        void main() {
            vUv = uv;
            #ifdef TREE_LEAVES
            vColor = leafShade(color, position);
            #else
            vColor = color;
            #endif
            #ifdef USE_INSTANCING_COLOR
            // (Red carries the tint, blue whether the tree is alive: TREE_LIFE.)
            vColor *= vec3(instanceColor.r);
            #endif
            vec3 origin = vec3(instanceMatrix[3]);
            vec3 placed = uAnchorLocal + origin;
            // Ruined Earth (revival.ts): a tree is alive where life has come back (some of them,
            // where it is only coming), else a bare grey snag: no leaves, every twig showing, and far
            // off its own photographs dead (when there are any).
            #if defined(TREE_LIFE) && defined(USE_INSTANCING_COLOR)
            float alive = step(0.5, instanceColor.b);
            #else
            float life = revivalLife(normalize(placed), length(placed) - uRadius);
            float alive = step(rvHash(floor(placed * 0.37)), life);
            #endif
            vDead = 1.0 - alive;
            #if defined(TREE_LEAVES) || (defined(TREE_IMPOSTOR) && !defined(TREE_DEAD_IMPOSTOR))
            if (alive < 0.5) {
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                return;
            }
            #endif
            #ifdef TREE_BARK
            // A living tree's finest twigs are in its leaf sprays' photographs.
            if (alive > 0.5 && aTwig > 0.5) {
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                return;
            }
            #endif
            float dist = length(placed - uCamLocal);
            vDist = dist;
            mat3 basis = mat3(instanceMatrix);
            float scale = length(basis[1]);
            vec3 axisX = basis[0] / scale;
            vec3 axisY = basis[1] / scale;
            vec3 axisZ = basis[2] / scale;
            // Wind: the whole tree leans and springs back, more near its top.
            float phase = dot(placed, vec3(0.013, 0.017, 0.011));
            float wind = sin(uTime * 1.1 + phase) * 0.6 + sin(uTime * 2.3 + phase * 1.7) * 0.25;
            #ifdef TREE_IMPOSTOR
            vec3 toCam = uCamLocal - placed;
            // How high the camera looks down on the tree: the standing card shows below about 55
            // degrees, the one from above over about 25, both dissolving into each other between.
            float rise = dot(toCam, axisY) / max(length(toCam), 1e-3);
            float show = aTop > 0.5 ? smoothstep(0.4, 0.75, rise) : 1.0 - smoothstep(0.55, 0.85, rise);
            vShow = show;
            vTop = aTop;
            if (show < 0.004) {
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                return;
            }
            // The standing card turned about the tree's own axis to face the camera; the other lies
            // across the crown, turned with the tree (+X right, -Z up in its picture).
            vec3 level = toCam - axisY * dot(toCam, axisY);
            vec3 side = length(level) > 1e-3 ? normalize(cross(axisY, level)) : axisX;
            float across = (uv.x - 0.5) * 2.0 * uHalfWidth;
            vec3 p = aTop > 0.5
                ? axisX * across - axisZ * (uv.y - 0.5) * 2.0 * uHalfWidth + axisY * TOP_CARD
                : side * across + axisY * uv.y;
            float swayAt = aTop > 0.5 ? TOP_CARD : uv.y;
            p += (axisX * 0.6 + axisZ * 0.4) * wind * uSway * swayAt * swayAt * 0.02;
            // Which photograph: the direction to the camera in the tree's frame.
            float azimuth = atan(dot(level, axisX), dot(level, axisZ));
            vFrame = fract(azimuth / 6.28318530718) * FRAMES;
            vAxisX = axisX;
            vAxisY = axisY;
            vAxisZ = axisZ;
            // Shrink into the ground at the edge of its reach.
            float fade = 1.0 - smoothstep(uReach * 0.8, uReach, dist);
            vec3 local = origin + p * scale * fade - normalize(placed) * dist * 0.003;
            vHeight = aTop > 0.5 ? TOP_CARD : uv.y;
            vNormalLocal = axisY;
            #else
            vec3 m = position;
            m += vec3(0.6, 0.0, 0.4) * wind * uSway * m.y * m.y * 0.02;
            #ifdef TREE_LEAVES
            // Each spray flutters on its own.
            float flutter = sin(uTime * 7.0 + dot(m, vec3(91.0, 57.0, 73.0)) + phase * 3.0);
            m += normal * flutter * 0.0015 * uSway;
            #endif
            vec3 local = origin + basis * m;
            vHeight = position.y;
            vNormalLocal = basis * normal / scale;
            #endif
            vLocalPos = uAnchorLocal + local;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 1.0);
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        ${DITHER_GLSL}
        ${REVIVAL_GLSL}
        varying float vDead;
        uniform sampler2D uMap;
        uniform sampler2D uNormalMap;
        uniform vec2 uMapSize;
        uniform vec2 uLod;
        uniform float uSnow;
        uniform vec3 uTint;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vDist;
        varying float vHeight;
        #ifdef TREE_IMPOSTOR
        uniform sampler2D uNormalAtlas;
        #ifdef TREE_DEAD_IMPOSTOR
        uniform sampler2D uDeadMap;
        uniform sampler2D uDeadNormalAtlas;
        #endif
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        varying float vFrame;
        varying float vTop;
        varying float vShow;
        #endif

        // Normal mapping without stored tangents: a frame from screen derivatives.
        vec3 perturb(vec3 N, vec3 position, vec2 uv, vec3 mapN) {
            vec3 dp1 = dFdx(position);
            vec3 dp2 = dFdy(position);
            vec2 duv1 = dFdx(uv);
            vec2 duv2 = dFdy(uv);
            vec3 dp2perp = cross(dp2, N);
            vec3 dp1perp = cross(N, dp1);
            vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
            vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
            float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
            return normalize(mat3(T * invmax, B * invmax, N) * mapN);
        }

        void main() {
            #include <logdepthbuf_fragment>
            // Dissolve between the near tree and its impostor.
            float t = smoothstep(uLod.x, uLod.y, vDist);
            #ifdef TREE_IMPOSTOR
            if (lodDither() >= t) discard;
            // Between the side and the air, the two cards share the pixels (another pattern, so the
            // two dissolves do not line up).
            if (fract(lodDither() + 0.5) >= vShow) discard;
            #else
            if (lodDither() < t) discard;
            #endif
            vec3 up = normalize(vLocalPos);
            vec3 N = normalize(vNormalLocal);
            vec3 albedo = vColor * uTint;
            float wrap = 0.0;
            float leafy = 0.0;
            #ifdef TREE_IMPOSTOR
            // Two neighbouring photographs, chosen pixel by pixel. The mip level
            // comes from the card's own smooth coordinates: the frame jumping
            // from pixel to pixel would otherwise pick the smallest one.
            float frame = floor(vFrame);
            if (lodDither() < vFrame - frame) frame += 1.0;
            frame = mod(frame, FRAMES);
            // (The card lying across the crown shows the last picture, the one from above.)
            if (vTop > 0.5) frame = FRAMES;
            vec2 uv = vec2((frame + vUv.x) / TILES, vUv.y);
            vec2 gradX = dFdx(vUv) * vec2(1.0 / TILES, 1.0);
            vec2 gradY = dFdy(vUv) * vec2(1.0 / TILES, 1.0);
            // (Explicit gradients: safe to choose between the living and the dead photographs per pixel.)
            vec4 picture;
            vec4 facing;
            #ifdef TREE_DEAD_IMPOSTOR
            if (vDead > 0.5) {
                picture = textureGrad(uDeadMap, uv, gradX, gradY);
                facing = textureGrad(uDeadNormalAtlas, uv, gradX, gradY);
            } else {
                picture = textureGrad(uMap, uv, gradX, gradY);
                facing = textureGrad(uNormalAtlas, uv, gradX, gradY);
            }
            #else
            picture = textureGrad(uMap, uv, gradX, gradY);
            facing = textureGrad(uNormalAtlas, uv, gradX, gradY);
            #endif
            vec2 texel = vUv * uMapSize.y;
            vec2 ddx = dFdx(texel);
            vec2 ddy = dFdy(texel);
            float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
            if (picture.a * (1.0 + mip * 0.3) < 0.5) discard;
            // Both strips were photographed on nothing, so their smaller mip
            // levels are the tree's own colours and normals times its coverage.
            vec3 n = facing.xyz / max(facing.a, 1e-3) * 2.0 - 1.0;
            N = normalize(vAxisX * n.x + vAxisY * n.y + vAxisZ * n.z);
            albedo *= picture.rgb / max(picture.a, 1e-3);
            // A crown of leaves is lit as one soft mass; bare wood is not.
            wrap = mix(0.5, 0.15, vDead);
            leafy = 1.0 - vDead;
            #endif
            #ifdef TREE_LEAVES
            vec4 picture = texture2D(uMap, vUv);
            vec2 texel = vUv * uMapSize;
            vec2 ddx = dFdx(texel);
            vec2 ddy = dFdy(texel);
            float mip = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
            // A spray seen edge-on is a streak, not leaves: it thins away as it turns side-on.
            vec3 faceN = normalize(cross(dFdx(vLocalPos), dFdy(vLocalPos)));
            float facing = abs(dot(faceN, normalize(uCamLocal - vLocalPos)));
            if (picture.a * (1.0 + mip * 0.25) * smoothstep(0.05, 0.28, facing) < 0.5) discard;
            albedo *= picture.rgb;
            wrap = 0.5;
            leafy = 1.0;
            #endif
            #ifdef TREE_BARK
            albedo *= texture2D(uMap, vUv).rgb;
            #ifdef TREE_NORMAL_MAP
            vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
            N = perturb(N, vLocalPos, vUv, mapN);
            #endif
            #endif
            // Dead wood, near or far: weathered to grey ash.
            #if defined(TREE_BARK) || defined(TREE_IMPOSTOR)
            if (vDead > 0.5) albedo = ashOf(albedo) * 1.15;
            #endif
            // Snow settles on what faces up.
            albedo = mix(albedo, vec3(0.9, 0.93, 0.96), uSnow * smoothstep(0.25, 0.7, dot(N, up)));
            vec3 color = surfaceLightWrap(albedo, N, up, wrap) + playerLights(albedo, N, vLocalPos);
            // Skylight reaches into a crown from every side.
            color += albedo * mix(uHorizon, uZenith, 0.5) * 0.3 * leafy * surfaceDay(up);
            // Leaves glow where the sun shines through them.
            vec3 viewDir = normalize(vLocalPos - uCamLocal);
            float through = pow(max(dot(viewDir, uSunDir), 0.0), 3.0) * surfaceDay(up);
            color += albedo * uSunColor * through * 0.55 * leafy;
            color = applyHaze(color, vLocalPos, up);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});
