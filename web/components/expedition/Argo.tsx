import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { say, forget, stepArgo, type ArgoTone } from './argo';
import { stepContact } from './contact';
import { EXPEDITIONS, findExpedition } from './expeditions';
import { gasModel, pressureAt, temperatureAt } from './gasAtmosphere';
import { HEAT_LIMIT, HEAT_WARNING } from './hazards';
import { celsius, coolingDrain, groundReadout, surfaceKelvin } from './thermal';
import { surfaceGravity } from './walking';
import { cue, type ExpeditionRuntime } from './runtime';

/**
 * ARGO at work (argo.ts): what it reads out, when, and the expedition under
 * way (expeditions.ts) moved on a few times a second.
 */

/** What each cloud deck is, in a line, the way the probes found it. */
const DECK_WORDS: Record<string, string> = {
    'Ammonia ice clouds': 'Ice crystals are hitting the canopy.',
    'Ammonium hydrosulphide clouds': 'Outside it smells of rotten eggs.',
    'Water clouds': 'There is lightning in every one of them.',
    'Methane ice clouds': 'Methane: it is what makes this planet blue.',
    'Hydrogen sulphide ice clouds': 'Hydrogen sulphide ice. The whole planet smells of rotten eggs.',
    'Ammonium hydrosulphide and water clouds': 'Water and ammonia, and storms in them.',
};

/** Pressures read out on the way down (bar), with what was found at some of them. */
const DEPTHS: [number, string][] = [
    [2, ''],
    [5, ''],
    [10, 'No sunlight reaches this deep.'],
    [15, ''],
    [20, ''],
    [23, 'Galileo\'s probe stopped transmitting at this depth, in 1995.'],
    [27, 'Close to the hull\'s rating. Turning back now leaves just enough to get out.'],
    [30, 'Past the hull\'s rating. Climb, now.'],
];

/** What each world does to a person, said on landing (after the ground's own reading). */
const HAZARD: Record<string, string> = {
    education: 'By day the ground cooks a suit; by night it freezes one. Stay near the terminator.',
    experience: 'The suit\'s cooling lasts about three minutes on this ground. The air would crush you flat.',
    projects: 'Breathable air. Watch for storms.',
    haven: 'Breathable air, and home to four hundred people. Every hour here is five months back home.',
    moon: 'Moon dust is charged and sharp as glass. It gets into everything.',
    skills: 'Without the suit your blood would boil in this air in under a minute. Dust storms cut the light.',
    phobos: 'Escape speed here is 41 km/h. Do not run too hard.',
    deimos: 'Escape speed here is 20 km/h: a hard jump and you are gone.',
    io: 'Jupiter\'s radiation here is about 36 sieverts a day. Keep the walk short.',
    europa: 'About 5 sieverts a day of radiation, and glare off the ice. Under it, an ocean.',
    ganymede: 'Inside Jupiter\'s magnetic field. The suit\'s electronics may glitch.',
    callisto: 'Outside Jupiter\'s radiation belts: the safest of its moons.',
    titan: 'You could fly here with wings. The seas are liquid methane, and you would sink in them.',
    enceladus: 'Geysers of salty water at the south pole, from an ocean under the ice.',
    mimas: 'Herschel crater is 10 km deep: a fall into it lasts minutes.',
    triton: 'The coldest surface ever measured. Nitrogen geysers rise 8 km.',
    pluto: 'Minus 230 degrees. If the suit\'s insulation failed, frostbite in seconds.',
    charon: 'Pluto hangs in the same place in the sky, always.',
};

