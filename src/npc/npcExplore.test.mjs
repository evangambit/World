import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNpcEntity } from '../actors/npcSimulation.js';
import { createTaskBrain } from './brain/index.js';
import { Obj, T } from '../world/tileTypes.js';
import { World3D } from '../world/world.js';
import { snapshotTileState } from './npcMemory.js';
import { runPlan, validatePlan } from './npcPlanRunner.js';
import { EAT_FOOD_PLAN } from './npcPlanTemplates.js';
import { driveLocomotionUntil } from './npcTestLocomotion.js';
import {
    generateExploreWaypoints,
    pickNextExploreWaypoint,
    runExplore,
} from './npcExplore.js';

/**
 * @param {World3D} world
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 */
function fillGrass(world, x0, y0, x1, y1) {
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            world.setTile(x, y, 0, { terrain: T.GRASS, obj: 0 });
        }
    }
}

describe('generateExploreWaypoints', () => {
    it('covers a disk with walkable grid points', () => {
        const world = new World3D();
        fillGrass(world, 0, 0, 10, 10);
        world.setTile(5, 5, 0, { terrain: T.GRASS, obj: Obj.STOVE });

        const waypoints = generateExploreWaypoints(world, { x: 5, y: 5, z: 0 }, 10, 5);
        assert.ok(waypoints.length >= 4);
        assert.ok(waypoints.every((wp) => world.isWalkable(wp.x, wp.y, wp.z)));
        assert.ok(waypoints.every((wp) => Math.max(Math.abs(wp.x - 5), Math.abs(wp.y - 5)) <= 10));
    });
});

describe('pickNextExploreWaypoint', () => {
    it('prefers the nearest unvisited reachable tile', () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 14, 14);
        const npc = createNpcEntity(10.5, 10.5, 0, { brain: createTaskBrain() });
        const waypoints = [
            { x: 14, y: 14, z: 0 },
            { x: 11, y: 10, z: 0 },
        ];
        const visited = new Set();

        const next = pickNextExploreWaypoint(npc, world, waypoints, visited);
        assert.deepEqual(next, { x: 11, y: 10, z: 0 });
    });
});

describe('runExplore', () => {
    it('picks up a distant flower by visiting waypoints', async () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 25, 25);
        world.setTile(10, 22, 0, { terrain: T.GRASS, obj: Obj.FLOWER });

        const npc = createNpcEntity(10.5, 10.5, 0, { brain: createTaskBrain() });
        npc.homeX = 10;
        npc.homeY = 10;
        npc.homeZ = 0;

        await driveLocomotionUntil(
            npc,
            runExplore(npc, world, {
                objectTag: 'edible_food',
                radius: 16,
                anchor: 'home',
            }),
        );

        assert.ok(npc.inventory?.some((s) => s.objType === Obj.FLOWER && s.count > 0));
        assert.equal(world.getTile(10, 22, 0)?.obj, 0);
    });

    it('uses remembered tile before wandering the grid', async () => {
        const world = new World3D();
        fillGrass(world, 10, 10, 20, 20);
        world.setTile(10, 18, 0, { terrain: T.GRASS, obj: Obj.FLOWER });

        const npc = createNpcEntity(10.5, 10.5, 0, { brain: createTaskBrain() });
        npc.homeX = 10;
        npc.homeY = 10;
        npc.brain.observeTile(10, 18, 0, {
            seenAt: 1,
            state: snapshotTileState({ terrain: T.GRASS, obj: Obj.FLOWER }),
        });

        await driveLocomotionUntil(
            npc,
            runExplore(npc, world, {
                objectTag: 'edible_food',
                radius: 12,
                anchor: 'home',
            }),
        );

        assert.ok(npc.inventory?.some((s) => s.objType === Obj.FLOWER));
    });
});

describe('explore plan step', () => {
    it('validates and runs via runPlan', async () => {
        assert.equal(validatePlan(EAT_FOOD_PLAN.plan), null);

        const world = new World3D();
        fillGrass(world, 0, 0, 30, 30);
        world.setTile(5, 15, 0, { terrain: T.GRASS, obj: Obj.FLOWER });

        const npc = createNpcEntity(5.5, 5.5, 0, { brain: createTaskBrain() });
        npc.homeX = 5;
        npc.homeY = 5;

        const result = await driveLocomotionUntil(
            npc,
            runPlan(npc, world, {
                type: 'explore',
                object: 'edible_food',
                radius: 14,
                anchor: 'home',
                pickup: true,
            }),
        );
        assert.equal(result.ok, true);
    });
});
