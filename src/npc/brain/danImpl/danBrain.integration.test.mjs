import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../../world/world.js';
import { T, Obj } from '../../../world/tileTypes.js';
import { createNpcEntity } from '../../../actors/npcSimulation.js';
import { tickSimulation } from '../../../simulation/tickSimulation.js';
import { DanBrain } from './danBrain.js';
import { getFoodNutrition } from '../../../domain/vitality.js';
import { WHEAT_STAGE_SECONDS } from '../../../domain/crops.js';

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

// ── Locked-house fixture ──────────────────────────────────────────────────────
//
// Layout (z=0):
//
//   y=0  W W W W W        W = WALL_WOOD
//   y=1  W . . . W        . = interior WOOD_FLOOR (buildingId=1)
//   y=2  W . N . W        N = NPC start (2.5, 2.5)
//   y=3  W . . . W
//   y=4  W W D W W        D = DOOR (locked, buildingId=1)
//   y=5  . . S . .        S = STOVE on DIRT
//   y=6  . H . H .        H = mature WHEAT_CROP on DIRT
//   y=7  . . . . .        (bare DIRT for planting)
//   y=8  . . . . .
//
// The NPC starts inside with the building key already in inventory.
// Without the pathfinding-with-keys fix the farm is unreachable (locked door
// blocks A*); with the fix the NPC routes through, auto-unlocks the door, and
// farms.

const HOUSE_BUILDING_ID = 1;
const HOUSE_DOOR_X = 2;
const HOUSE_DOOR_Y = 4;
const LOCKED_HOUSE_NPC_X = 2.5;
const LOCKED_HOUSE_NPC_Y = 2.5;

/**
 * Build a 5×5 locked house with a farm plot to the south.
 * The NPC starts inside holding the building key.
 * @returns {{ world: World3D, npc: import('../../../actors/npcSimulation.js').NpcEntity }}
 */
function lockedHouseFixture() {
    const world = new World3D();

    // ── House walls ──
    for (let x = 0; x < 5; x++) {
        world.setTile(x, 0, 0, { terrain: T.WALL_WOOD, buildingId: HOUSE_BUILDING_ID });
        world.setTile(x, 4, 0, { terrain: T.WALL_WOOD, buildingId: HOUSE_BUILDING_ID });
    }
    for (let y = 1; y <= 3; y++) {
        world.setTile(0, y, 0, { terrain: T.WALL_WOOD, buildingId: HOUSE_BUILDING_ID });
        world.setTile(4, y, 0, { terrain: T.WALL_WOOD, buildingId: HOUSE_BUILDING_ID });
    }

    // ── Interior floor ──
    for (let x = 1; x <= 3; x++) {
        for (let y = 1; y <= 3; y++) {
            world.setTile(x, y, 0, {
                terrain: T.WOOD_FLOOR,
                interior: true,
                ceiling: true,
                buildingId: HOUSE_BUILDING_ID,
            });
        }
    }

    // ── South door (locked) ──
    world.setTile(HOUSE_DOOR_X, HOUSE_DOOR_Y, 0, {
        terrain: T.DOOR,
        buildingId: HOUSE_BUILDING_ID,
        doorLocked: true,
        doorInsideDx: 0,
        doorInsideDy: -1,
    });

    // ── Farm area south of house ──
    for (let x = 0; x < 5; x++) {
        for (let y = 5; y <= 8; y++) {
            world.setTile(x, y, 0, { terrain: T.DIRT });
        }
    }

    // Stove for cooking wheat into bread (placed away from door to keep path clear)
    world.setTile(2, 7, 0, { terrain: T.DIRT, obj: Obj.STOVE });

    // Two mature wheat crops (planted well before t=0 so they are always mature)
    const maturePlantedAt = -(WHEAT_STAGE_SECONDS * 3 + 1);
    world.setTile(1, 6, 0, { terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 3, cropPlantedAt: maturePlantedAt });
    world.setTile(3, 6, 0, { terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 3, cropPlantedAt: maturePlantedAt });

    // NPC starts inside the house with the building key and some wheat seeds
    const npc = createNpcEntity(LOCKED_HOUSE_NPC_X, LOCKED_HOUSE_NPC_Y, 0, {
        inventory: [
            { objType: Obj.KEY, buildingId: HOUSE_BUILDING_ID, count: 1 },
            { objType: Obj.WHEAT_SEED, count: 3 },
        ],
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

    it('exits a locked house using a held key and then farms', () => {
        const { world, npc } = lockedHouseFixture();

        let gameTime = 0;
        const DT = 1;
        const DURATION = 600;

        for (let t = 0; t < DURATION; t += DT) {
            ({ gameTime } = tickSimulation({ world, gameTime, dt: DT, npcs: [npc] }));
        }

        const doorTile = world.getTile(HOUSE_DOOR_X, HOUSE_DOOR_Y, 0);
        const finalBread = npc.inventory.find((s) => s.objType === Obj.BREAD)?.count ?? 0;
        const finalWheat = npc.inventory.find((s) => s.objType === Obj.WHEAT)?.count ?? 0;
        const finalNutrition = npc.inventory.reduce(
            (sum, s) => sum + (getFoodNutrition(s.objType) ?? 0) * s.count,
            0,
        );
        console.log(
            `Locked-house test — bread: ${finalBread}, wheat: ${finalWheat}, ` +
            `nutrition: ${finalNutrition}, door unlocked: ${!doorTile?.doorLocked}`,
        );

        assert.ok(npc.isAlive, 'NPC should still be alive');
        assert.ok(!doorTile?.doorLocked, 'NPC should have unlocked the door to exit');
        assert.ok(finalNutrition >= 15, 'NPC should have farmed at least one wheat after leaving the house');
    });
});
