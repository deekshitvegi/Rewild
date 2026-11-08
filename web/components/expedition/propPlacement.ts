import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { openingHeading } from './sites';
import { groundHeight, groundSpot } from './environment';
import { usesEarthMap } from './earth';
import { usesMarsMap } from './mars';
import { fbm, smoothstep } from './noise';
import { cellPoint, cellRandom, type SurfaceCell } from './scatter';
import { siteClearings } from './history';
import type { ModelName } from './models';
import {
    archColliders, archGeometry, boulderGeometry, bushGeometry, butteGeometry, cactusGeometry,
    coniferGeometry, hoodooGeometry, lilyGeometry, reedGeometry, roundTreeGeometry, spireGeometry,
} from './propGeometry';

/**
 * Where props go on each world, with no rendering: the per-biome kits and
 * the deterministic placement of a cell's props. Kept free of React so it can
 * be measured and tested on its own.
 */

export type Collider = [number, number, number, number];

/**
 * How a sculpted model (models.ts) is fitted to a layer's model units: which
 * of its points goes on the vertical axis, how it is scaled, and where its
 * foot or centre ends up.
 */
export interface ModelFit {
    /** Model x, z to put on the axis (default: the middle of its bounding box). */
    axis?: [number, number];
    /** Scale to this height, or by this factor. */
    height?: number;
    scale?: number;
    /** Put its lowest point at this height, or its middle. */
    bottom?: number;
    middle?: number;
    /** Flatten it to this share of its height (a rock into a slab). */
    squash?: number;
}

export interface PropModel {
    name: ModelName;
    fit: ModelFit;
    /** Multiplies the model's own colours, to suit the world. */
    tint?: THREE.ColorRepresentation;
    /** Colliders for the model's shape, in place of the layer's. */
    colliders?: Collider[];
    /**
     * Paint it with a ground picture (terrain/<picture>.webp) projected in
     * model space instead of its own texture: the strata then run level
     * through the rock and match the cliffs. `repeat` is repeats per model
     * unit; above `cap` the rock is the darker, harder cap stone.
     */
    triplanar?: { picture: 'sandstone'; repeat: number; cap?: number };
}

/**
 * A photographed plant (public/textures/expedition) drawn as crossed upright
 * cards, the way distant trees are drawn in games: from the ground it reads as
 * a full tree from every side, and it costs a few triangles.
 */
export interface PropBillboard {
    name: 'broadleaf' | 'pine' | 'snowpine';
    /** Height in the layer's model units; the width follows the picture. */
    height: number;
    /** Multiplies the picture's colours, to suit the world. */
    tint?: string;
}

/**
 * Real three-dimensional trees (trees.ts), one model per variant, 1 unit
 * tall so the layer's scale is their height in metres. Near the explorer they
 * are drawn whole; from `near` [start, end] (per quality) they dissolve into
 * impostors, pictures of themselves, out to the layer's reach.
 */
export interface PropTree {
    models: ModelName[];
    near: [[number, number], [number, number], [number, number]];
    /** Multiplies the leaves' colours, to suit the world. */
    tint?: string;
    /** Snow on the upward faces of the crowns. */
    snow?: number;
}

export interface PropLayer {
    id: string;
    build: (seed: number) => THREE.BufferGeometry;
    variants: number;
    /** Target cell size (world units) and average instances per cell. */
    cell: number;
    perCell: number;
    /** Distance at which the layer has faded out, per quality level. */
    reach: [number, number, number];
    /** Instance scale range (model units to world units). */
    scale: [number, number];
    /** Density field that clusters the layer, 0..1. */
    density?: (x: number, y: number, z: number) => number;
    /** Only where the ground is at least this flat (normal . up). */
    flatness?: number;
    /** Only between these terrain heights. */
    heights?: [number, number];
    /** Model units pushed into the ground. */
    sink: number;
    /** 0 stands upright, 1 follows the slope. */
    lean: number;
    sway: number;
    /** Keeps this much ground clear around the landing zone. */
    clearZone: number;
    colliders?: Collider[];
    /** Colliders that stop the ship as well as the explorer. */
    shipSolid?: boolean;
    /** Hand-placed instances: distance and bearing from the landing zone. */
    landmarks?: {
        distance: number; bearing: number; scale: number; face?: boolean;
        /** Which way the model's front (+Z) looks: radians from the opening heading, toward its right. */
        front?: number;
        /** Stands in water on purpose (a torii in a lake): on the bed, and not moved ashore. */
        wet?: boolean;
        /** Stands exactly here, though beside water (a lantern on a lake's shore): not moved inland. */
        exact?: boolean;
        /** Stands at this height (metres above the radius) instead of on the ground: a bridge over a stream. */
        level?: number;
        /** Which of the layer's variants (a tree layer: which model); by default they take turns. */
        variant?: number;
    }[];
    /**
     * A sculpted model drawn in place of the built geometry once it has
     * loaded; or several, one for each variant in turn.
     */
    model?: PropModel | PropModel[];
    /**
     * Laid along the slope's contour, its x axis pointing downhill: a band of
     * rock exposed across a hillside, its cliff facing down the slope.
     */
    contour?: boolean;
    /** Where a sculpted model made in two levels of detail changes to its far level (metres). */
    detail?: number;
    /** Or a photographed plant, likewise. */
    billboard?: PropBillboard;
    /** Or real trees, likewise. */
    tree?: PropTree;
    /**
     * Chooses the variant at a spot (unit direction) from a random number 0..1:
     * so trees grow in stands of their own kind. Without it every variant is
     * equally likely everywhere.
     */
    pick?: (x: number, y: number, z: number, random: number) => number;
    /** The largest share of the layer's instances one variant may hold in view (sizes its draws); 1/variants by default. */
    crowd?: number;
    /** Grows on the water's surface (water lilies) instead of on dry land. */
    onWater?: boolean;
}

// The sculpted rocks, fitted to the model units of the shapes they replace.
const BOULDER: Omit<PropModel, 'tint'> = { name: 'boulder', fit: { scale: 2, middle: -0.14 } };
// The same rock pressed flat: the plates of basalt the Venera landers stood among.
const SLAB: Omit<PropModel, 'tint'> = { name: 'boulder', fit: { scale: 2.4, squash: 0.26, middle: -0.04 } };
// Height 1 like the built hoodoo; colliders measured from the model's girth.
const HOODOO: Omit<PropModel, 'tint'> = {
    name: 'hoodoo',
    fit: { axis: [0, 0], height: 1, bottom: -0.02 },
    colliders: [[0, 0.08, 0, 0.16], [0, 0.26, 0, 0.125], [0, 0.44, 0, 0.105], [0, 0.62, 0, 0.095], [0, 0.8, 0, 0.08], [0, 0.95, 0, 0.115]],
    triplanar: { picture: 'sandstone', repeat: 1.4, cap: 0.915 },
};
// Prepared (public/models/expedition) to the built arch's units: a span of
// one unit along x, the ground at y = 0, its legs carried on below it.
// Colliders follow the span, measured from the model.
const ARCH: Omit<PropModel, 'tint'> = {
    name: 'arch',
    fit: { axis: [0, 0], scale: 1 },
    colliders: [
        [0.374, 0.088, -0.155, 0.195], [0.338, 0.2, -0.104, 0.171], [0.321, 0.332, -0.095, 0.163], [0.303, 0.518, -0.053, 0.155],
        [0.228, 0.622, -0.024, 0.181], [0.149, 0.697, -0.005, 0.171], [0.052, 0.691, 0.063, 0.175], [-0.044, 0.681, 0.121, 0.182],
        [-0.141, 0.663, 0.14, 0.191], [-0.195, 0.529, 0.14, 0.158], [-0.242, 0.402, 0.162, 0.166], [-0.299, 0.321, 0.19, 0.182],
        [-0.324, 0.191, 0.187, 0.204], [-0.389, 0.095, 0.208, 0.194],
    ],
};

const column = (heights: number[], radius: number): Collider[] => heights.map((y) => [0, y, 0, radius]);

