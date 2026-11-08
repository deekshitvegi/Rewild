import * as THREE from 'three';
import { EXPEDITION_BODIES, THE_SUN, type ExpeditionBody } from './bodies';

/**
 * Eclipses: how much of the Sun's disc a world covers, seen from a point.
 *
 * With the planets at their true distances (30 Oct 2026) the Sun and the Moon are both about half
 * a degree across from Earth, as they really are, so the Moon can cover the Sun exactly. Seen from
 * the ground at its mean distance the Moon is a shade smaller than the Sun and leaves a ring of fire
 * (an annular eclipse); in its shadow cone in space, nearer the Moon than the cone's tip, it covers
 * the Sun completely and the corona comes out. The same holds for every world and every moon: Earth
 * eclipsing the Sun seen from the Moon, Jupiter seen from Io, Saturn from its rings.
 */

/** The share of a disc of angular radius `a` that a disc of radius `b`, `d` away, covers (small angles). */
export const discOverlap = (a: number, b: number, d: number) => {
    if (a <= 0) return 0;
    if (d >= a + b) return 0;
    if (d <= Math.abs(a - b)) return b >= a ? 1 : (b * b) / (a * a);
    const alpha = Math.acos(THREE.MathUtils.clamp((d * d + a * a - b * b) / (2 * d * a), -1, 1));
    const beta = Math.acos(THREE.MathUtils.clamp((d * d + b * b - a * a) / (2 * d * b), -1, 1));
    const lens = a * a * alpha + b * b * beta - 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)));
    return THREE.MathUtils.clamp(lens / (Math.PI * a * a), 0, 1);
};

export interface SunCover {
    /** The share of the Sun's disc hidden (0 to 1). */
    coverage: number;
    /** The world hiding it, if any. */
    body: ExpeditionBody | null;
    /** Its angular radius over the Sun's: above 1 it can cover the Sun completely. */
    ratio: number;
}

const toSun = new THREE.Vector3();
const toBody = new THREE.Vector3();

/** What hides the Sun from `eye`, leaving out `exclude` (the world underfoot: its horizon is sunset, not an eclipse). */
export const sunCover = (eye: THREE.Vector3, exclude: ExpeditionBody | null, out: SunCover): SunCover => {
    out.coverage = 0;
    out.body = null;
    out.ratio = 0;
    toSun.copy(THE_SUN.position).sub(eye);
    const sunDistance = toSun.length();
    if (sunDistance <= THE_SUN.radius) return out;
    toSun.divideScalar(sunDistance);
    const a = Math.asin(THE_SUN.radius / sunDistance);
    for (const body of EXPEDITION_BODIES) {
        if (body.kind === 'star' || body === exclude) continue;
        toBody.copy(body.position).sub(eye);
        const distance = toBody.length();
        if (distance >= sunDistance || distance <= body.radius) continue;
        const along = toBody.dot(toSun);
        if (along <= 0) continue;
        const b = Math.asin(body.radius / distance);
        const d = Math.acos(THREE.MathUtils.clamp(along / distance, -1, 1));
        if (d >= a + b) continue;
        const coverage = discOverlap(a, b, d);
        if (coverage > out.coverage) {
            out.coverage = coverage;
            out.body = body;
            out.ratio = b / a;
        }
    }
    return out;
};

/** How long a world's full shadow (umbra) reaches behind it, from its centre. */
export const umbraLength = (body: ExpeditionBody) => {
    const sunDistance = body.position.distanceTo(THE_SUN.position);
    return (body.radius * sunDistance) / Math.max(1, THE_SUN.radius - body.radius);
};

/** The point `share` of the way down a world's umbra, on the line from the Sun through it. */
export const umbraPoint = (body: ExpeditionBody, share: number, out: THREE.Vector3) =>
    out.copy(body.position).sub(THE_SUN.position).normalize().multiplyScalar(umbraLength(body) * share).add(body.position);
