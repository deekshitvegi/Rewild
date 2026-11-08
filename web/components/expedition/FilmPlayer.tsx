import { useEffect, useRef, useState } from 'react';
import { FILMS, filmUrl, filmVolume, type FilmId } from './films';
import './film.css';

/**
 * A film over the whole screen while something loads behind it (films.ts): the crew's voices,
 * captions of what they say, a bar for how much has loaded, and once everything is ready a way
 * to skip the rest. It ends by itself when the film has finished and everything is ready; if the
 * film finishes first it holds its last frame until then. Played with sound where the browser
 * allows it (the player has just pressed something), else muted with the captions.
 */
export const FilmPlayer = ({ film, ready, progress, title, detail, tip, onDone }: {
    film: FilmId;
    /** Everything behind the film is ready. */
    ready: boolean;
    /** How much has loaded, 0 to 1, read a few times a second. */
    progress: () => number;
    title: string;
    detail?: string;
    tip?: string;
    /** Called once the film has faded out. */
    onDone: () => void;
}) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [ended, setEnded] = useState(false);
    const [closing, setClosing] = useState(false);
    const [shown, setShown] = useState(0);
    const [caption, setCaption] = useState<{ who: string; text: string } | null>(null);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;
    const progressRef = useRef(progress);
    progressRef.current = progress;

    // Start it, with sound if allowed.
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.volume = filmVolume();
        video.muted = video.volume === 0;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => setEnded(true));
        });
    }, [film]);

    // The bar (never runs backwards) and the captions.
    useEffect(() => {
        const cues = FILMS[film].cues;
        let frame = 0;
        const tick = () => {
            const value = ready ? 1 : Math.min(0.97, progressRef.current());
            setShown((last) => (ready ? 1 : Math.max(last, value)));
            const video = videoRef.current;
            const t = video?.currentTime ?? 0;
            // No caption over the last frame once the film has ended and is waiting for the world.
            const cue = video?.ended ? null : cues.find((c) => t >= c.at && t < c.end) ?? null;
            setCaption((last) => (last?.text === cue?.text ? last : cue ? { who: cue.who, text: cue.text } : null));
            frame = window.setTimeout(tick, 120);
        };
        tick();
        return () => window.clearTimeout(frame);
    }, [film, ready]);

    const finish = () => {
        if (closing) return;
        setClosing(true);
        videoRef.current?.pause();
        window.setTimeout(() => doneRef.current(), 700);
    };

    // Over when the film has ended and everything is ready.
    useEffect(() => {
        if (ended && ready) finish();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ended, ready]);

    // Enter, Space or Escape skips once everything is ready; the game hears none of them meanwhile.
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (!['Enter', 'Space', 'Escape'].includes(event.code)) return;
            event.preventDefault();
            event.stopPropagation();
            if (ready) finish();
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    const percent = Math.round(shown * 100);
    return (
        <div className={`rewild-film${closing ? ' is-closing' : ''}`} role="dialog" aria-label={title}>
            <video
                ref={videoRef}
                className="rewild-film__video"
                src={filmUrl(film)}
                playsInline
                preload="auto"
                onEnded={() => setEnded(true)}
                onError={() => setEnded(true)}
            />
            <div className="rewild-film__shade" aria-hidden="true" />
            {caption && (
                <p className="rewild-film__caption" aria-live="polite">
                    <b>{caption.who}</b> {caption.text}
                </p>
            )}
            <div className="rewild-film__footer">
                <div className="rewild-film__status">
                    <p className="rewild-film__title">{title}</p>
                    <p className="rewild-film__detail" role="status">
                        {ready ? 'Ready' : ended ? 'Almost there' : detail ?? 'Loading'}
                        {!ready && tip ? <span> · {tip}</span> : null}
                    </p>
                </div>
                {ready ? (
                    <button type="button" className="rewild-film__skip" onClick={finish}>
                        {ended ? 'Continue' : 'Skip'} <kbd>Enter</kbd>
                    </button>
                ) : (
                    <span className="rewild-film__percent" aria-hidden="true">{percent}%</span>
                )}
                <div className="rewild-film__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Loading">
                    <span style={{ transform: `scaleX(${Math.max(0.02, shown)})` }} />
                </div>
            </div>
        </div>
    );
};
