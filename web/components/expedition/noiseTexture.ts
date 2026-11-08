import * as THREE from 'three';
import { NOISE_SLOPE_RANGE, periodicNoiseVolume, periodicSlopeVolume } from './noise';

/**
 * Smooth noise read from a texture instead of worked out per pixel. A gnoise
 * call (noise.ts) is eight corner hashes, a few hundred instructions; in a
 * pixel shader that runs on every pixel of the ground, several of them a
 * pixel were most of the frame on a built-in graphics chip. Where the field
 * does not have to match anything on the CPU (waves, surf, the canopy's
 * crowns, cloud decks), one read of a tiling volume of the same noise does.
 *
 * Both volumes are 64³, repeat every 16 units, and are built once, on first
 * use (while the game loads), shared by every material that reads them.
 */
const volumeTexture = (data: Uint8Array, size: number) => {
    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
};

let noise: THREE.Data3DTexture | null = null;
let slopes: THREE.Data3DTexture | null = null;

/** Four unrelated noise fields, one per channel. */
export const noiseVolume = () => {
    if (!noise) {
        const volume = periodicNoiseVolume(64, 16);
        noise = volumeTexture(volume.data, volume.size);
    }
    return noise;
};

/** One noise field's slope (RGB) and value (A). */
export const noiseSlopes = () => {
    if (!slopes) {
        const volume = periodicSlopeVolume(64, 16);
        slopes = volumeTexture(volume.data, volume.size);
    }
    return slopes;
};

/** The two volumes as uniforms, for a material that includes TEXTURE_NOISE_GLSL. */
export const textureNoiseUniforms = () => ({
    uNoiseVolume: { value: noiseVolume() },
    uNoiseSlopes: { value: noiseSlopes() },
});

/**
 * tnoise4(p): the four fields at p, each about -1..1 like gnoise (one lattice
 * cell per unit). tslope(p): one field's slope at p, per unit. (The
 * coordinates are wrapped first: the volumes have no mipmaps, so the wrap
 * leaves no seam, and small coordinates keep the texture unit's precision.
 * Read at level 0 explicitly: a read that works out its own level is not
 * allowed in the branches and loops these calls sit in on Direct3D.)
 */
export const TEXTURE_NOISE_GLSL = /* glsl */ `
uniform highp sampler3D uNoiseVolume;
uniform highp sampler3D uNoiseSlopes;
vec4 tnoise4(vec3 p) {
    return textureLod(uNoiseVolume, fract(p * 0.0625), 0.0) * 2.0 - 1.0;
}
vec3 tslope(vec3 p) {
    return (textureLod(uNoiseSlopes, fract(p * 0.0625), 0.0).xyz * 2.0 - 1.0) * ${NOISE_SLOPE_RANGE.toFixed(1)};
}
`;
