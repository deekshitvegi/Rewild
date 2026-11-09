import { useCallback, useEffect, useRef, useState } from 'react';
import { FilmPlayer } from './FilmPlayer';
import { crossingFilmFor, filmUrl, readCrossingFilm } from './films';
import { REGION_NAME, regionLoad, type Region } from './region';
import type { ExpeditionRuntime } from './runtime';

/**
 * What is over the screen while the Argo crosses and the other system is built (region.ts). By
 * default the crossing is drawn by the game itself (crossing.ts, WormholeTransit.tsx), which holds in
 * the throat until the other side is ready: over it there is only a thin line for the loading, gone
 * once it is done. Settings › Graphics › Wormhole crossing can still choose one of the old films
 * (films.ts) instead, played over the whole screen with a bar.
 *
 * A change of system without a crossing (a new ship by Saturn after TON 618, or a crew member
 * parked in the other system) has nothing to show: a dark card with the bar.
 */
export interface Crossing {
    to: Region;
    /** Through the wormhole (the throat, or a film), or moved there some other way (a card). */
    film: boolean;
    id: number;
}

export const WormholeFilm = ({ runtime, region, crossing, ready, onClosed }: {
    runtime: ExpeditionRuntime;
    /** The system the player is in: the next crossing goes to the other one. */
    region: Region;
    crossing: Crossing | null;
    /** The other system is built and its shaders are ready. */
    ready: boolean;
    onClosed: () => void;
}) => {
    const choice = readCrossingFilm();
    // A film, if one was chosen, fetched ahead once a crossing is near (the Argo docked), not by everyone at the start.
    const [warm, setWarm] = useState(false);
    useEffect(() => {
        if (warm || choice === 'engine') return undefined;
        const timer = window.setInterval(() => { if (runtime.mothership?.docked) setWarm(true); }, 1000);
        return () => window.clearInterval(timer);
    }, [runtime, warm, choice]);
    const next = crossingFilmFor(region === 'sol' ? 'ton' : 'sol', choice);

    const done = useCallback(() => {
        runtime.loading = false;
        onClosed();
    }, [runtime, onClosed]);
    const progress = useCallback(() => regionLoad.value, []);

    if (!crossing) return warm && choice !== 'engine' ? <video className="rewild-film__preload" src={filmUrl(next)} preload="auto" muted aria-hidden="true" /> : null;
    if (!crossing.film) return <LoadingCard key={crossing.id} to={crossing.to} ready={ready} onDone={done} />;
    if (choice === 'engine') return <ThroatLoading key={crossing.id} runtime={runtime} to={crossing.to} ready={ready} onDone={onClosed} />;
    return (
        <FilmPlayer
            key={crossing.id}
            film={crossingFilmFor(crossing.to, choice)}
            ready={ready}
            progress={progress}
            title={`Through the wormhole to ${REGION_NAME[crossing.to]}`}
            detail={`Loading ${REGION_NAME[crossing.to]}`}
            onDone={done}
        />
    );
};

/**
 * The crossing drawn by the game: a thin loading line under it while the other side is built. As
 * soon as it is ready the throat is let go (runtime.loading), and this closes when the crossing ends.
 */
const ThroatLoading = ({ runtime, to, ready, onDone }: { runtime: ExpeditionRuntime; to: Region; ready: boolean; onDone: () => void }) => {
    const [shown, setShown] = useState(0);
    const closed = useRef(false);
    useEffect(() => {
        if (ready) runtime.loading = false;
    }, [ready, runtime]);
    useEffect(() => {
        const timer = window.setInterval(() => {
            setShown((last) => Math.max(last, regionLoad.value));
            // Closed once the throat has opened out (or if there was never a throat to hold: nothing to wait for).
            if (ready && !runtime.transit && !closed.current) {
                closed.current = true;
                onDone();
            }
        }, 150);
        return () => window.clearInterval(timer);
    }, [ready, runtime, onDone]);
    return (
        <div className={`rewild-throat${ready ? ' is-ready' : ''}`} role="status" aria-live="polite">
            <p className="rewild-throat__title">{ready ? `${REGION_NAME[to][0].toUpperCase()}${REGION_NAME[to].slice(1)} ahead` : `Loading ${REGION_NAME[to]}`}</p>
            <div className="rewild-throat__bar"><span style={{ transform: `scaleX(${Math.max(0.02, ready ? 1 : shown)})` }} /></div>
        </div>
    );
};

/** No crossing to show: a dark card with the bar, gone as soon as the other system is ready. */
const LoadingCard = ({ to, ready, onDone }: { to: Region; ready: boolean; onDone: () => void }) => {
    const [shown, setShown] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setShown((last) => Math.max(last, regionLoad.value)), 150);
        return () => window.clearInterval(timer);
    }, []);
    useEffect(() => {
        if (!ready) return undefined;
        const timer = window.setTimeout(onDone, 400);
        return () => window.clearTimeout(timer);
    }, [ready, onDone]);
    return (
        <div className="rewild-film is-card" role="status" aria-live="polite">
            <div className="rewild-film__footer">
                <div className="rewild-film__status">
                    <p className="rewild-film__title">Loading {REGION_NAME[to]}</p>
                </div>
                <span className="rewild-film__percent">{Math.round((ready ? 1 : shown) * 100)}%</span>
                <div className="rewild-film__bar"><span style={{ transform: `scaleX(${Math.max(0.02, ready ? 1 : shown)})` }} /></div>
            </div>
        </div>
    );
};
