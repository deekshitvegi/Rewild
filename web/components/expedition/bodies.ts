import * as THREE from 'three';
import { SOLAR_SYSTEM_DATA } from '../../data';
import type { CelestialBodyData } from '../../types';
import { craterField, domes, fbm, linearDunes, ridged, shields, smoothstep } from './noise';
import { fromEquatorial, moonDirection, planetPosition } from './orbits';
import { earthGLSL, earthHeightFunction, earthUniforms, usesEarthMap } from './earth';
import { marsGLSL, marsHeightFunction, marsUniforms, usesMarsMap } from './mars';
import { streamCarve, streamWater, streamsGLSL, type Streams } from './streams';

/**
 * The expedition's star system: the real Solar System, with the portfolio's
 * sections on its worlds.
 *
 * The Sun is at the middle and every planet is where it really stood on the
 * system's date (orbits.ts), at its true size relative to the others. The
 * rocky planets can be landed on and keep their portfolio sections (Earth is
 * still Projects, and so on) with terrain, sky and palette of their own:
 * green hills with rock arches, an orange hazy desert with pillars, grey
 * cratered ground with blue crystals. The Moon circles Earth; the ice giants,
 * which have no ground, carry their sections on their largest moons.
 */

export type BiomeKind = 'verdant' | 'desert' | 'cratered' | 'canyon' | 'frozen' | 'glacier' | 'volcanic' | 'methane';

export interface BiomeDef {
    kind: BiomeKind;
    seed: number;
    /** Terrain colours: low ground, mid ground, high ground, steep rock, accent. */
    palette: [string, string, string, string, string];
    /**
     * No air worth the name (the Moon, Mercury, most moons): a black sky, no
     * haze and no glow at the horizon, shadows black but for light reflected
     * off the sunlit ground. (A sliver of 'haze' stays for the flight model,
     * which takes it as the height below which the ship may land.)
     */
    airless?: boolean;
    /** Sky straight up, sky at the horizon, and how thick the haze is. */
    zenith: string;
    horizon: string;
    haze: number;
    /**
     * The colour the air turns where the sun is low, from the ground and along
     * the terminator from space: Earth's orange if not given. Mars's sunsets are
     * blue (its dust sends blue light forwards, round the sun), and so is the
     * haze Pluto shows against the sun.
     */
    sunset?: string;
    /**
     * Whether that sunset colour is a glow round the sun only (dust or haze
     * scattering light forwards: Mars, Pluto, Triton) rather than the whole
     * low sky's (Earth's air).
     */
    sunsetAroundSun?: boolean;
    /**
     * The air lit from behind, when the world stands in front of the Sun: light scattered forwards
     * through its limb into a ring (Earth's red-orange from the Moon in a lunar eclipse, Pluto's and
     * Titan's blue haze). tint: how much more each of red, green and blue is scattered (and so lost
     * on the long way down); g: how strongly forwards (0 even, 1 straight on); gain: brightness;
     * deep: the colour of the haze itself low down (Titan's absorbs blue: orange), white if not given.
     */
    backlit?: { tint: [number, number, number]; g: number; gain: number; deep?: [number, number, number] };
    /**
     * How much of its dimming the haze puts on bright things beyond it, the sky's own glow
     * unchanged (1 if not given; a deck's dimming goes by its square). Titan's haze is so thick
     * that from its ground Saturn, 5.6 degrees across, would be gone (Huygens saw only orange
     * sky); 0.25 lets it show as Stargaze draws it: a ghost by day high in the sky, plainer at
     * night, lost near the horizon.
     */
    clearSight?: number;
    /**
     * How strong the glow round the sun's place in the sky is (1 if not given). Haven's light is
     * TON 618's disk, all round a black shadow: a glow at its centre lay over the shadow as haze.
     */
    sunGlow?: number;
    /** Altitude above the surface where the sky has faded to space. */
    atmosphereHeight: number;
    /**
     * How thick the air looks from far out, as its scale height's share of
     * atmosphereHeight: 0.06 if not given, a sliver at the limb as real air is
     * (the 0.2 the sky needs round someone standing in it drew a broad glowing
     * crescent round Mars). Titan's haze really is hundreds of kilometres deep.
     */
    limb?: number;
    cloudCover: number;
    /** Colour of the glowing crystals that can be mined. */
    crystal: string;
    /** How much of its kind's usual relief this world has (1, all of it, if not given). */
    relief?: number;
    /** How strongly the air fades the land with distance, relative to the haze (1 if not given). */
    aerial?: number;
    /**
     * A deck of cloud that never breaks (Venus's sulphuric acid clouds): its
     * base and top above the ground, its opacity per unit of path, and its
     * colour. From space it hides the ground; from under it, the sky.
     */
    deck?: { base: number; top: number; opacity: number; color: string };
    /**
     * How much of the daylight comes diffused through that cloud rather than
     * straight from the sun (0 clear, 1 none from the disc), and the colour
     * the sunlight is left with.
     */
    overcast?: number;
    sunColor?: string;
    /**
     * Rocks and ice in this world's own palette (the moons and Pluto), rather
     * than the kit made for the first world of its kind.
     */
    ownProps?: boolean;
    /**
     * Lakes and seas of something other than Earth's water (Titan's liquid
     * methane and ethane): wherever the ground lies below `level` (height,
     * game units) it is drowned to that level. `floats` says whether it holds
     * a person up (liquid methane is less than half as dense as water: no).
     * `waves` scales the wind waves (Titan's seas are glassy: Cassini's radar
     * found them smooth to a few millimetres).
     */
    liquid?: {
        level: number; name: string; deep: string; shallow: string; waves: number; floats: boolean;
        /** Clear water over a bed you can see, its colours taken out with depth (as Earth's). */
        clear?: boolean;
        /** Surf on its shores, 0 to 1 (methane seas have none). */
        surf?: number;
    };
    /**
     * A few seas worth the name instead of a pond in every hollow. A low-frequency pattern picks
     * where the sea basins lie; there the ground is pulled down by `deep` metres, elsewhere raised
     * by `lift`, all smoothly (never a step of height). Round `keep` (a unit direction) the ground
     * is left as it was, fully within `keepFrom` metres and easing back by `keepTo`.
     */
    basins?: {
        freq: number; freq2: number; mix2: number; from: number; to: number;
        lift: number; deep: number; keep: [number, number, number]; keepFrom: number; keepTo: number;
    };
    /** Lakes at their own levels, and rivers and waterfalls, laid out by hand (streams.ts). */
    streams?: Streams;
    /**
     * Named seas: basins carved where the real ones are (a unit direction from
     * the world's centre) and how far they reach (chord of the unit sphere).
     */
    seas?: { name: string; label: string; at: [number, number, number]; size: number }[];
}

export interface GasGiantDef {
    /** Equirectangular map of the real planet, relative to the site root. */
    map?: string;
    bands: [string, string, string, string];
    storm?: string;
    rings?: { inner: number; outer: number; color: string };
    /** Its north pole (IAU): right ascension and declination, degrees. */
    pole: [number, number];
    /** Map colour adjustments: saturation and brightness. */
    saturation?: number;
    brightness?: number;
    /** Where the map has real data, as texture v (0 south pole, 1 north): beyond it the shader paints the poles. */
    mapLatitudes?: [number, number];
    /** Jupiter: the polar cyclone clusters Juno found. Saturn: the north polar hexagon. */
    polarCyclones?: boolean;
    hexagon?: boolean;
    /** Saturn: the ten-sided wave round the south pole (about 60 S) that Hubble found. */
    decagon?: boolean;
    /** The haze above the cloud tops: its colour, and how far one sees through it in haze thicknesses. */
    haze?: { color: string; clarity: number };
    /**
     * Lightning seen from space on the night side: the latitudes (degrees) of
     * the storms it flashes in, and how many flashes a second there are in all.
     */
    lightning?: { latitudes: number[]; rate: number };
    /**
     * A great storm on the map that turns: its centre and semi-axes in map
     * coordinates (u east, v north, 0..1), how long its fastest ring takes to
     * go round (seconds, time-lapsed), and which way (1 anticlockwise seen from
     * above, -1 clockwise).
     */
    vortex?: { at: [number, number]; size: [number, number]; period: number; turn: 1 | -1 };
    /** An ice giant, drawn from what Hubble, Keck, the VLT and Voyager 2 saw (no map of it exists). */
    ice?: 'uranus' | 'neptune';
    /** Neptune: its dark spot's latitude, and its longitude from local noon, degrees. */
    darkSpot?: [number, number];
    /** Narrow rings: each one's inner and outer radius (planet radii), optical depth, and colour. */
    narrowRings?: NarrowRing[];
}

export interface NarrowRing {
    name: string;
    inner: number;
    outer: number;
    /** Normal optical depth: how much of the light straight through it the ring stops. */
    depth: number;
    color: string;
    /** Eccentric (Uranus's epsilon): how far it swings in and out, planet radii, and its width at the far point. */
    swing?: number;
    farWidth?: number;
    /** Arcs (Neptune's Adams ring): longitudes (degrees, from the ring frame's first axis) and lengths of the thick clumps, and their depth. */
    arcs?: { at: number; length: number; depth: number }[];
}

export interface ExpeditionBody {
    /** The portfolio id, e.g. 'projects'. */
    id: string;
    /** The planet's name, e.g. 'Earth'. */
    name: string;
    /** What the world is, in a few words: 'Planet', 'Gas giant', 'Moon of Saturn'. (The game names nothing after the portfolio.) */
    label: string;
    kind: 'rocky' | 'gas' | 'star';
    radius: number;
    /** Position in the system, in world units (doubles). */
    position: THREE.Vector3;
    biome?: BiomeDef;
    gas?: GasGiantDef;
    /** For a moon, the planet it circles. */
    parent?: string;
    /** Portfolio entries found on or around this world. */
    entries: CelestialBodyData[];
    /** Portfolio accent colour, used for markers. */
    color: string;
    /** Direction the sunlight comes FROM, here (unit vector). */
    sunDirection: THREE.Vector3;
    /** Surface gravity, metres per second squared: the real world's. */
    gravity?: number;
    /** What is true and strange about it, told on the first landing. */
    fact?: string;
    /** Air the explorer can breathe without the suit's supply (Earth, Haven). */
    breathable?: boolean;
    /**
     * Where its daylight comes from (universe frame), if not the Sun: Haven's is TON 618's disk.
     */
    lightFrom?: THREE.Vector3;
    /** Not in the Solar System (Haven, by TON 618): listed on the map, not drawn on its chart. */
    outsideSystem?: boolean;
    /**
     * No animals or fruit of the kinds the other worlds have: whatever lives
     * here is stranger (aliens.ts), and has to be looked for.
     */
    lifeless?: boolean;
    /**
     * How the real world looks from space: its photographed map, drawn over the
     * terrain from far away. `pole` is its north pole (right ascension and
     * declination); `anchor`, if given, is the latitude and longitude put at
     * the landing zone.
     */
    /**
     * Its photographed map, wrapped round its real pole. `faces`: a world kept
     * face on to another (longitude 0 points at it); `noon`: otherwise the
     * longitude (east) the Sun stands over, the world being frozen at one
     * moment of its day, chosen so a place that matters is in daylight.
     */
    globe?: { map: string; pole: [number, number]; anchor?: [number, number]; fade: [number, number]; water?: boolean; faces?: string; noon?: number };
}

