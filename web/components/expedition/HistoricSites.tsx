import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { ContactShadows, type ContactShadowsHandle } from './ContactShadows';
import { groundHeight } from './environment';
import { HISTORIC_SITES, SAMPLE_TUBES, siteFrame, sitesOn, tubeId, type HistoricSite, type SiteFrame } from './history';
import { useModel, type ModelName, modelEnvironment } from './models';
import { cue, type ExpeditionRuntime } from './runtime';
import { glowTexture } from './Wreck';

/**
 * What the real missions left behind (history.ts): Eagle's descent stage at
 * Tranquility Base with the flag, seismometer and laser reflector round it;
 * Venera 13 on its landing ring; the ten sample tubes Perseverance laid at
 * Three Forks. Built from simple shapes at their real sizes, drawn only
 * within a few kilometres. Coming close finds a site (a card with its story);
 * at Three Forks, E picks up the tubes, and landing on Earth with all ten
 * brings the samples home.
 */
const SHOW_WITHIN = 2600;
const PICK_WITHIN = 2.2;

export const HistoricSites = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [id, setId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    const tick = useRef(0);
    useFrame(() => {
        let next: string | null = null;
        if (runtime.altitude < 4000) {
            for (const site of sitesOn(runtime.currentBody)) {
                if (siteFrame(site).centre.distanceTo(runtime.camera) < SHOW_WITHIN) next = site.id;
            }
        }
        if (next !== current.current) {
            current.current = next;
            setId(next);
            runtime.pickup = null;
        }
        // Mars Sample Return: all ten tubes, out of the ship on Earth.
        if ((tick.current = (tick.current + 1) % 30) === 0) {
            const visited = runtime.stats.visited;
            if (!visited.includes('samples-home') && runtime.mode === 'walk' && runtime.currentBody?.id === 'projects'
                && SAMPLE_TUBES.every((_, i) => visited.includes(tubeId(i)))) {
                visited.push('samples-home');
                cue(runtime, 'chapter', 0.9);
                runtime.scan.found = {
                    label: 'Mars Sample Return',
                    name: 'The Jezero samples, home',
                    blurb: 'Ten tubes from Jezero crater, on Earth: the first pieces of another planet anyone has fetched on purpose. Laboratories here can look for signs of ancient life in them far more closely than any rover can, and the witness tube tells them what came from Earth.',
                };
                runtime.scan.foundAt = performance.now() / 1000;
            }
        }
    });
    const site = id ? HISTORIC_SITES.find((s) => s.id === id) ?? null : null;
    return site ? <SiteView key={site.id} site={site} runtime={runtime} /> : null;
};

const toLocal = new THREE.Vector3();
const shadowGround = new THREE.Vector3();