/** A plain block standing on the ground, coloured: what a ruin is drawn as until its model arrives. */
const blockGeometry = (width: number, height: number, depth: number, color: string) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(0, height / 2, 0);
    const c = new THREE.Color(color);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) {
        colors[i] = c.r;
        colors[i + 1] = c.g;
        colors[i + 2] = c.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
};

/**
 * What is left of the cities, three hundred years on (docs/story.md): stumps of towers in the old
 * centres, houses round them, cars where the streets were, a fallen overpass, and by the landing
 * zone the ruin of a landmark tower with its lattice sphere. The towns lie where a slow noise field
 * says (a few kilometres apart on this small Earth); the models are Higgsfield's (1 Nov 2026).
 */
const ruinLayers = (seed: number): PropLayer[] => {
    const town = (x: number, y: number, z: number) => fbm(x * 14, y * 14, z * 14, seed + 303, 2);
    const core = (x: number, y: number, z: number) => smoothstep(0.3, 0.5, town(x, y, z));
    const suburbs = (x: number, y: number, z: number) => smoothstep(0.12, 0.32, town(x, y, z));
    return [
        {
            id: 'ruin-tower', build: () => blockGeometry(0.5, 1, 0.6, '#77736d'), variants: 1,
            cell: 150, perCell: 0.5, reach: [1800, 2600, 3400], scale: [22, 56], density: core,
            flatness: 0.85, heights: [-2, 420], sink: 0.01, lean: 0, sway: 0, clearZone: 180,
            colliders: column([0.08, 0.28, 0.48, 0.68, 0.88], 0.3), shipSolid: true,
            model: { name: 'ruinTower', fit: { axis: [0, 0], height: 1, bottom: 0 } },
            landmarks: [
                { distance: 380, bearing: 0.55, scale: 46 }, { distance: 470, bearing: 0.72, scale: 58 },
                { distance: 560, bearing: 0.48, scale: 34 }, { distance: 610, bearing: 0.86, scale: 50 },
                { distance: 700, bearing: 0.62, scale: 40 },
            ],
        },
        {
            id: 'ruin-sphere', build: () => blockGeometry(0.4, 1, 0.4, '#8a847b'), variants: 1,
            cell: 4000, perCell: 0, reach: [3200, 4200, 5200], scale: [90, 90],
            flatness: 0.6, sink: 0.01, lean: 0, sway: 0, clearZone: 200,
            colliders: [...column([0.1, 0.3, 0.5, 0.7], 0.11), [0, 0.88, 0, 0.21]], shipSolid: true,
            model: { name: 'ruinSphere', fit: { axis: [0, 0], height: 1, bottom: 0 } },
            landmarks: [{ distance: 520, bearing: 0.95, scale: 90 }],
        },
        {
            id: 'ruin-house', build: () => blockGeometry(0.9, 1, 0.9, '#7a6e62'), variants: 1,
            cell: 55, perCell: 0.7, reach: [700, 1000, 1400], scale: [7, 10], density: suburbs,
            flatness: 0.85, heights: [-2, 420], sink: 0.02, lean: 0, sway: 0, clearZone: 90,
            colliders: [[0, 0.3, 0, 0.45], [0, 0.72, 0, 0.36]],
            model: { name: 'ruinHouse', fit: { axis: [0, 0], height: 1, bottom: 0 } },
            landmarks: [{ distance: 260, bearing: 0.4, scale: 9 }, { distance: 300, bearing: 0.32, scale: 8 }],
        },
        {
            id: 'ruin-car', build: () => blockGeometry(0.42, 0.36, 1, '#6e4a33'), variants: 1,
            cell: 26, perCell: 0.45, reach: [220, 320, 450], scale: [4.2, 4.8], density: suburbs,
            flatness: 0.8, sink: 0.01, lean: 0.9, sway: 0, clearZone: 40,
            colliders: [[0, 0.2, -0.25, 0.22], [0, 0.2, 0.25, 0.22]],
            model: { name: 'ruinCar', fit: { axis: [0, 0], scale: 1, bottom: 0 } },
            landmarks: [{ distance: 150, bearing: 0.3, scale: 4.5 }, { distance: 172, bearing: 0.36, scale: 4.4 }],
        },
        {
            id: 'ruin-overpass', build: () => blockGeometry(1, 0.62, 0.46, '#8a857d'), variants: 1,
            cell: 420, perCell: 0.3, reach: [1600, 2300, 3000], scale: [30, 42], density: suburbs,
            flatness: 0.85, heights: [-2, 420], sink: 0.02, lean: 0, sway: 0, clearZone: 200,
            colliders: [[-0.3, 0.16, 0, 0.16], [0.3, 0.16, 0, 0.16], [0, 0.48, 0, 0.22]], shipSolid: true,
            model: { name: 'ruinOverpass', fit: { axis: [0, 0], scale: 1, bottom: 0 } },
            landmarks: [{ distance: 430, bearing: 0.2, scale: 38 }],
        },
    ];
};

/**
 * Haven's colony (docs/story.md), round its landing zone: the ark Halcyon standing on its legs
 * where it came down, greenhouse domes and habitat modules round it. Placed by hand, like the
 * arch on Earth; the colonists who live there walk between them (Colonists.tsx).
 */
export const colonyLayers = (): PropLayer[] => [
    {
        id: 'haven-ark', build: () => blockGeometry(0.6, 1, 0.6, '#d8d8d2'), variants: 1,
        cell: 4000, perCell: 0, reach: [5200, 6400, 7600], scale: [150, 150],
        flatness: 0.6, sink: 0.01, lean: 0, sway: 0, clearZone: 120,
        colliders: [...column([0.12, 0.3, 0.5, 0.7, 0.88], 0.17)], shipSolid: true,
        model: { name: 'havenArk', fit: { axis: [0, 0], height: 1, bottom: 0 } },
        landmarks: [{ distance: 240, bearing: 0.18, scale: 150 }],
    },
    {
        id: 'haven-dome', build: () => blockGeometry(1, 0.66, 1, '#cfe3d8'), variants: 1,
        cell: 4000, perCell: 0, reach: [1400, 1900, 2400], scale: [14, 16],
        flatness: 0.8, sink: 0.02, lean: 0, sway: 0, clearZone: 40,
        colliders: [[0, 0.25, 0, 0.62]],
        model: { name: 'havenDome', fit: { axis: [0, 0], height: 1, bottom: 0 } },
        landmarks: [
            { distance: 92, bearing: 0.42, scale: 14 }, { distance: 118, bearing: 0.62, scale: 16 },
            { distance: 146, bearing: 0.5, scale: 13 }, { distance: 112, bearing: -0.08, scale: 15 },
        ],
    },
    {
        id: 'haven-habitat', build: () => blockGeometry(0.66, 0.45, 1, '#e8e8e4'), variants: 1,
        cell: 4000, perCell: 0, reach: [1400, 1900, 2400], scale: [6, 7],
        flatness: 0.85, sink: 0.02, lean: 0, sway: 0, clearZone: 30,
        colliders: [[0, 0.3, -0.3, 0.32], [0, 0.3, 0.3, 0.32]],
        model: { name: 'havenHabitat', fit: { axis: [0, 0], height: 1, bottom: 0 } },
        landmarks: [
            { distance: 70, bearing: 0.2, scale: 6.5 }, { distance: 84, bearing: 0.05, scale: 6 },
            { distance: 150, bearing: 0.28, scale: 7 }, { distance: 172, bearing: 0.12, scale: 6.5 },
            { distance: 130, bearing: 0.78, scale: 6 },
        ],
    },
];

type Landmark = NonNullable<PropLayer['landmarks']>[number];

/** A landmark at a point of the world's map: metres east (x) and north (y) of the landing zone. */
const mapMark = (x: number, y: number, more: Partial<Landmark> = {}): Landmark =>
    ({ distance: Math.hypot(x, y), bearing: Math.atan2(x, y), scale: 1, ...more });
/** The bearing (radians from north toward east) from one map point to another. */
const bearingTo = (x: number, y: number, tx: number, ty: number) => Math.atan2(tx - x, ty - y);