/**
 * The scale of the system. Every world has its true size relative to Earth,
 * and the Sun its true 109 Earth radii; an Earth radius is 12 km here, so
 * that it can be walked. The distances between the planets are true to the
 * same scale: an astronomical unit is 23,481 Earth radii (282 million units),
 * so from Earth the Sun spans the half degree of sky it really does, the
 * same as the Moon. Neptune is 30 of them out. (Until 30 Oct 2026 they were
 * squeezed fourfold, and the Sun looked four times too wide.)
 *
 * Within a planet's own system the distances are true to the sizes: the
 * Moon is 60 Earth radii out, so it spans the half degree of Earth's sky it
 * really does, Earth the two degrees of the Moon's, Jupiter twelve of
 * Europa's.
 */
export const EARTH_RADIUS = 12000;
export const SUN_RADIUS = EARTH_RADIUS * 109.2;
export const AU = (EARTH_RADIUS / 6371) * 149597870.7;
/** How much further apart the planets are than in the squeezed system before (68 million units to the AU). */
export const SPREAD = AU / 68000000;
// World units per kilometre within a planet's system: the same as for sizes.
const SYSTEM_SCALE = EARTH_RADIUS / 6371;

const planet = (id: string) => {
    const body = SOLAR_SYSTEM_DATA.moons?.find((m) => m.id === id);
    if (!body) throw new Error(`Missing portfolio planet ${id}`);
    return body;
};

const at = (name: Parameters<typeof planetPosition>[0]) => planetPosition(name).multiplyScalar(AU);

/**
 * TON 618, where it lies in our sky (Canes Venatici), 40 billion units out, and the size of its
 * horizon: deepSpace.ts draws it; Haven, below, goes round it.
 */
export const TON618_POSITION = fromEquatorial(187.113, 31.477).multiplyScalar(4e10);
export const TON618_HORIZON = 4000;

const makeRocky = (id: string, radius: number, position: THREE.Vector3, biome: BiomeDef): ExpeditionBody => {
    const data = planet(id);
    return {
        id,
        name: data.name,
        label: 'Planet',
        kind: 'rocky',
        radius,
        position,
        biome,
        entries: data.moons ?? [],
        color: data.color,
        sunDirection: new THREE.Vector3(),
    };
};

const makeGas = (id: string, radius: number, position: THREE.Vector3, gas: GasGiantDef, entries?: CelestialBodyData[]): ExpeditionBody => {
    const data = planet(id);
    return {
        id,
        name: data.name,
        label: gas.ice ? 'Ice giant' : 'Gas giant',
        kind: 'gas',
        radius,
        position,
        gas,
        entries: entries ?? data.moons ?? [],
        color: data.color,
        sunDirection: new THREE.Vector3(),
    };
};

/** A moon `distanceKm` from its planet (scaled like the sizes), in `direction`. */
const moonOf = (host: ExpeditionBody, distanceKm: number, direction: THREE.Vector3) =>
    host.position.clone().addScaledVector(direction.clone().normalize(), distanceKm * SYSTEM_SCALE);

/** Turn the direction from `host` to the Sun by `degrees` about ecliptic north, then tip it up or down by `tip` degrees. */
const aroundHost = (host: THREE.Vector3, degrees: number, tip: number) => {
    const toSun = host.clone().negate().normalize();
    const v = toSun.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(degrees));
    const side = new THREE.Vector3().crossVectors(v, new THREE.Vector3(0, 1, 0)).normalize();
    return v.applyAxisAngle(side, THREE.MathUtils.degToRad(tip));
};

const R = (earths: number) => Math.round(EARTH_RADIUS * earths);

const SUN: ExpeditionBody = {
    id: 'sun',
    name: 'Sun',
    label: 'Our star',
    kind: 'star',
    radius: SUN_RADIUS,
    position: new THREE.Vector3(0, 0, 0),
    entries: [],
    color: SOLAR_SYSTEM_DATA.color,
    sunDirection: new THREE.Vector3(0, 1, 0),
};

