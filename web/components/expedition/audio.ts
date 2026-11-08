/**
 * The expedition's sound, made in the browser rather than played from
 * recordings: every layer follows the game as it happens (the engine's pitch
 * with the throttle, the wind with the air and the speed, footsteps with the
 * ground underfoot), it costs no downloads, and the preview host, which lets
 * a page fetch only its own files, cannot block it.
 *
 * Continuous layers are built once and their levels steered every frame
 * (Soundscape.tsx); short sounds ("cues") are synthesised as they happen.
 * Ambient music is generative: slow chords and a sparse bell line in a mood
 * that changes with the place.
 */

export type CueName =
    | 'notice' | 'menu' | 'engage' | 'drop' | 'gear' | 'touchdown' | 'takeoff'
    | 'step' | 'jump' | 'land' | 'hurt' | 'mined' | 'gather' | 'eat' | 'craft' | 'camp'
    | 'rock' | 'impact' | 'explosion' | 'interdict' | 'chapter' | 'site' | 'transit' | 'scan' | 'waypoint'
    | 'splash' | 'growl' | 'call' | 'radio' | 'thunder';

export type Surface = 'grass' | 'sand' | 'gravel' | 'snow' | 'regolith' | 'water';

/**
 * What the player can turn up, down or off on its own (Settings, SoundPanel.tsx): every sound goes
 * through one of these on its way to its bus, the music through its own.
 */
export type SoundChannel = 'ship' | 'body' | 'world' | 'radio' | 'alerts';
export interface SoundVolumes {
    master: number;
    music: number;
    ship: number;
    body: number;
    world: number;
    radio: number;
    alerts: number;
}
export const FULL_VOLUME: SoundVolumes = { master: 1, music: 1, ship: 1, body: 1, world: 1, radio: 1, alerts: 1 };
/** Which channel each one-off sound plays on. */
const CUE_CHANNEL: Record<CueName, SoundChannel> = {
    notice: 'alerts', menu: 'alerts', waypoint: 'alerts', chapter: 'alerts', site: 'alerts', scan: 'alerts', craft: 'alerts', radio: 'radio',
    engage: 'ship', drop: 'ship', gear: 'ship', touchdown: 'ship', takeoff: 'ship', interdict: 'ship', transit: 'ship',
    step: 'body', jump: 'body', land: 'body', hurt: 'body', eat: 'body', gather: 'body', camp: 'body', mined: 'body', splash: 'body',
    rock: 'world', impact: 'world', explosion: 'world', growl: 'world', call: 'world', thunder: 'world',
};

export type Mood = 'earth' | 'space' | 'mars' | 'ice' | 'deep' | 'sun' | 'quiet';

/** The levels and pitches of the continuous layers, 0..1 unless noted. */
export interface Mix {
    engine: number;
    thrust: number;
    boost: number;
    pulse: number;
    airflow: number;
    entry: number;
    wind: number;
    /** Wind character: thin (Mars) is higher and fainter, thick (Venus) lower. */
    airDensity: number;
    breathing: number;
    breathRate: number;
    jetpack: number;
    laser: number;
    water: number;
    fire: number;
    heat: number;
    heatAlarm: boolean;
    lowAlarm: boolean;
    blackHole: number;
    radio: number;
    radioSignal: number;
    radioPitch: number;
    /** The ship's engines are heard through the hull in vacuum: duller. */
    vacuum: number;
}

export const silentMix = (): Mix => ({
    engine: 0, thrust: 0, boost: 0, pulse: 0, airflow: 0, entry: 0, wind: 0, airDensity: 1, breathing: 0, breathRate: 0.25,
    jetpack: 0, laser: 0, water: 0, fire: 0, heat: 0, heatAlarm: false, lowAlarm: false, blackHole: 0,
    radio: 0, radioSignal: 0, radioPitch: 1, vacuum: 0,
});

type Ctx = BaseAudioContext;

const noiseBuffer = (ctx: Ctx, seconds: number, colour: 'white' | 'pink' | 'brown') => {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            if (colour === 'white') {
                data[i] = white * 0.5;
            } else if (colour === 'pink') {
                // Paul Kellet's refined pink filter.
                b0 = 0.99886 * b0 + white * 0.0555179;
                b1 = 0.99332 * b1 + white * 0.0750759;
                b2 = 0.969 * b2 + white * 0.153852;
                b3 = 0.8665 * b3 + white * 0.3104856;
                b4 = 0.55 * b4 + white * 0.5329522;
                b5 = -0.7616 * b5 - white * 0.016898;
                data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                b6 = white * 0.115926;
            } else {
                last = (last + 0.02 * white) / 1.02;
                data[i] = last * 3.5;
            }
        }
        // Fade the ends together so the loop does not click.
        const fade = Math.min(2048, length >> 4);
        for (let i = 0; i < fade; i++) {
            const k = i / fade;
            data[i] = data[i] * k + data[length - fade + i] * (1 - k);
        }
    }
    return buffer;
};

/** A room for the music and the bells: a decaying wash of noise as the impulse. */
const reverbImpulse = (ctx: Ctx, seconds: number, decay: number) => {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return buffer;
};

const midi = (note: number) => 440 * Math.pow(2, (note - 69) / 12);

