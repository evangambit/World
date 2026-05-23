/**
 * Contexts for Bob's dual simulate/execute task framework.
 *
 * SimContext carries projected mutable state for the synchronous simulate
 * path.  Clone it before each candidate task's simulate call so tasks don't
 * corrupt each other's projected state.
 *
 * TaskContext (re-exported from thomasTasks.js) is unchanged — it's the
 * live async execution context used by the execute path.
 */
import { findPath } from '../../world/pathfinding.js';
import { MemoryWorldView } from '../npcMemoryWorld.js';
import { NPC_PERCEPTION_RADIUS } from '../npcConstants.js';

export { TaskContext } from '../thomasTasks.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Heuristic: simulation ticks required to walk one path step.
 * Tune this to match observed NPC movement speed at dt = 0.05.
 */
export const BOB_TICKS_PER_TILE = 4;

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SimResult
 * @property {number} elapsedTicks        Estimated ticks consumed by this task.
 * @property {Record<number, number>} netInventoryDelta  Per-objType net change (positive = gained).
 * @property {number} newTilesDiscovered  Estimated tiles added to tileMemory.
 * @property {number} netHungerDelta       Projected hunger change (negative = ate / reduced hunger).
 */

// ── SimContext ────────────────────────────────────────────────────────────────

/**
 * Mutable projected state threaded through a simulate call tree.
 *
 * - `tileMemory` and `world` are read-only references to live brain state.
 * - `projectedX/Y/Z`, `currentTick`, `_inventory` are mutated as the
 *   simulate functions model travel, actions, and inventory changes.
 */
export class SimContext {
    /**
     * @param {{
     *   tileMemory: Map<string, import('../npcMemory.js').TileMemoryEntry>,
     *   world: import('../../world/world.js').World3D,
     *   inventory: Map<number, number>,
     *   x: number,
     *   y: number,
     *   z: number,
     *   currentTick: number,
     *   gameTime: number,
     *   wanderRadius: number,
     *   hunger: number,
     * }} opts
     */
    constructor({ tileMemory, world, inventory, x, y, z, currentTick, gameTime, wanderRadius, hunger }) {
        this.tileMemory = tileMemory;
        this.world = world;
        this.projectedX = x;
        this.projectedY = y;
        this.projectedZ = z;
        this.currentTick = currentTick;
        this.gameTime = gameTime;
        this.wanderRadius = wanderRadius;
        this.projectedHunger = hunger;

        this.elapsedTicks = 0;
        this.newTilesDiscovered = 0;
        this._hungerDelta = 0;

        /** Keys of tiles already credited as discovered in this simulation run. */
        this._simDiscoveredKeys = new Set();

        /** @type {Map<number, number>} objType → current projected count */
        this._inventory = new Map(inventory);
        /** @type {Map<number, number>} objType → net change so far */
        this._inventoryDelta = new Map();
    }

    /**
     * Build a fresh SimContext from the live brain state.
     * @param {import('./bobBrain.js').BobBrain} brain
     * @returns {SimContext}
     */
    static fromBrain(brain) {
        const npc = brain.npc;
        const inventory = new Map();
        for (const stack of npc.inventory ?? []) {
            inventory.set(stack.objType, (inventory.get(stack.objType) ?? 0) + stack.count);
        }
        return new SimContext({
            tileMemory: brain.tileMemory,
            world: brain._world,
            inventory,
            x: Math.floor(npc.x),
            y: Math.floor(npc.y),
            z: npc.z,
            currentTick: brain._tickCount,
            gameTime: brain._gameTime,
            wanderRadius: npc.wanderRadius ?? 10,
            hunger: npc.hunger ?? 0,
        });
    }

    /**
     * Deep-copy this context.  Call before each candidate task's simulate so
     * that tasks don't interfere with each other's projected state.
     * @returns {SimContext}
     */
    clone() {
        const c = new SimContext({
            tileMemory: this.tileMemory,
            world: this.world,
            inventory: this._inventory,
            x: this.projectedX,
            y: this.projectedY,
            z: this.projectedZ,
            currentTick: this.currentTick,
            gameTime: this.gameTime,
            wanderRadius: this.wanderRadius,
            hunger: this.projectedHunger,
        });
        c.elapsedTicks = this.elapsedTicks;
        c.newTilesDiscovered = this.newTilesDiscovered;
        c._hungerDelta = this._hungerDelta;
        for (const [k, v] of this._inventoryDelta) c._inventoryDelta.set(k, v);
        for (const k of this._simDiscoveredKeys) c._simDiscoveredKeys.add(k);
        return c;
    }

