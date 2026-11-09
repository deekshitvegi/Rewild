import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { loadSnapshot } from './expedition/loadProgress';
import { openingPlace } from './expedition/films';
import './expedition/film.css';

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
 * While the expedition loads: a dark screen with where it begins, a bar for how much has arrived and a tip. It fades
 * as soon as the world is ready. (The opening film made from the game, docs/films/OPENING.md, will play here.)
 */
const OpeningCard = ({ ready, onDone }: { ready: boolean; onDone: () => void }) => {
    const place = useMemo(openingPlace, []);
    const [tip, setTip] = useState(0);
    const [shown, setShown] = useState(0);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        if (ready) return undefined;
        const tips = window.setInterval(() => setTip((i) => (i + 1) % TIPS.length), 5200);
        // The bar never runs backwards, and waits at 97% for the last of the world.
        const bar = window.setInterval(() => {
            const snapshot = loadSnapshot();
            const value = snapshot.total ? snapshot.done / snapshot.total : 0;
            setShown((last) => Math.max(last, Math.min(0.97, value)));
        }, 150);
        return () => { window.clearInterval(tips); window.clearInterval(bar); };
    }, [ready]);
    useEffect(() => {
        if (!ready) return undefined;
        setShown(1);
        const fade = window.setTimeout(() => setClosing(true), 300);
        const done = window.setTimeout(onDone, 1000);
        return () => { window.clearTimeout(fade); window.clearTimeout(done); };
    }, [ready, onDone]);
    const percent = Math.round(shown * 100);
    return (
        <div className={`rewild-film is-card${closing ? ' is-closing' : ''}`}>
            <div className="rewild-film__footer">
                <div className="rewild-film__status">
                    <p className="rewild-film__title">Preparing the expedition</p>
                    <p className="rewild-film__detail" role="status">
                        {ready ? 'Ready' : place}
                        {!ready ? <span> · {TIPS[tip]}</span> : null}
                    </p>
                </div>
                <span className="rewild-film__percent" aria-hidden="true">{percent}%</span>
                <div className="rewild-film__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Loading">
                    <span style={{ transform: `scaleX(${Math.max(0.02, shown)})` }} />
                </div>
            </div>
        </div>
    );
};

export const ExpeditionStage = ({ phase, onWarpDone, onReady, onExit }: {
    phase: ExpeditionPhase;
    onWarpDone: () => void;
    onReady: () => void;
    onExit: () => void;
}) => {
    const mounted = phase === 'loading' || phase === 'on' || phase === 'leaving';
    // The world reveals itself once it is ready and the loading screen has faded.
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
            {mounted && phase !== 'leaving' && !filmDone && <OpeningCard ready={worldReady} onDone={markFilmDone} />}
        </>
    );
};
