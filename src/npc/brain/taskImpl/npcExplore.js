/**
 * Wide-area search — visits a grid of waypoints (perception-sized steps),
 * retries local find, and paths to remembered pickable matches.
 */
import { findPath } from '../../../world/pathfinding.js';
import { isPickableObject } from '../../../world/tileTypes.js';
import { World3D } from '../../../world/world.js';
import { NPC_PERCEPTION_RADIUS } from '../../shared/npcMemory.js';
import { isTileMemoryReachable } from '../../shared/npcMemory.js';
import { pathStepsFromNpc } from './npcMemoryTravel.js';
import { getObjectTagSpec } from '../../shared/npcObjectTags.js';
import { rememberLocationsOfNearby } from './npcPlanRefs.js';
import { runPickUpAtTile, travelNpcToTile } from '../../../actors/npcSimulation.js';
import { runFind } from './npcTaskPrimitives.js';

/** @typedef {{ x: number, y: number, z: number }} TileCoord */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @typedef {Object} ExploreOptions
 * @property {string} objectTag
 * @property {number} radius - Chebyshev tiles from anchor
 * @property {'home' | 'self'} [anchor]
 * @property {boolean} [pickup]
 * @property {number} [localRadius] - tiles for runFind at each stop (default perception radius)
 * @property {number} [gridStep] - spacing between waypoints (default perception radius)
 * @property {number} [maxVisits] - cap on waypoint travels
 * @property {number} [buildingId] - for keys, match keyBuildingId on tile
 */

/**
 * Walkable grid points covering a Chebyshev disk around anchor.
 * @param {World3D} world
 * @param {TileCoord} anchor
 * @param {number} radius
 * @param {number} [gridStep]
 * @returns {TileCoord[]}
 */
export function generateExploreWaypoints(world, anchor, radius, gridStep = NPC_PERCEPTION_RADIUS) {
    const step = Math.max(1, gridStep);
    /** @type {TileCoord[]} */
    const waypoints = [];

    for (let y = anchor.y - radius; y <= anchor.y + radius; y += step) {
        for (let x = anchor.x - radius; x <= anchor.x + radius; x += step) {
            if (Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y)) > radius) continue;
            if (!world.isWalkable(x, y, anchor.z)) continue;
            waypoints.push({ x, y, z: anchor.z });
        }
    }

    return waypoints;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {TileCoord[]} waypoints
 * @param {Set<string>} visited
 * @returns {TileCoord | null}
 */
export function pickNextExploreWaypoint(npc, world, waypoints, visited) {
    /** @type {{ wp: TileCoord, cost: number }[]} */
    const candidates = [];

    for (const wp of waypoints) {
        const key = World3D.key(wp.x, wp.y, wp.z);
        if (visited.has(key)) continue;
        const cost = pathStepsFromNpc(npc, world, wp.x, wp.y, wp.z);
        if (!Number.isFinite(cost)) continue;
        candidates.push({ wp, cost });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.cost - b.cost || a.wp.x - b.wp.x || a.wp.y - b.wp.y);
    return candidates[0].wp;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {string} objectTag
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {Promise<boolean>}
 */
async function tryPickupRememberedTarget(npc, world, objectTag, objType, buildingId) {
    for (const target of rememberLocationsOfNearby(npc, objectTag)) {
        if (!isTileMemoryReachable(npc, target.x, target.y, target.z)) continue;

        const tile = world.getTile(target.x, target.y, target.z);
        if (!tile || tile.obj !== objType || !isPickableObject(tile.obj)) continue;
        if (buildingId != null && tile.keyBuildingId !== buildingId) continue;

        try {
            await runPickUpAtTile(npc, world, target.x, target.y, target.z);
            return true;
        } catch {
            continue;
        }
    }
    return false;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {ExploreOptions} opts
 */
export async function runExplore(npc, world, opts) {
    const spec = getObjectTagSpec(opts.objectTag);
    const objType = spec.worldTypes[0];
    if (objType == null) {
        throw new Error(`explore: object tag ${opts.objectTag} has no world types`);
    }

    const pickup = opts.pickup !== false;
    if (!pickup) {
        throw new Error('explore without pickup is not implemented');
    }

    const localRadius = opts.localRadius ?? NPC_PERCEPTION_RADIUS;
    const anchor =
        opts.anchor === 'self'
            ? { x: Math.floor(npc.x), y: Math.floor(npc.y), z: npc.z }
            : {
                  x: npc.homeX,
                  y: npc.homeY,
                  z: npc.homeZ ?? npc.z,
              };

    const waypoints = generateExploreWaypoints(world, anchor, opts.radius, opts.gridStep);
    const visited = new Set();
    const maxVisits =
        opts.maxVisits ??
        Math.min(64, Math.max(waypoints.length, Math.ceil((opts.radius / NPC_PERCEPTION_RADIUS) ** 2)));

    for (let visit = 0; visit < maxVisits; visit++) {
        try {
            await runFind(npc, world, objType, localRadius, opts.buildingId);
            return;
        } catch {
            // no pickable object in immediate range
        }

        if (await tryPickupRememberedTarget(npc, world, opts.objectTag, objType, opts.buildingId)) {
            return;
        }

        const next = pickNextExploreWaypoint(npc, world, waypoints, visited);
        if (!next) break;

        visited.add(World3D.key(next.x, next.y, next.z));
        const sx = Math.floor(npc.x);
        const sy = Math.floor(npc.y);
        if (sx === next.x && sy === next.y && npc.z === next.z) continue;

        if (!findPath(world, sx, sy, npc.z, next.x, next.y, next.z)) continue;
        await travelNpcToTile(npc, next.x, next.y, next.z, world);
    }

    throw new Error(`Explore: no ${opts.objectTag} within radius ${opts.radius}`);
}
