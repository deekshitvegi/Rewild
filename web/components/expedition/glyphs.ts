/**
 * The alien script on the data sites. Each of the 26 letters has its own
 * glyph, drawn from strokes on a 3x3 grid. Reading a site for the first time
 * teaches a few glyphs; learned letters then appear in plain text wherever they
 * are written, so every inscription (and the Obelisk's hidden message) slowly
 * becomes readable as the system is explored.
 */

import { emptyStats, emptySupplies, type Medal, type Stats, type Supplies } from './survival';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The message on the Obelisk. */
export const OBELISK_MESSAGE = 'EVERY FIFTEENTH OF SEPTEMBER A NEW STAR IS BORN IN THIS GALAXY. THANK YOU FOR EXPLORING.';

const mulberry = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Strokes between points of a 3x3 grid (index = row * 3 + col).
const EDGES: [number, number][] = [];
for (let a = 0; a < 9; a++) {
    for (let b = a + 1; b < 9; b++) {
        const [ar, ac] = [Math.floor(a / 3), a % 3];
        const [br, bc] = [Math.floor(b / 3), b % 3];
        if (Math.max(Math.abs(ar - br), Math.abs(ac - bc)) === 1) EDGES.push([a, b]);
    }
}

/** SVG path data for each letter's glyph, in a 0..24 box. Always the same. */
export const GLYPH_PATHS: Record<string, string> = (() => {
    const random = mulberry(0x5eed);
    const used = new Set<string>();
    const paths: Record<string, string> = {};
    for (const letter of ALPHABET) {
        let strokes: [number, number][] = [];
        let key = '';
        for (let attempt = 0; attempt < 50; attempt++) {
            const count = 3 + Math.floor(random() * 2);
            const chosen = new Set<number>();
            // A connected-looking glyph: start with one edge, prefer edges touching it.
            const first = Math.floor(random() * EDGES.length);
            chosen.add(first);
            while (chosen.size < count) {
                const candidates = EDGES.map((_, n) => n).filter((n) => !chosen.has(n)
                    && [...chosen].some((c) => EDGES[c].some((p) => EDGES[n].includes(p))));
                chosen.add(candidates.length ? candidates[Math.floor(random() * candidates.length)] : Math.floor(random() * EDGES.length));
            }
            strokes = [...chosen].map((n) => EDGES[n]);
            key = [...chosen].sort((a, b) => a - b).join(',');
            if (!used.has(key)) break;
        }
        used.add(key);
        const point = (p: number) => `${4 + (p % 3) * 8} ${4 + Math.floor(p / 3) * 8}`;
        paths[letter] = strokes.map(([a, b]) => `M${point(a)}L${point(b)}`).join('');
    }
    return paths;
})();

export interface ExpeditionProgress {
    letters: string;
    sites: string[];
    crystals: number;
    /** Animal species scanned so far. */
    fauna: string[];
    /** Food carried and upgrades bought (survival.ts). */
    supplies: Supplies;
    /** What the story and its challenges are measured by. */
    stats: Stats;
    /** Story chapters finished, in order. */
    story: string[];
    /** Challenges met and paid (challenges.ts), and the best medal each finished chapter has earned. */
    challenges: string[];
    medals: Record<string, Medal>;
}

const STORAGE_KEY = 'expedition-progress-v1';

const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const numbers = (value: unknown) => Object.fromEntries(Object.entries(record(value)).filter(([, v]) => Number.isFinite(v))) as Record<string, number>;
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') as string[] : []);
const count = (value: unknown, fallback = 0) => (Number.isFinite(value) ? Number(value) : fallback);

