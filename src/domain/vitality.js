/**
 * Hunger and health — shared by player and NPCs.
 */
import { Obj } from '../world/tileTypes.js';

export const VITALITY = {
    MAX_HUNGER: 100,
    MAX_HEALTH: 100,
    /** Hunger gained per second (0 → 100 over ~2 minutes). */
    HUNGER_PER_SECOND: 0.85,
    /** Health lost per second while hunger is at max. */
    STARVE_DAMAGE_PER_SECOND: 4,
};

/** @type {Record<number, number>} hunger reduced per item eaten */
const FOOD_NUTRITION = {
    [Obj.STEAK]: 40,
    [Obj.FLOWER]: 10,
    [Obj.WHEAT]: 15,
};

/** @typedef {import('../actors/entity.js').Entity} Entity */

/**
 * @param {Entity} entity
 * @returns {boolean}
 */
export function isAlive(entity) {
    return entity.health > 0;
}

/**
 * @param {number} objType
 * @returns {boolean}
 */
export function isEdible(objType) {
    return (FOOD_NUTRITION[objType] ?? 0) > 0;
}

/**
 * @param {number} objType
 * @returns {number}
 */
export function getFoodNutrition(objType) {
    return FOOD_NUTRITION[objType] ?? 0;
}

/**
 * @param {Entity} entity
 * @param {number} dt
 */
export function tickVitality(entity, dt) {
    if (entity.health <= 0) return;

    entity.hunger = Math.min(
        VITALITY.MAX_HUNGER,
        entity.hunger + VITALITY.HUNGER_PER_SECOND * dt,
    );

    if (entity.hunger >= VITALITY.MAX_HUNGER) {
        entity.health = Math.max(
            0,
            entity.health - VITALITY.STARVE_DAMAGE_PER_SECOND * dt,
        );
    }
}

/**
 * @param {Entity} entity
 * @param {number} objType
 */
export function applyFood(entity, objType) {
    const nutrition = getFoodNutrition(objType);
    if (nutrition <= 0) return;
    entity.hunger = Math.max(0, entity.hunger - nutrition);
}

/**
 * Eat one item from inventory.
 * @param {Entity} entity
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {boolean}
 */
export function consumeFoodFromInventory(entity, objType, buildingId) {
    if (!isEdible(objType)) return false;

    const inv = entity.inventory ?? [];
    const i = inv.findIndex(
        (e) => e.objType === objType && (objType !== Obj.KEY || e.buildingId === buildingId),
    );
    if (i < 0) return false;

    const stack = inv[i];
    stack.count -= 1;
    if (stack.count <= 0) inv.splice(i, 1);

    applyFood(entity, objType);
    return true;
}

/**
 * @param {Entity} entity
 * @param {number} [hungerThreshold]
 * @returns {boolean}
 */
export function tryEatFromInventoryIfHungry(entity, hungerThreshold = 50) {
    if (!isAlive(entity)) return false;
    if (entity.hunger < hungerThreshold) return false;

    for (const stack of entity.inventory ?? []) {
        if (stack.count > 0 && isEdible(stack.objType)) {
            return consumeFoodFromInventory(entity, stack.objType, stack.buildingId);
        }
    }
    return false;
}
