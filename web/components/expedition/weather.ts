import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { fromEquatorial } from './orbits';

/**
 * Weather on the worlds with ground, as it is there, and what it asks of the
 * explorer. Nothing here runs on a timetable: the wind wanders, gusts come
 * and go, and storms are cells that form somewhere upwind at random, at a
 * random size and strength, and drift with the wind. One may come straight
 * over, clip the edge, or pass by on the horizon with its lightning in view.
 * The ship's computer forecasts from where the cell actually is.
 *
 * - Earth: thunderstorm cells; a severe one can drop a tornado at its
 *   leading edge. Gust fronts run out ahead of them.
 * - Mars: dust storms, fronts many kilometres across; dust devils on calm
 *   afternoons. Wind in air a hundredth as thick as Earth's cannot knock
 *   anyone over, but the dust closes the view and hides the way back.
 * - Worlds with no air to speak of, and Mars: solar particle storms, on a
 *   random clock: a flare's protons arrive within the hour; out in the open
 *   the dose climbs. Rock overhead or the ship's hull stops most of it.
 * - Titan: methane drizzle out of slow cells, in a breeze of a metre a second.
 * - Venus: a walking-pace wind in air 65 times as dense as Earth's: it
 *   pushes like a fresh breeze on Earth, slow and relentless.
 *
 * The wind pushes as dynamic pressure does (windForce): half the air's
 * density times the speed squared, on the area of a person or a ship.
 * Times are compressed, like everything in the game: a storm takes minutes.
 */
export type WeatherKind = 'thunderstorm' | 'dust' | 'radiation' | 'drizzle';

export type WeatherPhase = 'calm' | 'warning' | 'storm' | 'passing';

/** A storm cell drifting over the ground (planet-local positions, metres). */
export interface StormCell {
    kind: WeatherKind;
    /** Centre, from the world's centre, on its surface. */
    at: THREE.Vector3;
    /** Drift along the ground, m/s. */
    velocity: THREE.Vector3;
    /** Its half-length along its drift; across it, `stretch` times that (a dust front is a long arc). */
    radius: number;
    stretch: number;
    /** 0.5 a small storm, to 1 a severe one. */
    severity: number;
    age: number;
    life: number;
    /** The explorer has been inside it (it counts as weathered once it has gone). */
    reached: boolean;
}

export interface WeatherState {
    /** The world the weather is on (null away from any). */
    body: ExpeditionBody | null;
    kind: WeatherKind | null;
    phase: WeatherPhase;
    /** Seconds to the next change the explorer cares about (arrival, clearing), and the span it counts down from. */
    left: number;
    length: number;
    /** 0.5 (a small storm) to 1 (a severe one). */
    severity: number;
    /** 0 to 1: how much of the storm is here now (gusting, so it wavers). */
    strength: number;
    /** 0 to 1: how sheltered the explorer is (1 aboard the ship or under rock). */
    shelter: number;
    /** Lightning: the flash now (0 to 1.5), and the last stroke to ground. */
    flash: number;
    strike: null | { at: THREE.Vector3; age: number; distance: number; id: number };
    /** Seconds to the next stroke. */
    nextStrike: number;
    /** Radiation: dose this storm (1 kills), and the rate now (per second). */
    dose: number;
    rate: number;
    /** Storms survived (for the story): counted when one passes with the explorer alive. */
    weathered: number;
    /** Which kind comes next on a world with more than one. */
    turn: number;
    /**
     * A tornado on the ground (Earth, out of a severe thunderstorm cell): where it
     * is (world position), where it is heading, how far it is from the
     * explorer and which way, how old, and how strong (0 to 1).
     */
    tornado: null | { at: THREE.Vector3; heading: THREE.Vector3; distance: number; bearing: string; age: number; life: number; strength: number };
    /** A tornado has come down out of this cell already. */
    touchedDown: boolean;

    /** The storm cell nearest the explorer, if one is about. */
    cell: StormCell | null;
    /** What the cell will do: come over, pass by to one side, or leave. */
    forecast: { hit: boolean; distance: number; miss: number; compass: string; speed: number };
    /** The wind at the explorer: world vector (m/s, along the ground), its speed, and the gust part. */
    wind: THREE.Vector3;
    windSpeed: number;
    gust: number;
    /** The steady wind's direction (radians from east towards north) and speed, wandering. */
    heading: number;
    steady: number;
    /** Seconds until the next storm forms (a random clock), and until the next proton storm. */
    nextCell: number;
    nextFlare: number;
    /** A proton storm (it has no cell: nothing shows in the sky). */
    flare: null | { phase: 'warning' | 'storm' | 'passing'; left: number; length: number; severity: number; storm: number };
    /** The air's density at the ground (kg/m³) on this world. */
    density: number;
    clock: number;
    /** Where the explorer was at the last step (planet-local). */
    here: THREE.Vector3;
}

