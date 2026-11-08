import * as THREE from 'three';

/**
 * Lightning seen as lightning: a channel that forks and zigzags, burning
 * white-violet for a fraction of a second, rather than only a flash in the
 * cloud. On Jupiter and Saturn it runs between clouds (there is no ground):
 * deep in the water clouds, and, as Juno found, higher up in the ammonia and
 * water clouds too ("shallow lightning").
 *
 * A bolt is a set of straight segments; each is drawn as a ribbon a few
 * pixels wide that always faces the camera, additive and very bright, so the
 * bloom gives it its glare. It writes depth, so the cloud pass fogs it by its
 * real distance and hides it behind thick cloud.
 */

export interface BoltSegment {
    a: THREE.Vector3;
    b: THREE.Vector3;
    /** Half-width in pixels before the flash's own swelling, and brightness. */
    width: number;
    glow: number;
}

const perpendicular = (direction: THREE.Vector3, out: THREE.Vector3) => {
    out.set(1, 0, 0);
    if (Math.abs(direction.x) > 0.8) out.set(0, 1, 0);
    return out.cross(direction).normalize();
};

/** A jagged path from a to b: each segment's middle pushed sideways, level by level. */
const channel = (a: THREE.Vector3, b: THREE.Vector3, levels: number, roughness: number, random: () => number) => {
    let points = [a.clone(), b.clone()];
    const along = new THREE.Vector3();
    const side = new THREE.Vector3();
    const other = new THREE.Vector3();
    for (let level = 0; level < levels; level++) {
        const next: THREE.Vector3[] = [points[0]];
        for (let i = 0; i < points.length - 1; i++) {
            const p = points[i];
            const q = points[i + 1];
            along.subVectors(q, p);
            const length = along.length();
            along.divideScalar(Math.max(length, 1e-6));
            perpendicular(along, side);
            other.crossVectors(along, side);
            const angle = random() * Math.PI * 2;
            const push = (random() - 0.5) * 2 * roughness * length;
            next.push(p.clone().add(q).multiplyScalar(0.5)
                .addScaledVector(side, Math.cos(angle) * push)
                .addScaledVector(other, Math.sin(angle) * push), q);
        }
        points = next;
    }
    return points;
};

/**
 * One bolt between two points (the world's frame): its main channel and a
 * few forks off it, each fork thinner and fainter, some forking again.
 */
export const makeBolt = (from: THREE.Vector3, to: THREE.Vector3, random: () => number = Math.random): BoltSegment[] => {
    const segments: BoltSegment[] = [];
    const main = channel(from, to, 7, 0.24, random);
    for (let i = 0; i < main.length - 1; i++) segments.push({ a: main[i], b: main[i + 1], width: 1.4, glow: 1 });
    const length = from.distanceTo(to);
    const direction = new THREE.Vector3().subVectors(to, from).normalize();
    const side = new THREE.Vector3();
    const forks = 3 + Math.floor(random() * 4);
    for (let f = 0; f < forks; f++) {
        const start = main[Math.floor((0.15 + random() * 0.65) * (main.length - 1))];
        perpendicular(direction, side).applyAxisAngle(direction, random() * Math.PI * 2);
        const turn = THREE.MathUtils.degToRad(25 + random() * 35);
        const forkDirection = direction.clone().multiplyScalar(Math.cos(turn)).addScaledVector(side, Math.sin(turn)).normalize();
        const end = start.clone().addScaledVector(forkDirection, length * (0.2 + random() * 0.25));
        const fork = channel(start, end, 5, 0.26, random);
        for (let i = 0; i < fork.length - 1; i++) segments.push({ a: fork[i], b: fork[i + 1], width: 0.75, glow: 0.5 });
        // Now and then the fork forks again.
        if (random() < 0.5) {
            const twig = fork[Math.floor((0.3 + random() * 0.5) * (fork.length - 1))];
            const twigEnd = twig.clone().addScaledVector(forkDirection, length * 0.1).addScaledVector(side, length * (random() - 0.5) * 0.12);
            const small = channel(twig, twigEnd, 4, 0.28, random);
            for (let i = 0; i < small.length - 1; i++) segments.push({ a: small[i], b: small[i + 1], width: 0.5, glow: 0.3 });
        }
    }
    return segments;
};

