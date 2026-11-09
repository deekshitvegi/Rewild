import * as THREE from 'three';
import { trackLoad } from './loadProgress';
import { fillMapTexture } from './mapLoader';
import { detailBudget } from './detailBudget';

/**
 * The giants' maps are large (Jupiter's is 3600 x 1800): one texture per map,
 * shared by the planet, its cloud decks and the volumetric clouds, instead of
 * a copy on the GPU for each.
 */
const maps = new Map<string, THREE.Texture>();
const lastAsked = new Map<string, number>();

export const gasMapTexture = (path: string) => {
    lastAsked.set(path, performance.now());
    let texture = maps.get(path);
    if (!texture) {
        let settle = () => {};
        trackLoad(new Promise<void>((resolve) => { settle = resolve; }));
        // Decoded in the background (mapLoader.ts): blank until it is in.
        texture = new THREE.Texture();
        fillMapTexture(texture, `${import.meta.env.BASE_URL}${path}`, detailBudget.giantMap).then(() => settle(), () => settle());
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = 8;
        maps.set(path, texture);
    }
    return texture;
};

/**
 * The giants' maps let go when the ship leaves their system through the wormhole (measured 9 Nov: Jupiter's alone
 * held 33 MB of graphics memory out by TON 618). Any map asked for since `since` is kept (Saturn's photograph on
 * the far side of the wormhole); the rest are freed, and fetched again if the ship comes back.
 */
export const releaseGasMaps = (since: number) => {
    maps.forEach((texture, path) => {
        if ((lastAsked.get(path) ?? 0) >= since) return;
        texture.dispose();
        (texture.image as { close?: () => void } | null)?.close?.();
        maps.delete(path);
        lastAsked.delete(path);
    });
};
