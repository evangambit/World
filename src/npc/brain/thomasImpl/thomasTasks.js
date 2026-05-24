/**
 * Async task primitives for ThomasBrain.
 *
 * Tasks are async functions that receive a TaskContext and return typed exit
 * reasons.  They advance one simulation tick at a time via `ctx.nextTick()`.
 *
 * Low-level primitives (moveTowardLocation) think in ticks.
 * Higher-level combinators (seekKnownDesires) compose primitives and hide ticks.
 */
import { forEachNpcObservedTile, markTileUnreachable } from '../../shared/npcMemory.js';
import { findApproachTile } from '../taskImpl/npcTaskPrimitives.js';

/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */

// ── Exit reasons ────────────────────────────────────────────────────────────

export const MoveResult = Object.freeze({
    MAX_TICKS:   'max_ticks',
    IMPOSSIBLE:  'impossible',
    ARRIVED:     'arrived',
    TOOK_DAMAGE: 'took_damage',
});

export const SeekResult = Object.freeze({
    MAX_TICKS:          'max_ticks',
    NO_KNOWN_REACHABLE: 'no_known_reachable',
    ARRIVED:            'arrived',
    TOOK_DAMAGE:        'took_damage',
});

export const ActionResult = Object.freeze({
    COMPLETED:   'completed',
    FAILED:      'failed',
    TOOK_DAMAGE: 'took_damage',
});

// ── Task context ────────────────────────────────────────────────────────────

/**
 * Passed to every task / behavior function.  Provides live access to the NPC,
 * world, and tile memory — all of which are updated each tick by the brain.
 */
export class TaskContext {
    /** @param {import('./brain/thomasImpl/thomasBrain.js').ThomasBrain} brain */
    constructor(brain) {
        /** @private */
        this._brain = brain;
    }

    get npc()        { return this._brain.npc; }
    get world()      { return this._brain._world; }
    get gameTime()   { return this._brain._gameTime; }
    get tickCount()  { return this._brain._tickCount; }

    /** Yield control until the next simulation tick. */
    nextTick() { return this._brain._nextTick(); }

    /** Update the status line shown in the NPC panel. */
    setStatus(line) { this._brain._statusLine = line; }
}

// ── Primitives ──────────────────────────────────────────────────────────────

/**
 * Walk toward a tile on the NPC's current floor.
 *
 * Uses `setGoal` (live-world pathfinding) and then polls locomotion each tick.
 *
 * @param {TaskContext} ctx
 * @param {number} x   Target tile X
 * @param {number} y   Target tile Y
 * @param {number} maxTicks
 * @returns {Promise<string>} A `MoveResult.*` value.
 */
export async function moveTowardLocation(ctx, x, y, maxTicks) {
    const { npc } = ctx;
    const startHealth = npc.health;

    if (Math.floor(npc.x) === x && Math.floor(npc.y) === y) {
        return MoveResult.ARRIVED;
    }

    if (!npc.setGoal(x, y, npc.z, ctx.world)) {
        return MoveResult.IMPOSSIBLE;
    }

    for (let tick = 0; tick < maxTicks; tick++) {
        await ctx.nextTick();

        if (npc._dead || npc.health < startHealth) return MoveResult.TOOK_DAMAGE;
        if (Math.floor(npc.x) === x && Math.floor(npc.y) === y) return MoveResult.ARRIVED;
        if (npc._state === 'idle') return MoveResult.IMPOSSIBLE;
    }

    return MoveResult.MAX_TICKS;
}

// ── Desire-based search ─────────────────────────────────────────────────────

/**
 * A single desire: a predicate that matches tile state, plus a weight.
 * Higher weight = more desirable.
 * @typedef {Object} Desire
 * @property {(state: TileData) => boolean} match
 * @property {number} weight
 */

/**
 * Search tile memory for desired tiles, rank by `weight / distance`, and walk
 * toward the best.  Re-evaluates rankings every `reevalInterval` ticks so the
 * NPC can switch targets when perception updates memory.
 *
 * @param {TaskContext} ctx
 * @param {Desire[]} desires
 * @param {number} maxTicks
 * @param {{ reevalInterval?: number }} [opts]
 * @returns {Promise<string>} A `SeekResult.*` value.
 */
export async function seekKnownDesires(ctx, desires, maxTicks, opts = {}) {
    const reevalInterval = opts.reevalInterval ?? 60;
    const { npc } = ctx;
    const startHealth = npc.health;
    const deadline = ctx.tickCount + maxTicks;

    while (ctx.tickCount < deadline) {
        if (npc._dead || npc.health < startHealth) return SeekResult.TOOK_DAMAGE;

        const candidates = findDesirableTiles(ctx, desires);
        if (candidates.length === 0) return SeekResult.NO_KNOWN_REACHABLE;

        const ticksLeft = deadline - ctx.tickCount;
        const moveTicks = Math.min(ticksLeft, reevalInterval);

        let advanced = false;
        for (const best of candidates) {
            const dest = resolveDesireDestination(ctx, best.x, best.y, best.z);
            if (!dest) {
                markTileUnreachable(npc, best.x, best.y, best.z);
                continue;
            }

            const result = await moveTowardLocation(ctx, dest.x, dest.y, moveTicks);
            advanced = true;

            switch (result) {
                case MoveResult.ARRIVED:
                    return SeekResult.ARRIVED;
                case MoveResult.TOOK_DAMAGE:
                    return SeekResult.TOOK_DAMAGE;
                case MoveResult.IMPOSSIBLE:
                    markTileUnreachable(npc, best.x, best.y, best.z);
                    break;
                case MoveResult.MAX_TICKS:
                    break;
            }
            break;
        }

        if (!advanced) return SeekResult.NO_KNOWN_REACHABLE;
    }

    return SeekResult.MAX_TICKS;
}