/** Room for this many segments; a bolt rarely needs half of it. */
export const MAX_BOLT_SEGMENTS = 1400;

export const createBoltGeometry = () => {
    const vertices = MAX_BOLT_SEGMENTS * 4;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
    geometry.setAttribute('aStyle', new THREE.BufferAttribute(new Float32Array(vertices * 2), 2).setUsage(THREE.DynamicDrawUsage));
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const corner = geometry.getAttribute('aCorner') as THREE.BufferAttribute;
    const index: number[] = [];
    for (let s = 0; s < MAX_BOLT_SEGMENTS; s++) {
        const v = s * 4;
        corner.setXY(v, 0, -1);
        corner.setXY(v + 1, 0, 1);
        corner.setXY(v + 2, 1, -1);
        corner.setXY(v + 3, 1, 1);
        // Counter-clockwise on screen (the vertex shader puts corner y = +1 to
        // the left of the segment's direction), so the front face shows: the
        // other order made every quad a back face, culled, and no bolt was drawn.
        index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    geometry.setIndex(index);
    geometry.setDrawRange(0, 0);
    return geometry;
};

/** Puts a bolt's segments into the geometry (every vertex holds both ends of its segment). */
export const writeBolt = (geometry: THREE.BufferGeometry, segments: BoltSegment[]) => {
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const end = geometry.getAttribute('aEnd') as THREE.BufferAttribute;
    const style = geometry.getAttribute('aStyle') as THREE.BufferAttribute;
    const count = Math.min(segments.length, MAX_BOLT_SEGMENTS);
    for (let s = 0; s < count; s++) {
        const { a, b, width, glow } = segments[s];
        for (let k = 0; k < 4; k++) {
            position.setXYZ(s * 4 + k, a.x, a.y, a.z);
            end.setXYZ(s * 4 + k, b.x, b.y, b.z);
            style.setXY(s * 4 + k, width, glow);
        }
    }
    position.needsUpdate = true;
    end.needsUpdate = true;
    style.needsUpdate = true;
    geometry.setDrawRange(0, count * 6);
};

export const createBoltMaterial = () => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
        uViewport: { value: new THREE.Vector2(1, 1) },
        uLevel: { value: 0 },
    },
    vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec3 aEnd;
        attribute vec2 aCorner;
        attribute vec2 aStyle;
        uniform vec2 uViewport;
        uniform float uLevel;
        varying float vAcross;
        varying float vGlow;
        void main() {
            vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vec4 b = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);
            vGlow = aStyle.y;
            vAcross = aCorner.y;
            if (a.w <= 0.0 || b.w <= 0.0) {
                gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
                return;
            }
            vec2 sa = a.xy / a.w;
            vec2 sb = b.xy / b.w;
            vec2 along = (sb - sa) * uViewport;
            vec2 dir = length(along) > 1e-5 ? normalize(along) : vec2(1.0, 0.0);
            vec2 normal = vec2(-dir.y, dir.x);
            vec4 p = mix(a, b, aCorner.x);
            // A few pixels wide, swelling while the stroke is brightest.
            float halfWidth = aStyle.x * (1.1 + 1.6 * clamp(uLevel, 0.0, 1.5));
            p.xy += normal * aCorner.y * halfWidth * 2.0 / uViewport * p.w;
            gl_Position = p;
            #include <logdepthbuf_vertex>
        }`,
    fragmentShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform float uLevel;
        varying float vAcross;
        varying float vGlow;
        void main() {
            #include <logdepthbuf_fragment>
            float core = 1.0 - abs(vAcross);
            // A white-hot core with a violet fringe.
            vec3 hot = vec3(0.92, 0.94, 1.0) * pow(core, 3.0) * 34.0 + vec3(0.55, 0.6, 1.0) * core * 5.0;
            gl_FragColor = vec4(hot * uLevel * vGlow, 1.0);
        }`,
});
