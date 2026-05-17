/**
 * Crop growth, planting, and harvest (wheat).
 */
import { mergeStackInto } from './entityActions.js';
import {
    Obj,
    WHEAT_CROP_STAGES,
    canPlaceAmbientPlantOnTerrain,
    isWheatCropObject,
} from '../world/tileTypes.js';

/** Seconds per growth stage (four stages → mature at 3 × duration). */
export const WHEAT_STAGE_SECONDS = 18;

/** @typedef {import('../actors/entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../world/world.js').TileData} TileData */

/**
 * @param {TileData} tile
 * @param {number} gameTime
 * @returns {number} stage 0–3
 */
export function wheatStageForTile(tile, gameTime) {
    const planted = tile.cropPlantedAt ?? gameTime;
    const elapsed = Math.max(0, gameTime - planted);
    return Math.min(WHEAT_CROP_STAGES - 1, Math.floor(elapsed / WHEAT_STAGE_SECONDS));
}

/**
 * @param {TileData} tile
 * @param {number} gameTime
 * @returns {boolean}
 */
export function isWheatMature(tile, gameTime) {
    return isWheatCropObject(tile.obj) && wheatStageForTile(tile, gameTime) === WHEAT_CROP_STAGES - 1;
}

/**
 * Advance crop stages from elapsed time.
 * @param {World3D} world
 * @param {number} gameTime
 */
export function updateCrops(world, gameTime) {
    for (const tile of world.tiles.values()) {
        if (!isWheatCropObject(tile.obj)) continue;
        const stage = wheatStageForTile(tile, gameTime);
        if (tile.cropStage !== stage) tile.cropStage = stage;
    }
}

/**
 * @param {World3D} world
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {boolean}
 */
export function canPlantWheatAt(world, tx, ty, tz) {
    const tile = world.getTile(tx, ty, tz);
    if (!tile || tile.obj) return false;
    return canPlaceAmbientPlantOnTerrain(tile.terrain);
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} gameTime
 * @param {number} [tileZ]
 * @returns {{ ok: boolean, message: string }}
 */
export function plantWheatSeedAtTile(entity, world, tileX, tileY, gameTime, tileZ = entity.z) {
    if (tileZ !== entity.z) return { ok: false, message: 'Wrong floor' };

    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    if (Math.max(Math.abs(px - tileX), Math.abs(py - tileY)) > 1) {
        return { ok: false, message: 'Too far to plant' };
    }

    if (!canPlantWheatAt(world, tileX, tileY, tileZ)) {
        return { ok: false, message: 'Cannot plant here' };
    }

    const inv = entity.inventory ?? [];
    const i = inv.findIndex((e) => e.objType === Obj.WHEAT_SEED && e.count > 0);
    if (i < 0) return { ok: false, message: 'You need wheat seeds' };

    inv[i].count -= 1;
    if (inv[i].count <= 0) inv.splice(i, 1);

    world.setTile(tileX, tileY, tileZ, {
        obj: Obj.WHEAT_CROP,
        cropStage: 0,
        cropPlantedAt: gameTime,
    });

    return { ok: true, message: 'Planted wheat' };
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} gameTime
 * @param {number} [tileZ]
 * @returns {{ ok: boolean, message: string }}
 */
export function harvestWheatAtTile(entity, world, tileX, tileY, gameTime, tileZ = entity.z) {
    if (tileZ !== entity.z) return { ok: false, message: 'Wrong floor' };

    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    if (Math.max(Math.abs(px - tileX), Math.abs(py - tileY)) > 1) {
        return { ok: false, message: 'Too far to harvest' };
    }

    const tile = world.getTile(tileX, tileY, tileZ);
    if (!tile || !isWheatCropObject(tile.obj)) {
        return { ok: false, message: 'Nothing to harvest' };
    }

    if (!isWheatMature(tile, gameTime)) {
        return { ok: false, message: 'Wheat is not ready yet' };
    }

    world.setTile(tileX, tileY, tileZ, {
        obj: 0,
        cropStage: undefined,
        cropPlantedAt: undefined,
    });

    if (!entity.inventory) entity.inventory = [];
    mergeStackInto(entity.inventory, Obj.WHEAT, 1);
    mergeStackInto(entity.inventory, Obj.WHEAT_SEED, 2);

    return { ok: true, message: 'Harvested wheat and seeds' };
}
