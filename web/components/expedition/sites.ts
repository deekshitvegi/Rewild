import * as THREE from 'three';
import { SOLAR_SYSTEM_DATA } from '../../data';
import type { CelestialBodyData } from '../../types';
import { EXPEDITION_BODIES, findBody, startPosition, startSun, type ExpeditionBody } from './bodies';
import { ECLIPTIC_NORTH, fromEquatorial } from './orbits';
import { groundHeight, groundSpot } from './environment';
import { OBELISK_MESSAGE } from './glyphs';
import { SITE_RECORDS } from './records';

/**
 * The records of the worlds (records.ts). On each landable world they stand
 * as alien monoliths in a ring around a sunlit landing zone; Jupiter and
 * Saturn, which cannot be landed on, keep theirs on orbital data stations on
 * their sunlit sides; the ice giants' are on their moons; the Halcyon's relay
 * waits just above Earth; and the Obelisk at Earth's landing zone carries the
 * hidden message.
 */
export type SiteKind = 'ruin' | 'station' | 'obelisk';

export interface DataSite {
    id: string;
    kind: SiteKind;
    body: ExpeditionBody;
    entry: CelestialBodyData;
    /** On the ground for ruins and the Obelisk; in space for stations. World units. */
    position: THREE.Vector3;
    /** Local up: away from the planet for ruins, the station's axis for stations. */
    up: THREE.Vector3;
    inscription: string;
    color: string;
}

/** For a moon, the direction to the planet that fills its sky; nothing for a planet. */
const towardGiant = (body: ExpeditionBody) => {
    const giant = body.parent ? findBody(body.parent) : null;
    if (!giant) return null;
    return startPosition(giant).clone().sub(startPosition(body)).normalize();
};

// On a planet, the sun stands this high over the landing zone, and the
// arrival faces this far round from it: in view near the left of the frame,
// lighting the land from the side.
const PLANET_SUN = THREE.MathUtils.degToRad(28);
const PLANET_FACING = THREE.MathUtils.degToRad(42);

/** Unit vector at right angles to `v`, as level with the ecliptic as possible. */
const across = (v: THREE.Vector3) => {
    const out = new THREE.Vector3().crossVectors(v, ECLIPTIC_NORTH);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0).cross(v);
    return out.normalize();
};

/** Below this the placement below is lifted: the spot would be at dusk or in the dark. */
const SUN_FLOOR = Math.sin(THREE.MathUtils.degToRad(10));
const SUN_LIFT = THREE.MathUtils.degToRad(16);
const SUN_LOWEST = THREE.MathUtils.degToRad(9);
const GIANT_CLEAR = THREE.MathUtils.degToRad(4);
const GIANT_AIM = Math.sin(THREE.MathUtils.degToRad(25));

/**
 * The spot on a world where its sites stand and the expedition sets down.
 *
 * On a planet: in the northern mid-latitudes, where the sun stands about 26
 * degrees up, low enough for long light and shadows, high enough that the
 * land is lit (then moved to the most open ground nearby, see openGround).
 *
 * On a moon, its planet fills part of the sky, as the ringed giant does in
 * the reference video: the sun hangs low (about twelve degrees up) and the
 * planet a little higher, on either side of the way ahead, lit on the side
 * facing the sun. Where the planet stands nearly opposite the sun, that rule
 * lands at dusk or at night, so there the sun is put 16 degrees up instead
 * and the planet as near 25 degrees up as the geometry allows; where the two
 * are so nearly opposite that both cannot stand that high, the sun comes down
 * as far as 9 degrees so the planet can clear the horizon, rising opposite
 * the low sun like a full moon.
 */
