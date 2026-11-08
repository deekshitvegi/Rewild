import * as THREE from 'three';

/**
 * Large pictures (a world's map is up to 5400 x 2700) decoded away from the
 * game. Loaded as an <img>, a picture is decoded on the main thread the moment
 * it is first drawn: a stall of a few hundred milliseconds, every time a
 * world's map came back into view. createImageBitmap decodes it in the
 * background, and can shrink it on the way (a smaller copy at Low detail,
 * where the full map is a quarter of the graphics memory for nothing).
 *
 * Where the browser cannot turn the picture the right way up as it decodes
 * (Safari, older Firefox), it is loaded as before.
 */
const bitmapsWork = (() => {
    if (typeof createImageBitmap === 'undefined' || typeof navigator === 'undefined') return false;
    const agent = navigator.userAgent;
    if (/^((?!chrome|android).)*safari/i.test(agent)) return false;
    const firefox = /firefox\/(\d+)/i.exec(agent);
    return !(firefox && Number(firefox[1]) < 98);
})();

const decode = async (url: string, maxWidth: number) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const blob = await response.blob();
    let bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    if (bitmap.width > maxWidth) {
        const small = await createImageBitmap(bitmap, {
            resizeWidth: maxWidth,
            resizeHeight: Math.round(bitmap.height * maxWidth / bitmap.width),
            resizeQuality: 'high',
            premultiplyAlpha: 'none',
        });
        bitmap.close();
        bitmap = small;
    }
    return bitmap;
};

/** A picture as a texture, at most maxWidth pixels wide where it can be shrunk. */
export const loadMapTexture = async (url: string, maxWidth = Infinity): Promise<THREE.Texture> => {
    if (bitmapsWork) {
        try {
            const texture = new THREE.Texture(await decode(url, maxWidth));
            texture.flipY = false;
            texture.needsUpdate = true;
            return texture;
        } catch {
            // Loaded the old way below.
        }
    }
    return new THREE.TextureLoader().loadAsync(url);
};

/**
 * The same into a texture that exists already (and is drawn blank until the
 * picture is in): for maps shared from the start by several materials.
 */
export const fillMapTexture = async (texture: THREE.Texture, url: string, maxWidth = Infinity) => {
    if (bitmapsWork) {
        try {
            texture.image = await decode(url, maxWidth);
            texture.flipY = false;
            texture.needsUpdate = true;
            return texture;
        } catch {
            // Loaded the old way below.
        }
    }
    const image = await new THREE.ImageLoader().loadAsync(url);
    texture.image = image;
    texture.needsUpdate = true;
    return texture;
};

/** The widest map worth keeping at each detail level (Low, Medium, High). */
export const MAP_WIDTH = [2048, 4096, Infinity] as const;
