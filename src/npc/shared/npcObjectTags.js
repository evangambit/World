/**
 * Plan object tags — abstract names used in plans map to world / inventory types.
 */
import { Obj } from '../../world/tileTypes.js';

/** @typedef {{ inventoryTypes: number[], worldTypes: number[] }} ObjectTagSpec */

/** @type {Record<string, ObjectTagSpec>} */
export const OBJECT_TAGS = {
    edible_food: {
        inventoryTypes: [Obj.STEAK, Obj.FLOWER, Obj.WHEAT, Obj.BREAD],
        worldTypes: [Obj.FLOWER],
    },
    uncooked_food: {
        inventoryTypes: [Obj.UNCOOKED_STEAK],
        worldTypes: [Obj.UNCOOKED_STEAK],
    },
    stove: {
        inventoryTypes: [],
        worldTypes: [Obj.STOVE],
    },
    chest: {
        inventoryTypes: [],
        worldTypes: [Obj.CHEST],
    },
};

/**
 * @param {string} tag
 * @returns {ObjectTagSpec}
 */
export function getObjectTagSpec(tag) {
    const spec = OBJECT_TAGS[tag];
    if (!spec) throw new Error(`Unknown object tag: ${tag}`);
    return spec;
}
