/**
 * High-level task classes for Bob's brain.
 *
 * Each class bundles a simulate/execute pair for one high-level goal.
 * simulate() returns a SimResult consumed by BobBrain's scheduler.
 * execute() is an async coroutine that runs the real behavior.
 *
 * These compose the primitive task classes from bobTasks.js the same way
 * the execute path today composes moveTowardLocation / seekKnownDesires.
 */
import {
    T,
    Obj,
    WHEAT_CROP_STAGES,
    isStoveObject,
    isWheatCropObject,
} from '../../world/tileTypes.js';
import {
    canPlantWheatAt,
    harvestWheatAtTile,
    isWheatMature,
    plantWheatSeedAtTile,
    wheatStageForTile,
} from '../../domain/crops.js';
import { cookAtStove } from '../../domain/entityActions.js';
import { consumeFoodFromInventory, getFoodNutrition } from '../../domain/vitality.js';
import {
    SeekResult,
    MoveResult,
    ActionResult,
    inventoryCount,
} from '../thomasTasks.js';
import {
    SeekDesiresTask,
    WanderTask,
    TimedActionTask,
} from './bobTasks.js';

/** @typedef {import('./bobContext.js').SimContext} SimContext */
/** @typedef {import('./bobContext.js').SimResult} SimResult */
/** @typedef {import('../thomasTasks.js').TaskContext} TaskContext */

// ── Domain constants ──────────────────────────────────────────────────────────

/** NPC eats bread when hunger exceeds this (0 = full, 100 = starving). */
const HUNGER_EAT_THRESHOLD = 30;

/** Max bread to carry before skipping surplus-baking. */
const MAX_BREAD_STOCK = 5;

/**
 * Estimated ticks for the clear_grass timed action.
 * Action takes 5 game-seconds; at dt=0.05 that is 100 ticks.
 */
const CLEAR_GRASS_TICKS = 100;

/** Estimated ticks to eat one item (instant action + one frame). */
const EAT_TICKS = 1;

// ── EatFoodTask ───────────────────────────────────────────────────────────────

/**
 * Eat bread from inventory when hungry.
 *
 * simulate: consumes projected bread and reduces projected hunger while
 *   hunger stays above the threshold and bread remains.
 * execute: same rule against live NPC state until endTick or no longer hungry.
 */
export class EatFoodTask {
    /** @param {number} endTick */
    constructor(endTick) {
        this.endTick = endTick;
    }

    /** @param {SimContext} simCtx @returns {SimResult} */
    simulate(simCtx) {
        const nutrition = getFoodNutrition(Obj.BREAD);

        while (
            simCtx.currentTick < this.endTick &&
            simCtx.projectedHunger > HUNGER_EAT_THRESHOLD &&
            simCtx.inventoryCount(Obj.BREAD) > 0
        ) {
            simCtx.adjustInventory(Obj.BREAD, -1);
            simCtx.adjustHunger(-nutrition);
            simCtx.currentTick += EAT_TICKS;
            simCtx.elapsedTicks += EAT_TICKS;
        }

        return simCtx.toResult();
    }

    /** @param {TaskContext} ctx */
    async execute(ctx) {
        while (ctx.tickCount < this.endTick) {
            const { npc } = ctx;
            if (npc._dead) return;

            const breadCount = inventoryCount(npc, Obj.BREAD);
            if (npc.hunger <= HUNGER_EAT_THRESHOLD || breadCount === 0) {
                return;
            }

            ctx.setStatus('Eating bread');
            consumeFoodFromInventory(npc, Obj.BREAD);
            await ctx.nextTick();
        }
    }
}

// ── FarmAndBakeTask ───────────────────────────────────────────────────────────

/**
 * Farm wheat, collect seeds, and bake bread.
 *
 * simulate: runs a multi-step farming loop against projected state,
 *   advancing currentTick and mutating projectedInventory on each action.
 *   Loops until endTick is reached or no progress can be made.
 *
 * execute: same priority-ordered loop as Thomas's farmBehavior, respecting
 *   endTick as the outer deadline.
 */
export class FarmAndBakeTask {
    /** @param {number} endTick */
    constructor(endTick) {
        this.endTick = endTick;
    }

