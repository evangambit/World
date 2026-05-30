/**
 * Farm task — desire-weighted harvest, plant, and cook loop.
 *
 * Targets are scored as weight / Chebyshev distance from the NPC. The task
 * walks to the best target, performs one action, and repeats until no
 * farming opportunities remain in memory.
 */
import {
    cookBreadAtStoveAction,
    harvestWheatAction,
    plantWheatSeedAction,
} from '../../../../domain/entityActions.js';
import { isWheatMature } from '../../../../domain/crops.js';
import { walkToLocation } from '../../shared/walkToLocation.js';
import { forEachNpcObservedTile } from '../../../shared/npcMemory.js';
import { Obj, T, isStoveObject, isWheatCropObject } from '../../../../world/tileTypes.js';

/** @typedef {import('../../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../../../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/** Stop baking when bread stock reaches this count. */
export const MAX_BREAD_STOCK = 5;

/** @typedef {'harvest' | 'cook' | 'plant'} FarmActionType */

/**
 * @typedef {Object} FarmTarget
 * @property {TileCoord} tileCoord
 * @property {TileCoord} walkTarget
 * @property {FarmActionType} actionType
 */

const CARDINAL_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @param {NpcEntity} npc
 * @param {number} objType
 * @returns {number}
 */
function inventoryCount(npc, objType) {
    let count = 0;
    for (const stack of npc.inventory ?? []) {
        if (stack.objType === objType) count += stack.count;
    }
    return count;
}

/**
 * @param {NpcEntity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {number}
 */
function chebyshevDistFromNpc(npc, tx, ty, tz) {
    if (tz !== npc.z) return Infinity;
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    return Math.max(Math.abs(px - tx), Math.abs(py - ty));
}

/**
 * @param {HypotheticalWorld} hypoWorld
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {TileCoord | null}
 */
function findWalkableNeighbor(hypoWorld, tx, ty, tz) {
    for (const [dx, dy] of CARDINAL_OFFSETS) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (hypoWorld.isWalkable(nx, ny, tz)) {
            return { x: nx, y: ny, z: tz };
        }
    }
    return null;
}

/**
 * Scan tile memory and return the highest-scoring farming opportunity, or null.
 *
 * @param {NpcEntity} npc
 * @param {HypotheticalWorld} hypoWorld
 * @param {number} gameTime
 * @returns {FarmTarget | null}
 */
export function chooseBestFarmTarget(npc, hypoWorld, gameTime) {
    const pz = npc.z;

    const wheatCount = inventoryCount(npc, Obj.WHEAT);
    const breadCount = inventoryCount(npc, Obj.BREAD);
    const seedCount = inventoryCount(npc, Obj.WHEAT_SEED);

    /** @type {FarmTarget | null} */
    let best = null;
    let bestScore = 0;

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} tz
     * @param {number} weight
     * @param {FarmActionType} actionType
     * @param {TileCoord} walkTarget
     */
    function consider(tx, ty, tz, weight, actionType, walkTarget) {
        const dist = chebyshevDistFromNpc(npc, walkTarget.x, walkTarget.y, walkTarget.z);
        if (!Number.isFinite(dist)) return;

        const score = weight / Math.max(dist, 1);
        if (score <= bestScore) return;

        bestScore = score;
        best = {
            tileCoord: { x: tx, y: ty, z: tz },
            walkTarget,
            actionType,
        };
    }

    forEachNpcObservedTile(npc, (key, entry) => {
        const parts = key.split(',');
        const tx = Number(parts[0]);
        const ty = Number(parts[1]);
        const tz = Number(parts[2]);
        if (tz !== pz) return;
        if (entry.reachable === false) return;

        const state = entry.state;

        if (isWheatCropObject(state.obj) && isWheatMature(state, gameTime)) {
            const neighbor = findWalkableNeighbor(hypoWorld, tx, ty, tz);
            if (neighbor) consider(tx, ty, tz, 3, 'harvest', neighbor);
            return;
        }

        if (isStoveObject(state.obj) && wheatCount > 0 && breadCount < MAX_BREAD_STOCK) {
            const neighbor = findWalkableNeighbor(hypoWorld, tx, ty, tz);
            if (neighbor) consider(tx, ty, tz, 2, 'cook', neighbor);
            return;
        }

        if (seedCount > 0 && !state.obj && state.terrain === T.DIRT && hypoWorld.isWalkable(tx, ty, tz)) {
            consider(tx, ty, tz, 1, 'plant', { x: tx, y: ty, z: tz });
        }
    });

    return best;
}

/**
 * @param {NpcEntity} npc
 * @param {FarmTarget} target
 * @param {number} gameTime
 * @returns {EntityAction}
 */
function actionForTarget(npc, target, gameTime) {
    const { x, y, z } = target.tileCoord;
    switch (target.actionType) {
        case 'harvest':
            return harvestWheatAction(npc, x, y, gameTime, z);
        case 'cook':
            return cookBreadAtStoveAction(npc, x, y);
        case 'plant':
            return plantWheatSeedAction(npc, x, y, gameTime, z);
    }
}

/**
 * @param {NpcEntity} npc
 * @param {() => HypotheticalWorld} getWorld
 * @param {() => number} getGameTime
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* farmTask(npc, getWorld, getGameTime) {
    while (true) {
        const target = chooseBestFarmTarget(npc, getWorld(), getGameTime());
        if (!target) {
            return { ok: true };
        }

        const walkResult = yield* walkToLocation(npc, getWorld(), target.walkTarget, {
            getWorld,
        });
        if (!walkResult.ok) return walkResult;

        const actionResult = yield actionForTarget(npc, target, getGameTime());
        if (actionResult && !actionResult.ok) return actionResult;
    }
}
