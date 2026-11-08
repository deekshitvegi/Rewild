import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';

/**
 * Inside a gas giant. There is no ground: below the cloud tops the air only
 * gets thicker and hotter until it crushes whatever falls into it. The cloud
 * decks are the real ones, in the real order: ammonia ice at the top (the
 * white zones you see from space), ammonium hydrosulphide below it (whose
 * chromophores colour the brown belts), and water cloud deepest, where the
 * lightning is. NASA's Galileo probe fell into Jupiter in 1995 and stopped
 * transmitting at about 23 bar and 425 K, 57 minutes in.
 *
 * The depths are stretched for the game (the real decks span about 100 km
 * of a planet 70,000 km in radius; here the planet is 520 times smaller but
 * its weather a few kilometres deep, so there is room to fly through it).
 */
export interface CloudDeck {
    /** Height of the deck's top above the 1 bar level (game units, negative below), and its thickness. */
    top: number;
    thickness: number;
    /** Colour lit from above, and seen from below. */
    lit: string;
    under: string;
    name: string;
    /** Lightning lives in this deck. */
    storms?: boolean;
}

export interface GasZone {
    at: number;
    sky: string;
    haze: string;
    glow: string;
    visibility: number;
}

export interface GasModel {
    /** A gas giant (hydrogen and helium all the way down) or an ice giant (water, ammonia and methane under the hydrogen). */
    kind: 'gas' | 'ice';
    /** Where the air begins to show, above the cloud tops. */
    ceiling: number;
    /** Pressure scale height: pressure grows e-fold every this many units down. */
    scaleHeight: number;
    /** Temperature at 1 bar, kelvin. */
    temperature: number;
    /** What the hull is rated for, bar: deeper, it starts to give. */
    hullRating: number;
    /** Strongest jet stream, units per second, and the shape of the winds with latitude. */
    jets: number;
    winds: 'banded' | 'saturn' | 'uranus' | 'neptune';
    /** Sky colours: high (thin air, sunlit), deep (where little light reaches). */
    skyHigh: string;
    skyDeep: string;
    /** How far one sees through the gas between the clouds at the 1 bar level (units). */
    visibility: number;
    decks: CloudDeck[];
    /**
     * What it looks like at each depth, from above the cloud tops down into
     * the dark (highest first): the colour of the sky overhead, of the haze
     * things fade into, of the glow from below (sunlight scattered back up
     * by the clouds underneath, and deep down the planet's own heat), and how
     * far one sees there. Between two of them the look is blended.
     */
    zones: GasZone[];
    /**
     * Thunderstorms: towers of cloud rising out of the storm deck, one in a
     * cell of this size or none (chance), the tallest flattening into anvils.
     */
    towers: { spacing: number; chance: number } | null;
    /**
     * High, thin streaks of methane ice above everything (Neptune), in bands
     * of latitude, casting their shadows on the deck below.
     */
    cirrus?: { top: number; thickness: number; lit: string; under: string; cover: number };
    /** Seconds between lightning strokes nearby: [shortest, longest]; null where none has been seen. */
    lightning: [number, number] | null;
    /** What the HUD says above the cloud tops: what reached here, and what lies below. */
    above: string;
    /** And at depth, about what is under the clouds. */
    below: string;
    /** The card on first going below the cloud tops: what kind of world this is. */
    inside: string;
}

const JUPITER: GasModel = {
    kind: 'gas',
    ceiling: 9000,
    scaleHeight: 2300,
    temperature: 165,
    hullRating: 30,
    jets: 140,
    winds: 'banded',
    skyHigh: '#8fa4bf',
    skyDeep: '#5c4029',
    visibility: 26000,
    decks: [
        { name: 'Ammonia ice clouds', top: 600, thickness: 1800, lit: '#f6ecd9', under: '#b4a184' },
        { name: 'Ammonium hydrosulphide clouds', top: -2200, thickness: 2200, lit: '#e8813e', under: '#7c3314' },
        { name: 'Water clouds', top: -5400, thickness: 2600, lit: '#aab6c2', under: '#3a4350', storms: true },
    ],
    // Above: a deep blue sky over cream cloud tops. Under the ammonia: the
    // light comes through warm, and the hydrosulphide clouds burn orange and
    // red (the colours of the belts and the Great Red Spot). Under that, grey
    // storm murk lit by lightning; then dark, with a red glow from the heat below.
    zones: [
        { at: 6000, sky: '#3f66a8', haze: '#a9bad3', glow: '#e2d0ab', visibility: 160000 },
        { at: 600, sky: '#7d9cc6', haze: '#d4c8b0', glow: '#e9d3a8', visibility: 60000 },
        { at: -2200, sky: '#d29a62', haze: '#c8743d', glow: '#c0602a', visibility: 24000 },
        { at: -5400, sky: '#7a5034', haze: '#6a645b', glow: '#963f1c', visibility: 15000 },
        { at: -11000, sky: '#2a1a12', haze: '#22302d', glow: '#b3401a', visibility: 8000 },
    ],
    // Jupiter's storms are many and violent: towers taller than Everest, Juno's microwave radiometer and lightning detector see them all over.
    towers: { spacing: 16000, chance: 0.3 },
    lightning: [1.5, 6],
    above: "NASA's Galileo probe fell in here in 1995 and lasted to 23 bar and 425 K, 57 minutes in.",
    below: 'Far below the clouds, under thousands of kilometres of hydrogen, the pressure squeezes it into a liquid metal: the source of the strongest magnetic field of any planet.',
    inside: 'A gas giant: hydrogen and helium, like the Sun, with no surface anywhere. Its clouds come in decks, ammonia ice on top, then ammonium hydrosulphide, then water, where the lightning is; the storms that punch up through them are taller than Everest and wider than Texas.',
};

