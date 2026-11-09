import type { DomeSite } from './Domes';
import type { SunCover } from './eclipse';
import type { ShipRecall } from './recall';
import type { CrewState } from './crew';
import type { Mothership } from './mothership';
import * as THREE from 'three';
import type { Features } from './graphics';
import type { ExpeditionBody } from './bodies';
import type { ShipState } from './flight';
import type { WalkerState } from './walking';
import type { DataSite } from './sites';
import type { Mind, Species } from './Wildlife';
import { createFall, type FallState } from './fall';
import { createWeather, type WeatherState } from './weather';
import { gpuInfo } from './graphics';
import { createMotion, type Motion } from './motion';
import { createArgo, type ArgoState } from './argo';
import { createContact, type ContactState } from './contact';
import type { ExpeditionRun } from './expeditions';
import type { Shelter } from './Shelters';
import type { Asteroid } from './Asteroids';
import type { AsteroidField } from './hazards';
import { emptyStats, emptySupplies, type Campfire, type ForagePlant, type RecipeId, type Stats, type Supplies } from './survival';
import type { CueName } from './audio';
import type { FishingState } from './fishing';
import type { Band, RadioReading } from './radio';
import type { LifeForm } from './aliens';
import type { Vault, VaultFrame } from './vaults';
import type { Region } from './region';
import type { Transit } from './crossing';

export interface CrystalCluster {
    id: string;
    /** Centre of the cluster on the ground, in world units. */
    position: THREE.Vector3;
    health: number;
}

export interface Burst {
    position: THREE.Vector3;
    color: THREE.Color;
    start: number;
}

/**
 * Mutable state shared by the expedition's 3D components and its HUD.
 *
 * Everything in the system is positioned in double-precision world units, but
 * WebGL only has single precision. The scene is therefore drawn relative to
 * `origin` (a floating origin that follows the player), so whatever the player
 * is looking at stays near (0, 0, 0) where precision is best.
 */
export type ExpeditionMode = 'ship' | 'walk';

