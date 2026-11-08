/**
 * Small deterministic random number generator (mulberry32).
 *
 * The same seed always produces the same sequence, so anything generated from
 * it (a star system's position, colour or planets) looks identical on every
 * visit instead of being re-rolled on each page load.
 */
export const createSeededRandom = (seed: number) => {
    let state = Math.floor(seed) >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};
