/**
 * Keyboard, mouse and touch input for the expedition, read by the controllers
 * each frame. Mouse movement accumulates between frames; touch controls write
 * the same fields, so the controllers never care where input came from.
 */
export interface ExpeditionInput {
    keys: Set<string>;
    /** Look deltas since the last frame (pixels, or scaled touch drag). */
    lookX: number;
    lookY: number;
    /** Analogue move from a touch joystick, -1..1. */
    moveX: number;
    moveY: number;
    /** One-shot presses, cleared by the controller that consumes them. */
    pressed: Set<string>;
    /** Held pointer button (mining, or firing). */
    primary: boolean;
    /** Looking closer (held Z, or the touch button). */
    closer: boolean;
    pointerLocked: boolean;
}

export const createInput = (): ExpeditionInput => ({
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    moveX: 0,
    moveY: 0,
    pressed: new Set(),
    primary: false,
    closer: false,
    pointerLocked: false,
});

const GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'KeyM', 'KeyH', 'KeyR', 'KeyG', 'KeyT', 'KeyX', 'KeyZ', 'KeyU',
    'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/** Wires DOM events to `input`; returns a function that removes them. */
export const attachInput = (input: ExpeditionInput, element: HTMLElement) => {
    const onKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
        if (!GAME_KEYS.has(event.code)) return;
        event.preventDefault();
        if (!input.keys.has(event.code)) input.pressed.add(event.code);
        input.keys.add(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
        input.keys.delete(event.code);
    };
    const onBlur = () => {
        input.keys.clear();
        input.primary = false;
    };
    const onMouseMove = (event: MouseEvent) => {
        if (input.pointerLocked) {
            input.lookX += event.movementX;
            input.lookY += event.movementY;
        } else if (event.buttons & 2 || (event.buttons & 1 && event.target === element)) {
            input.lookX += event.movementX;
            input.lookY += event.movementY;
        }
    };
    const onMouseDown = (event: MouseEvent) => {
        if (event.target !== element) return;
        if (event.button === 0) {
            // Touch screens send a mouse press after a tap; there is no pointer to lock.
            const touch = (event as PointerEvent).pointerType === 'touch' || lookTouch !== null;
            if (!touch && !input.pointerLocked && element.requestPointerLock) {
                try {
                    const request = element.requestPointerLock() as unknown as Promise<void> | undefined;
                    request?.catch?.(() => undefined);
                } catch {
                    // Pointer lock is optional; dragging still steers.
                }
            }
            input.primary = true;
        }
    };
    const onMouseUp = (event: MouseEvent) => {
        if (event.button === 0) input.primary = false;
    };
    const onPointerLockChange = () => {
        input.pointerLocked = document.pointerLockElement === element;
    };
    const onContextMenu = (event: MouseEvent) => {
        if (event.target === element) event.preventDefault();
    };
    // Touch: dragging on the view looks around (on foot) or steers (in the ship).
    let lookTouch: number | null = null;
    let touchX = 0;
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => {
        if (lookTouch !== null) return;
        const touch = event.changedTouches[0];
        lookTouch = touch.identifier;
        touchX = touch.clientX;
        touchY = touch.clientY;
    };
    const onTouchMove = (event: TouchEvent) => {
        for (const touch of Array.from(event.changedTouches)) {
            if (touch.identifier !== lookTouch) continue;
            input.lookX += (touch.clientX - touchX) * 1.5;
            input.lookY += (touch.clientY - touchY) * 1.5;
            touchX = touch.clientX;
            touchY = touch.clientY;
            event.preventDefault();
        }
    };
    const onTouchEnd = (event: TouchEvent) => {
        for (const touch of Array.from(event.changedTouches)) {
            if (touch.identifier === lookTouch) lookTouch = null;
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    element.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    element.addEventListener('contextmenu', onContextMenu);
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    return () => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', onTouchEnd);
        element.removeEventListener('touchcancel', onTouchEnd);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('mousemove', onMouseMove);
        element.removeEventListener('mousedown', onMouseDown);
        window.removeEventListener('mouseup', onMouseUp);
        element.removeEventListener('contextmenu', onContextMenu);
        document.removeEventListener('pointerlockchange', onPointerLockChange);
        if (document.pointerLockElement === element) document.exitPointerLock();
    };
};

export const axis = (input: ExpeditionInput, negative: string[], positive: string[]) =>
    (positive.some((k) => input.keys.has(k)) ? 1 : 0) - (negative.some((k) => input.keys.has(k)) ? 1 : 0);

export const consume = (input: ExpeditionInput, code: string) => {
    if (!input.pressed.has(code)) return false;
    input.pressed.delete(code);
    return true;
};
