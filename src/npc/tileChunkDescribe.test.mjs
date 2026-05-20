import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../world/world.js';
import { WORLD_CHUNK_SIZE } from '../world/worldConstants.js';
import { Obj, T } from '../world/tileTypes.js';
import { snapshotTileState } from './npcMemory.js';
import {
    analyzeChunk,
    buildChunkCells,
    describeChunkDiff,
    describeChunkSnapshot,
    diffChunk,
    labelTileState,
    tileStatesEqual,
    tileToChunk,
} from './tileChunkDescribe.js';

describe('tileToChunk', () => {
    it('uses WORLD_CHUNK_SIZE by default', () => {
        assert.deepEqual(tileToChunk(12, 37), {
            chunkX: Math.floor(12 / WORLD_CHUNK_SIZE),
            chunkY: Math.floor(37 / WORLD_CHUNK_SIZE),
        });
    });
});

describe('labelTileState', () => {
    it('labels wheat by growth stage', () => {
        assert.equal(
            labelTileState({ terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 3 }),
            'mature wheat',
        );
    });

    it('labels terrain and objects per type', () => {
        assert.equal(labelTileState({ terrain: T.WALL_STONE, obj: Obj.NONE }), 'wall stone');
        assert.equal(labelTileState({ terrain: T.DIRT, obj: Obj.FLOWER }), 'dirt with flower');
    });

    it('labels locked doors', () => {
        assert.equal(labelTileState({ terrain: T.DOOR, obj: Obj.NONE, doorLocked: true }), 'locked door');
    });
});

describe('tileStatesEqual', () => {
    it('treats different crop stages as unequal', () => {
        const a = { terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 0 };
        const b = { terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 1 };
        assert.equal(tileStatesEqual(a, b), false);
    });
});

describe('buildChunkCells', () => {
    it('marks world holes as empty when world is provided', () => {
        const world = new World3D();
        const cells = buildChunkCells(0, 0, 0, { world, chunkSize: WORLD_CHUNK_SIZE });
        assert.equal(cells.length, WORLD_CHUNK_SIZE * WORLD_CHUNK_SIZE);
        assert.ok(cells.every((c) => c.kind === 'empty'));
    });

    it('marks memory tiles as seen', () => {
        const memory = new Map();
        memory.set(World3D.key(0, 0, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.DIRT, obj: Obj.NONE }),
        });
        const cells = buildChunkCells(0, 0, 0, { memory, chunkSize: WORLD_CHUNK_SIZE });
        const origin = cells.find((c) => c.x === 0 && c.y === 0);
        assert.equal(origin?.kind, 'seen');
        assert.equal(cells.filter((c) => c.kind === 'unseen').length, WORLD_CHUNK_SIZE ** 2 - 1);
    });
});

describe('describeChunkSnapshot', () => {
    it('summarizes composition, unseen, and inaccessible tiles', () => {
        const stats = {
            chunkX: 3,
            chunkY: 5,
            z: 0,
            chunkSize: WORLD_CHUNK_SIZE,
            totalSlots: WORLD_CHUNK_SIZE ** 2,
            unseenCount: 5,
            emptyCount: 0,
            inaccessibleCount: 7,
            labelCounts: new Map([
                ['wall stone', 6],
                ['wall wood', 4],
                ['dirt', 15],
            ]),
        };
        const line = describeChunkSnapshot(stats);
        assert.match(line, /Chunk \(3, 5\)/);
        assert.match(line, /15 dirt tiles/);
        assert.match(line, /5\/25 unseen tiles/);
        assert.match(line, /7 tiles are inaccessible/);
    });
});

describe('diffChunk', () => {
    it('describes transitions with total chunk area as denominator', () => {
        const chunkSize = WORLD_CHUNK_SIZE;
        const total = chunkSize * chunkSize;
        /** @type {Map<string, import('./npcMemory.js').TileMemoryEntry>} */
        const before = new Map();
        /** @type {Map<string, import('./npcMemory.js').TileMemoryEntry>} */
        const after = new Map();

        const dirtToWheat = [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
            [4, 0],
            [0, 1],
            [1, 1],
        ];
        for (const [x, y] of dirtToWheat) {
            before.set(World3D.key(x, y, 0), {
                seenAt: 0,
                state: snapshotTileState({ terrain: T.DIRT, obj: Obj.NONE }),
            });
            after.set(World3D.key(x, y, 0), {
                seenAt: 1,
                state: snapshotTileState({ terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 3 }),
            });
        }
        const wheatToGrass = [
            [2, 1],
            [3, 1],
            [4, 1],
            [0, 2],
        ];
        for (const [x, y] of wheatToGrass) {
            before.set(World3D.key(x, y, 0), {
                seenAt: 0,
                state: snapshotTileState({ terrain: T.DIRT, obj: Obj.WHEAT_CROP, cropStage: 3 }),
            });
            after.set(World3D.key(x, y, 0), {
                seenAt: 1,
                state: snapshotTileState({ terrain: T.GRASS, obj: Obj.NONE }),
            });
        }

        const diff = diffChunk(0, 0, 0, { memory: before, chunkSize }, { memory: after, chunkSize });
        const line = describeChunkDiff(diff);
        assert.match(line, /7\/25 tiles went from dirt to mature wheat/);
        assert.match(line, /4\/25 tiles went from mature wheat to grass/);
        assert.equal(diff.totalSlots, total);
    });
});

describe('analyzeChunk', () => {
    it('counts empty slots from world and seen tiles from memory', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, { terrain: T.GRASS, obj: Obj.NONE });
        const memory = new Map();
        memory.set(World3D.key(0, 0, 0), {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.NONE }),
        });
        const stats = analyzeChunk(0, 0, 0, { world, memory, chunkSize: WORLD_CHUNK_SIZE });
        assert.equal(stats.labelCounts.get('grass'), 1);
        assert.equal(stats.emptyCount, WORLD_CHUNK_SIZE ** 2 - 1);
        assert.equal(stats.unseenCount, 0);
    });

    it('treats world tiles without memory as unseen', () => {
        const world = new World3D();
        world.setTile(0, 0, 0, { terrain: T.GRASS, obj: Obj.NONE });
        const stats = analyzeChunk(0, 0, 0, { world, chunkSize: WORLD_CHUNK_SIZE });
        assert.equal(stats.unseenCount, 1);
        assert.equal(stats.emptyCount, WORLD_CHUNK_SIZE ** 2 - 1);
    });
});
