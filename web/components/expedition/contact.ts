import * as THREE from 'three';
import { say } from './argo';
import { ALPHABET } from './glyphs';
import type { LifeForm } from './aliens';
import { cue, type ExpeditionRuntime } from './runtime';

/**
 * First words: the three peoples who can think back at you, and what it
 * takes to be answered. The Venusian aeronauts talk in radio pulses, and the
 * way in is to count with them (Contact, Project Hail Mary). The Europans
 * speak in light, in the Makers' own script. The Makers speak only to someone
 * who has learned enough of that script to read them (Arrival).
 *
 * What each says is one piece of a single history: the Makers came through
 * the wormhole by Saturn when the dark of TON 618 ate their stars, left a key
 * on every world, taught the Europans to read, and were watched by the
 * aeronauts as they passed outward.
 */
export interface FirstWords {
    id: 'aeronauts' | 'europans' | 'makers';
    /** The life form it is (aliens.ts). */
    life: string;
    title: string;
    /** On foot or aboard, and how near (metres). */
    mode: 'walk' | 'ship';
    range: number;
    /** What E does. */
    prompt: string;
    /** A line for the log before they have been answered. */
    hint: string;
    /** Why it cannot be done yet, if it cannot. */
    blocked: (runtime: ExpeditionRuntime) => string | null;
    /** What Argo says when the player acts, and when the answer comes. */
    sent: string;
    heard: string;
    /** The answer: a passage of prose, and (for the two who write) a message in the Makers' script. */
    story: string;
    script?: string;
    reward: number;
}

/** Letters the Makers would need you to know: most of the script. */
export const MAKER_LETTERS = 18;

export const FIRST_WORDS: FirstWords[] = [
    {
        id: 'aeronauts',
        life: 'venus-aeronauts',
        title: 'Counting',
        mode: 'ship',
        range: 260,
        prompt: 'E  Answer them: thirteen pulses',
        hint: 'Somewhere between Venus\'s cloud decks something counts in radio pulses: two, three, five, seven, eleven.',
        blocked: (runtime) => (runtime.radio.band !== 'hydrogen' ? 'Tune the radio to the hydrogen line (V) to answer them' : null),
        sent: 'Sent: thirteen pulses on the hydrogen line, the next prime after theirs.',
        heard: 'They answered: seventeen, nineteen, twenty-three. Then a picture, one pulse for each dot.',
        story: 'You sent thirteen pulses, the next prime after their eleven, and the aeronauts sang the next three back. Then they sent a picture, one pulse for each dot: their sky as they see it through the gaps in the cloud. Long ago, it says, tall ones came up through the clouds in a ship that shone, counted with them as you just did, and left going outward, toward the world with rings. They have been watching that way since. They gave you a net of their crystal fibre.',
        reward: 20,
    },
    {
        id: 'europans',
        life: 'europa-europan',
        title: 'Light',
        mode: 'walk',
        range: 14,
        prompt: 'E  Flash your torch at it',
        hint: 'Whoever sent Europa\'s signal came up through the vent in a suit of shell plates.',
        blocked: () => null,
        sent: 'Torch: three flashes.',
        heard: 'It is answering in light, on the plates of its suit. The script is the Makers\'.',
        story: 'You flashed your torch at it three times. It flashed back from the plates of its suit and kept on: the same script the Makers cut into the monoliths and vaults. Whatever letters you have learned, Argo can read.',
        script: 'THEY CAME DOWN THROUGH THE ICE AND TAUGHT US TO READ. A KEY ON EVERY WORLD. THE LAST ONE WAITS WHERE THE SUN IS SMALL.',
        reward: 20,
    },
    {
        id: 'makers',
        life: 'triton-makers',
        title: 'The record',
        mode: 'walk',
        range: 22,
        prompt: 'E  Read what it is showing you',
        hint: 'At the edge of the system one of those who built the vaults is waiting for someone who can read.',
        blocked: (runtime) => {
            const known = runtime.letters.length;
            return known >= MAKER_LETTERS ? null : `You can read ${known} of the 26 glyphs; it needs ${MAKER_LETTERS}. Read monoliths, open vaults`;
        },
        sent: 'Reading. The glyphs on its robe are moving.',
        heard: 'It is speaking in the script. I can read it.',
        story: 'It bowed again and opened its hands, and the glyphs woven into its robe began to move, line after line, slowly, for someone still learning.',
        script: 'WE CAME THROUGH THE DOOR BY THE RINGED WORLD WHEN THE DARK ATE OUR STARS. WE LEFT A KEY ON EVERY WORLD SO THAT WHOEVER CAME NEXT WOULD LEARN TO READ BEFORE THEY FOUND THE DOOR. GO THROUGH AND LOOK. DO NOT FALL.',
        reward: 40,
    },
];

