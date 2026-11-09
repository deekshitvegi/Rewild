import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { modelEnvironment, useEnvironmentOn, useModel } from './models';
import { applyLivery, type Livery } from './livery';

/**
 * The player's ship: a grey and white swept-wing fighter with red accents and
 * twin engines. The sculpted model (models/expedition/ship.glb) is drawn once
 * it has loaded; until then, and if it cannot load, a version built from
 * primitives stands in. Forward is -Z, up is +Y. Landing pads sit
 * SHIP_GEAR_HEIGHT below its origin.
 */
export const SHIP_GEAR_HEIGHT = 1.55;

/** The sculpted hull is a unit long with its nose along +X. */
const MODEL_SCALE = 7.1;
/** Engine exits (centre of each nozzle), for the glow and the exhaust trails. */
const ENGINE_EXIT = {
    model: { x: 0.115 * MODEL_SCALE, y: 0.014 * MODEL_SCALE, z: 0.447 * MODEL_SCALE },
    primitive: { x: 1.08, y: -0.08, z: 2.8 },
};

export interface ShipHandle {
    group: THREE.Group;
    /** 0 retracted .. 1 down */
    setGear: (value: number) => void;
    /** 0 idle .. 1 full thrust; > 1 boost */
    setThrust: (value: number) => void;
    /** 0 .. 1 orange entry shield */
    setShield: (value: number) => void;
    /** World-space nozzle positions, for the exhaust trails. */
    nozzles: THREE.Object3D[];
}

const hull = new THREE.MeshStandardMaterial({ color: '#d9dcdf', metalness: 0.35, roughness: 0.42 });
const panel = new THREE.MeshStandardMaterial({ color: '#6f757c', metalness: 0.5, roughness: 0.5 });
const dark = new THREE.MeshStandardMaterial({ color: '#2d3136', metalness: 0.55, roughness: 0.45 });
const accent = new THREE.MeshStandardMaterial({ color: '#b3262c', metalness: 0.3, roughness: 0.45 });
const glass = new THREE.MeshStandardMaterial({ color: '#16202a', metalness: 0.6, roughness: 0.12, emissive: '#0b1822', emissiveIntensity: 0.6 });

const makeFuselage = () => {
    const profile = [
        [0.0, -3.1], [0.46, -3.05], [0.6, -2.7], [0.72, -1.2], [0.68, 0.6],
        [0.5, 1.9], [0.3, 2.9], [0.12, 3.5], [0.0, 3.7],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const geometry = new THREE.LatheGeometry(profile, 28);
    geometry.rotateX(-Math.PI / 2);
    geometry.scale(1.18, 0.66, 1);
    return geometry;
};

const makeWing = (side: 1 | -1) => {
    const points = [[0.45, 1.9], [0.45, -0.7], [1.6, 0.4], [3.9, 1.35], [3.95, 2.25], [1.2, 2.3]];
    const shape = new THREE.Shape(
        (side === 1 ? points : points.slice().reverse()).map(([x, z]) => new THREE.Vector2(x * side, z)),
    );
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2 });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, 0.02, 0);
    return geometry;
};

const makeFin = () => {
    const shape = new THREE.Shape([
        new THREE.Vector2(1.2, 0), new THREE.Vector2(2.75, 0), new THREE.Vector2(2.95, 1.1), new THREE.Vector2(2.45, 1.15),
    ]);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
    // Shape x -> ship z, shape y -> ship y, extrusion -> ship x.
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(0.035, 0, 0);
    return geometry;
};

