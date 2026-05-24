/**
 * NPC pathfinding and path following (no task/plan AI).
 */
import { isAdjacentToTile } from '../domain/entityActions.js';
import { DIR } from './entity.js';
import { findPath } from '../world/pathfinding.js';

/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @param {Entity & NpcLocomotionState} npc
 */
export function initNpcLocomotion(npc) {
    npc.path = null;
    npc.pathIndex = 0;
    npc._state = 'idle';
    npc._trip = null;
}

/**
 * @param {Entity & NpcLocomotionState} npc
 */
export function clearNpcLocomotion(npc) {
    if (npc._trip) {
        npc._trip.reject(new Error('dead'));
        npc._trip = null;
    }
    if (npc._memoryRefTravel) {
        npc._memoryRefTravel.reject(new Error('dead'));
        npc._memoryRefTravel = null;
    }
    npc.path = null;
    npc.pathIndex = 0;
    npc._state = 'idle';
}

/**
 * @param {Entity & NpcLocomotionState} npc
 * @param {number} gx
 * @param {number} gy
 * @param {number} gz
 * @param {World3D} world
 * @returns {boolean}
 */
export function setNpcGoal(npc, gx, gy, gz, world) {
    const sx = Math.floor(npc.x);
    const sy = Math.floor(npc.y);
    const path = findPath(world, sx, sy, npc.z, gx, gy, gz);
    if (path && path.length > 1) {
        npc.path = path;
        npc.pathIndex = 1;
        npc._state = 'walking';
        return true;
    }
    if (path && path.length === 1) {
        npc.path = null;
        npc.pathIndex = 0;
        npc._state = 'idle';
        return true;
    }
    return false;
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
 * @param {Entity & NpcLocomotionState} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {boolean} onto
 * @returns {boolean}
 */
export function isAtMoveGoal(npc, tx, ty, tz, onto) {
    if (onto) {
        return Math.floor(npc.x) === tx && Math.floor(npc.y) === ty && npc.z === tz;
    }
    return isAdjacentToTile(npc, tx, ty) && npc.z === tz;
}

/**
 * @param {Entity & NpcLocomotionState} npc
 * @param {number} dt
 */
export function tickNpcLocomotion(npc, dt) {
    if (npc._state === 'idle') {
        return;
    }

    if (!npc.path || npc.pathIndex >= npc.path.length) {
        npc._state = 'idle';
        finishNpcTripIfAtGoal(npc);
        return;
    }

    const target = npc.path[npc.pathIndex];
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
        npc.pathIndex++;
        if (npc.pathIndex >= npc.path.length) {
            npc._state = 'idle';
            finishNpcTripIfAtGoal(npc);
        }
    } else {
        const nx = ddx / dist;
        const ny = ddy / dist;
        npc.x += nx * npc.speed * dt;
        npc.y += ny * npc.speed * dt;

        if (Math.abs(nx) > Math.abs(ny)) {
            npc.dir = nx > 0 ? DIR.RIGHT : DIR.LEFT;
        } else {
            npc.dir = ny > 0 ? DIR.DOWN : DIR.UP;
        }
    }
}

/**
 * @param {Entity & NpcLocomotionState} npc
 */
function finishNpcTripIfAtGoal(npc) {
    if (!npc._trip) return;
    const { x, y, z, onto, resolve } = npc._trip;
    if (isAtMoveGoal(npc, x, y, z, onto)) {
        npc._trip = null;
        resolve();
    }
}

/**
 * @typedef {Object} NpcTrip
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {boolean} onto
 * @property {() => void} resolve
 * @property {(err: Error) => void} reject
 */

/**
 * @typedef {Object} NpcLocomotionState
 * @property {Array<{x:number,y:number,z:number}>|null} path
 * @property {number} pathIndex
 * @property {'idle'|'walking'} _state
 * @property {NpcTrip|null} _trip
 * @property {boolean} _dead
 */
