import * as THREE from 'three';
import { groundHeight, waterDepth } from './environment';
import { usesEarthMap } from './earth';
import { axis, consume, type ExpeditionInput } from './input';
import { cue, type ExpeditionRuntime } from './runtime';
import type { WalkerState } from './walking';

/**
 * Fishing, in the spirit of Red Dead Redemption 2's: face open water and
 * press E to cast; wait for a bite and press E as the float dips to hook it;
 * then hold click to reel in while the fish fights. Reeling and the fish's
 * runs raise the line's tension: let go before it snaps, and the fish takes
 * line back. Earth's catch is what lives in the lakes and rivers around
 * Dallas, where the expedition lands.
 */
export interface FishingState {
    phase: 'cast' | 'wait' | 'bite' | 'reel' | 'done';
    /** Seconds in this phase. */
    time: number;
    /** When the next bite comes (wait), the next run of the fish (reel). */
    next: number;
    /** Where the float lies, world units. */
    float: THREE.Vector3;
    tension: number;
    progress: number;
    fish: Catch;
    /** How it ended, for the HUD. */
    outcome: '' | 'caught' | 'snapped' | 'missed';
}

interface Catch { name: string; kg: number; fight: number }

/** Freshwater fish of North Texas: name, weight range (kg), and how hard each fights. */
const TEXAS: { name: string; kg: [number, number]; fight: number; weight: number }[] = [
    { name: 'Largemouth bass', kg: [0.5, 4.2], fight: 0.8, weight: 4 },
    { name: 'Channel catfish', kg: [0.9, 8], fight: 1, weight: 3 },
    { name: 'Bluegill', kg: [0.1, 0.5], fight: 0.35, weight: 4 },
    { name: 'White crappie', kg: [0.2, 1.3], fight: 0.45, weight: 3 },
    { name: 'Striped bass', kg: [1.2, 9], fight: 1.15, weight: 1 },
];

const pickFish = (): Catch => {
    const total = TEXAS.reduce((sum, f) => sum + f.weight, 0);
    let roll = Math.random() * total;
    const kind = TEXAS.find((f) => (roll -= f.weight) < 0) ?? TEXAS[0];
    const size = Math.random() ** 1.6;
    return { name: kind.name, kg: Math.round((kind.kg[0] + (kind.kg[1] - kind.kg[0]) * size) * 10) / 10, fight: kind.fight * (0.7 + size * 0.6) };
};

const probe = new THREE.Vector3();
const probeUp = new THREE.Vector3();

/** Open water in front of the explorer to cast into, or null (none on worlds without seas or rivers). */
export const castSpot = (runtime: ExpeditionRuntime, walker: WalkerState): THREE.Vector3 | null => {
    const body = walker.body;
    // Fish live in Earth's water only: nothing lives in Titan's methane.
    if (walker.swimming || runtime.mode !== 'walk' || !usesEarthMap(body)) return null;
    for (let reach = 4; reach <= 14; reach += 1.5) {
        probe.copy(walker.position).addScaledVector(walker.look, reach);
        probeUp.copy(probe).sub(body.position).normalize();
        // Where there is water the ground's height is its surface.
        if (waterDepth(body, probeUp) > 0.45) return body.position.clone().addScaledVector(probeUp, body.radius + groundHeight(body, probeUp));
    }
    return null;
};

/** Start fishing at a spot found by castSpot. */
export const beginFishing = (runtime: ExpeditionRuntime, spot: THREE.Vector3): FishingState => {
    cue(runtime, 'splash', 0.35);
    return { phase: 'cast', time: 0, next: 2.5 + Math.random() * 6.5, float: spot, tension: 0, progress: 0, fish: pickFish(), outcome: '' };
};

/**
 * One frame of fishing. Returns the state to keep (null once it is over and
 * has been shown long enough, or the player walked off).
 */
export const updateFishing = (state: FishingState, runtime: ExpeditionRuntime, walker: WalkerState, input: ExpeditionInput, dt: number): FishingState | null => {
    state.time += dt;
    const ship = runtime.hud.ship;
    const say = (message: string) => {
        if (!ship) return;
        ship.notice = message;
        ship.noticeTime = performance.now() / 1000;
    };
    // E belongs to the rod while a line is out (it strikes on a bite): never left over for afterwards.
    const struck = consume(input, 'KeyE');
    // Walking off, swimming or jumping puts the rod away.
    const moving = Math.abs(axis(input, ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown'])) + Math.abs(axis(input, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft'])) + Math.abs(input.moveX) + Math.abs(input.moveY);
    if (state.phase !== 'done' && (moving > 0.3 || walker.swimming || !walker.onGround || input.keys.has('Space'))) return null;
    switch (state.phase) {
        case 'cast':
            if (state.time > 0.9) {
                state.phase = 'wait';
                state.time = 0;
                cue(runtime, 'splash', 0.25);
            }
            break;
        case 'wait':
            if (state.time > state.next) {
                state.phase = 'bite';
                state.time = 0;
                cue(runtime, 'splash', 0.6);
            }
            break;
        case 'bite':
            if (struck) {
                state.phase = 'reel';
                state.time = 0;
                state.next = 0.8;
                state.tension = 0.25;
                say(`FISH ON · HOLD CLICK TO REEL · LET GO BEFORE THE LINE SNAPS`);
            } else if (state.time > 1.1) {
                // Too slow: it took the bait and went. Another will come.
                state.phase = 'wait';
                state.time = 0;
                state.next = 2 + Math.random() * 6;
                state.fish = pickFish();
                say('IT TOOK THE BAIT AND WENT · PRESS E AS SOON AS THE FLOAT DIPS');
            }
            break;
        case 'reel': {
            const fight = state.fish.fight;
            state.next -= dt;
            if (state.next <= 0) {
                // A run: the fish pulls hard for a moment.
                state.tension += (0.12 + Math.random() * 0.22) * fight * (input.primary ? 1.4 : 1);
                state.progress = Math.max(0, state.progress - 0.04 * fight);
                state.next = 0.6 + Math.random() * 1.2;
                cue(runtime, 'splash', 0.3);
            }
            if (input.primary) {
                state.progress += dt * 0.2 * (1 - state.tension * 0.4) / Math.max(0.6, fight);
                state.tension += dt * 0.45 * (0.7 + fight * 0.5);
            } else {
                state.tension -= dt * 0.75;
                state.progress = Math.max(0, state.progress - dt * 0.035 * fight);
            }
            state.tension = THREE.MathUtils.clamp(state.tension, 0, 1);
            if (state.tension >= 1) {
                state.phase = 'done';
                state.outcome = 'snapped';
                state.time = 0;
                say('THE LINE SNAPPED · REEL IN SHORTER PULLS');
                cue(runtime, 'drop', 0.4);
            } else if (state.progress >= 1) {
                state.phase = 'done';
                state.outcome = 'caught';
                state.time = 0;
                runtime.supplies.food += 1;
                runtime.stats.fish += 1;
                runtime.stats.bestFish = Math.max(runtime.stats.bestFish, state.fish.kg);
                walker.gathering = 1.8;
                cue(runtime, 'splash', 0.9);
                cue(runtime, 'craft', 0.8);
                say(`CAUGHT A ${state.fish.kg.toFixed(1)} KG ${state.fish.name.toUpperCase()} · +1 FOOD · COOK IT BY A CAMPFIRE`);
            }
            break;
        }
        case 'done':
            if (state.time > 1.6) return null;
            break;
    }
    return state;
};
