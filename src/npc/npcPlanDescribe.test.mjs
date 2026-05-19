import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    describePlanStep,
    formatPlanOutline,
    getPlanStepAt,
} from './npcPlanDescribe.js';

describe('npcPlanDescribe', () => {
    it('describes leaf steps', () => {
        assert.equal(
            describePlanStep({ type: 'goto', ref: 'rememberLocationsOfNearby(stove)' }),
            'goto rememberLocationsOfNearby(stove)',
        );
        assert.equal(
            describePlanStep({ type: 'find', object: 'edible_food', radius: 8, pickup: true }),
            'find edible_food (r=8, pickup)',
        );
    });

    it('marks the active step in the outline', () => {
        const plan = {
            type: 'seq',
            steps: [
                { type: 'find', object: 'edible_food', radius: 8, pickup: true },
                { type: 'eat', object: 'edible_food', from: 'inventory' },
            ],
        };
        const lines = formatPlanOutline(plan, [0]);
        assert.match(lines[1], /^  > find/);
        assert.match(lines[2], /^    eat/);
        assert.equal(getPlanStepAt(plan, [0])?.type, 'find');
    });
});
