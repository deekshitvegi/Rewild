import { useEffect, useRef } from 'react';
import { FALL_FADE, FALL_LOST_AT, FALL_TOTAL } from './fall';
import type { ExpeditionRuntime } from './runtime';

/**
 * While the ship falls into TON 618: a thin line showing how far the fall has
 * gone, a way to skip it, the fade to black as the log ends, and then the card
 * for the death: spaghettified inside TON 618. What is happening is told in the
 * expedition log (ExpeditionHUD).
 */
export const FallReadout = ({ runtime, onSkip }: { runtime: ExpeditionRuntime; onSkip: () => void }) => {
    const barRef = useRef<HTMLSpanElement>(null);
    const veilRef = useRef<HTMLDivElement>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const countRef = useRef<HTMLSpanElement>(null);
    const skipRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        let frame = 0;
        const tick = () => {
            const t = runtime.fall.time;
            if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, t / FALL_LOST_AT).toFixed(4)})`;
            if (veilRef.current) {
                const fade = Math.min(1, Math.max(0, (t - FALL_LOST_AT) / FALL_FADE));
                veilRef.current.style.opacity = fade.toFixed(3);
            }
            if (cardRef.current) {
                const shown = Math.min(1, Math.max(0, (t - FALL_LOST_AT - FALL_FADE * 0.6) / 0.8)) * Math.min(1, Math.max(0, (FALL_TOTAL - t) / 0.5));
                cardRef.current.style.opacity = shown.toFixed(3);
                cardRef.current.hidden = shown <= 0;
            }
            if (skipRef.current) skipRef.current.textContent = t >= FALL_LOST_AT ? 'Continue' : 'Skip the fall';
            if (countRef.current) {
                const death = runtime.lastDeath;
                countRef.current.textContent = death && death.cause === 'spaghettified' ? `Death ${death.count}` : '';
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [runtime]);
    return (
        <div className="expedition-fall" role="status" aria-live="polite">
            <div ref={veilRef} className="expedition-fall__veil" aria-hidden="true" />
            <div ref={cardRef} className="expedition-fall__card" role="alert" hidden>
                <strong>Spaghettified inside TON 618</strong>
                <span>
                    Five days after the horizon, in the last tenth of a second, the pull on the nose outgrew the pull on the tail
                    by more than any hull can take. A black hole this big lets you in whole; it is the centre that does not.
                </span>
                <span ref={countRef} className="expedition-fall__count" />
            </div>
            <div className="expedition-fall__bar" aria-hidden="true"><span ref={barRef} /></div>
            <button ref={skipRef} type="button" className="expedition-fall__skip" onClick={onSkip}>Skip the fall</button>
        </div>
    );
};
