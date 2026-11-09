import { BEAT } from './crossing';
import { FALL_INSIDE, FALL_SPIRAL, FALL_STRETCH_AT } from './fall';

/**
 * Everything said aloud in the crossing of the wormhole and the fall into TON 618: who says it, the
 * words (the captions), the recording (web/public/audio/lines, ATTRIBUTION.md there) and its length,
 * measured from the file, so a caption is up exactly as long as its line is heard. ARGO is dry (she is
 * the ship); the crew are heard over the intercom. `gain` brings each to the same loudness (about -20
 * dBFS while speaking; the crew's intercom takes came out 2-6 dB quieter than ARGO's).
 *
 * And the score for each (web/public/audio/music): one take each for now; the owner has not picked
 * between take A and take B, so the file is swapped here.
 */
export type Speaker = 'ARGO' | 'Dev' | 'Amara' | 'Kai' | 'Noor';

export interface VoiceLine {
    id: string;
    who: Speaker;
    text: string;
    file: string;
    /** Length of the recording, seconds. */
    seconds: number;
    /** Level to play it at (1: as recorded). */
    gain: number;
}

const db = (value: number) => Math.pow(10, value / 20);
const line = (id: string, who: Speaker, text: string, seconds: number, file: string, gainDb: number): VoiceLine => ({
    id, who, text, seconds, file: `audio/lines/${file}.mp3`, gain: db(gainDb),
});

export const LINES = {
    c01: line('c01', 'ARGO', 'Throat in thirty seconds. Tidal load is rising.', 3.97, 'c01-argo', -1.4),
    c02: line('c02', 'Dev', 'Everybody strapped in? This is it.', 2.59, 'c02-dev-com', 1.9),
    c03: line('c03', 'Amara', 'Gravity\'s climbing fast. Keep her dead centre, Dev.', 4.02, 'c03-amara-com', 5.7),
    c04: line('c04', 'Dev', 'Dead centre. Taking us in.', 2.66, 'c04-dev-com', 3.5),
    c05: line('c05', 'ARGO', 'Entering the throat.', 1.49, 'c05-argo', -1.4),
    c06: line('c06', 'Kai', 'Hull\'s singing back here! She\'ll hold, she\'ll hold!', 4.52, 'c06-kai-com', 2.2),
    c07: line('c07', 'Noor', 'Look at the light. It\'s bending all around us.', 4.68, 'c07-noor-com', 2.5),
    c08: line('c08', 'ARGO', 'Three g. Holding steady.', 2.69, 'c08-argo', -2.0),
    c09: line('c09', 'Amara', 'There. The other side.', 2.19, 'c09-amara-com', 5.2),
    c10: line('c10', 'Dev', 'Hold on, everyone. Bringing us out.', 2.82, 'c10-dev-com', 2.4),
    b1: line('b1', 'ARGO', 'Event horizon in ten seconds. There is no course back from here.', 4.91, 'b1-argo', -0.8),
    b2: line('b2', 'ARGO', 'Horizon crossed. Nothing feels different. That is the strange part.', 5.49, 'b2-argo', 1.6),
    b3: line('b3', 'ARGO', 'The sky behind us is shrinking into a ring. Everything that ever happened out there is in it.', 6.53, 'b3-argo', 0),
    b4: line('b4', 'ARGO', 'Tidal stretch rising. I\'m sorry.', 3.08, 'b4-argo', 0.6),
};

/**
 * Coming up to a mouth in the Argo: from thirty seconds out (time to the throat at the speed she is
 * closing), one after another; and as she reaches it, ARGO's last word. Lines that no longer fit the
 * time left are passed over.
 */
export const APPROACH_LINES: VoiceLine[] = [LINES.c01, LINES.c02, LINES.c03, LINES.c04];
export const APPROACH_FROM = 30.5;
export const ENTRY_LINE = { line: LINES.c05, eta: 1.6 };

/** In the throat, by sequence second (crossing.ts BEAT): each fits before the next begins. */
export const THROAT_LINES: { at: number; line: VoiceLine }[] = [
    { at: 0.4, line: LINES.c06 },
    { at: BEAT.eye + 0.1, line: LINES.c07 },
    { at: BEAT.pressure + 0.1, line: LINES.c08 },
    { at: BEAT.rush + 0.1, line: LINES.c09 },
    { at: BEAT.white - 0.4, line: LINES.c10 },
];

/** Falling into TON 618, by seconds into the fall (fall.ts). */
export const FALL_LINES: { at: number; line: VoiceLine }[] = [
    // The horizon is ten seconds away when the fall takes hold.
    { at: 0.2, line: LINES.b1 },
    { at: FALL_SPIRAL + 0.5, line: LINES.b2 },
    { at: FALL_SPIRAL + FALL_INSIDE + 0.2, line: LINES.b3 },
    { at: FALL_STRETCH_AT + 0.2, line: LINES.b4 },
];

export const SCORE = {
    /** The crossing: its loudest, brightest moment (33.4 s in) lands on the flash of white as the Argo comes out. */
    crossing: { file: 'audio/music/music-wormhole-a.mp3', peak: 33.4, level: 1, under: 0.45 },
    /** The fall: started 21.5 s in, so its peak (43-47 s) comes with the end and it fades under the card. */
    fall: { file: 'audio/music/music-blackhole-a.mp3', from: 21.5, level: 1.3, under: 0.5 },
};

/** The moment of full white in the crossing (sequence seconds): the score's peak goes here. */
export const CROSSING_WHITE = BEAT.white + 0.7;
