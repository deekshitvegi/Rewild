const GALACTIC_EPOCH_YEAR = 2000;
const GALACTIC_ANNIVERSARY_MONTH = 8; // September (zero based)
const GALACTIC_ANNIVERSARY_DAY = 15;
const FULL_ORBIT_RADIANS = Math.PI * 2;

// Match the established fast-forward rate without letting normal-time
// rendering determine the calendar. At 5000x this remains roughly 0.398
// simulated Galactic Years per second.
const PREVIEW_ORBIT_RADIANS_PER_SECOND = 0.0005;
const MAX_PREVIEW_FRAME_SECONDS = 0.1;
const CLOCK_VERSION = 2;

interface GalacticClockState {
    version: number;
    initialWallYears: number;
    lastSyncMs: number;
    previewYears: number;
}

interface GalacticClockWindow extends Window {
    __INITIAL_YEARS__?: number;
    __GALACTIC_YEARS__?: number;
    __GALACTIC_ANGLE__?: number;
    __TIME_SCALE__?: number;
    __GALACTIC_CLOCK_STATE__?: GalacticClockState;
}

export interface GalacticClockSnapshot {
    initialYears: number;
    simulationOffsetYears: number;
    totalYears: number;
    wallClockYears: number;
    isFastForwarding: boolean;
}

const localAnniversary = (calendarYear: number) =>
    new Date(
        calendarYear,
        GALACTIC_ANNIVERSARY_MONTH,
        GALACTIC_ANNIVERSARY_DAY,
        0,
        0,
        0,
        0,
    ).getTime();

/**
 * Returns real Galactic Years in the browser's local timezone.
 *
 * Each Galactic Year runs linearly between consecutive local September 15
 * midnights. This makes every anniversary exact despite leap years or daylight
 * saving changes: September 15, 2026 at 12:00 AM is precisely 26.000.
 */
export const getWallClockGalacticYears = (nowMs = Date.now()): number => {
    const now = new Date(nowMs);
    let anniversaryYear = now.getFullYear();
    let startMs = localAnniversary(anniversaryYear);

    if (nowMs < startMs) {
        anniversaryYear -= 1;
        startMs = localAnniversary(anniversaryYear);
    }

    const endMs = localAnniversary(anniversaryYear + 1);
    const fraction = (nowMs - startMs) / (endMs - startMs);
    return anniversaryYear - GALACTIC_EPOCH_YEAR + fraction;
};

const getClockWindow = () => window as GalacticClockWindow;

const initializeClock = (nowMs: number): GalacticClockState => {
    const clockWindow = getClockWindow();
    const initialWallYears = getWallClockGalacticYears(nowMs);
    const state: GalacticClockState = {
        version: CLOCK_VERSION,
        initialWallYears,
        lastSyncMs: nowMs,
        previewYears: 0,
    };

    clockWindow.__GALACTIC_CLOCK_STATE__ = state;
    clockWindow.__INITIAL_YEARS__ = initialWallYears;
    clockWindow.__GALACTIC_YEARS__ = 0;
    clockWindow.__GALACTIC_ANGLE__ = 0;
    return state;
};

export const getInitialGalacticYears = (nowMs = Date.now()): number => {
    const clockWindow = getClockWindow();
    const state = clockWindow.__GALACTIC_CLOCK_STATE__;
    if (state?.version === CLOCK_VERSION) return state.initialWallYears;
    return initializeClock(nowMs).initialWallYears;
};

/**
 * Synchronizes the shared simulation clock to wall time. Fast-forward adds a
 * page-session offset that remains after the control is released. A reload
 * creates a fresh clock with no session offset, so the calendar stays anchored
 * to Date.now() and reaches exactly 26.000 on September 15, 2026.
 */
export const syncGalacticClock = (
    nowMs = Date.now(),
    requestedTimeScale?: number,
): GalacticClockSnapshot => {
    const clockWindow = getClockWindow();
    let state = clockWindow.__GALACTIC_CLOCK_STATE__;
    if (!state || state.version !== CLOCK_VERSION) state = initializeClock(nowMs);

    const configuredScale = requestedTimeScale ?? clockWindow.__TIME_SCALE__ ?? 1;
    const timeScale = Number.isFinite(configuredScale) ? Math.max(0, configuredScale) : 1;
    const isFastForwarding = timeScale > 1;
    const wallClockYears = getWallClockGalacticYears(nowMs);
    const wallOffsetYears = wallClockYears - state.initialWallYears;

    if (isFastForwarding) {
        const elapsedSeconds = Math.min(
            MAX_PREVIEW_FRAME_SECONDS,
            Math.max(0, (nowMs - state.lastSyncMs) / 1000),
        );
        state.previewYears +=
            (elapsedSeconds * timeScale * PREVIEW_ORBIT_RADIANS_PER_SECOND) /
            FULL_ORBIT_RADIANS;
    }

    state.lastSyncMs = nowMs;
    const simulationOffsetYears = wallOffsetYears + state.previewYears;
    const totalYears = state.initialWallYears + simulationOffsetYears;

    clockWindow.__INITIAL_YEARS__ = state.initialWallYears;
    clockWindow.__GALACTIC_YEARS__ = simulationOffsetYears;
    clockWindow.__GALACTIC_ANGLE__ = simulationOffsetYears * FULL_ORBIT_RADIANS;

    return {
        initialYears: state.initialWallYears,
        simulationOffsetYears,
        totalYears,
        wallClockYears,
        isFastForwarding,
    };
};
