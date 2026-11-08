import * as THREE from 'three';
import { AU, EXPEDITION_BODIES, findBody, type ExpeditionBody } from './bodies';
import { fromEquatorial } from './orbits';
import { activeMotion, pinPoint, turnWithWorld } from './motion';
import { ALIEN_SITES, sitePosition } from './aliens';

/**
 * The ship's radio, after Outer Wilds' signalscope: tune a band, sweep the
 * ship's nose across the sky, and a signal grows out of the static as you
 * point at its source and as you close on it. A far, faint signal is only
 * heard pointing straight at it; up close, from any direction.
 *
 * The bands are real ones. The hydrogen line at 1420.405 MHz is where SETI
 * listens for other minds, because hydrogen, the commonest element, already
 * glows there. 406 MHz carries emergency beacons. And between 8 and 40 MHz
 * Jupiter roars: its moon Io drives bursts of radio along the planet's
 * magnetic field, loud enough to be heard on Earth with an amateur's antenna.
 */
export type Band = 'hydrogen' | 'distress' | 'jovian';

export const BANDS: { id: Band; label: string; frequency: string }[] = [
    { id: 'hydrogen', label: 'Hydrogen line', frequency: '1420.405 MHz' },
    { id: 'distress', label: 'Distress', frequency: '406.025 MHz' },
    { id: 'jovian', label: 'Jovian bursts', frequency: '8–40 MHz' },
];

export interface RadioSource {
    id: string;
    band: Band;
    /** What it is called once it has been found. */
    name: string;
    /** What the readout says before then. */
    unknown: string;
    /** Where it is, now (world units); a direction far outside the system for a sky source. */
    position: (out: THREE.Vector3) => THREE.Vector3;
    /** Distance at which it fades into the static. */
    reach: number;
    /** The tone it is heard as (relative pitch), and how it pulses. */
    pitch: number;
    pattern: 'primes' | 'beacon' | 'roar' | 'burst';
    /** Found by coming within this distance of it. */
    found: number;
    /** The world it lies on, if any. */
    body?: string;
    /** A point in the sky rather than a place (heard everywhere, never reached). */
    sky?: boolean;
}

/** Where the survey ship Kepler drifts, in the main belt (Derelict.tsx draws it). */
export const DERELICT = pinPoint(new THREE.Vector3(2.4 * AU, 0.01 * AU, -1.2 * AU));

/** Where the Wow! signal came from: a point in Sagittarius far beyond the system (it turns with the sky). */
const WOW = pinPoint(fromEquatorial(291.4, -27).multiplyScalar(AU * 4000));

/** Where an alien site is (aliens.ts). */
const atSite = (id: string) => (out: THREE.Vector3) => {
    const site = ALIEN_SITES.find((s) => s.id === id)!;
    sitePosition(site, out);
    // Worked out in its world's own frame: turned as the world is now.
    const motion = activeMotion();
    const body = findBody(site.body);
    return motion && body ? turnWithWorld(motion, body, out) : out;
};

/**
 * Every source in the system. The alien ones sit where life in the Solar
 * System is really thought likeliest: Europa's buried ocean, which may vent
 * through its cracks; Titan, under its haze; Mars, deep in the rock; the mild
 * layer of Venus's clouds; and, at the edge of the system, the Makers.
 */
export const RADIO_SOURCES: RadioSource[] = [
    {
        id: 'europa-signal', band: 'hydrogen', name: 'Europa · the vent', unknown: 'Unidentified narrowband signal',
        position: atSite('europa-signal'), reach: AU * 6, pitch: 1, pattern: 'primes', found: 120, body: 'europa',
    },
    {
        id: 'titan-signal', band: 'hydrogen', name: 'Titan · the floaters', unknown: 'Second narrowband signal',
        position: atSite('titan-signal'), reach: AU * 4, pitch: 1.19, pattern: 'primes', found: 200, body: 'titan',
    },
    {
        id: 'mars-signal', band: 'hydrogen', name: 'Mars · the rock dwellers', unknown: 'Faint narrowband signal',
        position: atSite('mars-signal'), reach: AU * 0.9, pitch: 0.84, pattern: 'primes', found: 120, body: 'skills',
    },
    {
        // Pulses from inside Venus's clouds: the aeronauts talk by radio.
        id: 'venus-signal', band: 'hydrogen', name: 'Venus · the aeronauts', unknown: 'Pulsed signal inside the clouds',
        position: atSite('venus-signal'), reach: AU * 1.2, pitch: 1.41, pattern: 'primes', found: 220, body: 'experience',
    },
    {
        // At the edge of the system, where the vaults end.
        id: 'triton-signal', band: 'hydrogen', name: 'Triton · the Makers', unknown: 'Very faint narrowband signal',
        position: atSite('triton-signal'), reach: AU * 12, pitch: 0.75, pattern: 'primes', found: 140, body: 'triton',
    },
    {
        // The real "Wow!" signal of 15 August 1977, from Sagittarius: heard once, never again.
        id: 'wow', band: 'hydrogen', name: 'The Wow! signal · 6EQUJ5', unknown: 'Strong signal from Sagittarius',
        position: (out) => out.copy(WOW), reach: Infinity, pitch: 1.33, pattern: 'burst', found: 0, sky: true,
    },
    {
        id: 'derelict-belt', band: 'distress', name: 'Derelict survey ship Kepler', unknown: 'Automated distress beacon',
        position: (out) => out.copy(DERELICT), reach: AU * 3, pitch: 1, pattern: 'beacon', found: 3000,
    },
    {
        id: 'jupiter-roar', band: 'jovian', name: 'Jupiter · Io-driven bursts', unknown: 'Natural radio noise',
        position: (out) => out.copy((findBody('research') as ExpeditionBody).position), reach: AU * 5, pitch: 1, pattern: 'roar', found: 0,
    },
];

