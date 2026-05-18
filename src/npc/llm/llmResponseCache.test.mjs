import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildLlmCachePayloadKey,
    getCachedLlmResponse,
    setCachedLlmResponse,
    wrapProviderWithLlmCache,
} from './llmResponseCache.js';

/** @returns {Map<string, string> & { getItem: (k: string) => string | null, setItem: (k: string, v: string) => void, removeItem: (k: string) => void }} */
function memoryStorage() {
    const map = new Map();
    return {
        getItem(key) {
            return map.get(key) ?? null;
        },
        setItem(key, value) {
            map.set(key, value);
        },
        removeItem(key) {
            map.delete(key);
        },
    };
}

describe('llmResponseCache', () => {
    it('returns the same content on a cache hit without calling the provider', async () => {
        const storage = memoryStorage();
        let calls = 0;
        const provider = {
            id: 'test',
            async complete() {
                calls += 1;
                return { content: '{"goal":"x","plan":{"type":"seq","steps":[]}}' };
            },
        };

        const cached = wrapProviderWithLlmCache(provider, { storage, enabled: true });
        const request = {
            model: 'test-model',
            temperature: 0.2,
            jsonMode: true,
            messages: [
                { role: 'system', content: 'sys' },
                { role: 'user', content: 'user' },
            ],
        };

        const first = await cached.complete(request);
        const second = await cached.complete(request);

        assert.equal(calls, 1);
        assert.equal(first.content, second.content);
    });

    it('uses different keys for different user messages', () => {
        const storage = memoryStorage();
        const base = {
            model: 'm',
            temperature: 0,
            jsonMode: true,
            messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'a' }],
        };
        const other = {
            ...base,
            messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'b' }],
        };

        const k1 = buildLlmCachePayloadKey('p', base);
        const k2 = buildLlmCachePayloadKey('p', other);
        assert.notEqual(k1, k2);

        setCachedLlmResponse(storage, k1, 'one');
        assert.equal(getCachedLlmResponse(storage, k1), 'one');
        assert.equal(getCachedLlmResponse(storage, k2), null);
    });
});
