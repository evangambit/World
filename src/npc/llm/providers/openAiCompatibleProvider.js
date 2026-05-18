/**
 * OpenAI-compatible chat API (Ollama, LM Studio, vLLM, many local stacks).
 */
/** @typedef {import('../llmTypes.js').LlmProvider} LlmProvider */
/** @typedef {import('../llmTypes.js').LlmProviderConfig} LlmProviderConfig */

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'llama3.2';

/**
 * @param {LlmProviderConfig} config
 * @returns {LlmProvider}
 */
export function createOpenAiCompatibleProvider(config) {
    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const defaultModel = config.model ?? DEFAULT_MODEL;
    const apiKey = config.apiKey?.trim();

    return {
        id: 'openai-compatible',

        /**
         * @param {import('../llmTypes.js').LlmCompletionRequest} request
         */
        async complete(request) {
            /** @type {Record<string, string>} */
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

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
                throw new Error(`LLM HTTP ${res.status}: ${raw.slice(0, 500)}`);
            }

            let data;
            try {
                data = JSON.parse(raw);
            } catch {
                throw new Error(`LLM: non-JSON response: ${raw.slice(0, 200)}`);
            }

            const content = data?.choices?.[0]?.message?.content;
            if (typeof content !== 'string' || !content.trim()) {
                throw new Error('LLM: empty message content');
            }

            return { content };
        },
    };
}
