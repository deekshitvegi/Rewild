import { EXPEDITION_BODIES } from './bodies';
import { ALPHABET, type ExpeditionProgress } from './glyphs';
import { CHAPTERS, type Chapter, type Objective } from './quests';
import { DATA_SITES } from './sites';
import type { Medal } from './survival';

/**
 * Challenges and medals: the side of the game that rewards playing well
 * rather than playing on.
 *
 * Challenges follow Red Dead Redemption 2's: a handful of trades, each a
 * ladder of ranks taken in order, so only the next rung of each shows. Every
 * rank pays crystals; the last rank of a trade earns its title.
 *
 * Medals follow GTA V's and RDR2's mission medals: finishing a chapter earns
 * bronze; meeting at least half of its bonus objectives, silver; all of them,
 * gold. Bonus objectives can be met later, and the medal improves.
 *
 * Like the story's objectives, every check is a test of the saved progress,
 * so it is met however it came about, and stays met.
 */
export interface Challenge {
    id: string;
    text: string;
    check: Objective['check'];
    /** Crystals paid when it is met. */
    reward: number;
}

export interface Trade {
    id: string;
    name: string;
    /** What finishing every rank makes the explorer. */
    title: string;
    about: string;
    ranks: Challenge[];
}

const counted = (have: number, need: number) => ({ done: have >= need, have: Math.min(Math.floor(have * 10) / 10, need), need });
const best = (values: Record<string, number>) => Math.max(0, ...Object.values(values));
const ruinsRead = (p: ExpeditionProgress) => DATA_SITES.filter((site) => site.kind === 'ruin' && p.sites.includes(site.id)).length;
const RUINS = DATA_SITES.filter((site) => site.kind === 'ruin').length;
const worldIds = new Set(EXPEDITION_BODIES.map((b) => b.id));
const worldsMinedOn = (p: ExpeditionProgress) => Object.entries(p.stats.minedOn).filter(([id, n]) => worldIds.has(id) && n > 0).length;
const fromAsteroids = (p: ExpeditionProgress) => (p.stats.minedOn.belt ?? 0) + (p.stats.minedOn.kuiper ?? 0) + (p.stats.minedOn.space ?? 0);
/** Worlds whose gravity is under a fifth of Earth's: there a jump is a leap. */
const LOW_GRAVITY = EXPEDITION_BODIES.filter((b) => b.kind === 'rocky' && (b.gravity ?? 9.81) < 9.81 / 5).map((b) => b.id);
const ALIEN_SIGNALS = ['europa-signal', 'titan-signal', 'mars-signal'];

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const REWARDS = [5, 8, 12, 16, 25];

const trade = (id: string, name: string, title: string, about: string, ranks: Omit<Challenge, 'id' | 'reward'>[]): Trade => ({
    id, name, title, about,
    ranks: ranks.map((rank, n) => ({ ...rank, id: `${id}-${n + 1}`, reward: REWARDS[n] })),
});

