import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, heightGLSL, terrainUniforms, type ExpeditionBody } from './bodies';
import { NOISE_GLSL } from './noise';
import { groundHeight } from './environment';
import { SHIP_GEAR_HEIGHT } from './Ship';
import type { ExpeditionRuntime } from './runtime';

/**
 * Soft shadows on the ground under what stands or walks on it: animals, the
 * explorer, the ship when it is low. Nothing on the surface casts a real
 * shadow, so without these everything looks as if it hovers a little.
 *
 * Each shadow is a dark, soft-edged ellipse, stretched away from the sun as
 * the sun gets lower and faded out at night and as its caster leaves the
 * ground. It is a small grid whose every vertex the vertex shader puts on
 * the terrain with the terrain's own height function, so it lies on sand
 * ripples and hillsides instead of cutting into them. One instanced mesh
 * draws them all.
 */

const createShadowMaterial = (body: ExpeditionBody) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
        uOrigin: { value: new THREE.Vector3() },
        uRadius: { value: body.radius },
        ...terrainUniforms(body),
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        ${NOISE_GLSL}
        ${heightGLSL(body)}
        uniform vec3 uOrigin; // floating origin, relative to the planet centre
        uniform float uRadius;
        varying vec2 vUv;
        varying float vStrength;
        void main() {
            vUv = uv;
            vStrength = 1.0;
            #ifdef USE_INSTANCING_COLOR
            vStrength = instanceColor.r;
            #endif
            // On the ground itself: the same height the terrain is drawn with,
            // a few centimetres up so the two never fight over a pixel.
            vec3 local = uOrigin + (instanceMatrix * vec4(position, 1.0)).xyz;
            vec3 d = normalize(local);
            local = d * (uRadius + terrainHeight(d, 0.25) + 0.04);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(local - uOrigin, 1.0);
            #include <logdepthbuf_vertex>
            #ifdef USE_LOGDEPTHBUF
            // Between its vertices the terrain mesh can stand a little above the
            // exact height this follows: depth-test the shadow as if it were a
            // little nearer, so the ground cannot swallow it.
            vFragDepth -= 0.25 + 0.004 * gl_Position.w;
            #endif
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec2 vUv;
        varying float vStrength;
        void main() {
            #include <logdepthbuf_fragment>
            // Dense in the middle, fading to nothing at the rim.
            vec2 p = vUv * 2.0 - 1.0;
            float shade = pow(max(1.0 - dot(p, p), 0.0), 1.6);
            gl_FragColor = vec4(0.0, 0.0, 0.0, shade * vStrength);
        }`,
});

export interface ContactShadowsHandle {
    /** Forget last frame's shadows. */
    begin: () => void;
    /**
     * A shadow on the ground at `ground` (relative to the floating origin),
     * whose local up is `up`, under a caster `length` long (along `forward`),
     * `width` wide and `height` tall, `lift` above the ground (fades it out).
     */
    add: (ground: THREE.Vector3, up: THREE.Vector3, forward: THREE.Vector3, length: number, width: number, height: number, lift?: number) => void;
    /** Upload this frame's shadows. */
    end: () => void;
}

const sunFlat = new THREE.Vector3();
const across = new THREE.Vector3();
const along = new THREE.Vector3();
const centre = new THREE.Vector3();
const basis = new THREE.Matrix4();
const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
const color = new THREE.Color();

export const ContactShadows = forwardRef<ContactShadowsHandle, { body: ExpeditionBody; runtime: ExpeditionRuntime; capacity: number }>(
    function ContactShadows({ body, runtime, capacity }, ref) {
        const meshRef = useRef<THREE.InstancedMesh | null>(null);
        const count = useRef(0);
        // A grid, so it can follow the ground's shape between its corners.
        const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1, 8, 8).rotateX(-Math.PI / 2), []);
        const material = useMemo(() => createShadowMaterial(body), [body]);
        useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

        useImperativeHandle(ref, () => ({
            begin: () => { count.current = 0; },
            add: (ground, up, forward, length, width, height, lift = 0) => {
                const mesh = meshRef.current;
                if (!mesh || count.current >= capacity) return;
                // How high the sun stands here; below the horizon there is no shadow.
                const sunUp = body.sunDirection.dot(up);
                const day = THREE.MathUtils.smoothstep(sunUp, -0.02, 0.12);
                const fade = day * (1 - THREE.MathUtils.smoothstep(lift, height * 0.15, height * 1.6));
                if (fade <= 0.01) return;
                along.copy(forward).addScaledVector(up, -forward.dot(up));
                if (along.lengthSq() < 1e-8) along.set(1, 0, 0).addScaledVector(up, -up.x);
                along.normalize();
                across.crossVectors(up, along).normalize();
                centre.copy(ground);
                // A footprint the shape of the caster, plus what a low sun throws.
                let sx = width * 1.15;
                let sz = length * 1.1;
                sunFlat.copy(body.sunDirection).addScaledVector(up, -sunUp);
                const flatLength = sunFlat.length();
                if (flatLength > 1e-4) {
                    sunFlat.divideScalar(flatLength);
                    const stretch = Math.min(height / Math.max(sunUp, 0.2), height * 2.5);
                    sz += stretch * 0.5 * Math.abs(sunFlat.dot(along));
                    sx += stretch * 0.5 * Math.abs(sunFlat.dot(across));
                    centre.addScaledVector(sunFlat, -stretch * 0.22);
                }
                basis.makeBasis(across, up, along);
                quaternion.setFromRotationMatrix(basis);
                matrix.compose(centre, quaternion, scale.set(sx, 1, sz));
                mesh.setMatrixAt(count.current, matrix);
                // The strength rides in the instance colour's red channel.
                mesh.setColorAt(count.current, color.setScalar(0.7 * fade));
                count.current += 1;
            },
            end: () => {
                const mesh = meshRef.current;
                if (!mesh) return;
                mesh.count = count.current;
                mesh.instanceMatrix.needsUpdate = true;
                if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
                material.uniforms.uOrigin.value.copy(runtime.origin).sub(body.position);
            },
        }), [capacity, material, runtime, body]);

        return (
            <instancedMesh
                ref={(mesh) => {
                    meshRef.current = mesh;
                    if (mesh && !mesh.instanceColor) {
                        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
                        mesh.count = 0;
                    }
                }}
                args={[geometry, material, capacity]}
                frustumCulled={false}
                renderOrder={1}
            />
        );
    },
);

const up = new THREE.Vector3();
const point = new THREE.Vector3();
const forward = new THREE.Vector3();

/** The explorer's and the ship's shadows on the rocky world they are on. */
const PlayerShadowLayer = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const shadows = useRef<ContactShadowsHandle>(null);
    useFrame(() => {
        const casting = shadows.current;
        if (!casting) return;
        casting.begin();
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        if (walker) {
            up.copy(walker.position).sub(body.position);
            const reach = up.length();
            up.divideScalar(reach);
            const ground = groundHeight(body, up);
            point.copy(body.position).addScaledVector(up, body.radius + ground).sub(runtime.origin);
            casting.add(point, up, walker.facing, 0.55, 0.55, 1.9, reach - body.radius - ground);
        }
        const ship = runtime.hud.ship;
        if (ship) {
            up.copy(ship.position).sub(body.position);
            const reach = up.length();
            up.divideScalar(reach);
            const ground = groundHeight(body, up);
            const lift = reach - body.radius - ground - SHIP_GEAR_HEIGHT;
            if (lift < 60) {
                point.copy(body.position).addScaledVector(up, body.radius + ground).sub(runtime.origin);
                forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
                casting.add(point, up, forward, 7.4, 6.4, 2.4, Math.max(0, lift));
            }
        }
        casting.end();
    }, -1);
    return <ContactShadows ref={shadows} body={body} runtime={runtime} capacity={2} />;
};

/** Shadows for the explorer and the ship, on whichever rocky world they are on. */
export const PlayerShadows = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [bodyId, setBodyId] = useState<string | null>(null);
    const current = useRef<string | null>(null);
    useFrame(() => {
        const body = runtime.currentBody;
        const id = body && body.kind === 'rocky' && body.biome ? body.id : null;
        if (id !== current.current) {
            current.current = id;
            setBodyId(id);
        }
    });
    const body = bodyId ? findBody(bodyId) : null;
    return body ? <PlayerShadowLayer key={body.id} body={body} runtime={runtime} /> : null;
};
