/**
 * High-level task functions for Carol's brain.
 *
 * Each task runs on RealCarolContext (live) or HypotheticalCarolContext (planning)
 * via the same async function body.
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
import { World3D } from '../../world/world.js';
import { MemoryWorldView } from '../npcMemoryWorld.js';
import { MoveResult, SeekResult, ActionResult, inventoryCount } from '../thomasTasks.js';

/** @typedef {import('./carolContext.js').RealCarolContext} RealCarolContext */
/** @typedef {import('./carolContext.js').HypotheticalCarolContext} HypotheticalCarolContext */
/** @typedef {RealCarolContext | HypotheticalCarolContext} CarolContext */
/** @typedef {import('../thomasTasks.js').Desire} Desire */

const HUNGER_EAT_THRESHOLD = 30;
const MAX_BREAD_STOCK = 5;
const CLEAR_GRASS_TICKS = 100;

const EAT_FOOD_TYPES = [Obj.STEAK, Obj.BREAD];

const EXPLORE_DIRECTIONS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** @param {CarolContext} ctx */
function pickEdibleFood(ctx) {
    for (const objType of EAT_FOOD_TYPES) {
        if (ctx.isHypothetical) {
            if (ctx.inventoryCount(objType) > 0) return objType;
        } else if (inventoryCount(ctx.npc, objType) > 0) {
            return objType;
        }
    }
    return null;
}

/**
 * Eat steak or bread while hungry.
 *
 * @param {CarolContext} ctx
 * @param {number} endTick
 */
export async function eatFoodTask(ctx, endTick) {
    while (ctx.tickCount < endTick) {
        if (!ctx.isActive()) return;
        if (!ctx.isHypothetical && ctx.npc._dead) return;

        const food = pickEdibleFood(ctx);
        const hungry = ctx.isHypothetical
            ? ctx.hunger > HUNGER_EAT_THRESHOLD
            : ctx.npc.hunger > HUNGER_EAT_THRESHOLD;

        if (!hungry || !food) return;

        ctx.setStatus(food === Obj.STEAK ? 'Eating steak' : 'Eating bread');

        if (ctx.isHypothetical) {
            ctx.adjustInventory(food, -1);
            ctx.adjustHunger(-getFoodNutrition(food));
        } else {
            consumeFoodFromInventory(ctx.npc, food);
        }

        await ctx.nextTick();
    }
}

/**
 * Farm wheat, bake bread, and cook uncooked steak.
 *
 * @param {CarolContext} ctx
 * @param {number} endTick
 */
export async function farmAndBakeTask(ctx, endTick) {
    while (ctx.tickCount < endTick) {
        if (!ctx.isActive()) return;
        if (!ctx.isHypothetical && ctx.npc._dead) return;

        const before = ctx.tickCount;
        await farmAndBakeStep(ctx, endTick);

        // Guard against a step that made no time progress (e.g. seek/wander
        // failed on a hypothetical context) to prevent infinite loops during
        // scheduler evaluation.
        if (ctx.tickCount === before) {
            await ctx.nextTick();
        }
    }
}

/**
 * One iteration of the farming priority loop.
 *
 * @param {CarolContext} ctx
 * @param {number} endTick
 */
