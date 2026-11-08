import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cue, type ExpeditionRuntime } from './runtime';
import { ALIEN_SITES, siteDirection, sitePosition, siteOn, type AlienSite, type LifeForm } from './aliens';
import { groundHeight } from './environment';
import { findBody, type ExpeditionBody } from './bodies';
import { Aeronauts, Europan, Gliders, Maker } from './AlienModels';
import { firstWordsFor } from './contact';

/**
 * The alien sites (aliens.ts), drawn when the explorer is near one, and the
 * scanner: look at a life form, on foot or from the ship, long enough to scan
 * it.
 *
 * Europa: a crack in the ice venting a plume of water vapour hundreds of
 * metres high, glittering blue near its base where it carries living cells,
 * and ice crawlers grazing round it. Titan: floaters drifting in the haze and
 * gliders circling over it. Mars: rocks split open on a green layer of life,
 * and stilt grazers picking over them. Venus: aeronauts between the cloud
 * decks. Triton: one of the Makers, and the frost hunters. (The walkers are
 * drawn and moved with the world's animals, Wildlife.tsx; the sculpted
 * fliers and the Maker in AlienModels.tsx.)
 */
const SHOW_WITHIN = 4000;

const up = new THREE.Vector3();
const tangent = new THREE.Vector3();
const bitangent = new THREE.Vector3();
const scratch = new THREE.Vector3();
const toLife = new THREE.Vector3();
const forward = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);

/** A frame at a site: its up, and two directions along the ground. */
const frameAt = (direction: THREE.Vector3) => {
    up.copy(direction);
    tangent.set(0, 1, 0).cross(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    bitangent.crossVectors(up, tangent).normalize();
};

/** A soft white puff: the vapour and the cells take their colour from their vertices, not from a tinted sprite. */
const puffTexture = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        texture = new THREE.CanvasTexture(canvas);
        return texture;
    };
})();

const random = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

/** Things to scan at the site: the life form, and where each specimen is (world units). */
interface Specimen { life: LifeForm; position: THREE.Vector3 }

export const Aliens = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [siteId, setSiteId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    const where = useMemo(() => new THREE.Vector3(), []);
    useFrame(() => {
        const site = siteOn(runtime.currentBody);
        let id: string | null = null;
        if (site && runtime.altitude < 6000) {
            sitePosition(site, where);
            if (where.distanceTo(runtime.origin) < SHOW_WITHIN) id = site.id;
        }
        if (id !== current.current) {
            current.current = id;
            setSiteId(id);
        }
    });
    const site = siteId ? ALIEN_SITES.find((s) => s.id === siteId) ?? null : null;
    return site ? <AlienSiteView key={site.id} site={site} runtime={runtime} /> : null;
};

