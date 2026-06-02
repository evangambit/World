/**
 * Copy-on-write tile world for NPC memory and planning branches.
 *
 * Simulation uses only perceived tile memory — never the live world. Unobserved
 * coordinates read as unknown (null). branch() / clone() add overlay deltas.
 */
import { World3D } from '../../world/world.js';
import { isContainerObject, isTileWalkable, T } from '../../world/tileTypes.js';
import { snapshotTileState } from './npcMemory.js';

/** @typedef {import('../../world/world.js').TileData} TileData */
/** @typedef {import('../../world/world.js').TilePatch} TilePatch */
/** @typedef {import('./npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../actors/entity.js').Entity} Entity */

/**
 * @typedef {Object} HypotheticalWorldOptions
 * @property {HypotheticalWorld|null} [parent]
 * @property {Map<string, TileMemoryEntry>} [memory] - root only: NPC tile store
 */

/**
 * @param {TileData|null} existing
 * @param {TilePatch} patch
 * @returns {TileData}
 */
function mergeTilePatch(existing, patch) {
    const { contents: _contents, ...tilePatch } = patch;
    if (!existing) {
        return {
            terrain: 0,
            obj: 0,
            transition: null,
            ceiling: false,
            buildingId: null,
            interior: false,
            ...tilePatch,
        };
    }
    const next = { ...existing, ...tilePatch };
    if (patch.transition !== undefined) {
        next.transition = patch.transition ? { ...patch.transition } : null;
    }
    return next;
}

/**
 * Sparse, branchable view over remembered tiles only.
 * Implements the World3D surface used by entity action apply() paths.
 */
export class HypotheticalWorld {
    /**
     * @param {HypotheticalWorldOptions} [opts]
     */
    constructor(opts = {}) {
        /** @type {HypotheticalWorld|null} */
        this._parent = opts.parent ?? null;
        /** @type {Map<string, TileMemoryEntry>|null} */
        this._memory = this._parent ? null : (opts.memory ?? new Map());
        /** @type {Map<string, TileData>} */
        this._tiles = new Map();
        /** @type {Map<string, { objType: number, count: number, buildingId?: number }[]>} */
        this._containerContents = new Map();
    }

    // TODO: tasks should return a meaningful reason they failed (or maybe even succeeded) so the LLM
    // has something to go off of

    // TODO: a primitive tile-based movement action is very convenient for reducing the number of 
    // actions in planning by 30x. Both HypotheticalWorld and the real world sim will have to do
    // some physics-based enforcment to achieve this.

    // TODO: tick should provide everything that the NPC has learned in the last tick:
    // tiles it can see
    // actions of other NPCs it can see
    // communication from other NPCs
    // Note: this means we remove 'observe' calls from the brain

    /** @returns {HypotheticalWorld} */
    branch() {
        return new HypotheticalWorld({ parent: this });
    }

    /** @returns {HypotheticalWorld} */
    clone() {
        return this.branch();
    }

    /** @returns {HypotheticalWorld} */
    _root() {
        let node = /** @type {HypotheticalWorld} */ (this);
        while (node._parent) node = node._parent;
        return node;
    }

