/**
 * BrainTweak — structured mutations from LLM think/conversation responses.
 */
import { FARM_ZONES } from '../../../content/builder.js';
import { VILLAGE_NPC_SPAWNS } from '../../../content/builder.js';
import { isFarmZoneName } from './zoneUtils.js';

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
 * @property {Record<string, string | null>} [updateZoneOwnership]
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

    if (tweak.updateZoneOwnership) {
        /** @type {Record<string, string | null>} */
        const patch = {};
        for (const [zone, owner] of Object.entries(tweak.updateZoneOwnership)) {
            if (!isFarmZoneName(zone)) continue;
            if (owner !== null && typeof owner !== 'string') continue;
            if (owner !== null && !KNOWN_NPC_NAMES.has(owner)) continue;
            patch[zone] = owner;
        }
        if (Object.keys(patch).length > 0) out.updateZoneOwnership = patch;
    }

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
