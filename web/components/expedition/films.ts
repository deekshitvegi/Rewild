/**
 * The films the game can play while it loads (FilmPlayer.tsx): the crossing of the wormhole while
 * the other system is built (WormholeFilm.tsx), when the player picks a film over the crossing the
 * game draws (Settings › Graphics). Each comes as WebM (VP9: Chrome, Edge, Firefox,
 * Android) and MP4 (H.264: Safari, iPhone). Kept free of the game's own modules: the home page
 * loads this before the expedition has been fetched.
 */
export interface Cue {
    /** Seconds into the film. */
    at: number;
    end: number;
    who: string;
    text: string;
}

export interface Film {
    /** Path under the site's base, without the extension. */
    src: string;
    /** What is said, for the captions. */
    cues: Cue[];
}

// Captions, timed from the films' own audio (word timings checked against the loudness trace).
export const FILMS = {
    'crossing-out': { src: 'films/crossing-out', cues: [
        { at: 1.15, end: 5.59, who: 'ARGO', text: 'Throat in thirty seconds. Tidal load is rising.' },
        { at: 5.84, end: 8.48, who: 'Dev', text: 'Everybody strapped in? This is it.' },
        { at: 8.64, end: 12.02, who: 'Amara', text: 'Gravity\'s climbing fast. Keep her dead centre, Dev.' },
        { at: 12.22, end: 14.8, who: 'Dev', text: 'Dead centre. Taking us in.' },
        { at: 17.24, end: 18.83, who: 'ARGO', text: 'Entering the throat.' },
        { at: 18.88, end: 22.21, who: 'Kai', text: 'Hull\'s singing back here! She\'ll hold, she\'ll hold!' },
        { at: 22.26, end: 25.89, who: 'Noor', text: 'Look at the light. It\'s bending all around us.' },
        { at: 25.94, end: 29.34, who: 'ARGO', text: 'Three g. Holding steady.' },
        { at: 29.43, end: 32.3, who: 'Amara', text: 'There. The other side.' },
        { at: 32.35, end: 34.83, who: 'Dev', text: 'Hold on, everyone. Bringing us out.' },
    ] },
    'crossing-home': { src: 'films/crossing-home', cues: [
        { at: 0.9, end: 5.34, who: 'ARGO', text: 'Throat in thirty seconds. Tidal load is rising.' },
        { at: 6.15, end: 9.05, who: 'Dev', text: 'Everybody strapped in? This is it.' },
        { at: 9.15, end: 12.6, who: 'Amara', text: 'Gravity\'s climbing fast. Keep her dead centre, Dev.' },
        { at: 12.65, end: 15.45, who: 'Dev', text: 'Dead centre. Taking us in.' },
        { at: 17.24, end: 18.83, who: 'ARGO', text: 'Entering the throat.' },
        { at: 18.88, end: 22.21, who: 'Kai', text: 'Hull\'s singing back here! She\'ll hold, she\'ll hold!' },
        { at: 22.26, end: 25.89, who: 'Noor', text: 'Look at the light. It\'s bending all around us.' },
        { at: 25.94, end: 29.34, who: 'ARGO', text: 'Three g. Holding steady.' },
        { at: 29.43, end: 32.3, who: 'Amara', text: 'There. The other side.' },
        { at: 32.35, end: 34.83, who: 'Dev', text: 'Hold on, everyone. Bringing us out.' },
    ] },
    'quick-out': { src: 'films/wormhole-game-out', cues: [] as Cue[] },
    'quick-home': { src: 'films/wormhole-game-home', cues: [] as Cue[] },
} satisfies Record<string, Film>;
export type FilmId = keyof typeof FILMS;

let webm: boolean | null = null;
/** The film's address in the format this browser plays. */
export const filmUrl = (id: FilmId) => {
    if (webm === null) webm = typeof document !== 'undefined' && document.createElement('video').canPlayType('video/webm; codecs="vp9"') !== '';
    return `${import.meta.env.BASE_URL}${FILMS[id].src}.${webm ? 'webm' : 'mp4'}`;
};

/**
 * How the crossing is shown (Settings › Graphics › Wormhole crossing): drawn by the game as it happens
 * (crossing.ts, the default since 9 Nov 2026: the films were not liked), or one of the old films, the
 * crew's or the short one, kept for anyone who wants them.
 */
export type CrossingFilm = 'engine' | 'crew' | 'quick';
const CROSSING_KEY = 'rewild-crossing';
export const readCrossingFilm = (): CrossingFilm => {
    try {
        const saved = window.localStorage.getItem(CROSSING_KEY);
        return saved === 'crew' || saved === 'quick' ? saved : 'engine';
    } catch {
        return 'engine';
    }
};
export const saveCrossingFilm = (choice: CrossingFilm) => {
    try {
        window.localStorage.setItem(CROSSING_KEY, choice);
    } catch {
        // Not kept: this visit only.
    }
};
export const crossingFilmFor = (to: 'sol' | 'ton', choice: CrossingFilm = readCrossingFilm()): FilmId =>
    `${choice === 'quick' ? 'quick' : 'crossing'}-${to === 'ton' ? 'out' : 'home'}` as FilmId;

/**
 * Where the expedition begins, shown while it loads (ExpeditionLaunch.tsx): a new game on Haven, anyone further on in
 * the Solar System. (The AI-generated opening films were taken out at the owner's request on 9 Nov 2026; the
 * opening made from the game itself, docs/films/OPENING.md, takes their place when it is ready.)
 */
export const openingPlace = (): string => {
    try {
        const saved = JSON.parse(window.localStorage.getItem('expedition-progress-v1') ?? 'null') as { story?: unknown } | null;
        if (saved && Array.isArray(saved.story) && saved.story.length > 0) return 'Landing near Dallas, on Earth';
    } catch {
        // A damaged save begins as a new game does.
    }
    return 'Landing at the colony on Haven';
};

/** How loud the films play: the game's overall sound level (Settings › Sound), nothing when it is switched off. */
export const filmVolume = () => {
    try {
        const saved = JSON.parse(window.localStorage.getItem('rewild-sound') ?? 'null') as { volumes?: { master?: unknown }; off?: { master?: unknown } } | null;
        if (saved?.off?.master) return 0;
        const level = Number(saved?.volumes?.master);
        return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
    } catch {
        return 1;
    }
};