const idealZone = (body: ExpeditionBody): { zone: THREE.Vector3; lifted: boolean } => {
    const sun = startSun(body);
    const toGiant = towardGiant(body);
    if (!toGiant) {
        // A planet: the sun 28 degrees up, in the northern mid-latitudes.
        const side = across(sun);
        const zone = sun.clone().multiplyScalar(Math.sin(PLANET_SUN)).addScaledVector(side, Math.cos(PLANET_SUN)).addScaledVector(ECLIPTIC_NORTH, 0.35).normalize();
        return { zone, lifted: true };
    }
    const sideways = new THREE.Vector3().crossVectors(toGiant, sun);
    if (sideways.lengthSq() < 1e-4) {
        return { zone: toGiant.multiplyScalar(0.55).add(sun.clone().multiplyScalar(0.8)).add(new THREE.Vector3(0, 0.3, 0)).normalize(), lifted: false };
    }
    sideways.normalize();
    // Of the two sides of the giant-sun plane, take the one facing "up" in the system.
    if (sideways.y < 0) sideways.negate();
    const zone = sideways.clone().addScaledVector(toGiant, 0.3).addScaledVector(sun, 0.15).normalize();
    if (zone.dot(sun) >= SUN_FLOOR) return { zone, lifted: false };

    // up = sun * sin(lift) + (a cos(phi) + b sin(phi)) * cos(lift), with a the
    // giant's direction square to the sun: phi sets how high the giant stands.
    const along = toGiant.dot(sun);
    const a = toGiant.clone().addScaledVector(sun, -along);
    const reach = a.length();
    a.divideScalar(reach);
    const b = new THREE.Vector3().crossVectors(sun, a);
    // Sun and giant can stand at most this high between them (the angle that
    // is left once the one between them is taken from a half turn).
    const room = Math.PI - Math.acos(THREE.MathUtils.clamp(along, -1, 1));
    const lift = THREE.MathUtils.clamp(room - GIANT_CLEAR, SUN_LOWEST, SUN_LIFT);
    const sinLift = Math.sin(lift);
    const cosLift = Math.cos(lift);
    const cosPhi = THREE.MathUtils.clamp((GIANT_AIM - sinLift * along) / (cosLift * reach), -1, 1);
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const lifted = (side: number) => sun.clone().multiplyScalar(sinLift)
        .addScaledVector(a, cosLift * cosPhi)
        .addScaledVector(b, cosLift * sinPhi * side)
        .normalize();
    const one = lifted(1);
    const other = lifted(-1);
    return { zone: one.y >= other.y ? one : other, lifted: true };
};

/** The arrival's heading at a spot whose up is `up` (see openingHeading). */
const headingAt = (body: ExpeditionBody, up: THREE.Vector3) => {
    const flat = (v: THREE.Vector3) => v.clone().addScaledVector(up, -v.dot(up)).normalize();
    const sun = flat(startSun(body));
    const toGiant = towardGiant(body);
    if (!toGiant) return sun.applyAxisAngle(up, -PLANET_FACING);
    const giant = flat(toGiant);
    if (giant.dot(sun) < -0.5) return giant;
    return giant.multiplyScalar(0.45).addScaledVector(sun, 0.55).normalize();
};

/**
 * A lifted zone is put down wherever the lift lands, which can be a canyon
 * floor under a cliff. Within about half a kilometre (which moves the sun and
 * the giant by a couple of degrees at most) take the spot with the most open
 * outlook: a low skyline the way the arrival faces, and level ground for the
 * ring of monoliths.
 */
const openGround = (body: ExpeditionBody, ideal: THREE.Vector3) => {
    const radius = body.radius;
    // On a small moon everything shrinks with it: a search a few hundred
    // metres wide would wander a quarter of the way round Phobos, into night.
    const scale = THREE.MathUtils.clamp(radius / 2500, 0.08, 1);
    const tangent = new THREE.Vector3(0, 1, 0).cross(ideal);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0).cross(ideal);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(ideal, tangent);
    const away = (from: THREE.Vector3, a: THREE.Vector3, da: number, b: THREE.Vector3, db: number) =>
        from.clone().multiplyScalar(radius).addScaledVector(a, da).addScaledVector(b, db).normalize();
    let best = ideal;
    let bestScore = Infinity;
    for (let ring = 0; ring <= 5; ring++) {
        const count = ring === 0 ? 1 : 10;
        const reach = ring * 90 * scale;
        for (let k = 0; k < count; k++) {
            const angle = (k / count) * Math.PI * 2 + ring * 0.37;
            const spot = away(ideal, tangent, Math.cos(angle) * reach, bitangent, Math.sin(angle) * reach);
            // Not on a lake or the sea, nor its shore (flat water would otherwise score best).
            if (groundSpot(body, spot).shore < 24) continue;
            const floor = groundHeight(body, spot);
            const heading = headingAt(body, spot);
            const side = new THREE.Vector3().crossVectors(spot, heading).normalize();
            // Highest angle the ground ahead rises to, seen from a few metres up.
            let skyline = -90;
            for (const step of [80, 160, 260, 400, 600, 850]) {
                const distance = step * scale;
                const rise = groundHeight(body, away(spot, heading, distance, side, 0)) - floor - 6 * scale;
                skyline = Math.max(skyline, THREE.MathUtils.radToDeg(Math.atan2(rise, distance)));
            }
            // How uneven the ground is where the monoliths stand.
            let low = floor;
            let high = floor;
            for (let j = 0; j < 8; j++) {
                const a = (j / 8) * Math.PI * 2;
                const h = groundHeight(body, away(spot, heading, Math.cos(a) * 80 * scale, side, Math.sin(a) * 80 * scale));
                low = Math.min(low, h);
                high = Math.max(high, h);
            }
            const score = Math.max(skyline, 0) + ((high - low) * 0.25 + reach * 0.004) / scale;
            if (score < bestScore) {
                bestScore = score;
                best = spot;
            }
        }
    }
    return best;
};

