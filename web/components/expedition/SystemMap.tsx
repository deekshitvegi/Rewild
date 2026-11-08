import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AU, EXPEDITION_BODIES, THE_SUN, findBody, formatDistance } from './bodies';
import { DATA_SITES } from './sites';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import { useMapZoom } from './mapZoom';
import type { ExpeditionRuntime } from './runtime';
import { motionDate, toUniverse } from './motion';
import { changeWarp } from './MotionClock';
import { SurfaceMapView, surfaceMapAvailable } from './SurfaceMap';

/**
 * The maps (M). On or low over a world with ground, the surface map comes
 * first (SurfaceMap.tsx); anywhere, the system map: the Sun and every world
 * seen from above on their orbits, with each one's portfolio section, how
 * many of its data sites have been read, where the ship is and which way it
 * points. Distance from the Sun is drawn on a logarithmic scale, so Mercury
 * and Neptune both fit; "Near you" redraws the neighbourhood of the ship to
 * true scale. Picking a world sets a course to it (its marker is then
 * highlighted in flight); "Auto" also hands the flying to the autopilot.
 */
const VIEW = 1000;
const CENTRE = VIEW / 2;
// Radius on the map for a distance from the Sun (in AU).
const MAP_SCALE = 197;
const MAP_KNEE = 0.25;
const mapRadius = (au: number) => MAP_SCALE * Math.log10(1 + au / MAP_KNEE);
// Moons are drawn just outside their planet's dot, one step further out for each moon nearer in.
const MOON_GAP = 6;
const MOON_STEP = 5;
/** How big a world's dot is on the system map. */
const dotRadius = (radius: number) => 5 + Math.sqrt(radius / 12000) * 2.2;
// The asteroid belts (AU from the Sun), as hazards.ts thickens them.
const BELTS = [{ name: 'Main belt', from: 2.05, to: 3.35 }, { name: 'Kuiper belt', from: 30, to: 50 }];

interface Destination { id: string; name: string; label: string; color: string; position: THREE.Vector3; radius: number; sites: number; read: number }

const destinations = (read: ReadonlySet<string>): Destination[] => [
    ...EXPEDITION_BODIES.map((body) => {
        const sites = DATA_SITES.filter((s) => s.body === body);
        return {
            id: body.id,
            name: body.name,
            label: body.outsideSystem ? `${body.label} · through the wormhole` : body.kind === 'gas' && sites.length > 0 ? `${body.label} · orbital stations` : body.label,
            color: body.color,
            position: body.position,
            radius: body.radius,
            sites: sites.length,
            read: sites.filter((s) => read.has(s.id)).length,
        };
    }),
    { id: 'wormhole-saturn', name: 'Wormhole', label: 'Beside Saturn · leads to TON 618', color: '#a8d8ff', position: WORMHOLES[0].position, radius: WORMHOLES[0].radius, sites: 0, read: 0 },
    { id: BLACK_HOLE.id, name: BLACK_HOLE.name, label: 'Black hole · far outside the system', color: '#ffb05a', position: BLACK_HOLE.position, radius: BLACK_HOLE.horizon, sites: 0, read: 0 },
];

/** The universe's date and time, as the player's clock would show it. */
const formatDate = (date: Date) => date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A round number of units for distance rings. */
const niceUnits = (value: number) => {
    const power = 10 ** Math.floor(Math.log10(value));
    const n = value / power;
    return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
};

const forwardOf = (runtime: ExpeditionRuntime) => runtime.mode === 'walk' && runtime.hud.walker
    ? runtime.hud.walker.facing.clone()
    : new THREE.Vector3(0, 0, -1).applyQuaternion(runtime.hud.ship?.quaternion ?? new THREE.Quaternion());

