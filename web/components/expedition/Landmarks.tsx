import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { landmarkPosition, landmarksOn } from './landmarks';
import { cue, type ExpeditionRuntime } from './runtime';

/** Finds the great sights of a world (landmarks.ts) when the explorer gets there, on foot or flying over. */
export const Landmarks = ({ runtime }: { runtime: ExpeditionRuntime }) => {
    const tick = useRef(0);
    useFrame(() => {
        if ((tick.current = (tick.current + 1) % 15) !== 0) return;
        if (runtime.altitude > 6000) return;
        const visited = runtime.stats.visited;
        for (const landmark of landmarksOn(runtime.currentBody)) {
            if (visited.includes(landmark.id)) continue;
            if (landmarkPosition(landmark).distanceTo(runtime.camera) > landmark.reach) continue;
            visited.push(landmark.id);
            cue(runtime, 'chapter', 0.8);
            runtime.scan.found = { label: 'Landmark', name: landmark.name, blurb: landmark.blurb };
            runtime.scan.foundAt = performance.now() / 1000;
        }
    });
    return null;
};