async function farmAndBakeStep(ctx, endTick) {
        const wheatCount = ctx.isHypothetical
            ? ctx.inventoryCount(Obj.WHEAT)
            : inventoryCount(ctx.npc, Obj.WHEAT);
        const breadCount = ctx.isHypothetical
            ? ctx.inventoryCount(Obj.BREAD)
            : inventoryCount(ctx.npc, Obj.BREAD);
        const uncookedCount = ctx.isHypothetical
            ? ctx.inventoryCount(Obj.UNCOOKED_STEAK)
            : inventoryCount(ctx.npc, Obj.UNCOOKED_STEAK);

        if (uncookedCount > 0) {
            ctx.setStatus(`Cooking meat (${uncookedCount} raw)`);
            const seekResult = await ctx.seekDesires(
                [{ match: s => s.obj === Obj.STOVE, weight: 3 }],
                Math.min(500, endTick - ctx.tickCount),
            );
            switch (seekResult) {
                case SeekResult.ARRIVED:
                    if (ctx.isHypothetical) {
                        ctx.adjustInventory(Obj.UNCOOKED_STEAK, -1);
                        ctx.adjustInventory(Obj.STEAK, +1);
                        await ctx.nextTick();
                    } else if (tryCookMeatAtAdjacentStove(ctx)) {
                        await ctx.nextTick();
                    } else {
                        await ctx.nextTick();
                    }
                    break;
                case SeekResult.NO_KNOWN_REACHABLE:
                    ctx.setStatus('Looking for a stove');
                    await ctx.wander(Math.min(200, endTick - ctx.tickCount));
                    break;
                default:
                    return;
            }
            return;
        }

        if (wheatCount > 1 && breadCount < MAX_BREAD_STOCK) {
            ctx.setStatus(`Baking bread (${wheatCount} wheat)`);
            const seekResult = await ctx.seekDesires(
                [{ match: s => s.obj === Obj.STOVE, weight: 3 }],
                Math.min(500, endTick - ctx.tickCount),
            );
            switch (seekResult) {
                case SeekResult.ARRIVED:
                    if (ctx.isHypothetical) {
                        ctx.adjustInventory(Obj.WHEAT, -1);
                        ctx.adjustInventory(Obj.BREAD, +1);
                        await ctx.nextTick();
                    } else if (tryCookBreadAtAdjacentStove(ctx)) {
                        await ctx.nextTick();
                    } else {
                        await ctx.nextTick();
                    }
                    break;
                case SeekResult.NO_KNOWN_REACHABLE:
                    ctx.setStatus('Looking for a stove');
                    await ctx.wander(Math.min(200, endTick - ctx.tickCount));
                    break;
                default:
                    return;
            }
            return;
        }

        const seedCount = ctx.isHypothetical
            ? ctx.inventoryCount(Obj.WHEAT_SEED)
            : inventoryCount(ctx.npc, Obj.WHEAT_SEED);

        /** @type {Desire[]} */
        const desires = [];

        desires.push({
            match: s =>
                isWheatCropObject(s.obj) &&
                wheatStageForTile(s, ctx.gameTime) >= WHEAT_CROP_STAGES - 1,
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
            desires.push({ match: s => s.obj === Obj.STOVE, weight: 1.5 });
        }

        if (desires.length === 0) {
            ctx.setStatus('Exploring');
            await ctx.wander(Math.min(200, endTick - ctx.tickCount));
            return;
        }

        const goalDesc = seedCount > 0 ? `Farming (${seedCount} seeds)` : 'Looking for wheat';
        ctx.setStatus(`Seeking: ${goalDesc}`);

        const seekResult = await ctx.seekDesires(
            desires,
            Math.min(500, endTick - ctx.tickCount),
        );

        switch (seekResult) {
            case SeekResult.ARRIVED:
                ctx.setStatus('Working…');
                await interactAtCurrentTile(ctx);
                if (!ctx.isHypothetical && inventoryCount(ctx.npc, Obj.WHEAT) > 0) {
                    tryCookBreadAtAdjacentStove(ctx);
                }
                await ctx.nextTick();
                break;
            case SeekResult.NO_KNOWN_REACHABLE:
                ctx.setStatus('Exploring');
                await ctx.wander(Math.min(200, endTick - ctx.tickCount));
                break;
            default:
                return;
        }
}

/**
 * Walk toward unknown territory in the best-scoring direction.
 *
 * @param {CarolContext} ctx
 * @param {number} endTick
 */
export async function exploreTask(ctx, endTick) {
    ctx.setStatus('Exploring');

    const { direction: [dx, dy] } = pickBestExploreDirection(ctx, endTick);
    await executeExploreRay(ctx, dx, dy, endTick);
}

/**
 * Do nothing until endTick (baseline for utility comparison).
 *
 * @param {CarolContext} ctx
 * @param {number} endTick
 */
export async function idleTask(ctx, endTick) {
    ctx.setStatus('Idle');
    while (ctx.tickCount < endTick) {
        if (!ctx.isActive()) return;
        if (!ctx.isHypothetical && ctx.npc._dead) return;
        await ctx.nextTick();
    }
}

/**
 * @param {CarolContext} ctx
 * @param {number} endTick
 * @returns {{ direction: [number, number], score: number }}
 */
function pickBestExploreDirection(ctx, endTick) {
    let bestDir = /** @type {[number, number]} */ (EXPLORE_DIRECTIONS[0]);
    let bestScore = -Infinity;

    for (const [dx, dy] of EXPLORE_DIRECTIONS) {
        const branch = ctx.hypothetical();
        simulateExploreRay(branch, dx, dy, endTick);
        const score = branch.utility();
        if (score > bestScore) {
            bestScore = score;
            bestDir = [dx, dy];
        }
    }

    return { direction: bestDir, score: bestScore };
}

/**
 * @param {CarolContext} ctx
 * @param {number} startX
 * @param {number} startY
 * @param {number} dx
 * @param {number} dy
 * @param {number} endTick
 */
function simulateExploreRay(ctx, startX, startY, dx, dy, endTick) {
    const memWorld = new MemoryWorldView(ctx.tileMemory);
    const z = ctx.z;
    let x = startX;
    let y = startY;

    while (ctx.tickCount < endTick) {
        const nx = x + dx;
        const ny = y + dy;
        const key = World3D.key(nx, ny, z);

        if (!ctx.tileMemory.has(key)) {
            ctx.simMove(nx, ny, endTick);
            ctx.addDiscoveredTile(nx, ny, endTick);
            return;
        }

        if (!memWorld.isWalkable(nx, ny, z)) return;

        if (ctx.simDirectStep(nx, ny, endTick) !== MoveResult.ARRIVED) return;

        x = nx;
        y = ny;

        if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) >= ctx.wanderRadius) {
            return;
        }
    }
}

