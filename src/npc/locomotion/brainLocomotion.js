/**
 * Path-follow state owned by a brain (not stored on Entity or EntityAction).
 */
import { DIR } from '../../actors/entity.js';
import { isAtMoveGoal, planPathToTile, resolveMoveDestination } from './pathUtils.js';

/** @typedef {import('./pathUtils.js').MoveGoal} MoveGoal */
/** @typedef {import('../../actors/entity.js').Entity} Entity */

/**
 * @typedef {Object} BrainLocomotionState
 * @property {{ x: number, y: number, z: number }[] | null} path
 * @property {number} pathIndex
 */

/**
 * @returns {BrainLocomotionState}
 */
export function createBrainLocomotion() {
    return { path: null, pathIndex: 0 };
}

/**
 * @param {BrainLocomotionState} loco
 */
export function clearBrainLocomotion(loco) {
    loco.path = null;
    loco.pathIndex = 0;
}

/**
 * @param {BrainLocomotionState} loco
 * @returns {boolean}
 */
export function isBrainLocomotionActive(loco) {
    return !!loco.path && loco.pathIndex < loco.path.length;
}

/**
 * @param {BrainLocomotionState} loco
 * @returns {number}
 */
export function remainingBrainLocomotionSteps(loco) {
    if (!loco.path || loco.pathIndex >= loco.path.length) return 0;
    return loco.path.length - loco.pathIndex;
}

/**
 * @param {BrainLocomotionState} loco
 * @param {Entity} npc
 * @param {MoveGoal} goal
 * @param {import('../../world/world.js').World3D} world
 * @returns {boolean}
 */
export function beginBrainMove(loco, npc, goal, world) {
    const dest = resolveMoveDestination(world, npc, goal);
    if (!dest) return false;

    const path = planPathToTile(world, npc, dest.x, dest.y, dest.z);
    if (!path || path.length === 0) return false;

    if (path.length === 1) {
        clearBrainLocomotion(loco);
        return true;
    }

    loco.path = path;
    loco.pathIndex = 1;
    return true;
}

/**
 * @param {BrainLocomotionState} loco
 * @param {Entity} npc
 * @param {number} dt
 * @returns {boolean} still moving
 */
export function advanceBrainLocomotion(loco, npc, dt) {
    if (!isBrainLocomotionActive(loco)) return false;

    const target = loco.path[loco.pathIndex];
    const tx = target.x + 0.5;
    const ty = target.y + 0.5;

    const ddx = tx - npc.x;
    const ddy = ty - npc.y;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);

    if (dist < 0.15) {
        npc.x = tx;
        npc.y = ty;
        if (target.z !== npc.z) {
            npc.z = target.z;
        }
        loco.pathIndex++;
        if (loco.pathIndex >= loco.path.length) {
            clearBrainLocomotion(loco);
            return false;
        }
        return true;
    }

    const nx = ddx / dist;
    const ny = ddy / dist;
    npc.x += nx * npc.speed * dt;
    npc.y += ny * npc.speed * dt;

    if (Math.abs(nx) > Math.abs(ny)) {
        npc.dir = nx > 0 ? DIR.RIGHT : DIR.LEFT;
    } else {
        npc.dir = ny > 0 ? DIR.DOWN : DIR.UP;
    }
    return true;
}

/**
 * @param {BrainLocomotionState} loco
 * @param {Entity} npc
 * @param {MoveGoal} goal
 * @returns {boolean}
 */
export function isBrainMoveComplete(loco, npc, goal) {
    return !isBrainLocomotionActive(loco) && isAtMoveGoal(npc, goal);
}
