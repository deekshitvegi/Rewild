import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import * as THREE from 'three';
import type { ExpeditionBody } from './bodies';
import { groundHeight, groundSpot } from './environment';
import { earthSpot, usesEarthMap, type EarthSpot } from './earth';
import { ECLIPTIC_NORTH } from './orbits';
import { DATA_SITES, globeFrame, type DataSite } from './sites';
import type { ExpeditionRuntime } from './runtime';

/**
 * The surface map (M on a world): the ground around you from above, north
 * up, shaded like a relief map from the same height field you walk on, with
 * your ship, the monoliths, crystals and animals near you. Click or tap the
 * ground, or anything on it, to set a waypoint; its marker then shows the way
 * in the HUD. Drag to pan; scroll, pinch-free +/- buttons or the + and - keys
 * to zoom.
 */

interface Frame {
    body: ExpeditionBody;
    /** Unit direction of the map's centre point from the world's centre. */
    centre: THREE.Vector3;
    east: THREE.Vector3;
    north: THREE.Vector3;
    /** Real latitude and longitude for worlds with a globe (Earth, Mars). */
    globe: THREE.Matrix3 | null;
}

const MIN_SPAN = 150;
/** Widest view: past this a small world's map bends too far from the ground it shows. */
const maxSpan = (body: ExpeditionBody) => Math.min(body.radius * 0.8, 12000);

const makeFrame = (body: ExpeditionBody, point: THREE.Vector3): Frame => {
    const centre = point.clone().sub(body.position).normalize();
    const globe = body.globe ? globeFrame(body) : null;
    // North: the world's own pole where it has a real one, else ecliptic north.
    const pole = globe ? new THREE.Vector3(globe.elements[1], globe.elements[4], globe.elements[7]) : ECLIPTIC_NORTH.clone();
    const north = pole.addScaledVector(centre, -pole.dot(centre));
    if (north.lengthSq() < 1e-8) north.set(1, 0, 0).addScaledVector(centre, -centre.x);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, centre).normalize();
    return { body, centre, east, north, globe };
};

const scratch = new THREE.Vector3();

/**
 * Map metres (east, north) of a point in the world, or null on the far side. The map is azimuthal
 * equidistant about its centre: every distance and bearing from the middle is true, and the edge
 * of the widest view is stretched by under 3% (a flat, gnomonic map stretched it by 16%).
 */
const toMap = (frame: Frame, world: THREE.Vector3) => {
    scratch.copy(world).sub(frame.body.position).normalize();
    const along = scratch.dot(frame.centre);
    if (along <= 0) return null;
    const east = scratch.dot(frame.east);
    const north = scratch.dot(frame.north);
    const across = Math.hypot(east, north);
    if (across < 1e-12) return { x: 0, y: 0 };
    const ground = Math.atan2(across, along) * frame.body.radius;
    return { x: (east / across) * ground, y: (north / across) * ground };
};

/** Unit direction from the world's centre of map metres (x east, y north). */
const fromMap = (frame: Frame, x: number, y: number, out: THREE.Vector3) => {
    const rho = Math.hypot(x, y);
    if (rho < 1e-9) return out.copy(frame.centre);
    const angle = rho / frame.body.radius;
    const s = Math.sin(angle) / rho;
    return out.copy(frame.centre).multiplyScalar(Math.cos(angle)).addScaledVector(frame.east, x * s).addScaledVector(frame.north, y * s).normalize();
};

const groundPoint = (frame: Frame, x: number, y: number) => {
    const direction = fromMap(frame, x, y, new THREE.Vector3());
    return frame.body.position.clone().addScaledVector(direction, frame.body.radius + groundHeight(frame.body, direction));
};

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass bearing from (x0, y0) to (x1, y1) in map metres: degrees and a point. */
const bearing = (x0: number, y0: number, x1: number, y1: number) => {
    const degrees = (THREE.MathUtils.radToDeg(Math.atan2(x1 - x0, y1 - y0)) + 360) % 360;
    return { degrees, point: COMPASS[Math.round(degrees / 45) % 8] };
};

/** A round number for the scale bar, about a fifth of the map across. */
const niceLength = (span: number) => {
    const target = span * 0.2;
    const power = 10 ** Math.floor(Math.log10(target));
    const n = target / power;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
};

