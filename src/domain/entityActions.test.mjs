import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../world/world.js';
import { T } from '../world/tileTypes.js';
import {
    moveDirectionAction,
    satisfiesInventoryPrereq,
    satisfiesTilePrereq,
    tickEntityAction,
} from './entityActions.js';
import { Entity } from '../actors/entity.js';

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

describe('moveDirectionAction', () => {
    it('moves entity via tryMove on tick', () => {
        const world = new World3D();
        for (let x = 0; x <= 3; x++) {
            for (let y = 0; y <= 3; y++) {
                world.setTile(x, y, 0, { terrain: T.DIRT, obj: 0 });
            }
        }
        const entity = new Entity(1.5, 1.5, 0);
        const startX = entity.x;
        tickEntityAction(entity, moveDirectionAction(entity, 1, 0), world, 0.5);
        assert.ok(entity.x > startX);
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