const mercury = makeRocky('education', R(0.383), at('mercury'), {
    kind: 'cratered', seed: 1777,
    palette: ['#58585d', '#77777c', '#9a9aa0', '#3e3e43', '#6c7482'],
    zenith: '#020308', horizon: '#2c3140', haze: 0.18, airless: true, atmosphereHeight: 600, cloudCover: 0,
    crystal: '#4fc8ff',
});
// Venus as the Venera landers saw it: plains of dark basalt in plates and
// gravelly soil, volcanoes and lava domes, 465 C under 92 bar of carbon
// dioxide, beneath a deck of sulphuric acid cloud that never breaks. The sun
// is never seen from the ground; the light comes through the cloud, dim and
// yellow-orange. Nothing grows, and no liquid lies anywhere: the acid rain
// evaporates long before it reaches the ground.
const venus = makeRocky('experience', R(0.949), at('venus'), {
    kind: 'volcanic', seed: 2903,
    palette: ['#4e4136', '#5c4c3e', '#6b594a', '#3c3229', '#7f6852'],
    zenith: '#c9934f', horizon: '#ebc78e', haze: 2.0, atmosphereHeight: 1500, cloudCover: 0,
    // At its transits (2004, 2012) the haze above the clouds lit up as a thin arc, the aureole.
    backlit: { tint: [1.0, 0.95, 0.85], g: 0.72, gain: 1.4, deep: [1.0, 0.9, 0.7] },
    aerial: 1.3,
    deck: { base: 760, top: 1260, opacity: 0.012, color: '#efdcb0' },
    // Diffuse, but not shapeless: the Venera pictures show rocks with soft shadows.
    overcast: 0.7,
    sunColor: '#ffc98a',
    crystal: '#4fd0ff',
});
// Nothing could live in that heat; in the game, heat-proof aliens graze the plains.
const earth = makeRocky('projects', R(1), at('earth'), {
    kind: 'verdant', seed: 1201,
    palette: ['#2c6326', '#4f8430', '#86884a', '#66605a', '#7d6656'],
    // Fair-weather cloud, a third of the sky or so (0.55 read as overcast).
    zenith: '#3b78d0', horizon: '#c4dcf0', haze: 1.0, atmosphereHeight: 1400, cloudCover: 0.36,
    // From the Moon in a lunar eclipse: every sunrise and sunset at once, red-orange low down
    // (the blue scattered out on the long way through), a thin blue edge on top.
    backlit: { tint: [0.5, 1.0, 2.3], g: 0.6, gain: 2.4 },
    // Distant hills fade into the blue of the air, as they do in any landscape
    // photograph: the strongest single cue of distance.
    aerial: 1.8,
    crystal: '#56d8ff',
});
// The expedition sets down in North Texas, by Dallas, the portfolio owner's home.
// Its ground comes from NASA's maps (earth.ts), its colour from the Blue Marble.
earth.globe = { map: 'textures/expedition/earth-blue-marble.jpg', pole: [0, 90], anchor: [32.78, -96.8], fade: [9000, 26000], water: true };
const moon: ExpeditionBody = {
    id: 'moon',
    name: 'Moon',
    label: 'Moon of Earth',
    kind: 'rocky',
    radius: R(0.2727),
    position: moonOf(earth, 384400, moonDirection()),
    parent: 'projects',
    biome: {
        kind: 'cratered', seed: 6203,
        palette: ['#5c5b58', '#76746f', '#8e8c86', '#44433f', '#6b6964'],
        zenith: '#010204', horizon: '#15171c', haze: 0.05, airless: true, atmosphereHeight: 400, cloudCover: 0,
        crystal: '#7fd6ff',
    },
    entries: [],
    color: '#c9c6bd',
    sunDirection: new THREE.Vector3(),
};
const mars = makeRocky('skills', R(0.532), at('mars'), {
    kind: 'canyon', seed: 3413,
    // Mars as the rovers see it, not a poster's red: butterscotch dust over
    // brown soil, grey-brown rock.
    palette: ['#9e5f3e', '#ad6d49', '#bd8660', '#6b5548', '#977a65'],
    // No deck of cloud: Mars's water-ice clouds are rare, thin wisps (a deck
    // covering a third of it made the globe blotched white from orbit). Its
    // weather is dust.
    zenith: '#8e5b49', horizon: '#dea07c', haze: 1.4, sunset: '#9cc4ff', sunsetAroundSun: true, atmosphereHeight: 1300, cloudCover: 0,
    // The dust that turns its sunsets blue throws light forwards: a pale blue-white rim.
    backlit: { tint: [0.85, 1.0, 1.3], g: 0.75, gain: 0.7, deep: [1.0, 0.8, 0.65] },
    // Distance fades into the dust haze, but Olympus Mons still shows as a
    // mountain from a couple of kilometres off.
    aerial: 0.65,
    crystal: '#62e0ff',
});
// From orbit, Mars as the Viking orbiters photographed it (the MDIM 2.1 mosaic
// in NASA Ames's colour), taking over from the ground's own relief from
// about 1.5 km up (the canyon country made for walking would otherwise
// cover the whole globe in a maze of mesas).
mars.globe = { map: 'textures/expedition/mars-mdim.webp', pole: [317.681, 52.887], fade: [1500, 6000] };
// From orbit, the Moon as the Lunar Reconnaissance Orbiter's wide-angle camera
// mapped it, the maria dark on the side that always faces Earth (longitude 0,
// as the Moon's own maps have it); and Mercury as MESSENGER mapped it, all
// craters and bright rays. (Each fades in as the ground's own relief leaves.)
moon.globe = { map: 'textures/expedition/moons/moon.webp', pole: [269.9949, 66.5392], faces: 'projects', fade: [1500, 6000] };
mercury.globe = { map: 'textures/expedition/mercury.webp', pole: [281.0103, 61.4155], fade: [1500, 6000] };
// Mars is turned so that Jezero crater, where Perseverance left its sample
// tubes (history.ts), lies due north of where the ship sets down, in the
// morning sun. (On the game's date Mars is at its northern spring equinox:
// the Sun stands over the equator.)
mars.globe!.noon = 77.45 + 65.45;
// What the first landing on each says (Player.tsx shows it once).
mercury.fact = 'In the sunlight here the ground is over 300 °C; on the night side it falls to -170 °C, the widest swing of any planet. Your suit\'s cooling lasts about six minutes in this heat: go back to the ship to restore it. A year here is 88 days, and one day, sunrise to sunrise, is 176.';
venus.fact = '464 °C and 92 times the air pressure of Earth, day and night, pole to equator: hot enough to melt lead. Your suit\'s cooling lasts about three minutes out here; the ship restores it. Venera 13 came down to the south, under the gold marker, and lasted two hours.';
moon.fact = 'A sixth of Earth\'s gravity, no air, and the same face always turned to Earth, which hangs here in the sky without rising or setting. Twelve people walked on the Moon between 1969 and 1972. Where the first of them landed, Tranquility Base, is under the gold marker.';
mars.fact = 'Minus twenty degrees this morning, in air less than a hundredth as thick as Earth\'s, nearly all carbon dioxide. Today is the first day of northern spring on Mars: the Sun stands over the equator. North of here, under the gold marker, ten sample tubes Perseverance left are waiting for someone to bring them to Earth.';
const jupiter = makeGas('research', R(11.21), at('jupiter'), {
    // Cassini's global map (NASA/JPL/Space Science Institute, PIA07782); it stops short of the poles.
    map: 'textures/nasa/jupiter-cassini.webp',
    mapLatitudes: [0.1, 0.9],
    polarCyclones: true,
    bands: ['#d9a36c', '#b8784a', '#efd9b5', '#8f5a3a'],
    storm: '#b8553a',
    pole: [268.057, 64.495],
    // Juno's oblique views: a thin blue-grey haze over the limb.
    haze: { color: '#a3adbb', clarity: 20 },
    // Juno found lightning commonest at high latitudes, more in the north, and
    // almost none near the equator; Galileo and Cassini saw storms flashing in
    // the belts round 23 N and 48 N.
    lightning: { latitudes: [72, 66, 58, 48, 23, -38, -55, -63], rate: 1.6 },
    // The Great Red Spot on Cassini's map (20.7 S), with its collar: an
    // anticyclone, so it turns anticlockwise in the south. Its edge goes round
    // in about six days; here, a time-lapse.
    vortex: { at: [0.3619, 0.385], size: [0.026, 0.029], period: 150, turn: 1 },
});
const startOfSaturn = at('saturn');
const saturn = makeGas('beyond', R(9.45), at('saturn'), {
    map: 'textures/nasa/saturn.jpg',
    bands: ['#e9dcc0', '#d9c4a0', '#c7ab80', '#f3ead6'],
    rings: { inner: 1.22, outer: 2.36, color: '#e8dcc0' },
    pole: [40.589, 83.537],
    hexagon: true,
    decagon: true,
    // Saturn's map is warmer than the planet looks.
    saturation: 0.62, brightness: 1.08,
    // A thicker, yellower haze than Jupiter's: why Saturn looks so bland.
    haze: { color: '#d8cba9', clarity: 11 },
    // Cassini watched storms flash in "storm alley" round 35 S for years, and
    // through the great northern storm of 2010-11 round 35-40 N.
    lightning: { latitudes: [-34, -36, 38], rate: 0.6 },
});
// The ice giants have no ground, so their portfolio sections are on their
// largest moons, Titania and Triton, which can be landed on.
// The ice giants have no ground, so their portfolio sections are on their
// largest moons, Titania and Triton, which can be landed on.
// Ring radii from the PDS Ring-Moon Systems Node (km, over Uranus's 25,559 km
// and Neptune's 24,764 km); Uranus's rings are opaque but as dark as charcoal,
// Neptune's faint and dusty, thickest in the Adams ring's arcs.
const uranus = makeGas('freelance', R(4.01), at('uranus'), {
    bands: ['#a7d5d8', '#8dbcc0', '#cfeceb', '#7aaeb4'],
    pole: [257.311, -15.175],
    haze: { color: '#a9d6d6', clarity: 9 },
    ice: 'uranus',
    narrowRings: [
        { name: 'Zeta ring', inner: 1.481, outer: 1.618, depth: 0.002, color: '#8a8f94' },
        { name: 'Ring 6', inner: 1.63685, outer: 1.63691, depth: 0.3, color: '#5f6266' },
        { name: 'Ring 5', inner: 1.65235, outer: 1.65247, depth: 0.5, color: '#5f6266' },
        { name: 'Ring 4', inner: 1.66555, outer: 1.66564, depth: 0.3, color: '#5f6266' },
        { name: 'Alpha ring', inner: 1.74946, outer: 1.74974, depth: 0.4, color: '#626569' },
        { name: 'Beta ring', inner: 1.78634, outer: 1.78665, depth: 0.25, color: '#626569' },
        { name: 'Eta ring', inner: 1.84572, outer: 1.84581, depth: 0.25, color: '#5f6266' },
        { name: 'Gamma ring', inner: 1.86334, outer: 1.86349, depth: 1.2, color: '#606367' },
        { name: 'Delta ring', inner: 1.88965, outer: 1.88984, depth: 0.5, color: '#606367' },
        { name: 'Lambda ring', inner: 1.95717, outer: 1.95723, depth: 0.1, color: '#7d8186' },
        { name: 'Epsilon ring', inner: 2.00083, outer: 2.0016, depth: 1.5, color: '#686b6e', swing: 0.01589, farWidth: 0.00377 },
        { name: 'Nu ring', inner: 2.586, outer: 2.735, depth: 0.0005, color: '#9a7e6f' },
        { name: 'Mu ring', inner: 3.365, outer: 4.03, depth: 0.0002, color: '#7d9fd0' },
    ],
}, []);
const neptune = makeGas('certifications', R(3.88), at('neptune'), {
    bands: ['#8eb6dc', '#789fca', '#d7e7f4', '#3f5f8c'],
    pole: [299.36, 43.46],
    haze: { color: '#93b9dd', clarity: 12 },
    ice: 'neptune',
    // Its latitude, and its longitude from local noon (morning side, sunlit).
    darkSpot: [23, -28],
    narrowRings: [
        { name: 'Galle ring', inner: 1.6516, outer: 1.7323, depth: 0.0003, color: '#8c7a70' },
        { name: 'Le Verrier ring', inner: 2.146, outer: 2.15056, depth: 0.006, color: '#8f7d72' },
        { name: 'Lassell ring', inner: 2.1483, outer: 2.3098, depth: 0.0002, color: '#8c7a70' },
        { name: 'Arago ring', inner: 2.30779, outer: 2.31182, depth: 0.003, color: '#8f7d72' },
        {
            name: 'Adams ring', inner: 2.54056, outer: 2.54198, depth: 0.011, color: '#93806f',
            // Fraternite, Egalite 1 and 2, Liberte, Courage: trailing to leading, within 40 degrees.
            arcs: [
                { at: 0, length: 9.6, depth: 0.12 },
                { at: 8.8, length: 3.0, depth: 0.1 },
                { at: 11.5, length: 1.2, depth: 0.1 },
                { at: 21.6, length: 3.8, depth: 0.06 },
                { at: 29.5, length: 1.0, depth: 0.04 },
            ],
        },
    ],
}, []);
const moonOfIceGiant = (host: ExpeditionBody, id: string, name: string, radius: number, distanceKm: number, angle: number, biome: BiomeDef): ExpeditionBody => {
    const data = planet(host.id);
    return {
        id,
        name,
        label: `Moon of ${host.name}`,
        kind: 'rocky',
        radius,
        position: moonOf(host, distanceKm, aroundHost(host.position, angle, 8)),
        parent: host.id,
        biome,
        entries: data.moons ?? [],
        color: data.color,
        sunDirection: new THREE.Vector3(),
    };
};
// Larger than they really are (Titania is 789 km across the middle, Triton
// 1,353), so that there is room to explore.
// Titania has no air: a black sky over grey, faintly reddish ice and rock,
// cut by canyons where its crust cracked (Messina Chasmata runs 1,492 km).
const titania = moonOfIceGiant(uranus, 'titania', 'Titania', R(0.36), 435910, 62, {
    kind: 'frozen', seed: 4127,
    palette: ['#8e8a86', '#a19c96', '#bab5ad', '#5a5653', '#a7b6bd'],
    zenith: '#020308', horizon: '#0d1118', haze: 0.04, airless: true, atmosphereHeight: 300, cloudCover: 0,
    crystal: '#8ff3ff',
});
// Triton's nitrogen air is a millionth of Earth's: a near-black sky over
// pinkish nitrogen frost and grey-blue ice (Voyager 2, 1989).
const triton = moonOfIceGiant(neptune, 'triton', 'Triton', R(0.4), 354760, -58, {
    kind: 'glacier', seed: 5051,
    palette: ['#d6cdc6', '#c7b6ae', '#eee5df', '#69666f', '#dda59d'],
    zenith: '#03050c', horizon: '#161b27', haze: 0.12, sunset: '#a9c6f2', sunsetAroundSun: true, atmosphereHeight: 400, cloudCover: 0,
    backlit: { tint: [0.7, 1.0, 1.7], g: 0.6, gain: 1.0 },
    crystal: '#9fe8ff',
});