/** What a world's weather is made of. */
interface Climate {
    /** Air at the ground, kg/m³ (Earth 1.225). */
    density: number;
    /** The steady wind, m/s: typical speed and how far it wanders. */
    wind: number;
    spread: number;
    /** Gusts, as a share of the wind. */
    gust: number;
    /** Storm cells: kind, mean seconds between them, radius (m), drift speed (m/s), how far upwind they form. */
    cell?: { kind: WeatherKind; every: number; radius: [number, number]; speed: [number, number]; upwind: [number, number] };
    /** Proton storms: mean seconds between them. */
    flares?: number;
}

const CLIMATES: Record<string, Climate> = {
    // Earth (North Texas): a breeze, and thunderstorm cells off the plains.
    projects: { density: 1.225, wind: 5, spread: 2.5, gust: 0.35, cell: { kind: 'thunderstorm', every: 560, radius: [1800, 3600], speed: [8, 14], upwind: [6000, 9000] } },
    haven: { density: 1.1, wind: 3, spread: 2, gust: 0.25 },
    // Mars: steady winds, dust storm fronts, and flares through thin air.
    skills: { density: 0.02, wind: 7, spread: 4, gust: 0.5, cell: { kind: 'dust', every: 720, radius: [1600, 3200], speed: [10, 18], upwind: [4200, 6500] }, flares: 1500 },
    // Titan: barely a breeze, slow cells of methane drizzle.
    titan: { density: 5.4, wind: 0.6, spread: 0.4, gust: 0.3, cell: { kind: 'drizzle', every: 480, radius: [1200, 2600], speed: [4, 7], upwind: [2600, 4200] } },
    // Venus: no weather overhead to speak of, but the air is so thick that its slow wind leans on you.
    experience: { density: 65, wind: 0.9, spread: 0.35, gust: 0.25 },
};
/** Worlds without air (the Moon, Mercury, the icy moons...): only flares. */
const AIRLESS: Climate = { density: 0, wind: 0, spread: 0, gust: 0, flares: 1200 };

export const climateOfBody = (body: ExpeditionBody | null): Climate | null => {
    if (!body || body.kind !== 'rocky' || !body.biome) return null;
    return CLIMATES[body.id] ?? AIRLESS;
};

/** What weather a world gets. */
export const climateOf = (body: ExpeditionBody | null): WeatherKind[] => {
    const climate = climateOfBody(body);
    if (!climate) return [];
    const kinds: WeatherKind[] = [];
    if (climate.cell) kinds.push(climate.cell.kind);
    if (climate.flares) kinds.push('radiation');
    return kinds;
};

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);
/** Seconds to the next event of a random (Poisson) clock with this mean. */
const waitFor = (mean: number) => -Math.log(1 - Math.random() * 0.999) * mean;
const gaussian = () => {
    const u = 1 - Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
};
/** Smooth 1D noise in time, -1 to 1 (value noise, smoothstep-blended). */
const hash1 = (n: number) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
};
const noise1 = (t: number) => {
    const i = Math.floor(t);
    const f = t - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i) * (1 - u) + hash1(i + 1) * u;
};

export const createWeather = (): WeatherState => ({
    body: null,
    kind: null,
    phase: 'calm',
    left: 0,
    length: 0,
    severity: 0,
    strength: 0,
    shelter: 0,
    flash: 0,
    strike: null,
    nextStrike: 0,
    dose: 0,
    rate: 0,
    weathered: 0,
    turn: 0,
    tornado: null,
    touchedDown: false,
    cell: null,
    forecast: { hit: false, distance: 0, miss: 0, compass: '', speed: 0 },
    wind: new THREE.Vector3(),
    windSpeed: 0,
    gust: 0,
    heading: 0,
    steady: 0,
    nextCell: 0,
    nextFlare: 0,
    flare: null,
    density: 0,
    clock: 0,
    here: new THREE.Vector3(),
});

