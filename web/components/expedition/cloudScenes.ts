import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { fromEquatorial } from './orbits';
import { createZoneLook, exposureAt, gasModel, lightAt, windAt, zoneAt } from './gasAtmosphere';
import { gasMapTexture } from './gasMaps';
import { marchKey, type CloudLayerSpec, type CloudScene } from './cloudVolume';
import { nearestVortices, packVortex } from './vortices';
import { ringFrame } from './rings';
import type { ExpeditionRuntime } from './runtime';
import { groundHeight } from './environment';
import { cellLife, climateOfBody } from './weather';
import { usesEarthMap } from './earth';

/**
 * Which clouds surround the camera: the decks of the gas giant it is in or
 * over (gasAtmosphere.ts), each lit by what sunlight is left at its height.
 */
const gasLayers = new Map<string, CloudLayerSpec[]>();
const layersOfGiant = (body: ExpeditionBody) => {
    let layers = gasLayers.get(body.id);
    if (!layers) {
        const model = gasModel(body);
        layers = model.decks.map((deck, i) => {
            // Light that reaches the deck's top through the decks above it.
            const light = lightAt(model, deck.top + 1);
            const lit = new THREE.Color(deck.lit).multiplyScalar(light);
            const shade = new THREE.Color(deck.under).multiplyScalar(light);
            return {
                bottom: deck.top - deck.thickness,
                top: deck.top,
                // Fields of heaped cloud with clear air between, not lids:
                // billows a kilometre or two across (from inside, the noise's
                // own size is what the eye reads as the size of a cloud), torn
                // open into canyons by the slow field.
                coverage: i === 0 ? 0.48 : i === 1 ? 0.56 : 0.62,
                density: 0.011,
                scale: 1700 + i * 300,
                erosion: 0.5,
                anvil: 0.5,
                storm: deck.storms ? 1 : 0,
                lit,
                shade,
                // Only where there is a map of the real planet (Jupiter, Saturn).
                useMap: i === 0 && !!body.gas?.map,
            } satisfies CloudLayerSpec;
        });
        // Cirrus (Neptune): thin streaks high above everything, in full sunlight.
        if (model.cirrus) {
            const c = model.cirrus;
            layers.push({
                bottom: c.top - c.thickness,
                top: c.top,
                coverage: c.cover,
                density: 0.012,
                scale: 2400,
                erosion: 0.5,
                anvil: 0.95,
                storm: 0,
                lit: new THREE.Color(c.lit),
                shade: new THREE.Color(c.under),
                cirrus: 10,
            } satisfies CloudLayerSpec);
        }
        // Thunderstorms: towers of cloud boiling up out of the storm deck,
        // through the decks above, flattening into anvils under the top deck,
        // with the lightning inside them.
        const storm = model.decks.find((d) => d.storms);
        if (storm && model.towers) {
            const top = model.decks[0];
            layers.push({
                bottom: storm.top - storm.thickness * 0.6,
                top: top.top - top.thickness * 0.4,
                coverage: model.towers.chance,
                density: 0.009,
                scale: 3000,
                erosion: 0.42,
                anvil: 0.9,
                storm: 1,
                // Lit in the shader by the sunlight left at each height (cvLightAt).
                lit: new THREE.Color(storm.lit).lerp(new THREE.Color(top.lit), 0.6),
                shade: new THREE.Color(storm.under),
                towers: model.towers.spacing,
            } satisfies CloudLayerSpec);
        }
        gasLayers.set(body.id, layers);
    }
    return layers;
};

/**
 * The walls of the great vortices: eyewalls and towering arms, from the storm
 * deck to above the tops (on Saturn, whose south eyewall stands 30-75 km over
 * the eye, highest). Only drawn near a vortex that has them.
 */
const WALL_LIFT: Record<string, number> = { research: 1500, beyond: 3500, freelance: 1500 };
const wallLayers = new Map<string, CloudLayerSpec | null>();
const wallOfGiant = (body: ExpeditionBody) => {
    if (wallLayers.has(body.id)) return wallLayers.get(body.id)!;
    const model = gasModel(body);
    const storm = model.decks.find((d) => d.storms) ?? model.decks[model.decks.length - 1];
    const top = model.decks[0];
    const layer: CloudLayerSpec | null = WALL_LIFT[body.id] === undefined ? null : {
        bottom: storm.top - storm.thickness,
        top: top.top + WALL_LIFT[body.id],
        coverage: 1,
        density: 0.01,
        // Finer than the decks: the wall is seen from close by.
        scale: 1300,
        erosion: 0.55,
        anvil: 0.9,
        storm: 1,
        lit: new THREE.Color(storm.lit).lerp(new THREE.Color(top.lit), 0.7),
        shade: new THREE.Color(storm.under),
        vortex: true,
    };
    wallLayers.set(body.id, layer);
    return layer;
};
const withWall = new Map<string, CloudLayerSpec[]>();

