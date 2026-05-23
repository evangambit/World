/**
 * English summaries of tile chunks and chunk diffs (for LLM / debug context).
 */
import { WORLD_CHUNK_SIZE } from '../world/worldConstants.js';
import {
    Obj,
    T,
    TERRAIN_NAMES,
    OBJ_NAMES,
    formatWheatCropLabel,
    isWheatCropObject,
} from '../world/tileTypes.js';
import { World3D } from '../world/world.js';
import { NPC_PERCEPTION_RADIUS } from './npcConstants.js';
import { getNpcTileMemory } from './npcMemory.js';

/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('./npcMemory.js').TileMemoryEntry} TileMemoryEntry */

/**
 * @typedef {'unseen' | 'empty' | 'seen'} ChunkCellKind
 */

/**
 * @typedef {Object} ChunkCell
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {ChunkCellKind} kind
 * @property {TileData} [state]
 * @property {boolean} [reachable]
 */

/**
 * @typedef {Object} ChunkSnapshotStats
 * @property {number} chunkX
 * @property {number} chunkY
 * @property {number} z
 * @property {number} chunkSize
 * @property {number} totalSlots
 * @property {number} unseenCount
 * @property {number} emptyCount
 * @property {number} inaccessibleCount
 * @property {Map<string, number>} labelCounts
 */

/**
 * @typedef {Object} ChunkTransition
 * @property {string} from
 * @property {string} to
 * @property {number} count
 */

/**
 * @typedef {Object} ChunkDiffResult
 * @property {number} chunkX
 * @property {number} chunkY
 * @property {number} z
 * @property {number} totalSlots
 * @property {ChunkTransition[]} transitions
 */

/**
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} [chunkSize]
 */
export function tileToChunk(tileX, tileY, chunkSize = WORLD_CHUNK_SIZE) {
    return {
        chunkX: Math.floor(tileX / chunkSize),
        chunkY: Math.floor(tileY / chunkSize),
    };
}

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} [chunkSize]
 */
export function chunkOrigin(chunkX, chunkY, chunkSize = WORLD_CHUNK_SIZE) {
    return {
        minX: chunkX * chunkSize,
        minY: chunkY * chunkSize,
    };
}

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 */
export function chunkCoordKey(chunkX, chunkY, z) {
    return `${chunkX},${chunkY},${z}`;
}

/**
 * @param {number} terrain
 */
function terrainLabel(terrain) {
    return (TERRAIN_NAMES[terrain] ?? `terrain ${terrain}`).toLowerCase();
}

/**
 * @param {number} obj
 * @param {TileData} state
 */
function objectLabel(obj, state) {
    let name = (OBJ_NAMES[obj] ?? `object ${obj}`).toLowerCase();
    if (obj === Obj.KEY && state.keyBuildingId != null) {
        name = `${name} #${state.keyBuildingId}`;
    }
    return name;
}

/**
 * Lowercase English label for grouping and diffs (per terrain / object type).
 * @param {TileData} state
 */
export function labelTileState(state) {
    if (isWheatCropObject(state.obj)) {
        return formatWheatCropLabel(state.cropStage ?? 0).toLowerCase();
    }

    const terrain = state.terrain ?? T.NONE;
    if (terrain === T.DOOR) {
        return state.doorLocked ? 'locked door' : 'door';
    }

    const terrainPart = terrain !== T.NONE ? terrainLabel(terrain) : null;
    const obj = state.obj ?? Obj.NONE;

    if (obj && obj !== Obj.NONE) {
        const objPart = objectLabel(obj, state);
        if (terrainPart) return `${terrainPart} with ${objPart}`;
        return objPart;
    }

    return terrainPart ?? 'empty';
}

/**
 * Stable key for tile-state equality (memory, diffs).
 * @param {TileData} state
 */
export function tileStateKey(state) {
    const t = state.transition;
    const trans = t ? `${t.tx},${t.ty},${t.tz},${t.type}` : '';
    return [
        state.terrain ?? 0,
        state.obj ?? 0,
        state.cropStage ?? '',
        state.doorLocked ? 1 : 0,
        state.keyBuildingId ?? '',
        trans,
    ].join('|');
}

/**
 * @param {TileData} a
 * @param {TileData} b
 */
export function tileStatesEqual(a, b) {
    return tileStateKey(a) === tileStateKey(b);
}

/**
 * @param {ChunkCell} cell
 */
export function cellKindLabel(cell) {
    if (cell.kind === 'unseen') return null;
    if (cell.kind === 'empty') return 'empty';
    return labelTileState(/** @type {TileData} */ (cell.state));
}

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 * @param {number} [chunkSize]
 * @returns {Generator<{ x: number, y: number, z: number }>}
 */
