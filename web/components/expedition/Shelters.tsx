import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { gnoise } from './noise';
import { groundHeight, levelGround } from './environment';
import { landingZoneDirection } from './sites';
import { loadPicture, rockPictureOf } from './PlanetTerrain';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { watchView, type ExpeditionRuntime } from './runtime';
import { climateOf } from './weather';

/**
 * Rock shelters: hollows in outcrops of the world's own rock, open on one
 * side, of the kind wind and water carve out of a cliff foot or a boulder.
 * Two stand a short walk from each landing site that has weather; inside,
 * rock overhead keeps off lightning and most of a flare's protons.
 */
export interface Shelter {
    id: string;
    /** The middle of its floor (world units), its up, and the way its mouth opens. */
    centre: THREE.Vector3;
    up: THREE.Vector3;
    mouth: THREE.Vector3;
    seed: number;
}

/** The hollow (metres): how far from the middle, and how high, counts as under rock. */
export const SHELTER_INSIDE = 5.2;
const HOLLOW_HEIGHT = 3.9;
/** The rock round it: outer radius and height, inner radius and height (metres). */
const OUTER: [number, number] = [7.4, 5.6];
const INNER: [number, number] = [5.8, 4.2];
/** Half-width of the mouth (radians) and how high it reaches (metres). */
const MOUTH = 0.72;
const MOUTH_TOP = 3.1;

const cache = new Map<string, Shelter[]>();

/** The shelters by a world's landing site (none on worlds without weather). */
export const sheltersOn = (body: ExpeditionBody): Shelter[] => {
    let list = cache.get(body.id);
    if (list) return list;
    list = [];
    if (climateOf(body).length) {
        const zone = landingZoneDirection(body);
        const tangent = new THREE.Vector3(0, 1, 0).cross(zone);
        if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0).cross(zone);
        tangent.normalize();
        ([[140, 35], [230, 205]] as const).forEach(([distance, bearing], k) => {
            const heading = tangent.clone().applyAxisAngle(zone, THREE.MathUtils.degToRad(bearing));
            const axis = new THREE.Vector3().crossVectors(zone, heading).normalize();
            const ideal = zone.clone().applyAxisAngle(axis, distance / body.radius).normalize();
            const up = levelGround(body, ideal, 45, 9);
            const centre = body.position.clone().addScaledVector(up, body.radius + groundHeight(body, up));
            // The mouth opens towards the landing site, where people come from.
            const toward = zone.clone().sub(up);
            toward.addScaledVector(up, -toward.dot(up));
            const mouth = toward.lengthSq() > 1e-12 ? toward.normalize() : tangent.clone();
            list!.push({ id: `${body.id}-shelter-${k}`, centre, up, mouth, seed: (body.biome!.seed * 31 + k * 977) >>> 0 });
        });
    }
    cache.set(body.id, list);
    return list;
};

/** How far under rock a point is in a shelter: 1 deep inside, less towards the mouth, 0 outside. */
export const shelterCover = (shelters: Shelter[], point: THREE.Vector3) => {
    let best = 0;
    for (const shelter of shelters) {
        const d = scratch.copy(point).sub(shelter.centre);
        const height = d.dot(shelter.up);
        if (height < -1 || height > HOLLOW_HEIGHT) continue;
        d.addScaledVector(shelter.up, -height);
        const r = d.length();
        if (r > SHELTER_INSIDE) continue;
        // In the mouth, half covered at best; deeper in, fully.
        const towardMouth = r > 1e-3 ? d.dot(shelter.mouth) / r : 0;
        const inMouth = towardMouth > Math.cos(MOUTH) ? THREE.MathUtils.smoothstep(r, 2.6, 4.6) : 0;
        best = Math.max(best, 1 - inMouth * 0.6);
    }
    return best;
};
const scratch = new THREE.Vector3();

/**
 * The rock: an outer dome and the hollow inside it, joined round the mouth,
 * lumpy with noise, in the shelter's own frame (y up, mouth towards +z),
 * and a floor that follows the ground under it.
 */
