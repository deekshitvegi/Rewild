import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { findBody, sunDirectionAt, type ExpeditionBody } from './bodies';
import { gasModel, zoneAt, createZoneLook } from './gasAtmosphere';
import { groundHeight, skyBeyond, waterDepth } from './environment';
import { createShipState, updateShip, type ShipState } from './flight';
import { consume, type ExpeditionInput } from './input';
import { cue, type ExpeditionRuntime, type PlayerKeep } from './runtime';
import { activeMotion, directionToBody, directionToGame, fromStart, startOf, turnFromStart } from './motion';
import { Ship, SHIP_GEAR_HEIGHT, type ShipHandle } from './Ship';
import { Astronaut, type AstronautHandle, type Motion } from './Astronaut';
import { ExhaustTrails, SpeedStreaks } from './effects';
import { MiningEffects, SurfaceCrystals } from './Crystals';
import { SurfaceProps } from './Props';
import { Clouds } from './Clouds';
import { Wildlife } from './Wildlife';
import { createWalker, updateWalker, walkerCamera, type WalkerState } from './walking';
import { nearestInteractable } from './DataSites';
import { landingZoneDirection, openingHeading } from './sites';
import { SAMPLE_TUBES, tubeId } from './history';
import { BLACK_HOLE, WORMHOLES, crossThroat, farness, findWormhole } from './deepSpace';
import { updateEnvironment } from './environment';
import { PlayerShadows } from './ContactShadows';
import { FALL_LOST_AT, FALL_SPIRAL, FALL_STRETCH_AT, FALL_TRIGGER, advanceFall, beginFall, countFallDeath, spaghetti, spaghettiShot } from './fall';
import { CROSSING_LAYER } from './WormholeTransit';
import { Grass } from './Grass';
import { NO_MIRROR_LAYER, WaterSurface } from './WaterSurface';
import { TORCH } from './surfaceShading';
import { FORAGE_NAME, RECIPES, miningRate, type RecipeId } from './survival';
import { Campfire } from './Campfire';
import { ForagePlants } from './Forage';
import { Asteroids } from './Asteroids';
import { Fishing } from './Fishing';
import { beginFishing, castSpot, updateFishing } from './fishing';
import { Wreck } from './Wreck';
import { RUNE_HEIGHT, RUNE_REACH } from './Vaults';
import { HEAT_LIMIT, HEAT_WARNING, LOSS_SECONDS, SUN } from './hazards';
import { answerContact } from './contact';
import { advanceRecall, callShip } from './recall';
import { CrewFleet } from './CrewFleet';
import { LIVERIES } from './livery';
import { MothershipView } from './MothershipView';
import { TRANSIT_HOLD, TRANSIT_SECONDS, WormholeTransit } from './WormholeTransit';
import { BEAT, argoLook, crossingCamera, throatLook } from './crossing';
import { addRipple, bodyWarp, bodyWarpActive, clearBodyWarp, screenFx, stretchMatrix, toFrame } from './spacetime';
import { AfterimagesWatch } from './Afterimages';
import { ScreenWarpWatch } from './ScreenWarp';
import type { Region } from './region';
import { Colonists } from './Colonists';
import { Waterfalls } from './Waterfalls';
import { Lotus } from './Lotus';
import { DOME_RADIUS, addDome, domeCentre } from './Domes';
import { say } from './argo';
import { besidePose, copyShip, createCrew, formatMetres, park, unpark } from './crew';
import { MOTHERSHIP, advanceDocking, bayPose, beginDocking, createMothership, dockingCheck, placeMothership, undock } from './mothership';

export interface ExpeditionStart {
    /** Portfolio id of the world to begin at (default: Earth, Projects). */
    body?: string;
    /** Begin landed on the surface (the default) or flying low over it. */
    landed?: boolean;
}

/**
 * Where the expedition begins: by default landed on Earth (Projects), at its
 * landing zone by the Obelisk, in the grass among the trees, with the sun
 * low on the left.
 */
export const computeStart = (options: ExpeditionStart = {}) => {
    const world = findBody(options.body ?? 'projects') ?? findBody('projects')!;
    const up = landingZoneDirection(world);
    const landed = (options.landed ?? true) && world.kind === 'rocky';
    const heading = openingHeading(world);
    // Landed starts set down beside the landing zone's centre, not on top of it.
    const spot = landed ? up.clone().multiplyScalar(world.radius).addScaledVector(heading, -26).normalize() : up;
    const ground = groundHeight(world, spot);
    const altitude = landed ? SHIP_GEAR_HEIGHT : world.kind === 'rocky' ? 150 : world.radius * 0.6;
    const flatHeading = heading.clone().addScaledVector(spot, -heading.dot(spot)).normalize();
    // Worked out on the world as it was at the start, then put where it is now
    // (the same, unless the world has moved on since: motion.ts).
    const local = startOf(world).clone().addScaledVector(spot, world.radius + ground + altitude);
    const motion = activeMotion();
    const position = motion ? fromStart(motion, world, local, new THREE.Vector3()) : local;
    const lookAt = local.clone().addScaledVector(flatHeading, 100);
    if (motion) fromStart(motion, world, lookAt, lookAt);
    const shipUp = motion ? directionToGame(motion, world, spot, new THREE.Vector3()) : spot;
    return { position, lookAt, up: shipUp, landed };
};

const throatSun = new THREE.Color(0.62, 0.78, 1.0);
const throatWalls = new THREE.Color(0.2, 0.42, 1.0);
const throatDeep = new THREE.Color(0.04, 0.12, 0.45);
const Lighting = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const sunRef = useRef<THREE.DirectionalLight>(null);
    const hemiRef = useRef<THREE.HemisphereLight>(null);
    const space = useMemo(() => new THREE.Color('#1b2140'), []);
    const sky = useMemo(() => new THREE.Color(), []);
    const ground = useMemo(() => new THREE.Color(), []);
    const sunColor = useMemo(() => new THREE.Color('#fff0dc'), []);
    const diskColor = useMemo(() => new THREE.Color('#ffb46e'), []);
    const light = useMemo(() => new THREE.Vector3(), []);
    const toSun = useMemo(() => new THREE.Vector3(), []);
    const gasLook = useMemo(createZoneLook, []);
    const gasFlash = useMemo(() => new THREE.Color(0.75, 0.82, 1.0), []);
    useFrame(() => {
        const body = runtime.currentBody;
        const air = runtime.atmosphere;
        if (sunRef.current) {
            // Out by TON 618 the light comes from its disk, not the sun.
            const far = farness(runtime.camera);
            light.copy(BLACK_HOLE.position).sub(runtime.camera).normalize().lerp(sunDirectionAt(runtime.camera, toSun), 1 - far).normalize();
            sunRef.current.position.copy(light).multiplyScalar(100);
            sunRef.current.color.copy(sunColor).lerp(diskColor, far);
            // Under a deck of cloud (Venus) the light comes from the whole sky, not the sun.
            const overcast = (body?.biome?.overcast ?? 0) * (1 - skyBeyond(runtime));
            sunRef.current.intensity = 3.1 * (air > 0 ? THREE.MathUtils.lerp(1, runtime.daylight, air) : 1) * (1 - far * 0.35) * (1 - 0.8 * overcast)
                // Under a gas giant's cloud decks, only what light gets through.
                * (runtime.gas ? THREE.MathUtils.clamp(runtime.gas.light, 0, 1) : 1);
        }
        if (hemiRef.current) {
            sky.copy(space);
            ground.set('#0d0f14');
            if (body?.biome) {
                sky.lerp(new THREE.Color(body.biome.zenith), air);
                ground.lerp(new THREE.Color(body.biome.palette[1]).multiplyScalar(0.45), Math.min(1, air * 1.5 + 0.2));
            }
            const gas = runtime.gas;
            if (gas) {
                // Inside a gas giant the light comes from all round, the colour of
                // the haze, and flares blue-white with each lightning stroke.
                // (The sky and the glow from below of this depth: gasAtmosphere zones.)
                const model = gasModel(gas.body);
                zoneAt(model, gas.height, gasLook);
                const deepDown = THREE.MathUtils.smoothstep(-gas.height, 2000, 11000);
                sky.copy(gasLook.sky).multiplyScalar(0.2 + 0.8 * runtime.daylight * gas.light);
                ground.copy(gasLook.glow).multiplyScalar(0.25 + 0.5 * runtime.daylight * gas.light + 0.5 * deepDown);
                const flash = gas.flash?.level ?? 0;
                sky.lerp(gasFlash, Math.min(1, flash * 0.7));
            }
            hemiRef.current.color.copy(sky);
            hemiRef.current.groundColor.copy(ground);
            hemiRef.current.intensity = (0.55 + air * 0.35 * runtime.daylight) * (1 + 1.8 * (body?.biome?.overcast ?? 0) * (1 - skyBeyond(runtime))) + (gas?.flash?.level ?? 0) * 2.2;
        }
        // In the throat (crossing.ts) the light is the throat's: from the eye ahead, and the walls' blue
        // all round; the far side's light grows as she comes up to it.
        const transit = runtime.transit;
        if (transit && sunRef.current && hemiRef.current) {
            const glow = throatLook(transit.t).glow;
            sunRef.current.position.copy(transit.axis).multiplyScalar(100).addScaledVector(transit.up, 35);
            sunRef.current.color.copy(throatSun).lerp(sunColor, glow * 0.6);
            sunRef.current.intensity = 2.2 + 2.5 * glow;
            hemiRef.current.color.copy(throatWalls);
            hemiRef.current.groundColor.copy(throatDeep);
            hemiRef.current.intensity = 1.5;
        }
    });
    return (
        <>
            <directionalLight ref={sunRef} color="#fff0dc" intensity={3} />
            <hemisphereLight ref={hemiRef} intensity={0.6} />
            <ambientLight intensity={0.05} />
        </>
    );
};

