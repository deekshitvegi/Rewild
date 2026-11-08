import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, startPosition, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { useEnvironmentOn, useModel } from './models';
import type { ExpeditionRuntime } from './runtime';

/**
 * Domes the explorer builds (the fabricator, C): a pressurised dome of the kind the colony on
 * Haven lives in, set up where they stand, on any world with ground. Inside it there is air to
 * breathe, the suit cools down, storms, heat and radiation are kept out, and wounds mend. They
 * stay where they were put (kept on this device), so a world can have its own base.
 */
export interface DomeSite { id: string; body: string; direction: [number, number, number]; at: number }

const KEY = 'rewild-domes';
/** Metres: the dome's radius on the ground, and how high inside counts as inside. */
export const DOME_RADIUS = 6;
const DOME_HEIGHT = 5;
const SHOW_WITHIN = 7000;

export const loadDomes = (): DomeSite[] => {
    try {
        const list = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as DomeSite[];
        return Array.isArray(list) ? list.filter((d) => d && typeof d.body === 'string' && Array.isArray(d.direction)) : [];
    } catch {
        return [];
    }
};
const saveDomes = (list: DomeSite[]) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(list.slice(-60)));
    } catch {
        // Kept for this visit only.
    }
};

/** Where a dome stands (the world's frame of the start, as everything laid on a world). */
export const domeCentre = (body: ExpeditionBody, direction: THREE.Vector3, out = new THREE.Vector3()) =>
    out.copy(startPosition(body)).addScaledVector(direction, body.radius + groundHeight(body, direction));

/** Put up a dome at a direction on a world; it is drawn and works from the next frame. */
export const addDome = (runtime: ExpeditionRuntime, body: ExpeditionBody, direction: THREE.Vector3) => {
    const site: DomeSite = { id: `dome-${Date.now()}`, body: body.id, direction: [direction.x, direction.y, direction.z], at: Date.now() };
    runtime.domes = [...runtime.domes, site];
    saveDomes(runtime.domes);
};

const local = new THREE.Vector3();

export const Domes = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const [version, setVersion] = useState(0);
    const seen = useRef(runtime.domes);
    useEffect(() => {
        if (!runtime.domes.length) runtime.domes = loadDomes();
        seen.current = runtime.domes;
        setVersion((v) => v + 1);
    }, [runtime]);
    // Inside one: the suit and the weather read this (walking.ts, Weather.tsx).
    useFrame(() => {
        if (runtime.domes !== seen.current) {
            seen.current = runtime.domes;
            setVersion((v) => v + 1);
        }
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const body = runtime.currentBody;
        let inside = false;
        if (walker && body) {
            for (const site of runtime.domes) {
                if (site.body !== body.id) continue;
                const direction = local.set(site.direction[0], site.direction[1], site.direction[2]);
                const centre = domeCentre(body, direction, new THREE.Vector3());
                const d = local.copy(walker.position).sub(centre);
                const up = centre.clone().sub(startPosition(body)).normalize();
                const height = d.dot(up);
                d.addScaledVector(up, -height);
                if (height > -1 && height < DOME_HEIGHT && d.length() < DOME_RADIUS - 0.6) {
                    inside = true;
                    break;
                }
            }
        }
        runtime.inDome = inside;
    });
    useEffect(() => () => { runtime.inDome = false; }, [runtime]);
    const here = runtime.currentBody?.id ?? null;
    const list = useMemo(() => runtime.domes.filter((d) => d.body === here), [here, version, runtime]); // eslint-disable-line react-hooks/exhaustive-deps
    return <>{list.map((site) => <DomeView key={site.id} site={site} runtime={runtime} />)}</>;
};

const DomeView = ({ site, runtime }: { site: DomeSite; runtime: ExpeditionRuntime }) => {
    const { gl } = useThree();
    const gltf = useModel('havenDome');
    useEnvironmentOn(gltf?.scene ?? null, gl, 0.5);
    const body = useMemo(() => findBody(site.body) as ExpeditionBody, [site]);
    const groupRef = useRef<THREE.Group>(null);
    const { centre, orientation } = useMemo(() => {
        const direction = new THREE.Vector3(...site.direction).normalize();
        const centre = domeCentre(body, direction);
        const orientation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
        return { centre, orientation };
    }, [site, body]);
    const model = useMemo(() => {
        if (!gltf) return null;
        const root = gltf.scene.clone(true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        // As wide as the dome is meant to be, sitting on the ground.
        const scale = (DOME_RADIUS * 2) / Math.max(size.x, size.z, 1e-3);
        root.scale.setScalar(scale);
        root.position.y = -box.min.y * scale - 0.15;
        return root;
    }, [gltf]);
    useFrame(() => {
        const group = groupRef.current;
        if (!group) return;
        group.visible = centre.distanceTo(runtime.camera) < SHOW_WITHIN;
        group.position.copy(centre).sub(runtime.origin);
        group.quaternion.copy(orientation);
    });
    return model ? <group ref={groupRef}><primitive object={model} /></group> : null;
};