// Jupiter's Europa and Saturn's Titan, where life beyond Earth is thought
// likeliest in the Solar System: an ocean under Europa's ice, and Titan's
// thick orange haze over dunes and lakes of methane. Neither has a portfolio
// section; the radio leads to them (radio.ts). True to size, at their real
// distances: Jupiter spans 12 degrees of Europa's sky, Saturn under 6 of Titan's.
const europa: ExpeditionBody = {
    id: 'europa',
    name: 'Europa',
    label: 'Moon of Jupiter',
    kind: 'rocky',
    radius: R(0.245),
    position: moonOf(jupiter, 671034, aroundHost(jupiter.position, 60, 5)),
    parent: 'research',
    biome: {
        kind: 'frozen', seed: 7351,
        // One of the smoothest surfaces in the Solar System: its ridges stand a few hundred metres at most.
        relief: 0.4,
        // Water ice, scored by long reddish-brown cracks (lineae): salts from the ocean below.
        palette: ['#e7e1d6', '#d6c9b6', '#f3efe7', '#8a5a3c', '#a8643f'],
        zenith: '#020308', horizon: '#121722', haze: 0.04, airless: true, atmosphereHeight: 300, cloudCover: 0,
        crystal: '#8fe9ff',
    },
    entries: [],
    color: '#d9c8ae',
    sunDirection: new THREE.Vector3(),
    lifeless: true,
};
/** Titan's lake level (game units): the low quarter or so of its ground is under liquid. */
const LAKE_LEVEL = -14;
const titan: ExpeditionBody = {
    id: 'titan',
    name: 'Titan',
    label: 'Moon of Saturn',
    kind: 'rocky',
    radius: R(0.404),
    position: moonOf(saturn, 1221870, aroundHost(saturn.position, -40, 4)),
    parent: 'beyond',
    biome: {
        kind: 'methane', seed: 8429,
        // Dark dunes of organic sand and plains of ice pebbles under an orange
        // sky, as the Huygens probe saw it in 2005; lakes and seas of liquid
        // methane and ethane in the low ground, as Cassini mapped them.
        palette: ['#4b3a28', '#5e4831', '#755a3b', '#3a2c1e', '#8c6b45'],
        // Clouds are rare on Titan (methane clouds cover about 1% of it at a
        // time, mostly far from the equator): half the sky under a deck read
        // as a map of land and sea hung upside down overhead, and even 8% drew
        // dark blots on the orange sky. Under the haze they are lost in it, from
        // the ground and from space alike: none drawn.
        zenith: '#b4722c', horizon: '#e2a65c', haze: 3.2, atmosphereHeight: 2600, limb: 0.2, cloudCover: 0,
        // Cassini against the Sun: orange haze, and over it the blue of the detached layer.
        backlit: { tint: [0.45, 1.0, 2.6], g: 0.65, gain: 1.5, deep: [1.0, 0.6, 0.28] },
        clearSight: 0.25,
        // The haze is overhead, high in the air: on its way down Huygens saw
        // the ground clearly from kilometres up, channels and shorelines and
        // all. Across the ground it is far thinner than the sky's thickness
        // alone would make it (at 0.6 a sea 1 km off was lost in it).
        aerial: 0.3,
        // The haze proper: an orange smog of organic particles hundreds of
        // kilometres deep, opaque from space (Voyager and Cassini saw a
        // featureless orange ball; only infrared and radar reach the ground).
        // Huygens came out under it at about 50 km. From the ground it is the
        // whole sky, and the light comes diffused through it.
        deck: { base: 320, top: 2000, opacity: 0.004, color: '#d39548' },
        overcast: 0.6,
        crystal: '#7fe3ff',
        liquid: { level: LAKE_LEVEL, name: 'methane', deep: '#0b0805', shallow: '#3a2a19', waves: 0.12, floats: false },
    },
    entries: [],
    color: '#d9a35a',
    sunDirection: new THREE.Vector3(),
    lifeless: true,
};

// ---- Every major moon, and Pluto with Charon ---------------------------------
// True to size where they are big enough to walk (1,400 units and up); smaller
// ones enlarged less and less (1400 (r/1400)^0.35) so there is ground to explore,
// Uranus's first stretched 2.91 times like Titania; the small ones' hills and
// craters cut down to about a tenth of their radius (lab/relief.mts). Each at
// its real distance in planet radii, so its planet spans as much of its sky
// as it really does (Jupiter 19 degrees from Io, 4 from Callisto).
// Each orbits in its planet's equator and keeps one face to it: the zero of
// its map's longitude faces the planet. Maps: NASA/USGS (public domain).
const KM = EARTH_RADIUS / 6371;
const SIZE_FLOOR = 1400;
const gameRadius = (km: number, stretch = 1) => {
    const r = km * KM * stretch;
    return Math.round(r >= SIZE_FLOOR ? r : SIZE_FLOOR * Math.pow(r / SIZE_FLOOR, 0.35));
};
const AIRLESS = { zenith: '#010204', horizon: '#14161c', haze: 0.04, airless: true, atmosphereHeight: 300, cloudCover: 0 };
const POLES: Record<string, [number, number]> = {
    skills: [317.681, 52.887],
    research: [268.057, 64.495],
    beyond: [40.589, 83.537],
    freelance: [257.311, -15.175],
    pluto: [132.993, -6.163],
};

interface MoonSpec {
    id: string;
    name: string;
    host: ExpeditionBody;
    /** Real radius and orbit (km), and the host's radius (km). */
    radiusKm: number;
    orbitKm: number;
    hostKm: number;
    /** The size stretch before the floor. */
    stretch?: number;
    /** Degrees round its planet's equator from the Sun's side. */
    angle: number;
    gravity: number;
    fact: string;
    biome: Pick<BiomeDef, 'kind' | 'seed' | 'palette' | 'crystal'> & Partial<BiomeDef>;
    /** Its map in textures/expedition/moons (none: drawn from its terrain alone). */
    map?: string;
    color: string;
}

const makeMoon = (spec: MoonSpec): ExpeditionBody => {
    const radius = gameRadius(spec.radiusKm, spec.stretch);
    const ratio = spec.orbitKm / spec.hostKm;
    const distance = ratio * spec.host.radius;
    const pole = POLES[spec.host.id];
    const axis = fromEquatorial(pole[0], pole[1]);
    const toSun = spec.host.position.clone().negate();
    toSun.addScaledVector(axis, -toSun.dot(axis)).normalize();
    const direction = toSun.applyAxisAngle(axis, THREE.MathUtils.degToRad(spec.angle));
    return {
        id: spec.id,
        name: spec.name,
        label: `Moon of ${spec.host.name}`,
        kind: 'rocky',
        radius,
        position: spec.host.position.clone().addScaledVector(direction, distance),
        parent: spec.host.id,
        biome: { ...AIRLESS, ownProps: true, ...spec.biome },
        entries: [],
        color: spec.color,
        sunDirection: new THREE.Vector3(),
        lifeless: true,
        gravity: spec.gravity,
        fact: spec.fact,
        globe: spec.map ? { map: `textures/expedition/moons/${spec.map}.webp`, pole, faces: spec.host.id, fade: [radius * 1.3, radius * 3.2] } : undefined,
    };
};

// Pluto, a dwarf planet with ground: nitrogen-ice plains (Sputnik Planitia)
// and mountains of water ice, under a thin blue haze (New Horizons, 2015).
const pluto: ExpeditionBody = {
    id: 'pluto',
    name: 'Pluto',
    label: 'Dwarf planet',
    kind: 'rocky',
    radius: gameRadius(1188.3),
    position: at('pluto'),
    biome: {
        kind: 'glacier', seed: 9503, relief: 0.22,
        palette: ['#e6d3bd', '#d9b99a', '#f2e6d8', '#6e3a20', '#b47a52'],
        zenith: '#02040a', horizon: '#1d2a44', haze: 0.12, sunset: '#8fb8ff', sunsetAroundSun: true, atmosphereHeight: 500, cloudCover: 0,
        // New Horizons, looking back at the night side: a ring of blue haze, twenty layers deep.
        backlit: { tint: [0.65, 1.0, 1.8], g: 0.6, gain: 1.0 },
        crystal: '#9fe8ff', ownProps: true,
    },
    entries: [],
    color: '#d8b896',
    sunDirection: new THREE.Vector3(),
    lifeless: true,
    gravity: 0.62,
    fact: 'You are standing on the heart: Sputnik Planitia, a glacier of nitrogen ice 1,000 km across, slowly overturning in cells 20 to 40 km wide. The mountains round it are blocks of water ice floating in the nitrogen.',
    // Locked face to face with Charon, like a moon to its planet: longitude 0
    // faces it, and Sputnik Planitia, the heart, faces away.
    globe: { map: 'textures/expedition/moons/pluto.webp', pole: POLES.pluto, faces: 'charon', fade: [gameRadius(1188.3) * 1.3, gameRadius(1188.3) * 3.2] },
};

