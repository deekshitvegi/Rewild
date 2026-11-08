import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, startPosition, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { cue, type ExpeditionRuntime } from './runtime';
import { glowTexture } from './Wreck';

/**
 * Asteroids that fall: now and then, on the world the explorer is at, a rock comes down a few
 * kilometres away, as rocks do on every world (the Moon is hit by a metre-sized rock most hours;
 * Earth by a ten-metre one every decade or so). The ship's computer sees it coming a minute and a
 * half out and says where; in the last half minute it is in the sky, a fireball with a trail through
 * air, a bright point on an airless world. Then the flash, the fireball, the shockwave across the
 * ground and the dust; the sound later, if there is air to carry it. Too close is deadly. Its
 * crater stays (kept on this device), so it can be come back to.
 *
 * Not on gas giants (nothing to strike), not while the story is on Haven, and not more often than
 * every few minutes.
 */

/** Seconds from the warning to the strike, and how long before it the rock is in the sky. */
const WARNING = 90;
const VISIBLE = 28;
/** Seconds between one and the next, while the explorer is on a world (the first comes sooner). */
const QUIET: [number, number] = [300, 720];
const FIRST: [number, number] = [150, 260];
const KEY = 'rewild-craters';
const MAX_CRATERS = 48;

export interface Crater { body: string; direction: [number, number, number]; radius: number; at: number }

export interface IncomingImpact {
    body: string;
    /** Where it strikes (unit, the world's frame of the start) and the point on the ground. */
    direction: THREE.Vector3;
    point: THREE.Vector3;
    /** The way it comes in from (unit, pointing up and away along its path). */
    from: THREE.Vector3;
    radius: number;
    /** Game seconds (the impacts' own clock) of the warning and of the strike. */
    warned: number;
    at: number;
    struck: boolean;
}

const loadCraters = (): Crater[] => {
    try {
        const list = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Crater[];
        return Array.isArray(list) ? list.filter((c) => c && typeof c.body === 'string' && Array.isArray(c.direction)) : [];
    } catch {
        return [];
    }
};
const saveCraters = (list: Crater[]) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX_CRATERS)));
    } catch {
        // Kept for this visit only.
    }
};

const random = (range: [number, number]) => range[0] + Math.random() * (range[1] - range[0]);
const scratch = new THREE.Vector3();
const toPlayer = new THREE.Vector3();

/** A point on the ground of a world (its frame of the start: the world the explorer is on is there now). */
const groundAt = (body: ExpeditionBody, direction: THREE.Vector3, out: THREE.Vector3) =>
    out.copy(startPosition(body)).addScaledVector(direction, body.radius + groundHeight(body, direction));

/** Bearing words for the warning: "north-east". */
const bearingName = (body: ExpeditionBody, from: THREE.Vector3, to: THREE.Vector3) => {
    const up = from.clone().sub(startPosition(body)).normalize();
    const pole = new THREE.Vector3(0, 1, 0);
    const north = pole.addScaledVector(up, -pole.dot(up)).normalize();
    const east = new THREE.Vector3().crossVectors(north, up);
    const d = to.clone().sub(from);
    const angle = (THREE.MathUtils.radToDeg(Math.atan2(d.dot(east), d.dot(north))) + 360) % 360;
    return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(angle / 45) % 8];
};

/** Tests: ?impact=20 sends one at once, 20 seconds out (and anywhere in the story). */
const forced = (() => {
    try {
        const v = Number(new URLSearchParams(window.location.search).get('impact'));
        return Number.isFinite(v) && v > 0 ? Math.max(4, v) : 0;
    } catch {
        return 0;
    }
})();

