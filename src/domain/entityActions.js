/**
 * Shared world interactions for any entity (player or NPC).
 * Input UI and plan runners call these — implement a capability once here.
 */
import { cookUncookedSteakInInventory, cookWheatIntoBread } from './cooking.js';
import { harvestWheatAtTile, plantWheatSeedAtTile } from './crops.js';
import { getTimedAction } from './timedActions.js';
import {
    Obj,
    T,
    canStashInContainer,
    isContainerObject,
    isPickableObject,
    isStoveObject,
    isTerrainDropSurface,
    isTileWalkable,
} from '../world/tileTypes.js';

/** @typedef {{ x: number, y: number, z: number }} TileCoord */
/** @typedef {{ objType: number, count: number, buildingId?: number }} ItemStack */
/** @typedef {import('../actors/entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {{ ok: boolean, message?: string }} ActionResult */

/**
 * Static requirements for an entity action (inventory + target tile semantics).
 * Dynamic world state is validated in action execution; `prereq` captures intent for planners/UI.
 *
 * @typedef {Object} InventoryReq
 * @property {number} objType
 * @property {number} [count=1]
 * @property {number} [buildingId]
 *
 * @typedef {Object} TileReq
 * @property {number} x
 * @property {number} y
 * @property {number} [z]
 * @property {number} [object] - required tile.obj
 * @property {boolean} [pickable] - tile.obj must be pickable
 * @property {boolean} [container] - tile.obj must be a container
 * @property {number} [terrain] - required tile.terrain
 * @property {boolean} [walkable] - tile must be walkable (terrain + obj, doors unlocked)
 *
 * @typedef {Object} ContainerItemReq
 * @property {number} objType
 * @property {number} [buildingId]
 *
 * @typedef {Object} ActionPrereq
 * @property {InventoryReq[][]} [inventoryAnyOf] - OR-of-AND groups for inventory requirements
 * @property {ContainerItemReq} [containerItem] - stack required inside target container
 * @property {TileReq} [tile]
 * @property {TileCoord} [adjacentTo] - entity must be adjacent to this tile
 *
 * @typedef {Object} BaseEntityAction
 * @property {() => ActionPrereq} prereq
 * @property {(world: World3D) => boolean | ActionResult} [apply] - one-shot world effect when no tick
 * @property {(entity: Entity, world: World3D, dt: number) => boolean | ActionResult} [tick] - per-frame update (movement, etc.)
 * @property {number} [duration=0] - seconds; 0 = instant apply, >0 starts TimedActionRunner until complete
 *
 * @typedef {BaseEntityAction & {
 *   type: 'moveDirection',
 *   dx: number,
 *   dy: number,
 * }} MoveDirectionAction
 *
 * @typedef {BaseEntityAction & {
 *   type?: undefined,
 * }} GenericEntityAction
 *
 * @typedef {MoveDirectionAction | GenericEntityAction} EntityAction
 */

/**
 * @param {EntityAction} action
 * @returns {number}
 */
export function actionDuration(action) {
    return action.duration ?? 0;
}

/**
 * @param {EntityAction} action
 * @returns {action is MoveDirectionAction}
 */
export function isMoveDirectionAction(action) {
    return action.type === 'moveDirection';
}

/**
 * Same movement primitive as player keyboard input — one simulation step via tryMove.
 * @param {Entity} entity
 * @param {number} dx - normalized direction (-1, 0, or 1)
 * @param {number} dy
 * @returns {MoveDirectionAction}
 */
export function moveDirectionAction(entity, dx, dy) {
    return {
        type: 'moveDirection',
        dx,
        dy,
        duration: 0,
        prereq: () => ({}),
        tick: (e, world, dt) => {
            if (dx === 0 && dy === 0) return true;
            return e.tryMove(dx, dy, world, dt);
        },
    };
}

/**
 * @param {Entity} entity
 * @param {InventoryReq} req
 */
export function inventoryHasReq(entity, req) {
    const count = req.count ?? 1;
    return (entity.inventory ?? []).some(
        (s) =>
            s.objType === req.objType &&
            s.count >= count &&
            (req.buildingId == null || s.buildingId === req.buildingId),
    );
}

/**
 * @param {Entity} entity
 * @param {ActionPrereq} prereq
 */
