/**
 * Resolve LLM provider settings for Dan think/conversation calls (browser).
 */

/**
 * @typedef {Object} DanLlmConfig
 * @property {string} provider - 'openrouter' | 'openai' | 'mock'
 * @property {string} apiKey
 * @property {string} model
 * @property {string} baseUrl
 */

const DEFAULT_MODELS = {
    openrouter: 'openai/gpt-4o-mini',
    openai: 'gpt-4o-mini',
};

/**
 * @returns {DanLlmConfig}
 */
export function resolveDanLlmConfig() {
    if (typeof globalThis.location === 'undefined') {
        return {
            provider: 'mock',
            apiKey: '',
            model: 'mock',
            baseUrl: '',
        };
    }

    const params = new URLSearchParams(globalThis.location.search);
    const provider = (params.get('llm') || 'mock').toLowerCase();
    const apiKey =
        params.get('apiKey') ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('world_llm_api_key') : '') ||
        '';

    if (!apiKey || provider === 'mock') {
        return { provider: 'mock', apiKey: '', model: 'mock', baseUrl: '' };
    }

    if (provider === 'openai') {
        return {
            provider: 'openai',
            apiKey,
            model: params.get('model') || DEFAULT_MODELS.openai,
            baseUrl: 'https://api.openai.com/v1',
        };
    }

    return {
        provider: 'openrouter',
        apiKey,
        model: params.get('model') || DEFAULT_MODELS.openrouter,
        baseUrl: 'https://openrouter.ai/api/v1',
    };
}

/**
 * Log LLM prompts/responses to the browser console unless ?llmLog=0.
 *
 * @returns {boolean}
 */
export function isDanLlmLoggingEnabled() {
    if (typeof globalThis.location === 'undefined') return true;
    const v = new URLSearchParams(globalThis.location.search).get('llmLog');
    if (v === '0' || v === 'false') return false;
    return true;
}
