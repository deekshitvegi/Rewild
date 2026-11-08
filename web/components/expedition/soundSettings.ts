import { FULL_VOLUME, type SoundVolumes } from './audio';

/**
 * The sound settings (Settings › Sound): a level for everything at once and for each channel, and
 * which channels are switched off. Kept on this device. A channel switched off keeps its level, so
 * switching it back on brings it back as it was.
 */
export interface SoundSettings {
    volumes: SoundVolumes;
    off: Partial<Record<keyof SoundVolumes, boolean>>;
}

const KEY = 'rewild-sound';

export const loadSoundSettings = (): SoundSettings => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<SoundSettings> | null;
        const volumes = { ...FULL_VOLUME };
        for (const name of Object.keys(volumes) as (keyof SoundVolumes)[]) {
            const v = saved?.volumes?.[name];
            if (typeof v === 'number' && Number.isFinite(v)) volumes[name] = Math.min(1, Math.max(0, v));
        }
        return { volumes, off: { ...(saved?.off ?? {}) } };
    } catch {
        return { volumes: { ...FULL_VOLUME }, off: {} };
    }
};

export const saveSoundSettings = (settings: SoundSettings) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
        // Nowhere to keep it: it lasts this visit.
    }
};

/** What the engine plays at: each level, or nothing where it is switched off. */
export const effectiveVolumes = (settings: SoundSettings): SoundVolumes => {
    const out = { ...settings.volumes };
    for (const name of Object.keys(out) as (keyof SoundVolumes)[]) if (settings.off[name]) out[name] = 0;
    return out;
};
