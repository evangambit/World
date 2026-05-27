/**
 * Shared action execution for actor controllers (player + NPC simulation).
 * Keep this out of brain modules: brains should return actions, not execute them.
 */
import { actionDuration } from '../domain/entityActions.js';
import { explainActionPrereq } from '../domain/entityActions.js';

/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/**
 * @param {boolean | { ok: boolean, message?: string }} outcome
 * @param {string} failMessage
 * @param {string} successMessage
 * @returns {ActionExecutionResult}
 */
function normalizeOutcome(outcome, failMessage, successMessage) {
    if (typeof outcome === 'boolean') {
        return outcome ? { ok: true } : { ok: false, message: failMessage };
    }
    return {
        ok: outcome.ok,
        message: outcome.message ?? (outcome.ok ? successMessage : failMessage),
    };
}

/**
 * Execute one entity action for a frame with reasoned outcome.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @param {number} dt
 * @returns {ActionExecutionResult}
 */
export function tickEntityActionResult(entity, action, world, dt) {
    const pre = explainActionPrereq(entity, world, action.prereq());
    if (!pre.ok) {
        entity.currentAction = null;
        return { ok: false, message: pre.message ?? 'Prerequisite failed' };
    }

    if (entity.timedAction.isBusy()) {
        entity.timedAction.cancel();
    }

    entity.currentAction = action;
    const raw =
        typeof action.tick === 'function'
            ? action.tick(entity, world, dt)
            : (action.apply?.(world) ?? false);
    const result = normalizeOutcome(raw, 'Action failed', 'Action succeeded');

    if (!result.ok) {
        entity.currentAction = null;
        return result;
    }

    if (actionDuration(action) === 0) {
        entity.currentAction = null;
    } else if (actionDuration(action) > 0 && !entity.timedAction.isBusy()) {
        entity.currentAction = null;
    }

    return result;
}

/**
 * Run one entity action for a single simulation frame.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @param {number} dt
 * @returns {boolean}
 */
export function tickEntityAction(entity, action, world, dt) {
    return tickEntityActionResult(entity, action, world, dt).ok;
}

/**
 * Execute a one-shot action through the shared executor path.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {boolean}
 */
export function runEntityAction(entity, action, world) {
    return tickEntityActionResult(entity, action, world, 0).ok;
}

/**
 * Execute a one-shot action and return an outcome message.
 * @param {Entity} entity
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {ActionExecutionResult}
 */
export function runEntityActionResult(entity, action, world) {
    return tickEntityActionResult(entity, action, world, 0);
}