/** Start afresh on arriving at a world (or leaving one): a calm of random length, a wind from a random quarter. */
export const settleWeather = (weather: WeatherState, body: ExpeditionBody | null) => {
    const climate = climateOfBody(body);
    weather.body = body;
    weather.kind = null;
    weather.phase = 'calm';
    weather.left = 0;
    weather.length = 0;
    weather.strength = 0;
    weather.flash = 0;
    weather.strike = null;
    weather.dose = 0;
    weather.rate = 0;
    weather.tornado = null;
    weather.touchedDown = false;
    weather.cell = null;
    weather.flare = null;
    weather.density = climate?.density ?? 0;
    weather.heading = Math.random() * Math.PI * 2;
    weather.steady = climate ? Math.max(0, climate.wind + gaussian() * climate.spread * 0.5) : 0;
    weather.wind.set(0, 0, 0);
    weather.windSpeed = 0;
    weather.gust = 0;
    // The first storm forms a little sooner than the rest, so a visit sees one more often than not.
    weather.nextCell = climate?.cell ? 60 + waitFor(climate.cell.every * 0.45) : Infinity;
    weather.nextFlare = climate?.flares ? 90 + waitFor(climate.flares) : Infinity;
};

const north = new THREE.Vector3();
const east = new THREE.Vector3();
const northOf = new THREE.Vector3();
const local = new THREE.Vector3();
const rel = new THREE.Vector3();
const tmp = new THREE.Vector3();
const poles = new Map<string, THREE.Vector3>();

/** The world's north (its globe's pole where it has one) and east at a point (planet-local, unit). */
const frameAt = (body: ExpeditionBody, at: THREE.Vector3) => {
    let pole = poles.get(body.id);
    if (!pole) {
        pole = body.globe ? fromEquatorial(body.globe.pole[0], body.globe.pole[1]) : body.gas ? fromEquatorial(body.gas.pole[0], body.gas.pole[1]) : new THREE.Vector3(0, 1, 0);
        poles.set(body.id, pole);
    }
    local.copy(at).normalize();
    east.crossVectors(pole, local);
    if (east.lengthSq() < 1e-8) east.set(1, 0, 0).addScaledVector(local, -local.x);
    east.normalize();
    north.crossVectors(local, east);
};

const COMPASS = ['east', 'north-east', 'north', 'north-west', 'west', 'south-west', 'south', 'south-east'];
/** Which way a direction (along the ground at the explorer) points, in words. */
const compassOf = (direction: THREE.Vector3) => {
    const a = Math.atan2(direction.dot(north), direction.dot(east));
    return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
};

/** A cell's strength over its life: building, mature, dying away (0 to 1). */
export const cellLife = (cell: StormCell) =>
    THREE.MathUtils.smoothstep(cell.age, 0, cell.life * 0.12) * (1 - THREE.MathUtils.smoothstep(cell.age, cell.life * 0.8, cell.life));

const drift = new THREE.Vector3();
const toward = new THREE.Vector3();
/**
 * Where `here` is from a cell, along the ground: `out` is the direction away
 * from the cell at `here` (tangent) times the distance round the curve, and
 * `velocity` the cell's drift carried over to `here`. Returns the distance.
 */
export const cellOffset = (body: ExpeditionBody, here: THREE.Vector3, cell: StormCell, out: THREE.Vector3, velocity: THREE.Vector3) => {
    local.copy(here).normalize();
    toward.copy(cell.at).normalize();
    const cos = THREE.MathUtils.clamp(local.dot(toward), -1, 1);
    const distance = Math.acos(cos) * body.radius;
    // Away from the cell, along the ground at here.
    out.copy(local).multiplyScalar(cos).sub(toward);
    if (out.lengthSq() < 1e-12) out.copy(east);
    out.normalize().multiplyScalar(distance);
    // The drift, turned into the ground plane at here (the cell is near enough for that to hold).
    const speed = cell.velocity.length();
    velocity.copy(cell.velocity).addScaledVector(local, -cell.velocity.dot(local));
    if (velocity.lengthSq() > 1e-12) velocity.setLength(speed);
    return distance;
};

const axis = new THREE.Vector3();
/**
 * The point `metres` round the curve from `from` (planet-local) heading along
 * `direction` (tangent there), on the ground; `carry` (a tangent vector at
 * `from`) is turned with it, so it stays the same heading over the ground.
 */
const overGround = (from: THREE.Vector3, direction: THREE.Vector3, metres: number, radius: number, out = new THREE.Vector3(), carry?: THREE.Vector3) => {
    const start = local.copy(from).normalize();
    axis.crossVectors(start, direction);
    if (axis.lengthSq() < 1e-12) return out.copy(start).multiplyScalar(radius);
    axis.normalize();
    carry?.applyAxisAngle(axis, metres / radius);
    return out.copy(start).applyAxisAngle(axis, metres / radius).multiplyScalar(radius);
};

