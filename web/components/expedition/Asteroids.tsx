import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EXPEDITION_BODIES } from './bodies';
import { hash3, hashToUnit, NOISE_OFFSET, gnoise } from './noise';
import type { ExpeditionInput } from './input';
import { cue, type ExpeditionRuntime } from './runtime';
import { beltAt, beltDensity, fieldDensity, SUN, type AsteroidField } from './hazards';
import { useModel } from './models';
import { glowTexture } from './Wreck';

/**
 * Asteroids. Space between the worlds is mostly empty, but not everywhere:
 * the main belt between Mars and Jupiter, the Kuiper belt beyond Neptune,
 * and a thin cloud of debris above each world with ground hold rocks from
 * boulders to small hills, each tumbling slowly. Crossing a belt on the
 * pulse drive can pull the ship out into a dense cluster (flight.ts), thick
 * enough that flying fast through it is a gamble: hitting a rock costs shield
 * in proportion to the speed of the hit. Hold click with one ahead and the
 * ship's mining laser cuts it apart for crystals.
 *
 * Near rocks are the sculpted boulder, stretched and turned so no two look
 * alike; distant ones are cheaper lumpy spheres in the same colours.
 */
export const ASTEROID_CELL = 5000;
const REACH = 24000;
/** Cells of a dense cluster, and how far around the ship its rocks are drawn. */
const FIELD_CELL = 420;
const FIELD_REACH = 2600;
const NEAR = 1100;
const NEAR_MAX = 220;
const VARIANTS = 4;
const LIMIT = [320, 650, 900] as const;

export interface Asteroid {
    id: string;
    position: THREE.Vector3;
    radius: number;
    /** Stretch along its own axes, so one model makes many shapes. */
    shape: THREE.Vector3;
    axis: THREE.Vector3;
    spin: number;
    phase: number;
    variant: number;
    /** Distance at which the ship touches it (its rough average size). */
    reach: number;
    /** 0 to 1: what the mining laser has left of it. */
    health: number;
    /** Drawn out to here, then faded (a rock of the dense cluster is only drawn near). */
    drawn: number;
}

const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

/** Rocks per 5 km cell at a point: the belts, and debris above worlds with ground. */
export const asteroidDensity = (p: THREE.Vector3) => {
    // A stray rock now and then anywhere, but none where the Sun would have boiled it away.
    let density = (p.distanceTo(SUN.position) > SUN.radius * 12 ? 0.004 : 0) + beltDensity(p);
    for (const body of EXPEDITION_BODIES) {
        if (body.kind !== 'rocky') continue;
        const altitude = p.distanceTo(body.position) - body.radius;
        const floor = (body.biome?.atmosphereHeight ?? 0) * 3 + 1500;
        if (altitude < floor * 0.8 || altitude > body.radius * 2.5) continue;
        density += smooth(floor * 0.8, floor * 1.3, altitude) * (1 - smooth(body.radius * 1.5, body.radius * 2.5, altitude)) * 0.12;
    }
    return density;
};

/** A lumpy rock for the distance: an icosphere pushed in and out by noise, smooth shaded. */
const makeRock = (variant: number) => {
    const sphere = new THREE.IcosahedronGeometry(1, 2);
    sphere.deleteAttribute('normal');
    sphere.deleteAttribute('uv');
    // The icosphere comes with every face's corners apart: join them so the shading is smooth.
    const geometry = mergeVertices(sphere);
    sphere.dispose();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i);
        const seed = 4100 + variant * 31;
        const n = gnoise(v.x * 1.4 + variant, v.y * 1.4, v.z * 1.4, seed) * 0.3
            + gnoise(v.x * 3.5, v.y * 3.5 + variant, v.z * 3.5, seed + 1) * 0.1;
        v.multiplyScalar(0.82 + n);
        position.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    return geometry;
};

/** The average colour of a picture (for the distant rocks to match the near ones). */
const meanColour = (texture: THREE.Texture | null) => {
    const colour = new THREE.Color(1, 1, 1);
    const image = texture?.image as CanvasImageSource | undefined;
    if (!image) return colour;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const context = canvas.getContext('2d');
        if (!context) return colour;
        context.drawImage(image, 0, 0, 16, 16);
        const data = context.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const n = data.length / 4;
        colour.setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
    } catch {
        // An unreadable picture: the distant rocks keep the plain tint.
    }
    return colour;
};