const SiteView = ({ site, runtime }: { site: HistoricSite; runtime: ExpeditionRuntime }) => {
    const body = useMemo(() => findBody(site.body) as ExpeditionBody, [site]);
    const frame = useMemo(() => siteFrame(site), [site]);
    const groupRef = useRef<THREE.Group>(null);
    const shadows = useRef<ContactShadowsHandle>(null);
    const gl = useThree((state) => state.gl);
    const environment = useMemo(() => modelEnvironment(gl), [gl]);
    // Local axes: x east, y up, z south.
    const orientation = useMemo(() => new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(frame.east, frame.up, frame.north.clone().negate())), [frame]);
    const inverse = useMemo(() => orientation.clone().invert(), [orientation]);
    // Where the ground is under a local point, as a local height.
    const groundAt = useMemo(() => (x: number, z: number) => {
        const world = new THREE.Vector3(x, 0, z).applyQuaternion(orientation).add(frame.centre).sub(body.position).normalize();
        const point = body.position.clone().addScaledVector(world, body.radius + groundHeight(body, world));
        return point.sub(frame.centre).applyQuaternion(inverse).y;
    }, [orientation, inverse, frame, body]);
    const [picked, setPicked] = useState(() => SAMPLE_TUBES.map((_, i) => runtime.stats.visited.includes(tubeId(i))));
    // The Sun's bearing along the ground here (local axes), for the solar masts to face.
    const sunLocal = useMemo(() => {
        const local = body.sunDirection.clone().applyQuaternion(inverse);
        local.y = 0;
        return local.lengthSq() > 1e-8 ? local.normalize() : new THREE.Vector3(1, 0, 0);
    }, [body, inverse]);

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        group.position.copy(frame.centre).sub(runtime.origin);
        group.quaternion.copy(orientation);
        // Found: close enough to see it for what it is.
        if (!runtime.stats.visited.includes(site.id) && runtime.origin.distanceTo(frame.centre) < site.reach) {
            runtime.stats.visited.push(site.id);
            cue(runtime, 'chapter', 0.8);
            runtime.scan.found = { label: `${site.mission} · Discovery`, name: site.name, blurb: site.blurb };
            runtime.scan.foundAt = performance.now() / 1000;
        }
        // The tubes: one in reach on foot can be picked up (Player.tsx, E).
        if (frame.tubes.length) {
            const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
            let pickup: ExpeditionRuntime['pickup'] = null;
            let best = PICK_WITHIN;
            frame.tubes.forEach((at, i) => {
                if (runtime.stats.visited.includes(tubeId(i)) || !walker) return;
                const d = at.distanceTo(walker.position);
                if (d < best) {
                    best = d;
                    pickup = { index: i, position: at };
                }
            });
            runtime.pickup = pickup;
            const now = SAMPLE_TUBES.map((_, i) => runtime.stats.visited.includes(tubeId(i)));
            if (now.some((p, i) => p !== picked[i])) setPicked(now);
        }
        const casting = shadows.current;
        if (casting) {
            casting.begin();
            shadowGround.copy(frame.centre).sub(runtime.origin);
            if (site.id === 'apollo11') casting.add(shadowGround, frame.up, frame.east, 4.4, 4.4, 3.2);
            if (site.id === 'venera13') casting.add(shadowGround, frame.up, frame.east, 2.5, 2.5, 1.9);
            if (site.id === 'seed-vault') casting.add(shadowGround, frame.up, frame.east, 6, 16, 4);
            casting.end();
        }
    });
    useEffect(() => () => { runtime.pickup = null; }, [runtime]);

    return (
        <>
            <group ref={groupRef}>
                {site.id === 'apollo11' && <TranquilityBase groundAt={groundAt} environment={environment} />}
                {site.id === 'venera13' && <Venera groundAt={groundAt} environment={environment} />}
                {site.id === 'three-forks' && <SampleDepot frame={frame} inverse={inverse} picked={picked} environment={environment} />}
                {site.id === 'seed-vault' && <SeedVault groundAt={groundAt} environment={environment} />}
                {site.id === 'shackleton' && <SolarFarm groundAt={groundAt} environment={environment} sun={sunLocal} />}
            </group>
            <ContactShadows ref={shadows} body={body} runtime={runtime} capacity={2} />
        </>
    );
};

type GroundAt = (x: number, z: number) => number;

/** Thermal blanket: a solid whose faces are pushed about a little and lit flat, so it reads as crinkled foil. */
const crinkle = (geometry: THREE.BufferGeometry, amount: number, seed: number) => {
    const g = geometry.toNonIndexed();
    const position = g.getAttribute('position') as THREE.BufferAttribute;
    const p = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        p.fromBufferAttribute(position, i);
        const h = Math.sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719 + seed) * 43758.5453;
        const r = (h - Math.floor(h) - 0.5) * 2 * amount;
        position.setXYZ(i, p.x * (1 + r), p.y + r * 0.5, p.z * (1 + r));
    }
    g.computeVertexNormals();
    return g;
};

/** A round rod from a to b. */
const Strut = ({ a, b, radius, material }: { a: THREE.Vector3; b: THREE.Vector3; radius: number; material: THREE.Material }) => {
    const { position, quaternion, length } = useMemo(() => {
        const d = new THREE.Vector3().subVectors(b, a);
        return {
            position: a.clone().addScaledVector(d, 0.5),
            quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()),
            length: d.length(),
        };
    }, [a, b]);
    const geometry = useMemo(() => new THREE.CylinderGeometry(radius, radius, length, 8), [radius, length]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    return <mesh geometry={geometry} material={material} position={position} quaternion={quaternion} />;
};

