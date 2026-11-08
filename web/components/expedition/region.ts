import type * as THREE from 'three';
import { findBody, type ExpeditionBody } from './bodies';
import { BLACK_HOLE } from './deepSpace';

/**
 * The game is two systems joined by the wormhole: ours (`sol`: the Sun, the planets and their
 * moons, the mouth by Saturn) and TON 618's (`ton`: the black hole, Haven, the far mouth). Only
 * the one the player is in is built and drawn; the other is taken down, and put up again behind
 * the film of the crossing (WormholeFilm.tsx) when the Argo goes through.
 */
export type Region = 'sol' | 'ton';

/** Anything nearer TON 618 than this is in its system (it is 40 billion units from the Sun). */
const TON_REACH = 1e10;

/** Which system a world belongs to. */
export const regionOf = (body: ExpeditionBody): Region => (body.outsideSystem ? 'ton' : 'sol');

/** Which system a point (game frame) is in. */
export const regionAt = (point: THREE.Vector3): Region =>
    point.distanceTo(BLACK_HOLE.position) < TON_REACH ? 'ton' : 'sol';

/** Which system a wormhole mouth opens into. */
export const mouthRegion = (id: string): Region => (id === 'wormhole-ton618' ? 'ton' : 'sol');

/** The system an expedition begins in: where its first world is (Earth unless said). */
export const startRegion = (bodyId?: string): Region => {
    const body = findBody(bodyId ?? 'projects');
    return body ? regionOf(body) : 'sol';
};

/** Names as they read mid-sentence ("Loading the Solar System"). */
/** How far the system being built behind the crossing film has got, 0 to 1 (RegionGate sets it; the film's bar shows it). */
export const regionLoad = { value: 0 };

export const REGION_NAME: Record<Region, string> = { sol: 'the Solar System', ton: 'TON 618' };
