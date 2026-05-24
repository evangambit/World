/**
 * MemoryWorldView — a read-only world view backed by an NPC's tile memory.
 *
 * Used wherever an NPC is planning (pathfinding, reachability) rather than
 * the game engine actually moving it.
 */
import { isTileWalkable, T } from '../world/tileTypes.js';
import { World3D } from '../world/world.js';

/** @typedef {import('./npcMemory.js').TileMemoryEntry} TileMemoryEntry */

export class MemoryWorldView {
    /**
     * @param {Map<string, TileMemoryEntry>} tileMemory
     */
    constructor(tileMemory) {
        this._memory = tileMemory;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    isWalkable(x, y, z) {
        const entry = this._memory.get(World3D.key(x, y, z));
        if (!entry) return true;
        const s = entry.state;
        if (s.terrain === T.DOOR && s.doorLocked) return false;
        return isTileWalkable(s.terrain, s.obj);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{ x: number, y: number, z: number }[]}
     */
    getWalkableNeighbors(x, y, z) {
        const neighbors = [];

        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (this.isWalkable(x + dx, y + dy, z)) {
                neighbors.push({ x: x + dx, y: y + dy, z });
            }
        }

        const entry = this._memory.get(World3D.key(x, y, z));
        const transition = entry?.state?.transition;
        if (transition) {
            const { tx, ty, tz } = transition;
            if (this.isWalkable(tx, ty, tz)) {
                neighbors.push({ x: tx, y: ty, z: tz });
            }
        }

        return neighbors;
    }
}