const SATURN: GasModel = {
    kind: 'gas',
    // Colder, with weaker gravity: the same decks lie deeper, under a thick yellow haze, which is why Saturn looks so bland.
    ceiling: 12000,
    scaleHeight: 3600,
    temperature: 134,
    hullRating: 30,
    jets: 240,
    winds: 'saturn',
    skyHigh: '#cbb98c',
    skyDeep: '#56432c',
    visibility: 13000,
    decks: [
        { name: 'Ammonia ice clouds', top: -1100, thickness: 2000, lit: '#f4dca0', under: '#b39257' },
        { name: 'Ammonium hydrosulphide clouds', top: -4200, thickness: 2400, lit: '#dc9a48', under: '#7a4f22' },
        { name: 'Water clouds', top: -8200, thickness: 3000, lit: '#a39886', under: '#3e362c', storms: true },
    ],
    // Golden haze and yellow cumulus at the top, amber and ochre below, dark
    // brown at the water clouds; deeper, the grey-blue murk over the hydrogen.
    zones: [
        { at: 5000, sky: '#b89c5e', haze: '#dcc896', glow: '#efd9a0', visibility: 120000 },
        { at: -1100, sky: '#d0b478', haze: '#dfc287', glow: '#ecc67c', visibility: 45000 },
        { at: -4200, sky: '#bc8c4a', haze: '#c58c44', glow: '#b06e2e', visibility: 19000 },
        { at: -8200, sky: '#604228', haze: '#5c4632', glow: '#74502c', visibility: 12000 },
        { at: -15000, sky: '#1c2130', haze: '#2a3242', glow: '#3e4a5e', visibility: 7000 },
    ],
    // Fewer storms, but huge: Cassini watched single storms in "storm alley" flash for months, and a great white storm wrap round the planet in 2010-11.
    towers: { spacing: 24000, chance: 0.12 },
    lightning: [5, 16],
    above: "Cassini dived into the atmosphere here on 15 September 2017, sending data until it burned up about 1,500 km above these clouds.",
    below: 'Deep down, as in Jupiter, the hydrogen turns metallic; above that core, helium may be raining out of the hydrogen, which would explain why Saturn is hotter inside than it should be.',
    inside: 'A gas giant, the lightest planet: on average less dense than water. Its cloud decks lie deeper than Jupiter\'s under a thick yellow haze, which is why it looks so calm from outside; underneath, its equator carries winds of 1,800 km/h.',
};