// The garden round the tarn (map metres). One line runs from the gate on the west shore, across the
// water through the torii, to the hall on the south-east shore: arriving from the colony, the visitor
// looks along it with TON 618's light behind them, on the fronts of the torii and the hall.
const TARN: [number, number] = [140, -325];
const TORII: [number, number] = [140, -345];
const HALL: [number, number] = [158, -360];
const AXIS = bearingTo(...HALL, ...TORII);
const GATE: [number, number] = [100.8, -312.4];
// On the north shore: from the gate it stands to the left of the line, the lanterns to the right.
const PAGODA: [number, number] = [124, -284];
// The arched bridge over the stream where it leaves the tarn, its length across the water.
const BRIDGE: [number, number] = [173, -324];
const STREAM = bearingTo(168, -326, 178, -322);
const BRIDGE_ENDS: [number, number][] = [-1, 1].map((k) => [BRIDGE[0] - 9.4 * k * Math.cos(STREAM), BRIDGE[1] + 9.4 * k * Math.sin(STREAM)]);
// Stone lanterns: a pair inside the gate, a path along the south-west shore, a pair before the hall.
const LANTERNS: [number, number][] = [
    [110.4, -316.5], [106.6, -321.1],
    [112.0, -332.5], [120.2, -344.8], [132.9, -351.6], [147.5, -353.0],
    [155.0, -352.3], [150.2, -357.3],
];

/**
 * Haven's temples and shrines (source_assets/temples, made in Blender from real proportions), on the
 * level ground streams.ts pads out for them: the Greek temple on the bay's headland and the Nagara
 * temple on its terrace, both with their fronts to TON 618; the shrine garden round the tarn. Real
 * size: the models are in metres, their origin at the middle of the base, their front +Z.
 */
