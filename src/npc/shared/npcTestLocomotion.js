/**
 * Test helpers — drive NPC locomotion until async travel/plan work settles.
 */
import assert from 'node:assert/strict';
import { tickNpcLocomotionFrame } from '../../actors/npcSimulation.js';

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */

/**
 * @typedef {Object} DriveLocomotionOptions
 * @property {number} [maxTicks] - hard cap (default 10000)
 * @property {number} [dt] - seconds per tick (default 0.05)
 * @property {import('../../world/world.js').World3D} world - required (applies pending move actions)
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
    const { world } = opts;
    assert.ok(world, 'driveLocomotionUntil requires opts.world');
    const maxTicks = opts.maxTicks ?? 10_000;
    const dt = opts.dt ?? 0.05;
    let settled = false;
    promise.finally(() => {
        settled = true;
    });

    for (let i = 0; i < maxTicks && !settled; i++) {
        opts.onTick?.(npc);
        tickNpcLocomotionFrame(npc, world, dt);
        // Let travel/plan promise continuations run (finally() is a microtask).
        await Promise.resolve();
    }

    assert.ok(
        settled,
        `driveLocomotionUntil: promise did not settle within ${maxTicks} locomotion ticks`,
    );
    return promise;
}