const URANUS: GasModel = {
    kind: 'ice',
    // Methane absorbs red light: under its haze everything is cyan. Uranus
    // barely has any heat of its own, so its air is the calmest of the four,
    // its clouds few and its storms rare.
    ceiling: 8000,
    scaleHeight: 2600,
    temperature: 76,
    hullRating: 30,
    jets: 200,
    winds: 'uranus',
    skyHigh: '#a3d3dc',
    skyDeep: '#10313e',
    visibility: 11000,
    decks: [
        { name: 'Methane ice clouds', top: -250, thickness: 1300, lit: '#ecfbfc', under: '#93c8cf' },
        { name: 'Hydrogen sulphide ice clouds', top: -2600, thickness: 2400, lit: '#93d3d9', under: '#2f6d77' },
        { name: 'Ammonium hydrosulphide and water clouds', top: -6000, thickness: 2400, lit: '#548f99', under: '#173a42', storms: true },
    ],
    // Pale cyan over white methane cloud, turning teal under the hydrogen
    // sulphide, then a deep blue-green dark: calm, and almost featureless.
    zones: [
        { at: 5000, sky: '#5fb3c4', haze: '#b6e3e8', glow: '#d6f2f4', visibility: 150000 },
        { at: -250, sky: '#93d0d9', haze: '#c2e8ec', glow: '#c2e8ec', visibility: 50000 },
        { at: -2600, sky: '#6db2ba', haze: '#5ea6ae', glow: '#4b8f99', visibility: 18000 },
        { at: -6000, sky: '#2c636d', haze: '#235159', glow: '#1f4f58', visibility: 11000 },
        { at: -13000, sky: '#0b2227', haze: '#0e262c', glow: '#174048', visibility: 7000 },
    ],
    towers: { spacing: 20000, chance: 0.03 },
    // Voyager 2 heard lightning on the radio in 1986; it has never been seen.
    lightning: [45, 100],
    above: 'No spacecraft has entered Uranus: Voyager 2 flew past once, in 1986. Its clouds smell of rotten eggs: the deck below is hydrogen sulphide ice.',
    below: "This is an ice giant: under the hydrogen lies a deep, hot, dense ocean of water, ammonia and methane, thousands of kilometres thick, round a rocky core.",
    inside: 'An ice giant. Only this outer skin is hydrogen and helium: most of Uranus is water, ammonia and methane, a hot dense fluid. It lies on its side, tilted 98 degrees, so each pole has 42 years of sunlight and then 42 of night. Its north is turning into summer now.',
};

const NEPTUNE: GasModel = {
    kind: 'ice',
    // The windiest planet: Neptune makes more than twice the heat it gets from
    // the Sun, which drives the fastest winds in the Solar System, westward at
    // up to 2,000 km/h. Bright methane cirrus streams high above the blue deck.
    ceiling: 8000,
    scaleHeight: 2300,
    temperature: 72,
    hullRating: 30,
    jets: 320,
    winds: 'neptune',
    // Bluer than Uranus inside: less haze, so the methane's blue reaches deeper.
    skyHigh: '#5b8fd6',
    skyDeep: '#06142e',
    visibility: 24000,
    decks: [
        { name: 'Methane ice clouds', top: -900, thickness: 1300, lit: '#eef5ff', under: '#8db0e2' },
        { name: 'Hydrogen sulphide ice clouds', top: -3200, thickness: 2200, lit: '#5f90e0', under: '#1d3f86' },
        { name: 'Ammonium hydrosulphide and water clouds', top: -6000, thickness: 2000, lit: '#3159b0', under: '#0b1d4a', storms: true },
    ],
    // A deep blue sky over bright white cumulus, then canyons of blue cloud,
    // darker and darker blue below: the methane takes the red light first.
    zones: [
        { at: 5000, sky: '#2457bd', haze: '#8db0ec', glow: '#bdd3f7', visibility: 160000 },
        { at: -900, sky: '#4f86dd', haze: '#86aae8', glow: '#a3c0f1', visibility: 55000 },
        { at: -3200, sky: '#3967c2', haze: '#3d66b9', glow: '#2f57a9', visibility: 19000 },
        { at: -6000, sky: '#152f6d', haze: '#193270', glow: '#1b3b88', visibility: 12000 },
        { at: -13000, sky: '#060e25', haze: '#091432', glow: '#132f6e', visibility: 7000 },
    ],
    towers: { spacing: 15000, chance: 0.07 },
    // Voyager 2's photographs of 1989: white streaks 50 to 100 km above the blue cloud deck, casting shadows on it.
    cirrus: { top: 1900, thickness: 320, lit: '#f6fbff', under: '#b3c6dc', cover: 0.3 },
    lightning: [25, 60],
    above: 'No spacecraft has entered Neptune: Voyager 2 flew past once, in 1989, and photographed these white streaks of methane ice casting their shadows on the deck below.',
    below: 'This is an ice giant: under the hydrogen lies a deep, hot ocean of water, ammonia and methane. Deeper still, the pressure may squeeze carbon out of the methane as diamond hail.',
    inside: 'An ice giant like Uranus, but restless: it gives off more than twice the heat it gets from the Sun, which drives the fastest winds measured anywhere in the Solar System, westward at up to 2,000 km/h. Its moon Triton orbits backwards, a captured world.',
};

export const gasModel = (body: ExpeditionBody): GasModel =>
    body.id === 'beyond' ? SATURN : body.id === 'freelance' ? URANUS : body.id === 'certifications' ? NEPTUNE : JUPITER;

/** Pressure (bar) at a height above the 1 bar level. */
export const pressureAt = (model: GasModel, height: number) => Math.exp(-height / model.scaleHeight);
/** Temperature (K) along the dry adiabat: it rises as pressure to the power 0.29. */
export const temperatureAt = (model: GasModel, height: number) => model.temperature * Math.pow(Math.max(pressureAt(model, height), 0.05), 0.29);
/** The deck the height is inside, if any. */
export const deckAt = (model: GasModel, height: number) => model.decks.find((d) => height <= d.top && height >= d.top - d.thickness) ?? null;
/** Height below which the hull starts to give. */
export const crushHeight = (model: GasModel) => -model.scaleHeight * Math.log(model.hullRating);

