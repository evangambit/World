import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EAT_FOOD_PLAN } from '../npcPlanTemplates.js';
import { createLlmNpcPlanner } from './createLlmPlanner.js';

describe('createLlmNpcPlanner', () => {
    it('parses valid JSON from the provider', async () => {
        /** @type {import('./llmTypes.js').LlmProvider} */
        const provider = {
            id: 'test',
            async complete() {
                return { content: JSON.stringify(EAT_FOOD_PLAN) };
            },
        };

        const planner = createLlmNpcPlanner(provider);
        const doc = await planner({
            npc: { name: 'T', hunger: 50, inventory: [] },
            world: {},
            event: { reason: 'idle' },
            messages: { system: 'sys', user: 'user' },
        });

        assert.equal(doc?.goal, 'eat_food');
    });

    it('retries once when the first response is invalid', async () => {
        let calls = 0;
        const provider = {
            id: 'test',
            async complete() {
                calls += 1;
                if (calls === 1) return { content: 'not json' };
                return { content: JSON.stringify(EAT_FOOD_PLAN) };
            },
        };

        const planner = createLlmNpcPlanner(provider);
        const doc = await planner({
            npc: { name: 'T', hunger: 50, inventory: [] },
            world: {},
            event: { reason: 'idle' },
            messages: { system: 'sys', user: 'user' },
        });

        assert.equal(calls, 2);
        assert.equal(doc?.goal, 'eat_food');
    });
});