const forward = new THREE.Vector3();
const shipUp = new THREE.Vector3();
const cameraWorld = new THREE.Vector3();
const lookWorld = new THREE.Vector3();
const offset = new THREE.Vector3();
const crewUp = new THREE.Vector3();
const mothershipUp = new THREE.Vector3();
const mothershipBay = new THREE.Vector3();
const crewLocal = new THREE.Vector3();
const bodyUp = new THREE.Vector3();
const walkerUp = new THREE.Vector3();
const walkerRight = new THREE.Vector3();
const walkerBack = new THREE.Vector3();
const basis = new THREE.Matrix4();
const head = new THREE.Vector3();
const view = new THREE.Vector3();
const toCrystal = new THREE.Vector3();
const crystalUp = new THREE.Vector3();
const tipWorld = new THREE.Vector3();
/** Render layer of the player's own objects (see the layer note in Player). */
export const PLAYER_LAYER = 1;
const onPlayerLayer = (object: THREE.Object3D) => {
    const layer = object.userData.noMirror ? NO_MIRROR_LAYER : PLAYER_LAYER;
    if (object.layers.mask !== 1 << layer) object.layers.set(layer);
};
const arrival = new THREE.Matrix4();
const warpCentre = new THREE.Vector3();
const warpPoint = new THREE.Vector3();
const warpFrame = new THREE.Vector2();
const warpMatrix = new THREE.Matrix4();
const wobbleEuler = new THREE.Euler();
const IDENTITY = new THREE.Matrix4();
const shot = { position: new THREE.Vector3(), target: new THREE.Vector3(), up: new THREE.Vector3(), fov: 64 };
const crossing = new THREE.Vector3();
/**
 * The mouth the player last came out of: it cannot take them back until the camera is clear of it.
 * (The Argo's chase camera sits 430 m behind her, so just out of a mouth it could still be inside the
 * throat she came out of, and she went straight back through.)
 */
const exitMouth: { id: string | null } = { id: null };
const zero = new THREE.Vector3();

/** What the explorer is doing, for the animation. */
const motionOf = (walker: WalkerState): Motion => {
    if (walker.down) return 'down';
    if (walker.gathering > 0) return 'gather';
    if (walker.sitting) return walker.eating > 0 ? 'eat' : 'sit';
    if (walker.swimming) return walker.moving > 0.12 ? 'swim' : 'tread';
    if (walker.jetting) return 'air';
    // The jump's crouch and spring, held at the top of the leap; a long fall
    // (or a long low-gravity hang) turns into the falling pose.
    if (walker.jumpPending || (!walker.onGround && walker.jumpTime < 0.9)) return 'jump';
    if (!walker.onGround && walker.airTime > 0.22) return 'air';
    // Coming down from a jump or a drop: the landing, unless already walking off.
    if (walker.onGround && walker.landTime < 0.5 && walker.landedFrom > 0.3 && walker.moving < 0.5) return 'land';
    if (walker.running) return 'run';
    return walker.moving > 0.08 ? 'walk' : 'idle';
};

/** Step out of the landed ship onto the ground beside it. */
const disembark = (ship: ShipState, runtime: ExpeditionRuntime): WalkerState | null => {
    const body = runtime.currentBody;
    if (!body || body.kind !== 'rocky') return null;
    const shipRight = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const shipForward = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
    // Clear of the wingtip, so the camera behind the explorer is not inside the wing.
    const spot = ship.position.clone().addScaledVector(shipRight, 7.5);
    const spotUp = spot.clone().sub(body.position).normalize();
    const ground = groundHeight(body, spotUp);
    const position = body.position.clone().addScaledVector(spotUp, body.radius + ground + 0.4);
    return createWalker(body, position, shipForward);
};

/** Come to beside a campfire, on its log. */
const besideCamp = (camp: NonNullable<ExpeditionRuntime['camp']>) => {
    const seat = camp.position.clone().addScaledVector(camp.seat, 1.9);
    const up = seat.clone().sub(camp.body.position).normalize();
    const position = camp.body.position.clone().addScaledVector(up, camp.body.radius + groundHeight(camp.body, up) + 0.3);
    return createWalker(camp.body, position, camp.seat.clone().negate());
};

/** Aim at the nearest crystal in view and mine it while the button is held. */
const updateMining = (runtime: ExpeditionRuntime, walker: WalkerState, input: ExpeditionInput, dt: number, astronaut: AstronautHandle | null) => {
    walkerUp.copy(walker.position).sub(walker.body.position).normalize();
    head.copy(walker.position).addScaledVector(walkerUp, 1.5);
    view.copy(walker.look).multiplyScalar(Math.cos(walker.pitch)).addScaledVector(walkerUp, Math.sin(walker.pitch)).normalize();
    // A vault's rune stone in view: the beam lights it (Vaults.tsx keeps the order and the time).
    const vault = runtime.vault;
    if (vault) {
        let rune = -1;
        let bestOff = Infinity;
        if (!vault.open) {
            vault.frame.runes.forEach((position, i) => {
                if (i < vault.lit) return;
                crystalUp.copy(position).sub(walker.body.position).normalize();
                toCrystal.copy(position).addScaledVector(crystalUp, RUNE_HEIGHT * 0.72).sub(head);
                const distance = toCrystal.length();
                if (distance > RUNE_REACH) return;
                const off = Math.acos(THREE.MathUtils.clamp(toCrystal.divideScalar(distance).dot(view), -1, 1));
                if (off < Math.max(0.05, Math.atan2(0.9, distance)) && off < bestOff) {
                    bestOff = off;
                    rune = i;
                }
            });
        }
        vault.target = rune;
        if (rune >= 0) {
            runtime.surface.target = null;
            runtime.fauna.zapping = false;
            astronaut?.setMining(input.primary);
            if (input.primary) {
                const position = vault.frame.runes[rune];
                crystalUp.copy(position).sub(walker.body.position).normalize();
                const tip = astronaut?.toolTip;
                if (tip) tip.getWorldPosition(tipWorld).add(runtime.origin);
                else tipWorld.copy(head);
                runtime.surface.beam = { from: tipWorld.clone(), to: position.clone().addScaledVector(crystalUp, RUNE_HEIGHT * 0.72) };
                vault.charge[rune] += dt;
            } else {
                runtime.surface.beam = null;
            }
            return;
        }
    }
    let best = null;
    let bestScore = Infinity;
    for (const cluster of runtime.surface.crystals) {
        crystalUp.copy(cluster.position).sub(walker.body.position).normalize();
        toCrystal.copy(cluster.position).addScaledVector(crystalUp, 0.8).sub(head);
        const distance = toCrystal.length();
        if (distance > 16) continue;
        const facing = toCrystal.divideScalar(distance).dot(view);
        if (facing < 0.86 && distance > 3.5) continue;
        const score = distance * (2 - facing);
        if (score < bestScore) { bestScore = score; best = cluster; }
    }
    runtime.surface.target = best;
    // No crystal in view but an animal looked at: the beam goes to it (it drives a predator off).
    const animalAt = !best && input.primary ? runtime.fauna.targetPosition : null;
    runtime.fauna.zapping = !!animalAt;
    if (animalAt) {
        const tip = astronaut?.toolTip;
        if (tip) tip.getWorldPosition(tipWorld).add(runtime.origin);
        else tipWorld.copy(head);
        crystalUp.copy(animalAt).sub(walker.body.position).normalize();
        runtime.surface.beam = { from: tipWorld.clone(), to: animalAt.clone().addScaledVector(crystalUp, 0.9) };
        astronaut?.setMining(true);
        return;
    }
    const mining = !!best && input.primary;
    astronaut?.setMining(mining);
    if (mining && best) {
        crystalUp.copy(best.position).sub(walker.body.position).normalize();
        const tip = astronaut?.toolTip;
        if (tip) tip.getWorldPosition(tipWorld).add(runtime.origin);
        else tipWorld.copy(head);
        runtime.surface.beam = { from: tipWorld.clone(), to: best.position.clone().addScaledVector(crystalUp, 0.8) };
        best.health -= dt * 0.9 * miningRate(runtime.supplies);
        if (best.health <= 0) {
            runtime.surface.mined.add(best.id);
            const first = runtime.stats.mined === 0;
            const yieldOf = 3 + Math.floor(Math.random() * 6);
            runtime.inventory.crystals += yieldOf;
            runtime.stats.mined += yieldOf;
            runtime.stats.minedOn[walker.body.id] = (runtime.stats.minedOn[walker.body.id] ?? 0) + yieldOf;
            runtime.surface.bursts.push({
                position: best.position.clone().addScaledVector(crystalUp, 0.8),
                color: new THREE.Color(walker.body.biome?.crystal ?? '#48d6ff'),
                start: performance.now() / 1000,
            });
            runtime.surface.version += 1;
            runtime.surface.target = null;
            runtime.surface.beam = null;
            // The first crystals: say what they are for.
            const ship = runtime.hud.ship;
            if (ship) {
                ship.notice = first
                    ? `+${yieldOf} CRYSTALS · PRESS C TO MAKE A CAMPFIRE, OXYGEN, MEDKITS AND UPGRADES WITH THEM`
                    : `+${yieldOf} CRYSTALS`;
                ship.noticeTime = performance.now() / 1000;
            }
        }
    } else {
        runtime.surface.beam = null;
    }
};

