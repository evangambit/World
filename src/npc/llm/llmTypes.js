/**
 * Generic LLM provider types — shared by OpenRouter, local OpenAI-compatible servers, etc.
 */

/** @typedef {'system' | 'user' | 'assistant'} LlmRole */

/**
 * @typedef {Object} LlmChatMessage
 * @property {LlmRole} role
 * @property {string} content
 */

/**
 * @typedef {Object} LlmCompletionRequest
 * @property {LlmChatMessage[]} messages
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {boolean} [jsonMode]
 */

/**
 * @typedef {Object} LlmCompletionResult
 * @property {string} content
 * @property {boolean} [cached] - true when served from localStorage cache
 */

/**
 * @typedef {Object} LlmProvider
 * @property {string} id
 * @property {(request: LlmCompletionRequest) => Promise<LlmCompletionResult>} complete
 */

/**
 * @typedef {Object} LlmProviderConfig
 * @property {'openrouter' | 'openai-compatible'} providerId
 * @property {string} [apiKey]
 * @property {string} [baseUrl]
 * @property {string} [model]
 * @property {string} [referer]
 * @property {string} [appTitle]
 */

export {};