/**
 * @param {CarolContext} ctx
 * @param {number} dx
 * @param {number} dy
 * @param {number} endTick
 */
async function executeExploreRay(ctx, dx, dy, endTick) {
    const memWorld = new MemoryWorldView(ctx.tileMemory);
    const z = ctx.z;
    const startX = ctx.x;
    const startY = ctx.y;
    let x = ctx.x;
    let y = ctx.y;

    while (ctx.tickCount < endTick) {
        if (!ctx.isActive()) return;
        if (!ctx.isHypothetical && ctx.npc._dead) return;

        const nx = x + dx;
        const ny = y + dy;
        const key = World3D.key(nx, ny, z);

        if (!ctx.tileMemory.has(key)) {
            ctx.setStatus('Exploring unknown');
            if (ctx.isHypothetical) {
                ctx.simMove(nx, ny, endTick);
                ctx.addDiscoveredTile(nx, ny, endTick);
            } else {
                await ctx.moveToward(nx, ny, endTick - ctx.tickCount);
            }
            return;
        }

        if (!memWorld.isWalkable(nx, ny, z)) return;

        ctx.setStatus('Exploring');
        if (ctx.isHypothetical) {
            if (ctx.simDirectStep(nx, ny, endTick) !== MoveResult.ARRIVED) return;
            x = ctx.x;
            y = ctx.y;
        } else {
            const step = await ctx.moveToward(nx, ny, endTick - ctx.tickCount);
            if (step !== MoveResult.ARRIVED) return;
            x = Math.floor(ctx.npc.x);
            y = Math.floor(ctx.npc.y);
        }

        if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) >= ctx.wanderRadius) {
            return;
        }
    }
}

/** @param {CarolContext} ctx */
async function interactAtCurrentTile(ctx) {
    if (ctx.isHypothetical) {
        simInteractAtCurrentTile(ctx);
        return;
    }

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
        await ctx.doAction('clear_grass', tx, ty);
        return;
    }

    if (canPlantWheatAt(world, tx, ty, tz) && inventoryCount(npc, Obj.WHEAT_SEED) > 0) {
        plantWheatSeedAtTile(npc, world, tx, ty, gameTime, tz);
    }
}

/** @param {CarolContext} ctx */
function simInteractAtCurrentTile(ctx) {
    if (!ctx.isHypothetical) return;
    const { tileMemory } = ctx;
    const px = ctx.x;
    const py = ctx.y;
    const pz = ctx.z;

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const key = `${px + dx},${py + dy},${pz}`;
            const entry = tileMemory.get(key);
            if (!entry) continue;
            const s = entry.state;

            if (
                isWheatCropObject(s.obj) &&
                wheatStageForTile(s, ctx.gameTime) >= WHEAT_CROP_STAGES - 1
            ) {
                ctx.adjustInventory(Obj.WHEAT, +1);
                ctx.adjustInventory(Obj.WHEAT_SEED, +2);
                return;
            }

            if (s.terrain === T.TALL_GRASS && !s.obj) {
                void ctx.doAction('clear_grass', px + dx, py + dy, CLEAR_GRASS_TICKS);
                ctx.adjustInventory(Obj.WHEAT_SEED, +1);
                return;
            }

            if (!s.obj && s.terrain === T.DIRT && ctx.inventoryCount(Obj.WHEAT_SEED) > 0) {
                ctx.adjustInventory(Obj.WHEAT_SEED, -1);
                return;
            }

            if (s.obj === Obj.STOVE && ctx.inventoryCount(Obj.WHEAT) > 0) {
                ctx.adjustInventory(Obj.WHEAT, -1);
                ctx.adjustInventory(Obj.BREAD, +1);
                return;
            }
        }
    }
}

/** @param {RealCarolContext} ctx @returns {boolean} */
function tryCookMeatAtAdjacentStove(ctx) {
    const { npc, world } = ctx;
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    const z = npc.z;

    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const tile = world.getTile(px + dx, py + dy, z);
            if (!tile || !isStoveObject(tile.obj)) continue;
            if (cookAtStove(npc, world, px + dx, py + dy) === 'steak') return true;
        }
    }
    return false;
}

/** @param {RealCarolContext} ctx @returns {boolean} */
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
