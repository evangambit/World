/**
 * Primitive task classes for Bob's brain.
 *
 * Each class bundles a simulate/execute pair for one low-level operation.
 * Higher-level task classes (bobBehaviors.js) compose these as sub-tasks.
 *
 * Conventions:
 *   - `endTick` is an absolute tick deadline set at construction.
 *   - `simulate(simCtx)` is synchronous and mutates simCtx in place.
 *     Returns a typed exit code (SeekResult.*, MoveResult.*).
 *   - `execute(ctx)` is async and returns the same typed exit code.
 *   - Sub-tasks inherit the parent's deadline:
 *       new SubTask(Math.min(subDeadline, this.endTick))
 */
import { findApproachTile } from '../npcTaskPrimitives.js';
import { MemoryWorldView } from '../npcMemoryWorld.js';
import {
    MoveResult,
    SeekResult,
    ActionResult,
    moveTowardLocation,
    seekKnownDesires,
    doTimedAction,
    wanderOnce,
    inventoryCount,
    findDesirableTiles,
} from '../thomasTasks.js';
import { SimContext } from './bobContext.js';

export { MoveResult, SeekResult, ActionResult, inventoryCount };

/** @typedef {import('../thomasTasks.js').TaskContext} TaskContext */
/** @typedef {import('../thomasTasks.js').Desire} Desire */

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Find a walkable tile to path toward a desired target.
 * Used by both SeekDesiresTask.simulate and the execute path.
 *
 * @param {SimContext} simCtx
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @returns {{ x: number, y: number, z: number } | null}
 */
function simResolveDestination(simCtx, tx, ty, tz) {
    const memWorld = new MemoryWorldView(simCtx.tileMemory);
    if (memWorld.isWalkable(tx, ty, tz)) return { x: tx, y: ty, z: tz };
    // findApproachTile only reads npc.x/y/z — duck-type it with projected coords.
    const fakeNpc = { x: simCtx.projectedX, y: simCtx.projectedY, z: simCtx.projectedZ };
    return findApproachTile(memWorld, fakeNpc, { x: tx, y: ty, z: tz });
}

// ── MoveTask ──────────────────────────────────────────────────────────────────

/**
 * Walk to a specific tile.
 * simulate: estimates path cost via A*.
 * execute: delegates to `moveTowardLocation`.
 */
export class MoveTask {
    /**
     * @param {number} endTick
     * @param {number} tx
     * @param {number} ty
     */
    constructor(endTick, tx, ty) {
        this.endTick = endTick;
        this.tx = tx;
        this.ty = ty;
    }

    /** @param {SimContext} simCtx @returns {string} MoveResult.* */
    simulate(simCtx) {
        return simCtx.simMove(this.tx, this.ty, this.endTick);
    }

    /** @param {TaskContext} ctx @returns {Promise<string>} MoveResult.* */
    execute(ctx) {
        return moveTowardLocation(ctx, this.tx, this.ty, this.endTick - ctx.tickCount);
    }
}

// ── SeekDesiresTask ───────────────────────────────────────────────────────────

/**
 * Search tile memory for desired tiles and walk toward the best match.
 * simulate: scans memory, finds approach tile, estimates path cost.
 * execute: delegates to `seekKnownDesires`.
 */
export class SeekDesiresTask {
    /**
     * @param {number} endTick
     * @param {Desire[]} desires
     */
    constructor(endTick, desires) {
        this.endTick = endTick;
        this.desires = desires;
    }

    /** @param {SimContext} simCtx @returns {string} SeekResult.* */
    simulate(simCtx) {
        const candidates = findDesirableTiles(
            { x: simCtx.projectedX, y: simCtx.projectedY, z: simCtx.projectedZ, tileMemory: simCtx.tileMemory },
            this.desires,
        );
        if (candidates.length === 0) return SeekResult.NO_KNOWN_REACHABLE;

        for (const candidate of candidates) {
            const dest = simResolveDestination(simCtx, candidate.x, candidate.y, candidate.z);
            if (!dest) continue;

            const result = simCtx.simMove(dest.x, dest.y, this.endTick);
            if (result === 'arrived') return SeekResult.ARRIVED;
            if (result === 'impossible') continue;
            // max_ticks
            return SeekResult.MAX_TICKS;
        }

        return SeekResult.NO_KNOWN_REACHABLE;
    }

    /** @param {TaskContext} ctx @returns {Promise<string>} SeekResult.* */
    execute(ctx) {
        return seekKnownDesires(ctx, this.desires, this.endTick - ctx.tickCount);
    }
}

// ── WanderTask ────────────────────────────────────────────────────────────────

/**
 * Take one random walk near home to expand perception coverage.
 * simulate: estimates travel ticks; counts tiles not yet in memory near
 *   projected position as a proxy for tiles that would be discovered.
 * execute: delegates to `wanderOnce`.
 */
export class WanderTask {
    /** @param {number} endTick */
    constructor(endTick) {
        this.endTick = endTick;
    }

    /** @param {SimContext} simCtx @returns {string} MoveResult.* */
    simulate(simCtx) {
        const dist = Math.max(1, Math.floor(simCtx.wanderRadius * 0.5));
        const px = simCtx.projectedX;
        const py = simCtx.projectedY;

        // Rank reachable candidates by how many unmapped tiles they would reveal.
        const candidates = [
            [px + dist, py],
            [px - dist, py],
            [px,        py + dist],
            [px,        py - dist],
        ]
            .filter(([tx, ty]) => simCtx.canReach(tx, ty))
            .sort((a, b) =>
                simCtx.countPotentialDiscoveries(b[0], b[1]) -
                simCtx.countPotentialDiscoveries(a[0], a[1]),
            );

        if (candidates.length === 0) return MoveResult.IMPOSSIBLE;
        return simCtx.simMove(candidates[0][0], candidates[0][1], this.endTick);
    }

    /** @param {TaskContext} ctx @returns {Promise<string>} MoveResult.* */
    execute(ctx) {
        return wanderOnce(ctx, this.endTick - ctx.tickCount);
    }
}

// ── TimedActionTask ───────────────────────────────────────────────────────────

/**
 * Perform a timed action on a specific tile.
 * simulate: advances currentTick by the estimated action duration.
 * execute: delegates to `doTimedAction`.
 */
export class TimedActionTask {
    /**
     * @param {number} endTick
     * @param {string} actionId
     * @param {number} tx
     * @param {number} ty
     * @param {number} estimatedTicks  Heuristic duration for the simulate path.
     */
    constructor(endTick, actionId, tx, ty, estimatedTicks) {
        this.endTick = endTick;
        this.actionId = actionId;
        this.tx = tx;
        this.ty = ty;
        this.estimatedTicks = estimatedTicks;
    }

    /** @param {SimContext} simCtx @returns {string} ActionResult.* */
    simulate(simCtx) {
        if (simCtx.currentTick + this.estimatedTicks > this.endTick) {
            return ActionResult.FAILED;
        }
        simCtx.currentTick += this.estimatedTicks;
        simCtx.elapsedTicks += this.estimatedTicks;
        return ActionResult.COMPLETED;
    }

    /** @param {TaskContext} ctx @returns {Promise<string>} ActionResult.* */
    execute(ctx) {
        return doTimedAction(ctx, this.actionId, this.tx, this.ty);
    }
}
