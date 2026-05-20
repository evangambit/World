/**
 * NPC tile memory — records tiles perceived within range (latest snapshot + seenAt).
 */
import { World3D } from '../world/world.js';
import { tileStatesEqual } from './tileChunkDescribe.js';

import { NPC_PERCEPTION_RADIUS } from './npcConstants.js';

export { NPC_PERCEPTION_RADIUS };

/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @typedef {Object} TileMemoryEntry
 * @property {number} seenAt
 * @property {TileData} state
 * @property {boolean} [reachable] - false when pathing failed; omitted = unknown
 */

/**
 * Immutable snapshot of a live tile (decoupled from world mutations).
 * @param {TileData} tile
 * @returns {TileData}
 */
export function snapshotTileState(tile) {
    return {
        terrain: tile.terrain,
        obj: tile.obj,
        transition: tile.transition ? { ...tile.transition } : null,
        ceiling: tile.ceiling,
        buildingId: tile.buildingId,
        interior: tile.interior,
        contents: tile.contents?.map((s) => ({ ...s })),
        doorLocked: tile.doorLocked,
        doorInsideDx: tile.doorInsideDx,
        doorInsideDy: tile.doorInsideDy,
        keyBuildingId: tile.keyBuildingId,
        cropStage: tile.cropStage,
        cropPlantedAt: tile.cropPlantedAt,
    };
}

/**
 * @param {NpcEntity} npc
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {TileMemoryEntry|undefined}
 */
export function getNpcTileMemory(npc, x, y, z) {
    return npc.tileMemory?.get(World3D.key(x, y, z));
}

/**
 * @param {TileData} a
 * @param {TileData} b
 * @returns {boolean}
 */
export function tileMemoryStatesEqual(a, b) {
    return tileStatesEqual(a, b);
}

/**
 * @param {NpcEntity} npc
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {boolean}
 */
export function isTileMemoryReachable(npc, x, y, z) {
    const mem = getNpcTileMemory(npc, x, y, z);
    if (!mem) return true;
    return mem.reachable !== false;
}

/**
 * @param {NpcEntity} npc
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function markTileUnreachable(npc, x, y, z) {
    const entry = getNpcTileMemory(npc, x, y, z);
    if (entry) entry.reachable = false;
}

/**
 * @param {NpcEntity} npc
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
export function markTileReachable(npc, x, y, z) {
    const entry = getNpcTileMemory(npc, x, y, z);
    if (entry) entry.reachable = true;
}

/**
 * Record tiles within perception range on the NPC's current floor.
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {number} gameTime
 */
export function tickNpcPerception(npc, world, gameTime) {
    if (npc._dead || !npc.tileMemory) return;

    const cx = Math.floor(npc.x);
    const cy = Math.floor(npc.y);
    const cz = npc.z;
    const r = NPC_PERCEPTION_RADIUS;

    for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
            const tx = cx + dx;
            const ty = cy + dy;
            const tile = world.getTile(tx, ty, cz);
            if (!tile) continue;

            const key = World3D.key(tx, ty, cz);
            const state = snapshotTileState(tile);
            const prev = npc.tileMemory.get(key);
            /** @type {boolean|undefined} */
            let reachable;
            if (prev && tileMemoryStatesEqual(prev.state, state)) {
                reachable = prev.reachable;
            }

            npc.tileMemory.set(key, {
                seenAt: gameTime,
                state,
                reachable,
            });
        }
    }
}
