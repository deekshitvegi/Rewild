import * as THREE from 'three';
import { AU, findBody, formatDistance, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { gasModel, pressureAt } from './gasAtmosphere';
import { SUN } from './hazards';
import { HISTORIC_SITES, siteFrame } from './history';
import { directionToBody, fromStart, orientationOf, startOf, universeDirection } from './motion';
import { fromEquatorial } from './orbits';
import { ringName } from './rings';
import type { ExpeditionRuntime } from './runtime';
import type { Medal } from './survival';
import { forget } from './argo';
import { IO_PLUME_HEIGHT, ventUp } from './Volcano';
import { vortexRelative, vorticesOf } from './vortices';
import { forceWeather } from './weather';
import { DEBRIS, debrisOffset, findFrame, storyFind } from './story';
import { PLUME_TOP, geyserVents } from './EnceladusGeysers';
import { umbraPoint } from './eclipse';

/**
 * Expeditions, in the spirit of the Chase videos: a goal past the point
 * where it is safe, real numbers all the way, gear with a limit, and the
 * choice of how far to push before turning back. Each is begun from the log
 * (J); ARGO reads the way; a death or a lost ship ends the attempt, and the
 * attempts are counted.
 *
 * Medals: bronze for coming back at all, silver and gold for going further
 * (deeper, longer, with more to spare).
 */
export interface ExpeditionRun {
    id: string;
    stage: number;
    /** The best measure so far (bar reached, seconds held, cooling left...). */
    best: number;
    /** A clock the expedition keeps (seconds). */
    timer: number;
    /** Deaths counted when it began, so a death during it ends it. */
    deathsAtStart: number;
}

export interface ExpeditionRecord {
    attempts: number;
    /** Best medal, and the best measure on a finished run. */
    medal: Medal | null;
    best: number;
}

interface Context {
    runtime: ExpeditionRuntime;
    dt: number;
    say: (text: string, tone?: 'info' | 'warn' | 'danger', key?: string) => void;
}

type Outcome = null | { result: 'done'; medal: Medal; summary: string } | { result: 'failed'; summary: string };

export interface ExpeditionDef {
    id: string;
    world: string;
    title: string;
    /** The briefing, with the real numbers. */
    brief: string;
    /** What earns each medal. */
    medals: [string, string, string];
    reward: number;
    step: (run: ExpeditionRun, ctx: Context) => Outcome;
    /** What to do now, and the live numbers, for the HUD. */
    status: (run: ExpeditionRun, runtime: ExpeditionRuntime) => { stage: string; detail: string };
    /** Where to go now, marked on screen while the expedition runs (game frame). */
    target?: (run: ExpeditionRun, runtime: ExpeditionRuntime) => { name: string; position: THREE.Vector3 } | null;
}

const medalBy = (value: number, silver: number, gold: number): Medal => (value >= gold ? 'gold' : value >= silver ? 'silver' : 'bronze');

const shipLost = (runtime: ExpeditionRuntime) => !!runtime.player?.ship.destroyed;
const died = (run: ExpeditionRun, runtime: ExpeditionRuntime) => (runtime.stats.deaths ?? 0) > run.deathsAtStart;

/** The pressure outside the ship, if it is inside this giant. */
const pressureIn = (runtime: ExpeditionRuntime, id: string) => {
    const gas = runtime.gas;
    if (!gas || gas.body.id !== id) return null;
    return pressureAt(gasModel(gas.body), gas.height);
};

const bar = (p: number) => (p < 10 ? p.toFixed(1) : Math.round(p).toString());

/** Pressure at the top of Jupiter's water clouds, as the game's atmosphere has them. */
const waterTop = () => {
    const model = gasModel(findBody(JUPITER) as ExpeditionBody);
    const deck = model.decks.find((d) => d.name === 'Water clouds');
    return deck ? pressureAt(model, deck.top) : 5;
};

// ---- Jupiter: the metallic sea ----------------------------------------------------------------
const JUPITER = 'research';
const jupiter: ExpeditionDef = {
    id: 'jupiter-deep',
    world: JUPITER,
    title: 'The metallic sea',
    brief: 'Galileo\'s probe fell into Jupiter in 1995 and stopped transmitting at 23 bar. Under the clouds the pressure climbs without end: ammonia ice at the top, then ammonium hydrosulphide, then water clouds full of lightning, and far below them hydrogen squeezed into a metal. Your hull is rated to 30 bar. Dive as deep as you dare, then climb back above the clouds alive.',
    medals: ['Reach the water clouds and climb out', 'Reach 15 bar and climb out', 'Reach 25 bar, deeper than Galileo, and climb out'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: `The hull gave way at ${bar(run.best)} bar.` };
        const p = pressureIn(runtime, JUPITER);
        if (run.stage === 0) {
            if (p !== null) {
                run.stage = 1;
                say('Entering Jupiter. Hull rated to 30 bar. Galileo\'s probe lasted to 23.', 'info');
            }
            return null;
        }
        if (p !== null) run.best = Math.max(run.best, p);
        // The water clouds: lightning in every one, and the deepest deck.
        if (run.stage === 1 && (runtime.gas?.deck === 'Water clouds' || run.best >= waterTop())) {
            run.stage = 2;
            say(`Water clouds, ${bar(run.best)} bar. Climb out now for bronze; silver at 15 bar, gold at 25.`, 'info');
        }
        if (run.stage === 2 && (p === null || p < 1)) {
            return { result: 'done', medal: medalBy(run.best, 15, 25), summary: `Down to ${bar(run.best)} bar and back above the clouds.` };
        }
        return null;
    },
    status: (run, runtime) => {
        const p = pressureIn(runtime, JUPITER);
        const shield = Math.round((runtime.player?.ship.shield ?? 1) * 100);
        const now = p === null ? 'outside' : `${bar(p)} bar now`;
        if (run.stage === 0) return { stage: 'Fly into Jupiter\'s clouds', detail: 'Set the course on the map (M) and dive in' };
        if (run.stage === 1) return { stage: `Dive to the water clouds, ${bar(waterTop())} bar`, detail: `Deepest ${bar(run.best)} bar · ${now} · shield ${shield}%` };
        return { stage: 'Deeper for a better medal, then climb above 1 bar', detail: `Deepest ${bar(run.best)} bar · ${now} · shield ${shield}%` };
    },
};

