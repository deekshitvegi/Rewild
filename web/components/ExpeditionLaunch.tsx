import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { loadSnapshot } from './expedition/loadProgress';
import { FilmPlayer } from './expedition/FilmPlayer';
import { openingFilm } from './expedition/films';

/**
 * Going from the home page into the Expedition in one smooth move: a short
 * hyperspace jump drawn over the galaxy, a black veil with the loading card
 * while the Expedition fetches what the landing site shows and renders its
 * first frames with it, then a fade up onto the landing site.
 * Leaving fades back to the galaxy the same way.
 */
export type ExpeditionPhase = 'off' | 'warp' | 'loading' | 'on' | 'leaving';

const loadExpedition = () => import('./expedition/ExpeditionExperience');
const ExpeditionExperience = lazy(loadExpedition);

/** Download the Expedition ahead of time so the jump never waits for the network. */
export const preloadExpedition = () => {
    void loadExpedition().catch(() => undefined);
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The jump: star streaks rushing out of the centre, then a flash to black. */
const Warp = ({ onDone }: { onDone: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx) {
            doneRef.current();
            return undefined;
        }
        const reduced = prefersReducedMotion();
        const duration = reduced ? 450 : 1650;
        const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
        const resize = () => {
            canvas.width = Math.round(window.innerWidth * ratio);
            canvas.height = Math.round(window.innerHeight * ratio);
        };
        resize();
        window.addEventListener('resize', resize);

        const stars = Array.from({ length: 900 }, () => ({
            angle: Math.random() * Math.PI * 2,
            depth: 0.04 + Math.random() * 0.96,
            tint: Math.random(),
            width: 0.6 + Math.random() * 1.4,
        }));
        const start = performance.now();
        let frame = 0;
        let finished = false;

        const draw = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h / 2;
            const reach = Math.hypot(cx, cy);
            ctx.clearRect(0, 0, w, h);

            // The galaxy darkens as the jump begins.
            ctx.fillStyle = `rgba(1, 2, 6, ${Math.min(1, t * 2.2) * 0.9})`;
            ctx.fillRect(0, 0, w, h);

            if (!reduced) {
                // Speed builds slowly, then all at once.
                const speed = Math.pow(t, 2.6);
                ctx.globalCompositeOperation = 'lighter';
                ctx.lineCap = 'round';
                for (const star of stars) {
                    const r = reach * Math.pow(star.depth, 1.6) * (0.2 + speed * 1.6);
                    const length = r * (0.02 + speed * 0.9);
                    const x0 = cx + Math.cos(star.angle) * r;
                    const y0 = cy + Math.sin(star.angle) * r;
                    const x1 = cx + Math.cos(star.angle) * (r + length);
                    const y1 = cy + Math.sin(star.angle) * (r + length);
                    const alpha = Math.min(1, 0.15 + t * 1.2) * (0.35 + 0.65 * star.depth);
                    const blue = 220 + Math.round(star.tint * 35);
                    ctx.strokeStyle = `rgba(${blue - 40}, ${blue - 15}, 255, ${alpha})`;
                    ctx.lineWidth = star.width * ratio * (0.6 + speed * 1.6);
                    ctx.beginPath();
                    ctx.moveTo(x0, y0);
                    ctx.lineTo(x1, y1);
                    ctx.stroke();
                }
                ctx.globalCompositeOperation = 'source-over';

                // A bright bloom at the centre, then everything goes white and on to black.
                const glow = Math.max(0, (t - 0.55) / 0.45);
                if (glow > 0) {
                    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach * (0.2 + glow));
                    gradient.addColorStop(0, `rgba(235, 244, 255, ${Math.min(1, glow * 1.3)})`);
                    gradient.addColorStop(1, 'rgba(160, 190, 255, 0)');
                    ctx.fillStyle = gradient;
                    ctx.fillRect(0, 0, w, h);
                }
                const white = Math.max(0, (t - 0.78) / 0.12);
                if (white > 0) {
                    ctx.fillStyle = `rgba(240, 246, 255, ${Math.min(1, white)})`;
                    ctx.fillRect(0, 0, w, h);
                }
            }
            const black = reduced ? t : Math.max(0, (t - 0.9) / 0.1);
            if (black > 0) {
                ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, black)})`;
                ctx.fillRect(0, 0, w, h);
            }

            if (t >= 1) {
                if (!finished) {
                    finished = true;
                    doneRef.current();
                }
                return;
            }
            frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', resize);
        };
    }, []);

    return <canvas ref={canvasRef} className="expedition-warp" aria-hidden="true" />;
};

/** Keeps a failed Expedition (no WebGL, a download that did not arrive) from taking the portfolio down with it. */
class ExpeditionBoundary extends Component<{ children: ReactNode; onExit: () => void }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Expedition failed:', error, errorInfo);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="expedition-boot" role="alert">
                <p>The expedition could not start on this device.</p>
                <button type="button" onClick={this.props.onExit}>Return to the galaxy</button>
            </div>
        );
    }
}

/** Things worth knowing before the first step, shown while the world loads. */
const TIPS = [
    'Hold Shift to run. Space jumps; hold it in the air for the jetpack.',
    'E steps out of the ship, and takes you back aboard.',
    'M opens the map: pick any world and fly there.',
    'V tunes the radio. Some signals lead to alien life.',
    'Crystals pay for everything the fabricator makes (C).',
    'J shows your chapters and challenges.',
    'T switches the torch on, for the night side.',
];

/**
 * While the expedition loads: the opening film (films.ts) for where it begins, over the veil, with
 * a bar for how much has arrived and a tip. The game is revealed when the film has ended (or been
 * skipped, once the world is ready) and the world is ready.
 */
const OpeningFilm = ({ ready, onDone }: { ready: boolean; onDone: () => void }) => {
    const opening = useMemo(openingFilm, []);
    const [tip, setTip] = useState(0);
    useEffect(() => {
        if (ready) return undefined;
        const timer = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 5200);
        return () => window.clearInterval(timer);
    }, [ready]);
    const progress = useCallback(() => {
        const snapshot = loadSnapshot();
        return snapshot.total ? snapshot.done / snapshot.total : 0;
    }, []);
    return (
        <FilmPlayer
            film={opening.id}
            ready={ready}
            progress={progress}
            title="Preparing the expedition"
            detail={opening.detail}
            tip={TIPS[tip]}
            onDone={onDone}
        />
    );
};

export const ExpeditionStage = ({ phase, onWarpDone, onReady, onExit }: {
    phase: ExpeditionPhase;
    onWarpDone: () => void;
    onReady: () => void;
    onExit: () => void;
}) => {
    const mounted = phase === 'loading' || phase === 'on' || phase === 'leaving';
    // The world reveals itself once it is ready and the opening film is over.
    const [worldReady, setWorldReady] = useState(false);
    const [filmDone, setFilmDone] = useState(false);
    useEffect(() => {
        if (phase !== 'off') return;
        setWorldReady(false);
        setFilmDone(false);
    }, [phase]);
    const markReady = useCallback(() => setWorldReady(true), []);
    const markFilmDone = useCallback(() => setFilmDone(true), []);
    const revealed = useRef(false);
    useEffect(() => {
        if (phase === 'off') revealed.current = false;
        if (revealed.current || !worldReady || !filmDone) return;
        revealed.current = true;
        onReady();
    }, [phase, worldReady, filmDone, onReady]);
    return (
        <>
            {phase === 'warp' && <Warp onDone={onWarpDone} />}
            {mounted && (
                <ExpeditionBoundary onExit={onExit}>
                    <Suspense fallback={null}>
                        <ExpeditionExperience onExit={onExit} onReady={markReady} />
                    </Suspense>
                </ExpeditionBoundary>
            )}
            <div className="expedition-veil" data-phase={phase} aria-hidden="true" />
            {mounted && phase !== 'leaving' && !filmDone && <OpeningFilm ready={worldReady} onDone={markFilmDone} />}
        </>
    );
};