const MOONS: MoonSpec[] = [
    // Mars: two small dark captured asteroids, Phobos with its 9 km crater Stickney.
    { id: 'phobos', name: 'Phobos', host: mars, radiusKm: 11.1, orbitKm: 9376, hostKm: 3389.5, angle: 40, gravity: 0.0057, fact: "Mars's larger moon, 22 km across and falling: it spirals 1.8 m closer every century and in some 50 million years will break up into a ring. Gravity here is under a thousandth of Earth's.", map: 'phobos', color: '#6b5f55',
        biome: { kind: 'cratered', seed: 9101, relief: 0.16, palette: ['#3d3833', '#4a443d', '#5e564d', '#2c2824', '#6b5b4c'], crystal: '#6fdcff' } },
    { id: 'deimos', name: 'Deimos', host: mars, radiusKm: 6.3, orbitKm: 23463, hostKm: 3389.5, angle: -70, gravity: 0.003, fact: "Mars's smaller moon, 12 km across, its craters filled in by a blanket of dust. Its escape speed is 5.6 m/s: a good throw would send a stone off into space.", map: 'deimos', color: '#7a7066',
        biome: { kind: 'cratered', seed: 9131, relief: 0.14, palette: ['#55504a', '#625c55', '#7a7269', '#3f3b37', '#857565'], crystal: '#6fdcff' } },
    // Jupiter: Io, the most volcanic world known; Ganymede, larger than Mercury; Callisto, the most cratered.
    { id: 'io', name: 'Io', host: jupiter, radiusKm: 1821.6, orbitKm: 421700, hostKm: 69911, angle: 75, gravity: 1.796, fact: "The most volcanic world known: some 400 active volcanoes, heated by Jupiter's tides flexing it, with plumes up to 500 km high. The colours are sulphur.", map: 'io', color: '#d6c25a',
        biome: { kind: 'volcanic', seed: 9203, palette: ['#c9b24a', '#d8c66a', '#e8dd9a', '#4a3b25', '#b4532a'], crystal: '#5fd6ff' } },
    { id: 'ganymede', name: 'Ganymede', host: jupiter, radiusKm: 2634.1, orbitKm: 1070412, hostKm: 69911, angle: -45, gravity: 1.428, fact: "The largest moon in the Solar System, bigger than Mercury, and the only moon with a magnetic field of its own. A salty ocean lies deep under its ice.", map: 'ganymede', color: '#a39a8f',
        biome: { kind: 'frozen', seed: 9227, relief: 0.6, palette: ['#7a7166', '#8f857a', '#bdb5aa', '#4e473f', '#a39a8f'], crystal: '#8fe9ff' } },
    { id: 'callisto', name: 'Callisto', host: jupiter, radiusKm: 2410.3, orbitKm: 1882709, hostKm: 69911, angle: 140, gravity: 1.235, fact: "The most heavily cratered surface known, almost unchanged for four billion years. It orbits outside Jupiter's worst radiation, so NASA has studied it as a base for human explorers.", map: 'callisto', color: '#6b6158',
        biome: { kind: 'cratered', seed: 9241, palette: ['#4e463e', '#5c5349', '#8a8076', '#2f2a25', '#a99f94'], crystal: '#8fe9ff' } },
    // Saturn: Mimas with its giant crater Herschel; Enceladus, the whitest thing in the system, venting its ocean
    // through the tiger stripes at its south pole; Tethys and Odysseus; Dione's wispy cliffs; Rhea; two-faced Iapetus.
    { id: 'mimas', name: 'Mimas', host: saturn, radiusKm: 198.2, orbitKm: 185539, hostKm: 58232, angle: 30, gravity: 0.064, fact: "Its crater Herschel is 139 km wide, a third of the whole moon: the impact nearly shattered it. Its orbit hints at a young ocean forming beneath the ice.", map: 'mimas', color: '#bdb8b1',
        biome: { kind: 'cratered', seed: 9311, relief: 0.35, palette: ['#9a958f', '#aaa59f', '#cfcac3', '#6f6b67', '#b8b2aa'], crystal: '#9fe8ff' } },
    { id: 'enceladus', name: 'Enceladus', host: saturn, radiusKm: 252.1, orbitKm: 237948, hostKm: 58232, angle: -20, gravity: 0.113, fact: "The most reflective world in the Solar System. From cracks at its south pole, the tiger stripes, geysers throw the water of its buried ocean into space, feeding Saturn's E ring.", map: 'enceladus', color: '#eef3f6',
        biome: { kind: 'frozen', seed: 9323, relief: 0.09, palette: ['#e8edf0', '#f4f7f9', '#ffffff', '#a9b3ba', '#d7e3ea'], crystal: '#9fe8ff' } },
    { id: 'tethys', name: 'Tethys', host: saturn, radiusKm: 531.1, orbitKm: 294619, hostKm: 58232, angle: 70, gravity: 0.146, fact: "Almost pure water ice, less dense than water: it would float. The crater Odysseus spans two fifths of it, and the canyon Ithaca Chasma runs three quarters of the way round.", map: 'tethys', color: '#d4d0ca',
        biome: { kind: 'cratered', seed: 9337, relief: 0.5, palette: ['#b8b4ae', '#c6c2bc', '#e4e0da', '#86827d', '#d0ccc6'], crystal: '#9fe8ff' } },
    { id: 'dione', name: 'Dione', host: saturn, radiusKm: 561.4, orbitKm: 377396, hostKm: 58232, angle: -80, gravity: 0.232, fact: "Its bright wisps are not frost but ice cliffs hundreds of metres high, where the crust has cracked apart. Cassini found a trace of oxygen around it.", map: 'dione', color: '#c8c3bc',
        biome: { kind: 'frozen', seed: 9341, relief: 0.12, palette: ['#aaa59e', '#bab5ae', '#dcd8d1', '#7a7671', '#c8c3bc'], crystal: '#9fe8ff' } },
    { id: 'rhea', name: 'Rhea', host: saturn, radiusKm: 763.8, orbitKm: 527108, hostKm: 58232, angle: 110, gravity: 0.264, fact: "Saturn's second-largest moon. Cassini flew through the thinnest of atmospheres here, oxygen and carbon dioxide, made as Saturn's radiation splits the ice.", map: 'rhea', color: '#c0bbb3',
        biome: { kind: 'cratered', seed: 9349, relief: 0.5, palette: ['#a49f97', '#b2ada5', '#d6d1c9', '#76726c', '#c0bbb3'], crystal: '#9fe8ff' } },
    { id: 'iapetus', name: 'Iapetus', host: saturn, radiusKm: 734.5, orbitKm: 3560820, hostKm: 58232, angle: -130, gravity: 0.223, fact: "Two-faced: one hemisphere as dark as coal, the other as bright as snow, and a ridge up to 20 km high runs along its equator like the seam of a walnut.", map: 'iapetus', color: '#8a7460',
        biome: { kind: 'cratered', seed: 9371, relief: 0.55, palette: ['#4a2f1c', '#b6aa98', '#f0ece4', '#2a1a10', '#8a6a4a'], crystal: '#9fe8ff' } },
    // Uranus (no global maps: Voyager 2 saw only their southern halves): Miranda's patchwork of terrains and the
    // tallest cliff known, Verona Rupes; Ariel's rift valleys; dark Umbriel; reddish Oberon.
    { id: 'miranda', name: 'Miranda', host: uranus, radiusKm: 235.8, orbitKm: 129390, hostKm: 25362, stretch: 2.91, angle: 50, gravity: 0.079, fact: "A patchwork of terrains, as if broken apart and put back together, with Verona Rupes, the tallest known cliff in the Solar System, perhaps 10 km high. A fall from its top would last about eight minutes.", color: '#a9a5a0',
        biome: { kind: 'canyon', seed: 9409, relief: 0.18, palette: ['#8a8784', '#9c9995', '#bdb9b4', '#5e5b58', '#a9a5a0'], crystal: '#8ff3ff' } },
    { id: 'ariel', name: 'Ariel', host: uranus, radiusKm: 578.9, orbitKm: 191020, hostKm: 25362, stretch: 2.91, angle: -60, gravity: 0.269, fact: "The brightest of Uranus's moons, cut by rift valleys hundreds of kilometres long. Uranus lies on its side, so here a polar day lasts 42 years, and so does the night.", color: '#b8b4af',
        biome: { kind: 'frozen', seed: 9421, relief: 0.3, palette: ['#9b9792', '#aaa6a1', '#cfcbc6', '#6c6965', '#b8b4af'], crystal: '#8ff3ff' } },
    { id: 'umbriel', name: 'Umbriel', host: uranus, radiusKm: 584.7, orbitKm: 266000, hostKm: 25362, stretch: 2.91, angle: 130, gravity: 0.2, fact: "The darkest of Uranus's large moons, old and cratered, with one bright ring of frost, Wunda, on a crater floor.", color: '#6b6865',
        biome: { kind: 'cratered', seed: 9433, palette: ['#4f4c4a', '#5b5856', '#76726f', '#3a3836', '#6b6865'], crystal: '#8ff3ff' } },
    { id: 'oberon', name: 'Oberon', host: uranus, radiusKm: 761.4, orbitKm: 583520, hostKm: 25362, stretch: 2.91, angle: -130, gravity: 0.346, fact: "The outermost of Uranus's large moons, old and cratered, its crater floors darkened by something that welled up from inside.", color: '#93867c',
        biome: { kind: 'cratered', seed: 9439, palette: ['#7a6f68', '#8a7f77', '#a59a91', '#544b45', '#93867c'], crystal: '#8ff3ff' } },
    // Charon, half Pluto's size, with its reddish polar cap (Mordor Macula), at its real distance; placed
    // round Pluto so that Pluto's landing zone falls in Sputnik Planitia, the heart (10 N, 175 E: lab/zonemap.mts).
    { id: 'charon', name: 'Charon', host: pluto, radiusKm: 606, orbitKm: 19591, hostKm: 1188.3, angle: -139, gravity: 0.288, fact: "Half Pluto's size, so the two circle a point in the space between them, each keeping one face to the other. Its red north pole, Mordor Macula, is stained by gas escaping from Pluto.", map: 'charon', color: '#9a918a',
        biome: { kind: 'cratered', seed: 9511, relief: 0.45, palette: ['#8c837b', '#9a918a', '#bdb5ad', '#5a4f48', '#7a4a34'], crystal: '#9fe8ff' } },
];
const moon_ = Object.fromEntries(MOONS.map((spec) => [spec.id, makeMoon(spec)])) as Record<string, ExpeditionBody>;

// Titan's seas, where Cassini mapped them: three seas round the north pole
// and one lake in the south, at their real latitudes and their real
// longitudes from one another (west, as the IAU gives them). North is +y
// (the parallels its dunes run along). The globe is turned so that Kraken
// Mare lies under the noon sun: from where the game's Titan stands, the
// north would otherwise sit in its long polar dusk, and the seas unseen.
{
    const north = new THREE.Vector3(0, 1, 0);
    const toSun = titan.position.clone().negate();
    toSun.addScaledVector(north, -toSun.dot(north)).normalize();
    const KRAKEN_WEST = 310;
    const zero = toSun.applyAxisAngle(north, THREE.MathUtils.degToRad(KRAKEN_WEST));
    const east = new THREE.Vector3().crossVectors(north, zero);
    const at = (latitude: number, westLongitude: number): [number, number, number] => {
        const phi = THREE.MathUtils.degToRad(latitude);
        const lambda = THREE.MathUtils.degToRad(-westLongitude);
        const v = zero.clone().multiplyScalar(Math.cos(phi) * Math.cos(lambda))
            .addScaledVector(east, Math.cos(phi) * Math.sin(lambda))
            .addScaledVector(north, Math.sin(phi));
        return [v.x, v.y, v.z];
    };
    titan.biome!.seas = [
        { name: 'Kraken Mare', label: 'Sea of liquid methane', at: at(68, KRAKEN_WEST), size: 0.2 },
        { name: 'Ligeia Mare', label: 'Sea of liquid methane', at: at(79, 248), size: 0.1 },
        { name: 'Punga Mare', label: 'Sea of liquid methane', at: at(85, 340), size: 0.075 },
        { name: 'Ontario Lacus', label: 'Lake of liquid methane', at: at(-72, 183), size: 0.05 },
    ];
}

// The real surface gravity of each world with ground (m/s²): a jump on the
// Moon or Titania goes many times higher and falls many times slower than on
// Earth, and a fall hurts in proportion to the speed it ends at.
mercury.gravity = 3.70;
venus.gravity = 8.87;
earth.gravity = 9.81;
earth.breathable = true;
moon.gravity = 1.62;
mars.gravity = 3.71;
titania.gravity = 0.379;
triton.gravity = 0.779;
europa.gravity = 1.315;
titan.gravity = 1.352;
// The giants at their 1 bar level, where the cloud tops are.
jupiter.gravity = 24.79;
saturn.gravity = 10.44;
uranus.gravity = 8.69;
neptune.gravity = 11.15;

/** The Sun, then the planets outwards, each followed by its moon. */
/**
 * Haven (docs/story.md): the one world by TON 618 that can hold life, where the ark Halcyon
 * brought the last people off Earth. It goes round the black hole thirteen horizon radii out,
 * a little above its disk, turned always the same face to it (as the Moon is to Earth), so the
 * hole hangs fixed in its sky and its light is the disk's. TON 618 spins so fast (the story says)
 * that close in time runs slow: a day here is ten years at home.
 */