export const templeLayers = (): PropLayer[] => [
    {
        id: 'temple-greek', build: () => blockGeometry(15.8, 12, 33.9, '#e4ddd0'), variants: 1,
        cell: 4000, perCell: 0, reach: [3000, 3800, 4600], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0, shipSolid: true,
        colliders: [[0, 2, 0, 9], [0, 2, 9, 9], [0, 2, -9, 9]],
        model: { name: 'templeGreek', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [{ distance: 267.9, bearing: -1.0937, scale: 1, front: -0.733 }],
    },
    {
        id: 'temple-nagara', build: () => blockGeometry(17.5, 24, 33, '#d9b98c'), variants: 1,
        cell: 4000, perCell: 0, reach: [3200, 4000, 4800], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0, shipSolid: true,
        // The sanctum under its spire and the hall; the steps up the terrace in front stay open.
        colliders: [[0, 4, -6, 8], [0, 3, 3, 6.5]],
        model: { name: 'templeNagara', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(352, 334, { front: -0.733 })],
    },
    {
        id: 'shrine-torii', build: () => blockGeometry(17.6, 0.8, 1.2, '#b8321c'), variants: 1,
        cell: 4000, perCell: 0, reach: [1600, 2200, 2800], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0,
        colliders: [[-5.6, 3, 0, 1.2], [5.6, 3, 0, 1.2]],
        model: { name: 'shrineTorii', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(...TORII, { front: AXIS, wet: true })],
    },
    {
        id: 'shrine-honden', build: () => blockGeometry(8.8, 7, 8.2, '#9c3a24'), variants: 1,
        cell: 4000, perCell: 0, reach: [1600, 2200, 2800], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0, shipSolid: true,
        colliders: [[0, 2, -0.5, 4.4], [0, 1, 3.5, 2.5]],
        model: { name: 'shrineHonden', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(...HALL, { front: AXIS, exact: true })],
    },
    {
        id: 'shrine-lantern', build: () => blockGeometry(0.9, 2.2, 0.8, '#8d8b84'), variants: 1,
        cell: 4000, perCell: 0, reach: [500, 800, 1100], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0,
        colliders: [[0, 0.8, 0, 0.45]],
        model: { name: 'shrineLantern', fit: { axis: [0, 0], scale: 1 } },
        // Each with its light window toward the water.
        landmarks: LANTERNS.map(([x, y]) => mapMark(x, y, { front: bearingTo(x, y, ...TARN), exact: true })),
    },
    {
        id: 'shrine-pagoda', build: () => blockGeometry(15.8, 34, 15.8, '#7a2a1c'), variants: 1,
        cell: 4000, perCell: 0, reach: [2600, 3400, 4200], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0, shipSolid: true,
        colliders: [[0, 3, 0, 6], [0, 12, 0, 5], [0, 22, 0, 4]],
        model: { name: 'shrinePagoda', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(...PAGODA, { front: bearingTo(...PAGODA, ...TARN), exact: true })],
    },
    {
        // The gate the garden is entered by, from the colony's side: its front to the path, its passage on the line.
        id: 'shrine-gate', build: () => blockGeometry(15.6, 10.7, 11.4, '#8f3322'), variants: 1,
        cell: 4000, perCell: 0, reach: [1800, 2400, 3000], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0, shipSolid: true,
        // The two side bays; the middle stays open to walk through.
        colliders: [[-5.2, 2, 0, 2.8], [5.2, 2, 0, 2.8]],
        model: { name: 'shrineGate', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(...GATE, { front: AXIS })],
    },
    {
        id: 'shrine-bridge', build: () => blockGeometry(16.5, 3, 3.9, '#b8321c'), variants: 1,
        cell: 4000, perCell: 0, reach: [1400, 1900, 2400], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0,
        model: { name: 'shrineBridge', fit: { axis: [0, 0], scale: 1 } },
        landmarks: [mapMark(...BRIDGE, { front: STREAM, level: 45.2, exact: true })],
    },
    {
        // Bronze lanterns hung on vermilion posts at either end of the bridge, their arms over the path.
        id: 'shrine-lantern-hanging', build: () => blockGeometry(0.7, 3.3, 0.6, '#9c3a24'), variants: 1,
        cell: 4000, perCell: 0, reach: [500, 800, 1100], scale: [1, 1],
        flatness: 0, sink: 0, lean: 0, sway: 0, clearZone: 0,
        colliders: [[0, 1.2, 0, 0.3]],
        model: { name: 'shrineLanternHanging', fit: { axis: [0, 0], scale: 1 } },
        landmarks: BRIDGE_ENDS.map(([x, y]) => mapMark(x + 2.2 * Math.sin(STREAM), y + 2.2 * Math.cos(STREAM), { front: bearingTo(x, y, ...BRIDGE), exact: true })),
    },
];

/** Where scattered things do not grow: the historic sites, and the level ground made for buildings. */
const clearingsOn = (body: ExpeditionBody) => {
    const pads = body.biome?.streams?.pads ?? [];
    if (!pads.length) return siteClearings(body);
    return [...siteClearings(body), ...pads.map((pad) => ({
        direction: new THREE.Vector3(...pad.at), cos: Math.cos((pad.radius + pad.blend * 0.5) / body.radius),
    }))];
};

/** Where no wild tree or bush grows: round a lake or a temple with a garden, whose trees are planted (gardenTreeLayers). */
const gardensOn = (body: ExpeditionBody) => [...(body.biome?.streams?.lakes ?? []), ...(body.biome?.streams?.pads ?? [])]
    .filter((place) => place.garden)
    .map((place) => ({ direction: new THREE.Vector3(...place.at), cos: Math.cos(place.garden! / body.radius) }));

/** A layer's sculpted models, one for each variant in turn (none: it draws its built shapes). */
export const layerModels = (layer: PropLayer): PropModel[] => (layer.model ? (Array.isArray(layer.model) ? layer.model : [layer.model]) : []);

// A real tree's trunk, in units of the tree's height.
const TRUNK: Collider[] = [[0, 0.04, 0, 0.03], [0, 0.12, 0, 0.026]];
// Where the whole trees dissolve into impostors, per quality level.
const BROADLEAF_NEAR: PropTree['near'] = [[30, 45], [70, 95], [110, 140]];
const BUSH_NEAR: PropTree['near'] = [[20, 30], [45, 60], [70, 90]];

// The shrine garden's trees round the tarn (map metres; height in metres), clear of the water, of the buildings'
// pads and of the line from the gate across the torii to the hall. Japanese maples framing the hall and the
// gate, one turning colour over the south shore where the gate looks across the water to it.
const MAPLES: [number, number, number, number][] = [
    // x, y, height, 0 deep red / 1 orange-red
    [170, -350, 6.2, 0], [144, -368, 5.6, 1], [112, -302, 5.2, 1],
    [88, -345, 5.8, 0], [125, -357, 5.4, 1], [173, -336, 5, 0],
];
// Black pines trained as niwaki, each leaning out (bearing, radians from north toward east): one over the
// water beside the torii, one at the gate's south flank (12 m from its middle, clear of its posts), one on the
// north shore, one behind the hall.
const PINES: [number, number, number, number][] = [
    [128, -347, 5.2, 0.73], [92.5, -322, 4.6, 1.75], [138, -286, 5, Math.PI], [168, -367, 4.4, -0.94],
];
// Which way the niwaki model leans: radians from its front (+Z) toward its right.
const NIWAKI_LEAN = 2.59;
// Italian cypresses at the Greek temple on the headland: two either side of its back half, and an avenue of
// them along its approach from behind, none in front of its facade (which looks out to sea). In the temple's
// frame: metres along its front axis (negative: behind its middle) and to its right.
const TEMPLE: [number, number] = [-237.9, 123.1];
const TEMPLE_FRONT = -0.733;
const templeSpot = (along: number, right: number): [number, number] => [
    TEMPLE[0] + Math.sin(TEMPLE_FRONT) * along + Math.cos(TEMPLE_FRONT) * right,
    TEMPLE[1] + Math.cos(TEMPLE_FRONT) * along - Math.sin(TEMPLE_FRONT) * right,
];
const CYPRESSES: [number, number, number][] = [
    [-6, 14, 17], [-16, 14.5, 15], [-6, -14, 16], [-16, -14.5, 18.5],
    ...[-38, -48, -58, -68].flatMap((along, k): [number, number, number][] => [[along, 5.5, 15 + (k % 2) * 2.5], [along, -5.5, 16.5 - (k % 2) * 2]]),
];

/** Haven's garden trees: the maples and pines round the tarn, the cypresses at the Greek temple. Placed by hand. */
const gardenTreeLayers = (): PropLayer[] => [
    {
        id: 'garden-maple', build: (s) => roundTreeGeometry(s, ['#8f2a1f', '#a8401f']), variants: 2,
        cell: 4000, perCell: 0, reach: [600, 900, 1200], scale: [5, 6],
        sink: 0.01, lean: 0, sway: 0.8, clearZone: 0, colliders: TRUNK,
        tree: { models: ['jmapleRed', 'jmapleOrange'], near: BROADLEAF_NEAR },
        landmarks: MAPLES.map(([x, y, height, variant]) => mapMark(x, y, { scale: height, variant, exact: true })),
    },
    {
        id: 'garden-pine', build: (s) => coniferGeometry(s, ['#25402a', '#2c4a2f']), variants: 1,
        cell: 4000, perCell: 0, reach: [600, 900, 1200], scale: [4, 5],
        sink: 0.01, lean: 0, sway: 0.4, clearZone: 0, colliders: TRUNK,
        tree: { models: ['pineNiwaki'], near: BROADLEAF_NEAR },
        landmarks: PINES.map(([x, y, height, lean]) => mapMark(x, y, { scale: height, front: lean - NIWAKI_LEAN, exact: true })),
    },
    {
        id: 'temple-cypress', build: (s) => coniferGeometry(s, ['#1f3a24', '#24412a']), variants: 1,
        cell: 4000, perCell: 0, reach: [1200, 1800, 2400], scale: [14, 18],
        sink: 0.01, lean: 0, sway: 0.3, clearZone: 0, colliders: TRUNK,
        tree: { models: ['cypress'], near: BROADLEAF_NEAR },
        landmarks: CYPRESSES.map(([along, right, height]) => mapMark(...templeSpot(along, right), { scale: height, exact: true })),
    },
];

/** Index into `weights` for a random number 0..1, in proportion to the weights. */
const weighted = (weights: number[], random: number) => {
    const total = weights.reduce((sum, w) => sum + w, 0);
    let acc = 0;
    for (let i = 0; i < weights.length; i++) {
        acc += weights[i] / total;
        if (random < acc) return i;
    }
    return weights.length - 1;
};
const blend = (a: number[], b: number[], t: number) => a.map((w, i) => w + (b[i] - w) * t);

// Broadleaf woods, in the order of BROADLEAF.
const BROADLEAF: ModelName[] = ['oakA', 'oakB', 'oakWide', 'ashA', 'ashTall', 'mapleRed', 'mapleOrange', 'aspenGold', 'birch'];
// Mostly oak and ash, a few trees already turning.
const GREEN_WOOD = [30, 25, 18, 15, 12, 0, 3, 2, 1];
// A stand turning colour: maples red and orange, aspens gold.
const AUTUMN_STAND = [7, 6, 3, 4, 3, 30, 26, 20, 1];
// A grove of birch.
const BIRCH_GROVE = [4, 4, 0, 4, 4, 0, 1, 12, 70];

/**
 * Woods grow in stands, not as an even mixture: an oak and ash wood here, a
 * hollow of maples turning red there, a grove of white birches. Two slow noise
 * fields lay the stands out (a few hundred metres across) and blend their mixes
 * at the edges.
 */
const broadleafStands = (seed: number) => (x: number, y: number, z: number, random: number) => {
    const autumn = smoothstep(0.12, 0.32, fbm(x * 30, y * 30, z * 30, seed + 91, 2));
    const grove = smoothstep(0.16, 0.34, -fbm(x * 44, y * 44, z * 44, seed + 97, 2));
    return weighted(blend(blend(GREEN_WOOD, AUTUMN_STAND, autumn), BIRCH_GROVE, grove * (1 - autumn)), random);
};

// Conifers, in the order of CONIFERS: eastern red cedar on open ground (the
// commonest conifer round Dallas), pines in the thick woods, spruce higher up.
const CONIFERS: ModelName[] = ['cedar', 'pineA', 'pineB', 'spruce'];


const forestField = (seed: number) => (x: number, y: number, z: number) =>
    smoothstep(-0.04, 0.3, fbm(x * 40, y * 40, z * 40, seed + 57, 3));
const fieldsField = (seed: number, frequency: number) => (x: number, y: number, z: number) =>
    smoothstep(-0.02, 0.32, fbm(x * frequency, y * frequency, z * frequency, seed + 61, 2));

export const kit = (body: ExpeditionBody): PropLayer[] => {
    const biome = body.biome!;
    const seed = biome.seed;
    const earthly = usesEarthMap(body);
    const forest = earthly ? earthWoods(body, seed) : forestField(seed);
    const sparseForest = earthly ? forest : (x: number, y: number, z: number) => 0.07 + 0.93 * forest(x, y, z);
    const fields = fieldsField(seed, 18);
    const boulder = (colors: string[], snow = false, overrides: Partial<PropLayer> = {}, tint = '#ffffff'): PropLayer => ({
        id: 'boulder', build: (s) => boulderGeometry(s, colors, snow), variants: 3,
        cell: 24, perCell: 0.22, reach: [240, 360, 520], scale: [0.6, 3.0],
        sink: 0.05, lean: 0.6, sway: 0, clearZone: 100, colliders: [[0, 0.05, 0, 0.8]],
        model: { ...BOULDER, tint }, ...overrides,
    });
    const arch = (colors: string[], overrides: Partial<PropLayer> = {}, tint = '#ffffff'): PropLayer => ({
        id: 'arch', build: (s) => archGeometry(s, colors), variants: 2,
        cell: 1100, perCell: 0.16, reach: [2600, 3400, 4200], scale: [70, 130], flatness: 0.8,
        sink: 0.05, lean: 0, sway: 0, clearZone: 380, colliders: archColliders, shipSolid: true,
        model: { ...ARCH, tint }, ...overrides,
    });
    // Every world but the green and red ones: its own rock and ice (rockKit).
    if (biome.ownProps || ROCK_WORLDS.has(biome.kind)) return rockKit(body, boulder, fields);
    switch (biome.kind) {
        case 'verdant': {
            const rock = ['#7c3f2b', '#94502f', '#a9623c', '#6a3526', '#bb7a50'];
            const conifers = (x: number, y: number, z: number, random: number) => {
                const thick = smoothstep(0.45, 0.8, forest(x, y, z));
                const high = smoothstep(80, 220, groundAt(body, x, y, z));
                return weighted([55 * (1 - thick) + 10, 22 * thick + 4, 22 * thick + 4, 40 * high + 3], random);
            };
            return [
                {
                    id: 'tree', build: (s) => roundTreeGeometry(s, ['#47872f', '#579838', '#3e7a2d', '#66a33f']), variants: BROADLEAF.length,
                    cell: 18, perCell: earthly ? 3.6 : 1.6, reach: [520, 800, 1100], scale: [9, 17], density: sparseForest,
                    flatness: 0.8, heights: [-300, 430], sink: 0.01, lean: 0.03, sway: 1, clearZone: 104,
                    colliders: TRUNK, billboard: { name: 'broadleaf', height: 3.9 },
                    tree: { models: BROADLEAF, near: BROADLEAF_NEAR },
                    pick: broadleafStands(seed), crowd: 0.45,
                },
                ...(earthly ? [{
                    // Willows, poplars and birches along the rivers, thickest on the valley floor.
                    id: 'riverside', build: (s: number) => roundTreeGeometry(s, ['#5a8a34', '#6b9a3c', '#4c7d2e']), variants: 3,
                    cell: 15, perCell: 2.4, reach: [520, 800, 1100] as [number, number, number], scale: [9, 17] as [number, number],
                    density: (x: number, y: number, z: number) => smoothstep(0.3, 0.85, groundSpot(body, probe.set(x, y, z)).valley) * 0.9,
                    flatness: 0.75, sink: 0.01, lean: 0.05, sway: 1.2, clearZone: 90, colliders: TRUNK,
                    tree: { models: ['willow', 'poplar', 'birch'] as ModelName[], near: BROADLEAF_NEAR },
                    pick: (_x: number, _y: number, _z: number, random: number) => weighted([50, 32, 18], random), crowd: 0.6,
                } satisfies PropLayer] : []),
                {
                    id: 'conifer', build: (s) => coniferGeometry(s, ['#25502a', '#2c5c2f', '#214626']), variants: CONIFERS.length,
                    cell: 22, perCell: 1.1, reach: [520, 800, 1100], scale: [9, 20],
                    density: earthly
                        // Pines where the woods are thick (the piney woods east of
                        // Dallas), and cedars dotted over the open prairie.
                        ? (x, y, z) => Math.max(smoothstep(0.45, 0.8, forest(x, y, z)) * 0.8, 0.14 * (1 - forest(x, y, z)))
                        : (x, y, z) => forest(x, y, z) * smoothstep(0, 140, groundAt(body, x, y, z)),
                    flatness: 0.72, sink: 0.01, lean: 0.02, sway: 0.6, clearZone: 120, colliders: TRUNK,
                    billboard: { name: 'pine', height: 5.2 },
                    tree: { models: CONIFERS, near: BROADLEAF_NEAR },
                    pick: conifers, crowd: 0.6,
                },
                ...(earthly ? [{
                    // Reeds and bulrushes along the water's edge.
                    id: 'reeds', build: (s: number) => reedGeometry(s, ['#5f7d34', '#6f8c3a', '#86964a', '#4f6b2c']), variants: 3,
                    cell: 4, perCell: 0.9, reach: [70, 110, 160] as [number, number, number], scale: [1.1, 2.0] as [number, number],
                    density: (x: number, y: number, z: number) => smoothstep(0.86, 0.985, groundSpot(body, probe.set(x, y, z)).valley),
                    flatness: 0.6, sink: 0.03, lean: 0.15, sway: 0.8, clearZone: 12,
                } satisfies PropLayer, {
                    // Water lilies in the shallows of the rivers.
                    id: 'lilies', build: (s: number) => lilyGeometry(s, ['#3f6b2a', '#4c7a30', '#5b8a36', '#355f26']), variants: 3,
                    cell: 5, perCell: 0.5, reach: [70, 110, 160] as [number, number, number], scale: [1.6, 3.2] as [number, number],
                    density: (x: number, y: number, z: number) => { const w = groundSpot(body, probe.set(x, y, z)).water; return smoothstep(0.2, 0.6, w) * (1 - smoothstep(1.4, 2.4, w)); },
                    sink: -0.002, lean: 0, sway: 0, clearZone: 12, onWater: true,
                } satisfies PropLayer] : []),
                {
                    // Now and then a tree that has died, standing at the edge of a wood.
                    id: 'snag', build: (s) => roundTreeGeometry(s, ['#6b5a48', '#5d4e40']), variants: 1,
                    cell: 70, perCell: 0.5, reach: [520, 800, 1100], scale: [8, 15],
                    density: (x, y, z) => { const f = forest(x, y, z); return smoothstep(0.1, 0.35, f) * (1 - smoothstep(0.6, 0.9, f)); },
                    flatness: 0.8, sink: 0.01, lean: 0.04, sway: 0.2, clearZone: 120, colliders: TRUNK,
                    tree: { models: ['deadTree'], near: BROADLEAF_NEAR },
                },
                {
                    id: 'bush', build: (s) => bushGeometry(s, ['#3f7c2c', '#4d8b33', '#5b9a3c']), variants: 3,
                    cell: 9, perCell: 0.3, reach: [110, 170, 240], scale: [1.1, 2.4], flatness: 0.7,
                    sink: 0.02, lean: 0.2, sway: 0.4, clearZone: 40,
                    tree: { models: ['bushA', 'bushB', 'bushC'], near: BUSH_NEAR },
                },
                boulder(['#6f6860', '#7d766c', '#5d5852', '#857a6c'], false, {}, '#c9b8a2'),
                arch(rock, { landmarks: [{ distance: 620, bearing: 0.08, scale: 125, face: true }] }, '#d9a48c'),
                ...(earthly ? ruinLayers(seed) : []),
                ...(body.id === 'haven' ? colonyLayers() : []),
                ...(body.id === 'haven' ? templeLayers() : []),
                ...(body.id === 'haven' ? gardenTreeLayers() : []),
            ];
        }
        case 'desert': {
            const sandstone = ['#b0613a', '#c77a4a', '#dc9c68', '#98502f', '#e8b584'];
            return [
                {
                    id: 'spire', build: (s) => spireGeometry(s, sandstone), variants: 3,
                    cell: 70, perCell: 0.4, reach: [1400, 2000, 2600], scale: [45, 120], density: fields,
                    flatness: 0.8, sink: 0.03, lean: 0, sway: 0, clearZone: 260,
                    colliders: column([0.08, 0.28, 0.48, 0.68, 0.88], 0.13), shipSolid: true,
                    landmarks: [
                        { distance: 520, bearing: -0.35, scale: 115 },
                        { distance: 580, bearing: -0.22, scale: 80 },
                        { distance: 700, bearing: 0.3, scale: 135 },
                    ],
                },
                {
                    id: 'hoodoo', build: (s) => hoodooGeometry(s, sandstone), variants: 2,
                    cell: 44, perCell: 0.3, reach: [900, 1300, 1800], scale: [16, 42], density: fields,
                    flatness: 0.8, sink: 0.04, lean: 0, sway: 0, clearZone: 160,
                    colliders: column([0.15, 0.45, 0.8], 0.2), shipSolid: true, model: { ...HOODOO },
                },
                {
                    id: 'butte', build: (s) => butteGeometry(s, sandstone), variants: 2,
                    cell: 950, perCell: 0.22, reach: [3200, 4200, 5200], scale: [80, 170], flatness: 0.85,
                    sink: 0.06, lean: 0, sway: 0, clearZone: 500,
                    colliders: [-0.42, 0, 0.42].flatMap((x) => [-0.42, 0, 0.42].map((z): Collider => [x, 0.5, z, 0.46])),
                    shipSolid: true,
                },
                {
                    id: 'cactus', build: (s) => cactusGeometry(s, ['#5d7d3a', '#6b8b42', '#52703a']), variants: 2,
                    cell: 22, perCell: 0.14, reach: [220, 340, 480], scale: [1.3, 2.3],
                    density: (x, y, z) => 1 - fields(x, y, z), flatness: 0.8, sink: 0.05, lean: 0.05, sway: 0,
                    clearZone: 100, colliders: [[0, 1.0, 0, 0.3]],
                },
                {
                    id: 'shrub', build: (s) => bushGeometry(s, ['#8a7a4c', '#7b6b43', '#96864f']), variants: 2,
                    cell: 11, perCell: 0.25, reach: [110, 170, 240], scale: [0.6, 1.3], flatness: 0.7,
                    sink: 0.2, lean: 0.4, sway: 0.2, clearZone: 40,
                },
                boulder(['#b2744a', '#9e6440', '#c08458'], false, {}, '#e8b088'),
                arch(sandstone, { cell: 1500, perCell: 0.1 }, '#f2c8a8'),
            ];
        }
        case 'canyon': {
            if (usesMarsMap(body)) return marsKit(body, boulder);
            const redRock = ['#8e3f26', '#a4532f', '#bb6c42', '#76331f', '#c98660'];
            return [
                {
                    id: 'hoodoo', build: (s) => hoodooGeometry(s, redRock), variants: 3,
                    cell: 40, perCell: 0.35, reach: [900, 1300, 1800], scale: [14, 38], density: fields,
                    flatness: 0.8, sink: 0.04, lean: 0, sway: 0, clearZone: 160,
                    colliders: column([0.15, 0.45, 0.8], 0.2), shipSolid: true, model: { ...HOODOO, tint: '#e0907a' },
                },
                {
                    id: 'spire', build: (s) => spireGeometry(s, redRock), variants: 2,
                    cell: 90, perCell: 0.25, reach: [1400, 2000, 2600], scale: [30, 85], density: fields,
                    flatness: 0.8, sink: 0.03, lean: 0, sway: 0, clearZone: 260,
                    colliders: column([0.08, 0.28, 0.48, 0.68, 0.88], 0.13), shipSolid: true,
                },
                boulder(['#8a4a33', '#7a4030', '#96583c'], false, {}, '#d49a7e'),
                arch(redRock, { cell: 900, perCell: 0.2, landmarks: [{ distance: 560, bearing: -0.25, scale: 105, face: true }] }, '#e6a08a'),
            ];
        }
        default:
            return rockKit(body, boulder, fields);
    }
};

/** A colour made lighter or darker. */
const shade = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/**
 * Mars as the rovers see it: no spires or arches, but rock everywhere, grey
 * basalt under a coat of dust. Stones strewn over the plains; blocks fallen
 * from the ledges lying on the slopes of debris below them; low slabs of
 * bedrock showing through the soil.
 */
const marsKit = (
    body: ExpeditionBody,
    boulder: (colors: string[], snow?: boolean, overrides?: Partial<PropLayer>, tint?: string) => PropLayer,
): PropLayer[] => {
    const basalt = ['#6e5a4c', '#7b6655', '#5f4f45'];
    const debris = debrisOf(slopeField(body));
    return [
        boulder(basalt, false, { cell: 16, perCell: 0.3, scale: [0.3, 1.5], lean: 0.6, reach: [130, 190, 280], clearZone: 30 }, '#c9a07e'),
        boulder(basalt, false, {
            id: 'block', cell: 30, perCell: 0.9, scale: [1.4, 4.5], lean: 0.45, reach: [360, 520, 740], density: debris,
            clearZone: 60, colliders: [[0, 0.05, 0, 0.8]], shipSolid: true,
        }, '#b8916f'),
        boulder(['#6a5648', '#77614f'], false, {
            id: 'outcrop', cell: 14, perCell: 0.35, reach: [110, 160, 230], scale: [0.8, 2.6], lean: 0.15, sink: 0.02,
            flatness: 0.7, clearZone: 30, colliders: [], model: { ...SLAB, tint: '#b48c6c' },
        }, '#b48c6c'),
    ];
};

/** Rise over run at a spot, from the ground 6 m to either side of it. */
const slopeField = (body: ExpeditionBody) => {
    const up = new THREE.Vector3();
    const t1 = new THREE.Vector3();
    const t2 = new THREE.Vector3();
    const at = new THREE.Vector3();
    const step = 6 / body.radius;
    return (x: number, y: number, z: number) => {
        up.set(x, y, z);
        t1.set(0, 1, 0).cross(up);
        if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0).cross(up);
        t1.normalize();
        t2.crossVectors(up, t1);
        const h = groundHeight(body, up);
        const a = groundHeight(body, at.copy(up).addScaledVector(t1, step).normalize()) - h;
        const b = groundHeight(body, at.copy(up).addScaledVector(t2, step).normalize()) - h;
        return Math.hypot(a, b) / 6;
    };
};
type Field = (x: number, y: number, z: number) => number;
/** Slopes of debris: steeper than the plains, gentler than the cliffs above them. */
const debrisOf = (slope: Field): Field => (x, y, z) => {
    const s = slope(x, y, z);
    return smoothstep(0.3, 0.7, s) * (1 - smoothstep(1.3, 2.2, s));
};

