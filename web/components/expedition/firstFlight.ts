import { findBody } from './bodies';
import { say } from './argo';
import type { ExpeditionRuntime } from './runtime';

/**
 * First flight: the guide a new player gets, because the friends who first played the game never
 * found out that the ship flies to other worlds. Five steps, from taking off on Earth to landing
 * on the Moon, each shown on the expedition log card until it is done (checked against what the
 * player actually did) and spoken once by ARGO. Done once; kept between visits; H shows the
 * controls, and the steps can be skipped.
 */
export interface FlightStep {
    id: string;
    /** What to do, with the key. */
    title: string;
    /** How, in a sentence. */
    body: string;
    /** ARGO's line when the step comes up. */
    argo: string;
    done: (runtime: ExpeditionRuntime) => boolean;
}

const MOON = 'moon';

export const FLIGHT_STEPS: FlightStep[] = [
    {
        id: 'board',
        title: 'Board your ship (E)',
        body: 'Your ship can fly anywhere in the Solar System: every planet and moon you can see in the sky. Walk to it and press E.',
        argo: 'Everything you can see up there is somewhere you can go. Get in the ship.',
        done: (r) => r.mode === 'ship',
    },
    {
        id: 'takeoff',
        title: 'Take off (F)',
        body: 'Press F to lift off, then W for throttle. Steer with the mouse.',
        argo: 'F to lift off. W opens the throttle.',
        done: (r) => r.mode === 'ship' && !!r.hud.ship && !r.hud.ship.landed && !r.hud.ship.landing,
    },
    {
        id: 'space',
        title: 'Fly up into space',
        body: 'Point the nose at the sky and climb. Hold Shift to boost. Space begins where the sky turns black.',
        argo: 'Nose up and climb. The sky goes black about where the air runs out.',
        done: (r) => r.mode === 'ship' && r.atmosphere < 0.02 && r.altitude > 3000,
    },
    {
        id: 'course',
        title: 'Open the map (M) and pick the Moon',
        body: 'The map lists every world. Pick the Moon to set your course: a gold marker shows the way.',
        argo: 'Open the map and pick the Moon. I will mark the way in gold.',
        done: (r) => !!r.waypoint,
    },
    {
        id: 'travel',
        title: 'Go: press G for the autopilot',
        body: 'G flies you there. Or point at the gold marker and press Space: the pulse drive crosses a million kilometres a second.',
        argo: 'G and I will fly us. Space engages the pulse drive if you would rather fly yourself.',
        done: (r) => r.autopilot || !!r.hud.ship?.pulseEngaged || r.stats.landed.includes(MOON),
    },
    {
        id: 'land',
        title: 'Land on the Moon (F)',
        body: 'Come in low and slow and press F to set down. E steps outside: a sixth of Earth\'s gravity.',
        argo: 'Low and slow, then F. Mind the first step: a sixth of a gravity.',
        done: (r) => r.stats.landed.includes(MOON),
    },
];

const KEY = 'expedition-first-flight';

export interface FirstFlight {
    /** Index of the step in progress; FLIGHT_STEPS.length once flown. */
    step: number;
    skipped: boolean;
}

export const loadFirstFlight = (): FirstFlight => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<FirstFlight> | null;
        if (saved && Number.isFinite(saved.step)) return { step: Math.min(FLIGHT_STEPS.length, Number(saved.step)), skipped: !!saved.skipped };
    } catch {
        // A fresh start.
    }
    return { step: 0, skipped: false };
};

const keep = (flight: FirstFlight) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(flight));
    } catch {
        // Not kept between visits.
    }
};

/** Whether the guide is still showing. */
export const flying = (flight: FirstFlight) => !flight.skipped && flight.step < FLIGHT_STEPS.length;

/**
 * Move the guide on past every step already done (a player who flew off before reading it
 * skips straight ahead), and have ARGO say the step now up. Returns true when the step changed.
 */
export const advanceFirstFlight = (flight: FirstFlight, runtime: ExpeditionRuntime) => {
    if (!flying(flight)) return false;
    const start = flight.step;
    // Someone who has already landed on the Moon needs none of it.
    if (runtime.stats.landed.includes(MOON)) flight.step = FLIGHT_STEPS.length;
    while (flight.step < FLIGHT_STEPS.length && FLIGHT_STEPS[flight.step].done(runtime)) flight.step += 1;
    // Already aboard at the start (the ship never left the ground): the first step is met.
    if (flight.step !== start) keep(flight);
    const now = FLIGHT_STEPS[flight.step];
    if (now) say(runtime.argo, now.argo, 'info', `first-flight-${now.id}`);
    else if (flight.step !== start) say(runtime.argo, `That's the Moon. The rest of the system is the same: pick a world on the map and go.${findBody('beyond') ? ' Saturn is my favourite.' : ''}`, 'info', 'first-flight-done');
    return flight.step !== start;
};

export const skipFirstFlight = (flight: FirstFlight) => {
    flight.skipped = true;
    keep(flight);
};
