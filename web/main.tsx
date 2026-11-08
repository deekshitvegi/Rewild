import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter/opsz.css';
import './app.css';
import { ExpeditionStage, preloadExpedition, type ExpeditionPhase } from './components/ExpeditionLaunch';

/** The web version on its own: a start screen, then the same warp, opening film and game as on the website. */
function Game() {
    const [phase, setPhase] = useState<ExpeditionPhase>('off');
    useEffect(() => { preloadExpedition(); }, []);
    const begin = useCallback(() => setPhase((p) => (p === 'off' ? 'warp' : p)), []);
    const warped = useCallback(() => setPhase('loading'), []);
    const ready = useCallback(() => setPhase((p) => (p === 'loading' ? 'on' : p)), []);
    const exit = useCallback(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        setPhase('leaving');
        window.setTimeout(() => setPhase('off'), 550);
    }, []);
    // Never leave the veil down if the first frames are slow to arrive.
    useEffect(() => {
        if (phase !== 'loading') return undefined;
        const timer = window.setTimeout(() => setPhase((p) => (p === 'loading' ? 'on' : p)), 60000);
        return () => window.clearTimeout(timer);
    }, [phase]);
    return (
        <>
            {phase === 'off' && (
                <main className="rewild-start">
                    <h1>Rewild</h1>
                    <p>Win Earth back. Then bring it to life.</p>
                    <button type="button" onClick={begin} autoFocus>Begin</button>
                </main>
            )}
            <ExpeditionStage phase={phase} onWarpDone={warped} onReady={ready} onExit={exit} />
        </>
    );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Game /></StrictMode>);