    /** @param {SimContext} simCtx @returns {SimResult} */
    simulate(simCtx) {
        while (simCtx.currentTick < this.endTick) {
            const before = simCtx.currentTick;
            this._simStep(simCtx);
            // Guard against a step that made no time progress to prevent
            // infinite loops when nothing is reachable.
            if (simCtx.currentTick === before) {
                simCtx.currentTick++;
                simCtx.elapsedTicks++;
            }
        }
        return simCtx.toResult();
    }

    /**
     * Simulate one iteration of the farming priority loop.
     * @param {SimContext} simCtx
     */
    _simStep(simCtx) {
        // ── Bake bread if surplus wheat ───────────────────────────────────────
        const wheatCount = simCtx.inventoryCount(Obj.WHEAT);
        const breadCount = simCtx.inventoryCount(Obj.BREAD);

        if (wheatCount > 1 && breadCount < MAX_BREAD_STOCK) {
            const seek = new SeekDesiresTask(this.endTick, [
                { match: s => s.obj === Obj.STOVE, weight: 3 },
            ]);
            if (seek.simulate(simCtx) === SeekResult.ARRIVED) {
                simCtx.adjustInventory(Obj.WHEAT, -1);
                simCtx.adjustInventory(Obj.BREAD, +1);
            }
            return;
        }

        // ── Build desire list based on projected inventory ────────────────────
        const seedCount = simCtx.inventoryCount(Obj.WHEAT_SEED);

        /** @type {import('../thomasTasks.js').Desire[]} */
        const desires = [];

        // Mature crops → harvest (+1 wheat, +2 seeds)
        desires.push({
            match: s =>
                isWheatCropObject(s.obj) &&
                wheatStageForTile(s, simCtx.gameTime) >= WHEAT_CROP_STAGES - 1,
            weight: 2,
        });

        if (seedCount > 0) {
            // Empty dirt → plant (-1 seed)
            desires.push({
                match: s => !s.obj && s.terrain === T.DIRT,
                weight: 1,
            });
            // Tall grass → clear for seeds (timed action, +1 seed)
            desires.push({
                match: s => s.terrain === T.TALL_GRASS && !s.obj,
                weight: 0.5,
            });
        }

        if (wheatCount > 0) {
            desires.push({ match: s => s.obj === Obj.STOVE, weight: 1.5 });
        }

        if (desires.length === 0) {
            // Nothing to do — wander to expand perception.
            new WanderTask(this.endTick).simulate(simCtx);
            return;
        }

        const seek = new SeekDesiresTask(this.endTick, desires);
        if (seek.simulate(simCtx) !== SeekResult.ARRIVED) return;

        // ── Interact with whatever we arrived at ──────────────────────────────
        this._simInteract(simCtx);
    }