/** How far a cell reaches towards here (its edge, on the line from its centre): `away` points from it to here. */
export const cellReach = (cell: StormCell, away: THREE.Vector3, velocity: THREE.Vector3) => {
    const a2 = away.lengthSq();
    const v2 = velocity.lengthSq();
    if (a2 < 1e-6 || v2 < 1e-12) return cell.radius;
    const c2 = away.dot(velocity) ** 2 / (a2 * v2);
    return cell.radius / Math.sqrt(c2 + (1 - c2) / (cell.stretch * cell.stretch));
};

/** Form a storm cell upwind, at random: whether it comes over is left to the wind. */
const formCell = (weather: WeatherState, body: ExpeditionBody, here: THREE.Vector3, kind?: WeatherKind, severity?: number) => {
    const climate = climateOfBody(body);
    const spec = climate?.cell;
    if (!spec) return false;
    frameAt(body, here);
    // The steering wind, and the cell's own drift a little off it.
    const steer = weather.heading + gaussian() * 0.25;
    const along = new THREE.Vector3().copy(east).multiplyScalar(Math.cos(steer)).addScaledVector(north, Math.sin(steer));
    const radius = between(spec.radius);
    const distance = between(spec.upwind);
    // Upwind, offset to one side: about half the cells come over, the rest pass by.
    const side = (Math.random() * 2 - 1) * radius * 1.9;
    const across = new THREE.Vector3().crossVectors(local, along);
    const speed = between(spec.speed);
    const velocity = along.clone().multiplyScalar(speed);
    const at = overGround(here, along, -distance, body.radius, new THREE.Vector3(), velocity);
    overGround(at, across, side, body.radius, at, velocity);
    weather.cell = {
        kind: kind ?? spec.kind,
        at,
        velocity,
        radius,
        // A dust storm comes as a long front; a thunderstorm cell is roughly round.
        stretch: (kind ?? spec.kind) === 'dust' ? 1.6 + Math.random() * 0.8 : 1 + Math.random() * 0.3,
        // Most storms are ordinary; one in three or so is severe.
        severity: severity ?? (Math.random() < 0.33 ? 0.82 + Math.random() * 0.18 : 0.5 + Math.random() * 0.25),
        age: 0,
        life: (distance + radius * 2.5) / speed + 60 + Math.random() * 120,
        reached: false,
    };
    weather.touchedDown = false;
    weather.turn += 1;
    return true;
};

/**
 * The wind in words for the HUD: its speed, and the quarter it blows from
 * (or, carried by a giant's jet, the way it carries you). `at` is planet-local.
 */
export const windWords = (body: ExpeditionBody, at: THREE.Vector3, wind: THREE.Vector3, jet = false) => {
    const speed = wind.length();
    if (speed < 0.5) return null;
    frameAt(body, at);
    const fast = speed >= 40;
    const amount = fast ? `${Math.round(speed * 3.6).toLocaleString('en-US')} km/h` : `${speed < 10 ? speed.toFixed(1) : Math.round(speed)} m/s`;
    if (jet) return `Jet stream ${amount} · carrying you ${compassOf(tmp.copy(wind).normalize())}`;
    return `Wind ${amount} from the ${compassOf(tmp.copy(wind).negate().normalize())}`;
};

/**
 * Bring a storm in now (a test hook, and for storms the story calls): a cell
 * straight upwind, its front 2.5 km off, or a flare. With `arrive` (seconds)
 * the cell drifts at whatever pace brings its front here then.
 */
export const forceWeather = (weather: WeatherState, kind?: WeatherKind, severity?: number, here?: THREE.Vector3, arrive?: number) => {
    const gap = 2500;
    const body = weather.body;
    const kinds = climateOf(body);
    if (!body || !kinds.length) return false;
    const want = kind && kinds.includes(kind) ? kind : kinds[weather.turn % kinds.length];
    if (want === 'radiation') {
        startFlare(weather, severity);
        weather.turn += 1;
        return true;
    }
    const at = (here ?? weather.here).clone();
    if (at.lengthSq() < 1) return false;
    if (!formCell(weather, body, at, want, severity)) return false;
    // Forced: aimed straight over, nearer.
    const cell = weather.cell!;
    frameAt(body, at);
    // Its drift as it would be here, then back upwind from here with it.
    const speed = arrive ? THREE.MathUtils.clamp(gap / arrive, 2, 18) : cell.velocity.length();
    local.copy(at).normalize();
    cell.velocity.addScaledVector(local, -cell.velocity.dot(local)).setLength(speed);
    const along = tmp.copy(cell.velocity).normalize();
    overGround(at, along, -(cell.radius + gap), body.radius, cell.at, cell.velocity);
    // Long enough to get here from there, and to pass.
    cell.life = Math.max(cell.life, (gap + cell.radius * 2.5) / Math.max(speed, 0.5) + 120);
    return true;
};

