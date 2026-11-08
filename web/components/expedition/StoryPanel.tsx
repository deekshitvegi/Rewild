import type { CrewCard } from './crew';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { earthRevival, revivalStage } from './revival';
import { findBody } from './bodies';
import { CHAPTERS, type StoryState } from './quests';
import { bonusOf, medalOf, tradeStates, type Medal } from './challenges';
import type { ExpeditionProgress } from './glyphs';
import { EXPEDITIONS } from './expeditions';
import { TRAIL } from './story';
import { FIRST_WORDS, wordsId } from './contact';
import { LIFE_FORMS } from './aliens';
import { Inscription } from './DataLog';
import { badgeOf } from './badges';

const MEDAL_NAME: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

/** A medal's disc. */
const MedalBadge = ({ medal }: { medal: Medal | null }) => (
    <i className={`expedition-medal${medal ? ` is-${medal}` : ''}`} aria-hidden="true" />
);

/** The chapter in progress, under the expedition log: what to do next. */
export const StoryPanel = ({ story, progress, onOpen }: { story: StoryState; progress: ExpeditionProgress; onOpen: () => void }) => {
    if (!story.chapter) {
        const golds = CHAPTERS.filter((chapter) => medalOf(chapter, progress) === 'gold').length;
        return (
            <section className="expedition-story" data-hud-panel>
                <small>Story · complete</small>
                <strong>The Signal is read</strong>
                <span className="expedition-story__bonus"><MedalBadge medal="gold" />{golds} of {CHAPTERS.length} chapters at gold</span>
                <button type="button" onClick={onOpen}>Chapters <kbd>J</kbd></button>
            </section>
        );
    }
    const open = story.objectives.filter((o) => !o.done).slice(0, 3);
    const bonus = (story.chapter.bonus ?? []).map((objective) => ({ objective, ...objective.check(progress) })).find((b) => !b.done);
    const world = story.chapter.world ? findBody(story.chapter.world) : undefined;
    const badge = badgeOf(world?.id);
    return (
        <section className="expedition-story" data-hud-panel aria-label="Story">
            <header className="expedition-story__head">
                {badge && <i className="expedition-world" style={{ backgroundImage: `url(${badge})` }} aria-hidden="true" />}
                <div>
                    <small>Chapter {story.index + 1} of {CHAPTERS.length}{world ? ` · ${world.name}` : ''}{story.chapter.seed ? ` · Seed: ${story.chapter.seed}` : ''}</small>
                    <strong>{story.chapter.title}</strong>
                </div>
            </header>
            <ul>
                {open.map(({ objective, have, need }, k) => (
                    <li key={objective.id} className={k === 0 ? 'is-next' : undefined}>
                        <i aria-hidden="true" />
                        <span>{objective.text}</span>
                        {need !== undefined && need > 1 && <b>{have ?? 0}/{need}</b>}
                    </li>
                ))}
            </ul>
            {bonus && (
                <span className="expedition-story__bonus" title="Bonus objective: for a silver or gold medal">
                    <MedalBadge medal="gold" />
                    <span>Bonus · {bonus.objective.text}{bonus.need !== undefined && bonus.need > 1 ? ` · ${bonus.have ?? 0}/${bonus.need}` : ''}</span>
                </span>
            )}
            <button type="button" onClick={onOpen}>Chapters &amp; challenges <kbd>J</kbd></button>
        </section>
    );
};

type Tab = 'story' | 'challenges' | 'expeditions' | 'crew';