const AlienSiteView = ({ site, runtime }: { site: AlienSite; runtime: ExpeditionRuntime }) => {
    const body = findBody(site.body) as ExpeditionBody;
    const centre = useMemo(() => sitePosition(site), [site]);
    const specimens = useRef<Specimen[]>([]);
    const scanning = useRef<{ life: LifeForm | null; time: number }>({ life: null, time: 0 });

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        // ---- The scanner -----------------------------------------------------------------
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const ship = runtime.hud.ship;
        let from: THREE.Vector3 | null = null;
        let range = 0;
        if (walker) {
            frameAt(scratch.copy(walker.position).sub(walker.body.position).normalize());
            forward.copy(walker.look).multiplyScalar(Math.cos(walker.pitch)).addScaledVector(up, Math.sin(walker.pitch)).normalize();
            from = scratch.copy(walker.position).addScaledVector(up, 1.5).clone();
            range = 60;
        } else if (ship && !ship.landed) {
            forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
            from = ship.position.clone();
            range = 700;
        }
        const pick: { best: Specimen | null; off: number } = { best: null, off: Infinity };
        const consider = (life: LifeForm, position: THREE.Vector3, eye: THREE.Vector3) => {
            toLife.copy(position).sub(eye);
            const distance = toLife.length();
            if (distance > range || distance < 0.5) return;
            const off = Math.acos(THREE.MathUtils.clamp(toLife.divideScalar(distance).dot(forward), -1, 1));
            // A wider cone close up: easy to point at what is right in front of you.
            if (off < Math.max(0.06, Math.atan2(4, distance)) && off < pick.off) {
                pick.off = off;
                pick.best = { life, position };
            }
        };
        if (from && !runtime.menuOpen && !runtime.sites.open) {
            for (const specimen of specimens.current) consider(specimen.life, specimen.position, from);
            // The site's animals walk about (Wildlife.tsx moves them).
            for (const animal of runtime.fauna.animals) if (animal.life) consider(animal.life, animal.position, from);
        }
        const best = pick.best;
        const scan = scanning.current;
        const known = best ? runtime.stats.aliens.includes(best.life.id) : false;
        if (best && !known) {
            if (scan.life !== best.life) {
                scan.life = best.life;
                scan.time = 0;
            }
            scan.time += dt;
            if (scan.time >= 1.6) {
                runtime.stats.aliens.push(best.life.id);
                runtime.scan.found = best.life;
                runtime.scan.foundAt = performance.now() / 1000;
                scan.life = null;
                scan.time = 0;
                cue(runtime, 'chapter', 1);
                if (ship) {
                    ship.notice = `FIRST CONTACT · ${best.life.name.toUpperCase()}`;
                    ship.noticeTime = performance.now() / 1000;
                }
            }
        } else {
            scan.time = Math.max(0, scan.time - dt * 2);
            if (scan.time === 0) scan.life = null;
        }
        // ---- Those who can answer (contact.ts): the nearest of them here ----
        const eye = walker ? walker.position : ship ? ship.position : null;
        let near: ExpeditionRuntime['contact']['near'] = null;
        if (eye) {
            for (const specimen of specimens.current) {
                if (!firstWordsFor(specimen.life)) continue;
                const distance = specimen.position.distanceTo(eye);
                if (!near || distance < near.distance) near = { site: site.id, life: specimen.life, position: specimen.position, distance };
            }
        }
        if (near && near.distance < 1500) runtime.contact.near = near;
        else if (runtime.contact.near?.site === site.id) runtime.contact.near = null;
        runtime.scan.life = scan.life ?? (best && known ? best.life : null);
        runtime.scan.progress = scan.life ? Math.min(1, scan.time / 1.6) : best && known ? 1 : 0;
    });

    const register = useCallback((list: Specimen[]) => {
        specimens.current = specimens.current.concat(list);
        if (import.meta.env.DEV) (window as unknown as { __specimens?: Specimen[] }).__specimens = specimens.current;
    }, []);
    useEffect(() => () => {
        specimens.current = [];
        runtime.scan.life = null;
        runtime.scan.progress = 0;
        if (runtime.contact.near?.site === site.id) runtime.contact.near = null;
    }, [runtime, site]);

    return (
        <>
            {site.life.map((life) => {
                const props = { body, site, centre, runtime, life, register };
                switch (life.kind) {
                    case 'plume': return <Plume key={life.id} {...props} />;
                    case 'floater': return <Floaters key={life.id} {...props} />;
                    case 'endolith': return <Endoliths key={life.id} {...props} />;
                    case 'glider': return <Gliders key={life.id} {...props} />;
                    case 'aeronaut': return <Aeronauts key={life.id} {...props} />;
                    case 'maker': return <Maker key={life.id} {...props} />;
                    case 'europan': return <Europan key={life.id} {...props} />;
                    // Walkers are drawn and moved with the world's animals (Wildlife.tsx).
                    default: return null;
                }
            })}
        </>
    );
};

interface PartProps {
    body: ExpeditionBody;
    site: AlienSite;
    centre: THREE.Vector3;
    runtime: ExpeditionRuntime;
    life: LifeForm;
    register: (list: Specimen[]) => void;
}