export const Impacts = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [craters, setCraters] = useState<Crater[]>(loadCraters);
    const [incoming, setIncoming] = useState<IncomingImpact | null>(null);
    const schedule = useRef({ next: forced ? 2 : random(FIRST), clock: 0 });
    const live = useRef<IncomingImpact | null>(null);

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        const plan = schedule.current;
        plan.clock += dt;
        const body = runtime.currentBody;
        const onWorld = !!body && body.kind === 'rocky' && runtime.altitude < 15000 && !runtime.fall.active && !runtime.transit;
        const story = runtime.story.chapter;
        const impact = live.current;
        if (!impact) {
            if (!onWorld || (story === 'ten-years' && !forced) || runtime.menuOpen) return;
            plan.next -= dt;
            if (plan.next > 0) return;
            plan.next = random(QUIET);
            // A spot 1.5 to 6 km off along the ground (now and then nearer: 0.7 to 1.2 km).
            const from = runtime.mode === 'walk' && runtime.hud.walker ? runtime.hud.walker.position : runtime.camera;
            const up = scratch.copy(from).sub(startPosition(body)).normalize();
            const tangent = new THREE.Vector3(0, 1, 0).cross(up);
            if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
            tangent.normalize();
            const bitangent = new THREE.Vector3().crossVectors(up, tangent);
            const bearing = Math.random() * Math.PI * 2;
            const metres = forced ? 1400 : Math.random() < 0.15 ? random([700, 1200]) : random([1500, 6000]);
            const direction = up.clone().multiplyScalar(body.radius)
                .addScaledVector(tangent, Math.cos(bearing) * metres)
                .addScaledVector(bitangent, Math.sin(bearing) * metres)
                .normalize();
            const point = groundAt(body, direction, new THREE.Vector3());
            // In from 30 to 60 degrees above the horizon, from any side.
            const side = Math.random() * Math.PI * 2;
            const elevation = THREE.MathUtils.degToRad(random([30, 60]));
            const t2 = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
            const b2 = new THREE.Vector3().crossVectors(direction, t2);
            const along = t2.multiplyScalar(Math.cos(side)).addScaledVector(b2, Math.sin(side));
            const fromDir = direction.clone().multiplyScalar(Math.sin(elevation)).addScaledVector(along, Math.cos(elevation)).normalize();
            const next: IncomingImpact = { body: body.id, direction, point, from: fromDir, radius: random([18, 46]), warned: plan.clock, at: plan.clock + (forced || WARNING), struck: false };
            live.current = next;
            setIncoming(next);
            cue(runtime, 'notice', 1);
            return;
        }
        const left = impact.at - plan.clock;
        const target = findBody(impact.body);
        // Left the world before it struck: forgotten.
        if (!target || body?.id !== impact.body || runtime.altitude > 40000) {
            if (!impact.struck) {
                live.current = null;
                setIncoming(null);
                runtime.impact = null;
            }
        }
        const eye = runtime.mode === 'walk' && runtime.hud.walker ? runtime.hud.walker.position : runtime.camera;
        const distance = toPlayer.copy(impact.point).sub(eye).length();
        runtime.impact = impact.struck ? null : {
            seconds: Math.max(0, left),
            metres: distance,
            bearing: target ? bearingName(target, eye, impact.point) : '',
            point: impact.point,
        };
        if (!impact.struck && left <= 0) {
            impact.struck = true;
            const air = !!target?.biome && !target.biome.airless;
            // The blast, and what it does to anyone near.
            const hurtRange = impact.radius * 6;
            const deadly = impact.radius * 2.2;
            if (distance < hurtRange) {
                const harm = distance < deadly ? 1 : Math.pow(1 - (distance - deadly) / (hurtRange - deadly), 1.5) * 0.85;
                const walker = runtime.mode === 'walk' ? runtime.player?.walker.current : null;
                if (walker) {
                    walker.health = Math.max(0, walker.health - harm);
                    walker.hurtBy = 'a meteorite impact';
                    if (walker.health <= 0) walker.down = true;
                } else if (runtime.player?.ship && runtime.altitude < 2000) {
                    const ship = runtime.player.ship;
                    ship.shield = Math.max(0, ship.shield - harm);
                    ship.jolt = Math.max(ship.jolt, 1);
                }
            }
            // Felt at once in the ground; heard when the sound arrives, through air.
            const near = THREE.MathUtils.clamp(1 - distance / 12000, 0.15, 1);
            cue(runtime, 'impact', near);
            window.setTimeout(() => cue(runtime, 'explosion', air ? near : near * 0.4), air ? Math.min(9000, (distance / 343) * 1000) : 0);
            if (runtime.player?.ship) runtime.player.ship.jolt = Math.max(runtime.player.ship.jolt, 0.35 + 0.65 * near);
            const crater: Crater = { body: impact.body, direction: [impact.direction.x, impact.direction.y, impact.direction.z], radius: impact.radius, at: Date.now() };
            setCraters((list) => {
                const next = [...list, crater].slice(-MAX_CRATERS);
                saveCraters(next);
                return next;
            });
            if (!runtime.stats.visited.includes('impact-seen')) runtime.stats.visited.push('impact-seen');
            window.setTimeout(() => {
                if (live.current === impact) {
                    live.current = null;
                    setIncoming(null);
                }
            }, 14000);
        }
    });
    useEffect(() => () => { runtime.impact = null; }, [runtime]);

    const here = runtime.currentBody?.id;
    return (
        <>
            {incoming && <Strike key={`${incoming.body}-${incoming.at}`} impact={incoming} runtime={runtime} clock={schedule} />}
            {craters.filter((c) => c.body === here).map((c) => <CraterMark key={`${c.body}-${c.at}`} crater={c} runtime={runtime} />)}
        </>
    );
};

