import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
    Apple, Combine, ArrowDownToLine, ChevronsUp, Flashlight, Footprints, Gem, Hand, LogOut, Navigation,
    PlaneLanding, PlaneTakeoff, Rocket, ScanLine, Zap, ZoomIn, type LucideIcon,
} from 'lucide-react';
import type { ExpeditionInput } from './input';

/**
 * On-screen controls for phones and tablets. A thumb stick on the left
 * (throttle and turn in the ship, walk on foot), drag anywhere else to look or
 * steer, and buttons that press the same keys the keyboard would (the map
 * and the fabricator are in the toolbar along the top).
 */
export const TouchControls = ({ input, mode, landed, course, autopilot, lowGravity = false, swimming = false }: {
    input: ExpeditionInput;
    mode: 'ship' | 'walk';
    landed: boolean;
    /** On foot where gravity is weak: a button fires the jetpack downward. */
    lowGravity?: boolean;
    /** Swimming: a button dives (held), and the jet button brings the swimmer up. */
    swimming?: boolean;
    /** A course is set on the map: the autopilot can fly it. */
    course: boolean;
    autopilot: boolean;
}) => {
    const baseRef = useRef<HTMLDivElement>(null);
    const [knob, setKnob] = useState({ x: 0, y: 0 });
    const stickPointer = useRef<number | null>(null);

    useEffect(() => () => {
        input.moveX = 0;
        input.moveY = 0;
    }, [input]);

    const moveStick = (event: ReactPointerEvent) => {
        const base = baseRef.current;
        if (!base) return;
        const rect = base.getBoundingClientRect();
        const radius = rect.width / 2;
        let x = (event.clientX - rect.left - radius) / radius;
        let y = (event.clientY - rect.top - radius) / radius;
        const length = Math.hypot(x, y);
        if (length > 1) { x /= length; y /= length; }
        input.moveX = Math.abs(x) < 0.12 ? 0 : x;
        input.moveY = Math.abs(y) < 0.12 ? 0 : -y;
        setKnob({ x, y });
    };
    const releaseStick = () => {
        stickPointer.current = null;
        input.moveX = 0;
        input.moveY = 0;
        setKnob({ x: 0, y: 0 });
    };

    /** A button that holds a key down while touched. */
    const hold = (code: string) => ({
        onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            if (!input.keys.has(code)) input.pressed.add(code);
            input.keys.add(code);
        },
        onPointerUp: () => input.keys.delete(code),
        onPointerCancel: () => input.keys.delete(code),
    });
    /** A button that presses a key once. */
    const tap = (code: string) => ({
        onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
            event.preventDefault();
            input.pressed.add(code);
        },
    });

    return (
        <div className="expedition-touch">
            <div
                ref={baseRef}
                className="expedition-touch__stick"
                aria-label={mode === 'ship' ? 'Throttle and turn' : 'Walk'}
                role="presentation"
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    stickPointer.current = event.pointerId;
                    moveStick(event);
                }}
                onPointerMove={(event) => { if (stickPointer.current === event.pointerId) moveStick(event); }}
                onPointerUp={releaseStick}
                onPointerCancel={releaseStick}
            >
                <span style={{ transform: `translate(${knob.x * 34}px, ${knob.y * 34}px)` }} />
            </div>
            <div className="expedition-touch__buttons">
                <button type="button" {...tap('KeyE')}>{mode === 'walk' ? <Face icon={Hand} label="Use" /> : landed ? <Face icon={LogOut} label="Exit" /> : <Face icon={ScanLine} label="Scan" />}</button>
                {mode === 'ship' && <button type="button" {...tap('KeyF')}>{landed ? <Face icon={PlaneTakeoff} label="Lift" /> : <Face icon={PlaneLanding} label="Land" />}</button>}
                {mode === 'ship' && <button type="button" {...tap('KeyU')}><Face icon={Combine} label="Dock" /></button>}
                {mode === 'ship' && course && <button type="button" aria-pressed={autopilot} {...tap('KeyG')}><Face icon={Navigation} label={autopilot ? 'Manual' : 'Auto'} /></button>}
                <button type="button" {...hold('Space')}>{mode === 'walk' ? <Face icon={ChevronsUp} label={swimming ? 'Rise' : 'Jet'} /> : <Face icon={Zap} label="Pulse" />}</button>
                {mode === 'walk' && (lowGravity || swimming) && <button type="button" {...hold('KeyX')}><Face icon={ArrowDownToLine} label={swimming ? 'Dive' : 'Down'} /></button>}
                <button type="button" {...hold('ShiftLeft')}>{mode === 'walk' ? <Face icon={Footprints} label="Sprint" /> : <Face icon={Rocket} label="Boost" />}</button>
                {mode === 'walk' && (
                    <button
                        type="button"
                        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); input.primary = true; }}
                        onPointerUp={() => { input.primary = false; }}
                        onPointerCancel={() => { input.primary = false; }}
                    >
                        <Face icon={Gem} label="Mine" />
                    </button>
                )}
                {mode === 'walk' && <button type="button" {...tap('KeyR')}><Face icon={Apple} label="Eat" /></button>}
                {mode === 'walk' && <button type="button" {...tap('KeyG')}><Face icon={PlaneLanding} label="Call ship" /></button>}
                <button type="button" {...tap('KeyT')}><Face icon={Flashlight} label="Light" /></button>
                <button
                    type="button"
                    aria-label="Hold to look closer"
                    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); input.closer = true; }}
                    onPointerUp={() => { input.closer = false; }}
                    onPointerCancel={() => { input.closer = false; }}
                >
                    <Face icon={ZoomIn} label="Closer" />
                </button>
            </div>
        </div>
    );
};

/** A touch button's face: a line icon over a short label. */
const Face = ({ icon: Icon, label }: { icon: LucideIcon; label: string }) => (
    <>
        <Icon aria-hidden="true" size={18} strokeWidth={1.5} />
        <span>{label}</span>
    </>
);

/** True on devices whose main pointer is a finger. */
export const useCoarsePointer = () => {
    const [coarse, setCoarse] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
    useEffect(() => {
        const query = window.matchMedia?.('(pointer: coarse)');
        if (!query) return undefined;
        const update = () => setCoarse(query.matches);
        query.addEventListener?.('change', update);
        return () => query.removeEventListener?.('change', update);
    }, []);
    return coarse;
};
