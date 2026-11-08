import { Fragment, useEffect, useRef } from 'react';
import { ALPHABET, GLYPH_PATHS, readInscription } from './glyphs';
import type { DataSite } from './sites';

/**
 * What a data site says: its alien inscription (decoded as far as the glyphs
 * learned so far allow), the glyphs this reading taught, and the portfolio
 * entry itself.
 */
export const Glyph = ({ letter, size = 18 }: { letter: string; size?: number }) => (
    <svg className="expedition-glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d={GLYPH_PATHS[letter] ?? ''} />
    </svg>
);

export const Inscription = ({ text, known }: { text: string; known: string }) => {
    // Word by word, so a line only ever breaks between words.
    const words: ReturnType<typeof readInscription>[] = [[]];
    for (const c of readInscription(text, known)) {
        if (c.ch === ' ') words.push([]);
        else words[words.length - 1].push(c);
    }
    return (
        <p className="expedition-log__inscription" aria-label="Alien inscription">
            {words.map((word, w) => (
                <Fragment key={w}>
                    {w > 0 && <span className="is-space"> </span>}
                    <span className="is-word">
                        {word.map((c, n) => {
                            if (!c.isLetter) return <span key={n}>{c.ch}</span>;
                            return c.known
                                ? <span key={n} className="is-known">{c.ch}</span>
                                : <span key={n} className="is-glyph"><Glyph letter={c.ch} /></span>;
                        })}
                    </span>
                </Fragment>
            ))}
        </p>
    );
};

export const DataLog = ({ site, known, learned, onClose }: {
    site: DataSite;
    known: string;
    learned: string[];
    onClose: () => void;
}) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' || event.code === 'KeyE') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const entry = site.entry;
    const where = site.kind === 'station' ? `Orbital data station · ${site.body.name}` : site.kind === 'obelisk' ? 'The Obelisk · Earth' : `Data site · ${site.body.name} · ${site.body.label}`;
    const obeliskProgress = site.kind === 'obelisk' ? `${known.length} of ${ALPHABET.length} glyphs known` : null;

    return (
        <div className="expedition-log" role="dialog" aria-modal="true" aria-labelledby="expedition-log-title">
            <div className="expedition-log__panel" style={{ ['--site' as string]: site.color }}>
                <header>
                    <small>{where}</small>
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="Close">Close <kbd>E</kbd></button>
                </header>
                <Inscription text={site.inscription} known={known} />
                {learned.length > 0 && (
                    <p className="expedition-log__learned">
                        Glyphs learned:
                        {learned.map((letter) => (
                            <span key={letter}><Glyph letter={letter} size={16} /> = {letter}</span>
                        ))}
                    </p>
                )}
                {obeliskProgress && <p className="expedition-log__learned">{obeliskProgress}. Every data site you read teaches more of the script.</p>}
                <h2 id="expedition-log-title">{entry.name}</h2>
                {entry.description && <p className="expedition-log__lead">{entry.description}</p>}
                {(entry.date || entry.location) && (
                    <p className="expedition-log__meta">{[entry.date, entry.location].filter(Boolean).join(' · ')}</p>
                )}
                {entry.about && <p className="expedition-log__about">{entry.about}</p>}
                {entry.details && entry.details.length > 0 && (
                    <ul>
                        {entry.details.map((detail) => <li key={detail}>{detail}</li>)}
                    </ul>
                )}
                {entry.link && (
                    <a className="expedition-log__link" href={entry.link} target="_blank" rel="noreferrer">
                        {entry.linkLabel ?? 'Open link'} ↗
                    </a>
                )}
            </div>
        </div>
    );
};
