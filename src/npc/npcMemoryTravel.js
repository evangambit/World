/**
 * Travel toward rememberLocationsOfNearby refs — picks the best reachable
 * target and retargets when memory or path cost improves mid-trip.
 */
import { findPath } from '../world/pathfinding.js';
import { World3D } from '../world/world.js';
import { setNpcGoal } from '../actors/npcLocomotion.js';
import {
    isTileMemoryReachable,
    markTileReachable,
    markTileUnreachable,
} from './npcMemory.js';
import { resolvePlanRefs } from './npcPlanRefs.js';

/** @typedef {{ x: number, y: number, z: number }} TileRef */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @typedef {Object} MemoryRefTravelState
 * @property {string} ref
 * @property {World3D} world
 * @property {string|null} goalKey
 * @property {Set<string>} tried
 * @property {() => void} resolve
 * @property {(err: Error) => void} reject
 */

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {number}
 */
export function pathStepsFromNpc(npc, world, tx, ty, tz) {
    const sx = Math.floor(npc.x);
    const sy = Math.floor(npc.y);
    const path = findPath(world, sx, sy, npc.z, tx, ty, tz);
    if (!path || path.length === 0) return Infinity;
    return Math.max(0, path.length - 1);
}

/**
 * @param {NpcEntity} npc
 * @returns {number}
 */
export function remainingPathSteps(npc) {
    if (!npc.path || npc.pathIndex >= npc.path.length) return 0;
    return npc.path.length - npc.pathIndex;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {string} ref
 * @param {Set<string>} [excludeKeys]
 * @returns {({ x: number, y: number, z: number, key: string, pathSteps: number }|null)}
 */
export function findBestReachableMemoryRefTarget(npc, world, ref, excludeKeys = new Set()) {
    const candidates = resolvePlanRefs(npc, world, ref);
    /** @type {{ x: number, y: number, z: number, key: string, pathSteps: number }|null} */
    let best = null;

    for (const target of candidates) {
        const key = World3D.key(target.x, target.y, target.z);
        if (excludeKeys.has(key)) continue;
        if (!isTileMemoryReachable(npc, target.x, target.y, target.z)) continue;

        const pathSteps = pathStepsFromNpc(npc, world, target.x, target.y, target.z);
        if (!Number.isFinite(pathSteps)) {
            markTileUnreachable(npc, target.x, target.y, target.z);
            continue;
        }
        if (!best || pathSteps < best.pathSteps) {
            best = { ...target, key, pathSteps };
        }
    }

    return best;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {string} ref
 * @returns {boolean}
 */
function isAtAnyMemoryRefTarget(npc, world, ref) {
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    for (const target of resolvePlanRefs(npc, world, ref)) {
        if (px === target.x && py === target.y && npc.z === target.z) {
            return true;
        }
    }
    return false;
}

/**
 * @param {NpcEntity} npc
 */
export function clearMemoryRefTravel(npc) {
    npc._memoryRefTravel = null;
}

/**
 * @param {NpcEntity} npc
 */
function finishMemoryRefTravel(npc) {
    const travel = npc._memoryRefTravel;
    if (!travel) return;
    if (travel.goalKey) {
        const parts = travel.goalKey.split(',').map(Number);
        markTileReachable(npc, parts[0], parts[1], parts[2]);
    }
    clearMemoryRefTravel(npc);
    travel.resolve();
}

/**
 * @param {NpcEntity} npc
 * @param {{ x: number, y: number, z: number }} target
 * @returns {boolean}
 */
function applyMemoryRefGoal(npc, target) {
    if (!setNpcGoal(npc, target.x, target.y, target.z, npc._memoryRefTravel.world)) {
        markTileUnreachable(npc, target.x, target.y, target.z);
        return false;
    }

    const travel = npc._memoryRefTravel;
    if (npc._state === 'idle' && isAtAnyMemoryRefTarget(npc, travel.world, travel.ref)) {
        finishMemoryRefTravel(npc);
        return true;
    }

    if (!npc._trip) {
        npc._trip = {
            x: target.x,
            y: target.y,
            z: target.z,
            resolve: () => finishMemoryRefTravel(npc),
            reject: (err) => {
                const trip = npc._memoryRefTravel;
                clearMemoryRefTravel(npc);
                if (trip) trip.reject(err);
            },
        };
    } else {
        npc._trip.x = target.x;
        npc._trip.y = target.y;
        npc._trip.z = target.z;
    }
    return true;
}

/**
 * After locomotion and perception — retarget if a strictly closer reachable match exists.
 * @param {NpcEntity} npc
 * @param {World3D} world
 */
export function syncMemoryRefTravelGoal(npc, world) {
    const travel = /** @type {MemoryRefTravelState|undefined} */ (npc._memoryRefTravel);
    if (!travel || npc._dead) return;

    const activeWorld = travel.world ?? world;

    if (isAtAnyMemoryRefTarget(npc, activeWorld, travel.ref)) {
        markTileReachable(npc, Math.floor(npc.x), Math.floor(npc.y), npc.z);
        finishMemoryRefTravel(npc);
        return;
    }

    const best = findBestReachableMemoryRefTarget(npc, activeWorld, travel.ref, travel.tried);
    if (!best) return;

    if (best.key === travel.goalKey) return;

    let costToCurrent = Infinity;
    if (npc._state === 'walking' && travel.goalKey) {
        costToCurrent = remainingPathSteps(npc);
    } else if (travel.goalKey) {
        const parts = travel.goalKey.split(',').map(Number);
        costToCurrent = pathStepsFromNpc(npc, activeWorld, parts[0], parts[1], parts[2]);
    }

    if (best.pathSteps >= costToCurrent) return;

    travel.goalKey = best.key;
    applyMemoryRefGoal(npc, best);
}

/**
 * @param {NpcEntity} npc
 * @param {string} ref
 * @param {World3D} world
 * @param {{ excludeKeys?: Set<string> }} [opts]
 * @returns {Promise<void>}
 */
export function travelNpcToMemoryRef(npc, ref, world, opts = {}) {
    if (npc._dead) {
        return Promise.reject(new Error('dead'));
    }
    if (npc._memoryRefTravel) {
        return Promise.reject(new Error('memory travel already active'));
    }
    if (npc.timedAction?.isBusy?.()) {
        npc.timedAction.cancel();
    }

    const tried = opts.excludeKeys ?? new Set();

    return new Promise((resolve, reject) => {
        if (isAtAnyMemoryRefTarget(npc, world, ref)) {
            resolve();
            return;
        }

        const best = findBestReachableMemoryRefTarget(npc, world, ref, tried);
        if (!best) {
            reject(new Error(`no reachable remembered target for ${ref}`));
            return;
        }

        npc._memoryRefTravel = {
            ref,
            world,
            goalKey: best.key,
            tried,
            resolve,
            reject: (err) => {
                clearMemoryRefTravel(npc);
                reject(err);
            },
        };

        if (!applyMemoryRefGoal(npc, best)) {
            const failedKey = best.key;
            clearMemoryRefTravel(npc);
            const err = new Error(`no path to (${best.x}, ${best.y}, ${best.z})`);
            /** @type {Error & { failedKey?: string }} */ (err).failedKey = failedKey;
            reject(err);
        }
    });
}
