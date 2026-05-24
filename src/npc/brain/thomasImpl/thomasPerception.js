/**
 * Wall-respecting tile perception for ThomasBrain.
 *
 * Uses a supercover DDA raycast from the NPC to each candidate tile so that
 * opaque tiles (walls, cliffs, trees…) block sight — unlike the default
 * Chebyshev scan which records everything within range unconditionally.
 */
import { T, Obj } from '../../../world/tileTypes.js';
import { World3D } from '../../../world/world.js';
import { getNpcTileMemory, snapshotTileState, tileMemoryStatesEqual } from '../../shared/npcMemory.js';
import { NPC_PERCEPTION_RADIUS } from '../../shared/npcConstants.js';

/** @typedef {import('../world/world.js').TileData} TileData */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */

/**
 * Returns true when a tile blocks line of sight.
 * The tile at the *observer* and at the *target* are never treated as blockers
 * by the raycaster — only intermediate tiles are tested with this.
 * @param {TileData} tile
 * @returns {boolean}
 */
export function isTileOpaque(tile) {
    if (
        tile.terrain === T.WALL_STONE ||
        tile.terrain === T.WALL_WOOD  ||
        tile.terrain === T.CLIFF      ||
        tile.terrain === T.ROOF
    ) return true;
    if (tile.obj === Obj.TREE) return true;
    return false;
}

/**
 * Supercover DDA line-of-sight check on a single z-layer.
 *
 * Traces every grid cell the ray from (ax, ay) to (bx, by) passes through.
 * Returns false as soon as any intermediate cell (not the start or end) is
 * opaque.  The start and end cells themselves are never tested as blockers so
 * that an NPC standing next to a wall can still see the wall tile, and a
 * target tile that is itself a wall can still be perceived (just not seen past).
 *
 * @param {World3D} world
 * @param {number} ax  NPC tile X
 * @param {number} ay  NPC tile Y
 * @param {number} bx  Target tile X
 * @param {number} by  Target tile Y
 * @param {number} z
 * @returns {boolean}
 */
export function hasLineOfSight(world, ax, ay, bx, by, z) {
    if (ax === bx && ay === by) return true;

    const dx = bx - ax;
    const dy = by - ay;
    const nx = Math.abs(dx);
    const ny = Math.abs(dy);
    const signX = dx > 0 ? 1 : -1;
    const signY = dy > 0 ? 1 : -1;

    let x = ax;
    let y = ay;
    let ix = 0;
    let iy = 0;

    while (ix < nx || iy < ny) {
        // Choose the axis whose crossing is closer to the ray midline.
        // Multiplying out the fractions avoids floating point.
        if ((2 * ix + 1) * ny < (2 * iy + 1) * nx) {
            x += signX;
            ix++;
        } else {
            y += signY;
            iy++;
        }

        // Reached the target — line of sight is clear.
        if (x === bx && y === by) return true;

        const tile = world.getTile(x, y, z);
        if (tile && isTileOpaque(tile)) return false;
    }

    return true;
}

/**
 * Per-frame perception tick for ThomasBrain.
 *
 * Identical bookkeeping to the default `tickNpcPerception` (snapshot + seenAt
 * + reachable carry-forward on unchanged state) but only records tiles that
 * have an unobstructed line of sight to the NPC.
 *
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {number} gameTime
 */
export function tickThomasPerception(npc, world, gameTime) {
    const brain = npc.brain;
    if (npc._dead || !brain?.observeTile) return;

    const cx = Math.floor(npc.x);
    const cy = Math.floor(npc.y);
    const cz = npc.z;
    const r = NPC_PERCEPTION_RADIUS;

    for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
            const tx = cx + dx;
            const ty = cy + dy;

            const tile = world.getTile(tx, ty, cz);
            if (!tile) continue;

            if (!hasLineOfSight(world, cx, cy, tx, ty, cz)) continue;

            const state = snapshotTileState(tile);
            const prev = getNpcTileMemory(npc, tx, ty, cz);

            /** @type {boolean|undefined} */
            let reachable;
            if (prev && tileMemoryStatesEqual(prev.state, state)) {
                reachable = prev.reachable;
            }

            brain.observeTile(tx, ty, cz, { seenAt: gameTime, state, reachable });
        }
    }
}
