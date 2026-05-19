import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPlanHistoryEntry, formatPlanHistorySection } from './npcPlanHistory.js';

describe('formatPlanHistoryEntry', () => {
    it('formats completed and failed outcomes', () => {
        assert.equal(
            formatPlanHistoryEntry({
                goal: 'eat_food',
                outcome: 'completed',
                position: '(1, 2, 0)',
            }),
            'eat_food — completed @ (1, 2, 0)',
        );
        assert.equal(
            formatPlanHistoryEntry({
                goal: 'gather_food',
                outcome: 'failed',
                failedStep: 'find edible_food (r=8, pickup)',
                error: 'Find: no edible_food within radius 8',
                position: '(9, 30, 0)',
            }),
            'gather_food — failed at find edible_food (r=8, pickup): Find: no edible_food within radius 8 @ (9, 30, 0)',
        );
    });
});

describe('formatPlanHistorySection', () => {
    it('returns empty for no records', () => {
        assert.deepEqual(formatPlanHistorySection([]), []);
    });

    it('numbers entries oldest first', () => {
        const lines = formatPlanHistorySection([
            { goal: 'a', outcome: 'failed', error: 'x' },
            { goal: 'b', outcome: 'completed' },
        ]);
        assert.match(lines[0], /oldest first/);
        assert.match(lines[1], /^1\. a/);
        assert.match(lines[2], /^2\. b/);
    });
});
