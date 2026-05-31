import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../../world/world.js';
import { T, Obj } from '../../../world/tileTypes.js';
import { createNpcEntity } from '../../../actors/npcSimulation.js';
import { tickSimulation } from '../../../simulation/tickSimulation.js';
import { DanBrain } from './danBrain.js';
import { getFoodNutrition } from '../../../domain/vitality.js';

const GRID_SIZE = 7;
const GRID_ORIGIN = 0;
const TILE_Z = 0;
const STOVE_X = 6;
const STOVE_Y = 3;
const NPC_X = 3.5;
const NPC_Y = 3.5;

/**
 * 7×7 dirt field with a stove for cooking; NPC starts centered with wheat seeds.
 * @returns {{ world: World3D, npc: import('../../../actors/npcSimulation.js').NpcEntity }}
 */
function breadProductionFixture() {
    const world = new World3D();

    for (let x = GRID_ORIGIN; x < GRID_ORIGIN + GRID_SIZE; x++) {
        for (let y = GRID_ORIGIN; y < GRID_ORIGIN + GRID_SIZE; y++) {
            world.setTile(x, y, TILE_Z, { terrain: T.DIRT, obj: 0 });
        }
    }

    world.setTile(STOVE_X, STOVE_Y, TILE_Z, { terrain: T.DIRT, obj: Obj.STOVE });

    const npc = createNpcEntity(NPC_X, NPC_Y, TILE_Z, {
        inventory: [{ objType: Obj.WHEAT_SEED, count: 5 }],
        brain: new DanBrain(),
    });

    return { world, npc };
}

describe('DanBrain integration', () => {
    it('produces bread over 600 virtual seconds', () => {
        const { world, npc } = breadProductionFixture();

        let gameTime = 0;
        const DT = 1;
        const DURATION = 600;

        let maxBreadSeen = 0;
        let maxWheatSeen = 0;
        for (let t = 0; t < DURATION; t += DT) {
            ({ gameTime } = tickSimulation({ world, gameTime, dt: DT, npcs: [npc] }));
            const breadStack = npc.inventory.find((s) => s.objType === Obj.BREAD);
            if (breadStack && breadStack.count > maxBreadSeen) {
                maxBreadSeen = breadStack.count;
            }
            const wheatStack = npc.inventory.find((s) => s.objType === Obj.WHEAT);
            if (wheatStack && wheatStack.count > maxWheatSeen) {
                maxWheatSeen = wheatStack.count;
            }
        }

        const finalBread = npc.inventory.find((s) => s.objType === Obj.BREAD)?.count ?? 0;
        const finalWheat = npc.inventory.find((s) => s.objType === Obj.WHEAT)?.count ?? 0;
        const finalNutrition = npc.inventory.reduce((sum, s) => sum + (getFoodNutrition(s.objType) ?? 0) * s.count, 0);
        console.log(
            `Bread produced (peak inventory): ${maxBreadSeen}, remaining at end: ${finalBread}; ` +
            `wheat (peak inventory): ${maxWheatSeen}, remaining at end: ${finalWheat}; ` +
            `nutrition at end: ${finalNutrition}`,
        );

        assert.ok(npc.isAlive, 'NPC should still be alive after 600s');
        assert.ok(finalNutrition >= 100, 'NPC should have produced at least 100 nutrition');
    });
});
