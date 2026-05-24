/**
 * Carol's RealContext / HypotheticalContext protocol.
 *
 * Task functions receive either a RealCarolContext (live execution) or a
 * HypotheticalCarolContext (instant nextTick planning).  Both expose the same
 * interface: hypothetical(), utility(), movement helpers, and inventory deltas.
 */
import { findPath } from '../../world/pathfinding.js';
import { World3D } from '../../world/world.js';
import { Obj } from '../../world/tileTypes.js';
import { findApproachTile } from '../npcTaskPrimitives.js';
import { MemoryWorldView } from '../npcMemoryWorld.js';
import { NPC_PERCEPTION_RADIUS } from '../npcConstants.js';
import {
    ActionResult,
    MoveResult,
    SeekResult,
    doTimedAction,
    inventoryCount,
    moveTowardLocation,
    seekKnownDesires,
    wanderOnce,
} from '../thomasTasks.js';

/** @typedef {import('../npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('../../world/world.js').TileData} TileData */
/** @typedef {import('../thomasTasks.js').Desire} Desire */
/** @typedef {import('./carolBrain.js').CarolBrain} CarolBrain */

export const EXPLORE_ALPHA = 2;
export const HUNGER_C = 0.05;
export const BREAD_SATIETY_K = 30;
export const TICK_COST = 0.01;
export const TICKS_PER_TILE = 4;

/**
 * @param {Iterable<string>} keys
 * @param {number} z
 * @returns {{ x: number, y: number } | null}
 */
export function computeCentroid(keys, z) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (const key of keys) {
        const parts = key.split(',');
        if (parts.length !== 3) continue;
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const kz = Number(parts[2]);
        if (kz !== z) continue;
        sumX += x;
        sumY += y;
        count++;
    }

    if (count === 0) return null;
    return { x: sumX / count, y: sumY / count };
}

/**
 * Carol.md utility: exploration sum + exponential hunger/bread term - tick cost.
 *
 * @param {{
 *   tileMemory: Map<string, TileMemoryEntry>,
 *   z: number,
 *   extraTileKeys?: Iterable<string>,
 *   hunger: number,
 *   breadCount: number,
 *   elapsedTicks: number,
 * }} params
 * @returns {number}
 */
