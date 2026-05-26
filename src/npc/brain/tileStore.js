/**
 * Legacy tile observation hook for brains.
 * Memory storage now lives in npcMemory's internal store.
 */

/**
 * @param {{ observeTile?: (x: number, y: number, z: number, entry: import('./interface.js').TileMemoryEntry) => void }} host
 */
export function initTileStore(host) {
    if (typeof host.observeTile !== 'function') {
        host.observeTile = () => {};
    }
}
