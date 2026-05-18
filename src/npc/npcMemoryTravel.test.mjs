import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tickNpcLocomotion } from '../actors/npcLocomotion.js';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { Obj, T } from '../world/tileTypes.js';
import { World3D } from '../world/world.js';
import {
    getNpcTileMemory,
    isTileMemoryReachable,
    snapshotTileState,
} from './npcMemory.js';
import {
    findBestReachableMemoryRefTarget,
    syncMemoryRefTravelGoal,
    travelNpcToMemoryRef,
} from './npcMemoryTravel.js';

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

describe('travelNpcToMemoryRef', () => {
    it('retargets to a closer stove when one is remembered mid-travel', async () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 14, 10);

        const npc = createNpcEntity(10.5, 10.5, 0);
        npc.tileMemory.set(World3D.key(14, 10, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        const travelPromise = travelNpcToMemoryRef(
            npc,
            'rememberLocationsOfNearby(stove)',
            world,
        );
        assert.equal(npc._memoryRefTravel?.goalKey, '14,10,0');

        npc.tileMemory.set(World3D.key(12, 10, 0), {
            seenAt: 2,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });
        syncMemoryRefTravelGoal(npc, world);
        assert.equal(npc._memoryRefTravel?.goalKey, '12,10,0');

        for (let i = 0; i < 300 && npc._memoryRefTravel; i++) {
            tickNpcLocomotion(npc, 0.05);
            syncMemoryRefTravelGoal(npc, world);
        }

        await travelPromise;
        assert.equal(Math.floor(npc.x), 12);
        assert.equal(Math.floor(npc.y), 10);
    });

    it('skips stoves remembered as unreachable and tries another', async () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 14, 10);
        for (let y = 10; y <= 12; y++) {
            world.setTile(13, y, 0, { terrain: T.WALL_STONE, obj: 0 });
        }

        const npc = createNpcEntity(10.5, 10.5, 0);
        npc.tileMemory.set(World3D.key(14, 10, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
            reachable: false,
        });
        npc.tileMemory.set(World3D.key(12, 10, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        assert.equal(
            findBestReachableMemoryRefTarget(npc, world, 'rememberLocationsOfNearby(stove)')?.key,
            '12,10,0',
        );

        const travelPromise = travelNpcToMemoryRef(
            npc,
            'rememberLocationsOfNearby(stove)',
            world,
        );

        for (let i = 0; i < 300 && npc._memoryRefTravel; i++) {
            tickNpcLocomotion(npc, 0.05);
            syncMemoryRefTravelGoal(npc, world);
        }

        await travelPromise;
        assert.equal(isTileMemoryReachable(npc, 14, 10, 0), false);
        assert.equal(getNpcTileMemory(npc, 12, 10, 0)?.reachable, true);
    });
});
