/**
 * Build an NPC planner from a generic LlmProvider.
 */
import { extractJsonFromText } from './extractJson.js';
import { createLlmProvider } from './providers/createLlmProvider.js';
import { parsePlanDocument } from './npcPlanner.js';

/** @typedef {import('./llmTypes.js').LlmProvider} LlmProvider */
/** @typedef {import('./llmTypes.js').LlmProviderConfig} LlmProviderConfig */
/** @typedef {import('./npcPlanner.js').PlannerRequest} PlannerRequest */
/** @typedef {import('./npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {import('../npcTasks.js').PlanDocument} PlanDocument */

/**
 * @typedef {Object} LlmPlannerOptions
 * @property {number} [maxAttempts]
 * @property {number} [temperature]
 * @property {string} [model]
 */

/**
 * @param {LlmProvider} provider
 * @param {LlmPlannerOptions} [opts]
 * @returns {NpcPlannerFn}
 */
export function createLlmNpcPlanner(provider, opts = {}) {
    const maxAttempts = opts.maxAttempts ?? 2;
    const temperature = opts.temperature ?? 0.2;
    const model = opts.model;

    return async function llmRequestPlan(request) {
        let userContent = request.messages.user;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const { content } = await provider.complete({
                model,
                temperature,
                jsonMode: true,
                messages: [
                    { role: 'system', content: request.messages.system },
                    { role: 'user', content: userContent },
                ],
            });

            const parsed = parsePlanDocument(extractJsonFromText(content));
            if (parsed.ok) return parsed.doc;

            userContent = [
                request.messages.user,
                '',
                `Your previous reply was not a valid plan document: ${parsed.error}`,
                'Reply with a single corrected JSON object only.',
            ].join('\n');
        }

        return null;
    };
}

/**
 * @param {LlmProviderConfig} config
 * @param {LlmPlannerOptions} [opts]
 * @returns {NpcPlannerFn}
 */
export function createNpcPlannerFromConfig(config, opts = {}) {
    const provider = createLlmProvider(config);
    return createLlmNpcPlanner(provider, {
        ...opts,
        model: opts.model ?? config.model,
    });
}
