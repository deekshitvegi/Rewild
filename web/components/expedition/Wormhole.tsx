import * as THREE from 'three';
import type { WormholeMouth } from './deepSpace';

/**
 * A wormhole mouth, drawn the way Interstellar's was worked out (James, von
 * Tunzelmann, Franklin and Thorne, "Visualizing Interstellar's Wormhole",
 * 2015): not a tunnel but a sphere, a crystal ball holding the whole sky of
 * the other side, with this side's sky bent round its edge.
 *
 * Space around it has the shape r(l) = 1 + W (sqrt(1 + (l / W)^2) - 1), in
 * throat radii, l being distance through the throat: flat far away, curving
 * into the throat over the lensing width W. (W = 1 is the Ellis wormhole; the
 * film's was thinner, which gives the crisp edge.) A ray from the camera keeps
 * its impact parameter b; if b < 1 and it is heading in, it passes the throat
 * and leaves on the other side, otherwise it swings round and leaves on this
 * side. How far round it swings is an integral along the ray, done here with
 * Gauss-Legendre quadrature. Near b = 1 rays wind round the throat: the thin
 * bright ring at the edge.
 *
 * Both skies are photographs (cube maps) taken by DeepSpace.tsx: this side's
 * from the camera, the other side's from the matching point beyond the other
 * mouth, so that crossing the throat changes nothing on screen.
 */

/**
 * The two skies for the crossing (WormholeTransit.tsx), by the mouth it comes out of: ahead, the
 * far side's photograph; behind, this side's; each with the turn from the game's frame now to the
 * one it was taken in. Kept up to date by DeepSpace.tsx.
 */
export interface TunnelSkies { ahead: THREE.Texture | null; behind: THREE.Texture | null; aheadTurn: THREE.Matrix3; behindTurn: THREE.Matrix3 }
export const TUNNEL_SKIES: Record<string, TunnelSkies> = {};
export const tunnelSkies = (to: string) => (TUNNEL_SKIES[to] ??= { ahead: null, behind: null, aheadTurn: new THREE.Matrix3(), behindTurn: new THREE.Matrix3() });

/** The bent region reaches this many throat radii from the centre. */
export const MOUTH_REACH = 2.2;
/** Lensing width, in throat radii. */
const WIDTH = 0.25;

const glsl = (values: number[]) => `float[${values.length}](${values.map((v) => v.toPrecision(9)).join(', ')})`;
// 12-point Gauss-Legendre nodes and weights on [0, 1]: within 0.01 degrees of
// the exact bending, even a hundredth of a radius from the edge.
const NODES = [0.00921968288, 0.0479413718, 0.115048663, 0.206341023, 0.316084251, 0.437383296, 0.562616704, 0.683915749, 0.793658977, 0.884951337, 0.952058628, 0.990780317];
const WEIGHTS = [0.0235876682, 0.053469663, 0.0800391643, 0.101583713, 0.116746268, 0.124573523, 0.124573523, 0.116746268, 0.101583713, 0.0800391643, 0.053469663, 0.0235876682];

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uCamLocal;
uniform float uRadius;
uniform samplerCube uLocalSky;
uniform samplerCube uThroughSky;
uniform float uHasLocal;
uniform mat3 uLink;
uniform float uHaze;
// From the game's frame now to the frame each photograph was taken in (the sky turns as the
// game's frame follows a world, motion.ts; turning the lookup costs nothing, retaking costs 6 renders).
uniform mat3 uLocalTurn;
uniform mat3 uThroughTurn;
varying vec3 vLocal;

const float REACH = ${MOUTH_REACH.toFixed(2)};

const float WIDTH = ${WIDTH.toFixed(3)};
const float NODES[12] = ${glsl(NODES)};
const float WEIGHTS[12] = ${glsl(WEIGHTS)};

// How far round the centre a ray of impact parameter b swings between
// infinity and 1 / U throat radii. The substitution u = U s (2 - s) takes out
// the square-root singularity at U, where the ray turns or meets the throat.
float swing(float U, float b) {
    float sum = 0.0;
    for (int i = 0; i < 12; i++) {
        float x = NODES[i];
        float u = U * x * (2.0 - x);
        float stretch = 1.0 + (1.0 / max(u, 1e-6) - 1.0) / WIDTH;
        float curve = inversesqrt(max(1.0 - 1.0 / (stretch * stretch), 1e-8));
        sum += WEIGHTS[i] * curve * (1.0 - x) * inversesqrt(max(1.0 - b * b * u * u, 1e-8));
    }
    return sum * 2.0 * U * b;
}