const useMaterials = (environment: THREE.Texture) => {
    const materials = useMemo(() => ({
        gold: new THREE.MeshStandardMaterial({ color: '#c99a38', metalness: 0.85, roughness: 0.36, envMap: environment, envMapIntensity: 0.55, flatShading: true }),
        black: new THREE.MeshStandardMaterial({ color: '#141414', metalness: 0.3, roughness: 0.62, envMap: environment, envMapIntensity: 0.3, flatShading: true }),
        silver: new THREE.MeshStandardMaterial({ color: '#b6bbc1', metalness: 0.8, roughness: 0.32, envMap: environment, envMapIntensity: 0.6 }),
        deck: new THREE.MeshStandardMaterial({ color: '#3b3c3f', metalness: 0.4, roughness: 0.75 }),
        cells: new THREE.MeshStandardMaterial({ color: '#1b2948', metalness: 0.5, roughness: 0.3, envMap: environment, envMapIntensity: 0.5 }),
        pale: new THREE.MeshStandardMaterial({ color: '#cfcac0', metalness: 0.2, roughness: 0.7, envMap: environment, envMapIntensity: 0.25 }),
        grey: new THREE.MeshStandardMaterial({ color: '#7e8287', metalness: 0.6, roughness: 0.45, envMap: environment, envMapIntensity: 0.4 }),
    }), [environment]);
    useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);
    return materials;
};

/** The flag, bleached: what half a century of unfiltered sunlight probably left of its colours. */
const flagTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 190;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ece9e1';
    ctx.fillRect(0, 0, 190, 100);
    ctx.fillStyle = '#dcc9c2';
    for (let i = 0; i < 13; i += 2) ctx.fillRect(0, (i * 100) / 13, 190, 100 / 13);
    ctx.fillStyle = '#c9ccd6';
    ctx.fillRect(0, 0, 76, 54);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

