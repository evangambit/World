/**
 * Resolve NPC brain type from URL parameters.
 *
 * Usage: ?brain=thomas  (valid values: thomas, wander, noop)
 *
 * Defaults to "thomas".
 */
import { ThomasBrain, WanderBrain, NoopNpcBrain } from '../brain/index.js';

/** @typedef {import('../brain/interface.js').NpcBrain} NpcBrain */
/** @typedef {'thomas' | 'wander' | 'noop'} BrainType */

const VALID_BRAIN_TYPES = /** @type {BrainType[]} */ (['thomas', 'wander', 'noop']);

/**
 * @returns {BrainType}
 */
export function resolveBrainType() {
    if (typeof globalThis.location === 'undefined') return 'thomas';
    const params = new URLSearchParams(globalThis.location.search);
    const value = /** @type {string | null} */ (params.get('brain'))?.toLowerCase();
    if (value && VALID_BRAIN_TYPES.includes(/** @type {BrainType} */ (value))) {
        return /** @type {BrainType} */ (value);
    }
    if (value) {
        console.warn(
            `[World] Unknown brain type "${value}", using "thomas". Valid: ${VALID_BRAIN_TYPES.join(', ')}`,
        );
    }
    return 'thomas';
}

/**
 * @param {BrainType} brainType
 * @returns {NpcBrain}
 */
export function createBrainForType(brainType) {
    if (brainType === 'wander') return new WanderBrain();
    if (brainType === 'noop') return new NoopNpcBrain();
    return new ThomasBrain();
}
