import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../world/world.js';
import { T } from '../world/tileTypes.js';
import { satisfiesInventoryPrereq, satisfiesTilePrereq } from './entityActions.js';

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

describe('satisfiesInventoryPrereq', () => {
    it('supports OR-of-AND via inventoryAnyOf', () => {
        const entity = {
            inventory: [
                { objType: 1, count: 2 },
                { objType: 2, count: 1 },
            ],
        };
        assert.equal(
            satisfiesInventoryPrereq(entity, {
                inventoryAnyOf: [
                    [{ objType: 1, count: 3 }],
                    [{ objType: 1, count: 2 }, { objType: 2, count: 1 }],
                ],
            }),
            true,
        );
    });

    it('returns false when no inventoryAnyOf group is satisfiable', () => {
        const entity = {
            inventory: [
                { objType: 10, count: 1 },
                { objType: 20, count: 1 },
            ],
        };
        assert.equal(
            satisfiesInventoryPrereq(entity, {
                inventoryAnyOf: [
                    [{ objType: 10, count: 2 }],
                    [{ objType: 30, count: 1 }],
                ],
            }),
            false,
        );
    });
});
