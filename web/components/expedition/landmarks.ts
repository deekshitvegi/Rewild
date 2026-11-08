import * as THREE from 'three';
import { findBody, startPosition, type ExpeditionBody } from './bodies';
import { groundHeight } from './environment';
import { directionAt } from './history';

/**
 * The great natural sights of a world, where they really are on its map (on
 * Mars, in MOLA's own latitudes and longitudes): marked from orbit, found by
 * getting there (flying over counts), each with a card saying what it is.
 */
export interface Landmark {
    id: string;
    body: string;
    name: string;
    /** Under the name on its marker. */
    label: string;
    /** Degrees north and east. */
    lat: number;
    lon: number;
    /** Metres from the eye: closer than this, it has been found. */
    reach: number;
    blurb: string;
}

export const LANDMARKS: Landmark[] = [
    {
        // The middle of the summit calderas (MOLA: the deepest pits lie between 18.7 N and 19.3 N).
        id: 'olympus-mons', body: 'skills', name: 'Olympus Mons', label: 'tallest volcano in the Solar System',
        lat: 18.85, lon: -133.5, reach: 450,
        blurb: 'Olympus Mons stands nearly 22 km above the Martian datum, two and a half times as high as Everest stands above the sea, on a base some 600 km across, about the size of Arizona. Its slopes are so gentle, about five degrees, that it cannot be seen whole from anywhere on its surface: the planet curves away first. A cliff up to 8 km high runs round its foot. The summit is six collapsed calderas run together, 80 km by 60 km and up to 3 km deep, where lava drained away beneath. Some of the lava on its flanks is only a few million years old. (Here, as everywhere on this Mars, heights are drawn eight times their true proportion.)',
    },
    {
        // Coprates Chasma, the canyon's deep central trough.
        id: 'valles-marineris', body: 'skills', name: 'Valles Marineris', label: 'the great canyon of Mars',
        lat: -13.4, lon: -61.4, reach: 700,
        blurb: 'Valles Marineris runs 4,000 km along the equator of Mars, as far as New York is from Los Angeles, and in places 7 km deep, four times deeper than the Grand Canyon. No river cut it: the crust split open as the Tharsis volcanoes swelled up beside it, and its walls have slumped back in landslides that ran tens of kilometres across the floor. The walls show hundreds of beds of rock, and from the floor rise mounds of pale layered sediment, laid down perhaps in lakes. (Its depth is drawn eight times its true proportion here.)',
    },
];

const positions = new Map<string, THREE.Vector3>();

/** Where a landmark is: on the ground at its latitude and longitude. */
export const landmarkPosition = (landmark: Landmark) => {
    let at = positions.get(landmark.id);
    if (!at) {
        const body = findBody(landmark.body) as ExpeditionBody;
        const up = directionAt(body, landmark.lat, landmark.lon);
        // In the game's frame of the start, like everything laid out on a world (motion.ts).
        at = startPosition(body).clone().addScaledVector(up, body.radius + groundHeight(body, up));
        positions.set(landmark.id, at);
    }
    return at;
};

export const landmarksOn = (body: ExpeditionBody | null) => (body ? LANDMARKS.filter((landmark) => landmark.body === body.id) : []);
