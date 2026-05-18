import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VITALITY } from '../../domain/vitality.js';
import { Obj } from '../../world/tileTypes.js';
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
        assert.match(prompt, /whereIsMyKitchen/);
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
