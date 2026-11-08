import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type BiomeKind, type ExpeditionBody } from './bodies';
import { groundHeight, waterDepth } from './environment';
import { cellKey, cellPoint, cellRandom, cellsNear } from './scatter';
import { SURFACE_SHADING_GLSL, createSurfaceUniforms } from './surfaceShading';
import { landingZoneDirection } from './sites';
import { at, finish, hashUnit, lump, paint, part, transform, type Part } from './propGeometry';
import { createSeededRandom } from '../../utils/seededRandom';
import { cue, type ExpeditionRuntime } from './runtime';
import type { WalkerState } from './walking';
import type { ShipState } from './flight';
import { CREATURES, HABITATS, createCreatureMaterial, creatureInstanceGeometry, loadCreature, type CreatureModel, type FittedCreature } from './creatures';
import { ContactShadows, type ContactShadowsHandle } from './ContactShadows';
import { alienHerdsOn, siteDirection, type LifeForm } from './aliens';

/**
 * Wildlife, as in the reference video: herds of grazers that wander, put their
 * heads down to feed and bolt when you come close, and flocks of birds wheeling
 * overhead. Every world with air has its own species, generated from its seed;
 * aim at an animal on foot to learn its name.
 *
 * Each species has a temper (Mind). Skittish ones bolt early, though walking
 * slowly lets you near; calm ones let you walk among them; curious ones come
 * over to look at you. Fed by hand (E, with food) a plant-eater follows you
 * for a while and can be petted. Predators keep their distance until you come
 * into their range, then stalk, growl and charge, and bite; the mining beam
 * held on one, or the torch shone at it at night, drives it off.
 *
 * Each species is one of the sculpted animals (creatures.ts), walked by its
 * vertex shader, so a whole herd is one draw call. Until its model has loaded
 * (or if it cannot) a species is drawn from built parts (body, head, four legs)
 * instead.
 */

export interface Species {
    id: string;
    name: string;
    /** Body length in world units. */
    size: number;
    walk: number;
    legs: number;
    neck: number;
    colors: [THREE.Color, THREE.Color, THREE.Color];
    horns: boolean;
    stripes: boolean;
    temperament: string;
    /** The sculpted animal it is drawn as, and how far its markings are recoloured. */
    model: CreatureModel;
    recolor: number;
    /**
     * Life from another world's alien site (aliens.ts): it lives only around
     * its site (`home`, a unit direction on the body), keeps its own temper,
     * and is met as a first contact (Aliens.tsx scans it) rather than counted
     * among the world's species.
     */
    alien?: { life: LifeForm; home: THREE.Vector3; count: number; mind: Mind };
}

const SYLLABLES = ['ka', 'lo', 'rin', 'tha', 'mu', 'vex', 'sol', 'ae', 'dri', 'qua', 'ne', 'zor', 'pel', 'ix', 'ur', 'yan', 'bo', 'shi', 'tel', 'gor'];

const PALETTES: Record<BiomeKind, string[][]> = {
    verdant: [['#c98a3c', '#f1d9a4', '#5a3a22'], ['#3f8fa0', '#d5eef0', '#1f4a58'], ['#b8543a', '#f4d1b6', '#402018'], ['#7a6a52', '#d8ccb4', '#2a2420']],
    desert: [['#2fb8a8', '#f3e6c4', '#7a2f6e'], ['#e0508a', '#ffe0b0', '#3a2a6a'], ['#f0a020', '#fff0c8', '#2a6aa0']],
    canyon: [['#d9c08a', '#f6ead0', '#6a3a22'], ['#7a8a9a', '#e0e4e8', '#3a2a24'], ['#b06a3a', '#f0d8b0', '#40281a']],
    frozen: [['#e8f2f6', '#ffffff', '#6a8aa0'], ['#9ab8d8', '#eef6ff', '#2a4a6a']],
    glacier: [['#5a7ac0', '#d8e4ff', '#1a2a5a'], ['#c8d8f0', '#ffffff', '#3a5a9a']],
    cratered: [],
    volcanic: [['#2fb8a8', '#f3e6c4', '#7a2f6e'], ['#e0508a', '#ffe0b0', '#3a2a6a'], ['#f0a020', '#fff0c8', '#2a6aa0']],
    methane: [],
};

/** How a species takes to the explorer. */
export type Mind = 'tolerant' | 'curious' | 'skittish' | 'predator';
export const mindOf = (species: Species): Mind =>
    species.alien ? species.alien.mind
        : species.model === 'sabretooth' ? 'predator'
        : /Curious/.test(species.temperament) ? 'curious'
            : /Docile|Calm|Placid/.test(species.temperament) ? 'tolerant' : 'skittish';
/** How readily a predator comes for the explorer, 0..1, from its temperament. */
const aggression = (species: Species) =>
    /Territorial/.test(species.temperament) ? 1 : /Watchful|Wary/.test(species.temperament) ? 0.65 : /Solitary/.test(species.temperament) ? 0.5 : 0.35;

/** The species that live on a world (none on airless ones). */
export const speciesOf = (body: ExpeditionBody): Species[] => {
    const biome = body.biome;
    if (!biome || biome.kind === 'cratered' || body.lifeless) return [];
    const palettes = PALETTES[biome.kind];
    const habitats = HABITATS[biome.kind as Exclude<BiomeKind, 'cratered'>];
    return palettes.map((palette, n) => {
        const habitat = habitats[n % habitats.length];
        const creature = CREATURES[habitat.model];
        const random = createSeededRandom(biome.seed * 97 + n * 1301);
        const syllables = 2 + Math.floor(random() * 2);
        let word = '';
        for (let i = 0; i < syllables; i++) word += SYLLABLES[Math.floor(random() * SYLLABLES.length)];
        const legs = 0.55 + random() * 0.55;
        return {
            id: `${body.id}:${n}`,
            name: `${word[0].toUpperCase()}${word.slice(1)} ${creature.kinds[Math.floor(random() * creature.kinds.length)]}`,
            size: creature.length[0] + random() * (creature.length[1] - creature.length[0]),
            walk: 1.4 + random() * 1.2,
            legs,
            neck: 0.15 + random() * 0.55,
            colors: [new THREE.Color(palette[0]), new THREE.Color(palette[1]), new THREE.Color(palette[2])],
            horns: random() > 0.45,
            stripes: random() > 0.5,
            temperament: creature.temperaments[Math.floor(random() * creature.temperaments.length)],
            model: habitat.model,
            recolor: habitat.recolor,
        };
    });
};

