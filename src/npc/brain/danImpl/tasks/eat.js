/**
 * Eat task — consume food from inventory when hungry.
 */
import { eatAction } from '../../../../domain/entityActions.js';
import { isEdible } from '../../../../domain/vitality.js';
import { Obj } from '../../../../world/tileTypes.js';

/** @typedef {import('../../../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/** Eat when hunger reaches this threshold (0 = full, 100 = starving). */
export const HUNGER_EAT_THRESHOLD = 60;

/** Prefer higher-nutrition / prepared food first. */
const EAT_FOOD_PRIORITY = [Obj.BREAD, Obj.STEAK, Obj.WHEAT];

/**
 * @param {NpcEntity} npc
 * @param {number} objType
 * @returns {number}
 */
function inventoryCount(npc, objType) {
    let count = 0;
    for (const stack of npc.inventory ?? []) {
        if (stack.objType === objType) count += stack.count;
    }
    return count;
}

/**
 * @param {NpcEntity} npc
 * @returns {number | null}
 */
export function pickEdibleFood(npc) {
    for (const objType of EAT_FOOD_PRIORITY) {
        if (inventoryCount(npc, objType) > 0 && isEdible(objType)) return objType;
    }
    return null;
}

/**
 * @param {NpcEntity} npc
 * @returns {boolean}
 */
export function shouldEat(npc) {
    return npc.hunger >= HUNGER_EAT_THRESHOLD && pickEdibleFood(npc) !== null;
}

/**
 * @param {NpcEntity} npc
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* eatTask(npc) {
    const food = pickEdibleFood(npc);
    if (!food) {
        return { ok: false, message: 'No food to eat' };
    }

    const result = yield eatAction(npc, food);
    if (result && !result.ok) return result;
    return { ok: true };
}
