/**
 * Test helpers — drive NPC locomotion until async travel/plan work settles.
 */
import assert from 'node:assert/strict';
import { tickNpcLocomotion } from '../../actors/npcLocomotion.js';

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */

/**
 * @typedef {Object} DriveLocomotionOptions
 * @property {number} [maxTicks] - hard cap (default 10000)
 * @property {number} [dt] - seconds per tick (default 0.05)
 * @property {(npc: NpcEntity) => void} [onTick] - e.g. syncMemoryRefTravelGoal
 */

/**
 * Tick locomotion until `promise` settles or fail fast (avoids hanging tests).
 * @template T
 * @param {NpcEntity} npc
 * @param {Promise<T>} promise
 * @param {DriveLocomotionOptions} [opts]
 * @returns {Promise<T>}
 */
export async function driveLocomotionUntil(npc, promise, opts = {}) {
    const maxTicks = opts.maxTicks ?? 10_000;
    const dt = opts.dt ?? 0.05;
    let settled = false;
    promise.finally(() => {
        settled = true;
    });

    for (let i = 0; i < maxTicks && !settled; i++) {
        opts.onTick?.(npc);
        tickNpcLocomotion(npc, dt);
        // Let travel/plan promise continuations run (finally() is a microtask).
        await Promise.resolve();
    }

    assert.ok(
        settled,
        `driveLocomotionUntil: promise did not settle within ${maxTicks} locomotion ticks`,
    );
    return promise;
}
