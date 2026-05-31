/**
 * Eat task — consume food from inventory when hungry.
 */
import { eatAction } from '../../../../domain/entityActions.js';
import { isEdible } from '../../../../domain/vitality.js';
import { Obj } from '../../../../world/tileTypes.js';

/** @typedef {import('../danContext.js').DanContext} DanContext */
/** @typedef {import('../../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/** Eat when hunger reaches this threshold (0 = full, 100 = starving). */
export const HUNGER_EAT_THRESHOLD = 60;

/** Prefer higher-nutrition / prepared food first. */
const EAT_FOOD_PRIORITY = [Obj.BREAD, Obj.STEAK, Obj.WHEAT];

/**
 * @param {{ inventory?: { objType: number, count: number }[] }} entity
 * @param {number} objType
 * @returns {number}
 */
function inventoryCount(entity, objType) {
    let count = 0;
    for (const stack of entity.inventory ?? []) {
        if (stack.objType === objType) count += stack.count;
    }
    return count;
}

/**
 * @param {{ inventory?: { objType: number, count: number }[] }} entity
 * @returns {number | null}
 */
export function pickEdibleFood(entity) {
    for (const objType of EAT_FOOD_PRIORITY) {
        if (inventoryCount(entity, objType) > 0 && isEdible(objType)) return objType;
    }
    return null;
}

/**
 * @param {DanContext} ctx
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* eatTask(ctx) {
    const food = pickEdibleFood(ctx.entity);
    if (!food) {
        return { ok: false, message: 'No food to eat' };
    }

    const result = yield* ctx.applyAction(eatAction(ctx.entity, food));
    if (!result.ok) return result;
    return { ok: true };
}
