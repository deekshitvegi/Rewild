import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Ship, type ShipHandle } from './Ship';
import { Astronaut, type AstronautHandle } from './Astronaut';
import { shipPose, walkerPose, type CrewMember } from './crew';
import { LIVERIES } from './livery';
import type { ExpeditionRuntime } from './runtime';

/**
 * The rest of the crew, where they were left: each one's own ship parked, and anyone out on foot
 * standing where they were. The one being played is drawn by
 * Player. Held in their world's frame (crew.ts), so they go round with it; drawn only when near
 * enough to be seen.
 */
const SHIP_SEEN = 60000;
const WALKER_SEEN = 3000;

const position = new THREE.Vector3();
const turn = new THREE.Quaternion();
const facing = new THREE.Vector3();
const up = new THREE.Vector3();
const back = new THREE.Vector3();
const right = new THREE.Vector3();
const basis = new THREE.Matrix4();

/** Who needs drawing: parked ships of their own, and crew out on foot (not the one being played). */
const shown = (runtime: ExpeditionRuntime) => {
    const crew = runtime.crew;
    if (!crew) return { ships: [] as number[], walkers: [] as number[] };
    const ships: number[] = [];
    const walkers: number[] = [];
    crew.members.forEach((m: CrewMember, i) => {
        if (i === crew.active) return;
        ships.push(i);
        if (m.walker) walkers.push(i);
    });
    return { ships, walkers };
};

export const CrewFleet = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [version, setVersion] = useState(-1);
    const [cast, setCast] = useState(() => shown(runtime));
    const ships = useRef<(ShipHandle | null)[]>([]);
    const walkers = useRef<(AstronautHandle | null)[]>([]);

    useFrame(() => {
        const crew = runtime.crew;
        if (!crew) return;
        if (crew.version !== version) {
            setVersion(crew.version);
            setCast(shown(runtime));
        }
        const motion = runtime.motion;
        const eye = runtime.camera;
        cast.ships.forEach((index) => {
            const handle = ships.current[index];
            const member = crew.members[index];
            if (!handle?.group || !member) return;
            shipPose(member, motion, position, turn);
            const seen = !member.ship.destroyed && position.distanceTo(eye) < SHIP_SEEN;
            handle.group.visible = seen;
            if (!seen) return;
            handle.group.position.copy(position).sub(runtime.origin);
            handle.group.quaternion.copy(turn);
            handle.setGear(member.ship.gear);
            handle.setThrust(member.ship.landed ? 0 : 0.12);
            handle.setShield(0);
        });
        cast.walkers.forEach((index) => {
            const handle = walkers.current[index];
            const member = crew.members[index];
            if (!handle?.group || !member?.walker) return;
            walkerPose(member, motion, position, facing);
            const seen = position.distanceTo(eye) < WALKER_SEEN;
            handle.group.visible = seen;
            if (!seen) return;
            const body = member.walker.body;
            up.copy(position).sub(body.position).normalize();
            back.copy(facing).negate();
            right.crossVectors(up, back).normalize();
            back.crossVectors(right, up).normalize();
            basis.makeBasis(right, up, back);
            handle.group.position.copy(position).sub(runtime.origin);
            handle.group.quaternion.setFromRotationMatrix(basis);
            handle.setGait(0, 0);
            handle.setJetpack(false);
            handle.setMotion(member.walker.sitting ? 'sit' : 'idle');
        });
    });

    return (
        <>
            {cast.ships.map((index) => (
                <Ship key={`ship-${index}`} ref={(h) => { ships.current[index] = h; }} livery={LIVERIES[runtime.crew!.members[index].def.id]} />
            ))}
            {cast.walkers.map((index) => (
                <Astronaut key={`walker-${index}`} ref={(h) => { walkers.current[index] = h; }} livery={LIVERIES[runtime.crew!.members[index].def.id]} />
            ))}
        </>
    );
};