/** Saved supplies and stats, with anything missing or damaged put back to its start. */
const readSupplies = (value: unknown): Supplies => {
    const v = record(value);
    const start = emptySupplies();
    return { food: count(v.food, start.food), jetpack: count(v.jetpack), tank: count(v.tank), tool: count(v.tool) };
};
const readStats = (value: unknown): Stats => {
    const v = record(value);
    return {
        ...emptyStats(),
        mined: count(v.mined),
        minedOn: numbers(v.minedOn),
        landed: strings(v.landed),
        gathered: count(v.gathered),
        crafted: numbers(v.crafted),
        meals: count(v.meals),
        cooked: count(v.cooked),
        rested: count(v.rested),
        jumps: numbers(v.jumps),
        drops: numbers(v.drops),
        swum: count(v.swum),
        visited: strings(v.visited),
        sunPass: typeof v.sunPass === 'number' && Number.isFinite(v.sunPass) && v.sunPass >= 0 ? v.sunPass : 99,
        fed: count(v.fed),
        petted: count(v.petted),
        friends: strings(v.friends),
        scared: count(v.scared),
        bitten: count(v.bitten),
        fish: count(v.fish),
        bestFish: count(v.bestFish),
        vaults: strings(v.vaults),
        heard: strings(v.heard),
        signals: strings(v.signals),
        aliens: strings(v.aliens),
        deaths: count(v.deaths),
        deathsOn: numbers(v.deathsOn),
        expeditions: readExpeditions(v.expeditions),
    };
};

const readExpeditions = (value: unknown): Stats['expeditions'] => {
    const out: Stats['expeditions'] = {};
    for (const [id, entry] of Object.entries(record(value))) {
        const e = record(entry);
        const medal = e.medal === 'bronze' || e.medal === 'silver' || e.medal === 'gold' ? e.medal : null;
        out[id] = { attempts: count(e.attempts), medal, best: typeof e.best === 'number' && Number.isFinite(e.best) ? e.best : 0 };
    }
    return out;
};

const readMedals = (value: unknown) =>
    Object.fromEntries(Object.entries(record(value)).filter(([, v]) => v === 'bronze' || v === 'silver' || v === 'gold')) as Record<string, Medal>;

export const loadProgress = (): ExpeditionProgress => {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<ExpeditionProgress>;
            return {
                letters: typeof parsed.letters === 'string' ? parsed.letters.replace(/[^A-Z]/g, '') : '',
                sites: Array.isArray(parsed.sites) ? parsed.sites.filter((s) => typeof s === 'string') : [],
                crystals: Number.isFinite(parsed.crystals) ? Number(parsed.crystals) : 0,
                fauna: Array.isArray(parsed.fauna) ? parsed.fauna.filter((s) => typeof s === 'string') : [],
                supplies: readSupplies(parsed.supplies),
                stats: readStats(parsed.stats),
                story: strings(parsed.story),
                challenges: strings(parsed.challenges),
                medals: readMedals(parsed.medals),
            };
        }
    } catch {
        // Storage can be unavailable (private windows, embedded previews).
    }
    return { letters: '', sites: [], crystals: 0, fauna: [], supplies: emptySupplies(), stats: emptyStats(), story: [], challenges: [], medals: {} };
};

export const saveProgress = (progress: ExpeditionProgress) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
        // Progress simply is not kept between visits.
    }
};

/**
 * Letters a first reading of `inscription` teaches: its three most common
 * unknown letters, or, if it has none left, the next unknown letters of the
 * alphabet. That way every letter can be learned eventually.
 */
export const lettersToLearn = (inscription: string, known: string, count = 3) => {
    const counts = new Map<string, number>();
    for (const ch of inscription.toUpperCase()) {
        if (ALPHABET.includes(ch) && !known.includes(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    const fromText = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([ch]) => ch);
    const extra = [...ALPHABET].filter((ch) => !known.includes(ch) && !fromText.includes(ch));
    return [...fromText, ...extra].slice(0, count);
};

/** An inscription split into characters, each either decoded or still a glyph. */
export const readInscription = (inscription: string, known: string) =>
    [...inscription.toUpperCase()].map((ch) => ({
        ch,
        isLetter: ALPHABET.includes(ch),
        known: !ALPHABET.includes(ch) || known.includes(ch),
    }));
