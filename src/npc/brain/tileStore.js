/**
 * Tile observation store — shared by memory-capable brains.
 */
import { World3D } from '../../world/world.js';

/** @typedef {import('./interface.js').TileMemoryEntry} TileMemoryEntry */

/**
 * @param {{ _tileStore: Map<string, TileMemoryEntry>, observeTile: (x: number, y: number, z: number, entry: TileMemoryEntry) => void }} host
 */
export function initTileStore(host) {
    host._tileStore = new Map();
    host.observeTile = (x, y, z, entry) => {
        host._tileStore.set(World3D.key(x, y, z), entry);
    };
}
