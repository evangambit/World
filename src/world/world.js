/**
 * World3D — sparse 3D tile grid indexed by (x, y, z).
 * Multiple z-layers can exist at the same (x, y) coordinate.
 */
import { isTileWalkable, T } from './tileTypes.js';

/** @typedef {{ terrain: number, obj: number, transition: {tx:number,ty:number,tz:number,type:string}|null, ceiling: boolean, buildingId: number|null, interior: boolean, contents?: {objType:number, count:number, buildingId?:number}[], doorLocked?: boolean, doorInsideDx?: number, doorInsideDy?: number, keyBuildingId?: number|null, cropStage?: number, cropPlantedAt?: number }} TileData */

export class World3D {
    constructor() {
        /** @type {Map<string, TileData>} "x,y,z" → tile data */
        this.tiles = new Map();
        /** @type {Map<string, Set<number>>} "x,y" → set of z-levels present */
        this.columns = new Map();
        /** World bounds (updated on setTile) */
        this.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
        this._boundsInit = false;
    }

    /** Generate map key */
    static key(x, y, z) { return `${x},${y},${z}`; }
    static colKey(x, y) { return `${x},${y}`; }

    /**
     * Set a tile at (x, y, z).
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {Partial<TileData>} data
     */
    setTile(x, y, z, data) {
        const key = World3D.key(x, y, z);
        const existing = this.tiles.get(key);
        const tile = existing
            ? Object.assign(existing, data)
            : { terrain: 0, obj: 0, transition: null, ceiling: false, buildingId: null, interior: false, contents: [], ...data };
        this.tiles.set(key, tile);

        // Update column index
        const ck = World3D.colKey(x, y);
        if (!this.columns.has(ck)) this.columns.set(ck, new Set());
        this.columns.get(ck).add(z);

        // Update bounds
        if (!this._boundsInit) {
            this.bounds = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
            this._boundsInit = true;
        } else {
            if (x < this.bounds.minX) this.bounds.minX = x;
            if (x > this.bounds.maxX) this.bounds.maxX = x;
            if (y < this.bounds.minY) this.bounds.minY = y;
            if (y > this.bounds.maxY) this.bounds.maxY = y;
            if (z < this.bounds.minZ) this.bounds.minZ = z;
            if (z > this.bounds.maxZ) this.bounds.maxZ = z;
        }
    }

    /** @returns {TileData|null} */
    getTile(x, y, z) {
        return this.tiles.get(World3D.key(x, y, z)) || null;
    }

    /**
     * Mutable stack list for container tiles; creates an empty array if missing.
     * @returns {{objType:number, count:number}[]|null}
     */
    ensureTileContents(x, y, z) {
        const tile = this.getTile(x, y, z);
        if (!tile) return null;
        if (!tile.contents) tile.contents = [];
        return tile.contents;
    }

    /** Get all z-levels present at (x, y), sorted ascending. */
    getLayersAt(x, y) {
        const s = this.columns.get(World3D.colKey(x, y));
        return s ? [...s].sort((a, b) => a - b) : [];
    }

    /** Check if a tile at (x,y,z) exists and is walkable. */
    isWalkable(x, y, z) {
        const tile = this.getTile(x, y, z);
        if (!tile) return false;
        if (tile.terrain === T.DOOR && tile.doorLocked) return false;
        return isTileWalkable(tile.terrain, tile.obj);
    }

    /** Get the transition data at (x,y,z), if any. */
    getTransition(x, y, z) {
        const tile = this.getTile(x, y, z);
        return tile ? tile.transition : null;
    }

    /** Check if the tile at (x,y,z) has a ceiling (player is "indoors"). */
    hasCeiling(x, y, z) {
        const tile = this.getTile(x, y, z);
        return tile ? tile.ceiling : false;
    }

    /** Get the buildingId for the tile at (x,y,z), or null if not part of a building. */
    getBuildingId(x, y, z) {
        const tile = this.getTile(x, y, z);
        return tile ? tile.buildingId : null;
    }

    /**
     * Get walkable cardinal neighbors for pathfinding.
     * Returns array of {x, y, z} including same-layer adjacency and transitions.
     */
    getWalkableNeighbors(x, y, z) {
        const neighbors = [];
        // Cardinal directions on same layer
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (this.isWalkable(nx, ny, z)) {
                neighbors.push({ x: nx, y: ny, z });
            }
        }
        // Transition (stairs, doors, etc.)
        const tile = this.getTile(x, y, z);
        if (tile && tile.transition) {
            const { tx, ty, tz } = tile.transition;
            if (this.isWalkable(tx, ty, tz)) {
                neighbors.push({ x: tx, y: ty, z: tz });
            }
        }
        return neighbors;
    }
}
