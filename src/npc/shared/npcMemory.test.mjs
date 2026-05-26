import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../world/world.js';
import { Obj, T } from '../../world/tileTypes.js';
import { createNpcEntity } from '../../actors/npcSimulation.js';
import { initTileStore } from '../brain/tileStore.js';
import { tickSimulation } from '../../simulation/tickSimulation.js';
import {
    NPC_PERCEPTION_RADIUS,
    getNpcTileMemory,
    isTileMemoryReachable,
    markTileUnreachable,
    snapshotTileState,
    tickNpcPerception,
    tileMemoryStatesEqual,
} from './npcMemory.js';

/**
 * Minimal brain for tests that need Chebyshev tile memory without a full AI stack.
 * @returns {import('../brain/interface.js').NpcBrain}
 */
function createPerceptionTestBrain() {
    const brain = {
        /** @type {import('../../actors/npcSimulation.js').NpcEntity | null} */
        npc: null,
        attach(npc) {
            this.npc = npc;
        },
        tick(world, _dt, gameTime) {
            if (this.npc) tickNpcPerception(this.npc, world, gameTime);
            return null;
        },
    };
    initTileStore(brain);
    return brain;
}

describe('snapshotTileState', () => {
    it('copies tile fields so world edits do not mutate memory', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, {
            terrain: T.GRASS,
            obj: Obj.CHEST,
            doorLocked: false,
        });
        const live = world.getTile(0, 0, 0);
        const snap = snapshotTileState(live);
        live.obj = Obj.NONE;
        live.doorLocked = true;

        assert.equal(snap.obj, Obj.CHEST);
        assert.equal(snap.doorLocked, false);
    });
});

describe('tileMemoryStatesEqual', () => {
    it('includes crop stage when comparing snapshots', () => {
        const a = snapshotTileState({ terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 0 });
        const b = snapshotTileState({ terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 1 });
        assert.equal(tileMemoryStatesEqual(a, b), false);
    });
});

describe('tickNpcPerception', () => {
    it('records tiles within perception radius with seenAt', () => {
        const world = new World3D();
        const npc = createNpcEntity(10, 10, 0, { brain: createPerceptionTestBrain() });
        const inRangeX = 10 + NPC_PERCEPTION_RADIUS;
        const outOfRangeX = 10 + NPC_PERCEPTION_RADIUS + 1;

        world.setTile(inRangeX, 10, 0, { terrain: T.GRASS, obj: Obj.TREE });
        world.setTile(outOfRangeX, 10, 0, { terrain: T.GRASS, obj: Obj.ROCK });

        tickNpcPerception(npc, world, 42);

        assert.ok(getNpcTileMemory(npc, inRangeX, 10, 0));
        assert.equal(getNpcTileMemory(npc, inRangeX, 10, 0)?.seenAt, 42);
        assert.equal(getNpcTileMemory(npc, inRangeX, 10, 0)?.state.obj, Obj.TREE);
        assert.equal(getNpcTileMemory(npc, outOfRangeX, 10, 0), undefined);
    });

    it('refreshes seenAt and state while the tile stays in view', () => {
        const world = new World3D();
        const npc = createNpcEntity(0, 0, 0, { brain: createPerceptionTestBrain() });
        world.setTile(3, 0, 0, { terrain: T.GRASS, obj: Obj.BUSH });

        tickNpcPerception(npc, world, 1);
        world.setTile(3, 0, 0, { terrain: T.GRASS, obj: Obj.FLOWER });
        tickNpcPerception(npc, world, 5);

        const mem = getNpcTileMemory(npc, 3, 0, 0);
        assert.equal(mem?.seenAt, 5);
        assert.equal(mem?.state.obj, Obj.FLOWER);
    });

    it('runs from tickSimulation with advancing gameTime', () => {
        const world = new World3D();
        const npc = createNpcEntity(0, 0, 0, { brain: createPerceptionTestBrain() });
        world.setTile(0, 0, 0, { terrain: T.GRASS, obj: Obj.SIGN });

        let gameTime = 0;
        ({ gameTime } = tickSimulation({ world, gameTime, dt: 2, npcs: [npc] }));

        const mem = getNpcTileMemory(npc, 0, 0, 0);
        assert.equal(mem?.seenAt, 2);
        assert.equal(mem?.state.obj, Obj.SIGN);
    });

    it('clears reachability when the tile state changes on re-perception', () => {
        const world = new World3D();
        const npc = createNpcEntity(0, 0, 0, { brain: createPerceptionTestBrain() });
        world.setTile(2, 0, 0, { terrain: T.DOOR, obj: 0, doorLocked: true });

        tickNpcPerception(npc, world, 1);
        markTileUnreachable(npc, 2, 0, 0);
        assert.equal(isTileMemoryReachable(npc, 2, 0, 0), false);

        world.setTile(2, 0, 0, { terrain: T.DOOR, obj: 0, doorLocked: false });
        tickNpcPerception(npc, world, 2);
        assert.equal(isTileMemoryReachable(npc, 2, 0, 0), true);
    });
});
