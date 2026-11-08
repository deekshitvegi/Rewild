/**
 * What the expedition is still fetching: models, maps and the ground's
 * pictures. Every loader hands its promise to trackLoad() the first time it
 * starts, so the loading screen can show real progress and the world is
 * revealed only once the landing site has everything it shows.
 */
export interface LoadSnapshot {
    /** Loads started so far, and how many of them have finished (or failed). */
    total: number;
    done: number;
    /** performance.now() when the last load finished. */
    lastSettled: number;
}

let snapshot: LoadSnapshot = { total: 0, done: 0, lastSettled: 0 };
const listeners = new Set<() => void>();

const publish = (next: LoadSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
};

/** Counts a load in; returns the same promise. */
export const trackLoad = <T>(promise: Promise<T>): Promise<T> => {
    publish({ ...snapshot, total: snapshot.total + 1 });
    const settle = () => publish({ ...snapshot, done: snapshot.done + 1, lastSettled: performance.now() });
    promise.then(settle, settle);
    return promise;
};

export const loadSnapshot = (): LoadSnapshot => snapshot;

export const subscribeLoads = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/** Everything started has finished, and nothing new has started for `quiet` ms. */
export const loadsSettled = (quiet = 600) =>
    snapshot.total > 0 && snapshot.done >= snapshot.total && performance.now() - snapshot.lastSettled > quiet;