const formatMetres = (metres: number) => metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres)} m`;

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a: number[], b: number[], t: number, out: number[]) => {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
    return out;
};
const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

const FOREST = rgb('#26472a');
const SAND = rgb('#d2c193');
const SHALLOW = rgb('#4f9cc0');
const DEEP = rgb('#123a63');
// Titan's lakes of methane, as the map shows them: dark, a little browner in the shallows.
const METHANE_SHALLOW = rgb('#4a3e33');
const METHANE_DEEP = rgb('#16120f');

interface View { cx: number; cy: number; span: number }

/**
 * The ground is drawn in square tiles at fixed zoom levels, the way a web map is: level z tiles are
 * widest / 2^z metres across, each painted once at its own resolution and kept. Panning slides
 * painted tiles; zooming swaps to the level that fits, with the coarser level still painted
 * underneath until the finer one arrives, so the picture is never stretched far or left blank.
 * One shared height scale for the whole map keeps the colours and contours matching across tiles.
 */
const TILES_ACROSS = 4;
const MAX_LEVEL = 8;
const tileSpan = (widest: number, z: number) => widest / 2 ** z;
/** The level whose tiles fit about TILES_ACROSS across the view. */
const levelFor = (widest: number, span: number) => THREE.MathUtils.clamp(Math.round(Math.log2((widest * TILES_ACROSS) / span)), 0, MAX_LEVEL);

/** Heights across the whole map, sampled once: the colour ramp and contour step every tile shares. */
interface Look { lo: number; hi: number; range: number; step: number; exaggerate: number }
const sampleLook = (frame: Frame, widest: number): Look => {
    const direction = new THREE.Vector3();
    const spot: EarthSpot = { water: 0, shore: 1e4, cover: 0, valley: 0 };
    const earth = usesEarthMap(frame.body);
    let lo = Infinity;
    let hi = -Infinity;
    const n = 24;
    for (let row = 0; row <= n; row++) {
        for (let col = 0; col <= n; col++) {
            fromMap(frame, (col / n - 0.5) * widest, (0.5 - row / n) * widest, direction);
            let h: number;
            if (earth) {
                h = earthSpot(frame.body, direction, spot);
                if (spot.water > 0) continue;
            } else {
                h = groundHeight(frame.body, direction);
            }
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
        }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const range = Math.max(hi - lo, 1);
    return { lo, hi, range, step: Math.max(1, niceLength(range * 0.6) / 2), exaggerate: THREE.MathUtils.clamp(widest / (range * 6), 1, 3) };
};

/** One tile being painted: its samples so far, and the canvas they go into. */
interface TileJob {
    key: string;
    z: number;
    x0: number;
    /** North edge (map y of its top row). */
    y1: number;
    span: number;
    n: number;
    row: number;
    heights: Float32Array;
    water: Float32Array;
    shore: Float32Array;
    cover: Float32Array;
    canvas: HTMLCanvasElement;
}

const makeJob = (key: string, z: number, i: number, j: number, span: number, n: number): TileJob => {
    const size = n + 1;
    const canvas = document.createElement('canvas');
    canvas.className = 'surface-map__tile';
    return {
        key, z, x0: i * span, y1: (j + 1) * span, span, n, row: 0,
        heights: new Float32Array(size * size), water: new Float32Array(size * size), shore: new Float32Array(size * size), cover: new Float32Array(size * size),
        canvas,
    };
};

const sampleDirection = new THREE.Vector3();
const sampleSpot: EarthSpot = { water: 0, shore: 1e4, cover: 0, valley: 0 };
/** Sample rows of a tile until `until` (ms); true once every row is in. */
const sampleRows = (frame: Frame, job: TileJob, until: number) => {
    const size = job.n + 1;
    const earth = usesEarthMap(frame.body);
    const lakes = !!frame.body.biome?.liquid;
    while (job.row < size && performance.now() < until) {
        const my = job.y1 - (job.row / job.n) * job.span;
        for (let col = 0; col < size; col++) {
            const mx = job.x0 + (col / job.n) * job.span;
            fromMap(frame, mx, my, sampleDirection);
            const i = job.row * size + col;
            if (earth) {
                job.heights[i] = earthSpot(frame.body, sampleDirection, sampleSpot);
                job.water[i] = sampleSpot.water;
                job.shore[i] = sampleSpot.shore;
                job.cover[i] = sampleSpot.cover;
            } else if (lakes) {
                job.heights[i] = groundHeight(frame.body, sampleDirection);
                job.water[i] = groundSpot(frame.body, sampleDirection).water;
            } else {
                job.heights[i] = groundHeight(frame.body, sampleDirection);
            }
        }
        job.row += 1;
    }
    return job.row >= size;
};

const LIGHT = new THREE.Vector3(-1, 1, 1.25).normalize();
/** Colour a sampled tile into its canvas: palette by height, hill shading, contours, water. */
const drawTile = (frame: Frame, job: TileJob, look: Look) => {
    const { n, heights, water, shore, cover } = job;
    const size = n + 1;
    const earth = usesEarthMap(frame.body);
    const lakes = !!frame.body.biome?.liquid;
    const palette = (frame.body.biome?.palette ?? ['#777777', '#888888', '#999999', '#555555', '#777777']).map(rgb);
    const { lo, range, step } = look;
    // Relief is exaggerated where the land is gentle, so it still reads: one amount for the whole
    // map, so tiles of every level match while the sharper ones arrive.
    const exaggerate = look.exaggerate;
    const cell = job.span / n;
    job.canvas.width = n;
    job.canvas.height = n;
    const context = job.canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(n, n);
    const color = [0, 0, 0];
    const ground = [0, 0, 0];
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * size + x;
            const h = heights[i];
            // Rows run north to south: down the image is south.
            const dx = (heights[i + 1] - h) / cell;
            const dy = (h - heights[i + size]) / cell;
            const slope = Math.hypot(dx, dy);
            if (water[i] > 0.05) {
                if (lakes) mix(METHANE_SHALLOW, METHANE_DEEP, smooth(0, 12, water[i]), color);
                else mix(SHALLOW, DEEP, smooth(0, 30, water[i]), color);
            } else {
                const t = THREE.MathUtils.clamp((h - lo) / range, 0, 1);
                if (t < 0.5) mix(palette[0], palette[1], t * 2, ground);
                else mix(palette[1], palette[2], (t - 0.5) * 2, ground);
                mix(ground, palette[3], smooth(0.55, 1.3, slope), ground);
                if (earth) {
                    mix(ground, FOREST, cover[i] * 0.75, ground);
                    if (shore[i] < 7) mix(ground, SAND, smooth(7, 2, shore[i]), ground);
                }
                // Hill shading from the north-west, as on a printed relief map.
                const nx = -dx * exaggerate;
                const ny = -dy * exaggerate;
                const shade = (nx * LIGHT.x + ny * LIGHT.y + LIGHT.z) / Math.sqrt(nx * nx + ny * ny + 1) / LIGHT.z;
                const lit = THREE.MathUtils.clamp(0.42 + 0.58 * shade, 0.3, 1.3);
                color[0] = ground[0] * lit;
                color[1] = ground[1] * lit;
                color[2] = ground[2] * lit;
                // Contour lines, every fifth one darker.
                const band = Math.floor(h / step);
                if (band !== Math.floor(heights[i + 1] / step) || band !== Math.floor(heights[i + size] / step)) {
                    const k = band % 5 === 0 ? 0.68 : 0.84;
                    color[0] *= k;
                    color[1] *= k;
                    color[2] *= k;
                }
            }
            const o = (y * n + x) * 4;
            image.data[o] = Math.min(255, color[0]);
            image.data[o + 1] = Math.min(255, color[1]);
            image.data[o + 2] = Math.min(255, color[2]);
            image.data[o + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    // The samples are no longer needed once drawn.
    job.heights = job.water = job.shore = job.cover = new Float32Array(0);
};

/** The tiles a view needs at level z: their keys and indices. */
const tilesFor = (view: View, widest: number, z: number) => {
    const s = tileSpan(widest, z);
    const out: { key: string; z: number; i: number; j: number; d: number }[] = [];
    const i0 = Math.floor((view.cx - view.span / 2) / s);
    const i1 = Math.floor((view.cx + view.span / 2) / s);
    const j0 = Math.floor((view.cy - view.span / 2) / s);
    const j1 = Math.floor((view.cy + view.span / 2) / s);
    for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
            const d = Math.hypot((i + 0.5) * s - view.cx, (j + 0.5) * s - view.cy);
            out.push({ key: `${z}:${i}:${j}`, z, i, j, d });
        }
    }
    return out;
};

/**
 * Keeps the tile layer (`layer`, a div over the map) showing the ground for `view`: painted tiles
 * placed in it, missing ones painted a few at a time (most of a frame each: the world waits while
 * a map is open), nearest the middle first, the coarse level before the fine one. Returns whether
 * any ground is showing yet.
 */
const useTerrainTiles = (frame: Frame, view: View, widest: number, quality: number, layer: React.RefObject<HTMLDivElement>) => {
    const cache = useRef(new Map<string, TileJob>());
    const look = useMemo(() => sampleLook(frame, widest), [frame, widest]);
    const [ready, setReady] = useState(false);
    const viewRef = useRef(view);
    viewRef.current = view;
    const fine = quality === 0 ? 64 : 96;

    // Put every painted tile the view needs into the layer, coarse levels under fine ones.
    const place = useCallback(() => {
        const box = layer.current;
        if (!box) return;
        const v = viewRef.current;
        const z = levelFor(widest, v.span);
        const levels = [...new Set([0, Math.max(0, z - 2), Math.max(0, z - 1), z])];
        const shown = new Set<HTMLCanvasElement>();
        for (const level of levels) {
            for (const t of tilesFor(v, widest, level)) {
                const job = cache.current.get(t.key);
                if (!job || job.row <= job.n || !job.canvas.width) continue;
                const left = ((job.x0 - (v.cx - v.span / 2)) / v.span) * 100;
                const top = (((v.cy + v.span / 2) - job.y1) / v.span) * 100;
                const width = (job.span / v.span) * 100;
                const style = job.canvas.style;
                style.left = `${left}%`;
                style.top = `${top}%`;
                // A hair over, so neighbouring tiles leave no seam between them.
                style.width = `${width + 0.06}%`;
                style.height = `${width + 0.06}%`;
                style.zIndex = String(level);
                shown.add(job.canvas);
                if (job.canvas.parentElement !== box) box.appendChild(job.canvas);
            }
        }
        for (const child of [...box.children]) if (!shown.has(child as HTMLCanvasElement)) child.remove();
        if (shown.size && !ready) setReady(true);
    }, [layer, widest, ready]);

    useEffect(() => { place(); }, [view, place]);

    // The painter: one job at a time, the most needed first.
    useEffect(() => {
        let request = 0;
        let stopped = false;
        const next = () => {
            const v = viewRef.current;
            const z = levelFor(widest, v.span);
            // Coarse to fine: the whole map, then two cheap in-between levels, then the sharp one,
            // so the view sharpens in steps instead of sitting blocky while the sharp tiles come.
            const near = (level: number) => tilesFor(v, widest, level).sort((a, b) => a.d - b.d);
            const wanted = [
                ...tilesFor({ cx: 0, cy: 0, span: widest }, widest, 0),
                ...(z >= 2 ? near(z - 2) : []),
                ...(z >= 1 ? near(z - 1) : []),
                ...near(z),
            ];
            for (const t of wanted) {
                const job = cache.current.get(t.key);
                if (!job) {
                    const made = makeJob(t.key, t.z, t.i, t.j, tileSpan(widest, t.z), t.z === z ? fine : t.z === 0 ? 32 : 48);
                    cache.current.set(t.key, made);
                    return made;
                }
                if (job.row <= job.n) return job;
            }
            return null;
        };
        const work = () => {
            if (stopped) return;
            const until = performance.now() + 18;
            let changed = false;
            while (performance.now() < until) {
                const job = next();
                if (!job) break;
                if (sampleRows(frame, job, until)) {
                    drawTile(frame, job, look);
                    job.row = job.n + 1;
                    changed = true;
                }
            }
            if (changed) place();
            request = requestAnimationFrame(work);
        };
        request = requestAnimationFrame(work);
        return () => {
            stopped = true;
            cancelAnimationFrame(request);
        };
    }, [frame, widest, fine, look, place]);

    // A different world (or a reopened map): start again.
    useEffect(() => () => { cache.current.clear(); }, [frame]);
    return ready;
};

interface Place {
    id: string;
    name: string;
    detail: string;
    x: number;
    y: number;
    world: THREE.Vector3;
    kind: 'ship' | 'site' | 'obelisk' | 'waypoint';
    read?: boolean;
    color: string;
}

export const SurfaceMapView = ({ runtime, read, onChange }: {
    runtime: ExpeditionRuntime;
    read: ReadonlySet<string>;
    /** Called after the waypoint changes, so the dialog can say so. */
    onChange?: () => void;
}) => {
    const body = runtime.currentBody!;
    const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
    const ship = runtime.hud.ship;
    const player = walker ? walker.position : ship!.position;
    // The map is drawn about a point on the ground: where the player stood when it was opened, and
    // then wherever it is panned to (below), so the middle of the map is always true to the ground.
    const [frame, setFrame] = useState(() => makeFrame(body, player));
    const me = useMemo(() => toMap(frame, player) ?? { x: 0, y: 0 }, [frame, player]);
    const shipAt = useMemo(() => (ship && walker ? toMap(frame, ship.position) : null), [frame, ship, walker]);
    const widest = maxSpan(body);

    const [view, setView] = useState<View>(() => {
        const reach = shipAt ? Math.hypot(shipAt.x - me.x, shipAt.y - me.y) : 0;
        return { cx: me.x, cy: me.y, span: THREE.MathUtils.clamp(reach * 2.7, 320, widest) };
    });
    const layerRef = useRef<HTMLDivElement>(null);
    const [waypoint, setWaypoint] = useState(() => runtime.surfaceWaypoint?.clone() ?? null);
    const boxRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ id: number; x: number; y: number; view: View; moved: boolean } | null>(null);
    const ready = useTerrainTiles(frame, view, widest, runtime.quality, layerRef);

    // Map metres to the overlay's 1000-unit box, and back.
    const px = (x: number) => 500 + ((x - view.cx) / view.span) * 1000;
    const py = (y: number) => 500 - ((y - view.cy) / view.span) * 1000;

    const places = useMemo<Place[]>(() => {
        const list: Place[] = [];
        if (shipAt && ship) list.push({ id: 'ship', name: 'Your ship', detail: 'Board it with E', x: shipAt.x, y: shipAt.y, world: ship.position, kind: 'ship', color: '#7fe3ff' });
        for (const site of DATA_SITES as DataSite[]) {
            if (site.body !== body || site.kind === 'station') continue;
            const at = toMap(frame, site.position);
            if (!at) continue;
            list.push({
                id: site.id,
                name: site.entry.name,
                detail: site.kind === 'obelisk' ? 'The Obelisk' : read.has(site.id) ? 'Read' : 'Unread monolith',
                x: at.x,
                y: at.y,
                world: site.position,
                kind: site.kind === 'obelisk' ? 'obelisk' : 'site',
                read: read.has(site.id),
                color: site.kind === 'obelisk' || read.has(site.id) ? '#ffc85a' : site.color,
            });
        }
        return list;
    }, [frame, body, ship, shipAt, read]);

    const waypointAt = waypoint ? toMap(frame, waypoint) : null;

    const setTarget = useCallback((point: THREE.Vector3 | null) => {
        runtime.surfaceWaypoint = point ? point.clone() : null;
        setWaypoint(point ? point.clone() : null);
        onChange?.();
    }, [runtime, onChange]);

    const zoom = useCallback((factor: number, about?: { x: number; y: number }) => {
        setView((current) => {
            const span = THREE.MathUtils.clamp(current.span * factor, MIN_SPAN, widest);
            if (!about) return { ...current, span };
            // Keep the point under the pointer where it is.
            const k = span / current.span;
            return { cx: about.x + (current.cx - about.x) * k, cy: about.y + (current.cy - about.y) * k, span };
        });
    }, [widest]);

    /**
     * Show `next`, and when it has been panned well away from the projection's centre, move the
     * centre there instead: the ground keeps its true shape however far the map is dragged, and it
     * can be dragged all the way round the world (it used to stretch out and end). The view is then
     * in the new frame's metres, which is returned.
     */
    const show = (next: View): View => {
        if (Math.hypot(next.cx, next.cy) < Math.max(next.span * 0.5, body.radius * 0.2)) {
            setView(next);
            return next;
        }
        const direction = fromMap(frame, next.cx, next.cy, new THREE.Vector3());
        setFrame(makeFrame(body, body.position.clone().add(direction)));
        const moved = { cx: 0, cy: 0, span: next.span };
        setView(moved);
        return moved;
    };

    const toMetres = (clientX: number, clientY: number) => {
        const rect = boxRef.current!.getBoundingClientRect();
        const u = (clientX - rect.left) / rect.width;
        const v = (clientY - rect.top) / rect.height;
        return { x: view.cx + (u - 0.5) * view.span, y: view.cy - (v - 0.5) * view.span, scale: rect.width / 1000 };
    };

    const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
        try {
            event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
            // Capture is only a nicety for drags that leave the map.
        }
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view, moved: false };
    };
    const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        const dx = event.clientX - d.x;
        const dy = event.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 6) return;
        d.moved = true;
        const rect = boxRef.current!.getBoundingClientRect();
        const metres = d.view.span / rect.width;
        const shown = show({ cx: d.view.cx - dx * metres, cy: d.view.cy + dy * metres, span: d.view.span });
        // Re-centred: carry on dragging from here, in the new frame.
        if (shown.cx === 0 && shown.cy === 0) {
            d.x = event.clientX;
            d.y = event.clientY;
            d.view = shown;
        }
    };
    const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        drag.current = null;
        if (!d || d.moved || d.id !== event.pointerId) return;
        // A click: on the waypoint clears it, on a place goes there, elsewhere marks the ground.
        const at = toMetres(event.clientX, event.clientY);
        const near = (x: number, y: number) => Math.hypot(px(x) - px(at.x), py(y) - py(at.y)) * at.scale < 16;
        if (waypointAt && near(waypointAt.x, waypointAt.y)) {
            setTarget(null);
            return;
        }
        const place = places.find((p) => near(p.x, p.y));
        setTarget(place ? place.world : groundPoint(frame, at.x, at.y));
    };
    const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        const at = toMetres(event.clientX, event.clientY);
        zoom(Math.exp(event.deltaY * 0.0016), at);
    };
    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const pan = view.span * 0.12;
        const moves: Record<string, [number, number]> = { ArrowUp: [0, pan], ArrowDown: [0, -pan], ArrowLeft: [-pan, 0], ArrowRight: [pan, 0] };
        if (moves[event.key]) {
            event.preventDefault();
            const [dx, dy] = moves[event.key];
            show({ ...view, cx: view.cx + dx, cy: view.cy + dy });
        } else if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoom(1 / 1.5);
        } else if (event.key === '-' || event.key === '_') {
            event.preventDefault();
            zoom(1.5);
        }
    };


    // Things beyond the edge get an arrow on the border pointing to them.
    const edge = (x: number, y: number) => {
        const sx = px(x) - 500;
        const sy = py(y) - 500;
        const limit = 470;
        const k = Math.min(limit / Math.max(Math.abs(sx), 1e-6), limit / Math.max(Math.abs(sy), 1e-6));
        if (k >= 1) return null;
        return { x: 500 + sx * k, y: 500 + sy * k, angle: THREE.MathUtils.radToDeg(Math.atan2(sy, sx)) };
    };

    // The arrow points where the view looks (what the player sees as ahead), not where the explorer's
    // body happens to face.
    const viewDirection = runtime.view.camera ? runtime.view.camera.getWorldDirection(new THREE.Vector3()) : null;
    const facing = viewDirection ?? (walker ? walker.facing : new THREE.Vector3(0, 0, -1).applyQuaternion(ship!.quaternion));
    const heading = THREE.MathUtils.radToDeg(Math.atan2(facing.dot(frame.east), facing.dot(frame.north)));
    const shipHeading = ship ? (() => {
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
        return THREE.MathUtils.radToDeg(Math.atan2(f.dot(frame.east), f.dot(frame.north)));
    })() : 0;
    const scale = niceLength(view.span);
    const zoomed = view.span <= 2000;

    // Labels that fit: the ship and the Obelisk first, then the nearest
    // monoliths, each only where it does not cover one already placed (the
    // list beside the map names them all).
    const labelled = new Set<string>();
    {
        const boxes: { l: number; t: number; r: number; b: number }[] = [
            { l: px(me.x) - 22, t: py(me.y) - 22, r: px(me.x) + 22, b: py(me.y) + 22 },
        ];
        const order = [...places].sort((a, b) => {
            const rank = (p: Place) => (p.kind === 'ship' ? 0 : p.kind === 'obelisk' ? 1 : 2);
            return rank(a) - rank(b) || Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y);
        });
        for (const place of order) {
            if (place.kind === 'site' && !zoomed) continue;
            const x = px(place.x);
            const y = py(place.y) + (place.kind === 'ship' ? 34 : 30);
            const half = ((place.kind === 'ship' ? 4 : place.name.length) * 12.5) / 2 + 6;
            const box = { l: x - half, t: y - 20, r: x + half, b: y + 6 };
            if (boxes.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
            boxes.push(box);
            labelled.add(place.id);
        }
    }

    // Where you are: latitude and longitude on a world with a real globe.
    const coordinates = (() => {
        const up = player.clone().sub(body.position).normalize();
        if (frame.globe) {
            const e = frame.globe.elements;
            const zeroDir = new THREE.Vector3(e[0], e[3], e[6]);
            const northPole = new THREE.Vector3(e[1], e[4], e[7]);
            const eastDir = new THREE.Vector3(e[2], e[5], e[8]);
            const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(up.dot(northPole), -1, 1)));
            const lon = THREE.MathUtils.radToDeg(Math.atan2(up.dot(eastDir), up.dot(zeroDir)));
            return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
        }
        const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(up.y, -1, 1)));
        const lon = THREE.MathUtils.radToDeg(Math.atan2(-up.z, up.x));
        return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${((lon + 360) % 360).toFixed(2)}° E`;
    })();

    const listed = places
        .map((place) => ({ place, distance: Math.hypot(place.x - me.x, place.y - me.y), way: bearing(me.x, me.y, place.x, place.y) }))
        .sort((a, b) => (a.place.kind === 'ship' ? -1 : b.place.kind === 'ship' ? 1 : a.distance - b.distance));
    const waypointDistance = waypointAt ? Math.hypot(waypointAt.x - me.x, waypointAt.y - me.y) : 0;

    return (
        <div className="surface-map">
            <div
                ref={boxRef}
                className="surface-map__view"
                role="application"
                aria-label={`Map of the ground around you on ${body.name}. Click to set a waypoint, drag to pan, scroll or use plus and minus to zoom.`}
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => { drag.current = null; }}
                onWheel={onWheel}
                onKeyDown={onKeyDown}
            >
                <div ref={layerRef} className="surface-map__tiles" />
                {!ready && <p className="surface-map__loading" role="status">Surveying the ground…</p>}
                <svg className="surface-map__overlay" viewBox="0 0 1000 1000" aria-hidden="true">
                    {/* The way to the ship and to the waypoint. */}
                    {shipAt && <line x1={px(me.x)} y1={py(me.y)} x2={px(shipAt.x)} y2={py(shipAt.y)} stroke="#7fe3ff" strokeOpacity="0.55" strokeWidth="2.5" strokeDasharray="8 8" />}
                    {waypointAt && <line x1={px(me.x)} y1={py(me.y)} x2={px(waypointAt.x)} y2={py(waypointAt.y)} stroke="#ffd35a" strokeOpacity="0.75" strokeWidth="3" strokeDasharray="10 7" />}
                    {/* How far, half way along each line (where it is on the map). */}
                    {[shipAt && { at: shipAt, colour: '#7fe3ff' }, waypointAt && { at: waypointAt, colour: '#ffd35a' }].map((line, n) => {
                        if (!line) return null;
                        const metres = Math.hypot(line.at.x - me.x, line.at.y - me.y);
                        const mx = (px(me.x) + px(line.at.x)) / 2;
                        const my = (py(me.y) + py(line.at.y)) / 2;
                        if (metres < 30 || mx < 40 || mx > 960 || my < 40 || my > 960) return null;
                        return <text key={n} x={mx} y={my - 8} textAnchor="middle" className="surface-map__label" style={{ fill: line.colour }}>{formatMetres(metres)}</text>;
                    })}
                    {zoomed && runtime.surface.crystals.filter((c) => !runtime.surface.mined.has(c.id)).map((cluster) => {
                        const at = toMap(frame, cluster.position);
                        if (!at) return null;
                        return <path key={cluster.id} d="M0 -7 L5 0 L0 7 L-5 0 Z" transform={`translate(${px(at.x)} ${py(at.y)})`} fill={body.biome?.crystal ?? '#56d8ff'} stroke="#04121a" strokeWidth="1.5" />;
                    })}
                    {view.span <= 4000 && runtime.fauna.animals.map((animal, n) => {
                        const at = toMap(frame, animal.position);
                        if (!at) return null;
                        return <circle key={n} cx={px(at.x)} cy={py(at.y)} r="4.5" fill="#ffd9a6" stroke="#2a1a08" strokeWidth="1.5" />;
                    })}
                    {places.map((place) => {
                        const x = px(place.x);
                        const y = py(place.y);
                        if (x < -20 || x > 1020 || y < -20 || y > 1020) return null;
                        const label = labelled.has(place.id);
                        return (
                            <g key={place.id} transform={`translate(${x} ${y})`}>
                                {place.kind === 'ship' && <path d="M0 -17 L12 13 L0 7 L-12 13 Z" transform={`rotate(${shipHeading})`} fill="#e8f6ff" stroke="#05121a" strokeWidth="2.5" />}
                                {place.kind === 'site' && <rect x="-5.5" y="-10" width="11" height="20" rx="1.5" fill={place.color} stroke="#05070b" strokeWidth="2" />}
                                {place.kind === 'obelisk' && <path d="M0 -15 L8 0 L0 15 L-8 0 Z" fill="#ffc85a" stroke="#05070b" strokeWidth="2" />}
                                {label && (
                                    <text y={place.kind === 'ship' ? 34 : 30} textAnchor="middle" className="surface-map__label">
                                        {place.kind === 'ship' ? 'Ship' : place.name}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                    {waypointAt && (
                        <g transform={`translate(${px(waypointAt.x)} ${py(waypointAt.y)})`}>
                            <path d="M0 0 C-7 -10 -13 -17 -13 -26 A13 13 0 1 1 13 -26 C13 -17 7 -10 0 0 Z" fill="#ffd35a" stroke="#2b1d00" strokeWidth="2.5" />
                            <circle cy="-26" r="4.5" fill="#2b1d00" />
                        </g>
                    )}
                    <g transform={`translate(${px(me.x)} ${py(me.y)})`}>
                        <circle r="20" fill="#58e1ff" fillOpacity="0.16" stroke="#58e1ff" strokeWidth="2" />
                        <path d="M0 -14 L9 10 L0 5 L-9 10 Z" transform={`rotate(${heading})`} fill="#58e1ff" stroke="#03141a" strokeWidth="2" />
                    </g>
                    {[shipAt && { at: shipAt, color: '#7fe3ff', text: 'Ship' }, waypointAt && { at: waypointAt, color: '#ffd35a', text: 'Waypoint' }].map((item) => {
                        if (!item) return null;
                        const e = edge(item.at.x, item.at.y);
                        if (!e) return null;
                        return (
                            <g key={item.text} transform={`translate(${e.x} ${e.y})`}>
                                <path d="M16 0 L-6 -10 L-1 0 L-6 10 Z" transform={`rotate(${e.angle})`} fill={item.color} stroke="#05070b" strokeWidth="2" />
                                <text y={e.y > 900 ? -18 : 30} textAnchor="middle" className="surface-map__label">{item.text}</text>
                            </g>
                        );
                    })}
                    <g transform="translate(944 58)">
                        <circle r="26" fill="#05070b" fillOpacity="0.55" stroke="#e8eef5" strokeOpacity="0.4" />
                        <path d="M0 -18 L7 4 L0 0 L-7 4 Z" fill="#ff7b6b" />
                        <path d="M0 18 L7 -4 L0 0 L-7 -4 Z" fill="#e8eef5" fillOpacity="0.7" />
                        <text y="-30" textAnchor="middle" className="surface-map__label">N</text>
                    </g>
                    <g transform="translate(36 952)">
                        <rect x="-8" y="-30" width={(scale / view.span) * 1000 + 16} height="44" rx="6" fill="#05070b" fillOpacity="0.55" />
                        <line x1="0" y1="0" x2={(scale / view.span) * 1000} y2="0" stroke="#e8eef5" strokeWidth="4" />
                        <line x1="0" y1="-7" x2="0" y2="7" stroke="#e8eef5" strokeWidth="3" />
                        <line x1={(scale / view.span) * 1000} y1="-7" x2={(scale / view.span) * 1000} y2="7" stroke="#e8eef5" strokeWidth="3" />
                        <text x="0" y="-12" className="surface-map__label surface-map__label--start">{formatMetres(scale)}</text>
                    </g>
                </svg>
                <div className="surface-map__tools">
                    <button type="button" onClick={() => zoom(1 / 1.6)} aria-label="Zoom in">+</button>
                    <button type="button" onClick={() => zoom(1.6)} aria-label="Zoom out">−</button>
                    <button type="button" onClick={() => { setFrame(makeFrame(body, player)); setView((v) => ({ ...v, cx: 0, cy: 0 })); }}>Me</button>
                    {shipAt && ship && <button type="button" onClick={() => show({ ...view, cx: shipAt.x, cy: shipAt.y })}>Ship</button>}
                </div>
            </div>
            <div className="surface-map__side">
                <section className="surface-map__here">
                    <small>You are here</small>
                    <strong>{body.name}</strong>
                    <span>{coordinates}</span>
                    <span>{walker ? 'On foot' : ship?.landed ? 'Landed' : `Flying · ${formatMetres(Math.max(0, runtime.altitude))} up`}</span>
                </section>
                {waypointAt && (
                    <section className="surface-map__waypoint">
                        <div>
                            <small>Waypoint</small>
                            <strong>{formatMetres(waypointDistance)} · {bearing(me.x, me.y, waypointAt.x, waypointAt.y).point}</strong>
                            <span>Follow the gold marker</span>
                        </div>
                        <button type="button" onClick={() => setTarget(null)}>Clear</button>
                    </section>
                )}
                <ul className="surface-map__places">
                    {listed.map(({ place, distance, way }) => {
                        const target = !!waypoint && waypoint.distanceTo(place.world) < 1;
                        return (
                            <li key={place.id}>
                                <button
                                    type="button"
                                    className={target ? 'is-target' : ''}
                                    aria-pressed={target}
                                    onClick={() => {
                                        setTarget(target ? null : place.world);
                                        setView((v) => ({ ...v, cx: place.x, cy: place.y, span: Math.max(v.span, Math.min(widest, distance * 2.6)) }));
                                    }}
                                    style={{ ['--place' as string]: place.color }}
                                >
                                    <i aria-hidden="true" className={`is-${place.kind}`} />
                                    <span>
                                        <b>{place.name}</b>
                                        <small>{place.detail}</small>
                                    </span>
                                    <em>{distance < 4 ? 'Here' : `${formatMetres(distance)} ${way.point}`}</em>
                                </button>
                            </li>
                        );
                    })}
                </ul>
                <p className="surface-map__hint">Click the ground or a place to set a waypoint; click the pin to clear it. Drag to pan, scroll to zoom.</p>
            </div>
        </div>
    );
};

/** Whether the surface map makes sense here: on or low over a world with ground. */
export const surfaceMapAvailable = (runtime: ExpeditionRuntime) =>
    !!runtime.currentBody && runtime.currentBody.kind === 'rocky' && runtime.altitude < 20000 && !!(runtime.hud.walker || runtime.hud.ship);
