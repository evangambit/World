/**
 * Inventory cooking — uncooked steak → steak, wheat → bread at a stove.
 */
import { Obj } from '../world/tileTypes.js';

/**
 * @param {{ objType: number, count: number, buildingId?: number }[]} inventory
 * @returns {boolean}
 */
export function cookUncookedSteakInInventory(inventory) {
    const stack = inventory.find((e) => e.objType === Obj.UNCOOKED_STEAK && e.count > 0);
    if (!stack) return false;

    stack.count -= 1;
    if (stack.count <= 0) {
        const idx = inventory.indexOf(stack);
        if (idx >= 0) inventory.splice(idx, 1);
    }

    const cooked = inventory.find((e) => e.objType === Obj.STEAK);
    if (cooked) cooked.count += 1;
    else inventory.push({ objType: Obj.STEAK, count: 1 });
    return true;
}

/**
 * @param {{ objType: number, count: number }[]} inventory
 * @returns {boolean}
 */
export function inventoryHasUncookedSteak(inventory) {
    return inventory.some((e) => e.objType === Obj.UNCOOKED_STEAK && e.count > 0);
}

/**
 * @param {{ objType: number, count: number, buildingId?: number }[]} inventory
 * @returns {boolean}
 */
export function cookWheatIntoBread(inventory) {
    const stack = inventory.find((e) => e.objType === Obj.WHEAT && e.count > 0);
    if (!stack) return false;

    stack.count -= 1;
    if (stack.count <= 0) {
        const idx = inventory.indexOf(stack);
        if (idx >= 0) inventory.splice(idx, 1);
    }

    const bread = inventory.find((e) => e.objType === Obj.BREAD);
    if (bread) bread.count += 1;
    else inventory.push({ objType: Obj.BREAD, count: 1 });
    return true;
}

/**
 * @param {{ objType: number, count: number }[]} inventory
 * @returns {boolean}
 */
export function inventoryHasWheat(inventory) {
    return inventory.some((e) => e.objType === Obj.WHEAT && e.count > 0);
}