const fmt = (value: number) => (Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US'));

export const ArgoWatch = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const last = useRef({ deck: null as string | null, gas: null as string | null, landed: false, warp: 1, tick: 0 });

    useFrame((_, delta) => {
        const now = performance.now() / 1000;
        const argo = runtime.argo;
        const speak = (text: string, tone: ArgoTone = 'info', key?: string) => say(argo, text, tone, key);
        const state = last.current;
        state.tick += Math.min(delta, 0.1);
        // A few times a second is plenty.
        if (state.tick >= 0.25) {
            const dt = state.tick;
            state.tick = 0;
            const ship = runtime.player?.ship;
            const walker = runtime.mode === 'walk' ? runtime.player?.walker.current ?? null : null;

            // ---- The expedition under way ----
            const run = runtime.expedition;
            const def = run ? findExpedition(run.id) : null;
            if (run && def) {
                const outcome = def.step(run, { runtime, dt, say: speak });
                if (outcome) {
                    const record = runtime.stats.expeditions[run.id] ?? { attempts: 0, medal: null, best: 0 };
                    record.attempts += 1;
                    if (outcome.result === 'done') {
                        const rank = { bronze: 1, silver: 2, gold: 3 } as const;
                        const first = !record.medal;
                        if (!record.medal || rank[outcome.medal] > rank[record.medal]) record.medal = outcome.medal;
                        record.best = Math.max(record.best, run.best);
                        if (first) runtime.inventory.crystals += def.reward;
                        speak(`${def.title}: done. ${outcome.summary} ${outcome.medal[0].toUpperCase()}${outcome.medal.slice(1)}.${first ? ` +${def.reward} crystals.` : ''}`, 'info');
                        runtime.scan.found = { name: def.title, blurb: `${outcome.summary} ${outcome.medal[0].toUpperCase()}${outcome.medal.slice(1)} medal.`, label: 'Expedition complete' };
                        runtime.scan.foundAt = now;
                        cue(runtime, 'chapter', 0.9);
                    } else {
                        speak(`${def.title}: failed. ${outcome.summary} Attempt ${record.attempts}.`, 'danger');
                    }
                    runtime.stats.expeditions[run.id] = record;
                    runtime.expedition = null;
                }
            }

            // ---- Inside a giant: each deck, and the pressure on the way down ----
            const gas = runtime.gas;
            if (gas) {
                const model = gasModel(gas.body);
                const p = pressureAt(model, gas.height);
                const t = celsius(temperatureAt(model, gas.height));
                if (state.gas !== gas.body.id) {
                    state.gas = gas.body.id;
                    forget(argo, `depth-${gas.body.id}`);
                }
                if (gas.deck && gas.deck !== state.deck) {
                    speak(`${gas.deck}. ${fmt(p)} bar, ${Math.round(t)} °C. ${DECK_WORDS[gas.deck] ?? ''}`.trim(), 'info');
                }
                state.deck = gas.deck;
                for (const [depth, words] of DEPTHS) {
                    if (p >= depth) speak(`Pressure ${depth} bar. Temperature ${Math.round(t)} °C.${words ? ` ${words}` : ''}`, depth >= 27 ? 'danger' : 'info', `depth-${gas.body.id}-${depth}`);
                }
            } else {
                state.gas = null;
                state.deck = null;
            }

            // ---- The ship's shield and hull ----
            if (ship && !ship.destroyed) {
                const why = ship.hurtBy === 'pressure' ? 'Turning back now leaves enough to get out.' : 'Get clear.';
                if (ship.shield < 0.5) speak(`Shield at 50%. ${why}`, 'warn', 'shield-50');
                if (ship.shield < 0.25) speak('Shield at 25%. Climb out, now.', 'danger', 'shield-25');
                if (ship.shield > 0.9) forget(argo, 'shield-');
                if (ship.temperature > HEAT_WARNING) speak(`Hull at ${Math.round(ship.temperature).toLocaleString('en-US')} K. The shield is rated to ${HEAT_LIMIT.toLocaleString('en-US')} K.`, 'warn', 'heat');
                else if (ship.temperature < HEAT_WARNING * 0.8) forget(argo, 'heat');
            }

            // ---- Landing: the ground, and what the world does to a person ----
            const body = runtime.currentBody;
            const landed = !!ship?.landed && runtime.mode === 'ship';
            if (landed && !state.landed && body && body.kind === 'rocky') {
                const g = surfaceGravity(body) / 9.81;
                const up = ship!.position.clone().sub(body.position).normalize();
                const reading = groundReadout(body, surfaceKelvin(body, up));
                const hazard = HAZARD[body.id];
                speak(`${body.name}. ${reading}, gravity ${g < 0.1 ? g.toFixed(3) : g.toFixed(2)} g.${hazard ? ` ${hazard}` : ''}`, 'info', `land-${body.id}`);
            }
            state.landed = landed;

            // ---- On foot: cooling, air, health ----
            if (walker && !walker.down) {
                const drain = coolingDrain(walker.kelvin);
                if (drain > 0) {
                    const left = Math.round(walker.cooling / drain);
                    if (walker.cooling < 0.5) speak(`Suit cooling at 50%. About ${left} seconds left.`, 'warn', 'cool-50');
                    if (walker.cooling < 0.25) speak(`Cooling at 25%. ${left} seconds. Get back to the ship.`, 'danger', 'cool-25');
                    if (walker.cooling < 0.1) speak('Cooling almost gone.', 'danger', 'cool-10');
                } else if (walker.cooling > 0.9) forget(argo, 'cool-');
                if (walker.oxygen < 0.3) speak('Oxygen at 30%.', 'warn', 'air-30');
                if (walker.oxygen < 0.1) speak('Oxygen at 10%. Back to the ship.', 'danger', 'air-10');
                if (walker.oxygen > 0.9) forget(argo, 'air-');
                if (walker.health < 0.3) speak('Vital signs falling.', 'danger', 'life-30');
                if (walker.health > 0.7) forget(argo, 'life-');
            }

            // ---- The time warp, the first time it is used ----
            const warp = runtime.motion.warp;
            if (warp > 1 && state.warp === 1) speak(`Time ×${warp.toLocaleString('en-US')}. The worlds move faster; the ship and you do not.`, 'info', 'warp');
            state.warp = warp;

        }

        // First words with whoever is near (contact.ts): the torch's flashes, the reply.
        stepContact(runtime, Math.min(delta, 0.1));

        // The line on screen, and a chime as each one goes up.
        const fresh = stepArgo(argo, now);
        if (fresh) cue(runtime, fresh.tone === 'info' ? 'notice' : 'radio', fresh.tone === 'danger' ? 1 : 0.6);
    });
    return null;
};

/** Begin an expedition (from the log): ARGO reads the gist, and the course is set for its world. */
export const beginExpedition = (runtime: ExpeditionRuntime, id: string, start: (runtime: ExpeditionRuntime, id: string) => NonNullable<ExpeditionRuntime['expedition']>) => {
    const def = EXPEDITIONS.find((e) => e.id === id);
    if (!def) return;
    runtime.expedition = start(runtime, id);
    if (runtime.currentBody?.id !== def.world) runtime.waypoint = def.world;
    say(runtime.argo, `Expedition: ${def.title}. ${def.medals[0]}.`, 'info');
};
