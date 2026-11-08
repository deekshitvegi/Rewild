import * as THREE from 'three';

/**
 * Where the planets really are. Keplerian elements for the eight planets
 * (JPL, "Approximate Positions of the Planets", E. M. Standish, valid
 * 1800-2050), and the Moon from its mean elements. The expedition begins
 * today, with everything where it is in the real sky, and moves on from there
 * (motion.ts).
 *
 * Positions are heliocentric ecliptic (J2000) in astronomical units; the
 * world's Y axis is ecliptic north, X points to the March equinox and Z is
 * minus ecliptic Y, so the system lies in the XZ plane seen from above.
 */

/**
 * The date the expedition begins at: now. The test pages (lab/) keep one
 * fixed date so their pictures can be compared from day to day; ?date= sets
 * any other.
 */
const FIXED_DATE = new Date(Date.UTC(2026, 8, 30, 0, 0, 0));
const startDate = () => {
    if (typeof window === 'undefined') return FIXED_DATE;
    const asked = new URLSearchParams(window.location.search).get('date');
    const date = asked ? new Date(asked) : null;
    if (date && !Number.isNaN(date.getTime())) return date;
    return window.location.pathname.includes('/lab/') ? FIXED_DATE : new Date();
};
export const EPOCH = startDate();

export type PlanetName = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

// a (AU), e, I, L, long. perihelion, long. ascending node (degrees), and the
// rate of L per Julian century. The slower rates of the others are left out:
// over a quarter of a century they move the planets by a fraction of a degree.
const ELEMENTS: Record<PlanetName, [number, number, number, number, number, number, number]> = {
    mercury: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 149472.67411175],
    venus: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 58517.81538729],
    earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0, 35999.37244981],
    mars: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 19140.30268499],
    jupiter: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 3034.74612775],
    saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 1222.49362201],
    uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, 428.48202785],
    neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 218.45945325],
    // Pluto, from the same tables (good to a degree or so over these decades).
    pluto: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, 145.20780515],
};

const DEG = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
const daysSinceJ2000 = (date: Date) => (date.getTime() - J2000) / 86400000;

/** Ecliptic (x, y, z) in AU to world axes (x, z-up becomes y-up). */
const toWorld = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

/** Heliocentric position of a planet at `date`, in AU, in world axes. */
export const planetPosition = (name: PlanetName, date: Date = EPOCH) => {
    const [a, e, inclination, meanLongitude, perihelion, node, rate] = ELEMENTS[name];
    const T = daysSinceJ2000(date) / 36525;
    const L = meanLongitude + rate * T;
    const w = (perihelion - node) * DEG;
    const O = node * DEG;
    const I = inclination * DEG;
    // Mean anomaly, then the eccentric anomaly by Newton's method.
    let M = ((L - perihelion) % 360) * DEG;
    if (M > Math.PI) M -= 2 * Math.PI;
    if (M < -Math.PI) M += 2 * Math.PI;
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
    const x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
    const y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
    const z = sw * sI * xp + cw * sI * yp;
    return toWorld(x, y, z);
};

/**
 * Direction from the Earth to the Moon at `date` (unit vector, world axes),
 * from its mean longitude, anomaly and node: good to a degree or so.
 */
export const moonDirection = (date: Date = EPOCH) => {
    const d = daysSinceJ2000(date);
    const L = 218.316 + 13.176396 * d;
    const M = (134.963 + 13.064993 * d) * DEG;
    const F = (93.272 + 13.22935 * d) * DEG;
    const longitude = (L + 6.289 * Math.sin(M)) * DEG;
    const latitude = 5.128 * Math.sin(F) * DEG;
    const x = Math.cos(latitude) * Math.cos(longitude);
    const y = Math.cos(latitude) * Math.sin(longitude);
    const z = Math.sin(latitude);
    return toWorld(x, y, z).normalize();
};

/** Ecliptic north in world axes. */
export const ECLIPTIC_NORTH = new THREE.Vector3(0, 1, 0);

const OBLIQUITY = 23.4393 * DEG;

/** A direction given in equatorial coordinates (degrees), in world axes. */
export const fromEquatorial = (ra: number, dec: number) => {
    const x = Math.cos(dec * DEG) * Math.cos(ra * DEG);
    const y = Math.cos(dec * DEG) * Math.sin(ra * DEG);
    const z = Math.sin(dec * DEG);
    return toWorld(x, y * Math.cos(OBLIQUITY) + z * Math.sin(OBLIQUITY), -y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY)).normalize();
};
