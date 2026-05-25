/**
 * Immutable NPC EntityAction factories.
 */
import { isAtMoveGoal, resolveMoveDestination } from '../npc/locomotion/pathUtils.js';

/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../npc/locomotion/pathUtils.js').MoveGoal} MoveGoal */
/** @typedef {import('./entity.js').Entity} Entity */

/**
 * @param {EntityAction} action
 * @returns {action is EntityAction & { type: 'move', goal: MoveGoal }}
 */
export function isMoveAction(action) {
    return action.type === 'move';
}

/**
 * Immutable move intent — path state lives on the brain, not this object.
 * @param {Entity} entity
 * @param {number} tx
 * @param {number} ty
 * @param {number} [tz]
 * @param {{ onto?: boolean }} [opts]
 * @returns {EntityAction & { type: 'move', goal: MoveGoal }}
 */
export function moveToAction(entity, tx, ty, tz = entity.z, opts = {}) {
    const goal = Object.freeze({
        tx,
        ty,
        tz,
        onto: opts.onto === true,
    });

    return Object.freeze({
        type: 'move',
        duration: 0,
        goal,
        prereq: () =>
            goal.onto
                ? { tile: { x: tx, y: ty, z: tz } }
                : { adjacentTo: { x: tx, y: ty, z: tz } },
        isComplete: (e) => isAtMoveGoal(e, goal),
        apply: (world) => {
            if (isAtMoveGoal(entity, goal)) return true;
            return resolveMoveDestination(world, entity, goal) != null;
        },
    });
}