export function satisfiesInventoryPrereq(entity, prereq) {
    const groups = prereq.inventoryAnyOf ?? [];
    if (groups.length === 0) return true;
    return groups.some((group) => group.every((req) => inventoryHasReq(entity, req)));
}

/**
 * @param {Entity} entity
 * @param {ActionPrereq} prereq
 * @returns {ActionResult}
 */
export function explainInventoryPrereq(entity, prereq) {
    if (satisfiesInventoryPrereq(entity, prereq)) return { ok: true };
    return { ok: false, message: 'Missing required items' };
}

/**
 * @param {World3D} world
 * @param {TileReq} req
 * @returns {boolean}
 */
export function satisfiesTilePrereq(world, req) {
    const z = req.z ?? 0;
    const tile = world.getTile(req.x, req.y, z);
    if (!tile) return false;
    if (req.object != null && tile.obj !== req.object) return false;
    if (req.pickable === true && !isPickableObject(tile.obj)) return false;
    if (req.container === true && !isContainerObject(tile.obj)) return false;
    if (req.terrain != null && tile.terrain !== req.terrain) return false;
    if (req.walkable === true && !world.isWalkable(req.x, req.y, z)) return false;
    return true;
}

/**
 * @param {World3D} world
 * @param {TileReq} req
 * @returns {ActionResult}
 */
export function explainTilePrereq(world, req) {
    const z = req.z ?? 0;
    const tile = world.getTile(req.x, req.y, z);
    if (!tile) return { ok: false, message: 'Target tile does not exist' };
    if (req.object != null && tile.obj !== req.object) return { ok: false, message: 'Wrong object on tile' };
    if (req.pickable === true && !isPickableObject(tile.obj)) return { ok: false, message: 'Nothing pickable there' };
    if (req.container === true && !isContainerObject(tile.obj)) return { ok: false, message: 'Target is not a container' };
    if (req.terrain != null && tile.terrain !== req.terrain) return { ok: false, message: 'Wrong terrain' };
    if (req.walkable === true && !world.isWalkable(req.x, req.y, z)) {
        return { ok: false, message: 'Tile is not walkable' };
    }
    return { ok: true };
}

/**
 * Evaluate static action prereqs against current entity/world state with reasons.
 * @param {Entity} entity
 * @param {World3D} world
 * @param {ActionPrereq} prereq
 * @returns {ActionResult}
 */