/** The sculpted boulder as a plain geometry about its own centre, about one unit in radius. */
const boulderOf = (gltf: GLTF) => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
        if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
    });
    if (!mesh) return null;
    const found = mesh as THREE.Mesh;
    const source = found.geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
        const attribute = source.getAttribute(name);
        if (!attribute) continue;
        const values = new Float32Array(attribute.count * attribute.itemSize);
        for (let i = 0; i < attribute.count; i++) {
            for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(i, c);
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
    }
    if (source.index) geometry.setIndex(source.index.clone());
    geometry.applyMatrix4(found.matrixWorld);
    geometry.computeBoundingBox();
    const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
    geometry.translate(-centre.x, -centre.y, -centre.z);
    // Scaled so its average distance from the centre is 1: that is the size used for touching it.
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    let sum = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) sum += v.fromBufferAttribute(positions, i).length();
    const mean = sum / positions.count;
    geometry.scale(1 / mean, 1 / mean, 1 / mean);
    geometry.computeBoundingSphere();
    const material = (found.material as THREE.MeshStandardMaterial).clone();
    material.metalness = 0;
    material.metalnessMap = null;
    material.roughness = 1;
    material.envMap = null;
    return { geometry, material, mean: meanColour(material.map) };
};

const ROCK_COLOUR = { belt: '#8f857a', kuiper: '#b3bec8', debris: '#7d7468' };

const toRock = new THREE.Vector3();
const forward = new THREE.Vector3();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const position = new THREE.Vector3();
const cell = new THREE.Vector3();
const scratch = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

/** The rocks of one cell, the same on every visit. */
const rocksOf = (
    cx: number, cy: number, cz: number, size: number, density: number, seed: number, prefix: string,
    sizes: (u: number, h: (s: number) => number) => number, drawn: number,
) => {
    const base = hash3(cx + NOISE_OFFSET * 4, cy + NOISE_OFFSET * 4, cz + NOISE_OFFSET * 4, seed);
    const count = Math.floor(density + hashToUnit(base));
    const rocks: Asteroid[] = [];
    for (let k = 0; k < count; k++) {
        const h = (s: number) => hashToUnit(hash3(cx + NOISE_OFFSET * 4, cy + NOISE_OFFSET * 4, cz + NOISE_OFFSET * 4, seed + 23 + k * 17 + s));
        const at = new THREE.Vector3((cx + h(1)) * size, (cy + h(2)) * size, (cz + h(3)) * size);
        // Never inside a world.
        if (EXPEDITION_BODIES.some((b) => at.distanceTo(b.position) < b.radius * 1.05)) continue;
        const radius = sizes(h(4), h);
        const shape = new THREE.Vector3(0.8 + h(10) * 0.5, 0.65 + h(11) * 0.4, 0.8 + h(12) * 0.35);
        rocks.push({
            id: `${prefix}${cx}:${cy}:${cz}:${k}`,
            position: at,
            radius,
            shape,
            axis: new THREE.Vector3(h(5) - 0.5, h(6) - 0.5, h(7) - 0.5).normalize(),
            spin: (h(8) - 0.5) * 0.3,
            phase: h(13) * Math.PI * 2,
            variant: Math.floor(h(9) * VARIANTS),
            reach: radius * (shape.x + shape.y + shape.z) / 3 * 0.9,
            health: 1,
            drawn,
        });
    }
    return rocks;
};

/** Belt rock: mostly boulders, a few small hills. */
const beltSize = (u: number) => 8 + u * u * u * 110;
/** A dense cluster: many small rocks, some large, now and then a giant. */
const fieldSize = (u: number, h: (s: number) => number) => (h(14) < 0.025 ? 260 + h(15) * 380 : 6 + u * u * u * 150);

