import { useCallback, useEffect, useState } from 'react';
import { FilmPlayer } from './FilmPlayer';
import { crossingFilmFor, filmUrl, readCrossingFilm } from './films';
import { REGION_NAME, regionLoad, type Region } from './region';
import type { ExpeditionRuntime } from './runtime';

/**
 * The film of the crossing, shown while the other system is built (region.ts): the crew in the
 * Argo going through the throat (films.ts), over the whole screen, with a bar for the other
 * system's loading. Once that is ready the film can be skipped; when it ends (or is skipped) it
 * fades back into the game, where the tunnel (WormholeTransit.tsx) has been held just short of
 * opening out, and opens out.
 *
 * A change of system without a crossing (a new ship by Saturn after TON 618, or a crew member
 * parked in the other system) plays no film: a dark card with the bar.
 */
export interface Crossing {
    to: Region;
    /** Through the wormhole (the film), or moved there some other way (a card). */
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
    // The next crossing's film fetched ahead once a crossing is near (the Argo docked), not by everyone at the start.
    const [warm, setWarm] = useState(false);
    useEffect(() => {
        if (warm) return undefined;
        const timer = window.setInterval(() => { if (runtime.mothership?.docked) setWarm(true); }, 1000);
        return () => window.clearInterval(timer);
    }, [runtime, warm]);
    const next = crossingFilmFor(region === 'sol' ? 'ton' : 'sol');

    const done = useCallback(() => {
        runtime.loading = false;
        onClosed();
    }, [runtime, onClosed]);
    const progress = useCallback(() => regionLoad.value, []);

    return (
        <>
            {warm && !crossing && <video className="rewild-film__preload" src={filmUrl(next)} preload="auto" muted aria-hidden="true" />}
            {crossing && (crossing.film
                ? (
                    <FilmPlayer
                        key={crossing.id}
                        film={crossingFilmFor(crossing.to, readCrossingFilm())}
                        ready={ready}
                        progress={progress}
                        title={`Through the wormhole to ${REGION_NAME[crossing.to]}`}
                        detail={`Loading ${REGION_NAME[crossing.to]}`}
                        onDone={done}
                    />
                )
                : <LoadingCard key={crossing.id} to={crossing.to} ready={ready} onDone={done} />)}
        </>
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
