import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';

/**
 * Zoom and pan for a square SVG map (the system map): scroll or pinch-free +/- to zoom about the
 * pointer, drag to pan, and a click that was not a drag is told apart from one that was. The view
 * is a square viewBox inside the map's own `size`-unit drawing; it never zooms out past the whole
 * drawing nor in past `deepest` units across.
 */
export interface MapView { x: number; y: number; w: number }

const DRAG = 5;

export const useMapZoom = (size: number, deepest: number) => {
    const whole: MapView = { x: 0, y: 0, w: size };
    const [view, setView] = useState<MapView>(whole);
    const svgRef = useRef<SVGSVGElement>(null);
    const drag = useRef<{ id: number; x: number; y: number; view: MapView; moved: boolean } | null>(null);
    // The last pointer press ended in a drag: the click that follows it is not a pick.
    const dragged = useRef(false);
    // How big the drawing is on screen (its square side, px), so lines and labels can be sized in pixels.
    const [side, setSide] = useState(600);
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg || typeof ResizeObserver === 'undefined') return undefined;
        const measure = () => {
            const rect = svg.getBoundingClientRect();
            const s = Math.min(rect.width, rect.height);
            if (s > 0) setSide(s);
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(svg);
        return () => observer.disconnect();
    });

    /** Keep the view over the drawing: a little slack at the edges, never wider than the whole. */
    const settle = useCallback((v: MapView): MapView => {
        const w = Math.min(size, Math.max(deepest, v.w));
        const slack = w * 0.35;
        return {
            w,
            x: Math.min(size - w + slack, Math.max(-slack, v.x)),
            y: Math.min(size - w + slack, Math.max(-slack, v.y)),
        };
    }, [size, deepest]);

    /** A point on screen in map units (the SVG keeps its square drawing centred: xMidYMid meet). */
    const toMap = useCallback((clientX: number, clientY: number, v: MapView) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return { x: v.x + v.w / 2, y: v.y + v.w / 2, perPixel: v.w / 600 };
        const side = Math.min(rect.width, rect.height);
        const perPixel = v.w / side;
        const left = rect.left + (rect.width - side) / 2;
        const top = rect.top + (rect.height - side) / 2;
        return { x: v.x + (clientX - left) * perPixel, y: v.y + (clientY - top) * perPixel, perPixel };
    }, []);

    /** Zoom by `factor` (under 1 is in) about a point in map units, or the middle of the view. */
    const zoomBy = useCallback((factor: number, about?: { x: number; y: number }) => {
        setView((v) => {
            const w = Math.min(size, Math.max(deepest, v.w * factor));
            const ax = about?.x ?? v.x + v.w / 2;
            const ay = about?.y ?? v.y + v.w / 2;
            const k = w / v.w;
            return settle({ w, x: ax - (ax - v.x) * k, y: ay - (ay - v.y) * k });
        });
    }, [size, deepest, settle]);

    /** Centre on a point in map units, `w` units across. */
    const focus = useCallback((x: number, y: number, w: number) => setView(settle({ w, x: x - w / 2, y: y - w / 2 })), [settle]);
    const reset = useCallback(() => setView({ x: 0, y: 0, w: size }), [size]);

    const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
        const at = toMap(event.clientX, event.clientY, view);
        zoomBy(Math.exp(event.deltaY * 0.0018), at);
    };
    const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.button !== 0) return;
        dragged.current = false;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view, moved: false };
    };
    const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        const dx = event.clientX - d.x;
        const dy = event.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < DRAG) return;
        if (!d.moved) {
            d.moved = true;
            try {
                event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
                // Capture only keeps a drag that leaves the map going.
            }
        }
        const { perPixel } = toMap(event.clientX, event.clientY, d.view);
        setView(settle({ w: d.view.w, x: d.view.x - dx * perPixel, y: d.view.y - dy * perPixel }));
    };
    const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
        const d = drag.current;
        drag.current = null;
        dragged.current = !!d && d.moved && d.id === event.pointerId;
    };

    return {
        view,
        svgRef,
        viewBox: `${view.x} ${view.y} ${view.w} ${view.w}`,
        /** How many times the whole drawing is magnified. */
        zoom: size / view.w,
        /** Map units per screen pixel: a line `n` pixels wide is n times this. */
        perPixel: view.w / side,
        zoomBy,
        focus,
        reset,
        dragged,
        handlers: { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel: () => { drag.current = null; } },
    };
};