/**
 * Scan tileMemory for tiles matching any desire on the NPC's current floor.
 * Returns them sorted best-first by `weight / max(distance, 1)`.
 *
 * @param {TaskContext} ctx
 * @param {Desire[]} desires
 * @returns {{ x: number, y: number, z: number, weight: number, dist: number, score: number }[]}
 */
function findDesirableTiles(ctx, desires) {
    const { npc } = ctx;
    const npcX = Math.floor(npc.x);
    const npcY = Math.floor(npc.y);
    const npcZ = npc.z;

    /** @type {{ x: number, y: number, z: number, weight: number, dist: number, score: number }[]} */
    const results = [];

    forEachNpcObservedTile(npc, (key, entry) => {
        if (entry.reachable === false) return;

        const parts = key.split(',');
        const tx = +parts[0];
        const ty = +parts[1];
        const tz = +parts[2];
        if (tz !== npcZ) return;

        for (const desire of desires) {
            if (desire.match(entry.state)) {
                const dist = Math.max(Math.abs(tx - npcX), Math.abs(ty - npcY));
                const score = desire.weight / Math.max(dist, 1);
                results.push({ x: tx, y: ty, z: tz, weight: desire.weight, dist, score });
                break;
            }
        }
    });

    results.sort((a, b) => b.score - a.score);
    return results;
}

/**
 * Walkable tile to path toward a remembered desire (e.g. stove blocks its cell).
 * @param {TaskContext} ctx
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {{ x: number, y: number, z: number } | null}
 */
function resolveDesireDestination(ctx, tx, ty, tz) {
    const { world, npc } = ctx;
    if (world.isWalkable(tx, ty, tz)) {
        return { x: tx, y: ty, z: tz };
    }
    return findApproachTile(world, npc, { x: tx, y: ty, z: tz });
}

// ── Timed actions ───────────────────────────────────────────────────────────

/**
 * Start a timed action on an adjacent tile and wait for it to finish.
 *
 * The engine's `tickNpcSimulation` ticks the action each frame (advancing
 * elapsed time, checking validity).  We just poll `isBusy()` via nextTick.
 *
 * @param {TaskContext} ctx
 * @param {string} actionId   e.g. `'clear_grass'`
 * @param {number} tx
 * @param {number} ty
 * @returns {Promise<string>} An `ActionResult.*` value.
 */
export async function doTimedAction(ctx, actionId, tx, ty) {
    const { npc } = ctx;
    const startHealth = npc.health;

    const result = npc.timedAction.start(actionId, ctx.world, tx, ty);
    if (!result.ok) return ActionResult.FAILED;

    while (npc.timedAction.isBusy()) {
        await ctx.nextTick();
        if (npc._dead || npc.health < startHealth) return ActionResult.TOOK_DAMAGE;
    }
    return ActionResult.COMPLETED;
}

// ── Utilities ───────────────────────────────────────────────────────────────

/**
 * Count how many of a given object type the NPC is carrying.
 * @param {NpcEntity} npc
 * @param {number} objType  e.g. `Obj.WHEAT_SEED`
 * @returns {number}
 */
export function inventoryCount(npc, objType) {
    if (!npc.inventory) return 0;
    const stack = npc.inventory.find(s => s.objType === objType);
    return stack ? stack.count : 0;
}

/**
 * Pick a random walkable tile near home and walk there (single trip).
 * Useful as a fallback when a behavior has nothing specific to do — the
 * movement expands perception coverage.
 *
 * @param {TaskContext} ctx
 * @param {number} maxTicks
 * @returns {Promise<string>} A `MoveResult.*` value.
 */
export async function wanderOnce(ctx, maxTicks) {
    const { npc } = ctx;
    const radius = npc.wanderRadius ?? 10;
    for (let attempt = 0; attempt < 10; attempt++) {
        const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
        const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
        if (!ctx.world.isWalkable(gx, gy, npc.homeZ)) continue;
        return await moveTowardLocation(ctx, gx, gy, maxTicks);
    }
    await ctx.nextTick();
    return MoveResult.IMPOSSIBLE;
}

// ── Default behavior ────────────────────────────────────────────────────────

/**
 * Simple wander loop — pick a random walkable tile near home and walk there.
 * Used as the default behavior when no custom one is provided.
 *
 * @param {TaskContext} ctx
 */
export async function defaultWanderBehavior(ctx) {
    while (true) {
        const { npc } = ctx;
        if (npc._dead) return;

        const radius = npc.wanderRadius ?? 10;
        let moved = false;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            if (!ctx.world.isWalkable(gx, gy, npc.homeZ)) continue;
            await moveTowardLocation(ctx, gx, gy, 200);
            moved = true;
            break;
        }
        if (!moved) await ctx.nextTick();
    }
}
