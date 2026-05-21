/**
 * Behavioral regression tests for farmBehavior / ThomasBrain.
 *
 * Run with:  npm test
 *
 * The console line printed by each test is the primary regression signal.
 * Copy the numbers from a known-good run into the assertions below to lock in
 * expected behavior — tighten the bounds whenever you want stricter coverage.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildVillage } from '../content/builder.js';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { createThomasBrain } from './npcBrain.js';
import { inventoryCount } from './thomasTasks.js';
import { tickSimulation } from '../simulation/tickSimulation.js';
import { Obj } from '../world/tileTypes.js';

/**
 * Advance the simulation by `ticks` steps at `dt` seconds per tick.
 *
 * Each iteration yields the microtask queue via `await Promise.resolve()` so
 * that ThomasBrain's async behavior coroutine (which resolves one nextTick()
 * promise per tick) advances in lock-step with the engine.  Without this
 * yield, Promise continuations would only run after the entire loop finished.
 *
 * @param {import('../world/world.js').World3D} world
 * @param {import('../actors/npcSimulation.js').NpcEntity[]} npcs
 * @param {number} ticks
 * @param {number} [dt]
 * @returns {Promise<number>} final gameTime (seconds)
 */
async function runTicks(world, npcs, ticks, dt = 0.05) {
    let gameTime = 0;
    for (let i = 0; i < ticks; i++) {
        ({ gameTime } = tickSimulation({ world, gameTime, dt, npcs }));
        await Promise.resolve();
    }
    return gameTime;
}

describe('farmBehavior bread production over 10 000 ticks', () => {
    it('NPC bakes bread and survives the full run', async () => {
        const world = buildVillage();

        // Spawn inside Finn's cottage (9.5, 30.5).  The stove is 2 tiles south
        // at (9, 32) and immediately visible through Thomas perception (radius 5,
        // no obstructions between them inside the building interior).
        //
        // Starting inventory:
        //   5 wheat  — wheat > 1 triggers the baking loop on the first tick,
        //              so bread production begins before hunger is a factor.
        //   10 bread — food buffer giving ~350 game-seconds of leeway while the
        //              NPC finds seeds, plants, and waits for the first crop.
        const npc = createNpcEntity(9.5, 30.5, 0, {
            name: 'BreadTester',
            inventory: [
                { objType: Obj.WHEAT, count: 5 },
                { objType: Obj.BREAD, count: 10 },
            ],
            brain: createThomasBrain(),
        });

        const gameTime = await runTicks(world, [npc], 10_000);

        const bread = inventoryCount(npc, Obj.BREAD);
        const wheat = inventoryCount(npc, Obj.WHEAT);
        const seeds = inventoryCount(npc, Obj.WHEAT_SEED);

        // ── Regression snapshot ──────────────────────────────────────────────
        // Record what the NPC achieved after 10 000 ticks so that AI-code
        // changes that alter productivity are immediately visible.
        console.log(
            `[bread-production] ticks=10000 game=${gameTime.toFixed(0)}s` +
            `  bread=${bread}  wheat=${wheat}  seeds=${seeds}` +
            `  alive=${npc.isAlive}  hunger=${npc.hunger.toFixed(1)}` +
            `  health=${npc.health}`,
        );

        // The NPC must not starve — a dead NPC is an unambiguous regression.
        assert.ok(npc.isAlive, 'NPC starved or was killed — farmBehavior regressed');

        // Baseline (first recorded run): bread=24, wheat=1, seeds=8.
        //
        // Without farming: 14 bread-equivalents (10 start + 4 baked) minus ~14
        // eaten over 500 s ≈ 0 remaining.  Ending with ≥ 5 means the full
        // farming cycle (find seeds → plant → grow → harvest → bake) ran at
        // least once.  Tighten this threshold whenever you want stricter coverage.
        assert.ok(
            bread >= 5,
            `Farming cycle produced too little bread (bread=${bread}) — ` +
            `expected ≥ 5; baseline was 24`,
        );
    });
});
