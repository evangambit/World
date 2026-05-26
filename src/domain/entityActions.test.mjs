import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../world/world.js';
import { T } from '../world/tileTypes.js';
import { satisfiesTilePrereq } from './entityActions.js';

describe('satisfiesTilePrereq', () => {
    it('requires walkable when walkable: true', () => {
        const world = new World3D();
        world.setTile(1, 2, 0, { terrain: T.DIRT, obj: 0 });
        world.setTile(3, 4, 0, { terrain: T.WATER, obj: 0 });

        assert.equal(satisfiesTilePrereq(world, { x: 1, y: 2, z: 0, walkable: true }), true);
        assert.equal(satisfiesTilePrereq(world, { x: 3, y: 4, z: 0, walkable: true }), false);
    });

    it('ignores walkability when walkable is omitted', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, { terrain: T.WATER, obj: 0 });

        assert.equal(satisfiesTilePrereq(world, { x: 0, y: 0, z: 0 }), true);
    });
});
