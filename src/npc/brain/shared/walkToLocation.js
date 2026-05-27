/**
 * Shared brain locomotion — tile-by-tile walks via entity actions.
 */
import { moveToTileAction } from '../../../domain/entityActions.js';
import { findPath } from '../../../world/pathfinding.js';

/** @typedef {import('../../../actors/entity.js').Entity} Entity */
/** @typedef {import('../../../world/world.js').World3D} World3D */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/**
 * Yield per-step move actions and return final walk result.
 * Resume with the previous tick's ActionExecutionResult after each yield.
 *
 * @param {Entity} entity
 * @param {World3D} world
 * @param {TileCoord} target
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* walkToLocation(entity, world, target) {
    const path = findPath(
        world,
        Math.floor(entity.x),
        Math.floor(entity.y),
        entity.z,
        target.x,
        target.y,
        target.z,
    );
    if (!path || path.length < 2) {
        return { ok: false, message: 'No path to target tile' };
    }

    for (const step of path.slice(1)) {
        const isAtStep =
            Math.floor(entity.x) === step.x && Math.floor(entity.y) === step.y && entity.z === step.z;
        if (isAtStep) continue;
        const result = yield moveToTileAction(entity, step.x, step.y, step.z);
        if (result && !result.ok) return result;
    }

    return { ok: true };
}
