/**
 * Shared brain locomotion — tile-by-tile walks via entity actions.
 * Pathfinding runs on HypotheticalWorld (remembered tiles only).
 */
import { moveToTileAction } from '../../../domain/entityActions.js';
import { HypotheticalWorld } from '../../shared/hypotheticalWorld.js';

/** @typedef {import('../../../actors/entity.js').Entity} Entity */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/**
 * @typedef {Object} WalkToLocationOptions
 * @property {() => HypotheticalWorld} [getWorld] - fresh view for replanning (e.g. updated tile memory)
 * @property {number} [maxReplans] - cap replans when the route keeps breaking (default 32)
 */

const DEFAULT_MAX_REPLANS = 32;

// ── A* on HypotheticalWorld ──

class MinHeap {
    constructor() {
        this.data = [];
    }

    push(item) {
        this.data.push(item);
        this._bubbleUp(this.data.length - 1);
    }

    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._sinkDown(0);
        }
        return top;
    }

    get size() {
        return this.data.length;
    }

    _bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.data[i].f >= this.data[parent].f) break;
            [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
            i = parent;
        }
    }

    _sinkDown(i) {
        const n = this.data.length;
        while (true) {
            let smallest = i;
            const l = 2 * i + 1;
            const r = 2 * i + 2;
            if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
            if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
            if (smallest === i) break;
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

/**
 * @param {HypotheticalWorld} world
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {TileCoord[]}
 */
function getWalkableNeighbors(world, x, y, z) {
    const neighbors = [];
    for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (world.isWalkable(nx, ny, z)) {
            neighbors.push({ x: nx, y: ny, z });
        }
    }
    const tile = world.getTile(x, y, z);
    if (tile?.transition) {
        const { tx, ty, tz } = tile.transition;
        if (world.isWalkable(tx, ty, tz)) {
            neighbors.push({ x: tx, y: ty, z: tz });
        }
    }
    return neighbors;
}

/**
 * @param {HypotheticalWorld} world
 * @param {number} sx
 * @param {number} sy
 * @param {number} sz
 * @param {number} gx
 * @param {number} gy
 * @param {number} gz
 * @param {number} [maxNodes]
 * @returns {TileCoord[] | null}
 */
export function findPath(world, sx, sy, sz, gx, gy, gz, maxNodes = 2000) {
    const key = (x, y, z) => `${x},${y},${z}`;
    const startKey = key(sx, sy, sz);
    const goalKey = key(gx, gy, gz);

    if (startKey === goalKey) return [{ x: sx, y: sy, z: sz }];

    const open = new MinHeap();
    const gScore = new Map();
    const cameFrom = new Map();
    const coords = new Map();

    const h = (x, y, z) => Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz) * 3;

    gScore.set(startKey, 0);
    coords.set(startKey, { x: sx, y: sy, z: sz });
    open.push({ key: startKey, f: h(sx, sy, sz) });

    let expanded = 0;

    while (open.size > 0 && expanded < maxNodes) {
        const current = open.pop();
        const ck = current.key;
        expanded++;

        if (ck === goalKey) {
            const path = [];
            let k = goalKey;
            while (k) {
                path.push(coords.get(k));
                k = cameFrom.get(k) ?? null;
            }
            path.reverse();
            return path;
        }

        const { x, y, z } = coords.get(ck);
        const currentG = gScore.get(ck);
        const neighbors = getWalkableNeighbors(world, x, y, z);

        for (const nb of neighbors) {
            const nk = key(nb.x, nb.y, nb.z);
            const moveCost = nb.z !== z ? 3 : 1;
            const tentG = currentG + moveCost;

            if (!gScore.has(nk) || tentG < gScore.get(nk)) {
                gScore.set(nk, tentG);
                cameFrom.set(nk, ck);
                coords.set(nk, nb);
                open.push({ key: nk, f: tentG + h(nb.x, nb.y, nb.z) });
            }
        }
    }

    return null;
}

/**
 * @param {HypotheticalWorld} world
 * @param {TileCoord[]} path
 * @param {number} fromIndex
 */
function isRemainingPathAccessible(world, path, fromIndex) {
    for (let i = fromIndex; i < path.length; i++) {
        const step = path[i];
        if (!world.isWalkable(step.x, step.y, step.z)) return false;
    }
    return true;
}

/**
 * @param {Entity} entity
 * @param {HypotheticalWorld} world
 * @param {TileCoord} target
 */
function planPathFromEntity(entity, world, target) {
    return findPath(
        world,
        Math.floor(entity.x),
        Math.floor(entity.y),
        entity.z,
        target.x,
        target.y,
        target.z,
    );
}

/**
 * Yield per-step move actions and return final walk result.
 * Resume with the previous tick's ActionExecutionResult after each yield.
 *
 * Replans from the entity's current tile when a remaining step is no longer
 * walkable in `getWorld()` / `world`, or when a move action fails.
 *
 * @param {Entity} entity
 * @param {HypotheticalWorld} world
 * @param {TileCoord} target
 * @param {WalkToLocationOptions} [options]
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* walkToLocation(entity, world, target, options = {}) {
    const getWorld = options.getWorld ?? (() => world);
    const maxReplans = options.maxReplans ?? DEFAULT_MAX_REPLANS;

    let path = planPathFromEntity(entity, getWorld(), target);
    if (!path) {
        return { ok: false, message: 'No path to target tile' };
    }
    // path.length === 1 means already at destination — not an error.

    let pathIndex = 1;
    let replans = 0;

    while (pathIndex < path.length) {
        const step = path[pathIndex];
        const isAtStep =
            Math.floor(entity.x) === step.x && Math.floor(entity.y) === step.y && entity.z === step.z;
        if (isAtStep) {
            pathIndex++;
            continue;
        }

        const view = getWorld();
        if (!isRemainingPathAccessible(view, path, pathIndex)) {
            if (replans >= maxReplans) {
                return { ok: false, message: 'Path blocked and replan limit reached' };
            }
            replans++;
            path = planPathFromEntity(entity, view, target);
            if (!path || path.length < 2) {
                return { ok: false, message: 'No path to target tile' };
            }
            pathIndex = 1;
            continue;
        }

        const result = yield moveToTileAction(entity, step.x, step.y, step.z);
        if (result && !result.ok) {
            if (replans >= maxReplans) return result;
            replans++;
            path = planPathFromEntity(entity, getWorld(), target);
            if (!path || path.length < 2) return result;
            pathIndex = 1;
            continue;
        }

        pathIndex++;
    }

    return { ok: true };
}
