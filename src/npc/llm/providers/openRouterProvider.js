/**
 * OpenRouter chat completions — https://openrouter.ai/docs
 */
/** @typedef {import('../llmTypes.js').LlmProvider} LlmProvider */
/** @typedef {import('../llmTypes.js').LlmProviderConfig} LlmProviderConfig */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-3.5-haiku';

/**
 * @param {LlmProviderConfig} config
 * @returns {LlmProvider}
 */
export function createOpenRouterProvider(config) {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
        throw new Error('OpenRouter provider requires apiKey');
    }

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const defaultModel = config.model ?? DEFAULT_MODEL;
    const referer =
        config.referer ??
        (typeof globalThis.location !== 'undefined' ? globalThis.location.origin : '');
    const appTitle = config.appTitle ?? 'World';

    return {
        id: 'openrouter',

        /**
         * @param {import('../llmTypes.js').LlmCompletionRequest} request
         */
        async complete(request) {
            /** @type {Record<string, string>} */
            const headers = {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            };
            if (referer) headers['HTTP-Referer'] = referer;
            if (appTitle) headers['X-Title'] = appTitle;

            const body = {
                model: request.model ?? defaultModel,
                messages: request.messages,
                temperature: request.temperature ?? 0.2,
            };
            if (request.jsonMode) {
                body.response_format = { type: 'json_object' };
            }

            const res = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });

            const raw = await res.text();
            if (!res.ok) {
                throw new Error(`OpenRouter HTTP ${res.status}: ${raw.slice(0, 500)}`);
            }

            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                throw new Error(`OpenRouter: non-JSON response: ${raw.slice(0, 200)}`);
            }

            const content = data?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
                throw new Error('OpenRouter: empty message content');
            }

            return { content };
        },
    };
}
