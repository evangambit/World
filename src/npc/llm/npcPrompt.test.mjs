import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { World3D } from '../../world/world.js';
import { VITALITY } from '../../domain/vitality.js';
import { Obj, T } from '../../world/tileTypes.js';
import { createNpcEntity } from '../../actors/npcSimulation.js';
import { snapshotTileState, tickNpcPerception } from '../npcMemory.js';
import {
    buildSystemPrompt,
    buildUserPrompt,
    summarizeInventoryByTag,
} from './npcPrompt.js';
import { MOCK_EAT_HUNGER_THRESHOLD, mockRequestPlan } from './mockPlanner.js';
import { EAT_FOOD_PLAN } from '../npcPlanTemplates.js';

describe('buildSystemPrompt', () => {
    it('mentions starvation and plan combinators', () => {
        const prompt = buildSystemPrompt('Alice');
        assert.match(prompt, /Alice/);
        assert.match(prompt, /[Ss]tarv/);
        assert.match(prompt, /hunger.*0.*100/i);
        assert.match(prompt, /\bseq\b/);
        assert.match(prompt, /\bsel\b/);
        assert.match(prompt, /\beat\b/);
        assert.match(prompt, /edible_food/);
        assert.match(prompt, /rememberLocationsOfNearby/);
    });
});

describe('buildUserPrompt', () => {
    it('includes current hunger and event', () => {
        const npc = {
            name: 'Bob',
            hunger: 72,
            health: 90,
            homeX: 3,
            homeY: 4,
            homeZ: 0,
            inventory: [],
        };
        const user = buildUserPrompt(npc, { reason: 'idle' });
        assert.match(user, /hunger: 72/);
        assert.match(user, new RegExp(`\\/ ${VITALITY.MAX_HUNGER}`));
        assert.match(user, /reason: idle/);
    });

    it('includes recent plan history and failure context', () => {
        const npc = {
            hunger: 80,
            health: 100,
            homeX: 0,
            homeY: 0,
            homeZ: 0,
            inventory: [],
        };
        const user = buildUserPrompt(npc, {
            reason: 'plan_failed',
            goal: 'gather_food',
            error: 'Find: no edible_food within radius 8',
            failedStep: 'find edible_food (r=8, pickup)',
            position: '(9, 30, 0)',
            recentPlans: [
                { goal: 'eat_food', outcome: 'completed', position: '(8, 28, 0)' },
                {
                    goal: 'gather_food',
                    outcome: 'failed',
                    failedStep: 'find edible_food (r=8, pickup)',
                    error: 'Find: no edible_food within radius 8',
                    position: '(9, 30, 0)',
                },
            ],
        });
        assert.match(user, /failed_step: find edible_food/);
        assert.match(user, /position: \(9, 30, 0\)/);
        assert.match(user, /Recent plans/);
        assert.match(user, /1\. eat_food — completed/);
        assert.match(user, /2\. gather_food — failed/);
    });

    it('includes nearby chunk surroundings when world is provided', () => {
        const world = new World3D();
        const npc = createNpcEntity(10, 10, 0);
        world.setTile(10, 10, 0, { terrain: T.DIRT, obj: Obj.NONE });
        world.setTile(11, 10, 0, { terrain: T.WALL_STONE, obj: Obj.NONE });
        tickNpcPerception(npc, world, 1);

        const user = buildUserPrompt(
            npc,
            { reason: 'idle' },
            { world },
        );
        assert.match(user, /## Surroundings/);
        assert.match(user, /Nearby chunks/);
        assert.match(user, /dirt tile/);
    });
});

describe('summarizeInventoryByTag', () => {
    it('counts stacks by tag', () => {
        const npc = {
            inventory: [{ objType: Obj.STEAK, count: 2 }],
        };
        const counts = summarizeInventoryByTag(npc);
        assert.equal(counts.edible_food, 2);
    });
});

describe('mockRequestPlan', () => {
    it('returns eat plan when hungry', async () => {
        const doc = await mockRequestPlan({
            npc: { hunger: MOCK_EAT_HUNGER_THRESHOLD + 1, inventory: [] },
            world: {},
            event: { reason: 'idle' },
            messages: { system: '', user: '' },
        });
        assert.deepEqual(doc?.goal, EAT_FOOD_PLAN.goal);
    });

    it('returns null when not hungry', async () => {
        const doc = await mockRequestPlan({
            npc: { hunger: 0, inventory: [] },
            world: {},
            event: { reason: 'idle' },
            messages: { system: '', user: '' },
        });
        assert.equal(doc, null);
    });
});