/** The laser reflector: 100 fused-silica corner cubes in an aluminium panel. */
const reflectorTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#a7abb0';
    ctx.fillRect(0, 0, 80, 80);
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#1d2230' : '#262c3c';
            ctx.beginPath();
            ctx.arc(4 + x * 8, 4 + y * 8, 3.2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

/**
 * Eagle's descent stage (about 4.2 m across, its top 3.1 m up on four legs
 * whose pads stand 9 m apart), the front leg with its ladder facing west,
 * where the crew climbed down; round it what they set up and left.
 */
const TranquilityBase = ({ groundAt, environment }: { groundAt: GroundAt; environment: THREE.Texture }) => {
    const m = useMaterials(environment);
    const parts = useMemo(() => {
        const stage = crinkle(new THREE.CylinderGeometry(2.1, 2.1, 1.6, 8, 3, true).rotateY(Math.PI / 8), 0.018, 1);
        const blackBand = crinkle(new THREE.CylinderGeometry(2.14, 2.14, 0.34, 8, 1, true).rotateY(Math.PI / 8), 0.012, 2);
        const deck = new THREE.CylinderGeometry(2.1, 2.1, 0.12, 8).rotateY(Math.PI / 8);
        const bell = new THREE.CylinderGeometry(0.5, 0.78, 0.6, 20, 1, true);
        const pad = new THREE.CylinderGeometry(0.47, 0.42, 0.14, 20);
        const box = new THREE.BoxGeometry(1, 1, 1);
        const flag = new THREE.PlaneGeometry(1.52, 0.9);
        const panel = new THREE.PlaneGeometry(1, 1);
        return { stage, blackBand, deck, bell, pad, box, flag, panel };
    }, []);
    useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
    const flagMaterial = useMemo(() => new THREE.MeshStandardMaterial({ map: flagTexture(), roughness: 0.95, side: THREE.DoubleSide }), []);
    const reflector = useMemo(() => new THREE.MeshStandardMaterial({ map: reflectorTexture(), metalness: 0.6, roughness: 0.25, envMap: environment, envMapIntensity: 0.7 }), [environment]);
    useEffect(() => () => {
        flagMaterial.map?.dispose(); flagMaterial.dispose();
        reflector.map?.dispose(); reflector.dispose();
    }, [flagMaterial, reflector]);

    // Legs west (front, with the ladder), south, east and north.
    const legs = useMemo(() => [[-1, 0], [0, 1], [1, 0], [0, -1]].map(([dx, dz]) => {
        const x = dx * 4.5;
        const z = dz * 4.5;
        const foot = new THREE.Vector3(x, groundAt(x, z) + 0.1, z);
        const top = new THREE.Vector3(dx * 2.0, 2.9, dz * 2.0);
        const side = new THREE.Vector3(-dz, 0, dx);
        const knee = foot.clone().lerp(top, 0.45);
        const lowA = new THREE.Vector3(dx * 1.9, 1.55, dz * 1.9).addScaledVector(side, 1.3);
        const lowB = new THREE.Vector3(dx * 1.9, 1.55, dz * 1.9).addScaledVector(side, -1.3);
        return { dx, dz, foot, top, knee, lowA, lowB, side };
    }), [groundAt]);
    const front = legs[0];
    const rungs = useMemo(() => {
        const list: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
        const out = new THREE.Vector3(front.dx, 0, front.dz).multiplyScalar(0.18);
        for (let i = 1; i <= 9; i++) {
            const t = 0.1 + i * 0.085;
            const c = front.foot.clone().lerp(front.top, t).add(out);
            list.push({ a: c.clone().addScaledVector(front.side, 0.28), b: c.clone().addScaledVector(front.side, -0.28) });
        }
        return list;
    }, [front]);
    const rails = useMemo(() => [0.28, -0.28].map((s) => {
        const out = new THREE.Vector3(front.dx, 0, front.dz).multiplyScalar(0.18);
        return {
            a: front.foot.clone().lerp(front.top, 0.12).add(out).addScaledVector(front.side, s),
            b: front.foot.clone().lerp(front.top, 0.92).add(out).addScaledVector(front.side, s),
        };
    }), [front]);
    // What stands round it: the flag (blown over by the ascent engine) to the
    // south-west, the seismometer and laser reflector to the south, the TV
    // camera on its tripod to the north.
    const flagAt = useMemo(() => new THREE.Vector3(-6.5, groundAt(-6.5, 5) + 0.03, 5), [groundAt]);
    const psep = useMemo(() => new THREE.Vector3(1.5, groundAt(1.5, 16), 16), [groundAt]);
    const lrrr = useMemo(() => new THREE.Vector3(-2.2, groundAt(-2.2, 14), 14), [groundAt]);
    const camera = useMemo(() => new THREE.Vector3(-3, groundAt(-3, -17), -17), [groundAt]);

    return (
        <group>
            <mesh geometry={parts.stage} material={m.gold} position={[0, 2.3, 0]} />
            <mesh geometry={parts.blackBand} material={m.black} position={[0, 1.62, 0]} />
            <mesh geometry={parts.deck} material={m.deck} position={[0, 3.12, 0]} />
            {/* Where the ascent stage sat: its four fittings and the cut lines. */}
            {[[0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]].map(([x, z], i) => (
                <mesh key={i} geometry={parts.box} material={m.silver} position={[x, 3.24, z]} scale={[0.18, 0.12, 0.18]} />
            ))}
            <mesh geometry={parts.box} material={m.black} position={[0.4, 3.22, -0.6]} scale={[0.7, 0.1, 0.4]} />
            <mesh geometry={parts.bell} material={m.grey} position={[0, 1.2, 0]} />
            {/* The porch the crew stepped out onto, over the front leg. */}
            <mesh geometry={parts.box} material={m.silver} position={[-2.35, 3.05, 0]} scale={[0.7, 0.05, 0.9]} />
            {legs.map((leg, i) => (
                <group key={i}>
                    <Strut a={leg.top} b={leg.foot} radius={0.07} material={m.gold} />
                    <Strut a={leg.lowA} b={leg.knee} radius={0.045} material={m.silver} />
                    <Strut a={leg.lowB} b={leg.knee} radius={0.045} material={m.silver} />
                    <mesh geometry={parts.pad} material={m.gold} position={leg.foot} />
                </group>
            ))}
            {rails.map((rail, i) => <Strut key={`r${i}`} a={rail.a} b={rail.b} radius={0.022} material={m.silver} />)}
            {rungs.map((rung, i) => <Strut key={`g${i}`} a={rung.a} b={rung.b} radius={0.014} material={m.silver} />)}
            {/* The plaque, on the ladder's strut. */}
            <mesh geometry={parts.box} material={m.silver} position={front.foot.clone().lerp(front.top, 0.62).add(new THREE.Vector3(front.dx * 0.2, 0, 0))} scale={[0.02, 0.19, 0.23]} />

            {/* The flag, down in the dust beside its pole. */}
            <group position={flagAt} rotation={[0, 0.5, 0]}>
                <Strut a={new THREE.Vector3(-1.2, 0.03, 0)} b={new THREE.Vector3(1.2, 0.03, 0)} radius={0.016} material={m.silver} />
                <Strut a={new THREE.Vector3(0.45, 0.04, -0.05)} b={new THREE.Vector3(0.45, 0.04, 1.0)} radius={0.01} material={m.silver} />
                <mesh geometry={parts.flag} material={flagMaterial} position={[1.2 - 0.78, 0.035, 0.48]} rotation={[-Math.PI / 2, 0, 0.06]} />
            </group>
            {/* The Passive Seismic Experiment: a box on legs with two solar wings. */}
            <group position={psep}>
                <mesh geometry={parts.box} material={m.gold} position={[0, 0.42, 0]} scale={[0.55, 0.45, 0.42]} />
                <mesh geometry={parts.panel} material={m.cells} position={[-0.9, 0.62, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.2, 0.6, 1]} />
                <mesh geometry={parts.panel} material={m.cells} position={[0.9, 0.62, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[1.2, 0.6, 1]} />
                <mesh geometry={parts.box} material={m.silver} position={[0, 0.1, 0]} scale={[0.5, 0.2, 0.36]} />
            </group>
            {/* The laser ranging retroreflector, tilted to face Earth. */}
            <group position={lrrr}>
                <mesh geometry={parts.box} material={m.silver} position={[0, 0.12, 0]} scale={[0.5, 0.24, 0.4]} />
                <mesh geometry={parts.panel} material={reflector} position={[0, 0.34, 0]} rotation={[-Math.PI / 2 + 0.45, 0, 0]} scale={[0.46, 0.46, 1]} />
            </group>
            {/* The black-and-white TV camera, left on its tripod. */}
            <group position={camera}>
                <Strut a={new THREE.Vector3(0.35, 0, 0.2)} b={new THREE.Vector3(0, 1.3, 0)} radius={0.015} material={m.silver} />
                <Strut a={new THREE.Vector3(-0.35, 0, 0.2)} b={new THREE.Vector3(0, 1.3, 0)} radius={0.015} material={m.silver} />
                <Strut a={new THREE.Vector3(0, 0, -0.4)} b={new THREE.Vector3(0, 1.3, 0)} radius={0.015} material={m.silver} />
                <mesh geometry={parts.box} material={m.pale} position={[0, 1.42, 0]} scale={[0.27, 0.17, 0.42]} />
            </group>
        </group>
    );
};

/**
 * Venera 13: the pressure sphere (its instruments inside, kept cool for two
 * hours by a heat sink) on a crushable landing ring with teeth, under the
 * disc that braked its fall through the thick air, an antenna on top; the
 * lens cap it threw off lies beside it.
 */
const Venera = ({ groundAt, environment }: { groundAt: GroundAt; environment: THREE.Texture }) => {
    const m = useMaterials(environment);
    const base = useMemo(() => groundAt(0, 0), [groundAt]);
    const parts = useMemo(() => ({
        ring: new THREE.TorusGeometry(1.2, 0.17, 10, 40).rotateX(Math.PI / 2),
        tooth: new THREE.ConeGeometry(0.09, 0.22, 4),
        sphere: new THREE.SphereGeometry(0.52, 24, 16),
        disk: new THREE.CylinderGeometry(1.05, 1.05, 0.06, 40),
        rim: new THREE.TorusGeometry(1.05, 0.05, 8, 40).rotateX(Math.PI / 2),
        antenna: new THREE.CylinderGeometry(0.13, 0.13, 0.62, 16),
        dome: new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        port: new THREE.CylinderGeometry(0.07, 0.09, 0.22, 12),
        cap: new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    }), []);
    useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
    const teeth = useMemo(() => Array.from({ length: 24 }, (_, i) => (i / 24) * Math.PI * 2), []);
    const struts = useMemo(() => [0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k / 6) * Math.PI * 2;
        return { a: new THREE.Vector3(Math.cos(a) * 1.15, base + 0.25, Math.sin(a) * 1.15), b: new THREE.Vector3(Math.cos(a) * 0.38, base + 0.75, Math.sin(a) * 0.38) };
    }), [base]);
    const cap = useMemo(() => new THREE.Vector3(1.7, groundAt(1.7, 0.6), 0.6), [groundAt]);
    return (
        <group>
            <mesh geometry={parts.ring} material={m.grey} position={[0, base + 0.17, 0]} />
            {teeth.map((a, i) => (
                <mesh key={i} geometry={parts.tooth} material={m.grey} position={[Math.cos(a) * 1.2, base + 0.05, Math.sin(a) * 1.2]} rotation={[Math.PI, 0, 0]} />
            ))}
            {struts.map((s, i) => <Strut key={i} a={s.a} b={s.b} radius={0.04} material={m.grey} />)}
            <mesh geometry={parts.sphere} material={m.pale} position={[0, base + 1.0, 0]} />
            {[0, Math.PI].map((a, i) => (
                <mesh key={i} geometry={parts.port} material={m.black} position={[Math.cos(a) * 0.48, base + 0.78, Math.sin(a) * 0.48]} rotation={[0, -a, Math.PI / 2 + 0.5]} />
            ))}
            <Strut a={new THREE.Vector3(0, base + 1.45, 0)} b={new THREE.Vector3(0, base + 1.75, 0)} radius={0.12} material={m.grey} />
            <mesh geometry={parts.disk} material={m.pale} position={[0, base + 1.78, 0]} />
            <mesh geometry={parts.rim} material={m.grey} position={[0, base + 1.78, 0]} />
            <mesh geometry={parts.antenna} material={m.grey} position={[0, base + 2.12, 0]} />
            <mesh geometry={parts.dome} material={m.pale} position={[0, base + 2.43, 0]} />
            <mesh geometry={parts.cap} material={m.pale} position={cap} rotation={[0.3, 0, 2.7]} />
        </group>
    );
};

