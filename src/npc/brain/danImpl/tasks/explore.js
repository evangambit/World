/**
 * Exploration task — find and walk toward the frontier of known territory.
 *
 * Candidate goals are the last known walkable tile in each of 8 directions
 * before hitting unknown terrain. Each candidate is scored by simulating
 * NPC perception at that position (counting new tiles that would be seen)
 * divided by path cost, giving a value-per-step metric.
 */
import { findPath } from '../../shared/walkToLocation.js';
import { NPC_PERCEPTION_RADIUS } from '../../../shared/npcConstants.js';

/** @typedef {import('../../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../../../../actors/npcSimulation.js').NpcEntity} NpcEntity */
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
 * Walk in direction [dx, dy] from (px, py, pz) until the next step would
 * leave known walkable territory. Returns the last known walkable tile
 * adjacent to the unexplored frontier, or null if the very first step is
 * already blocked or unknown.
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
        if (!hypoWorld.isKnownTile(nx, ny, pz) || !hypoWorld.isWalkable(nx, ny, pz)) {
            // nx,ny is the frontier boundary — cx,cy is our reachable goal
            break;
        }
        cx = nx;
        cy = ny;
    }

    // If we never moved, there is no usable goal in this direction.
    if (cx === px && cy === py) return null;
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

    let bestGoal = null;
    let bestScore = 0; // strictly positive to filter zero-gain candidates

    for (const [dx, dy] of EIGHT_DIRECTIONS) {
        const goal = findFrontierGoal(hypoWorld, px, py, pz, dx, dy);
        if (!goal) continue;

        const path = findPath(hypoWorld, px, py, pz, goal.x, goal.y, goal.z);
        if (!path || path.length < 2) continue;

        // Branch so we don't pollute the shared hypoWorld's seen-tile set.
        const branch = hypoWorld.branch();
        const newTiles = branch.simulatePerception(goal.x, goal.y, goal.z, NPC_PERCEPTION_RADIUS);
        const score = newTiles / path.length;

        if (score > bestScore) {
            bestScore = score;
            bestGoal = goal;
        }
    }

    return bestGoal;
}