const zones = new Map<string, THREE.Vector3>();

export const landingZoneDirection = (body: ExpeditionBody) => {
    let zone = zones.get(body.id);
    if (!zone) {
        const ideal = idealZone(body);
        // A world whose map is pinned to the zone (Earth, at Dallas) takes the
        // ideal spot as it is: its ground comes from the map placed there.
        zone = ideal.lifted && body.kind === 'rocky' && !body.globe?.anchor ? openGround(body, ideal.zone) : ideal.zone;
        zones.set(body.id, zone);
    }
    return zone.clone();
};

/**
 * The frame a world's map is wrapped in, as rows: longitude 0, north, and
 * longitude 90 east. North is the world's real pole; where an anchor is
 * given, the pole is tipped the least it must be for the anchor's latitude to
 * be the landing zone's, and turned so the anchor's longitude is there too.
 */
export const globeFrame = (body: ExpeditionBody) => {
    const globe = body.globe;
    const frame = new THREE.Matrix3();
    if (!globe) return frame;
    let north = fromEquatorial(globe.pole[0], globe.pole[1]);
    let zero: THREE.Vector3;
    if (globe.anchor) {
        const [lat, lon] = globe.anchor.map(THREE.MathUtils.degToRad);
        const zone = landingZoneDirection(body);
        const towardPole = north.clone().addScaledVector(zone, -north.dot(zone)).normalize();
        north = zone.clone().multiplyScalar(Math.sin(lat)).addScaledVector(towardPole, Math.cos(lat)).normalize();
        const meridian = zone.clone().addScaledVector(north, -zone.dot(north)).normalize();
        zero = meridian.applyAxisAngle(north, -lon);
    } else if (globe.faces && findBody(globe.faces)) {
        // A moon that keeps one face to its planet: longitude 0 points at it.
        zero = startPosition(findBody(globe.faces)!).clone().sub(startPosition(body));
        zero.addScaledVector(north, -zero.dot(north)).normalize();
    } else if (globe.noon !== undefined && startSun(body).lengthSq() > 0) {
        // Turned so the Sun stands over longitude `noon` (when the expedition began).
        const sun = startSun(body);
        zero = sun.clone().addScaledVector(north, -sun.dot(north)).normalize()
            .applyAxisAngle(north, -THREE.MathUtils.degToRad(globe.noon));
    } else {
        zero = new THREE.Vector3(1, 0, 0).addScaledVector(north, -north.x);
        if (zero.lengthSq() < 1e-6) zero.set(0, 0, 1).addScaledVector(north, -north.z);
        zero.normalize();
    }
    const east = new THREE.Vector3().crossVectors(north, zero);
    return frame.set(zero.x, zero.y, zero.z, north.x, north.y, north.z, east.x, east.y, east.z);
};

/**
 * The way the expedition faces on arrival. On a planet, 42 degrees round from
 * the sun, which is then in view near the edge of the frame and lights the
 * land from the side. On a moon, between the sun and its planet, so both are
 * in view; or, where the planet stands opposite the sun, towards it with the
 * sun behind, so the land and the planet are both lit face-on.
 */
export const openingHeading = (body: ExpeditionBody) => headingAt(body, landingZoneDirection(body));

const letters = (text: string) => text.toUpperCase().replace(/[^A-Z .]/g, '').replace(/\s+/g, ' ').trim();