const torchFrom = new THREE.Vector3();
const torchDir = new THREE.Vector3();
const torchUp = new THREE.Vector3();

/**
 * The explorer's torch, or the ship's lamps: T switches it, and it comes on
 * by itself the first time the player is on a world's night side. The beam
 * follows where the explorer looks (from the helmet) or where the ship points
 * (from its nose). The ground and everything on it light up through the
 * shared surface shading (TORCH); the ship, the explorer and the monoliths
 * through an ordinary spotlight.
 */
const Torch = ({ runtime, input }: { runtime: ExpeditionRuntime; input: ExpeditionInput }) => {
    const lightRef = useRef<THREE.SpotLight>(null);
    const strength = useRef(0);
    useFrame((_, delta) => {
        const dt = Math.min(delta, 0.1);
        const torch = runtime.torch;
        const ship = runtime.hud.ship;
        const walker = runtime.mode === 'walk' ? runtime.hud.walker : null;
        const body = runtime.currentBody;
        const surface = !!body && body.kind === 'rocky' && runtime.altitude < 3000;
        if (consume(input, 'KeyT')) {
            torch.on = !torch.on;
            torch.manual = true;
            if (ship) {
                ship.notice = walker ? (torch.on ? 'TORCH ON' : 'TORCH OFF') : (torch.on ? 'LAMPS ON' : 'LAMPS OFF');
                ship.noticeTime = performance.now() / 1000;
            }
        }
        // Dusk switches it on, once; after the player has chosen, it is theirs.
        if (!torch.manual && surface) torch.on = runtime.daylight < 0.3;
        const wanted = torch.on && surface && !runtime.fall.active ? 1 : 0;
        strength.current += (wanted - strength.current) * (1 - Math.exp(-dt * 10));
        if (strength.current < 0.002) strength.current = 0;

        if (walker) {
            torchUp.copy(walker.position).sub(walker.body.position).normalize();
            torchDir.copy(walker.look).multiplyScalar(Math.cos(walker.pitch - 0.12)).addScaledVector(torchUp, Math.sin(walker.pitch - 0.12)).normalize();
            torchFrom.copy(walker.position).addScaledVector(torchUp, 1.62).addScaledVector(walker.look, 0.25);
        } else if (ship) {
            torchDir.set(0, -0.16, -1).normalize().applyQuaternion(ship.quaternion);
            torchFrom.copy(ship.position).addScaledVector(torchDir, 4);
        }
        TORCH.strength.value = strength.current * (walker ? 1 : 1.6);
        if (body) TORCH.position.value.copy(torchFrom).sub(body.position);
        TORCH.direction.value.copy(torchDir);

        const light = lightRef.current;
        if (light) {
            light.visible = strength.current > 0;
            light.intensity = strength.current * (walker ? 30 : 60);
            light.position.copy(torchFrom).sub(runtime.origin);
            light.target.position.copy(torchFrom).addScaledVector(torchDir, 10).sub(runtime.origin);
            light.target.updateMatrixWorld();
        }
    });
    return <spotLight ref={lightRef} color="#ffedd2" angle={0.42} penumbra={0.55} distance={70} decay={1.4} intensity={0} visible={false} />;
};

/**
 * Holding Z narrows the view to about a sixth, as raising a pair of binoculars
 * does: the Moon, a planet or a far ridge seen closer. (Everything is drawn at
 * its true size, so at the usual wide view the Moon is a small bright disc,
 * as in a photograph taken with an ordinary lens.)
 */
const LOOK_CLOSER_FOV = 11;
const lookingCloser = (input: ExpeditionInput) => input.keys.has('KeyZ') || input.closer;