/**
 * The ten sample tubes: titanium, about 15 cm long (drawn a little larger,
 * to be found at all), each with a glint of sunlight on it.
 */
const SampleDepot = ({ frame, inverse, picked, environment }: { frame: SiteFrame; inverse: THREE.Quaternion; picked: boolean[]; environment: THREE.Texture }) => {
    const m = useMaterials(environment);
    const parts = useMemo(() => ({
        tube: new THREE.CylinderGeometry(0.028, 0.028, 0.26, 12).rotateZ(Math.PI / 2),
        seal: new THREE.CylinderGeometry(0.031, 0.031, 0.05, 12).rotateZ(Math.PI / 2),
    }), []);
    useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
    const glint = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: '#fff3dc', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }), []);
    useEffect(() => () => glint.dispose(), [glint]);
    const spots = useMemo(() => frame.tubes.map((at, i) => {
        toLocal.copy(at).sub(frame.centre).applyQuaternion(inverse);
        return { position: toLocal.clone().add(new THREE.Vector3(0, 0.03, 0)), turn: (i * 1.7) % Math.PI };
    }), [frame, inverse]);
    return (
        <group>
            {spots.map((spot, i) => picked[i] ? null : (
                <group key={i} position={spot.position} rotation={[0, spot.turn, 0]}>
                    <mesh geometry={parts.tube} material={m.silver} />
                    <mesh geometry={parts.seal} material={m.pale} position={[0.13, 0, 0]} />
                    <sprite material={glint} scale={[0.5, 0.5, 0.5]} position={[0, 0.06, 0]} />
                </group>
            ))}
        </group>
    );
};