export function explainActionPrereq(entity, world, prereq) {
    const inv = explainInventoryPrereq(entity, prereq);
    if (!inv.ok) return inv;

    if (prereq.adjacentTo) {
        const t = prereq.adjacentTo;
        if (t.z !== entity.z) return { ok: false, message: 'Wrong floor' };
        if (!isAdjacentToTile(entity, t.x, t.y)) return { ok: false, message: 'Too far away' };
    }

    if (prereq.tile) {
        const tile = explainTilePrereq(world, prereq.tile);
        if (!tile.ok) return tile;
    }

    if (prereq.containerItem) {
        const t = prereq.tile;
        if (!t) return { ok: false, message: 'Container target missing' };
        const stacks = world.getTileContents(t.x, t.y, t.z ?? 0);
        const hit = stacks.some(
            (s) =>
                s.objType === prereq.containerItem.objType &&
                (prereq.containerItem.buildingId == null ||
                    s.buildingId === prereq.containerItem.buildingId) &&
                s.count > 0,
        );
        if (!hit) return { ok: false, message: 'Required item not in container' };
    }

    return { ok: true };
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 */
export function isAdjacentToTile(entity, tileX, tileY) {
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    return Math.max(Math.abs(px - tileX), Math.abs(py - tileY)) <= 1;
}

/**
 * @param {ItemStack[]} list
 * @param {number} objType
 * @param {number} count
 * @param {number} [buildingId]
 */
export function mergeStackInto(list, objType, count, buildingId) {
    const e = list.find(
        (x) => x.objType === objType && (objType !== Obj.KEY || x.buildingId === buildingId),
    );
    if (e) e.count += count;
    else {
        const entry = { objType, count };
        if (objType === Obj.KEY && buildingId != null) entry.buildingId = buildingId;
        list.push(entry);
    }
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} [tileZ]
 * @returns {EntityAction}
 */
export function pickUpAction(entity, tileX, tileY, tileZ = entity.z) {
    return {
        prereq: () => ({
            adjacentTo: { x: tileX, y: tileY, z: tileZ },
            tile: { x: tileX, y: tileY, z: tileZ, pickable: true },
        }),
        apply: (world) => applyPickUpAtTile(entity, world, tileX, tileY, tileZ),
    };
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 * @returns {EntityAction}
 */
export function cookSteakAtStoveAction(entity, tileX, tileY) {
    return {
        prereq: () => ({
            inventoryAnyOf: [[{ objType: Obj.UNCOOKED_STEAK }]],
            adjacentTo: { x: tileX, y: tileY, z: entity.z },
            tile: { x: tileX, y: tileY, z: entity.z, object: Obj.STOVE },
        }),
        apply: (world) => applyCookSteakAtStove(entity, world, tileX, tileY),
    };
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 * @returns {EntityAction}
 */
export function cookBreadAtStoveAction(entity, tileX, tileY) {
    return {
        prereq: () => ({
            inventoryAnyOf: [[{ objType: Obj.WHEAT }]],
            adjacentTo: { x: tileX, y: tileY, z: entity.z },
            tile: { x: tileX, y: tileY, z: entity.z, object: Obj.STOVE },
        }),
        apply: (world) => applyCookBreadAtStove(entity, world, tileX, tileY),
    };
}

/**
 * @param {Entity} entity
 * @returns {EntityAction}
 */
export function toggleDoorLockAction(entity) {
    return {
        prereq: () => ({ adjacentTo: { x: Math.floor(entity.x), y: Math.floor(entity.y), z: entity.z } }),
        apply: (world) => toggleDoorLock(entity, world).ok,
    };
}

/**
 * @param {Entity} entity
 * @param {number} objType
 * @param {number} [buildingId]
 * @param {number} [count]
 * @returns {EntityAction & { lastResult: DropResult }}
 */
export function dropAction(entity, objType, buildingId, count) {
    /** @type {DropResult} */
    let lastResult = { placed: 0, requested: 0, message: '' };
    const inventoryReq = { objType, count: count ?? 1 };
    if (objType === Obj.KEY && buildingId != null) inventoryReq.buildingId = buildingId;
    return {
        get lastResult() {
            return lastResult;
        },
        prereq: () => ({ inventoryAnyOf: [[inventoryReq]] }),
        apply: (world) => {
            lastResult = applyDropFromInventory(entity, world, objType, buildingId, count);
            return lastResult.placed > 0;
        },
    };
}

/**
 * @param {Entity} entity
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {EntityAction}
 */
export function takeFromContainerAction(entity, cx, cy, cz, objType, buildingId) {
    /** @type {ContainerItemReq} */
    const containerItem = { objType };
    if (objType === Obj.KEY && buildingId != null) containerItem.buildingId = buildingId;
    return {
        prereq: () => ({
            adjacentTo: { x: cx, y: cy, z: cz },
            tile: { x: cx, y: cy, z: cz, container: true },
            containerItem,
        }),
        apply: (world) => applyTakeFromContainer(entity, world, cx, cy, cz, objType, buildingId),
    };
}

/**
 * @param {Entity} entity
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {EntityAction}
 */
export function stashToContainerAction(entity, cx, cy, cz, objType, buildingId) {
    const inventoryReq = { objType };
    if (objType === Obj.KEY && buildingId != null) inventoryReq.buildingId = buildingId;
    return {
        prereq: () => ({
            inventoryAnyOf: [[inventoryReq]],
            adjacentTo: { x: cx, y: cy, z: cz },
            tile: { x: cx, y: cy, z: cz, container: true },
        }),
        apply: (world) => applyStashToContainer(entity, world, cx, cy, cz, objType, buildingId),
    };
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} gameTime
 * @param {number} [tileZ]
 * @returns {EntityAction}
 */
export function plantWheatSeedAction(entity, tileX, tileY, gameTime, tileZ = entity.z) {
    return {
        prereq: () => ({
            inventoryAnyOf: [[{ objType: Obj.WHEAT_SEED }]],
            adjacentTo: { x: tileX, y: tileY, z: tileZ },
            tile: { x: tileX, y: tileY, z: tileZ, terrain: T.DIRT },
        }),
        apply: (world) => plantWheatSeedAtTile(entity, world, tileX, tileY, gameTime, tileZ).ok,
    };
}

/**
 * @param {Entity} entity
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} gameTime
 * @param {number} [tileZ]
 * @returns {EntityAction}
 */
export function harvestWheatAction(entity, tileX, tileY, gameTime, tileZ = entity.z) {
    return {
        prereq: () => ({
            adjacentTo: { x: tileX, y: tileY, z: tileZ },
            tile: { x: tileX, y: tileY, z: tileZ, object: Obj.WHEAT_CROP },
        }),
        apply: (world) => harvestWheatAtTile(entity, world, tileX, tileY, gameTime, tileZ).ok,
    };
}

// --- apply implementations ---

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} tileZ
 */
function applyPickUpAtTile(entity, world, tileX, tileY, tileZ) {
    if (tileZ !== entity.z) return false;
    if (!isAdjacentToTile(entity, tileX, tileY)) return false;

    const tile = world.getTile(tileX, tileY, tileZ);
    if (!tile || !isPickableObject(tile.obj)) return false;

    const objType = tile.obj;
    const keyBuildingId = objType === Obj.KEY ? tile.keyBuildingId : undefined;
    world.setTile(tileX, tileY, tileZ, { obj: 0, keyBuildingId: null });

    if (!entity.inventory) entity.inventory = [];
    mergeStackInto(entity.inventory, objType, 1, keyBuildingId ?? undefined);
    return true;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 */
function applyCookSteakAtStove(entity, world, tileX, tileY) {
    if (!entity.inventory) entity.inventory = [];
    if (!isAdjacentToTile(entity, tileX, tileY)) return false;

    const tile = world.getTile(tileX, tileY, entity.z);
    if (!tile || !isStoveObject(tile.obj)) return false;

    return cookUncookedSteakInInventory(entity.inventory);
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 */
function applyCookBreadAtStove(entity, world, tileX, tileY) {
    if (!entity.inventory) entity.inventory = [];
    if (!isAdjacentToTile(entity, tileX, tileY)) return false;

    const tile = world.getTile(tileX, tileY, entity.z);
    if (!tile || !isStoveObject(tile.obj)) return false;

    return cookWheatIntoBread(entity.inventory);
}

/**
 * @param {Entity} entity
 * @param {number} buildingId
 * @returns {boolean}
 */
export function hasKeyForBuilding(entity, buildingId) {
    return (entity.inventory ?? []).some(
        (s) => s.objType === Obj.KEY && s.buildingId === buildingId && s.count > 0,
    );
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @returns {{ tx: number, ty: number, tile: import('../world/world.js').TileData } | null}
 */
export function findDoorNextToEntity(entity, world) {
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    const pz = entity.z;
    const tryTile = (tx, ty) => {
        const t = world.getTile(tx, ty, pz);
        if (t?.terrain === T.DOOR && t.buildingId != null) return { tx, ty, tile: t };
        return null;
    };
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = tryTile(px + dx, py + dy);
        if (r) return r;
    }
    return null;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {import('../world/world.js').TileData} tile
 * @param {number} doorX
 * @param {number} doorY
 * @param {number} buildingId
 */
export function countsAsInsideForDoor(entity, world, tile, doorX, doorY, buildingId) {
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    const pz = entity.z;
    const pt = world.getTile(px, py, pz);
    if (pt?.interior && pt.buildingId === buildingId) return true;
    const idx = tile.doorInsideDx ?? 0;
    const idy = tile.doorInsideDy ?? 0;
    const isx = doorX + idx;
    const isy = doorY + idy;
    if (px === isx && py === isy) return true;
    const onDoor = px === doorX && py === doorY;
    const adjInside = Math.max(Math.abs(px - isx), Math.abs(py - isy)) === 1;
    return onDoor && adjInside;
}

/** @typedef {{ ok: true, locked: boolean, message: string } | { ok: false, message: string }} DoorToggleResult */

/**
 * Toggle lock on a door adjacent to the entity (same rules as player E key).
 * @param {Entity} entity
 * @param {World3D} world
 * @returns {DoorToggleResult}
 */
export function toggleDoorLock(entity, world) {
    const hit = findDoorNextToEntity(entity, world);
    if (!hit) return { ok: false, message: 'No door nearby' };

    const { tx, ty, tile } = hit;
    const bid = tile.buildingId;
    const inside = countsAsInsideForDoor(entity, world, tile, tx, ty, bid);
    const nextLocked = !tile.doorLocked;

    if (nextLocked) {
        const px = Math.floor(entity.x);
        const py = Math.floor(entity.y);
        if (px === tx && py === ty) {
            return { ok: false, message: 'Step off the door to lock it' };
        }
    }

    if (inside) {
        world.setTile(tx, ty, entity.z, { doorLocked: nextLocked });
        return {
            ok: true,
            locked: nextLocked,
            message: nextLocked ? 'Door locked' : 'Door unlocked',
        };
    }

    if (hasKeyForBuilding(entity, bid)) {
        world.setTile(tx, ty, entity.z, { doorLocked: nextLocked });
        return {
            ok: true,
            locked: nextLocked,
            message: nextLocked ? 'Door locked (key)' : 'Door unlocked (key)',
        };
    }

    return { ok: false, message: "Need this building's key" };
}

/**
 * @param {World3D} world
 * @param {number} tx
 * @param {number} ty
 * @param {number} z
 * @param {number} objType
 * @param {number} px
 * @param {number} py
 */
function canDropObjAtTile(world, tx, ty, z, objType, px, py) {
    const t = world.getTile(tx, ty, z);
    if (!t || t.obj) return false;
    if (!isTerrainDropSurface(t.terrain)) return false;
    if (!isTileWalkable(t.terrain, 0)) return false;
    if (tx === px && ty === py && !isTileWalkable(t.terrain, objType)) return false;
    return true;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} objType
 * @param {Set<string>} used
 * @returns {TileCoord | null}
 */
function findDropSpot(entity, world, objType, used) {
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    const pz = entity.z;
    for (let r = 0; r <= 8; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const tx = px + dx;
                const ty = py + dy;
                const key = `${tx},${ty},${pz}`;
                if (used.has(key)) continue;
                if (!canDropObjAtTile(world, tx, ty, pz, objType, px, py)) continue;
                used.add(key);
                return { x: tx, y: ty, z: pz };
            }
        }
    }
    return null;
}

/** @typedef {{ placed: number, requested: number, message: string }} DropResult */

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} objType
 * @param {number} [buildingId]
 * @param {number} [count]
 * @returns {DropResult}
 */
function applyDropFromInventory(entity, world, objType, buildingId, count) {
    const inv = entity.inventory ?? [];
    const i = inv.findIndex(
        (e) => e.objType === objType && (objType !== Obj.KEY || e.buildingId === buildingId),
    );
    if (i < 0) return { placed: 0, requested: 0, message: 'Nothing to drop' };

    const stack = inv[i];
    const n = count != null ? Math.min(count, stack.count) : stack.count;
    const used = new Set();
    let placed = 0;

    while (placed < n) {
        const spot = findDropSpot(entity, world, objType, used);
        if (!spot) break;
        const patch = { obj: objType };
        if (objType === Obj.KEY) patch.keyBuildingId = buildingId ?? null;
        else patch.keyBuildingId = null;
        world.setTile(spot.x, spot.y, spot.z, patch);
        placed++;
    }

    if (placed === 0) return { placed: 0, requested: n, message: 'No place to drop' };

    stack.count -= placed;
    if (stack.count <= 0) inv.splice(i, 1);

    const message = placed === n ? 'Dropped' : `Dropped ${placed} (no room for rest)`;
    return { placed, requested: n, message };
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 */
export function canOpenContainerAt(entity, world, cx, cy, cz) {
    if (cz !== entity.z) return false;
    const tile = world.getTile(cx, cy, cz);
    if (!tile || !isContainerObject(tile.obj)) return false;
    return isAdjacentToTile(entity, cx, cy);
}

/** @typedef {{ ok: boolean, contents: {objType:number, count:number, buildingId?:number}[] }} LookInsideContainerResult */

/**
 * Look inside a container and read a snapshot of its contents.
 * @param {Entity} entity
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {EntityAction & { lastResult: LookInsideContainerResult }}
 */
export function lookInsideContainerAction(entity, cx, cy, cz) {
    /** @type {LookInsideContainerResult} */
    let lastResult = { ok: false, contents: [] };
    return {
        get lastResult() {
            return lastResult;
        },
        prereq: () => ({
            adjacentTo: { x: cx, y: cy, z: cz },
            tile: { x: cx, y: cy, z: cz, container: true },
        }),
        apply: (world) => {
            if (!canOpenContainerAt(entity, world, cx, cy, cz)) {
                lastResult = { ok: false, contents: [] };
                return false;
            }
            const contents = world.ensureTileContents(cx, cy, cz) ?? [];
            lastResult = { ok: true, contents: contents.map((s) => ({ ...s })) };
            return true;
        },
    };
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 */
function applyTakeFromContainer(entity, world, cx, cy, cz, objType, buildingId) {
    const look = lookInsideContainerAction(entity, cx, cy, cz);
    if (!look.apply?.(world)) return false;

    const contents = world.ensureTileContents(cx, cy, cz);
    if (!contents) return false;

    const i = contents.findIndex(
        (e) => e.objType === objType && (objType !== Obj.KEY || e.buildingId === buildingId),
    );
    if (i < 0) return false;

    const [stack] = contents.splice(i, 1);
    if (!entity.inventory) entity.inventory = [];
    mergeStackInto(entity.inventory, stack.objType, stack.count, stack.buildingId);
    return true;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 */
function applyStashToContainer(entity, world, cx, cy, cz, objType, buildingId) {
    if (!canStashInContainer(objType)) return false;
    const look = lookInsideContainerAction(entity, cx, cy, cz);
    if (!look.apply?.(world)) return false;

    const inv = entity.inventory ?? [];
    const i = inv.findIndex(
        (e) => e.objType === objType && (objType !== Obj.KEY || e.buildingId === buildingId),
    );
    if (i < 0) return false;

    const [stack] = inv.splice(i, 1);
    const contents = world.ensureTileContents(cx, cy, cz);
    if (!contents) {
        mergeStackInto(inv, stack.objType, stack.count, stack.buildingId);
        return false;
    }
    mergeStackInto(contents, stack.objType, stack.count, stack.buildingId);
    return true;
}

/**
 * First matching stack in a container (for NPC plans).
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number[]} inventoryTypes
 * @returns {{ objType: number, buildingId?: number } | null}
 */
export function findContainerStack(world, cx, cy, cz, inventoryTypes) {
    const tile = world.getTile(cx, cy, cz);
    if (!tile || !isContainerObject(tile.obj)) return null;
    const contents = world.ensureTileContents(cx, cy, cz) ?? [];
    for (const stack of contents) {
        if (inventoryTypes.includes(stack.objType) && stack.count > 0) {
            return { objType: stack.objType, buildingId: stack.buildingId };
        }
    }
    return null;
}

// --- legacy function wrappers (delegate to actions) ---

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} [tileZ]
 * @returns {boolean}
 */
export function pickUpAtTile(entity, world, tileX, tileY, tileZ = entity.z) {
    return pickUpAction(entity, tileX, tileY, tileZ).apply(world);
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @returns {false | 'steak' | 'bread'}
 */
export function cookAtStove(entity, world, tileX, tileY) {
    if (cookSteakAtStoveAction(entity, tileX, tileY).apply(world)) return 'steak';
    if (cookBreadAtStoveAction(entity, tileX, tileY).apply(world)) return 'bread';
    return false;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} objType
 * @param {number} [buildingId]
 * @param {number} [count]
 * @returns {DropResult}
 */
export function dropFromInventory(entity, world, objType, buildingId, count) {
    const action = dropAction(entity, objType, buildingId, count);
    action.apply(world);
    return action.lastResult;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {boolean}
 */
export function takeFromContainer(entity, world, cx, cy, cz, objType, buildingId) {
    return takeFromContainerAction(entity, cx, cy, cz, objType, buildingId).apply(world);
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {number} objType
 * @param {number} [buildingId]
 * @returns {boolean}
 */
export function stashToContainer(entity, world, cx, cy, cz, objType, buildingId) {
    return stashToContainerAction(entity, cx, cy, cz, objType, buildingId).apply(world);
}

/**
 * Timed registry action at a tile (e.g. clear_grass). apply() starts the runner; world updates on complete.
 * @param {Entity} entity
 * @param {string} actionId
 * @param {number} tx
 * @param {number} ty
 * @param {number} [tz]
 * @returns {EntityAction}
 */
export function startTimedWorldAction(entity, actionId, tx, ty, tz = entity.z) {
    const duration = getTimedAction(actionId)?.duration ?? 0;
    return {
        duration,
        prereq: () => ({ adjacentTo: { x: tx, y: ty, z: tz } }),
        apply: (world) => entity.timedAction.start(actionId, world, tx, ty, tz).ok,
    };
}
