/**
 * Shared action execution for actor controllers (player + NPC simulation).
 * Keep this out of brain modules: brains should return actions, not execute them.
 */
import { actionDuration } from '../domain/entityActions.js';

/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * Run one entity action for a single simulation frame.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @param {number} dt
 * @returns {boolean}
 */
export function tickEntityAction(entity, action, world, dt) {
    if (entity.timedAction.isBusy()) {
        entity.timedAction.cancel();
    }

    entity.currentAction = action;
    const ok =
        typeof action.tick === 'function'
            ? action.tick(entity, world, dt)
            : (action.apply?.(world) ?? false);

    if (!ok) {
        entity.currentAction = null;
        return false;
    }

    if (actionDuration(action) === 0) {
        entity.currentAction = null;
    } else if (actionDuration(action) > 0 && !entity.timedAction.isBusy()) {
        entity.currentAction = null;
    }

    return true;
}

/**
 * Execute a one-shot action through the shared executor path.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {boolean}
 */
export function runEntityAction(entity, action, world) {
    return tickEntityAction(entity, action, world, 0);
}