const axes = new Map<string, THREE.Vector3>();
const axisOf = (body: ExpeditionBody) => {
    let axis = axes.get(body.id);
    if (!axis) {
        axis = body.gas ? fromEquatorial(body.gas.pole[0], body.gas.pole[1]) : new THREE.Vector3(0, 1, 0);
        axes.set(body.id, axis);
    }
    return axis;
};

const up = new THREE.Vector3();
const east = new THREE.Vector3();
const look = createZoneLook();

export const createCloudScene = (): CloudScene => ({
    centre: new THREE.Vector3(),
    radius: 1,
    axis: new THREE.Vector3(0, 1, 0),
    layers: [],
    sun: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    skyTop: new THREE.Color(),
    skyBottom: new THREE.Color(),
    haze: new THREE.Color(),
    visibility: 1e9,
    reach: 45000,
    wind: new THREE.Vector3(),
    flash: new THREE.Vector3(),
    flashLevel: 0,
    map: null,
    murk: new THREE.Vector3(),
    cirrusTurn: 0,
    deckTop: new THREE.Vector3(1e9, 1e9, 1e9),
    deckThick: new THREE.Vector3(1, 1, 1),
    vortexA: [0, 1, 2, 3].map(() => new THREE.Vector4()),
    vortexB: [0, 1, 2, 3].map(() => new THREE.Vector4()),
    vortexC: [0, 1, 2, 3].map(() => new THREE.Vector4(1, 0, 0, 0)),
    e1: new THREE.Vector3(1, 0, 0),
    wall: new THREE.Vector2(0, 1),
    time: 0,
    infrared: 0,
    exposure: 1,
    cell: { a: new THREE.Vector4(), b: new THREE.Vector4(), c: new THREE.Vector4(), bound: new THREE.Vector4(), d: new THREE.Vector4(1, 0, 0, 0) },
    cover: null,
    coverFrame: new THREE.Matrix3(),
    steps: 0,
});

/**
 * A dust storm on a world with ground: one layer from just under the ground
 * to over the storm's head, its shape round the storm cell weather.ts drifts
 * over the ground (cloudVolume.ts, cvCellShape). Mars's dust, lit: the ochre
 * of the Pathfinder and Curiosity pictures; in its own shade, umber.
 */
const dustLayer: CloudLayerSpec = {
    bottom: 0,
    top: 1,
    coverage: 1,
    density: 0.014,
    scale: 620,
    erosion: 0.38,
    anvil: 0.9,
    storm: 0,
    lit: new THREE.Color('#e2ae7c'),
    shade: new THREE.Color('#6b4630'),
    dust: true,
};
const dustLayers = [dustLayer];
/**
 * A thunderstorm on Earth: a cumulonimbus from under its base (the rain) to
 * its anvil (cloudVolume.ts, cvStormCell). Sunlit tops white, the base and
 * the rain under it slate grey.
 */
const thunderLayer: CloudLayerSpec = {
    bottom: 0,
    top: 1,
    coverage: 1,
    density: 0.011,
    scale: 760,
    erosion: 0.3,
    anvil: 0.9,
    storm: 1,
    lit: new THREE.Color('#f2f4f7'),
    shade: new THREE.Color('#4f5866'),
    thunder: true,
};
const thunderLayers = [thunderLayer];
/**
 * Earth's fair-weather cumulus (cloudVolume.ts, a layer with `cover`): heaped up out of wherever its
 * deck is cloudy (Clouds.tsx shares its cover map), from just under the deck's height to a kilometre
 * over it, so from space and from under them they are the same clouds. Sunlit tops white, the flat
 * bases grey with a little of the sky's blue. Drawn (Settings › Graphics › Clouds: on High by default)
 * from the ground to a few kilometres up; further out and higher the deck alone draws them.
 */