const SystemMapView = ({ runtime, read, onClose }: {
    runtime: ExpeditionRuntime;
    read: ReadonlySet<string>;
    onClose: () => void;
}) => {
    const [scale, setScale] = useState<'system' | 'local'>('system');
    // Scroll to zoom where the pointer is, drag to pan, click a world to zoom in on it (mapZoom.ts).
    const systemZoom = useMapZoom(VIEW, VIEW / 80);
    const localZoom = useMapZoom(VIEW, VIEW / 40);
    const zoomer = scale === 'system' ? systemZoom : localZoom;
    // Lines, labels and dots are sized in screen pixels (the drawing's units were tuned for a map
    // about 600 px across): the same on a phone and a wide screen, and as the map zooms. Dots grow
    // a little when zoomed in, so a planet stays a planet among its moons.
    const z = zoomer.zoom;
    const unit = zoomer.perPixel;
    const sw = (width: number) => width * 0.6 * unit;
    const sr = (radius: number) => radius * 0.6 * unit * Math.pow(z, 0.3);
    const [course, setCourse] = useState(runtime.waypoint);
    const inShip = runtime.mode === 'ship';
    // The map is drawn in the Sun's frame (ecliptic north up), whichever world
    // the game's frame follows (motion.ts); it is redrawn as the worlds move.
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = window.setInterval(() => setTick((t) => t + 1), runtime.motion.warp > 1 ? 120 : 500);
        return () => window.clearInterval(timer);
    }, [runtime, runtime.motion.warp]);
    const uni = (v: THREE.Vector3) => toUniverse(runtime.motion, v, new THREE.Vector3());
    const player = uni(runtime.mode === 'walk' && runtime.hud.walker ? runtime.hud.walker.position : runtime.hud.ship?.position ?? runtime.origin);
    const forward = forwardOf(runtime).applyQuaternion(runtime.motion.M.clone().invert());
    const live = useMemo(() => destinations(read), [read]);
    const places = live.map((p) => ({ ...p, position: uni(p.position) }));
    const at = (id: string) => uni(findBody(id)!.position);
    const sun = uni(THE_SUN.position);

    // Seen from above (x and z), about the Sun.
    const layout = (() => {
        const project = (x: number, z: number) => {
            const dx = x - sun.x;
            const dz = z - sun.z;
            const r = Math.hypot(dx, dz);
            if (r < 1) return { x: CENTRE, y: CENTRE };
            const k = mapRadius(r / AU) / r;
            return { x: CENTRE + dx * k, y: CENTRE + dz * k };
        };
        /**
         * Where a body is drawn: a moon a little way off its planet, in the
         * direction it really lies, the moons in their order outwards.
         */
        const place = (id: string) => {
            const body = findBody(id)!;
            const where = at(body.id);
            if (!body.parent) return project(where.x, where.z);
            const host = findBody(body.parent)!;
            const hostAt = at(host.id);
            const p = project(hostAt.x, hostAt.z);
            const dx = where.x - hostAt.x;
            const dz = where.z - hostAt.z;
            const r = Math.hypot(dx, dz) || 1;
            const rank = EXPEDITION_BODIES.filter((b) => b.parent === host.id
                && b.position.distanceTo(host.position) < body.position.distanceTo(host.position)).length;
            const offset = dotRadius(host.radius) + MOON_GAP + rank * MOON_STEP;
            return { x: p.x + (dx / r) * offset, y: p.y + (dz / r) * offset };
        };
        return { project, place };
    })();

    const here = layout.project(player.x, player.z);
    // Exactly where you are: distance from the Sun, ecliptic longitude and latitude.
    const fromSun = player.clone().sub(sun);
    const sunDistance = fromSun.length();
    const longitude = (THREE.MathUtils.radToDeg(Math.atan2(-fromSun.z, fromSun.x)) + 360) % 360;
    const latitude = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(fromSun.y / Math.max(sunDistance, 1), -1, 1)));
    const nearest = places.slice(0, EXPEDITION_BODIES.length)
        .map((p) => ({ p, gap: Math.max(0, player.distanceTo(p.position) - p.radius) }))
        .sort((a, b) => a.gap - b.gap)[0];
    const heading = places
        .filter((p) => p.position.distanceTo(player) > p.radius * 1.5)
        .map((p) => ({ p, angle: forward.angleTo(p.position.clone().sub(player)) }))
        .sort((a, b) => a.angle - b.angle)[0];
    const headingAngle = THREE.MathUtils.radToDeg(Math.atan2(forward.z, forward.x));

    // Click a world: zoom in on it, wide enough to hold its moons.
    const zoomTo = (id: string) => {
        const body = findBody(id);
        if (!body) return;
        const p = layout.place(id);
        const moons = EXPEDITION_BODIES.filter((b) => b.parent === id).length;
        const reach = body.parent ? 22 : dotRadius(body.radius) + (moons ? MOON_GAP + moons * MOON_STEP : 12);
        systemZoom.focus(p.x, p.y, Math.min(VIEW, Math.max(VIEW / 70, reach * 5)));
    };

    // Marked worlds keep a marker in flight; everything else is left off the screen.
    const [marks, setMarks] = useState<string[]>(() => [...runtime.marks]);
    const toggleMark = useCallback((id: string) => {
        runtime.marks = runtime.marks.includes(id) ? runtime.marks.filter((m) => m !== id) : [...runtime.marks, id];
        setMarks(runtime.marks);
    }, [runtime]);

    const choose = useCallback((id: string, auto: boolean) => {
        const same = runtime.waypoint === id;
        runtime.waypoint = same && !auto ? null : id;
        runtime.autopilot = auto && inShip;
        setCourse(runtime.waypoint);
        if (auto || !same) onClose();
    }, [runtime, inShip, onClose]);

    // "Near you": true scale around the ship, wide enough to hold the nearest world and its moons.
    const local = useMemo(() => {
        const nearBody = findBody(nearest.p.id) ?? THE_SUN;
        const reach = Math.max(player.distanceTo(uni(nearBody.position)) * 2.6, nearBody.radius * 7);
        const span = THREE.MathUtils.clamp(reach, 20000, AU * 3);
        const k = VIEW / span;
        const px = (v: THREE.Vector3) => ({ x: CENTRE + (v.x - player.x) * k, y: CENTRE + (v.z - player.z) * k });
        return { span, k, px };
    }, [nearest.p.id, player]);

    const target = course ? places.find((p) => p.id === course) ?? null : null;
    const rings = [1, 2, 3].map((n) => niceUnits(local.span / 7) * n);

    return (
        <>
            <div className="expedition-map__position" aria-live="polite">
                <div><small>From the Sun</small><b>{(sunDistance / AU).toFixed(4)} AU</b></div>
                <div><small>Longitude</small><b>{longitude.toFixed(2)}°</b></div>
                <div><small>Latitude</small><b>{latitude >= 0 ? '+' : ''}{latitude.toFixed(3)}°</b></div>
                <div><small>Nearest</small><b>{runtime.currentBody && runtime.currentBody.id === nearest.p.id && runtime.altitude < 2000 ? `On ${nearest.p.name}` : `${nearest.p.name} · ${formatDistance(nearest.gap)}`}</b></div>
                <div><small>Heading</small><b>{heading && heading.angle < THREE.MathUtils.degToRad(12) ? `To ${heading.p.name}` : 'Open space'}</b></div>
                <div className="expedition-map__date"><small>Date</small><b>{formatDate(motionDate(runtime.motion))}</b></div>
            </div>
            <div className="expedition-map__body">
                <div className="expedition-map__chart">
                    <div className="expedition-map__tools">
                        <div className="expedition-map__scale" role="group" aria-label="Map scale">
                            <button type="button" aria-pressed={scale === 'system'} onClick={() => setScale('system')}>Whole system</button>
                            <button type="button" aria-pressed={scale === 'local'} onClick={() => setScale('local')}>Near you</button>
                        </div>
                        <div className="expedition-map__warp" role="group" aria-label="Time warp">
                            <button type="button" aria-label="Slower" onClick={() => { changeWarp(runtime, -1); setTick((t) => t + 1); }}>−<kbd>,</kbd></button>
                            <span>{runtime.motion.warp === 1 ? 'Real time' : `Time ×${runtime.motion.warp.toLocaleString('en-US')}`}</span>
                            <button type="button" aria-label="Faster" onClick={() => { changeWarp(runtime, 1); setTick((t) => t + 1); }}>+<kbd>.</kbd></button>
                        </div>
                    </div>
                    <div className="expedition-map__zoom" role="group" aria-label="Zoom">
                        <button type="button" onClick={() => zoomer.zoomBy(1 / 1.8)} aria-label="Zoom in">+</button>
                        <button type="button" onClick={() => zoomer.zoomBy(1.8)} aria-label="Zoom out">−</button>
                        <button type="button" onClick={() => zoomer.reset()}>{scale === 'system' ? 'All' : 'Fit'}</button>
                        {scale === 'system' && <button type="button" onClick={() => systemZoom.focus(here.x, here.y, VIEW / 8)}>Me</button>}
                    </div>
                    {scale === 'system' ? (
                        <svg ref={systemZoom.svgRef} viewBox={systemZoom.viewBox} {...systemZoom.handlers} className="is-zoomable" style={{ ['--unit' as string]: unit }} role="img" aria-label="The Sun, the worlds on their orbits and your ship, seen from above. Scroll to zoom, drag to move, click a world to zoom in on it.">
                            <defs>
                                <radialGradient id="expedition-map-sun">
                                    <stop offset="0" stopColor="#fff6d8" />
                                    <stop offset="0.4" stopColor="#ffd27a" stopOpacity="0.5" />
                                    <stop offset="1" stopColor="#ffb040" stopOpacity="0" />
                                </radialGradient>
                            </defs>
                            {EXPEDITION_BODIES.filter((body) => body.kind !== 'star' && !body.parent && !body.outsideSystem).map((body) => {
                                const r = mapRadius(body.position.distanceTo(THE_SUN.position) / AU);
                                return <circle key={`orbit-${body.id}`} cx={CENTRE} cy={CENTRE} r={r} fill="none" stroke="#9fb4d8" strokeOpacity="0.16" strokeWidth={sw(1.5)} />;
                            })}
                            {BELTS.map((belt) => {
                                const inner = mapRadius(belt.from);
                                const outer = mapRadius(belt.to);
                                const middle = (inner + outer) / 2;
                                // The label goes where no world is drawn near the ring.
                                const worlds = EXPEDITION_BODIES.filter((body) => body.kind !== 'star' && !body.parent && !body.outsideSystem).map((body) => layout.place(body.id));
                                let best = -Math.PI / 2;
                                let room = -1;
                                for (let k = 0; k < 24; k++) {
                                    const a = -Math.PI / 2 + (k / 24) * Math.PI * 2;
                                    const x = CENTRE + Math.cos(a) * middle;
                                    const y = CENTRE + Math.sin(a) * middle;
                                    const gap = Math.min(...worlds.map((w) => Math.hypot(w.x - x, w.y - y)), Math.hypot(here.x - x, here.y - y));
                                    if (gap > room + 20) { room = gap; best = a; }
                                }
                                return (
                                    <g key={belt.name} aria-hidden="true">
                                        <circle cx={CENTRE} cy={CENTRE} r={middle} fill="none" stroke="#c9b48f" strokeOpacity="0.1" strokeWidth={outer - inner} />
                                        <circle cx={CENTRE} cy={CENTRE} r={middle} fill="none" stroke="#e0cca6" strokeOpacity="0.4" strokeWidth={sw(2.5)} strokeDasharray={`${sw(1.5)} ${sw(7)}`} strokeLinecap="round" />
                                        <text x={CENTRE + Math.cos(best) * middle} y={CENTRE + Math.sin(best) * middle + 5} textAnchor="middle" className="expedition-map__belt">{belt.name}</text>
                                    </g>
                                );
                            })}
                            <circle cx={CENTRE} cy={CENTRE} r={sr(30)} fill="url(#expedition-map-sun)" />
                            <circle cx={CENTRE} cy={CENTRE} r={sr(7)} fill="#fff1c4" stroke={course === THE_SUN.id ? '#ffd35a' : 'none'} strokeWidth={sw(3)} />
                            {target && target.id !== BLACK_HOLE.id && (() => {
                                const to = findBody(target.id) ? layout.place(target.id) : layout.project(target.position.x, target.position.z);
                                return <line x1={here.x} y1={here.y} x2={to.x} y2={to.y} stroke="#ffd35a" strokeOpacity="0.7" strokeWidth={sw(2.5)} strokeDasharray={`${sw(10)} ${sw(8)}`} />;
                            })()}
                            {EXPEDITION_BODIES.filter((body) => body.kind !== 'star' && !body.outsideSystem).map((body) => {
                                const p = layout.place(body.id);
                                const r = sr(body.parent ? 3 : dotRadius(body.radius));
                                const current = runtime.currentBody === body;
                                const set = course === body.id;
                                // Moons are named once the map is zoomed in far enough to tell them apart.
                                const named = !body.parent || z >= 3.5;
                                return (
                                    <g key={body.id} className="expedition-map__world" onClick={() => { if (!systemZoom.dragged.current) zoomTo(body.id); }}>
                                        <title>{body.name}</title>
                                        {body.gas?.rings && <ellipse cx={p.x} cy={p.y} rx={r * 2.1} ry={r * 0.7} fill="none" stroke="#e6d7b8" strokeOpacity="0.55" strokeWidth={sw(2)} />}
                                        <circle cx={p.x} cy={p.y} r={r} fill={body.color} fillOpacity={current ? 1 : 0.85} stroke={set ? '#ffd35a' : current ? '#ffffff' : 'none'} strokeWidth={sw(3)} />
                                        {/* A wider invisible ring, so a small world is easy to click. */}
                                        <circle cx={p.x} cy={p.y} r={Math.max(r, sw(14))} fill="transparent" />
                                        {named && <text x={p.x} y={p.y + r + sw(body.parent ? 14 : 18)} textAnchor="middle" className={`expedition-map__label${body.parent ? ' expedition-map__label--moon' : ''}`}>{body.name}</text>}
                                    </g>
                                );
                            })}
                            {WORMHOLES.filter((w) => w.id === 'wormhole-saturn').map((w) => {
                                const wp = uni(w.position);
                                const p = layout.project(wp.x, wp.z);
                                return (
                                    <g key={w.id}>
                                        <circle cx={p.x} cy={p.y} r={sr(9)} fill="#050810" stroke="#a8d8ff" strokeWidth={sw(2)} strokeOpacity={course === w.id ? 1 : 0.7} />
                                        <circle cx={p.x} cy={p.y} r={sr(15)} fill="none" stroke="#a8d8ff" strokeOpacity="0.25" strokeWidth={sw(1)} />
                                    </g>
                                );
                            })}
                            {(() => {
                                // TON 618 lies far off this map: an arrow at the edge points to it.
                                const hole = uni(BLACK_HOLE.position);
                                const dx = hole.x;
                                const dz = hole.z;
                                const length = Math.hypot(dx, dz);
                                const ex = VIEW / 2 + (dx / length) * (VIEW / 2 - 40);
                                const ey = VIEW / 2 + (dz / length) * (VIEW / 2 - 40);
                                const angle = Math.atan2(dz, dx) * 180 / Math.PI;
                                return (
                                    <g transform={`translate(${ex} ${ey}) rotate(${angle})`}>
                                        <path d="M14 0 L-6 -9 L-2 0 L-6 9 Z" fill="#ffb05a" fillOpacity={course === BLACK_HOLE.id ? 1 : 0.75} />
                                    </g>
                                );
                            })()}
                            <g transform={`translate(${here.x} ${here.y}) scale(${unit * 0.75})`}>
                                <line x1="0" y1="0" x2={Math.cos(THREE.MathUtils.degToRad(headingAngle)) * 46} y2={Math.sin(THREE.MathUtils.degToRad(headingAngle)) * 46} stroke="#58e1ff" strokeWidth="2" strokeOpacity="0.8" />
                                <circle r="14" fill="none" stroke="#58e1ff" strokeWidth="2" strokeDasharray="4 4" />
                                <path d="M0 -9 L7 8 L0 4 L-7 8 Z" transform={`rotate(${headingAngle + 90})`} fill="#58e1ff" />
                            </g>
                        </svg>
                    ) : (
                        <svg ref={localZoom.svgRef} viewBox={localZoom.viewBox} {...localZoom.handlers} className="is-zoomable" style={{ ['--unit' as string]: unit }} role="img" aria-label="The worlds near your ship, to scale, seen from above. Scroll to zoom, drag to move.">
                            {rings.map((ring) => (
                                <g key={ring}>
                                    <circle cx={CENTRE} cy={CENTRE} r={ring * local.k} fill="none" stroke="#9fb4d8" strokeOpacity="0.18" strokeWidth={sw(1.5)} strokeDasharray={`${sw(3)} ${sw(6)}`} />
                                    <text x={CENTRE + ring * local.k * 0.7071 + 6} y={CENTRE - ring * local.k * 0.7071 - 6} className="expedition-map__label expedition-map__label--dim">{formatDistance(ring)}</text>
                                </g>
                            ))}
                            {places.map((p) => {
                                const at = local.px(p.position);
                                const r = Math.max(p.radius * local.k, sw(4));
                                if (at.x + r < 0 || at.x - r > VIEW || at.y + r < 0 || at.y - r > VIEW) return null;
                                return (
                                    <g key={p.id}>
                                        <circle cx={at.x} cy={at.y} r={r} fill={p.id === BLACK_HOLE.id || p.id.startsWith('wormhole') ? '#050810' : p.color} fillOpacity="0.9" stroke={course === p.id ? '#ffd35a' : p.id.startsWith('wormhole') ? '#a8d8ff' : 'none'} strokeWidth={sw(3)} />
                                        <text x={at.x} y={at.y + r + sw(20)} textAnchor="middle" className="expedition-map__label">{p.name}</text>
                                    </g>
                                );
                            })}
                            {target && (() => {
                                const to = local.px(target.position);
                                const dx = to.x - CENTRE;
                                const dy = to.y - CENTRE;
                                const length = Math.hypot(dx, dy) || 1;
                                const reach = Math.min(length, 470);
                                return <line x1={CENTRE} y1={CENTRE} x2={CENTRE + (dx / length) * reach} y2={CENTRE + (dy / length) * reach} stroke="#ffd35a" strokeOpacity="0.75" strokeWidth={sw(2.5)} strokeDasharray={`${sw(10)} ${sw(8)}`} />;
                            })()}
                            <g transform={`translate(${CENTRE} ${CENTRE}) scale(${unit * 0.75})`}>
                                <line x1="0" y1="0" x2={Math.cos(THREE.MathUtils.degToRad(headingAngle)) * 60} y2={Math.sin(THREE.MathUtils.degToRad(headingAngle)) * 60} stroke="#58e1ff" strokeWidth="2" strokeOpacity="0.8" />
                                <circle r="16" fill="none" stroke="#58e1ff" strokeWidth="2" strokeDasharray="4 4" />
                                <path d="M0 -10 L8 9 L0 5 L-8 9 Z" transform={`rotate(${headingAngle + 90})`} fill="#58e1ff" />
                            </g>
                        </svg>
                    )}
                </div>
                <ul className="expedition-map__list">
                    {places.map((place) => {
                        const distance = Math.max(0, player.distanceTo(place.position) - place.radius);
                        const set = course === place.id;
                        const body = findBody(place.id);
                        return (
                            <li key={place.id} className={`expedition-map__row${body?.parent ? ' is-moon' : ''}`}>
                                <button
                                    type="button"
                                    className={set ? 'is-course' : ''}
                                    aria-pressed={set}
                                    onClick={() => choose(place.id, false)}
                                    style={{ ['--world' as string]: place.color }}
                                >
                                    <i aria-hidden="true" />
                                    <span>
                                        <b>{place.name}</b>
                                        <small>{place.label}</small>
                                    </span>
                                    <em>
                                        {body && runtime.currentBody === body ? 'Here' : formatDistance(distance)}
                                        {place.sites > 0 && <small>{place.read}/{place.sites} sites</small>}
                                    </em>
                                </button>
                                <span className="expedition-map__actions">
                                    <button type="button" className={`expedition-map__mark${marks.includes(place.id) ? ' is-on' : ''}`} aria-pressed={marks.includes(place.id)} onClick={() => toggleMark(place.id)} aria-label={marks.includes(place.id) ? `Remove the marker from ${place.name}` : `Mark ${place.name}: keep its marker on screen`}>{marks.includes(place.id) ? 'Marked' : 'Mark'}</button>
                                    {inShip && !(body && runtime.currentBody === body && body.kind !== 'rocky') && (
                                        <button type="button" className="expedition-map__auto" onClick={() => choose(place.id, true)} aria-label={`Autopilot to ${place.name}`}>Auto</button>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>
            <p className="expedition-map__hint">
                {inShip
                    ? 'Scroll to zoom and drag to move the map; click a world to zoom in on it and its moons. Pick a world in the list to set a course (its marker stays gold until you arrive), or press Auto to let the autopilot fly you there. Mark keeps a world\'s marker on screen.'
                    : 'Pick a world to set a course, or Mark it to keep its marker on screen. Board your ship (E) to fly there or to use the autopilot.'}
            </p>
        </>
    );
};

/** The maps dialog: the surface map and the system map, one at a time. */
export const MapDialog = ({ runtime, read, onClose }: {
    runtime: ExpeditionRuntime;
    read: ReadonlySet<string>;
    onClose: () => void;
}) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    const surface = surfaceMapAvailable(runtime);
    const [tab, setTab] = useState<'surface' | 'system'>(surface ? 'surface' : 'system');

    useEffect(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' || event.code === 'KeyM') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            } else if (event.code === 'Tab' && surface && event.shiftKey === false && document.activeElement === document.body) {
                event.preventDefault();
                setTab((t) => (t === 'surface' ? 'system' : 'surface'));
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose, surface]);

    const body = runtime.currentBody;
    return (
        <div className="expedition-map" role="dialog" aria-modal="true" aria-labelledby="expedition-map-title">
            <div className={`expedition-map__panel${tab === 'surface' ? ' is-surface' : ''}`}>
                <header>
                    <div>
                        <small>{tab === 'surface' ? 'Surface map' : 'System map'}</small>
                        <h2 id="expedition-map-title">{tab === 'surface' && body ? `${body.name} · around you` : 'The Solar System'}</h2>
                    </div>
                    <div className="expedition-map__header-actions">
                        {surface && (
                            <div className="expedition-map__tabs" role="tablist" aria-label="Map">
                                <button type="button" role="tab" aria-selected={tab === 'surface'} onClick={() => setTab('surface')}>Surface</button>
                                <button type="button" role="tab" aria-selected={tab === 'system'} onClick={() => setTab('system')}>System</button>
                            </div>
                        )}
                        <button ref={closeRef} type="button" className="expedition-map__close" onClick={onClose}>Close <kbd>M</kbd></button>
                    </div>
                </header>
                {tab === 'surface' && surface
                    ? <SurfaceMapView runtime={runtime} read={read} />
                    : <SystemMapView runtime={runtime} read={read} onClose={onClose} />}
            </div>
        </div>
    );
};
