/**
 * Resolve NPC brain type from URL parameters.
 *
 * Usage: ?brain=wander  (valid values: wander, noop)
 *
 * Defaults to "wander".
 */
import { DanBrain, WanderBrain, NoopNpcBrain } from '../brain/index.js';

/** @typedef {import('../brain/interface.js').NpcBrain} NpcBrain */
/** @typedef {'wander' | 'noop' | 'dan'} BrainType */

const VALID_BRAIN_TYPES = /** @type {BrainType[]} */ (['wander', 'noop', 'dan']);

/**
 * @returns {BrainType}
 */
export function resolveBrainType() {
    if (typeof globalThis.location === 'undefined') return 'wander';
    const params = new URLSearchParams(globalThis.location.search);
    const value = /** @type {string | null} */ (params.get('brain'))?.toLowerCase();
    if (value && VALID_BRAIN_TYPES.includes(/** @type {BrainType} */ (value))) {
        return /** @type {BrainType} */ (value);
    }
    if (value) {
        console.warn(
            `[World] Unknown brain type "${value}", using "wander". Valid: ${VALID_BRAIN_TYPES.join(', ')}`,
        );
    }
    return 'wander';
}

/**
 * @param {BrainType} brainType
 * @returns {NpcBrain}
 */
export function createBrainForType(brainType) {
    if (brainType === 'noop') return new NoopNpcBrain();
    if (brainType === 'dan') return new DanBrain();
    return new WanderBrain();
}