export const TRADES: Trade[] = [
    trade('naturalist', 'Naturalist', 'Master Naturalist', 'The living things of the system: find them, feed them, fish for them.', [
        { text: 'Scan 3 species (look at an animal on foot)', check: (p) => counted(p.fauna.length, 3) },
        { text: 'Feed an animal by hand (E, with food)', check: (p) => counted(p.stats.fed, 1) },
        { text: 'Catch 3 fish (E facing open water)', check: (p) => counted(p.stats.fish, 3) },
        { text: 'Scan 8 species', check: (p) => counted(p.fauna.length, 8) },
        { text: 'Land a fish over 3 kg', check: (p) => ({ done: p.stats.bestFish >= 3 }) },
    ]),
    trade('survivalist', 'Survivalist', 'Master Survivalist', 'Living off the land, as far from home as anyone has been.', [
        { text: 'Pick 5 wild fruit or berries', check: (p) => counted(p.stats.gathered, 5) },
        { text: 'Eat a hot meal sitting by a campfire (R)', check: (p) => counted(p.stats.cooked, 1) },
        { text: 'Drive a predator off with the beam or the torch', check: (p) => counted(p.stats.scared, 1) },
        { text: 'Swim for two minutes in all', check: (p) => counted(Math.floor(p.stats.swum), 120) },
        { text: 'Cook 10 meals by campfires', check: (p) => counted(p.stats.cooked, 10) },
    ]),
    trade('prospector', 'Prospector', 'Master Prospector', 'Crystals are the expedition\'s energy. Find them everywhere.', [
        { text: 'Mine 25 crystals', check: (p) => counted(p.stats.mined, 25) },
        { text: 'Mine crystals on 3 different worlds', check: (p) => counted(worldsMinedOn(p), 3) },
        { text: 'Mine 20 crystals from asteroids', check: (p) => counted(fromAsteroids(p), 20) },
        { text: 'Mine 200 crystals', check: (p) => counted(p.stats.mined, 200) },
        { text: 'Mine crystals on 7 different worlds', check: (p) => counted(worldsMinedOn(p), 7) },
    ]),
    trade('pilot', 'Pilot', 'Master Pilot', 'From the Sun\'s fire to the far side of a wormhole.', [
        { text: 'Land on 3 different worlds', check: (p) => counted(p.stats.landed.length, 3) },
        { text: 'Mine an asteroid with the ship\'s laser', check: (p) => ({ done: fromAsteroids(p) > 0 }) },
        { text: 'Dive within one solar radius of the Sun and get away', check: (p) => ({ done: p.stats.sunPass <= 1 }) },
        { text: 'Land on 8 different worlds', check: (p) => counted(p.stats.landed.length, 8) },
        { text: 'Go through the wormhole and reach TON 618', check: (p) => ({ done: p.stats.visited.includes('ton618') }) },
    ]),
    trade('daredevil', 'Daredevil', 'Daredevil', 'Real gravity on every world: learn what each one forgives.', [
        { text: 'Jump 1.5 metres high', check: (p) => counted(best(p.stats.jumps), 1.5) },
        { text: 'Walk away from a 10 metre drop', check: (p) => counted(best(p.stats.drops), 10) },
        { text: 'Jump 8 metres high on a low-gravity world', check: (p) => counted(Math.max(0, ...LOW_GRAVITY.map((id) => p.stats.jumps[id] ?? 0)), 8) },
        { text: 'Walk away from a 40 metre drop', check: (p) => counted(best(p.stats.drops), 40) },
        { text: 'Dive within a tenth of a solar radius of the Sun', check: (p) => ({ done: p.stats.sunPass <= 0.1 }) },
    ]),
    trade('relics', 'Relic Hunter', 'Relic Hunter', 'Sealed vaults stand near every landing site: light their runes in the order on the lid.', [
        { text: 'Open a vault', check: (p) => counted(p.stats.vaults.length, 1) },
        { text: 'Open 3 vaults', check: (p) => counted(p.stats.vaults.length, 3) },
        { text: 'Open 5 vaults', check: (p) => counted(p.stats.vaults.length, 5) },
        { text: 'Open 7 vaults', check: (p) => counted(p.stats.vaults.length, 7) },
        { text: 'Open all nine vaults', check: (p) => counted(p.stats.vaults.length, 9) },
    ]),
    trade('linguist', 'Linguist', 'Master Linguist', 'The script on every monolith is one language. Learn to read it.', [
        { text: 'Read 3 monoliths', check: (p) => counted(ruinsRead(p), 3) },
        { text: 'Learn 10 glyphs', check: (p) => counted(p.letters.length, 10) },
        { text: 'Read 12 monoliths', check: (p) => counted(ruinsRead(p), Math.min(12, RUINS)) },
        { text: 'Learn every glyph', check: (p) => counted(p.letters.length, ALPHABET.length) },
        { text: 'Read every monolith in the system', check: (p) => counted(ruinsRead(p), RUINS) },
    ]),
    trade('listener', 'Listener', 'Master Listener', 'The radio (V) hears what the eye cannot: point the ship and listen.', [
        { text: 'Hear a signal on the hydrogen line', check: (p) => ({ done: ALIEN_SIGNALS.some((id) => p.stats.heard.includes(id)) }) },
        { text: 'Follow a signal to its source', check: (p) => ({ done: ALIEN_SIGNALS.some((id) => p.stats.signals.includes(id)) }) },
        { text: 'Hear Jupiter roar on the jovian band', check: (p) => ({ done: p.stats.heard.includes('jupiter-roar') }) },
        { text: 'Answer the distress call in the asteroid belt', check: (p) => ({ done: p.stats.signals.includes('derelict-belt') }) },
        { text: 'Hear the Wow! signal from Sagittarius', check: (p) => ({ done: p.stats.signals.includes('wow') }) },
    ]),
];