/**
 * The Svalbard Global Seed Vault's way in: the concrete portal that juts out of the mountainside,
 * about 5 m wide and 27 m long, its roof and front lined with steel, mirrors and prisms (Dyveke
 * Sanne's "Perpetual Repercussion", lit turquoise and white in the polar night); the tunnel runs on
 * 120 m into the rock behind. Drawn here with the slope of Platåberget it is cut into.
 */
const PORTAL_FRONT = 9;
const PORTAL_BACK = 2.5;
const ROOF_SLOPE = Math.atan((PORTAL_FRONT - PORTAL_BACK) / 27);
/** The portal roof's height at a distance along it (local z, the door at -13.5). */
const roofAt = (z: number) => PORTAL_FRONT - ((z + 13.5) / 27) * (PORTAL_FRONT - PORTAL_BACK);

const SeedVault = ({ groundAt, environment }: { groundAt: GroundAt; environment: THREE.Texture }) => {
    const m = useMaterials(environment);
    const base = useMemo(() => Math.min(groundAt(0, 0), groundAt(0, -12), groundAt(0, 12)), [groundAt]);
    const parts = useMemo(() => {
        const box = new THREE.BoxGeometry(1, 1, 1);
        // The mountainside: a long rounded slope rising away from the door, rough enough to read as rock.
        const hill = crinkle(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), 0.035, 4);
        const tiles = new THREE.PlaneGeometry(1, 1);
        // The portal: a wedge, 9 m tall at the door, its roof running down 27 m into the hill.
        const profile = new THREE.Shape();
        profile.moveTo(13.5, -1);
        profile.lineTo(13.5, PORTAL_FRONT);
        profile.lineTo(-13.5, PORTAL_BACK);
        profile.lineTo(-13.5, -1);
        profile.closePath();
        const portal = new THREE.ExtrudeGeometry(profile, { depth: 5.2, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-2.6, 0, 0);
        return { box, hill, tiles, portal };
    }, []);
    useEffect(() => () => Object.values(parts).forEach((g) => g.dispose()), [parts]);
    const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8b8a86', roughness: 0.92, metalness: 0.05 }), []);
    const rock = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b655e', roughness: 1, flatShading: true }), []);
    // The artwork: a grid of small mirrors and prisms that still catch whatever light there is.
    const art = useMemo(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#1a2224';
        ctx.fillRect(0, 0, 64, 128);
        for (let y = 0; y < 32; y++) {
            for (let x = 0; x < 16; x++) {
                const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
                const r = h - Math.floor(h);
                ctx.fillStyle = r > 0.7 ? '#bfe9e6' : r > 0.35 ? '#5fa7a5' : '#2c4a4c';
                ctx.fillRect(x * 4 + 0.5, y * 4 + 0.5, 3, 3);
            }
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: '#7fd6d0', emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.25, envMap: environment, envMapIntensity: 0.8 });
    }, [environment]);
    useEffect(() => () => { concrete.dispose(); rock.dispose(); art.map?.dispose(); art.dispose(); }, [concrete, rock, art]);
    // The portal points north-west out of the slope (local x east, z south): door at the -z end.
    return (
        <group position={[0, base, 0]}>
            <mesh geometry={parts.hill} material={rock} position={[0, -3, 32]} scale={[26, 15, 22]} />
            <mesh geometry={parts.portal} material={concrete} />
            {/* The artwork over the door, and along the front of the roof. */}
            <mesh geometry={parts.tiles} material={art} position={[0, PORTAL_FRONT - 2, -13.53]} rotation={[0, Math.PI, 0]} scale={[5.0, 3.4, 1]} />
            <mesh geometry={parts.tiles} material={art} position={[0, roofAt(-8) + 0.04, -8]} rotation={[-Math.PI / 2 - ROOF_SLOPE, 0, 0]} scale={[5.0, 11.2, 1]} />
            {/* The steel door, and the step up to it. */}
            <mesh geometry={parts.box} material={m.grey} position={[0, 2.1, -13.56]} scale={[2.4, 4.2, 0.12]} />
            <mesh geometry={parts.box} material={m.black} position={[0, 2.1, -13.62]} scale={[0.04, 4.0, 0.02]} />
            <mesh geometry={parts.box} material={concrete} position={[0, 0.15, -14.6]} scale={[4, 0.3, 2]} />
            {/* Seed crates brought out and stacked by the door, ready for the ship. */}
            {[[-1.9, -15.6, 0], [-1.1, -15.9, 0.3], [-1.5, -15.7, 0], [1.7, -15.4, 0.2]].map(([x, z, turn], i) => (
                <mesh key={i} geometry={parts.box} material={i === 2 ? m.grey : m.pale} position={[x, i === 2 ? 0.95 : 0.32, z]} rotation={[0, turn, 0]} scale={[0.7, 0.62, 0.5]} />
            ))}
        </group>
    );
};

