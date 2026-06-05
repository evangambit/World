import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActionMemory } from './actionMemory.js';

/**
 * Build a movement entry for 'Elara' at the given position, targeting (tx, ty).
 * @param {number} tick
 * @param {number} x
 * @param {number} y
 * @param {number} tx
 * @param {number} ty
 * @returns {import('./actionMemory.js').ActionMemoryEntry}
 */
function movEntry(tick, x, y, tx, ty) {
    return {
        subject: 'Elara',
        action: 'movement',
        location: [x, y, 0],
        tick,
        details: `→ (${tx}, ${ty})`,
    };
}

/**
 * Build a movement entry for another NPC (simulate observeNpc).
 */
function otherMovEntry(tick, name, x, y) {
    return {
        subject: name,
        action: 'movement',
        location: [x, y, 0],
        tick,
        details: 'seen nearby',
    };
}

describe('ActionMemory', () => {
    it('compresses a self movement run to start+latest even when other-NPC entries are interleaved', () => {
        const mem = new ActionMemory('Elara');

        // Simulate 10 movement steps, each followed by an observeNpc call for
        // another villager — exactly what happens every frame in main.js.
        for (let i = 0; i < 10; i++) {
            mem.append(movEntry(200 + i, 10 + i, 20, 11 + i, 20));
            mem.append(otherMovEntry(200 + i, 'Finn', 30 + i, 40));
        }

        const slice = mem.getPromptActionSlice();
        const selfMoves = slice.filter((e) => e.subject === 'Elara' && e.action === 'movement');

        // Buffer holds start + latest → at most 2 self movement entries in the slice.
        assert.ok(
            selfMoves.length <= 2,
            `Expected ≤2 self movement entries in prompt slice, got ${selfMoves.length}`,
        );
    });

    it('flushes the movement buffer when a self non-movement entry is appended', () => {
        const mem = new ActionMemory('Elara');

        mem.append(movEntry(200, 10, 20, 11, 20));
        mem.append(movEntry(201, 11, 20, 12, 20));

        // A think entry for self should flush the buffer.
        mem.append({ subject: 'Elara', action: 'think', location: [12, 20, 0], tick: 202, details: 'I need food' });

        const slice = mem.getPromptActionSlice();
        const selfMoves = slice.filter((e) => e.subject === 'Elara' && e.action === 'movement');

        // Both start and latest should now be in _entries (flushed by the think).
        assert.equal(selfMoves.length, 2, 'Expected start+latest to be flushed into entries');
        assert.equal(selfMoves[0].location[0], 10, 'First entry should be the start of the run');
        assert.equal(selfMoves[1].location[0], 11, 'Second entry should be the latest of the run');
    });

    it('reports correct length including the buffered entries', () => {
        const mem = new ActionMemory('Elara');

        assert.equal(mem.length, 0);

        mem.append(movEntry(1, 0, 0, 1, 0));
        assert.equal(mem.length, 1); // one entry in the buffer

        mem.append(movEntry(2, 1, 0, 2, 0));
        assert.equal(mem.length, 2); // start + latest

        mem.append(movEntry(3, 2, 0, 3, 0));
        assert.equal(mem.length, 2); // start stays, latest advances

        mem.append(otherMovEntry(3, 'Finn', 5, 5));
        assert.equal(mem.length, 3); // 2 buffered self entries + 1 Finn entry in _entries
    });
});
