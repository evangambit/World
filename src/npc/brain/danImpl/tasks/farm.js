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
import { Obj, T, isStoveObject, isWheatCropObject } from '../../../../world/tileTypes.js';

/** @typedef {import('../danContext.js').DanContext} DanContext */
/** @typedef {import('../../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/** @typedef {'harvest' | 'cook' | 'plant'} FarmActionType */

/**
 * @typedef {Object} FarmTarget
 * @property {TileCoord} tileCoord
 * @property {TileCoord} walkTarget
 * @property {FarmActionType} actionType
 */

/** Cap loop iterations to prevent runaway hypo simulation. */
const MAX_FARM_STEPS = 20;

const CARDINAL_OFFSETS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

/**
 * @param {{ inventory?: { objType: number, count: number }[] }} entity
 * @param {number} objType
 * @returns {number}
 */
function inventoryCount(entity, objType) {
    let count = 0;
    for (const stack of entity.inventory ?? []) {
        if (stack.objType === objType) count += stack.count;
    }
    return count;
}

/**
 * @param {{ x: number, y: number, z: number }} entity
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {number}
 */
function chebyshevDistFromNpc(entity, tx, ty, tz) {
    if (tz !== entity.z) return Infinity;
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
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
 * Scan the hypothetical world and return the highest-scoring farming
 * opportunity, or null.
 *
 * @param {{ x: number, y: number, z: number, inventory?: { objType: number, count: number }[] }} entity
 * @param {HypotheticalWorld} hypoWorld
 * @param {number} gameTime
 * @returns {FarmTarget | null}
 */
export function chooseBestFarmTarget(entity, hypoWorld, gameTime) {
    const pz = entity.z;

    const wheatCount = inventoryCount(entity, Obj.WHEAT);
    const seedCount = inventoryCount(entity, Obj.WHEAT_SEED);

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
        const dist = chebyshevDistFromNpc(entity, walkTarget.x, walkTarget.y, walkTarget.z);
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

    hypoWorld.forEachTile((key, tile, reachable) => {
        if (reachable === false) return;

        const parts = key.split(',');
        const tx = Number(parts[0]);
        const ty = Number(parts[1]);
        const tz = Number(parts[2]);
        if (tz !== pz) return;

        if (isWheatCropObject(tile.obj) && isWheatMature(tile, gameTime)) {
            const neighbor = findWalkableNeighbor(hypoWorld, tx, ty, tz);
            if (neighbor) consider(tx, ty, tz, 3, 'harvest', neighbor);
            return;
        }

        if (isStoveObject(tile.obj) && wheatCount > 0) {
            const neighbor = findWalkableNeighbor(hypoWorld, tx, ty, tz);
            if (neighbor) consider(tx, ty, tz, 2, 'cook', neighbor);
            return;
        }

        if (seedCount > 0 && !tile.obj && tile.terrain === T.DIRT && hypoWorld.isWalkable(tx, ty, tz)) {
            consider(tx, ty, tz, 1, 'plant', { x: tx, y: ty, z: tz });
        }
    });

    return best;
}

/**
 * @param {{ x: number, y: number, z: number }} entity
 * @param {FarmTarget} target
 * @param {number} gameTime
 * @returns {EntityAction}
 */
function actionForTarget(entity, target, gameTime) {
    const { x, y, z } = target.tileCoord;
    switch (target.actionType) {
        case 'harvest':
            return harvestWheatAction(entity, x, y, gameTime, z);
        case 'cook':
            return cookBreadAtStoveAction(entity, x, y);
        case 'plant':
            return plantWheatSeedAction(entity, x, y, gameTime, z);
    }
}

/**
 * @param {DanContext} ctx
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* farmTask(ctx) {
    for (let step = 0; step < MAX_FARM_STEPS; step++) {
        const target = chooseBestFarmTarget(ctx.entity, ctx.world, ctx.gameTime);
        if (!target) {
            return { ok: true };
        }

        const walkResult = yield* ctx.walkTo(target.walkTarget);
        if (!walkResult.ok) return walkResult;

        const actionResult = yield* ctx.applyAction(
            actionForTarget(ctx.entity, target, ctx.gameTime),
        );
        if (!actionResult.ok) return actionResult;
    }

    return { ok: true };
}