const cumulusLayer: CloudLayerSpec = {
    bottom: 0,
    top: 1,
    // Of the deck's cloudy sky, how much the puffs fill: the rest is the gaps between them, so the
    // noise shapes each puff (full cover made solid masses with straight sides: columns).
    coverage: 0.58,
    // Fair-weather cumulus are wider than they are tall and thin enough to glow at their edges:
    // puffs a kilometre across, half a kilometre deep, domed from a quarter of the way up.
    density: 0.014,
    scale: 1000,
    erosion: 0.45,
    anvil: 0.25,
    storm: 0,
    lit: new THREE.Color('#ffffff'),
    shade: new THREE.Color('#8e98a8'),
    cover: true,
};
const CUMULUS_CEILING = 9000;
const CUMULUS_REACH = 22000;
const cumulusOf = (runtime: ExpeditionRuntime, body: ExpeditionBody) =>
    runtime.features.volumeClouds && runtime.altitude < CUMULUS_CEILING && runtime.underwater <= 0 && runtime.cloudCover?.body === body ? runtime.cloudCover : null;
const hasCumulus = (body: ExpeditionBody | null) => !!body && body.kind === 'rocky' && usesEarthMap(body);

/** A world's storm cells' layers, if they are drawn as a volume. */
const cellLayersOf = (body: ExpeditionBody | null) => {
    const kind = climateOfBody(body)?.cell?.kind;
    return kind === 'dust' ? dustLayers : kind === 'thunderstorm' ? thunderLayers : [];
};
/** The march's version for a world with ground: its storm cells and, on Earth, its cumulus (compiled for it ahead of time). */
const groundKey = (body: ExpeditionBody | null, cumulus: boolean) => {
    const layers = [...(cumulus ? [cumulusLayer] : []), ...cellLayersOf(body)];
    return layers.length ? marchKey(layers) : null;
};
const cellUp = new THREE.Vector3();
const sky = new THREE.Color();
let cellSeen: object | null = null;
// The layers drawn over ground this frame (kept, not made anew each frame).
const groundLayers: CloudLayerSpec[] = [];

const noClouds = (scene: CloudScene) => {
    scene.steps = 0;
    scene.layers = [];
    scene.murk.z = 0;
    return false;
};

