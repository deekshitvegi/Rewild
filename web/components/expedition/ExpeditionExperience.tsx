import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DETAIL_NAME, dprFor, featuresKey, gpuInfo, readGraphics, resolveFeatures, saveGraphics, type GraphicsSetting } from './graphics';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { loadSnapshot, loadsSettled } from './loadProgress';
import * as THREE from 'three';
import { fromEquatorial } from './orbits';
import { Weather } from './Weather';
import { Aurora } from './Aurora';
import { Impacts } from './Impacts';
import { Domes } from './Domes';
import { Shelters } from './Shelters';
import { forceWeather } from './weather';
import { ExpeditionWorld } from './ExpeditionWorld';
import { ExpeditionHUD } from './ExpeditionHUD';
import { Player, type ExpeditionStart } from './Player';
import { attachInput, createInput } from './input';
import { createRuntime, cue, detectQuality, type ExpeditionRuntime } from './runtime';
import { MotionClock, changeWarp } from './MotionClock';
import { ArgoWatch } from './Argo';
import { directionToBody, directionToGame, fromStart, startOf, toStart, toUniverse, turnWithWorld } from './motion';
import { Soundscape } from './Soundscape';
import { Radio } from './Radio';
import { Aliens } from './Aliens';
import { Derelict } from './Derelict';
import { Vaults } from './Vaults';
import { HistoricSites } from './HistoricSites';
import { Landmarks } from './Landmarks';
import { HISTORIC_SITES, siteFrame } from './history';
import { markGpuRestored, textureQueue } from './models';
import { setDetailBudget } from './detailBudget';
import { releaseGasMaps } from './gasMaps';
import { EXPEDITIONS, startRun } from './expeditions';
import { Volcano } from './Volcano';
import { EnceladusGeysers } from './EnceladusGeysers';
import { StorySites } from './StorySites';
import { JupiterFloaters } from './JupiterFloaters';
import { OrbitDebris } from './OrbitDebris';
import { VAULTS, vaultFrame } from './vaults';
import { DataSites } from './DataSites';
import { DataLog } from './DataLog';
import { PostEffects } from './PostEffects';
import { SunFlare } from './SunFlare';
import { DeepSpace } from './DeepSpace';
import { BLACK_HOLE, WORMHOLES } from './deepSpace';
import { EXPEDITION_BODIES, findBody } from './bodies';
import { FallReadout } from './FallReadout';
import { beginFall, seekFall } from './fall';
import { lettersToLearn, loadProgress, saveProgress, type ExpeditionProgress } from './glyphs';
import { storyState } from './quests';
import { medalsRaised, newlyMet, rankName } from './challenges';
import { DATA_SITES, globeFrame, landingZoneDirection, openingHeading, prepareSites, type DataSite } from './sites';
import { earthMapSettled, loadEarthMap, riverProbe } from './earth';
import { loadMarsMap, marsMapSettled } from './mars';
import { mindOf, speciesOf } from './Wildlife';
import { groundHeight, groundSpot, waterDepth } from './environment';
import { ALIEN_SITES, sitePosition } from './aliens';
import { DERELICT } from './radio';
import { regionAt, regionLoad, startRegion, type Region } from './region';
import { WormholeFilm, type Crossing } from './WormholeFilm';
import '@fontsource-variable/inter/opsz.css';
import './expedition.css';
import './hud.css';
import './ui.css';
import { compileSafely } from './compileSafely';

/**
 * Expedition: the portfolio as an explorable star system, in the style of the
 * No Man's Sky-inspired reference video. Loaded on demand from "Choose your
 * journey"; the main portfolio scene is paused while it runs.
 */
