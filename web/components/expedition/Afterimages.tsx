import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { bodyWarp, stretchMatrix } from './spacetime';
import { compileSafely } from './compileSafely';

/**
 * Afterimages of the player's ship (spacetime.ts bodyWarp): see-through copies of its meshes strung
 * out behind it along the line it is being stretched along, each a little more stretched, further
 * aside and fainter than the last, tinted by the light it is seen in; and a dark copy over the ship
 * itself for when it is seen against a bright light. They share the ship's geometry; each frame they
 * take the ship's own transform, as it is being drawn, and shift it. Mounted only while there are
 * afterimages or a shade to draw (AfterimagesWatch). Their two small shaders are compiled in the
 * background soon after the start, so the first crossing does not wait on them.
 */
const MAX_GHOSTS = 6;

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalView;
varying vec3 vViewPosition;
void main() {
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    vNormalView = normalize(transformedNormal);
    #include <begin_vertex>
    #include <project_vertex>
    vViewPosition = -mvPosition.xyz;
    #include <logdepthbuf_vertex>
}
`;

const ghostFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform float uStrength;
varying vec3 vNormalView;
varying vec3 vViewPosition;
void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalView);
    vec3 v = normalize(vViewPosition);
    float facing = abs(dot(n, v));
    float rim = pow(1.0 - facing, 2.0);
    // A see-through copy of the ship: its shape shaded softly from the eye, brightest at the edges.
    vec3 color = uColor * (0.18 + 0.42 * facing + 1.5 * rim);
    gl_FragColor = vec4(color, clamp(uStrength * (0.5 + 0.5 * rim), 0.0, 1.0));
}
`;

const shadeFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uStrength;
void main() {
    #include <logdepthbuf_fragment>
    gl_FragColor = vec4(0.0, 0.0, 0.0, uStrength);
}
`;

// Shared and kept: compiled once, reused by every crossing and every fall.
const ghostMaterials = Array.from({ length: MAX_GHOSTS }, () => new THREE.ShaderMaterial({
    name: 'AfterimageMaterial',
    vertexShader,
    fragmentShader: ghostFragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uColor: { value: new THREE.Color() }, uStrength: { value: 0 } },
}));
const shadeMaterial = new THREE.ShaderMaterial({
    name: 'ShadeMaterial',
    vertexShader,
    fragmentShader: shadeFragment,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    toneMapped: false,
    uniforms: { uStrength: { value: 0 } },
});

const ghostMatrix = new THREE.Matrix4();
const offset = new THREE.Matrix4();
const centre = new THREE.Vector3();
const identity = new THREE.Quaternion();

/** The meshes worth copying: solid ones that are being drawn (not glows, sprites or skinned bodies). */
const collect = (roots: THREE.Object3D[]) => {
    const found: THREE.Mesh[] = [];
    for (const root of roots) {
        if (!root.visible) continue;
        root.traverseVisible((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh || (object as THREE.SkinnedMesh).isSkinnedMesh || (object as THREE.InstancedMesh).isInstancedMesh) return;
            const material = mesh.material as THREE.Material;
            if (!material || Array.isArray(mesh.material) || material.transparent || material.blending !== THREE.NormalBlending) return;
            if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
            found.push(mesh);
        });
    }
    return found;
};

interface Copy { source: THREE.Mesh; mesh: THREE.Mesh; ghost: number }

const Afterimages = ({ sources }: { sources: () => THREE.Object3D[] }) => {
    const groupRef = useRef<THREE.Group>(null);
    // The copies, rebuilt when the set of meshes being drawn changes (the sculpted model arriving, docking).
    const built = useRef<{ key: string; copies: Copy[] }>({ key: '', copies: [] });

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        const meshes = collect(sources());
        const key = meshes.map((m) => m.id).join(',');
        if (key !== built.current.key) {
            for (const copy of built.current.copies) group.remove(copy.mesh);
            const copies: Copy[] = [];
            for (const source of meshes) {
                // -1: the shade over the ship itself; 0..: afterimages.
                for (let ghost = -1; ghost < MAX_GHOSTS; ghost++) {
                    const mesh = new THREE.Mesh(source.geometry, ghost < 0 ? shadeMaterial : ghostMaterials[ghost]);
                    mesh.matrixAutoUpdate = false;
                    mesh.matrixWorldAutoUpdate = false;
                    mesh.frustumCulled = false;
                    // The faintest first, so the nearer ones lie over them.
                    // After the throat (WormholeTransit, order 10000), which would otherwise paint over them: they write no depth.
                    mesh.renderOrder = ghost < 0 ? 10006 : 10005 - ghost * 0.01;
                    mesh.userData.noMirror = true;
                    // At render time, the ship's own transform (just worked out for this frame), shifted back along the line.
                    mesh.onBeforeRender = () => {
                        if (ghost < 0) {
                            mesh.matrixWorld.copy(source.matrixWorld);
                            return;
                        }
                        const n = ghost + 1;
                        centre.copy(bodyWarp.centre).addScaledVector(bodyWarp.axis, bodyWarp.ghostStep * n).addScaledVector(bodyWarp.ghostSpread, n);
                        stretchMatrix(bodyWarp.axis, 1 + bodyWarp.ghostStretch * n, centre, identity, ghostMatrix);
                        offset.makeTranslation(
                            bodyWarp.axis.x * bodyWarp.ghostStep * n + bodyWarp.ghostSpread.x * n,
                            bodyWarp.axis.y * bodyWarp.ghostStep * n + bodyWarp.ghostSpread.y * n,
                            bodyWarp.axis.z * bodyWarp.ghostStep * n + bodyWarp.ghostSpread.z * n,
                        );
                        mesh.matrixWorld.multiplyMatrices(ghostMatrix, offset).multiply(source.matrixWorld);
                    };
                    group.add(mesh);
                    copies.push({ source, mesh, ghost });
                }
            }
            built.current = { key, copies };
        }
        const count = Math.min(MAX_GHOSTS, Math.round(bodyWarp.ghosts));
        for (const copy of built.current.copies) {
            copy.mesh.visible = copy.ghost < 0 ? bodyWarp.shade > 0.002 : copy.ghost < count && bodyWarp.ghostStrength > 0.002;
        }
        shadeMaterial.uniforms.uStrength.value = Math.min(1, bodyWarp.shade);
        ghostMaterials.forEach((material, i) => {
            // Each one fainter than the one before.
            material.uniforms.uStrength.value = bodyWarp.ghostStrength * Math.pow(0.7, i);
            (material.uniforms.uColor.value as THREE.Color).copy(bodyWarp.ghostColor);
        });
    });
    useEffect(() => () => {
        const group = groupRef.current;
        if (group) for (const copy of built.current.copies) group.remove(copy.mesh);
    }, []);
    return <group ref={groupRef} />;
};

/** Mounts the afterimages while there are any to draw; compiles their shaders once, in the background, after the start. */
export const AfterimagesWatch = ({ sources }: { sources: () => THREE.Object3D[] }) => {
    const [on, setOn] = useState(false);
    const { gl, camera } = useThree();
    useEffect(() => {
        if (!gl.extensions.get('KHR_parallel_shader_compile')) return undefined;
        const timer = window.setTimeout(() => {
            const probe = new THREE.Group();
            const box = new THREE.BoxGeometry(1, 1, 1);
            [...ghostMaterials.slice(0, 1), shadeMaterial].forEach((material) => probe.add(new THREE.Mesh(box, material)));
            compileSafely(gl, probe, camera).then(() => box.dispose());
        }, 16000);
        return () => window.clearTimeout(timer);
    }, [gl, camera]);
    useFrame(() => {
        const want = bodyWarp.ghosts > 0.5 || bodyWarp.shade > 0.002;
        if (want !== on) setOn(want);
    });
    return on ? <Afterimages sources={sources} /> : null;
};