const updateCellScene = (runtime: ExpeditionRuntime, body: ExpeditionBody, scene: CloudScene, dt: number) => {
    const weather = runtime.weather;
    const found = weather.body === body ? weather.cell : null;
    let cell = found && (found.kind === 'dust' || found.kind === 'thunderstorm') ? found : null;
    const strength = cell ? cellLife(cell) * (0.7 + 0.3 * cell.severity) : 0;
    if (strength < 0.01) cell = null;
    const cover = cumulusOf(runtime, body);
    // The deck leaves the sky inside the cumulus's reach to them.
    if (runtime.cloudCover) runtime.cloudCover.near = cover ? CUMULUS_REACH : 0;
    if (!cell && !cover) return noClouds(scene);
    const thunder = cell?.kind === 'thunderstorm';
    eye.copy(runtime.camera).sub(body.position);
    up.copy(eye).normalize();
    const ground = groundHeight(body, up);
    groundLayers.length = 0;
    if (cover) {
        const deck = body.biome!.atmosphereHeight * 0.4;
        cumulusLayer.bottom = deck - 60;
        cumulusLayer.top = deck + 560;
        groundLayers.push(cumulusLayer);
        scene.cover = cover.texture;
        scene.coverFrame.copy(cover.frame);
    } else {
        scene.cover = null;
    }
    if (cell) {
        // A new storm: its pattern starts afresh.
        if (cellSeen !== cell) {
            cellSeen = cell;
            scene.wind.set(0, 0, 0);
        }
        // A dust front's head; a thunderstorm's top (a severe one towers), and its base.
        // (These worlds are small: the horizon is close, so a front has to stand tall to be seen coming.)
        const head = thunder ? 3200 + 2600 * cell.severity : 1800 + 2300 * cell.severity;
        const base = thunder ? 620 : 0;
        const wander = thunder ? 900 : 600 + 500 * cell.severity;
        const layer = thunder ? thunderLayer : dustLayer;
        layer.bottom = ground - 400;
        layer.top = ground + head * 1.35;
        groundLayers.push(layer);
        cellUp.copy(cell.at).normalize();
        scene.cell.a.set(cellUp.x, cellUp.y, cellUp.z, cell.radius / body.radius);
        east.copy(cell.velocity).normalize();
        scene.cell.b.set(east.x, east.y, east.z, strength);
        scene.cell.c.set(ground, head, base, wander);
        // A sphere round the whole cell, its head included.
        const lift = body.radius + ground + head * 0.35;
        scene.cell.bound.set(cellUp.x * lift, cellUp.y * lift, cellUp.z * lift, cell.radius * cell.stretch * (thunder ? 1.45 : 1) + wander + head * 1.2);
        scene.cell.d.set(cell.stretch, 0, 0, 0);
        // The dust is carried with the storm, and boils up at its head (about 3 m/s).
        scene.wind.addScaledVector(cell.velocity, -dt).addScaledVector(cellUp, -3 * dt);
        // Lightning inside the cloud: the last stroke, lighting the cloud round it from within.
        const strike = weather.strike;
        if (thunder && strike && strike.age < 0.4) {
            scene.flash.copy(strike.at).sub(body.position).setLength(body.radius + ground + base + 900);
            scene.flashLevel = weather.flash;
        } else {
            scene.flashLevel = 0;
        }
    } else {
        scene.cell.b.w = 0;
        scene.flashLevel = 0;
    }
    scene.layers = groundLayers;
    for (let i = 0; i < 4; i++) {
        scene.vortexA[i].set(0, 0, 0, 0);
        scene.vortexB[i].set(0, 0, 0, 0);
        scene.vortexC[i].set(1, 0, 0, 0);
    }
    scene.time += dt;
    scene.infrared = 0;
    scene.exposure = 1;
    scene.deckTop.set(1e9, 1e9, 1e9);
    scene.deckThick.set(1, 1, 1);
    scene.centre.copy(body.position).sub(runtime.origin);
    scene.radius = body.radius;
    scene.axis.set(0, 1, 0);
    scene.sun.copy(body.sunDirection);
    // In an eclipse the share of the Sun still showing (the clouds are in the shadow too).
    const day = THREE.MathUtils.smoothstep(up.dot(body.sunDirection), -0.15, 0.25) * runtime.sunlight;
    scene.sunColor.set(body.biome?.sunColor ?? '#fff1dc').multiplyScalar(2.1 * runtime.sunlight);
    // Light from the sky above (Earth's blue; in a dust storm, the glow of the
    // dust itself, sunlight scattered down through it) and the sunlit ground below.
    // (A thunderhead's shaded side is grey, not black: the whole sky, the
    // cloud round it and the ground all light it.)
    if (thunder || !cell) scene.skyTop.set(body.biome?.horizon ?? '#c4dcf0').lerp(sky.setRGB(1, 1, 1), 0.3).multiplyScalar(0.85 * (0.06 + 0.94 * day));
    else scene.skyTop.set(body.biome?.horizon ?? '#dea07c').multiplyScalar(0.6 * (0.06 + 0.94 * day));
    scene.skyBottom.set(body.biome?.horizon ?? '#dea07c').multiplyScalar((thunder || !cell ? 0.45 : 0.3) * (0.06 + 0.94 * day));
    scene.haze.copy(sky.set(body.biome?.horizon ?? '#dea07c')).multiplyScalar(0.6 * (0.06 + 0.94 * day));
    scene.visibility = 40000;
    scene.reach = cell ? 26000 : CUMULUS_REACH;
    // A thin layer of puffs needs fewer steps than a giant's decks or a storm.
    scene.steps = cell ? 0 : 28;
    scene.cirrusTurn = 0;
    scene.map = null;
    return true;
};

const eye = new THREE.Vector3();

/** Every giant's set of features (and the dust storms'), to compile all their cloud marches in the background. */
export const cloudMarchBases = (bodies: ExpeditionBody[]) =>
    [...new Set([
        ...bodies.filter((body) => body.kind === 'gas').map((body) => marchKey(layersOfGiant(body))),
        ...bodies.map((body) => groundKey(body, false)).filter((key): key is string => key !== null),
        ...bodies.filter(hasCumulus).map((body) => groundKey(body, true)).filter((key): key is string => key !== null),
    ])];

/** The features the world the explorer is at needs compiled into the cloud march (null where it has no clouds of volume). */
export const cloudMarchBase = (runtime: ExpeditionRuntime): string | null => {
    const body = runtime.currentBody;
    if (body && body.kind === 'gas') return marchKey(layersOfGiant(body));
    return body ? groundKey(body, hasCumulus(body) && !!cumulusOf(runtime, body)) : null;
};