const prefersReducedMotion = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Tells the page the expedition can be shown: once everything the landing
 * site needs has loaded (models, maps, the ground's pictures) and a few
 * frames have been drawn with all of it, so nothing pops in at the start;
 * or after a long wait, with whatever has arrived.
 */
const READY_TIMEOUT = 45000;
const ReadySignal = ({ onReady, compiled }: { onReady?: () => void; compiled: boolean }) => {
    const frames = useRef(0);
    const started = useRef(0);
    const done = useRef(false);
    useFrame(() => {
        if (done.current || !onReady) return;
        const now = performance.now();
        if (!started.current) started.current = now;
        // A few frames drawn once everything is loaded and compiled, so the first one seen is complete.
        if (compiled) frames.current += 1;
        if (frames.current >= 8 || now - started.current > READY_TIMEOUT + COMPILE_TIMEOUT) {
            done.current = true;
            onReady();
        }
    });
    return null;
};

/** Longest wait for the shaders to compile before drawing anyway. */
const COMPILE_TIMEOUT = 60000;

/**
 * Nothing is drawn until the shaders of what is in view have compiled, in the
 * background (KHR_parallel_shader_compile), while the loading card is up.
 * Drawn straight away, the first frame would compile dozens of large shaders
 * in one go, and Direct3D (Chrome and Edge on Windows) can take long enough
 * over them that the browser resets the graphics process: the whole window
 * goes blank. A frame callback of priority 1 stops React Three Fiber drawing;
 * the post-processing (which draws its own frames) waits too.
 *
 * Not the far worlds: three's compile() walks the whole scene, hidden
 * objects too, and the scene holds every world of the Solar System (27 ground
 * shaders, the wormholes, the black hole), some 220 programs and 6 MB of
 * shader code, which on Windows outlasted the wait and left the game starting
 * with shaders still compiling: lag for a minute or more. What is marked
 * `deferCompile` and hidden (a world under a pixel across, TON 618 and the
 * wormholes out of reach) is compiled afterwards, a piece at a time
 * (BackgroundCompile), or when first seen. Everything else near the player is
 * compiled here, hidden or not, so nothing stalls just after landing.
 */
const CompileGate = ({ onCompiled }: { onCompiled: () => void }) => {
    const settled = useRef(0);
    const begun = useRef(0);
    const asked = useRef(false);
    useFrame(({ gl, scene, camera }) => {
        if (asked.current) return;
        const now = performance.now();
        if (!begun.current) begun.current = now;
        settled.current = loadsSettled() ? settled.current + 1 : 0;
        // Once the models and pictures are in and the ground round the ship is built.
        if (settled.current < 6 && now - begun.current < READY_TIMEOUT) return;
        asked.current = true;
        compileNear(gl, scene, camera).then(() => onCompiled());
    }, 1);
    return null;
};

/** Compile what is near the player (everything but far things marked to wait), giving up after COMPILE_TIMEOUT. */
const compileNear = (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    const timeout = new Promise((resolve) => { window.setTimeout(resolve, COMPILE_TIMEOUT); });
    // three's compile() walks scene.traverse: for this call, one that
    // passes over far things marked to wait (hidden worlds, TON 618).
    const traverse = scene.traverse;
    scene.traverse = function (this: THREE.Object3D, callback: (object: THREE.Object3D) => void) {
        const visit = (object: THREE.Object3D) => {
            if (object.userData.deferCompile && !object.visible) return;
            callback(object);
            object.children.forEach(visit);
        };
        visit(this);
    };
    let compiling: Promise<unknown>;
    try { compiling = compileSafely(gl, scene, camera); } finally { scene.traverse = traverse; }
    return Promise.race([compiling, timeout]).catch(() => undefined);
};

/**
 * After a change of system (region.ts) the other one is built while the film of the crossing
 * plays (WormholeFilm.tsx). It is ready once its models and pictures are in, what is near the
 * player is compiled (as CompileGate does at the start), and CompileGuard is holding nothing back.
 * It does not stop the drawing as CompileGate does: the film covers it.
 */
const RegionGate = ({ onReady }: { onReady: () => void }) => {
    const state = useRef({ begun: 0, settled: 0, quiet: 0, stage: 'loading' as 'loading' | 'compiling' | 'held' | 'done' });
    useFrame(({ gl, scene, camera }) => {
        const s = state.current;
        const now = performance.now();
        if (!s.begun) s.begun = now;
        if (s.stage === 'loading') {
            // The film's bar: how much of what this system fetches has arrived, then the compiling.
            const loads = loadSnapshot();
            regionLoad.value = Math.max(regionLoad.value, 0.1 + 0.6 * (loads.total ? loads.done / loads.total : 1));
            s.settled = loadsSettled() ? s.settled + 1 : 0;
            if (s.settled < 6 && now - s.begun < READY_TIMEOUT) return;
            s.stage = 'compiling';
            regionLoad.value = Math.max(regionLoad.value, 0.75);
            compileNear(gl, scene, camera).then(() => { s.stage = 'held'; });
            return;
        }
        if (s.stage !== 'held') return;
        regionLoad.value = Math.max(regionLoad.value, 0.9 + 0.025 * s.quiet);
        s.quiet = compileStatus.held === 0 ? s.quiet + 1 : 0;
        if (s.quiet < 4 && now - s.begun < READY_TIMEOUT + COMPILE_TIMEOUT) return;
        s.stage = 'done';
        onReady();
    });
    return null;
};

/**
 * Which system the player is in, from where their ship is: through the wormhole, or put there
 * (a new ship by Saturn after TON 618, a crew member parked in the other system).
 */
const RegionWatch = ({ runtime, onCross }: { runtime: ExpeditionRuntime; onCross: (to: Region) => void }) => {
    useFrame(() => {
        const ship = runtime.player?.ship;
        if (!ship) return;
        const here = regionAt(ship.position);
        if (here === runtime.region) return;
        runtime.region = here;
        runtime.loading = true;
        onCross(here);
    });
    return null;
};

/**
 * Models' pictures sent up to the graphics card in the background as they load (models.ts
 * textureQueue), a couple of milliseconds' worth a frame (at least one), instead of all at once in
 * the frame that first draws them.
 */
const TextureUploads = () => {
    const gl = useThree((state) => state.gl);
    useFrame(() => {
        const start = performance.now();
        while (textureQueue.length > 0) {
            gl.initTexture(textureQueue.shift()!);
            if (performance.now() - start > 2) break;
        }
    });
    return null;
};

/**
 * Once the game is showing, the shaders of everything not yet drawn (the
 * other worlds, deep space) are compiled in the background one top-level
 * piece every couple of seconds, so that the first visit to a world does not
 * stall on its ground's shader. Only where the browser compiles off the main
 * thread (KHR_parallel_shader_compile); elsewhere each would freeze the game
 * in turn, so they compile when first seen.
 */
const BackgroundCompile = () => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        if (!gl.extensions.get('KHR_parallel_shader_compile')) return undefined;
        let alive = true;
        const parts = [...scene.children];
        (async () => {
            for (const part of parts) {
                await new Promise((resolve) => { window.setTimeout(resolve, 2000); });
                if (!alive) return;
                if (!part.parent) continue;
                await compileSafely(gl, part, camera, scene);
            }
        })();
        return () => { alive = false; };
    }, [gl, scene, camera]);
    return null;
};


