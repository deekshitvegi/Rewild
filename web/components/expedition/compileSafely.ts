import type * as THREE from 'three';

/**
 * three's compileAsync, made safe. It compiles what `object` draws (as compile() does), then waits for
 * the driver to finish each program off the main thread. three's own version asks every material's
 * program whether it is ready on a timer; a material thrown away meanwhile (a world's props rebuilt
 * when a model arrives) has no program any more, the question throws inside the timer, and the promise
 * never settles: whatever waits on it waits for ever (a loading screen, a black hole that never shows).
 * Here a material that is gone counts as done, and after `limit` milliseconds the wait ends regardless.
 */
export const compileSafely = (gl: THREE.WebGLRenderer, object: THREE.Object3D, camera: THREE.Camera, target: THREE.Scene | null = null, limit = 20000): Promise<void> => {
    let materials: Set<THREE.Material>;
    try {
        materials = gl.compile(object, camera, target) as unknown as Set<THREE.Material>;
    } catch {
        return Promise.resolve();
    }
    const started = performance.now();
    return new Promise((resolve) => {
        const check = () => {
            materials.forEach((material) => {
                const program = (gl.properties.get(material) as { currentProgram?: { isReady?: () => boolean } } | undefined)?.currentProgram;
                try {
                    if (!program || !program.isReady || program.isReady()) materials.delete(material);
                } catch {
                    materials.delete(material);
                }
            });
            if (materials.size === 0 || performance.now() - started > limit) resolve();
            else window.setTimeout(check, 10);
        };
        window.setTimeout(check, 10);
    });
};
