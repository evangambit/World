/**
 * Farm zone helpers — tile membership, owned-zone filtering, LLM zone summaries.
 */
import { FARM_ZONES, FARM_ZONES_BY_NAME, TILE_TO_ZONE } from '../../../content/builder.js';
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
 * @param {string} zoneName
 * @returns {boolean}
 */
export function isFarmZoneName(zoneName) {
    return FARM_ZONES_BY_NAME.has(zoneName);
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {string | null}
 */
export function zoneNameForTile(x, y, z) {
    return TILE_TO_ZONE.get(tileKey(x, y, z)) ?? null;
}

/**
 * Hard-filter tile set for farming: tiles in zones this NPC owns.
 * Returns null when the NPC owns no zones (farm anywhere).
 *
 * @param {Record<string, string | null>} zoneOwners
 * @param {string} npcName
 * @returns {Set<string> | null}
 */
export function getOwnedTileSet(zoneOwners, npcName) {
    /** @type {string[]} */
    const ownedZones = [];
    for (const [zone, owner] of Object.entries(zoneOwners)) {
        if (owner === npcName && isFarmZoneName(zone)) {
            ownedZones.push(zone);
        }
    }
    if (ownedZones.length === 0) return null;

    const tiles = new Set();
    for (const zoneName of ownedZones) {
        const zone = FARM_ZONES_BY_NAME.get(zoneName);
        for (const [tx, ty] of zone.tiles) {
            tiles.add(tileKey(tx, ty, 0));
        }
    }
    return tiles;
}

/**
 * Derive compact zone summary for LLM prompts (spec §1.1 layer 4).
 *
 * @param {Map<string, TileMemoryEntry>} memory
 * @param {Record<string, string | null>} zoneOwners
 * @param {number} gameTime
 * @returns {Record<string, object>}
 */
export function buildZoneSummary(memory, zoneOwners, gameTime) {
    /** @type {Record<string, object>} */
    const summary = {};

    for (const zone of FARM_ZONES) {
        const zoneName = zone.name;
        let explored = 0;
        let growing = 0;
        let harvestable = 0;
        let bare = 0;
        const total = zone.tiles.length;

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

        const ownerKnown = Object.hasOwn(zoneOwners, zoneName);
        const owner = ownerKnown ? zoneOwners[zoneName] : 'unknown';

        if (explored === 0 && !ownerKnown) continue;

        /** @type {Record<string, string | number | null>} */
        const row = {
            owner: ownerKnown ? owner : 'unknown',
            explored: `${explored}/${total}`,
        };
        if (explored > 0) {
            row.growing = growing;
            row.harvestable = harvestable;
            row.bare = bare;
        }
        summary[zoneName] = row;
    }

    return summary;
}
