import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Apple, Gem, Landmark, PawPrint, ScrollText } from 'lucide-react';
import { EXPEDITION_BODIES, findBody, formatDistance, type ExpeditionBody } from './bodies';
import { findExpedition, startRun } from './expeditions';
import { beginExpedition } from './Argo';
import { fallClock, fallStage, formatShipTime } from './fall';
import { BEAT } from './crossing';
import { cue, type ExpeditionRuntime } from './runtime';
import { directionToBody, fromStart, motionDate, turnWithWorld } from './motion';
import type { ExpeditionInput } from './input';
import { ALPHABET, GLYPH_PATHS, type ExpeditionProgress } from './glyphs';
import { DATA_SITES } from './sites';
import { speciesOf } from './Wildlife';
import { BLACK_HOLE, WORMHOLES, timeDilation } from './deepSpace';
import { MapDialog } from './SystemMap';
import { CraftPanel } from './CraftPanel';
import { GraphicsPanel, type GraphicsControl } from './GraphicsPanel';
import { effectiveVolumes, loadSoundSettings, saveSoundSettings } from './soundSettings';
import { Prologue, StoryLog, StoryPanel, prologueRead } from './StoryPanel';
import { havenColony, storyState, type StoryState } from './quests';
import { FORAGE_NAME } from './survival';
import { TouchControls, useCoarsePointer } from './TouchControls';
import { HEAT_LIMIT, HEAT_WARNING, LOSS_SECONDS, SUN, beltAt } from './hazards';
import { gasModel, pressureAt, temperatureAt } from './gasAtmosphere';
import { soundEngine } from './audio';
import { BANDS } from './radio';
import { nextBand } from './Radio';
import { fromEquatorial } from './orbits';
import { ringName } from './rings';
import { narrowRingAt } from './IceRings';
import { weatherMessage, windWords } from './weather';
import { jumpHeight, jumpTime, lowGravity, surfaceGravity } from './walking';
import { SAMPLE_TUBES, siteFrame, sitesOn, tubeId } from './history';
import { siteOn, sitePosition } from './aliens';
import { contactNow } from './contact';
import { landmarkPosition, landmarksOn } from './landmarks';
import { SUIT_HOT, coolingDrain, groundReadout } from './thermal';
import { VORTEX_SIGHTS, vorticesOf } from './vortices';
import { Compass } from './Compass';
import { REVIVAL, earthRevival } from './revival';
import { setAshSky } from './surfaceShading';
import { FLIGHT_STEPS, advanceFirstFlight, flying, loadFirstFlight, skipFirstFlight, type FirstFlight } from './firstFlight';
import { crewCards, type CrewCard } from './crew';
import { MOTHERSHIP, dockingCheck, mothershipPose } from './mothership';

/** Earth, whose sky greys while it is still ash (revival.ts). */
const EARTH = EXPEDITION_BODIES.find((b) => b.id === 'projects')!;
/** How much slower time runs on Haven than at home: one day there is ten years here. */
const HAVEN_DILATION = 3652.5;

/** Music and sounds (footsteps, engines, wind, alarms) are switched separately; both kept between visits. */
const MUSIC_KEY = 'expedition-music';
const SOUNDS_KEY = 'expedition-sounds';
const readSwitch = (key: string) => {
    try {
        const saved = window.localStorage.getItem(key);
        if (saved === 'on' || saved === 'off') return saved === 'on';
        // The old single setting: 'effects' meant music off, 'off' meant both off.
        const old = window.localStorage.getItem('expedition-sound');
        if (old === 'off') return false;
        if (old === 'effects') return key !== MUSIC_KEY;
    } catch {
        // Fall through to on.
    }
    return true;
};
const keepSwitch = (key: string, on: boolean) => {
    try {
        window.localStorage.setItem(key, on ? 'on' : 'off');
    } catch {
        // Not kept between visits.
    }
};

/**
 * The expedition's heads-up display, laid out like the reference video: the
 * objective top-left, where you are and how fast bottom-left, markers on the
 * worlds, and short prompts. It reads the shared runtime a few times a second
 * rather than re-rendering on every frame.
 */
interface Marker {
    id: string;
    name: string;
    label: string;
    x: number;
    y: number;
    distance: string;
    color: string;
    behind: boolean;
    compact: boolean;
    course: boolean;
    /** Sideways nudge of the label, so it stays on screen beside a marker at the edge. */
    shift: number;
}

interface Bar {
    label: string;
    value: number;
    tone: string;
}

interface SiteMarker {
    id: string;
    name: string;
    x: number;
    y: number;
    distance: string;
    read: boolean;
    obelisk: boolean;
    compact: boolean;
    shift: number;
}

/** What weak gravity means on foot, in numbers. */
const lowGravityText = (body: ExpeditionBody) => {
    const g = surfaceGravity(body);
    const time = jumpTime(body);
    const hang = time >= 90 ? `${Math.round(time / 60)} minutes` : `${Math.round(time)} seconds`;
    const share = (g / 9.81) * 100;
    return `Gravity here is ${share < 1 ? share.toFixed(2) : share.toFixed(1)}% of Earth's: a jump rises ${Math.round(jumpHeight(body))} m and stays up ${hang}. `
        + 'Your boots grip the ground as you walk; in the air, X fires the jetpack downward.';
};

interface Snapshot {
    mode: 'ship' | 'walk';
    sites: SiteMarker[];
    bars: Bar[];
    crystals: number;
    location: string;
    /** The time warp, while it runs faster than real time: how fast, and the date it has reached. */
    time: string | null;
    /** On foot: the ground's temperature and air, and whether it is too hot for the suit. */
    ground: { text: string; hot: boolean } | null;
    /** The wind where the explorer or the ship is, in words, and whether it is pushing them hard. */
    wind: { text: string; strong: boolean } | null;
    sublabel: string;
    speed: number;
    pulse: number;
    altitude: number;
    landed: boolean;
    inAir: boolean;
    notice: string;
    noticeAge: number;
    markers: Marker[];
    /** What to do now; an alert (a storm coming) is the ship's computer speaking. */
    objective: { title: string; body: string; alert?: boolean; guide?: string };
    prompts: string[];
    /** Per prompt: a key hint that has stood unchanged long enough to fade (warnings never do). */
    quiet: boolean[];
    fauna: { id: string; name: string; temperament: string; alien: boolean } | null;
    /** How much slower time runs here than at home, near TON 618. */
    dilation: number | null;
    /** A course is set on the map, and whether the autopilot is flying it. */
    course: boolean;
    autopilot: boolean;
    /** On foot where gravity is too weak to hold a walker down (X brings them back down). */
    lowGravity: boolean;
    /** In water too deep to stand in, or dived under it (a touch button dives). */
    swimming: boolean;
    /** On foot: how much a hard landing just hurt (fading), and whether the explorer is down. */
    hurt: number;
    down: boolean;
    /** The death just counted (while down): where, of what, how long out there, which one. */
    death: { world: string; cause: string; survived: number; count: number } | null;
    /** ARGO's line on screen, if one. */
    argo: { text: string; tone: string } | null;
    /** What a colonist of Haven just said to the player. */
    speech: { name: string; line: string } | null;
    /** The expedition under way: its name, what to do now, the live numbers. */
    expedition: { title: string; stage: string; detail: string } | null;
    deaths: number;
    /** In the throat of a crossing (crossing.ts): the HUD steps aside for it, as it did for the film. */
    crossing: boolean;
    /** A predator stalking (0.3..0.8) or charging (1) the explorer. */
    danger: number;
    /** By a sealed vault: its runes in the order to light them, how many are lit, the seconds left. */
    vault: { name: string; letters: string[]; lit: number; left: number; open: boolean } | null;
    /** A line out: the fight's state. */
    fishing: { phase: string; tension: number; progress: number; outcome: string; fish: string } | null;
    /** The radio, when on: band, what it hears and how strongly. */
    radio: { band: string; frequency: string; strength: number; audible: number; name: string; distance: string; found: boolean } | null;
    /** A life form being scanned (progress 0..1), and the last one found, for its card. */
    scan: { name: string; progress: number; known: boolean } | null;
    discovery: { name: string; blurb: string; label: string; age: number } | null;
    /** Food carried. */
    food: number;
    /** The ship's hull temperature, kelvin. */
    temperature: number;
    /** Inside a gas giant: the pressure and temperature outside, the hull's rating, the cloud deck. */
    gas: null | { pressure: number; temperature: number; rating: number; deck: string | null };
    /** The ship was lost: how long ago, to what, and where the new one waits. */
    lost: null | { age: number; cause: string; home: string };
    /** Seconds since a new ship replaced a lost one (the view fades back in). */
    returned: number;
    /** Near a gas giant: whether the infrared imager is on (null: no giant near). */
    infrared: boolean | null;
    /** The crew of four, for the crew panel. */
    crew: CrewCard[];
}

interface Box { left: number; top: number; right: number; bottom: number }

/** Every species in the system, for the discoveries counter. */
const TOTAL_SPECIES = EXPEDITION_BODIES.reduce((sum, body) => sum + (body.kind === 'rocky' ? speciesOf(body).length : 0), 0);


const formatDuration = (hours: number) => {
    if (hours < 1.02) return `${Math.round(hours * 60)} minutes`;
    if (hours < 48) return `${hours.toFixed(1)} hours`;
    if (hours < 24 * 365) return `${(hours / 24).toFixed(1)} days`;
    return `${(hours / 24 / 365).toFixed(1)} years`;
};

const scratch = new THREE.Vector3();
const ray = new THREE.Vector3();
const toCenter = new THREE.Vector3();

/** True if the segment from `from` to `to` passes through the sphere. */
const blockedBy = (from: THREE.Vector3, to: THREE.Vector3, center: THREE.Vector3, radius: number) => {
    ray.copy(to).sub(from);
    const length = ray.length();
    ray.divideScalar(length);
    toCenter.copy(center).sub(from);
    const along = toCenter.dot(ray);
    if (along < 0 || along > length) return false;
    return toCenter.lengthSq() - along * along < radius * radius * 0.995;
};

/** How far to slide a label `half` wide (each side) centred at `x` so it stays 8px inside the screen. */
const labelShift = (x: number, half: number, width: number) =>
    Math.min(Math.max(x, half + 8), Math.max(half + 8, width - half - 8)) - x;

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const inside = (x: number, y: number, boxes: Box[], pad = 8) =>
    boxes.find((b) => x > b.left - pad && x < b.right + pad && y > b.top - pad && y < b.bottom + pad);

const giantAxis = new Map<string, THREE.Vector3>();
const axisOf = (body: (typeof EXPEDITION_BODIES)[number]) => {
    let axis = giantAxis.get(body.id);
    if (!axis) {
        axis = fromEquatorial(body.gas!.pole[0], body.gas!.pole[1]);
        giantAxis.set(body.id, axis);
    }
    return axis;
};
const DECAGON_LATITUDE = THREE.MathUtils.degToRad(-60.5);

/** How far a giant's rings reach (planet radii), 0 for none. */
const ringsOuter = (body: ExpeditionBody) => body.gas?.rings?.outer ?? Math.max(0, ...(body.gas?.narrowRings ?? []).map((r) => r.outer));

/** The first-flight guide (firstFlight.ts): one per page, read once. */
let flightState: FirstFlight | null = null;
const firstFlight = () => (flightState ??= loadFirstFlight());

/** Seconds a key hint stays before it fades; it comes back when it changes, or with the controls (H). */
const PROMPT_QUIET = 8;
const promptSince = new Map<string, number>();
const quietPrompts = (prompts: string[]) => {
    const now = performance.now() / 1000;
    for (const key of promptSince.keys()) if (!prompts.includes(key)) promptSince.delete(key);
    return prompts.map((p) => {
        if (!promptSince.has(p)) promptSince.set(p, now);
        return p.indexOf('  ') > 0 && now - promptSince.get(p)! > PROMPT_QUIET;
    });
};

