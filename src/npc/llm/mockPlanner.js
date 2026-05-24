/**
 * Stand-in planner for tests and local dev — returns built-in eat plan when hungry.
 */
import { VITALITY } from '../../domain/vitality.js';
import { EAT_FOOD_PLAN } from '../brain/taskImpl/npcPlanTemplates.js';
import { buildPlannerMessages } from './npcPrompt.js';

/** @typedef {import('./npcPlanner.js').PlannerRequest} PlannerRequest */

/** Hunger at or above this → mock returns eat_food plan. */
export const MOCK_EAT_HUNGER_THRESHOLD = 40;

/**
 * @param {PlannerRequest} request
 * @returns {Promise<import('../brain/taskImpl/npcTasks.js').PlanDocument | null>}
 */
export async function mockRequestPlan(request) {
    const { npc, event } = request;
    const hunger = npc.hunger ?? 0;

    if (hunger >= MOCK_EAT_HUNGER_THRESHOLD) {
        return structuredClone(EAT_FOOD_PLAN);
    }

    return null;
}

export { buildPlannerMessages };
