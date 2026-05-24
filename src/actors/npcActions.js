/**
 * NPC EntityActions — movement and other sim-tick actions.
 */
import { findApproachTile, isAtMoveGoal, setNpcGoal } from './npcLocomotion.js';

/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * Pathfind toward a tile. Default goal is adjacent (adjacentTo prereq); pass `{ onto: true }` to stand on the tile.
 * @param {Entity} entity
 * @param {number} tx
 * @param {number} ty
 * @param {number} [tz]
 * @param {{ onto?: boolean }} [opts]
 * @returns {EntityAction}
 */
export function moveToAction(entity, tx, ty, tz = entity.z, opts = {}) {
    const onto = opts.onto === true;
    const isComplete = (e) => isAtMoveGoal(e, tx, ty, tz, onto);

    return {
        duration: 0,
        isComplete,
        prereq: () =>
            onto
                ? { tile: { x: tx, y: ty, z: tz } }
                : { adjacentTo: { x: tx, y: ty, z: tz } },
        apply: (world) => {
            if (isComplete(entity)) return true;

            if (onto) {
                return setNpcGoal(entity, tx, ty, tz, world);
            }

            const approach = findApproachTile(world, entity, { x: tx, y: ty, z: tz });
            if (!approach) return false;
            return setNpcGoal(entity, approach.x, approach.y, approach.z, world);
        },
    };
}