// ---- Venus: 127 minutes -------------------------------------------------------------------------
const VENUS = 'experience';
const venera = HISTORIC_SITES.find((s) => s.id === 'venera13')!;
const landerAt = (runtime: ExpeditionRuntime, out: THREE.Vector3) => {
    const body = findBody(VENUS) as ExpeditionBody;
    return fromStart(runtime.motion, body, siteFrame(venera).centre, out);
};
const lander = new THREE.Vector3();
const venus: ExpeditionDef = {
    id: 'venus-venera',
    world: VENUS,
    title: '127 minutes',
    brief: 'On 1 March 1982 the Soviet lander Venera 13 set down on Venus and worked for 127 minutes in 457 °C and 89 times Earth\'s air pressure before the heat won. Your suit\'s cooling lasts about three minutes on that ground. Land near the lander, walk to it, and get back aboard before the cooling runs out.',
    medals: ['Reach the lander and get back aboard', 'With a quarter of the cooling left', 'With half of it left'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'The heat got through the suit.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const onVenus = runtime.currentBody?.id === VENUS;
        landerAt(runtime, lander);
        if (run.stage === 0) {
            if (onVenus && ship?.landed && ship.position.distanceTo(lander) < 2000) {
                run.stage = 1;
                say(`Landed ${Math.round(ship.position.distanceTo(lander))} m from Venera 13. 464 °C outside. Your cooling lasts about three minutes.`, 'warn');
            }
            return null;
        }
        if (run.stage === 1 && walker && walker.position.distanceTo(lander) < 9) {
            run.stage = 2;
            run.best = walker.cooling;
            say(`Venera 13. It sent back the first colour pictures of Venus\'s surface. Cooling at ${Math.round(walker.cooling * 100)}%. Back to the ship.`, 'info');
        }
        // The cooling left is read on foot: aboard, the ship starts topping it up at once.
        if (run.stage === 2 && walker) run.best = walker.cooling;
        if (run.stage === 2 && runtime.mode === 'ship') {
            const cooling = run.best;
            return { result: 'done', medal: medalBy(cooling, 0.25, 0.5), summary: `There and back with ${Math.round(cooling * 100)}% of the cooling left.` };
        }
        return null;
    },
    status: (run, runtime) => {
        landerAt(runtime, lander);
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const ship = runtime.player?.ship;
        const cooling = walker ? `cooling ${Math.round(walker.cooling * 100)}%` : 'aboard';
        if (run.stage === 0) return { stage: 'Land within 2 km of Venera 13', detail: ship && runtime.currentBody?.id === VENUS ? `${(ship.position.distanceTo(lander) / 1000).toFixed(1)} km to the lander (gold marker)` : 'Set the course for Venus on the map (M)' };
        if (run.stage === 1) return { stage: 'Walk to the lander', detail: walker ? `${Math.round(walker.position.distanceTo(lander))} m · ${cooling}` : 'Step outside (E)' };
        return { stage: 'Back aboard before the cooling runs out', detail: walker && ship ? `${Math.round(walker.position.distanceTo(ship.position))} m to the ship · ${cooling}` : cooling };
    },
    target: (run, runtime) => (run.stage < 2 && runtime.currentBody?.id === VENUS ? { name: 'Venera 13', position: landerAt(runtime, lander) } : null),
};

// ---- Saturn: the Cassini Division -------------------------------------------------------------------
const SATURN = 'beyond';
const local = new THREE.Vector3();
let saturnAxis: THREE.Vector3 | null = null;
/** Where the ship is against Saturn's rings: radius in Saturn radii, height off the ring plane. */
const ringPlace = (runtime: ExpeditionRuntime) => {
    const ship = runtime.player?.ship;
    const saturn = findBody(SATURN) as ExpeditionBody;
    if (!ship || !saturn.gas) return null;
    saturnAxis ??= fromEquatorial(saturn.gas.pole[0], saturn.gas.pole[1]);
    directionToBody(runtime.motion, saturn, local.copy(ship.position).sub(saturn.position), local);
    const up = local.dot(saturnAxis);
    const r = Math.sqrt(Math.max(0, local.lengthSq() - up * up)) / saturn.radius;
    return { r, up };
};
const PLANE = 400;
const saturn: ExpeditionDef = {
    id: 'saturn-cassini',
    world: SATURN,
    title: 'The Cassini Division',
    brief: 'Between Saturn\'s A and B rings lies a gap 4,700 km wide, the Cassini Division, swept clear by the pull of the moon Mimas. It is not quite empty: thin ringlets of ice drift in it, and on either side the rings are a field of ice blocks up to the size of a house, moving at orbital speed. Fly into the ring plane inside the gap and hold your course along it.',
    medals: ['Hold the gap for 30 seconds', 'For a minute', 'For two minutes'],
    reward: 25,
    step: (run, { runtime, dt, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: run.timer > 0 ? `The ice got the ship ${Math.round(run.timer)} s into the gap.` : 'The ship was lost.' };
        const place = ringPlace(runtime);
        const inside = !!place && ringName(place.r) === 'Cassini Division' && Math.abs(place.up) < PLANE;
        if (run.stage === 0) {
            if (inside) {
                run.stage = 1;
                run.timer = 0;
                say('In the Cassini Division, in the ring plane. Hold your course along the gap.', 'info');
            }
            return null;
        }
        if (inside) {
            run.timer += dt;
            run.best = Math.max(run.best, run.timer);
            if (run.timer >= 120) return { result: 'done', medal: 'gold', summary: 'Two minutes along the Cassini Division.' };
            return null;
        }
        // Out of the gap: a finished run if it was held long enough, else round again.
        if (run.timer >= 30) return { result: 'done', medal: medalBy(run.timer, 60, 120), summary: `${Math.round(run.timer)} seconds along the Cassini Division.` };
        say(`Out of the gap after ${Math.round(run.timer)} seconds. Back into it to try again.`, 'warn');
        run.stage = 0;
        run.timer = 0;
        return null;
    },
    status: (run, runtime) => {
        const place = ringPlace(runtime);
        const where = place ? `${place.r.toFixed(3)} Saturn radii · ${Math.round(Math.abs(place.up))} u off the plane` : '';
        if (run.stage === 0) return { stage: 'Fly into the gap between the A and B rings (1.95 to 2.02 Saturn radii), in the ring plane', detail: where };
        return { stage: 'Hold your course along the gap', detail: `${Math.round(run.timer)} s · ${where}` };
    },
};