const additive = (color: string, opacity = 1) => new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity });

/** The rock coming in, and everything that happens when it lands. */
const Strike = ({ impact, runtime, clock }: { impact: IncomingImpact; runtime: ExpeditionRuntime; clock: MutableRefObject<{ clock: number }> }) => {
    const body = useMemo(() => findBody(impact.body) as ExpeditionBody, [impact]);
    const air = !!body.biome && !body.biome.airless;
    const head = useRef<THREE.Sprite>(null);
    const trail = useRef<THREE.Mesh>(null);
    const flash = useRef<THREE.Sprite>(null);
    const ball = useRef<THREE.Mesh>(null);
    const ring = useRef<THREE.Mesh>(null);
    const dust = useRef<THREE.Group>(null);
    const materials = useMemo(() => ({
        head: additive(air ? '#ffd7a0' : '#fff6e8'),
        // The flash lights the sky even where a hill hides the point itself.
        flash: Object.assign(additive('#fff1d6'), { depthTest: false }),
        trail: new THREE.MeshBasicMaterial({ color: '#ff9a4a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
        ball: new THREE.MeshBasicMaterial({ color: '#ffb060', transparent: true, opacity: 0.9, depthWrite: false }),
        ring: new THREE.MeshBasicMaterial({ color: '#d8c8b0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
        dust: new THREE.SpriteMaterial({ map: glowTexture(), color: body.biome?.palette?.[1] ?? '#8a7d6c', transparent: true, opacity: 0.5, depthWrite: false }),
    }), [air, body]);
    const geometry = useMemo(() => ({
        trail: new THREE.CylinderGeometry(0.15, 1, 1, 8, 1, true).translate(0, 0.5, 0),
        ball: new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        ring: new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
    }), []);
    useEffect(() => () => {
        Object.values(materials).forEach((m) => m.dispose());
        Object.values(geometry).forEach((g) => g.dispose());
    }, [materials, geometry]);
    // Plumes of dust: fixed puffs round the point, each rising and spreading at its own pace.
    const puffs = useMemo(() => Array.from({ length: 14 }, (_, i) => ({ angle: (i / 14) * Math.PI * 2 + Math.random() * 0.4, out: 0.3 + Math.random() * 0.9, rise: 0.4 + Math.random() * 1.2, size: 0.7 + Math.random() * 0.8 })), []);
    const up = useMemo(() => impact.direction.clone(), [impact]);
    const orient = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up), [up]);
    const trailTurn = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), impact.from), [impact]);
    const tangent = useMemo(() => {
        const t = new THREE.Vector3(0, 1, 0).cross(up);
        if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
        return t.normalize();
    }, [up]);
    const bitangent = useMemo(() => new THREE.Vector3().crossVectors(up, tangent), [up, tangent]);
    const at = new THREE.Vector3();

    useFrame(() => {
        const left = impact.at - clock.current.clock;
        const base = at.copy(impact.point).sub(runtime.origin);
        // Coming in: from 26 km out along its path down to the ground.
        const visible = Math.min(VISIBLE, (impact.at - impact.warned) * 0.8);
        const inSky = left > 0 && left < visible;
        if (head.current) {
            head.current.visible = inSky;
            if (inSky) {
                const fraction = left / visible;
                const range = 26000 * fraction * fraction;
                head.current.position.copy(base).addScaledVector(impact.from, range);
                const glow = air ? 1 - fraction * 0.7 : 0.6;
                const size = Math.max(16, range * 0.012) * (air ? 1.4 + glow * 2.5 : 1.2);
                head.current.scale.setScalar(size);
                materials.head.opacity = 0.5 + glow * 0.5;
            }
        }
        if (trail.current) {
            trail.current.visible = inSky && air;
            if (inSky && air) {
                const fraction = left / visible;
                const range = 26000 * fraction * fraction;
                const length = Math.min(9000, 600 + (1 - fraction) * 6000);
                trail.current.position.copy(base).addScaledVector(impact.from, range);
                trail.current.quaternion.copy(trailTurn);
                trail.current.scale.set(Math.max(8, range * 0.004), length, Math.max(8, range * 0.004));
                materials.trail.opacity = 0.25 + (1 - fraction) * 0.45;
            }
        }
        // After: the flash (a second and a half), the fireball (swelling, fading to smoke), the
        // shockwave across the ground (out at about 300 m/s), the dust rising and spreading.
        const since = -left;
        const R = impact.radius;
        if (flash.current) {
            flash.current.visible = since >= 0 && since < 1.6;
            if (flash.current.visible) {
                flash.current.position.copy(base).addScaledVector(up, R * 0.5);
                flash.current.scale.setScalar(R * (22 + since * 40));
                materials.flash.opacity = Math.max(0, 1 - since / 1.6);
            }
        }
        if (ball.current) {
            ball.current.visible = since >= 0 && since < 9;
            if (ball.current.visible) {
                ball.current.position.copy(base);
                ball.current.quaternion.copy(orient);
                ball.current.scale.setScalar(R * (2 + 5 * (1 - Math.exp(-since * 1.2))));
                const cool = THREE.MathUtils.smoothstep(since, 0.4, 5);
                materials.ball.color.setRGB(1 - cool * 0.62, 0.69 - cool * 0.33, 0.38 - cool * 0.08);
                materials.ball.opacity = 0.9 * (1 - THREE.MathUtils.smoothstep(since, 4, 9));
            }
        }
        if (ring.current) {
            ring.current.visible = since >= 0 && since < 6;
            if (ring.current.visible) {
                ring.current.position.copy(base).addScaledVector(up, 1.5);
                ring.current.quaternion.copy(orient);
                ring.current.scale.setScalar(R * 2 + since * 300);
                materials.ring.opacity = 0.55 * (1 - since / 6);
            }
        }
        if (dust.current) {
            dust.current.visible = since >= 0 && since < 14;
            if (dust.current.visible) {
                dust.current.children.forEach((child, i) => {
                    const p = puffs[i];
                    const grow = 1 - Math.exp(-since * 0.5);
                    const out = R * (1 + p.out * 5 * grow);
                    child.position.copy(base)
                        .addScaledVector(tangent, Math.cos(p.angle) * out)
                        .addScaledVector(bitangent, Math.sin(p.angle) * out)
                        .addScaledVector(up, R * (0.5 + p.rise * 9 * grow));
                    child.scale.setScalar(R * p.size * (3 + 8 * grow));
                });
                materials.dust.opacity = 0.55 * (1 - THREE.MathUtils.smoothstep(since, 6, 14)) * (air ? 1 : 0.6);
            }
        }
    });

    return (
        <>
            <sprite ref={head} name="impact-head" material={materials.head} visible={false} />
            <mesh ref={trail} geometry={geometry.trail} material={materials.trail} visible={false} frustumCulled={false} />
            <sprite ref={flash} name="impact-flash" material={materials.flash} visible={false} />
            <mesh ref={ball} geometry={geometry.ball} material={materials.ball} visible={false} frustumCulled={false} />
            <mesh ref={ring} geometry={geometry.ring} material={materials.ring} visible={false} frustumCulled={false} />
            <group ref={dust} visible={false}>
                {puffs.map((_, i) => <sprite key={i} material={materials.dust} />)}
            </group>
        </>
    );
};

