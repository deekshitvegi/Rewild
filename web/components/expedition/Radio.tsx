import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cue, type ExpeditionRuntime } from './runtime';
import { listen, RADIO_SOURCES } from './radio';

/**
 * The receiver, each frame: what the tuned band hears from where the ship's
 * nose (or the explorer's gaze) points; a source heard clearly is noted, and
 * one reached is found. Pointing at Sagittarius on the hydrogen line hears
 * the Wow! signal of 1977.
 */
const forward = new THREE.Vector3();
const up = new THREE.Vector3();
const where = new THREE.Vector3();

export const Radio = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const nudged = useRef(false);
    useFrame(() => {
        const radio = runtime.radio;
        if (!radio.band) {
            radio.reading = null;
            // Coming within earshot of a signal not yet heard, with the radio off: say so, once.
            const ship = runtime.hud.ship;
            if (!nudged.current && ship && runtime.mode === 'ship' && !ship.pulseEngaged && !runtime.stats.heard.length) {
                forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
                const nearby = listen('hydrogen', ship.position, forward, new Set());
                if (nearby.source && !nearby.source.sky && nearby.audible > 0.45) {
                    nudged.current = true;
                    cue(runtime, 'radio', 0.8);
                    ship.notice = 'THE RADIO IS PICKING SOMETHING UP · PRESS V TO LISTEN';
                    ship.noticeTime = performance.now() / 1000;
                }
            }
            return;
        }
        const ship = runtime.hud.ship;
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        let from: THREE.Vector3;
        if (walker) {
            up.copy(walker.position).sub(walker.body.position).normalize();
            forward.copy(walker.look).multiplyScalar(Math.cos(walker.pitch)).addScaledVector(up, Math.sin(walker.pitch)).normalize();
            from = walker.position;
        } else if (ship) {
            forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
            from = ship.position;
        } else {
            return;
        }
        const found = new Set(runtime.stats.signals);
        const reading = listen(radio.band, from, forward, found);
        radio.reading = reading;
        const source = reading.source;
        if (!source) return;
        const stats = runtime.stats;
        const say = (message: string) => {
            if (!ship) return;
            ship.notice = message;
            ship.noticeTime = performance.now() / 1000;
        };
        // Heard clearly for the first time.
        if (reading.strength > 0.6 && !stats.heard.includes(source.id)) {
            stats.heard.push(source.id);
            cue(runtime, 'radio', 1);
            say(source.sky ? 'A STRONG NARROWBAND SIGNAL FROM SAGITTARIUS' : `${source.unknown.toUpperCase()} · FOLLOW IT`);
        }
        // Found: reached it, or, for the Wow! signal, held it dead ahead.
        if (!found.has(source.id)) {
            source.position(where);
            const reached = source.sky ? reading.strength > 0.85 : from.distanceTo(where) < source.found;
            if (reached) {
                stats.signals.push(source.id);
                cue(runtime, 'chapter', 0.9);
                say(source.sky
                    ? '6EQUJ5 · THE WOW! SIGNAL, HEARD ONCE ON 15 AUGUST 1977 AND NEVER AGAIN, UNTIL NOW'
                    : `SIGNAL SOURCE FOUND · ${source.name.toUpperCase()}`);
            }
        }
    });
    return null;
};

/** The bands in the order V steps through them, then off. */
export const nextBand = (band: ExpeditionRuntime['radio']['band']): ExpeditionRuntime['radio']['band'] => {
    const order = ['hydrogen', 'distress', 'jovian'] as const;
    if (!band) return order[0];
    const i = order.indexOf(band);
    return i < order.length - 1 ? order[i + 1] : null;
};

/** Every source, for anything that needs to list them. */
export const ALL_SOURCES = RADIO_SOURCES;
