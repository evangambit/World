/**
 * Travel toward rememberLocationsOfNearby refs — state on NpcTaskBrain only.
 */
import { moveToAction } from '../../../actors/npcActions.js';
import { applyHostAction, hostIsLocomotionActive, hostRemainingPathSteps } from '../../locomotion/brainLocomotionMixin.js';
import {
    findApproachTile,
    pathStepsFromNpc as countPathStepsFromNpc,
} from '../../locomotion/pathUtils.js';
import { findPath } from '../../../world/pathfinding.js';
import { World3D } from '../../../world/world.js';
import {
    isTileMemoryReachable,
    markTileReachable,
    markTileUnreachable,
} from '../../shared/npcMemory.js';
import { resolvePlanRefs } from './npcPlanRefs.js';

/** @typedef {{ x: number, y: number, z: number }} TileRef */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('./taskBrain.js').NpcTaskBrain} NpcTaskBrain */

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
 * @returns {NpcTaskBrain}
 */
function requireTaskBrain(npc) {
    const brain = /** @type {NpcTaskBrain | undefined} */ (npc.brain);
    if (!brain?.tasks) {
        throw new Error('memory travel requires NpcTaskBrain');
    }
    return brain;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {number}
 */
export function pathStepsFromNpc(npc, world, tx, ty, tz) {
    return countPathStepsFromNpc(world, npc, tx, ty, tz);
}

/**
 * @param {NpcEntity} npc
 * @returns {number}
 */
export function remainingPathSteps(npc) {
    return hostRemainingPathSteps(requireTaskBrain(npc));
}

/**
 * @param {World3D} world
 * @param {NpcEntity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {TileRef | null}
 */
export function resolveTravelDestinationForMemory(world, npc, tx, ty, tz) {
    if (world.isWalkable(tx, ty, tz)) {
        return { x: tx, y: ty, z: tz };
    }
    return findApproachTile(world, npc, { x: tx, y: ty, z: tz });
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {string} ref
 * @param {Set<string>} [excludeKeys]
 */
export function findBestReachableMemoryRefTarget(npc, world, ref, excludeKeys = new Set()) {
    const candidates = resolvePlanRefs(npc, world, ref);
    /** @type {{ x: number, y: number, z: number, key: string, pathSteps: number }|null} */
    let best = null;

    for (const target of candidates) {
        const key = World3D.key(target.x, target.y, target.z);
        if (excludeKeys.has(key)) continue;
        if (!isTileMemoryReachable(npc, target.x, target.y, target.z)) continue;

        const travel = resolveTravelDestinationForMemory(
            world,
            npc,
            target.x,
            target.y,
            target.z,
        );
        if (!travel) {
            markTileUnreachable(npc, target.x, target.y, target.z);
            continue;
        }

        const steps = countPathStepsFromNpc(world, npc, travel.x, travel.y, travel.z);
        if (!Number.isFinite(steps)) {
            markTileUnreachable(npc, target.x, target.y, target.z);
            continue;
        }
        if (!best || steps < best.pathSteps) {
            best = { x: travel.x, y: travel.y, z: travel.z, key, pathSteps: steps };
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
        if (npc.z !== target.z) continue;
        if (px === target.x && py === target.y) return true;
        if (Math.max(Math.abs(px - target.x), Math.abs(py - target.y)) > 1) continue;
        if (!world.isWalkable(target.x, target.y, target.z)) return true;
    }
    return false;
}

/**
 * @param {NpcEntity} npc
 */
export function clearMemoryRefTravel(npc) {
    requireTaskBrain(npc)._memoryRefTravel = null;
}

/**
 * @param {NpcEntity} npc
 */
function finishMemoryRefTravel(npc) {
    const brain = requireTaskBrain(npc);
    const travel = brain._memoryRefTravel;
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
 * @param {string} memoryKey
 * @returns {boolean}
 */
function applyMemoryRefGoal(npc, target, memoryKey) {
    const brain = requireTaskBrain(npc);
    const travel = brain._memoryRefTravel;
    if (!travel) return false;

    if (isAtAnyMemoryRefTarget(npc, travel.world, travel.ref)) {
        finishMemoryRefTravel(npc);
        return true;
    }

    const action = moveToAction(npc, target.x, target.y, target.z, { onto: true });
    if (!applyHostAction(brain, npc, action, travel.world)) {
        const parts = memoryKey.split(',').map(Number);
        markTileUnreachable(npc, parts[0], parts[1], parts[2]);
        return false;
    }

    if (!brain._trip) {
        brain._trip = {
            x: target.x,
            y: target.y,
            z: target.z,
            onto: true,
            resolve: () => finishMemoryRefTravel(npc),
            reject: (err) => {
                const trip = brain._memoryRefTravel;
                clearMemoryRefTravel(npc);
                if (trip) trip.reject(err);
            },
        };
    } else {
        brain._trip.x = target.x;
        brain._trip.y = target.y;
        brain._trip.z = target.z;
        brain._trip.onto = true;
    }
    return true;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 */
export function syncMemoryRefTravelGoal(npc, world) {
    const brain = requireTaskBrain(npc);
    const travel = brain._memoryRefTravel;
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
    if (hostIsLocomotionActive(brain) && travel.goalKey) {
        costToCurrent = remainingPathSteps(npc);
    } else if (travel.goalKey) {
        const parts = travel.goalKey.split(',').map(Number);
        const currentDest = resolveTravelDestinationForMemory(
            activeWorld,
            npc,
            parts[0],
            parts[1],
            parts[2],
        );
        costToCurrent = currentDest
            ? countPathStepsFromNpc(activeWorld, npc, currentDest.x, currentDest.y, currentDest.z)
            : Infinity;
    }

    if (best.pathSteps >= costToCurrent) return;

    travel.goalKey = best.key;
    applyMemoryRefGoal(npc, best, best.key);
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
    const brain = requireTaskBrain(npc);
    if (brain._memoryRefTravel) {
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

        brain._memoryRefTravel = {
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

        if (!applyMemoryRefGoal(npc, best, best.key)) {
            const failedKey = best.key;
            clearMemoryRefTravel(npc);
            const err = new Error(
                `no path to remembered tile ${failedKey} (via ${best.x}, ${best.y}, ${best.z})`,
            );
            /** @type {Error & { failedKey?: string }} */ (err).failedKey = failedKey;
            reject(err);
        }
    });
}