export const rankName = (trade: Trade, index: number) => `${trade.name} ${ROMAN[index] ?? index + 1}`;

export interface TradeState {
    trade: Trade;
    /** Ranks met, in order. */
    done: number;
    /** The next rank, checked, or null once the trade is mastered. */
    next: { challenge: Challenge; index: number; have?: number; need?: number } | null;
}

/** Where every trade stands, given the challenges already paid (progress.challenges). */
export const tradeStates = (progress: ExpeditionProgress): TradeState[] => TRADES.map((trade) => {
    let done = 0;
    while (done < trade.ranks.length && progress.challenges.includes(trade.ranks[done].id)) done++;
    if (done >= trade.ranks.length) return { trade, done, next: null };
    const challenge = trade.ranks[done];
    return { trade, done, next: { challenge, index: done, ...challenge.check(progress) } };
});

/**
 * Challenges met now that have not been paid yet, rank by rank in order: a
 * rank met early is paid as soon as the one before it is.
 */
export const newlyMet = (progress: ExpeditionProgress) => {
    const met: { trade: Trade; challenge: Challenge; index: number }[] = [];
    for (const trade of TRADES) {
        for (let index = 0; index < trade.ranks.length; index++) {
            const challenge = trade.ranks[index];
            if (progress.challenges.includes(challenge.id)) continue;
            if (!challenge.check(progress).done) break;
            met.push({ trade, challenge, index });
        }
    }
    return met;
};

// ---- Medals ----------------------------------------------------------------------------------

export type { Medal };
export const MEDAL_ORDER: Medal[] = ['bronze', 'silver', 'gold'];
/** Crystals for raising a chapter's medal to silver and to gold. */
export const MEDAL_REWARD: Record<Medal, number> = { bronze: 0, silver: 6, gold: 12 };

/** Bonus objectives met for a chapter: [met, of]. */
export const bonusOf = (chapter: Chapter, progress: ExpeditionProgress) => {
    const bonus = chapter.bonus ?? [];
    return { met: bonus.filter((objective) => objective.check(progress).done).length, of: bonus.length };
};

/** The medal a finished chapter has earned (null while it is unfinished). */
export const medalOf = (chapter: Chapter, progress: ExpeditionProgress): Medal | null => {
    if (!progress.story.includes(chapter.id)) return null;
    const { met, of } = bonusOf(chapter, progress);
    if (!of) return 'gold';
    if (met >= of) return 'gold';
    return met * 2 >= of ? 'silver' : 'bronze';
};

/** Chapters whose medal is better now than the one recorded (progress.medals), to announce and pay. */
export const medalsRaised = (progress: ExpeditionProgress) => {
    const raised: { chapter: Chapter; medal: Medal; reward: number }[] = [];
    for (const chapter of CHAPTERS) {
        const medal = medalOf(chapter, progress);
        if (!medal) continue;
        const had = progress.medals[chapter.id];
        const before = had ? MEDAL_ORDER.indexOf(had) : -1;
        const now = MEDAL_ORDER.indexOf(medal);
        if (now <= before) continue;
        let reward = 0;
        if (bonusOf(chapter, progress).of) for (let step = before + 1; step <= now; step++) reward += MEDAL_REWARD[MEDAL_ORDER[step]];
        raised.push({ chapter, medal, reward });
    }
    return raised;
};