// ---- The Sun: closer than Parker ------------------------------------------------------------------
const AU_KM = 149597870.7;
/** Distance from the Sun's centre, in AU. */
const sunAU = (runtime: ExpeditionRuntime) => {
    const ship = runtime.player?.ship;
    return ship ? ship.position.distanceTo(SUN.position) / AU : Infinity;
};
const millionKm = (au: number) => `${(au * AU_KM / 1e6).toFixed(au * AU_KM < 1e7 ? 1 : 0)} million km`;
const HELIOS = 0.29; // Helios 2, April 1976: 43.4 million km from the centre
const PARKER = 0.0459; // Parker Solar Probe, 24 December 2024: 6.1 million km above the surface
const SCORCH = 0.0334; // 5 million km: the hull past 1,500 K
const sun: ExpeditionDef = {
    id: 'sun-parker',
    world: SUN.id,
    title: 'Closer than Parker',
    brief: 'On 24 December 2024 the Parker Solar Probe passed 6.1 million km above the Sun\'s surface at 692,000 km/h, behind a carbon-foam shield: the closest and fastest anything made by people has been. For forty years before it the record belonged to Helios 2, which reached 43 million km in 1976. Your hull is rated to 1,600 K. Dive at the Sun as close as you dare, then climb back out.',
    medals: ['Closer than Helios 2, 43 million km, and back out', 'Closer than Parker, 6.9 million km from the centre', 'Within 5 million km, the hull past 1,500 K'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: run.best ? `The hull failed ${millionKm(run.best)} from the Sun.` : 'The ship was lost.' };
        const d = sunAU(runtime);
        if (d === Infinity) return null;
        if (!run.best || d < run.best) run.best = d;
        if (run.stage === 0 && d < HELIOS) {
            run.stage = 1;
            say(`Closer than Helios 2. ${millionKm(d)} from the centre of the Sun. Hull ${Math.round(runtime.player!.ship.temperature)} K.`, 'info');
        }
        if (run.stage >= 1) {
            if (d < PARKER) say(`Parker's record: closer than any probe has been. Hull ${Math.round(runtime.player!.ship.temperature)} K, rated to 1,600. Turn back now and the shield holds.`, 'warn', 'sun-parker');
            if (d < SCORCH) say('Five million kilometres. Past this the shield burns.', 'danger', 'sun-scorch');
            // Out again past Helios 2's distance: the attempt counts.
            if (d > HELIOS * 1.05) {
                const medal: Medal = run.best < SCORCH ? 'gold' : run.best < PARKER ? 'silver' : 'bronze';
                return { result: 'done', medal, summary: `${millionKm(run.best)} from the Sun's centre and back out.` };
            }
        }
        return null;
    },
    status: (run, runtime) => {
        const d = sunAU(runtime);
        const hull = Math.round(runtime.player?.ship.temperature ?? 0);
        const here = d === Infinity ? '' : `${millionKm(d)} · hull ${hull} K`;
        if (run.stage === 0) return { stage: 'Dive at the Sun: closer than 43 million km', detail: here };
        return { stage: 'Closer for a better medal, then back out past 45 million km', detail: `Closest ${millionKm(run.best)} · now ${here}` };
    },
};

// ---- The Moon: August 1972 --------------------------------------------------------------------------
const MOON = 'moon';
const apollo = HISTORIC_SITES.find((s) => s.id === 'apollo11')!;
const base = new THREE.Vector3();
const baseAt = (runtime: ExpeditionRuntime) => fromStart(runtime.motion, findBody(MOON) as ExpeditionBody, siteFrame(apollo).centre, base);
const moon: ExpeditionDef = {
    id: 'moon-1972',
    world: MOON,
    title: 'August 1972',
    brief: 'In August 1972, between the Apollo 16 and 17 missions, the Sun threw out one of the fiercest proton storms on record. Had a crew been out on the Moon in their suits, NASA later estimated, the dose could have killed them; inside the spacecraft they would have taken a small fraction of it. Land near Tranquility Base, where Apollo 11 came down, and walk to it. Then the Sun flares. The protons take a minute or two to arrive: get aboard or under rock and sit the storm out.',
    medals: ['Sit the storm out with the dose under the lethal level', 'With under a third of it', 'In shelter before the protons arrive: almost no dose'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'The dose was lethal.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const weather = runtime.weather;
        const onMoon = runtime.currentBody?.id === MOON;
        baseAt(runtime);
        if (run.stage === 0) {
            if (onMoon && ship?.landed && ship.position.distanceTo(base) < 1500) {
                run.stage = 1;
                say(`Landed ${Math.round(ship.position.distanceTo(base))} m from Tranquility Base. Walk to the descent stage.`, 'info');
            }
            return null;
        }
        if (run.stage === 1) {
            if (walker && walker.position.distanceTo(base) < 20 && weather.body?.id === MOON && forceWeather(weather, 'radiation', 1)) {
                run.stage = 2;
                const lead = Math.round(weather.flare?.left ?? 90);
                say(`Flare on the Sun: X-class. Protons arrive in about ${lead} seconds. Your suit stops almost none of them. Get aboard or under rock.`, 'danger');
            }
            return null;
        }
        // The storm: the dose taken outside, until it has passed (or the ship has left the Moon with you aboard).
        run.best = Math.max(run.best, weather.dose);
        if (run.stage === 2 && weather.flare?.phase === 'storm') {
            run.stage = 3;
            say(weather.shelter > 0.5 ? 'Protons arriving. You are shielded. Stay put.' : 'Protons arriving. You are in the open.', weather.shelter > 0.5 ? 'info' : 'danger');
        }
        if (!weather.flare || weather.body?.id !== MOON) {
            const dose = run.best;
            const medal: Medal = dose < 0.05 ? 'gold' : dose < 0.33 ? 'silver' : 'bronze';
            return { result: 'done', medal, summary: `The proton storm has passed. You took ${Math.round(dose * 100)}% of a lethal dose.` };
        }
        return null;
    },
    status: (run, runtime) => {
        baseAt(runtime);
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const weather = runtime.weather;
        if (run.stage === 0) return { stage: 'Land within 1.5 km of Tranquility Base', detail: ship && runtime.currentBody?.id === MOON ? `${(ship.position.distanceTo(base) / 1000).toFixed(1)} km to the site (gold marker)` : 'Set the course for the Moon on the map (M)' };
        if (run.stage === 1) return { stage: 'Walk to the Apollo 11 descent stage', detail: walker ? `${Math.round(walker.position.distanceTo(base))} m` : 'Step outside (E)' };
        const left = Math.max(0, Math.ceil(weather.flare?.left ?? 0));
        const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        const dose = `dose ${Math.round(run.best * 100)}% of lethal`;
        if (run.stage === 2) return { stage: 'Get aboard or under rock before the protons arrive', detail: `${clock} · ${dose}` };
        return { stage: 'Sit the proton storm out', detail: `${clock} left · ${dose}${weather.shelter > 0.5 ? ' · shielded' : ''}` };
    },
    target: (run, runtime) => (run.stage < 2 && runtime.currentBody?.id === MOON ? { name: 'Tranquility Base', position: baseAt(runtime) } : null),
};