const startFlare = (weather: WeatherState, severity?: number) => {
    // Most flares are moderate; the X-class ones that matter are rarer.
    const s = severity ?? Math.min(1, 0.5 + 0.5 * Math.random() ** 2.2);
    const lead = 60 + Math.random() * 120;
    weather.flare = { phase: 'warning', left: lead, length: lead, severity: s, storm: 70 + Math.random() * 170 };
    weather.dose = 0;
};

/**
 * Whether a storm can drop a tornado now: a severe Earth thunderstorm cell,
 * mature. North Texas is at the south end of Tornado Alley; spring is the
 * main season, but a second runs through October and November (an EF3
 * crossed north Dallas on 20 October 2019).
 */
export const tornadoDue = (weather: WeatherState) => {
    const cell = weather.cell;
    return weather.body?.id === 'projects'
        && !!cell && cell.kind === 'thunderstorm'
        && cell.severity > 0.8
        && !weather.touchedDown
        && cell.age > cell.life * 0.2 && cell.age < cell.life * 0.75;
};

/** Where a cell's tornado comes down: on its leading flank, and how it moves (planet-local). */
export const tornadoSpot = (weather: WeatherState, out: THREE.Vector3, heading: THREE.Vector3) => {
    const cell = weather.cell!;
    const along = tmp.copy(cell.velocity).normalize();
    const across = rel.crossVectors(local.copy(cell.at).normalize(), along);
    out.copy(cell.at).addScaledVector(along, cell.radius * (0.25 + 0.3 * Math.random())).addScaledVector(across, (Math.random() - 0.5) * cell.radius * 0.6);
    heading.copy(along).applyAxisAngle(local, (Math.random() - 0.5) * 0.5);
    return cell.velocity.length() * (0.9 + 0.5 * Math.random());
};

/** What a tornado does to someone in the open at this distance (health lost per second). */
export const tornadoHarm = (distance: number, strength: number) => {
    if (distance > 90) return 0;
    if (distance < 25) return 0.9 * strength;
    return 0.3 * strength * (1 - (distance - 25) / 65);
};

export const TORNADO_FACT = 'A column of air spinning with winds that can pass 300 km/h, hanging from the base of a supercell thunderstorm to the ground. North Texas is at the south end of Tornado Alley: most come in spring, but a second season runs through October and November. On the night of 20 October 2019 an EF3 tornado tore 25 km across north Dallas. Shelter is something solid overhead; nobody outruns one on foot.';

/**
 * The push of the wind on something: half the air's density times the
 * relative speed squared, times its drag area (m², drag coefficient
 * included), as an acceleration for its mass. Written into `out`.
 */
export const windForce = (weather: WeatherState, velocity: THREE.Vector3, area: number, mass: number, out: THREE.Vector3) => {
    out.copy(weather.wind).sub(velocity);
    const speed = out.length();
    if (weather.density <= 0 || speed < 1e-3) return out.set(0, 0, 0);
    return out.multiplyScalar(0.5 * weather.density * speed * area / mass);
};

/**
 * One step of the weather at `here` (the explorer's or the ship's position
 * from the world's centre). Returns what happened this step for the caller
 * to act on: a stroke of lightning (and where, planet-local), a phase begun.
 */