export function* chunkTileCoords(chunkX, chunkY, z, chunkSize = WORLD_CHUNK_SIZE) {
    const { minX, minY } = chunkOrigin(chunkX, chunkY, chunkSize);
    for (let dy = 0; dy < chunkSize; dy += 1) {
        for (let dx = 0; dx < chunkSize; dx += 1) {
            yield { x: minX + dx, y: minY + dy, z };
        }
    }
}

/**
 * @typedef {Object} BuildChunkCellsOptions
 * @property {Map<string, TileMemoryEntry>} [memory]
 * @property {(x: number, y: number, z: number) => TileMemoryEntry|undefined} [getObservedTile]
 * @property {import('../world/world.js').World3D} [world]
 * @property {number} [chunkSize]
 */

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 * @param {BuildChunkCellsOptions} opts
 * @returns {ChunkCell[]}
 */
export function buildChunkCells(chunkX, chunkY, z, opts = {}) {
    const chunkSize = opts.chunkSize ?? WORLD_CHUNK_SIZE;
    const memory = opts.memory;
    const getObservedTile = opts.getObservedTile;
    const world = opts.world;
    /** @type {ChunkCell[]} */
    const cells = [];

    for (const { x, y, z: cz } of chunkTileCoords(chunkX, chunkY, z, chunkSize)) {
        const mem = getObservedTile?.(x, y, cz) ?? memory?.get(World3D.key(x, y, cz));
        if (mem) {
            cells.push({
                x,
                y,
                z: cz,
                kind: 'seen',
                state: mem.state,
                reachable: mem.reachable,
            });
            continue;
        }

        if (typeof world?.getTile === 'function') {
            const live = world.getTile(x, y, cz);
            if (!live) {
                cells.push({ x, y, z: cz, kind: 'empty' });
            } else {
                cells.push({ x, y, z: cz, kind: 'unseen' });
            }
            continue;
        }

        cells.push({ x, y, z: cz, kind: 'unseen' });
    }

    return cells;
}

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 * @param {BuildChunkCellsOptions} opts
 * @returns {ChunkSnapshotStats}
 */
export function analyzeChunk(chunkX, chunkY, z, opts = {}) {
    const chunkSize = opts.chunkSize ?? WORLD_CHUNK_SIZE;
    const cells = buildChunkCells(chunkX, chunkY, z, opts);
    /** @type {Map<string, number>} */
    const labelCounts = new Map();
    let unseenCount = 0;
    let emptyCount = 0;
    let inaccessibleCount = 0;

    for (const cell of cells) {
        if (cell.kind === 'unseen') {
            unseenCount += 1;
            continue;
        }
        if (cell.kind === 'empty') {
            emptyCount += 1;
            labelCounts.set('empty', (labelCounts.get('empty') ?? 0) + 1);
            continue;
        }
        const label = labelTileState(cell.state);
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        if (cell.reachable === false) inaccessibleCount += 1;
    }

    return {
        chunkX,
        chunkY,
        z,
        chunkSize,
        totalSlots: chunkSize * chunkSize,
        unseenCount,
        emptyCount,
        inaccessibleCount,
        labelCounts,
    };
}

/**
 * @param {string} label
 * @param {number} count
 */
function formatLabelCount(label, count) {
    const noun = count === 1 ? 'tile' : 'tiles';
    return `${count} ${label} ${noun}`;
}

/**
 * @param {ChunkSnapshotStats} stats
 * @returns {string}
 */