export interface ExpeditionRuntime {
    origin: THREE.Vector3;
    mode: ExpeditionMode;
    /** The body whose gravity and atmosphere the player is in, if any. */
    currentBody: ExpeditionBody | null;
    /** Height above the terrain of currentBody. */
    altitude: number;
    /** 0 in space, 1 at the bottom of an atmosphere. */
    atmosphere: number;
    /** How high the sun is where the player is: 0 night, 1 day (an eclipse takes its share off). */
    daylight: number;
    /** The share of the Sun's disc left uncovered where the camera is (1, or less in an eclipse). */
    sunlight: number;
    /** What is eclipsing the Sun where the camera is, and by how much (eclipse.ts). */
    eclipse: SunCover;
    /**
     * How dark-adapted the player's eyes are (0..1): 1 on a world's night
     * side, near its ground, where everything round about is dark and the
     * Moon or a planet in the sky looks as bright as it does to a real eye.
     */
    nightEyes: number;
    /** How near the ground of the world the player is at (1 on it, 0 half its radius up and beyond). */
    nearGround: number;
    /** Speed in units per second. */
    speed: number;
    pulse: boolean;
    /** Camera position in world units. */
    camera: THREE.Vector3;
    /** Set by the terrain so props and physics can read the ground. */
    heightAt: Map<string, (x: number, y: number, z: number) => number>;
    /** Reduced-motion preference: no shake, fewer streaks. */
    reducedMotion: boolean;
    /** Rendering quality: 0 phone, 1 laptop, 2 desktop. */
    quality: 0 | 1 | 2;
    /** The costlier effects as the player has them (graphics.ts, Settings › Graphics). */
    features: Features;
    /** The camera, so the HUD can place markers on screen. */
    view: { camera: THREE.Camera | null };
    /** Live values the HUD reads a few times a second. */
    hud: {
        ship: ShipState | null;
        walker: WalkerState | null;
        prompt: string;
    };
    /** Mineable crystals near the explorer, and what has been mined. */
    surface: {
        crystals: CrystalCluster[];
        target: CrystalCluster | null;
        beam: { from: THREE.Vector3; to: THREE.Vector3 } | null;
        mined: Set<string>;
        bursts: Burst[];
        version: number;
        /**
         * Solid props near the player (rocks, trunks, pillars, arches) as flat
         * [x, y, z, radius, stopsShip] spheres in world units.
         */
        obstacles: number[];
        /** Solid things placed by other layers (a vault and its runes), in the same x, y, z, radius, ship-solid groups. */
        fixtures: number[];
        /** The rock shelters' walls and roofs (Shelters.tsx), the same way. */
        shelters: number[];
    };
    inventory: { crystals: number };
    /** Food and upgrades (survival.ts), live; saved with the progress. */
    supplies: Supplies;
    /** What the story is measured by, live; saved with the progress. */
    stats: Stats;
    /** The campfire lit last, if any: where to rest, cook, and come to after blacking out. */
    camp: Campfire | null;
    /** Rocks near the ship in space (Asteroids.tsx), the one the mining laser is on, and a dense field the pulse drive was pulled out into. */
    asteroids: Asteroid[];
    asteroidTarget: Asteroid | null;
    asteroidField: AsteroidField | null;
    /** The ship's hull temperature in kelvin, from its distance to the Sun (hazards.ts). */
    heat: number;
    /**
     * Inside a gas giant (GasDepths.tsx): how far above (or below) its 1 bar
     * level, how much sunlight is left, the cloud deck around the ship, and
     * the latest lightning stroke (world position).
     */
    gas: null | { body: ExpeditionBody; height: number; light: number; deck: string | null; flash: { position: THREE.Vector3; strength: number; level: number; hit: boolean } | null };
    /**
     * Earth's cloud cover as its deck draws it (Clouds.tsx): the cube map, the turn from the game's
     * frame into it (the world's own turn, then the wind's), so the clouds with volume
     * (cloudScenes.ts) are the same clouds; and how far out those are drawn this frame (the deck
     * leaves the sky inside that to them; 0 when they are not drawn).
     */
    cloudCover: null | { body: ExpeditionBody; texture: THREE.Texture; frame: THREE.Matrix3; near: number };
    /**
     * The water's own surface near the explorer (WaterSurface.tsx): the world it is drawn on and
     * how far out; the ground inside that draws the bed under it (PlanetTerrain.tsx).
     */
    waterSurface: null | { body: ExpeditionBody; near: number };
    /** How far under the water's surface the camera is (m; 0 in the air). */
    underwater: number;
    /** Short sounds asked for by what just happened, played by Soundscape on the next frame. */
    cues: { name: CueName; volume: number; option: number }[];
    /** The ship's mining laser is cutting an asteroid (for its sound). */
    shipLaser: boolean;
    /**
     * The radio (radio.ts): which band it is tuned to (off: null), what it
     * hears, and the life form being scanned at an alien site (aliens.ts),
     * how far along, and the last one found (for the HUD's card).
     */
    radio: { band: Band | null; reading: RadioReading | null };
    scan: { life: LifeForm | null; progress: number; found: { name: string; blurb: string; label?: string } | null; foundAt: number };
    /**
     * The vault near the explorer (Vaults.tsx): its runes, how many are lit
     * in order, the seconds left to light the rest, whether it is open, and
     * which rune the beam is on and for how long (Player charges it).
     */
    vault: { vault: Vault; frame: VaultFrame; lit: number; left: number; open: boolean; charge: number[]; target: number } | null;
    /** A historic site's sample tube in reach on foot (history.ts, HistoricSites.tsx): which, and where. */
    pickup: { index: number; position: THREE.Vector3 } | null;
    /** Fishing under way (fishing.ts), and open water in front of the explorer to cast into. */
    fishing: FishingState | null;
    fishSpot: THREE.Vector3 | null;
    /** Where the ship last set down: a new one waits there if it is lost. */
    lastLanding: { body: ExpeditionBody; position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
    /** Plants with fruit near the explorer, and when each was picked (they grow back). */
    forage: { plants: ForagePlant[]; picked: Map<string, number>; target: ForagePlant | null; version: number };
    /**
     * The animal species the explorer is looking at, and every species seen;
     * the animal in arm's reach in front of them and what can be done with it
     * (feed it, pet it); whether the mining beam is held on the animal looked
     * at (it drives a predator off); and how close a predator is to attacking.
     */
    fauna: {
        target: Species | null;
        discovered: Set<string>;
        version: number;
        /** Every animal about, with what scanning it finds when it is an alien site's (Aliens.tsx). */
        animals: { position: THREE.Vector3; life?: LifeForm }[];
        reach: { name: string; mind: Mind; friend: boolean; act: (what: 'feed' | 'pet') => string | null } | null;
        /** Where the animal looked at is (for the beam). */
        targetPosition: THREE.Vector3 | null;
        zapping: boolean;
        danger: number;
    };
    /** The data site in reach, and the one whose log is open (the game pauses). */
    sites: { nearest: DataSite | null; open: DataSite | null };
    /** Set by the experience: called when the player reads a site, comes out of a wormhole mouth, or falls into the black hole. */
    events: { openSite: (site: DataSite) => void; transit: (to: string) => void; fall: () => void; fallDone: () => void; learn: (letters: string[]) => void };
    /**
     * Set by the player: put the ship somewhere, flying the given way; or out
     * of a wormhole mouth; or make something with the fabricator (returns why
     * not, or null when it was made).
     */
    actions: {
        place: (position: THREE.Vector3, facing: THREE.Vector3, speed?: number, up?: THREE.Vector3) => void;
        arriveAt: (mouthId: string) => void;
        craft: (recipe: RecipeId) => string | null;
        /** Play as crew member `index` (crew.ts); returns what to tell the player. */
        switchCrew: (index: number) => string | null;
        /** Dock with the Argo, or undock from her (mothership.ts). */
        dock: () => string;
    };
    /** The crew of four and who is being played (crew.ts); made by Player. */
    crew: CrewState | null;
    /** The mothership, the only ship that can cross the wormhole (mothership.ts); made by Player. */
    mothership: Mothership | null;
    /**
     * Crossing a wormhole (crossing.ts, WormholeTransit.tsx): how far through the sequence, the mouth
     * it comes out of, and the way out (game frame). The ship is already at the far mouth, held while
     * the sequence plays.
     */
    transit: Transit | null;
    /**
     * The system the player is in (region.ts): only its worlds are built. `loading` is true from
     * the moment it changes until the other system is built and its shaders are ready, while the
     * film of the crossing plays (the crossing is held short of its end until then).
     */
    region: Region;
    loading: boolean;
    /** A colonist of Haven within talking distance (Colonists.tsx), and the last thing one said. */
    colonist: { name: string; line: string } | null;
    speech: { name: string; line: string; at: number } | null;
    /** Falling into TON 618 (fall.ts). */
    fall: FallState;
    /** A world picked on the system map, highlighted until it is reached. */
    waypoint: string | null;
    /** The ship flying in to the explorer, called with G on foot (recall.ts). */
    shipRecall: ShipRecall | null;
    /** Worlds the player marked on the system map: their markers stay up wherever they fly. */
    marks: string[];
    /** Every world's marker shown for a look round (L); otherwise only the course and the marks. */
    allMarkers: boolean;
    /** The domes built on the worlds (Domes.tsx), and whether the explorer is inside one now. */
    domes: DomeSite[];
    inDome: boolean;
    /** A rock coming down near the explorer (Impacts.tsx): how long, how far, which way, and where. */
    impact: { seconds: number; metres: number; bearing: string; point: THREE.Vector3 } | null;
    /** A spot picked on the surface map (world position), marked until it is reached. */
    surfaceWaypoint: THREE.Vector3 | null;
    /**
     * The story chapter under way (quests.ts): its world, and where each of its unmet objectives
     * is (gold markers, shown on that world even beyond the horizon). Set by the HUD's story tick.
     */
    story: { chapter: string | null; world: string | null; aims: { id: string; body: string; name: string; label: string; at: () => THREE.Vector3 }[] };
    /** Flying the ship to the picked world by itself (the pulse drive is engaged and dropped by it). */
    autopilot: boolean;
    /** What the autopilot is doing, for the HUD, while it flies. */
    autopilotStatus: { phase: string; remaining: number; name: string } | null;
    /** The torch (on foot) or the ship's lamps: on, and whether the player chose that (T) or it came on by itself at dusk. */
    torch: { on: boolean; manual: boolean };
    /** A full-screen panel (the system map) is open: the world waits. */
    menuOpen: boolean;
    /** The infrared imager (I): a gas giant shown by the heat coming up through its clouds. */
    infrared: boolean;
    /** The weather where the player is (weather.ts), and the rock shelters by the landing site (Shelters.tsx). */
    weather: WeatherState;
    shelters: Shelter[];
    /**
     * Run before every render with the position (scene units) of the camera
     * doing it: the player's, or a cube camera photographing the sky for the
     * wormhole. Shaders that depend on where they are seen from set their
     * camera uniforms here, so the photographs show them correctly too.
     */
    viewers: Set<(eye: THREE.Vector3) => void>;
    /**
     * The player was moved at a stroke (through a wormhole, or put somewhere).
     * `count` goes up each time; `carry` moves a world point along with the
     * player when the move was a crossing, or is null when it was a jump that
     * leaves things behind. Trails and other remembered positions follow it.
     */
    moved: { count: number; carry: ((point: THREE.Vector3) => void) | null };
    /**
     * The player's own state (ship, explorer, chase camera), kept here rather
     * than in the Player component so a change of graphics detail can rebuild
     * the whole scene without moving the player. Null until the Player mounts.
     */
    player: PlayerKeep | null;
    /** The clock, the time warp, and the frame that follows the world the player is at (motion.ts). */
    motion: Motion;
    /**
     * Called the moment the player passes into another world's reach, so the
     * game's frame follows it at once (MotionClock); true if the player was
     * carried into a new frame.
     */
    reanchor: (() => boolean) | null;
    /** ARGO, the ship's computer: the line it is saying and those waiting (argo.ts). */
    argo: ArgoState;
    /** First words with the peoples who can answer (contact.ts). */
    contact: ContactState;
    /** The glyphs learned so far (the saved progress's), for what reads the script. */
    letters: string;
    /** The expedition under way, if one (expeditions.ts). */
    expedition: ExpeditionRun | null;
    /** The last death: where, of what, after how long out, and which death it was (for the card). */
    lastDeath: { world: string; cause: string; survived: number; count: number; at: number } | null;
}

/** Ask for a short sound (audio.ts). */
export const cue = (runtime: ExpeditionRuntime, name: CueName, volume = 1, option = 0) => {
    if (runtime.cues.length < 24) runtime.cues.push({ name, volume, option });
};

/** Register a per-camera update (see ExpeditionRuntime.viewers); returns the unregister function. */
export const watchView = (runtime: ExpeditionRuntime, update: (eye: THREE.Vector3) => void) => {
    runtime.viewers.add(update);
    return () => { runtime.viewers.delete(update); };
};

export interface PlayerKeep {
    ship: ShipState;
    walker: { current: WalkerState | null };
    camera: { current: { quaternion: THREE.Quaternion; offset: THREE.Vector3; fov: number } };
    downFor: { current: number };
    wasLanded: { current: boolean };
    sunPass: { current: number };
}

export const createRuntime = (quality: 0 | 1 | 2, reducedMotion: boolean): ExpeditionRuntime => ({
    features: { volumeClouds: quality === 2, waterSurface: quality > 0, waterDetail: quality > 0, grass: quality, mirror: false },
    origin: new THREE.Vector3(),
    mode: 'ship',
    currentBody: null,
    altitude: Infinity,
    atmosphere: 0,
    daylight: 1,
    sunlight: 1,
    eclipse: { coverage: 0, body: null, ratio: 0 },
    nightEyes: 0,
    nearGround: 0,
    speed: 0,
    pulse: false,
    camera: new THREE.Vector3(),
    heightAt: new Map(),
    reducedMotion,
    quality,
    view: { camera: null },
    hud: { ship: null, walker: null, prompt: '' },
    surface: { crystals: [], target: null, beam: null, mined: new Set(), bursts: [], version: 0, obstacles: [], fixtures: [], shelters: [] },
    inventory: { crystals: 0 },
    supplies: emptySupplies(),
    stats: emptyStats(),
    camp: null,
    forage: { plants: [], picked: new Map(), target: null, version: 0 },
    asteroids: [],
    asteroidTarget: null,
    asteroidField: null,
    heat: 279,
    gas: null,
    cloudCover: null,
    waterSurface: null,
    underwater: 0,
    cues: [],
    shipLaser: false,
    fishing: null,
    fishSpot: null,
    vault: null,
    pickup: null,
    radio: { band: null, reading: null },
    scan: { life: null, progress: 0, found: null, foundAt: 0 },
    lastLanding: null,
    fauna: { target: null, discovered: new Set(), version: 0, animals: [], reach: null, targetPosition: null, zapping: false, danger: 0 },
    sites: { nearest: null, open: null },
    events: { openSite: () => undefined, transit: () => undefined, fall: () => undefined, fallDone: () => undefined, learn: () => undefined },
    actions: { place: () => undefined, arriveAt: () => undefined, craft: () => 'Not ready', switchCrew: () => null, dock: () => 'Not ready' },
    crew: null,
    mothership: null,
    transit: null,
    region: 'sol',
    loading: false,
    colonist: null,
    speech: null,
    fall: createFall(),
    waypoint: null,
    marks: [],
    allMarkers: false,
    shipRecall: null,
    surfaceWaypoint: null,
    impact: null,
    domes: [],
    inDome: false,
    story: { chapter: null, world: null, aims: [] },
    autopilot: false,
    autopilotStatus: null,
    torch: { on: false, manual: false },
    menuOpen: false,
    infrared: false,
    weather: createWeather(),
    shelters: [],
    viewers: new Set(),
    moved: { count: 0, carry: null },
    player: null,
    motion: createMotion(),
    reanchor: null,
    argo: createArgo(),
    contact: createContact(),
    letters: '',
    expedition: null,
    lastDeath: null,
});

export const detectQuality = (): 0 | 1 | 2 => {
    if (typeof window === 'undefined') return 2;
    const cores = navigator.hardwareConcurrency || 8;
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    // The chip the browser actually draws with comes first: a software
    // renderer can only manage the least, a laptop's built-in chip the middle.
    const kind = gpuInfo().kind;
    if (kind === 'software') return 0;
    if (small || cores <= 4) return 0;
    if (kind === 'integrated') return 1;
    if (kind === 'discrete') return window.innerWidth < 900 ? 1 : 2;
    if (window.innerWidth < 1200 || cores <= 6) return 1;
    return 2;
};
