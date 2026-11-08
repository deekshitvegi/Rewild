import { useEffect, useRef, useState } from 'react';
import type { ExpeditionRuntime } from './runtime';
import { RECIPES, airMinutes } from './survival';

/**
 * The suit's fabricator (C): crystals into a campfire kit, an oxygen refill,
 * a medkit, a ration, a patch for the ship's shield, or a lasting upgrade.
 * Each line says what it costs and does; one that cannot be afforded, or is
 * already at its last level, is shown but cannot be pressed.
 */
export const CraftPanel = ({ runtime, onClose }: { runtime: ExpeditionRuntime; onClose: () => void }) => {
    const closeRef = useRef<HTMLButtonElement>(null);
    const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
    const [, setTick] = useState(0);

    useEffect(() => {
        if (document.pointerLockElement) document.exitPointerLock();
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.code === 'Escape' || event.code === 'KeyC') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [onClose]);

    const crystals = runtime.inventory.crystals;
    const supplies = runtime.supplies;
    const levels: Record<string, number> = { jetpack: supplies.jetpack, tank: supplies.tank, tool: supplies.tool };

    return (
        <div className="expedition-map" role="dialog" aria-modal="true" aria-labelledby="expedition-craft-title">
            <div className="expedition-map__panel expedition-craft">
                <header>
                    <div>
                        <small>Suit fabricator</small>
                        <h2 id="expedition-craft-title">Craft with crystals</h2>
                    </div>
                    <div className="expedition-map__header-actions">
                        <span className="expedition-craft__purse"><i aria-hidden="true" /> <b>{crystals}</b> crystals · <b>{supplies.food}</b> food</span>
                        <button ref={closeRef} type="button" className="expedition-map__close" onClick={onClose}>Close <kbd>C</kbd></button>
                    </div>
                </header>
                <p className="expedition-craft__intro">
                    Crystals are the expedition&apos;s energy: mine them with the beam (hold click near one) and turn them into what keeps you going.
                    Your air tank holds {airMinutes(supplies)} minutes on worlds you cannot breathe on.
                </p>
                <ul className="expedition-craft__list">
                    {RECIPES.map((recipe) => {
                        const cost = recipe.cost(supplies);
                        const maxed = cost === null;
                        const short = !maxed && crystals < cost;
                        return (
                            <li key={recipe.id}>
                                <button
                                    type="button"
                                    disabled={maxed || short}
                                    onClick={() => {
                                        const why = runtime.actions.craft(recipe.id);
                                        setMessage(why ? { text: why, ok: false } : { text: `${recipe.name} made.`, ok: true });
                                        setTick((t) => t + 1);
                                    }}
                                >
                                    <span>
                                        <b>{recipe.name}{recipe.upgrade ? ` · level ${(levels[recipe.id] ?? 0) + (maxed ? 0 : 1)} of 2` : ''}</b>
                                        <small>{recipe.detail}</small>
                                    </span>
                                    <em>{maxed ? 'Done' : <><i aria-hidden="true" /> {cost}</>}</em>
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {message && <p className={`expedition-craft__message${message.ok ? ' is-ok' : ''}`} role="status">{message.text}</p>}
            </div>
        </div>
    );
};