/** Chords (as MIDI notes) for each mood, played in turn; and the scale its bells pick from. */
const MOODS: Record<Mood, { chords: number[][]; bells: number[]; tone: number; tempo: number }> = {
    earth: { chords: [[48, 55, 64, 71, 74], [45, 52, 60, 67, 71], [41, 48, 57, 64, 71], [43, 50, 59, 62, 69]], bells: [72, 74, 76, 79, 81, 84], tone: 1500, tempo: 11 },
    space: { chords: [[50, 57, 61, 66, 69], [47, 54, 57, 62, 66], [43, 50, 54, 59, 62], [40, 47, 54, 57, 62]], bells: [74, 76, 78, 81, 83, 86], tone: 1100, tempo: 13 },
    mars: { chords: [[38, 45, 50, 53, 57], [34, 41, 46, 50, 57], [31, 38, 46, 50, 52], [33, 40, 45, 49, 52]], bells: [62, 65, 67, 69, 72], tone: 800, tempo: 14 },
    ice: { chords: [[40, 47, 54, 55, 62], [36, 43, 52, 55, 59], [33, 40, 47, 48, 55], [35, 42, 47, 49, 54]], bells: [76, 78, 79, 83, 86], tone: 1700, tempo: 12 },
    deep: { chords: [[24, 31, 36, 43, 47], [24, 31, 37, 43, 46], [22, 29, 36, 41, 45]], bells: [60, 61, 67, 70], tone: 420, tempo: 18 },
    sun: { chords: [[45, 52, 57, 61, 64], [43, 50, 55, 59, 66], [41, 48, 53, 57, 64]], bells: [69, 73, 76, 81], tone: 1300, tempo: 10 },
    quiet: { chords: [], bells: [], tone: 600, tempo: 20 },
};

const FOOTSTEP: Record<Surface, { centre: number; q: number; length: number; level: number; click: number }> = {
    grass: { centre: 2600, q: 0.6, length: 0.09, level: 0.42, click: 0 },
    sand: { centre: 1100, q: 0.7, length: 0.12, level: 0.5, click: 0 },
    gravel: { centre: 1700, q: 0.9, length: 0.07, level: 0.55, click: 0.35 },
    snow: { centre: 3200, q: 1.4, length: 0.13, level: 0.45, click: 0.15 },
    regolith: { centre: 900, q: 0.8, length: 0.08, level: 0.45, click: 0.2 },
    water: { centre: 700, q: 0.5, length: 0.22, level: 0.5, click: 0 },
};

interface Layer { gain: GainNode; set: (value: number, time: number) => void }

const MASTER = 1.3;
const SFX = 0.9;
const AMBIENCE = 0.75;
const MUSIC = 0.32;