/** The walking life of the world's alien sites, as species. */
export const alienSpeciesOf = (body: ExpeditionBody): Species[] => alienHerdsOn(body).map(({ site, life }, n) => {
    const herd = life.herd!;
    const creature = CREATURES[herd.model];
    const random = createSeededRandom((body.biome?.seed ?? 1) * 131 + n * 977);
    const coat = new THREE.Color('#bfc4c8');
    return {
        id: `alien:${life.id}`,
        name: life.name,
        size: creature.length[0] + random() * (creature.length[1] - creature.length[0]),
        walk: herd.walk,
        legs: 0.6,
        neck: 0.3,
        colors: [coat, coat.clone(), coat.clone()],
        horns: false,
        stripes: false,
        temperament: creature.temperaments[0],
        model: herd.model,
        recolor: 0,
        alien: { life, home: siteDirection(site).clone(), count: herd.count, mind: herd.mind },
    };
});

/** Body, head (pivoting at the neck) and one leg (pivoting at the hip), in body lengths. */
const buildSpecies = (species: Species, seed: number) => {
    const [coat, belly, accent] = species.colors;
    const shade = new THREE.Color();
    const hip = species.legs * 0.5;
    const torso = paint(transform(lump(seed, 1, 0.07), at(0, hip + 0.08, 0, 0.3, 0.26, 0.55)), (centre, normal, i) => {
        shade.copy(normal.y < -0.35 ? belly : coat);
        if (species.stripes && normal.y > 0.2 && Math.sin(centre.z * 26) > 0.35) shade.copy(accent);
        return shade.multiplyScalar(0.9 + hashUnit(i, seed) * 0.14);
    });
    const tail = paint(transform(part(new THREE.ConeGeometry(0.06, 0.34, 5)), at(0, hip + 0.16, -0.62, 1, 1, 1, 0, 0, -2.2)), () => shade.copy(accent));
    const body = finish([torso, tail]);

    const neckLength = species.neck * 0.7;
    const headParts: Part[] = [];
    headParts.push(paint(transform(part(new THREE.CylinderGeometry(0.07, 0.1, neckLength, 6)), at(0, neckLength * 0.45, neckLength * 0.3, 1, 1, 1, 0, 0, 0.6)), () => shade.copy(coat)));
    const headAt = new THREE.Vector3(0, neckLength * 0.9 + 0.02, neckLength * 0.55 + 0.08);
    headParts.push(paint(transform(lump(seed + 3, 1, 0.06), at(headAt.x, headAt.y, headAt.z, 0.13, 0.12, 0.2)), (_c, normal) => shade.copy(normal.y < -0.3 ? belly : coat)));
    headParts.push(paint(transform(lump(seed + 4, 0, 0.05), at(0, headAt.y - 0.03, headAt.z + 0.17, 0.08, 0.07, 0.09)), () => shade.copy(belly)));
    [-1, 1].forEach((side) => {
        headParts.push(paint(transform(lump(seed + 5, 0, 0), at(side * 0.1, headAt.y + 0.04, headAt.z + 0.08, 0.035)), () => shade.setRGB(0.02, 0.02, 0.03)));
        if (species.horns) {
            headParts.push(paint(transform(part(new THREE.ConeGeometry(0.03, 0.2, 5)), at(side * 0.07, headAt.y + 0.16, headAt.z - 0.02, 1, 1, 1, 0, side * -0.35, -0.3)), () => shade.copy(accent)));
        } else {
            headParts.push(paint(transform(part(new THREE.ConeGeometry(0.045, 0.13, 4)), at(side * 0.1, headAt.y + 0.11, headAt.z - 0.05, 1, 1, 0.4, 0, side * -0.6)), () => shade.copy(coat)));
        }
    });
    const head = finish(headParts);

    const leg = finish([
        paint(transform(part(new THREE.CylinderGeometry(0.045, 0.032, hip, 5)), at(0, -hip / 2, 0)), () => shade.copy(coat).lerp(accent, 0.3)),
        paint(transform(part(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 5)), at(0, -hip + 0.025, 0.01)), () => shade.copy(accent)),
    ]);
    return { body, head, leg, hip };
};

interface Animal {
    species: number;
    position: THREE.Vector3;
    heading: THREE.Vector3;
    speed: number;
    gait: number;
    graze: number;
    state: 'graze' | 'walk' | 'flee' | 'watch' | 'approach' | 'follow' | 'stalk' | 'charge';
    timer: number;
    /** Seconds it will still follow the explorer, after being fed by hand. */
    friend: number;
    /** Seconds before it will come for (or come over to) the explorer again. */
    cooldown: number;
    /** Seconds the mining beam has been held on it (a predator gives up). */
    zapped: number;
    /** Until its next call or growl. */
    voice: number;
    random: () => number;
    herd: string;
    /** Its own offset for idle motion, so a herd never nods in step. */
    phase: number;
    /** Where its tail is in its swing; quicker while it runs. */
    swish: number;
    /** An alien site's animal: what scanning it finds, and where it keeps to (unit direction). */
    life?: LifeForm;
    home?: THREE.Vector3;
}

interface Flock {
    key: string;
    center: THREE.Vector3;
    radius: number;
    height: number;
    speed: number;
    count: number;
    phase: number;
}

