import { EXPEDITION_BODIES } from './bodies';
import { PlanetTerrain } from './PlanetTerrain';
import { Atmosphere } from './Atmosphere';
import { GasGiant } from './GasGiant';
import { GasDepths } from './GasDepths';
import { SpaceBackdrop } from './SpaceBackdrop';
import { PlanetPoints } from './PlanetPoints';
import { Sun } from './Sun';
import { regionOf, type Region } from './region';
import type { ExpeditionRuntime } from './runtime';

/** Everything in the system the player is in that is not the player (region.ts: the other system is not built). */
export const ExpeditionWorld = ({ runtime, region }: { runtime: ExpeditionRuntime; region: Region }) => (
    <>
        <SpaceBackdrop runtime={runtime} />
        {region === 'sol' && <PlanetPoints runtime={runtime} />}
        {region === 'sol' && <Sun runtime={runtime} />}
        {EXPEDITION_BODIES.filter((body) => body.kind !== 'star' && regionOf(body) === region).map((body) => body.kind === 'gas'
            ? <GasGiant key={body.id} body={body} runtime={runtime} />
            : (
                <group key={body.id}>
                    <PlanetTerrain body={body} runtime={runtime} />
                    {!body.biome?.airless && <Atmosphere body={body} runtime={runtime} />}
                </group>
            ))}
        {region === 'sol' && <GasDepths runtime={runtime} />}
    </>
);
