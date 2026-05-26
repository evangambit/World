/**
 * NPC tile memory — records tiles perceived within range (latest snapshot + seenAt).
 */
import { World3D } from '../../world/world.js';
import { tileStatesEqual } from './tileChunkDescribe.js';

import { NPC_PERCEPTION_RADIUS } from './npcConstants.js';

export { NPC_PERCEPTION_RADIUS };

/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/** @type {WeakMap<NpcEntity, Map<string, TileMemoryEntry>>} */
const NPC_TILE_MEMORY = new WeakMap();

/**
 * @typedef {Object} TileMemoryEntry
 * @property {number} seenAt
 * @property {TileData} state
 * @property {boolean} [reachable] - false when pathing failed; omitted = unknown
 */

/**
 * @param {NpcEntity} npc
 * @returns {Map<string, TileMemoryEntry>|undefined}
 */
function tileStoreFor(npc) {
    return NPC_TILE_MEMORY.get(npc);
}

/**
 * @param {NpcEntity} npc
 * @returns {Map<string, TileMemoryEntry>}
 */
function ensureTileStoreFor(npc) {
    let map = NPC_TILE_MEMORY.get(npc);
    if (!map) {
        map = new Map();
        NPC_TILE_MEMORY.set(npc, map);
    }
    return map;
}

/**
 * @param {NpcEntity} npc
 * @param {(key: string, entry: TileMemoryEntry) => void} fn
 */
export function forEachNpcObservedTile(npc, fn) {
    const map = tileStoreFor(npc);
    if (!map) return;
    for (const [key, entry] of map) fn(key, entry);
}

/**
 * Public accessor for an NPC's observed tile store.
 * Callers should treat the returned map as read-only.
 *
 * @param {NpcEntity} npc
 * @returns {Map<string, TileMemoryEntry>|undefined}
 */
export function getNpcTileMemoryStore(npc) {
    return tileStoreFor(npc);
}

/**
 * @param {NpcEntity} npc
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {TileMemoryEntry} entry
 */
export function setNpcTileMemory(npc, x, y, z, entry) {
    ensureTileStoreFor(npc).set(World3D.key(x, y, z), entry);
}

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
    return tileStoreFor(npc)?.get(World3D.key(x, y, z));
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
    const brain = npc.brain;
    if (!npc.isAlive) return;

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

            const state = snapshotTileState(tile);
            const prev = getNpcTileMemory(npc, tx, ty, cz);
            /** @type {boolean|undefined} */
            let reachable;
            if (prev && tileMemoryStatesEqual(prev.state, state)) {
                reachable = prev.reachable;
            }

            const entry = {
                seenAt: gameTime,
                state,
                reachable,
            };
            setNpcTileMemory(npc, tx, ty, cz, entry);
            brain?.observeTile?.(tx, ty, cz, entry);
        }
    }
}
