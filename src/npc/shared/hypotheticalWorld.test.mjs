import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../world/world.js';
import { Obj, T } from '../../world/tileTypes.js';
import { Entity } from '../../actors/entity.js';
import { pickUpAction } from '../../domain/entityActions.js';
import { snapshotTileState } from './npcMemory.js';
import {
    HypotheticalEntity,
    createHypotheticalFromMemory,
} from './hypotheticalWorld.js';

describe('HypotheticalWorld', () => {
    it('branch() shares parent memory without copying the store', () => {
        const memory = new Map();
        memory.set(World3D.key(0, 0, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.BUSH }),
        });
        memory.set(World3D.key(1, 0, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.TREE }),
        });

        const root = createHypotheticalFromMemory(memory);
        const branch = root.branch();

        branch.setTile(0, 0, 0, { obj: Obj.NONE });

        assert.equal(root.getTile(0, 0, 0)?.obj, Obj.BUSH);
        assert.equal(branch.getTile(0, 0, 0)?.obj, Obj.NONE);
        assert.equal(branch.getTile(1, 0, 0)?.obj, Obj.TREE);
        assert.equal(memory.get(World3D.key(0, 0, 0))?.state.obj, Obj.BUSH);
    });

    it('nested branches only store their own deltas', () => {
        const memory = new Map();
        memory.set(World3D.key(0, 0, 0), {
            seenAt: 0,
            state: snapshotTileState({ terrain: T.DIRT, obj: Obj.ROCK }),
        });

        const a = createHypotheticalFromMemory(memory);
        const b = a.branch();
        const c = b.branch();

        b.setTile(0, 0, 0, { obj: Obj.NONE });
        c.setTile(0, 0, 0, { terrain: T.WATER });

        assert.equal(a.getTile(0, 0, 0)?.obj, Obj.ROCK);
        assert.equal(b.getTile(0, 0, 0)?.obj, Obj.NONE);
        assert.equal(c.getTile(0, 0, 0)?.terrain, T.WATER);
        assert.equal(c.getTile(0, 0, 0)?.obj, Obj.NONE);
    });

    it('treats unobserved tiles as unknown', () => {
        const live = new World3D();
        live.setTile(5, 5, 0, { terrain: T.GRASS, obj: Obj.SIGN });

        const hypo = createHypotheticalFromMemory(new Map());
        assert.equal(hypo.getTile(5, 5, 0), null);
        assert.equal(hypo.isKnownTile(5, 5, 0), false);
        assert.equal(hypo.isWalkable(5, 5, 0), false);
    });

    it('apply() simulates only from memory without touching live world', () => {
        const memory = new Map();
        memory.set(World3D.key(1, 0, 0), {
            seenAt: 0,
            state: snapshotTileState({ terrain: T.DIRT, obj: Obj.FLOWER }),
        });

        const live = new World3D();
        live.setTile(1, 0, 0, { terrain: T.DIRT, obj: Obj.FLOWER });

        const hypo = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        const snap = new HypotheticalEntity(entity);

        const ok = hypo.apply(pickUpAction(/** @type {Entity} */ (/** @type {unknown} */ (snap)), 1, 0, 0), snap);
        assert.equal(ok, true);
        assert.equal(hypo.getTile(1, 0, 0)?.obj, Obj.NONE);
        assert.equal(live.getTile(1, 0, 0)?.obj, Obj.FLOWER);
        assert.equal(snap.inventory.some((s) => s.objType === Obj.FLOWER), true);
    });

    it('HypotheticalEntity.branch() isolates inventory edits', () => {
        const entity = new Entity(0, 0, 0);
        entity.inventory = [{ objType: Obj.WHEAT_SEED, count: 3 }];

        const a = new HypotheticalEntity(entity);
        const b = a.branch();
        b.inventory[0].count = 0;

        assert.equal(a.inventory[0].count, 3);
        assert.equal(b.inventory[0].count, 0);
    });

});
