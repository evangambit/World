/**
 * Tile/object type constants and gameplay rules (no rendering).
 */

// ── Tile type enum ──
export const T = {
    NONE:        0,
    GRASS:       1,
    DIRT:        2,
    STONE_PATH:  3,
    WATER:       4,
    WOOD_FLOOR:  5,
    STONE_FLOOR: 6,
    WALL_STONE:  7,
    WALL_WOOD:   8,
    CLIFF:       9,
    BRIDGE:     10,
    DOOR:       11,
    STAIRS_UP:  12,
    STAIRS_DOWN:13,
    ROOF:       14,
    SAND:       15,
    TALL_GRASS: 16,
};

// ── Object type enum (rendered on top of terrain) ──
export const Obj = {
    NONE:   0,
    TREE:   1,
    ROCK:   2,
    BUSH:   3,
    FLOWER: 4,
    TABLE:  5,
    CHAIR:  6,
    BED:    7,
    BARREL: 8,
    CRATE:  9,
    SIGN:  10,
    WELL:  11,
    LAMP:  12,
    CHEST: 13,
    /** Building key — use `keyBuildingId` on the tile or inventory stack */
    KEY: 14,
    STOVE: 15,
    UNCOOKED_STEAK: 16,
    STEAK: 17,
    /** Growing wheat — use `cropStage` 0–3 on the tile */
    WHEAT_CROP: 18,
    WHEAT: 19,
    WHEAT_SEED: 20,
    BREAD: 21,
};

/** Wheat growth stages (0 = sprout … 3 = mature). */
export const WHEAT_CROP_STAGES = 4;

/** Reverse-lookup name maps for UI display */
const _buildNames = (obj) => { const m = {}; for (const [k, v] of Object.entries(obj)) m[v] = k.charAt(0) + k.slice(1).toLowerCase().replace('_', ' '); return m; };
export const TERRAIN_NAMES = _buildNames(T);
export const OBJ_NAMES = _buildNames(Obj);

/** Objects the player can pick up into inventory (world tile `obj` is cleared). */
const PICKABLE_OBJ = new Set([
    Obj.FLOWER, Obj.BUSH, Obj.ROCK, Obj.BARREL, Obj.CRATE, Obj.KEY, Obj.UNCOOKED_STEAK,
    Obj.WHEAT, Obj.WHEAT_SEED, Obj.BREAD,
]);

/** Furniture / storage whose stacks live in World3D's private container store. */
const CONTAINER_OBJ = new Set([Obj.TABLE, Obj.BED, Obj.CHAIR, Obj.CHEST]);

export function isContainerObject(objType) {
    return !!objType && CONTAINER_OBJ.has(objType);
}

export function isPickableObject(objType) {
    return !!objType && PICKABLE_OBJ.has(objType);
}

export function isStoveObject(objType) {
    return objType === Obj.STOVE;
}

export function isWheatCropObject(objType) {
    return objType === Obj.WHEAT_CROP;
}

/** @param {number} cropStage */
export function formatWheatCropLabel(cropStage) {
    const names = ['Wheat sprout', 'Young wheat', 'Growing wheat', 'Mature wheat'];
    return names[Math.min(cropStage, WHEAT_CROP_STAGES - 1)] ?? 'Wheat';
}

/** Items allowed inside a container (no nesting furniture). */
export function canStashInContainer(objType) {
    return isPickableObject(objType) && !isContainerObject(objType);
}

export function formatItemStackLabel(objType, count, buildingId) {
    let name = OBJ_NAMES[objType] || `Object ${objType}`;
    if (objType === Obj.KEY && buildingId != null) name = `${name} #${buildingId}`;
    return count > 1 ? `${name} ×${count}` : name;
}

// ── Walkability ──
const NON_WALKABLE = new Set([
    T.NONE, T.WATER, T.WALL_STONE, T.WALL_WOOD, T.CLIFF, T.ROOF,
]);
const NON_WALKABLE_OBJ = new Set([
    Obj.TREE, Obj.ROCK, Obj.WELL, Obj.BARREL, Obj.CRATE, Obj.TABLE, Obj.BED, Obj.CHEST, Obj.STOVE,
]);

export function isTileWalkable(terrain, obj) {
    if (NON_WALKABLE.has(terrain)) return false;
    if (obj && NON_WALKABLE_OBJ.has(obj)) return false;
    return true;
}

/** Loose items can be placed on this terrain (not walls, water, doors, stairs). */
export function isTerrainDropSurface(terrain) {
    if (terrain === T.DOOR || terrain === T.STAIRS_UP || terrain === T.STAIRS_DOWN) return false;
    return !NON_WALKABLE.has(terrain);
}

/** Bushes / flowers only on outdoor ground — never on building walls, doors, floors, water, etc. */
const AMBIENT_PLANT_TERRAIN = new Set([
    T.GRASS, T.DIRT, T.STONE_PATH, T.SAND, T.TALL_GRASS,
]);

export function canPlaceAmbientPlantOnTerrain(terrain) {
    return AMBIENT_PLANT_TERRAIN.has(terrain);
}

/** Grass / tall grass that can be cleared to dirt with a timed action. */
export function isClearableGrassTerrain(terrain) {
    return terrain === T.GRASS || terrain === T.TALL_GRASS;
}