/**
 * East-west wind at a latitude (sine of it, from the planet's axis), units per
 * second, positive eastward. Jupiter: jets that change direction band by
 * band, the strongest at 24 degrees north. Saturn: one broad, fast eastward
 * jet over the equator. Uranus and Neptune: the other way round, westward
 * at the equator and eastward at high latitudes (fits to Voyager and Keck
 * cloud tracking, scaled to the strongest).
 */
export const windAt = (model: GasModel, sinLat: number) => {
    const lat = Math.asin(THREE.MathUtils.clamp(sinLat, -1, 1));
    const deg = THREE.MathUtils.radToDeg(lat);
    switch (model.winds) {
        case 'saturn':
            return model.jets * (0.85 * Math.exp(-((deg / 22) ** 2)) + 0.25 * Math.sin(lat * 13) * Math.cos(lat));
        case 'uranus':
            // About -50 m/s at the equator, +250 m/s near 60 degrees.
            return model.jets * (-0.2 + 1.2 * Math.sin(Math.min(Math.abs(lat) * 1.5, Math.PI / 2)) ** 2) * Math.cos(lat * 0.75);
        case 'neptune': {
            // Sromovsky's fit: -398 m/s at the equator, about +250 m/s at 70 degrees.
            const u = -398 + 0.188 * deg * deg - 1.2e-5 * deg ** 4;
            return model.jets * u / 400;
        }
        default:
            return model.jets * (0.55 * Math.cos(lat * 11) + 0.45 * Math.sin(lat * 19 + 0.7)) * Math.cos(lat);
    }
};

/**
 * How bright the murk looks to a camera that has adjusted to the dark, as an
 * eye or a long exposure does: deep down there is next to no sunlight, but the
 * haze is still seen, dim and brown, instead of a black void.
 */
export const seenLight = (light: number) => {
    const dark = 1 - THREE.MathUtils.clamp(light, 0, 1);
    return light + 0.24 * dark * dark;
};

/**
 * The gas itself, between the clouds: how far one sees through it at the 1 bar
 * level is each model's own (GasModel.visibility); this is the height over
 * which that distance changes e-fold (shorter deeper down). Its extinction
 * at a height is 3.9 / visibility there.
 */
export const MURK_SCALE = 3800;

/** How much sunlight is left at a height: each deck above dims it. */
export const lightAt = (model: GasModel, height: number) => {
    let light = 1;
    for (const deck of model.decks) {
        const above = THREE.MathUtils.clamp((deck.top - height) / deck.thickness, 0, 1);
        light *= 1 - above * 0.5;
    }
    // And the haze, thicker with depth.
    return light * Math.exp(-Math.max(0, -height) / 20000);
};

/** The look at a height (GasModel.zones), blended between the two zones round it. Colours are linear. */
export interface ZoneLook { sky: THREE.Color; haze: THREE.Color; glow: THREE.Color; visibility: number }
export const createZoneLook = (): ZoneLook => ({ sky: new THREE.Color(), haze: new THREE.Color(), glow: new THREE.Color(), visibility: 1 });
const zoneColours = new Map<string, THREE.Color>();
const zc = (hex: string) => {
    let c = zoneColours.get(hex);
    if (!c) { c = new THREE.Color(hex); zoneColours.set(hex, c); }
    return c;
};
export const zoneAt = (model: GasModel, height: number, out: ZoneLook) => {
    const zones = model.zones;
    let i = 0;
    while (i < zones.length - 1 && height < zones[i + 1].at) i += 1;
    const a = zones[i];
    const b = zones[Math.min(i + 1, zones.length - 1)];
    const t = a === b ? 0 : THREE.MathUtils.smoothstep(height, a.at, b.at);
    out.sky.copy(zc(a.sky)).lerp(zc(b.sky), t);
    out.haze.copy(zc(a.haze)).lerp(zc(b.haze), t);
    out.glow.copy(zc(a.glow)).lerp(zc(b.glow), t);
    out.visibility = THREE.MathUtils.lerp(a.visibility, b.visibility, t);
    return out;
};

/**
 * How much brighter the camera (or an eye) makes things deep down, where
 * little sunlight reaches: it opens up as the light fades, so the clouds keep
 * their shapes and colours instead of sinking into black.
 */
export const exposureAt = (light: number) => THREE.MathUtils.clamp(1 / (0.22 + 0.78 * Math.sqrt(Math.max(light, 0))), 1, 3.2);