const shelterGeometry = (seed: number) => {
    const AROUND = 56;
    const UP = 14;
    const positions: number[] = [];
    const shade: number[] = [];
    const index: number[] = [];
    const lumps = (x: number, y: number, z: number) => gnoise(x * 0.32, y * 0.32, z * 0.32, seed) * 0.95 + gnoise(x * 1.1, y * 1.1, z * 1.1, seed + 7) * 0.32;
    // A point of one shell: angle round (0 at the mouth), height fraction up the dome.
    const point = (shell: [number, number], a: number, v: number, inner: boolean) => {
        const phi = v * Math.PI * 0.5;
        const x = Math.sin(a) * Math.cos(phi) * shell[0];
        const z = Math.cos(a) * Math.cos(phi) * shell[0];
        const y = Math.sin(phi) * shell[1] - 0.6;
        const n = lumps(x, y, z) * (inner ? 0.5 : 1);
        const len = Math.hypot(x, y + 0.6, z) || 1;
        return [x + (x / len) * n, y + ((y + 0.6) / len) * n, z + (z / len) * n];
    };
    // The mouth: cells round the front, below its top.
    const hole = (i: number, j: number) => {
        const a = ((i + 0.5) / AROUND) * Math.PI * 2;
        const angle = Math.atan2(Math.sin(a), Math.cos(a));
        const y = Math.sin(((j + 0.5) / UP) * Math.PI * 0.5) * INNER[1] - 0.6;
        return Math.abs(angle) < MOUTH && y < MOUTH_TOP;
    };
    const shellVertices = (shell: [number, number], inner: boolean) => {
        const start = positions.length / 3;
        for (let j = 0; j <= UP; j++) {
            for (let i = 0; i <= AROUND; i++) {
                positions.push(...point(shell, (i / AROUND) * Math.PI * 2, j / UP, inner));
                shade.push(inner ? 1 : 0);
            }
        }
        return start;
    };
    const outer = shellVertices(OUTER, false);
    const inner = shellVertices(INNER, true);
    const at = (start: number, i: number, j: number) => start + j * (AROUND + 1) + i;
    for (let j = 0; j < UP; j++) {
        for (let i = 0; i < AROUND; i++) {
            if (hole(i, j)) continue;
            const [a, b, c, d] = [at(outer, i, j), at(outer, i + 1, j), at(outer, i, j + 1), at(outer, i + 1, j + 1)];
            index.push(a, b, d, a, d, c);
            const [e, f, g, h] = [at(inner, i, j), at(inner, i + 1, j), at(inner, i, j + 1), at(inner, i + 1, j + 1)];
            index.push(e, h, f, e, g, h);
        }
    }
    // The rim round the mouth: where a solid cell meets a hole, join the shells.
    const rim = (o1: number, o2: number, i1: number, i2: number) => {
        const base = positions.length / 3;
        for (const v of [o1, o2, i1, i2]) {
            positions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
            shade.push(0.5);
        }
        index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    for (let j = 0; j < UP; j++) {
        for (let i = 0; i < AROUND; i++) {
            const here = hole(i, j);
            const right = hole((i + 1) % AROUND, j);
            if (here !== right) rim(at(outer, i + 1, j), at(outer, i + 1, j + 1), at(inner, i + 1, j), at(inner, i + 1, j + 1));
            const above = j + 1 < UP && hole(i, j + 1);
            if (here && !above) rim(at(outer, i, j + 1), at(outer, i + 1, j + 1), at(inner, i, j + 1), at(inner, i + 1, j + 1));
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aInner', new THREE.Float32BufferAttribute(shade, 1));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
};

/** The hollow's floor, a disc following the ground (its heights are filled in place). */
const floorGeometry = () => {
    const RINGS = 7;
    const SECTORS = 28;
    const positions: number[] = [0, 0, 0];
    const index: number[] = [];
    for (let r = 1; r <= RINGS; r++) {
        for (let s = 0; s < SECTORS; s++) {
            const a = (s / SECTORS) * Math.PI * 2;
            const radius = (r / RINGS) * (INNER[0] + 0.3);
            positions.push(Math.sin(a) * radius, 0, Math.cos(a) * radius);
        }
    }
    for (let s = 0; s < SECTORS; s++) index.push(0, 1 + s, 1 + ((s + 1) % SECTORS));
    for (let r = 1; r < RINGS; r++) {
        for (let s = 0; s < SECTORS; s++) {
            const a = 1 + (r - 1) * SECTORS + s;
            const b = 1 + (r - 1) * SECTORS + ((s + 1) % SECTORS);
            const c = 1 + r * SECTORS + s;
            const d = 1 + r * SECTORS + ((s + 1) % SECTORS);
            index.push(a, c, b, b, c, d);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('aInner', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill(1), 1));
    geometry.setIndex(index);
    return geometry;
};

const shelterMaterial = (body: ExpeditionBody, picture: THREE.Texture, mean: [number, number, number]) => new THREE.ShaderMaterial({
    // Both faces: the rim round the mouth is a single sheet.
    side: THREE.DoubleSide,
    uniforms: {
        ...createSurfaceUniforms(body),
        uPicture: { value: picture },
        uMean: { value: new THREE.Vector3(...mean) },
        uRock: { value: new THREE.Color(body.biome!.palette[3]) },
        uMouth: { value: new THREE.Vector3(0, 0, 1) },
        uOriginScene: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute float aInner;
        uniform vec3 uOriginScene;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vModel;
        varying vec3 vModelNormal;
        varying float vInner;
        void main() {
            vModel = position;
            vModelNormal = normal;
            vInner = aInner;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vLocalPos = (world.xyz - uOriginScene);
            vNormalLocal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * world;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        uniform sampler2D uPicture;
        uniform vec3 uMean;
        uniform vec3 uRock;
        uniform vec3 uMouth;
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vModel;
        varying vec3 vModelNormal;
        varying float vInner;
        void main() {
            #include <logdepthbuf_fragment>
            // The world's cliff rock, projected three ways in the shelter's own frame (metres).
            vec3 w = abs(normalize(vModelNormal));
            w = pow(w, vec3(4.0));
            w /= w.x + w.y + w.z;
            vec3 p = vModel / 3.2;
            vec3 pic = texture2D(uPicture, p.yz).rgb * w.x + texture2D(uPicture, p.xz).rgb * w.y + texture2D(uPicture, p.xy).rgb * w.z;
            vec3 albedo = uRock * (pic / max(uMean, vec3(0.01)));
            vec3 N = normalize(vNormalLocal);
            if (!gl_FrontFacing) N = -N;
            vec3 up = normalize(vLocalPos);
            vec3 color = surfaceLight(albedo, N, up);
            // Inside, the rock overhead keeps the sun and most of the sky off:
            // lit only towards the mouth.
            vec2 across = vModel.xz;
            float towardMouth = dot(normalize(across + vec2(1e-4)), uMouth.xz);
            float light = mix(0.12, 0.6, smoothstep(0.55, 0.95, towardMouth) * smoothstep(1.0, 5.2, length(across)));
            color *= mix(1.0, light, vInner);
            color += playerLights(albedo, N, vLocalPos);
            gl_FragColor = vec4(applyHaze(color, vLocalPos, up), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const ShelterRock = ({ body, shelter, runtime, picture, mean }: { body: ExpeditionBody; shelter: Shelter; runtime: ExpeditionRuntime; picture: THREE.Texture; mean: [number, number, number] }) => {
    const rock = useMemo(() => shelterGeometry(shelter.seed), [shelter]);
    const floor = useMemo(() => {
        const geometry = floorGeometry();
        // Lay it on the ground, four centimetres up.
        const side = new THREE.Vector3().crossVectors(shelter.up, shelter.mouth).normalize();
        const position = geometry.getAttribute('position') as THREE.BufferAttribute;
        const spot = new THREE.Vector3();
        const base = shelter.centre.distanceTo(body.position);
        for (let i = 0; i < position.count; i++) {
            const x = position.getX(i);
            const z = position.getZ(i);
            spot.copy(shelter.centre).sub(body.position).addScaledVector(side, x).addScaledVector(shelter.mouth, z).normalize();
            position.setY(i, body.radius + groundHeight(body, spot) - base + 0.04);
        }
        geometry.computeVertexNormals();
        return geometry;
    }, [shelter, body]);
    const material = useMemo(() => shelterMaterial(body, picture, mean), [body, picture, mean]);
    useEffect(() => () => { rock.dispose(); floor.dispose(); material.dispose(); }, [rock, floor, material]);
    const group = useRef<THREE.Group>(null);
    const orientation = useMemo(() => {
        const side = new THREE.Vector3().crossVectors(shelter.up, shelter.mouth).normalize();
        return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, shelter.up, shelter.mouth));
    }, [shelter]);
    useEffect(() => watchView(runtime, (eye) => {
        material.uniforms.uCamLocal.value.copy(eye).add(runtime.origin).sub(body.position);
    }), [runtime, material, body]);
    useFrame(() => {
        const g = group.current;
        if (!g) return;
        g.position.copy(shelter.centre).sub(runtime.origin);
        g.quaternion.copy(orientation);
        material.uniforms.uOriginScene.value.copy(body.position).sub(runtime.origin);
    });
    return (
        <group ref={group}>
            <mesh geometry={rock} material={material} />
            <mesh geometry={floor} material={material} />
        </group>
    );
};

/**
 * The shelters of the world the player is on, drawn within a few kilometres,
 * and solid: their walls and roof are spheres the explorer cannot walk
 * through (runtime.surface.shelters).
 */
export const Shelters = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [body, setBody] = useState<ExpeditionBody | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const here = runtime.currentBody && runtime.currentBody.kind === 'rocky' && runtime.altitude < 6000 && sheltersOn(runtime.currentBody).length ? runtime.currentBody : null;
        if ((here?.id ?? null) !== current.current) {
            current.current = here?.id ?? null;
            setBody(here);
        }
    });
    const shelters = useMemo(() => (body ? sheltersOn(body) : []), [body]);
    const [picture, setPicture] = useState<{ texture: THREE.Texture; mean: [number, number, number] } | null>(null);
    useEffect(() => {
        if (!body) return undefined;
        let live = true;
        const rock = rockPictureOf(body);
        loadPicture(rock.name, Math.min(runtime.quality * 4, 8)).then((texture) => { if (live) setPicture({ texture, mean: rock.mean }); }).catch(() => undefined);
        return () => { live = false; };
    }, [body, runtime.quality]);
    useEffect(() => {
        runtime.shelters = shelters;
        const solids: number[] = [];
        const point = new THREE.Vector3();
        for (const shelter of shelters) {
            const side = new THREE.Vector3().crossVectors(shelter.up, shelter.mouth).normalize();
            const put = (x: number, y: number, z: number, radius: number) => {
                point.copy(shelter.centre).addScaledVector(side, x).addScaledVector(shelter.up, y).addScaledVector(shelter.mouth, z);
                solids.push(point.x, point.y, point.z, radius, 1);
            };
            // The wall, all round but the mouth, in two rows; the roof.
            const wall = (OUTER[0] + INNER[0]) / 2;
            for (let k = 0; k < 30; k++) {
                const a = (k / 30) * Math.PI * 2;
                if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < MOUTH - 0.05) continue;
                put(Math.sin(a) * wall, 1.1, Math.cos(a) * wall, 1.0);
                put(Math.sin(a) * (wall - 0.4), 2.9, Math.cos(a) * (wall - 0.4), 1.0);
            }
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2;
                put(Math.sin(a) * 3.3, INNER[1] + 0.6, Math.cos(a) * 3.3, 1.5);
            }
            put(0, INNER[1] + 1.1, 0, 1.6);
        }
        runtime.surface.shelters = solids;
        return () => {
            runtime.surface.shelters = [];
            runtime.shelters = [];
        };
    }, [runtime, shelters]);
    if (!body || !picture) return null;
    return (
        <>
            {shelters.map((shelter) => (
                <ShelterRock key={shelter.id} body={body} shelter={shelter} runtime={runtime} picture={picture.texture} mean={picture.mean} />
            ))}
        </>
    );
};