    /**
     * @param {string} key
     * @returns {TileMemoryEntry|undefined}
     */
    _memoryEntry(key) {
        return this._root()._memory?.get(key);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {TileData|null}
     */
    getTile(x, y, z) {
        const key = World3D.key(x, y, z);
        let node = /** @type {HypotheticalWorld|null} */ (this);
        while (node) {
            const overlay = node._tiles.get(key);
            if (overlay) return overlay;
            node = node._parent;
        }

        const mem = this._memoryEntry(key);
        if (mem) return mem.state;
        return null;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    isKnownTile(x, y, z) {
        const key = World3D.key(x, y, z);
        let node = /** @type {HypotheticalWorld|null} */ (this);
        while (node) {
            if (node._tiles.has(key)) return true;
            node = node._parent;
        }
        return this._memoryEntry(key) != null;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    isReachable(x, y, z) {
        const key = World3D.key(x, y, z);
        let node = /** @type {HypotheticalWorld|null} */ (this);
        while (node) {
            if (node._tiles.has(key)) return true;
            node = node._parent;
        }
        const mem = this._memoryEntry(key);
        if (mem) return mem.reachable !== false;
        return false;
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {boolean}
     */
    isWalkable(x, y, z) {
        const tile = this.getTile(x, y, z);
        if (!tile) return false;
        if (tile.terrain === T.DOOR && tile.doorLocked) return false;
        return isTileWalkable(tile.terrain, tile.obj);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {TilePatch} data
     */
    setTile(x, y, z, data) {
        const key = World3D.key(x, y, z);
        const current = this.getTile(x, y, z);
        const { contents: incomingContents, ...tilePatch } = data;
        const merged = snapshotTileState(mergeTilePatch(current, tilePatch));
        this._tiles.set(key, merged);

        if (incomingContents) {
            this._containerContents.set(
                key,
                incomingContents.map((s) => ({
                    objType: s.objType,
                    count: s.count,
                    buildingId: s.buildingId,
                })),
            );
        }
        if (!isContainerObject(merged.obj)) {
            this._containerContents.delete(key);
        } else if (!this._containerContents.has(key) && !incomingContents) {
            const inherited = this.getTileContents(x, y, z);
            if (inherited.length > 0) {
                this._containerContents.set(
                    key,
                    inherited.map((s) => ({ ...s })),
                );
            }
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{ objType: number, count: number, buildingId?: number }[]}
     */
    getTileContents(x, y, z) {
        const key = World3D.key(x, y, z);
        let node = /** @type {HypotheticalWorld|null} */ (this);
        while (node) {
            if (node._containerContents.has(key)) {
                return node._containerContents.get(key) ?? [];
            }
            node = node._parent;
        }
        return [];
    }

    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{ objType: number, count: number, buildingId?: number }[]|null}
     */
    ensureTileContents(x, y, z) {
        const tile = this.getTile(x, y, z);
        if (!tile || !isContainerObject(tile.obj)) return null;
        const key = World3D.key(x, y, z);
        if (!this._containerContents.has(key)) {
            const inherited = this.getTileContents(x, y, z);
            this._containerContents.set(
                key,
                inherited.map((s) => ({ ...s })),
            );
        }
        return this._containerContents.get(key) ?? null;
    }

    /**
     * Run a one-shot entity action against this view (apply() only).
     * Movement and timed tick actions are not simulated here.
     *
     * @param {EntityAction} action
     * @param {Entity} entity
     * @returns {boolean}
     */
    apply(action, entity) {
        if (typeof action.apply !== 'function') return false;
        return action.apply(this);
    }

    /**
     * Iterate every known tile in this branch, overlay tiles taking precedence
     * over root memory. Useful for planning loops that need a merged tile view.
     *
     * @param {(key: string, tile: TileData, reachable: boolean | undefined) => void} fn
     */
    forEachTile(fn) {
        const seen = new Set();
        let node = /** @type {HypotheticalWorld|null} */ (this);
        while (node) {
            for (const [key, tile] of node._tiles) {
                if (!seen.has(key)) {
                    seen.add(key);
                    fn(key, tile, undefined);
                }
            }
            node = node._parent;
        }
        const root = this._root();
        if (root._memory) {
            for (const [key, entry] of root._memory) {
                if (!seen.has(key)) {
                    seen.add(key);
                    fn(key, entry.state, entry.reachable);
                }
            }
        }
    }
}

/**
 * Branchable entity snapshot for planning (inventory + pose).
 * Pass instances to HypotheticalWorld.apply alongside branched worlds.
 */
export class HypotheticalEntity {
    /**
     * @param {Entity} entity
     * @param {HypotheticalEntity|null} [parent]
     */
    constructor(entity, parent = null) {
        if (parent) {
            this.x = parent.x;
            this.y = parent.y;
            this.z = parent.z;
            this.hunger = parent.hunger;
            this.name = parent.name;
            this.inventory = parent.inventory.map((s) => ({ ...s }));
        } else {
            this.x = entity.x;
            this.y = entity.y;
            this.z = entity.z;
            this.hunger = entity.hunger ?? 0;
            this.name = entity.name ?? '';
            this.inventory = (entity.inventory ?? []).map((s) => ({ ...s }));
        }
        /** @type {HypotheticalEntity|null} */
        this._parent = parent;
    }

    /** @returns {HypotheticalEntity} */
    branch() {
        return new HypotheticalEntity(/** @type {Entity} */ (/** @type {unknown} */ (this)), this);
    }

    /** @returns {HypotheticalEntity} */
    clone() {
        return this.branch();
    }
}

/**
 * @param {Map<string, TileMemoryEntry>} memory
 * @returns {HypotheticalWorld}
 */
export function createHypotheticalFromMemory(memory) {
    return new HypotheticalWorld({ memory });
}