    /**
     * Model the inventory effect of interacting with the best-match tile at
     * the projected position.  We check tileMemory at the projected coords
     * rather than the live world so this stays heuristic.
     * @param {SimContext} simCtx
     */
    _simInteract(simCtx) {
        const { tileMemory, projectedX: px, projectedY: py, projectedZ: pz } = simCtx;
        // Scan projected position and immediate neighbors for a match in memory.
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const key = `${px + dx},${py + dy},${pz}`;
                const entry = tileMemory.get(key);
                if (!entry) continue;
                const s = entry.state;

                if (
                    isWheatCropObject(s.obj) &&
                    wheatStageForTile(s, simCtx.gameTime) >= WHEAT_CROP_STAGES - 1
                ) {
                    // Harvest: +1 wheat, +2 seeds (matches harvestWheatAtTile)
                    simCtx.adjustInventory(Obj.WHEAT, +1);
                    simCtx.adjustInventory(Obj.WHEAT_SEED, +2);
                    return;
                }

                if (s.terrain === T.TALL_GRASS && !s.obj) {
                    // Clear grass: timed action, conservatively +1 seed
                    const action = new TimedActionTask(
                        this.endTick,
                        'clear_grass',
                        px + dx,
                        py + dy,
                        CLEAR_GRASS_TICKS,
                    );
                    if (action.simulate(simCtx) === ActionResult.COMPLETED) {
                        simCtx.adjustInventory(Obj.WHEAT_SEED, +1);
                    }
                    return;
                }

                if (!s.obj && s.terrain === T.DIRT && simCtx.inventoryCount(Obj.WHEAT_SEED) > 0) {
                    // Plant: instant, -1 seed
                    simCtx.adjustInventory(Obj.WHEAT_SEED, -1);
                    return;
                }

                if (s.obj === Obj.STOVE && simCtx.inventoryCount(Obj.WHEAT) > 0) {
                    // Bake: instant once adjacent, -1 wheat +1 bread
                    simCtx.adjustInventory(Obj.WHEAT, -1);
                    simCtx.adjustInventory(Obj.BREAD, +1);
                    return;
                }
            }
        }
    }

    // ── execute ───────────────────────────────────────────────────────────────

    /** @param {TaskContext} ctx */
    async execute(ctx) {
        while (ctx.tickCount < this.endTick) {
            const { npc } = ctx;
            if (npc._dead) return;

            // Bake bread if surplus wheat.
            const wheatCount = inventoryCount(npc, Obj.WHEAT);
            const breadCount = inventoryCount(npc, Obj.BREAD);
            if (wheatCount > 1 && breadCount < MAX_BREAD_STOCK) {
                ctx.setStatus(`Baking bread (${wheatCount} wheat)`);
                const seek = new SeekDesiresTask(
                    Math.min(ctx.tickCount + 500, this.endTick),
                    [{ match: s => s.obj === Obj.STOVE, weight: 3 }],
                );
                switch (await seek.execute(ctx)) {
                    case SeekResult.ARRIVED:
                        tryCookBreadAtAdjacentStove(ctx);
                        await ctx.nextTick();
                        break;
                    case SeekResult.NO_KNOWN_REACHABLE:
                        ctx.setStatus('Looking for a stove');
                        await new WanderTask(Math.min(ctx.tickCount + 200, this.endTick)).execute(ctx);
                        break;
                    case SeekResult.TOOK_DAMAGE:
                        return;
                    default:
                        break;
                }
                continue;
            }

            // Farm.
            const seedCount = inventoryCount(npc, Obj.WHEAT_SEED);

            /** @type {import('../thomasTasks.js').Desire[]} */
            const desires = [];

            desires.push({
                match: s =>
                    isWheatCropObject(s.obj) &&
                    wheatStageForTile(s, ctx.gameTime) >= WHEAT_CROP_STAGES - 1,
                weight: 2,
            });

            if (seedCount > 0) {
                desires.push({ match: s => !s.obj && s.terrain === T.DIRT, weight: 1 });
                desires.push({ match: s => s.terrain === T.TALL_GRASS && !s.obj, weight: 0.5 });
            }

            if (wheatCount > 0) {
                desires.push({ match: s => s.obj === Obj.STOVE, weight: 1.5 });
            }

            const goalDesc = seedCount > 0 ? `Farming (${seedCount} seeds)` : 'Looking for wheat';
            ctx.setStatus(`Seeking: ${goalDesc}`);

            const seek = new SeekDesiresTask(
                Math.min(ctx.tickCount + 500, this.endTick),
                desires,
            );

            switch (await seek.execute(ctx)) {
                case SeekResult.ARRIVED:
                    ctx.setStatus('Working…');
                    await interactAtCurrentTile(ctx);
                    if (inventoryCount(npc, Obj.WHEAT) > 0) {
                        tryCookBreadAtAdjacentStove(ctx);
                    }
                    await ctx.nextTick();
                    break;
                case SeekResult.NO_KNOWN_REACHABLE:
                    ctx.setStatus('Exploring');
                    await new WanderTask(Math.min(ctx.tickCount + 200, this.endTick)).execute(ctx);
                    break;
                case SeekResult.TOOK_DAMAGE:
                    return;
                default:
                    break;
            }
        }
    }
}

// ── ExploreTask ───────────────────────────────────────────────────────────────

/**
 * Wander to expand perception coverage.
 *
 * simulate: delegates to WanderTask which counts unmapped tiles near the
 *   projected position as a proxy for tiles that would be discovered.
 * execute: delegates to WanderTask.execute (wanderOnce loop).
 */
export class ExploreTask {
    /** @param {number} endTick */
    constructor(endTick) {
        this.endTick = endTick;
    }