export const Asteroids = ({ runtime, input }: { runtime: ExpeditionRuntime; input: ExpeditionInput }) => {
    const farRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
    const nearRef = useRef<THREE.InstancedMesh>(null);
    const laserRef = useRef<THREE.Mesh>(null);
    const debrisRef = useRef<THREE.Points>(null);
    const rocks = useRef<Asteroid[]>([]);
    const built = useRef({ key: '', version: -1 });
    const broken = useRef(new Set<string>());
    const version = useRef(0);
    // Rocks of every cell near the ship, made once, so a half-mined rock stays half mined.
    const cells = useRef(new Map<string, Asteroid[]>());
    const limit = LIMIT[runtime.quality];
    const gltf = useModel('boulder');
    const boulder = useMemo(() => (gltf ? boulderOf(gltf) : null), [gltf]);
    const geometries = useMemo(() => Array.from({ length: VARIANTS }, (_, n) => makeRock(n)), []);
    const farMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: ROCK_COLOUR.belt, roughness: 1, metalness: 0 }), []);
    const laserGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true).translate(0, 0.5, 0), []);
    const laserMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 0.5), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), []);
    const debris = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(240 * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
        // Nothing until a rock breaks (every point starts on the player).
        g.setDrawRange(0, 0);
        return g;
    }, []);
    const debrisMaterial = useMemo(() => new THREE.PointsMaterial({ map: glowTexture(), color: '#ffd9a8', size: 6, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), []);
    const breaks = useRef<{ position: THREE.Vector3; radius: number; start: number }[]>([]);
    const directions = useMemo(() => Array.from({ length: 40 }, () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()), []);
    useEffect(() => () => {
        geometries.forEach((g) => g.dispose());
        farMaterial.dispose();
        laserGeometry.dispose();
        laserMaterial.dispose();
        debris.dispose();
        debrisMaterial.dispose();
    }, [geometries, farMaterial, laserGeometry, laserMaterial, debris, debrisMaterial]);
    useEffect(() => () => {
        boulder?.geometry.dispose();
        boulder?.material.dispose();
    }, [boulder]);

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        const ship = runtime.hud.ship;
        const inSpace = runtime.mode === 'ship' && !!ship && runtime.atmosphere < 0.01 && !runtime.fall.active && runtime.camera.distanceTo(SUN.position) > SUN.radius * 1.2;
        const fast = !!ship && ship.pulse > 0.25;
        const hide = () => {
            farRefs.current.forEach((m) => { if (m) m.count = 0; });
            if (nearRef.current) nearRef.current.count = 0;
            if (laserRef.current) laserRef.current.visible = false;
            debris.setDrawRange(0, 0);
        };
        if (!ship || !inSpace || fast) {
            hide();
            runtime.shipLaser = false;
            rocks.current = [];
            runtime.asteroids = [];
            runtime.asteroidTarget = null;
            built.current.key = '';
            return;
        }
        const p = ship.position;
        // A cluster left far behind is let go.
        const field: AsteroidField | null = runtime.asteroidField;
        if (field && field.center.distanceTo(p) > field.radius * 2.5) runtime.asteroidField = null;
        const ix = Math.floor(p.x / ASTEROID_CELL);
        const iy = Math.floor(p.y / ASTEROID_CELL);
        const iz = Math.floor(p.z / ASTEROID_CELL);
        const fx = Math.floor(p.x / FIELD_CELL);
        const fy = Math.floor(p.y / FIELD_CELL);
        const fz = Math.floor(p.z / FIELD_CELL);
        const key = `${ix}:${iy}:${iz}|${runtime.asteroidField ? `${runtime.asteroidField.seed}:${fx}:${fy}:${fz}` : ''}`;

        if (key !== built.current.key || version.current !== built.current.version) {
            built.current.key = key;
            built.current.version = version.current;
            const list: Asteroid[] = [];
            const seen = new Set<string>();
            const take = (id: string, make: () => Asteroid[]) => {
                seen.add(id);
                let made = cells.current.get(id);
                if (!made) {
                    made = make();
                    cells.current.set(id, made);
                }
                for (const rock of made) if (!broken.current.has(rock.id)) list.push(rock);
            };
            // Scattered rocks, in 5 km cells.
            const span = Math.ceil(REACH / ASTEROID_CELL);
            for (let dx = -span; dx <= span; dx++) {
                for (let dy = -span; dy <= span; dy++) {
                    for (let dz = -span; dz <= span; dz++) {
                        const cx = ix + dx, cy = iy + dy, cz = iz + dz;
                        cell.set((cx + 0.5) * ASTEROID_CELL, (cy + 0.5) * ASTEROID_CELL, (cz + 0.5) * ASTEROID_CELL);
                        if (cell.distanceTo(p) > REACH + ASTEROID_CELL) continue;
                        const at = cell.clone();
                        take(`s${cx}:${cy}:${cz}`, () => {
                            const density = asteroidDensity(at);
                            return density < 0.003 ? [] : rocksOf(cx, cy, cz, ASTEROID_CELL, density, 977, '', beltSize, REACH);
                        });
                    }
                }
            }
            // A dense cluster, in small cells near the ship.
            const cluster = runtime.asteroidField;
            if (cluster) {
                const reach = Math.ceil(FIELD_REACH / FIELD_CELL);
                for (let dx = -reach; dx <= reach; dx++) {
                    for (let dy = -reach; dy <= reach; dy++) {
                        for (let dz = -reach; dz <= reach; dz++) {
                            const cx = fx + dx, cy = fy + dy, cz = fz + dz;
                            cell.set((cx + 0.5) * FIELD_CELL, (cy + 0.5) * FIELD_CELL, (cz + 0.5) * FIELD_CELL);
                            if (cell.distanceTo(p) > FIELD_REACH + FIELD_CELL) continue;
                            const density = fieldDensity(cluster, cell);
                            if (density <= 0) continue;
                            take(`f${cluster.seed}:${cx}:${cy}:${cz}`, () =>
                                rocksOf(cx, cy, cz, FIELD_CELL, density, 3301 + (cluster.seed % 9973), `f${cluster.seed}:`, fieldSize, FIELD_REACH)
                                    // Not on top of where the ship was pulled out.
                                    .filter((rock) => rock.position.distanceTo(cluster.entry) > rock.radius * 1.3 + 160));
                        }
                    }
                }
            }
            for (const id of [...cells.current.keys()]) if (!seen.has(id)) cells.current.delete(id);
            // Too many to draw: the nearest, surface first.
            if (list.length > limit) {
                list.sort((a, b) => a.position.distanceTo(p) - a.radius - (b.position.distanceTo(p) - b.radius));
                list.length = limit;
            }
            rocks.current = list;
            runtime.asteroids = list;
        }

        // Draw them, tumbling: the nearest as the sculpted boulder.
        const t = performance.now() / 1000;
        const counts = new Array(VARIANTS).fill(0);
        let nearCount = 0;
        const near = nearRef.current;
        for (const rock of rocks.current) {
            const distance = rock.position.distanceTo(p);
            if (distance - rock.radius > rock.drawn) continue;
            const fade = 1 - smooth(rock.drawn * 0.82, rock.drawn, distance - rock.radius);
            quaternion.setFromAxisAngle(rock.axis, rock.phase + t * rock.spin);
            scale.copy(rock.shape).multiplyScalar(rock.radius * (0.55 + rock.health * 0.45) * fade);
            position.copy(rock.position).sub(runtime.origin);
            matrix.compose(position, quaternion, scale);
            if (boulder && near && distance - rock.radius < NEAR && nearCount < NEAR_MAX) {
                near.setMatrixAt(nearCount++, matrix);
                continue;
            }
            const mesh = farRefs.current[rock.variant];
            if (!mesh) continue;
            mesh.setMatrixAt(counts[rock.variant]++, matrix);
        }
        farRefs.current.forEach((mesh, n) => {
            if (!mesh) return;
            mesh.count = counts[n];
            mesh.instanceMatrix.needsUpdate = true;
        });
        if (near) {
            near.count = nearCount;
            near.instanceMatrix.needsUpdate = true;
        }
        // Belt rock is brown-grey; out in the Kuiper belt, icy.
        const region = beltAt(p);
        const colour = region === 'kuiper' ? ROCK_COLOUR.kuiper : region === 'belt' || runtime.asteroidField ? ROCK_COLOUR.belt : ROCK_COLOUR.debris;
        if (boulder) {
            boulder.material.color.set(colour).multiplyScalar(1.35);
            farMaterial.color.copy(boulder.material.color).multiply(boulder.mean);
        } else {
            farMaterial.color.set(colour);
        }

        // Hitting one: the shield takes the blow, harder the faster.
        for (const rock of ship.destroyed ? [] : rocks.current) {
            const reach = rock.reach * (0.55 + rock.health * 0.45) + 4.5;
            toRock.copy(p).sub(rock.position);
            const gap = toRock.length();
            if (gap >= reach || gap < 1e-6) continue;
            toRock.divideScalar(gap);
            ship.position.addScaledVector(toRock, reach - gap);
            const into = ship.velocity.dot(toRock);
            if (into < 0) {
                if (into < -60) {
                    ship.shield = Math.max(0, ship.shield + into / 1600);
                    ship.hurtBy = 'asteroid';
                    ship.jolt = Math.min(1, -into / 700);
                    cue(runtime, 'impact', Math.min(1.3, -into / 500));
                    ship.notice = ship.shield > 0 ? `ASTEROID IMPACT · SHIELD ${Math.round(ship.shield * 100)}%` : 'ASTEROID IMPACT';
                    ship.noticeTime = performance.now() / 1000;
                }
                ship.velocity.addScaledVector(toRock, -into * 1.3);
            }
        }

        // The mining laser: hold click with a rock in front of the nose.
        const laser = laserRef.current;
        let target: Asteroid | null = null;
        forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
        if (!ship.landed && !ship.destroyed && !runtime.menuOpen) {
            let best = Infinity;
            for (const rock of rocks.current) {
                toRock.copy(rock.position).sub(p);
                const distance = toRock.length() - rock.radius;
                if (distance > 3000) continue;
                const aim = toRock.normalize().dot(forward);
                const allowed = Math.cos(Math.atan2(rock.radius * 1.2, Math.max(distance, 1)) + 0.05);
                if (aim < allowed) continue;
                if (distance < best) { best = distance; target = rock; }
            }
        }
        runtime.asteroidTarget = target;
        const firing = !!target && input.primary && !runtime.menuOpen;
        runtime.shipLaser = firing;
        if (laser) {
            laser.visible = firing;
            if (firing && target) {
                const from = scratch.copy(p).addScaledVector(forward, 4).sub(runtime.origin);
                toRock.copy(target.position).sub(runtime.origin).sub(from);
                const length = Math.max(1, toRock.length() - target.radius * 0.5);
                laser.position.copy(from);
                laser.quaternion.setFromUnitVectors(yAxis, toRock.normalize());
                // Never thinner than a couple of pixels, however far.
                const width = Math.max(0.18, length * 0.0012) * (1 + Math.sin(t * 50) * 0.2);
                laser.scale.set(width, length, width);
                target.health -= dt / (0.6 + target.radius / 45);
                if (target.health <= 0) {
                    broken.current.add(target.id);
                    version.current += 1;
                    const gained = 2 + Math.round(target.radius / 12);
                    const where = beltAt(target.position) ?? 'space';
                    runtime.inventory.crystals += gained;
                    runtime.stats.mined += gained;
                    runtime.stats.minedOn[where] = (runtime.stats.minedOn[where] ?? 0) + gained;
                    breaks.current.push({ position: target.position.clone(), radius: target.radius, start: performance.now() / 1000 });
                    cue(runtime, 'rock', Math.min(1.2, 0.5 + target.radius / 120));
                    ship.notice = `ASTEROID MINED · +${gained} CRYSTALS`;
                    ship.noticeTime = performance.now() / 1000;
                }
            }
        }

        // Breaking up: a burst of glowing debris.
        const debrisPoints = debrisRef.current;
        if (debrisPoints) {
            const now = performance.now() / 1000;
            breaks.current = breaks.current.filter((b) => now - b.start < 2.2);
            const positions = debris.getAttribute('position') as THREE.BufferAttribute;
            let n = 0;
            for (const b of breaks.current.slice(-6)) {
                const age = now - b.start;
                for (const d of directions) {
                    positions.setXYZ(n++,
                        b.position.x - runtime.origin.x + d.x * age * b.radius * 1.4,
                        b.position.y - runtime.origin.y + d.y * age * b.radius * 1.4,
                        b.position.z - runtime.origin.z + d.z * age * b.radius * 1.4);
                }
            }
            debris.setDrawRange(0, n);
            positions.needsUpdate = true;
            debrisMaterial.opacity = breaks.current.length ? 1 - Math.min(1, (now - (breaks.current[breaks.current.length - 1]?.start ?? now)) / 2.2) : 0;
            debrisMaterial.size = 6;
        }
    });

    return (
        <group>
            {geometries.map((geometry, n) => (
                <instancedMesh key={n} ref={(mesh) => { farRefs.current[n] = mesh; }} args={[geometry, farMaterial, limit]} frustumCulled={false} />
            ))}
            {boulder && <instancedMesh ref={nearRef} args={[boulder.geometry, boulder.material, NEAR_MAX]} frustumCulled={false} />}
            <mesh ref={laserRef} geometry={laserGeometry} material={laserMaterial} visible={false} frustumCulled={false} />
            <points ref={debrisRef} geometry={debris} material={debrisMaterial} frustumCulled={false} />
        </group>
    );
};
