/**
 * Low-level NPC task primitives (movement, pickup search).
 */
import { findPath } from './pathfinding.js';
import { isPickableObject, Obj, OBJ_NAMES } from './tiles.js';

/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
 * @param {number} gx
 * @param {number} gy
 * @param {number} gz
 */
export async function runGoTo(npc, world, gx, gy, gz) {
    await npc.travelToTile(gx, gy, gz, world);
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
 * @param {number} objType
 * @param {number} radius
 * @param {number} [buildingId]
 */
export async function runFind(npc, world, objType, radius, buildingId) {
    const origin = { x: Math.floor(npc.x), y: Math.floor(npc.y), z: npc.z };
    const targets = findObjectTilesInRadius(world, origin, objType, radius, buildingId);
    if (targets.length === 0) {
        const label = OBJ_NAMES[objType] || `object ${objType}`;
        const idHint = buildingId != null ? ` #${buildingId}` : '';
        throw new Error(`Find: no ${label}${idHint} within radius ${radius}`);
    }

    let lastErr = null;
    for (const target of targets) {
        const approach = findApproachTile(world, npc, target);
        if (!approach) {
            lastErr = new Error(`Find: no approach tile for (${target.x}, ${target.y})`);
            continue;
        }
        try {
            await npc.travelToTile(approach.x, approach.y, approach.z, world);
            if (!npc.pickUpAt(target.x, target.y, target.z, world)) {
                throw new Error(`Find: pickup failed at (${target.x}, ${target.y})`);
            }
            return;
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr ?? new Error('Find: could not reach any matching object');
}

/**
 * @param {import('./world.js').World3D} world
 * @param {TileCoord} origin
 * @param {number} objType
 * @param {number} radius
 * @param {number} [buildingId]
 * @returns {TileCoord[]}
 */
function findObjectTilesInRadius(world, origin, objType, radius, buildingId) {
    const hits = [];
    for (const [key, tile] of world.tiles) {
        if (tile.obj !== objType || !isPickableObject(tile.obj)) continue;
        if (buildingId != null && objType === Obj.KEY && tile.keyBuildingId !== buildingId) continue;
        const parts = key.split(',').map(Number);
        const x = parts[0];
        const y = parts[1];
        const z = parts[2];
        if (z !== origin.z) continue;
        const dist = Math.max(Math.abs(x - origin.x), Math.abs(y - origin.y));
        if (dist > radius) continue;
        hits.push({ x, y, z });
    }
    hits.sort((a, b) => {
        const da = Math.max(Math.abs(a.x - origin.x), Math.abs(a.y - origin.y));
        const db = Math.max(Math.abs(b.x - origin.x), Math.abs(b.y - origin.y));
        return da - db;
    });
    return hits;
}

/**
 * @param {import('./world.js').World3D} world
 * @param {import('./npc.js').NPC} npc
 * @param {TileCoord} target
 * @returns {TileCoord|null}
 */
function findApproachTile(world, npc, target) {
    const sx = Math.floor(npc.x);
    const sy = Math.floor(npc.y);
    const sz = npc.z;
    const candidates = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            const tx = target.x + dx;
            const ty = target.y + dy;
            if (!world.isWalkable(tx, ty, target.z)) continue;
            if (!findPath(world, sx, sy, sz, tx, ty, target.z)) continue;
            const dist = Math.max(Math.abs(tx - target.x), Math.abs(ty - target.y));
            if (dist > 1) continue;
            candidates.push({ x: tx, y: ty, z: target.z });
        }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
        const da = Math.abs(a.x - sx) + Math.abs(a.y - sy);
        const db = Math.abs(b.x - sx) + Math.abs(b.y - sy);
        return da - db;
    });
    return candidates[0];
}
