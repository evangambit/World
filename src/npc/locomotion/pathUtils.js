/**
 * Pure pathfinding helpers — no entity or brain state.
 */
import { isAdjacentToTile } from '../../domain/entityActions.js';
import { findPath } from '../../world/pathfinding.js';

/** @typedef {{ x: number, y: number, z: number }} TileCoord */
/** @typedef {import('../../actors/entity.js').Entity} Entity */
/** @typedef {import('../../world/world.js').World3D} World3D */

/**
 * @typedef {Object} MoveGoal
 * @property {number} tx
 * @property {number} ty
 * @property {number} tz
 * @property {boolean} onto
 */

/**
 * @param {Entity} npc
 * @param {MoveGoal} goal
 * @returns {boolean}
 */
export function isAtMoveGoal(npc, goal) {
    if (goal.onto) {
        return Math.floor(npc.x) === goal.tx && Math.floor(npc.y) === goal.ty && npc.z === goal.tz;
    }
    return isAdjacentToTile(npc, goal.tx, goal.ty) && npc.z === goal.tz;
}

/**
 * @param {World3D} world
 * @param {Entity} npc
 * @param {TileCoord} target
 * @returns {TileCoord|null}
 */
export function findApproachTile(world, npc, target) {
    const sx = Math.floor(npc.x);
    const sy = Math.floor(npc.y);
    const sz = npc.z;
    const candidates = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const ax = target.x + dx;
            const ay = target.y + dy;
            if (!world.isWalkable(ax, ay, target.z)) continue;
            if (!findPath(world, sx, sy, sz, ax, ay, target.z)) continue;
            if (Math.max(Math.abs(ax - target.x), Math.abs(ay - target.y)) > 1) continue;
            candidates.push({ x: ax, y: ay, z: target.z });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        const da = Math.abs(a.x - sx) + Math.abs(a.y - sy);
        const db = Math.abs(b.x - sx) + Math.abs(b.y - sy);
        return da - db;
    });
    return candidates[0];
}

/**
 * @param {World3D} world
 * @param {Entity} npc
 * @param {number} gx
 * @param {number} gy
 * @param {number} gz
 * @returns {{ x: number, y: number, z: number }[] | null}
 */
export function planPathToTile(world, npc, gx, gy, gz) {
    const sx = Math.floor(npc.x);
    const sy = Math.floor(npc.y);
    return findPath(world, sx, sy, npc.z, gx, gy, gz);
}

/**
 * @param {World3D} world
 * @param {Entity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {number}
 */
export function pathStepsFromNpc(world, npc, tx, ty, tz) {
    const path = planPathToTile(world, npc, tx, ty, tz);
    if (!path || path.length === 0) return Infinity;
    return Math.max(0, path.length - 1);
}

/**
 * @param {World3D} world
 * @param {Entity} npc
 * @param {MoveGoal} goal
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function resolveMoveDestination(world, npc, goal) {
    if (goal.onto) {
        return { x: goal.tx, y: goal.ty, z: goal.tz };
    }
    return findApproachTile(world, npc, { x: goal.tx, y: goal.ty, z: goal.tz });
}
