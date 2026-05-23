import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { createTaskBrain } from './npcBrain.js';
import { driveLocomotionUntil } from './npcTestLocomotion.js';
import { Obj, T } from '../world/tileTypes.js';
import { World3D } from '../world/world.js';
import { snapshotTileState } from './npcMemory.js';
import { syncMemoryRefTravelGoal } from './npcMemoryTravel.js';
import { runPlan } from './npcPlanRunner.js';

/**
 * @param {World3D} world
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function fillGrass(world, x0, y0, x1, y1) {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            world.setTile(x, y, 0, { terrain: T.GRASS, obj: 0 });
        }
    }
}

describe('goto with rememberLocationsOfNearby', () => {
    it('walks to a remembered stove via adaptive travel', async () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 14, 10);

        const npc = createNpcEntity(10.5, 10.5, 0, { brain: createTaskBrain() });
        npc.brain.observeTile(12, 10, 0, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        const result = await driveLocomotionUntil(
            npc,
            runPlan(npc, world, {
                type: 'goto',
                ref: 'rememberLocationsOfNearby(stove)',
            }),
            { onTick: (n) => syncMemoryRefTravelGoal(n, world) },
        );
        assert.equal(result.ok, true);
        assert.equal(Math.floor(npc.x), 12);
    });
});

describe('cook plan step', () => {
    it('cooks uncooked_food in inventory', async () => {
        const world = new World3D();
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
        npc.inventory = [{ objType: Obj.UNCOOKED_STEAK, count: 1 }];

        const result = await runPlan(npc, world, {
            type: 'cook',
            object: 'uncooked_food',
        });

        assert.equal(result.ok, true);
        assert.ok(npc.inventory.some((s) => s.objType === Obj.STEAK && s.count > 0));
    });
});