/**
 * A model for a site, centred over its middle and standing on y = 0, scaled to a height or a
 * width; its metal pointed at the site's reflections. Null while it loads.
 */
const useFitted = (name: ModelName, fit: { height?: number; width?: number }, environment: THREE.Texture) => {
    const gltf = useModel(name);
    return useMemo(() => {
        if (!gltf) return null;
        const root = gltf.scene.clone(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = fit.height ? fit.height / size.y : (fit.width ?? 1) / Math.max(size.x, size.z, 1e-3);
        root.scale.setScalar(scale);
        root.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
        root.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => {
                const standard = material as THREE.MeshStandardMaterial;
                if (!standard.isMeshStandardMaterial) return;
                standard.envMap = environment;
                standard.envMapIntensity = 0.5;
            });
        });
        const holder = new THREE.Group();
        holder.add(root);
        return holder;
    }, [gltf, environment, fit.height, fit.width]);
};

/**
 * The solar farm on Shackleton's rim: tall masts of vertical panels (like NASA's Vertical Solar
 * Array Technology towers, built for exactly this spot), turned to the low Sun that circles the
 * horizon here, cabled to the power station and the habitat of the last lunar base, a module
 * under a printed shell of regolith against the radiation. The masts and the habitat are sculpted
 * models; until they arrive, nothing stands in for them but the cables.
 */