// ---- Mars: before the storm ---------------------------------------------------------------------------
const MARS = 'skills';
const forks = HISTORIC_SITES.find((s) => s.id === 'three-forks')!;
const depot = new THREE.Vector3();
const depotAt = (runtime: ExpeditionRuntime) => fromStart(runtime.motion, findBody(MARS) as ExpeditionBody, siteFrame(forks).centre, depot);
const clockOf = (seconds: number) => {
    const t = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
/** Seconds until a storm front coming straight this way arrives (null when none is). */
const frontETA = (runtime: ExpeditionRuntime) => {
    const weather = runtime.weather;
    if (!weather.cell || weather.cell.kind !== 'dust' || !weather.forecast.hit || weather.phase === 'storm' || weather.phase === 'passing') return null;
    // Once the ship's computer is counting down, the same count; before that, an estimate from the front's drift.
    if (weather.phase === 'warning' && weather.kind === 'dust') return weather.left;
    return weather.forecast.distance / Math.max(weather.forecast.speed, 0.5);
};
const mars: ExpeditionDef = {
    id: 'mars-depot',
    world: MARS,
    title: 'Before the storm',
    brief: 'At Three Forks in Jezero crater, Perseverance set ten sealed tubes of Mars down on the ground for a later mission to bring home. A dust storm front is building to the west. Land near the depot, walk in among the tubes, take what you can (E), and be back aboard before the front arrives. The air here is too thin for the wind to knock you over, but the dust closes the view to a few hundred metres and falling. In 2018 a storm like this blotted out the Sun over the rover Opportunity, and it never woke again.',
    medals: ['Back aboard before the front arrives', 'With a minute to spare', 'With two minutes to spare'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'Killed out at the depot.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const weather = runtime.weather;
        depotAt(runtime);
        if (run.stage === 0) {
            // The front comes on at a pace that leaves time to walk there and back
            // (6.2 m/s on foot) with a little over three minutes to spare.
            const walk = ship ? ship.position.distanceTo(depot) : 0;
            if (runtime.currentBody?.id === MARS && ship?.landed && walk < 1500 && weather.body?.id === MARS && forceWeather(weather, 'dust', 0.95, undefined, (walk * 2) / 6.2 + 200)) {
                run.stage = 1;
                say(`Landed ${Math.round(ship.position.distanceTo(depot))} m from the depot. A dust front is coming in from the west. Move.`, 'warn');
            }
            return null;
        }
        const eta = frontETA(runtime);
        if (eta !== null) run.timer = eta;
        if (run.stage === 1 && eta !== null) say(`Dust front to the west: it arrives in ${clockOf(eta)}.`, 'warn', 'mars-front');
        if (run.stage === 1 && walker && walker.position.distanceTo(depot) < 14) {
            run.stage = 2;
            say(`At the depot. Front in ${clockOf(run.timer)}. Take what you can, then back to the ship.`, 'info');
        }
        // The front arrives: aboard by then, or the attempt is lost.
        if (weather.kind === 'dust' && weather.phase === 'storm' && runtime.mode === 'walk') {
            return { result: 'failed', summary: run.stage === 2 ? 'The front reached you on the way back. In the dust the ship was a shadow you had to walk to by its beacon.' : 'The front arrived before you reached the depot.' };
        }
        if (run.stage === 2 && runtime.mode === 'ship') {
            const spare = eta ?? 0;
            run.best = spare;
            const tubes = runtime.stats.visited.filter((v) => v.startsWith('tube-')).length;
            return { result: 'done', medal: medalBy(spare, 60, 120), summary: `Aboard with ${clockOf(spare)} to spare. Tubes aboard: ${tubes} of 10.` };
        }
        // The front came and went (or broke up) without a run at the depot: start over.
        if (run.stage === 1 && run.timer > 0 && !weather.cell && runtime.mode === 'ship') {
            run.stage = 0;
            run.timer = 0;
            forget(runtime.argo, 'mars-front');
        }
        return null;
    },
    status: (run, runtime) => {
        depotAt(runtime);
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const eta = frontETA(runtime);
        const front = eta !== null ? `front in ${clockOf(eta)}` : runtime.weather.kind === 'dust' && runtime.weather.phase === 'storm' ? 'the front is here' : '';
        if (run.stage === 0) return { stage: 'Land within 1.5 km of Three Forks, in Jezero crater', detail: ship && runtime.currentBody?.id === MARS ? `${(ship.position.distanceTo(depot) / 1000).toFixed(1)} km to the depot (gold marker)` : 'Set the course for Mars on the map (M)' };
        if (run.stage === 1) return { stage: 'Walk to the depot', detail: [walker ? `${Math.round(walker.position.distanceTo(depot))} m` : 'Step outside (E)', front].filter(Boolean).join(' · ') };
        return { stage: 'Back aboard before the front', detail: [walker && ship ? `${Math.round(walker.position.distanceTo(ship.position))} m to the ship` : '', front].filter(Boolean).join(' · ') };
    },
    target: (run, runtime) => (run.stage < 2 && runtime.currentBody?.id === MARS ? { name: 'Three Forks', position: depotAt(runtime) } : null),
};

// ---- Io: snow from a volcano ----------------------------------------------------------------------------
const IO = 'io';
const vent = new THREE.Vector3();
const ventAxis = new THREE.Vector3();
const offset = new THREE.Vector3();
/** The vent, and the way up from it, in the game's frame now. */
const ventAt = (runtime: ExpeditionRuntime) => {
    const io = findBody(IO) as ExpeditionBody;
    const up = ventUp(io);
    const start = startOf(io).clone().addScaledVector(up, io.radius + groundHeight(io, up));
    fromStart(runtime.motion, io, start, vent);
    ventAxis.copy(vent).sub(io.position).normalize();
    return io;
};
/** The ship's place against the plume: height over the vent, and distance from its axis. */
const plumePlace = (runtime: ExpeditionRuntime) => {
    const ship = runtime.player?.ship;
    if (!ship) return null;
    ventAt(runtime);
    offset.copy(ship.position).sub(vent);
    const height = offset.dot(ventAxis);
    const across = Math.sqrt(Math.max(0, offset.lengthSq() - height * height));
    return { height, across };
};
const io: ExpeditionDef = {
    id: 'io-plume',
    world: IO,
    title: 'Snow from a volcano',
    brief: 'On 6 August 2001 the Galileo probe swept 194 km over Io\'s north pole, through the edge of a volcanic plume, and caught flakes of sulphur dioxide snow, each a clump of 15 to 20 molecules, minutes after they had left the vent. Fly through the plume\'s umbrella, then land near the vent and walk up to it. Io lies deep in Jupiter\'s radiation belts: keep it short.',
    medals: ['Fly through the umbrella', 'Then land within 400 m of the vent', 'Then walk to within 60 m of it and get back aboard'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'Killed out on Io.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        if (runtime.currentBody?.id !== IO) return null;
        const ship = runtime.player!.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const place = plumePlace(runtime);
        if (!place) return null;
        // Stage 0: into the umbrella, where the grains slow at the top of their arcs.
        if (run.stage === 0) {
            if (runtime.mode === 'ship' && place.height > IO_PLUME_HEIGHT * 0.45 && place.height < IO_PLUME_HEIGHT * 1.15 && place.across < IO_PLUME_HEIGHT * 1.3) {
                run.stage = 1;
                run.best = 1;
                say('Inside the plume. Sulphur dioxide snow on the canopy, minutes out of the vent. Galileo caught the same.', 'info');
            }
            return null;
        }
        // Stage 1: down beside the vent (best 2), then on foot to it (best 3).
        if (ship.landed && ship.position.distanceTo(vent) < 400 && run.best < 2) {
            run.best = 2;
            say(`Down ${Math.round(ship.position.distanceTo(vent))} m from the vent. The ground here is sulphur, and warm.`, 'info');
        }
        if (walker && walker.position.distanceTo(vent) < 60 && run.best < 3) {
            run.best = 3;
            say('At the vent. Gas and grains rising faster than a rifle bullet. Back aboard.', 'warn');
        }
        if (run.best >= 3 && runtime.mode === 'ship') return { result: 'done', medal: 'gold', summary: 'Through the plume, down beside the vent, and on foot to it.' };
        // Flying away again: what was done counts.
        if (runtime.mode === 'ship' && !ship.landed && runtime.altitude > 1500) {
            return { result: 'done', medal: run.best >= 2 ? 'silver' : 'bronze', summary: run.best >= 2 ? 'Through the plume and down beside its vent.' : 'Through the volcano\'s plume.' };
        }
        return null;
    },
    status: (run, runtime) => {
        const place = runtime.currentBody?.id === IO ? plumePlace(runtime) : null;
        if (!place) return { stage: 'Fly to Io', detail: 'Set the course for Io on the map (M)' };
        const ship = runtime.player!.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const toVent = walker ? walker.position.distanceTo(vent) : ship.position.distanceTo(vent);
        if (run.stage === 0) return { stage: 'Fly into the umbrella at the top of the plume', detail: `${Math.round(place.height)} u over the vent · ${Math.round(place.across)} u off its axis` };
        if (run.best < 2) return { stage: 'Land within 400 m of the vent', detail: `${Math.round(toVent)} m to the vent` };
        if (run.best < 3) return { stage: 'Walk to within 60 m of the vent', detail: walker ? `${Math.round(toVent)} m` : 'Step outside (E)' };
        return { stage: 'Back aboard', detail: walker ? `${Math.round(walker.position.distanceTo(ship.position))} m to the ship` : '' };
    },
    target: (run, runtime) => {
        if (runtime.currentBody?.id !== IO || run.best >= 3) return null;
        ventAt(runtime);
        if (run.stage === 0) return { name: 'The plume\'s umbrella', position: vent.clone().addScaledVector(ventAxis, IO_PLUME_HEIGHT * 0.8) };
        return { name: 'The vent', position: vent.clone() };
    },
};

// ---- Neptune: under the dark spot -------------------------------------------------------------------------
const NEPTUNE = 'certifications';
const spotLocal = new THREE.Vector3();
/** How far inside Neptune's dark spot the ship is (under 1: inside), if it is in Neptune. */
const inSpot = (runtime: ExpeditionRuntime) => {
    const gas = runtime.gas;
    const ship = runtime.player?.ship;
    if (!gas || gas.body.id !== NEPTUNE || !ship) return Infinity;
    const spot = vorticesOf(gas.body).find((v) => v.sight === 'neptune-spot');
    if (!spot) return Infinity;
    directionToBody(runtime.motion, gas.body, spotLocal.copy(ship.position).sub(gas.body.position), spotLocal);
    return vortexRelative(gas.body, spot, spotLocal);
};
const deckPressure = (name: string, fallback: number) => {
    const model = gasModel(findBody(NEPTUNE) as ExpeditionBody);
    const deck = model.decks.find((d) => d.name === name);
    return deck ? pressureAt(model, deck.top) : fallback;
};
const neptune: ExpeditionDef = {
    id: 'neptune-spot',
    world: NEPTUNE,
    title: 'Under the dark spot',
    brief: 'In 1989 Voyager 2 found a storm the size of Earth in Neptune\'s clouds, the Great Dark Spot, with white methane clouds hanging at its edge; five years later Hubble looked and it was gone. Dark spots have come and gone since. Around them blow the fastest winds in the Solar System, up to 2,000 km/h. Find the dark spot, dive through it to the clouds beneath, and climb out. No probe has ever entered Neptune.',
    medals: ['Down through the spot to the hydrogen sulphide clouds and out', 'To 10 bar inside the spot and out', 'To the water clouds under the spot and out'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: `The hull gave way at ${bar(run.best)} bar.` };
        const p = pressureIn(runtime, NEPTUNE);
        const rel = inSpot(runtime);
        if (run.stage === 0) {
            if (p !== null && rel < 1) {
                run.stage = 1;
                say('Inside the dark spot. The wind turns round it at over a thousand kilometres an hour. Dive.', 'info');
            }
            return null;
        }
        if (p !== null && rel < 1.15) run.best = Math.max(run.best, p);
        const sulphide = deckPressure('Hydrogen sulphide ice clouds', 4);
        if (run.stage === 1 && run.best >= sulphide) {
            run.stage = 2;
            say(`Hydrogen sulphide clouds under the spot, ${bar(run.best)} bar. Climb out now for bronze; silver at 10 bar, gold in the water clouds.`, 'info');
        }
        if (run.stage === 2 && (p === null || p < 1)) {
            const water = deckPressure('Ammonium hydrosulphide and water clouds', 13.6);
            const medal: Medal = run.best >= water ? 'gold' : run.best >= 10 ? 'silver' : 'bronze';
            return { result: 'done', medal, summary: `Down to ${bar(run.best)} bar under the dark spot and back out.` };
        }
        return null;
    },
    status: (run, runtime) => {
        const p = pressureIn(runtime, NEPTUNE);
        const rel = inSpot(runtime);
        const now = p === null ? 'outside' : `${bar(p)} bar now`;
        const where = rel < 1 ? 'in the spot' : rel < 3 ? 'near the spot' : 'away from the spot';
        if (run.stage === 0) return { stage: 'Find Neptune\'s dark spot and fly down into it', detail: p === null ? 'Set the course for Neptune on the map (M); the spot is marked' : `${now} · ${where}` };
        if (run.stage === 1) return { stage: `Dive to the hydrogen sulphide clouds, ${bar(deckPressure('Hydrogen sulphide ice clouds', 4))} bar`, detail: `Deepest ${bar(run.best)} bar in the spot · ${now} · ${where}` };
        return { stage: 'Deeper for a better medal, then climb above 1 bar', detail: `Deepest ${bar(run.best)} bar in the spot · ${now} · ${where}` };
    },
    target: (run, runtime) => {
        const neptune = findBody(NEPTUNE) as ExpeditionBody;
        if (run.stage > 0 || (runtime.currentBody?.id !== NEPTUNE && runtime.gas?.body.id !== NEPTUNE)) return null;
        const spot = vorticesOf(neptune).find((v) => v.sight === 'neptune-spot');
        if (!spot) return null;
        const at = spotLocal.copy(spot.dir).applyQuaternion(orientationOf(runtime.motion, neptune)).multiplyScalar(neptune.radius).add(neptune.position);
        return { name: 'The dark spot', position: at.clone() };
    },
};

