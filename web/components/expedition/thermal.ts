import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';

/**
 * How hot the ground is where the explorer stands, from each world's measured
 * extremes: where the Sun stands overhead (day) and at night, in kelvin. On
 * an airless world the ground follows the Sun closely, as the fourth root of
 * how squarely it shines (the Moon's equator reaches 390 K at noon and drops
 * to 95 K at night, as LRO's Diviner measured); thick air evens it out
 * (Venus is 737 K everywhere, Titan 94 K); thin air in between (Mars).
 *
 * A spacesuit copes with a range: NASA's suit for the Moon's south pole is
 * built for about -235 °C to +120 °C. Colder than that is not met on the
 * worlds here; hotter (the floor of Venus, Mercury by day) the suit's cooling
 * runs down against the heat, and when it is spent the heat does harm. The
 * ship's own cooling restores it.
 */
export interface Climate {
    day: number;
    night: number;
    air: 'none' | 'thin' | 'thick';
    /** Air pressure at the ground, bar (0: vacuum, or as good as). */
    bar?: number;
}

const CLIMATES: Record<string, Climate> = {
    education: { day: 700, night: 100, air: 'none' },   // Mercury (MESSENGER)
    experience: { day: 737, night: 737, air: 'thick', bar: 92 }, // Venus
    projects: { day: 302, night: 286, air: 'thick', bar: 1.0 },   // Earth: Dallas in early October
    haven: { day: 291, night: 291, air: 'thick', bar: 0.9 },      // Haven: one long day under the disk
    moon: { day: 390, night: 95, air: 'none' },
    skills: { day: 293, night: 180, air: 'thin', bar: 0.006 },      // Mars
    phobos: { day: 270, night: 160, air: 'none' },
    deimos: { day: 270, night: 160, air: 'none' },
    io: { day: 130, night: 90, air: 'none' },
    europa: { day: 130, night: 85, air: 'none' },
    ganymede: { day: 152, night: 80, air: 'none' },
    callisto: { day: 165, night: 80, air: 'none' },
    mimas: { day: 92, night: 70, air: 'none' },
    enceladus: { day: 80, night: 50, air: 'none' },
    tethys: { day: 92, night: 70, air: 'none' },
    dione: { day: 100, night: 70, air: 'none' },
    rhea: { day: 100, night: 55, air: 'none' },
    titan: { day: 94, night: 94, air: 'thick', bar: 1.47 },        // Huygens: 93.7 K
    iapetus: { day: 130, night: 90, air: 'none' },
    miranda: { day: 86, night: 55, air: 'none' },
    ariel: { day: 86, night: 55, air: 'none' },
    umbriel: { day: 86, night: 55, air: 'none' },
    titania: { day: 86, night: 55, air: 'none' },
    oberon: { day: 86, night: 55, air: 'none' },
    triton: { day: 38, night: 38, air: 'thin', bar: 0.000014 },
    pluto: { day: 45, night: 38, air: 'thin', bar: 0.00001 },
    charon: { day: 55, night: 40, air: 'none' },
};

/** The hottest the suit holds out against indefinitely (K): +120 °C. */
export const SUIT_HOT = 393;
/** Seconds the suit's cooling lasts on the floor of Venus, the hottest ground there is. */
const VENUS_SECONDS = 180;

/** Ground temperature (K) at a direction from a world's centre. */
export const surfaceKelvin = (body: ExpeditionBody, up: THREE.Vector3) => {
    const climate = CLIMATES[body.id];
    if (!climate) return 250;
    const sun = Math.max(0, up.dot(body.sunDirection));
    const share = climate.air === 'none' ? Math.pow(sun, 0.25) : climate.air === 'thin' ? Math.sqrt(sun) : sun;
    return Math.max(climate.night, climate.night + (climate.day - climate.night) * share);
};

export const celsius = (kelvin: number) => kelvin - 273.15;

/** How fast (per second) the suit's cooling runs down at a ground temperature. */
export const coolingDrain = (kelvin: number) => kelvin <= SUIT_HOT ? 0 : (kelvin - SUIT_HOT) / ((737 - SUIT_HOT) * VENUS_SECONDS);

/** What the ground is like here, for the HUD: "464 °C · 92 bar", "25 °C · vacuum". */
export const groundReadout = (body: ExpeditionBody, kelvin: number) => {
    const bar = CLIMATES[body.id]?.bar ?? 0;
    const air = bar <= 0 ? 'vacuum' : bar >= 10 ? `${Math.round(bar)} bar` : bar >= 0.1 ? `${bar.toFixed(bar >= 1 ? 1 : 2)} bar` : bar >= 0.001 ? `${bar.toFixed(3)} bar` : `${(bar * 1e6).toFixed(0)} microbar`;
    return `${Math.round(celsius(kelvin))} °C · ${air}`;
};
