/**
 * High-level task functions for Carol's brain.
 *
 * Each task runs on RealCarolContext or HypotheticalCarolContext via the same
 * async function body — all real/hypo differences live in carolContext.js.
 */
import {
    T,
    Obj,
    WHEAT_CROP_STAGES,
    isWheatCropObject,
} from '../../world/tileTypes.js';
import { World3D } from '../../world/world.js';
import { MemoryWorldView } from '../npcMemoryWorld.js';
import { SeekResult } from '../thomasTasks.js';

/** @typedef {import('./carolContext.js').RealCarolContext} RealCarolContext */
/** @typedef {import('./carolContext.js').HypotheticalCarolContext} HypotheticalCarolContext */
/** @typedef {RealCarolContext | HypotheticalCarolContext} CarolContext */
/** @typedef {import('../thomasTasks.js').Desire} Desire */

const HUNGER_EAT_THRESHOLD = 30;
const MAX_BREAD_STOCK = 5;
const WHEAT_STAGE_SECONDS = 18;

const EAT_FOOD_TYPES = [Obj.STEAK, Obj.BREAD];

const EXPLORE_DIRECTIONS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** @param {import('../../world/world.js').TileData} state @param {number} gameTime */
function isMatureWheat(state, gameTime) {
    if (!isWheatCropObject(state.obj)) return false;
    const planted = state.cropPlantedAt ?? gameTime;
    const elapsed = Math.max(0, gameTime - planted);
    return Math.floor(elapsed / WHEAT_STAGE_SECONDS) >= WHEAT_CROP_STAGES - 1;
}

/** @param {CarolContext} ctx */
function pickEdibleFood(ctx) {
    for (const objType of EAT_FOOD_TYPES) {
        if (ctx.inventoryCount(objType) > 0) return objType;
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
        if (!ctx.isAlive()) return;

        const food = pickEdibleFood(ctx);
        if (ctx.hunger <= HUNGER_EAT_THRESHOLD || !food) return;

        ctx.setStatus(food === Obj.STEAK ? 'Eating steak' : 'Eating bread');
        ctx.eatFood(food);
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
        if (!ctx.isAlive()) return;

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
    const wheatCount = ctx.inventoryCount(Obj.WHEAT);
    const breadCount = ctx.inventoryCount(Obj.BREAD);
    const uncookedCount = ctx.inventoryCount(Obj.UNCOOKED_STEAK);

    if (uncookedCount > 0) {
        ctx.setStatus(`Cooking meat (${uncookedCount} raw)`);
        const seekResult = await ctx.seekDesires(
            [{ match: s => s.obj === Obj.STOVE, weight: 3 }],
            Math.min(500, endTick - ctx.tickCount),
        );
        switch (seekResult) {
            case SeekResult.ARRIVED:
                ctx.cookAtAdjacentStove('steak');
                await ctx.nextTick();
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
                ctx.cookAtAdjacentStove('bread');
                await ctx.nextTick();
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

    const seedCount = ctx.inventoryCount(Obj.WHEAT_SEED);

    /** @type {Desire[]} */
    const desires = [];

    desires.push({
        match: s => isMatureWheat(s, ctx.gameTime),
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
            await ctx.interactAt(ctx.x, ctx.y);
            if (ctx.inventoryCount(Obj.WHEAT) > 0) {
                ctx.cookAtAdjacentStove('bread');
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

    const { direction: [dx, dy] } = await pickBestExploreDirection(ctx, endTick);
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
        if (!ctx.isAlive()) return;
        await ctx.nextTick();
    }
}

/**
 * @param {CarolContext} ctx
 * @param {number} endTick
 * @returns {Promise<{ direction: [number, number], score: number }>}
 */
async function pickBestExploreDirection(ctx, endTick) {
    let bestDir = /** @type {[number, number]} */ (EXPLORE_DIRECTIONS[0]);
    let bestScore = -Infinity;

    for (const [dx, dy] of EXPLORE_DIRECTIONS) {
        const branch = ctx.hypothetical();
        await simulateExploreDirection(branch, dx, dy, endTick);
        const score = branch.utility();
        if (score > bestScore) {
            bestScore = score;
            bestDir = [dx, dy];
        }
    }

    return { direction: bestDir, score: bestScore };
}

/**
 * Cast a ray through known memory in (dx, dy) until the first absent tile.
 * Does not mutate ctx.
 *
 * @param {CarolContext} ctx
 * @param {number} dx
 * @param {number} dy
 * @returns {{ x: number, y: number } | null}
 */
function findFrontierTile(ctx, dx, dy) {
    const memWorld = new MemoryWorldView(ctx.tileMemory);
    const z = ctx.z;
    const startX = ctx.x;
    const startY = ctx.y;
    let x = startX;
    let y = startY;

    while (true) {
        const nx = x + dx;
        const ny = y + dy;
        const key = World3D.key(nx, ny, z);

        if (!ctx.tileMemory.has(key)) {
            return { x: nx, y: ny };
        }

        if (!memWorld.isWalkable(nx, ny, z)) return null;

        x = nx;
        y = ny;

        if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) >= ctx.wanderRadius) {
            return null;
        }
    }
}

/**
 * Simulate pathfinding to the frontier tile found by a direction ray.
 *
 * @param {CarolContext} ctx
 * @param {number} dx
 * @param {number} dy
 * @param {number} endTick
 */
async function simulateExploreDirection(ctx, dx, dy, endTick) {
    const frontier = findFrontierTile(ctx, dx, dy);
    if (!frontier) return;

    await ctx.moveToward(frontier.x, frontier.y, endTick - ctx.tickCount);
    ctx.addDiscoveredTile(frontier.x, frontier.y);
}

/**
 * Walk toward the frontier tile for the chosen direction.
 *
 * @param {CarolContext} ctx
 * @param {number} dx
 * @param {number} dy
 * @param {number} endTick
 */
async function executeExploreRay(ctx, dx, dy, endTick) {
    if (!ctx.isActive()) return;
    if (!ctx.isAlive()) return;

    const frontier = findFrontierTile(ctx, dx, dy);
    if (!frontier) return;

    ctx.setStatus('Exploring unknown');
    await ctx.moveToward(frontier.x, frontier.y, endTick - ctx.tickCount);
    ctx.addDiscoveredTile(frontier.x, frontier.y);
}