/** Every chapter with its medal, and every challenge (J). */
export const StoryLog = ({ story, progress, onClose, active, onBegin, onAbandon, crew, onSwitch, onPrologue }: {
    story: StoryState;
    progress: ExpeditionProgress;
    onClose: () => void;
    /** The expedition under way, and how to begin or give up one (expeditions.ts). */
    active: string | null;
    onBegin: (id: string) => void;
    onAbandon: () => void;
    /** The crew of four, and how to play as one of them. */
    crew: CrewCard[];
    onSwitch: (index: number) => void;
    /** Read the prologue again. */
    onPrologue: () => void;
}) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    const [tab, setTab] = useState<Tab>('story');
    useEffect(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' || event.code === 'KeyJ') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const trades = tradeStates(progress);
    const ranks = trades.reduce((sum, t) => sum + t.done, 0);
    const totalRanks = trades.reduce((sum, t) => sum + t.trade.ranks.length, 0);

    return (
        <div className="expedition-map" role="dialog" aria-modal="true" aria-labelledby="expedition-story-title">
            <div className="expedition-map__panel expedition-chapters">
                <header>
                    <div>
                        <small>{tab === 'story' ? 'Story' : tab === 'challenges' ? `Challenges · ${ranks} of ${totalRanks} ranks` : tab === 'crew' ? 'Crew of the Argo' : `Expeditions · deaths ${progress.stats.deaths ?? 0}`}</small>
                        <h2 id="expedition-story-title">{tab === 'story' ? 'The Signal' : tab === 'challenges' ? 'Trades of the expedition' : tab === 'crew' ? 'Four of us' : 'Past the safe point'}</h2>
                    </div>
                    <div className="expedition-map__header-actions">
                        <div className="expedition-map__tabs" role="tablist" aria-label="Log">
                            <button type="button" role="tab" aria-selected={tab === 'story'} onClick={() => setTab('story')}>Story</button>
                            <button type="button" role="tab" aria-selected={tab === 'challenges'} onClick={() => setTab('challenges')}>Challenges</button>
                            <button type="button" role="tab" aria-selected={tab === 'expeditions'} onClick={() => setTab('expeditions')}>Expeditions</button>
                            <button type="button" role="tab" aria-selected={tab === 'crew'} onClick={() => setTab('crew')}>Crew</button>
                        </div>
                        <button ref={closeRef} type="button" className="expedition-map__close" onClick={onClose}>Close <kbd>J</kbd></button>
                    </div>
                </header>
                {tab === 'crew' ? (
                    <>
                        <p className="expedition-craft__intro">
                            Play as any of the four, at any time (keys 1 to 4). Each has a fighter of their own and stays where you leave them, on foot or in their ship, on any world. The Argo, the ship that brought them home, waits overhead: a fighter docks into her (U at her bay), and only she can cross the wormhole.
                        </p>
                        <ul className="expedition-crew">
                            {crew.map((c, i) => (
                                <li key={c.id} className={c.active ? 'is-active' : ''}>
                                    <img src={`${import.meta.env.BASE_URL}textures/crew/${c.id}-full.webp`} alt={`${c.name}, ${c.role}`} width={720} height={964} loading="lazy" />
                                    <div>
                                        <strong>{c.name}</strong>
                                        <small>{c.role}</small>
                                        <p>{c.strength}</p>
                                        <p className="expedition-crew__where">{c.active ? `You · ${c.status}` : c.status}</p>
                                        {!c.active && <button type="button" onClick={() => onSwitch(i)}>Play as {c.name.split(' ')[0]} <kbd>{i + 1}</kbd></button>}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </>
                ) : tab === 'story' ? (
                    <>
                        <EarthRecovery progress={progress} onPrologue={onPrologue} />
                        <p className="expedition-craft__intro">
                            Finishing a chapter earns bronze. Meet half its bonus objectives for silver, all of them for gold; they can be met later, and the medal improves.
                        </p>
                        <ol className="expedition-chapters__list">
                            {CHAPTERS.map((chapter, index) => {
                                const done = progress.story.includes(chapter.id);
                                const current = story.chapter?.id === chapter.id;
                                const objectives = chapter.objectives.map((objective) => ({ objective, ...objective.check(progress) }));
                                const bonus = (chapter.bonus ?? []).map((objective) => ({ objective, ...objective.check(progress) }));
                                const medal = medalOf(chapter, progress);
                                const { met, of } = bonusOf(chapter, progress);
                                return (
                                    <li key={chapter.id} className={done ? 'is-done' : current ? 'is-current' : 'is-later'}>
                                        <header>
                                            <span>
                                                <small>Chapter {index + 1}{chapter.world ? ` · ${findBody(chapter.world)?.name ?? ''}` : ''}{chapter.seed ? ` · Seed: ${chapter.seed}` : ''}</small>
                                                <b>{chapter.title}</b>
                                            </span>
                                            <em>
                                                {medal ? <><MedalBadge medal={medal} />{MEDAL_NAME[medal]}</> : `+${chapter.reward} crystals`}
                                            </em>
                                        </header>
                                        {(current || done) && <p>{chapter.intro}</p>}
                                        {(current || done) && (
                                            <ul>
                                                {objectives.map(({ objective, done: isMet, have, need }) => (
                                                    <li key={objective.id} className={isMet ? 'is-met' : ''}>
                                                        <i aria-hidden="true" />
                                                        <span>{objective.text}{need !== undefined && need > 1 ? ` · ${have ?? 0}/${need}` : ''}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {(current || done) && of > 0 && (
                                            <div className="expedition-chapters__bonus">
                                                <small>Bonus · {met} of {of}{done && medal !== 'gold' ? ` · ${medal === 'silver' ? 'all' : `${Math.ceil(of / 2)}`} for ${medal === 'silver' ? 'gold' : 'silver'}` : ''}</small>
                                                <ul>
                                                    {bonus.map(({ objective, done: isMet, have, need }) => (
                                                        <li key={objective.id} className={isMet ? 'is-met' : ''}>
                                                            <i aria-hidden="true" />
                                                            <span>{objective.text}{need !== undefined && need > 1 ? ` · ${have ?? 0}/${need}` : ''}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ol>
                        <h3 className="expedition-words__title">What they told us</h3>
                        <ol className="expedition-chapters__list">
                            {FIRST_WORDS.map((words) => {
                                const heard = progress.stats.visited.includes(wordsId(words));
                                const life = LIFE_FORMS.find((l) => l.id === words.life);
                                return (
                                    <li key={words.id} className={heard ? 'is-done' : 'is-later'}>
                                        <header>
                                            <span>
                                                <small>{life?.name ?? ''}</small>
                                                <b>{heard ? words.title : 'Not heard yet'}</b>
                                            </span>
                                        </header>
                                        <p>{heard ? words.story : words.hint}</p>
                                        {heard && words.script && <Inscription text={words.script} known={progress.letters} />}
                                    </li>
                                );
                            })}
                        </ol>
                        <h3 className="expedition-words__title">The trail</h3>
                        <ol className="expedition-chapters__list">
                            {TRAIL.map((find, index) => {
                                const found = progress.stats.visited.includes(find.id);
                                // The next stone to find gives its hint; those after it wait.
                                const next = !found && TRAIL.slice(0, index).every((f) => progress.stats.visited.includes(f.id));
                                return (
                                    <li key={find.id} className={found ? 'is-done' : next ? 'is-current' : 'is-later'}>
                                        <header>
                                            <span>
                                                <small>Stone {find.trail} of {TRAIL.length}{found ? ` · ${findBody(find.body)?.name ?? ''}` : ''}</small>
                                                <b>{found ? find.name : next ? 'Not found yet' : 'Further along the trail'}</b>
                                            </span>
                                        </header>
                                        {(found || next) && <p>{found ? find.blurb : find.hint}</p>}
                                        {found && find.script && <Inscription text={find.script} known={progress.letters} />}
                                    </li>
                                );
                            })}
                        </ol>
                    </>
                ) : tab === 'expeditions' ? (
                    <>
                        <p className="expedition-craft__intro">
                            Each goes past the point where it is safe, with the real numbers read out by Argo, the ship&apos;s computer. How far to push is up to you: coming back is bronze, going further earns silver and gold. A death or a lost ship ends the attempt.
                        </p>
                        <ol className="expedition-chapters__list">
                            {EXPEDITIONS.map((expedition) => {
                                const record = progress.stats.expeditions?.[expedition.id];
                                const medal = record?.medal ?? null;
                                const rank = medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0;
                                const running = active === expedition.id;
                                return (
                                    <li key={expedition.id} className={running ? 'is-current' : medal ? 'is-done' : 'is-open'}>
                                        <header>
                                            <span>
                                                <small>{findBody(expedition.world)?.name ?? ''}{record?.attempts ? ` · ${record.attempts} attempt${record.attempts > 1 ? 's' : ''}` : ''}</small>
                                                <b>{expedition.title}</b>
                                            </span>
                                            <em>{medal ? <><MedalBadge medal={medal} />{MEDAL_NAME[medal]}</> : `+${expedition.reward} crystals`}</em>
                                        </header>
                                        <p>{expedition.brief}</p>
                                        <ul>
                                            {expedition.medals.map((text, n) => (
                                                <li key={text} className={n < rank ? 'is-met' : ''}>
                                                    <MedalBadge medal={(['bronze', 'silver', 'gold'] as const)[n]} />
                                                    <span>{text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <div className="expedition-chapters__actions">
                                            {running
                                                ? <button type="button" className="expedition-map__auto" onClick={onAbandon}>Give up this attempt</button>
                                                : <button type="button" className="expedition-map__auto" onClick={() => onBegin(expedition.id)} disabled={!!active}>{record?.attempts ? 'Try again' : 'Begin'}</button>}
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    </>
                ) : (
                    <>
                        <p className="expedition-craft__intro">
                            Eight trades, five ranks each, taken in order: only the next rank of each shows. Every rank pays crystals; the last earns the trade&apos;s title.
                        </p>
                        <ol className="expedition-trades">
                            {trades.map(({ trade, done, next }) => (
                                <li key={trade.id} className={next ? '' : 'is-mastered'}>
                                    <header>
                                        <span>
                                            <small>{trade.name} · {next ? `Rank ${next.index + 1} of ${trade.ranks.length}` : 'Mastered'}</small>
                                            <b>{next ? next.challenge.text : trade.title}</b>
                                        </span>
                                        <em>{next ? `+${next.challenge.reward} crystals` : trade.title}</em>
                                    </header>
                                    <div className="expedition-trades__ranks" aria-label={`${done} of ${trade.ranks.length} ranks`}>
                                        {trade.ranks.map((rank, n) => <i key={rank.id} className={n < done ? 'is-done' : n === done ? 'is-next' : ''} />)}
                                    </div>
                                    {next && next.need !== undefined && next.need > 1 && (
                                        <div className="expedition-trades__bar" role="progressbar" aria-valuemin={0} aria-valuemax={next.need} aria-valuenow={next.have ?? 0}>
                                            <i style={{ ['--v' as string]: Math.min(1, (next.have ?? 0) / next.need) }} />
                                            <span>{next.have ?? 0} / {next.need}</span>
                                        </div>
                                    )}
                                    <p>{trade.about}</p>
                                </li>
                            ))}
                        </ol>
                    </>
                )}
            </div>
        </div>
    );
};

/** How far Earth has come back (revival.ts), and which of the Seven Seeds are home. */
const EarthRecovery = ({ progress, onPrologue }: { progress: ExpeditionProgress; onPrologue: () => void }) => {
    const value = earthRevival(progress);
    const stage = revivalStage(value);
    const seeds = CHAPTERS.filter((chapter) => chapter.seed);
    const home = seeds.filter((chapter) => progress.story.includes(chapter.id)).length;
    return (
        <section className="expedition-earth" aria-label="Earth's recovery">
            <header>
                <span>
                    <small>Earth · {home} of {seeds.length} Seeds home</small>
                    <b>{stage.name}</b>
                </span>
                <em>{Math.round(value * 100)}%</em>
            </header>
            <i className="expedition-earth__bar" style={{ '--fill': `${Math.round(value * 100)}%` } as CSSProperties} aria-hidden="true" />
            <p>{stage.blurb}</p>
            <ul className="expedition-earth__seeds">
                {seeds.map((chapter) => (
                    <li key={chapter.id} className={progress.story.includes(chapter.id) ? 'is-met' : ''} title={chapter.title}>{chapter.seed}</li>
                ))}
            </ul>
            <button type="button" className="expedition-earth__prologue" onClick={onPrologue}>Read the prologue</button>
        </section>
    );
};

const PROLOGUE_KEY = 'rewild-prologue';
/** Whether the prologue has been read on this device. */
export const prologueRead = () => {
    try {
        // A test start somewhere (?start=) skips it; ?prologue shows it anyway.
        const query = new URLSearchParams(window.location.search);
        if (query.has('prologue')) return false;
        if (query.has('start')) return true;
        return window.localStorage.getItem(PROLOGUE_KEY) === 'read';
    } catch {
        return false;
    }
};

/** The prologue (docs/story.md), shown once to a new player: where the crew came from, and why. */
export const Prologue = ({ onClose }: { onClose: () => void }) => {
    const beginRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        beginRef.current?.focus();
        try {
            window.localStorage.setItem(PROLOGUE_KEY, 'read');
        } catch {
            // Nowhere to keep it: shown again next time.
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);
    return (
        <div className="expedition-prologue" role="dialog" aria-modal="true" aria-labelledby="prologue-title">
            <article>
                <img src={`${import.meta.env.BASE_URL}textures/story/haven.webp`} alt="Haven: green hills and the colony's domes under the black hole TON 618, the ark Halcyon standing beside them" />
                <div>
                    <small>Prologue · Haven, by TON 618</small>
                    <h2 id="prologue-title">Ten Years a Day</h2>
                    <p>Three hundred years ago a superflare burned the ozone off Earth. The ark <i>Halcyon</i> carried four hundred people out through the wormhole by Saturn, to Haven: a green world circling the black hole TON 618. So close to it, time runs slow. One day on Haven is ten years on Earth.</p>
                    <p>Haven's orbit is failing. The council has sent four of you home in the <i>Argo</i>, the <i>Halcyon</i>'s tender: Dev Arora, Noor Haddad, Kai Mendes and Amara Okafor. Bring Earth back to life, one Seed at a time, then go back through the wormhole and tell them to come home.</p>
                    <p>You have years. They have a month.</p>
                    <button ref={beginRef} type="button" onClick={onClose}>Begin</button>
                </div>
            </article>
        </div>
    );
};