/**
 * The rock of the airless and icy worlds, Venus and Titan, from sculptures
 * made for each kind of ground (rock-*.glb). Each comes in two levels of
 * detail and is recoloured to its world: its picture divided by its own mean
 * colour (texmean.mjs) and multiplied by the world's, so the detail is the
 * sculpture's and the colour the terrain's.
 */
type RockKind = 'lunar' | 'mercury' | 'ice' | 'pluto' | 'io' | 'venus' | 'titan';
const ROCK_WORLDS = new Set(['cratered', 'frozen', 'glacier', 'volcanic', 'methane']);
const ROCK_KIND: Record<string, RockKind> = {
    education: 'mercury', io: 'io', experience: 'venus', titan: 'titan', pluto: 'pluto', triton: 'pluto',
    // Cratered, but their crust is water ice.
    mimas: 'ice', tethys: 'ice', rhea: 'ice', iapetus: 'ice',
    // Ice, but its dark terrain is a rocky lag of dust over it: white blocks
    // stood out on it like plastic.
    ganymede: 'lunar',
};
const rockKind = (body: ExpeditionBody): RockKind => {
    const kind = body.biome!.kind;
    return ROCK_KIND[body.id]
        ?? (kind === 'volcanic' ? 'venus' : kind === 'methane' ? 'titan' : kind === 'cratered' ? 'lunar' : 'ice');
};
// Mean colour of each sculpture's picture, linear (texmean.mjs).
const ROCK_MEAN: Partial<Record<ModelName, [number, number, number]>> = {
    rockBreccia: [0.2048, 0.1946, 0.18],
    rockTalus: [0.1186, 0.1132, 0.1055],
    rockRimOutcrop: [0.1687, 0.1602, 0.1487],
    rockMercuryScarp: [0.1222, 0.1087, 0.0952],
    rockIceBlock: [0.3478, 0.3137, 0.3112],
    rockIceScarp: [0.3789, 0.3766, 0.3638],
    rockPlutoIce: [0.4025, 0.3377, 0.2951],
    rockIoSulfur: [0.2367, 0.1577, 0.0627],
    rockVenusPlates: [0.1136, 0.0959, 0.0752],
    rockTitanCobbles: [0.2767, 0.1738, 0.0941],
};
// Fitted so a layer's scale is a boulder's half-width (as the built boulders),
// or a band's length.
const ROCK_FIT: Partial<Record<ModelName, ModelFit>> = {
    rockBreccia: { scale: 2, middle: -0.16 },
    rockTalus: { scale: 2, middle: -0.3 },
    rockIceBlock: { scale: 2, middle: -0.12 },
    rockPlutoIce: { scale: 2, middle: -0.1 },
    rockIoSulfur: { scale: 2, middle: -0.08 },
    rockVenusPlates: { scale: 1, bottom: -0.035 },
    rockTitanCobbles: { scale: 1, bottom: -0.05 },
    rockRimOutcrop: { scale: 1, bottom: -0.025 },
    rockMercuryScarp: { scale: 1, bottom: -0.025 },
    rockIceScarp: { scale: 1, bottom: -0.03 },
};
// A band's colliders: a row of spheres along its length, where its rock stands
// highest (scarpface.mjs: the ice scarp's top is on its -x side, its cliff
// facing +x).
const along = (x: number, y: number, r: number): Collider[] => [-0.4, -0.27, -0.13, 0, 0.13, 0.27, 0.4].map((z) => [x, y, z, r]);
const ROCK_COLLIDERS: Partial<Record<ModelName, Collider[]>> = {
    rockRimOutcrop: along(0.04, 0.06, 0.09),
    rockMercuryScarp: along(-0.02, 0.07, 0.1),
    rockIceScarp: along(-0.09, 0.1, 0.12),
    rockVenusPlates: along(0, 0.03, 0.08),
};

