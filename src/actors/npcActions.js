/**
 * Immutable NPC EntityAction factories.
 */
import { isAdjacentToTile, satisfiesTilePrereq } from '../domain/entityActions.js';
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
 * Step onto an adjacent tile (Chebyshev distance ≤ 1, same floor).
 * Path state for the single edge lives on the brain during the step.
 *
 * @param {Entity} entity
 * @param {number} tx
 * @param {number} ty
 * @param {number} [tz]
 * @returns {EntityAction & { type: 'move', goal: MoveGoal }}
 */
export function moveToAction(entity, tx, ty, tz = entity.z) {
    const goal = Object.freeze({ tx, ty, tz, step: true });
    const destTile = Object.freeze({ x: tx, y: ty, z: tz, walkable: true });

    return Object.freeze({
        type: 'move',
        duration: 0,
        goal,
        prereq: () => ({ tile: destTile }),
        isComplete: (e) => isAtMoveGoal(e, goal),
        apply: (world) => {
            if (isAtMoveGoal(entity, goal)) return true;
            if (entity.z !== tz) return false;
            if (!isAdjacentToTile(entity, tx, ty)) return false;
            return satisfiesTilePrereq(world, destTile);
        },
    });
}

/**
 * Travel to a tile anywhere reachable — may pathfind and use approach tiles.
 * @param {Entity} entity
 * @param {number} tx
 * @param {number} ty
 * @param {number} [tz]
 * @param {{ onto?: boolean }} [opts]
 * @returns {EntityAction & { type: 'move', goal: MoveGoal }}
 */
export function travelToTileAction(entity, tx, ty, tz = entity.z, opts = {}) {
    const goal = Object.freeze({
        tx,
        ty,
        tz,
        onto: opts.onto === true,
    });
    const destTile = Object.freeze({ x: tx, y: ty, z: tz, walkable: true });

    return Object.freeze({
        type: 'move',
        duration: 0,
        goal,
        prereq: () =>
            goal.onto
                ? { tile: destTile }
                : { adjacentTo: { x: tx, y: ty, z: tz } },
        isComplete: (e) => isAtMoveGoal(e, goal),
        apply: (world) => {
            if (isAtMoveGoal(entity, goal)) return true;
            if (goal.onto && !satisfiesTilePrereq(world, destTile)) return false;
            return resolveMoveDestination(world, entity, goal) != null;
        },
    });
}
