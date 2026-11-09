import { MAP_WIDTH } from './mapLoader';

/**
 * How large a picture the graphics card is asked to hold, per detail level (Low, Medium, High). Measured 9 Nov:
 * the models' pictures are mostly 2048 x 2048 (21 MB each with their mipmaps); Haven alone sent 313 MB of them up
 * before the ship had moved, and a page that grows to a few GB is reloaded by the Claude app. A model's picture
 * is shrunk once as it loads, so a quarter of the memory at Low, and the same look at the distances it is seen.
 */
export const MODEL_PICTURE = [1024, 2048, Infinity] as const;

export const detailBudget = {
    /** Widest picture inside a model (pixels). */
    modelPicture: Infinity as number,
    /** Widest map of a giant planet (pixels). */
    giantMap: Infinity as number,
};

/** Set as soon as the detail level is known; pictures loaded after this follow it. */
export const setDetailBudget = (quality: 0 | 1 | 2) => {
    detailBudget.modelPicture = MODEL_PICTURE[quality];
    detailBudget.giantMap = MAP_WIDTH[quality];
};
