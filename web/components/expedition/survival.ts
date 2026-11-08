import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';

/**
 * Surviving on foot: what crystals are for, food, and the campfire.
 *
 * Crystals are the expedition's energy. The suit's fabricator turns them
 * into things that keep the explorer going (an oxygen refill, a medkit, a
 * ration, a campfire kit, a patch for the ship's shield) and into lasting
 * upgrades (a bigger jetpack, a bigger air tank, a faster mining tool). Food
 * comes from plants that grow on every world with ground (berries on Earth,
 * stranger fruit elsewhere) or from rations; eating keeps hunger off, and
 * eating a cooked meal by a campfire heals. A campfire is also where the
 * explorer comes to after blacking out, once one has been lit.
 */
export interface Supplies {
    /** Food carried: fruit, berries, rations. */
    food: number;
    /** Upgrade levels: jetpack fuel, air tank, mining tool (0 to 2 each). */
    jetpack: number;
    tank: number;
    tool: number;
}

export const emptySupplies = (): Supplies => ({ food: 2, jetpack: 0, tank: 0, tool: 0 });

/** Counts the story and challenges are measured by (kept between visits). */
export interface Stats {
    /** Crystals ever mined (spending them does not take these back). */
    mined: number;
    /** Crystals mined per world. */
    minedOn: Record<string, number>;
    /** Worlds landed on. */
    landed: string[];
    /** Food gathered from plants. */
    gathered: number;
    /** Things made with the fabricator, by recipe. */
    crafted: Record<string, number>;
    meals: number;
    /** Meals eaten hot, sitting by a campfire. */
    cooked: number;
    /** Seconds rested by a campfire. */
    rested: number;
    /** Highest jump on each world, metres above the take-off. */
    jumps: Record<string, number>;
    /** Highest drop walked away from on each world, metres. */
    drops: Record<string, number>;
    /** Seconds spent swimming. */
    swum: number;
    /** Places visited: 'wormhole', 'ton618', 'horizon' (fell into TON 618), 'kepler' (salvaged), Saturn's 'rings', 'hexagon' and 'decagon', 'io-plume', 'methane' (waded into Titan's sea). */
    visited: string[];
    /** Closest pass by the Sun the ship got away from, in solar radii above its surface (99: none). */
    sunPass: number;
    /** Animals fed by hand and petted; the species that have followed the explorer. */
    fed: number;
    petted: number;
    friends: string[];
    /** Predators driven off, and bites taken. */
    scared: number;
    bitten: number;
    /** Fish caught, and the heaviest (kg). */
    fish: number;
    bestFish: number;
    /** Vaults opened (vaults.ts). */
    vaults: string[];
    /** Radio sources heard clearly, and found; alien life forms scanned. */
    heard: string[];
    signals: string[];
    aliens: string[];
    /** Deaths, in all and on each world (the ship lost counts as one). */
    deaths: number;
    deathsOn: Record<string, number>;
    /** Expeditions (expeditions.ts): attempts, the best medal and the best measure of each. */
    expeditions: Record<string, { attempts: number; medal: Medal | null; best: number }>;
}

/** A chapter's medal (challenges.ts): finished; half its bonus objectives too; all of them. */
export type Medal = 'bronze' | 'silver' | 'gold';

export const emptyStats = (): Stats => ({
    mined: 0, minedOn: {}, landed: [], gathered: 0, crafted: {}, meals: 0, cooked: 0, rested: 0, jumps: {}, drops: {}, swum: 0, visited: [], sunPass: 99,
    fed: 0, petted: 0, friends: [], scared: 0, bitten: 0, fish: 0, bestFish: 0, vaults: [], heard: [], signals: [], aliens: [],
    deaths: 0, deathsOn: {}, expeditions: {},
});

export type RecipeId = 'campfire' | 'dome' | 'oxygen' | 'medkit' | 'ration' | 'repair' | 'jetpack' | 'tank' | 'tool';

export interface Recipe {
    id: RecipeId;
    name: string;
    /** What it does, for the fabricator's list. */
    detail: string;
    /** Crystals it costs now, or null once it is fully upgraded. */
    cost: (supplies: Supplies) => number | null;
    /** An upgrade lasts; the rest are used at once. */
    upgrade: boolean;
}

const level = (costs: number[]) => (current: number) => (current < costs.length ? costs[current] : null);
const jetpackCost = level([15, 30]);
const tankCost = level([12, 25]);
const toolCost = level([10, 22]);

export const RECIPES: Recipe[] = [
    { id: 'campfire', name: 'Campfire kit', detail: 'Lit where you stand. Sit by it to rest and heal, cook food, and come back to it if you black out.', cost: () => 4, upgrade: false },
    { id: 'dome', name: 'Dome habitat', detail: 'A pressurised dome set up in front of you, like the colony\'s on Haven. Inside: air, shelter from storms, heat and radiation, and rest. It stays where you put it.', cost: () => 20, upgrade: false },
    { id: 'oxygen', name: 'Oxygen refill', detail: 'Fills the suit\'s air tank.', cost: () => 3, upgrade: false },
    { id: 'medkit', name: 'Medkit', detail: 'Heals half your health at once.', cost: () => 6, upgrade: false },
    { id: 'ration', name: 'Ration', detail: 'One meal, for worlds where nothing grows.', cost: () => 2, upgrade: false },
    { id: 'repair', name: 'Shield patch', detail: 'Restores the ship\'s shield. Use it by your ship.', cost: () => 5, upgrade: false },
    { id: 'jetpack', name: 'Jetpack fuel cell', detail: 'Upgrade: the jetpack burns longer (+40% each level).', cost: (s) => jetpackCost(s.jetpack), upgrade: true },
    { id: 'tank', name: 'Larger air tank', detail: 'Upgrade: three more minutes of air each level.', cost: (s) => tankCost(s.tank), upgrade: true },
    { id: 'tool', name: 'Mining lens', detail: 'Upgrade: the mining beam cuts faster (+50% each level).', cost: (s) => toolCost(s.tool), upgrade: true },
];

/** How much longer the jetpack burns with its upgrades. */
export const jetpackEndurance = (supplies: Supplies) => 1 + supplies.jetpack * 0.4;
/** Minutes of air in the suit with its upgrades. */
export const airMinutes = (supplies: Supplies) => 6 + supplies.tank * 3;
/** How fast the mining beam cuts with its upgrades. */
export const miningRate = (supplies: Supplies) => 1 + supplies.tool * 0.5;

/** Seconds a full stomach lasts. */
export const SATIETY_SECONDS = 15 * 60;

/** A lit campfire: where it is, and when it was lit (seconds, page clock). */
export interface Campfire {
    body: ExpeditionBody;
    position: THREE.Vector3;
    up: THREE.Vector3;
    /** Which way its log seat faces from the fire. */
    seat: THREE.Vector3;
    lit: number;
}

/** A plant whose fruit can be picked: on every world with ground. */
export interface ForagePlant {
    id: string;
    position: THREE.Vector3;
    /** Food it gives. */
    yield: number;
}

/** What grows on each kind of world, for the HUD and the plants' look. */
export const FORAGE_NAME: Record<string, string> = {
    verdant: 'Wild berries',
    desert: 'Dune melons',
    cratered: 'Rock lichen pods',
    canyon: 'Canyon cactus fruit',
    frozen: 'Frost berries',
    glacier: 'Ice kelp bulbs',
};
