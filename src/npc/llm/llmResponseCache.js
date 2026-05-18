/**
 * Browser localStorage cache for LLM planner completions (reduces API cost).
 */
/** @typedef {import('./llmTypes.js').LlmProvider} LlmProvider */
/** @typedef {import('./llmTypes.js').LlmCompletionRequest} LlmCompletionRequest */

/** Bump when planner prompts change materially so stale plans are not reused. */
export const LLM_CACHE_VERSION = 2;

const STORAGE_PREFIX = 'world.llm.';
const INDEX_KEY = `${STORAGE_PREFIX}cache.v${LLM_CACHE_VERSION}.index`;
const ENTRY_PREFIX = `${STORAGE_PREFIX}cache.v${LLM_CACHE_VERSION}.`;
const DEFAULT_MAX_ENTRIES = 64;

/**
 * @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void, removeItem: (key: string) => void }} StorageLike
 */

/**
 * @returns {boolean}
 */
function isBrowser() {
    return typeof globalThis.localStorage !== 'undefined';
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
 * @returns {boolean}
 */
export function isLlmCacheEnabled() {
    if (!isBrowser()) return false;

    const params = new URLSearchParams(globalThis.location.search);
    const param = params.get('llm_cache');
    if (param === '0' || param === 'false') return false;
    if (param === '1' || param === 'true') return true;

    const stored = readStorage('cache');
    if (stored === '0' || stored === 'false') return false;
    if (stored === '1' || stored === 'true') return true;

    return true;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function hashForLlmCache(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) {
        h = ((h << 5) + h) ^ text.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
}

/**
 * @param {string} providerId
 * @param {LlmCompletionRequest} request
 * @returns {string}
 */
export function buildLlmCachePayloadKey(providerId, request) {
    const payload = {
        v: LLM_CACHE_VERSION,
        providerId,
        model: request.model ?? '',
        temperature: request.temperature ?? 0,
        jsonMode: !!request.jsonMode,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    return hashForLlmCache(JSON.stringify(payload));
}

/**
 * @param {string} hash
 * @returns {string}
 */
export function llmCacheEntryKey(hash) {
    return `${ENTRY_PREFIX}${hash}`;
}

/**
 * @param {StorageLike} storage
 * @returns {string[]}
 */
function readIndex(storage) {
    try {
        const raw = storage.getItem(INDEX_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
    } catch {
        return [];
    }
}

/**
 * @param {StorageLike} storage
 * @param {string[]} index
 */
function writeIndex(storage, index) {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
}

/**
 * @param {StorageLike} storage
 * @param {string} hash
 * @param {number} [maxEntries]
 */
function touchIndex(storage, hash, maxEntries = DEFAULT_MAX_ENTRIES) {
    let index = readIndex(storage).filter((h) => h !== hash);
    index.push(hash);
    while (index.length > maxEntries) {
        const evict = index.shift();
        if (evict) storage.removeItem(llmCacheEntryKey(evict));
    }
    writeIndex(storage, index);
}

/**
 * @param {StorageLike} storage
 * @param {string} hash
 * @returns {string | null}
 */
export function getCachedLlmResponse(storage, hash) {
    try {
        const raw = storage.getItem(llmCacheEntryKey(hash));
        if (!raw) return null;
        const entry = JSON.parse(raw);
        return typeof entry?.content === 'string' ? entry.content : null;
    } catch {
        return null;
    }
}

/**
 * @param {StorageLike} storage
 * @param {string} hash
 * @param {string} content
 * @param {number} [maxEntries]
 */
export function setCachedLlmResponse(storage, hash, content, maxEntries = DEFAULT_MAX_ENTRIES) {
    storage.setItem(
        llmCacheEntryKey(hash),
        JSON.stringify({ content, at: Date.now() }),
    );
    touchIndex(storage, hash, maxEntries);
}

/**
 * @returns {StorageLike | null}
 */
export function createBrowserLlmCacheStorage() {
    if (!isBrowser()) return null;
    return globalThis.localStorage;
}

/**
 * @param {LlmProvider} provider
 * @param {object} [opts]
 * @param {StorageLike} [opts.storage]
 * @param {boolean} [opts.enabled]
 * @param {number} [opts.maxEntries]
 * @returns {LlmProvider}
 */
export function wrapProviderWithLlmCache(provider, opts = {}) {
    const storage = opts.storage ?? createBrowserLlmCacheStorage();
    const enabled = opts.enabled !== false && storage != null;
    if (!enabled) return provider;

    const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

    return {
        id: `${provider.id}+cache`,
        async complete(request) {
            const hash = buildLlmCachePayloadKey(provider.id, request);
            const cached = getCachedLlmResponse(storage, hash);
            if (cached != null) {
                console.log(`[World] LLM cache hit (${provider.id}, ${hash.slice(0, 8)}…)`);
                return { content: cached, cached: true };
            }

            const result = await provider.complete(request);
            setCachedLlmResponse(storage, hash, result.content, maxEntries);
            return { ...result, cached: false };
        },
    };
}