const SolarFarm = ({ groundAt, environment, sun }: { groundAt: GroundAt; environment: THREE.Texture; sun: THREE.Vector3 }) => {
    const m = useMaterials(environment);
    const tower = useFitted('moonSolarTower', MAST_FIT, environment);
    const power = useFitted('moonPower', POWER_FIT, environment);
    const habitat = useFitted('moonHabitat', HABITAT_FIT, environment);
    // Panels face the Sun: their face normal along the ground towards it.
    const facing = useMemo(() => Math.atan2(sun.x, sun.z), [sun]);
    // Five masts in a shallow arc across the ridge, 14 m apart, each 18 m tall.
    const masts = useMemo(() => [-2, -1, 0, 1, 2].map((k) => {
        const along = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
        const x = along.x * k * 14 - sun.x * Math.abs(k) * 2;
        const z = along.z * k * 14 - sun.z * Math.abs(k) * 2;
        return { x, z, y: groundAt(x, z) };
    }), [facing, sun, groundAt]);
    const station = useMemo(() => {
        const x = -sun.x * 16;
        const z = -sun.z * 16;
        return { x, z, y: groundAt(x, z) };
    }, [sun, groundAt]);
    const hab = useMemo(() => {
        const x = -sun.x * 30 + sun.z * 10;
        const z = -sun.z * 30 - sun.x * 10;
        // Its shell sits a little into the ground, as regolith heaped on regolith would.
        return { x, z, y: Math.min(groundAt(x, z), groundAt(x + 5, z), groundAt(x - 5, z), groundAt(x, z + 5), groundAt(x, z - 5)) - 0.35 };
    }, [sun, groundAt]);
    const towers = useMemo(() => (tower ? masts.map(() => tower.clone(true)) : []), [tower, masts]);
    return (
        <group>
            {masts.map((mast, i) => (
                <group key={i} position={[mast.x, mast.y, mast.z]}>
                    {towers[i] && <primitive object={towers[i]} rotation={[0, facing + MAST_TURN, 0]} />}
                    {/* The cable to the station, along the ground. */}
                    <Strut a={new THREE.Vector3(0, 0.12, 0)} b={new THREE.Vector3(station.x - mast.x, station.y - mast.y + 0.12, station.z - mast.z)} radius={0.06} material={m.black} />
                </group>
            ))}
            {/* The power station: an insulated module on four feet, its radiators folded out. */}
            {power && (
                <group position={[station.x, station.y, station.z]} rotation={[0, facing, 0]}>
                    <primitive object={power} />
                </group>
            )}
            {/* The base's habitat, its airlock turned towards the station. */}
            {habitat && (
                <group position={[hab.x, hab.y, hab.z]} rotation={[0, Math.atan2(station.x - hab.x, station.z - hab.z) + HABITAT_TURN, 0]}>
                    <primitive object={habitat} />
                </group>
            )}
        </group>
    );
};
// The models' sizes on the Moon (metres), and the turn that points the panels' face (the mast
// model's) or the airlock (the habitat's) along +z.
const MAST_FIT = { height: 18.5 };
const POWER_FIT = { width: 6.8 };
const HABITAT_FIT = { width: 13 };
const MAST_TURN = 0;
const HABITAT_TURN = 0;