/** A point `along` metres in the site's tangent frame (x along the crack, z across), on the ground, raised `height`. */
const placeAt = (body: ExpeditionBody, site: AlienSite, x: number, z: number, height: number, out = new THREE.Vector3()) => {
    frameAt(siteDirection(site));
    out.copy(body.position).addScaledVector(up, body.radius).addScaledVector(tangent, x).addScaledVector(bitangent, z);
    const direction = scratch.copy(out).sub(body.position).normalize();
    return out.copy(body.position).addScaledVector(direction, body.radius + groundHeight(body, direction) + height);
};

// ---- Europa: the plume, and the life it carries -----------------------------------------------

const Plume = ({ body, site, centre, runtime, life, register }: PartProps) => {
    const count = [700, 1400, 2200][runtime.quality];
    const microbes = [160, 280, 420][runtime.quality];
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [count]);
    const cells = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(microbes * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(microbes * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [microbes]);
    const vapour = useMemo(() => new THREE.PointsMaterial({ map: puffTexture(), size: 9, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
    const glow = useMemo(() => new THREE.PointsMaterial({ map: puffTexture(), size: 1.1, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), []);
    const vent = useMemo(() => placeAt(body, site, 0, 0, 0), [body, site]);
    // The fissure the plume rises from, laid on the ice (it follows the ground, a few centimetres up):
    // a dark crack down its middle, salts from the ocean staining the ice reddish-brown either side
    // and fading out, as along Europa's real lineae.
    const crack = useMemo(() => {
        const ACROSS = [-7, -2.4, -0.5, 0, 0.5, 2.4, 7];
        const SHADE = [[0.55, 0.36, 0.24, 0], [0.5, 0.31, 0.2, 0.55], [0.18, 0.11, 0.08, 0.9], [0.08, 0.05, 0.04, 0.95], [0.18, 0.11, 0.08, 0.9], [0.5, 0.31, 0.2, 0.55], [0.55, 0.36, 0.24, 0]];
        const STEPS = 72;
        const positions: number[] = [];
        const colours: number[] = [];
        const indices: number[] = [];
        const point = new THREE.Vector3();
        for (let i = 0; i <= STEPS; i++) {
            const along = -72 + (i / STEPS) * 144;
            // It wanders a little, and pinches out at its ends.
            const wander = Math.sin(along * 0.05) * 3 + Math.sin(along * 0.17 + 1) * 0.8;
            const width = Math.min(1, (72 - Math.abs(along)) / 18);
            ACROSS.forEach((z, k) => {
                placeAt(body, site, along, wander + z * Math.max(width, 0.15), 0.06, point).sub(vent);
                positions.push(point.x, point.y, point.z);
                const [r, g, b, a] = SHADE[k];
                colours.push(r, g, b, a * width);
            });
        }
        const row = ACROSS.length;
        for (let i = 0; i < STEPS; i++) {
            for (let k = 0; k < row - 1; k++) {
                const a = i * row + k;
                indices.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 4));
        g.setIndex(indices);
        g.computeVertexNormals();
        return g;
    }, [body, site, vent]);
    const crackMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), []);
    const crackRef = useRef<THREE.Mesh>(null);
    const seeds = useMemo(() => {
        const r = random(7351);
        return {
            vapour: Array.from({ length: count }, () => ({ phase: r(), angle: r() * Math.PI * 2, spread: r(), life: 7 + r() * 6 })),
            cells: Array.from({ length: microbes }, () => ({ phase: r(), angle: r() * Math.PI * 2, radius: r(), height: r(), twinkle: r() * 6 })),
        };
    }, [count, microbes]);
    useEffect(() => {
        register([
            { life, position: vent.clone().addScaledVector(scratch.copy(vent).sub(body.position).normalize(), 18) },
            { life, position: vent.clone().addScaledVector(scratch.copy(vent).sub(body.position).normalize(), 45) },
        ]);
    }, [body, vent, life, register]);
    useEffect(() => () => {
        geometry.dispose();
        cells.dispose();
        vapour.dispose();
        glow.dispose();
        crack.dispose();
        crackMaterial.dispose();
    }, [geometry, cells, vapour, glow, crack, crackMaterial]);

    useFrame(({ clock }) => {
        const t = clock.elapsedTime;
        const ventUp = scratch.copy(vent).sub(body.position).normalize().clone();
        frameAt(ventUp);
        // Ice grains scatter light forwards: against the Sun the plume glows (as Enceladus's does).
        const against = Math.max(0, toLife.copy(vent).sub(runtime.camera).normalize().dot(body.sunDirection));
        const sunlit = Math.max(0.25, ventUp.dot(body.sunDirection) + 0.4) * (1 + 2.5 * against ** 6);
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        const colours = geometry.getAttribute('color') as THREE.BufferAttribute;
        seeds.vapour.forEach((p, i) => {
            const age = ((t / p.life) + p.phase) % 1;
            const height = 320 * Math.pow(age, 0.75);
            const reach = (3 + 70 * age) * p.spread;
            const x = vent.x - runtime.origin.x + tangent.x * Math.cos(p.angle) * reach + bitangent.x * Math.sin(p.angle) * reach + up.x * height;
            const y = vent.y - runtime.origin.y + tangent.y * Math.cos(p.angle) * reach + bitangent.y * Math.sin(p.angle) * reach + up.y * height;
            const z = vent.z - runtime.origin.z + tangent.z * Math.cos(p.angle) * reach + bitangent.z * Math.sin(p.angle) * reach + up.z * height;
            positions.setXYZ(i, x, y, z);
            const fade = Math.sin(Math.min(1, age * 6) * Math.PI / 2) * (1 - age) * 0.16 * sunlit;
            colours.setXYZ(i, fade, fade * 1.02, fade * 1.08);
        });
        positions.needsUpdate = true;
        colours.needsUpdate = true;
        const cellPositions = cells.getAttribute('position') as THREE.BufferAttribute;
        const cellColours = cells.getAttribute('color') as THREE.BufferAttribute;
        seeds.cells.forEach((c, i) => {
            const rise = ((t * 0.08 + c.phase) % 1) * 55 + c.height * 6;
            const reach = 1.5 + c.radius * (3 + rise * 0.25);
            const angle = c.angle + t * 0.2;
            cellPositions.setXYZ(i,
                vent.x - runtime.origin.x + tangent.x * Math.cos(angle) * reach + bitangent.x * Math.sin(angle) * reach + up.x * rise,
                vent.y - runtime.origin.y + tangent.y * Math.cos(angle) * reach + bitangent.y * Math.sin(angle) * reach + up.y * rise,
                vent.z - runtime.origin.z + tangent.z * Math.cos(angle) * reach + bitangent.z * Math.sin(angle) * reach + up.z * rise);
            const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + c.twinkle));
            cellColours.setXYZ(i, 0.2 * pulse, 0.85 * pulse, 1.4 * pulse);
        });
        cellPositions.needsUpdate = true;
        cellColours.needsUpdate = true;
        const crackMesh = crackRef.current;
        if (crackMesh) crackMesh.position.copy(vent).sub(runtime.origin);
    });
    return (
        <group>
            <points geometry={geometry} material={vapour} frustumCulled={false} />
            <points geometry={cells} material={glow} frustumCulled={false} />
            <mesh ref={crackRef} geometry={crack} material={crackMaterial} />
        </group>
    );
};

