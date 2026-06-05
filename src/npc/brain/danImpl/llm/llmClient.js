/**
 * LLM client for Dan think and conversation turns (structured JSON responses).
 */
import { resolveDanLlmConfig, isDanLlmLoggingEnabled } from './llmConfig.js';
import { extractJsonObject } from './extractJson.js';

const LOG_PREFIX = '[DanLLM]';

/**
 * @param {'think' | 'conversation'} mode
 * @param {'request' | 'response' | 'mock'} kind
 * @param {Record<string, unknown>} payload
 */
function logLlmExchange(mode, kind, payload) {
    if (!isDanLlmLoggingEnabled()) return;
    const label = `${LOG_PREFIX} ${mode} ${kind}`;
    console.groupCollapsed(label);
    console.log(payload);
    console.groupEnd();
}

/**
 * @typedef {Object} ThinkOutput
 * @property {string} [thought]
 * @property {import('../brainTweak.js').BrainTweak} [brainTweak]
 */

/**
 * @typedef {Object} ConversationTurnOutput
 * @property {string} say
 * @property {boolean} [endConversation]
 * @property {import('../brainTweak.js').BrainTweak} [brainTweak]
 */

/**
 * @param {'think' | 'conversation'} mode
 * @returns {object}
 */
function mockLlmResponse(mode) {
    if (mode === 'conversation') {
        return { say: '(LLM disabled — set ?llm=openrouter&apiKey=...)', endConversation: true };
    }
    return { thought: '(LLM disabled — press T with API key configured to think)' };
}

/**
 * @param {string} system
 * @param {string} user
 * @param {'think' | 'conversation'} mode
 * @returns {Promise<object>}
 */
async function callLlmRaw(system, user, mode) {
    const config = resolveDanLlmConfig();

    logLlmExchange(mode, 'request', {
        provider: config.provider,
        model: config.model,
        system,
        user,
    });

    if (config.provider === 'mock') {
        const mock = mockLlmResponse(mode);
        logLlmExchange(mode, 'mock', { parsed: mock });
        return mock;
    }

    const url = `${config.baseUrl}/chat/completions`;
    const body = {
        model: config.model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.4,
    };

    const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
    };
    if (config.provider === 'openrouter') {
        headers['HTTP-Referer'] = globalThis.location?.origin ?? 'http://localhost';
        headers['X-Title'] = 'World';
    }

    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const errText = await res.text();
        logLlmExchange(mode, 'response', {
            error: `HTTP ${res.status}`,
            body: errText.slice(0, 2000),
        });
        throw new Error(`LLM request failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
        logLlmExchange(mode, 'response', { error: 'missing message content', data });
        throw new Error('LLM response missing message content');
    }

    let parsed;
    try {
        parsed = extractJsonObject(content);
    } catch (err) {
        logLlmExchange(mode, 'response', {
            error: err instanceof Error ? err.message : String(err),
            raw: content,
        });
        throw err;
    }

    logLlmExchange(mode, 'response', { raw: content, parsed });
    return parsed;
}

/**
 * @param {ThinkOutput} output
 * @returns {ThinkOutput}
 */
function validateThinkOutput(output) {
    if (output.brainTweak != null && typeof output.brainTweak !== 'object') {
        throw new Error('Invalid brainTweak in ThinkOutput');
    }
    if (output.thought != null && typeof output.thought !== 'string') {
        throw new Error('Invalid thought in ThinkOutput');
    }
    return output;
}

/**
 * @param {ConversationTurnOutput} output
 * @returns {ConversationTurnOutput}
 */
function validateConversationOutput(output) {
    if (typeof output.say !== 'string' || !output.say.trim()) {
        throw new Error('ConversationTurnOutput requires non-empty say');
    }
    if (output.brainTweak != null && typeof output.brainTweak !== 'object') {
        throw new Error('Invalid brainTweak in ConversationTurnOutput');
    }
    return output;
}

/**
 * @param {string} system
 * @param {string} user
 * @returns {Promise<ThinkOutput>}
 */
export async function callThinkLlm(system, user) {
    const output = await callLlmRaw(system, user, 'think');
    return validateThinkOutput(/** @type {ThinkOutput} */ (output));
}

/**
 * @param {string} system
 * @param {string} user
 * @returns {Promise<ConversationTurnOutput>}
 */
export async function callConversationLlm(system, user) {
    const output = await callLlmRaw(system, user, 'conversation');
    return validateConversationOutput(/** @type {ConversationTurnOutput} */ (output));
}
