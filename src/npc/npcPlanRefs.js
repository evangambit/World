/**
 * Resolve plan step refs (memory queries, etc.) into tile coordinates.
 */
import { World3D } from '../world/world.js';
import { getObjectTagSpec } from './npcObjectTags.js';

/** @typedef {{ x: number, y: number, z: number }} TileRef */
/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/** Matches rememberLocationsOfNearby(stove) */
export const REMEMBER_NEARBY_REF_RE = /^rememberLocationsOfNearby\(([^)]+)\)$/;

/**
 * Coerce a plan ref field to a string (LLMs sometimes emit legacy `{ query: "..." }`).
 * @param {unknown} ref
 * @returns {string | null}
 */
export function normalizePlanRef(ref) {
    if (ref == null) return null;
    if (typeof ref === 'string') {
        const trimmed = ref.trim();
        return trimmed || null;
    }
    if (typeof ref === 'object') {
        const query = /** @type {{ query?: string }} */ (ref).query;
        if (typeof query === 'string') {
            const trimmed = query.trim();
            if (trimmed) return trimmed;
        }
    }
    return null;
}

/**
 * @param {unknown} ref
 * @returns {TileRef | null}
 */
export function parsePlanRefAsTile(ref) {
    if (ref == null || typeof ref !== 'object') return null;
    const o = /** @type {{ query?: string, x?: unknown, y?: unknown, z?: unknown }} */ (ref);
    if (o.query != null) return null;
    const { x, y, z } = o;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
}

/**
 * @param {unknown} ref
 * @returns {string}
 */
export function formatPlanRef(ref) {
    const tile = parsePlanRefAsTile(ref);
    if (tile) return `(${tile.x},${tile.y},${tile.z})`;
    const refStr = normalizePlanRef(ref);
    if (refStr) return refStr;
    if (ref == null) return 'null';
    return JSON.stringify(ref);
}

/**
 * @param {TileData} state
 * @param {string} objectTag
 * @returns {boolean}
 */
export function tileMemoryMatchesObjectTag(state, objectTag) {
    const spec = getObjectTagSpec(objectTag);
    if (spec.worldTypes.includes(state.obj)) return true;
    if (state.contents?.some(
        (s) => spec.worldTypes.includes(s.objType) || spec.inventoryTypes.includes(s.objType),
    )) {
        return true;
    }
    return false;
}

/**
 * Remembered tiles matching an object tag on the NPC's current floor, nearest first.
 * @param {NpcEntity} npc
 * @param {string} objectTag
 * @returns {TileRef[]}
 */
export function rememberLocationsOfNearby(npc, objectTag) {
    getObjectTagSpec(objectTag);

    const cx = Math.floor(npc.x);
    const cy = Math.floor(npc.y);
    const cz = npc.z;

    /** @type {{ ref: TileRef, dist: number }[]} */
    const matches = [];

    for (const [key, entry] of npc.tileMemory ?? []) {
        if (!tileMemoryMatchesObjectTag(entry.state, objectTag)) continue;

        const parts = key.split(',').map(Number);
        const x = parts[0];
        const y = parts[1];
        const z = parts[2];
        if (z !== cz) continue;

        const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        matches.push({ ref: { x, y, z }, dist });
    }

    matches.sort((a, b) => a.dist - b.dist || a.ref.x - b.ref.x || a.ref.y - b.ref.y);
    return matches.map((m) => m.ref);
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} _world
 * @param {string} ref
 * @returns {TileRef[]}
 */
export function resolvePlanRefs(npc, _world, ref) {
    const refStr = normalizePlanRef(ref);
    if (!refStr) return [];
    const match = refStr.match(REMEMBER_NEARBY_REF_RE);
    if (!match) return [];
    const objectTag = match[1].trim();
    if (!objectTag) return [];
    try {
        return rememberLocationsOfNearby(npc, objectTag);
    } catch {
        return [];
    }
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {string} ref
 * @returns {TileRef | null}
 */
export function resolvePlanRef(npc, world, ref) {
    return resolvePlanRefs(npc, world, ref)[0] ?? null;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {{ ref?: unknown, x?: number, y?: number, z?: number }} step
 * @returns {TileRef[]}
 */
export function resolvePlanRefTargets(npc, world, step) {
    const tileFromRef = parsePlanRefAsTile(step.ref);
    if (tileFromRef) return [tileFromRef];

    const refStr = normalizePlanRef(step.ref);
    if (refStr != null) {
        return resolvePlanRefs(npc, world, refStr);
    }
    if (step.x != null && step.y != null && step.z != null) {
        return [{ x: step.x, y: step.y, z: step.z }];
    }
    return [];
}

/**
 * @param {string} ref
 * @returns {boolean}
 */
export function isKnownPlanRef(ref) {
    const refStr = normalizePlanRef(ref);
    return refStr != null && REMEMBER_NEARBY_REF_RE.test(refStr);
}
