import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Obj, T } from '../world/tileTypes.js';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { createTaskBrain } from './npcBrain.js';
import { snapshotTileState } from './npcMemory.js';
import {
    normalizePlanRef,
    parsePlanRefAsTile,
    rememberLocationsOfNearby,
    resolvePlanRef,
    resolvePlanRefs,
    resolvePlanRefTargets,
    tileMemoryMatchesObjectTag,
} from './npcPlanRefs.js';

describe('rememberLocationsOfNearby', () => {
    it('returns all remembered matches sorted nearest first', () => {
        const npc = createNpcEntity(10, 10, 0, { brain: createTaskBrain() });
        npc.brain.observeTile(14, 10, 0, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });
        npc.brain.observeTile(12, 10, 0, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });
        npc.brain.observeTile(11, 11, 0, {
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
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
        npc.brain.observeTile(3, 0, 1, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        assert.deepEqual(rememberLocationsOfNearby(npc, 'stove'), []);
    });
});

describe('normalizePlanRef', () => {
    it('accepts legacy binding objects with a query field', () => {
        assert.equal(
            normalizePlanRef({ query: 'rememberLocationsOfNearby(chest)' }),
            'rememberLocationsOfNearby(chest)',
        );
    });

    it('resolves legacy binding objects via resolvePlanRefs', () => {
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
        npc.brain.observeTile(2, 0, 0, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.CHEST }),
        });

        const refs = resolvePlanRefs(npc, {}, {
            query: 'rememberLocationsOfNearby(chest)',
        });
        assert.deepEqual(refs, [{ x: 2, y: 0, z: 0 }]);
    });
});

describe('parsePlanRefAsTile', () => {
    it('accepts coordinate objects on ref', () => {
        assert.deepEqual(parsePlanRefAsTile({ x: 9, y: 30, z: 0 }), { x: 9, y: 30, z: 0 });
    });

    it('does not treat legacy query objects as tiles', () => {
        assert.equal(parsePlanRefAsTile({ query: 'rememberLocationsOfNearby(chest)' }), null);
    });

    it('resolves goto steps with coordinate ref objects', () => {
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
        const targets = resolvePlanRefTargets(npc, {}, {
            ref: { x: 9, y: 30, z: 0 },
        });
        assert.deepEqual(targets, [{ x: 9, y: 30, z: 0 }]);
    });
});

describe('resolvePlanRef', () => {
    it('parses rememberLocationsOfNearby(tag)', () => {
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
        npc.brain.observeTile(2, 0, 0, {
            seenAt: 5,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.STOVE }),
        });

        const ref = resolvePlanRef(npc, {}, 'rememberLocationsOfNearby(stove)');
        assert.deepEqual(ref, { x: 2, y: 0, z: 0 });
    });

    it('returns null for unknown ref syntax', () => {
        const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
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