export const wordsId = (words: FirstWords) => `words-${words.id}`;
export const firstWordsFor = (life: LifeForm | null) => (life ? FIRST_WORDS.find((w) => w.life === life.id) ?? null : null);

/** A message in the Makers' script as far as it can be read: unknown letters as dots. */
export const readScript = (script: string, known: string) =>
    [...script].map((ch) => (ALPHABET.includes(ch) && !known.includes(ch) ? '·' : ch)).join('');

export interface ContactState {
    /** The nearest of those who can answer, at the site in view (Aliens.tsx). */
    near: null | { site: string; life: LifeForm; position: THREE.Vector3; distance: number };
    /** An exchange under way: the reply comes a moment after the player acts. */
    pending: null | { words: FirstWords; at: number };
    /** The torch flashing for the Europans. */
    flash: number;
}

export const createContact = (): ContactState => ({ near: null, pending: null, flash: 0 });

/** Who can be answered now, and how (for the HUD's prompts); null when no one. */
export const contactNow = (runtime: ExpeditionRuntime) => {
    const near = runtime.contact.near;
    const words = firstWordsFor(near?.life ?? null);
    if (!near || !words || runtime.contact.pending) return null;
    if (runtime.stats.visited.includes(wordsId(words))) return null;
    if (!runtime.stats.aliens.includes(words.life)) return null;
    if (runtime.mode !== words.mode || near.distance > words.range) return null;
    return { words, blocked: words.blocked(runtime) };
};

/** E pressed: if someone can be answered, answer them. Returns whether the press was used. */
export const answerContact = (runtime: ExpeditionRuntime) => {
    const now = contactNow(runtime);
    if (!now || now.blocked) return false;
    const { words } = now;
    runtime.contact.pending = { words, at: performance.now() / 1000 };
    if (words.id === 'europans') runtime.contact.flash = 1.6;
    say(runtime.argo, words.sent, 'info');
    cue(runtime, words.id === 'aeronauts' ? 'radio' : 'notice', 0.8);
    return true;
};

/** Each frame: the torch flashes, and a moment later the answer comes. */
export const stepContact = (runtime: ExpeditionRuntime, dt: number) => {
    const contact = runtime.contact;
    if (contact.flash > 0) {
        contact.flash = Math.max(0, contact.flash - dt);
        // Three flashes, a quarter of a second each.
        runtime.torch.on = contact.flash > 0 ? Math.floor(contact.flash / 0.27) % 2 === 0 : runtime.torch.manual;
    }
    const pending = contact.pending;
    if (!pending || performance.now() / 1000 - pending.at < 2.6) return;
    contact.pending = null;
    const { words } = pending;
    const id = wordsId(words);
    if (runtime.stats.visited.includes(id)) return;
    runtime.stats.visited.push(id);
    runtime.inventory.crystals += words.reward;
    say(runtime.argo, words.heard, 'info');
    const message = words.script ? ` "${readScript(words.script, runtime.letters)}"` : '';
    runtime.scan.found = { name: words.title, blurb: `${words.story}${message}`, label: 'First words' };
    runtime.scan.foundAt = performance.now() / 1000;
    cue(runtime, 'chapter', 1);
};