/** Fill `scene` for this frame; false when there are no clouds near the camera. */
export const updateCloudScene = (runtime: ExpeditionRuntime, scene: CloudScene, dt: number): boolean => {
    const body = runtime.currentBody;
    if (body && body.kind === 'rocky') return updateCellScene(runtime, body, scene, dt);
    if (!body || body.kind !== 'gas') return noClouds(scene);
    const model = gasModel(body);
    const height = runtime.altitude;
    // Clouds are drawn from a little above the top deck's reach of view.
    if (height > model.decks[0].top + 30000) {
        scene.layers = [];
        scene.murk.z = 0;
        return false;
    }
    scene.layers = layersOfGiant(body);
    scene.steps = 0;
    // The great vortices near the camera (up to four), and their walls if any is within sight.
    eye.copy(runtime.camera).sub(body.position);
    const near = nearestVortices(body, eye, 4).filter((n) => n.gap < scene.reach);
    for (let i = 0; i < 4; i++) packVortex(near[i]?.v ?? null, scene.vortexA[i], scene.vortexB[i], scene.vortexC[i]);
    const wall = wallOfGiant(body);
    if (wall && near.some((n) => n.v.kind === 'eye' || n.v.kind === 'spiral')) {
        let layers = withWall.get(body.id);
        if (!layers) {
            layers = [...scene.layers, wall].slice(0, 5);
            withWall.set(body.id, layers);
        }
        scene.layers = layers;
    }
    scene.wall.set(wall?.bottom ?? 0, wall?.top ?? 1);
    scene.e1.copy(ringFrame(axisOf(body)).e1);
    scene.time += dt;
    scene.infrared = THREE.MathUtils.damp(scene.infrared, runtime.infrared ? 1 : 0, 6, dt);
    const decks = model.decks;
    scene.deckTop.set(decks[0]?.top ?? 1e9, decks[1]?.top ?? 1e9, decks[2]?.top ?? 1e9);
    scene.deckThick.set(decks[0]?.thickness ?? 1, decks[1]?.thickness ?? 1, decks[2]?.thickness ?? 1);
    scene.centre.copy(body.position).sub(runtime.origin);
    scene.radius = body.radius;
    scene.axis.copy(axisOf(body));
    scene.sun.copy(body.sunDirection);
    up.copy(runtime.camera).sub(body.position).normalize();
    const light = THREE.MathUtils.clamp(lightAt(model, height), 0, 1);
    const day = THREE.MathUtils.smoothstep(up.dot(body.sunDirection), -0.2, 0.25);
    scene.sunColor.setRGB(2.3, 2.18, 1.98);
    // How it looks at this depth (gasAtmosphere zones): the sky overhead
    // lights the clouds from above, the glow from below (sunlight sent back up
    // by the decks underneath; deep down, the planet's heat) from beneath.
    zoneAt(model, height, look);
    const deepDown = THREE.MathUtils.smoothstep(-height, 2000, 11000);
    scene.skyTop.copy(look.sky).multiplyScalar(0.45 * (0.08 + 0.92 * day) * (0.3 + 0.7 * light));
    scene.skyBottom.copy(look.glow).multiplyScalar(0.3 * (0.08 + 0.92 * day) * light + 0.32 * deepDown);
    // The haze the decks fade into, never black to an eye used to the dark.
    scene.haze.copy(look.haze).multiplyScalar(Math.max(0.55 * (0.06 + 0.94 * day) * (0.25 + 0.75 * light), 0.22 * deepDown));
    // The gas itself fogs everything between the clouds, the rings and the
    // sky above included: as thick here as this depth's visibility says,
    // thicker below and thinner above (an e-fold every 6.5 km).
    scene.visibility = look.visibility;
    scene.murk.set((3.9 / look.visibility) * Math.exp(height / 6500), 6500, 1);
    // An eye opens up in the dark: the deeper, the more it sees of what light there is.
    scene.exposure = exposureAt(light);
    scene.reach = 45000;
    // The jets carry the clouds east (or west), faster than a hurricane.
    east.crossVectors(axisOf(body), up).normalize();
    const wind = windAt(model, up.dot(axisOf(body)));
    scene.wind.addScaledVector(east, -wind * dt);
    scene.cirrusTurn -= wind * dt / body.radius;
    const flash = runtime.gas?.flash;
    if (flash) {
        scene.flash.copy(flash.position).sub(body.position);
        scene.flashLevel = flash.level;
    } else {
        scene.flashLevel = 0;
    }
    scene.map = body.gas?.map ? gasMapTexture(body.gas.map) : null;
    return true;
};