    /**
     * @param {number} objType
     * @returns {number}
     */
    inventoryCount(objType) {
        return this._inventory.get(objType) ?? 0;
    }

    /**
     * Apply a positive (gain) or negative (consume) inventory change.
     * Projected count is clamped to 0 — can't go negative.
     * @param {number} objType
     * @param {number} delta
     */
    adjustInventory(objType, delta) {
        const cur = this._inventory.get(objType) ?? 0;
        this._inventory.set(objType, Math.max(0, cur + delta));
        this._inventoryDelta.set(objType, (this._inventoryDelta.get(objType) ?? 0) + delta);
    }

    /**
     * Apply a hunger change (negative delta = ate food).
     * @param {number} delta
     */
    adjustHunger(delta) {
        this.projectedHunger = Math.max(0, this.projectedHunger + delta);
        this._hungerDelta += delta;
    }

    /**
     * Estimate the cost of walking from projected position to (tx, ty) and
     * advance projected state.  Uses real A* pathfinding for accuracy.
     *
     * @param {number} tx
     * @param {number} ty
     * @param {number} endTick
     * @returns {'arrived' | 'impossible' | 'max_ticks'}
     */
    simMove(tx, ty, endTick) {
        if (this.projectedX === tx && this.projectedY === ty) return 'arrived';

        const memWorld = new MemoryWorldView(this.tileMemory);
        const path = findPath(
            memWorld,
            this.projectedX, this.projectedY, this.projectedZ,
            tx, ty, this.projectedZ,
        );
        if (!path || path.length === 0) return 'impossible';

        const ticks = Math.ceil((path.length - 1) * BOB_TICKS_PER_TILE);
        if (this.currentTick + ticks > endTick) return 'max_ticks';

        this.currentTick += ticks;
        this.elapsedTicks += ticks;
        this.projectedX = tx;
        this.projectedY = ty;

        // Credit newly visible tiles at the destination, counting each tile
        // at most once per simulation run.
        const r = NPC_PERCEPTION_RADIUS;
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                const key = `${tx + dx},${ty + dy},${this.projectedZ}`;
                if (!this.tileMemory.has(key) && !this._simDiscoveredKeys.has(key)) {
                    this._simDiscoveredKeys.add(key);
                    this.newTilesDiscovered++;
                }
            }
        }

        return 'arrived';
    }

    /**
     * Returns true if a path exists from the projected position to (tx, ty)
     * according to tile memory.  Does not mutate any state.
     * @param {number} tx
     * @param {number} ty
     * @returns {boolean}
     */
    canReach(tx, ty) {
        if (this.projectedX === tx && this.projectedY === ty) return true;
        const memWorld = new MemoryWorldView(this.tileMemory);
        const path = findPath(
            memWorld,
            this.projectedX, this.projectedY, this.projectedZ,
            tx, ty, this.projectedZ,
        );
        return path !== null && path.length > 0;
    }

    /**
     * Counts tiles within perception radius of (tx, ty) that would be newly
     * discovered if the NPC moved there — i.e. absent from both tileMemory
     * and the tiles already credited in this simulation run.
     * @param {number} tx
     * @param {number} ty
     * @returns {number}
     */
    countPotentialDiscoveries(tx, ty) {
        const r = NPC_PERCEPTION_RADIUS;
        let count = 0;
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                const key = `${tx + dx},${ty + dy},${this.projectedZ}`;
                if (!this.tileMemory.has(key) && !this._simDiscoveredKeys.has(key)) {
                    count++;
                }
            }
        }
        return count;
    }

    /** @returns {SimResult} */
    toResult() {
        return {
            elapsedTicks: this.elapsedTicks,
            netInventoryDelta: Object.fromEntries(this._inventoryDelta),
            newTilesDiscovered: this.newTilesDiscovered,
            netHungerDelta: this._hungerDelta,
        };
    }
}