const buildSnapshot = (runtime: ExpeditionRuntime, width: number, height: number, read: ReadonlySet<string>, panels: Box[]): Snapshot => {
    const ship = runtime.hud.ship;
    const body = runtime.currentBody;
    const inAir = runtime.atmosphere > 0.02;
    const nearBlackHole = runtime.camera.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * 400;
    const belt = !body && !nearBlackHole ? beltAt(runtime.camera) : null;
    // Out among a giant's rings (they reach past where its pull takes over), it is still that giant's.
    const ringed = body && ringsOuter(body) > 0 ? body : !body ? EXPEDITION_BODIES.find((b) => ringsOuter(b) > 0 && runtime.camera.distanceTo(b.position) < b.radius * ringsOuter(b) * 1.08) ?? null : null;
    const location = body ? body.name : ringed ? ringed.name : nearBlackHole ? BLACK_HOLE.name : belt === 'belt' ? 'Main belt' : belt === 'kuiper' ? 'Kuiper belt' : 'Open space';
    // Over (or in) a giant's rings, which one.
    const ringAt = ringed ? (() => {
        const local = directionToBody(runtime.motion, ringed, scratch.copy(runtime.camera).sub(ringed.position), scratch);
        const axis = axisOf(ringed);
        const up = local.dot(axis);
        if (Math.abs(up) > 4000) return null;
        const r = Math.sqrt(Math.max(0, local.lengthSq() - up * up)) / ringed.radius;
        return ringed.gas?.narrowRings ? narrowRingAt(ringed.gas.narrowRings, r) : ringName(r);
    })() : null;
    const sublabel = ringAt ? `${ringAt} · ${ringed!.name}'s rings` : ringed && !body ? `${ringed.name}'s rings` : body ? body.label : nearBlackHole ? 'Black hole · far outside the system' : belt ? 'Asteroids · Solar System' : 'Solar System';
    const blackHoleDistance = runtime.camera.distanceTo(BLACK_HOLE.position);
    const nearMouth = WORMHOLES.find((w) => runtime.camera.distanceTo(w.position) < w.radius * 60) ?? null;
    // A course is done once its world is reached (the autopilot ends its own).
    if (!runtime.autopilot) {
        if (runtime.waypoint && body?.id === runtime.waypoint) runtime.waypoint = null;
        if (runtime.waypoint === BLACK_HOLE.id && blackHoleDistance < BLACK_HOLE.horizon * 90) runtime.waypoint = null;
        if (runtime.waypoint && nearMouth?.id === runtime.waypoint) runtime.waypoint = null;
    }
    // A waypoint picked on the surface map is done once the player gets to it.
    const here = runtime.mode === 'walk' && runtime.hud.walker ? runtime.hud.walker.position : ship?.position;
    if (runtime.surfaceWaypoint && here && here.distanceTo(runtime.surfaceWaypoint) < (runtime.mode === 'walk' ? 6 : 40)) {
        runtime.surfaceWaypoint = null;
        if (ship) {
            ship.notice = 'WAYPOINT REACHED';
            ship.noticeTime = performance.now() / 1000;
        }
    }

    // Everything that gets a marker: the worlds, the wormhole mouths, TON 618.
    type Target = { id: string; name: string; label: string; position: THREE.Vector3; radius: number; color: string; world: boolean; beyond?: boolean };
    // Out by TON 618 the worlds are millions of units away: leave them off.
    const deepSpace = blackHoleDistance < BLACK_HOLE.horizon * 400;
    // A moon is marked near its planet (or once it is the course): from across
    // the system its marker would sit on its planet's.
    // On the ground or low over it, the sky is for looking at: a world is
    // marked there only when it is the course.
    // On (or low over) a world, or down in a giant's clouds, the other worlds are out of sight: only the course stays marked.
    const grounded = !!body && ((body.kind === 'rocky' && (inAir || runtime.altitude < 2500)) || (!!runtime.gas && runtime.gas.height < -300));
    // Only the course and the worlds the player marked carry markers (L shows every world for a look round).
    const marked = (b: (typeof EXPEDITION_BODIES)[number]) => {
        if (runtime.waypoint === b.id || runtime.marks.includes(b.id) || runtime.story.world === b.id) return true;
        if (grounded || !runtime.allMarkers) return false;
        if (!b.parent || body?.id === b.id) return true;
        const host = EXPEDITION_BODIES.find((h) => h.id === b.parent);
        return !host || runtime.camera.distanceTo(host.position) < host.radius * 80;
    };
    const targets: Target[] = deepSpace ? [] : EXPEDITION_BODIES.filter(marked).map((b) => ({ id: b.id, name: b.name, label: b.parent ? b.label : '', position: b.position, radius: b.radius, color: b.color, world: true }));
    // Falling in, nothing is steered for: no markers.
    const falling = runtime.fall.active;
    // The Argo, always marked while the fighter is away from her: she is the way through the wormhole.
    const mothership = runtime.mothership;
    const liveShip = runtime.player?.ship;
    if (!falling && mothership?.placed && !mothership.docked && !mothership.docking && liveShip) {
        const at = new THREE.Vector3();
        mothershipPose(mothership, liveShip, runtime.motion, at, new THREE.Quaternion());
        targets.push({ id: 'mothership', name: MOTHERSHIP.name, label: 'Mothership · crosses the wormhole', position: at, radius: 0, color: '#e8eef7', world: false });
    }
    for (const mouth of WORMHOLES) {
        if (falling) break;
        if (runtime.camera.distanceTo(mouth.position) < 900000 || runtime.waypoint === mouth.id || runtime.marks.includes(mouth.id)) {
            targets.push({ id: mouth.id, name: 'Wormhole', label: mouth.id === 'wormhole-saturn' ? 'to TON 618' : 'to Saturn', position: mouth.position, radius: mouth.radius, color: '#a8d8ff', world: false });
        }
    }
    if (!falling && (blackHoleDistance < 3400000 || runtime.waypoint === BLACK_HOLE.id || runtime.marks.includes(BLACK_HOLE.id))) {
        targets.push({ id: BLACK_HOLE.id, name: BLACK_HOLE.name, label: 'Black hole', position: BLACK_HOLE.position, radius: BLACK_HOLE.horizon * 2.6, color: '#ffb05a', world: false });
    }
    // Saturn's polar storms, to fly to: the hexagon over the north pole, and the
    // decagon round the south at 60 S (marked where it is nearest).
    const giant = !falling && !deepSpace ? EXPEDITION_BODIES.find((b) => b.kind === 'gas' && runtime.camera.distanceTo(b.position) < b.radius * 12) ?? null : null;
    if (giant?.gas?.hexagon && !runtime.gas) {
        const axis = axisOf(giant);
        targets.push({ id: 'hexagon', name: 'The hexagon', label: `${giant.name} · north pole`, position: turnWithWorld(runtime.motion, giant, giant.position.clone().addScaledVector(axis, giant.radius)), radius: 0, color: '#9fd8ff', world: false });
    }
    if (giant?.gas?.decagon && !runtime.gas) {
        const axis = axisOf(giant);
        // Worked out in the giant's own frame (it turns), then put back.
        const side = directionToBody(runtime.motion, giant, runtime.camera.clone().sub(giant.position), new THREE.Vector3());
        side.addScaledVector(axis, -side.dot(axis));
        if (side.lengthSq() > 1) {
            side.normalize();
            const at = turnWithWorld(runtime.motion, giant, side.multiplyScalar(Math.cos(DECAGON_LATITUDE)).addScaledVector(axis, Math.sin(DECAGON_LATITUDE)).multiplyScalar(giant.radius).add(giant.position));
            targets.push({ id: 'decagon', name: 'The decagon', label: `${giant.name} · 60° south`, position: at, radius: 0, color: '#9fd8ff', world: false });
        }
    }
    // The great vortices, to fly into (one marker for each that is not found yet:
    // Jupiter's polar cyclones at the north pole, the Great Red Spot, Saturn's
    // south polar hurricane, Uranus's polar cyclone, Neptune's dark spot).
    // Saturn's north hurricane sits under the hexagon's marker.
    if (giant && !runtime.gas) {
        const marked = new Set<string>(['saturn-north-eye']);
        // Of several (Jupiter's polar ring), the one best in sunlight.
        const sunniest = [...vorticesOf(giant)].sort((a, b) => b.dir.dot(giant.sunDirection) - a.dir.dot(giant.sunDirection));
        for (const v of sunniest) {
            if (marked.has(v.sight) || runtime.stats.visited.includes(v.sight)) continue;
            marked.add(v.sight);
            const sight = VORTEX_SIGHTS[v.sight];
            targets.push({ id: v.sight, name: sight.name, label: `${giant.name} · fly in`, position: turnWithWorld(runtime.motion, giant, giant.position.clone().addScaledVector(v.dir, giant.radius)), radius: 0, color: '#9fd8ff', world: false });
        }
    }
    // The infrared imager works near a giant; leaving switches it off.
    if (!giant) runtime.infrared = false;

    // A storm due or here: the nearest rock shelter is marked.
    const weather = runtime.weather;
    const stormy = weather.phase !== 'calm' && weather.kind !== 'drizzle' && weather.kind !== null;
    if (stormy && runtime.mode === 'walk' && runtime.shelters.length && weather.shelter < 0.5) {
        const from = runtime.hud.walker?.position ?? runtime.camera;
        const nearest = runtime.shelters.reduce((a, b) => (a.centre.distanceTo(from) <= b.centre.distanceTo(from) ? a : b));
        targets.push({ id: 'shelter', name: 'Rock shelter', label: 'cover from the storm', position: nearest.centre, radius: 0, color: '#ffd35a', world: false });
    }

    // A tornado on the ground is marked (to keep clear of it).
    if (weather.tornado && runtime.altitude < 2500) {
        targets.push({ id: 'tornado', name: 'Tornado', label: 'keep clear · take cover', position: weather.tornado.at, radius: 0, color: '#ff9a7a', world: false });
    }

    // On foot, the way back to the ship is always marked (and any spot picked on the surface map).
    if (runtime.mode === 'walk' && ship) {
        targets.push({ id: 'ship', name: 'Your ship', label: 'E to board', position: ship.position, radius: 0, color: '#7fe3ff', world: false });
    }
    if (runtime.surfaceWaypoint && body && runtime.altitude < 9000) {
        targets.push({ id: 'surface-waypoint', name: 'Waypoint', label: '', position: runtime.surfaceWaypoint, radius: 0, color: '#ffd35a', world: false });
    }
    // The radio: the source it hears, marked once the receiver is pointed near it.
    const reading = runtime.radio.band ? runtime.radio.reading : null;
    if (reading?.source && !reading.source.sky && (reading.strength > 0.22 || reading.audible > 0.6) && !runtime.stats.signals.includes(reading.source.id)) {
        const signalAt = reading.source.position(new THREE.Vector3());
        targets.push({ id: 'signal', name: 'Signal', label: BANDS.find((b) => b.id === reading.source!.band)?.frequency ?? '', position: signalAt, radius: 0, color: '#9dffb0', world: false });
    }
    // The named seas of the world below (Titan's), marked even beyond its horizon, so they can be found.
    const seas = body?.biome?.seas;
    const liquidLevel = body?.biome?.liquid?.level ?? 0;
    if (body && seas && !falling && runtime.altitude < 30000) {
        for (const sea of seas) {
            const at = turnWithWorld(runtime.motion, body, body.position.clone().addScaledVector(scratch.set(sea.at[0], sea.at[1], sea.at[2]), body.radius + liquidLevel));
            targets.push({ id: `sea-${sea.name}`, name: sea.name, label: sea.label, position: at, radius: 0, color: '#e2b98a', world: false, beyond: true });
        }
    }
    // A sealed vault on this world, once within a kilometre and a half (Vaults.tsx mounts it then).
    if (runtime.vault && !runtime.vault.open && runtime.altitude < 2500) {
        targets.push({ id: 'vault', name: runtime.vault.vault.name, label: 'sealed vault', position: runtime.vault.frame.centre, radius: 0, color: '#9fe6ff', world: false });
    }
    // Where a falling rock will strike (Impacts.tsx).
    if (runtime.impact && !falling) {
        targets.push({ id: 'impact', name: 'Impact', label: `in ${Math.ceil(runtime.impact.seconds)} s`, position: runtime.impact.point, radius: 0, color: '#ff8a5a', world: false, beyond: true });
    }
    // The story's next stop on this world (quests.ts), marked in gold even beyond the horizon.
    if (body && !falling && runtime.altitude < 60000) {
        for (const aim of runtime.story.aims) {
            if (aim.body !== body.id) continue;
            targets.push({ id: aim.id, name: aim.name, label: aim.label, position: aim.at(), radius: 0, color: '#ffd35a', world: false, beyond: true });
        }
    }
    // Alien life on this world (aliens.ts) not met yet: its site is marked, so it can be found at all.
    const alienSite = body && !falling && runtime.altitude < 60000 ? siteOn(body) : null;
    if (alienSite && !runtime.story.aims.some((aim) => aim.body === alienSite.body) && alienSite.life.some((life) => !runtime.stats.aliens.includes(life.id))) {
        targets.push({ id: 'life-signs', name: 'Life signs', label: 'something is alive here', position: sitePosition(alienSite), radius: 0, color: '#9dffb0', world: false, beyond: true });
    }
    // Where real spacecraft came down on this world (history.ts), until found;
    // then, at Three Forks, the nearest sample tube still lying there.
    if (body && runtime.altitude < 30000) {
        for (const site of sitesOn(body)) {
            const frame = siteFrame(site);
            if (!runtime.stats.visited.includes(site.id)) {
                if (targets.some((t) => t.id === `history-${site.id}`)) continue;
                targets.push({ id: `history-${site.id}`, name: site.name, label: site.mission, position: frame.centre, radius: 0, color: '#f2d79a', world: false });
                continue;
            }
            const from = runtime.hud.walker?.position ?? runtime.camera;
            let tube = -1;
            frame.tubes.forEach((at, i) => {
                if (!runtime.stats.visited.includes(tubeId(i)) && (tube < 0 || at.distanceTo(from) < frame.tubes[tube].distanceTo(from))) tube = i;
            });
            if (tube >= 0 && frame.tubes[tube].distanceTo(from) < 400) {
                const have = SAMPLE_TUBES.filter((_, i) => runtime.stats.visited.includes(tubeId(i))).length;
                targets.push({ id: 'history-tube', name: 'Sample tube', label: `${have} of ${SAMPLE_TUBES.length} picked up`, position: frame.tubes[tube], radius: 0, color: '#f2d79a', world: false });
            }
        }
    }
    // The expedition under way: where to go now, marked even beyond the horizon.
    const expedition = runtime.expedition ? findExpedition(runtime.expedition.id) : null;
    const aim = expedition?.target?.(runtime.expedition!, runtime) ?? null;
    if (aim && !falling) targets.push({ id: 'expedition', name: aim.name, label: expedition!.title, position: aim.position, radius: 0, color: '#ffd35a', world: false, beyond: true });
    // The world's great sights (landmarks.ts), until found: marked even beyond the horizon.
    if (body && !falling && runtime.altitude < 60000) {
        for (const landmark of landmarksOn(body)) {
            if (runtime.stats.visited.includes(landmark.id)) continue;
            targets.push({ id: `landmark-${landmark.id}`, name: landmark.name, label: landmark.label, position: landmarkPosition(landmark), radius: 0, color: '#f2c9a0', world: false, beyond: true });
        }
    }
    // Haven's colony, always: a ship coming from the wormhole can come down anywhere on the world.
    if (body?.id === 'haven' && !falling && !targets.some((target) => target.name === 'The colony')) {
        targets.push({ id: 'haven-colony', name: 'The colony', label: 'the Halcyon and her people', position: havenColony(), radius: 0, color: '#f2c9a0', world: false, beyond: true });
    }
    // Where rocks are few (a belt, not a cluster), the nearest is marked, to fly to and mine.
    if (runtime.mode === 'ship' && ship && !ship.destroyed && ship.pulse < 0.05 && !runtime.asteroidField && runtime.asteroids.length && beltAt(ship.position)) {
        let nearestRock = runtime.asteroids[0];
        for (const rock of runtime.asteroids) if (rock.position.distanceTo(ship.position) - rock.radius < nearestRock.position.distanceTo(ship.position) - nearestRock.radius) nearestRock = rock;
        if (nearestRock.position.distanceTo(ship.position) < 15000) {
            targets.push({ id: 'asteroid', name: 'Asteroid', label: 'mine it for crystals', position: nearestRock.position, radius: nearestRock.radius, color: '#d9c4a5', world: false });
        }
    }

    const markers: Marker[] = [];
    const camera = runtime.view.camera;
    if (camera) {
        const ordered = targets
            .map((b) => ({ b, d: runtime.camera.distanceTo(b.position) - b.radius }))
            .sort((p, q) => p.d - q.d);
        for (const { b } of ordered) {
            if (b.world && b.id === body?.id && inAir) continue;
            // Hidden behind the world we are flying over.
            if (body && b.id !== body.id && !b.beyond && blockedBy(runtime.camera, b.position, body.position, body.radius)) continue;
            // Or behind the Sun.
            if (b.id !== SUN.id && blockedBy(runtime.camera, b.position, SUN.position, SUN.radius)) continue;
            scratch.copy(b.position).sub(runtime.origin).project(camera);
            const behind = scratch.z > 1;
            let x = (scratch.x * 0.5 + 0.5) * width;
            let y = (-scratch.y * 0.5 + 0.5) * height;
            if (behind) { x = width - x; y = height - y; }
            const margin = 40;
            const offscreen = behind || x < margin || x > width - margin || y < margin || y > height - margin;
            if (offscreen) {
                const cx = width / 2, cy = height / 2;
                let dx = x - cx, dy = y - cy;
                // Straight behind, the mirrored point lands near the middle of the screen: it must
                // still go to the edge (it read as "ahead" before), the bottom one if no side is nearer.
                if (behind && Math.hypot(dx, dy) < 1) { dx = 0; dy = 1; }
                const scale = Math.min((width / 2 - margin) / Math.max(Math.abs(dx), 1e-3), (height / 2 - margin) / Math.max(Math.abs(dy), 1e-3));
                const reach = behind ? scale : Math.min(scale, 1);
                x = cx + dx * reach;
                y = cy + dy * reach;
            }
            // Keep markers off the HUD panels: slide edge markers past them,
            // leave out a world that is only visible behind one.
            const panel = inside(x, y, panels);
            if (panel) {
                if (!offscreen) continue;
                y = panel.top < height / 2 ? panel.bottom + 16 : panel.top - 16;
            }
            const surfaceDistance = Math.max(0, runtime.camera.distanceTo(b.position) - b.radius);
            let label: Box = { left: x - 60, top: y - 6, right: x + 60, bottom: y + 36 };
            // An edge marker whose label would lie across a panel slides clear of it too.
            const under = offscreen ? panels.find((p) => overlaps(label, p)) : undefined;
            if (under) {
                y = under.top > y ? under.top - 44 : under.bottom + 16;
                label = { left: x - 60, top: y - 6, right: x + 60, bottom: y + 36 };
            }
            // Edge markers that land on one another (the ship and a shelter, both
            // behind) stack, one label's height apart, towards the middle.
            if (offscreen) {
                const step = y > height / 2 ? -44 : 44;
                const taken = (box: Box) => markers.some((m) => m.behind && overlaps(box, { left: m.x - 60, top: m.y - 6, right: m.x + 60, bottom: m.y + 36 }));
                for (let k = 0; k < 4 && taken(label); k++) {
                    y += step;
                    label = { left: x - 60, top: y - 6, right: x + 60, bottom: y + 36 };
                }
            }
            // Nearer worlds keep their labels; a farther one too close on screen
            // shows only its marker, as does one whose label would cover a panel.
            const crowded = markers.some((m) => Math.abs(m.x - x) < 126 && Math.abs(m.y - y) < 46 && !m.compact)
                || panels.some((p) => overlaps(label, p));
            const chosen = runtime.marks.includes(b.id);
            const course = runtime.waypoint === b.id || b.id === 'ship' || b.id === 'surface-waypoint' || b.id === 'signal' || b.id === 'shelter' || b.id === 'expedition';
            markers.push({ id: b.id, name: b.name, label: b.label, x, y, distance: formatDistance(surfaceDistance), color: b.color, behind: offscreen, compact: crowded && !course && !chosen, course, shift: labelShift(x, 60, width) });
        }
    }

    // Data sites on the world below, and stations within range. Nearest first:
    // a label that would lie across one already shown (a site's or a world's)
    // shows only its marker.
    const sites: SiteMarker[] = [];
    if (camera) {
        const shown: Box[] = markers.filter((m) => !m.compact).map((m) => ({ left: m.x - 60, top: m.y - 6, right: m.x + 60, bottom: m.y + 36 }));
        // Each worked out on its world as it was at the start: where it is now.
        const near = DATA_SITES
            .map((site) => {
                const at = fromStart(runtime.motion, site.body, site.position, new THREE.Vector3());
                return { site, at, distance: runtime.camera.distanceTo(at) };
            })
            .sort((a, b) => a.distance - b.distance);
        for (const { site, at, distance } of near) {
            const relevant = site.kind === 'station' ? distance < 60000 : site.body === body && runtime.altitude < 9000;
            if (!relevant) continue;
            if (site.kind !== 'station' && body && blockedBy(runtime.camera, at, body.position, body.radius - 400)) continue;
            scratch.copy(at).sub(runtime.origin).project(camera);
            if (scratch.z > 1 || scratch.z < -1) continue;
            const x = (scratch.x * 0.5 + 0.5) * width;
            const y = (-scratch.y * 0.5 + 0.5) * height;
            if (x < 0 || x > width || y < 0 || y > height) continue;
            if (inside(x, y, panels, 4)) continue;
            const label: Box = { left: x - 70, top: y - 8, right: x + 70, bottom: y + 34 };
            const compact = panels.some((p) => overlaps(label, p)) || shown.some((b) => overlaps(label, b));
            if (!compact) shown.push(label);
            sites.push({
                id: site.id, name: site.entry.name, x, y, distance: formatDistance(distance), read: read.has(site.id), obelisk: site.kind === 'obelisk',
                compact,
                shift: labelShift(x, 70, width),
            });
        }
    }

    const prompts: string[] = [];
    // Someone who can answer (contact.ts): what E does, or what is still needed.
    const contact = contactNow(runtime);
    if (contact) prompts.push(contact.blocked ?? contact.words.prompt);
    if (ringAt && runtime.mode !== 'walk' && ringed && Math.abs(directionToBody(runtime.motion, ringed, scratch.copy(runtime.camera).sub(ringed.position), scratch).dot(axisOf(ringed))) > 900) prompts.push('Rings · fly into the ring plane to see what they are made of');
    if (giant && runtime.mode !== 'walk' && !runtime.gas) prompts.push(runtime.infrared ? 'I  Back to visible light' : 'I  Infrared imager: see its heat');
    const nearestSite = runtime.sites.nearest;
    if (nearestSite) {
        prompts.push(nearestSite.kind === 'station' ? 'E  Scan data station' : nearestSite.kind === 'obelisk' ? 'E  Read the Obelisk' : 'E  Read the inscription');
    }
    const course = runtime.waypoint ? EXPEDITION_BODIES.find((b) => b.id === runtime.waypoint) : null;
    let objective: Snapshot['objective'] = course
        ? { title: `Course set · ${course.name}`, body: `${course.label} · ${formatDistance(Math.max(0, runtime.camera.distanceTo(course.position) - course.radius))}. Leave the atmosphere, point at the gold marker and engage the pulse drive.` }
        : { title: 'Explore the Solar System', body: 'Every planet and moon is somewhere you can go. Pick one on the map (M), fly there and land to explore it on foot.' };
    if (nearMouth) {
        const crossing = runtime.mothership?.docked
            ? 'Fly the Argo into it to cross.'
            : 'Its throat would tear the fighter apart: only the Argo is built to cross. Dock with her (U at her bay) and fly her in.';
        objective = nearMouth.id === 'wormhole-saturn'
            ? { title: 'Wormhole', body: `A sphere of bent space. Through it lies TON 618, far outside this system. ${crossing}` }
            : { title: 'Wormhole · the way home', body: `It comes out beside Saturn. ${crossing}` };
    } else if (blackHoleDistance < BLACK_HOLE.horizon * 400) {
        objective = { title: `${BLACK_HOLE.name} · black hole`, body: 'About 66 billion times the mass of the Sun. Its pull builds as you close in: keep clear of the disk, and use the wormhole to go home.' };
    }
    const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
    // Inside a gas giant: what the hull is up against.
    const gasReading = ship && !walker && body?.kind === 'gas' && inAir
        ? (() => {
            const model = gasModel(body);
            return { pressure: pressureAt(model, runtime.altitude), temperature: temperatureAt(model, runtime.altitude), rating: model.hullRating, deck: runtime.gas?.deck ?? null };
        })()
        : null;
    let bars: Bar[] = [
        { label: 'Shield', value: ship?.shield ?? 1, tone: ship && ship.shield < 0.3 ? 'danger' : 'shield' },
        { label: 'Thrust', value: Math.max(0, ship?.throttle ?? 0), tone: 'thrust' },
        { label: 'Boost', value: ship?.boost ?? 0, tone: 'boost' },
    ];
    // Near the Sun the hull's heat, against the shield's rating.
    if (gasReading && gasReading.pressure > 2) {
        bars.push({ label: 'Pressure', value: THREE.MathUtils.clamp(gasReading.pressure / gasReading.rating, 0, 1), tone: gasReading.pressure > gasReading.rating ? 'danger' : gasReading.pressure > gasReading.rating * 0.6 ? 'heat-high' : 'heat' });
    }
    if (ship && ship.temperature > 500) {
        bars.push({ label: 'Heat', value: THREE.MathUtils.clamp((ship.temperature - 500) / (HEAT_LIMIT - 500), 0, 1), tone: ship.temperature > HEAT_LIMIT ? 'danger' : ship.temperature > HEAT_WARNING ? 'heat-high' : 'heat' });
    }
    if (walker) {
        bars = [
            { label: 'Health', value: walker.health, tone: walker.health < 0.3 ? 'danger' : 'life' },
            { label: body?.breathable ? 'Air' : 'Oxygen', value: walker.oxygen, tone: walker.oxygen < 0.2 ? 'danger' : 'oxygen' },
            { label: 'Food', value: walker.satiety, tone: walker.satiety < 0.15 ? 'danger' : 'food' },
            { label: 'Jetpack', value: walker.jetpack, tone: 'jetpack' },
        ];
        // Suit cooling, where the ground is hotter than the suit can stand (or it is still recovering).
        if (walker.kelvin > SUIT_HOT || walker.cooling < 0.995) {
            bars.push({ label: 'Cooling', value: walker.cooling, tone: walker.cooling < 0.25 ? 'danger' : walker.kelvin > SUIT_HOT ? 'heat-high' : 'heat' });
        }
        // Food, the campfire and plants within reach.
        const camp = runtime.camp && runtime.camp.body === walker.body && walker.position.distanceTo(runtime.camp.position) < 3.6;
        if (walker.sitting) {
            prompts.push(runtime.supplies.food > 0 ? `R  Cook a meal (${runtime.supplies.food})` : 'No food to cook');
            prompts.push('W  Get up');
        } else if (camp) {
            prompts.push('E  Sit by the fire');
        }
        const fishing = runtime.fishing;
        if (fishing) {
            prompts.length = 0;
            if (fishing.phase === 'cast' || fishing.phase === 'wait') prompts.push('Waiting for a bite · move to stop');
            else if (fishing.phase === 'bite') prompts.push('E  Hook it!');
            else if (fishing.phase === 'reel') prompts.push('Hold click  Reel in · let go when the line goes red');
        } else if (runtime.fishSpot && !runtime.fauna.reach && !runtime.forage.target) {
            prompts.push('E  Fish');
        }
        const creature = runtime.fauna.reach;
        if (creature && !walker.sitting && !fishing) {
            prompts.push(creature.mind === 'predator' ? 'Too dangerous · back away'
                : creature.friend ? `E  Pet the ${creature.name}`
                    : runtime.supplies.food > 0 ? `E  Feed the ${creature.name} (${runtime.supplies.food} food)` : 'Pick fruit to feed animals');
        }
        if (runtime.fauna.danger > 0.2) prompts.push('Predator · back away, or hold click to drive it off');
        if (runtime.pickup && !walker.sitting) prompts.push('E  Pick up the sample tube');
        if (runtime.forage.target && !walker.sitting) prompts.push(`E  Pick ${(FORAGE_NAME[walker.body.biome?.kind ?? 'verdant'] ?? 'fruit').toLowerCase()}`);
        // What crystals are for, until the first campfire has been made.
        if (!walker.sitting && !camp && !(runtime.stats.crafted.campfire ?? 0)) {
            prompts.push(runtime.inventory.crystals >= 4 ? 'C  Make a campfire (4 crystals)' : `Mine crystals for a campfire (${runtime.inventory.crystals}/4)`);
        }
        if (!walker.sitting && runtime.supplies.food > 0 && walker.satiety < 0.75) prompts.push(`R  Eat (${runtime.supplies.food})`);
        if (walker.satiety < 0.15) prompts.push('Hungry · eat something (R)');
        if (runtime.colonist) prompts.unshift(`E  Talk to ${runtime.colonist.name}`);
        if (ship && walker.position.distanceTo(ship.position) < 10 && !nearestSite && !runtime.shipRecall) prompts.push('E  Board ship');
        if (ship && !runtime.shipRecall && walker.position.distanceTo(ship.position) > 150) prompts.push('G  Call your ship');
        if (runtime.surface.target) prompts.push(runtime.surface.beam ? 'Mining…' : 'Hold click  Mine crystal');
        const weak = lowGravity(walker.body);
        prompts.push(walker.onGround ? 'Space  Jump · hold for jetpack' : weak ? 'Hold Space  Jetpack · X  Down' : 'Hold Space  Jetpack');
        if (walker.sliding) prompts.push('Too steep to climb');
        if (walker.atEdge) prompts.push('Edge · Shift to run off, Space to jump');
        if (runtime.daylight < 0.35) prompts.push(runtime.torch.on ? 'T  Torch off' : 'T  Torch');
        if (walker.oxygen < 0.25 && !body?.breathable) prompts.push('Oxygen low · return to your ship');
        if (walker.kelvin > SUIT_HOT) {
            const drain = coolingDrain(walker.kelvin);
            prompts.push(walker.cooling <= 0 ? 'Overheating · get back to your ship'
                : `Too hot for the suit · ${Math.max(1, Math.round(walker.cooling / drain))} s of cooling left · the ship restores it`);
        }
        if (walker.health < 0.35) prompts.push('Hurt · rest, or return to your ship to heal');
        objective = {
            title: `On foot · ${body?.name ?? ''}`,
            body: weak ? lowGravityText(walker.body)
                : 'Read the monoliths, mine crystals and turn them into supplies (C), pick food, scan animals. E by your ship boards it.',
        };
    } else if (ship) {
        if (runtime.waypoint && !ship.landing) prompts.push(runtime.autopilot ? 'G  Take the controls' : 'G  Autopilot');
        if (mothership?.placed && !ship.landing) {
            if (mothership.docked) prompts.push('U  Undock the fighter');
            else if (mothership.docking) prompts.push('Docking…');
            else {
                const check = dockingCheck(mothership, ship, runtime.motion);
                if (check.ok) prompts.push('U  Dock with the Argo');
                else if (check.metres < MOTHERSHIP.reach * 3) prompts.push(check.speed >= MOTHERSHIP.closing ? `Slow down to dock · ${Math.round(check.speed)} m/s` : 'Fly to the light on the Argo\'s bay');
            }
        }
        if (ship.landed) {
            if (!nearestSite) prompts.push('E  Step outside');
            prompts.push('F  Take off');
            objective = { title: `Landed on ${body?.name ?? 'the surface'}`, body: 'Press E to step outside and explore on foot.' };
        } else if (ship.landing) {
            prompts.push('Landing…');
        } else if (inAir && body?.kind === 'gas' && gasReading) {
            const model = gasModel(body);
            const deep = gasReading.pressure > model.hullRating;
            if (!course) objective = deep
                ? { title: `${Math.round(gasReading.pressure)} bar · the hull is buckling`, body: `It is rated to ${model.hullRating} bar. Climb: there is no floor down here, only air growing thicker and hotter until it crushes anything that falls in.` }
                : gasReading.deck
                    ? { title: `Inside the ${gasReading.deck.toLowerCase()}`, body: `${Math.round(gasReading.pressure * 10) / 10} bar, ${Math.round(gasReading.temperature)} K. ${model.decks.find((d) => d.name === gasReading.deck)?.storms ? (model.kind === 'gas' ? 'Lightning lives here, in the water clouds, as on Earth but far stronger. ' : 'Lightning has been heard down here on the radio, but never seen. ') : ''}Keep up speed or the ship sinks: gravity here is ${(body.gravity ?? 10).toFixed(1)} m/s².` }
                    : runtime.altitude > model.decks[0].top
                        ? { title: `${body.name} · ${model.kind === 'ice' ? 'an ice giant' : 'a gas giant'}, above the clouds`, body: `No ground: below the clouds the air only thickens. ${model.above} This hull is rated to ${model.hullRating} bar.` }
                        : { title: `${body.name} · between the cloud decks`, body: `${Math.round(gasReading.pressure * 10) / 10} bar, ${Math.round(gasReading.temperature)} K. ${gasReading.pressure > 6 ? model.below : 'The light fails with every deck you pass under.'} Climb to leave the atmosphere.` };
        } else if (inAir) {
            if (runtime.altitude < 220 && ship.velocity.length() < 260) prompts.push('F  Land');
            if (!course) objective = { title: `${body?.name} · ${body?.label}`, body: 'Fly low and slow, then press F to land. Climb to leave the atmosphere.' };
        } else {
            const field = runtime.asteroidField;
            const inField = !!field && ship.position.distanceTo(field.center) < field.radius;
            prompts.push(inField ? 'Mass locked · fly clear of the cluster' : ship.pulseEngaged ? 'Space  Drop out of pulse' : ship.temperature > HEAT_WARNING ? 'Space  Dive closer (no heat cut-out)' : 'Space  Pulse drive');
            if (!runtime.radio.band && runtime.stats.heard.length === 0 && runtime.altitude > 20000) prompts.push('V  Radio');
            if (runtime.asteroidTarget) prompts.push('Hold click  Mine asteroid');
            if (!course && !nearMouth && !nearBlackHole) objective = { title: 'Open space', body: 'Point at a world and engage the pulse drive to cross the system fast. Press M for the system map.' };
            if (belt && !inField && !course) objective = { title: belt === 'belt' ? 'The main asteroid belt' : 'The Kuiper belt', body: 'Rock and ice left over from the making of the planets. Fly up to an asteroid and hold click to mine it with the ship\'s laser.' };
            if (inField) objective = { title: 'Asteroid cluster', body: `The pulse drive is mass locked until you fly clear: ${formatDistance(Math.max(0, field!.radius - ship.position.distanceTo(field!.center)))} to the edge. Hitting rock costs shield, more the faster you go. Hold click on a rock ahead to mine it.` };
            if (ship.temperature > HEAT_WARNING) {
                objective = ship.temperature > HEAT_LIMIT
                    ? { title: `Hull ${Math.round(ship.temperature).toLocaleString('en-US')} K · heat shield failing`, body: `Past its rating of ${HEAT_LIMIT.toLocaleString('en-US')} K the shield burns away. Turn away from the Sun and engage the pulse drive to get clear.` }
                    : { title: `The Sun · hull ${Math.round(ship.temperature).toLocaleString('en-US')} K`, body: `The heat shield is rated to ${HEAT_LIMIT.toLocaleString('en-US')} K, like the Parker Solar Probe's. Closer than this it starts to burn away.` };
            }
        }
    }
    // The autopilot says what it is doing.
    const pilot = runtime.autopilot ? runtime.autopilotStatus : null;
    if (pilot && runtime.mode === 'ship') {
        objective = { title: `Autopilot · ${pilot.name}`, body: `${pilot.phase} · ${formatDistance(pilot.remaining)} to go. Steer, change throttle or press G to take the controls.` };
    }
    // A storm coming or here: the ship's computer's warning takes the log.
    const forecast = weather.phase !== 'calm' ? weatherMessage(weather) : null;
    if (forecast && (walker || ship?.landed || runtime.altitude < 2500)) {
        objective = { ...forecast, alert: weather.kind !== 'drizzle' };
        if (walker && weather.shelter >= 0.5 && weather.kind !== 'drizzle') prompts.unshift('Under rock · sheltered');
    }
    if (walker && weather.kind === 'radiation' && (weather.dose > 0.001 || weather.phase === 'storm')) {
        bars.push({ label: 'Dose', value: THREE.MathUtils.clamp(weather.dose, 0, 1), tone: weather.dose > 0.5 ? 'danger' : 'heat' });
    }
    // A rock coming down nearby (Impacts.tsx): the ship's computer gives the count and the way out.
    const impact = runtime.impact;
    if (impact && !runtime.fall.active) {
        const m = Math.floor(impact.seconds / 60);
        const sec = Math.floor(impact.seconds % 60);
        const km = impact.metres >= 1000 ? `${(impact.metres / 1000).toFixed(1)} km` : `${Math.round(impact.metres)} m`;
        objective = {
            title: `Impact in ${m}:${String(sec).padStart(2, '0')}`,
            body: impact.metres < 1600
                ? `A rock is coming down ${km} ${impact.bearing} of you. Get clear: at least a kilometre and a half, or take off.`
                : `A rock is coming down ${km} ${impact.bearing} of you. Keep clear and watch the sky over there.`,
            alert: true,
        };
    }
    // Falling into TON 618: the log tells what is happening.
    if (runtime.fall.active) {
        const stage = fallStage(runtime.fall.time);
        // The ship's own clock (fall.ts): the real times, days of them, shown fast.
        const clock = fallClock(runtime.fall);
        const reading = clock.sinceHorizon < 0
            ? `Ship's clock: horizon in ${formatShipTime(-clock.sinceHorizon)}.`
            : `Ship's clock: ${formatShipTime(clock.sinceHorizon)} since the horizon, ${formatShipTime(clock.left)} to the centre.`;
        objective = { title: stage.title, body: `${stage.body} ${reading}` };
        prompts.length = 0;
    }

    const target = walker ? runtime.fauna.target : null;
    // A new player's first flight, step by step, until they have landed on the Moon (firstFlight.ts).
    const flight = firstFlight();
    if (runtime.story.chapter !== 'ten-years') advanceFirstFlight(flight, runtime);
    // (Not in the prologue on Haven: its own objectives lead the way, to the Argo and home.)
    if (flying(flight) && !objective.alert && !runtime.fall.active && runtime.story.chapter !== 'ten-years') {
        const step = FLIGHT_STEPS[flight.step];
        objective = { title: step.title, body: step.body, guide: `First flight · ${flight.step + 1} of ${FLIGHT_STEPS.length}` };
    }

    return {
        mode: walker ? 'walk' : 'ship',
        sites,
        bars,
        crystals: runtime.inventory.crystals,
        location,
        time: runtime.motion.warp > 1
            ? `Time ×${runtime.motion.warp.toLocaleString('en-US')} · ${motionDate(runtime.motion).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
            : null,
        ground: walker && body?.kind === 'rocky' ? { text: groundReadout(body, walker.kelvin), hot: walker.kelvin > SUIT_HOT } : null,
        wind: windReading(runtime, body, walker, ship),
        sublabel,
        speed: walker ? walker.velocity.length() : ship ? ship.velocity.length() : 0,
        pulse: ship ? ship.pulse : 0,
        altitude: runtime.altitude,
        landed: !!ship?.landed,
        inAir,
        notice: ship?.notice ?? '',
        noticeAge: ship ? performance.now() / 1000 - ship.noticeTime : 99,
        markers,
        objective,
        prompts,
        quiet: quietPrompts(prompts),
        fauna: target ? { id: target.id, name: target.name, temperament: target.temperament, alien: !!target.alien } : null,
        // On Haven the hole's spin holds time slower than its pull alone would (docs/story.md): a day
        // there is ten years at home.
        dilation: body?.id === 'haven' && !runtime.fall.active ? HAVEN_DILATION
            : blackHoleDistance < BLACK_HOLE.horizon * 80 && !runtime.fall.active ? timeDilation(blackHoleDistance) : null,
        course: !!runtime.waypoint,
        autopilot: runtime.autopilot,
        lowGravity: !!walker && lowGravity(walker.body),
        swimming: !!walker && (walker.swimming || walker.dive > 0),
        hurt: walker ? walker.impact * Math.max(0, 1 - walker.impactTime / 1.2) : 0,
        down: !!walker?.down,
        death: walker?.down && runtime.lastDeath
            ? { world: theWorld(findBody(runtime.lastDeath.world)?.name ?? 'open space'), cause: runtime.lastDeath.cause, survived: runtime.lastDeath.survived, count: runtime.lastDeath.count }
            : null,
        speech: runtime.speech && performance.now() / 1000 - runtime.speech.at < Math.max(5, runtime.speech.line.length / 14) ? { name: runtime.speech.name, line: runtime.speech.line } : null,
        argo: runtime.argo.current && performance.now() / 1000 - runtime.argo.current.at < runtime.argo.current.hold
            ? { text: runtime.argo.current.text, tone: runtime.argo.current.tone }
            : null,
        expedition: (() => {
            const run = runtime.expedition;
            const def = run ? findExpedition(run.id) : null;
            return run && def ? { title: def.title, ...def.status(run, runtime) } : null;
        })(),
        deaths: runtime.stats.deaths ?? 0,
        crossing: !!runtime.transit && runtime.transit.t < BEAT.out + 0.3,
        danger: walker ? runtime.fauna.danger : 0,
        radio: radioSnapshot(runtime),
        scan: runtime.scan.life ? { name: runtime.scan.life.name, progress: runtime.scan.progress, known: runtime.stats.aliens.includes(runtime.scan.life.id) } : null,
        discovery: runtime.scan.found && performance.now() / 1000 - runtime.scan.foundAt < 12
            ? { name: runtime.scan.found.name, blurb: runtime.scan.found.blurb, label: runtime.scan.found.label ?? 'First contact', age: performance.now() / 1000 - runtime.scan.foundAt }
            : null,
        vault: walker && runtime.vault && !runtime.vault.open && runtime.vault.frame.centre.distanceTo(walker.position) < 70
            ? { name: runtime.vault.vault.name, letters: [...runtime.vault.vault.key], lit: runtime.vault.lit, left: runtime.vault.left, open: runtime.vault.open }
            : null,
        fishing: walker && runtime.fishing && runtime.fishing.phase !== 'cast'
            ? { phase: runtime.fishing.phase, tension: runtime.fishing.tension, progress: runtime.fishing.progress, outcome: runtime.fishing.outcome, fish: runtime.fishing.fish.name }
            : null,
        food: runtime.supplies.food,
        temperature: ship && !walker ? ship.temperature : 0,
        gas: gasReading,
        lost: ship?.destroyed ? { age: ship.destroyed.age, cause: ship.destroyed.cause, home: theWorld(runtime.lastLanding?.body.name ?? 'Earth') } : null,
        returned: ship ? performance.now() / 1000 - ship.replacedAt : 99,
        infrared: giant ? runtime.infrared : null,
        crew: runtime.crew ? crewCards(runtime.crew, !!walker, body, !!ship?.landed, !!runtime.mothership?.docked) : [],
    };
};

/** The wind for the status block: on foot from the weather, aboard from what the ship feels (a giant's jets). */
const windAt3 = new THREE.Vector3();
const windReading = (runtime: ExpeditionRuntime, body: ExpeditionBody | null, walker: ExpeditionRuntime['hud']['walker'] | null, ship: ExpeditionRuntime['hud']['ship'] | null) => {
    if (!body || (body.kind === 'rocky' && runtime.altitude > 4000)) return null;
    if (walker) {
        if (runtime.weather.body !== body || runtime.weather.density <= 0) return null;
        windAt3.copy(walker.position).sub(body.position);
        const text = windWords(body, windAt3, runtime.weather.wind);
        return text ? { text: walker.windPush > 0.6 ? `${text} · bracing` : text, strong: walker.windPush > 0.6 } : null;
    }
    if (!ship || ship.wind.lengthSq() < 4) return null;
    windAt3.copy(ship.position).sub(body.position);
    const text = windWords(body, windAt3, ship.wind, body.kind === 'gas');
    return text ? { text, strong: ship.wind.length() > (body.kind === 'gas' ? 150 : 18) } : null;
};

/** The radio's readout, or null when it is off. */
const radioSnapshot = (runtime: ExpeditionRuntime): Snapshot['radio'] => {
    const band = runtime.radio.band;
    if (!band) return null;
    const info = BANDS.find((b) => b.id === band)!;
    const reading = runtime.radio.reading;
    const source = reading?.source ?? null;
    const found = !!source && runtime.stats.signals.includes(source.id);
    return {
        band: info.label,
        frequency: info.frequency,
        strength: reading?.strength ?? 0,
        audible: reading?.audible ?? 0,
        name: !source || (reading?.audible ?? 0) < 0.02 ? 'Static' : found || runtime.stats.heard.includes(source.id) && source.sky ? source.name : source.unknown,
        distance: source && !source.sky && Number.isFinite(reading?.distance ?? Infinity) ? formatDistance(reading!.distance) : '',
        found,
    };
};

/** How dark the view is a number of seconds after losing the ship: the wreck is seen, then the view goes black. */
const lossDarkness = (age: number) => {
    const end = LOSS_SECONDS;
    if (age < 1.8) return (age / 1.8) * 0.3;
    if (age < end - 1.5) return 0.3 + ((age - 1.8) / (end - 3.3)) * 0.25;
    return 0.55 + Math.min(1, (age - (end - 1.5)) / 1.5) * 0.45;
};

/** Seconds a notice stays up: long enough to read. */
const noticeHold = (text: string) => Math.max(3, text.length / 15);

/**
 * Notices are written in capitals where they are raised; shown in sentence
 * case, as the rest of the site is. Names keep their capitals (worlds, TON 618,
 * NASA), and so do single letters, which are keys to press.
 */
const NAMES = new Map<string, string>([
    ...EXPEDITION_BODIES.map((b) => [b.name.toUpperCase(), b.name] as [string, string]),
    ['TON', 'TON'], ['NASA', 'NASA'], ['KEPLER', 'Kepler'], ['GALILEO', 'Galileo'], ['JUNO', 'Juno'],
    ['SUN', 'Sun'], ['AU', 'AU'], ['WOW!', 'Wow!'], ['K', 'K'], ['SAGITTARIUS', 'Sagittarius'], ['DALLAS', 'Dallas'], ['TEXAS', 'Texas'],
    // The ships and the crew.
    ['ARGO', 'Argo'], ['HALCYON', 'Halcyon'], ['DEV', 'Dev'], ['ARORA', 'Arora'], ['NOOR', 'Noor'], ['HADDAD', 'Haddad'],
    ['KAI', 'Kai'], ['MENDES', 'Mendes'], ['AMARA', 'Amara'], ['OKAFOR', 'Okafor'],
]);
const sentenceCase = (text: string) => {
    if (text !== text.toUpperCase()) return text;
    return text.split(' · ').map((part) => part.split(' ').map((word, i) => {
        const bare = word.replace(/[^A-Z0-9!]/g, '');
        const name = NAMES.get(bare);
        let out: string;
        if (name) out = word.replace(bare, name);
        // A single letter is a key to press (but A and I are words).
        else if (/^[B-HJ-Z]$/.test(bare) || /^\([A-Z]\)$/.test(word) || /\d/.test(word)) out = word;
        else out = word.toLowerCase();
        return i === 0 ? out.charAt(0).toUpperCase() + out.slice(1) : out;
    }).join(' ')).join(' · ');
};

/** A world's name as it reads in a sentence ("on the Moon", "on Mars"). */
const theWorld = (name: string) => (name === 'Moon' ? 'the Moon' : name);

/** What killed the explorer, for the death card. */
const DEATH_TEXT: Record<string, string> = {
    fall: 'The fall was harder than the suit could soften.',
    air: 'The suit ran out of air.',
    heat: 'The suit\'s cooling gave out, and the heat got through.',
    hunger: 'Too long without food.',
    lightning: 'Struck by lightning out in the open.',
    tornado: 'Caught in the open by the tornado.',
    radiation: 'The proton storm\'s dose was more than a body takes.',
    predator: 'A predator got to you.',
    injuries: 'The injuries were too much.',
};
const formatSurvived = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`);

const LOSS_TEXT: Record<string, string> = {
    heat: 'The heat shield burned through. Nothing built survives that close to the Sun for long.',
    asteroid: 'It hit one rock too many. In a cluster, slow down: the faster the hit, the more it costs.',
    impact: 'It hit the ground too fast for the shield to take.',
    pressure: 'The air crushed it. Deep in a giant the pressure keeps climbing, with no floor to stop on: NASA\'s Galileo probe lasted to 23 bar.',
    lightning: 'Lightning in the water clouds, a thousand times stronger than on Earth, burned through what was left of the shield.',
    ice: 'It met the rings too fast. Their ice comes in pieces up to the size of a house, all moving together: slow to their speed among them.',
    debris: 'The debris cloud got it. Every fragment there is going round at orbital speed: match it before flying in among them, as Kessler warned.',
};

const SHIP_CONTROLS: [string, string][] = [
    ['Mouse', 'Steer (click to lock the pointer)'],
    ['W / S', 'Throttle up / down'],
    ['A / D', 'Turn · Q / E roll'],
    ['Shift', 'Boost'],
    ['Space', 'Pulse drive (open space)'],
    ['F', 'Land / take off'],
    ['E', 'Step outside when landed'],
    ['M', 'Maps · set a course'],
    ['G', 'Autopilot to the course'],
    ['1 - 4', 'Play as Dev, Noor, Kai or Amara'],
    ['U', 'Dock with the Argo · undock'],
    ['T', 'Lamps'],
    ['I', 'Infrared imager, near a giant'],
    ['Z', 'Hold to look closer: the Moon, a planet'],
    ['Click', 'Hold to mine an asteroid'],
    ['N', 'Music on / off'],
    ['B', 'Sounds on / off'],
    ['L', 'Show every world'],
    ['O', 'Graphics · detail and resolution'],
    [', / .', 'Time warp: watch the worlds turn'],
    ['H', 'Show / hide controls'],
];

const WALK_CONTROLS: [string, string][] = [
    ['W A S D', 'Walk · Shift to run'],
    ['Mouse', 'Look around'],
    ['Space', 'Jump · hold for the jetpack'],
    ['G', 'Call your ship: it flies to you'],
    ['1 - 4', 'Play as Dev, Noor, Kai or Amara'],
    ['X', 'Jetpack down, in weak gravity'],
    ['Click', 'Hold to mine crystals'],
    ['T', 'Torch'],
    ['Z', 'Hold to look closer: the Moon, a planet'],
    ['R', 'Eat'],
    ['C', 'Craft with crystals'],
    ['J', 'Chapters, medals and challenges'],
    ['E', 'Read a monolith · board the ship'],
    ['M', 'Map · find your way back'],
    ['N', 'Music on / off'],
    ['B', 'Sounds on / off'],
    ['O', 'Graphics · detail and resolution'],
    [', / .', 'Time warp: watch the Sun cross the sky'],
    ['H', 'Show / hide controls'],
];

/** The toolbar's icons: one stroke weight, drawn on a 24 unit grid. */
const ICONS: Record<string, string> = {
    map: 'M9 4.5 3.5 6.6v13l5.5-2.1 6 2.1 5.5-2.1v-13l-5.5 2.1-6-2.1ZM9 4.5v13M15 6.6v13',
    craft: 'M14.6 3.6a4.5 4.5 0 0 0-5.4 5.8L3.6 15a2 2 0 0 0 2.8 2.8L12 12.2a4.5 4.5 0 0 0 5.8-5.4l-2.6 2.6-2.4-.6-.6-2.4Z',
    radio: 'M12 13.2v7.3M8.6 9.6a4.8 4.8 0 0 1 6.8 0M5.8 6.8a8.8 8.8 0 0 1 12.4 0M12 11.2h.01',
    infrared: 'M13.8 14.6V5.4a1.8 1.8 0 0 0-3.6 0v9.2a3.8 3.8 0 1 0 3.6 0ZM12 11.5v5.5',
    sound: 'M10.5 5.5 6.5 9H3.5v6h3l4 3.5v-13ZM15 9a4.2 4.2 0 0 1 0 6M17.8 6.2a8.2 8.2 0 0 1 0 11.6',
    music: 'M9 18V5.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM9 9.5l11-2',
    'music-off': 'M9 18V5.5l11-2V16M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM3 3l18 18',
    mute: 'M10.5 5.5 6.5 9H3.5v6h3l4 3.5v-13ZM15.5 9.5l5 5M20.5 9.5l-5 5',
    graphics: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
    keys: 'M4.5 6.5h15a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5ZM7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8',
    leave: 'M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 5.5 12 10 7.5M5.5 12h10',
};
const Icon = ({ name }: { name: string }) => (
    <svg className="expedition-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={ICONS[name]} /></svg>
);


/** The dial's top: the pulse drive's fastest, in units a second. */
const DIAL_TOP = Math.log10(1 + 2e9);
const dialAt = (speed: number) => Math.min(0.999, Math.log10(1 + Math.max(0, speed)) / DIAL_TOP);
const DIAL_TICKS = Array.from({ length: 10 }, (_, k) => dialAt(10 ** k));
const dialPoint = (f: number, r: number) => {
    const a = Math.PI * (1 - f);
    return [150 + r * Math.cos(a), 140 - r * Math.sin(a)];
};

/**
 * The ship's speed on a dial, bottom centre on desktop screens. The scale is logarithmic, a tick
 * for every tenfold, so walking pace and the pulse drive both read on one arc; the arc turns
 * amber while the pulse drive runs.
 */
const SpeedDial = ({ value, speed, unit, detail, pulse }: { value: number; speed: string; unit: string; detail: string; pulse: boolean }) => {
    const [x, y] = dialPoint(dialAt(value), 128);
    return (
        <div className={`expedition-dial${pulse ? ' is-pulse' : ''}`} aria-hidden="true" data-hud-panel>
            <svg viewBox="0 0 300 150">
                <path className="expedition-dial__track" d="M22 140 A128 128 0 0 1 278 140" />
                {value > 0.5 && <path className="expedition-dial__value" d={`M22 140 A128 128 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} />}
                {DIAL_TICKS.map((f, k) => {
                    const [x1, y1] = dialPoint(f, 114);
                    const [x2, y2] = dialPoint(f, 104);
                    return <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} />;
                })}
            </svg>
            <b>{speed}</b>
            <span>{unit}{detail}</span>
        </div>
    );
};

export const ExpeditionHUD = ({ runtime, input, onExit, progress, graphics }: {
    runtime: ExpeditionRuntime;
    input: ExpeditionInput;
    onExit: () => void;
    progress: ExpeditionProgress;
    graphics: GraphicsControl;
}) => {
    const readRef = useRef<ReadonlySet<string>>(new Set());
    readRef.current = new Set(progress.sites);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    // Whether a giant is near enough for the infrared imager (the key handler reads it).
    const infraredNear = useRef(false);
    infraredNear.current = snapshot?.infrared != null;
    const toggleInfrared = useCallback(() => {
        if (!infraredNear.current) return;
        runtime.infrared = !runtime.infrared;
        cue(runtime, 'scan', 0.5);
    }, [runtime]);
    const [showHelp, setShowHelp] = useState(true);
    const [mapOpen, setMapOpen] = useState(false);
    const [craftOpen, setCraftOpen] = useState(false);
    const [storyOpen, setStoryOpen] = useState(false);
    const [graphicsOpen, setGraphicsOpen] = useState(false);
    // A new player reads the prologue first (once on this device).
    const [prologueOpen, setPrologueOpen] = useState(() => progress.story.length === 0 && !prologueRead());
    const closePrologue = useCallback(() => setPrologueOpen(false), []);
    const [story, setStory] = useState<StoryState | null>(null);
    const progressRef = useRef(progress);
    progressRef.current = progress;
    // The saved progress with the live records, as the story and its medals are measured.
    const liveRef = useRef(progress);
    const helpTouched = useRef(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const coarse = useCoarsePointer();
    // Species already known when the expedition started, and when new ones were first seen.
    const knownSpecies = useRef(new Set(progress.fauna));
    const firstSeen = useRef(new Map<string, number>());

    const [music, setMusic] = useState(() => readSwitch(MUSIC_KEY));
    const [sounds, setSounds] = useState(() => readSwitch(SOUNDS_KEY));
    const toggleMusic = useCallback(() => setMusic((on) => !on), []);
    const toggleSounds = useCallback(() => setSounds((on) => !on), []);
    useEffect(() => {
        soundEngine().setMusic(music);
        keepSwitch(MUSIC_KEY, music);
    }, [music]);
    useEffect(() => {
        soundEngine().setSounds(sounds);
        keepSwitch(SOUNDS_KEY, sounds);
    }, [sounds]);
    // Each channel's level (Settings › Sound), kept on this device.
    const [soundSettings, setSoundSettings] = useState(loadSoundSettings);
    useEffect(() => {
        soundEngine().setVolumes(effectiveVolumes(soundSettings));
        saveSoundSettings(soundSettings);
    }, [soundSettings]);
    const toggleMap = useCallback(() => setMapOpen((open) => !open), []);
    const toggleCraft = useCallback(() => setCraftOpen((open) => !open), []);
    const toggleGraphics = useCallback(() => setGraphicsOpen((open) => !open), []);
    const menuOpen = mapOpen || craftOpen || storyOpen || graphicsOpen || prologueOpen;
    const wasOpen = useRef(menuOpen);
    useEffect(() => {
        runtime.menuOpen = menuOpen;
        if (menuOpen !== wasOpen.current) {
            wasOpen.current = menuOpen;
            cue(runtime, 'menu', menuOpen ? 1 : 0.7);
        }
        if (menuOpen) {
            input.keys.clear();
            input.primary = false;
        }
    }, [menuOpen, runtime, input]);

    useEffect(() => {
        let frame = 0;
        let actionsBottom = -1;
        let last = 0;
        let lastStory = 0;
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            if (now - last < 100) return;
            last = now;
            // The story, a couple of times a second, from the saved progress and the live records.
            if (now - lastStory > 500) {
                lastStory = now;
                const saved = progressRef.current;
                liveRef.current = { ...saved, crystals: runtime.inventory.crystals, fauna: [...runtime.fauna.discovered], supplies: runtime.supplies, stats: runtime.stats };
                // Earth's recovery follows the story (revival.ts): the ground, grass and trees read it.
                REVIVAL.value = earthRevival(liveRef.current);
                // Ash still in the air while the land is dead: a dusty grey sky, blue again as it greens.
                setAshSky(EARTH, 0.75 * (1 - THREE.MathUtils.smoothstep(REVIVAL.value, 0.15, 0.85)));
                const state = storyState(liveRef.current);
                setStory(state);
                // Where the chapter wants the player next: its world, and on each world the first
                // objective still to do that has a place (the gold marker).
                runtime.story.chapter = state.chapter?.id ?? null;
                const next = state.objectives.find((o) => !o.done)?.objective;
                runtime.story.world = next?.world ?? next?.aim?.body ?? state.chapter?.world ?? null;
                const aimed = new Set<string>();
                runtime.story.aims = [];
                for (const o of state.objectives) {
                    const aim = o.objective.aim;
                    if (o.done || !aim || aimed.has(aim.body)) continue;
                    aimed.add(aim.body);
                    runtime.story.aims.push({ id: o.objective.id, ...aim });
                }
            }
            const root = rootRef.current;
            const rect = root?.getBoundingClientRect();
            // The crew column sits just under the toolbar, however many rows that wraps into.
            const actions = root?.querySelector<HTMLElement>('.expedition-hud__actions');
            if (root && rect && actions) {
                const bottom = Math.round(actions.getBoundingClientRect().bottom - rect.top);
                if (bottom > 0 && bottom !== actionsBottom) {
                    actionsBottom = bottom;
                    root.style.setProperty('--actions-bottom', `${bottom}px`);
                }
            }
            const panels: Box[] = [];
            root?.querySelectorAll<HTMLElement>('[data-hud-panel]').forEach((element) => {
                const r = element.getBoundingClientRect();
                if (r.width > 0 && rect) panels.push({ left: r.left - rect.left, top: r.top - rect.top, right: r.right - rect.left, bottom: r.bottom - rect.top });
            });
            setSnapshot(buildSnapshot(runtime, rect?.width ?? window.innerWidth, rect?.height ?? window.innerHeight, readRef.current, panels));
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [runtime]);

    // Crew switches and docking say what happened on the notice line.
    const crewNotice = useCallback((message: string | null) => {
        const ship = runtime.player?.ship;
        if (!message || !ship) return;
        ship.notice = message;
        ship.noticeTime = performance.now() / 1000;
    }, [runtime]);
    const [crewHover, setCrewHover] = useState<number | null>(null);

    // The controls card introduces itself, then gets out of the way.
    useEffect(() => {
        const timer = window.setTimeout(() => { if (!helpTouched.current) setShowHelp(false); }, 14000);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (runtime.sites.open) return;
            if (event.code === 'KeyH') {
                helpTouched.current = true;
                setShowHelp((v) => !v);
            }
            if (menuOpen) return;
            if (event.code === 'KeyM') setMapOpen(true);
            if (event.code === 'KeyC') setCraftOpen(true);
            if (event.code === 'KeyJ') setStoryOpen(true);
            if (event.code === 'KeyN') toggleMusic();
            if (event.code === 'KeyB') toggleSounds();
            if (event.code === 'KeyL') runtime.allMarkers = !runtime.allMarkers;
            if (event.code === 'KeyO') setGraphicsOpen(true);
            if (event.code === 'KeyV') {
                runtime.radio.band = nextBand(runtime.radio.band);
                cue(runtime, 'radio', 0.6);
            }
            if (event.code === 'KeyI') toggleInfrared();
            const digit = /^Digit([1-4])$/.exec(event.code);
            if (digit) crewNotice(runtime.actions.switchCrew(Number(digit[1]) - 1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [runtime, menuOpen, toggleMusic, toggleSounds, toggleInfrared, crewNotice]);

    const s = snapshot;
    const now = performance.now() / 1000;
    let newSpecies = false;
    if (s?.fauna && !knownSpecies.current.has(s.fauna.id)) {
        if (!firstSeen.current.has(s.fauna.id)) firstSeen.current.set(s.fauna.id, now);
        newSpecies = now - (firstSeen.current.get(s.fauna.id) ?? now) < 6;
    }
    const controls = s?.mode === 'walk' ? WALK_CONTROLS : SHIP_CONTROLS;

    return (
        <div ref={rootRef} className={`expedition-hud${s?.discovery ? ' has-card' : ''}${s?.crossing ? ' is-crossing' : ''}`} aria-live="polite">
            {s && (
                <>
                    <div className="expedition-hud__left">
                        {s.expedition && (
                            <section className="expedition-hud__expedition" aria-label="Expedition" data-hud-panel>
                                <small>Expedition · {s.expedition.title}</small>
                                <strong>{s.expedition.stage}</strong>
                                {s.expedition.detail && <p>{s.expedition.detail}</p>}
                            </section>
                        )}
                        <section className={`expedition-hud__objective${s.objective.alert ? ' is-alert' : ''}`} role={s.objective.alert ? 'alert' : undefined} data-hud-panel>
                            <small>{s.objective.alert ? 'Ship\'s computer' : s.objective.guide ?? 'Expedition log'}</small>
                            <strong>{s.objective.title}</strong>
                            <p>{s.objective.body}</p>
                            {s.objective.guide && (
                                <button type="button" className="expedition-hud__skip" onClick={() => skipFirstFlight(firstFlight())}>Skip the guide</button>
                            )}
                        </section>
                        {story && !s.expedition && <StoryPanel story={story} progress={liveRef.current} onOpen={() => setStoryOpen(true)} />}
                        {s.vault && (
                            <section className={`expedition-vault${s.vault.lit ? ' is-running' : ''}`} role="status" data-hud-panel>
                                <small>{s.vault.name} · {s.vault.lit ? `${s.vault.lit} of 3 lit · ${Math.max(0, Math.ceil(s.vault.left))} s` : 'light the runes in this order'}</small>
                                <div className="expedition-vault__key">
                                    {s.vault.letters.map((letter, i) => (
                                        <span key={i} className={i < s.vault!.lit ? 'is-lit' : ''}>
                                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={GLYPH_PATHS[letter] ?? ''} /></svg>
                                            <b>{progress.letters.includes(letter) ? letter : '?'}</b>
                                        </span>
                                    ))}
                                </div>
                                <p>Hold click on a rune stone to light it. A wrong one, or too slow, and they all go dark.</p>
                            </section>
                        )}
                    </div>

                    {s.crew.length > 0 && (() => {
                        const tip = crewHover !== null ? s.crew[crewHover] : null;
                        return (
                            <section className="expedition-hud__crew" aria-label="Crew" data-hud-panel>
                                {s.crew.map((c, i) => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        className={`expedition-hud__crew-face${c.active ? ' is-active' : ''}`}
                                        aria-label={`${c.name}, ${c.role}. ${c.status}`}
                                        aria-pressed={c.active}
                                        onClick={() => crewNotice(runtime.actions.switchCrew(i))}
                                        onPointerEnter={() => setCrewHover(i)}
                                        onPointerLeave={() => setCrewHover(null)}
                                        onFocus={() => setCrewHover(i)}
                                        onBlur={() => setCrewHover(null)}
                                    >
                                        <img src={`${import.meta.env.BASE_URL}textures/crew/${c.id}.webp`} alt="" width={44} height={44} draggable={false} />
                                        <kbd>{i + 1}</kbd>
                                    </button>
                                ))}
                                {tip && (
                                    <p className="expedition-hud__crew-tip" style={{ ['--row' as string]: crewHover }} aria-hidden="true">
                                        <b>{tip.name}</b><span>{tip.role}</span><span>{tip.active ? `You · ${tip.status}` : tip.status}</span>
                                    </p>
                                )}
                            </section>
                        );
                    })()}
                    <nav className="expedition-hud__actions" aria-label="Expedition" data-hud-panel>
                        <div className="expedition-hud__tools">
                            <button type="button" onClick={toggleMap} aria-pressed={mapOpen} aria-label="Map" data-tip={coarse ? undefined : 'Map · M'}><Icon name="map" /></button>
                            <button type="button" onClick={toggleCraft} aria-pressed={craftOpen} aria-label="Craft" data-tip={coarse ? undefined : 'Craft · C'}><Icon name="craft" /></button>
                            <button
                                type="button"
                                className={s.radio ? 'has-label' : ''}
                                onClick={() => { runtime.radio.band = nextBand(runtime.radio.band); cue(runtime, 'radio', 0.6); }}
                                aria-pressed={!!s.radio}
                                aria-label={s.radio ? `Radio, ${s.radio.frequency}; press for the next band` : 'Radio'}
                                data-tip={coarse ? undefined : 'Radio · V'}
                            >
                                <Icon name="radio" />{s.radio && <span className="expedition-hud__wide">{s.radio.frequency}</span>}
                            </button>
                            {s.infrared !== null && (
                                <button type="button" onClick={toggleInfrared} aria-pressed={s.infrared} aria-label="Infrared imager" data-tip={coarse ? undefined : 'Infrared · I'}><Icon name="infrared" /></button>
                            )}
                            <button type="button" onClick={toggleMusic} aria-pressed={music} aria-label={music ? 'Music on; press to turn off' : 'Music off; press to turn on'} className={music ? '' : 'is-muted'} data-tip={coarse ? undefined : `${music ? 'Music on' : 'Music off'} · N`}>
                                <Icon name={music ? 'music' : 'music-off'} />
                            </button>
                            <button type="button" onClick={toggleSounds} aria-pressed={sounds} aria-label={sounds ? 'Sounds on; press to turn off' : 'Sounds off; press to turn on'} className={sounds ? '' : 'is-muted'} data-tip={coarse ? undefined : `${sounds ? 'Sounds on' : 'Sounds off'} · B`}>
                                <Icon name={sounds ? 'sound' : 'mute'} />
                            </button>
                            <button type="button" onClick={toggleGraphics} aria-pressed={graphicsOpen} aria-label="Settings: sound and graphics" data-tip={coarse ? undefined : 'Settings · O'}><Icon name="graphics" /></button>
                            {!coarse && <button type="button" onClick={() => { helpTouched.current = true; setShowHelp((v) => !v); }} aria-pressed={showHelp} aria-label="Controls" data-tip="Controls · H"><Icon name="keys" /></button>}
                        </div>
                        <button type="button" className="expedition-hud__leave is-exit" onClick={onExit} aria-label="Leave expedition"><Icon name="leave" /><span>Leave</span></button>
                    </nav>

                    <Compass runtime={runtime} coarse={coarse} />
                    {s.markers.map((m) => (
                        <div
                            key={m.id}
                            className={`expedition-hud__marker${m.behind ? ' is-edge' : ''}${m.compact ? ' is-compact' : ''}${m.course ? ' is-course' : ''}`}
                            style={{ transform: `translate(${m.x}px, ${m.y}px)`, ['--marker' as string]: m.course ? '#ffb547' : m.color, ['--shift' as string]: `${m.shift}px` }}
                        >
                            <i aria-hidden="true" />
                            {!m.compact && <span><b>{m.name}</b> {m.label}</span>}
                            {!m.compact && <em>{m.distance}</em>}
                        </div>
                    ))}

                    {s.sites.map((m) => (
                        <div
                            key={m.id}
                            className={`expedition-hud__site${m.read ? ' is-read' : ''}${m.obelisk ? ' is-obelisk' : ''}`}
                            style={{ transform: `translate(${m.x}px, ${m.y}px)`, ['--shift' as string]: `${m.shift}px` }}
                        >
                            <i aria-hidden="true" />
                            {!m.compact && <span>{m.name}</span>}
                            {!m.compact && <em>{m.distance}</em>}
                        </div>
                    ))}

                    {s.pulse > 0.05 && <div className="expedition-hud__pulse" style={{ opacity: Math.min(1, s.pulse * 1.4) }}>Pulse drive</div>}
                    {s.radio && (
                        <section className="expedition-radio" aria-label="Radio">
                            <small>Radio · {s.radio.band} · {s.radio.frequency}</small>
                            <div className="expedition-radio__meter" aria-hidden="true">
                                {Array.from({ length: 12 }, (_, k) => <i key={k} className={(k + 0.5) / 12 < s.radio!.strength ? 'is-on' : (k + 0.5) / 12 < s.radio!.audible ? 'is-faint' : ''} />)}
                            </div>
                            <strong>{s.radio.name}{s.radio.found ? ' · found' : ''}</strong>
                            <span>{s.radio.strength > 0.05 ? `Strength ${Math.round(s.radio.strength * 100)}%${s.radio.distance ? ` · ${s.radio.distance}` : ''}` : s.radio.audible > 0.02 ? 'Faint · sweep slowly to find it' : 'Nothing on this band here · V to change'}</span>
                        </section>
                    )}
                    {s.scan && !s.scan.known && (
                        <div className="expedition-scan" style={{ ['--p' as string]: s.scan.progress }}>
                            <i aria-hidden="true" />
                            <span>Scanning · {s.scan.name}</span>
                        </div>
                    )}
                    {s.discovery && (
                        <section className="expedition-discovery" style={{ opacity: Math.min(1, (12 - s.discovery.age) / 1.5) }} role="status">
                            <small>{s.discovery.label}</small>
                            <strong>{s.discovery.name}</strong>
                            <p>{s.discovery.blurb}</p>
                        </section>
                    )}

                    {s.hurt > 0.01 && <div className="expedition-hud__hurt" style={{ opacity: Math.min(1, 0.35 + s.hurt) }} aria-hidden="true" />}
                    {s.danger > 0.2 && <div className="expedition-hud__danger" style={{ opacity: s.danger * 0.85 }} aria-hidden="true" />}
                    {s.fishing && (
                        <div className={`expedition-fishing is-${s.fishing.phase}`} role="status">
                            <small>{s.fishing.phase === 'wait' ? 'Line out' : s.fishing.phase === 'bite' ? 'A bite!' : s.fishing.phase === 'reel' ? 'Fish on' : s.fishing.outcome === 'caught' ? `${s.fishing.fish} caught` : s.fishing.outcome === 'snapped' ? 'Line snapped' : ''}</small>
                            {s.fishing.phase === 'reel' && (
                                <>
                                    <label><span>Tension</span><i style={{ ['--v' as string]: s.fishing.tension }} data-hot={s.fishing.tension > 0.75 ? '' : undefined} /></label>
                                    <label><span>Reeled in</span><i style={{ ['--v' as string]: s.fishing.progress }} /></label>
                                </>
                            )}
                        </div>
                    )}
                    {s.temperature > HEAT_WARNING && !s.lost && (
                        <div className="expedition-hud__heat" style={{ opacity: Math.min(1, (s.temperature - HEAT_WARNING) / (HEAT_LIMIT + 350 - HEAT_WARNING)) }} aria-hidden="true" />
                    )}
                    {s.returned < 1.6 && <div className="expedition-hud__return" style={{ opacity: Math.max(0, 1 - s.returned / 1.6) }} aria-hidden="true" />}
                    {s.lost && (
                        <div className="expedition-hud__lost" role="alert" style={{ background: `rgba(0, 0, 0, ${lossDarkness(s.lost.age)})` }}>
                            <strong style={{ opacity: THREE.MathUtils.clamp((s.lost.age - 0.8) / 0.8, 0, 1) }}>Ship destroyed</strong>
                            <span style={{ opacity: THREE.MathUtils.clamp((s.lost.age - 1.6) / 0.8, 0, 1) }}>{LOSS_TEXT[s.lost.cause] ?? LOSS_TEXT.impact}</span>
                            <span style={{ opacity: THREE.MathUtils.clamp((s.lost.age - 2.2) / 0.8, 0, 1) }}>A new ship is waiting on {s.lost.home}. The crystals aboard this one are lost with it.{s.deaths > 0 ? ` Deaths: ${s.deaths}.` : ''}</span>
                        </div>
                    )}
                    {s.down && (
                        <div className="expedition-hud__down" role="alert">
                            <strong>{s.death ? `You died on ${s.death.world}` : 'You died'}</strong>
                            {s.death && <span>{DEATH_TEXT[s.death.cause] ?? DEATH_TEXT.injuries}</span>}
                            {s.death && <span>{s.death.survived > 1 ? `Time out there ${formatSurvived(s.death.survived)} · ` : ''}death {s.death.count}</span>}
                            <span>Your suit's beacon is bringing you back.</span>
                        </div>
                    )}

                    {s.notice && s.noticeAge < noticeHold(s.notice) && (
                        <div className="expedition-hud__notice" style={{ opacity: Math.min(1, (noticeHold(s.notice) - s.noticeAge) * 1.5) }}>{sentenceCase(s.notice)}</div>
                    )}

                    {s.fauna && (
                        <div className={`expedition-hud__fauna${newSpecies ? ' is-new' : ''}`}>
                            <small>{s.fauna.alien ? 'Alien life' : newSpecies ? 'New species discovered' : 'Fauna'}</small>
                            <strong>{s.fauna.name}</strong>
                            <span>{s.fauna.temperament} · {s.location}</span>
                        </div>
                    )}

                    {s.speech && !s.argo && (
                        <div className="expedition-argo is-person" role="status" aria-live="polite">
                            <b>{s.speech.name}</b>
                            <span>{s.speech.line}</span>
                        </div>
                    )}
                    {s.argo && (
                        <div className={`expedition-argo is-${s.argo.tone}`} role="status" aria-live="polite">
                            <b>Argo</b>
                            <span>{s.argo.text}</span>
                        </div>
                    )}

                    {s.prompts.length > 0 && !s.down && (
                        <div className="expedition-hud__prompts">
                            {s.prompts.map((p, i) => {
                                // "E  Board ship": the key in a key cap (on a touch screen, only what it does).
                                // A hint that has stood a while fades out of the way; H brings them all back.
                                // A hint on screen is a panel: markers slide clear of it, not under it.
                                const quiet = s.quiet[i] && !showHelp ? 'is-quiet' : undefined;
                                const panel = quiet ? undefined : { 'data-hud-panel': true };
                                const at = p.indexOf('  ');
                                if (at < 0) return <span key={p} className={quiet} {...panel}>{p}</span>;
                                return coarse
                                    ? <span key={p} className={quiet} {...panel}>{p.slice(at + 2)}</span>
                                    : <span key={p} className={quiet} {...panel}><kbd>{p.slice(0, at)}</kbd>{p.slice(at + 2)}</span>;
                            })}
                        </div>
                    )}

                    <section className="expedition-hud__status" data-hud-panel>
                        <small>{s.sublabel}</small>
                        <strong>{s.location}</strong>
                        <div className="expedition-hud__speed">
                            <b>{s.speed >= 1e6 ? (s.speed / 1e6).toFixed(s.speed >= 1e8 ? 0 : 1) : Math.round(s.speed)}</b>
                            <span>{s.speed >= 1e6 ? 'Mu/s' : 'u/s'}{s.mode === 'ship' && s.inAir && Number.isFinite(s.altitude) ? ` · alt ${Math.round(s.gas ? s.altitude : Math.max(0, s.altitude))}` : ''}</span>
                        </div>
                        {s.time && <p className="expedition-hud__hull">{s.time}</p>}
                        {s.ground && <p className={`expedition-hud__hull${s.ground.hot ? ' is-hot' : ''}`}>{s.ground.text}</p>}
                        {s.wind && <p className={`expedition-hud__hull${s.wind.strong ? ' is-hot' : ''}`}>{s.wind.text}</p>}
                        {s.gas && (
                            <p className={`expedition-hud__hull${s.gas.pressure > s.gas.rating ? ' is-failing' : s.gas.pressure > s.gas.rating * 0.6 ? ' is-hot' : ''}`}>
                                {s.gas.pressure < 10 ? s.gas.pressure.toFixed(2) : Math.round(s.gas.pressure)} bar · {Math.round(s.gas.temperature)} K · rated {s.gas.rating} bar
                            </p>
                        )}
                        {s.mode === 'ship' && s.temperature > 500 && (
                            <p className={`expedition-hud__hull${s.temperature > HEAT_LIMIT ? ' is-failing' : s.temperature > HEAT_WARNING ? ' is-hot' : ''}`}>
                                Hull {Math.round(s.temperature).toLocaleString('en-US')} K · rated {HEAT_LIMIT.toLocaleString('en-US')} K
                            </p>
                        )}
                        {s.dilation !== null && (
                            <p className="expedition-hud__dilation">Time dilation ×{s.dilation < 10 ? s.dilation.toFixed(3) : s.dilation.toFixed(1)} · 1 hour here is {formatDuration(s.dilation)} at home</p>
                        )}
                        <div className="expedition-hud__bars">
                            {s.bars.map((bar) => (
                                <label key={bar.label}><span>{bar.label}</span><i style={{ ['--v' as string]: bar.value }} data-tone={bar.tone} /></label>
                            ))}
                        </div>
                    </section>

                    {!coarse && (
                        <SpeedDial
                            value={s.speed}
                            speed={s.speed >= 1e6 ? (s.speed / 1e6).toFixed(s.speed >= 1e8 ? 0 : 1) : String(Math.round(s.speed))}
                            unit={s.speed >= 1e6 ? 'Mu/s' : 'u/s'}
                            detail={s.mode === 'ship' && s.inAir && Number.isFinite(s.altitude) ? ` · altitude ${Math.round(s.gas ? s.altitude : Math.max(0, s.altitude))}` : ''}
                            pulse={s.pulse > 0.05}
                        />
                    )}

                    <section className="expedition-hud__cargo" aria-label="Discoveries" data-hud-panel>
                        <div title={`${progress.sites.length} of ${DATA_SITES.length} sites read`}><Landmark className="expedition-hud__item" aria-hidden="true" /><b>{progress.sites.length}<em>/{DATA_SITES.length}</em></b><small>sites</small></div>
                        <div title={`${progress.letters.length} of ${ALPHABET.length} glyphs learned`}><ScrollText className="expedition-hud__item" aria-hidden="true" /><b>{progress.letters.length}<em>/{ALPHABET.length}</em></b><small>glyphs</small></div>
                        <div title="Species found"><PawPrint className="expedition-hud__item" aria-hidden="true" /><b>{Math.max(progress.fauna.length, runtime.fauna.discovered.size)}<em>/{TOTAL_SPECIES}</em></b><small>species</small></div>
                        <div><Gem className="expedition-hud__item" aria-hidden="true" /><b>{s.crystals}</b><small>crystals</small></div>
                        <div><Apple className="expedition-hud__item" aria-hidden="true" /><b>{s.food}</b><small>food</small></div>
                    </section>

                    {/* The card that introduces itself steps aside for a discovery card (opened with H, it stays). */}
                    {showHelp && !coarse && !(s.discovery && !helpTouched.current) && (
                        <section className="expedition-hud__help" aria-label="Controls" data-hud-panel>
                            <strong>{s.mode === 'walk' ? 'On foot' : 'Flight'} controls</strong>
                            <dl>
                                {controls.map(([key, action]) => (
                                    <div key={key} className="expedition-hud__help-row"><dt>{key}</dt><dd>{action}</dd></div>
                                ))}
                            </dl>
                        </section>
                    )}

                    {coarse && !menuOpen && <TouchControls input={input} mode={s.mode} landed={s.landed} course={s.course} autopilot={s.autopilot} lowGravity={s.lowGravity} swimming={s.swimming} />}
                </>
            )}
            {mapOpen && <MapDialog runtime={runtime} read={readRef.current} onClose={() => setMapOpen(false)} />}
            {craftOpen && <CraftPanel runtime={runtime} onClose={() => setCraftOpen(false)} />}
            {graphicsOpen && (
                <GraphicsPanel
                    control={graphics}
                    sound={{ settings: soundSettings, onChange: setSoundSettings, music, sounds, toggleMusic, toggleSounds }}
                    onClose={() => setGraphicsOpen(false)}
                />
            )}
            {storyOpen && story && (
                <StoryLog
                    story={story}
                    progress={{ ...progress, supplies: runtime.supplies, stats: runtime.stats, fauna: [...runtime.fauna.discovered] }}
                    onClose={() => setStoryOpen(false)}
                    active={runtime.expedition?.id ?? null}
                    onBegin={(id) => { beginExpedition(runtime, id, startRun); setStoryOpen(false); }}
                    onAbandon={() => { runtime.expedition = null; setStoryOpen(false); }}
                    crew={s?.crew ?? []}
                    onSwitch={(i) => { crewNotice(runtime.actions.switchCrew(i)); setStoryOpen(false); }}
                    onPrologue={() => { setStoryOpen(false); setPrologueOpen(true); }}
                />
            )}
            {prologueOpen && <Prologue onClose={closePrologue} />}
        </div>
    );
};
