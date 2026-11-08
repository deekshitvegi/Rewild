import * as THREE from 'three';
import { AU, EXPEDITION_BODIES } from './bodies';
import { pinDirection } from './motion';

/**
 * What can kill the ship in space: the Sun's heat, and rock.
 *
 * Heat. The hull settles at the temperature of a dark body at its distance
 * from the Sun, T = 278.6 K / sqrt(d in AU): 279 K at Earth, 448 K at Mercury,
 * about 2,000 K at the Sun's visible surface here. Its heat shield is rated,
 * like the Parker Solar Probe's, to about 1,600 K; above that it burns away,
 * faster the hotter it gets.
 *
 * Rock. The main belt (2.0 to 3.45 AU) and the Kuiper belt (29 to 52 AU) hold
 * scattered asteroids, and crossing a belt on the pulse drive can pull the
 * ship out into a dense cluster that it has to fly clear of before the drive
 * will engage again.
 */
export const SUN = EXPEDITION_BODIES.find((body) => body.kind === 'star')!;

/** Seconds from losing the ship to the new one waiting where the last landed. */
export const LOSS_SECONDS = 6;

/** The heat shield's rating. */
export const HEAT_LIMIT = 1600;
/** Where the HUD starts warning. */
export const HEAT_WARNING = 1300;

/** Hull temperature (kelvin) at a point. */
export const hullTemperature = (position: THREE.Vector3) => {
    const d = Math.max(position.distanceTo(SUN.position), SUN.radius) / AU;
    return 278.6 / Math.sqrt(d);
};

/** Distance from the Sun's centre at which the hull reaches `kelvin`. */
export const distanceAtTemperature = (kelvin: number) => (278.6 / kelvin) ** 2 * AU;

/** Shield lost per second at a hull temperature: none up to the rating. */
export const heatDamage = (kelvin: number) => (kelvin <= HEAT_LIMIT ? 0 : 0.6 * ((kelvin - HEAT_LIMIT) / 400) ** 1.5);

const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

// Ecliptic north in the game's frame, which turns as it follows a world (motion.ts).
const NORTH = pinDirection(new THREE.Vector3(0, 1, 0));
const fromSun = new THREE.Vector3();
/** A point's distance from the Sun in the plane of the planets, and its height off it, AU. */
const ecliptic = (p: THREE.Vector3) => {
    fromSun.copy(p).sub(SUN.position);
    const h = fromSun.dot(NORTH);
    return { r: Math.sqrt(Math.max(0, fromSun.lengthSq() - h * h)) / AU, h: Math.abs(h) / AU };
};

/** How thick the main belt and the Kuiper belt are at a point (0 outside them). */
export const beltDensity = (p: THREE.Vector3) => {
    const { r, h } = ecliptic(p);
    return smooth(2.0, 2.25, r) * (1 - smooth(3.2, 3.45, r)) * (1 - smooth(0.1, 0.25, h)) * 0.55
        + smooth(29, 31, r) * (1 - smooth(48, 52, r)) * (1 - smooth(2, 4, h)) * 0.4;
};

/** Which belt a point is in, if any (for the records). */
export const beltAt = (p: THREE.Vector3): 'belt' | 'kuiper' | null => {
    const { r } = ecliptic(p);
    if (beltDensity(p) < 0.05) return null;
    return r < 10 ? 'belt' : 'kuiper';
};

/** A dense cluster the pulse drive was pulled out into. */
export interface AsteroidField {
    center: THREE.Vector3;
    radius: number;
    /** Seeds its rocks, so a field is the same however often it is crossed. */
    seed: number;
    /** Where the ship was pulled out: kept clear of rock. */
    entry: THREE.Vector3;
}

export const FIELD_RADIUS = 9000;

/** Rocks per FIELD_CELL cube at a point of a field: thickest at its heart. */
export const fieldDensity = (field: AsteroidField, p: THREE.Vector3) => {
    const x = p.distanceTo(field.center) / field.radius;
    return x >= 1 ? 0 : 0.9 * (1 - smooth(0.35, 1, x)) + 0.25 * (1 - smooth(0.85, 1, x));
};
