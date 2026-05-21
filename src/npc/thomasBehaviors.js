/**
 * High-level behaviors for ThomasBrain.
 *
 * A behavior is an `async (ctx) => {}` that drives an NPC using task
 * primitives.  Pass one to the ThomasBrain constructor.
 */
import { Obj } from '../world/tileTypes.js';
import { canPlaceAmbientPlantOnTerrain, isWheatCropObject } from '../world/tileTypes.js';
import { canPlantWheatAt, harvestWheatAtTile, isWheatMature, plantWheatSeedAtTile } from '../domain/crops.js';
import { pickUpAtTile } from '../domain/entityActions.js';
import {
    SeekResult,
    inventoryCount,
    seekKnownDesires,
    wanderOnce,
} from './thomasTasks.js';

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

        const seedCount = inventoryCount(npc, Obj.WHEAT_SEED);

        /** @type {Desire[]} */
        const desires = [];

        desires.push({
            match: s => isWheatCropObject(s.obj) && s.cropStage >= 3,
            weight: 2,
        });

        if (seedCount < 10) {
            desires.push({
                match: s => s.obj === Obj.WHEAT_SEED,
                weight: 1.5,
            });
        }

        if (seedCount > 0) {
            desires.push({
                match: s => !s.obj && canPlaceAmbientPlantOnTerrain(s.terrain),
                weight: 1,
            });
        }

        const goalDesc = seedCount > 0
            ? `Farming (${seedCount} seeds)`
            : 'Looking for seeds';
        ctx.setStatus(`Seeking: ${goalDesc}`);

        const result = await seekKnownDesires(ctx, desires, 500);

        switch (result) {
            case SeekResult.ARRIVED:
                ctx.setStatus('Working…');
                interactAtCurrentTile(ctx);
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
 * world, not memory) and perform the appropriate instant action.
 * @param {TaskContext} ctx
 */
function interactAtCurrentTile(ctx) {
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

    if (tile.obj === Obj.WHEAT_SEED) {
        pickUpAtTile(npc, world, tx, ty, tz);
        return;
    }

    if (canPlantWheatAt(world, tx, ty, tz) && inventoryCount(npc, Obj.WHEAT_SEED) > 0) {
        plantWheatSeedAtTile(npc, world, tx, ty, gameTime, tz);
    }
}
