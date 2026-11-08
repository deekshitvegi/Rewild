import * as THREE from 'three';
import { startSun, type ExpeditionBody } from './bodies';
import { fromEquatorial } from './orbits';
import { ringFrame } from './rings';

/**
 * The great storms of the giant planets, which can be flown into. There are no
 * tornadoes here (a tornado is a column of air touching the ground, and a giant
 * has no ground); what they have instead are vortices hundreds to thousands of
 * kilometres wide, the real ones, where they really are:
 *
 * - Jupiter: eight cyclones in a ring round one over the north pole and five
 *   round one in the south (Juno, 2017), and the Great Red Spot.
 * - Saturn: a hurricane on each pole, each with an eye and an eyewall (Cassini).
 * - Uranus: a cyclone on the north pole (radio images from the VLA, 2024).
 * - Neptune: a dark spot, an anticyclone the size of the Atlantic (Hubble 2018).
 *
 * Sizes are the real ones at the game's scale (giants are at true size, 1.88
 * units to the kilometre); winds are in units per second as the jets are.
 */
export type VortexKind = 'eye' | 'spiral' | 'clearing' | 'oval';

export interface Vortex {
    /** Which discovery it belongs to (VORTEX_SIGHTS). */
    sight: VortexSight;
    /** Its centre, a direction in the planet's frame. */
    dir: THREE.Vector3;
    /** How far its clouds wind out from the centre (units along the surface, east-west). */
    reach: number;
    /** The eye's radius (a cyclone with an eye), or its core's. */
    eye: number;
    /** Wind at the eyewall, units per second: positive turns anticlockwise seen from above. */
    wind: number;
    kind: VortexKind;
    /** How high the eyewall stands, as a share of the vortex layer (cloudScenes). */
    wall: number;
    /** North-south size over east-west (ovals). */
    aspect: number;
    /** Spiral arms: how many, and how tightly wound. */
    arms: number;
    tightness: number;
}

export type VortexSight = 'jovian-cyclones' | 'great-red-spot' | 'saturn-north-eye' | 'saturn-south-eye' | 'uranus-cyclone' | 'neptune-spot';

/** What finding each says (the discovery card). */
export const VORTEX_SIGHTS: Record<VortexSight, { name: string; blurb: string }> = {
    'jovian-cyclones': {
        name: "Jupiter's polar cyclones",
        blurb: 'Juno found them in 2017: eight cyclones packed in a ring round one over the north pole, and five round one in the south, each about as wide as the United States, with winds as fast as the strongest hurricanes on Earth. They have kept their places, like cells in a honeycomb, ever since. Most of Jupiter\'s lightning flashes up here, near the poles.',
    },
    'great-red-spot': {
        name: 'The Great Red Spot',
        blurb: 'A storm wider than Earth that has been turning for at least 150 years. It is an anticyclone, a dome of high pressure whose clouds stand kilometres above the rest, going round anticlockwise about once every six days with winds of over 400 km/h at its edge. It is shrinking: about 40,000 km long in the 1800s, barely 15,000 km now.',
    },
    'saturn-north-eye': {
        name: "Saturn's north polar hurricane",
        blurb: 'A hurricane parked on the north pole, inside the hexagon. Its eye is about 2,000 km across, twenty times wider than a hurricane\'s eye on Earth, and the clouds at its edge race round at 150 m/s (540 km/h). A hurricane on Earth wanders and dies over land; this one has no land to reach and stays where it is.',
    },
    'saturn-south-eye': {
        name: "Saturn's south polar hurricane",
        blurb: 'Cassini found it in 2006: a storm about 8,000 km across clamped on the south pole, the first hurricane with a true eye and eyewall seen on another planet. The wall of cloud round the eye towers 30 to 75 km above the clouds inside it, and the winds go round at about 550 km/h.',
    },
    'uranus-cyclone': {
        name: "Uranus's polar cyclone",
        blurb: 'Found in 2024 in years of radio images from the Very Large Array: a compact core of warm, dry air sinking over the north pole, ringed by fast winds, much like the polar cyclones of Saturn. The north is turning into summer now, after decades of darkness, and the pole is in sunlight.',
    },
    'neptune-spot': {
        name: "Neptune's dark spot",
        blurb: 'Hubble found this dark spot in 2018, and the VLT saw one from the ground in 2023: an anticyclone about as wide as the Atlantic, where the haze over the deep clouds is darker. Bright methane clouds form along its edge, the way clouds cap a mountain. Neptune\'s spots come and go in a few years; Voyager 2\'s Great Dark Spot of 1989 had gone by 1994.',
    },
};

