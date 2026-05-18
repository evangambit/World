import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Obj, T } from '../world/tileTypes.js';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { snapshotTileState } from './npcMemory.js';
import { World3D } from '../world/world.js';
import {
    rememberLocationsOfNearby,
    resolvePlanRef,
    tileMemoryMatchesObjectTag,
} from './npcPlanRefs.js';

describe('rememberLocationsOfNearby', () => {
    it('returns all remembered matches sorted nearest first', () => {
        const npc = createNpcEntity(10, 10, 0);
        npc.tileMemory.set(World3D.key(14, 10, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });
        npc.tileMemory.set(World3D.key(12, 10, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });
        npc.tileMemory.set(World3D.key(11, 11, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.CHEST }),
        });

        const refs = rememberLocationsOfNearby(npc, 'stove');
        assert.deepEqual(refs, [
            { x: 12, y: 10, z: 0 },
            { x: 14, y: 10, z: 0 },
        ]);
    });

    it('returns an empty array when nothing matches', () => {
        const npc = createNpcEntity(0, 0, 0);
        npc.tileMemory.set(World3D.key(3, 0, 1), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        assert.deepEqual(rememberLocationsOfNearby(npc, 'stove'), []);
    });
});

describe('resolvePlanRef', () => {
    it('parses rememberLocationsOfNearby(tag)', () => {
        const npc = createNpcEntity(0, 0, 0);
        npc.tileMemory.set(World3D.key(2, 0, 0), {
            seenAt: 5,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        const ref = resolvePlanRef(npc, {}, 'rememberLocationsOfNearby(stove)');
        assert.deepEqual(ref, { x: 2, y: 0, z: 0 });
    });

    it('returns null for unknown ref syntax', () => {
        const npc = createNpcEntity(0, 0, 0);
        assert.equal(resolvePlanRef(npc, {}, 'my_kitchen'), null);
    });
});

describe('tileMemoryMatchesObjectTag', () => {
    it('matches loose items in remembered container contents', () => {
        const state = snapshotTileState({
            terrain: T.GRASS,
            obj: Obj.CHEST,
            contents: [{ objType: Obj.STEAK, count: 1 }],
        });
        assert.equal(tileMemoryMatchesObjectTag(state, 'edible_food'), true);
        assert.equal(tileMemoryMatchesObjectTag(state, 'stove'), false);
    });
});
