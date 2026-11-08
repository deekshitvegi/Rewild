import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { cue, type ExpeditionRuntime } from './runtime';
import { GLYPH_PATHS } from './glyphs';
import { findBody, type ExpeditionBody } from './bodies';
import { REWARD_TEXT, VAULT_CRYSTALS, VAULTS, vaultFrame, vaultOn, type Vault, type VaultFrame } from './vaults';

/**
 * The vaults (vaults.ts) in 3D, and their puzzle: three rune stones round a
 * sealed chest, lit with the mining beam (Player.updateMining charges the
 * rune looked at) in the order the lid shows, before the time runs out. A
 * wrong rune, or too slow, and they all go dark.
 */
const SHOW_WITHIN = 1500;
/** Seconds of beam a rune takes to light. */
export const RUNE_CHARGE = 0.6;
/** How far the beam reaches a rune. */
export const RUNE_REACH = 45;
/** The rune stones' height: their glyphs face the vault from the top. */
export const RUNE_HEIGHT = 2.1;

export const Vaults = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [id, setId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const vault = vaultOn(runtime.currentBody);
        let next: string | null = null;
        if (vault && runtime.altitude < 2500 && vaultFrame(vault).centre.distanceTo(runtime.origin) < SHOW_WITHIN) next = vault.id;
        if (next !== current.current) {
            current.current = next;
            setId(next);
            if (!next) runtime.vault = null;
        }
    });
    const vault = id ? VAULTS.find((v) => v.id === id) ?? null : null;
    return vault ? <VaultView key={vault.id} vault={vault} runtime={runtime} /> : null;
};

/** A glyph carved white on clear, for a plate whose material colour sets how it glows. */
const glyphTexture = (letter: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.translate(12, 12);
    ctx.scale(3, 3);
    ctx.stroke(new Path2D(GLYPH_PATHS[letter] ?? ''));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
};

const yAxis = new THREE.Vector3(0, 1, 0);
const toCentre = new THREE.Vector3();
const DARK = new THREE.Color(0.22, 0.24, 0.26);
const AWAKE = new THREE.Color(0.7, 0.95, 1.1);
const LIT = new THREE.Color(1.6, 2.4, 2.8);
const WRONG = new THREE.Color(2.4, 0.5, 0.3);

const stone = new THREE.MeshStandardMaterial({ color: '#5e6167', roughness: 0.9, metalness: 0.03 });
const stoneLight = new THREE.MeshStandardMaterial({ color: '#80838a', roughness: 0.94, metalness: 0.02 });