/**
 * A sculpted rock recoloured so its picture averages `target`, an sRGB
 * colour, a little darker: a rock stands up into the light that grazes the
 * ground, so the same colour reads paler on it than on the ground around.
 */
const rockModel = (name: ModelName, target: string): PropModel => {
    const mean = ROCK_MEAN[name]!;
    const c = new THREE.Color(target).multiplyScalar(0.82);
    return { name, fit: ROCK_FIT[name]!, colliders: ROCK_COLLIDERS[name], tint: new THREE.Color(c.r / mean[0], c.g / mean[1], c.b / mean[2]) };
};
const mix = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/**
 * Stones strewn everywhere; blocks lying on the slopes of debris below the
 * steeper ground (as boulder fields lie on crater walls in the Lunar
 * Reconnaissance Orbiter's pictures); bands of bedrock or ice laid along the
 * contour where the ground is steepest, their cliffs facing downhill; on the
 * icy worlds, fields of broken blocks (Europa's chaos terrain); on Venus and
 * Io plates of lava; on Titan rounded cobbles of ice.
 */
const rockKit = (
    body: ExpeditionBody,
    boulder: (colors: string[], snow?: boolean, overrides?: Partial<PropLayer>, tint?: string) => PropLayer,
    fields: Field,
): PropLayer[] => {
    const biome = body.biome!;
    const [low, mid, high, steep] = biome.palette;
    const kind = rockKind(body);
    const clear = (metres: number) => Math.min(metres, body.radius * 0.12);
    const slope = slopeField(body);
    const debris = debrisOf(slope);
    const steepGround: Field = (x, y, z) => smoothstep(0.55, 1.0, slope(x, y, z));
    const built = [shade(steep, 1.1), shade(mid, 0.8), shade(low, 0.9)];
    // Ice blocks are the ground's own ice: on the dark, dusty moons (Ganymede,
    // Callisto) as dark as it, not white.
    const stoneColor = kind === 'ice' || kind === 'pluto' ? mid : mix(mid, high, 0.5);
    const bandColor = mix(steep, high, 0.5);
    const icy = kind === 'ice' || kind === 'pluto';
    const block: ModelName = kind === 'ice' ? 'rockIceBlock' : kind === 'pluto' ? 'rockPlutoIce' : kind === 'io' ? 'rockIoSulfur' : 'rockBreccia';
    const stones: ModelName[] = kind === 'lunar' ? ['rockTalus', 'rockBreccia', 'rockTalus']
        : kind === 'mercury' ? ['rockBreccia', 'rockTalus', 'rockBreccia']
        : kind === 'pluto' ? ['rockPlutoIce', 'rockIceBlock']
        : [block];
    const band: ModelName = kind === 'mercury' ? 'rockMercuryScarp' : icy ? 'rockIceScarp' : kind === 'venus' || kind === 'io' ? 'rockVenusPlates' : 'rockRimOutcrop';
    // Io's own colours are the point of its rocks: sulphur over dark lava.
    const stoneTarget = kind === 'io' ? mix(steep, mid, 0.55) : stoneColor;
    const layers: PropLayer[] = [];
    if (kind === 'titan') {
        // Titan: rounded pebbles of water ice on a dark plain, as Huygens photographed them.
        layers.push(boulder(['#7a6448', '#8a7254', '#6a563c', '#958060'], false, {
            cell: 10, perCell: 0.32, scale: [0.9, 2.6], lean: 0.3, sink: 0.02, colliders: [], detail: 20,
            model: rockModel('rockTitanCobbles', mix(mid, high, 0.6)),
        }));
    } else {
        layers.push(boulder(built, false, {
            cell: 14, perCell: 0.35, scale: [0.3, 2.4], lean: 0.6, clearZone: clear(100), detail: 26,
            model: stones.map((name) => rockModel(name, stoneTarget)),
        }));
    }
    if (kind === 'venus' || kind === 'io') {
        // Plates of lava: the flat stones the Venera landers stood among.
        layers.push(boulder([steep, shade(steep, 0.7)], false, {
            id: 'slab', cell: 8, perCell: 0.4, reach: [160, 240, 340], scale: [1.4, 5.5], lean: 0.12, sink: 0.01,
            flatness: 0.6, clearZone: clear(40), colliders: [], detail: 30,
            model: rockModel('rockVenusPlates', kind === 'io' ? mix(steep, low, 0.25) : mix(low, steep, 0.4)),
        }));
    }
    layers.push(
        boulder(built, false, {
            id: 'block', cell: 30, perCell: 0.9, scale: [1.3, 5], lean: 0.45, reach: [360, 520, 740], density: debris,
            clearZone: clear(60), colliders: [[0, 0.05, 0, 0.8]], shipSolid: true, detail: 70,
            model: [rockModel(block, stoneTarget), rockModel(stones[0], stoneTarget)],
        }),
        boulder(built, false, {
            id: 'band', cell: 50, perCell: 0.7, scale: [12, 34], lean: 0.85, sink: 0.01, reach: [700, 1000, 1400],
            density: steepGround, contour: true, clearZone: clear(150), colliders: [], shipSolid: true, detail: 160,
            model: rockModel(band, kind === 'io' ? mix(steep, low, 0.3) : bandColor),
        }),
        boulder(built, false, {
            id: 'outcrop', cell: 120, perCell: 0.22, reach: [900, 1300, 1800], scale: [4, 13], clearZone: clear(200),
            colliders: [[0, 0.05, 0, 0.8]], shipSolid: true, detail: 140,
            model: rockModel(block, kind === 'titan' ? mix(low, steep, 0.5) : mid),
        }),
    );
    if (icy) {
        // Fields of broken ice blocks, clustered, where the crust broke up.
        layers.unshift(boulder(built, false, {
            id: 'ice', cell: 60, perCell: biome.kind === 'frozen' ? 0.26 : 0.36, reach: [900, 1300, 1800],
            scale: [3, biome.kind === 'glacier' ? 14 : 10], density: fields, flatness: 0.75, sink: 0.02, lean: 0.25,
            clearZone: clear(160), colliders: [[0, 0.05, 0, 0.75]], shipSolid: true, detail: 160,
            model: rockModel(block, mix(mid, high, 0.35)),
            ...(body.id === 'europa' ? { landmarks: [{ distance: 360, bearing: 0.25, scale: 16 }] } : {}),
        }));
    }
    return layers;
};

