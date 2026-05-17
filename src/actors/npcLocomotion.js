/**
 * NPC pathfinding and path following (no task/plan AI).
 */
import { DIR } from './entity.js';
import { findPath } from '../world/pathfinding.js';

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
 * @param {Entity & NpcLocomotionState} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {World3D} world
 * @returns {Promise<void>}
 */
export function travelNpcToTile(npc, tx, ty, tz, world) {
    if (npc._dead) {
        return Promise.reject(new Error('dead'));
    }
    if (npc.timedAction.isBusy()) {
        npc.timedAction.cancel();
    }
    if (npc._trip) {
        npc._trip.reject(new Error('travel superseded'));
        npc._trip = null;
    }

    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    if (px === tx && py === ty && npc.z === tz) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        if (!setNpcGoal(npc, tx, ty, tz, world)) {
            reject(new Error(`no path to (${tx}, ${ty}, ${tz})`));
            return;
        }
        if (npc._state === 'idle' && px === tx && py === ty && npc.z === tz) {
            resolve();
            return;
        }
        npc._trip = { x: tx, y: ty, z: tz, resolve, reject };
    });
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
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    const { x, y, z, resolve } = npc._trip;
    if (px === x && py === y && npc.z === z) {
        npc._trip = null;
        resolve();
    }
}

/**
 * @typedef {Object} NpcLocomotionState
 * @property {Array<{x:number,y:number,z:number}>|null} path
 * @property {number} pathIndex
 * @property {'idle'|'walking'} _state
 * @property {{ x: number, y: number, z: number, resolve: () => void, reject: (err: Error) => void }|null} _trip
 * @property {boolean} _dead
 */
