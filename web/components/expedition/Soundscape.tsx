import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';
import { soundEngine, releaseSound, silentMix, type Mood, type Surface } from './audio';
import { BLACK_HOLE } from './deepSpace';
import { HEAT_LIMIT, HEAT_WARNING } from './hazards';
import { waterDepth } from './environment';
import { pulse } from './radio';

/**
 * Listens to the game and plays it: steers the continuous layers of
 * audio.ts every frame from what the ship and the explorer are doing, plays
 * the short sounds the game asks for (runtime.cues), and notices the moments
 * that make a sound by themselves (a footfall, touching down, the pulse drive
 * engaging).
 */

/** How much air each world has to carry sound (Earth 1); none on the airless ones. */
const AIR: Record<string, number> = { projects: 1, haven: 0.9, experience: 1.6, skills: 0.25, titan: 1.4 };

const SURFACES: Surface[] = ['grass', 'sand', 'gravel', 'snow', 'regolith', 'water'];
const surfaceOf = (kind: string | undefined): Surface =>
    kind === 'verdant' ? 'grass' : kind === 'desert' || kind === 'methane' ? 'sand' : kind === 'canyon' || kind === 'volcanic' ? 'gravel' : kind === 'frozen' || kind === 'glacier' ? 'snow' : 'regolith';

const MOOD_OF: Record<string, Mood> = { projects: 'earth', haven: 'earth', skills: 'mars', experience: 'mars', education: 'sun', moon: 'space', titania: 'ice', triton: 'ice', europa: 'ice', titan: 'mars' };

const up = new THREE.Vector3();

