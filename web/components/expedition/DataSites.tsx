import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { DATA_SITES, type DataSite } from './sites';
import { GLYPH_PATHS } from './glyphs';
import type { ExpeditionRuntime } from './runtime';
import { fromStart, turnFromStart } from './motion';

/**
 * The data sites in 3D: dark stone monoliths with a glowing glyph panel and a
 * beam of light that can be seen from the air, orbital stations for the gas
 * giants, and the golden Obelisk. A site turns gold once it has been read.
 */

const inscriptionTexture = (text: string, color: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    const letters = text.replace(/[^A-Z]/g, '').slice(0, 24);
    [...letters].forEach((ch, n) => {
        const col = n % 3;
        const row = Math.floor(n / 3);
        const path = new Path2D(GLYPH_PATHS[ch] ?? '');
        ctx.save();
        ctx.translate(14 + col * 36, 18 + row * 58);
        ctx.scale(1.25, 1.9);
        ctx.stroke(path);
        ctx.restore();
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

// A shaft of light rising from a site: a thin bright core in a soft glow,
// starting just above the stone and fading with height, faint beside it and
// clear from the air. It is never drawn thinner than a couple of pixels, so a
// site can be found from a long way off.
const beamMaterial = (color: string, radius: number) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
        uColor: { value: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35) },
        uStrength: { value: 1 },
        uRadius: { value: radius },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uRadius;
        varying float vHeight;
        varying float vSeen;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
            vHeight = uv.y;
            // How far the camera is from the beam at this height.
            float distance = length((modelViewMatrix * vec4(0.0, position.y, 0.0, 1.0)).xyz);
            float widen = max(1.0, distance * 0.0016 / uRadius);
            vec4 mv = modelViewMatrix * vec4(position.x * widen, position.y, position.z * widen, 1.0);
            // Faint close by, where it would only get in the way; spread thin
            // light is dimmer.
            vSeen = smoothstep(6.0, 90.0, distance) / sqrt(widen);
            vNormalView = normalize(normalMatrix * normal);
            vViewDir = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vHeight;
        varying float vSeen;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
            #include <logdepthbuf_fragment>
            // Across the beam: 1 on its axis, 0 at its edge.
            float across = abs(dot(normalize(vNormalView), normalize(vViewDir)));
            float glow = across * across * across * 0.35 + pow(across, 24.0) * 0.65;
            float rise = smoothstep(0.004, 0.02, vHeight);
            float fall = 1.0 - vHeight;
            fall *= fall * fall;
            gl_FragColor = vec4(uColor * glow * rise * fall * vSeen * 0.55 * uStrength, 1.0);
        }`,
});

// Dark granite, not black: at the old albedo (about 2%) the monoliths read as holes in the picture.
const stone = new THREE.MeshStandardMaterial({ color: '#4d5158', roughness: 0.88, metalness: 0.02 });
const stoneLight = new THREE.MeshStandardMaterial({ color: '#676a70', roughness: 0.95, metalness: 0.02 });
const stationHull = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.5, metalness: 0.45 });
const GOLD = '#ffc85a';

const yAxis = new THREE.Vector3(0, 1, 0);

const SiteModel = ({ site, runtime, discovered }: { site: DataSite; runtime: ExpeditionRuntime; discovered: boolean }) => {
    const groupRef = useRef<THREE.Group>(null);
    const ringRef = useRef<THREE.Mesh>(null);
    const color = discovered ? GOLD : site.color;
    const panel = useMemo(() => {
        const texture = inscriptionTexture(site.inscription, site.kind === 'obelisk' ? GOLD : color);
        return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    }, [site, color]);
    const beamRadius = site.kind === 'station' ? 3 : site.kind === 'obelisk' ? 0.8 : 0.5;
    const beam = useMemo(() => beamMaterial(site.kind === 'obelisk' ? GOLD : color, beamRadius), [site, color, beamRadius]);
    useEffect(() => () => { panel.map?.dispose(); panel.dispose(); beam.dispose(); }, [panel, beam]);

    const orientation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(yAxis, site.up), [site]);
    const stones = useMemo(() => Array.from({ length: 5 }, (_, n) => {
        const angle = (n / 5) * Math.PI * 2 + (site.id.length % 7) * 0.3;
        return { x: Math.cos(angle) * 4.2, z: Math.sin(angle) * 4.2, h: 0.8 + ((site.id.charCodeAt(n % site.id.length) * 37) % 100) / 60, tilt: ((n * 53) % 20 - 10) / 60 };
    }), [site]);

    useFrame(({ clock }) => {
        const group = groupRef.current;
        if (!group) return;
        // Held on its world as it was at the start; a station by a giant that is
        // not the frame's world goes round with it (motion.ts).
        fromStart(runtime.motion, site.body, site.position, group.position).sub(runtime.origin);
        turnFromStart(runtime.motion, site.body, orientation, group.quaternion);
        // The ring turns slowly about its own axis, which is the station's.
        if (ringRef.current) ringRef.current.rotation.z = clock.elapsedTime * 0.12;
    });

    if (site.kind === 'station') {
        return (
            <group ref={groupRef}>
                <mesh ref={ringRef} material={stationHull} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[42, 3.2, 12, 64]} />
                </mesh>
                <mesh material={stationHull} position={[0, 0, 0]}>
                    <boxGeometry args={[6, 26, 2.2]} />
                </mesh>
                <mesh material={panel} position={[0, 2, 1.12]}>
                    <planeGeometry args={[4.6, 18]} />
                </mesh>
                <mesh material={beam} position={[0, 1100, 0]}>
                    <cylinderGeometry args={[beamRadius, beamRadius, 2200, 16, 1, true]} />
                </mesh>
            </group>
        );
    }

    const tall = site.kind === 'obelisk' ? 2.2 : 1;
    return (
        <group ref={groupRef}>
            <mesh material={stone} position={[0, 2.1 * tall - 0.4, 0]}>
                <boxGeometry args={[1.4 * tall, 4.6 * tall, 0.5 * tall]} />
            </mesh>
            <mesh material={panel} position={[0, 2.1 * tall - 0.1, 0.255 * tall]}>
                <planeGeometry args={[1.05 * tall, 3.7 * tall]} />
            </mesh>
            {stones.map((s, n) => (
                <mesh key={n} material={stoneLight} position={[s.x * tall, s.h / 2 - 0.2, s.z * tall]} rotation={[s.tilt, n, -s.tilt]}>
                    <boxGeometry args={[0.7, s.h, 0.55]} />
                </mesh>
            ))}
            <mesh material={beam} position={[0, 450, 0]}>
                <cylinderGeometry args={[beamRadius, beamRadius, 900, 12, 1, true]} />
            </mesh>
        </group>
    );
};

export const DataSites = ({ runtime, discovered }: { runtime: ExpeditionRuntime; discovered: ReadonlySet<string> }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const id = runtime.currentBody?.id ?? null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
        }
    });
    // Ruins are drawn only on the world the player is at; stations are always out there.
    const visible = DATA_SITES.filter((site) => site.kind === 'station' || site.body.id === bodyId);
    return (
        <>
            {visible.map((site) => (
                <SiteModel key={site.id} site={site} runtime={runtime} discovered={discovered.has(site.id)} />
            ))}
        </>
    );
};

/** The site the player can interact with right now, if any. */
export const nearestInteractable = (runtime: ExpeditionRuntime, position: THREE.Vector3, onFoot: boolean) => {
    let best: DataSite | null = null;
    let bestDistance = Infinity;
    for (const site of DATA_SITES) {
        const distance = site.position.distanceTo(position);
        const reach = site.kind === 'station' ? (onFoot ? 0 : 520) : onFoot ? (site.kind === 'obelisk' ? 9 : 6.5) : 0;
        if (distance < reach && distance < bestDistance) {
            best = site;
            bestDistance = distance;
        }
    }
    return best;
};
