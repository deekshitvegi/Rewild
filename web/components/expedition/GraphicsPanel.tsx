import { useEffect, useRef, useState } from 'react';
import { DETAIL_NAME, gpuLabel, type DetailSetting, type FeatureSetting, type Features, type GpuInfo, type GraphicsSetting, type Quality, type ResolutionSetting } from './graphics';
import type { SoundVolumes } from './audio';
import type { SoundSettings } from './soundSettings';
import { readCrossingFilm, saveCrossingFilm, type CrossingFilm } from './films';

/** The sound side of Settings: the levels, and the music and sounds switches (N and B). */
export interface SoundControl {
    settings: SoundSettings;
    onChange: (next: SoundSettings) => void;
    music: boolean;
    sounds: boolean;
    toggleMusic: () => void;
    toggleSounds: () => void;
}

const CHANNELS: { id: keyof SoundVolumes; label: string; what: string }[] = [
    { id: 'master', label: 'Everything', what: 'All sound at once' },
    { id: 'music', label: 'Music', what: 'The score' },
    { id: 'ship', label: 'Ship', what: 'Engines, the pulse drive, landing gear, re-entry, heat on the hull' },
    { id: 'body', label: 'Suit', what: 'Breathing, footsteps, the jetpack, the mining beam, eating, splashing' },
    { id: 'world', label: 'World', what: 'Wind, water, fire, thunder, animals, impacts' },
    { id: 'voice', label: 'Voices', what: 'ARGO and the crew' },
    { id: 'radio', label: 'Radio', what: 'Static and signals' },
    { id: 'alerts', label: 'Alerts', what: 'Notices, menus, alarms, chapter and scan chimes' },
];

const TAB_KEY = 'rewild-settings-tab';
type Tab = 'sound' | 'graphics';
const readTab = (): Tab => {
    try {
        return window.localStorage.getItem(TAB_KEY) === 'graphics' ? 'graphics' : 'sound';
    } catch {
        return 'sound';
    }
};

export interface GraphicsControl {
    setting: GraphicsSetting;
    /** What detectQuality picked for this device. */
    detected: Quality;
    /** The detail the scene is built with now. */
    quality: Quality;
    /** The effects as they are drawn now (each choice, or what the detail level gives it). */
    features: Features;
    onChange: (next: GraphicsSetting) => void;
    /** The chip the browser draws with, and how many steps Auto has lowered the detail this visit. */
    gpu: GpuInfo;
    lowered: number;
}

/** What to do when the browser is not drawing with the computer's graphics card. */
const GPU_ADVICE: Partial<Record<GpuInfo['kind'], string>> = {
    integrated: 'This is the computer\'s built-in graphics. If it also has an NVIDIA or AMD card (most gaming laptops do), let the app you play in use it: Windows Settings › System › Display › Graphics, choose your browser or the Claude app, Options, High performance. Then restart that app, and keep the charger plugged in: on battery many laptops switch back to the built-in chip.',
    software: 'The browser is drawing without the graphics card, so everything is slow. Turn on "Use graphics acceleration when available" in the browser\'s settings (Chrome and Edge: Settings › System) and restart it.',
};

const DETAIL_TEXT: Record<Quality, string> = {
    0: 'Lighter grass and forests, no volumetric clouds or glow. Best for phones and older laptops.',
    1: 'Volumetric clouds and glow, fuller grass, forests and wildlife.',
    2: 'The densest grass and forests and the most detailed ground and clouds. Needs a strong graphics card.',
};

