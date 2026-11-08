import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ExpeditionRuntime } from './runtime';
import { findBody } from './bodies';
import { groundHeight } from './environment';
import { landingZoneDirection, openingHeading } from './sites';

/**
 * Io's volcanoes throw sulphur and sulphur dioxide hundreds of kilometres up
 * (Pele's plume rises about 300 km, Tvashtar's up to 400) and the gas falls
 * back along ballistic arcs into a ring, an umbrella that Voyager and New
 * Horizons photographed against black space. One erupts on the horizon from
 * the landing site: grains on parabolas under Io's own gravity, launched from
 * the vent at up to 35 degrees from the vertical. Where they slow at the top
 * they crowd together, and that is the umbrella's canopy.
 */
const PLUME_HEIGHT = 520; // about 275 km at the game's scale for Io (1.88 units a kilometre)
const DISTANCE = 650; // from the landing zone, along the ground: near enough that the curve of the ground does not hide its stem
const BEARING = 0.3; // radians to the right of the heading on arrival: in view
const CONE = THREE.MathUtils.degToRad(35);
// A third of the grains leave in a narrow jet up the middle: the stem the umbrella opens from.
const STEM = THREE.MathUtils.degToRad(7);
const COUNT = [800, 1500, 2200];

export const IO_PLUME_BLURB = 'Io\'s volcanoes throw sulphur and sulphur dioxide hundreds of kilometres high. With no air to hold it up, the gas flies on ballistic arcs and falls back in a ring, an umbrella up to 1,200 km across that stains the ground red and white.';

const random = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

/** A soft round puff; the grains take their colour from their vertices. */
const puff = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        texture = new THREE.CanvasTexture(canvas);
        return texture;
    };
})();

/** The vent's direction from Io's centre (in Io's frame of the start, like the landing zone). */
export const ventUp = (body: NonNullable<ReturnType<typeof findBody>>) => {
    const zone = landingZoneDirection(body);
    const heading = openingHeading(body);
    const side = new THREE.Vector3().crossVectors(heading, zone).normalize();
    const along = heading.clone().multiplyScalar(Math.cos(BEARING)).addScaledVector(side, Math.sin(BEARING));
    return zone.clone().multiplyScalar(body.radius).addScaledVector(along, DISTANCE).normalize();
};

/** How high the plume's umbrella stands over the vent (game units). */
export const IO_PLUME_HEIGHT = PLUME_HEIGHT;

/** Where the vent is, and its frame: up, and two directions along the ground. */
const ventOf = (body: NonNullable<ReturnType<typeof findBody>>) => {
    const up = ventUp(body);
    const tangent = new THREE.Vector3(0, 1, 0).cross(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(up, tangent).normalize();
    const position = body.position.clone().addScaledVector(up, body.radius + groundHeight(body, up));
    return { position, up, tangent, bitangent };
};

const toVent = new THREE.Vector3();

export const Volcano = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const io = useMemo(() => findBody('io') ?? null, []);
    const count = COUNT[runtime.quality];
    const vent = useMemo(() => (io ? ventOf(io) : null), [io]);
    const grains = useMemo(() => {
        const r = random(4417);
        const g = io?.gravity ?? 1.8;
        const v0 = Math.sqrt(2 * g * PLUME_HEIGHT);
        return Array.from({ length: count }, () => {
            // Evenly over the cone's solid angle, a little slower towards its edge;
            // a third in the narrow stem.
            const cone = r() < 0.33 ? STEM : CONE;
            const theta = Math.acos(1 - r() * (1 - Math.cos(cone)));
            const speed = v0 * (0.84 + 0.16 * r()) * (1 - 0.08 * theta / CONE);
            const rise = speed * Math.cos(theta);
            return { phi: r() * Math.PI * 2, rise, out: speed * Math.sin(theta), flight: (2 * rise) / g, phase: r(), size: 0.6 + r() * 0.8 };
        });
    }, [io, count]);
    const geometry = useMemo(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
        return g;
    }, [count]);
    const material = useMemo(() => new THREE.PointsMaterial({
        map: puff(), size: 140, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }), []);
    useEffect(() => () => {
        geometry.dispose();
        material.dispose();
    }, [geometry, material]);
    const pointsRef = useRef<THREE.Points>(null);

    useFrame(({ clock }) => {
        const points = pointsRef.current;
        if (!points || !io || !vent) return;
        const near = runtime.currentBody === io && runtime.camera.distanceTo(vent.position) < 9000;
        points.visible = near;
        if (!near) return;
        const t = clock.elapsedTime;
        const g = io.gravity ?? 1.8;
        // Fine grains scatter light forwards: seen against the Sun the plume shines.
        toVent.copy(vent.position).sub(runtime.camera).normalize();
        const against = Math.max(0, toVent.dot(io.sunDirection));
        const sunlit = Math.max(0.15, vent.up.dot(io.sunDirection) + 0.35) * (1 + 3 * against ** 6);
        const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
        const colours = geometry.getAttribute('color') as THREE.BufferAttribute;
        const ox = vent.position.x - runtime.origin.x;
        const oy = vent.position.y - runtime.origin.y;
        const oz = vent.position.z - runtime.origin.z;
        for (let i = 0; i < grains.length; i++) {
            const p = grains[i];
            const age = (t / p.flight + p.phase) % 1;
            const time = age * p.flight;
            const height = p.rise * time - 0.5 * g * time * time;
            const reach = p.out * time;
            const cx = Math.cos(p.phi) * reach;
            const cz = Math.sin(p.phi) * reach;
            positions.setXYZ(i,
                ox + vent.tangent.x * cx + vent.bitangent.x * cz + vent.up.x * height,
                oy + vent.tangent.y * cx + vent.bitangent.y * cz + vent.up.y * height,
                oz + vent.tangent.z * cx + vent.bitangent.z * cz + vent.up.z * height);
            // Dense and bright leaving the vent, thinning out as it spreads, gone as it lands.
            const fade = Math.min(1, age * 14) * (1 - age ** 3) * (0.55 - 0.35 * age) * 0.12 * sunlit * p.size;
            colours.setXYZ(i, fade * 0.78, fade * 0.86, fade);
        }
        positions.needsUpdate = true;
        colours.needsUpdate = true;
        // Watching one erupt, from near enough to see it, counts once.
        if (!runtime.stats.visited.includes('io-plume') && runtime.camera.distanceTo(vent.position) < 2600) {
            const view = new THREE.Vector3(0, 0, -1).applyQuaternion(runtime.view.camera?.quaternion ?? new THREE.Quaternion());
            const top = vent.position.clone().addScaledVector(vent.up, PLUME_HEIGHT * 0.5).sub(runtime.camera).normalize();
            if (view.dot(top) > Math.cos(THREE.MathUtils.degToRad(25))) {
                runtime.stats.visited.push('io-plume');
                runtime.scan.found = { name: 'A volcano erupting', blurb: IO_PLUME_BLURB, label: 'Discovery' };
                runtime.scan.foundAt = performance.now() / 1000;
            }
        }
    });

    if (!io || !vent) return null;
    return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} visible={false} />;
};