const glowTexture = (() => {
    let texture: THREE.Texture | null = null;
    return () => {
        if (texture) return texture;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d')!;
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.18, 'rgba(210,235,255,0.9)');
        gradient.addColorStop(0.45, 'rgba(110,170,255,0.35)');
        gradient.addColorStop(1, 'rgba(60,110,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    };
})();

const shieldMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uIntensity: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            vLocal = position;
            vNormal = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uIntensity;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        void main() {
            #include <logdepthbuf_fragment>
            float rim = pow(max(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 0.0), 2.0);
            float front = smoothstep(0.6, -1.0, vLocal.z);
            float flicker = 0.85 + 0.15 * sin(uTime * 37.0 + vLocal.x * 9.0 + vLocal.y * 13.0);
            vec3 color = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.85, 0.5), rim);
            gl_FragColor = vec4(color * (rim * 1.3 + front * 0.35) * front * uIntensity * flicker, 1.0);
        }`,
});

export const Ship = forwardRef<ShipHandle, { livery?: Livery }>(function Ship({ livery }, ref) {
    const { gl } = useThree();
    const model = useModel('ship');
    // In its pilot's colours (livery.ts), with materials of its own.
    const hullModel = useMemo(() => {
        if (!model) return null;
        const copy = model.scene.clone(true);
        // The model came marked as bare metal all over (metallicFactor 1), so its colour was whatever it reflected:
        // white in the old studio light, brown in a world's own. A ship's hull is painted, and paint is not metal.
        copy.traverse((object) => {
            const material = (object as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (material?.isMeshStandardMaterial && material.metalness > 0.3) material.metalness = 0.3;
        });
        return livery ? applyLivery(copy, livery) : copy;
    }, [model, livery]);
    useEnvironmentOn(hullModel, gl, 0.45);
    // The built parts (landing gear, and the whole stand-in) reflect the same
    // studio light, or their metal renders black.
    useEffect(() => {
        const env = modelEnvironment(gl);
        [hull, panel, dark, accent, glass].forEach((material) => {
            material.envMap = env;
            material.envMapIntensity = 0.45;
            material.needsUpdate = true;
        });
    }, [gl]);
    const exit = hullModel ? ENGINE_EXIT.model : ENGINE_EXIT.primitive;
    const groupRef = useRef<THREE.Group>(null!);
    const gearRef = useRef<THREE.Group>(null!);
    const plumeRefs = useRef<THREE.Sprite[]>([]);
    const nozzleRefs = useRef<THREE.Object3D[]>([]);
    const shieldRef = useRef<THREE.Mesh>(null!);
    const state = useRef({ gear: 1, thrust: 0, shield: 0 });

    const geometries = useMemo(() => ({
        fuselage: makeFuselage(),
        canopy: new THREE.SphereGeometry(0.5, 24, 16),
        wingR: makeWing(1),
        wingL: makeWing(-1),
        fin: makeFin(),
        nacelle: new THREE.CylinderGeometry(0.36, 0.31, 2.5, 22).rotateX(Math.PI / 2),
        nozzle: new THREE.TorusGeometry(0.3, 0.07, 10, 24),
        intake: new THREE.CylinderGeometry(0.24, 0.3, 0.3, 18).rotateX(Math.PI / 2),
        pod: new THREE.CylinderGeometry(0.1, 0.1, 1.5, 12).rotateX(Math.PI / 2),
        stripe: new THREE.BoxGeometry(0.16, 0.03, 2.6),
        strut: new THREE.CylinderGeometry(0.05, 0.06, 1.0, 10),
        pad: new THREE.CylinderGeometry(0.2, 0.22, 0.07, 16),
        shield: new THREE.SphereGeometry(1, 32, 20),
        glowDisc: new THREE.CircleGeometry(0.26, 20),
    }), []);
    const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.8, 5.0), toneMapped: false }), []);
    const plumeMaterial = useMemo(() => new THREE.SpriteMaterial({
        map: glowTexture(), color: new THREE.Color(1.9, 2.3, 3.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }), []);

    useEffect(() => () => {
        Object.values(geometries).forEach((g) => g.dispose());
        glowMaterial.dispose();
        plumeMaterial.dispose();
    }, [geometries, glowMaterial, plumeMaterial]);

    useImperativeHandle(ref, () => ({
        get group() { return groupRef.current; },
        setGear: (value: number) => { state.current.gear = value; },
        setThrust: (value: number) => { state.current.thrust = value; },
        setShield: (value: number) => { state.current.shield = value; },
        get nozzles() { return nozzleRefs.current; },
    }), []);

    useFrame(({ clock }) => {
        const { gear, thrust, shield } = state.current;
        if (gearRef.current) {
            gearRef.current.visible = gear > 0.02;
            gearRef.current.scale.set(1, Math.max(0.02, gear), 1);
        }
        const flicker = 0.92 + Math.sin(clock.elapsedTime * 43) * 0.05 + Math.sin(clock.elapsedTime * 71) * 0.03;
        const size = (0.9 + thrust * 1.6) * flicker;
        plumeRefs.current.forEach((sprite) => {
            sprite.scale.set(size, size, 1);
            sprite.material.opacity = 0.55 + Math.min(thrust, 1.6) * 0.3;
        });
        shieldMaterial.uniforms.uIntensity.value = shield;
        shieldMaterial.uniforms.uTime.value = clock.elapsedTime;
        if (shieldRef.current) shieldRef.current.visible = shield > 0.01;
    });

    return (
        <group ref={groupRef}>
            {hullModel ? (
                <primitive object={hullModel} rotation={[0, Math.PI / 2, 0]} scale={MODEL_SCALE} />
            ) : (
                <>
                    <mesh geometry={geometries.fuselage} material={hull} castShadow />
                    <mesh geometry={geometries.canopy} material={glass} position={[0, 0.36, -0.95]} scale={[0.58, 0.46, 1.3]} />
                    <mesh geometry={geometries.stripe} material={accent} position={[0, 0.47, 0.6]} />
                    <mesh geometry={geometries.wingR} material={hull} rotation={[0, 0, -0.05]} />
                    <mesh geometry={geometries.wingL} material={hull} rotation={[0, 0, 0.05]} />
                    {[1, -1].map((side) => (
                        <group key={side}>
                            <mesh geometry={geometries.pod} material={accent} position={[side * 3.95, -0.02, 1.7]} />
                            <mesh geometry={geometries.fin} material={panel} position={[side * 0.46, 0.25, 0]} rotation={[0, 0, side * -0.32]} />
                            <group position={[side * exit.x, exit.y, exit.z]}>
                                <mesh geometry={geometries.nacelle} material={panel} position={[0, 0, -1.25]} />
                                <mesh geometry={geometries.intake} material={dark} position={[0, 0, -2.55]} />
                                <mesh geometry={geometries.nozzle} material={dark} />
                            </group>
                        </group>
                    ))}
                </>
            )}
            {[1, -1].map((side) => (
                <group key={side} position={[side * exit.x, exit.y, exit.z]}>
                    <mesh geometry={geometries.glowDisc} material={glowMaterial} position={[0, 0, 0.02]} />
                    <object3D ref={(o) => { if (o) nozzleRefs.current[side === 1 ? 0 : 1] = o; }} position={[0, 0, 0.2]} />
                    <sprite
                        ref={(s) => { if (s) plumeRefs.current[side === 1 ? 0 : 1] = s; }}
                        material={plumeMaterial}
                        position={[0, 0, 0.3]}
                    />
                </group>
            ))}
            <group ref={gearRef} position={[0, -0.42, 0]}>
                {[[0, -1.9], [1.05, 1.3], [-1.05, 1.3]].map(([x, z]) => (
                    <group key={`${x}-${z}`} position={[x, 0, z]}>
                        <mesh geometry={geometries.strut} material={dark} position={[0, -0.5, 0]} />
                        <mesh geometry={geometries.pad} material={panel} position={[0, -1.08, 0]} />
                    </group>
                ))}
            </group>
            <mesh ref={shieldRef} geometry={geometries.shield} material={shieldMaterial} position={[0, 0, -0.6]} scale={[2.3, 1.35, 3.9]} renderOrder={5} />
        </group>
    );
});
