import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonFromText } from './extractJson.js';

describe('extractJsonFromText', () => {
    it('returns raw JSON objects', () => {
        const json = '{"goal":"x","plan":{"type":"seq","steps":[]}}';
        assert.equal(extractJsonFromText(json), json);
    });

    it('strips markdown fences', () => {
        const inner = '{"goal":"eat"}';
        assert.equal(extractJsonFromText(`\`\`\`json\n${inner}\n\`\`\``), inner);
    });

    it('extracts the first object from prose', () => {
        const out = extractJsonFromText('Here you go: {"goal":"a","plan":{"type":"seq","steps":[]}} thanks');
        assert.match(out, /"goal":"a"/);
    });
});
