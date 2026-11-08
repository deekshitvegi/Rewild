import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { ECLIPTIC_NORTH } from './orbits';
import { globeFrame } from './sites';
import { orientationOf } from './motion';
import type { ExpeditionRuntime } from './runtime';

/**
 * The compass along the top of the screen, as in most open-world games: the way the camera looks,
 * with north, east, south and west on it, and a mark for the ship, the waypoint and the course at
 * their bearings, each with its distance. Turn until the mark is in the middle and walk.
 *
 * On (or low over) a world with ground only: in space there is no north. It is moved on every
 * frame by writing transforms, without React, so it turns as smoothly as the view.
 */
const SPAN = 120;
const TICKS = Array.from({ length: 24 }, (_, i) => i * 15);
const LETTER: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

interface Mark { id: string; label: string; colour: string }
const MARKS: Mark[] = [
    { id: 'ship', label: 'Ship', colour: '#7fe3ff' },
    { id: 'waypoint', label: 'Waypoint', colour: '#ffd35a' },
    { id: 'camp', label: 'Camp', colour: '#ff9a5a' },
    { id: 'course', label: 'Course', colour: '#ffb547' },
];

const formatDistance = (metres: number) => metres >= 1000 ? `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km` : `${Math.round(metres)} m`;

const poles = new Map<string, THREE.Vector3>();
/** The world's north pole in its own starting frame (its real one where it has a globe). */
const poleOf = (body: ExpeditionBody) => {
    let pole = poles.get(body.id);
    if (!pole) {
        const globe = body.globe ? globeFrame(body) : null;
        pole = globe ? new THREE.Vector3(globe.elements[1], globe.elements[4], globe.elements[7]).normalize() : ECLIPTIC_NORTH.clone();
        poles.set(body.id, pole);
    }
    return pole;
};

const up = new THREE.Vector3();
const north = new THREE.Vector3();
const east = new THREE.Vector3();
const look = new THREE.Vector3();
const to = new THREE.Vector3();

/** Bearing in degrees (0 north, 90 east) of a direction flattened onto the ground plane. */
const bearingOf = (direction: THREE.Vector3) => {
    const x = direction.dot(east);
    const y = direction.dot(north);
    return (THREE.MathUtils.radToDeg(Math.atan2(x, y)) + 360) % 360;
};
const wrap = (degrees: number) => ((degrees + 540) % 360) - 180;

export const Compass = ({ runtime, coarse }: { runtime: ExpeditionRuntime; coarse: boolean }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const markRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const headingRef = useRef<HTMLElement>(null);

    useEffect(() => {
        let frame = 0;
        const tick = () => {
            frame = requestAnimationFrame(tick);
            const root = rootRef.current;
            const track = trackRef.current;
            const camera = runtime.view.camera;
            const body = runtime.currentBody;
            const near = !!body && body.kind === 'rocky' && runtime.altitude < 20000 && !runtime.menuOpen && !runtime.fall.active;
            if (!root || !track || !camera || !near || !body) {
                if (root && root.dataset.on !== '0') root.dataset.on = '0';
                return;
            }
            if (root.dataset.on !== '1') root.dataset.on = '1';
            const width = root.clientWidth || 1;
            const perDegree = width / SPAN;

            up.copy(runtime.camera).sub(body.position).normalize();
            north.copy(poleOf(body)).applyQuaternion(orientationOf(runtime.motion, body));
            north.addScaledVector(up, -north.dot(up));
            if (north.lengthSq() < 1e-8) north.set(1, 0, 0).addScaledVector(up, -up.x);
            north.normalize();
            east.crossVectors(north, up).normalize();
            camera.getWorldDirection(look);
            look.addScaledVector(up, -look.dot(up));
            // Looking straight up or down: keep the last heading.
            if (look.lengthSq() < 1e-6) return;
            const heading = bearingOf(look.normalize());
            // The track holds the ticks for 0-360 three times over; centre the heading on it.
            track.style.transform = `translate3d(${(width / 2 - (heading + 360) * perDegree).toFixed(1)}px, 0, 0)`;
            if (headingRef.current) headingRef.current.textContent = `${Math.round(heading) % 360}°`;

            const from = runtime.mode === 'walk' && runtime.hud.walker ? runtime.hud.walker.position : runtime.hud.ship?.position ?? runtime.camera;
            const ship = runtime.hud.ship;
            const course = runtime.waypoint ? findBody(runtime.waypoint) : null;
            const places: Record<string, THREE.Vector3 | null> = {
                ship: runtime.mode === 'walk' && ship ? ship.position : null,
                waypoint: runtime.surfaceWaypoint,
                camp: runtime.camp && runtime.camp.body === body ? runtime.camp.position : null,
                course: course && course !== body ? course.position : null,
            };
            for (const mark of MARKS) {
                const element = markRefs.current[mark.id];
                if (!element) continue;
                const at = places[mark.id];
                const distance = at ? at.distanceTo(from) : 0;
                if (!at || (mark.id !== 'course' && distance < 6)) {
                    if (element.dataset.on !== '0') element.dataset.on = '0';
                    continue;
                }
                to.copy(at).sub(from);
                to.addScaledVector(up, -to.dot(up));
                if (to.lengthSq() < 1e-6) continue;
                const off = wrap(bearingOf(to.normalize()) - heading);
                const edge = Math.abs(off) > SPAN / 2 - 4;
                const x = width / 2 + THREE.MathUtils.clamp(off, -SPAN / 2 + 4, SPAN / 2 - 4) * perDegree;
                element.dataset.on = '1';
                element.dataset.edge = edge ? (off < 0 ? 'left' : 'right') : '';
                element.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`;
                const label = element.lastElementChild as HTMLElement | null;
                if (label) label.textContent = mark.id === 'course' ? (course?.name ?? '') : formatDistance(distance);
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [runtime]);

    return (
        <div ref={rootRef} className={`expedition-compass${coarse ? ' is-coarse' : ''}`} data-on="0" aria-hidden="true" data-hud-panel>
            <div className="expedition-compass__window">
                <div className="expedition-compass__ticks">
                <div ref={trackRef} className="expedition-compass__track">
                    {[0, 1, 2].flatMap((lap) => TICKS.map((degrees) => (
                        <span
                            key={`${lap}-${degrees}`}
                            className={LETTER[degrees] ? (degrees % 90 === 0 ? 'is-cardinal' : 'is-letter') : 'is-tick'}
                            style={{ left: `calc(${(lap * 360 + degrees) / SPAN} * var(--compass-width))` }}
                        >
                            {LETTER[degrees] ?? ''}
                        </span>
                    )))}
                </div>
                </div>
                {MARKS.map((mark) => (
                    <div key={mark.id} ref={(element) => { markRefs.current[mark.id] = element; }} className={`expedition-compass__mark is-${mark.id}`} data-on="0" style={{ ['--mark' as string]: mark.colour }}>
                        <i />
                        <small />
                    </div>
                ))}
            </div>
            <b ref={headingRef} className="expedition-compass__heading" />
        </div>
    );
};