export const stepWeather = (weather: WeatherState, dt: number, exposed: boolean, here?: THREE.Vector3) => {
    const events: { began: WeatherPhase | null; stroke: boolean; strokeAt: THREE.Vector3 | null } = { began: null, stroke: false, strokeAt: null };
    const body = weather.body;
    const climate = climateOfBody(body);
    if (!body || !climate || !here) {
        weather.strength = 0;
        weather.flash = 0;
        weather.wind.set(0, 0, 0);
        weather.windSpeed = 0;
        return events;
    }
    weather.clock += dt;
    weather.here.copy(here);
    const t = weather.clock;
    frameAt(body, here);

    // The steady wind wanders, slowly, in direction and speed.
    if (climate.wind > 0) {
        weather.heading += gaussian() * 0.04 * Math.sqrt(dt) + Math.sin(t * 0.013) * 0.002 * dt;
        weather.steady += (climate.wind - weather.steady) * 0.01 * dt + gaussian() * climate.spread * 0.06 * Math.sqrt(dt);
        weather.steady = Math.max(0, weather.steady);
    }

    // The storm cell: form one on a random clock, move it, and see where it is from here.
    const phaseBefore = weather.phase;
    if (!weather.cell && climate.cell) {
        weather.nextCell -= dt;
        if (weather.nextCell <= 0) {
            formCell(weather, body, here);
            weather.nextCell = waitFor(climate.cell.every);
        }
    }
    let cellPhase: WeatherPhase = 'calm';
    let cellStrength = 0;
    const cell = weather.cell;
    if (cell) {
        cell.age += dt;
        cell.at.addScaledVector(cell.velocity, dt);
        // Keep it on the ground, and its drift along it.
        local.copy(cell.at).normalize();
        cell.at.copy(local).multiplyScalar(body.radius);
        cell.velocity.addScaledVector(local, -cell.velocity.dot(local));
        const life = cellLife(cell);
        frameAt(body, here);
        // Where the cell is from here, measured along the ground (these worlds
        // are small: a storm a few kilometres off is a good way round the curve).
        const distance = cellOffset(body, here, cell, rel, drift);
        const speed = drift.length();
        // Positive while it comes this way.
        const closing = speed > 0 ? rel.dot(drift) / Math.max(distance, 1) : 0;
        // Closest it will come: the explorer's distance from its track.
        const miss = speed > 0 ? tmp.crossVectors(rel, drift).length() / speed : distance;
        // Its edge on the line to here, and its half-width across its track.
        const reach = cellReach(cell, rel, drift);
        const wide = cell.radius * cell.stretch;
        const hit = miss < wide * 0.95;
        weather.forecast.hit = hit;
        weather.forecast.distance = Math.max(0, distance - reach);
        weather.forecast.miss = Math.max(0, miss - wide);
        weather.forecast.speed = speed;
        weather.forecast.compass = compassOf(tmp.copy(rel).negate().normalize());
        // How much of it is here: deep inside a cell is the worst of it.
        const inside = 1 - THREE.MathUtils.smoothstep(distance, reach * 0.55, reach * 1.15);
        cellStrength = inside * (0.4 + 0.6 * life);
        if (inside > 0.02) cell.reached = true;
        if (distance < reach * 1.05) {
            cellPhase = closing > 0 || distance < reach * 0.6 ? 'storm' : 'passing';
            weather.left = Math.min((cell.radius * 2) / Math.max(speed, 0.5), closing < 0 ? Math.max(0, (reach * 1.05 - distance) / Math.max(-closing, 0.5)) : (cell.radius * 2 * Math.sqrt(Math.max(0, 1 - (miss / wide) ** 2))) / Math.max(speed, 0.5));
            weather.length = (2 * cell.radius) / Math.max(speed, 0.5);
        } else if (closing > 0) {
            // On its way: a warning once it is a few minutes off (or a note that it will pass by).
            const eta = (distance - reach) / Math.max(closing, 0.5);
            if (eta < 240 || distance < reach * 2.2) {
                cellPhase = 'warning';
                weather.left = eta;
            }
        } else if (cell.reached && distance < reach * 1.6) {
            cellPhase = 'passing';
            weather.left = Math.min((cell.radius * 1.2) / Math.max(speed, 0.5), (reach * 1.6 - distance) / Math.max(-closing, 0.5));
            weather.length = (cell.radius * 0.55) / Math.max(speed, 0.5);
        }
        // Gone: past its life, or far behind.
        if (cell.age > cell.life || (closing < 0 && distance > reach * 3)) {
            if (cell.reached) weather.weathered += 1;
            weather.cell = null;
            weather.touchedDown = false;
        }
    }

    // A proton storm: a random clock, no cell.
    let flareStrength = 0;
    if (climate.flares) {
        if (!weather.flare) {
            weather.nextFlare -= dt;
            if (weather.nextFlare <= 0) {
                startFlare(weather);
                weather.nextFlare = waitFor(climate.flares);
            }
        }
        const flare = weather.flare;
        if (flare) {
            flare.left -= dt;
            if (flare.left <= 0) {
                if (flare.phase === 'warning') { flare.phase = 'storm'; flare.left = flare.storm; flare.length = flare.storm; }
                else if (flare.phase === 'storm') { flare.phase = 'passing'; flare.left = 20 + Math.random() * 20; flare.length = flare.left; }
                else { weather.flare = null; weather.weathered += 1; }
            }
            if (weather.flare) {
                const f = weather.flare;
                const done = 1 - f.left / Math.max(f.length, 1e-3);
                flareStrength = f.phase === 'storm' ? Math.min(1, done * 6) * (0.8 + 0.2 * noise1(t * 0.3)) : f.phase === 'passing' ? 1 - done : 0;
            }
        }
    }

    // Which storm the explorer hears about: a flare outranks weather overhead (it can kill).
    const flare = weather.flare;
    if (flare && (flare.phase !== 'warning' || cellPhase === 'calm')) {
        weather.kind = 'radiation';
        weather.phase = flare.phase;
        weather.left = flare.left;
        weather.length = flare.length;
        weather.severity = flare.severity;
    } else if (weather.cell && cellPhase !== 'calm') {
        weather.kind = weather.cell.kind;
        weather.phase = cellPhase;
        weather.severity = weather.cell.severity;
    } else {
        weather.kind = null;
        weather.phase = 'calm';
    }
    if (weather.phase !== phaseBefore) {
        events.began = weather.phase;
        weather.length = weather.left;
    }

    // How strong it is here now: storms gust and waver, they do not ramp.
    const gustNoise = noise1(t * 0.43) * 0.6 + noise1(t * 0.137 + 17) * 0.4;
    const target = weather.kind === 'radiation' ? flareStrength
        : weather.cell ? THREE.MathUtils.clamp(cellStrength * (0.85 + 0.25 * gustNoise), 0, 1)
        : 0;
    weather.strength += (target - weather.strength) * Math.min(1, dt * 1.2);
    const storm = weather.cell && weather.kind !== 'radiation' ? weather.strength : 0;

    // The wind here: the steady wind, gusts on three time scales, and a storm's outflow on top.
    const gusts = noise1(t * 0.47) * 0.5 + noise1(t * 0.13 + 5.1) * 0.35 + noise1(t * 1.9 + 9.7) * 0.15;
    weather.gust = climate.gust * gusts;
    tmp.copy(east).multiplyScalar(Math.cos(weather.heading)).addScaledVector(north, Math.sin(weather.heading));
    weather.wind.copy(tmp).multiplyScalar(weather.steady * (1 + weather.gust));
    if (weather.cell && storm > 0) {
        // Gusts out of a thunderstorm's downdraft (or a dust front's leading
        // edge) blow outward from it, strongest near its edge.
        cellOffset(body, here, weather.cell, rel, drift);
        if (rel.lengthSq() > 1) rel.normalize();
        const outflow = weather.cell.kind === 'thunderstorm' ? 14 : weather.cell.kind === 'dust' ? 16 : 1.2;
        weather.wind.addScaledVector(rel, outflow * weather.cell.severity * storm * (1 + 0.6 * gusts));
        // And along with the storm's own drift.
        weather.wind.addScaledVector(drift, 0.5 * storm);
    }
    weather.windSpeed = weather.wind.length();

    // Lightning: strokes come out of the cell, oftener the stronger it is, wherever in it they fall.
    weather.flash = Math.max(0, weather.flash - dt * 7);
    if (weather.strike) weather.strike.age += dt;
    const lightning = weather.cell?.kind === 'thunderstorm' ? weather.cell : null;
    if (lightning) {
        const activity = THREE.MathUtils.smoothstep(lightning.age, 0, lightning.life * 0.15) * (1 - THREE.MathUtils.smoothstep(lightning.age, lightning.life * 0.85, lightning.life));
        weather.nextStrike -= dt * activity * (0.4 + lightning.severity);
        if (weather.nextStrike <= 0) {
            weather.nextStrike = 2 + Math.random() * 7;
            // Somewhere under the cell; now and then, out in the open in a
            // severe storm, right by the explorer.
            const nearby = exposed && storm > 0.4 && Math.random() < 0.1 * lightning.severity * storm;
            const out = new THREE.Vector3();
            if (nearby) {
                frameAt(body, here);
                const r = Math.random() < 0.3 * lightning.severity ? Math.random() * 2 : 4 + Math.random() * 50;
                const a = Math.random() * Math.PI * 2;
                out.copy(here).addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r);
            } else {
                frameAt(body, lightning.at);
                const r = lightning.radius * Math.sqrt(Math.random()) * 0.85;
                const a = Math.random() * Math.PI * 2;
                out.copy(lightning.at).addScaledVector(east, Math.cos(a) * r).addScaledVector(north, Math.sin(a) * r);
            }
            events.stroke = true;
            events.strokeAt = out;
            frameAt(body, here);
        }
    }

    // Radiation: the dose climbs while out in the open.
    weather.rate = weather.kind === 'radiation' ? weather.strength * weather.severity * 0.0075 : 0;
    if (exposed) weather.dose += weather.rate * dt;
    if (weather.kind !== 'radiation' && !weather.flare && weather.phase === 'calm') weather.dose = Math.max(0, weather.dose - dt * 0.0005);
    return events;
};