/** Settings › Graphics › Effects: each costly effect on its own, Auto following the detail level. */
const EFFECTS: { id: keyof FeatureSetting; label: string; options: { value: string; label: string }[]; what: string; now: (f: Features) => string }[] = [
    {
        id: 'clouds',
        label: 'Clouds',
        options: [{ value: 'auto', label: 'Auto' }, { value: 'flat', label: 'Flat' }, { value: 'volume', label: '3D' }],
        what: '3D: heaped cumulus you can fly under and through, lit by the sun. Flat: a painted deck, lighter on the graphics card.',
        now: (f) => (f.volumeClouds ? '3D' : 'Flat'),
    },
    {
        id: 'water',
        label: 'Water',
        options: [{ value: 'auto', label: 'Auto' }, { value: 'simple', label: 'Simple' }, { value: 'detailed', label: 'Detailed' }],
        what: 'Detailed: rivers and seas with a real bed under them, breakers rolling in, diving, light playing on the bed, white water, the ship stirring the water. Simple: the water painted on the ground.',
        now: (f) => (f.waterSurface ? 'Detailed' : 'Simple'),
    },
    {
        id: 'grass',
        label: 'Grass',
        options: [{ value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }, { value: 'light', label: 'Light' }, { value: 'full', label: 'Full' }],
        what: 'How thick the grass grows round you. It is one of the costliest things in a meadow.',
        now: (f) => (f.grass < 0 ? 'Off' : f.grass === 0 ? 'Light' : f.grass === 1 ? 'Medium' : 'Full'),
    },
    {
        id: 'reflections',
        label: 'Reflections',
        options: [{ value: 'auto', label: 'Auto' }, { value: 'sky', label: 'Sky' }, { value: 'mirror', label: 'Mirror' }],
        what: 'Mirror: still water reflects the banks, trees, hills, the ship and you, broken up by ripples. It draws the view twice, so near water it can nearly halve the frame rate. Sky: only the sky and the sun. Mirror needs Detailed water and Medium detail or above.',
        now: (f) => (f.mirror ? 'Mirror' : 'Sky'),
    },
];

const RESOLUTIONS: { value: ResolutionSetting; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 1, label: '100%' },
    { value: 0.75, label: '75%' },
    { value: 0.5, label: '50%' },
    { value: 0.35, label: '35%' },
];

