/**
 * The player's graphics choice, kept per device: how much detail the world is
 * built with (quality 0-2, or what detectQuality picks) and how many pixels
 * are drawn (a share of the screen's own pixels, or the detail level's range).
 */
export type Quality = 0 | 1 | 2;
export type DetailSetting = 'auto' | Quality;
export type ResolutionSetting = 'auto' | 1 | 0.75 | 0.5 | 0.35;
/**
 * The costlier effects, each its own choice ('auto': as the detail level has it): the clouds
 * drawn with volume or as a flat deck; the water as a surface of its own over a bed, with
 * caustics and white water, or painted on the ground; how thick the grass grows.
 */
export interface FeatureSetting {
    clouds: 'auto' | 'flat' | 'volume';
    water: 'auto' | 'simple' | 'detailed';
    grass: 'auto' | 'off' | 'light' | 'full';
    reflections: 'auto' | 'sky' | 'mirror';
}
export interface GraphicsSetting { detail: DetailSetting; resolution: ResolutionSetting; features: FeatureSetting }

/** What the effects are, worked out from the choices and the detail level. */
export interface Features {
    volumeClouds: boolean;
    waterSurface: boolean;
    waterDetail: boolean;
    /** Grass density: the detail level whose grass to draw (-1: none). */
    grass: -1 | Quality;
    /** The water mirrors the world (a second view drawn from under it), not only the sky. */
    mirror: boolean;
}

const AUTO_FEATURES: FeatureSetting = { clouds: 'auto', water: 'auto', grass: 'auto', reflections: 'auto' };

export const resolveFeatures = (f: FeatureSetting, quality: Quality): Features => {
    const waterSurface = f.water === 'auto' ? quality > 0 : f.water === 'detailed';
    return {
        // (Volume clouds need the effects pass, which Low has none of.)
        volumeClouds: quality > 0 && (f.clouds === 'auto' ? quality === 2 : f.clouds === 'volume'),
        waterSurface,
        waterDetail: f.water === 'auto' ? quality > 0 : f.water === 'detailed',
        grass: f.grass === 'auto' ? quality : f.grass === 'off' ? -1 : f.grass === 'light' ? 0 : 2,
        // A mirror needs the water's own surface to show it, and the effects pass: drawn straight to
        // the screen (Low), every material would need a second program for drawing into a picture.
        // Only when chosen: it draws the whole view a second time (measured 1.85x the frame by a river).
        mirror: waterSurface && quality > 0 && f.reflections === 'mirror',
    };
};

/** A key that changes when any effect does (the scene is rebuilt for it). */
export const featuresKey = (f: Features) => `${+f.volumeClouds}${+f.waterSurface}${+f.waterDetail}${f.grass}${+f.mirror}`;

const KEY = 'expedition-graphics';
const DETAILS: DetailSetting[] = ['auto', 0, 1, 2];
const RESOLUTIONS: ResolutionSetting[] = ['auto', 1, 0.75, 0.5, 0.35];

export const DETAIL_NAME: Record<Quality, string> = { 0: 'Low', 1: 'Medium', 2: 'High' };

export const readGraphics = (): GraphicsSetting => {
    try {
        const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null') as Partial<GraphicsSetting> | null;
        const f = saved?.features;
        return {
            detail: DETAILS.includes(saved?.detail as DetailSetting) ? saved!.detail! : 'auto',
            resolution: RESOLUTIONS.includes(saved?.resolution as ResolutionSetting) ? saved!.resolution! : 'auto',
            features: {
                clouds: f && ['flat', 'volume'].includes(f.clouds) ? f.clouds : 'auto',
                water: f && ['simple', 'detailed'].includes(f.water) ? f.water : 'auto',
                grass: f && ['off', 'light', 'full'].includes(f.grass) ? f.grass : 'auto',
                reflections: f && ['sky', 'mirror'].includes(f.reflections) ? f.reflections : 'auto',
            },
        };
    } catch {
        return { detail: 'auto', resolution: 'auto', features: { ...AUTO_FEATURES } };
    }
};

export const saveGraphics = (setting: GraphicsSetting) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify(setting));
    } catch {
        // Not kept between visits.
    }
};

/** The screen's own pixel ratio, capped where more pixels stop being visible. */
const screenRatio = () => Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);

/** Device pixel ratio for the canvas: a range (clamped to the screen by the renderer) or a share of the screen. */
export const dprFor = (quality: Quality, resolution: ResolutionSetting): number | [number, number] => {
    if (resolution === 'auto') return quality === 0 ? [0.7, 1.1] : quality === 1 ? [0.9, 1.4] : [1, 1.75];
    return Math.max(0.35, screenRatio() * resolution);
};

/**
 * The graphics chip the browser is drawing with, as the browser names it,
 * and what kind it is. A laptop with an NVIDIA or AMD card usually runs the
 * browser on its built-in (integrated) chip unless Windows is told otherwise,
 * and a browser with hardware acceleration turned off draws in software:
 * either makes a strong machine slow, and only this can tell them apart.
 */
export type GpuKind = 'discrete' | 'integrated' | 'mobile' | 'software' | 'unknown';
export interface GpuInfo { name: string; kind: GpuKind }

let gpu: GpuInfo | null = null;

/** Sorts a renderer name ("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU ...)") into a kind. */
export const gpuKind = (name: string): GpuKind => {
    const n = name.toLowerCase();
    if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/.test(n)) return 'software';
    if (/nvidia|geforce|quadro|rtx|gtx|radeon\s*(rx|pro|r9|vii)|\brx\s*\d{3,4}|arc\s*a\d|apple m\d/.test(n)) return 'discrete';
    if (/adreno|mali|powervr|apple a\d|xclipse|immortalis/.test(n)) return 'mobile';
    if (/intel|uhd|iris|hd graphics|radeon\(tm\)\s*graphics|radeon graphics|vega \d+ graphics|amd radeon\s*\d{3}m/.test(n)) return 'integrated';
    return 'unknown';
};

export const gpuInfo = (): GpuInfo => {
    if (gpu) return gpu;
    let name = '';
    try {
        const canvas = document.createElement('canvas');
        // Ask exactly as the game's own canvas does, so a machine with two chips names the one the game gets.
        const want = { powerPreference: 'high-performance' as const };
        const gl = (canvas.getContext('webgl2', want) ?? canvas.getContext('webgl', want)) as WebGLRenderingContext | null;
        if (gl) {
            const debug = gl.getExtension('WEBGL_debug_renderer_info');
            name = String((debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) ?? '');
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
    } catch {
        // No WebGL to ask.
    }
    gpu = { name, kind: name ? gpuKind(name) : 'unknown' };
    return gpu;
};

/** The chip's name without the browser's wrapping: "NVIDIA GeForce RTX 4070 Laptop GPU". */
export const gpuLabel = (info: GpuInfo) => {
    const inner = /^ANGLE \(([^,]+),\s*(.+?)(?:\s*\(0x[0-9a-f]+\))?(?:\s*Direct3D.*|\s*OpenGL.*|\s*Vulkan.*|,.*)?\)$/i.exec(info.name);
    return (inner ? inner[2] : info.name).replace(/\s+/g, ' ').trim() || 'Unknown';
};

