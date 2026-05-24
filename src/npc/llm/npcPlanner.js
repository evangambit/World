/**
 * NPC planner contract and plan JSON validation.
 */
import { validatePlan } from '../brain/taskImpl/npcPlanRunner.js';

/** @typedef {import('../brain/taskImpl/npcTasks.js').PlanDocument} PlanDocument */

/** @typedef {import('./npcPrompt.js').PlannerEvent} PlannerEvent */

/**
 * @typedef {Object} PlannerRequest
 * @property {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @property {import('../../world/world.js').World3D} world
 * @property {PlannerEvent} event
 * @property {{ system: string, user: string }} messages
 */

/**
 * @typedef {(request: PlannerRequest) => Promise<PlanDocument | null>} NpcPlannerFn
 */

/**
 * @param {unknown} raw
 * @returns {{ ok: true, doc: PlanDocument } | { ok: false, error: string }}
 */
export function parsePlanDocument(raw) {
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: `invalid JSON: ${msg}` };
        }
    }

    if (value == null || typeof value !== 'object') {
        return { ok: false, error: 'plan document must be an object' };
    }

    const doc = /** @type {PlanDocument} */ (value);
    if (typeof doc.goal !== 'string' || !doc.goal) {
        return { ok: false, error: 'plan document requires a non-empty goal string' };
    }
    if (doc.plan == null || typeof doc.plan !== 'object') {
        return { ok: false, error: 'plan document requires a plan object' };
    }

    const validationError = validatePlan(doc.plan);
    if (validationError) return { ok: false, error: validationError };

    return { ok: true, doc };
}

/**
 * @param {PlanDocument | null} doc
 * @returns {PlanDocument | null}
 */
export function normalizePlannerResult(doc) {
    if (doc == null) return null;
    const parsed = parsePlanDocument(doc);
    return parsed.ok ? parsed.doc : null;
}