const havenPlace = (() => {
    const towardHome = startOfSaturn.clone().sub(TON618_POSITION).normalize();
    const across = new THREE.Vector3(0, 1, 0).cross(towardHome).normalize();
    const normal = new THREE.Vector3().crossVectors(towardHome, across).normalize();
    const out = towardHome.clone().applyAxisAngle(normal, 0.62);
    return TON618_POSITION.clone().addScaledVector(out, TON618_HORIZON * 13).addScaledVector(normal, TON618_HORIZON * 2.2);
})();
const haven: ExpeditionBody = {
    id: 'haven',
    name: 'Haven',
    label: 'Planet of TON 618',
    kind: 'rocky',
    radius: R(0.3),
    position: havenPlace,
    biome: {
        kind: 'verdant', seed: 7717,
        // Teal grass and blue-green moss under a dusky sky: the disk's light is warm but the sky
        // stays dark enough for the hole to show by day.
        palette: ['#1f5a4c', '#2f7a5e', '#6f8f6a', '#4a5650', '#7fa592'],
        // (Bright enough by day that the other galaxy's stars are lost in it, as in the key art; clear
        // enough that TON 618 stands out of it, its shadow black.)
        // No cloud deck: its flat sheets read as paper cut-outs against TON 618 (3D clouds to come).
        zenith: '#17292c', horizon: '#4a726b', haze: 0.62, atmosphereHeight: 700, cloudCover: 0,
        clearSight: 0.45, sunGlow: 0.08,
        sunColor: '#ffd8b0', aerial: 1.2, crystal: '#9fffe0',
        // Gentle grassland, where a colony could be built (the key art's).
        relief: 0.3,
        // A sea in a few great basins, a bay of it at the foot of the colony's hill, so that facing
        // TON 618 from the colony you look out over open water. The hill itself is left as it was.
        basins: {
            freq: 1.6, freq2: 5, mix2: 0.25, from: -0.05, to: 0.25, lift: 17, deep: 30,
            keep: [-0.761571, 0.427026, -0.487501], keepFrom: 200, keepTo: 450,
        },
        // A tarn on the bench south of the colony; its stream runs east to the lip of the bluff over
        // the inlet and falls 48 m into a gorge it has cut down to the sea.
        streams: {
            // Level ground for the temples: the Greek temple on the bay's headland, facing TON 618
            // over the sea; the Japanese garden round the tarn (hall, pagoda, gate); the Indian
            // temple and its stepped tank on the terrace north-east of the colony.
            pads: [
                { name: 'Headland temple', at: [-0.7856767, 0.4524747, -0.4218753], radius: 24, level: 15.8, blend: 18, garden: 48 },
                { name: 'Garden hall', at: [-0.6901831, 0.4509642, -0.5659315], radius: 9, level: 45.5, blend: 8 },
                { name: 'Garden pagoda', at: [-0.7058921, 0.4464998, -0.5498676], radius: 10, level: 45.3, blend: 8 },
                { name: 'Garden gate', at: [-0.7009163, 0.4552909, -0.5490233], radius: 9, level: 47.5, blend: 8 },
                { name: 'Terrace temple', at: [-0.8081256, 0.3019601, -0.5057204], radius: 30, level: 22.5, blend: 20 },
            ],
            lakes: [{ name: 'Tarn', at: [-0.6972961, 0.4494692, -0.5583508], radius: 30, level: 44, depth: 4, garden: 72 }],
            rivers: [{
                name: 'The falls',
                points: [
                    [-0.696359, 0.4440423, -0.5638356], [-0.6968734, 0.4414527, -0.5652318],
                    [-0.6961981, 0.4397488, -0.567388], [-0.6954061, 0.4387911, -0.5690982],
                    [-0.6948889, 0.4367328, -0.5713088], [-0.6939697, 0.4349667, -0.5737683],
                    [-0.6943959, 0.4319596, -0.5755217], [-0.6948129, 0.4289474, -0.5772687],
                    [-0.6947304, 0.4256201, -0.5798252],
                ],
                levels: [44, 43.7, 43.3, 42.9, -5, -5, -5, -5, -5],
                width: 7, depth: 1.6, bank: 1.3, valley: 26,
            }],
        },
        // Clear fresh water, jade in the shallows and dark teal where it is deep.
        liquid: { level: -5, name: 'water', deep: '#0b2629', shallow: '#2f6d63', waves: 0.8, floats: true, clear: true, surf: 0.7 },
    },
    entries: [],
    color: '#6fd0b4',
    sunDirection: new THREE.Vector3(),
    gravity: 8.9,
    breathable: true,
    lightFrom: TON618_POSITION.clone(),
    outsideSystem: true,
    fact: 'Haven: the only world by TON 618 that can hold life, and home to the colony the ark Halcyon brought from Earth. It is held so deep in the black hole\'s spinning gravity that time here runs slow: one day on Haven is ten years at home. The light is the accretion disk\'s.',
};

export const EXPEDITION_BODIES: ExpeditionBody[] = [
    SUN, mercury, venus, earth, moon,
    mars, moon_.phobos, moon_.deimos,
    jupiter, moon_.io, europa, moon_.ganymede, moon_.callisto,
    saturn, moon_.mimas, moon_.enceladus, moon_.tethys, moon_.dione, moon_.rhea, titan, moon_.iapetus,
    uranus, moon_.miranda, moon_.ariel, moon_.umbriel, titania, moon_.oberon,
    neptune, triton,
    pluto, moon_.charon,
    haven,
];
EXPEDITION_BODIES.forEach((body) => {
    if (body.kind !== 'star') body.sunDirection.copy(body.lightFrom ?? SUN.position).sub(body.position).normalize();
});

// Where each world starts, and where its Sun is then (in its own frame). The
// worlds move on and turn from there (motion.ts); whatever is laid out on a
// world (its landing zone, its sites, its vaults) is laid out from these, so
// it comes out the same whenever it is first worked out.
const startPositions = new Map(EXPEDITION_BODIES.map((body) => [body.id, body.position.clone()]));
const startSuns = new Map(EXPEDITION_BODIES.map((body) => [body.id, body.sunDirection.clone()]));
/** Where a world was when the expedition began (and is, whenever the game's frame follows it). */
export const startPosition = (body: ExpeditionBody) => startPositions.get(body.id) ?? body.position;
/** The Sun's direction from a world, in its own frame, when the expedition began. */
export const startSun = (body: ExpeditionBody) => startSuns.get(body.id) ?? body.sunDirection;

export const findBody = (id: string) => EXPEDITION_BODIES.find((body) => body.id === id);

/** The system's star. */
export const THE_SUN = SUN;

/** Direction the sunlight comes FROM at a point in the system. */
export const sunDirectionAt = (point: THREE.Vector3, out = new THREE.Vector3()) => {
    out.copy(SUN.position).sub(point);
    const length = out.length();
    return length > 1e-6 ? out.divideScalar(length) : out.set(0, 1, 0);
};

/** A distance for the HUD: units near a world, thousands of them further, AU across the system. */
export const formatDistance = (units: number) => {
    if (units >= AU * 0.05) return `${(units / AU).toFixed(units >= AU * 10 ? 1 : 2)} AU`;
    if (units >= 1000000) return `${(units / 1000000).toFixed(1)} Mu`;
    if (units >= 100000) return `${(units / 1000).toFixed(0)} ku`;
    if (units >= 1000) return `${(units / 1000).toFixed(1)} ku`;
    return `${Math.round(units)} u`;
};

/** The planet a moon circles (or the body itself). */
export const hostOf = (body: ExpeditionBody) => (body.parent ? findBody(body.parent) ?? body : body);

/**
 * Terrain height in world units for a unit direction on a rocky planet.
 * `detail` trims the finest octaves (the renderer does the same per chunk);
 * pass 1 for the full detail used when walking and landing.
 */
/** Craters wider than this (radius, units) have slumped into flat floors, terraced walls and central peaks. */
const CRATER_COMPLEX = 40;

/**
 * GLSL for one size of crater, `scale` lattice cells to the unit sphere: where
 * none of them is big enough ever to slump (radius at most 0.3 of a cell, and
 * slumping begins at 0.8 x CRATER_COMPLEX) plain bowls (noise.ts craterBowls),
 * the same height for less work.
 */
const craterGLSL = (body: ExpeditionBody, scale: number, seed: string, density: number) => {
    const cell = body.radius / scale;
    return cell * 0.3 <= CRATER_COMPLEX * 0.8
        ? `craterBowls(d * ${scale.toFixed(1)}, ${seed}, ${density.toFixed(3)}, ${cell.toFixed(3)})`
        : `craterField(d * ${scale.toFixed(1)}, ${seed}, ${density.toFixed(3)}, ${cell.toFixed(3)}, ${CRATER_COMPLEX.toFixed(1)})`;
};

/** Titan's ground away from the seas: lower round the poles, raised (and dry) elsewhere. */
const POLAR_LOW = 0;
const DRY_LIFT = 28;
/** The floor of Titan's named seas: Ligeia Mare is over 160 m deep (here, stretched less, about 45 m). */
const SEA_FLOOR = -60;

/**
 * How deep a world's named seas carve the ground at a direction: 1 over a
 * sea's floor, easing to 0 at its outer shore. The shore is ragged at every
 * scale, bays and headlands and islands, the way the drowned valleys of
 * Ligeia Mare are.
 */
const seaBasins = (x: number, y: number, z: number, s: number, seas: NonNullable<BiomeDef['seas']>) => {
    if (!seas.length) return 0;
    const ragged = fbm(x * 22, y * 22, z * 22, s + 51, 3) * 0.3 + fbm(x * 70, y * 70, z * 70, s + 53, 2) * 0.1;
    let carve = 0;
    for (const sea of seas) {
        const dx = x - sea.at[0];
        const dy = y - sea.at[1];
        const dz = z - sea.at[2];
        carve = Math.max(carve, 1 - smoothstep(0.55, 1, Math.sqrt(dx * dx + dy * dy + dz * dz) / sea.size + ragged));
    }
    return carve;
};

const seaBasinsGLSL = (seas: NonNullable<BiomeDef['seas']>) => {
    if (!seas.length) return 'float seaBasins(vec3 d, uint seed) { return 0.0; }\n';
    const carves = seas.map((sea) =>
        `    carve = max(carve, 1.0 - smoothstep(0.55, 1.0, length(d - vec3(${sea.at.map((v) => v.toFixed(6)).join(', ')})) / ${sea.size.toFixed(4)} + ragged));`);
    return /* glsl */ `
float seaBasins(vec3 d, uint seed) {
    float ragged = fbm(d * 22.0, seed + 51u, 3, 2.0, 0.5) * 0.3 + fbm(d * 70.0, seed + 53u, 2, 2.0, 0.5) * 0.1;
    float carve = 0.0;
${carves.join('\n')}
    return carve;
}
`;
};

export const createHeightFunction = (body: ExpeditionBody) => {
    const biome = body.biome;
    if (!biome) return () => 0;
    if (usesEarthMap(body)) return earthHeightFunction(body);
    if (usesMarsMap(body)) return marsHeightFunction(body);
    const ground = createGroundFunction(body);
    // Where the ground lies under a lake, the height is the lake's surface.
    const level = biome.liquid?.level;
    if (level === undefined) return ground;
    const water = createWaterLevelFunction(body);
    return (x: number, y: number, z: number) => Math.max(ground(x, y, z), water(x, y, z));
};

