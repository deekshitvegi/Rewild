import * as THREE from 'three';
import { THE_SUN, findBody } from './bodies';
import { fromEquatorial } from './orbits';
import { gasMapTexture } from './gasMaps';
import { RING_GLSL } from './rings';
import { orientationOf, type Motion } from './motion';

/**
 * Saturn as the far mouth of the wormhole shows it, out by TON 618, where the Solar System is not
 * built (region.ts). The mouth's view of home is a photograph taken beyond the mouth by Saturn,
 * and Saturn fills a good part of it: this stands in for the real giant (GasGiant.tsx) in that
 * photograph only. Its map and rings, lit by the Sun; hidden the rest of the time.
 */
const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vLocal;
void main() {
    vUv = uv;
    vLocal = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const planetFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uSun;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
    #include <logdepthbuf_fragment>
    float light = max(dot(normalize(vNormal), uSun), 0.0);
    vec3 albedo = texture2D(uMap, vUv).rgb;
    gl_FragColor = vec4(albedo * (light * 1.6 + 0.015), 1.0);
    #include <colorspace_fragment>
}
`;

const ringFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${RING_GLSL}
uniform vec3 uColor;
uniform float uRadius;
varying vec3 vLocal;
void main() {
    #include <logdepthbuf_fragment>
    float density = ringDensity(length(vLocal) / uRadius);
    if (density < 0.01) discard;
    gl_FragColor = vec4(uColor * (0.35 + 0.65 * density), density * 0.9);
    #include <colorspace_fragment>
}
`;

const sunWorld = new THREE.Vector3();

export const createSaturnStandIn = () => {
    const saturn = findBody('beyond')!;
    const gas = saturn.gas!;
    const axis = fromEquatorial(gas.pole[0], gas.pole[1]);
    const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const group = new THREE.Group();
    group.visible = false;
    group.userData.deferCompile = true;

    const sphere = new THREE.SphereGeometry(saturn.radius, 96, 64).applyQuaternion(align);
    const map = gas.map ? gasMapTexture(gas.map) : null;
    const planetMaterial = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader: planetFragment,
        uniforms: { uMap: { value: map }, uSun: { value: new THREE.Vector3(1, 0, 0) } },
    });
    group.add(new THREE.Mesh(sphere, planetMaterial));

    let ringMaterial: THREE.ShaderMaterial | null = null;
    let ringGeometry: THREE.BufferGeometry | null = null;
    if (gas.rings) {
        ringGeometry = new THREE.RingGeometry(saturn.radius * gas.rings.inner, saturn.radius * gas.rings.outer, 256, 4)
            .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis));
        ringMaterial = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader: ringFragment,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            uniforms: { uColor: { value: new THREE.Color(gas.rings.color) }, uRadius: { value: saturn.radius } },
        });
        group.add(new THREE.Mesh(ringGeometry, ringMaterial));
    }

    return {
        group,
        /** Put it where Saturn is now (scene units), turned as it is, lit from the Sun. */
        place: (motion: Motion, origin: THREE.Vector3) => {
            group.position.copy(saturn.position).sub(origin);
            group.quaternion.copy(orientationOf(motion, saturn));
            sunWorld.copy(THE_SUN.position).sub(saturn.position).normalize();
            (planetMaterial.uniforms.uSun.value as THREE.Vector3).copy(sunWorld);
        },
        dispose: () => {
            sphere.dispose();
            planetMaterial.dispose();
            ringGeometry?.dispose();
            ringMaterial?.dispose();
        },
    };
};
