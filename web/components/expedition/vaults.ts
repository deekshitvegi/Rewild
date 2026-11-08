import * as THREE from 'three';
import { findBody, startPosition, startSun, type ExpeditionBody } from './bodies';
import { groundHeight, levelGround, waterDepth } from './environment';
import { landingZoneDirection, openingHeading } from './sites';

/**
 * Vaults: sealed stone chests left by whoever carved the monoliths, one on
 * every world with ground, a short walk from where the ship sets down. Three
 * rune stones stand round each, every one carved with a glyph of the script.
 * The lid shows the same three glyphs in a row: light the runes with the
 * mining beam in that order, before the first goes dark again, and the vault
 * opens. That is God of War's Nornir chests, with the order of Tomb Raider's
 * puzzle tombs; and read in the script, every lid spells a word.
 *
 * Inside is ancient technology the suit can use (a jetpack cell, a larger
 * air tank, a sharper mining lens) or, once those are all fitted, crystals.
 */
export type VaultReward = 'jetpack' | 'tank' | 'tool';

export interface Vault {
    id: string;
    body: string;
    name: string;
    /** The three letters on the lid, in the order to light them. */
    key: string;
    /** Degrees from the Sun's direction at the landing zone (positive: to its right), and metres from the zone. */
    bearing: number;
    distance: number;
    /** Seconds to light all three once the first is lit. */
    limit: number;
    reward: VaultReward;
}

export const VAULTS: Vault[] = [
    { id: 'vault-projects', body: 'projects', name: 'Vault of the Sky', key: 'SKY', bearing: 110, distance: 230, limit: 22, reward: 'jetpack' },
    { id: 'vault-moon', body: 'moon', name: 'Vault of the Seas', key: 'SEA', bearing: -100, distance: 200, limit: 18, reward: 'tank' },
    { id: 'vault-skills', body: 'skills', name: 'Red Vault', key: 'RED', bearing: 120, distance: 260, limit: 18, reward: 'tool' },
    { id: 'vault-experience', body: 'experience', name: 'Vault in the Fog', key: 'FOG', bearing: -110, distance: 240, limit: 18, reward: 'jetpack' },
    { id: 'vault-education', body: 'education', name: 'Sun Vault', key: 'SUN', bearing: 100, distance: 220, limit: 16, reward: 'tank' },
    { id: 'vault-europa', body: 'europa', name: 'Ice Vault', key: 'ICE', bearing: -120, distance: 180, limit: 15, reward: 'tool' },
    { id: 'vault-titan', body: 'titan', name: 'Vault of Air', key: 'AIR', bearing: 120, distance: 210, limit: 15, reward: 'jetpack' },
    { id: 'vault-titania', body: 'titania', name: 'The Far Vault', key: 'FAR', bearing: -100, distance: 200, limit: 14, reward: 'tank' },
    { id: 'vault-triton', body: 'triton', name: 'The Last Vault', key: 'END', bearing: 100, distance: 200, limit: 14, reward: 'tool' },
];

export const REWARD_TEXT: Record<VaultReward, { name: string; detail: string }> = {
    jetpack: { name: 'Ancient fuel cell', detail: 'The jetpack burns longer.' },
    tank: { name: 'Ancient air cell', detail: 'The suit holds more air.' },
    tool: { name: 'Ancient lens', detail: 'The mining beam cuts faster.' },
};
/** Crystals inside once every upgrade of that kind is already fitted. */
export const VAULT_CRYSTALS = 30;

export const vaultOn = (body: ExpeditionBody | null) => (body ? VAULTS.find((vault) => vault.body === body.id) ?? null : null);

/** A vault's frame: where it stands, its up, and two directions along the ground. */
export interface VaultFrame {
    centre: THREE.Vector3;
    up: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
    /** Where each rune stands (world units, on the ground), in the order of the key's letters. */
    runes: THREE.Vector3[];
}

const frames = new Map<string, VaultFrame>();

// In the game's frame of the start, like everything laid out on a world (motion.ts).
const onGround = (body: ExpeditionBody, direction: THREE.Vector3) =>
    startPosition(body).clone().addScaledVector(direction, body.radius + groundHeight(body, direction));

const random = (seed: number) => {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
};

/** Where a vault and its runes are. Out of rivers and seas: the next dry spot along the same bearing. */
export const vaultFrame = (vault: Vault): VaultFrame => {
    let frame = frames.get(vault.id);
    if (frame) return frame;
    const body = findBody(vault.body) as ExpeditionBody;
    const zone = landingZoneDirection(body);
    const sun = startSun(body).clone().addScaledVector(zone, -startSun(body).dot(zone));
    const toward = sun.lengthSq() > 1e-6 ? sun.normalize() : openingHeading(body);
    const heading = toward.applyAxisAngle(zone, -THREE.MathUtils.degToRad(vault.bearing));
    const axis = new THREE.Vector3().crossVectors(zone, heading).normalize();
    const at = (metres: number) => zone.clone().applyAxisAngle(axis, metres / body.radius).normalize();
    // On the most level dry ground near there, room for the runes all round.
    const up = levelGround(body, at(vault.distance), vault.distance * 0.6, 36);
    const tangent = new THREE.Vector3(0, 1, 0).cross(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(up, tangent).normalize();
    // The runes round it, a third of a turn apart give or take, each 22 to 34 m out, dry.
    const r = random(vault.id.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
    const start = r() * Math.PI * 2;
    const order = [0, 1, 2].sort(() => r() - 0.5);
    const runes: THREE.Vector3[] = [];
    order.forEach((slot, n) => {
        const angle = start + slot * (Math.PI * 2 / 3) + (r() - 0.5) * 0.6;
        let reach = 22 + r() * 12;
        const spot = (m: number) => up.clone().multiplyScalar(body.radius)
            .addScaledVector(tangent, Math.cos(angle) * m)
            .addScaledVector(bitangent, Math.sin(angle) * m)
            .normalize();
        for (let k = 0; k < 6 && waterDepth(body, spot(reach)) > 0; k++) reach -= 3;
        runes[n] = onGround(body, spot(reach));
    });
    frame = { centre: onGround(body, up), up, tangent, bitangent, runes };
    frames.set(vault.id, frame);
    return frame;
};