/** Units to the kilometre for the giants (true size: Earth's 6,371 km is 12,000 units). */
const KM = 12000 / 6371;

const frameOf = (body: ExpeditionBody) => {
    const axis = fromEquatorial(body.gas!.pole[0], body.gas!.pole[1]);
    return ringFrame(axis);
};

/** A direction from latitude and longitude (radians) in the planet's frame (the same as the map's). */
const direction = (frame: ReturnType<typeof ringFrame>, lat: number, lon: number) => frame.e1.clone().multiplyScalar(Math.cos(lat) * Math.cos(lon))
    .addScaledVector(frame.e2, Math.cos(lat) * Math.sin(lon))
    .addScaledVector(frame.axis, Math.sin(lat))
    .normalize();

/**
 * Jupiter's polar rings, placed exactly as GasGiant's jovianPole paints them:
 * a cyclone `ring` radians from the pole every 1/n of the way round, the
 * north's turned 0.4 radians.
 */
export const JOVIAN_POLES = {
    north: { count: 8, ring: 0.1222, size: 0.023, turn: 0.4 },
    south: { count: 5, ring: 0.105, size: 0.0325, turn: 0 },
};

const make = (sight: VortexSight, dir: THREE.Vector3, o: Partial<Vortex> & Pick<Vortex, 'reach' | 'eye' | 'wind' | 'kind'>): Vortex => ({
    sight, dir, wall: 0.9, aspect: 1, arms: 2, tightness: 3, ...o,
});

const cache = new Map<string, Vortex[]>();

export const vorticesOf = (body: ExpeditionBody): Vortex[] => {
    const known = cache.get(body.id);
    if (known) return known;
    const list: Vortex[] = [];
    const gas = body.gas;
    if (gas && body.kind === 'gas') {
        const frame = frameOf(body);
        const R = body.radius;
        if (gas.polarCyclones) {
            for (const [hemisphere, ring] of [['north', JOVIAN_POLES.north], ['south', JOVIAN_POLES.south]] as const) {
                const pole = frame.axis.clone().multiplyScalar(hemisphere === 'north' ? 1 : -1);
                // Cyclones turn anticlockwise in the north, clockwise in the south.
                const sense = hemisphere === 'north' ? 1 : -1;
                const reach = ring.size * 1.6 * R;
                list.push(make('jovian-cyclones', pole.clone(), { reach: reach * 0.95, eye: reach * 0.24, wind: 95 * sense, kind: 'spiral', wall: 0.72, arms: 3, tightness: 2.6 }));
                for (let i = 0; i < ring.count; i++) {
                    const a = (i / ring.count) * Math.PI * 2 + ring.turn;
                    const dir = pole.clone().multiplyScalar(Math.cos(ring.ring))
                        .add(frame.e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(frame.e2, Math.sin(a)).multiplyScalar(Math.sin(ring.ring)))
                        .normalize();
                    list.push(make('jovian-cyclones', dir, { reach, eye: reach * 0.24, wind: 95 * sense, kind: 'spiral', wall: 0.72, arms: 3, tightness: 2.6 }));
                }
            }
        }
        if (gas.vortex && gas.map) {
            // The Great Red Spot, where the map has it (u east, v north).
            const lon = (gas.vortex.at[0] - 0.5) * Math.PI * 2;
            const lat = (gas.vortex.at[1] - 0.5) * Math.PI;
            const halfEW = gas.vortex.size[0] * Math.PI * 2 * Math.cos(lat) * R;
            const halfNS = gas.vortex.size[1] * Math.PI * R;
            list.push(make('great-red-spot', direction(frame, lat, lon), { reach: halfEW, eye: halfEW * 0.3, wind: 120 * gas.vortex.turn, kind: 'oval', aspect: halfNS / halfEW, arms: 2, tightness: 1.6 }));
        }
        if (gas.hexagon) {
            // Eye 2,000 km across (Cassini, 2012), the spiral clouds out to some 4,000 km.
            list.push(make('saturn-north-eye', frame.axis.clone(), { reach: 4000 * KM, eye: 1000 * KM, wind: 150, kind: 'eye', wall: 0.92, arms: 2, tightness: 3.2 }));
        }
        if (gas.decagon) {
            // About 8,000 km across, the eyewall 30-75 km high (Cassini, 2006).
            list.push(make('saturn-south-eye', frame.axis.clone().negate(), { reach: 4000 * KM, eye: 1100 * KM, wind: -153, kind: 'eye', wall: 0.97, arms: 2, tightness: 3 }));
        }
        if (gas.ice === 'uranus') {
            // Uranus spins backwards, so a cyclone over its (IAU) north pole turns clockwise seen from above it.
            list.push(make('uranus-cyclone', frame.axis.clone(), { reach: 3000 * KM, eye: 850 * KM, wind: -110, kind: 'eye', wall: 0.82, arms: 2, tightness: 2.4 }));
        }
        if (gas.ice === 'neptune' && gas.darkSpot) {
            // About 11,000 by 6,000 km; an anticyclone in the north turns clockwise.
            list.push(make('neptune-spot', darkSpotDirection(body), {
                reach: 5500 * KM, eye: 1500 * KM, wind: -100, kind: 'clearing', aspect: 0.55, arms: 2, tightness: 1.4,
            }));
        }
    }
    cache.set(body.id, list);
    return list;
};

