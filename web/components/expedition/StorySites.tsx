import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { say } from './argo';
import { readScript } from './contact';
import { fromStart, turnFromStart } from './motion';
import { useEnvironmentOn, useModel } from './models';
import { cue, type ExpeditionRuntime } from './runtime';
import { STORY_FINDS, findFrame, findsOn, type StoryFind } from './story';

/**
 * The trail's stones and the other finds of story.ts, standing on their
 * worlds: drawn within a few kilometres (the seed ship, six hundred metres
 * long, from further), found by coming close. A stone's message reads as far
 * as the Makers' letters have been learned; read later, the Story tab (J)
 * shows it again with whatever has been learned since.
 */
const showWithin = (find: StoryFind) => Math.max(3200, find.size * 14);

export const StorySites = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [ids, setIds] = useState<string[]>([]);
    const current = useRef('');
    const at = useMemo(() => new THREE.Vector3(), []);
    useFrame(() => {
        const near: string[] = [];
        const body = runtime.currentBody;
        if (body) {
            for (const find of findsOn(body)) {
                fromStart(runtime.motion, body, findFrame(find).centre, at);
                if (at.distanceTo(runtime.camera) < showWithin(find)) near.push(find.id);
            }
        }
        const key = near.join(',');
        if (key !== current.current) {
            current.current = key;
            setIds(near);
        }
    });
    return (
        <>
            {ids.map((id) => {
                const find = STORY_FINDS.find((f) => f.id === id)!;
                return <FindView key={id} find={find} runtime={runtime} />;
            })}
        </>
    );
};

const toFind = new THREE.Vector3();
const basis = new THREE.Matrix4();
const startTurn = new THREE.Quaternion();

const FindView = ({ find, runtime }: { find: StoryFind; runtime: ExpeditionRuntime }) => {
    const body = useMemo(() => findBody(find.body) as ExpeditionBody, [find]);
    const frame = useMemo(() => findFrame(find), [find]);
    const gltf = useModel(find.model);
    const gl = useThree((state) => state.gl);
    const groupRef = useRef<THREE.Group>(null);
    // The model scaled to its size, stood up (or laid down) on the local ground, sunk in a little.
    const root = useMemo(() => {
        if (!gltf) return null;
        const scene = gltf.scene.clone(true);
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        const scale = find.size / Math.max(size.x, size.y, size.z, 1e-6);
        const holder = new THREE.Group();
        scene.position.copy(centre).multiplyScalar(-1);
        const inner = new THREE.Group();
        inner.add(scene);
        if (find.lying) {
            // The long axis (+z) along the ground (east), its height (y) still up.
            inner.rotation.set(0, Math.PI / 2, 0);
        }
        inner.scale.setScalar(scale);
        const height = (find.lying ? size.y : size.y) * scale;
        inner.position.y = height * (0.5 - (find.sink ?? 0));
        holder.add(inner);
        scene.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
                mesh.frustumCulled = true;
                // Far off (the seed ship from orbit) it is still in the depth range of the world it is on.
                mesh.renderOrder = 0;
            }
        });
        return holder;
    }, [gltf, find]);
    useEnvironmentOn(root, gl, 0.35);
    useEffect(() => () => {
        root?.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) mesh.geometry.dispose();
        });
    }, [root]);

    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        fromStart(runtime.motion, body, frame.centre, toFind);
        group.position.copy(toFind).sub(runtime.origin);
        startTurn.setFromRotationMatrix(basis.makeBasis(frame.east, frame.up, frame.north.clone().negate()));
        turnFromStart(runtime.motion, body, startTurn, group.quaternion);
        // Found: close enough to see it for what it is.
        if (!runtime.stats.visited.includes(find.id) && toFind.distanceTo(runtime.camera) < find.reach + 30) {
            runtime.stats.visited.push(find.id);
            cue(runtime, 'chapter', 0.9);
            const message = find.script ? ` "${readScript(find.script, runtime.letters)}"` : '';
            runtime.scan.found = { label: find.label, name: find.name, blurb: `${find.blurb}${message}` };
            runtime.scan.foundAt = performance.now() / 1000;
            say(runtime.argo, find.argo, 'info');
            const next = find.trail ? STORY_FINDS.find((f) => f.trail === find.trail! + 1) : null;
            if (next) say(runtime.argo, `${next.hint} That is ${findBody(next.body)?.name ?? ''}.`, 'info');
        }
    });

    return root ? <group ref={groupRef}><primitive object={root} /></group> : null;
};