export const Player = ({ runtime, input, start, region }: { runtime: ExpeditionRuntime; input: ExpeditionInput; start?: ExpeditionStart; region: Region }) => {
    const shipRef = useRef<ShipHandle>(null);
    const astronautRef = useRef<AstronautHandle>(null);
    // Kept on the runtime, so the scene can be rebuilt (a change of graphics
    // detail) with the player exactly where they were.
    const kept = useMemo<PlayerKeep>(() => {
        if (runtime.player) return runtime.player;
        const begin = computeStart(start);
        const state = createShipState(begin.position, begin.lookAt, begin.up);
        if (begin.landed) {
            state.landed = true;
            state.gear = 1;
            state.throttle = 0;
            state.velocity.set(0, 0, 0);
        }
        runtime.player = {
            ship: state,
            walker: { current: null },
            camera: { current: { quaternion: state.quaternion.clone(), offset: new THREE.Vector3(0, 2.8, 14), fov: 62 } },
            downFor: { current: 0 },
            wasLanded: { current: false },
            // The closest the ship has come to the Sun on this pass, in solar radii above its surface.
            sunPass: { current: 99 },
        };
        return runtime.player;
        // The start is only read once, when the expedition opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runtime]);
    const { ship, walker: walkerRef, camera: cameraState, downFor, wasLanded, sunPass } = kept;
    // The crew of four, each with a fighter of their own (crew.ts), and the Argo, the big ship
    // waiting overhead that the fighter docks into to cross the wormhole (mothership.ts). Both are
    // put in place once the world at the start is known (first frame).
    if (!runtime.crew) runtime.crew = createCrew(ship);
    const crew = runtime.crew;
    if (!runtime.mothership) runtime.mothership = createMothership(ship);
    const mothership = runtime.mothership;

    // A ship set down on the ground (at the start, beside the first one).
    const standOnGround = (s: ShipState, body: ExpeditionBody | null) => {
        if (!s.landed || !body || body.kind !== 'rocky') return;
        const up = crewUp.copy(s.position).sub(body.position).normalize();
        const local = directionToBody(runtime.motion, body, up, crewLocal);
        s.position.copy(body.position).addScaledVector(up, body.radius + groundHeight(body, local) + SHIP_GEAR_HEIGHT);
        s.velocity.set(0, 0, 0);
    };
    const homeHere = () => (runtime.currentBody && runtime.currentBody.kind !== 'star' ? runtime.currentBody : null);
    const placeCrew = () => {
        const home = homeHere();
        crew.members.forEach((m, i) => {
            if (i === crew.active) return;
            copyShip(ship, m.ship);
            besidePose(ship, i - 1, m.ship.position, m.ship.quaternion);
            m.ship.velocity.set(0, 0, 0);
            standOnGround(m.ship, home);
            park(m, runtime.motion, home);
        });
        crew.placed = true;
        placeMothership(mothership, ship, home, runtime.motion);
    };

    // Play as someone else (keys 1-4 or the crew panel). The one being played stays exactly where
    // they are, on foot or aboard, held in their world's frame so it carries them round with it;
    // the other is put back into play where they were left.
    runtime.actions.switchCrew = (index: number) => {
        const a = crew.active;
        if (index === a || index < 0 || index >= crew.members.length) return null;
        if (mothership.docked || mothership.docking) return 'UNDOCK FROM THE ARGO FIRST (U)';
        if (ship.destroyed || ship.landing || runtime.fall.active || runtime.shipRecall) return 'NOT NOW';
        const motion = runtime.motion;
        const me = crew.members[a];
        const them = crew.members[index];
        const onFoot = runtime.mode === 'walk' && !!walkerRef.current;
        me.walker = onFoot ? walkerRef.current : null;
        copyShip(ship, me.ship);
        me.parked = false;
        park(me, motion, onFoot && me.walker ? me.walker.body : homeHere());
        unpark(them, motion);
        copyShip(them.ship, ship);
        walkerRef.current = them.walker;
        runtime.mode = them.walker ? 'walk' : 'ship';
        them.walker = null;
        crew.active = index;
        crew.version += 1;
        runtime.autopilot = false;
        cameraState.current.quaternion.copy(ship.quaternion);
        runtime.moved = { count: runtime.moved.count + 1, carry: null };
        const here = walkerRef.current ? walkerRef.current.position : ship.position;
        updateEnvironment(runtime, here);
        runtime.origin.copy(here);
        const where = runtime.currentBody ? `${walkerRef.current ? 'on foot' : ship.landed ? 'landed' : 'flying'} · ${runtime.currentBody.name}` : 'in space';
        return `NOW PLAYING ${them.def.name.toUpperCase()} · ${where.toUpperCase()}`;
    };

    // U: dock with the Argo when the fighter is at her bay, slow; undock when docked.
    runtime.actions.dock = () => {
        if (runtime.mode !== 'ship') return 'GET IN YOUR SHIP FIRST';
        if (mothership.docking) return 'DOCKING…';
        if (mothership.docked) {
            undock(mothership, ship, runtime.motion, homeHere());
            cameraState.current.quaternion.copy(ship.quaternion);
            updateEnvironment(runtime, ship.position);
            return 'UNDOCKED · THE ARGO WAITS HERE FOR YOU';
        }
        if (ship.destroyed || ship.landing) return 'NOT NOW';
        const check = dockingCheck(mothership, ship, runtime.motion);
        if (check.ok) {
            beginDocking(mothership, ship);
            runtime.autopilot = false;
            return 'DOCKING WITH THE ARGO';
        }
        if (check.metres >= MOTHERSHIP.reach) return `FLY TO THE ARGO TO DOCK · ${formatMetres(check.metres)} AWAY`;
        if (ship.landed) return 'TAKE OFF FIRST';
        return `SLOW DOWN TO DOCK · UNDER ${MOTHERSHIP.closing} M/S`;
    };

    // Put the ship somewhere in space, flying the given way (after falling into
    // TON 618 it is put out of the wormhole by Saturn).
    runtime.actions.place = (position: THREE.Vector3, facing: THREE.Vector3, speed = 420, up?: THREE.Vector3) => {
        const direction = facing.clone().normalize();
        ship.position.copy(position);
        ship.velocity.copy(direction).multiplyScalar(speed);
        ship.drift.set(0, 0, 0);
        arrival.lookAt(zero, direction, up ?? (Math.abs(direction.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)));
        ship.quaternion.setFromRotationMatrix(arrival);
        ship.angular.set(0, 0, 0);
        ship.throttle = THREE.MathUtils.clamp(speed / 950, 0, 1);
        ship.pulseEngaged = false;
        ship.pulse = 0;
        ship.boost = 0;
        ship.landed = false;
        ship.gear = 0;
        ship.landing = null;
        ship.takeoff = 0;
        cameraState.current.quaternion.copy(ship.quaternion);
        runtime.mode = 'ship';
        runtime.moved = { count: runtime.moved.count + 1, carry: null };
        updateEnvironment(runtime, ship.position);
    };
    // The fabricator: crystals into what keeps the explorer going.
    runtime.actions.craft = (id: RecipeId) => {
        const recipe = RECIPES.find((r) => r.id === id);
        if (!recipe) return 'Unknown recipe';
        const cost = recipe.cost(runtime.supplies);
        if (cost === null) return 'Already fully upgraded';
        if (runtime.inventory.crystals < cost) return `Needs ${cost} crystals`;
        const walker = runtime.mode === 'walk' ? walkerRef.current : null;
        const near = walker ? walker.position.distanceTo(ship.position) < 30 : true;
        if (id === 'campfire') {
            if (!walker) return 'Step outside to make a campfire';
            if (walker.swimming || !walker.onGround) return 'Stand on dry ground to make a campfire';
            const up = walker.position.clone().sub(walker.body.position).normalize();
            const spot = walker.position.clone().addScaledVector(walker.facing, 1.7).sub(walker.body.position).normalize();
            if (waterDepth(walker.body, spot) > 0) return `Not in ${walker.body.biome?.liquid?.name ?? 'water'}`;
            const position = walker.body.position.clone().addScaledVector(spot, walker.body.radius + groundHeight(walker.body, spot));
            runtime.camp = { body: walker.body, position, up: spot, seat: walker.facing.clone().negate().addScaledVector(up, -walker.facing.clone().negate().dot(up)).normalize(), lit: performance.now() / 1000 };
        } else if (id === 'dome') {
            if (!walker) return 'Step outside to put up a dome';
            if (walker.swimming || !walker.onGround) return 'Stand on dry ground to put up a dome';
            // Eight metres ahead, on ground level enough and clear of water and the other domes.
            const spot = walker.position.clone().addScaledVector(walker.facing, DOME_RADIUS + 2).sub(walker.body.position).normalize();
            if (waterDepth(walker.body, spot) > 0) return `Not in ${walker.body.biome?.liquid?.name ?? 'water'}`;
            const probe = (a: number) => walker.body.position.clone().addScaledVector(spot, walker.body.radius).addScaledVector(walker.facing, a).sub(walker.body.position).normalize();
            const rise = Math.abs(groundHeight(walker.body, probe(DOME_RADIUS)) - groundHeight(walker.body, probe(-DOME_RADIUS)));
            if (rise > DOME_RADIUS * 0.8) return 'Too steep here for a dome';
            const centre = domeCentre(walker.body, spot);
            if (runtime.domes.some((d) => d.body === walker.body.id && domeCentre(walker.body, new THREE.Vector3(...d.direction)).distanceTo(centre) < DOME_RADIUS * 2.2)) return 'Too close to another dome';
            addDome(runtime, walker.body, spot);
        } else if (id === 'oxygen') {
            if (!walker) return 'The ship refills your air while you are aboard';
            walker.oxygen = 1;
        } else if (id === 'medkit') {
            if (!walker) return 'The ship heals you while you are aboard';
            if (walker.health >= 0.999) return 'You are not hurt';
            walker.health = Math.min(1, walker.health + 0.5);
        } else if (id === 'ration') {
            runtime.supplies.food += 1;
        } else if (id === 'repair') {
            if (!near) return 'Go back to your ship to patch its shield';
            if (ship.shield >= 0.999) return 'The shield is whole';
            ship.shield = 1;
        } else if (id === 'jetpack') runtime.supplies.jetpack += 1;
        else if (id === 'tank') runtime.supplies.tank += 1;
        else if (id === 'tool') runtime.supplies.tool += 1;
        runtime.inventory.crystals -= cost;
        runtime.stats.crafted[id] = (runtime.stats.crafted[id] ?? 0) + 1;
        ship.notice = `${recipe.name.toUpperCase()} · MADE`;
        ship.noticeTime = performance.now() / 1000;
        return null;
    };
    // A new ship where the lost one last set down (or at the start): landed,
    // shield whole; the crystals aboard the old one are gone with it.
    const replaceShip = (time: number) => {
        const last = runtime.lastLanding;
        const begin = last ? null : computeStart();
        // The landing spot is held on its world as it was at the start (motion.ts).
        if (last) {
            fromStart(runtime.motion, last.body, last.position, ship.position);
            turnFromStart(runtime.motion, last.body, last.quaternion, ship.quaternion);
        } else {
            ship.position.copy(begin!.position);
            ship.quaternion.setFromRotationMatrix(arrival.lookAt(begin!.position, begin!.lookAt, begin!.up));
        }
        ship.velocity.set(0, 0, 0);
        ship.drift.set(0, 0, 0);
        ship.angular.set(0, 0, 0);
        ship.landed = true;
        ship.landing = null;
        ship.takeoff = 0;
        ship.gear = 1;
        ship.throttle = 0;
        ship.boost = 0;
        ship.pulse = 0;
        ship.pulseEngaged = false;
        ship.sunDive = false;
        ship.shield = 1;
        ship.entry = 0;
        ship.jolt = 0;
        ship.hurtBy = '';
        ship.destroyed = null;
        ship.replacedAt = time;
        const lost = Math.ceil(runtime.inventory.crystals * 0.2);
        runtime.inventory.crystals -= lost;
        runtime.asteroidField = null;
        runtime.autopilot = false;
        runtime.mode = 'ship';
        cameraState.current.quaternion.copy(ship.quaternion);
        runtime.moved = { count: runtime.moved.count + 1, carry: null };
        updateEnvironment(runtime, ship.position);
        const where = (last?.body ?? runtime.currentBody)?.name.toUpperCase() ?? 'EARTH';
        ship.notice = `A NEW SHIP ON ${where}${lost > 0 ? ` · ${lost} CRYSTALS LOST WITH THE OLD ONE` : ''}`;
        ship.noticeTime = time;
    };
    const lossCounted = useRef(false);
    // The ship as drawn, stretched and turned by the crossing or the fall (spacetime.ts): the fighter,
    // and the Argo when she is the one flying. Identity whenever nothing bends space.
    const shipWarpRef = useRef<THREE.Group>(null);
    const argoWarpRef = useRef<THREE.Group>(null);
    const warpDrive = useRef({ engaged: false, compress: 0, speed: 0 });
    const fallLayers = useRef<number | null>(null);
    const { scene: sceneForLayers } = useThree();
    const updateSpacetime = (camera: THREE.Camera, dt: number) => {
        const transit = runtime.transit;
        const fall = runtime.fall;
        const length = mothership.docked ? MOTHERSHIP.length : 9;
        warpCentre.copy(ship.position).sub(runtime.origin);
        if (transit) {
            const look = argoLook(transit.t, transit.clock, runtime.reducedMotion);
            bodyWarp.stretch = look.stretch;
            bodyWarp.axis.copy(transit.axis);
            bodyWarp.wobble.setFromEuler(wobbleEuler.set(look.pitch, look.yaw, look.roll));
            bodyWarp.centre.copy(warpCentre);
            bodyWarp.ghosts = look.ghosts;
            bodyWarp.ghostStep = -0.12 * length * look.stretch;
            // Fanned out across the way through, towards the camera's side: the trail is seen, not hidden behind her.
            bodyWarp.ghostSpread.copy(camera.position).sub(warpCentre);
            bodyWarp.ghostSpread.addScaledVector(transit.axis, -bodyWarp.ghostSpread.dot(transit.axis));
            bodyWarp.ghostSpread.cross(transit.axis).normalize().multiplyScalar(0.06 * length * look.ghostStretch / 0.1);
            bodyWarp.ghostStrength = look.ghostStrength;
            bodyWarp.ghostStretch = look.ghostStretch;
            bodyWarp.ghostColor.setRGB(0.42, 0.72, 1.7);
            bodyWarp.shade = look.shade;
            // The far side's light floods the whole frame, the Argo with it, and fades into the system there.
            screenFx.flash = THREE.MathUtils.smoothstep(transit.t, BEAT.white + 0.62, BEAT.white + 0.75) * (1 - THREE.MathUtils.smoothstep(transit.t, BEAT.out + 0.15, BEAT.end));
        } else if (fall.active && fall.time >= FALL_STRETCH_AT - 0.2) {
            const end = spaghetti(fall);
            // Drawn out along the line to the centre, squeezed across it (the tidal stretch), afterimages trailing.
            bodyWarp.stretch = end.stretch;
            bodyWarp.axis.copy(BLACK_HOLE.position).sub(ship.position).normalize();
            bodyWarp.wobble.identity();
            bodyWarp.centre.copy(warpCentre);
            bodyWarp.ghosts = end.ghosts > 0.01 ? 6 : 0;
            // Trailing behind her motion round the centre, each image a little more drawn out than the last.
            bodyWarp.ghostStep = -0.05 * length * end.stretch;
            // (Round the hole, from the plane of the fall: the way she is going, across the line to the centre.)
            bodyWarp.ghostSpread.crossVectors(fall.e1, fall.e2).cross(bodyWarp.axis);
            warpPoint.copy(camera.position).sub(warpCentre).normalize();
            bodyWarp.ghostSpread.addScaledVector(warpPoint, -bodyWarp.ghostSpread.dot(warpPoint));
            if (bodyWarp.ghostSpread.lengthSq() > 1e-6) bodyWarp.ghostSpread.normalize().multiplyScalar(-0.3 * length * end.ghosts);
            bodyWarp.ghostStrength = 0.6 * end.ghosts;
            bodyWarp.ghostStretch = 0.22 * end.ghosts;
            bodyWarp.ghostColor.setRGB(0.8, 0.9, 1.5);
            bodyWarp.shade = 0;
        } else if (bodyWarpActive()) clearBodyWarp();
        if (!transit && screenFx.flash > 0) screenFx.flash = 0;

        // Inside the horizon nothing outside is seen directly, only by the light the tracer bends in
        // (BlackHole.tsx): the worlds and the far mouth are not drawn there, only the ship and the traced sky.
        const inside = fall.active && fall.time > FALL_SPIRAL;
        if (inside && fallLayers.current === null) {
            fallLayers.current = camera.layers.mask;
            sceneForLayers.traverse((object) => {
                if ((object as THREE.Light).isLight) object.layers.enable(CROSSING_LAYER);
            });
            camera.layers.mask = (1 << 1) | (1 << 2) | (1 << CROSSING_LAYER);
        } else if (!inside && fallLayers.current !== null) {
            camera.layers.mask = fallLayers.current;
            fallLayers.current = null;
        }

        const warped = bodyWarpActive();
        if (warped) stretchMatrix(bodyWarp.axis, bodyWarp.stretch, bodyWarp.centre, bodyWarp.wobble, warpMatrix);
        for (const group of [shipWarpRef.current, argoWarpRef.current]) {
            if (!group) continue;
            const on = warped && (group === shipWarpRef.current || mothership.docked);
            if (on) group.matrix.copy(warpMatrix);
            else if (!group.matrix.equals(IDENTITY)) group.matrix.identity();
            else continue;
            group.matrixWorldNeedsUpdate = true;
        }

        // The pulse drive's bubble: space outside it drawn in towards the heading, bluer ahead, redder
        // to the sides; a ripple as it engages and as it drops out, when the squeeze snaps back past flat.
        const drive = warpDrive.current;
        const flying = !transit && !fall.active && runtime.mode === 'ship' && !ship.destroyed;
        // Gentle at a low pulse, all of it at full: the square.
        const target = flying ? ship.pulse * ship.pulse * (mothership.docked ? 0.85 : 1) : 0;
        const stiffness = 34;
        drive.speed += ((target - drive.compress) * stiffness - drive.speed * 2 * Math.sqrt(stiffness) * 0.3) * dt;
        drive.compress += drive.speed * dt;
        const perspective = camera as THREE.PerspectiveCamera;
        if (ship.pulseEngaged !== drive.engaged) {
            drive.engaged = ship.pulseEngaged;
            if (flying) {
                // (Dropping out: the squeeze lets go all at once.)
                if (!drive.engaged) drive.speed -= 3.2 * Math.max(drive.compress, 0.25);
                if (toFrame(warpCentre, camera, warpFrame)) addRipple(warpFrame, drive.engaged ? 0.9 : 1.25, 0.8, screenFx.bubbleRadius, 1.35);
            }
        }
        const idle = Math.abs(drive.compress) < 0.002 && Math.abs(drive.speed) < 0.01;
        if (idle) {
            drive.compress = 0;
            drive.speed = 0;
        }
        screenFx.compress = drive.compress;
        screenFx.shift = flying ? ship.pulse : 0;
        screenFx.wall = flying ? THREE.MathUtils.clamp(ship.pulse * 1.15, 0, 1) : 0;
        if (!idle || screenFx.ripples.length > 0) {
            // The heading in the frame, and the ship with the bubble round it.
            warpPoint.copy(ship.velocity.lengthSq() > 1 ? ship.velocity : warpPoint.set(0, 0, -1).applyQuaternion(ship.quaternion)).normalize().multiplyScalar(1e5).add(camera.position);
            toFrame(warpPoint, camera, screenFx.apex);
            if (toFrame(warpCentre, camera, screenFx.bubble)) {
                warpPoint.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(length * 0.62).add(warpCentre);
                toFrame(warpPoint, camera, warpFrame);
                screenFx.bubbleRadius = Math.hypot((warpFrame.x - screenFx.bubble.x) * perspective.aspect, warpFrame.y - screenFx.bubble.y);
            } else screenFx.bubbleRadius = 0;
        }
    };
    const recordDeath = (world: string, cause: string, survived: number, time: number) => {
        const stats = runtime.stats;
        stats.deaths = (stats.deaths ?? 0) + 1;
        stats.deathsOn = stats.deathsOn ?? {};
        stats.deathsOn[world] = (stats.deathsOn[world] ?? 0) + 1;
        runtime.lastDeath = { world, cause, survived, count: stats.deaths, at: time };
    };
    runtime.actions.arriveAt = (mouthId: string) => {
        const mouth = findWormhole(mouthId);
        if (mouth) runtime.actions.place(mouth.exit.position, mouth.exit.facing);
    };

    useFrame(({ camera, clock }, delta) => {
        // Up to a tenth of a second per frame, so slow devices still move at
        // full speed rather than in slow motion.
        const dt = Math.min(delta, 0.1);
        // Wall-clock seconds, which the HUD also uses to age notices.
        const time = performance.now() / 1000;
        void clock;
        // While a data log is open the world waits; input is dropped.
        const paused = !!runtime.sites.open || runtime.menuOpen || runtime.fall.active;
        if (paused) {
            input.lookX = 0;
            input.lookY = 0;
            input.pressed.clear();
            input.primary = false;
            runtime.surface.beam = null;
        }
        // The others and the Argo are set in place once the world at the start is known.
        if (!crew.placed) placeCrew();
        // U: dock with the Argo, or undock from her (mothership.ts).
        if (consume(input, 'KeyU')) {
            const message = runtime.actions.dock();
            ship.notice = message;
            ship.noticeTime = time;
        }
        // Looking closer (Z): the mouse turns the view as much on screen as before.
        const lookScale = cameraState.current.fov / 64;
        input.lookX *= lookScale;
        input.lookY *= lookScale;

        // The ship lost with the pilot aboard is a death too, counted once.
        if (ship.destroyed && !lossCounted.current) {
            lossCounted.current = true;
            if (runtime.mode === 'ship') recordDeath(runtime.currentBody?.id ?? 'space', ship.destroyed.cause, 0, time);
        } else if (!ship.destroyed) lossCounted.current = false;

        if (runtime.mode === 'ship') {
            // Lost: the wreck drifts, and then a new ship waits where the last one landed.
            // (A test harness can hold the moment: window.__holdLoss, in development only.)
            const holdLoss = import.meta.env.DEV && !!(window as unknown as { __holdLoss?: boolean }).__holdLoss;
            if (ship.destroyed && !paused && !holdLoss) ship.destroyed.age += dt;
            if (ship.destroyed && ship.destroyed.age > LOSS_SECONDS) replaceShip(time);
            if (runtime.fall.active) {
                // Falling into TON 618: the plunge flies the ship, and when the
                // log ends a new ship leaves the wormhole by Saturn.
                // (What ARGO says on the way down is voiced: Voices.tsx, voiceLines.ts.)
                const before = runtime.fall.time;
                if (!runtime.sites.open && !runtime.menuOpen && advanceFall(runtime.fall, ship, runtime.fall.hold ? 0 : dt)) runtime.events.fallDone();
                const after = runtime.fall.time;
                if (before < FALL_LOST_AT && after >= FALL_LOST_AT) {
                    const death = countFallDeath(runtime.fall, runtime.stats, time);
                    if (death) runtime.lastDeath = death;
                }
                updateEnvironment(runtime, ship.position);
            } else if (!paused && runtime.transit) {
                // Down the throat (WormholeTransit.tsx): the ship is already at the far mouth,
                // held there with the controls locked until the tunnel opens out.
                const transit = runtime.transit;
                const before = transit.t;
                // Held short of the far side while the other system is built behind the throat (region.ts):
                // the sequence waits at its hold, and everything in it keeps moving on `clock`.
                if (!transit.hold) {
                    transit.clock += dt;
                    const next = transit.t + dt;
                    if (runtime.loading && next > TRANSIT_HOLD) {
                        transit.held += Math.max(0, next - Math.max(transit.t, TRANSIT_HOLD));
                        transit.t = Math.max(transit.t, TRANSIT_HOLD);
                    } else transit.t = next;
                }
                void before;
                input.pressed.clear();
                input.lookX = 0;
                input.lookY = 0;
                ship.throttle = Math.max(ship.throttle, 0.4);
                if (transit.t >= TRANSIT_SECONDS) {
                    runtime.transit = null;
                    clearBodyWarp();
                    screenFx.flash = 0;
                    runtime.events.transit(transit.to);
                }
            } else if (!paused && mothership.docking) {
                // Being drawn into the Argo's bay: held on the run-in, no controls.
                if (advanceDocking(mothership, ship, runtime.motion, dt)) {
                    if (!runtime.stats.visited.includes('argo-docked')) runtime.stats.visited.push('argo-docked');
                    ship.notice = 'DOCKED WITH THE ARGO · SHE CAN CROSS THE WORMHOLE';
                    ship.noticeTime = time;
                    cue(runtime, 'radio', 0.5);
                }
                input.pressed.clear();
                input.lookX = 0;
                input.lookY = 0;
                updateEnvironment(runtime, ship.position);
            } else if (!paused) {
                if (mothership.docked) {
                    // Flying the Argo: she turns slowly, and she is no lander.
                    input.lookX *= MOTHERSHIP.agility;
                    input.lookY *= MOTHERSHIP.agility;
                    if (consume(input, 'KeyF')) {
                        ship.notice = 'THE ARGO CANNOT LAND · UNDOCK (U) AND FLY THE FIGHTER DOWN';
                        ship.noticeTime = time;
                    }
                }
                updateShip(ship, input, runtime, dt, time, 1);
                const ground = runtime.currentBody;
                if (mothership.docked && ground && ground.kind === 'rocky' && runtime.altitude < MOTHERSHIP.floor) {
                    // Held above the air: she would never come out of it again.
                    mothershipUp.copy(ship.position).sub(ground.position).normalize();
                    const down = ship.velocity.dot(mothershipUp);
                    if (down < 0) ship.velocity.addScaledVector(mothershipUp, -down);
                    ship.velocity.addScaledVector(mothershipUp, (MOTHERSHIP.floor - runtime.altitude) * dt * 0.5);
                    if (time - ship.noticeTime > 5) {
                        ship.notice = 'THE ARGO STAYS ABOVE THE AIR · UNDOCK (U) TO GO LOWER';
                        ship.noticeTime = time;
                    }
                }
            }
            if (!runtime.fall.active && !runtime.transit) {
                // Through the wormhole: when the camera reaches a throat, the
                // camera, the ship ahead of it and everything they are doing
                // carry straight on out of the other mouth (see crossThroat).
                const cam = cameraState.current;
                crossing.copy(cam.offset).applyQuaternion(cam.quaternion).add(ship.position);
                for (const mouth of WORMHOLES) {
                    // Only the Argo is built to cross: the fighter alone is turned back at the throat.
                    const gate = mouth.radius * 1.35;
                    if (!mothership.docked && ship.position.distanceTo(mouth.position) < gate) {
                        mothershipUp.copy(ship.position).sub(mouth.position).normalize();
                        ship.position.copy(mouth.position).addScaledVector(mothershipUp, gate);
                        const inward = ship.velocity.dot(mothershipUp);
                        if (inward < 0) ship.velocity.addScaledVector(mothershipUp, -inward * 1.4);
                        ship.pulseEngaged = false;
                        ship.pulse = 0;
                        ship.jolt = Math.max(ship.jolt, 0.6);
                        runtime.autopilot = false;
                        if (time - ship.noticeTime > 4) {
                            ship.notice = 'THE THROAT WOULD TEAR THE FIGHTER APART · ONLY THE ARGO CAN CROSS';
                            ship.noticeTime = time;
                        }
                        continue;
                    }
                    if (mouth.id === exitMouth.id) {
                        if (crossing.distanceTo(mouth.position) < mouth.radius * 1.5) continue;
                        exitMouth.id = null;
                    }
                    if (crossing.distanceTo(mouth.position) < mouth.radius) {
                        const { other, turn, point } = crossThroat(mouth, crossing);
                        exitMouth.id = other.id;
                        const from = crossing.clone();
                        runtime.moved = { count: runtime.moved.count + 1, carry: (p) => { p.sub(from).applyQuaternion(turn).add(point); } };
                        ship.position.sub(crossing).applyQuaternion(turn).add(point);
                        ship.velocity.applyQuaternion(turn);
                        ship.drift.applyQuaternion(turn);
                        ship.quaternion.premultiply(turn);
                        cam.quaternion.premultiply(turn);
                        updateEnvironment(runtime, ship.position);
                        // The crossing plays out as a flight down the throat (WormholeTransit.tsx);
                        // the arrival is announced as it opens out.
                        const axis = ship.velocity.lengthSq() > 1 ? ship.velocity.clone().normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
                        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
                        up.addScaledVector(axis, -up.dot(axis));
                        if (up.lengthSq() < 1e-6) up.set(1, 0, 0).addScaledVector(axis, -axis.x);
                        runtime.transit = { t: 0, clock: 0, held: 0, to: other.id, axis, up: up.normalize() };
                        // The throat's surface gives way: a ripple through space from the middle of the view.
                        addRipple(new THREE.Vector2(0.5, 0.52), 1.4, 0.9, 0.02, 1.4);
                        break;
                    }
                }
                if (ship.position.distanceTo(BLACK_HOLE.position) < BLACK_HOLE.horizon * FALL_TRIGGER) {
                    beginFall(runtime.fall, ship);
                    runtime.events.fall();
                }
            }
            // Landing somewhere counts for the story, and is where a new ship
            // would wait if this one were lost.
            if (ship.landed && !wasLanded.current && runtime.currentBody) {
                const here = runtime.currentBody;
                if (!runtime.stats.landed.includes(here.id)) {
                    runtime.stats.landed.push(here.id);
                    if (here.fact) {
                        runtime.scan.found = { name: here.name, blurb: here.fact, label: 'First landing' };
                        runtime.scan.foundAt = performance.now() / 1000;
                    }
                }
                runtime.lastLanding = { body: runtime.currentBody, position: ship.position.clone(), quaternion: ship.quaternion.clone() };
            }
            wasLanded.current = ship.landed;
            // A close pass by the Sun counts once the ship is away from it, alive.
            if (ship.destroyed) {
                sunPass.current = 99;
            } else if (ship.temperature > HEAT_WARNING) {
                sunPass.current = Math.min(sunPass.current, (ship.position.distanceTo(SUN.position) - SUN.radius) / SUN.radius);
            } else if (sunPass.current < 99) {
                runtime.stats.sunPass = Math.min(runtime.stats.sunPass, Math.round(sunPass.current * 100) / 100);
                sunPass.current = 99;
            }
            // Aboard, the explorer heals and the suit's air refills.
            const resting = walkerRef.current;
            if (resting && !paused) {
                resting.health = Math.min(1, resting.health + dt * 0.05);
                resting.oxygen = Math.min(1, resting.oxygen + dt * 0.25);
                resting.cooling = Math.min(1, resting.cooling + dt * 0.12);
            }
            const station = nearestInteractable(runtime, ship.position, false);
            runtime.sites.nearest = station;
            if (!paused && !ship.destroyed && consume(input, 'KeyE')) {
                if (answerContact(runtime)) {
                    // Answered the aeronauts (contact.ts).
                } else if (station) {
                    runtime.events.openSite(station);
                } else if (ship.landed) {
                    const walker = disembark(ship, runtime);
                    if (walker) {
                        // The same explorer steps out: as hurt, as hungry, and with as much air, as they came in.
                        if (resting) {
                            walker.health = resting.health;
                            walker.oxygen = resting.oxygen;
                            walker.cooling = resting.cooling;
                            walker.satiety = resting.satiety;
                        }
                        walkerRef.current = walker;
                        runtime.mode = 'walk';
                    }
                }
            }
            runtime.origin.copy(ship.position);
        } else if (walkerRef.current) {
            let walker = walkerRef.current;
            if (!paused) {
                updateWalker(walker, input, runtime, dt);
                if (!walker.down && !runtime.fishing) updateMining(runtime, walker, input, dt, astronautRef.current);
                else if (runtime.fishing) {
                    runtime.surface.beam = null;
                    runtime.fauna.zapping = false;
                    astronautRef.current?.setMining(runtime.fishing.phase === 'reel' || runtime.fishing.phase === 'cast');
                }
            }
            // Blacked out: after a moment the suit's beacon brings the explorer
            // round by the campfire lit last on this world, or else beside the
            // ship: half healed, short of some crystals.
            if (walker.down && !paused) {
                // The moment it happens: one more death, counted, with its cause.
                if (downFor.current === 0) recordDeath(walker.body.id, walker.hurtBy || 'injuries', time - walker.born, time);
                downFor.current += dt;
                runtime.surface.beam = null;
                astronautRef.current?.setMining(false);
                if (downFor.current > 3.4) {
                    downFor.current = 0;
                    const camp = runtime.camp && runtime.camp.body === walker.body ? runtime.camp : null;
                    // A ship still flying in sets down first.
                    if (runtime.shipRecall) {
                        advanceRecall(runtime.shipRecall, ship, 1e6);
                        runtime.shipRecall = null;
                    }
                    const woken = camp ? besideCamp(camp) : disembark(ship, runtime);
                    if (woken) {
                        woken.health = 0.5;
                        woken.oxygen = 1;
                        woken.satiety = Math.max(walker.satiety, 0.3);
                        const lost = Math.ceil(runtime.inventory.crystals * 0.2);
                        runtime.inventory.crystals -= lost;
                        walkerRef.current = woken;
                        walker = woken;
                        const where = camp ? 'BY YOUR CAMPFIRE' : 'BESIDE YOUR SHIP';
                        ship.notice = lost > 0 ? `YOU CAME TO ${where} · ${lost} CRYSTALS LOST` : `YOU CAME TO ${where}`;
                        ship.noticeTime = time;
                    }
                }
            }
            // The story's records: jumps, drops walked away from, swimming. (Measured on the
            // frame of touchdown: landTime has already counted that frame by now, so it is never 0.)
            if (walker.touchdown && !walker.down) {
                const id = walker.body.id;
                if (walker.lastJump > (runtime.stats.jumps[id] ?? 0)) runtime.stats.jumps[id] = walker.lastJump;
                if (walker.lastDrop > (runtime.stats.drops[id] ?? 0)) runtime.stats.drops[id] = walker.lastDrop;
            }
            if (walker.swimming && !paused) runtime.stats.swum += dt;
            if (walker.sitting && !paused) runtime.stats.rested += dt;

            const site = nearestInteractable(runtime, walker.position, true);
            runtime.sites.nearest = site;
            // G on foot calls the ship: it flies over and lands beside the explorer (recall.ts).
            if (!paused && consume(input, 'KeyG')) {
                if (runtime.shipRecall) {
                    ship.notice = 'YOUR SHIP IS ON ITS WAY';
                } else {
                    const called = callShip(ship, walker);
                    runtime.shipRecall = called.recall;
                    ship.notice = called.notice;
                    if (called.recall) cue(runtime, 'radio', 0.5);
                }
                ship.noticeTime = time;
            }
            if (runtime.shipRecall && !paused && advanceRecall(runtime.shipRecall, ship, dt)) {
                runtime.shipRecall = null;
                ship.notice = 'YOUR SHIP HAS LANDED · E TO BOARD';
                ship.noticeTime = time;
            }
            // Sitting by the fire: moving gets up.
            const camp = runtime.camp && runtime.camp.body === walker.body && walker.position.distanceTo(runtime.camp.position) < 3.6 ? runtime.camp : null;
            if (walker.sitting && (!camp || ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].some((k) => input.keys.has(k)) || Math.abs(input.moveX) + Math.abs(input.moveY) > 0.3)) {
                walker.sitting = false;
            }
            // Eat (R): a cooked meal by the fire heals more than a cold one on the move.
            if (!paused && consume(input, 'KeyR') && !walker.down && walker.eating <= 0) {
                if (runtime.supplies.food <= 0) {
                    ship.notice = 'NO FOOD · PICK FRUIT, OR MAKE A RATION (C)';
                } else {
                    runtime.supplies.food -= 1;
                    runtime.stats.meals += 1;
                    const cooked = walker.sitting;
                    if (cooked) runtime.stats.cooked += 1;
                    walker.satiety = Math.min(1, walker.satiety + 0.4);
                    walker.health = Math.min(1, walker.health + (cooked ? 0.3 : 0.08));
                    walker.eating = cooked ? 4.5 : 1.5;
                    ship.notice = cooked ? 'A HOT MEAL BY THE FIRE · HEALING' : 'YOU EAT ON THE MOVE';
                }
                ship.noticeTime = time;
            }
            const plant = runtime.forage.target;
            const creature = runtime.fauna.reach;
            // Fishing: once a line is out, it takes the controls (E hooks, click reels, moving stops).
            if (runtime.fishing && !paused) runtime.fishing = updateFishing(runtime.fishing, runtime, walker, input, dt);
            runtime.fishSpot = runtime.fishing || walker.sitting ? null : castSpot(runtime, walker);
            // Someone of Haven's colony beside you: E hears them out (Colonists.tsx).
            if (!paused && runtime.colonist && !walker.down && input.pressed.has('KeyE')) {
                consume(input, 'KeyE');
                runtime.speech = { ...runtime.colonist, at: time };
                if (!runtime.stats.visited.includes('haven-talk')) runtime.stats.visited.push('haven-talk');
                // At the story's end, what they are told is that Earth is ready (quests.ts, The Call).
                if (runtime.story.chapter === 'the-call' && !runtime.stats.visited.includes('haven-news')) runtime.stats.visited.push('haven-news');
            }
            if (!paused && !runtime.fishing && consume(input, 'KeyE') && !walker.down && walker.eating <= 0 && !answerContact(runtime)) {
                // (Not while it is still flying in.)
                const toShip = runtime.shipRecall ? Infinity : walker.position.distanceTo(ship.position);
                const toSite = site ? site.position.distanceTo(walker.position) : Infinity;
                const toCamp = camp ? walker.position.distanceTo(camp.position) : Infinity;
                const toPlant = plant ? walker.position.distanceTo(plant.position) : Infinity;
                const tube = runtime.pickup;
                const toTube = tube ? walker.position.distanceTo(tube.position) : Infinity;
                // An animal right in front comes first: it is what the player is looking at.
                const toCreature = creature ? 0 : Infinity;
                // Open water ahead, when nothing else is in reach: cast a line.
                const toWater = runtime.fishSpot ? 30 : Infinity;
                const nearest = Math.min(toSite, toShip < 10 ? toShip : Infinity, toCamp, toPlant, toCreature, toWater, toTube);
                if (!Number.isFinite(nearest)) {
                    // Nothing in reach.
                } else if (nearest === toWater && runtime.fishSpot) {
                    runtime.fishing = beginFishing(runtime, runtime.fishSpot);
                    walker.velocity.set(0, 0, 0);
                } else if (nearest === toCreature && creature) {
                    const said = creature.act(creature.friend ? 'pet' : 'feed');
                    if (said) {
                        ship.notice = said;
                        ship.noticeTime = time;
                    }
                } else if (nearest === toSite) {
                    runtime.events.openSite(site!);
                } else if (nearest === toCamp) {
                    walker.sitting = !walker.sitting;
                    if (walker.sitting) {
                        // On the log, facing the fire.
                        const seat = camp!.position.clone().addScaledVector(camp!.seat, 1.15);
                        const up = seat.clone().sub(walker.body.position).normalize();
                        walker.position.copy(walker.body.position).addScaledVector(up, walker.body.radius + groundHeight(walker.body, up));
                        walker.facing.copy(camp!.seat).negate();
                        walker.velocity.set(0, 0, 0);
                    }
                } else if (nearest === toTube && tube) {
                    // A sample tube from the depot, into the sample case.
                    const id = tubeId(tube.index);
                    if (!runtime.stats.visited.includes(id)) runtime.stats.visited.push(id);
                    runtime.pickup = null;
                    walker.gathering = 2.4;
                    const have = SAMPLE_TUBES.filter((_, i) => runtime.stats.visited.includes(tubeId(i))).length;
                    ship.notice = have === SAMPLE_TUBES.length
                        ? 'ALL TEN SAMPLE TUBES ON BOARD · TAKE THEM TO EARTH'
                        : `SAMPLE TUBE ${have} OF ${SAMPLE_TUBES.length} · ${SAMPLE_TUBES[tube.index].toUpperCase()}`;
                    ship.noticeTime = time;
                    cue(runtime, 'scan', 0.8);
                } else if (nearest === toPlant && plant) {
                    runtime.forage.picked.set(plant.id, time);
                    runtime.forage.version += 1;
                    runtime.forage.target = null;
                    runtime.supplies.food += plant.yield;
                    runtime.stats.gathered += 1;
                    walker.gathering = 2.4;
                    ship.notice = `${(FORAGE_NAME[walker.body.biome?.kind ?? 'verdant'] ?? 'Fruit').toUpperCase()} · +${plant.yield} FOOD`;
                    ship.noticeTime = time;
                } else if (nearest === toShip) {
                    runtime.mode = 'ship';
                    runtime.fishing = null;
                    walker.sitting = false;
                    runtime.surface.beam = null;
                    astronautRef.current?.setMining(false);
                }
            }
            runtime.origin.copy(walker.position);
        }

        // The ship is always drawn where it is, relative to the floating origin.
        const handle = shipRef.current;
        if (handle?.group) {
            handle.group.visible = !ship.destroyed;
            if (mothership.docked) bayPose(ship.position, ship.quaternion, mothershipBay);
            else mothershipBay.copy(ship.position);
            handle.group.position.copy(mothershipBay).sub(runtime.origin);
            handle.group.quaternion.copy(ship.quaternion);
            handle.setGear(ship.gear);
            handle.setThrust(ship.landed ? 0.05 : Math.max(0.12, ship.throttle) + ship.boost * 0.9 + ship.pulse);
            // Atmospheric entry, or the Sun's heat on the shield, glows on the nose.
            handle.setShield(Math.max(ship.entry, THREE.MathUtils.clamp((ship.temperature - HEAT_WARNING) / (HEAT_LIMIT + 300 - HEAT_WARNING), 0, 1)));
        }

        // The explorer stands at the floating origin while on foot.
        const astronaut = astronautRef.current;
        const walker = walkerRef.current;
        if (astronaut?.group) {
            astronaut.group.visible = runtime.mode === 'walk' && !!walker;
            if (runtime.mode === 'walk' && walker) {
                walkerUp.copy(walker.position).sub(walker.body.position).normalize();
                walkerBack.copy(walker.facing).negate();
                walkerRight.crossVectors(walkerUp, walkerBack).normalize();
                basis.makeBasis(walkerRight, walkerUp, walkerBack);
                astronaut.group.position.set(0, 0, 0);
                astronaut.group.quaternion.setFromRotationMatrix(basis);
                astronaut.setGait(walker.gait, walker.moving);
                astronaut.setJetpack(walker.jetting);
                astronaut.setMotion(motionOf(walker));
                astronaut.setWalker(walker);
            }
        }

        const cam = cameraState.current;
        if (runtime.mode === 'walk' && walker) {
            const cameraUp = walkerCamera(walker, cameraWorld, lookWorld);
            camera.position.copy(cameraWorld).sub(runtime.origin);
            camera.up.copy(cameraUp);
            camera.lookAt(lookWorld.x - runtime.origin.x, lookWorld.y - runtime.origin.y, lookWorld.z - runtime.origin.z);
            const perspective = camera as THREE.PerspectiveCamera;
            cam.fov += ((lookingCloser(input) ? LOOK_CLOSER_FOV : 64) - cam.fov) * (1 - Math.exp(-dt * 6));
            if (Math.abs(perspective.fov - cam.fov) > 0.01) {
                perspective.fov = cam.fov;
                perspective.updateProjectionMatrix();
            }
            cam.quaternion.copy(ship.quaternion);
            camera.updateMatrixWorld();
            runtime.camera.copy(cameraWorld);
            runtime.speed = walker.velocity.length();
            runtime.pulse = false;
            runtime.hud.ship = ship;
            runtime.hud.walker = walker;
            runtime.view.camera = camera;
            return;
        }
        runtime.hud.walker = null;

        // Chase camera: orientation lags a little behind the ship, position does
        // not (a fall held by a test harness is framed at once).
        if (runtime.fall.hold) cam.quaternion.copy(ship.quaternion);
        else if (!ship.destroyed) cam.quaternion.slerp(ship.quaternion, 1 - Math.exp(-dt * (ship.landing ? 2 : 4.5)));
        // Portrait screens are narrow: pull back so the ship does not fill them.
        const portrait = THREE.MathUtils.clamp(1 / Math.max((camera as THREE.PerspectiveCamera).aspect, 0.3), 1, 2.2);
        const targetOffset = ship.destroyed
            // Lost: the camera drifts back from the wreck.
            ? offset.set(0, 10, 75)
            : offset.set(0, (2.8 - ship.pulse * 0.5) * (0.7 + portrait * 0.3), (14 + ship.boost * 2.5 + ship.pulse * 4) * (0.55 + portrait * 0.45));
        // Flying the Argo: well back and above, so all of her is in view.
        if (mothership.docked && !ship.destroyed) targetOffset.set(0, 175 * (0.7 + portrait * 0.3), 430 * (0.55 + portrait * 0.45));
        cam.offset.lerp(targetOffset, 1 - Math.exp(-dt * (ship.destroyed ? 1.6 : 3)));
        cameraWorld.copy(cam.offset).applyQuaternion(cam.quaternion).add(ship.position);
        forward.set(0, 0, -1).applyQuaternion(cam.quaternion);
        shipUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
        lookWorld.copy(ship.position).addScaledVector(forward, 40).addScaledVector(shipUp, 2.2);

        // Keep the camera above the ground of the world it is near.
        const body = runtime.currentBody;
        if (body && body.kind === 'rocky') {
            const distance = cameraWorld.distanceTo(body.position);
            bodyUp.copy(cameraWorld).sub(body.position).divideScalar(distance);
            const minimum = body.radius + groundHeight(body, bodyUp) + 2.5;
            if (distance < minimum) cameraWorld.copy(body.position).addScaledVector(bodyUp, minimum);
        }

        if (!runtime.reducedMotion && (ship.entry > 0.05 || ship.jolt > 0.02)) {
            const shake = ship.entry * 0.18 + ship.jolt * ship.jolt * 0.9;
            cameraWorld.x += (Math.random() - 0.5) * shake;
            cameraWorld.y += (Math.random() - 0.5) * shake;
            cameraWorld.z += (Math.random() - 0.5) * shake;
        }

        camera.position.copy(cameraWorld).sub(runtime.origin);
        camera.up.copy(shipUp);
        // cameraWorld is relative to the ship's world position; the origin is the ship.
        camera.lookAt(lookWorld.x - runtime.origin.x, lookWorld.y - runtime.origin.y, lookWorld.z - runtime.origin.z);
        const perspective = camera as THREE.PerspectiveCamera;
        const closer = lookingCloser(input) && !ship.destroyed;
        const targetFov = closer ? LOOK_CLOSER_FOV : 62 + ship.boost * 9 + ship.pulse * 22;
        cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * (closer ? 6 : 3)));
        if (Math.abs(perspective.fov - cam.fov) > 0.01) {
            perspective.fov = cam.fov;
            perspective.updateProjectionMatrix();
        }
        // The crossing and the end of the fall have cameras of their own (crossing.ts, fall.ts).
        const transit = runtime.transit;
        if (transit) {
            warpCentre.copy(ship.position).sub(runtime.origin);
            crossingCamera(transit, warpCentre, mothership.docked ? MOTHERSHIP.length : 9, runtime.reducedMotion, shot);
            if (!runtime.reducedMotion) {
                // Shaken as the far side comes up.
                const k = THREE.MathUtils.smoothstep(transit.t, BEAT.rush, BEAT.white) * (1 - THREE.MathUtils.smoothstep(transit.t, BEAT.white + 0.4, BEAT.out)) * (mothership.docked ? 2.5 : 0.08);
                shot.position.x += (Math.sin(time * 37.1) + Math.sin(time * 23.7)) * k;
                shot.position.y += (Math.sin(time * 41.3) + Math.sin(time * 17.9)) * k;
            }
            camera.position.copy(shot.position);
            camera.up.copy(shot.up);
            camera.lookAt(shot.target);
            cam.fov = shot.fov;
            if (Math.abs(perspective.fov - cam.fov) > 0.01) {
                perspective.fov = cam.fov;
                perspective.updateProjectionMatrix();
            }
            cameraWorld.copy(camera.position).add(runtime.origin);
        } else if (runtime.fall.active && spaghettiShot(runtime.fall, ship, runtime.origin, shot, mothership.docked ? MOTHERSHIP.length : 9)) {
            camera.position.copy(shot.position);
            camera.up.copy(shot.up);
            camera.lookAt(shot.target);
            cameraWorld.copy(camera.position).add(runtime.origin);
        }
        camera.updateMatrixWorld();
        runtime.camera.copy(cameraWorld);
        runtime.speed = ship.velocity.length();
        runtime.pulse = ship.pulse > 0.05;
        updateSpacetime(camera, dt);
        runtime.hud.ship = ship;
        runtime.view.camera = camera;
    }, -2);

    // The player's ship, explorer and exhaust live on their own layer: the main
    // camera sees them, the cube cameras that photograph the sky for the
    // wormhole and black hole lensing do not.
    const { camera: mainCamera } = useThree();
    const playerRef = useRef<THREE.Group>(null);
    const warpSources = () => {
        const list: THREE.Object3D[] = [];
        if (shipWarpRef.current) list.push(shipWarpRef.current);
        if (argoWarpRef.current && mothership.docked) list.push(argoWarpRef.current);
        return list;
    };
    const groundDetailRef = useRef<THREE.Group>(null);
    // The one being played wears their own colours, fighter and suit (livery.ts).
    const [activeId, setActiveId] = useState(() => crew.members[crew.active].def.id);
    useFrame(() => {
        const id = crew.members[crew.active].def.id;
        if (id !== activeId) setActiveId(id);
    });
    useEffect(() => {
        mainCamera.layers.enable(PLAYER_LAYER);
        mainCamera.layers.enable(NO_MIRROR_LAYER);
    }, [mainCamera]);
    // Checked every frame, not once: the sculpted ship and explorer arrive
    // after the first render and would otherwise join the photographs.
    useFrame(() => {
        playerRef.current?.traverse(onPlayerLayer);
        // The ground's small things (grass, plants, trees, rocks, animals, crystals) are left out of
        // the sky photographs the same way: a photograph of the sky has no use for them, and from a
        // world's ground they were most of the cost of six large views of the whole scene.
        groundDetailRef.current?.traverse(onPlayerLayer);
    });

    return (
        <>
            <group ref={playerRef}>
                <group ref={shipWarpRef} matrixAutoUpdate={false}>
                    <Ship ref={shipRef} livery={LIVERIES[activeId]} />
                </group>
                <Astronaut ref={astronautRef} livery={LIVERIES[activeId]} />
                <CrewFleet runtime={runtime} />
                <group ref={argoWarpRef} matrixAutoUpdate={false}>
                    <MothershipView runtime={runtime} />
                </group>
                <AfterimagesWatch sources={warpSources} />
                <WormholeTransit runtime={runtime} />
                {region === 'ton' && <Colonists runtime={runtime} />}
                {region === 'ton' && <Waterfalls runtime={runtime} />}
                {region === 'ton' && <Lotus runtime={runtime} />}
                <MiningEffects runtime={runtime} />
                <ExhaustTrails
                    runtime={runtime}
                    nozzles={() => shipRef.current?.nozzles ?? []}
                    intensity={() => (ship.landed || runtime.fall.active ? 0 : THREE.MathUtils.clamp((ship.velocity.length() - 50) / 320, 0, 1) * (0.6 + ship.boost * 0.4) + ship.pulse * 0.3)}
                />
                <SpeedStreaks
                    velocity={() => ship.velocity}
                    strength={() => (runtime.fall.active ? 0 : Math.max(ship.pulse, runtime.atmosphere < 0.01 ? THREE.MathUtils.clamp((ship.velocity.length() - 1400) / 1800, 0, 0.5) : 0))}
                />
            </group>
            <group ref={groundDetailRef}>
                <SurfaceProps runtime={runtime} />
                <Grass runtime={runtime} />
                <WaterSurface runtime={runtime} />
                <Wildlife runtime={runtime} />
                <SurfaceCrystals runtime={runtime} />
                <ForagePlants runtime={runtime} />
            </group>
            <Clouds runtime={runtime} />
            <PlayerShadows runtime={runtime} />
            <Lighting runtime={runtime} />
            <Torch runtime={runtime} input={input} />
            <Campfire runtime={runtime} />
            <Asteroids runtime={runtime} input={input} />
            <Fishing runtime={runtime} tipOf={() => astronautRef.current?.toolTip ?? null} />
            <Wreck runtime={runtime} />
            <ScreenWarpWatch quality={runtime.quality} />
        </>
    );
};

