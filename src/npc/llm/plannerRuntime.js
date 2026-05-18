/**
 * Resolve LLM planner settings from the environment (Node) or browser (URL + localStorage).
 */
/** @typedef {import('./llmTypes.js').LlmProviderConfig} LlmProviderConfig */

const STORAGE_PREFIX = 'world.llm.';

/**
 * @returns {boolean}
 */
function isBrowser() {
    return typeof globalThis.location !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

/**
 * @param {string} key
 * @returns {string | undefined}
 */
function readStorage(key) {
    if (!isBrowser()) return undefined;
    const value = globalThis.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    return value?.trim() || undefined;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {LlmProviderConfig | null}
 */
export function resolveNodePlannerConfig(env = process.env) {
    const providerId = env.WORLD_LLM_PROVIDER ?? env.OPENROUTER_API_KEY ? 'openrouter' : undefined;
    if (!providerId || providerId === 'mock' || providerId === 'none') {
        return null;
    }

    const apiKey =
        env.WORLD_LLM_API_KEY ??
        env.OPENROUTER_API_KEY ??
        env.OPENAI_API_KEY;

    if (providerId === 'openrouter' && !apiKey?.trim()) {
        return null;
    }

    return {
        providerId: /** @type {LlmProviderConfig['providerId']} */ (providerId),
        apiKey: apiKey?.trim(),
        baseUrl: env.WORLD_LLM_BASE_URL?.trim(),
        model: env.WORLD_LLM_MODEL?.trim(),
        referer: env.WORLD_LLM_REFERER?.trim(),
        appTitle: env.WORLD_LLM_APP_TITLE?.trim(),
    };
}

/**
 * Browser: enable with `?llm=openrouter` (or `openai-compatible`) and set keys in localStorage:
 *   world.llm.apiKey, world.llm.model (optional), world.llm.baseUrl (for local)
 *
 * @returns {LlmProviderConfig | null}
 */
export function resolveBrowserPlannerConfig() {
    if (!isBrowser()) return null;

    const params = new URLSearchParams(globalThis.location.search);
    const providerId =
        params.get('llm') ??
        readStorage('provider') ??
        (readStorage('apiKey') ? 'openrouter' : undefined);

    if (!providerId || providerId === 'mock' || providerId === 'none') {
        return null;
    }

    if (providerId !== 'openrouter' && providerId !== 'openai-compatible') {
        console.warn(`[World] Unknown llm provider "${providerId}", using mock planner`);
        return null;
    }

    const apiKey = readStorage('apiKey');
    const baseUrl = params.get('baseUrl') ?? readStorage('baseUrl');

    if (providerId === 'openrouter' && !apiKey) {
        console.warn(
            '[World] ?llm=openrouter but no API key. Set localStorage: world.llm.apiKey = "sk-or-..."',
        );
        return null;
    }

    if (providerId === 'openai-compatible' && !baseUrl) {
        console.warn(
            '[World] ?llm=openai-compatible requires baseUrl (?baseUrl= or localStorage world.llm.baseUrl)',
        );
        return null;
    }

    return {
        providerId: /** @type {LlmProviderConfig['providerId']} */ (providerId),
        apiKey,
        baseUrl: baseUrl ?? undefined,
        model: params.get('model') ?? readStorage('model'),
        referer: globalThis.location.origin,
        appTitle: 'World',
    };
}

/**
 * @returns {LlmProviderConfig | null}
 */
export function resolvePlannerConfig() {
    if (isBrowser()) return resolveBrowserPlannerConfig();
    return resolveNodePlannerConfig();
}