// ---- The trail: where the Makers' stones are (story.ts) ---------------------------------------------
const findAt = (runtime: ExpeditionRuntime, id: string, out: THREE.Vector3) => {
    const find = storyFind(id)!;
    return fromStart(runtime.motion, findBody(find.body) as ExpeditionBody, findFrame(find).centre, out);
};
const mmss = (seconds: number) => {
    const t = Math.max(0, Math.round(seconds));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

// ---- Phobos: the monolith ----------------------------------------------------------------------------
const PHOBOS = 'phobos';
const monolith = new THREE.Vector3();
const phobos: ExpeditionDef = {
    id: 'phobos-monolith',
    world: PHOBOS,
    title: 'The monolith on Phobos',
    brief: 'Phobos is a lump of rock 27 km long that goes round Mars every 7 hours 39 minutes, 6,000 km up, and is falling 1.8 m closer every century. In 1998 Mars Global Surveyor photographed a boulder on it perhaps 85 m across, standing up out of the dust and casting a long shadow; in 2009 Buzz Aldrin said someone should go and look at it. Its gravity is a two-thousandth of Earth\'s: a jump takes minutes to come down, and spiked boots are the only way to walk. Land near it, walk to it, and get back aboard.',
    medals: ['Touch the monolith and get back aboard', 'In under four minutes from landing', 'In under two and a half'],
    reward: 25,
    step: (run, { runtime, dt, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'Lost on Phobos.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        findAt(runtime, 'trail-phobos', monolith);
        if (run.stage === 0) {
            if (runtime.currentBody?.id === PHOBOS && ship?.landed && ship.position.distanceTo(monolith) < 700) {
                run.stage = 1;
                run.timer = 0;
                say(`Landed ${Math.round(ship.position.distanceTo(monolith))} m from the monolith. Gravity 0.0057 m/s². Walk, do not jump: a jump here lasts minutes.`, 'info');
            }
            return null;
        }
        run.timer += dt;
        if (run.stage === 1 && walker && walker.position.distanceTo(monolith) < 26) {
            run.stage = 2;
            say(`At the monolith, ${mmss(run.timer)} after landing. There is writing under the dust. Back to the ship.`, 'info');
        }
        if (run.stage === 2 && runtime.mode === 'ship') {
            run.best = run.timer;
            const medal: Medal = run.timer < 150 ? 'gold' : run.timer < 240 ? 'silver' : 'bronze';
            return { result: 'done', medal, summary: `To the monolith and back aboard in ${mmss(run.timer)}.` };
        }
        return null;
    },
    status: (run, runtime) => {
        findAt(runtime, 'trail-phobos', monolith);
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        if (run.stage === 0) return { stage: 'Land within 700 m of the monolith', detail: ship && runtime.currentBody?.id === PHOBOS ? `${Math.round(ship.position.distanceTo(monolith))} m to it (gold marker)` : 'Set the course for Phobos on the map (M)' };
        if (run.stage === 1) return { stage: 'Walk to the monolith', detail: walker ? `${Math.round(walker.position.distanceTo(monolith))} m · ${mmss(run.timer)}` : `Step outside (E) · ${mmss(run.timer)}` };
        return { stage: 'Back aboard', detail: `${walker && ship ? `${Math.round(walker.position.distanceTo(ship.position))} m to the ship · ` : ''}${mmss(run.timer)}` };
    },
    target: (run, runtime) => (run.stage < 2 ? { name: 'The monolith', position: findAt(runtime, 'trail-phobos', monolith).clone() } : null),
};

// ---- Earth orbit: Kessler ------------------------------------------------------------------------------
const cloudCentre = new THREE.Vector3();
const cloudVelocity = new THREE.Vector3();
const cloudOffset = new THREE.Vector3();
const cloudOffsetVelocity = new THREE.Vector3();
const cloudAt = (runtime: ExpeditionRuntime) => {
    debrisOffset(runtime.motion.seconds, cloudOffset, cloudOffsetVelocity);
    universeDirection(runtime.motion, cloudOffset, cloudCentre).add((findBody(DEBRIS.body) as ExpeditionBody).position);
    universeDirection(runtime.motion, cloudOffsetVelocity, cloudVelocity);
    return cloudCentre;
};
const RECOVER = 12;
const kessler: ExpeditionDef = {
    id: 'earth-kessler',
    world: DEBRIS.body,
    title: 'Kessler',
    brief: 'On 10 February 2009 the communications satellite Iridium 33 and the dead Kosmos 2251 met at 11.7 km/s, 789 km over Siberia, and made over two thousand fragments large enough to track. In 1978 Donald Kessler warned that enough collisions would feed on one another until some orbits could not be used for generations. Out among the debris of a collision like it a dead satellite is tumbling, its recorder still aboard. Match its orbit, hold within 30 m of it while the ship\'s arm takes the recorder, and get clear. Everything there moves at 7.5 km/s; only what you hit at a different speed hurts.',
    medals: ['Take the recorder and clear the cloud', 'With half the shield left', 'With nine tenths of it'],
    reward: 30,
    step: (run, { runtime, dt, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: 'The debris got the ship.' };
        const ship = runtime.player?.ship;
        if (!ship || runtime.mode !== 'ship') return null;
        cloudAt(runtime);
        const gap = ship.position.distanceTo(cloudCentre);
        const relative = ship.velocity.clone().sub(cloudVelocity).length();
        if (run.stage === 0) {
            if (gap < 2500) {
                run.stage = 1;
                say(`In the debris cloud. Relative speed ${Math.round(relative)} m/s. Slow to its speed before going in among the fragments.`, 'warn');
            }
            return null;
        }
        if (run.stage === 1) {
            if (gap < 30 && relative < 15) {
                run.timer += dt;
                say('Holding beside the satellite. The arm is out.', 'info', 'kessler-arm');
                if (run.timer >= RECOVER) {
                    run.stage = 2;
                    say(`Recorder aboard. Shield at ${Math.round(ship.shield * 100)}%. Now clear the cloud.`, 'info');
                }
            }
            return null;
        }
        if (run.stage === 2 && gap > 1500) {
            run.best = ship.shield;
            return { result: 'done', medal: medalBy(ship.shield, 0.5, 0.9), summary: `Recorder recovered; clear of the cloud with the shield at ${Math.round(ship.shield * 100)}%.` };
        }
        return null;
    },
    status: (run, runtime) => {
        const ship = runtime.player?.ship;
        cloudAt(runtime);
        const gap = ship ? ship.position.distanceTo(cloudCentre) : Infinity;
        const relative = ship ? ship.velocity.clone().sub(cloudVelocity).length() : 0;
        const shield = `shield ${Math.round((ship?.shield ?? 1) * 100)}%`;
        if (run.stage === 0) return { stage: 'Fly up to the debris cloud in low Earth orbit', detail: ship ? `${gap > 9000 ? `${(gap / 1000).toFixed(1)} km` : `${Math.round(gap)} m`} (gold marker) · ${shield}` : '' };
        if (run.stage === 1) return { stage: 'Hold within 30 m of the satellite, under 15 m/s relative', detail: `${Math.round(gap)} m · ${Math.round(relative)} m/s relative · arm ${Math.round((run.timer / RECOVER) * 100)}% · ${shield}` };
        return { stage: 'Clear the cloud, 1.5 km out', detail: `${Math.round(gap)} m · ${shield}` };
    },
    target: (run, runtime) => (run.stage < 2 ? { name: 'Dead satellite', position: cloudAt(runtime).clone() } : null),
};

// ---- Enceladus: through the plume ---------------------------------------------------------------------
const ENCELADUS = 'enceladus';
const CASSINI_PASS = 186; // Cassini's 49 km over the south pole (28 October 2015), at this Enceladus's scale
const geyserAt = new THREE.Vector3();
const geyserUp = new THREE.Vector3();
const fans = new THREE.Vector3();
/** The ship's height over the vents and its distance from the nearest one's column (game frame). */
const sprayPlace = (runtime: ExpeditionRuntime) => {
    const ship = runtime.player?.ship;
    const body = findBody(ENCELADUS) as ExpeditionBody;
    if (!ship) return null;
    let best: { height: number; across: number } | null = null;
    for (const v of geyserVents()) {
        fromStart(runtime.motion, body, v, geyserAt);
        geyserUp.copy(geyserAt).sub(body.position).normalize();
        const off = ship.position.clone().sub(geyserAt);
        const height = off.dot(geyserUp);
        const across = Math.sqrt(Math.max(0, off.lengthSq() - height * height));
        if (!best || across < best.across) best = { height, across };
    }
    return best;
};
const enceladus: ExpeditionDef = {
    id: 'enceladus-plume',
    world: ENCELADUS,
    title: 'Through the plume',
    brief: 'Near Enceladus\'s south pole four cracks, the tiger stripes, throw the water of a buried ocean into space faster than the moon\'s escape speed. On 28 October 2015 Cassini flew through the spray 49 km above the surface and found molecular hydrogen in it: what microbes on Earth\'s sea floor live on. Fly down through a jet, lower than Cassini went, then land and walk to the frost fans round the vent.',
    medals: ['Through a jet, then to the frost fans', 'Through it lower than Cassini, under 49 km (186 m here)', 'Under 60 m, in the thick of it'],
    reward: 30,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'Lost on Enceladus.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        if (runtime.currentBody?.id !== ENCELADUS) return null;
        const place = sprayPlace(runtime);
        if (!place) return null;
        if (runtime.mode === 'ship' && place.across < 45 && place.height > 8 && place.height < PLUME_TOP * 0.7) {
            const first = run.best === 0;
            run.best = run.best === 0 ? place.height : Math.min(run.best, place.height);
            if (first) say(`In the jet, ${Math.round(place.height)} m over the vent: ice grains and water vapour. Cassini passed at 49 km, ${CASSINI_PASS} m here.`, 'info');
            if (run.stage === 0) run.stage = 1;
        }
        findAt(runtime, 'trail-enceladus', fans);
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        if (run.stage === 1 && walker && walker.position.distanceTo(fans) < 30) {
            const medal: Medal = run.best < 60 ? 'gold' : run.best < CASSINI_PASS ? 'silver' : 'bronze';
            return { result: 'done', medal, summary: `Through the jet ${Math.round(run.best)} m over the vent, and on foot to the frost fans.` };
        }
        return null;
    },
    status: (run, runtime) => {
        const place = runtime.currentBody?.id === ENCELADUS ? sprayPlace(runtime) : null;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        findAt(runtime, 'trail-enceladus', fans);
        const lowest = run.best ? `lowest pass ${Math.round(run.best)} m` : 'not through a jet yet';
        if (!place) return { stage: 'Fly to Enceladus\'s south pole, to the tiger stripes', detail: 'Set the course for Enceladus on the map (M); the vents are marked' };
        if (run.stage === 0) return { stage: 'Fly down through one of the jets', detail: `${Math.round(place.across)} m from a jet · ${Math.round(Math.max(0, place.height))} m up` };
        return { stage: 'Land and walk to the frost fans', detail: `${lowest} · ${walker ? `${Math.round(walker.position.distanceTo(fans))} m to the fans` : 'step outside (E) near them'}` };
    },
    target: (run, runtime) => (runtime.currentBody?.id === ENCELADUS || run.stage === 0 ? { name: 'The tiger stripes', position: findAt(runtime, 'trail-enceladus', fans).clone() } : null),
};

// ---- Iapetus: the seed ship ------------------------------------------------------------------------------
const IAPETUS = 'iapetus';
const seed = new THREE.Vector3();
const iapetus: ExpeditionDef = {
    id: 'iapetus-seed',
    world: IAPETUS,
    title: 'The seed ship',
    brief: 'Iapetus has two faces, one as dark as coal and one as bright as snow, and round its equator a ridge up to 20 km high and 1,300 km long that nobody has explained. Cassini flew past it at 1,227 km on 10 September 2007. In Arthur C. Clarke\'s novel 2001 the Star Gate waited here. The stones of the trail point to the ridge on the dark face. Land beside what lies there, walk to it, and read its log: the more of the Makers\' script you know, the more of it you can read.',
    medals: ['Walk to it and read what you can', 'Knowing 18 of the 26 letters', 'Knowing 24 of them'],
    reward: 40,
    step: (run, { runtime, say }) => {
        if (died(run, runtime)) return { result: 'failed', summary: 'Lost on Iapetus.' };
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        findAt(runtime, 'trail-iapetus', seed);
        if (run.stage === 0) {
            if (runtime.currentBody?.id === IAPETUS && ship?.landed && ship.position.distanceTo(seed) < 1800) {
                run.stage = 1;
                say(`Landed ${Math.round(ship.position.distanceTo(seed))} m from it, on the dark face. The dust here is as dark as coal.`, 'info');
            }
            return null;
        }
        if (run.stage === 1 && walker && walker.position.distanceTo(seed) < 160) {
            const known = runtime.letters.length;
            run.best = known;
            const medal: Medal = known >= 24 ? 'gold' : known >= 18 ? 'silver' : 'bronze';
            return { result: 'done', medal, summary: `At the seed ship, reading its log with ${known} of the 26 letters.` };
        }
        return null;
    },
    status: (run, runtime) => {
        findAt(runtime, 'trail-iapetus', seed);
        const ship = runtime.player?.ship;
        const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;
        const letters = `${runtime.letters.length} of 26 letters known`;
        if (run.stage === 0) return { stage: 'Land within 1.8 km of it, on the ridge', detail: ship && runtime.currentBody?.id === IAPETUS ? `${(ship.position.distanceTo(seed) / 1000).toFixed(1)} km (gold marker) · ${letters}` : `Set the course for Iapetus on the map (M) · ${letters}` };
        return { stage: 'Walk to its hull', detail: walker ? `${Math.max(0, Math.round(walker.position.distanceTo(seed) - 140))} m · ${letters}` : `Step outside (E) · ${letters}` };
    },
    target: (run, runtime) => ({ name: 'The ridge', position: findAt(runtime, 'trail-iapetus', seed).clone() }),
};

// ---- The Moon's shadow: totality ---------------------------------------------------------------------
const MOON_ID = 'moon';
/** Totality on 8 April 2024 in Dallas, where Earth's map is centred (seconds). */
const DALLAS_2024 = 231;
/** The longest a total eclipse can last anywhere on Earth (seconds). */
const LONGEST = 452;
const shadowSpot = new THREE.Vector3();
/** Most of the way down the Moon's umbra: the Moon there is just larger than the Sun, so the prominences show at its edge. */
const shadowAt = (runtime: ExpeditionRuntime) => umbraPoint(findBody(MOON_ID) as ExpeditionBody, 0.94, shadowSpot);
const inTotality = (runtime: ExpeditionRuntime) => runtime.eclipse.body?.id === MOON_ID && runtime.eclipse.coverage >= 0.9995;
const totality: ExpeditionDef = {
    id: 'moon-totality',
    world: MOON_ID,
    title: 'Totality',
    brief: 'The Sun is 400 times wider than the Moon and, by chance, about 400 times further away, so from Earth the two look the same size and the Moon can cover the Sun exactly. Then, for a few minutes, the day goes dark, the stars come out and the corona shows: the Sun\'s outer air, over a million degrees, never seen otherwise without a special telescope. On 8 April 2024 Dallas had 3 minutes 51 seconds of it; the next total eclipse crosses Greenland, Iceland and Spain on 12 August 2026, and none on Earth can last longer than 7 minutes 32 seconds. Here the Moon stands at its mean distance, where from the ground it is a shade too small and leaves a ring of fire. So go to its shadow in space instead, where it reaches 374,000 km behind the Moon, fly into it and stay.',
    medals: ['Reach totality and see the corona', 'Stay in it longer than Dallas had, 3 min 51 s', 'Longer than any eclipse on Earth can last, 7 min 32 s'],
    reward: 25,
    step: (run, { runtime, dt, say }) => {
        if (shipLost(runtime)) return { result: 'failed', summary: 'The ship was lost.' };
        const cover = runtime.eclipse;
        if (run.stage === 0) {
            if (cover.body?.id === MOON_ID && cover.coverage > 0.5) {
                run.stage = 1;
                say(`The Moon has taken ${Math.round(cover.coverage * 100)}% of the Sun. Further into the shadow.`, 'info');
            }
            return null;
        }
        if (inTotality(runtime)) {
            if (run.timer === 0) say('Totality. The corona: the Sun\'s outer air, a million degrees, white streamers reaching out millions of kilometres. The red tongues at the edge are prominences.', 'info');
            const before = run.timer;
            run.timer += dt;
            run.best = run.timer;
            if (before < DALLAS_2024 && run.timer >= DALLAS_2024) say('3 minutes 51 seconds: as long as Dallas had on 8 April 2024.', 'info');
            if (run.timer >= LONGEST) {
                return { result: 'done', medal: 'gold', summary: `${mmss(run.timer)} in totality: longer than any eclipse on Earth can last.` };
            }
        } else if (run.timer >= 10) {
            return { result: 'done', medal: medalBy(run.timer, DALLAS_2024, LONGEST), summary: `${mmss(run.timer)} in totality before the shadow moved on.` };
        }
        return null;
    },
    status: (run, runtime) => {
        const cover = runtime.eclipse;
        const covered = cover.body?.id === MOON_ID ? `Sun ${Math.min(100, cover.coverage * 100).toFixed(cover.coverage > 0.99 ? 1 : 0)}% covered` : 'Sun uncovered';
        const ship = runtime.player?.ship;
        const gap = ship ? ship.position.distanceTo(shadowAt(runtime)) : Infinity;
        if (run.stage === 0) return { stage: 'Fly into the Moon\'s shadow (gold marker)', detail: `${Number.isFinite(gap) ? `${formatDistance(gap)} · ` : ''}${covered}` };
        return { stage: inTotality(runtime) ? 'Totality: stay in the shadow' : 'Into the full shadow, where the Moon covers all of the Sun', detail: `${mmss(run.timer)} in totality · ${covered}${Number.isFinite(gap) ? ` · ${formatDistance(gap)} from the marker` : ''}` };
    },
    target: (run, runtime) => ({ name: 'The Moon\'s shadow', position: shadowAt(runtime).clone() }),
};

export const EXPEDITIONS: ExpeditionDef[] = [jupiter, venus, saturn, sun, moon, totality, mars, io, neptune, phobos, kessler, enceladus, iapetus];
export const findExpedition = (id: string) => EXPEDITIONS.find((e) => e.id === id) ?? null;

export const startRun = (runtime: ExpeditionRuntime, id: string): ExpeditionRun => ({
    id,
    stage: 0,
    best: 0,
    timer: 0,
    deathsAtStart: runtime.stats.deaths ?? 0,
});