void main() {
    #include <logdepthbuf_fragment>
    vec3 camera = uCamLocal / uRadius;
    vec3 rd = normalize(vLocal / uRadius - camera);
    float distance = length(camera);
    vec3 n = camera / max(distance, 1e-6);
    // A frame inside the throat before the crossing is handed over reads as on it.
    float r0 = max(distance, 1.0002);

    // The ray's plane holds n and its sideways direction t; psi is its angle from n.
    float cosPsi = dot(rd, n);
    vec3 side = rd - n * cosPsi;
    float sinPsi = length(side);
    vec3 t = sinPsi > 1e-6 ? side / sinPsi : vec3(0.0);
    float b = r0 * sinPsi;
    bool inward = cosPsi < 0.0;
    bool through = inward && b < 1.0;

    // phi: how far the ray swings round the centre on its way out to
    // infinity, on this side or (through the throat) the other.
    float fromHere = swing(1.0 / r0, b);
    float phi = fromHere;
    if (inward) phi = 2.0 * swing(b < 1.0 ? 1.0 : 1.0 / b, b) - fromHere;
    // It leaves radially, from where it ends up.
    vec3 outgoing = n * cos(phi) + t * sin(phi);

    // This side: bending eases off to nothing at the edge of the region, so
    // the edge meets the real sky without a seam.
    float taper = 1.0 - smoothstep(REACH * 0.7, REACH * 0.98, b);
    vec3 localDirection = normalize(mix(rd, outgoing, taper));
    vec3 localColor = textureCube(uLocalSky, uLocalTurn * localDirection).rgb;
    // The other side: carried over by the link between the mouths (the radial
    // part turns round on the way through, hence the minus).
    vec3 farColor = textureCube(uThroughSky, uThroughTurn * -(uLink * outgoing)).rgb;
    // Seen through an atmosphere, the other side is veiled by this sky's light.
    vec3 veil = textureCube(uLocalSky, uLocalTurn * rd).rgb;

    if (!through && uHasLocal < 0.5) discard;
    vec3 color = through ? mix(farColor, veil, uHaze) : localColor;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vLocal;
void main() {
    vLocal = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
}
`;

const cameraWorld = new THREE.Vector3();
const linkMatrix = new THREE.Matrix4();

/**
 * The mouth's mesh: a sphere, seen from inside (so it also works with the
 * camera within the bent region), that writes depth so that what is behind
 * the mouth, and was photographed into its sky, is not drawn again on top.
 */
export const createMouth = (mouth: WormholeMouth, localSky: THREE.Texture, throughSky: THREE.Texture) => {
    const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: true,
        uniforms: {
            uCamLocal: { value: new THREE.Vector3() },
            uRadius: { value: mouth.radius },
            uLocalSky: { value: localSky },
            uThroughSky: { value: throughSky },
            uHasLocal: { value: 0 },
            uLink: { value: new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(mouth.link)) },
            uHaze: { value: 0 },
            uLocalTurn: { value: new THREE.Matrix3() },
            uThroughTurn: { value: new THREE.Matrix3() },
        },
    });
    const geometry = new THREE.SphereGeometry(mouth.radius * MOUTH_REACH, 96, 64);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    // After Saturn's rings, before any atmosphere, which may lie in front of it.
    mesh.renderOrder = 1.5;
    // Whichever camera draws it (the player's, or a cube camera photographing
    // the sky) sees it from where that camera is.
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
        cameraWorld.setFromMatrixPosition(camera.matrixWorld);
        material.uniforms.uCamLocal.value.copy(cameraWorld).sub(mesh.position);
        // The link turns with the sky as the game's frame follows a world (motion.ts).
        (material.uniforms.uLink.value as THREE.Matrix3).setFromMatrix4(linkMatrix.makeRotationFromQuaternion(mouth.link));
    };
    return { mesh, material, geometry };
};
