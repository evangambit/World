import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Obj } from '../../world/tileTypes.js';
import { parsePlanDocument } from './npcPlanner.js';
import { EAT_FOOD_PLAN } from '../brain/taskImpl/npcPlanTemplates.js';
import { NPCTaskRunner } from '../brain/taskImpl/npcTasks.js';
import { mockRequestPlan } from './mockPlanner.js';

describe('parsePlanDocument', () => {
    it('accepts a valid built-in plan', () => {
        const result = parsePlanDocument(EAT_FOOD_PLAN);
        assert.equal(result.ok, true);
        if (result.ok) assert.equal(result.doc.goal, 'eat_food');
    });

    it('rejects invalid plans', () => {
        const result = parsePlanDocument({ goal: 'x', plan: { type: 'nope', steps: [] } });
        assert.equal(result.ok, false);
    });
});

describe('NPCTaskRunner with mock planner', () => {
    it('calls planner when idle and enqueues eat plan', async () => {
        const npc = {
            name: 'Tester',
            hunger: 55,
            health: 100,
            homeX: 0,
            homeY: 0,
            homeZ: 0,
            inventory: [{ objType: Obj.STEAK, count: 1 }],
            isAlive: true,
            _dead: false,
            wanderRadius: 1,
        };
        let plannerCalls = 0;
        const runner = new NPCTaskRunner(npc, {
            planner: async (request) => {
                plannerCalls += 1;
                assert.equal(request.event.reason, 'idle');
                return mockRequestPlan(request);
            },
            plannerCooldownMs: 60_000,
            wanderOnPlannerFailure: false,
        });
        const world = { isWalkable: () => true };

        runner._schedulePlanner(world, { reason: 'idle' });
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(plannerCalls, 1);
        assert.ok(npc.hunger < 55, 'eat plan should reduce hunger');
        assert.equal(npc.inventory.length, 0, 'steak should be consumed');
    });
});
