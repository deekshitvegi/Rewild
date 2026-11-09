import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { soundEngine, type Playing } from './audio';
import { BEAT } from './crossing';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import { mouthRegion } from './region';
import { APPROACH_FROM, APPROACH_LINES, CROSSING_WHITE, ENTRY_LINE, FALL_LINES, LINES, SCORE, THROAT_LINES, type VoiceLine } from './voiceLines';
import type { ExpeditionRuntime } from './runtime';

/**
 * The voices and the score of the crossing and of the fall into TON 618 (voiceLines.ts): who says
 * what, when, and the music under it, kept in time with what is on screen.
 *
 * - Coming up to a mouth in the Argo, the lines start thirty seconds out (time to the throat at the
 *   speed she is closing) and ARGO's "Entering the throat" comes as she reaches it. Turn away and they
 *   stop.
 * - In the throat each line is tied to its beat (crossing.ts); none starts while the throat is held.
 * - The score is placed so that its peak lands on the flash of white as the Argo comes out: started
 *   during the approach as far into the track as the time left needs, moved (a short crossfade) if the
 *   Argo speeds up or slows, and held back in its build if the throat has to wait for the other system.
 * - Falling in, ARGO's four lines at their moments and the fall's own score, from part way in.
 *
 * Every line puts up its caption for exactly as long as it is heard (its measured length). The score
 * dips under each line. Nothing plays until the player has interacted with the page (the browser's
 * rule); the captions come regardless.
 */

/** The caption on screen now (Captions reads it). */
export const caption = { who: '', text: '', until: 0 };

const fileUrl = (file: string) => `${import.meta.env.BASE_URL}${file}`;
const crossingFiles = () => [...APPROACH_LINES, ENTRY_LINE.line, ...THROAT_LINES.map((t) => t.line)].map((l) => l.file).concat(SCORE.crossing.file);
const fallFiles = () => FALL_LINES.map((t) => t.line.file).concat(SCORE.fall.file);

type ScoreKind = 'crossing' | 'fall';

const toMouth = new THREE.Vector3();
/** Development only: every line and score start, in page seconds, for test films to be given their sound. */
const heard: { at: number; file: string; offset: number; gain: number; kind: string; played?: boolean }[] = [];
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __voiceLog?: unknown }).__voiceLog = heard;

