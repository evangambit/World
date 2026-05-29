/**
 * Exploration task — find and walk toward the frontier of known territory.
 *
 * Candidate goals are the last known walkable tile in each of 8 directions
 * before hitting unknown terrain. Each candidate is scored as the sum of
 * min(1/distance(newTile, centroid), 1) over all tiles that would be newly
 * seen from that position, divided by path cost. This favours filling gaps
 * near the centroid of known territory over extending distant tentacles.
 */
import { findPath } from '../../shared/walkToLocation.js';
import { NPC_PERCEPTION_RADIUS } from '../../../shared/npcConstants.js';
import { getNpcTileMemoryStore } from '../../../shared/npcMemory.js';

/** @typedef {import('../../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../../../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

const EIGHT_DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

/** Maximum tiles to walk in one direction when searching for the frontier. */
const FRONTIER_SEARCH_CAP = 200;

/**
 * Compute the centroid of all known tiles on floor z.
 * Used to weight exploration candidates: tiles near the centroid fill gaps,
 * tiles far away extend tentacles.
 *
 * @param {Map<string, TileMemoryEntry>} memory
 * @param {number} z
 * @returns {{ x: number, y: number }}
 */
function computeCentroid(memory, z) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const key of memory.keys()) {
        const parts = key.split(',');
        if (Number(parts[2]) !== z) continue;
        sx += Number(parts[0]);
        sy += Number(parts[1]);
        count++;
    }
    return count > 0 ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
}

/**
 * Weighted count of new tiles visible from (gx, gy, gz).
 *
 * Each tile in the perception square that is not yet known contributes
 * min(1 / distance(tile, centroid), 1) — so tiles close to the centroid of
 * known territory count more than tiles far out on an arm. This keeps
 * exploration compact rather than encouraging long tentacles in one direction.
 *
 * @param {HypotheticalWorld} hypoWorld
 * @param {number} gx
 * @param {number} gy
 * @param {number} gz
 * @param {number} radius
 * @param {{ x: number, y: number }} centroid
 * @returns {number}
 */
function weightedNewTilesScore(hypoWorld, gx, gy, gz, radius, centroid) {
    let score = 0;
    for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
            const tx = gx + dx;
            const ty = gy + dy;
            if (!hypoWorld.isKnownTile(tx, ty, gz)) {
                const dist = Math.sqrt((tx - centroid.x) ** 2 + (ty - centroid.y) ** 2);
                score += dist > 0 ? Math.min(1 / dist, 1) : 1;
            }
        }
    }
    return score;
}

/**
 * Walk in direction [dx, dy] from (px, py, pz) through all known tiles until
 * hitting an unknown tile. Returns the last known tile before the frontier if
 * it is walkable, otherwise null.
 *
 * Non-walkable known tiles (walls, objects) are traversed during the scan so
 * that the returned goal can be on the far side of an obstacle — pathfinding
 * in the caller will find the real route around it. If the direction ends on a
 * non-walkable tile (e.g. a wall flush against the unknown boundary), null is
 * returned and the direction is skipped.
 *
 * @param {HypotheticalWorld} hypoWorld
 * @param {number} px
 * @param {number} py
 * @param {number} pz
 * @param {number} dx
 * @param {number} dy
 * @returns {TileCoord | null}
 */
function findFrontierGoal(hypoWorld, px, py, pz, dx, dy) {
    let cx = px;
    let cy = py;

    for (let i = 0; i < FRONTIER_SEARCH_CAP; i++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!hypoWorld.isKnownTile(nx, ny, pz)) {
            // nx,ny is the unknown frontier — cx,cy is the last known tile
            break;
        }
        cx = nx;
        cy = ny;
    }

    // If we never moved, there is no usable goal in this direction.
    if (cx === px && cy === py) return null;

    // If we reach FRONTIER_SEARCH_CAP, then the last known tile may be non-walkable.
    if (!hypoWorld.isWalkable(cx, cy, pz)) {
        return null;
    }

    return { x: cx, y: cy, z: pz };
}

/**
 * Evaluate all 8 directional frontiers and return the tile coordinate that
 * maximises new tiles seen per step of path cost. Returns null if no
 * reachable frontier with exploration value exists.
 *
 * @param {NpcEntity} npc
 * @param {HypotheticalWorld} hypoWorld
 * @returns {TileCoord | null}
 */
export function chooseBestExplorationGoal(npc, hypoWorld) {
    const px = Math.floor(npc.x);
    const py = Math.floor(npc.y);
    const pz = npc.z;

    const memory = getNpcTileMemoryStore(npc);
    const centroid = memory ? computeCentroid(memory, pz) : { x: px, y: py };

    let bestGoal = null;
    let bestScore = 0; // strictly positive to filter zero-gain candidates

    for (const [dx, dy] of EIGHT_DIRECTIONS) {
        const goal = findFrontierGoal(hypoWorld, px, py, pz, dx, dy);
        if (!goal) continue;

        const path = findPath(hypoWorld, px, py, pz, goal.x, goal.y, goal.z);
        if (!path || path.length < 2) continue;

        const tileScore = weightedNewTilesScore(
            hypoWorld,
            goal.x,
            goal.y,
            goal.z,
            NPC_PERCEPTION_RADIUS,
            centroid,
        );
        const score = tileScore / path.length;

        if (score > bestScore) {
            bestScore = score;
            bestGoal = goal;
        }
    }

    return bestGoal;
}