    /** @param {SimContext} simCtx @returns {SimResult} */
    simulate(simCtx) {
        while (simCtx.currentTick < this.endTick) {
            const before = simCtx.currentTick;
            new WanderTask(this.endTick).simulate(simCtx);
            if (simCtx.currentTick === before) {
                simCtx.currentTick++;
                simCtx.elapsedTicks++;
            }
        }
        return simCtx.toResult();
    }

    /** @param {TaskContext} ctx */
    async execute(ctx) {
        ctx.setStatus('Exploring');
        while (ctx.tickCount < this.endTick) {
            const { npc } = ctx;
            if (npc._dead) return;
            const result = await new WanderTask(
                Math.min(ctx.tickCount + 200, this.endTick),
            ).execute(ctx);
            if (result === MoveResult.TOOK_DAMAGE) return;
            await ctx.nextTick();
        }
    }
}

// ── IdleTask ──────────────────────────────────────────────────────────────────

/**
 * Stand still and do nothing until endTick.
 * Useful as a baseline in utility scoring — any productive task should
 * score higher than idle.
 */
export class IdleTask {
    /** @param {number} endTick */
    constructor(endTick) {
        this.endTick = endTick;
    }

    /** @param {SimContext} simCtx @returns {SimResult} */
    simulate(simCtx) {
        simCtx.elapsedTicks = this.endTick - simCtx.currentTick;
        simCtx.currentTick = this.endTick;
        return simCtx.toResult();
    }

    /** @param {TaskContext} ctx */
    async execute(ctx) {
        ctx.setStatus('Idle');
        while (ctx.tickCount < this.endTick) {
            if (ctx.npc._dead) return;
            await ctx.nextTick();
        }
    }
}

// ── Default utility function ──────────────────────────────────────────────────

/**
 * Score a SimResult for the scheduler.  Weights can be tuned per-NPC by
 * supplying a custom utility function to BobBrain instead.
 *
 * @param {SimResult} result
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @returns {number}
 */
export function defaultBobUtility(result, npc) {
    let score = 0;

    const breadDelta = result.netInventoryDelta[Obj.BREAD] ?? 0;
    const wheatDelta = result.netInventoryDelta[Obj.WHEAT] ?? 0;
    const seedDelta  = result.netInventoryDelta[Obj.WHEAT_SEED] ?? 0;

    const hungerFactor = 1 + (npc.hunger ?? 0) / 100;

    // Hunger relief from eating (negative netHungerDelta = hunger went down).
    const hungerRelief = -(result.netHungerDelta ?? 0);
    score += hungerRelief * hungerFactor;

    // Gaining food in inventory (farming / baking), not consuming it to eat.
    if (breadDelta > 0) score += breadDelta * 10 * hungerFactor;
    score += wheatDelta * 3;
    score += seedDelta  * 1;

    // Exploration value decays as memory fills in.
    score += result.newTilesDiscovered * 0.2;

    return score;
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Interact with the live tile at or adjacent to the NPC's current position.
 * @param {TaskContext} ctx
 */
async function interactAtCurrentTile(ctx) {
    const { npc, world, gameTime } = ctx;
    const tx = Math.floor(npc.x);
    const ty = Math.floor(npc.y);
    const tz = npc.z;
    const tile = world.getTile(tx, ty, tz);
    if (!tile) return;

    if (isWheatCropObject(tile.obj) && isWheatMature(tile, gameTime)) {
        harvestWheatAtTile(npc, world, tx, ty, gameTime, tz);
        return;
    }

    if (tile.terrain === T.TALL_GRASS && !tile.obj) {
        await new TimedActionTask(Infinity, 'clear_grass', tx, ty, CLEAR_GRASS_TICKS).execute(ctx);
        return;
    }

    if (canPlantWheatAt(world, tx, ty, tz) && inventoryCount(npc, Obj.WHEAT_SEED) > 0) {
        plantWheatSeedAtTile(npc, world, tx, ty, gameTime, tz);
    }
}

/**
 * Cook one wheat into bread using a stove on a neighboring tile.
 * @param {TaskContext} ctx
 * @returns {boolean}
 */
function tryCookBreadAtAdjacentStove(ctx) {
    const { npc, world } = ctx;
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    const z = npc.z;

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const tile = world.getTile(px + dx, py + dy, z);
            if (!tile || !isStoveObject(tile.obj)) continue;
            if (cookAtStove(npc, world, px + dx, py + dy) === 'bread') return true;
        }
    }
    return false;
}
