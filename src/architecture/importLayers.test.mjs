/**
 * Layer boundary: simulation/domain/npc code and their tests must not import
 * presentation (client/) or the browser entry (main.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');
const CLIENT = join(SRC, 'client');
const MAIN = join(SRC, 'main.js');

/** Top-level src dirs treated as business logic (not presentation). */
const LOGIC_DIRS = ['world', 'domain', 'actors', 'simulation', 'npc', 'content'];

const IMPORT_SPECIFIERS_RE = /\b(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walkJsFiles(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        const path = join(dir, ent.name);
        if (ent.isDirectory()) {
            yield* walkJsFiles(path);
        } else if (/\.(?:m?js)$/.test(ent.name)) {
            yield path;
        }
    }
}

/**
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

/**
 * @param {string} source
 * @returns {string[]}
 */
function extractImportSpecifiers(source) {
    const code = stripComments(source);
    /** @type {string[]} */
    const specs = [];
    for (const re of [IMPORT_SPECIFIERS_RE, DYNAMIC_IMPORT_RE]) {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(code)) !== null) {
            specs.push(match[1]);
        }
    }
    return specs;
}

/**
 * @param {string} filePath
 * @param {string} specifier
 * @returns {string|null} absolute resolved path
 */
function resolveRelativeImport(filePath, specifier) {
    if (specifier.startsWith('node:')) return null;
    if (!specifier.startsWith('.')) return null;
    return join(dirname(filePath), specifier);
}

/**
 * @param {string} absPath
 * @returns {boolean}
 */
function isPresentationModule(absPath) {
    const norm = absPath.split(sep).join('/');
    const clientSegment = `/src/client/`;
    if (norm.includes(clientSegment) || norm.endsWith('/src/client')) return true;
    if (norm.endsWith('/src/main.js')) return true;
    return false;
}

/**
 * @param {string} filePath
 * @param {string} specifier
 * @returns {boolean}
 */
function isForbiddenPresentationImport(filePath, specifier) {
    const resolved = resolveRelativeImport(filePath, specifier);
    if (!resolved) return false;
    return isPresentationModule(resolved);
}

/**
 * @returns {Promise<string[]>}
 */
async function collectLogicAndTestFiles() {
    /** @type {Set<string>} */
    const files = new Set();

    for (const dir of LOGIC_DIRS) {
        for await (const path of walkJsFiles(join(SRC, dir))) {
            files.add(path);
        }
    }

    for await (const path of walkJsFiles(SRC)) {
        if (path.startsWith(CLIENT + sep)) continue;
        if (path.endsWith('.test.mjs')) files.add(path);
    }

    for await (const path of walkJsFiles(join(ROOT, 'scripts'))) {
        files.add(path);
    }

    return [...files];
}

/**
 * @returns {Promise<string[]>}
 */
async function collectClientFiles() {
    /** @type {string[]} */
    const files = [];
    for await (const path of walkJsFiles(CLIENT)) {
        files.push(path);
    }
    return files;
}

describe('business logic must not import presentation', () => {
    it('world, domain, actors, simulation, npc, content, tests, and scripts stay free of client/ and main.js', async () => {
        const violations = [];

        for (const file of await collectLogicAndTestFiles()) {
            const source = await readFile(file, 'utf8');
            for (const spec of extractImportSpecifiers(source)) {
                if (isForbiddenPresentationImport(file, spec)) {
                    violations.push({
                        file: relative(ROOT, file),
                        specifier: spec,
                    });
                }
            }
        }

        assert.equal(
            violations.length,
            0,
            violations.map((v) => `${v.file} imports presentation via "${v.specifier}"`).join('\n'),
        );
    });
});

describe('presentation must not import the browser entry', () => {
    it('client/ does not import main.js', async () => {
        const violations = [];

        for (const file of await collectClientFiles()) {
            const source = await readFile(file, 'utf8');
            for (const spec of extractImportSpecifiers(source)) {
                const resolved = resolveRelativeImport(file, spec);
                if (resolved && resolved === MAIN) {
                    violations.push({ file: relative(ROOT, file), specifier: spec });
                }
            }
        }

        assert.equal(
            violations.length,
            0,
            violations.map((v) => `${v.file} imports main via "${v.specifier}"`).join('\n'),
        );
    });
});
