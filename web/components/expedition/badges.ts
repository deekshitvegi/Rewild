/**
 * A world's badge: a 128 x 64 map of the real world (public/textures/badges), drawn as a small
 * lit sphere on the HUD's chapter card. Null for a world without one.
 */
const BADGES = new Set([
    'education', 'experience', 'projects', 'skills', 'research', 'beyond', 'freelance', 'certifications',
    'moon', 'pluto', 'charon', 'callisto', 'deimos', 'dione', 'enceladus', 'ganymede', 'iapetus', 'io', 'mimas',
    'phobos', 'rhea', 'tethys', 'europa', 'titan', 'titania', 'oberon', 'umbriel', 'ariel', 'miranda', 'triton',
]);

export const badgeOf = (id?: string | null) => (id && BADGES.has(id) ? `${import.meta.env.BASE_URL}textures/badges/${id}.webp` : null);