/**
 * Never compile a shader in the middle of a frame. Coming up on a world, things appear that the
 * GPU has not drawn before (its moons, rings, ground, plants, models; a giant's cloud layers),
 * and drawing one waits until its shader is compiled and linked: on Windows that can be seconds,
 * the freezes on approach (worst at the giants, which bring the most). Just before each frame is
 * drawn, any material about to be drawn without a ready shader (new, or changed) is held back
 * for a moment while its shader compiles off the main thread (KHR_parallel_shader_compile), then
 * shown. Without that extension there is nothing to gain: drawing it is left as it was.
 */
/** How many materials CompileGuard is holding back while their shaders compile (RegionGate waits for none). */
const compileStatus = { held: 0 };

const CompileGuard = () => {
    const { gl, scene, camera } = useThree();
    const parallel = useMemo(() => !!gl.extensions.get('KHR_parallel_shader_compile'), [gl]);
    const pending = useRef(new Map<THREE.Material, number>());
    useFrame(() => {
        if (!parallel) return;
        const now = performance.now();
        const held = pending.current;
        scene.traverseVisible((object) => {
            const drawable = object as THREE.Mesh;
            if (!(drawable.isMesh || (object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite)) return;
            if (!object.layers.test(camera.layers)) return;
            const list = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
            for (const material of list) {
                if (!material || !material.visible) continue;
                if (held.has(material)) {
                    material.visible = false;
                    continue;
                }
                if (material.userData.warmed === material.version) continue;
                const properties = gl.properties.get(material) as { currentProgram?: unknown; __version?: number };
                if (properties.currentProgram && properties.__version === material.version) {
                    material.userData.warmed = material.version;
                    continue;
                }
                held.set(material, now);
                material.visible = false;
                const version = material.version;
                compileSafely(gl, object, camera, scene, 4000).then(() => {
                    material.userData.warmed = version;
                    held.delete(material);
                    material.visible = true;
                });
            }
        });
        // Never hold anything back for long, whatever happens to its compile.
        held.forEach((since, material) => {
            if (now - since < 4000) return;
            material.userData.warmed = material.version;
            held.delete(material);
            material.visible = true;
        });
        compileStatus.held = held.size;
        // Priority 0, mounted last: after the scene's own updates, before the frame is drawn. (Any
        // priority above 0 tells react-three-fiber this callback draws the frame itself, and with
        // the post-processing off, nothing would.)
    });
    return null;
};


/**
 * Resolution on Auto: fewer pixels while frames come slowly (deep in a giant's
 * clouds, or a laptop's graphics chip throttling after a long session), more
 * again once they keep up. Steps of 15% down and 10% up, at most one every 2 s
 * (each one resizes every buffer); a one-off stall (a shader, a picture
 * arriving) is not enough to step down.
 */
const AdaptiveResolution = ({ range, onChange, onFloor, hold }: { range: [number, number]; onChange: (dpr: number) => void; onFloor?: () => void; hold?: () => boolean }) => {
    // With detail on Auto too, the resolution only comes down a little before
    // the detail comes down instead (onFloor): a sharp picture with less in it
    // looks better than a blurred one with everything.
    const lowest = onFloor ? range[0] * 0.85 : Math.min(range[0], 0.6);
    const state = useRef({ dpr: Math.min(range[1], Math.max(range[0], window.devicePixelRatio || 1)), ema: 1 / 60, slow: 0, fast: 0, last: 0, floored: 0, done: false });
    useFrame((_, delta) => {
        const s = state.current;
        // Not while the other system is being built behind the film: those frames say nothing.
        if (hold?.()) {
            s.slow = 0;
            s.floored = 0;
            return;
        }
        // A long frame counts as a quarter of a second at most: one stall
        // fades from the average before it adds up to a step.
        const dt = Math.min(delta, 0.25);
        s.ema += (dt - s.ema) * 0.05;
        s.slow = s.ema > 1 / 44 ? s.slow + dt : 0;
        s.fast = s.ema < 1 / 57 ? s.fast + dt : 0;
        const now = performance.now();
        // Still slow at the lowest resolution for 6 s: less detail.
        s.floored = s.dpr <= lowest + 0.01 && s.ema > 1 / 44 ? s.floored + dt : 0;
        if (onFloor && !s.done && s.floored > 6) {
            s.done = true;
            onFloor();
            return;
        }
        if (now - s.last < 2000) return;
        const next = s.slow > 1.5 ? Math.max(lowest, s.dpr * 0.85) : s.fast > 5 ? Math.min(range[1], s.dpr * 1.1) : s.dpr;
        if (Math.abs(next - s.dpr) < 0.01) return;
        s.dpr = next;
        s.last = now;
        s.slow = 0;
        s.fast = 0;
        onChange(next);
    });
    return null;
};

/** What the first take-off says about the ship (a discovery card). */
const FIRST_FLIGHT = 'It can take you anywhere in the Solar System: the eight planets, twenty moons, Pluto and Charon, and through a wormhole out beyond Saturn. Open the map, pick a world and press Auto, and the autopilot flies you there. Your course is the gold marker.';

export default function ExpeditionExperience({ onExit, onReady, start, quality: forcedQuality }: {
    onExit: () => void;
    onReady?: () => void;
    start?: ExpeditionStart;
    quality?: 0 | 1 | 2;
}) {
    // Detail and resolution: the player's choice (Graphics in the toolbar), or what suits the device.
    const detected = useMemo(detectQuality, []);
    const gpu = useMemo(gpuInfo, []);
    // Steps of detail Auto has taken down this visit, because frames stayed slow.
    const [lowered, setLowered] = useState(0);
    const autoQuality = Math.max(0, detected - lowered) as 0 | 1 | 2;
    const [graphics, setGraphics] = useState<GraphicsSetting>(readGraphics);
    const changeGraphics = useCallback((next: GraphicsSetting) => {
        setGraphics(next);
        saveGraphics(next);
    }, []);
    const quality = forcedQuality ?? (graphics.detail === 'auto' ? autoQuality : graphics.detail);
    // Earth's and Mars's ground comes from maps, which those worlds, their
    // sites and landing spots all stand on: nothing is built until they have
    // arrived (or failed, when the world keeps invented ground).
    const [grounded, setGrounded] = useState(() => earthMapSettled() && marsMapSettled());
    useEffect(() => {
        if (grounded) return undefined;
        let alive = true;
        Promise.all([loadEarthMap(), loadMarsMap(findBody('skills')!)]).then(() => { if (alive) setGrounded(true); });
        return () => { alive = false; };
    }, [grounded]);
    if (grounded) prepareSites();
    // One runtime for the whole expedition: a change of detail rebuilds the world
    // round the player (below) but keeps where they are and what they carry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const runtime = useMemo(() => createRuntime(quality, prefersReducedMotion()), []);
    runtime.quality = quality;
    // Pictures loaded from now on follow the detail level's size (detailBudget.ts).
    setDetailBudget(quality);
    // The costlier effects as chosen (Settings › Graphics); a change rebuilds the scene as the detail does.
    const features = useMemo(() => resolveFeatures(graphics.features, quality), [graphics.features, quality]);
    runtime.features = features;
    // After the graphics device is reset and comes back, the scene is built again from scratch.
    const [restores, setRestores] = useState(0);
    const sceneKey = `${quality}-${featuresKey(features)}-${restores}`;
    const input = useMemo(createInput, []);
    const detachRef = useRef<(() => void) | null>(null);
    const [lost, setLost] = useState(false);
    const [progress, setProgress] = useState<ExpeditionProgress>(loadProgress);
    // A new game begins on Haven (the prologue, quests.ts); anyone further on, on Earth as before.
    const [begin] = useState<ExpeditionStart | undefined>(() => start ?? (progress.story.length === 0 ? { body: 'haven', landed: true } : undefined));
    // Which of the two systems is built (region.ts): the one the expedition begins in, then the
    // one the Argo crosses into. The swap waits until the film covers the screen; the gate then
    // waits for the new system to be ready, and the film fades back into the game.
    const [region, setRegion] = useState<Region>(() => {
        const first = startRegion(begin?.body);
        runtime.region = first;
        return first;
    });
    const [crossing, setCrossing] = useState<Crossing | null>(null);
    const [regionReady, setRegionReady] = useState(true);
    const onCross = useCallback((to: Region) => {
        regionLoad.value = 0.04;
        setRegionReady(false);
        setCrossing((last) => ({ to, film: !!runtime.transit, id: (last?.id ?? 0) + 1 }));
        window.setTimeout(() => setRegion(runtime.region), 450);
    }, [runtime]);
    // Out by TON 618, the giants' maps are let go once their worlds have been taken down (gasMaps.ts).
    useEffect(() => {
        if (region !== 'ton') return undefined;
        const since = performance.now();
        const timer = window.setTimeout(() => releaseGasMaps(since), 8000);
        return () => window.clearTimeout(timer);
    }, [region]);
    const markRegionReady = useCallback(() => setRegionReady(true), []);
    const closeCrossing = useCallback(() => setCrossing(null), []);
    const [openLog, setOpenLog] = useState<{ site: DataSite; learned: string[] } | null>(null);
    const discovered = useMemo(() => new Set(progress.sites), [progress.sites]);

    // Crystals, species, supplies and the story's records carried over from earlier visits.
    useEffect(() => {
        runtime.inventory.crystals = Math.max(runtime.inventory.crystals, progress.crystals);
        progress.fauna.forEach((id) => runtime.fauna.discovered.add(id));
        runtime.supplies = { ...progress.supplies };
        runtime.stats = JSON.parse(JSON.stringify(progress.stats));
        // The expedition begins landed on Earth.
        if (!runtime.stats.landed.includes('projects')) runtime.stats.landed.push('projects');
        // Only on start.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime]);

    const progressRef = useRef(progress);
    // Chapters whose world has been marked as the course (once each, so a course
    // the player clears on the map stays cleared), and when a chapter last finished.
    const markedRef = useRef(new Set<string>());
    const finishedAtRef = useRef(0);
    progressRef.current = progress;
    runtime.letters = progress.letters;

    // Reading a site: the first reading teaches new glyphs.
    runtime.events.openSite = useCallback((site: DataSite) => {
        if (document.pointerLockElement) document.exitPointerLock();
        runtime.sites.open = site;
        cue(runtime, 'site');
        const current = progressRef.current;
        const firstTime = !current.sites.includes(site.id);
        const learned = firstTime && site.kind !== 'obelisk' ? lettersToLearn(site.inscription, current.letters) : [];
        setOpenLog({ site, learned });
        if (!firstTime) return;
        const next = {
            ...current,
            letters: current.letters + learned.join(''),
            sites: [...current.sites, site.id],
            crystals: runtime.inventory.crystals,
        };
        progressRef.current = next;
        saveProgress(next);
        setProgress(next);
    }, [runtime]);

    // A vault's lid teaches the glyphs of the word it spells.
    runtime.events.learn = useCallback((letters: string[]) => {
        const current = progressRef.current;
        const fresh = [...new Set(letters)].filter((ch) => !current.letters.includes(ch));
        if (!fresh.length) return;
        const next = { ...current, letters: current.letters + fresh.join('') };
        progressRef.current = next;
        saveProgress(next);
        setProgress(next);
    }, []);

    // Wormhole crossings and falling into TON 618.
    const [falling, setFalling] = useState(false);
    runtime.events.transit = useCallback((to: string) => {
        if (!runtime.stats.visited.includes('wormhole')) runtime.stats.visited.push('wormhole');
        // Which way (the story asks for each: home from Haven, and back again).
        if (!runtime.stats.visited.includes(`crossed-${to}`)) runtime.stats.visited.push(`crossed-${to}`);
        cue(runtime, 'transit');
        const ship = runtime.hud.ship;
        if (!ship) return;
        ship.notice = to === 'wormhole-ton618' ? `THROUGH THE WORMHOLE · ${BLACK_HOLE.name}` : 'THROUGH THE WORMHOLE · HOME';
        ship.noticeTime = performance.now() / 1000;
    }, [runtime]);
    runtime.events.fall = useCallback(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        if (!runtime.stats.visited.includes('horizon')) runtime.stats.visited.push('horizon');
        setFalling(true);
    }, [runtime]);
    const finishFall = useCallback(() => {
        setFalling(false);
        runtime.fall.active = false;
        // Nothing comes back out of a black hole: the log ends, and a new
        // ship leaves the wormhole by Saturn.
        runtime.actions.arriveAt('wormhole-saturn');
        const ship = runtime.hud.ship;
        if (ship) {
            ship.shield = 1;
            ship.notice = 'SIGNAL LOST IN TON 618 · A NEW SHIP LEAVES THE WORMHOLE';
            ship.noticeTime = performance.now() / 1000;
        }
    }, [runtime]);
    runtime.events.fallDone = finishFall;

    const closeLog = useCallback(() => {
        runtime.sites.open = null;
        setOpenLog(null);
    }, [runtime]);

    // Keep crystals, species, supplies and the story's records saved; finish
    // story chapters whose objectives are all met, and pay their rewards.
    useEffect(() => {
        const timer = window.setInterval(() => {
            const current = progressRef.current;
            const fauna = [...runtime.fauna.discovered];
            if (runtime.camera.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * 400 && !runtime.stats.visited.includes('ton618')) {
                runtime.stats.visited.push('ton618');
            }
            let next: ExpeditionProgress = { ...current, crystals: runtime.inventory.crystals, fauna, supplies: { ...runtime.supplies }, stats: JSON.parse(JSON.stringify(runtime.stats)) };
            const announce = (message: string) => {
                const ship = runtime.hud.ship;
                if (!ship) return;
                ship.notice = message;
                ship.noticeTime = performance.now() / 1000;
            };
            const { finished } = storyState(next);
            if (finished.length) {
                const reward = finished.reduce((sum, chapter) => sum + chapter.reward, 0);
                runtime.inventory.crystals += reward;
                cue(runtime, 'chapter');
                next = { ...next, crystals: runtime.inventory.crystals, story: [...next.story, ...finished.map((c) => c.id)] };
                announce(`CHAPTER COMPLETE · ${finished[finished.length - 1].title.toUpperCase()} · +${reward} CRYSTALS`);
                finishedAtRef.current = performance.now();
            }
            // Where to go next: a chapter set on another world marks that world as
            // the course (a gold marker in the sky, the autopilot ready), a
            // few seconds after the last chapter's announcement has been read.
            const upcoming = storyState(next).chapter;
            if (upcoming?.world && runtime.currentBody?.id !== upcoming.world && !runtime.waypoint && !runtime.expedition && !markedRef.current.has(upcoming.id)
                && performance.now() - finishedAtRef.current > 5000) {
                markedRef.current.add(upcoming.id);
                runtime.waypoint = upcoming.world;
                // (The HUD's prompt says how to hand over to the autopilot: G, or Auto on a phone.)
                announce(`COURSE SET · ${(findBody(upcoming.world)?.name ?? upcoming.world).toUpperCase()}`);
            }
            // The first time the ship leaves the ground: what it can do.
            const flying = runtime.hud.ship;
            if (flying && runtime.mode === 'ship' && !flying.landed && runtime.altitude > 80 && !runtime.stats.visited.includes('first-flight')) {
                runtime.stats.visited.push('first-flight');
                runtime.scan.found = { name: 'Your ship', blurb: FIRST_FLIGHT, label: 'First flight' };
                runtime.scan.foundAt = performance.now() / 1000;
            }
            // Medals: a finished chapter's, and a better one when more of its bonus objectives are met.
            const raised = medalsRaised(next);
            if (raised.length) {
                const reward = raised.reduce((sum, r) => sum + r.reward, 0);
                runtime.inventory.crystals += reward;
                next = { ...next, crystals: runtime.inventory.crystals, medals: { ...next.medals, ...Object.fromEntries(raised.map((r) => [r.chapter.id, r.medal])) } };
                const last = raised[raised.length - 1];
                // A chapter just finished already said so; its medal follows only if it is better than bronze.
                if (!finished.length || last.medal !== 'bronze') {
                    cue(runtime, 'chapter', 0.7);
                    announce(`${last.medal.toUpperCase()} MEDAL · ${last.chapter.title.toUpperCase()}${reward ? ` · +${reward} CRYSTALS` : ''}`);
                }
            }
            // Challenges, rank by rank.
            const met = newlyMet(next);
            if (met.length) {
                const reward = met.reduce((sum, m) => sum + m.challenge.reward, 0);
                runtime.inventory.crystals += reward;
                next = { ...next, crystals: runtime.inventory.crystals, challenges: [...next.challenges, ...met.map((m) => m.challenge.id)] };
                const last = met[met.length - 1];
                const mastered = last.index === last.trade.ranks.length - 1;
                cue(runtime, 'chapter', 0.6);
                announce(mastered
                    ? `CHALLENGES · ${last.trade.title.toUpperCase()} · +${reward} CRYSTALS`
                    : `CHALLENGE · ${rankName(last.trade, last.index).toUpperCase()} COMPLETE · +${reward} CRYSTALS`);
            }
            // Seconds swum or rested tick all the time: they are saved in
            // five-second steps, so the page is not redrawn every second.
            const steady = (p: ExpeditionProgress) => JSON.stringify({ ...p, stats: { ...p.stats, swum: Math.floor(p.stats.swum / 5), rested: Math.floor(p.stats.rested / 5) } });
            if (steady(next) !== steady(current)) {
                progressRef.current = next;
                saveProgress(next);
                setProgress(next);
            }
        }, 1000);
        return () => window.clearInterval(timer);
    }, [runtime]);

    useEffect(() => () => detachRef.current?.(), []);

    // Local test harnesses reach the running expedition through this; production builds drop it.
    useEffect(() => {
        if (!import.meta.env.DEV) return undefined;
        const debug = window as unknown as { __expedition?: unknown };
        debug.__expedition = { runtime, input, sites: DATA_SITES, wormholes: WORMHOLES, blackHole: BLACK_HOLE, bodies: EXPEDITION_BODIES, beginFall, seekFall, globeFrame, riverProbe, landingZoneDirection, openingHeading, speciesOf, mindOf, waterDepth, groundHeight, groundSpot, alienSites: ALIEN_SITES, sitePosition, derelict: DERELICT, vaults: VAULTS, vaultFrame, fromEquatorial, forceWeather, historicSites: HISTORIC_SITES, siteFrame, expeditions: EXPEDITIONS, startRun, motionTools: { fromStart, toStart, turnWithWorld, directionToGame, directionToBody, toUniverse, changeWarp, startOf } };
        return () => { delete debug.__expedition; };
    }, [runtime, input]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' && !document.pointerLockElement && !runtime.sites.open && !runtime.menuOpen) onExit();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onExit, runtime]);

    // On Auto the pixel ratio follows the frame rate (AdaptiveResolution). It
    // goes through the Canvas's own prop: React Three Fiber resets the ratio
    // to that prop whenever the Canvas renders.
    const [adaptedDpr, setAdaptedDpr] = useState<number | null>(null);
    useEffect(() => { setAdaptedDpr(null); }, [quality, graphics.resolution]);
    const range = dprFor(quality, graphics.resolution);
    const dpr = Array.isArray(range) && adaptedDpr !== null ? adaptedDpr : range;
    // Shaders compiled in the background before anything is drawn (CompileGate),
    // again whenever a change of detail rebuilds the scene.
    const [compiled, setCompiled] = useState(false);
    const markCompiled = useCallback(() => {
        // Test pages time the start by it (development builds only).
        if (import.meta.env.DEV) (window as unknown as { __compiledAt?: number }).__compiledAt = performance.now();
        setCompiled(true);
    }, []);
    const notify = useCallback((text: string) => {
        const ship = runtime.hud.ship;
        if (!ship) return;
        ship.notice = text;
        ship.noticeTime = performance.now() / 1000;
    }, [runtime]);
    const lowerDetail = useCallback(() => {
        setLowered((n) => n + 1);
        notify(`GRAPHICS SET TO ${DETAIL_NAME[Math.max(0, autoQuality - 1) as 0 | 1 | 2].toUpperCase()} TO KEEP IT SMOOTH · O TO CHANGE`);
    }, [autoQuality, notify]);
    // Drawing on a laptop's built-in chip, or without the graphics card at all: say so once.
    const warned = useRef(false);
    useEffect(() => {
        if (!compiled || warned.current || forcedQuality !== undefined) return;
        if (gpu.kind !== 'software' && gpu.kind !== 'integrated') return;
        if (Math.min(window.innerWidth, window.innerHeight) < 600) return;
        warned.current = true;
        const timer = window.setTimeout(() => notify(gpu.kind === 'software'
            ? 'THIS BROWSER IS NOT USING YOUR GRAPHICS CARD · O FOR HOW TO FIX IT'
            : 'RUNNING ON BUILT-IN GRAPHICS · O TO USE YOUR GRAPHICS CARD'), 4000);
        return () => window.clearTimeout(timer);
    }, [compiled, forcedQuality, gpu, notify]);
    const builtQuality = useRef(quality);
    useEffect(() => {
        if (builtQuality.current === quality) return;
        builtQuality.current = quality;
        setCompiled(false);
    }, [quality]);

    if (!grounded) return <div className="expedition" role="application" aria-label="Expedition: fly the portfolio star system" aria-busy="true" />;

    return (
        <div className="expedition" role="application" aria-label="Expedition: fly the portfolio star system">
            <Canvas
                className="expedition__canvas"
                camera={{ fov: 62, near: 0.3, far: 1e11, position: [0, 0, 0] }}
                gl={{ logarithmicDepthBuffer: true, antialias: quality > 0, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
                dpr={dpr}
                onCreated={({ gl, scene, camera }) => {
                    // Test pages reach the renderer and the scene (development builds only).
                    if (import.meta.env.DEV) (window as unknown as { __three?: unknown }).__three = { gl, scene, camera };
                    // Reading back each new shader's status makes the page wait for the
                    // graphics driver to finish compiling it: only worth it while developing.
                    gl.debug.checkShaderErrors = import.meta.env.DEV;
                    detachRef.current?.();
                    detachRef.current = attachInput(input, gl.domElement);
                    gl.domElement.addEventListener('webglcontextlost', (event) => {
                        event.preventDefault();
                        setLost(true);
                    });
                    gl.domElement.addEventListener('webglcontextrestored', () => {
                        markGpuRestored();
                        setRestores((n) => n + 1);
                        setLost(false);
                    });
                }}
            >
                {/* A change of graphics detail rebuilds the scene (in this order); the player's state lives on the runtime. */}
                <Fragment key={sceneKey}>
                    <ExpeditionWorld runtime={runtime} region={region} />
                    <DeepSpace runtime={runtime} region={region} />
                    <DataSites runtime={runtime} discovered={discovered} />
                    <Player runtime={runtime} input={input} start={begin} region={region} />
                    <Aliens runtime={runtime} />
                    {region === 'sol' && (
                        <>
                            <Volcano runtime={runtime} />
                            <EnceladusGeysers runtime={runtime} />
                            <JupiterFloaters runtime={runtime} />
                            <OrbitDebris runtime={runtime} />
                            <HistoricSites runtime={runtime} />
                            <Aurora runtime={runtime} />
                            <SunFlare runtime={runtime} />
                        </>
                    )}
                    <StorySites runtime={runtime} />
                    <Derelict runtime={runtime} />
                    <Vaults runtime={runtime} />
                    <Landmarks runtime={runtime} />
                    <Shelters runtime={runtime} />
                    <Weather runtime={runtime} />
                    <Impacts runtime={runtime} />
                    <Domes runtime={runtime} />
                    {compiled && <PostEffects quality={quality} runtime={runtime} region={region} />}
                </Fragment>
                {/* Outside it: rebuilding the sound would drop the player's sound setting and need another tap to start. */}
                <MotionClock runtime={runtime} />
                <RegionWatch runtime={runtime} onCross={onCross} />
                {!regionReady && crossing && region === crossing.to && <RegionGate key={`region-${crossing.id}`} onReady={markRegionReady} />}
                <ArgoWatch runtime={runtime} />
                <Soundscape runtime={runtime} />
                <Radio runtime={runtime} />
                {!compiled && <CompileGate key={`compile-${quality}`} onCompiled={markCompiled} />}
                {compiled && <BackgroundCompile key={`background-${quality}-${region}`} />}
                <TextureUploads />
                {compiled && <CompileGuard key={`guard-${quality}`} />}
                {/* Not in the lab, whose views are measured at a fixed resolution. */}
                {compiled && forcedQuality === undefined && Array.isArray(range) && (
                    <AdaptiveResolution
                        key={`resolution-${quality}`}
                        range={range}
                        onChange={setAdaptedDpr}
                        onFloor={graphics.detail === 'auto' && quality > 0 ? lowerDetail : undefined}
                        hold={() => runtime.loading}
                    />
                )}
                <ReadySignal onReady={onReady} compiled={compiled} />
            </Canvas>
            <ExpeditionHUD runtime={runtime} input={input} onExit={onExit} progress={progress} graphics={{ setting: graphics, detected, quality, features, onChange: changeGraphics, gpu, lowered }} />
            <WormholeFilm runtime={runtime} region={region} crossing={crossing} ready={regionReady} onClosed={closeCrossing} />
            {falling && <FallReadout runtime={runtime} onSkip={finishFall} />}
            {openLog && <DataLog site={openLog.site} known={progress.letters} learned={openLog.learned} onClose={closeLog} />}
            {lost && (
                <div className="expedition-loading" role="alert">
                    The graphics device was reset. Rebuilding the scene as soon as it is back.
                </div>
            )}
        </div>
    );
}