/**
 * Neptune's dark spot: its latitude, and its longitude counted from local noon
 * when the expedition began (Neptune turns every 16 hours, so it comes round
 * into the day again).
 */
export const darkSpotDirection = (body: ExpeditionBody) => {
    const frame = frameOf(body);
    const [latitude, fromNoon] = body.gas!.darkSpot ?? [0, 0];
    const sun = startSun(body);
    const noon = Math.atan2(sun.dot(frame.e2), sun.dot(frame.e1));
    return direction(frame, THREE.MathUtils.degToRad(latitude), noon + THREE.MathUtils.degToRad(fromNoon));
};

/** East and north at a vortex (any pair at a pole). */
const east = new THREE.Vector3();
const north = new THREE.Vector3();
const tangent = (body: ExpeditionBody, v: Vortex) => {
    const frame = frameOf(body);
    east.crossVectors(Math.abs(frame.axis.dot(v.dir)) > 0.995 ? frame.e1 : frame.axis, v.dir).normalize();
    north.crossVectors(v.dir, east);
};

/** How far inside a vortex a point is (planet-relative): its distance from the centre over its reach, ovals measured as ovals. */
export const vortexRelative = (body: ExpeditionBody, v: Vortex, point: THREE.Vector3) => {
    const n = point.clone().normalize();
    const c = n.dot(v.dir);
    if (c <= 0) return Infinity;
    tangent(body, v);
    const d = n.addScaledVector(v.dir, -c);
    const x = d.dot(east) * body.radius;
    const y = (d.dot(north) / v.aspect) * body.radius;
    return Math.hypot(x, y) / v.reach;
};

/** The vortex a point (planet-relative) is in, if any, and how far in. */
export const vortexAt = (body: ExpeditionBody, point: THREE.Vector3) => {
    let best: Vortex | null = null;
    let rel = Infinity;
    for (const v of vorticesOf(body)) {
        const r = vortexRelative(body, v, point);
        if (r < rel) { rel = r; best = v; }
    }
    return best && rel < 1.35 ? { vortex: best, rel } : null;
};

/** The vortices nearest a point (planet-relative), nearest edge first, at most `count`. */
export const nearestVortices = (body: ExpeditionBody, point: THREE.Vector3, count: number) => {
    const n = point.clone().normalize();
    return vorticesOf(body)
        .map((v) => ({ v, gap: Math.acos(THREE.MathUtils.clamp(n.dot(v.dir), -1, 1)) * body.radius - v.reach }))
        .sort((a, b) => a.gap - b.gap)
        .slice(0, count);
};

/** A vortex packed for the cloud shader: centre and reach; eye, wind, kind, wall; aspect, tightness, arms. */
export const KIND_CODE: Record<VortexKind, number> = { eye: 0, spiral: 1, clearing: 2, oval: 3 };
export const packVortex = (v: Vortex | null, a: THREE.Vector4, b: THREE.Vector4, c: THREE.Vector4) => {
    if (!v) {
        a.set(0, 0, 0, 0);
        b.set(0, 0, 0, 0);
        c.set(1, 0, 0, 0);
        return;
    }
    a.set(v.dir.x, v.dir.y, v.dir.z, v.reach);
    b.set(v.eye, v.wind, KIND_CODE[v.kind], v.wall);
    c.set(v.aspect, v.tightness, v.arms, 0);
};