/** The level water stands at over a direction: the world's sea level, or a lake's or river's (streams). */
export const createWaterLevelFunction = (body: ExpeditionBody) => {
    const level = body.biome?.liquid?.level ?? -1e9;
    const streams = body.biome?.streams;
    if (!streams) return () => level;
    const seed = body.biome!.seed >>> 0;
    return (x: number, y: number, z: number) => streamWater(x, y, z, level, streams, body.radius, seed);
};

/** The solid ground of an invented world, under its lakes too. */
export const createGroundFunction = (body: ExpeditionBody) => {
    const relief = body.biome?.relief ?? 1;
    const height = inventedHeightFunction(body);
    const scaled = relief === 1 ? height : (x: number, y: number, z: number) => height(x, y, z) * relief;
    const basins = body.biome?.basins;
    const streams = body.biome?.streams;
    if (!basins && !streams) return scaled;
    const seed = body.biome!.seed >>> 0;
    const radius = body.radius;
    return (x: number, y: number, z: number) => {
        let h = scaled(x, y, z);
        if (basins) h += basinShape(x, y, z, seed, basins, radius);
        return streams ? streamCarve(x, y, z, h, streams, radius, seed) : h;
    };
};

/**
 * Metres to add to the ground for a world's sea basins (BiomeDef.basins): down in the basins, up
 * clear of the water elsewhere, nothing round the kept spot. Mirrored exactly in basinShapeGLSL.
 */
const basinShape = (x: number, y: number, z: number, s: number, b: NonNullable<BiomeDef['basins']>, radius: number) => {
    const n = fbm(x * b.freq, y * b.freq, z * b.freq, s + 71, 3) + fbm(x * b.freq2, y * b.freq2, z * b.freq2, s + 73, 2) * b.mix2;
    const sea = smoothstep(b.from, b.to, -n);
    // The kept spot by its chord (metres along the ground, near enough at these distances).
    const dx = x - b.keep[0];
    const dy = y - b.keep[1];
    const dz = z - b.keep[2];
    const keep = smoothstep(b.keepFrom, b.keepTo, Math.sqrt(dx * dx + dy * dy + dz * dz) * radius);
    return keep * (b.lift * (1 - sea) - b.deep * sea);
};

const basinShapeGLSL = (body: ExpeditionBody) => {
    const b = body.biome!.basins!;
    const s = `${body.biome!.seed >>> 0}u`;
    const f = (v: number) => v.toFixed(6);
    return /* glsl */ `
float basinShape(vec3 d) {
    float n = fbm(d * ${f(b.freq)}, ${s} + 71u, 3, 2.0, 0.5) + fbm(d * ${f(b.freq2)}, ${s} + 73u, 2, 2.0, 0.5) * ${f(b.mix2)};
    float sea = smoothstep(${f(b.from)}, ${f(b.to)}, -n);
    float keep = smoothstep(${f(b.keepFrom)}, ${f(b.keepTo)}, length(d - vec3(${b.keep.map(f).join(', ')})) * ${body.radius.toFixed(1)});
    return keep * (${f(b.lift)} * (1.0 - sea) - ${f(b.deep)} * sea);
}
`;
};

const inventedHeightFunction = (body: ExpeditionBody) => {
    const biome = body.biome!;
    const s = biome.seed >>> 0;

    switch (biome.kind) {
        case 'verdant':
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 3, y * 3, z * 3, s, 4);
                const hills = fbm(x * 22, y * 22, z * 22, s + 11, 5);
                const ridge = ridged(x * 9, y * 9, z * 9, s + 23, 4);
                const mask = smoothstep(0.02, 0.42, base);
                const detail = fbm(x * 180, y * 180, z * 180, s + 37, 5);
                return base * 140 + hills * 110 + ridge * mask * 260 + detail * 5;
            };
        case 'desert':
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 2.5, y * 2.5, z * 2.5, s, 4);
                const dunes = fbm(x * 30, y * 30, z * 30, s + 5, 4);
                const mesaNoise = fbm(x * 12, y * 12, z * 12, s + 17, 4);
                const mesa = smoothstep(0.18, 0.24, mesaNoise);
                const detail = fbm(x * 200, y * 200, z * 200, s + 29, 5);
                return base * 80 + dunes * 45 + mesa * 230 + mesaNoise * 30 + detail * 3;
            };
        case 'cratered': {
            // Craters, each as deep as its size makes it (noise.ts
            // craterField): large slumped craters with terraced walls and
            // central peaks, down to small fresh bowls. (The basins and the
            // largest craters, two more sizes worked out at every point of the
            // ground, made the Moon a third slower to draw: they are to come
            // from real elevation maps instead, one lookup.)
            const R = body.radius;
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 3, y * 3, z * 3, s, 4);
                const big = craterField(x * 14, y * 14, z * 14, s + 3, 0.55, R / 14, CRATER_COMPLEX);
                const small = craterField(x * 60, y * 60, z * 60, s + 7, 0.6, R / 60, CRATER_COMPLEX);
                const tiny = craterField(x * 240, y * 240, z * 240, s + 9, 0.5, R / 240, CRATER_COMPLEX);
                const detail = fbm(x * 220, y * 220, z * 220, s + 13, 4);
                return base * 90 + big + small + tiny + detail * 3;
            };
        }
        case 'canyon':
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 3, y * 3, z * 3, s, 4);
                const channel = Math.abs(fbm(x * 7, y * 7, z * 7, s + 19, 4));
                const canyon = 1 - smoothstep(0.0, 0.09, channel);
                const mesa = smoothstep(0.1, 0.16, fbm(x * 16, y * 16, z * 16, s + 31, 3));
                const detail = fbm(x * 190, y * 190, z * 190, s + 41, 5);
                return base * 90 - canyon * 300 + mesa * 120 + detail * 4;
            };
        case 'frozen':
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 3, y * 3, z * 3, s, 4);
                const ridge = ridged(x * 12, y * 12, z * 12, s + 3, 5);
                const mask = smoothstep(-0.05, 0.35, base);
                const drifts = fbm(x * 60, y * 60, z * 60, s + 7, 4);
                const detail = fbm(x * 210, y * 210, z * 210, s + 11, 4);
                return base * 110 + ridge * mask * 460 + drifts * 18 + detail * 3;
            };
        case 'volcanic':
            if (body.id === 'io') {
                // Io has no shield volcanoes. Its mountains are blocks of crust
                // pushed up and tilted, standing alone over the plains with
                // steep scarps, tilted tops and aprons of debris (Boosaule,
                // Tohil, Euboea Montes); its volcanoes are paterae, calderas
                // sunk into the plains.
                return (x: number, y: number, z: number) => {
                    const base = fbm(x * 2.2, y * 2.2, z * 2.2, s, 4);
                    const flows = ridged(x * 14, y * 14, z * 14, s + 5, 4);
                    // A block is a flat-topped dome cell (steep sides, level
                    // top) whose outline the broad field and the flows bend;
                    // the broad field tilts its top. Same noise calls as the
                    // shield volcanoes this replaces, so it costs the same.
                    const warp = base * 0.35 + flows * 0.06;
                    const massif = domes(x * 4.5 + warp, y * 4.5 + warp, z * 4.5 + warp, s + 51, 0.4);
                    const patera = domes(x * 26, y * 26, z * 26, s + 13, 0.3);
                    const detail = fbm(x * 210, y * 210, z * 210, s + 29, 5);
                    return base * 50 + flows * 6 + massif * (120 + base * 90 + flows * 16) - patera * 26 + detail * 2.4;
                };
            }
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 2.2, y * 2.2, z * 2.2, s, 4);
                const flows = ridged(x * 14, y * 14, z * 14, s + 5, 4);
                const shield = shields(x * 4, y * 4, z * 4, s + 9, 0.45);
                const dome = domes(x * 26, y * 26, z * 26, s + 13, 0.3);
                const detail = fbm(x * 210, y * 210, z * 210, s + 29, 5);
                return base * 70 + flows * 9 + shield * 150 + dome * 34 + detail * 2.4;
            };
        case 'methane': {
            // Titan: lakes and seas round the poles, where the methane rains
            // out; the equator dry, under long dunes of dark sand.
            const seas = biome.seas ?? [];
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 2.5, y * 2.5, z * 2.5, s, 4);
                const basins = fbm(x * 7, y * 7, z * 7, s + 3, 5);
                const hills = ridged(x * 18, y * 18, z * 18, s + 7, 4);
                const highland = smoothstep(0.12, 0.45, base);
                const lat = Math.abs(y);
                const polar = smoothstep(0.72, 0.9, lat);
                const belt = 1 - smoothstep(0.35, 0.6, lat);
                const crest = linearDunes(x, y, z, s);
                const sand = smoothstep(-0.05, 0.25, fbm(x * 5, y * 5, z * 5, s + 11, 3)) * (1 - highland) * belt;
                const detail = fbm(x * 200, y * 200, z * 200, s + 29, 5);
                const land = base * 70 + hills * highland * 120 + crest * sand * 9 + detail * 1.6
                    + polar * (basins * 55 + POLAR_LOW) + (1 - polar) * (basins * 20 + DRY_LIFT);
                // A sea's basin has a floor of its own, whatever the land round it does.
                const carve = seaBasins(x, y, z, s, seas);
                return land + (SEA_FLOOR + basins * 12 + detail * 1.6 - land) * carve;
            };
        }
        case 'glacier':
        default:
            return (x: number, y: number, z: number) => {
                const base = fbm(x * 2.5, y * 2.5, z * 2.5, s, 4);
                // Shelves of ice, each edge a steep riser rather than a step:
                // a step the mesh cannot follow is drawn as a sheet of
                // stretched triangles, a striped curtain seen from the side.
                const k = (base * 0.5 + 0.5) * 6;
                const shelves = (Math.floor(k) + smoothstep(0.8, 1, k - Math.floor(k))) / 6;
                const ridge = ridged(x * 16, y * 16, z * 16, s + 5, 4);
                const detail = fbm(x * 200, y * 200, z * 200, s + 13, 4);
                return shelves * 200 + base * 60 + ridge * 160 + detail * 3;
            };
    }
};

/**
 * GLSL source for `float terrainHeight(vec3 d, float spacing)` matching
 * createHeightFunction(). `spacing` is the chunk's vertex spacing in world units;
 * octaves smaller than about 1.5 vertices are skipped because they cannot be
 * drawn at that resolution anyway.
 */