const tangentBasis = (up: THREE.Vector3) => {
    const tangent = new THREE.Vector3(0, 1, 0).cross(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(up, tangent).normalize();
    return { tangent, bitangent };
};

// (In the game's frame of the start: DataSites and the HUD put it where its world is now.)
const groundPoint = (body: ExpeditionBody, direction: THREE.Vector3) =>
    startPosition(body).clone().addScaledVector(direction, body.radius + groundHeight(body, direction));

/**
 * What a site says in the game: its record of the world it stands on (records.ts), in place of the
 * portfolio entry it was laid out from. Nothing of the portfolio shows in the game; the entry only
 * decides how many sites a world has and keeps their ids (so what was read stays read).
 */
const asRecord = (id: string, entry: CelestialBodyData): CelestialBodyData => {
    const record = SITE_RECORDS[id];
    if (!record) return entry;
    return {
        ...entry,
        name: record.name,
        description: record.description,
        about: record.about,
        details: record.details,
        location: record.location,
        portfolioLabel: undefined,
        date: undefined,
        link: undefined,
        linkLabel: undefined,
        moons: undefined,
    };
};

const buildSites = (): DataSite[] => {
    const sites: DataSite[] = [];
    for (const body of EXPEDITION_BODIES) {
        if (body.kind === 'star') continue;
        if (body.kind === 'rocky') {
            const zone = landingZoneDirection(body);
            const { tangent, bitangent } = tangentBasis(zone);
            body.entries.forEach((entry, i) => {
                const angle = (i / body.entries.length) * Math.PI * 2 + 0.4;
                const place = (reach: number) => zone.clone().multiplyScalar(body.radius)
                    .addScaledVector(tangent, Math.cos(angle) * reach)
                    .addScaledVector(bitangent, Math.sin(angle) * reach)
                    .normalize();
                // Out of any river: the next dry spot along the same bearing.
                let reach = 60 + (i % 2) * 34;
                for (let k = 0; k < 8 && groundSpot(body, place(reach)).water > 0; k++) reach += k % 2 ? -16 * (k + 1) : 16 * (k + 1);
                const direction = place(reach);
                const id = `${body.id}:${entry.id}`;
                const record = asRecord(id, entry);
                sites.push({
                    id,
                    kind: 'ruin',
                    body,
                    entry: record,
                    position: groundPoint(body, direction),
                    up: direction.clone(),
                    inscription: letters(record.name),
                    color: body.color,
                });
            });
        } else {
            // Stations wait on the giant's sunlit side, a little above its equator.
            const toward = startSun(body).clone().addScaledVector(ECLIPTIC_NORTH, 0.25).normalize();
            const distance = body.radius * (body.gas?.rings ? body.gas.rings.outer + 0.25 : 1.45);
            const base = startPosition(body).clone().addScaledVector(toward, distance);
            const { tangent, bitangent } = tangentBasis(toward);
            body.entries.forEach((entry, i) => {
                const angle = (i / body.entries.length) * Math.PI * 2;
                const id = `${body.id}:${entry.id}`;
                const record = asRecord(id, entry);
                sites.push({
                    id,
                    kind: 'station',
                    body,
                    entry: record,
                    position: base.clone().addScaledVector(tangent, Math.cos(angle) * 1400).addScaledVector(bitangent, Math.sin(angle) * 1400),
                    up: toward.clone(),
                    inscription: letters(record.name),
                    color: body.color,
                });
            });
        }
    }

    // The Halcyon's relay just above Earth, and the Obelisk at the heart of
    // Earth's landing zone, where the expedition begins.
    const earth = findBody('projects')!;
    const zone = landingZoneDirection(earth);
    const relay = asRecord('about', SOLAR_SYSTEM_DATA);
    sites.push({
        id: 'about',
        kind: 'station',
        body: earth,
        entry: relay,
        position: startPosition(earth).clone().addScaledVector(zone.clone().lerp(startSun(earth), 0.35).normalize(), earth.radius + 7000),
        up: zone.clone(),
        inscription: letters(relay.name),
        color: '#FDB813',
    });
    sites.push({
        id: 'obelisk',
        kind: 'obelisk',
        body: earth,
        entry: {
            id: 'obelisk',
            type: 'moon',
            name: 'The Obelisk',
            description: 'An obelisk older than the system itself',
            about: 'Its surface is covered in the same script as every data site. Learn the glyphs across the system and the message will read itself.',
            color: '#FDB813',
            size: 1,
            orbitRadius: 0,
            orbitSpeed: 0,
        },
        position: groundPoint(earth, zone),
        up: zone.clone(),
        inscription: OBELISK_MESSAGE,
        color: '#FDB813',
    });
    return sites;
};

/**
 * Every site, once prepareSites() has placed them (after the Earth map has
 * loaded, since the sites stand on the ground it shapes).
 */
export const DATA_SITES: DataSite[] = [];
export const prepareSites = () => {
    if (!DATA_SITES.length) DATA_SITES.push(...buildSites());
    return DATA_SITES;
};

export const sitesOf = (bodyId: string) => DATA_SITES.filter((site) => site.body.id === bodyId && site.kind !== 'station');
