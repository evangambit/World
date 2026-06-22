/**
 * BrainTweak — structured mutations from LLM think/conversation responses.
 */
import { VILLAGE_NPC_SPAWNS } from '../../../content/builder.js';

/** @typedef {'low' | 'normal' | 'high'} TalkUrgency */

/**
 * @typedef {Object} PendingTask
 * @property {'talk_to'} type
 * @property {string} target
 * @property {string} message
 * @property {TalkUrgency} urgency
 */

/**
 * @typedef {Object} BrainTweak
 * @property {PendingTask} [addPendingTask]
 */

const KNOWN_NPC_NAMES = new Set(VILLAGE_NPC_SPAWNS.map((s) => s.name));

/**
 * @param {BrainTweak} tweak
 * @param {string} selfName
 * @param {Map<string, import('./danBrain.js').DanBrain> | null} npcRegistry
 * @returns {BrainTweak}
 */
export function sanitizeBrainTweak(tweak, selfName, npcRegistry) {
    /** @type {BrainTweak} */
    const out = {};

    if (tweak.addPendingTask) {
        const pt = tweak.addPendingTask;
        if (pt.type !== 'talk_to') return out;
        if (!KNOWN_NPC_NAMES.has(pt.target) || pt.target === selfName) return out;
        const urgency = pt.urgency === 'low' || pt.urgency === 'high' ? pt.urgency : 'normal';
        if (npcRegistry && !npcRegistry.has(pt.target)) return out;
        out.addPendingTask = {
            type: 'talk_to',
            target: pt.target,
            message: String(pt.message ?? '').slice(0, 500),
            urgency,
        };
    }

    return out;
}