/** Frames a second, averaged over half a second, while the panel is open. */
const useFrameRate = () => {
    const [rate, setRate] = useState<number | null>(null);
    useEffect(() => {
        let frame = 0;
        let count = 0;
        let since = performance.now();
        const tick = (now: number) => {
            frame = requestAnimationFrame(tick);
            count += 1;
            if (now - since >= 500) {
                const fps = (count * 1000) / (now - since);
                setRate(fps < 10 ? Math.round(fps * 10) / 10 : Math.round(fps));
                count = 0;
                since = now;
            }
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);
    return rate;
};

/** The size of the picture being drawn (the canvas's own pixels), read from the page. */
const useDrawnSize = (setting: GraphicsSetting, quality: Quality) => {
    const [size, setSize] = useState<{ width: number; height: number } | null>(null);
    useEffect(() => {
        const read = () => {
            const canvas = document.querySelector<HTMLCanvasElement>('.expedition__canvas canvas');
            if (canvas) setSize({ width: canvas.width, height: canvas.height });
        };
        // The renderer resizes on the next frame after a change.
        const timer = window.setTimeout(read, 120);
        read();
        return () => window.clearTimeout(timer);
    }, [setting, quality]);
    return size;
};

/**
 * Graphics (O): how much detail the world is built with and how many pixels
 * are drawn. Auto picks for the device; the choice is kept on this device.
 * Changing the detail rebuilds the scene round the player, who stays put.
 */
export const GraphicsPanel = ({ control, sound, onClose }: { control: GraphicsControl; sound: SoundControl; onClose: () => void }) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    const [tab, setTab] = useState<Tab>(readTab);
    const choose = (next: Tab) => {
        setTab(next);
        try {
            window.localStorage.setItem(TAB_KEY, next);
        } catch {
            // Not kept.
        }
    };
    const rate = useFrameRate();
    const size = useDrawnSize(control.setting, control.quality);
    const { setting, detected, quality, features, onChange, gpu, lowered } = control;
    const advice = GPU_ADVICE[gpu.kind];

    useEffect(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' || event.code === 'KeyO') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const details: { value: DetailSetting; label: string }[] = [
        { value: 'auto', label: 'Auto' },
        { value: 0, label: 'Low' },
        { value: 1, label: 'Medium' },
        { value: 2, label: 'High' },
    ];

    return (
        <div className="expedition-map" role="dialog" aria-modal="true" aria-labelledby="expedition-graphics-title">
            <div className="expedition-map__panel expedition-graphics">
                <header>
                    <div>
                        <small>Rewild</small>
                        <h2 id="expedition-graphics-title">Settings</h2>
                    </div>
                    <button ref={closeRef} type="button" className="expedition-map__close" onClick={onClose}>Done <kbd>O</kbd></button>
                </header>
                <div className="expedition-graphics__segments expedition-settings__tabs" role="tablist" aria-label="Settings">
                    {(['sound', 'graphics'] as Tab[]).map((t) => (
                        <button key={t} type="button" role="tab" aria-selected={tab === t} aria-checked={tab === t} onClick={() => choose(t)}>
                            {t === 'sound' ? 'Sound' : 'Graphics'}
                        </button>
                    ))}
                </div>

                {tab === 'sound' ? <SoundSection sound={sound} /> : <>

                <section className="expedition-graphics__group" aria-labelledby="expedition-graphics-detail">
                    <h3 id="expedition-graphics-detail">Detail</h3>
                    <div className="expedition-graphics__segments" role="radiogroup" aria-labelledby="expedition-graphics-detail">
                        {details.map((option) => (
                            <button
                                key={String(option.value)}
                                type="button"
                                role="radio"
                                aria-checked={setting.detail === option.value}
                                onClick={() => onChange({ ...setting, detail: option.value })}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <p>
                        {setting.detail === 'auto' ? `Auto chose ${DETAIL_NAME[detected]} for this device${lowered ? `, then ${DETAIL_NAME[quality]} to keep it smooth` : ''}. ` : ''}
                        {DETAIL_TEXT[quality]}
                    </p>
                </section>

                <section className="expedition-graphics__group" aria-labelledby="expedition-graphics-resolution">
                    <h3 id="expedition-graphics-resolution">Resolution</h3>
                    <div className="expedition-graphics__segments" role="radiogroup" aria-labelledby="expedition-graphics-resolution">
                        {RESOLUTIONS.map((option) => (
                            <button
                                key={String(option.value)}
                                type="button"
                                role="radio"
                                aria-checked={setting.resolution === option.value}
                                onClick={() => onChange({ ...setting, resolution: option.value })}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                    <p>
                        {setting.resolution === 'auto'
                            ? 'Matched to the detail level. '
                            : `${Math.round(Number(setting.resolution) * 100)}% of your screen's sharpness. Lower is smoother on slow devices. `}
                        {size ? `Drawing ${size.width} × ${size.height} pixels.` : ''}
                    </p>
                </section>

                <section className="expedition-graphics__group" aria-labelledby="expedition-graphics-effects">
                    <h3 id="expedition-graphics-effects">Effects</h3>
                    {EFFECTS.map((effect) => (
                        <div key={effect.id} className="expedition-graphics__effect">
                            <h4 id={`expedition-effect-${effect.id}`}>{effect.label}</h4>
                            <div className="expedition-graphics__segments" role="radiogroup" aria-labelledby={`expedition-effect-${effect.id}`}>
                                {effect.options.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={setting.features[effect.id] === option.value}
                                        onClick={() => onChange({ ...setting, features: { ...setting.features, [effect.id]: option.value } as FeatureSetting })}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <p>{setting.features[effect.id] === 'auto' ? `Auto: ${effect.now(features)} at ${DETAIL_NAME[quality]}. ` : ''}{effect.what}</p>
                        </div>
                    ))}
                </section>

                <FilmSection />

                <p className="expedition-graphics__rate" role="status">
                    {rate === null ? 'Measuring…' : `Running at ${rate} frames a second`}
                    {gpu.name ? ` on ${gpuLabel(gpu)}` : ''}
                    {/* A fixed sharpness that is too much for this chip: Auto lowers it as the frame rate needs. */}
                    {rate !== null && rate < 40 && setting.resolution !== 'auto' && Number(setting.resolution) > 0.5 && size && size.width * size.height > 1.6e6
                        ? `. Auto resolution would draw about half as many pixels here and run smoother.`
                        : ''}
                </p>
                {advice && <p className="expedition-graphics__advice">{advice}</p>}
                </>}
            </div>
        </div>
    );
};

/** Settings › Graphics › Wormhole crossing: how the crossing is shown while the other system loads. */
const FILM_CHOICES: { value: CrossingFilm; label: string; what: string }[] = [
    { value: 'engine', label: 'In the game', what: 'Drawn as it happens: the Argo down the throat, the spiral of light, out into the other side.' },
    { value: 'crew', label: 'Crew film', what: 'The old film of the crew in the Argo, talking it through on the radio.' },
    { value: 'quick', label: 'Short film', what: 'The old eight-second film of the throat.' },
];
const FilmSection = () => {
    const [film, setFilm] = useState(readCrossingFilm);
    const choose = (next: CrossingFilm) => {
        setFilm(next);
        saveCrossingFilm(next);
    };
    return (
        <section className="expedition-graphics__group" aria-labelledby="expedition-graphics-film">
            <h3 id="expedition-graphics-film">Wormhole crossing</h3>
            <div className="expedition-graphics__segments" role="radiogroup" aria-labelledby="expedition-graphics-film">
                {FILM_CHOICES.map((option) => (
                    <button key={option.value} type="button" role="radio" aria-checked={film === option.value} onClick={() => choose(option.value)}>
                        {option.label}
                    </button>
                ))}
            </div>
            <p>Shown while the Argo crosses and the other system loads. {FILM_CHOICES.find((option) => option.value === film)?.what}</p>
        </section>
    );
};

/** Settings › Sound: a level and an on/off switch for each channel. */
const SoundSection = ({ sound }: { sound: SoundControl }) => {
    const { settings, onChange } = sound;
    const set = (id: keyof SoundVolumes, value: number) => onChange({ ...settings, volumes: { ...settings.volumes, [id]: value } });
    const flip = (id: keyof SoundVolumes) => onChange({ ...settings, off: { ...settings.off, [id]: !settings.off[id] } });
    return (
        <>
            <section className="expedition-graphics__group" aria-labelledby="expedition-sound-switches">
                <h3 id="expedition-sound-switches">Quick switches</h3>
                <div className="expedition-sound__switches">
                    <button type="button" aria-pressed={sound.music} onClick={sound.toggleMusic}>Music {sound.music ? 'on' : 'off'} <kbd>N</kbd></button>
                    <button type="button" aria-pressed={sound.sounds} onClick={sound.toggleSounds}>Sounds {sound.sounds ? 'on' : 'off'} <kbd>B</kbd></button>
                </div>
            </section>
            <section className="expedition-graphics__group" aria-labelledby="expedition-sound-levels">
                <h3 id="expedition-sound-levels">Levels</h3>
                <ul className="expedition-sound__list">
                    {CHANNELS.map((channel) => {
                        const off = !!settings.off[channel.id];
                        const level = Math.round(settings.volumes[channel.id] * 100);
                        return (
                            <li key={channel.id} className={off ? 'is-off' : undefined}>
                                <label htmlFor={`sound-${channel.id}`}>
                                    <b>{channel.label}</b>
                                    <span>{channel.what}</span>
                                </label>
                                <input
                                    id={`sound-${channel.id}`}
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={5}
                                    value={level}
                                    disabled={off}
                                    onChange={(event) => set(channel.id, Number(event.target.value) / 100)}
                                    aria-valuetext={`${level} percent`}
                                />
                                <output htmlFor={`sound-${channel.id}`}>{off ? 'Off' : `${level}%`}</output>
                                <button type="button" aria-pressed={!off} aria-label={`${channel.label}: ${off ? 'off, press to turn on' : 'on, press to turn off'}`} onClick={() => flip(channel.id)}>
                                    {off ? 'Turn on' : 'Turn off'}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </section>
        </>
    );
};
