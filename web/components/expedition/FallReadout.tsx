import { useEffect, useRef } from 'react';
import { FALL_FADE, FALL_INSIDE, FALL_SPIRAL, FALL_TOTAL } from './fall';
import type { ExpeditionRuntime } from './runtime';

/**
 * While the ship falls into TON 618: a thin line showing how far the fall has
 * gone, a way to skip it, and the fade to black as the log ends. What is
 * happening is told in the expedition log (ExpeditionHUD).
 */
export const FallReadout = ({ runtime, onSkip }: { runtime: ExpeditionRuntime; onSkip: () => void }) => {
    const barRef = useRef<HTMLSpanElement>(null);
    const veilRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        let frame = 0;
        const tick = () => {
            const t = runtime.fall.time;
            if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, t / FALL_TOTAL).toFixed(4)})`;
            if (veilRef.current) {
                const fade = Math.min(1, Math.max(0, (t - FALL_SPIRAL - FALL_INSIDE) / FALL_FADE));
                veilRef.current.style.opacity = fade.toFixed(3);
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [runtime]);
    return (
        <div className="expedition-fall" role="status" aria-live="polite">
            <div ref={veilRef} className="expedition-fall__veil" aria-hidden="true" />
            <div className="expedition-fall__bar" aria-hidden="true"><span ref={barRef} /></div>
            <button type="button" className="expedition-fall__skip" onClick={onSkip}>Skip the fall</button>
        </div>
    );
};
