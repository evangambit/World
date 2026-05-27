import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../../world/world.js';
import { Obj, T } from '../../../world/tileTypes.js';
import { Entity } from '../../../actors/entity.js';
import { snapshotTileState } from '../../shared/npcMemory.js';
import { createHypotheticalFromMemory } from '../../shared/hypotheticalWorld.js';
import { walkToLocation } from './walkToLocation.js';

/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */

/**
 * @param {number} [terrain]
 * @param {number} [obj]
 */
function walkableState(terrain = T.GRASS, obj = Obj.NONE) {
    return snapshotTileState({ terrain, obj });
}

/**
 * @param {Iterable<[number, number, number]>} coords
 * @returns {Map<string, import('../../shared/npcMemory.js').TileMemoryEntry>}
 */
function memoryForTiles(coords) {
    const memory = new Map();
    for (const [x, y, z] of coords) {
        memory.set(World3D.key(x, y, z), { seenAt: 0, state: walkableState() });
    }
    return memory;
}

/**
 * @param {Map<string, import('../../shared/npcMemory.js').TileMemoryEntry>} memory
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function blockTileInMemory(memory, x, y, z) {
    memory.set(World3D.key(x, y, z), {
        seenAt: 1,
        state: walkableState(T.WATER, Obj.NONE),
    });
}

/**
 * @param {Entity} entity
 * @param {HypotheticalWorld} world
 * @param {{ x: number, y: number, z: number }} target
 * @param {import('./walkToLocation.js').WalkToLocationOptions} [options]
 * @param {(entity: Entity, action: EntityAction) => { ok: boolean, message?: string }} [simulateMove]
 */
function runWalk(entity, world, target, options, simulateMove) {
    const gen = walkToLocation(entity, world, target, options);
    /** @type {EntityAction[]} */
    const actions = [];
    let step = gen.next();
    while (!step.done) {
        actions.push(step.value);
        const moveResult = simulateMove
            ? simulateMove(entity, step.value)
            : succeedAdjacentMove(entity, step.value);
        step = gen.next(moveResult);
    }
    return { result: step.value, actions };
}

/**
 * @param {Entity} entity
 * @param {EntityAction} action
 */
function succeedAdjacentMove(entity, action) {
    if (action.type !== 'moveToTile') {
        return { ok: false, message: 'Expected moveToTile action' };
    }
    entity.x = action.tileX + 0.5;
    entity.y = action.tileY + 0.5;
    entity.z = action.tileZ;
    return { ok: true };
}

describe('walkToLocation', () => {
    it('yields moveToTile for each step and completes at target', () => {
        const memory = memoryForTiles([
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
        ]);
        const world = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        const { result, actions } = runWalk(entity, world, { x: 3, y: 0, z: 0 });

        assert.equal(result.ok, true);
        assert.equal(actions.length, 3);
        assert.equal(actions.every((a) => a.type === 'moveToTile'), true);
        assert.equal(actions[0].tileX, 1);
        assert.equal(actions[2].tileX, 3);
        assert.equal(Math.floor(entity.x), 3);
        assert.equal(Math.floor(entity.y), 0);
    });

    it('returns failure when target is unreachable in memory', () => {
        const memory = memoryForTiles([
            [0, 0, 0],
            [1, 0, 0],
        ]);
        const world = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        const { result, actions } = runWalk(entity, world, { x: 5, y: 0, z: 0 });

        assert.equal(result.ok, false);
        assert.equal(result.message, 'No path to target tile');
        assert.equal(actions.length, 0);
    });

    it('replans around a tile that becomes blocked on the current route', () => {
        const memory = memoryForTiles([
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
            [1, 1, 0],
            [2, 1, 0],
            [3, 1, 0],
        ]);
        const world = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        let getWorldCalls = 0;

        const { result, actions } = runWalk(
            entity,
            world,
            { x: 3, y: 0, z: 0 },
            {
                getWorld: () => {
                    getWorldCalls++;
                    if (getWorldCalls > 2) blockTileInMemory(memory, 2, 0, 0);
                    return createHypotheticalFromMemory(memory);
                },
            },
            succeedAdjacentMove,
        );

        assert.equal(result.ok, true);
        assert.equal(Math.floor(entity.x), 3);
        assert.equal(Math.floor(entity.y), 0);
        assert.ok(actions.some((a) => a.tileX === 1 && a.tileY === 1));
        assert.equal(actions.some((a) => a.tileX === 2 && a.tileY === 0), false);
    });

    it('replans after a failed move action', () => {
        const memory = memoryForTiles([
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
            [1, 1, 0],
            [2, 1, 0],
            [3, 1, 0],
        ]);
        const world = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        let blockedMidRoute = false;

        const { result, actions } = runWalk(
            entity,
            world,
            { x: 3, y: 0, z: 0 },
            {
                getWorld: () => {
                    if (blockedMidRoute) blockTileInMemory(memory, 2, 0, 0);
                    return createHypotheticalFromMemory(memory);
                },
            },
            (e, action) => {
                if (!blockedMidRoute && action.tileX === 2 && action.tileY === 0) {
                    blockedMidRoute = true;
                    return { ok: false, message: 'Tile blocked' };
                }
                return succeedAdjacentMove(e, action);
            },
        );

        assert.equal(result.ok, true);
        assert.equal(Math.floor(entity.x), 3);
        assert.ok(actions.length > 3);
        assert.ok(actions.some((a) => a.tileY === 1));
    });

    it('stops when replan limit is reached', () => {
        const memory = memoryForTiles([
            [0, 0, 0],
            [1, 0, 0],
            [2, 0, 0],
            [3, 0, 0],
        ]);
        const world = createHypotheticalFromMemory(memory);
        const entity = new Entity(0.5, 0.5, 0);
        let completedMoves = 0;

        const { result, actions } = runWalk(
            entity,
            world,
            { x: 3, y: 0, z: 0 },
            {
                maxReplans: 0,
                getWorld: () => {
                    if (completedMoves > 0) blockTileInMemory(memory, 2, 0, 0);
                    return createHypotheticalFromMemory(memory);
                },
            },
            (e, action) => {
                const move = succeedAdjacentMove(e, action);
                if (move.ok) completedMoves++;
                return move;
            },
        );

        assert.equal(result.ok, false);
        assert.equal(result.message, 'Path blocked and replan limit reached');
        assert.equal(actions.length, 1);
        assert.equal(Math.floor(entity.x), 1);
    });
});
