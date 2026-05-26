import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../world/world.js';
import { Obj, T } from '../world/tileTypes.js';
import { WHEAT_STAGE_SECONDS } from './crops.js';
import {
    harvestWheatAction,
    lookInsideContainerAction,
    moveDirectionAction,
    plantWheatSeedAction,
    satisfiesInventoryPrereq,
    satisfiesTilePrereq,
} from './entityActions.js';
import { runEntityAction, tickEntityAction } from '../actors/actionExecutor.js';
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

describe('crop actions', () => {
    it('plants and harvests wheat via EntityAction wrappers', () => {
        const world = new World3D();
        world.setTile(1, 1, 0, { terrain: T.DIRT, obj: 0 });
        const entity = new Entity(1.5, 2.5, 0);
        entity.inventory = [{ objType: Obj.WHEAT_SEED, count: 1 }];

        const planted = runEntityAction(entity, plantWheatSeedAction(entity, 1, 1, 0), world);
        assert.equal(planted, true);

        const matureAt = WHEAT_STAGE_SECONDS * 3;
        const tile = world.getTile(1, 1, 0);
        world.setTile(1, 1, 0, {
            cropPlantedAt: 0,
            cropStage: 3,
            obj: tile?.obj ?? Obj.WHEAT_CROP,
        });
        const harvested = runEntityAction(entity, harvestWheatAction(entity, 1, 1, matureAt), world);
        assert.equal(harvested, true);
        assert.ok(entity.inventory.some((s) => s.objType === Obj.WHEAT && s.count >= 1));
    });
});

describe('lookInsideContainerAction', () => {
    it('returns a snapshot of container contents', () => {
        const world = new World3D();
        world.setTile(2, 2, 0, {
            terrain: T.DIRT,
            obj: Obj.CHEST,
            contents: [{ objType: Obj.WHEAT, count: 2 }],
        });
        const entity = new Entity(1.5, 1.5, 0);
        const action = lookInsideContainerAction(entity, 2, 2, 0);
        const ok = runEntityAction(entity, action, world);
        assert.equal(ok, true);
        assert.equal(action.lastResult.ok, true);
        assert.equal(action.lastResult.contents.length, 1);
        assert.equal(action.lastResult.contents[0].objType, Obj.WHEAT);
    });
});
