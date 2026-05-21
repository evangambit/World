/**
 * Resolve NPC brain type from URL parameters.
 *
 * Usage: ?brain=wander  (valid values: task, wander, noop)
 *
 * Defaults to "task" (full perception + plans + optional LLM planner).
 */
import { createDefaultTaskBrain, createWanderBrain, noopNpcBrain } from './npcBrain.js';

/** @typedef {import('./npcBrain.js').NpcBrain} NpcBrain */
/** @typedef {import('./llm/npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {'task' | 'wander' | 'noop'} BrainType */

const VALID_BRAIN_TYPES = /** @type {BrainType[]} */ (['task', 'wander', 'noop']);

/**
 * @returns {BrainType}
 */
export function resolveBrainType() {
    if (typeof globalThis.location === 'undefined') return 'task';
    const params = new URLSearchParams(globalThis.location.search);
    const value = /** @type {string | null} */ (params.get('brain'))?.toLowerCase();
    if (value && VALID_BRAIN_TYPES.includes(/** @type {BrainType} */ (value))) {
        return /** @type {BrainType} */ (value);
    }
    if (value) {
        console.warn(
            `[World] Unknown brain type "${value}", using "task". Valid: ${VALID_BRAIN_TYPES.join(', ')}`,
        );
    }
    return 'task';
}

/**
 * @param {BrainType} brainType
 * @param {{ planner?: NpcPlannerFn }} [opts]
 * @returns {NpcBrain}
 */
export function createBrainForType(brainType, opts = {}) {
    if (brainType === 'wander') return createWanderBrain();
    if (brainType === 'noop') return noopNpcBrain();
    return createDefaultTaskBrain(opts);
}