/** What a stroke at this distance does to someone out in the open (health lost). */
export const strokeHarm = (distance: number, severity: number) => {
    if (distance < 3) return 0.78 * severity + 0.18;
    if (distance < 60) return 0.28 * (1 - distance / 60) * severity;
    return 0;
};

const km = (metres: number) => metres >= 1000 ? `${(metres / 1000).toFixed(metres < 10000 ? 1 : 0)} km` : `${Math.max(50, Math.round(metres / 50) * 50)} m`;

/** The ship's computer's words for the forecast, the storm, and the clear. */
export const weatherMessage = (weather: WeatherState) => {
    const severe = weather.severity > 0.8;
    const time = Math.max(0, Math.ceil(weather.left));
    const clock = `${Math.floor(time / 60)}:${String(time % 60).padStart(2, '0')}`;
    const f = weather.forecast;
    const wind = Math.round(weather.windSpeed);
    switch (weather.kind) {
        case 'thunderstorm':
            if (weather.tornado) {
                const where = weather.tornado.distance >= 1000 ? `${(weather.tornado.distance / 1000).toFixed(1)} km` : `${Math.round(weather.tornado.distance / 10) * 10} m`;
                return {
                    title: `Tornado warning · on the ground ${where} ${weather.tornado.bearing}`,
                    body: weather.shelter > 0.5 ? 'You are in shelter. Stay there until it has passed.' : 'A tornado has touched down. Get aboard the ship or into the rock shelter now and stay there. Nobody outruns one on foot.',
                };
            }
            if (weather.phase === 'warning') {
                return f.hit
                    ? { title: `${severe ? 'Severe thunderstorm' : 'Thunderstorm'} · lightning in ${clock}`, body: `A cell ${km(f.distance)} to the ${f.compass}, moving this way at ${Math.round(f.speed * 3.6)} km/h. Out in the open a strike can kill: get aboard the ship, or into the rock shelter, before it arrives.` }
                    : { title: `${severe ? 'Severe thunderstorm' : 'Thunderstorm'} ${km(f.distance)} to the ${f.compass}`, body: `On its track it passes about ${km(f.miss)} from here. Lightning can still reach 15 km from a storm: keep an eye on it.` };
            }
            return weather.phase === 'storm'
                ? { title: `${severe ? 'Severe thunderstorm' : 'Thunderstorm'} overhead · wind ${wind} m/s`, body: weather.shelter > 0.5 ? `You are in shelter. It should clear in about ${clock}.` : 'You are in the open. Get aboard the ship, or into the rock shelter.' }
                : { title: 'The storm is passing', body: 'Lightning can still strike from its trailing edge. Give it a minute.' };
        case 'dust':
            if (weather.phase === 'warning') {
                return f.hit
                    ? { title: `Dust storm front · arrives in ${clock}`, body: `A wall of dust ${km(f.distance)} to the ${f.compass}, coming on at ${Math.round(f.speed * 3.6)} km/h. This air is too thin to knock you over, but the dust will close the view to a few hundred metres. Note the way back to the ship.` }
                    : { title: `Dust storm ${km(f.distance)} to the ${f.compass}`, body: `It should pass about ${km(f.miss)} from here.` };
            }
            return weather.phase === 'storm'
                ? { title: `Dust storm · wind ${wind} m/s`, body: 'Visibility a few hundred metres and falling. The ship\'s beacon still shows the way back.' }
                : { title: 'The dust is settling', body: 'Visibility is coming back.' };
        case 'radiation':
            return weather.phase === 'warning'
                ? { title: `Solar flare · protons in ${clock}`, body: `${severe ? 'A big flare: X-class.' : 'A flare on the Sun.'} There is no air here to stop its particles. Get aboard the ship or under rock before they arrive, and stay until they pass.` }
                : weather.phase === 'storm'
                    ? { title: `Proton storm · ${clock}`, body: weather.shelter > 0.5 ? 'Shielded. The dose has stopped climbing.' : 'Out in the open the dose is climbing. Get under rock or aboard the ship.' }
                    : { title: 'The proton storm is easing', body: 'Nearly clear.' };
        case 'drizzle':
            return weather.phase === 'warning' && !f.hit
                ? { title: `Methane showers ${km(f.distance)} to the ${f.compass}`, body: 'Drops a centimetre across, falling at a walking pace in this thick air. Harmless.' }
                : { title: 'Methane drizzle', body: 'Drops a centimetre across, falling at a walking pace in this thick air. Harmless.' };
        default:
            return null;
    }
};

/**
 * Weather as every surface shader sees it (shared like the torch's
 * uniforms): how stormy and how dusty the sky is, and the lightning flash.
 */
export const WEATHER_UNIFORMS = {
    storm: { value: 0 },
    dust: { value: 0 },
    flash: { value: 0 },
};
