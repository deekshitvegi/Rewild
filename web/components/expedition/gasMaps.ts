import * as THREE from 'three';
import { trackLoad } from './loadProgress';
import { fillMapTexture } from './mapLoader';

/**
 * The giants' maps are large (Jupiter's is 3600 x 1800): one texture per map,
 * shared by the planet, its cloud decks and the volumetric clouds, instead of
 * a copy on the GPU for each.
 */
const maps = new Map<string, THREE.Texture>();

export const gasMapTexture = (path: string) => {
    let texture = maps.get(path);
    if (!texture) {
        let settle = () => {};
        trackLoad(new Promise<void>((resolve) => { settle = resolve; }));
        // Decoded in the background (mapLoader.ts): blank until it is in.
        texture = new THREE.Texture();
        fillMapTexture(texture, `${import.meta.env.BASE_URL}${path}`).then(() => settle(), () => settle());
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.anisotropy = 8;
        maps.set(path, texture);
    }
    return texture;
};
