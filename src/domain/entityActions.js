/**
 * Shared world interactions for any entity (player or NPC).
 * Input UI and plan runners call these — implement a capability once here.
 */
import { cookUncookedSteakInInventory } from './cooking.js';
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
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} [tileZ] - defaults to entity.z
 * @returns {boolean}
 */
export function pickUpAtTile(entity, world, tileX, tileY, tileZ = entity.z) {
    if (tileZ !== entity.z) return false;
    if (!isAdjacentToTile(entity, tileX, tileY)) return false;

    const tile = world.getTile(tileX, tileY, tileZ);
    if (!tile || !isPickableObject(tile.obj)) return false;

    const objType = tile.obj;
    const keyBuildingId = objType === Obj.KEY ? tile.keyBuildingId : undefined;
    world.setTile(tileX, tileY, tileZ, { obj: 0, contents: [], keyBuildingId: null });

    if (!entity.inventory) entity.inventory = [];
    mergeStackInto(entity.inventory, objType, 1, keyBuildingId ?? undefined);
    return true;
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @returns {boolean}
 */
export function cookAtStove(entity, world, tileX, tileY) {
    if (!entity.inventory) entity.inventory = [];
    if (!isAdjacentToTile(entity, tileX, tileY)) return false;

    const tile = world.getTile(tileX, tileY, entity.z);
    if (!tile || !isStoveObject(tile.obj)) return false;

    return cookUncookedSteakInInventory(entity.inventory);
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
 * Drop one or more of an inventory stack onto nearby walkable tiles.
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} objType
 * @param {number} [buildingId]
 * @param {number} [count] - default: entire stack
 * @returns {DropResult}
 */
export function dropFromInventory(entity, world, objType, buildingId, count) {
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

    const message =
        placed === n ? 'Dropped' : `Dropped ${placed} (no room for rest)`;
    return { placed, requested: n, message };
}

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @returns {boolean}
 */
export function canOpenContainerAt(entity, world, cx, cy, cz) {
    if (cz !== entity.z) return false;
    const tile = world.getTile(cx, cy, cz);
    if (!tile || !isContainerObject(tile.obj)) return false;
    return isAdjacentToTile(entity, cx, cy);
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
    if (!canOpenContainerAt(entity, world, cx, cy, cz)) return false;

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
 * @returns {boolean}
 */
export function stashToContainer(entity, world, cx, cy, cz, objType, buildingId) {
    if (!canStashInContainer(objType)) return false;
    if (!canOpenContainerAt(entity, world, cx, cy, cz)) return false;

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
    world.ensureTileContents(cx, cy, cz);
    const contents = tile.contents ?? [];
    for (const stack of contents) {
        if (inventoryTypes.includes(stack.objType) && stack.count > 0) {
            return { objType: stack.objType, buildingId: stack.buildingId };
        }
    }
    return null;
}