const creatureMaterial = (body: ExpeditionBody) => new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: { ...createSurfaceUniforms(body), uOrigin: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform vec3 uOrigin; // floating origin, relative to the planet centre
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        void main() {
            vec4 world = instanceMatrix * vec4(position, 1.0);
            vLocalPos = uOrigin + world.xyz;
            vNormalLocal = mat3(instanceMatrix) * normal;
            vColor = color;
            gl_Position = projectionMatrix * modelViewMatrix * world;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${SURFACE_SHADING_GLSL}
        varying vec3 vLocalPos;
        varying vec3 vNormalLocal;
        varying vec3 vColor;
        void main() {
            #include <logdepthbuf_fragment>
            vec3 up = normalize(vLocalPos);
            vec3 color = applyHaze(surfaceLightWrap(vColor, normalize(vNormalLocal), up, 0.25) + playerLights(vColor, normalize(vNormalLocal), vLocalPos), vLocalPos, up);
            gl_FragColor = vec4(color, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const birdGeometry = () => {
    // A body and two wings; wing tips carry uv.x = 1 so the shader can flap them.
    const position = [
        0, 0, 0.5, -0.07, 0, -0.3, 0.07, 0, -0.3,
        0, 0, 0.2, -1, 0.05, -0.05, 0, 0, -0.2,
        0, 0, 0.2, 0, 0, -0.2, 1, 0.05, -0.05,
    ];
    const flap = [0, 0, 0, 0, 1, 0, 0, 0, 1];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('aFlap', new THREE.Float32BufferAttribute(flap, 1));
    return g;
};

const birdMaterial = (body: ExpeditionBody) => new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...createSurfaceUniforms(body), uOrigin: { value: new THREE.Vector3() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${SURFACE_SHADING_GLSL}
        attribute float aFlap;
        uniform vec3 uOrigin;
        uniform float uTime;
        varying vec3 vColor;
        void main() {
            vec3 p = position;
            float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
            p.y += aFlap * sin(uTime * 9.0 + phase) * 0.55;
            vec4 world = instanceMatrix * vec4(p, 1.0);
            vec3 local = uOrigin + world.xyz;
            vec3 up = normalize(local);
            vColor = applyHaze(vec3(0.05, 0.05, 0.06) * (0.3 + surfaceDay(up)), local, up);
            gl_Position = projectionMatrix * modelViewMatrix * world;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec3 vColor;
        void main() {
            #include <logdepthbuf_fragment>
            gl_FragColor = vec4(vColor, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const MAX_ANIMALS = [14, 24, 36];
const MAX_BIRDS = 60;

const up = new THREE.Vector3();
const right = new THREE.Vector3();
const forward = new THREE.Vector3();
const away = new THREE.Vector3();
const toCenter = new THREE.Vector3();
const basis = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const local = new THREE.Matrix4();
const pivot = new THREE.Vector3();
const scaleVector = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const rotation = new THREE.Quaternion();
const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const probe = new THREE.Vector3();
const head = new THREE.Vector3();
const view = new THREE.Vector3();
const toAnimal = new THREE.Vector3();
const combined = new THREE.Matrix4();
const offset = new THREE.Vector3();
const cameraLocal = new THREE.Vector3();
const unit = new THREE.Vector3(1, 1, 1);
const zAxis = new THREE.Vector3(0, 0, 1);
const shadowGround = new THREE.Vector3();

const flatten = (v: THREE.Vector3, normal: THREE.Vector3) => {
    v.addScaledVector(normal, -v.dot(normal));
    if (v.lengthSq() < 1e-8) {
        v.set(1, 0, 0).addScaledVector(normal, -normal.x);
        if (v.lengthSq() < 1e-8) v.set(0, 1, 0).addScaledVector(normal, -normal.y);
    }
    return v.normalize();
};

/** How far a sculpted animal's legs swing, in radians: longer as it breaks into a run. */
const strideOf = (speed: number, walk: number) => {
    const moving = Math.min(1, speed / walk);
    const run = THREE.MathUtils.clamp((speed - walk) / (walk * 2.4), 0, 1);
    return moving * (0.3 + 0.2 * run);
};

/** The rigged models a world's species are drawn with, as each arrives. */
const useCreatures = (species: Species[]) => {
    const [creatures, setCreatures] = useState<Map<CreatureModel, FittedCreature>>(() => new Map());
    useEffect(() => {
        let alive = true;
        [...new Set(species.map((s) => s.model))].forEach((name) => {
            loadCreature(name).then((creature) => {
                if (alive && creature) setCreatures((current) => new Map(current).set(name, creature));
            }).catch(() => undefined);
        });
        return () => { alive = false; };
    }, [species]);
    return creatures;
};

const TWO_PI = Math.PI * 2;

/** How squarely the explorer faces a point (1 dead ahead). */
const toward = (walker: WalkerState, point: THREE.Vector3) => {
    toPoint.copy(point).sub(walker.position).normalize();
    return toPoint.dot(walker.look);
};
const toPoint = new THREE.Vector3();

const flash = (ship: ShipState | null, message: string) => {
    if (!ship) return;
    ship.notice = message;
    ship.noticeTime = performance.now() / 1000;
};

/**
 * Feeding by hand (a plant-eater that is not afraid: approached slowly if it
 * is skittish) makes a friend that follows for two minutes; a friend can be
 * petted. Returns what to tell the player.
 */
const interact = (runtime: ExpeditionRuntime, animal: Animal, kind: Species, mind: Mind, what: 'feed' | 'pet') => {
    const walker = runtime.hud.walker;
    if (!walker) return null;
    if (mind === 'predator') return 'IT BARES ITS TEETH · BACK AWAY';
    if (what === 'pet') {
        if (animal.friend <= 0) return null;
        animal.friend = Math.max(animal.friend, 90);
        animal.state = 'follow';
        animal.graze = 1;
        runtime.stats.petted += 1;
        walker.gathering = 1.6;
        cue(runtime, 'call', 0.7, animal.species % 3);
        return `YOU PET THE ${kind.name.toUpperCase()}`;
    }
    if (runtime.supplies.food <= 0) return 'NO FOOD TO OFFER · PICK FRUIT FIRST';
    if (mind === 'skittish' && walker.velocity.length() > 2.5) {
        animal.state = 'flee';
        animal.timer = 3;
        return 'TOO FAST · IT BOLTS · APPROACH SLOWLY';
    }
    runtime.supplies.food -= 1;
    animal.friend = 120;
    animal.state = 'follow';
    animal.graze = 1;
    runtime.stats.fed += 1;
    if (!runtime.stats.friends.includes(kind.id)) runtime.stats.friends.push(kind.id);
    walker.gathering = 1.6;
    cue(runtime, 'call', 0.8, animal.species % 3);
    return `THE ${kind.name.toUpperCase()} EATS FROM YOUR HAND · IT WILL FOLLOW YOU`;
};

const WildlifeLayer = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    // The world's own species first, then the alien sites' (which live only at home).
    const natives = useMemo(() => speciesOf(body), [body]);
    const species = useMemo(() => [...natives, ...alienSpeciesOf(body)], [natives, body]);
    const zone = useMemo(() => landingZoneDirection(body), [body]);
    const maxAnimals = MAX_ANIMALS[runtime.quality];
    const models = useMemo(() => species.map((s, n) => buildSpecies(s, body.biome!.seed + n * 17)), [species, body]);
    const material = useMemo(() => creatureMaterial(body), [body]);
    const birds = useMemo(() => ({ geometry: birdGeometry(), material: birdMaterial(body) }), [body]);
    useEffect(() => () => {
        models.forEach((m) => { m.body.dispose(); m.head.dispose(); m.leg.dispose(); });
        material.dispose();
        birds.geometry.dispose();
        birds.material.dispose();
    }, [models, material, birds]);
    const creatures = useCreatures(species);
    // Each species' sculpted herd, once its model is in.
    const sculpted = useMemo(() => species.map((s) => {
        const creature = creatures.get(s.model);
        if (!creature) return null;
        return {
            creature,
            geometry: creatureInstanceGeometry(creature, maxAnimals),
            material: createCreatureMaterial(body, creature, s.colors[0], s.recolor),
        };
    }), [species, creatures, body, maxAnimals]);
    useEffect(() => () => {
        sculpted.forEach((herd) => {
            if (!herd) return;
            herd.geometry.dispose();
            herd.material.dispose();
        });
    }, [sculpted]);
    const herdRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
    const shadows = useRef<ContactShadowsHandle>(null);

    const bodyRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
    const headRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
    const legRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
    const birdRef = useRef<THREE.InstancedMesh | null>(null);
    const animals = useRef<Animal[]>([]);
    const herds = useRef(new Set<string>());
    const flocks = useRef<Flock[]>([]);
    const lastScan = useRef(new THREE.Vector3(Infinity, 0, 0));
    // Leaving the world leaves nothing behind to feed, beam at or be warned of.
    useEffect(() => () => {
        runtime.fauna.reach = null;
        runtime.fauna.targetPosition = null;
        runtime.fauna.zapping = false;
        runtime.fauna.danger = 0;
        runtime.fauna.animals = [];
    }, [runtime]);

    useFrame(({ clock }, delta) => {
        const dt = Math.min(delta, 0.1);
        const paused = !!runtime.sites.open || runtime.menuOpen;
        const player = runtime.origin;
        const distance = player.distanceTo(body.position);
        up.copy(player).sub(body.position).divideScalar(distance);
        const altitude = runtime.currentBody === body ? runtime.altitude : Infinity;
        const near = altitude < 900;

        // ---- Spawn herds and flocks around the player, drop far ones -----------
        const groundPoint = probe.copy(body.position).addScaledVector(up, body.radius);
        if (near && lastScan.current.distanceTo(groundPoint) > 60) {
            lastScan.current.copy(groundPoint);
            const seed = body.biome!.seed + 4409;
            const depth = Math.max(3, Math.round(Math.log2((2 * 0.785 * body.radius) / 240)));
            const wanted = new Set<string>();
            // Herds to raise once the ones left behind are gone: until then those still count against the cap.
            const raise: { key: string; kind: number; size: number; random: () => number; centre: THREE.Vector3; near: number; spread: number; alien?: Species['alien'] }[] = [];
            // The alien sites' animals first (they are what a site is for): one herd round each site, while the explorer is within reach of it.
            species.forEach((kind, index) => {
                const alien = kind.alien;
                if (!alien || alien.home.distanceTo(up) * body.radius > 900) return;
                wanted.add(kind.id);
                if (herds.current.has(kind.id)) return;
                const random = createSeededRandom(index * 7919 + 13);
                // A little off the site itself, where its plume, stones or vault stand.
                const aside = flatten(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5), alien.home);
                const centre = alien.home.clone().multiplyScalar(body.radius).addScaledVector(aside, 45).normalize();
                raise.push({ key: kind.id, kind: index, size: alien.count, random, centre, near: 3, spread: 16, alien });
            });
            for (const cell of cellsNear(up, body.radius, depth, 560)) {
                if (!natives.length || cellRandom(cell, seed, 1) > 0.3) continue;
                const key = cellKey(cell);
                const where = new THREE.Vector3();
                cellPoint(cell, 0.2 + cellRandom(cell, seed, 2) * 0.6, 0.2 + cellRandom(cell, seed, 3) * 0.6, where);
                if (where.distanceTo(up) * body.radius > 560) continue;
                if (where.dot(zone) > Math.cos(90 / body.radius)) continue;
                if (waterDepth(body, where) > 0) continue;
                wanted.add(key);
                if (herds.current.has(key)) continue;
                let kind = Math.floor(cellRandom(cell, seed, 4) * natives.length);
                // Predators are rarer, and hunt alone or in pairs.
                if (mindOf(species[kind]) === 'predator' && cellRandom(cell, seed, 7) < 0.5) kind = (kind + 1) % natives.length;
                const predator = mindOf(species[kind]) === 'predator';
                const size = predator ? 1 + (cellRandom(cell, seed, 8) < 0.3 ? 1 : 0) : 3 + Math.floor(cellRandom(cell, seed, 5) * 5);
                const random = createSeededRandom(Math.floor(cellRandom(cell, seed, 6) * 1e9));
                raise.push({ key, kind, size, random, centre: where, near: 4, spread: 12 });
            }
            for (const key of [...herds.current]) if (!wanted.has(key)) herds.current.delete(key);
            animals.current = animals.current.filter((a) => herds.current.has(a.herd));
            for (const { key, kind, size, random, centre, near: inner, spread, alien } of raise) {
                let born = 0;
                for (let k = 0; k < size && animals.current.length < maxAnimals; k++) {
                    const tangent = flatten(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5), centre);
                    const spot = centre.clone().multiplyScalar(body.radius).addScaledVector(tangent, inner + random() * spread).normalize();
                    if (waterDepth(body, spot) > 0) continue;
                    animals.current.push({
                        species: kind,
                        position: body.position.clone().addScaledVector(spot, body.radius + groundHeight(body, spot)),
                        heading: flatten(new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5), spot),
                        speed: 0,
                        gait: random() * 6,
                        graze: random(),
                        state: random() > 0.5 ? 'graze' : 'walk',
                        timer: 1 + random() * 5,
                        random,
                        herd: key,
                        phase: random() * TWO_PI,
                        swish: random() * TWO_PI,
                        friend: 0,
                        cooldown: 0,
                        zapped: 0,
                        voice: 4 + random() * 12,
                        life: alien?.life,
                        home: alien ? centre : undefined,
                    });
                    born++;
                }
                // A herd with no room yet is raised on a later scan.
                if (born) herds.current.add(key);
            }

            // Birds: a few flocks wheeling over the nearby hills.
            const flockDepth = Math.max(2, Math.round(Math.log2((2 * 0.785 * body.radius) / 900)));
            const next: Flock[] = [];
            for (const cell of cellsNear(up, body.radius, flockDepth, 1400)) {
                if (!natives.length || cellRandom(cell, seed, 11) > 0.55 || next.length >= 5) continue;
                const where = new THREE.Vector3();
                cellPoint(cell, 0.5, 0.5, where);
                if (where.distanceTo(up) * body.radius > 1400) continue;
                next.push({
                    key: cellKey(cell),
                    center: body.position.clone().addScaledVector(where, body.radius + Math.max(0, groundHeight(body, where))),
                    radius: 30 + cellRandom(cell, seed, 12) * 60,
                    height: 40 + cellRandom(cell, seed, 13) * 60,
                    speed: 9 + cellRandom(cell, seed, 14) * 6,
                    count: 6 + Math.floor(cellRandom(cell, seed, 15) * 7),
                    phase: cellRandom(cell, seed, 16) * Math.PI * 2,
                });
            }
            flocks.current = next;
        }

        runtime.fauna.animals = animals.current;

        // ---- Behaviour ------------------------------------------------------------
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const onFoot = !!walker && walker.body === body;
        const ship = runtime.hud.ship;
        // The ship low overhead scatters everything.
        const shipThreat = !onFoot && ship && altitude < 40 ? ship.position : null;
        const looked = runtime.fauna.target;
        let danger = 0;
        runtime.fauna.reach = null;
        if (!paused) {
            let reachBest = Infinity;
            for (const animal of animals.current) {
                const kind = species[animal.species];
                const mind = mindOf(kind);
                up.copy(animal.position).sub(body.position).normalize();
                animal.timer -= dt;
                animal.cooldown = Math.max(0, animal.cooldown - dt);
                animal.friend = Math.max(0, animal.friend - dt);
                animal.voice -= dt;
                let target = 0;
                let face: THREE.Vector3 | null = null;
                const d = onFoot ? animal.position.distanceTo(walker!.position) : Infinity;
                const walkerSpeed = onFoot ? walker!.velocity.length() : 0;
                if (shipThreat && animal.position.distanceTo(shipThreat) < 45 && animal.state !== 'flee') {
                    animal.state = 'flee';
                    animal.timer = 2.5 + animal.random() * 2;
                }
                if (onFoot && animal.state !== 'flee') {
                    // The beam held on it, or a torch in its eyes at night: a predator turns tail.
                    const lookedAt = looked === kind && d < 40 && toward(walker!, animal.position) > 0.93;
                    animal.zapped = lookedAt && runtime.fauna.zapping ? animal.zapped + dt : Math.max(0, animal.zapped - dt * 2);
                    const dazzled = runtime.torch.on && runtime.daylight < 0.35 && d < 22 && toward(walker!, animal.position) > 0.9;
                    if (mind === 'predator' && (animal.zapped > 0.5 || dazzled) && (animal.state === 'stalk' || animal.state === 'charge' || animal.state === 'watch')) {
                        animal.state = 'flee';
                        animal.timer = 5 + animal.random() * 2;
                        animal.cooldown = 16;
                        animal.zapped = 0;
                        runtime.stats.scared += 1;
                        cue(runtime, 'growl', 0.8, 1);
                        flash(ship, 'IT TURNS AND RUNS');
                    } else if (mind === 'predator' && animal.cooldown <= 0) {
                        const fierce = aggression(kind);
                        const stalkRange = 22 + 22 * fierce;
                        const chargeRange = 6 + 7 * fierce;
                        if (animal.state === 'charge') {
                            // Running the explorer down: a bite on reaching them.
                            if (d < kind.size * 0.55 + 1.1) {
                                const bite = 0.16 + 0.1 * fierce;
                                walker!.health = Math.max(0, walker!.health - bite);
                                walker!.hurtBy = 'predator';
                                walker!.impact = Math.min(1, bite * 3);
                                walker!.impactTime = 0;
                                walker!.hurtAgo = 0;
                                away.copy(walker!.position).sub(animal.position);
                                walker!.velocity.addScaledVector(flatten(away, up), 7).addScaledVector(up, 2.5);
                                runtime.stats.bitten += 1;
                                cue(runtime, 'growl', 1.3, 0);
                                flash(ship, 'BITTEN · GET AWAY, OR HOLD THE BEAM ON IT');
                                animal.state = 'flee';
                                animal.timer = 3 + animal.random() * 2;
                                animal.cooldown = 9 + animal.random() * 5;
                            } else if (d > stalkRange * 1.3 || animal.timer <= 0) {
                                animal.state = 'walk';
                                animal.cooldown = 6;
                            }
                        } else if (d < chargeRange) {
                            animal.state = 'charge';
                            animal.timer = 6;
                            cue(runtime, 'growl', 1.2, 0);
                        } else if (d < stalkRange) {
                            if (animal.state !== 'stalk') {
                                animal.state = 'stalk';
                                animal.timer = 12 + animal.random() * 8;
                                animal.voice = 0.4;
                            }
                            if (animal.timer <= 0) {
                                animal.state = 'walk';
                                animal.cooldown = 10;
                            }
                        } else if (animal.state === 'stalk') {
                            animal.state = 'walk';
                        }
                    } else if (animal.friend > 0) {
                        animal.state = 'follow';
                    } else if (mind === 'skittish') {
                        // Walking slowly lets you near; running sends them off from far away.
                        const range = walker!.running ? 26 : walkerSpeed < 2.5 ? 6 : 14;
                        if (d < range) {
                            animal.state = 'flee';
                            animal.timer = 2.5 + animal.random() * 2;
                        } else if (d < range * 1.8 && animal.state === 'graze') {
                            animal.state = 'watch';
                            animal.timer = 2 + animal.random() * 2;
                        }
                    } else if (mind === 'tolerant') {
                        if (d < 3 && walker!.running) {
                            animal.state = 'flee';
                            animal.timer = 2;
                        } else if (d < 7 && animal.state === 'walk') {
                            animal.state = 'watch';
                            animal.timer = 2 + animal.random() * 3;
                        }
                    } else if (mind === 'curious') {
                        if (d < 6 && walker!.running) {
                            animal.state = 'flee';
                            animal.timer = 2.5;
                        } else if (d < 32 && animal.cooldown <= 0 && animal.state !== 'approach' && animal.state !== 'watch') {
                            animal.state = 'approach';
                            animal.timer = 14;
                        } else if (animal.state === 'approach' && animal.timer <= 0) {
                            animal.state = 'walk';
                            animal.timer = 4;
                            animal.cooldown = 25;
                        }
                    }
                }
                if (animal.timer <= 0 && (animal.state === 'graze' || animal.state === 'walk' || animal.state === 'flee' || animal.state === 'watch')) {
                    animal.state = animal.state === 'walk' ? 'graze' : 'walk';
                    animal.timer = animal.state === 'walk' ? 3 + animal.random() * 6 : 2 + animal.random() * 5;
                }
                if (animal.state === 'follow' && animal.friend <= 0) {
                    animal.state = 'walk';
                    animal.timer = 5;
                }

                if (animal.state === 'walk') {
                    target = kind.walk;
                    // Wander, drifting back towards the herd.
                    animal.heading.applyAxisAngle(up, (animal.random() - 0.5) * dt * 1.6);
                    let count = 0;
                    toCenter.set(0, 0, 0);
                    for (const other of animals.current) {
                        if (other.herd !== animal.herd) continue;
                        toCenter.add(other.position);
                        count++;
                    }
                    toCenter.divideScalar(Math.max(1, count)).sub(animal.position);
                    if (toCenter.length() > 14) animal.heading.lerp(flatten(toCenter, up), dt * 0.8);
                    // An alien site's animals keep to their site.
                    if (animal.home) {
                        toCenter.copy(animal.home).multiplyScalar(body.radius).add(body.position).sub(animal.position);
                        if (toCenter.length() > 60) animal.heading.lerp(flatten(toCenter, up), dt * 1.2);
                    }
                } else if (animal.state === 'flee') {
                    const from = onFoot ? walker!.position : shipThreat;
                    if (from) {
                        target = kind.walk * 3.4;
                        away.copy(animal.position).sub(from);
                        animal.heading.lerp(flatten(away, up), 1 - Math.exp(-dt * 4));
                    } else {
                        target = kind.walk * 2;
                    }
                } else if (onFoot && (animal.state === 'watch' || animal.state === 'approach' || animal.state === 'follow' || animal.state === 'stalk' || animal.state === 'charge')) {
                    toCenter.copy(walker!.position).sub(animal.position);
                    face = flatten(toCenter, up);
                    if (animal.state === 'approach') target = d > 4.5 ? kind.walk * 0.8 : 0;
                    else if (animal.state === 'follow') target = d > 9 ? Math.min(kind.walk * 3, d * 0.6) : d > 5 ? kind.walk * 0.7 : 0;
                    else if (animal.state === 'stalk') target = d > 6 + 7 * aggression(kind) + 2 ? kind.walk * 0.55 : 0;
                    else if (animal.state === 'charge') target = kind.walk * 3.8;
                    if (animal.state === 'approach' && d <= 4.5) animal.state = 'watch';
                    animal.heading.lerp(face, 1 - Math.exp(-dt * (animal.state === 'charge' ? 6 : 3)));
                    // A predator's growl as it stalks; a calm animal's call now and then.
                    if (animal.state === 'stalk' && animal.voice <= 0) {
                        cue(runtime, 'growl', THREE.MathUtils.clamp(1.2 - d / 40, 0.25, 1), 1);
                        animal.voice = 3.5 + animal.random() * 3;
                    }
                }
                if (mind !== 'predator' && animal.voice <= 0 && onFoot && d < 70) {
                    cue(runtime, 'call', THREE.MathUtils.clamp(1 - d / 70, 0.1, 0.8), animal.species % 3);
                    animal.voice = 8 + animal.random() * 16;
                } else if (animal.voice <= 0) {
                    animal.voice = 6 + animal.random() * 10;
                }
                if (mind === 'predator' && onFoot && (animal.state === 'stalk' || animal.state === 'charge')) {
                    danger = Math.max(danger, animal.state === 'charge' ? 1 : THREE.MathUtils.clamp(1 - d / 45, 0.3, 0.8));
                }

                flatten(animal.heading, up);
                animal.speed += (target - animal.speed) * (1 - Math.exp(-dt * 3));
                const head = animal.state === 'graze' ? 1 : 0;
                animal.graze += (head - animal.graze) * (1 - Math.exp(-dt * 2.5));
                animal.position.addScaledVector(animal.heading, animal.speed * dt);
                // Turn back at the water's edge.
                up.copy(animal.position).sub(body.position).normalize();
                if (waterDepth(body, up) > 0.05) {
                    animal.position.addScaledVector(animal.heading, -animal.speed * dt * 1.5);
                    animal.heading.negate();
                }
                // Stay out of rocks and trunks.
                for (const obstacles of [runtime.surface.obstacles, runtime.surface.fixtures, runtime.surface.shelters]) {
                    for (let i = 0; i < obstacles.length; i += 5) {
                        away.set(animal.position.x - obstacles[i], animal.position.y - obstacles[i + 1], animal.position.z - obstacles[i + 2]);
                        const reach = obstacles[i + 3] + kind.size * 0.4;
                        const gap = away.lengthSq();
                        if (gap >= reach * reach || gap < 1e-8) continue;
                        animal.position.addScaledVector(away.normalize(), reach - Math.sqrt(gap));
                        animal.heading.applyAxisAngle(up, 0.6);
                    }
                }
                up.copy(animal.position).sub(body.position).normalize();
                animal.position.copy(body.position).addScaledVector(up, body.radius + groundHeight(body, up));
                const rig = sculpted[animal.species]?.creature.rig;
                if (rig) {
                    // A foot in contact sweeps 2 * leg * sin(stride) per half cycle:
                    // matched to the ground speed, the feet cannot slide.
                    const reach = 2 * rig.leg * Math.max(Math.sin(strideOf(animal.speed, kind.walk)), 0.12) * kind.size;
                    animal.gait = (animal.gait + (Math.PI * animal.speed * dt) / reach) % TWO_PI;
                } else {
                    // A stride is about two leg lengths: the feet cannot slide.
                    animal.gait = (animal.gait + (animal.speed * dt) / (kind.size * kind.legs * 0.9) * Math.PI) % TWO_PI;
                }

                // Within arm's reach, in front of the explorer: something to feed or pet.
                if (onFoot && d < kind.size * 0.6 + 2.6 && toward(walker!, animal.position) > 0.2 && animal.state !== 'flee' && animal.state !== 'charge' && d < reachBest) {
                    reachBest = d;
                    const it = animal;
                    runtime.fauna.reach = {
                        name: kind.name,
                        mind,
                        friend: animal.friend > 0,
                        act: (what) => interact(runtime, it, kind, mind, what),
                    };
                }
            }
        }
        runtime.fauna.danger = danger;
        // ---- Draw ------------------------------------------------------------------
        const counts = species.map(() => 0);
        const t = clock.elapsedTime;
        shadows.current?.begin();
        for (const animal of animals.current) {
            const kind = species[animal.species];
            const model = models[animal.species];
            const n = counts[animal.species]++;
            const herd = sculpted[animal.species];
            const herdMesh = herdRefs.current[animal.species];
            if (herd && herdMesh) {
                const config = herd.creature.config;
                up.copy(animal.position).sub(body.position).normalize();
                forward.copy(animal.heading);
                right.crossVectors(up, forward).normalize();
                basis.makeBasis(right, up, forward);
                quaternion.setFromRotationMatrix(basis);
                const moving = Math.min(1, animal.speed / kind.walk);
                const stride = strideOf(animal.speed, kind.walk);
                // The body is highest mid-stance, twice a stride; sunk a touch so
                // the feet meet sloping ground.
                const rise = Math.abs(Math.cos(animal.gait)) * 0.012 * moving - 0.012;
                scaleVector.setScalar(kind.size);
                pivot.copy(animal.position).sub(runtime.origin).addScaledVector(up, rise * kind.size);
                partMatrix.compose(pivot, quaternion, scaleVector);
                herdMesh.setMatrixAt(n, partMatrix);
                const idle = 1 - animal.graze;
                const nod = Math.sin(t * 0.7 + animal.phase) * 0.08 * idle;
                const look = Math.sin(t * 0.37 + animal.phase * 2.3) * config.neck.look * idle * (1 - moving * 0.8);
                const pose = herd.geometry.getAttribute('aAnim') as THREE.InstancedBufferAttribute;
                pose.setXYZW(n, animal.gait, stride, animal.graze * config.neck.graze + nod, look);
                const tail = herd.geometry.getAttribute('aTail') as THREE.InstancedBufferAttribute;
                animal.swish = (animal.swish + dt * (1.8 + moving * 3)) % TWO_PI;
                tail.setX(n, Math.sin(animal.swish) * config.tail.sway * (0.5 + 0.5 * moving));
                shadowGround.copy(animal.position).sub(runtime.origin);
                shadows.current?.add(shadowGround, up, forward, kind.size * 0.85, kind.size * 0.3, kind.size * herd.creature.height);
                continue;
            }
            const bodyMesh = bodyRefs.current[animal.species];
            const headMesh = headRefs.current[animal.species];
            const legMesh = legRefs.current[animal.species];
            if (!bodyMesh || !headMesh || !legMesh) continue;
            up.copy(animal.position).sub(body.position).normalize();
            forward.copy(animal.heading);
            right.crossVectors(up, forward).normalize();
            basis.makeBasis(right, up, forward);
            quaternion.setFromRotationMatrix(basis);
            const moving = Math.min(1, animal.speed / kind.walk);
            const bob = Math.abs(Math.sin(animal.gait)) * 0.04 * moving;
            scaleVector.setScalar(kind.size);
            pivot.copy(animal.position).sub(runtime.origin).addScaledVector(up, bob * kind.size);
            partMatrix.compose(pivot, quaternion, scaleVector);
            bodyMesh.setMatrixAt(n, partMatrix);
            shadowGround.copy(animal.position).sub(runtime.origin);
            shadows.current?.add(shadowGround, up, forward, kind.size * 0.8, kind.size * 0.3, kind.size * (kind.legs * 0.5 + 0.35));

            // Head down to graze, up and looking about otherwise.
            const hip = model.hip;
            local.compose(offset.set(0, hip + 0.16, 0.42), rotation.setFromAxisAngle(xAxis, animal.graze * 0.95 - 0.1 + Math.sin(clock.elapsedTime * 0.7 + n) * 0.06 * (1 - animal.graze)), unit);
            headMesh.setMatrixAt(n, combined.multiplyMatrices(partMatrix, local));

            const swing = 0.5 + 0.25 * Math.min(1, animal.speed / (kind.walk * 2));
            const hips: [number, number, number][] = [[0.17, 0.3, 0], [-0.17, 0.3, Math.PI], [0.17, -0.3, Math.PI], [-0.17, -0.3, 0]];
            hips.forEach(([x, z, phase], k) => {
                local.compose(offset.set(x, hip + 0.02, z), rotation.setFromAxisAngle(xAxis, Math.sin(animal.gait + phase) * swing * moving), unit);
                legMesh.setMatrixAt(n * 4 + k, combined.multiplyMatrices(partMatrix, local));
            });
        }
        shadows.current?.end();
        species.forEach((_, s) => {
            const count = counts[s];
            const herdMesh = herdRefs.current[s];
            const herd = sculpted[s];
            if (herdMesh && herd) {
                herdMesh.count = count;
                herdMesh.instanceMatrix.needsUpdate = true;
                herd.geometry.getAttribute('aAnim').needsUpdate = true;
                herd.geometry.getAttribute('aTail').needsUpdate = true;
            }
            [bodyRefs.current[s], headRefs.current[s]].forEach((mesh) => {
                if (!mesh) return;
                mesh.count = count;
                mesh.instanceMatrix.needsUpdate = true;
            });
            const legs = legRefs.current[s];
            if (legs) {
                legs.count = count * 4;
                legs.instanceMatrix.needsUpdate = true;
            }
        });

        const flock = birdRef.current;
        if (flock) {
            let b = 0;
            for (const f of near ? flocks.current : []) {
                const fUp = probe.copy(f.center).sub(body.position).normalize();
                const tangentA = new THREE.Vector3().crossVectors(fUp, yAxis);
                if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0);
                tangentA.normalize();
                const tangentB = new THREE.Vector3().crossVectors(fUp, tangentA).normalize();
                for (let k = 0; k < f.count && b < MAX_BIRDS; k++) {
                    const angle = f.phase + (t * f.speed) / f.radius + k * 0.35;
                    const wobble = Math.sin(t * 0.8 + k * 1.7) * 6;
                    head.copy(f.center)
                        .addScaledVector(tangentA, Math.cos(angle) * (f.radius + wobble))
                        .addScaledVector(tangentB, Math.sin(angle) * (f.radius + wobble))
                        .addScaledVector(fUp, f.height + Math.sin(t * 1.3 + k) * 4 + k * 1.5);
                    view.copy(tangentA).multiplyScalar(-Math.sin(angle)).addScaledVector(tangentB, Math.cos(angle)).normalize();
                    right.crossVectors(fUp, view).normalize();
                    basis.makeBasis(right, fUp, view);
                    quaternion.setFromRotationMatrix(basis);
                    // Bank into the turn.
                    quaternion.multiply(rotation.setFromAxisAngle(zAxis, -0.35));
                    partMatrix.compose(head.sub(runtime.origin), quaternion, scaleVector.setScalar(1.3));
                    flock.setMatrixAt(b++, partMatrix);
                }
            }
            flock.count = b;
            flock.instanceMatrix.needsUpdate = true;
        }

        // ---- What the explorer is looking at ---------------------------------------
        runtime.fauna.target = null;
        runtime.fauna.targetPosition = null;
        if (onFoot) {
            const walker = runtime.hud.walker!;
            const walkerUp = probe.copy(walker.position).sub(body.position).normalize();
            head.copy(walker.position).addScaledVector(walkerUp, 1.5);
            view.copy(walker.look).multiplyScalar(Math.cos(walker.pitch)).addScaledVector(walkerUp, Math.sin(walker.pitch)).normalize();
            let best = Infinity;
            for (const animal of animals.current) {
                toAnimal.copy(animal.position).sub(head);
                const d = toAnimal.length();
                if (d > 40) continue;
                const facing = toAnimal.divideScalar(d).dot(view);
                if (facing < 0.93) continue;
                const score = d * (2 - facing);
                if (score < best) {
                    best = score;
                    runtime.fauna.target = species[animal.species];
                    runtime.fauna.targetPosition = animal.position;
                }
            }
            const target = runtime.fauna.target;
            // (Alien life is met by scanning it: Aliens.tsx.)
            if (target && !target.alien && !runtime.fauna.discovered.has(target.id)) {
                runtime.fauna.discovered.add(target.id);
                runtime.fauna.version += 1;
            }
        }

        const originLocal = probe.copy(runtime.origin).sub(body.position);
        cameraLocal.copy(runtime.camera).sub(body.position);
        material.uniforms.uOrigin.value.copy(originLocal);
        material.uniforms.uCamLocal.value.copy(cameraLocal);
        birds.material.uniforms.uOrigin.value.copy(originLocal);
        birds.material.uniforms.uCamLocal.value.copy(cameraLocal);
        birds.material.uniforms.uTime.value = clock.elapsedTime;
        sculpted.forEach((herd) => {
            if (!herd) return;
            herd.material.uniforms.uOrigin.value.copy(originLocal);
            herd.material.uniforms.uCamLocal.value.copy(cameraLocal);
        });
    }, -1);

    return (
        <>
            {models.map((model, s) => {
                const herd = sculpted[s];
                if (herd) {
                    return <instancedMesh key={`herd-${s}-${herd.geometry.uuid}`} ref={(m) => { herdRefs.current[s] = m; if (m) m.count = 0; }} args={[herd.geometry, herd.material, maxAnimals]} frustumCulled={false} />;
                }
                return (
                    <group key={`parts-${s}`}>
                        <instancedMesh ref={(m) => { bodyRefs.current[s] = m; if (m) m.count = 0; }} args={[model.body, material, maxAnimals]} frustumCulled={false} />
                        <instancedMesh ref={(m) => { headRefs.current[s] = m; if (m) m.count = 0; }} args={[model.head, material, maxAnimals]} frustumCulled={false} />
                        <instancedMesh ref={(m) => { legRefs.current[s] = m; if (m) m.count = 0; }} args={[model.leg, material, maxAnimals * 4]} frustumCulled={false} />
                    </group>
                );
            })}
            <instancedMesh ref={(m) => { birdRef.current = m; if (m) m.count = 0; }} args={[birds.geometry, birds.material, MAX_BIRDS]} frustumCulled={false} />
            <ContactShadows ref={shadows} body={body} runtime={runtime} capacity={maxAnimals} />
        </>
    );
};

/** Animals for the world the player is on, if it has any. */
export const Wildlife = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        // Nothing native lives on airless or lifeless worlds, but alien sites keep animals of their own.
        const id = body && body.kind === 'rocky' && body.biome && ((body.biome.kind !== 'cratered' && !body.lifeless) || alienHerdsOn(body).length > 0) ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
            runtime.fauna.target = null;
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <WildlifeLayer key={body.id} body={body} runtime={runtime} /> : null;
};
