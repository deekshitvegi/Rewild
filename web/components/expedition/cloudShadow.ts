import * as THREE from 'three';

/**
 * The shadows the cloud deck casts on the ground (Earth): its cover map, the turn from the world's frame into
 * the map's (the wind's drift included), the deck's height above the ground and how dark a full cloud's shadow
 * is. Shared by the deck (Clouds.tsx, which sets them each frame) and the ground (PlanetTerrain.tsx), so the
 * shadows move with the clouds that cast them. Strength 0 until the map is drawn.
 */
export const CLOUD_SHADOW = {
    uCloudShadowMap: { value: null as THREE.Texture | null },
    uCloudShadowTurn: { value: new THREE.Matrix3() },
    uCloudShadowHeight: { value: 560 },
    uCloudShadowStrength: { value: 0 },
};

/**
 * GLSL: `float cloudShade(vec3 pos)`, the share of sunlight the clouds let through to a point on the ground
 * (`pos` in the world's frame, from its centre), along the line to the sun up to the deck. Needs uSunDir.
 */
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform samplerCube uCloudShadowMap;
uniform mat3 uCloudShadowTurn;
uniform float uCloudShadowHeight;
uniform float uCloudShadowStrength;
float cloudShade(vec3 pos) {
    if (uCloudShadowStrength <= 0.0) return 1.0;
    vec3 up = normalize(pos);
    float sunUp = dot(up, uSunDir);
    // Up the sun's line to the deck (the curve ignored: the deck is low over a wide world).
    vec3 atDeck = pos + uSunDir * (uCloudShadowHeight / max(sunUp, 0.08));
    float cover = textureLod(uCloudShadowMap, uCloudShadowTurn * normalize(atDeck), 1.5).r;
    // Thin cloud lets most of the light through; thick cloud a third of it.
    float shade = smoothstep(0.1, 0.75, cover) * uCloudShadowStrength;
    return 1.0 - 0.68 * shade * smoothstep(-0.02, 0.12, sunUp);
}
`;