const groundAt = (body: ExpeditionBody, x: number, y: number, z: number) => groundHeight(body, probe.set(x, y, z));

/** In water, or on the sand along the sea (Earth), or at a lake's very edge (Titan). */
const onWaterOrBeach = (body: ExpeditionBody, up: THREE.Vector3) => {
    if (!usesEarthMap(body) && !body.biome?.liquid) return false;
    const spot = groundSpot(body, up);
    return spot.water > 0 || spot.shore < 18;
};

/**
 * How wooded Earth is at a spot, as its terrain shades it (the map's tree
 * cover, in patches), with woods lining the rivers and a few trees scattered
 * over the open land.
 */
const earthWoods = (body: ExpeditionBody, seed: number) => (x: number, y: number, z: number) => {
    const spot = groundSpot(body, probe.set(x, y, z));
    if (spot.water > 0) return 0;
    const woods = smoothstep(0.2, 0.65, spot.cover + fbm(x * 160, y * 160, z * 160, seed + 57, 2) * 0.3);
    return Math.max(woods, spot.valley * 0.75, 0.04);
};

export interface PropInstance {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    scale: number;
    tint: number;
    variant: number;
}

const probe = new THREE.Vector3();
const dir = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const normal = new THREE.Vector3();
const axisX = new THREE.Vector3();
const axisY = new THREE.Vector3();
const axisZ = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const basis = new THREE.Matrix4();
const downhill = new THREE.Vector3();