export const heightGLSL = (body: ExpeditionBody) => {
    if (usesEarthMap(body)) return earthGLSL(body);
    if (usesMarsMap(body)) return marsGLSL(body);
    const liquid = body.biome?.liquid;
    if (liquid) {
        // The ground under the lakes, and the lakes' surface over it. water.y
        // is roughly the distance from the shore (a shore shelving 1 in 12).
        const level = liquid.level.toFixed(2);
        return inventedHeightGLSL(body).replace('float terrainHeight(vec3 d, float spacing) {', 'float terrainGround(vec3 d, float spacing) {') + /* glsl */ `
float terrainSurface(vec3 d, float spacing, out vec2 water) {
    float g = terrainGround(d, spacing);
    float level = ${body.biome!.streams ? `streamWater(d, ${level})` : level};
    water = vec2(max(level - g, 0.0), (g - level) * 12.0);
    return max(g, level);
}
float terrainHeight(vec3 d, float spacing) {
    vec2 water;
    return terrainSurface(d, spacing, water);
}
float terrainCover(vec3 d) {
    return 0.0;
}
`;
    }
    return inventedHeightGLSL(body) + /* glsl */ `
float terrainSurface(vec3 d, float spacing, out vec2 water) {
    water = vec2(0.0, 1e4);
    return terrainHeight(d, spacing);
}
float terrainCover(vec3 d) {
    return 0.0;
}
`;
};

/** Uniforms a material needs for heightGLSL(body) (Earth's map; nothing elsewhere). */
export const terrainUniforms = (body: ExpeditionBody): Record<string, THREE.IUniform> =>
    (usesEarthMap(body) ? earthUniforms(body) : usesMarsMap(body) ? marsUniforms(body) : {});

const inventedHeightGLSL = (body: ExpeditionBody) => {
    const relief = body.biome!.relief ?? 1;
    const basins = !!body.biome!.basins;
    const streams = body.biome!.streams;
    const source = inventedHeightSource(body);
    if (relief === 1 && !basins && !streams) return source;
    // The same terrain, its height scaled by the world's relief, its sea basins carved, and its
    // lakes and rivers cut into it.
    const height = `terrainHeightFull(d, spacing) * ${relief.toFixed(4)}${basins ? ' + basinShape(d)' : ''}`;
    return source.replace('float terrainHeight(vec3 d, float spacing) {', 'float terrainHeightFull(vec3 d, float spacing) {')
        + (basins ? basinShapeGLSL(body) : '')
        + (streams ? streamsGLSL(streams, body.radius, body.biome!.seed >>> 0) : '') + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    return ${streams ? `streamCarve(d, ${height})` : height};
}`;
};

const inventedHeightSource = (body: ExpeditionBody) => {
    const biome = body.biome!;
    const s = `${biome.seed >>> 0}u`;
    const R = body.radius.toFixed(1);
    const oct = (freq: number, max: number) =>
        `octaves(${freq.toFixed(1)}, ${max}, spacing)`;
    const common = /* glsl */ `
int octaves(float baseFreq, int maxOctaves, float spacing) {
    float feature = ${R} / (baseFreq * 1.5 * max(spacing, 0.01));
    return clamp(int(floor(log2(max(feature, 1.0)))) + 1, 1, maxOctaves);
}
`;
    switch (biome.kind) {
        case 'verdant':
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 3.0, ${s}, ${oct(3, 4)}, 2.0, 0.5);
    float hills = fbm(d * 22.0, ${s} + 11u, ${oct(22, 5)}, 2.0, 0.5);
    float ridge = ridged(d * 9.0, ${s} + 23u, ${oct(9, 4)});
    float mask = smoothstep(0.02, 0.42, base);
    float detail = spacing < 30.0 ? fbm(d * 180.0, ${s} + 37u, ${oct(180, 5)}, 2.0, 0.5) : 0.0;
    return base * 140.0 + hills * 110.0 + ridge * mask * 260.0 + detail * 5.0;
}`;
        case 'desert':
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 2.5, ${s}, ${oct(2.5, 4)}, 2.0, 0.5);
    float dunes = fbm(d * 30.0, ${s} + 5u, ${oct(30, 4)}, 2.0, 0.5);
    float mesaNoise = fbm(d * 12.0, ${s} + 17u, ${oct(12, 4)}, 2.0, 0.5);
    float mesa = smoothstep(0.18, 0.24, mesaNoise);
    float detail = spacing < 30.0 ? fbm(d * 200.0, ${s} + 29u, ${oct(200, 5)}, 2.0, 0.5) : 0.0;
    return base * 80.0 + dunes * 45.0 + mesa * 230.0 + mesaNoise * 30.0 + detail * 3.0;
}`;
        case 'cratered':
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 3.0, ${s}, ${oct(3, 4)}, 2.0, 0.5);
    float big = ${craterGLSL(body, 14, `${s} + 3u`, 0.55)};
    float small = spacing < 120.0 ? ${craterGLSL(body, 60, `${s} + 7u`, 0.6)} : 0.0;
    float tiny = spacing < 16.0 ? ${craterGLSL(body, 240, `${s} + 9u`, 0.5)} : 0.0;
    float detail = spacing < 30.0 ? fbm(d * 220.0, ${s} + 13u, ${oct(220, 4)}, 2.0, 0.5) : 0.0;
    return base * 90.0 + big + small + tiny + detail * 3.0;
}`;
        case 'volcanic':
            if (body.id === 'io') {
                return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 2.2, ${s}, ${oct(2.2, 4)}, 2.0, 0.5);
    float flows = ridged(d * 14.0, ${s} + 5u, ${oct(14, 4)});
    float massif = domes(d * 4.5 + (base * 0.35 + flows * 0.06), ${s} + 51u, 0.4);
    float patera = spacing < 200.0 ? domes(d * 26.0, ${s} + 13u, 0.3) : 0.0;
    float detail = spacing < 30.0 ? fbm(d * 210.0, ${s} + 29u, ${oct(210, 5)}, 2.0, 0.5) : 0.0;
    return base * 50.0 + flows * 6.0 + massif * (120.0 + base * 90.0 + flows * 16.0) - patera * 26.0 + detail * 2.4;
}`;
            }
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 2.2, ${s}, ${oct(2.2, 4)}, 2.0, 0.5);
    float flows = ridged(d * 14.0, ${s} + 5u, ${oct(14, 4)});
    float shield = shields(d * 4.0, ${s} + 9u, 0.45);
    float dome = spacing < 200.0 ? domes(d * 26.0, ${s} + 13u, 0.3) : 0.0;
    float detail = spacing < 30.0 ? fbm(d * 210.0, ${s} + 29u, ${oct(210, 5)}, 2.0, 0.5) : 0.0;
    return base * 70.0 + flows * 9.0 + shield * 150.0 + dome * 34.0 + detail * 2.4;
}`;
        case 'canyon':
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 3.0, ${s}, ${oct(3, 4)}, 2.0, 0.5);
    float channel = abs(fbm(d * 7.0, ${s} + 19u, ${oct(7, 4)}, 2.0, 0.5));
    float canyon = 1.0 - smoothstep(0.0, 0.09, channel);
    float mesa = smoothstep(0.1, 0.16, fbm(d * 16.0, ${s} + 31u, ${oct(16, 3)}, 2.0, 0.5));
    float detail = spacing < 30.0 ? fbm(d * 190.0, ${s} + 41u, ${oct(190, 5)}, 2.0, 0.5) : 0.0;
    return base * 90.0 - canyon * 300.0 + mesa * 120.0 + detail * 4.0;
}`;
        case 'frozen':
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 3.0, ${s}, ${oct(3, 4)}, 2.0, 0.5);
    float ridge = ridged(d * 12.0, ${s} + 3u, ${oct(12, 5)});
    float mask = smoothstep(-0.05, 0.35, base);
    float drifts = spacing < 150.0 ? fbm(d * 60.0, ${s} + 7u, ${oct(60, 4)}, 2.0, 0.5) : 0.0;
    float detail = spacing < 30.0 ? fbm(d * 210.0, ${s} + 11u, ${oct(210, 4)}, 2.0, 0.5) : 0.0;
    return base * 110.0 + ridge * mask * 460.0 + drifts * 18.0 + detail * 3.0;
}`;
        case 'methane':
            return common + seaBasinsGLSL(biome.seas ?? []) + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 2.5, ${s}, ${oct(2.5, 4)}, 2.0, 0.5);
    float basins = fbm(d * 7.0, ${s} + 3u, ${oct(7, 5)}, 2.0, 0.5);
    float hills = ridged(d * 18.0, ${s} + 7u, ${oct(18, 4)});
    float highland = smoothstep(0.12, 0.45, base);
    float lat = abs(d.y);
    float polar = smoothstep(0.72, 0.9, lat);
    float belt = 1.0 - smoothstep(0.35, 0.6, lat);
    float crest = spacing < 40.0 ? linearDunes(d, ${s}) : 0.0;
    float sand = smoothstep(-0.05, 0.25, fbm(d * 5.0, ${s} + 11u, ${oct(5, 3)}, 2.0, 0.5)) * (1.0 - highland) * belt;
    float detail = spacing < 30.0 ? fbm(d * 200.0, ${s} + 29u, ${oct(200, 5)}, 2.0, 0.5) : 0.0;
    float land = base * 70.0 + hills * highland * 120.0 + crest * sand * 9.0 + detail * 1.6
        + polar * (basins * 55.0 + ${POLAR_LOW.toFixed(2)}) + (1.0 - polar) * (basins * 20.0 + ${DRY_LIFT.toFixed(2)});
    float carve = seaBasins(d, ${s});
    return land + (${SEA_FLOOR.toFixed(2)} + basins * 12.0 + detail * 1.6 - land) * carve;
}`;
        case 'glacier':
        default:
            return common + /* glsl */ `
float terrainHeight(vec3 d, float spacing) {
    float base = fbm(d * 2.5, ${s}, ${oct(2.5, 4)}, 2.0, 0.5);
    float k = (base * 0.5 + 0.5) * 6.0;
    float shelves = (floor(k) + smoothstep(0.8, 1.0, fract(k))) / 6.0;
    float ridge = ridged(d * 16.0, ${s} + 5u, ${oct(16, 4)});
    float detail = spacing < 30.0 ? fbm(d * 200.0, ${s} + 13u, ${oct(200, 4)}, 2.0, 0.5) : 0.0;
    return shelves * 200.0 + base * 60.0 + ridge * 160.0 + detail * 3.0;
}`;
    }
};

/** Rough height range of each biome, used to bound chunks for culling. */
export const HEIGHT_RANGE: Record<BiomeKind, [number, number]> = {
    verdant: [-700, 900],
    desert: [-500, 700],
    cratered: [-700, 600],
    canyon: [-800, 520],
    frozen: [-500, 1100],
    glacier: [-300, 760],
    volcanic: [-400, 900],
    methane: [-260, 420],
};
