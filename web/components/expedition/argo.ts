/**
 * ARGO, the suit's and the ship's computer. Like RICO in the Chase videos it
 * is dry and literal and says the numbers out loud: the pressure and the
 * temperature at each cloud deck, what the ground is like on landing, how
 * much cooling or air is left, the point past which there is no coming back.
 * Its lines are shown one at a time as subtitles, each long enough to read.
 */
export type ArgoTone = 'info' | 'warn' | 'danger';

export interface ArgoLine {
    text: string;
    tone: ArgoTone;
    /** When it went up (page seconds), and for how long it stays. */
    at: number;
    hold: number;
}

export interface ArgoState {
    current: ArgoLine | null;
    queue: ArgoLine[];
    /** Lines said once per expedition visit (by key), so it does not repeat itself. */
    said: Set<string>;
}

export const createArgo = (): ArgoState => ({ current: null, queue: [], said: new Set() });

/** Long enough to read: a little over a third of a second a word, from 3.5 to 9 seconds. */
const holdFor = (text: string) => Math.min(9, Math.max(3.5, 1.6 + text.split(/\s+/).length * 0.34));

/**
 * Say a line. With a key it is said only once (until forget(key)); a danger
 * line goes straight to the front, anything else waits its turn (at most
 * three waiting: old news is dropped).
 */
export const say = (argo: ArgoState, text: string, tone: ArgoTone = 'info', key?: string) => {
    if (key) {
        if (argo.said.has(key)) return false;
        argo.said.add(key);
    }
    const line: ArgoLine = { text, tone, at: 0, hold: holdFor(text) };
    if (tone === 'danger') argo.queue.unshift(line);
    else argo.queue.push(line);
    if (argo.queue.length > 3) argo.queue.splice(3);
    return true;
};

export const forget = (argo: ArgoState, prefix: string) => {
    for (const key of [...argo.said]) if (key.startsWith(prefix)) argo.said.delete(key);
};

/** Move the lines on; returns the line that has just gone up, if one did. */
export const stepArgo = (argo: ArgoState, now: number): ArgoLine | null => {
    const current = argo.current;
    const urgent = argo.queue[0]?.tone === 'danger' && current && current.tone !== 'danger';
    if (current && now - current.at < current.hold && !urgent) return null;
    const next = argo.queue.shift() ?? null;
    if (next) next.at = now;
    argo.current = next ?? (current && now - current.at < current.hold ? current : null);
    return next;
};