export interface RadioReading {
    band: Band;
    /** The source heard best, and how strongly (0..1): how squarely it is pointed at and how near. */
    source: RadioSource | null;
    strength: number;
    /** Angle (radians) between where the receiver points and the source. */
    off: number;
    /** How loud it would be pointed straight at it (0..1): whether it is worth searching for. */
    audible: number;
    distance: number;
}

const to = new THREE.Vector3();
const where = new THREE.Vector3();

/**
 * What the receiver hears pointing along `forward` from `from`. A source is
 * heard within a cone that widens as it nears (a faint one only dead ahead),
 * and its level falls off with distance.
 */
export const listen = (band: Band, from: THREE.Vector3, forward: THREE.Vector3, found: ReadonlySet<string>): RadioReading => {
    let best: RadioReading = { band, source: null, strength: 0, off: Math.PI, audible: 0, distance: Infinity };
    // The loudest place to search, when nothing is pointed at yet (never the sky: it is a needle in a haystack).
    let hint: RadioReading | null = null;
    for (const source of RADIO_SOURCES) {
        if (source.band !== band) continue;
        source.position(where);
        to.copy(where).sub(from);
        const distance = to.length();
        if (distance < 1) continue;
        to.divideScalar(distance);
        // How loud it would be: full within a tenth of its reach, gone at its reach.
        const audible = source.sky ? 0.9 : THREE.MathUtils.clamp(1 - Math.log10(Math.max(distance / (source.reach * 0.1), 1)), 0, 1);
        if (audible <= 0) continue;
        // The receiver's cone: 6 degrees for the faintest, 70 when close; 3 for a point in the sky.
        const cone = THREE.MathUtils.degToRad(source.sky ? 3 : 6 + 64 * audible * audible);
        const off = Math.acos(THREE.MathUtils.clamp(to.dot(forward), -1, 1));
        const aim = THREE.MathUtils.clamp(1 - off / cone, 0, 1);
        const strength = audible * aim * aim * (found.has(source.id) ? 0.85 : 1);
        if (strength > best.strength) best = { band, source, strength, off, audible, distance };
        if (!source.sky && (!hint || audible > hint.audible)) hint = { band, source, strength, off, audible, distance };
    }
    if (best.strength < 0.02 && hint) return hint;
    return best;
};

/** The pulsing a source is heard with at time `t` (0..1). Alien signals count out the primes. */
export const pulse = (pattern: RadioSource['pattern'], t: number) => {
    switch (pattern) {
        case 'primes': {
            // Groups of 2, 3, 5, 7 and 11 short beeps, a pause between groups.
            const groups = [2, 3, 5, 7, 11];
            const total = groups.reduce((sum, n) => sum + n * 0.22 + 0.9, 0);
            let at = t % total;
            for (const n of groups) {
                const span = n * 0.22;
                if (at < span) return (at % 0.22) < 0.12 ? 1 : 0;
                at -= span;
                if (at < 0.9) return 0;
                at -= 0.9;
            }
            return 0;
        }
        case 'beacon':
            return (t % 2) < 0.5 ? 1 : 0;
        case 'burst':
            return 0.6 + 0.4 * Math.sin(t * 3);
        case 'roar':
            return 0.4 + 0.6 * Math.abs(Math.sin(t * 0.7) * Math.sin(t * 2.3 + 1));
    }
};

/** The world a source lies on, if one. */
export const sourceBody = (source: RadioSource) => (source.body ? EXPEDITION_BODIES.find((b) => b.id === source.body) ?? null : null);
