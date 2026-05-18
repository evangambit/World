/**
 * Factory for LLM backends.
 */
import { createOpenAiCompatibleProvider } from './openAiCompatibleProvider.js';
import { createOpenRouterProvider } from './openRouterProvider.js';

/** @typedef {import('../llmTypes.js').LlmProvider} LlmProvider */
/** @typedef {import('../llmTypes.js').LlmProviderConfig} LlmProviderConfig */

/**
 * @param {LlmProviderConfig} config
 * @returns {LlmProvider}
 */
export function createLlmProvider(config) {
    switch (config.providerId) {
        case 'openrouter':
            return createOpenRouterProvider(config);
        case 'openai-compatible':
            return createOpenAiCompatibleProvider(config);
        default:
            throw new Error(`Unknown LLM provider: ${config.providerId}`);
    }
}