export function describeChunkSnapshot(stats) {
    const entries = [...stats.labelCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const composition = entries.map(([label, n]) => formatLabelCount(label, n)).join(', ');

    const head = `Chunk (${stats.chunkX}, ${stats.chunkY})`;
    let line = composition ? `${head}: ${composition}` : `${head}: (no known tiles)`;

    if (stats.unseenCount > 0) {
        line += `. ${stats.unseenCount}/${stats.totalSlots} unseen tiles`;
    }
    if (stats.inaccessibleCount > 0) {
        const noun = stats.inaccessibleCount === 1 ? 'tile is' : 'tiles are';
        line += `. ${stats.inaccessibleCount} ${noun} inaccessible`;
    }

    return line;
}

/**
 * @param {ChunkCell[]} before
 * @param {ChunkCell[]} after
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 * @param {number} [chunkSize]
 * @returns {ChunkDiffResult}
 */
export function diffChunkCells(before, after, chunkX, chunkY, z, chunkSize = WORLD_CHUNK_SIZE) {
    const totalSlots = chunkSize * chunkSize;
    /** @type {Map<string, ChunkTransition>} */
    const byKey = new Map();

    for (let i = 0; i < totalSlots; i += 1) {
        const a = before[i];
        const b = after[i];
        const from = cellKindLabel(a);
        const to = cellKindLabel(b);
        if (from == null || to == null) continue;
        if (from === to) continue;

        const key = `${from}\0${to}`;
        const prev = byKey.get(key);
        if (prev) {
            prev.count += 1;
        } else {
            byKey.set(key, { from, to, count: 1 });
        }
    }

    const transitions = [...byKey.values()].sort(
        (a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    );

    return { chunkX, chunkY, z, totalSlots, transitions };
}

/**
 * @param {number} chunkX
 * @param {number} chunkY
 * @param {number} z
 * @param {BuildChunkCellsOptions} beforeOpts
 * @param {BuildChunkCellsOptions} afterOpts
 * @returns {ChunkDiffResult}
 */
export function diffChunk(chunkX, chunkY, z, beforeOpts, afterOpts) {
    const chunkSize = beforeOpts.chunkSize ?? afterOpts.chunkSize ?? WORLD_CHUNK_SIZE;
    const before = buildChunkCells(chunkX, chunkY, z, { ...beforeOpts, chunkSize });
    const after = buildChunkCells(chunkX, chunkY, z, { ...afterOpts, chunkSize });
    return diffChunkCells(before, after, chunkX, chunkY, z, chunkSize);
}

/**
 * @param {ChunkDiffResult} diff
 * @returns {string}
 */
export function describeChunkDiff(diff) {
    if (diff.transitions.length === 0) {
        return `Chunk (${diff.chunkX}, ${diff.chunkY}): no tile changes`;
    }

    const parts = diff.transitions.map((t) => {
        const noun = t.count === 1 ? 'tile' : 'tiles';
        return `${t.count}/${diff.totalSlots} ${noun} went from ${t.from} to ${t.to}`;
    });

    return `Chunk (${diff.chunkX}, ${diff.chunkY}): ${parts.join('; ')}`;
}

/**
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} z
 * @param {number} radius - Chebyshev tiles
 * @param {number} [chunkSize]
 * @returns {{ chunkX: number, chunkY: number, z: number }[]}
 */
export function listChunksNearTile(tileX, tileY, z, radius, chunkSize = WORLD_CHUNK_SIZE) {
    const minCx = Math.floor((tileX - radius) / chunkSize);
    const maxCx = Math.floor((tileX + radius) / chunkSize);
    const minCy = Math.floor((tileY - radius) / chunkSize);
    const maxCy = Math.floor((tileY + radius) / chunkSize);
    /** @type {{ chunkX: number, chunkY: number, z: number }[]} */
    const chunks = [];

    for (let chunkY = minCy; chunkY <= maxCy; chunkY += 1) {
        for (let chunkX = minCx; chunkX <= maxCx; chunkX += 1) {
            chunks.push({ chunkX, chunkY, z });
        }
    }

    return chunks;
}

/**
 * @typedef {Object} FormatSurroundingsOptions
 * @property {import('../world/world.js').World3D} [world]
 * @property {number} [radius]
 * @property {number} [chunkSize]
 * @property {ChunkDiffResult[]} [chunkDiffs]
 */

/**
 * Lines for planner prompts (nearby chunk snapshots and optional diffs).
 * @param {import('../actors/npcSimulation.js').NpcEntity} npc
 * @param {FormatSurroundingsOptions} [opts]
 * @returns {string[]}
 */
export function formatSurroundingsSection(npc, opts = {}) {
    const z = npc.z ?? 0;
    const x = Math.floor(npc.x ?? 0);
    const y = Math.floor(npc.y ?? 0);
    const radius = opts.radius ?? NPC_PERCEPTION_RADIUS;
    const chunkSize = opts.chunkSize ?? WORLD_CHUNK_SIZE;
    const getObservedTile = (x, y, z) => getNpcTileMemory(npc, x, y, z);
    const world = opts.world;

    const chunks = listChunksNearTile(x, y, z, radius, chunkSize);
    /** @type {string[]} */
    const lines = [
        '## Surroundings',
        `position: (${x}, ${y}, ${z})`,
    ];

    const buildOpts = { getObservedTile, world, chunkSize };
    /** @type {string[]} */
    const chunkLines = [];

    for (const { chunkX, chunkY } of chunks) {
        const stats = analyzeChunk(chunkX, chunkY, z, buildOpts);
        const known = stats.totalSlots - stats.unseenCount;
        if (known === 0) continue;
        chunkLines.push(describeChunkSnapshot(stats));
    }

    if (chunkLines.length > 0) {
        lines.push('Nearby chunks:');
        for (const line of chunkLines) {
            lines.push(`- ${line}`);
        }
    }

    const diffs = opts.chunkDiffs ?? [];
    if (diffs.length > 0) {
        lines.push('Recent chunk changes:');
        for (const diff of diffs) {
            if (diff.transitions.length === 0) continue;
            lines.push(`- ${describeChunkDiff(diff)}`);
        }
    }

    if (chunkLines.length === 0 && diffs.length === 0) {
        return [];
    }

    return lines;
}
