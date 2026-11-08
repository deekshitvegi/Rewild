import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { findBody, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { useEnvironmentOn, useModel } from './models';
import { colonyLayers, generateLandmarks } from './propPlacement';
import { landingZoneDirection } from './sites';
import type { ExpeditionRuntime } from './runtime';

/**
 * The people of Haven (docs/story.md): the colony the ark Halcyon brought from Earth, going about
 * their day between the greenhouses, the habitats and the ark. Each walks from one place to the
 * next and stops a while; walk up to one and press E to hear what they have to say. Drawn only
 * while the player is at Haven (the frame then follows it, so its start frame is the game's).
 */
interface Person { name: string; model: 'colonistWoman' | 'colonistMan'; line: string }
const PEOPLE: Person[] = [
    { name: 'Mara Ilunga', model: 'colonistWoman', line: 'One day here is ten years on Earth. Take the years it needs; we will only miss you for a day.' },
    { name: 'Tomas Reyes', model: 'colonistMan', line: 'The orbit drops a little every week. The council says we have a month here. Maybe.' },
    { name: 'Ines Halvorsen', model: 'colonistWoman', line: 'My grandmother was born in Oslo. I would like to see snow that is not ash.' },
    { name: 'Jun Park', model: 'colonistMan', line: 'The domes feed four hundred of us. Earth could feed everyone, if it greens again.' },
    { name: 'Ama Boateng', model: 'colonistWoman', line: 'When the Halcyon comes down at home, I want to be first down the ramp.' },
    { name: 'Elias Varga', model: 'colonistMan', line: 'Noor left us her last seeds. Bring the rest of them back where they belong.' },
    { name: 'Sofia Marchetti', model: 'colonistWoman', line: 'Look at it up there. It is beautiful, and one day it is going to eat us.' },
    { name: 'Ravi Menon', model: 'colonistMan', line: 'Kai fixed the water plant before you left. Tell him it is still running.' },
];

/** Metres a second, and how close counts as beside someone. */
const WALK = 1.2;
const TALK = 4.5;

interface Walker {
    person: Person;
    root: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    walk: THREE.AnimationAction | null;
    /** Where they are (unit direction from Haven's centre), where they are going, and how long they wait there. */
    at: THREE.Vector3;
    to: number;
    wait: number;
    heading: THREE.Vector3;
}

const up = new THREE.Vector3();
const toward = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();
const place = new THREE.Vector3();

const ColonyPeople = ({ body, runtime }: { body: ExpeditionBody; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const woman = useModel('colonistWoman');
    const man = useModel('colonistMan');
    const group = useRef<THREE.Group>(null);
    useEnvironmentOn(woman?.scene ?? null, gl, 0.35);
    useEnvironmentOn(man?.scene ?? null, gl, 0.35);

    // Where they go: just outside each dome, habitat and the ark, and the middle of the colony.
    const stops = useMemo(() => {
        const zone = landingZoneDirection(body);
        const out: THREE.Vector3[] = [zone.clone()];
        for (const layer of colonyLayers()) {
            for (const mark of generateLandmarks(body, layer, zone)) {
                const dir = mark.position.clone().sub(body.position).normalize();
                // Stand off from the building's middle, on the side facing the colony's.
                const back = zone.clone().sub(dir).normalize();
                const offset = (mark.scale * (layer.id === 'haven-ark' ? 0.45 : 1.1)) / body.radius;
                out.push(dir.addScaledVector(back, offset).normalize());
            }
        }
        return out;
    }, [body]);

    const walkers = useMemo<Walker[]>(() => {
        if (!woman || !man) return [];
        return PEOPLE.map((person, i) => {
            const gltf = person.model === 'colonistWoman' ? woman : man;
            const root = cloneSkinned(gltf.scene);
            root.traverse((object) => { object.frustumCulled = false; });
            const mixer = new THREE.AnimationMixer(root);
            const clip = gltf.animations[0];
            const walk = clip ? mixer.clipAction(clip) : null;
            if (walk) {
                walk.play();
                walk.time = (i * 0.37) % clip.duration;
            }
            const start = stops[(i * 3 + 1) % stops.length].clone();
            // Spread out round where they start.
            start.add(new THREE.Vector3(Math.sin(i * 2.4), Math.cos(i * 1.7), Math.sin(i * 3.1)).multiplyScalar(6 / body.radius)).normalize();
            return { person, root, mixer, walk, at: start, to: (i * 5 + 2) % stops.length, wait: i * 1.3, heading: new THREE.Vector3(1, 0, 0) };
        });
    }, [woman, man, stops, body]);

    useEffect(() => () => { walkers.forEach((w) => w.mixer.stopAllAction()); }, [walkers]);

    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        const paused = !!runtime.sites.open || runtime.menuOpen;
        const listener = runtime.mode === 'walk' ? runtime.hud.walker?.position ?? null : null;
        let nearest: { person: Person; metres: number } | null = null;
        for (const w of walkers) {
            up.copy(w.at);
            if (!paused) {
                if (w.wait > 0) {
                    w.wait -= dt;
                } else {
                    // On towards the next stop, along the ground.
                    toward.copy(stops[w.to]).sub(w.at);
                    const gap = toward.length() * body.radius;
                    if (gap < 1.5) {
                        w.wait = 4 + ((w.to * 7) % 9);
                        w.to = (w.to + 1 + (w.person.name.length % 3)) % stops.length;
                    } else {
                        toward.addScaledVector(up, -toward.dot(up)).normalize();
                        w.heading.lerp(toward, 1 - Math.exp(-dt * 3)).normalize();
                        w.at.addScaledVector(w.heading, (WALK * dt) / body.radius).normalize();
                    }
                }
                if (w.walk) {
                    w.walk.paused = w.wait > 0;
                    if (w.wait > 0) w.walk.time = 0;
                }
                w.mixer.update(dt);
            }
            const height = groundHeight(body, w.at);
            place.copy(body.position).addScaledVector(w.at, body.radius + height);
            w.root.position.copy(place).sub(runtime.origin);
            // Model faces +Z: x = up × forward.
            up.copy(w.at);
            const forward = toward.copy(w.heading).addScaledVector(up, -w.heading.dot(up)).normalize();
            right.crossVectors(up, forward).normalize();
            basis.makeBasis(right, up, forward);
            w.root.quaternion.setFromRotationMatrix(basis);
            if (listener) {
                const metres = listener.distanceTo(place);
                if (metres < TALK && (!nearest || metres < nearest.metres)) nearest = { person: w.person, metres };
            }
        }
        const found = nearest as { person: Person; metres: number } | null;
        runtime.colonist = found ? { name: found.person.name, line: found.person.line } : null;
    });

    useEffect(() => () => { runtime.colonist = null; }, [runtime]);

    return (
        <group ref={group}>
            {walkers.map((w) => <primitive key={w.person.name} object={w.root} />)}
        </group>
    );
};

/** The colonists, while the player is at Haven. */
export const Colonists = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [here, setHere] = useState(false);
    useFrame(() => {
        const at = runtime.currentBody?.id === 'haven';
        if (at !== here) setHere(at);
    });
    const body = findBody('haven');
    return here && body ? <ColonyPeople body={body} runtime={runtime} /> : null;
};