export class SoundEngine {
    ctx: Ctx | null = null;
    /** Rendering a recording (OfflineAudioContext), not playing: never suspended. */
    private offline = false;
    private master!: GainNode;
    private sfx!: GainNode;
    private ambience!: GainNode;
    private music!: GainNode;
    /** The channels (SoundChannel), each into the sounds' or the ambience's bus. */
    private channels!: Record<SoundChannel, GainNode>;
    private volumes: SoundVolumes = { ...FULL_VOLUME };
    /** Where tone() and burst() play when not told: the channel of the cue being played. */
    private current!: AudioNode;
    private reverb!: ConvolverNode;
    private noise: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } | null = null;
    private layers: Record<string, Layer> = {};
    private nodes: Record<string, AudioNode & { frequency?: AudioParam; Q?: AudioParam }> = {};
    private muted = false;
    private musicOn = true;
    private soundsOn = true;
    /** The music's own path into the reverb, so its echo goes quiet with it. */
    private musicSend!: GainNode;
    /** The sounds' own path into the reverb (cues played into the hall). */
    private sfxSend!: GainNode;
    private mood: Mood = 'quiet';
    private nextChord = 0;
    private chordIndex = 0;
    private nextBell = 0;
    private nextCrackle = 0;
    private alarmPhase = 0;
    private breathPhase = 0;
    private stopped = false;

    /**
     * Make the audio graph (once); a live context may start suspended until
     * the player interacts. A given context (an OfflineAudioContext) renders
     * a recording instead.
     */
    start(given?: BaseAudioContext) {
        if (this.ctx || this.stopped) return;
        let ctx: Ctx;
        if (given) {
            ctx = given;
            this.offline = true;
        } else {
            const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (!AudioCtor) return;
            try {
                ctx = new AudioCtor({ latencyHint: 'interactive' });
            } catch {
                return;
            }
        }
        this.ctx = ctx;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 12;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.004;
        compressor.release.value = 0.25;
        // A limiter last, so the loudest moments (an explosion) cannot clip.
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.1;
        compressor.connect(limiter).connect(ctx.destination);
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER * this.volumes.master;
        this.master.connect(compressor);
        this.sfx = this.bus(this.soundsOn ? SFX : 0);
        this.ambience = this.bus(this.soundsOn ? AMBIENCE : 0);
        this.music = this.bus(this.musicOn ? MUSIC * this.volumes.music : 0);
        const channel = (name: SoundChannel, into: GainNode) => {
            const gain = ctx.createGain();
            gain.gain.value = this.volumes[name];
            gain.connect(into);
            return gain;
        };
        this.channels = { ship: channel('ship', this.sfx), body: channel('body', this.sfx), world: channel('world', this.ambience), radio: channel('radio', this.sfx), alerts: channel('alerts', this.sfx) };
        this.current = this.channels.alerts;
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = reverbImpulse(ctx, 4.5, 2.6);
        this.musicSend = ctx.createGain();
        this.musicSend.gain.value = this.musicOn ? 1 : 0;
        this.musicSend.connect(this.reverb);
        this.sfxSend = ctx.createGain();
        this.sfxSend.gain.value = this.soundsOn ? 1 : 0;
        this.sfxSend.connect(this.reverb);
        const wet = ctx.createGain();
        wet.gain.value = 0.9;
        this.reverb.connect(wet).connect(this.master);
        this.noise = { white: noiseBuffer(ctx, 3, 'white'), pink: noiseBuffer(ctx, 4, 'pink'), brown: noiseBuffer(ctx, 4, 'brown') };
        this.buildLayers();
    }

    private bus(level: number) {
        const gain = this.ctx!.createGain();
        gain.gain.value = level;
        gain.connect(this.master);
        return gain;
    }

    /** Resume after the player's first click or key press (browsers start sound only then). */
    resume() {
        const ctx = this.ctx;
        if (ctx instanceof AudioContext && ctx.state === 'suspended') ctx.resume().catch(() => undefined);
    }

    suspend() {
        const ctx = this.ctx;
        if (ctx instanceof AudioContext && ctx.state === 'running') ctx.suspend().catch(() => undefined);
    }

    stop() {
        this.stopped = true;
        const ctx = this.ctx;
        if (ctx instanceof AudioContext) ctx.close().catch(() => undefined);
        this.ctx = null;
    }

    private get live() {
        return !!this.ctx && (this.offline || this.ctx.state === 'running');
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER * this.volumes.master, this.ctx.currentTime, 0.08);
    }

    /** The music alone. */
    setMusic(on: boolean) {
        this.musicOn = on;
        if (!this.ctx) return;
        this.music.gain.setTargetAtTime(on ? MUSIC * this.volumes.music : 0, this.ctx.currentTime, 0.4);
        this.musicSend.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.4);
    }

    /** Each channel's level, the music's and the overall (0 to 1; 0 is off). */
    setVolumes(volumes: SoundVolumes) {
        this.volumes = { ...volumes };
        const ctx = this.ctx;
        if (!ctx) return;
        const t = ctx.currentTime;
        this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER * volumes.master, t, 0.08);
        this.music.gain.setTargetAtTime(this.musicOn ? MUSIC * volumes.music : 0, t, 0.2);
        this.musicSend.gain.setTargetAtTime(this.musicOn && volumes.music > 0 ? 1 : 0, t, 0.2);
        for (const name of Object.keys(this.channels) as SoundChannel[]) this.channels[name].gain.setTargetAtTime(volumes[name], t, 0.08);
    }

    /** Everything but the music: footsteps, engines, wind, alarms, the radio. */
    setSounds(on: boolean) {
        this.soundsOn = on;
        if (!this.ctx) return;
        this.sfx.gain.setTargetAtTime(on ? SFX : 0, this.ctx.currentTime, 0.08);
        this.ambience.gain.setTargetAtTime(on ? AMBIENCE : 0, this.ctx.currentTime, 0.08);
        this.sfxSend.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.08);
    }

    // ---- Continuous layers --------------------------------------------------------

    private loop(buffer: AudioBuffer, rate = 1) {
        const source = this.ctx!.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = rate;
        source.start(this.ctx!.currentTime + Math.random() * 0.05, Math.random() * buffer.duration);
        return source;
    }

    private filter(type: BiquadFilterType, frequency: number, q = 0.7) {
        const node = this.ctx!.createBiquadFilter();
        node.type = type;
        node.frequency.value = frequency;
        node.Q.value = q;
        return node;
    }

    private layer(name: string, output: AudioNode, smoothing = 0.12): GainNode {
        const gain = this.ctx!.createGain();
        gain.gain.value = 0;
        gain.connect(output);
        this.layers[name] = {
            gain,
            set: (value, time) => gain.gain.setTargetAtTime(Math.max(0, value), time, smoothing),
        };
        return gain;
    }

    private buildLayers() {
        const ctx = this.ctx!;
        const n = this.noise!;
        // The ship's engines: a low hum, a rumble and a faint turbine whine,
        // all through one filter that opens with the throttle.
        const engineFilter = this.filter('lowpass', 300, 0.9);
        engineFilter.connect(this.layer('engine', this.channels.ship, 0.18));
        const hum = [0, 7, -5].map((detune) => {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = 46;
            osc.detune.value = detune;
            const g = ctx.createGain();
            g.gain.value = 0.12;
            osc.connect(g).connect(engineFilter);
            osc.start();
            return osc;
        });
        const rumble = this.loop(n.brown);
        const rumbleGain = ctx.createGain();
        rumbleGain.gain.value = 0.9;
        rumble.connect(rumbleGain).connect(engineFilter);
        // The turbines' whistle: a narrow band of noise (a pure tone sounds like a synthesiser).
        const whine = this.filter('bandpass', 600, 9);
        const whineGain = ctx.createGain();
        whineGain.gain.value = 0;
        this.loop(n.white).connect(whine).connect(whineGain).connect(this.channels.ship);
        this.nodes.engineFilter = engineFilter;
        this.nodes.whineGain = whineGain;
        this.nodes.whine = whine;
        this.nodes.hum0 = hum[0];
        this.nodes.hum1 = hum[1];
        this.nodes.hum2 = hum[2];

        // Boost: a hard rush of exhaust.
        const boostFilter = this.filter('bandpass', 900, 0.8);
        this.loop(n.white).connect(boostFilter).connect(this.layer('boost', this.channels.ship));
        // The pulse drive: a deep fifth that throbs, and a rising rush.
        const pulseOut = this.layer('pulse', this.channels.ship, 0.4);
        for (const [frequency, level] of [[33, 0.5], [49.5, 0.35], [66, 0.18]] as const) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = frequency;
            const g = ctx.createGain();
            g.gain.value = level;
            const lfo = ctx.createOscillator();
            lfo.frequency.value = 0.35 + frequency / 400;
            const depth = ctx.createGain();
            depth.gain.value = level * 0.4;
            lfo.connect(depth).connect(g.gain);
            osc.connect(g).connect(pulseOut);
            osc.start();
            lfo.start();
        }
        const pulseRush = this.filter('bandpass', 500, 0.6);
        const rushGain = ctx.createGain();
        rushGain.gain.value = 0.5;
        this.loop(n.pink).connect(pulseRush).connect(rushGain).connect(pulseOut);
        this.nodes.pulseRush = pulseRush;

        // Air rushing over the hull, and the roar of a hot entry.
        const airflowFilter = this.filter('bandpass', 500, 0.5);
        this.loop(n.pink).connect(airflowFilter).connect(this.layer('airflow', this.channels.world, 0.2));
        this.nodes.airflowFilter = airflowFilter;
        this.loop(n.brown).connect(this.filter('lowpass', 420, 0.6)).connect(this.layer('entry', this.channels.ship, 0.25));

        // Wind on the ground, gusting: two bands whose levels drift.
        const windOut = this.layer('wind', this.channels.world, 0.6);
        const windLow = this.filter('bandpass', 380, 0.5);
        const windHigh = this.filter('bandpass', 1300, 1.2);
        const windLowGain = ctx.createGain();
        const windHighGain = ctx.createGain();
        windLowGain.gain.value = 0.8;
        windHighGain.gain.value = 0.25;
        this.loop(n.pink, 0.9).connect(windLow).connect(windLowGain).connect(windOut);
        this.loop(n.pink, 1.1).connect(windHigh).connect(windHighGain).connect(windOut);
        for (const [param, rate, depth] of [[windLowGain.gain, 0.07, 0.45], [windHighGain.gain, 0.11, 0.2], [windHigh.frequency, 0.05, 500]] as const) {
            const lfo = ctx.createOscillator();
            lfo.frequency.value = rate;
            const g = ctx.createGain();
            g.gain.value = depth;
            lfo.connect(g).connect(param);
            lfo.start();
        }
        this.nodes.windLow = windLow;
        this.nodes.windHigh = windHigh;

        // Breathing inside the helmet, where there is no air outside.
        const breathFilter = this.filter('bandpass', 1400, 0.9);
        this.loop(n.pink).connect(breathFilter).connect(this.layer('breathing', this.channels.body, 0.35));
        this.nodes.breathFilter = breathFilter;
        // Jetpack: a hiss over a rumble.
        const jetOut = this.layer('jetpack', this.channels.body, 0.06);
        this.loop(n.white).connect(this.filter('highpass', 1100, 0.6)).connect(jetOut);
        const jetRumble = ctx.createGain();
        jetRumble.gain.value = 0.8;
        this.loop(n.brown).connect(this.filter('lowpass', 220, 0.7)).connect(jetRumble).connect(jetOut);
        // The mining beam: a buzzing tone with a fizz.
        const laserOut = this.layer('laser', this.channels.body, 0.05);
        const carrier = ctx.createOscillator();
        carrier.type = 'sawtooth';
        carrier.frequency.value = 150;
        const modulator = ctx.createOscillator();
        modulator.frequency.value = 37;
        const modDepth = ctx.createGain();
        modDepth.gain.value = 40;
        modulator.connect(modDepth).connect(carrier.frequency);
        const laserTone = ctx.createGain();
        laserTone.gain.value = 0.25;
        carrier.connect(this.filter('bandpass', 1100, 1.3)).connect(laserTone).connect(laserOut);
        carrier.start();
        modulator.start();
        const fizz = ctx.createGain();
        fizz.gain.value = 0.35;
        this.loop(n.white).connect(this.filter('highpass', 4200, 0.7)).connect(fizz).connect(laserOut);
        // Water lapping and running.
        const waterFilter = this.filter('lowpass', 700, 0.4);
        this.loop(n.pink, 0.8).connect(waterFilter).connect(this.layer('water', this.channels.world, 0.5));
        // A campfire's low roar (its crackles are scheduled).
        this.loop(n.brown).connect(this.filter('lowpass', 360, 0.5)).connect(this.layer('fire', this.channels.world, 0.4));
        // The Sun's heat on the hull: a deep roar with a sizzle.
        const heatOut = this.layer('heat', this.channels.ship, 0.4);
        this.loop(n.brown).connect(this.filter('lowpass', 260, 0.6)).connect(heatOut);
        const sizzle = ctx.createGain();
        sizzle.gain.value = 0.18;
        this.loop(n.white).connect(this.filter('highpass', 3000, 0.6)).connect(sizzle).connect(heatOut);
        // TON 618: a drone below hearing's floor, felt more than heard.
        const holeOut = this.layer('blackHole', this.channels.world, 1.2);
        for (const frequency of [24, 36, 37.3]) {
            const osc = ctx.createOscillator();
            osc.frequency.value = frequency;
            const g = ctx.createGain();
            g.gain.value = 0.35;
            osc.connect(g).connect(holeOut);
            osc.start();
        }
        this.loop(n.brown, 0.5).connect(this.filter('lowpass', 120, 0.5)).connect(holeOut);
        // The ship's radio: static, and a signal under it.
        const radioOut = this.layer('radio', this.channels.radio, 0.15);
        const staticGain = ctx.createGain();
        staticGain.gain.value = 0.5;
        this.loop(n.white).connect(this.filter('bandpass', 2400, 0.4)).connect(staticGain).connect(radioOut);
        const signal = ctx.createOscillator();
        signal.type = 'sine';
        signal.frequency.value = 660;
        const signalGain = ctx.createGain();
        signalGain.gain.value = 0;
        signal.connect(signalGain).connect(radioOut);
        signal.start();
        this.nodes.staticGain = staticGain;
        this.nodes.signal = signal;
        this.nodes.signalGain = signalGain;
    }

    // ---- Each frame ------------------------------------------------------------------

    /** Steer every layer towards the mix, and schedule what plays by itself (chords, bells, crackles, alarms). */
    update(mix: Mix, mood: Mood, dt: number) {
        const ctx = this.ctx;
        if (!ctx || !this.live) return;
        const t = ctx.currentTime;
        const set = (name: string, value: number) => this.layers[name]?.set(value, t);
        const param = (node: string, key: 'frequency' | 'Q', value: number, smooth = 0.15) => {
            const p = (this.nodes[node] as unknown as Record<string, AudioParam>)?.[key];
            if (p) p.setTargetAtTime(value, t, smooth);
        };

        // Engine: pitch and brightness with the throttle; duller in vacuum (heard through the hull).
        const thrust = mix.thrust;
        set('engine', mix.engine * (0.55 + thrust * 0.45) * (1 - mix.vacuum * 0.35) * 0.65);
        param('engineFilter', 'frequency', (140 + thrust * 520 + mix.boost * 500) * (1 - mix.vacuum * 0.45));
        for (const name of ['hum0', 'hum1', 'hum2']) {
            const osc = this.nodes[name] as unknown as OscillatorNode;
            osc?.frequency.setTargetAtTime(42 + thrust * 30 + mix.boost * 18, t, 0.3);
        }
        (this.nodes.whine as unknown as BiquadFilterNode)?.frequency.setTargetAtTime(520 + thrust * 700 + mix.boost * 500, t, 0.3);
        (this.nodes.whineGain as unknown as GainNode)?.gain.setTargetAtTime(mix.engine * (0.05 + thrust * 0.12) * (1 - mix.vacuum * 0.6), t, 0.3);
        set('boost', mix.boost * mix.engine * 0.22 * (1 - mix.vacuum * 0.4));
        set('pulse', mix.pulse * 0.38);
        param('pulseRush', 'frequency', 300 + mix.pulse * 900, 0.6);
        set('airflow', mix.airflow * 0.4);
        param('airflowFilter', 'frequency', 280 + mix.airflow * 1400, 0.3);
        set('entry', mix.entry * 0.9);
        // Wind: thin air whistles faintly and high; thick air roars low.
        set('wind', mix.wind * (mix.airDensity < 0.5 ? 0.18 : 0.3));
        param('windLow', 'frequency', mix.airDensity > 1.2 ? 220 : mix.airDensity < 0.5 ? 650 : 380, 1);
        param('windHigh', 'frequency', mix.airDensity < 0.5 ? 2100 : 1300, 1);
        // Breathing: in and out, quicker when running.
        this.breathPhase += dt * mix.breathRate * Math.PI * 2;
        const breath = Math.max(0, Math.sin(this.breathPhase)) ** 2 * 0.9 + Math.max(0, -Math.sin(this.breathPhase)) ** 2 * 0.5;
        set('breathing', mix.breathing * 0.11 * breath);
        param('breathFilter', 'frequency', Math.sin(this.breathPhase) > 0 ? 1600 : 1100, 0.2);
        set('jetpack', mix.jetpack * 0.45);
        set('laser', mix.laser * 0.32);
        set('water', mix.water * 0.45);
        set('fire', mix.fire * 0.35);
        set('heat', mix.heat * 0.55);
        set('blackHole', mix.blackHole * 0.9);
        set('radio', mix.radio * 0.4);
        (this.nodes.staticGain as unknown as GainNode)?.gain.setTargetAtTime(0.5 * (1 - mix.radioSignal * 0.7), t, 0.2);
        (this.nodes.signalGain as unknown as GainNode)?.gain.setTargetAtTime(mix.radioSignal * 0.22 * (0.6 + 0.4 * Math.sin(t * 5.3) ** 2), t, 0.05);
        (this.nodes.signal as unknown as OscillatorNode)?.frequency.setTargetAtTime(660 * mix.radioPitch, t, 0.1);

        // Crackles from the fire.
        if (mix.fire > 0.02 && t > this.nextCrackle) {
            this.click(0.05 + Math.random() * 0.18 * mix.fire, 1800 + Math.random() * 2400);
            this.nextCrackle = t + 0.04 + Math.random() * Math.random() * 0.5;
        }
        // Alarms: the heat shield failing, the shield or health running out.
        if (mix.heatAlarm || mix.lowAlarm) {
            this.alarmPhase += dt;
            const period = mix.heatAlarm ? 0.42 : 1.1;
            if (this.alarmPhase > period) {
                this.alarmPhase = 0;
                this.tone(mix.heatAlarm ? 988 : 660, 0.12, 0.09, 'square', this.channels.alerts, 2400);
            }
        }
        this.updateMusic(mood, t);
    }

    // ---- Music ----------------------------------------------------------------------------

    private updateMusic(mood: Mood, t: number) {
        if (mood !== this.mood) {
            this.mood = mood;
            this.nextChord = Math.min(this.nextChord, t + 1.5);
            this.chordIndex = 0;
        }
        const style = MOODS[mood];
        if (!style.chords.length || !this.musicOn) return;
        if (t >= this.nextChord) {
            const chord = style.chords[this.chordIndex % style.chords.length];
            this.chordIndex += 1;
            const hold = style.tempo;
            chord.forEach((note, i) => this.pad(midi(note), t + i * 0.08, hold + 3, i === 0 ? 0.09 : 0.055, style.tone));
            this.nextChord = t + hold;
        }
        if (t >= this.nextBell) {
            if (this.nextBell > 0 && Math.random() < 0.8) {
                const note = style.bells[Math.floor(Math.random() * style.bells.length)];
                this.bell(midi(note), t, 0.05);
                if (Math.random() < 0.35) this.bell(midi(style.bells[Math.floor(Math.random() * style.bells.length)]), t + 0.45 + Math.random() * 0.4, 0.035);
            }
            this.nextBell = t + 3 + Math.random() * 6;
        }
    }

    /** A soft pad voice: two detuned saws and a triangle, slowly swelling and fading, in the reverb. */
    private pad(frequency: number, at: number, length: number, level: number, tone: number) {
        const ctx = this.ctx!;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0, at);
        out.gain.linearRampToValueAtTime(level, at + length * 0.3);
        out.gain.setValueAtTime(level, at + length * 0.55);
        out.gain.linearRampToValueAtTime(0, at + length);
        const lowpass = this.filter('lowpass', tone, 0.5);
        lowpass.connect(out);
        out.connect(this.music);
        const send = ctx.createGain();
        send.gain.value = 0.7;
        out.connect(send).connect(this.musicSend);
        for (const [type, detune, gain] of [['sawtooth', -6, 0.35], ['sawtooth', 6, 0.35], ['triangle', 0, 0.6]] as const) {
            const osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.value = frequency;
            osc.detune.value = detune;
            const g = ctx.createGain();
            g.gain.value = gain;
            osc.connect(g).connect(lowpass);
            osc.start(at);
            osc.stop(at + length + 0.1);
        }
    }

    /** A bell: a few inharmonic partials, ringing out. */
    private bell(frequency: number, at: number, level: number) {
        const ctx = this.ctx!;
        const out = ctx.createGain();
        out.gain.value = level;
        out.connect(this.music);
        const send = ctx.createGain();
        send.gain.value = 1.2;
        out.connect(send).connect(this.musicSend);
        for (const [ratio, gain, decay] of [[1, 1, 3.2], [2.76, 0.35, 1.6], [5.4, 0.15, 0.8], [0.5, 0.25, 4]] as const) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = frequency * ratio;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, at);
            g.gain.linearRampToValueAtTime(gain, at + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
            osc.connect(g).connect(out);
            osc.start(at);
            osc.stop(at + decay + 0.05);
        }
    }

    // ---- Short sounds ----------------------------------------------------------------------

    private tone(frequency: number, length: number, level: number, type: OscillatorType = 'sine', output: AudioNode = this.current, lowpass = 6000, glideTo?: number, at?: number) {
        const ctx = this.ctx!;
        const start = at ?? ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, start);
        if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(level, start + Math.min(0.01, length * 0.2));
        g.gain.exponentialRampToValueAtTime(0.0001, start + length);
        osc.connect(this.filter('lowpass', lowpass, 0.7)).connect(g).connect(output);
        osc.start(start);
        osc.stop(start + length + 0.05);
    }

    private burst(colour: 'white' | 'pink' | 'brown', length: number, level: number, type: BiquadFilterType, frequency: number, q = 0.7, sweepTo?: number, attack = 0.004, at?: number, output: AudioNode = this.current) {
        const ctx = this.ctx!;
        const start = at ?? ctx.currentTime;
        const source = ctx.createBufferSource();
        source.buffer = this.noise![colour];
        const filter = this.filter(type, frequency, q);
        if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + length);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(level, start + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, start + length);
        source.connect(filter).connect(g).connect(output);
        source.start(start, Math.random() * (source.buffer.duration - length - 0.1));
        source.stop(start + length + 0.05);
    }

    private click(level: number, frequency: number) {
        this.burst('white', 0.018 + Math.random() * 0.02, level, 'bandpass', frequency, 1.4, undefined, 0.001, undefined, this.channels.world);
    }

    /** A short sound for something that just happened. */
    cue(name: CueName, volume = 1, option = 0) {
        const ctx = this.ctx;
        if (!ctx || !this.live || !this.noise) return;
        const t = ctx.currentTime;
        const v = volume;
        // On the cue's own channel (Settings), by default and wherever it names one.
        this.current = this.channels[CUE_CHANNEL[name]];
        switch (name) {
            case 'notice':
                this.tone(1318, 0.16, 0.05 * v, 'sine');
                this.tone(1975, 0.12, 0.025 * v, 'sine', this.current, 6000, undefined, t + 0.05);
                break;
            case 'menu':
                this.click(0.12 * v, 2400);
                this.tone(880, 0.06, 0.03 * v, 'triangle');
                break;
            case 'waypoint':
                this.tone(1046, 0.25, 0.05 * v);
                this.tone(1568, 0.35, 0.05 * v, 'sine', this.current, 6000, undefined, t + 0.1);
                break;
            case 'engage':
                this.tone(70, 1.4, 0.35 * v, 'sine', this.current, 400, 28);
                this.burst('pink', 1.6, 0.35 * v, 'bandpass', 200, 0.6, 2200, 0.5);
                break;
            case 'drop':
                this.burst('pink', 0.9, 0.3 * v, 'bandpass', 1800, 0.6, 150, 0.02);
                this.tone(40, 0.8, 0.25 * v, 'sine', this.current, 300, 60);
                break;
            case 'gear':
                this.tone(210, 0.55, 0.06 * v, 'sawtooth', this.current, 900, 130);
                this.burst('brown', 0.18, 0.3 * v, 'lowpass', 500, 0.7, undefined, 0.004, t + 0.5);
                break;
            case 'touchdown':
                this.tone(70, 0.35, 0.4 * v, 'sine', this.current, 300, 38);
                this.burst('brown', 0.4, 0.45 * v, 'lowpass', 400, 0.6);
                break;
            case 'takeoff':
                this.burst('pink', 1.6, 0.3 * v, 'bandpass', 300, 0.5, 1400, 0.4);
                break;
            case 'step': {
                const style = FOOTSTEP[(['grass', 'sand', 'gravel', 'snow', 'regolith', 'water'] as Surface[])[option] ?? 'gravel'];
                this.burst('pink', style.length, style.level * 0.9 * v, 'bandpass', style.centre * (0.85 + Math.random() * 0.3), style.q);
                // The heel coming down: a dull thud under the scuff.
                this.burst('brown', 0.07, 0.5 * v, 'lowpass', 260, 0.7, undefined, 0.003);
                if (style.click > 0) this.click(style.click * 0.45 * v, 3000 + Math.random() * 2000);
                if (option === 5) this.burst('white', 0.25, 0.15 * v, 'bandpass', 1500, 0.6, 400, 0.01);
                break;
            }
            case 'jump':
                this.burst('white', 0.22, 0.12 * v, 'highpass', 1600, 0.6, undefined, 0.01);
                break;
            case 'land':
                this.burst('brown', 0.3, 0.45 * v, 'lowpass', 360, 0.6);
                this.tone(60, 0.25, 0.25 * v, 'sine', this.current, 300, 40);
                break;
            case 'hurt':
                this.tone(55, 0.4, 0.45 * v, 'sine', this.current, 300, 35);
                this.tone(740, 0.12, 0.06 * v, 'square', this.current, 2200, undefined, t + 0.1);
                this.tone(740, 0.12, 0.06 * v, 'square', this.current, 2200, undefined, t + 0.32);
                break;
            case 'mined':
                // A crystal shattering: bright partials and glass.
                for (let i = 0; i < 5; i++) {
                    this.tone(1760 * (1 + i * 0.5 + Math.random() * 0.08), 0.5 + Math.random() * 0.6, 0.035 * v, 'sine', this.current, 12000, undefined, t + i * 0.025);
                }
                this.burst('white', 0.35, 0.12 * v, 'highpass', 5000, 0.7, undefined, 0.002);
                this.tone(1318, 0.9, 0.04 * v, 'sine', this.sfxSend, 12000, undefined, t + 0.05);
                break;
            case 'gather':
                for (let i = 0; i < 4; i++) this.burst('pink', 0.12, 0.12 * v, 'bandpass', 3200 + Math.random() * 1500, 1.1, undefined, 0.01, t + i * 0.09);
                break;
            case 'eat':
                for (let i = 0; i < 3; i++) this.burst('white', 0.08, 0.14 * v, 'bandpass', 1500 + Math.random() * 900, 1.5, undefined, 0.003, t + i * 0.32);
                break;
            case 'craft':
                [659, 880, 1318].forEach((f, i) => this.tone(f, 0.22, 0.05 * v, 'triangle', this.current, 4000, undefined, t + i * 0.08));
                break;
            case 'camp':
                this.burst('brown', 1.2, 0.4 * v, 'lowpass', 300, 0.5, 900, 0.25);
                break;
            case 'rock':
                this.burst('brown', 0.9, 0.5 * v, 'lowpass', 700, 0.6, 120, 0.01);
                for (let i = 0; i < 6; i++) this.click(0.12 * v, 900 + Math.random() * 1200);
                break;
            case 'impact':
                this.tone(110, 0.45, 0.5 * v, 'sine', this.current, 600, 45);
                this.tone(523, 0.6, 0.1 * v, 'triangle', this.current, 3000, 480);
                this.burst('brown', 0.5, 0.5 * v, 'lowpass', 900, 0.7);
                break;
            case 'explosion':
                this.tone(55, 2.2, 0.8 * v, 'sine', this.current, 200, 24);
                this.burst('brown', 2.6, 0.9 * v, 'lowpass', 2400, 0.6, 140, 0.005);
                this.burst('white', 1.4, 0.65 * v, 'lowpass', 7000, 0.5, 500, 0.002);
                this.burst('pink', 0.5, 0.5 * v, 'bandpass', 1400, 0.6, 300, 0.001);
                for (let i = 0; i < 22; i++) this.burst('white', 0.06, 0.2 * v, 'bandpass', 1200 + Math.random() * 3500, 1.2, undefined, 0.002, t + 0.25 + Math.random() * 2.2);
                break;
            case 'interdict':
                this.tone(180, 1.1, 0.3 * v, 'sawtooth', this.current, 700, 40);
                this.burst('brown', 1.4, 0.5 * v, 'lowpass', 600, 0.6, 90, 0.02);
                break;
            case 'chapter':
                [523, 659, 784, 1046].forEach((f, i) => this.bell(f, t + i * 0.16, 0.06 * v));
                break;
            case 'site':
                [392, 494, 587, 740].forEach((f, i) => this.tone(f, 2.2, 0.03 * v, 'triangle', this.sfxSend, 3000, undefined, t + i * 0.12));
                break;
            case 'transit':
                this.burst('pink', 2.4, 0.45 * v, 'bandpass', 120, 0.7, 4000, 0.8);
                this.tone(55, 2.5, 0.3 * v, 'sine', this.current, 500, 220);
                break;
            case 'scan':
                this.tone(1568, 0.08, 0.05 * v, 'square', this.current, 3000);
                this.tone(2093, 0.1, 0.05 * v, 'square', this.current, 3000, undefined, t + 0.1);
                break;
            case 'splash':
                this.burst('white', 0.5, 0.3 * v, 'bandpass', 1400, 0.5, 300, 0.005);
                this.burst('brown', 0.4, 0.3 * v, 'lowpass', 500, 0.6);
                break;
            case 'growl': {
                // A predator's growl: a low buzz with a wavering throat.
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(70 + option * 20, t);
                osc.frequency.linearRampToValueAtTime(55 + option * 15, t + 0.9);
                const throat = this.filter('bandpass', 420, 2.2);
                const lfo = ctx.createOscillator();
                lfo.frequency.value = 9 + Math.random() * 6;
                const depth = ctx.createGain();
                depth.gain.value = 160;
                lfo.connect(depth).connect(throat.frequency);
                const g = ctx.createGain();
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(0.28 * v, t + 0.12);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
                osc.connect(throat).connect(g).connect(this.current);
                osc.start(t);
                lfo.start(t);
                osc.stop(t + 1.05);
                lfo.stop(t + 1.05);
                break;
            }
            case 'call': {
                // A grazer's call: a soft rising and falling hoot.
                const base = 260 + option * 90;
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(base, t);
                osc.frequency.linearRampToValueAtTime(base * 1.35, t + 0.18);
                osc.frequency.linearRampToValueAtTime(base * 0.9, t + 0.55);
                const g = ctx.createGain();
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(0.07 * v, t + 0.06);
                g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
                osc.connect(this.filter('lowpass', 1600, 0.8)).connect(g).connect(this.current);
                const send = ctx.createGain();
                send.gain.value = 0.5;
                g.connect(send).connect(this.sfxSend);
                osc.start(t);
                osc.stop(t + 0.75);
                break;
            }
            case 'radio':
                this.burst('white', 0.25, 0.18 * v, 'bandpass', 2600, 0.5);
                this.tone(1200, 0.06, 0.04 * v, 'square', this.current, 3000, undefined, t + 0.22);
                break;
            case 'thunder': {
                // A crack when the stroke is close, then the rumble rolling
                // round the cloud decks, each echo later and duller.
                if (v > 0.8) this.burst('white', 0.4, 0.3 * (v - 0.6), 'highpass', 900, 0.6, 300, 0.002);
                this.burst('brown', 2.4 + v, 0.8 * v, 'lowpass', 240, 0.6, 70, 0.06);
                for (let i = 0; i < 5; i++) {
                    this.burst('brown', 0.8 + Math.random() * 0.9, 0.45 * v * (1 - i / 6), 'lowpass', 160 + Math.random() * 180, 0.6, 60, 0.12, t + 0.25 + i * (0.3 + Math.random() * 0.45));
                }
                this.tone(36, 2.6, 0.32 * v, 'sine', this.current, 200, 27);
                break;
            }
        }
    }
}

/** One engine while the expedition is open; a new one each time it is opened again. */
let shared: SoundEngine | null = null;
export const soundEngine = () => {
    if (!shared) shared = new SoundEngine();
    return shared;
};
export const releaseSound = () => {
    shared?.stop();
    shared = null;
};
