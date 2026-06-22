/**
 * Farm zone helpers — tile membership and LLM zone summaries.
 */
import { FARM_ZONES } from '../../../content/builder.js';
import { T, isWheatCropObject } from '../../../world/tileTypes.js';
import { isWheatMature } from '../../../domain/crops.js';

/** @typedef {import('../../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} [z=0]
 * @returns {string}
 */
export function tileKey(x, y, z = 0) {
    return `${x},${y},${z}`;
}

/**
 * Derive compact zone summary for LLM prompts (spec §1.1 layer 4).
 *
 * @param {Map<string, TileMemoryEntry>} memory
 * @param {number} gameTime
 * @returns {Record<string, object>}
 */
export function buildZoneSummary(memory, gameTime) {
    /** @type {Record<string, object>} */
    const summary = {};

    for (const zone of FARM_ZONES) {
        const zoneName = zone.name;
        let explored = 0;
        let growing = 0;
        let harvestable = 0;
        let bare = 0;

        for (const [tx, ty] of zone.tiles) {
            const key = tileKey(tx, ty, 0);
            const entry = memory.get(key);
            if (!entry) continue;
            explored++;

            const tile = entry.state;
            if (isWheatCropObject(tile.obj)) {
                if (isWheatMature(tile, gameTime)) harvestable++;
                else growing++;
            } else if (!tile.obj && tile.terrain === T.DIRT) {
                bare++;
            }
        }

        if (explored === 0) continue;

        /** @type {Record<string, unknown>} */
        const row = {
            label: zone.label,
            explored,
        };
        if (explored > 0) {
            /** @type {Record<string, number>} */
            const tiles = {};
            if (growing > 0) tiles.growing = growing;
            if (harvestable > 0) tiles.harvestable = harvestable;
            if (bare > 0) tiles.bare = bare;
            if (Object.keys(tiles).length > 0) row.tiles = tiles;
        }
        summary[zoneName] = row;
    }

    return summary;
}