export const Soundscape = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const mix = useRef(silentMix());
    const primed = useRef(false);
    const seen = useRef({
        notice: '', noticeTime: 0, pulse: false, landed: false, landing: false, destroyed: false, step: 0, jumped: 0, land: 0,
        impact: 0, bursts: 0, gathered: 0, meals: 0, crafted: 0, field: false, fauna: 0, swimming: false, jolt: 0, takeoff: 0,
    });

    useEffect(() => {
        const engine = soundEngine();
        engine.start();
        // Browsers let a page make sound only once the player has interacted with it.
        const wake = () => engine.resume();
        const hidden = () => (document.hidden ? engine.suspend() : engine.resume());
        window.addEventListener('pointerdown', wake);
        window.addEventListener('keydown', wake);
        window.addEventListener('touchstart', wake);
        document.addEventListener('visibilitychange', hidden);
        return () => {
            window.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
            window.removeEventListener('touchstart', wake);
            document.removeEventListener('visibilitychange', hidden);
            releaseSound();
        };
    }, []);

    useFrame((_, delta) => {
        const engine = soundEngine();
        const dt = Math.min(delta, 0.1);
        const m = mix.current;
        const ship = runtime.hud.ship;
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const body = runtime.currentBody;
        const air = body ? (AIR[body.id] ?? 0) : 0;
        const s = seen.current;
        const paused = runtime.menuOpen || !!runtime.sites.open;

        // ---- The continuous mix -------------------------------------------------------
        Object.assign(m, silentMix());
        m.airDensity = Math.max(air, 0.01);
        if (ship && !walker) {
            const lost = !!ship.destroyed;
            m.engine = lost ? 0 : ship.landed ? 0.3 : 1;
            m.thrust = ship.landed ? 0 : THREE.MathUtils.clamp(ship.throttle, 0, 1);
            m.boost = ship.boost;
            m.pulse = lost ? 0 : ship.pulse;
            m.vacuum = 1 - THREE.MathUtils.clamp(runtime.atmosphere * 3, 0, 1);
            m.airflow = runtime.atmosphere * air * THREE.MathUtils.clamp(ship.velocity.length() / 700, 0, 1.2);
            m.entry = ship.entry;
            // Landed, the wind is heard through the hull.
            if (ship.landed) m.wind = air * 0.5;
            m.heat = lost ? 0 : THREE.MathUtils.clamp((ship.temperature - HEAT_WARNING) / 500, 0, 1);
            m.heatAlarm = !lost && ship.temperature > HEAT_LIMIT;
            m.lowAlarm = !lost && !ship.landed && ship.shield < 0.25;
            m.laser = runtime.shipLaser ? 1 : 0;
        }
        if (walker) {
            m.wind = air * (0.75 + Math.min(0.5, walker.velocity.length() / 25));
            m.breathing = body?.breathable ? 0 : 1;
            m.breathRate = 0.22 + (walker.running ? 0.22 : walker.moving * 0.08) + (walker.oxygen < 0.25 ? 0.2 : 0);
            m.jetpack = walker.jetting ? 1 : 0;
            m.laser = runtime.surface.beam ? 1 : 0;
            up.copy(walker.position).sub(walker.body.position).normalize();
            const depth = waterDepth(walker.body, up);
            m.water = walker.swimming ? 1 : depth > 0.05 ? 0.6 : 0;
            m.lowAlarm = walker.health < 0.25 && !walker.down;
        }
        const camp = runtime.camp;
        if (camp && body === camp.body) {
            const here = walker ? walker.position : ship?.position;
            if (here) m.fire = Math.pow(THREE.MathUtils.clamp(1 - here.distanceTo(camp.position) / 26, 0, 1), 1.5);
        }
        // The radio: static while tuned, the signal growing out of it as it is pointed at.
        const reading = runtime.radio.band ? runtime.radio.reading : null;
        if (runtime.radio.band) {
            m.radio = 1;
            if (reading?.source) {
                m.radioSignal = reading.strength * pulse(reading.source.pattern, performance.now() / 1000);
                m.radioPitch = reading.source.pitch;
            }
        }
        const toHole = runtime.camera.distanceTo(BLACK_HOLE.position) / BLACK_HOLE.horizon;
        m.blackHole = THREE.MathUtils.clamp(1 - Math.log10(Math.max(toHole, 1)) / Math.log10(400), 0, 1);
        if (paused) {
            m.engine *= 0.4;
            m.boost = 0;
            m.laser = 0;
            m.jetpack = 0;
        }

        // ---- What mood the music is in -------------------------------------------------
        let mood: Mood = 'space';
        if (ship?.destroyed) mood = 'quiet';
        else if (toHole < 400 || runtime.fall.active) mood = 'deep';
        else if (ship && ship.temperature > 1000 && !walker) mood = 'sun';
        else if (body && (walker || runtime.altitude < 6000) && MOOD_OF[body.id]) mood = MOOD_OF[body.id];
        engine.update(m, mood, dt);

        // ---- Moments that make a sound by themselves -------------------------------------
        // The first frame only takes note of how things stand (saved records, a landed start).
        if (!primed.current) {
            primed.current = true;
            Object.assign(s, {
                notice: ship?.notice ?? '', noticeTime: ship?.noticeTime ?? 0, pulse: !!ship?.pulseEngaged, landed: !!ship?.landed,
                landing: !!ship?.landing, destroyed: !!ship?.destroyed, bursts: runtime.surface.bursts.length,
                gathered: runtime.stats.gathered, meals: runtime.stats.meals, crafted: Object.values(runtime.stats.crafted).reduce((a, b) => a + b, 0),
                field: !!runtime.asteroidField, fauna: runtime.fauna.discovered.size, takeoff: ship?.takeoff ?? 0,
            });
            runtime.cues.length = 0;
            return;
        }
        if (ship) {
            if (ship.notice && (ship.notice !== s.notice || ship.noticeTime !== s.noticeTime)) {
                // Messages already voiced by their own sound below do not also ping.
                if (!/ENGAGED|ARRIVING|IMPACT|MINED|DESTROYED|INTERDICTED|WORMHOLE|CRYSTALS|PULSE DRIVE DROPPED/.test(ship.notice)) engine.cue(/WAYPOINT REACHED/.test(ship.notice) ? 'waypoint' : 'notice');
                s.notice = ship.notice;
                s.noticeTime = ship.noticeTime;
            }
            if (ship.pulseEngaged !== s.pulse) {
                engine.cue(ship.pulseEngaged ? 'engage' : 'drop', ship.pulseEngaged ? 1 : 0.8);
                s.pulse = ship.pulseEngaged;
            }
            if (!!ship.landing !== s.landing) {
                if (ship.landing) engine.cue('gear');
                s.landing = !!ship.landing;
            }
            if (ship.landed !== s.landed) {
                if (ship.landed && !ship.destroyed) engine.cue('touchdown');
                s.landed = ship.landed;
            }
            if (ship.takeoff > s.takeoff + 0.5) engine.cue('takeoff');
            s.takeoff = ship.takeoff;
            if (!!ship.destroyed !== s.destroyed) {
                if (ship.destroyed) engine.cue('explosion');
                s.destroyed = !!ship.destroyed;
            }
            if (!walker && ship.jolt > s.jolt + 0.35 && !ship.destroyed && runtime.cues.every((c) => c.name !== 'impact')) engine.cue('impact', ship.jolt);
            s.jolt = ship.jolt;
        }
        const field = !!runtime.asteroidField;
        if (field && !s.field) engine.cue('interdict');
        s.field = field;
        if (walker) {
            // Footfalls: two to a stride, as the walk's phase passes each half turn.
            const step = Math.floor(walker.gait / Math.PI);
            if (step !== s.step) {
                if (walker.onGround && walker.moving > 0.08 && !paused) {
                    const surface = walker.swimming || m.water > 0.5 ? 'water' : surfaceOf(walker.body.biome?.kind);
                    engine.cue('step', (walker.running ? 1 : 0.85) * (air > 0 ? 1 : 0.55), SURFACES.indexOf(surface));
                }
                s.step = step;
            }
            if (walker.jumpPending && !s.jumped) engine.cue('jump');
            s.jumped = walker.jumpPending ? 1 : 0;
            if (walker.landTime < s.land && walker.landedFrom > 0.35) engine.cue('land', Math.min(1.2, 0.4 + walker.landedFrom));
            s.land = walker.landTime;
            if (walker.impactTime < 0.05 && walker.impact > 0.02 && s.impact === 0) {
                engine.cue('hurt', Math.min(1.3, 0.5 + walker.impact));
                s.impact = 1;
            } else if (walker.impactTime > 0.5) {
                s.impact = 0;
            }
            if (walker.swimming && !s.swimming) engine.cue('splash');
            s.swimming = walker.swimming;
        } else {
            s.step = 0;
        }
        const bursts = runtime.surface.bursts.length;
        if (bursts > s.bursts) engine.cue('mined');
        s.bursts = bursts;
        if (runtime.stats.gathered > s.gathered) engine.cue('gather');
        s.gathered = runtime.stats.gathered;
        if (runtime.stats.meals > s.meals) engine.cue('eat');
        s.meals = runtime.stats.meals;
        const crafted = Object.values(runtime.stats.crafted).reduce((a, b) => a + b, 0);
        if (crafted > s.crafted) engine.cue(runtime.camp && performance.now() / 1000 - runtime.camp.lit < 1 ? 'camp' : 'craft');
        s.crafted = crafted;
        const fauna = runtime.fauna.discovered.size;
        if (fauna > s.fauna) engine.cue('scan');
        s.fauna = fauna;

        // ---- And whatever else asked for one ------------------------------------------------
        for (const c of runtime.cues) engine.cue(c.name, c.volume, c.option);
        runtime.cues.length = 0;
    });

    return null;
};
