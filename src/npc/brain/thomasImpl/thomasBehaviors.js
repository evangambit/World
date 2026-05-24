/**
 * High-level behaviors for ThomasBrain.
 *
 * A behavior is an `async (ctx) => {}` that drives an NPC using task
 * primitives.  Pass one to the ThomasBrain constructor.
 */
import { T, Obj, WHEAT_CROP_STAGES, isStoveObject, isWheatCropObject } from '../../../world/tileTypes.js';
import { canPlantWheatAt, harvestWheatAtTile, isWheatMature, plantWheatSeedAtTile, wheatStageForTile } from '../../../domain/crops.js';
import { cookAtStove } from '../../../domain/entityActions.js';
import { consumeFoodFromInventory } from '../../../domain/vitality.js';
import {
    SeekResult,
    doTimedAction,
    inventoryCount,
    seekKnownDesires,
    wanderOnce,
} from './thomasTasks.js';

/** Eat bread when hunger is above this (0 = full, 100 = starving). */
const HUNGER_EAT_BREAD_THRESHOLD = 30;

/** @typedef {import('./thomasTasks.js').TaskContext} TaskContext */
/** @typedef {import('./thomasTasks.js').Desire} Desire */

/**
 * Farming behavior — harvest mature wheat, collect seeds, plant on open ground.
 * Falls back to wandering when memory has nothing useful (which expands
 * perception coverage and may discover new resources).
 *
 * @param {TaskContext} ctx
 */
export async function farmBehavior(ctx) {
    while (true) {
        const { npc } = ctx;
        if (npc._dead) return;

        const breadCount = inventoryCount(npc, Obj.BREAD);
        if (npc.hunger > HUNGER_EAT_BREAD_THRESHOLD && breadCount > 0) {
            ctx.setStatus('Eating bread');
            consumeFoodFromInventory(npc, Obj.BREAD);
            await ctx.nextTick();
            continue;
        }

        const wheatCount = inventoryCount(npc, Obj.WHEAT);
        if (wheatCount > 1 && breadCount < 5) {
            ctx.setStatus(`Baking bread (${wheatCount} wheat)`);
            const bakeResult = await seekKnownDesires(
                ctx,
                [{ match: (s) => s.obj === Obj.STOVE, weight: 3 }],
                500,
            );
            switch (bakeResult) {
                case SeekResult.ARRIVED:
                    tryCookBreadAtAdjacentStove(ctx);
                    await ctx.nextTick();
                    break;
                case SeekResult.NO_KNOWN_REACHABLE:
                    ctx.setStatus('Looking for a stove');
                    await wanderOnce(ctx, 200);
                    break;
                case SeekResult.TOOK_DAMAGE:
                    return;
                case SeekResult.MAX_TICKS:
                    break;
            }
            continue;
        }

        const seedCount = inventoryCount(npc, Obj.WHEAT_SEED);

        /** @type {Desire[]} */
        const desires = [];

        desires.push({
            match: s => isWheatCropObject(s.obj) && wheatStageForTile(s, ctx.gameTime) >= WHEAT_CROP_STAGES - 1,
            weight: 2,
        });

        if (seedCount > 0) {
            desires.push({
                match: s => !s.obj && s.terrain === T.DIRT,
                weight: 1,
            });
            desires.push({
                match: s => s.terrain === T.TALL_GRASS && !s.obj,
                weight: 0.5,
            });
        }

        if (wheatCount > 0) {
            desires.push({
                match: s => s.obj === Obj.STOVE,
                weight: 1.5,
            });
        }

        const goalDesc = seedCount > 0
            ? `Farming (${seedCount} seeds)`
            : 'Looking for wheat';
        ctx.setStatus(`Seeking: ${goalDesc}`);

        const result = await seekKnownDesires(ctx, desires, 500);

        switch (result) {
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
                await wanderOnce(ctx, 200);
                break;

            case SeekResult.TOOK_DAMAGE:
                return;

            case SeekResult.MAX_TICKS:
                break;
        }
    }
}

/**
 * After arriving at a desired tile, figure out what's actually here (live
 * world, not memory) and perform the appropriate action.
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
        await doTimedAction(ctx, 'clear_grass', tx, ty);
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
            const cooked = cookAtStove(npc, world, px + dx, py + dy);
            if (cooked === 'bread') return true;
        }
    }
    return false;
}