const tangentFrame = (up: THREE.Vector3) => {
    tangent.set(0, 1, 0).cross(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    bitangent.crossVectors(up, tangent).normalize();
};

/** Ground normal at a direction, from two nearby height samples. */
const groundNormal = (body: ExpeditionBody, up: THREE.Vector3, height: number, out: THREE.Vector3) => {
    tangentFrame(up);
    const eps = 2 / body.radius;
    a.copy(up).multiplyScalar(body.radius + height);
    probe.copy(up).addScaledVector(tangent, eps).normalize();
    b.copy(probe).multiplyScalar(body.radius + groundHeight(body, probe));
    probe.copy(up).addScaledVector(bitangent, eps).normalize();
    c.copy(probe).multiplyScalar(body.radius + groundHeight(body, probe));
    out.crossVectors(b.sub(a), c.sub(a)).normalize();
    if (out.dot(up) < 0) out.negate();
    return out;
};

/** Orientation standing on `up`, leaning towards `lean`, turned by `yaw` (or so its x axis points along `facing`). */
const orient = (up: THREE.Vector3, leanTo: THREE.Vector3, lean: number, yaw: number, facing: THREE.Vector3 | null, out: THREE.Quaternion) => {
    axisY.copy(up).lerp(leanTo, lean).normalize();
    if (facing) {
        axisX.copy(facing);
    } else {
        tangentFrame(axisY);
        axisX.copy(tangent).multiplyScalar(Math.cos(yaw)).addScaledVector(bitangent, Math.sin(yaw));
    }
    axisX.addScaledVector(axisY, -axisX.dot(axisY)).normalize();
    axisZ.crossVectors(axisX, axisY).normalize();
    basis.makeBasis(axisX, axisY, axisZ);
    return out.setFromRotationMatrix(basis);
};

export interface LayerState {
    layer: PropLayer;
    depth: number;
    cellWorld: number;
    reach: number;
    perCell: number;
    cache: Map<string, PropInstance[]>;
    pending: SurfaceCell[];
    center: THREE.Vector3 | null;
    dirty: boolean;
}

export const LANDMARK_KEY = 'landmarks';

/** Everything this layer places in one cell. */
export const generateCell = (body: ExpeditionBody, state: LayerState, cell: SurfaceCell, zone: THREE.Vector3): PropInstance[] => {
    const { layer } = state;
    const seed = (body.biome!.seed + layer.id.length * 7919 + layer.id.charCodeAt(0) * 131) >>> 0;
    const instances: PropInstance[] = [];
    const expected = state.perCell;
    const count = Math.floor(expected + cellRandom(cell, seed, 0));
    const clear = Math.cos(layer.clearZone / body.radius);
    const sites = clearingsOn(body);
    const gardens = layer.tree && layer.perCell > 0 ? gardensOn(body) : [];
    for (let k = 0; k < Math.min(count, 6); k++) {
        cellPoint(cell, cellRandom(cell, seed, 1 + k * 5), cellRandom(cell, seed, 2 + k * 5), dir);
        if (dir.dot(zone) > clear) continue;
        if (sites.some((site) => dir.dot(site.direction) > site.cos)) continue;
        if (gardens.some((garden) => dir.dot(garden.direction) > garden.cos)) continue;
        if (layer.density && cellRandom(cell, seed, 3 + k * 5) > layer.density(dir.x, dir.y, dir.z)) continue;
        const height = groundHeight(body, dir);
        if (layer.heights && (height < layer.heights[0] || height > layer.heights[1])) continue;
        if (layer.onWater ? groundSpot(body, dir).water < 0.2 : onWaterOrBeach(body, dir)) continue;
        const needsNormal = layer.flatness !== undefined || layer.lean > 0 || layer.contour;
        if (needsNormal) groundNormal(body, dir, height, normal);
        else normal.copy(dir);
        if (layer.flatness !== undefined && normal.dot(dir) < layer.flatness) continue;
        const r = cellRandom(cell, seed, 4 + k * 5);
        const scale = THREE.MathUtils.lerp(layer.scale[0], layer.scale[1], r * r);
        let facing: THREE.Vector3 | null = null;
        if (layer.contour) {
            // Downhill: the ground normal leans that way.
            downhill.copy(normal).addScaledVector(dir, -normal.dot(dir));
            if (downhill.lengthSq() > 1e-4) facing = downhill.normalize();
        }
        const quaternion = orient(dir, normal, layer.lean, cellRandom(cell, seed, 40 + k) * Math.PI * 2, facing, new THREE.Quaternion());
        axisY.set(0, 1, 0).applyQuaternion(quaternion);
        instances.push({
            position: body.position.clone().addScaledVector(dir, body.radius + height).addScaledVector(axisY, -layer.sink * scale),
            quaternion,
            scale,
            tint: 0.86 + cellRandom(cell, seed, 60 + k) * 0.28,
            variant: layer.pick
                ? layer.pick(dir.x, dir.y, dir.z, cellRandom(cell, seed, 80 + k))
                : Math.floor(cellRandom(cell, seed, 80 + k) * layer.variants),
        });
    }
    return instances;
};

/** Hand-placed props near the landing zone, e.g. the arch the expedition opens on. */
export const generateLandmarks = (body: ExpeditionBody, layer: PropLayer, zone: THREE.Vector3): PropInstance[] => {
    const heading = openingHeading(body);
    const side = new THREE.Vector3().crossVectors(heading, zone).normalize();
    return (layer.landmarks ?? []).map((mark, n) => {
        const bearing = heading.clone().multiplyScalar(Math.cos(mark.bearing)).addScaledVector(side, Math.sin(mark.bearing));
        const at = (distance: number) => zone.clone().multiplyScalar(body.radius).addScaledVector(bearing, distance).normalize();
        // Brought nearer, a step at a time, until it stands on dry ground.
        let distance = mark.distance;
        while (!mark.wet && !mark.exact && distance > 200 && onWaterOrBeach(body, at(distance))) distance -= 30;
        const up = at(distance);
        // In water on purpose: stood on the bed, under the surface.
        const height = mark.level ?? groundHeight(body, up) - (mark.wet ? groundSpot(body, up).water : 0);
        groundNormal(body, up, height, normal);
        let facing = mark.face ? new THREE.Vector3().crossVectors(bearing, up).normalize() : null;
        if (mark.front !== undefined) {
            // The model's +X is up × front, so its +Z looks along the front.
            const front = heading.clone().multiplyScalar(Math.cos(mark.front)).addScaledVector(side, Math.sin(mark.front));
            facing = new THREE.Vector3().crossVectors(up, front).normalize();
        }
        const quaternion = orient(up, normal, 0, n * 2.1, facing, new THREE.Quaternion());
        return {
            position: body.position.clone().addScaledVector(up, body.radius + height).addScaledVector(up, -layer.sink * mark.scale),
            quaternion,
            scale: mark.scale,
            tint: 1,
            variant: mark.variant ?? n % layer.variants,
        };
    });
};

