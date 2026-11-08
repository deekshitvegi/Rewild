import type { ExpeditionProgress } from './glyphs';

/**
 * Earth's recovery (docs/story.md): the planet the player comes home to is ash. Three hundred years
 * after the superflare stripped its ozone, life is coming back on its own (lichen on the rocks,
 * algae in the shallows) but it is far from ready for people. Every chapter done brings more back,
 * and it shows on the ground: the land greens in patches, the lowlands first, the grass returns,
 * the dead trees leaf again.
 *
 * One number, 0 to 1, shared by everything that draws Earth (the ground, the grass, the trees) as
 * a uniform, so they all agree where life has come back: REVIVAL_GLSL gives each the same patches.
 */
export const REVIVAL = { value: 0.08 };

/** Earth's recovery stages, as the story names them (and the share of the bar where each begins). */
export const REVIVAL_STAGES = [
    { from: 0, name: 'Ash', blurb: 'Grey ground and dead trunks; lichen on the rocks.' },
    { from: 0.1, name: 'Lichen', blurb: 'Moss and lichen spreading, algae along the coasts.' },
    { from: 0.3, name: 'Meadow', blurb: 'Grass and shrubs coming back in the lowlands.' },
    { from: 0.55, name: 'Forest', blurb: 'Trees leafing again, rivers running clear.' },
    { from: 0.8, name: 'Wild', blurb: 'Herds and rain clouds; the sky blue again.' },
    { from: 0.95, name: 'Home', blurb: 'Air people can breathe: the Halcyon can land.' },
] as const;

export const revivalStage = (value: number) => [...REVIVAL_STAGES].reverse().find((stage) => value >= stage.from) ?? REVIVAL_STAGES[0];

/** Where the game starts: almost all ash, a few patches where life found a way first. */
export const REVIVAL_START = 0.08;

/**
 * The chapters that bring back one of the Seven Seeds: the ones with a `seed` in quests.ts (kept
 * as a list here so that the ground's shaders need not import the story; quests.ts warns in
 * development if the two differ).
 */
export const SEED_CHAPTER_IDS = ['vault', 'eternal-light', 'soil', 'under-ice', 'nitrogen', 'aeronauts', 'mirrors'];

/**
 * Earth's recovery for this progress: each Seed brought back greens it a seventh of the way to
 * Wild, the Makers' archive a little more, and the Halcyon told (the last chapter) takes it Home.
 * `?revival=0.4` in the address shows any stage.
 */
export const earthRevival = (progress: ExpeditionProgress) => {
    try {
        const forced = new URLSearchParams(window.location.search).get('revival');
        if (forced !== null && Number.isFinite(Number(forced))) return Math.min(1, Math.max(0, Number(forced)));
    } catch {
        // No address to read.
    }
    const done = (id: string) => progress.story.includes(id);
    const seeds = SEED_CHAPTER_IDS.filter(done).length;
    return Math.min(1, REVIVAL_START + seeds * 0.11 + (done('ash') ? 0.02 : 0) + (done('makers') ? 0.03 : 0) + (done('the-call') ? 0.1 : 0));
};

/**
 * GLSL: how far life has come back at a point on Earth (0 ash, 1 alive), from its direction from
 * the centre and its height above the datum. Patches from two octaves of value noise; low ground
 * (where the rivers and the water are) comes back first. Every shader that draws Earth uses this,
 * with the same uRevival.
 */
export const REVIVAL_GLSL = /* glsl */ `
uniform float uRevival;
float rvHash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float rvNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(rvHash(i), rvHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                   mix(rvHash(i + vec3(0.0, 1.0, 0.0)), rvHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
               mix(mix(rvHash(i + vec3(0.0, 0.0, 1.0)), rvHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                   mix(rvHash(i + vec3(0.0, 1.0, 1.0)), rvHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float revivalLife(vec3 dir, float height) {
    if (uRevival >= 0.999) return 1.0;
    float n = rvNoise(dir * 45.0) * 0.65 + rvNoise(dir * 180.0) * 0.35;
    float t = 0.04 + 0.66 * n + 0.2 * smoothstep(20.0, 400.0, height);
    return smoothstep(t - 0.05, t + 0.05, uRevival);
}
// What dead ground and dead wood look like: the colour drained to grey-brown ash.
vec3 ashOf(vec3 c) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return vec3(l) * vec3(1.03, 0.97, 0.9) * 0.92;
}
`;

/** The uniform for a world: Earth's recovery on Earth, alive everywhere else. */
const ALIVE = { value: 1 };
export const revivalUniform = (bodyId: string) => (bodyId === 'projects' ? REVIVAL : ALIVE);

const fract = (x: number) => x - Math.floor(x);
const rvHash = (x: number, y: number, z: number) => {
    let px = fract(x * 0.3183099 + 0.11) * 17;
    let py = fract(y * 0.3183099 + 0.17) * 17;
    let pz = fract(z * 0.3183099 + 0.13) * 17;
    return fract(px * py * pz * (px + py + pz));
};
const rvNoise = (x: number, y: number, z: number) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const fz = smooth(z - iz);
    const h = (a: number, b: number, c: number) => rvHash(ix + a, iy + b, iz + c);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    return lerp(
        lerp(lerp(h(0, 0, 0), h(1, 0, 0), fx), lerp(h(0, 1, 0), h(1, 1, 0), fx), fy),
        lerp(lerp(h(0, 0, 1), h(1, 0, 1), fx), lerp(h(0, 1, 1), h(1, 1, 1), fx), fy),
        fz,
    );
};

/**
 * Whether a tree at `position` (from Earth's centre, game units) is alive at this stage of the recovery: the same rule
 * as REVIVAL_GLSL's revivalLife, worked out once on the CPU when the trees are laid out, so a dead tree's leaves and
 * a living tree's bare twigs need not be drawn at all (Props.tsx). It decides for the trees' near models and their
 * far photographs alike, so the two always agree.
 */
export const treeAlive = (x: number, y: number, z: number, radius: number, revival: number) => {
    if (revival >= 0.999) return true;
    const length = Math.hypot(x, y, z) || 1;
    return rvHash(Math.floor(x * 0.37), Math.floor(y * 0.37), Math.floor(z * 0.37)) < revivalLifeAt(x / length, y / length, z / length, length - radius, revival);
};

const smoothstep = (e0: number, e1: number, v: number) => {
    const c = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    return c * c * (3 - 2 * c);
};

/**
 * REVIVAL_GLSL's revivalLife on the CPU: how far life has come back at the direction (dx, dy, dz)
 * (unit) and `height` above the datum. `slack` widens the edge of the living patches (the grass
 * asks with a little to spare, to leave out only ground that is surely dead).
 */
export const revivalLifeAt = (dx: number, dy: number, dz: number, height: number, revival: number, slack = 0) => {
    if (revival >= 0.999) return 1;
    const n = rvNoise(dx * 45, dy * 45, dz * 45) * 0.65 + rvNoise(dx * 180, dy * 180, dz * 180) * 0.35;
    const t = 0.04 + 0.66 * n + 0.2 * smoothstep(20, 400, height);
    return smoothstep(t - 0.05 - slack, t + 0.05, revival);
};
