import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Entity } from '../actors/entity.js';
import { World3D } from '../world/world.js';
import { Obj, T, WHEAT_CROP_STAGES } from '../world/tileTypes.js';
import { tickSimulation } from '../simulation/tickSimulation.js';
import {
    WHEAT_STAGE_SECONDS,
    wheatStageForTile,
    isWheatMature,
    updateCrops,
    canPlantWheatAt,
    plantWheatSeedAtTile,
    harvestWheatAtTile,
} from './crops.js';

/** @returns {{ world: World3D, entity: Entity, tileX: number, tileY: number, tileZ: number }} */
function wheatFieldFixture() {
    const world = new World3D();
    const tileX = 5;
    const tileY = 5;
    const tileZ = 0;
    world.setTile(tileX, tileY, tileZ, { terrain: T.GRASS, obj: 0 });
    const entity = new Entity(tileX + 0.5, tileY + 0.5, tileZ);
    entity.inventory = [{ objType: Obj.WHEAT_SEED, count: 3 }];
    return { world, entity, tileX, tileY, tileZ };
}

/** @param {import('../world/world.js').TileData} tile */
function cropTile(plantedAt) {
    return {
        obj: Obj.WHEAT_CROP,
        cropStage: 0,
        cropPlantedAt: plantedAt,
    };
}

describe('wheatStageForTile', () => {
    it('starts at stage 0 when planted', () => {
        const tile = cropTile(100);
        assert.equal(wheatStageForTile(tile, 100), 0);
    });

    it('advances one stage per WHEAT_STAGE_SECONDS', () => {
        const planted = 0;
        const tile = cropTile(planted);
        assert.equal(wheatStageForTile(tile, WHEAT_STAGE_SECONDS - 0.001), 0);
        assert.equal(wheatStageForTile(tile, WHEAT_STAGE_SECONDS), 1);
        assert.equal(wheatStageForTile(tile, WHEAT_STAGE_SECONDS * 2), 2);
    });

    it('caps at the final stage', () => {
        const tile = cropTile(0);
        const matureAt = WHEAT_STAGE_SECONDS * (WHEAT_CROP_STAGES - 1);
        assert.equal(wheatStageForTile(tile, matureAt), WHEAT_CROP_STAGES - 1);
        assert.equal(wheatStageForTile(tile, matureAt + 1000), WHEAT_CROP_STAGES - 1);
    });
});

describe('isWheatMature', () => {
    it('is false before the final stage', () => {
        const tile = cropTile(0);
        assert.equal(isWheatMature(tile, WHEAT_STAGE_SECONDS * 2), false);
    });

    it('is true once the final stage is reached', () => {
        const tile = cropTile(0);
        const matureTime = WHEAT_STAGE_SECONDS * (WHEAT_CROP_STAGES - 1);
        assert.equal(isWheatMature(tile, matureTime - 0.001), false);
        assert.equal(isWheatMature(tile, matureTime), true);
    });
});

describe('updateCrops', () => {
    it('writes cropStage on wheat tiles in the world', () => {
        const world = new World3D();
        world.setTile(1, 1, 0, { terrain: T.GRASS, obj: Obj.WHEAT_CROP, cropStage: 0, cropPlantedAt: 0 });
        updateCrops(world, WHEAT_STAGE_SECONDS * 2);
        const tile = world.getTile(1, 1, 0);
        assert.equal(tile.cropStage, 2);
    });
});

describe('plantWheatSeedAtTile', () => {
    it('plants on adjacent grass and consumes one seed', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        const result = plantWheatSeedAtTile(entity, world, tileX, tileY, 10, tileZ);

        assert.equal(result.ok, true);
        const tile = world.getTile(tileX, tileY, tileZ);
        assert.equal(tile.obj, Obj.WHEAT_CROP);
        assert.equal(tile.cropStage, 0);
        assert.equal(tile.cropPlantedAt, 10);
        assert.equal(entity.inventory[0].count, 2);
    });

    it('fails when the entity has no seeds', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        entity.inventory = [];
        const result = plantWheatSeedAtTile(entity, world, tileX, tileY, 0, tileZ);
        assert.equal(result.ok, false);
        assert.match(result.message, /seed/i);
    });

    it('fails when the tile already has an object', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        world.setTile(tileX, tileY, tileZ, { obj: Obj.ROCK });
        const result = plantWheatSeedAtTile(entity, world, tileX, tileY, 0, tileZ);
        assert.equal(result.ok, false);
    });

    it('fails when not adjacent', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        entity.x = 20;
        entity.y = 20;
        const result = plantWheatSeedAtTile(entity, world, tileX, tileY, 0, tileZ);
        assert.equal(result.ok, false);
        assert.match(result.message, /far/i);
    });
});

describe('harvestWheatAtTile', () => {
    it('fails when wheat is not mature', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        plantWheatSeedAtTile(entity, world, tileX, tileY, 0, tileZ);
        const result = harvestWheatAtTile(entity, world, tileX, tileY, 1, tileZ);
        assert.equal(result.ok, false);
        assert.match(result.message, /not ready/i);
    });

    it('harvests mature wheat into inventory and clears the tile', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        const plantedAt = 0;
        plantWheatSeedAtTile(entity, world, tileX, tileY, plantedAt, tileZ);
        const matureTime = plantedAt + WHEAT_STAGE_SECONDS * (WHEAT_CROP_STAGES - 1);
        updateCrops(world, matureTime);

        const result = harvestWheatAtTile(entity, world, tileX, tileY, matureTime, tileZ);
        assert.equal(result.ok, true);
        assert.equal(world.getTile(tileX, tileY, tileZ).obj, 0);

        const wheat = entity.inventory.find((s) => s.objType === Obj.WHEAT);
        const seeds = entity.inventory.find((s) => s.objType === Obj.WHEAT_SEED);
        assert.equal(wheat?.count, 1);
        assert.equal(seeds?.count, 4); // 2 after planting + 2 from harvest
    });
});

describe('wheat growth via tickSimulation', () => {
    it('reaches maturity after enough game time', () => {
        const { world, entity, tileX, tileY, tileZ } = wheatFieldFixture();
        const plantedAt = 100;
        plantWheatSeedAtTile(entity, world, tileX, tileY, plantedAt, tileZ);

        let gameTime = plantedAt;
        const matureAt = plantedAt + WHEAT_STAGE_SECONDS * (WHEAT_CROP_STAGES - 1);
        while (gameTime < matureAt) {
            ({ gameTime } = tickSimulation({ world, gameTime, dt: 1 }));
        }

        const tile = world.getTile(tileX, tileY, tileZ);
        assert.equal(isWheatMature(tile, gameTime), true);
        assert.equal(tile.cropStage, WHEAT_CROP_STAGES - 1);
    });
});

describe('canPlantWheatAt', () => {
    it('allows grass without objects', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, { terrain: T.GRASS, obj: 0 });
        assert.equal(canPlantWheatAt(world, 0, 0, 0), true);
    });

    it('disallows stone floor', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, { terrain: T.STONE_FLOOR, obj: 0 });
        assert.equal(canPlantWheatAt(world, 0, 0, 0), false);
    });
});