function computeCarolUtility({
    tileMemory,
    z,
    extraTileKeys = [],
    hunger,
    breadCount,
    elapsedTicks,
}) {
    const seenKeys = new Set(tileMemory.keys());
    for (const key of extraTileKeys) seenKeys.add(key);

    const centroid = computeCentroid(seenKeys, z);
    let uExplore = 0;

    for (const key of seenKeys) {
        const parts = key.split(',');
        if (parts.length !== 3) continue;
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const kz = Number(parts[2]);
        if (kz !== z) continue;

        const dist = centroid
            ? Math.hypot(x - centroid.x, y - centroid.y)
            : 0;
        uExplore += 1 / Math.max(1, dist) ** EXPLORE_ALPHA;
    }

    const satiety = 100 - hunger;
    const uHunger = -Math.exp(-HUNGER_C * (satiety + BREAD_SATIETY_K * breadCount));

    return uExplore + uHunger - TICK_COST * elapsedTicks;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {Map<string, TileMemoryEntry>} tileMemory
 * @param {Desire[]} desires
 * @returns {{ x: number, y: number, z: number, score: number }[]}
 */
function findDesirableTilesAt(x, y, z, tileMemory, desires) {
    /** @type {{ x: number, y: number, z: number, score: number }[]} */
    const results = [];

    for (const [key, entry] of tileMemory) {
        if (entry.reachable === false) continue;

        const parts = key.split(',');
        const tx = +parts[0];
        const ty = +parts[1];
        const tz = +parts[2];
        if (tz !== z) continue;

        for (const desire of desires) {
            if (desire.match(entry.state)) {
                const dist = Math.max(Math.abs(tx - x), Math.abs(ty - y));
                results.push({
                    x: tx,
                    y: ty,
                    z: tz,
                    score: desire.weight / Math.max(dist, 1),
                });
                break;
            }
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * @param {MemoryWorldView} memWorld
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {{ x: number, y: number, z: number } | null}
 */
function resolveDesireDestination(memWorld, x, y, z, tx, ty, tz) {
    if (memWorld.isWalkable(tx, ty, tz)) {
        return { x: tx, y: ty, z: tz };
    }
    const fakeNpc = { x, y, z };
    return findApproachTile(memWorld, fakeNpc, { x: tx, y: ty, z: tz });
}

/** @param {CarolBrain} brain */
function buildInventoryMap(brain) {
    /** @type {Map<number, number>} */
    const inventory = new Map();
    for (const stack of brain.npc?.inventory ?? []) {
        inventory.set(stack.objType, (inventory.get(stack.objType) ?? 0) + stack.count);
    }
    return inventory;
}

/**
 * Live execution context — delegates movement to thomasTasks primitives.
 */
export class RealCarolContext {
    /**
     * @param {CarolBrain} brain
     * @param {number} taskEpoch
     */
    constructor(brain, taskEpoch) {
        this._brain = brain;
        this._taskEpoch = taskEpoch;
    }

    get isHypothetical() { return false; }

    get brain() { return this._brain; }
    get npc() { return this._brain.npc; }
    get tileMemory() { return this._brain.tileMemory; }
    get world() { return this._brain._world; }
    get gameTime() { return this._brain._gameTime; }
    get tickCount() { return this._brain._tickCount; }

    get x() { return Math.floor(this.npc.x); }
    get y() { return Math.floor(this.npc.y); }
    get z() { return this.npc.z; }
    get hunger() { return this.npc.hunger ?? 0; }
    get wanderRadius() { return this.npc.wanderRadius ?? 10; }

    /** @param {number} _objType @param {number} _delta */
    adjustInventory(_objType, _delta) {}

    /** @param {number} _delta */
    adjustHunger(_delta) {}

    /** @returns {HypotheticalCarolContext} */
    hypothetical() {
        return HypotheticalCarolContext.fromReal(this);
    }

    /** @returns {number} */
    utility() {
        return computeCarolUtility({
            tileMemory: this.tileMemory,
            z: this.z,
            hunger: this.hunger,
            breadCount: inventoryCount(this.npc, Obj.BREAD),
            elapsedTicks: 0,
        });
    }

    /** @returns {Promise<void>} */
    nextTick() {
        return this._brain._nextTick();
    }

    /** @param {string} line */
    setStatus(line) {
        this._brain._statusLine = line;
    }

    /** @returns {boolean} */
    isActive() {
        return this._brain._taskEpoch === this._taskEpoch;
    }

    /** @returns {import('../thomasTasks.js').TaskContext} */
    _taskContext() {
        return this._brain._taskContext(this);
    }

    /**
     * @param {Desire[]} desires
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async seekDesires(desires, maxTicks) {
        return seekKnownDesires(this._taskContext(), desires, maxTicks);
    }

    /**
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async wander(maxTicks) {
        return wanderOnce(this._taskContext(), maxTicks);
    }

    /**
     * @param {string} actionId
     * @param {number} tx
     * @param {number} ty
     * @returns {Promise<string>}
     */
    async doAction(actionId, tx, ty) {
        return doTimedAction(this._taskContext(), actionId, tx, ty);
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async moveToward(tx, ty, maxTicks) {
        return moveTowardLocation(this._taskContext(), tx, ty, maxTicks);
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {string}
     */
    simDirectStep(tx, ty, endTick) {
        throw new Error('simDirectStep is only available on hypothetical contexts');
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {string}
     */
    simMove(tx, ty, endTick) {
        throw new Error('simMove is only available on hypothetical contexts');
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {string}
     */
    addDiscoveredTile(tx, ty, endTick) {
        throw new Error('addDiscoveredTile is only available on hypothetical contexts');
    }
}

/**
 * Planning context — instant nextTick, projected state via deltas.
 */
export class HypotheticalCarolContext {
    /**
     * @param {{
     *   tileMemory: Map<string, TileMemoryEntry>,
     *   gameTime: number,
     *   wanderRadius: number,
     *   inventory: Map<number, number>,
     *   x: number,
     *   y: number,
     *   z: number,
     *   hunger: number,
     *   currentTick: number,
     *   elapsedTicks?: number,
     *   extraTileKeys?: Set<string>,
     * }} snapshot
     */
    constructor(snapshot) {
        this.tileMemory = snapshot.tileMemory;
        this.gameTime = snapshot.gameTime;
        this.wanderRadius = snapshot.wanderRadius;

        this._inventory = new Map(snapshot.inventory);
        this._x = snapshot.x;
        this._y = snapshot.y;
        this._z = snapshot.z;
        this._hunger = snapshot.hunger;
        this._currentTick = snapshot.currentTick;
        this._elapsedTicks = snapshot.elapsedTicks ?? 0;
        this._extraTileKeys = new Set(snapshot.extraTileKeys ?? []);
    }

    /** @param {RealCarolContext} realCtx */
    static fromReal(realCtx) {
        return new HypotheticalCarolContext({
            tileMemory: realCtx.tileMemory,
            gameTime: realCtx.gameTime,
            wanderRadius: realCtx.wanderRadius,
            inventory: buildInventoryMap(realCtx.brain),
            x: realCtx.x,
            y: realCtx.y,
            z: realCtx.z,
            hunger: realCtx.hunger,
            currentTick: realCtx.tickCount,
        });
    }

    /** @returns {HypotheticalCarolContext} */
    clone() {
        return new HypotheticalCarolContext({
            tileMemory: this.tileMemory,
            gameTime: this.gameTime,
            wanderRadius: this.wanderRadius,
            inventory: this._inventory,
            x: this._x,
            y: this._y,
            z: this._z,
            hunger: this._hunger,
            currentTick: this._currentTick,
            elapsedTicks: this._elapsedTicks,
            extraTileKeys: this._extraTileKeys,
        });
    }

    get isHypothetical() { return true; }
    get npc() { return null; }
    get world() { return null; }
    get tickCount() { return this._currentTick; }
    get x() { return this._x; }
    get y() { return this._y; }
    get z() { return this._z; }
    get hunger() { return this._hunger; }

    /** @returns {HypotheticalCarolContext} */
    hypothetical() {
        return this.clone();
    }

    /** @returns {number} */
    utility() {
        return computeCarolUtility({
            tileMemory: this.tileMemory,
            z: this._z,
            extraTileKeys: this._extraTileKeys,
            hunger: this._hunger,
            breadCount: this.inventoryCount(Obj.BREAD),
            elapsedTicks: this._elapsedTicks,
        });
    }

    /** @returns {Promise<void>} */
    nextTick() {
        this._currentTick += 1;
        this._elapsedTicks += 1;
        return Promise.resolve();
    }

    /** @param {string} _line */
    setStatus(_line) {}

    /** @returns {boolean} */
    isActive() {
        return true;
    }

    /**
     * @param {number} objType
     * @returns {number}
     */
    inventoryCount(objType) {
        return this._inventory.get(objType) ?? 0;
    }

    /**
     * @param {number} objType
     * @param {number} delta
     */
    adjustInventory(objType, delta) {
        const cur = this._inventory.get(objType) ?? 0;
        this._inventory.set(objType, Math.max(0, cur + delta));
    }

    /** @param {number} delta */
    adjustHunger(delta) {
        this._hunger = Math.max(0, this._hunger + delta);
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     */
    _creditDiscoveriesAt(tx, ty, endTick) {
        const r = NPC_PERCEPTION_RADIUS;
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                const key = World3D.key(tx + dx, ty + dy, this._z);
                if (!this.tileMemory.has(key)) {
                    this._extraTileKeys.add(key);
                }
            }
        }
        void endTick;
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {string}
     */
    simDirectStep(tx, ty, endTick) {
        const ticks = TICKS_PER_TILE;
        if (this._currentTick + ticks > endTick) return MoveResult.MAX_TICKS;

        this._currentTick += ticks;
        this._elapsedTicks += ticks;
        this._x = tx;
        this._y = ty;
        this._creditDiscoveriesAt(tx, ty, endTick);
        return MoveResult.ARRIVED;
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {string}
     */
    simMove(tx, ty, endTick) {
        if (this._x === tx && this._y === ty) return MoveResult.ARRIVED;

        const memWorld = new MemoryWorldView(this.tileMemory);
        const path = findPath(
            memWorld,
            this._x, this._y, this._z,
            tx, ty, this._z,
        );
        if (!path || path.length === 0) return MoveResult.IMPOSSIBLE;

        const ticks = Math.ceil((path.length - 1) * TICKS_PER_TILE);
        if (this._currentTick + ticks > endTick) return MoveResult.MAX_TICKS;

        this._currentTick += ticks;
        this._elapsedTicks += ticks;
        this._x = tx;
        this._y = ty;
        this._creditDiscoveriesAt(tx, ty, endTick);
        return MoveResult.ARRIVED;
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     */
    addDiscoveredTile(tx, ty, endTick) {
        const key = World3D.key(tx, ty, this._z);
        if (!this.tileMemory.has(key)) {
            this._extraTileKeys.add(key);
        }
        void endTick;
    }

    /**
     * @param {Desire[]} desires
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async seekDesires(desires, maxTicks) {
        const endTick = this._currentTick + maxTicks;
        const candidates = findDesirableTilesAt(this._x, this._y, this._z, this.tileMemory, desires);
        if (candidates.length === 0) return SeekResult.NO_KNOWN_REACHABLE;

        const memWorld = new MemoryWorldView(this.tileMemory);
        for (const candidate of candidates) {
            const dest = resolveDesireDestination(
                memWorld,
                this._x,
                this._y,
                this._z,
                candidate.x,
                candidate.y,
                candidate.z,
            );
            if (!dest) continue;

            const result = this.simMove(dest.x, dest.y, endTick);
            if (result === MoveResult.ARRIVED) return SeekResult.ARRIVED;
            if (result === MoveResult.IMPOSSIBLE) continue;
            return SeekResult.MAX_TICKS;
        }

        return SeekResult.NO_KNOWN_REACHABLE;
    }

    /**
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async wander(maxTicks) {
        const endTick = this._currentTick + maxTicks;
        const dist = Math.max(1, Math.floor(this.wanderRadius * 0.5));
        const candidates = [
            [this._x + dist, this._y],
            [this._x - dist, this._y],
            [this._x, this._y + dist],
            [this._x, this._y - dist],
        ].filter(([tx, ty]) => {
            const memWorld = new MemoryWorldView(this.tileMemory);
            return memWorld.isWalkable(tx, ty, this._z);
        });

        if (candidates.length === 0) return MoveResult.IMPOSSIBLE;
        return this.simMove(candidates[0][0], candidates[0][1], endTick);
    }

    /**
     * @param {string} _actionId
     * @param {number} _tx
     * @param {number} _ty
     * @param {number} [estimatedTicks]
     * @returns {Promise<string>}
     */
    async doAction(_actionId, _tx, _ty, estimatedTicks = 100) {
        this._currentTick += estimatedTicks;
        this._elapsedTicks += estimatedTicks;
        return ActionResult.COMPLETED;
    }

    /**
     * @param {number} tx
     * @param {number} ty
     * @param {number} maxTicks
     * @returns {Promise<string>}
     */
    async moveToward(tx, ty, maxTicks) {
        return this.simMove(tx, ty, this._currentTick + maxTicks);
    }
}