/**
 * A crater left by an impact: the ground cannot be dug into (its height is worked out, not
 * stored), so the crater is drawn on it: a dark bowl, a raised lighter rim of thrown-out rock, and
 * rays of ejecta, laid over the ground's own shape.
 */
const CraterMark = ({ crater, runtime }: { crater: Crater; runtime: ExpeditionRuntime }) => {
    const body = useMemo(() => findBody(crater.body) as ExpeditionBody, [crater]);
    const mesh = useRef<THREE.Mesh>(null);
    const { geometry, centre } = useMemo(() => {
        const direction = new THREE.Vector3(...crater.direction).normalize();
        const centre = new THREE.Vector3();
        groundAt(body, direction, centre);
        const t = new THREE.Vector3(0, 1, 0).cross(direction);
        if (t.lengthSq() < 1e-6) t.set(1, 0, 0);
        t.normalize();
        const b = new THREE.Vector3().crossVectors(direction, t);
        const rings = 18;
        const spokes = 48;
        const outer = crater.radius * 3.2;
        const positions: number[] = [];
        const colors: number[] = [];
        const index: number[] = [];
        const ground = new THREE.Vector3();
        const dir = new THREE.Vector3();
        const rimColor = new THREE.Color(body.biome?.palette?.[2] ?? '#9a9080');
        const floorColor = new THREE.Color('#2a2622');
        const ejecta = new THREE.Color(body.biome?.palette?.[1] ?? '#857a6c');
        for (let r = 0; r <= rings; r++) {
            const f = r / rings;
            const radius = f * outer;
            for (let k = 0; k < spokes; k++) {
                const a = (k / spokes) * Math.PI * 2;
                dir.copy(direction).multiplyScalar(body.radius).addScaledVector(t, Math.cos(a) * radius).addScaledVector(b, Math.sin(a) * radius).normalize();
                groundAt(body, dir, ground);
                const x = radius / crater.radius;
                // The rim stands up just outside the bowl's edge.
                const rim = Math.exp(-((x - 1.05) ** 2) / 0.03) * crater.radius * 0.22;
                ground.addScaledVector(dir, 0.35 + rim).sub(centre);
                positions.push(ground.x, ground.y, ground.z);
                // Inside: the scorched floor; then the rim; then rays fading out.
                const rays = 0.5 + 0.5 * Math.cos(a * 9 + Math.sin(a * 5) * 1.5);
                const c = x < 0.95
                    ? floorColor.clone().lerp(rimColor, 0.25 * x)
                    : x < 1.3
                        ? rimColor.clone().lerp(ejecta, (x - 0.95) / 0.35)
                        : ejecta.clone().multiplyScalar(0.75 + 0.25 * rays);
                colors.push(c.r, c.g, c.b, x < 1.3 ? 1 : Math.max(0, 1 - (x - 1.3) / 1.9) * (0.35 + 0.65 * rays));
            }
        }
        for (let r = 0; r < rings; r++) {
            for (let k = 0; k < spokes; k++) {
                const a0 = r * spokes + k;
                const a1 = r * spokes + ((k + 1) % spokes);
                const b0 = a0 + spokes;
                const b1 = a1 + spokes;
                index.push(a0, b0, a1, a1, b0, b1);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
        geometry.setIndex(index);
        geometry.computeVertexNormals();
        return { geometry, centre };
    }, [crater, body]);
    const material = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), []);
    useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
    useFrame(() => {
        const m = mesh.current;
        if (!m) return;
        m.visible = centre.distanceTo(runtime.camera) < 9000;
        m.position.copy(centre).sub(runtime.origin);
    });
    return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={1} />;
};