export const Voices = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const state = useRef({
        voice: null as Playing | null,
        voiceUntil: 0,
        nextFree: 0,
        said: new Set<string>(),
        approach: null as { mouth: string; index: number; entry: boolean } | null,
        transit: null as object | null,
        falling: false,
        score: null as { kind: ScoreKind; playing: Playing } | null,
        ducked: false,
        loaded: { crossing: false, fall: false },
    });
    useEffect(() => () => {
        const s = state.current;
        s.voice?.stop(0.1);
        s.score?.playing.stop(0.3);
        caption.until = 0;
    }, []);

    useFrame(() => {
        const engine = soundEngine();
        const s = state.current;
        const now = performance.now() / 1000;
        const ship = runtime.player?.ship;
        const mothership = runtime.mothership;
        if (!ship) return;

        // Fetched when near: the crossing's once the Argo is docked, the fall's near TON 618.
        if (!s.loaded.crossing && mothership?.docked && engine.ctx) {
            s.loaded.crossing = true;
            crossingFiles().forEach((file) => engine.load(fileUrl(file)));
        }
        if (!s.loaded.fall && engine.ctx && (runtime.fall.active || ship.position.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * 60)) {
            s.loaded.fall = true;
            fallFiles().forEach((file) => engine.load(fileUrl(file)));
        }

        const speak = (line: VoiceLine) => {
            if (import.meta.env.DEV) heard.push({ at: now, file: line.file, offset: 0, gain: line.gain, kind: 'voice' });
            s.voice?.stop(0.12);
            s.voice = engine.play(fileUrl(line.file), 'voice', 0, 0.02, line.gain);
            caption.who = line.who;
            caption.text = line.text;
            caption.until = now + line.seconds + 0.15;
            s.voiceUntil = now + line.seconds;
            s.nextFree = now + line.seconds + 0.35;
            s.said.add(line.id);
        };
        const silence = () => {
            s.voice?.stop(0.15);
            s.voice = null;
            s.voiceUntil = 0;
            caption.until = 0;
        };
        /** Keep the score of `kind` playing at `position` seconds into it (starting it, or moving it if it is out by more than `slack`). */
        const scoreAt = (kind: ScoreKind, position: number, slack: number, fadeIn: number) => {
            const def = SCORE[kind];
            const url = fileUrl(def.file);
            const current = s.score?.kind === kind && !s.score.playing.ended() ? s.score.playing : null;
            if (current && Math.abs(current.position() - position) <= slack) return;
            if (position < 0) return;
            const next = engine.play(url, 'score', position, current ? 0.8 : fadeIn, def.level);
            if (import.meta.env.DEV) heard.push({ at: now, file: def.file, offset: position, gain: def.level, kind: 'score', played: !!next });
            if (!next) return;
            s.score?.playing.stop(current ? 0.8 : 0.4);
            s.score = { kind, playing: next };
            s.ducked = false;
        };
        const stopScore = (fade: number) => {
            s.score?.playing.stop(fade);
            s.score = null;
        };
        // Under a line the score comes down.
        const speaking = now < s.voiceUntil;
        if (s.score?.playing.ended()) s.score = null;
        if (s.score && speaking !== s.ducked) s.score.playing.level(speaking ? SCORE[s.score.kind].under : 1, speaking ? 0.12 : 0.6);
        s.ducked = speaking;

        // ---- Falling into TON 618 -----------------------------------------------------------
        const fall = runtime.fall;
        if (fall.active) {
            if (!s.falling) {
                s.falling = true;
                s.said.clear();
                silence();
                stopScore(0.5);
            }
            for (const { at, line } of FALL_LINES) {
                // (Within a second and a half of its moment: a fall jumped forward by a test passes over it.)
                if (!s.said.has(line.id) && fall.time >= at && fall.time < at + 1.5) speak(line);
            }
            if (!fall.hold) scoreAt('fall', SCORE.fall.from + fall.time, 1.5, 2);
            return;
        }
        if (s.falling) {
            // Skipped, or over: the voice stops, the score fades.
            s.falling = false;
            silence();
            if (s.score?.kind === 'fall') stopScore(1.5);
        }

        // ---- In the throat ------------------------------------------------------------------
        const transit = runtime.transit;
        if (transit) {
            if (s.transit !== transit) {
                s.transit = transit;
                for (const { line } of THROAT_LINES) s.said.delete(line.id);
                s.approach = null;
            }
            for (const { at, line } of THROAT_LINES) {
                if (!s.said.has(line.id) && transit.t >= at && transit.t < at + 1.5) speak(line);
            }
            const held = runtime.loading && transit.t >= BEAT.hold - 1e-3;
            const position = SCORE.crossing.peak - (CROSSING_WHITE - transit.t);
            const playing = s.score?.kind === 'crossing' ? s.score.playing : null;
            if (held && playing) {
                // Waiting for the other side: kept in the build, short of the peak.
                if (playing.position() > SCORE.crossing.peak - 4) scoreAt('crossing', playing.position() - 9, 0, 0.8);
            } else if (!transit.hold) scoreAt('crossing', position, 1.2, 1);
            return;
        }
        s.transit = null;

        // ---- Coming up to a mouth in the Argo ---------------------------------------------------
        const eligible = !!mothership?.docked && runtime.mode === 'ship' && !ship.destroyed;
        let eta = Infinity;
        let nearest = '';
        if (eligible) {
            for (const mouth of WORMHOLES) {
                if (mouthRegion(mouth.id) !== runtime.region) continue;
                // The crossing happens when the camera reaches the throat (Player.tsx).
                toMouth.copy(mouth.position).sub(runtime.camera);
                const distance = toMouth.length() - mouth.radius;
                const closing = ship.velocity.dot(toMouth.normalize());
                const time = closing > 30 && distance > 0 ? distance / closing : Infinity;
                if (time < eta) {
                    eta = time;
                    nearest = mouth.id;
                }
            }
        }
        if (eligible && eta <= APPROACH_FROM) {
            if (!s.approach || s.approach.mouth !== nearest) s.approach = { mouth: nearest, index: 0, entry: false };
            const approach = s.approach;
            if (!approach.entry && eta <= ENTRY_LINE.eta) {
                approach.entry = true;
                approach.index = APPROACH_LINES.length;
                speak(ENTRY_LINE.line);
            }
            while (approach.index < APPROACH_LINES.length && now >= s.nextFree) {
                const line = APPROACH_LINES[approach.index];
                // "Thirty seconds" only where it is still about thirty; nothing that would run into the last word.
                const late = (line === LINES.c01 && eta < 22) || eta - line.seconds < ENTRY_LINE.eta + 0.6;
                approach.index += 1;
                if (late) continue;
                speak(line);
                break;
            }
            scoreAt('crossing', SCORE.crossing.peak - (eta + CROSSING_WHITE), 2.5, 1.5);
        } else if (s.approach && (!eligible || eta > APPROACH_FROM + 15)) {
            // Turned away: no crossing after all.
            s.approach = null;
            if (s.score?.kind === 'crossing') stopScore(2.5);
        }
    });
    return null;
};

/** The words of the line being heard, at the foot of the screen. */
export const Captions = () => {
    const [shown, setShown] = useState<{ who: string; text: string } | null>(null);
    useEffect(() => {
        let frame = 0;
        let last = '';
        const tick = () => {
            const on = performance.now() / 1000 < caption.until;
            const key = on ? `${caption.who}|${caption.text}` : '';
            if (key !== last) {
                last = key;
                setShown(on ? { who: caption.who, text: caption.text } : null);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);
    if (!shown) return null;
    return (
        <p className="rewild-caption" role="status" aria-live="polite">
            <b>{shown.who}</b>
            {shown.text}
        </p>
    );
};