/** Light rising out of an opened vault: soft across, fading upwards, additive. */
const shaftGlow = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0.55, 0.85, 1.0) }, uStrength: { value: 0 } },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying float vHeight;
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
            vHeight = uv.y;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
        varying vec3 vNormalView;
        varying vec3 vViewDir;
        void main() {
            #include <logdepthbuf_fragment>
            float across = abs(dot(normalize(vNormalView), normalize(vViewDir)));
            float glow = across * across * across;
            float fade = 1.0 - vHeight;
            fade *= fade * fade * smoothstep(0.0, 0.01, vHeight);
            gl_FragColor = vec4(uColor * glow * fade * uStrength * 0.8, 1.0);
        }`,
});

const VaultView = ({ vault, runtime }: { vault: Vault; runtime: ExpeditionRuntime }) => {
    const frame = useMemo<VaultFrame>(() => vaultFrame(vault), [vault]);
    const letters = useMemo(() => [...vault.key], [vault]);
    const plates = useMemo(() => letters.map((letter) => {
        const map = glyphTexture(letter);
        return {
            lid: new THREE.MeshBasicMaterial({ map, color: DARK.clone(), transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }),
            rune: new THREE.MeshBasicMaterial({ map, color: DARK.clone(), transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
            map,
        };
    }), [letters]);
    const geometries = useMemo(() => ({
        base: new THREE.BoxGeometry(4.4, 0.32, 3.2),
        chest: new THREE.BoxGeometry(3.4, 1.3, 2.3),
        post: new THREE.BoxGeometry(0.38, 1.55, 0.38),
        lid: new THREE.BoxGeometry(3.7, 0.3, 2.6),
        plate: new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2),
        front: new THREE.PlaneGeometry(0.56, 0.56),
        // A flat face (not a corner) towards +z, where the glyph is.
        rune: new THREE.CylinderGeometry(0.34, 0.5, RUNE_HEIGHT, 6).rotateY(Math.PI / 6).translate(0, RUNE_HEIGHT / 2, 0),
        runePlate: new THREE.PlaneGeometry(0.62, 0.62),
        shaft: new THREE.CylinderGeometry(1.1, 1.1, 120, 20, 1, true).translate(0, 60, 0),
    }), []);
    const shaftMaterial = useMemo(() => shaftGlow(), []);
    useEffect(() => () => {
        plates.forEach((p) => { p.lid.dispose(); p.rune.dispose(); p.map.dispose(); });
        Object.values(geometries).forEach((g) => g.dispose());
        shaftMaterial.dispose();
    }, [plates, geometries, shaftMaterial]);

    const body = useMemo(() => findBody(vault.body) as ExpeditionBody, [vault]);
    const orientation = useMemo(() => new THREE.Quaternion().setFromUnitVectors(yAxis, frame.up), [frame]);
    // Each rune stone stands upright and turns its glyph (its +z face) towards the vault.
    const runeTurns = useMemo(() => frame.runes.map((rune) => {
        const up = rune.clone().sub(body.position).normalize();
        const facing = toCentre.copy(frame.centre).sub(rune);
        facing.addScaledVector(up, -facing.dot(up)).normalize();
        const side = new THREE.Vector3().crossVectors(up, facing).normalize();
        return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, facing));
    }), [frame, body]);

    const groupRef = useRef<THREE.Group>(null);
    const lidRef = useRef<THREE.Group>(null);
    const runeRefs = useRef<(THREE.Group | null)[]>([]);
    const shaftRef = useRef<THREE.Mesh>(null);
    const opened = runtime.stats.vaults.includes(vault.id);
    const state = useRef({ wrong: 0, openAge: opened ? 99 : -1 });

    useEffect(() => {
        runtime.vault = { vault, frame, lit: opened ? 3 : 0, left: 0, open: opened, charge: [0, 0, 0], target: -1 };
        // Solid: three spheres along the chest, two up each rune stone.
        const solids: number[] = [];
        const point = new THREE.Vector3();
        for (const along of [-1.1, 0, 1.1]) {
            point.set(along, 0.1, 0).applyQuaternion(orientation).add(frame.centre);
            solids.push(point.x, point.y, point.z, 1.05, 0);
        }
        frame.runes.forEach((rune) => {
            const up = rune.clone().sub(body.position).normalize();
            for (const [height, radius] of [[0.5, 0.5], [1.45, 0.42]]) {
                point.copy(rune).addScaledVector(up, height);
                solids.push(point.x, point.y, point.z, radius, 0);
            }
        });
        runtime.surface.fixtures = solids;
        return () => {
            runtime.vault = null;
            runtime.surface.fixtures = [];
        };
    }, [runtime, vault, frame, opened, orientation, body]);

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        const active = runtime.vault;
        const group = groupRef.current;
        if (!active || !group) return;
        group.position.copy(frame.centre).sub(runtime.origin);
        group.quaternion.copy(orientation);
        const s = state.current;
        const ship = runtime.hud.ship;
        const say = (message: string) => {
            if (!ship) return;
            ship.notice = message;
            ship.noticeTime = performance.now() / 1000;
        };
        const fail = (message: string) => {
            active.lit = 0;
            active.left = 0;
            active.charge.fill(0);
            s.wrong = 1.2;
            cue(runtime, 'drop', 0.7);
            say(message);
        };
        if (!active.open) {
            // A rune charged by the beam lights, if it is the next on the lid; otherwise they all go dark.
            for (let i = 0; i < 3; i++) {
                if (active.charge[i] < RUNE_CHARGE) {
                    if (active.target !== i) active.charge[i] = Math.max(0, active.charge[i] - dt * 2);
                    continue;
                }
                active.charge[i] = 0;
                if (i < active.lit) continue;
                if (i !== active.lit) {
                    fail('THE RUNES GO DARK · LIGHT THEM IN THE ORDER SHOWN ON THE VAULT');
                    break;
                }
                active.lit += 1;
                cue(runtime, 'scan', 0.9);
                if (active.lit === 1) active.left = vault.limit;
                if (active.lit === 3) {
                    active.open = true;
                    s.openAge = 0;
                    openVault(runtime, vault);
                }
            }
            if (active.lit > 0 && !active.open) {
                active.left -= dt;
                if (active.left <= 0) fail('TOO SLOW · THE RUNES GO DARK · LIGHT ALL THREE BEFORE THE TIME RUNS OUT');
            }
        }
        s.wrong = Math.max(0, s.wrong - dt);
        if (s.openAge >= 0) s.openAge += dt;

        // Glyphs: dark far off, awake close by, bright once lit; red for a moment after a mistake.
        const near = frame.centre.distanceTo(runtime.origin) < 80;
        plates.forEach((p, i) => {
            const lit = i < active.lit;
            const colour = lit ? LIT : s.wrong > 0 ? WRONG : near ? AWAKE : DARK;
            p.lid.color.lerp(colour, 1 - Math.exp(-dt * 8));
            const charging = !lit && active.target === i ? active.charge[i] / RUNE_CHARGE : 0;
            p.rune.color.copy(p.lid.color).lerp(LIT, charging * 0.7);
        });
        frame.runes.forEach((rune, i) => {
            const g = runeRefs.current[i];
            if (!g) return;
            g.position.copy(rune).sub(runtime.origin);
            g.quaternion.copy(runeTurns[i]);
        });
        // The lid slides aside and light rises.
        const open = s.openAge < 0 ? 0 : Math.min(1, s.openAge / 2.2);
        if (lidRef.current) lidRef.current.position.set(open * 2.6, 0.8 + open * 0.05, 0);
        if (shaftRef.current) {
            const fade = s.openAge < 0 ? 0 : s.openAge < 2 ? open : Math.max(0.15, 1 - (s.openAge - 2) / 8);
            shaftMaterial.uniforms.uStrength.value = fade;
            shaftRef.current.visible = fade > 0.01;
        }
    });

    return (
        <>
            <group ref={groupRef}>
                {/* A plinth, the chest between four corner posts, and its lid. */}
                <mesh geometry={geometries.base} material={stoneLight} position={[0, -0.12, 0]} />
                <mesh geometry={geometries.chest} material={stone} position={[0, 0, 0]} />
                {[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([x, z], i) => (
                    <mesh key={i} geometry={geometries.post} material={stoneLight} position={[x * 1.78, 0.1, z * 1.22]} />
                ))}
                {/* The key carved on the front as well as the lid, to be read from the approach. */}
                {plates.map((p, i) => (
                    <mesh key={`f${i}`} geometry={geometries.front} material={p.lid} position={[(i - 1) * 0.92, 0.18, 1.162]} />
                ))}
                {plates.map((p, i) => (
                    <mesh key={`b${i}`} geometry={geometries.front} material={p.lid} position={[(i - 1) * 0.92, 0.18, -1.162]} rotation={[0, Math.PI, 0]} />
                ))}
                <group ref={lidRef} position={[0, 0.8, 0]}>
                    <mesh geometry={geometries.lid} material={stoneLight} />
                    {plates.map((p, i) => (
                        <mesh key={i} geometry={geometries.plate} material={p.lid} position={[(i - 1) * 0.95, 0.155, 0]} />
                    ))}
                </group>
                <mesh ref={shaftRef} geometry={geometries.shaft} material={shaftMaterial} position={[0, 0.9, 0]} visible={false} />
            </group>
            {frame.runes.map((_, i) => (
                <group key={i} ref={(g) => { runeRefs.current[i] = g; }}>
                    <mesh geometry={geometries.rune} material={stone} />
                    <mesh geometry={geometries.runePlate} material={plates[i].rune} position={[0, RUNE_HEIGHT * 0.72, 0.36]} />
                </group>
            ))}
        </>
    );
};

/** What opening a vault gives: an upgrade the suit does not have yet, else crystals; and one glyph of its word. */
const openVault = (runtime: ExpeditionRuntime, vault: Vault) => {
    if (!runtime.stats.vaults.includes(vault.id)) runtime.stats.vaults.push(vault.id);
    const supplies = runtime.supplies;
    const kinds: (keyof typeof REWARD_TEXT)[] = [vault.reward, 'jetpack', 'tank', 'tool'];
    const kind = kinds.find((k) => supplies[k] < 2);
    let label: string;
    let blurb: string;
    if (kind) {
        supplies[kind] += 1;
        label = 'Vault opened';
        blurb = `${REWARD_TEXT[kind].name}: ${REWARD_TEXT[kind].detail} The lid read ${vault.key}.`;
    } else {
        runtime.inventory.crystals += VAULT_CRYSTALS;
        label = `Vault opened · +${VAULT_CRYSTALS} crystals`;
        blurb = `Every ancient cell is already fitted to the suit; it held crystals. The lid read ${vault.key}.`;
    }
    runtime.events.learn([...vault.key]);
    cue(runtime, 'chapter', 1);
    runtime.scan.found = { label, name: vault.name, blurb };
    runtime.scan.foundAt = performance.now() / 1000;
    const ship = runtime.hud.ship;
    if (ship) {
        ship.notice = `${vault.name.toUpperCase()} OPENS`;
        ship.noticeTime = performance.now() / 1000;
    }
};