// ---- Titan: floaters ----------------------------------------------------------------------------

const floaterMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) } },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            vLocal = position;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vNormal = normalize(mat3(modelMatrix) * normal);
            vView = normalize(cameraPosition - world.xyz);
            gl_Position = projectionMatrix * viewMatrix * world;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uTime;
        uniform vec3 uSun;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            #include <logdepthbuf_fragment>
            vec3 N = normalize(vNormal);
            float facing = abs(dot(N, normalize(vView)));
            // A thin membrane: seen edge on it is thicker, so the rim is denser.
            float membrane = mix(0.85, 0.2, facing);
            // Veins running down from the crown.
            float veins = smoothstep(0.92, 1.0, abs(sin(atan(vLocal.z, vLocal.x) * 9.0 + vLocal.y * 2.0)));
            float lit = 0.35 + 0.65 * max(dot(N, uSun), 0.0);
            vec3 skin = mix(vec3(0.95, 0.78, 0.55), vec3(0.6, 0.35, 0.2), veins) * lit;
            // The band of light round the base, pulsing.
            float band = smoothstep(-0.25, -0.55, vLocal.y) * (0.6 + 0.4 * sin(uTime * 2.1 + vLocal.x * 3.0));
            vec3 colour = skin + vec3(0.25, 1.0, 0.75) * band * 1.4;
            gl_FragColor = vec4(colour, clamp(membrane + band * 0.5 + veins * 0.25, 0.0, 0.95));
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
        }`,
});

const Floaters = ({ body, site, centre, runtime, life, register }: PartProps) => {
    const count = [7, 11, 14][runtime.quality];
    const floaters = useMemo(() => {
        const r = random(8429);
        return Array.from({ length: count }, () => ({
            along: (r() - 0.5) * 520, across: (r() - 0.5) * 520, height: 14 + r() * 50, size: 2.4 + r() * 4.2,
            drift: 0.6 + r() * 1.2, phase: r() * Math.PI * 2, bob: 0.2 + r() * 0.3,
        }));
    }, [count]);
    const geometry = useMemo(() => new THREE.SphereGeometry(1, 24, 16).scale(1, 0.72, 1), []);
    const material = useMemo(() => floaterMaterial(), []);
    const filament = useMemo(() => new THREE.CylinderGeometry(0.035, 0.01, 1, 4).translate(0, -0.5, 0), []);
    const filamentMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.62, 0.4), transparent: true, opacity: 0.55, depthWrite: false }), []);
    const positions = useMemo(() => floaters.map(() => new THREE.Vector3()), [floaters]);
    useEffect(() => {
        register(positions.map((position) => ({ life, position })));
    }, [positions, life, register]);
    useEffect(() => () => { geometry.dispose(); material.dispose(); filament.dispose(); filamentMaterial.dispose(); }, [geometry, material, filament, filamentMaterial]);
    const refs = useRef<(THREE.Group | null)[]>([]);
    useFrame(({ clock }) => {
        const t = clock.elapsedTime;
        material.uniforms.uTime.value = t;
        material.uniforms.uSun.value.copy(body.sunDirection);
        floaters.forEach((f, n) => {
            // Drifting on the wind in slow loops round the site, bobbing.
            const along = f.along + Math.sin(t * 0.02 * f.drift + f.phase) * 60;
            const across = f.across + Math.cos(t * 0.017 * f.drift + f.phase) * 60;
            placeAt(body, site, along, across, f.height + Math.sin(t * f.bob + f.phase) * 2.5, positions[n]);
            const group = refs.current[n];
            if (!group) return;
            const localUp = scratch.copy(positions[n]).sub(body.position).normalize();
            group.position.copy(positions[n]).sub(runtime.origin);
            group.quaternion.setFromUnitVectors(yAxis, localUp);
            const breathe = 1 + Math.sin(t * 0.8 + f.phase) * 0.04;
            group.scale.set(f.size * breathe, f.size / breathe, f.size * breathe);
        });
    });
    void centre;
    return (
        <>
            {floaters.map((f, n) => (
                <group key={n} ref={(g) => { refs.current[n] = g; }}>
                    <mesh geometry={geometry} material={material} renderOrder={2} />
                    {Array.from({ length: 8 }, (_, k) => (
                        <mesh key={k} geometry={filament} material={filamentMaterial}
                            position={[Math.cos(k * 0.785) * 0.45, -0.55, Math.sin(k * 0.785) * 0.45]}
                            scale={[1, 1.2 + ((k * 7 + n) % 5) * 0.35, 1]} rotation={[Math.sin(k + n) * 0.12, 0, Math.cos(k + n) * 0.12]} />
                    ))}
                </group>
            ))}
        </>
    );
};

// ---- Mars: life inside the rock ------------------------------------------------------------------

/** The face of a split rock: pale stone inside, a band of green life just under the weathered crust. */
const splitFaceTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const ring = (radius: number, colour: string) => {
        ctx.beginPath();
        ctx.arc(64, 64, radius, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
    };
    ring(64, '#6e3a22');
    ring(58, '#3f8a46');
    ring(51, '#6fae5a');
    ring(46, '#dcc0a0');
    // Grain in the stone.
    for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 44;
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(160,110,80,0.35)' : 'rgba(250,230,205,0.4)';
        ctx.fillRect(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 1.5, 1.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

const Endoliths = ({ body, site, runtime, life, register }: PartProps) => {
    const rocks = useMemo(() => {
        const r = random(3413);
        return Array.from({ length: 9 }, () => ({ along: (r() - 0.5) * 22, across: (r() - 0.5) * 22, size: 0.3 + r() * 0.45, turn: r() * Math.PI * 2, gap: 0.14 + r() * 0.22, tip: (r() - 0.5) * 0.5 }));
    }, []);
    const half = useMemo(() => {
        // Half of a weathered rock: the flat face is where it split. Shared vertices, so it shades smooth.
        const g = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'));
        const p = g.getAttribute('position') as THREE.BufferAttribute;
        const v = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
            v.fromBufferAttribute(p, i);
            const bump = 1 + Math.sin(v.x * 4.1) * 0.06 + Math.sin(v.y * 5.3 + 1) * 0.05 + Math.sin(v.z * 3.7 + 2) * 0.07;
            v.multiplyScalar(bump);
            v.x = Math.max(v.x, 0);
            p.setXYZ(i, v.x, v.y * 0.78, v.z);
        }
        g.computeVertexNormals();
        return g;
    }, []);
    const palette = body.biome?.palette ?? ['#9a5a3a', '#9a5a3a', '#9a5a3a', '#9a5a3a', '#9a5a3a'];
    const rockMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: new THREE.Color(palette[1]).lerp(new THREE.Color(palette[3]), 0.25), roughness: 0.92, metalness: 0 }), [palette]);
    const faceTexture = useMemo(() => splitFaceTexture(), []);
    const face = useMemo(() => new THREE.CircleGeometry(0.97, 28).rotateY(Math.PI / 2), []);
    const faceMaterial = useMemo(() => new THREE.MeshStandardMaterial({ map: faceTexture, roughness: 0.85, emissive: '#1e3a1e', emissiveIntensity: 0.25, emissiveMap: faceTexture, side: THREE.DoubleSide }), [faceTexture]);
    const placed = useMemo(() => rocks.map((rock) => placeAt(body, site, rock.along, rock.across, rock.size * 0.3)), [rocks, body, site]);
    useEffect(() => { register(placed.map((position) => ({ life, position }))); }, [placed, life, register]);
    useEffect(() => () => { half.dispose(); rockMaterial.dispose(); face.dispose(); faceMaterial.dispose(); faceTexture.dispose(); }, [half, rockMaterial, face, faceMaterial, faceTexture]);
    const refs = useRef<(THREE.Group | null)[]>([]);
    useFrame(() => {
        placed.forEach((position, n) => {
            const group = refs.current[n];
            if (!group) return;
            group.position.copy(position).sub(runtime.origin);
            group.quaternion.setFromUnitVectors(yAxis, scratch.copy(position).sub(body.position).normalize()).multiply(quaternion.setFromAxisAngle(yAxis, rocks[n].turn));
        });
    });
    return (
        <>
            {rocks.map((rock, n) => (
                <group key={n} ref={(g) => { refs.current[n] = g; }} scale={rock.size}>
                    {/* The two halves, fallen apart, their split faces showing the green band. */}
                    <group position={[rock.gap, 0, 0]} rotation={[0, 0, -0.25 + rock.tip]}>
                        <mesh geometry={half} material={rockMaterial} />
                        <mesh geometry={face} material={faceMaterial} position={[-0.005, 0, 0]} scale={[1, 0.78, 1]} />
                    </group>
                    <group position={[-rock.gap, 0, 0]} rotation={[0, Math.PI, 0.25 - rock.tip]}>
                        <mesh geometry={half} material={rockMaterial} />
                        <mesh geometry={face} material={faceMaterial} position={[-0.005, 0, 0]} scale={[1, 0.78, 1]} />
                    </group>
                </group>
            ))}
        </>
    );
};
