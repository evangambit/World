/**
 * WorldBuilder — high-level helpers for constructing the world,
 * plus the village map definition.
 */
import { T, Obj, canPlaceAmbientPlantOnTerrain } from '../world/tileTypes.js';
import { World3D } from '../world/world.js';

export class WorldBuilder {
    /**
     * @param {World3D} world
     */
    constructor(world) {
        this.world = world;
        /** @type {number} auto-incrementing building identifier */
        this._nextBuildingId = 1;
    }

    /** Fill a rectangle on a given z-layer with a terrain type. */
    fillRect(x, y, w, h, z, terrain, opts = {}) {
        for (let ty = y; ty < y + h; ty++) {
            for (let tx = x; tx < x + w; tx++) {
                this.world.setTile(tx, ty, z, { terrain, ...opts });
            }
        }
    }

    /** Place a single object on a tile (tile must already exist). */
    placeObject(x, y, z, obj) {
        this.world.setTile(x, y, z, { obj });
    }

    /** Bush / flower — only on grass, dirt, paths, sand, tall grass (not walls or indoor floors). */
    placeAmbientPlant(x, y, z, obj) {
        const t = this.world.getTile(x, y, z);
        if (!t || t.obj) return;
        if (!canPlaceAmbientPlantOnTerrain(t.terrain)) return;
        this.world.setTile(x, y, z, { obj });
    }

    /**
     * Place wheat at a given growth stage (for map authoring).
     * @param {number} stage 0–3
     * @param {number} [cropPlantedAt] - game time offset so stage matches at t=0
     */
    placeWheatCrop(x, y, z, stage, cropPlantedAt = 0) {
        const t = this.world.getTile(x, y, z);
        if (!t || t.obj) return;
        if (!canPlaceAmbientPlantOnTerrain(t.terrain)) return;
        this.world.setTile(x, y, z, {
            obj: Obj.WHEAT_CROP,
            cropStage: stage,
            cropPlantedAt,
        });
    }

    /**
     * Place a container object with initial item stacks.
     * @param {{objType: number, count: number}[]} contents
     */
    placeContainer(x, y, z, obj, contents = []) {
        this.world.setTile(x, y, z, {
            obj,
            contents: contents.map((c) => ({ objType: c.objType, count: c.count })),
        });
    }

    /**
     * Place a rectangular building.
     * @param {number} x - left edge
     * @param {number} y - top edge
     * @param {number} w - width (including walls)
     * @param {number} h - height (including walls)
     * @param {number} floors - number of floors (1 or 2)
     * @param {'stone'|'wood'} wallType
     * @param {{doorSide?: 'south'|'north'|'east'|'west', doorOffset?: number, withStove?: boolean, deferChest?: boolean}} opts
     */
    placeBuilding(x, y, w, h, floors = 1, wallType = 'stone', opts = {}) {
        const wallTile = wallType === 'wood' ? T.WALL_WOOD : T.WALL_STONE;
        const floorTile = wallType === 'wood' ? T.WOOD_FLOOR : T.STONE_FLOOR;
        const doorSide = opts.doorSide || 'south';
        const doorOffset = opts.doorOffset ?? Math.floor(w / 2);
        const bid = this._nextBuildingId++;

        for (let f = 0; f < floors; f++) {
            const z = f;
            // Interior floor (with ceiling flag)
            this.fillRect(x + 1, y + 1, w - 2, h - 2, z, floorTile, { ceiling: true, buildingId: bid, interior: true });

            // Walls (4 edges)
            for (let tx = x; tx < x + w; tx++) {
                this.world.setTile(tx, y, z, { terrain: wallTile, ceiling: true, buildingId: bid });
                this.world.setTile(tx, y + h - 1, z, { terrain: wallTile, ceiling: true, buildingId: bid });
            }
            for (let ty = y + 1; ty < y + h - 1; ty++) {
                this.world.setTile(x, ty, z, { terrain: wallTile, ceiling: true, buildingId: bid });
                this.world.setTile(x + w - 1, ty, z, { terrain: wallTile, ceiling: true, buildingId: bid });
            }

            // Door (only on ground floor, or each floor if accessible)
            if (f === 0) {
                let dx, dy;
                if (doorSide === 'south') { dx = x + doorOffset; dy = y + h - 1; }
                else if (doorSide === 'north') { dx = x + doorOffset; dy = y; }
                else if (doorSide === 'west') { dx = x; dy = y + doorOffset; }
                else { dx = x + w - 1; dy = y + doorOffset; }
                /** Unit step from door tile toward building interior (for inside/outside lock rules) */
                let insideDx = 0, insideDy = 0;
                if (doorSide === 'south') { insideDx = 0; insideDy = -1; }
                else if (doorSide === 'north') { insideDx = 0; insideDy = 1; }
                else if (doorSide === 'west') { insideDx = 1; insideDy = 0; }
                else { insideDx = -1; insideDy = 0; }
                this.world.setTile(dx, dy, z, {
                    terrain: T.DOOR,
                    ceiling: false,
                    buildingId: bid,
                    doorLocked: false,
                    doorInsideDx: insideDx,
                    doorInsideDy: insideDy,
                });
            }

            // Stairs between floors
            if (f < floors - 1) {
                // Stairs up on this floor — land one tile south of the upstairs stair
                const sx = x + w - 3, sy = y + 1;
                this.world.setTile(sx, sy, z, {
                    terrain: T.STAIRS_UP, ceiling: true, buildingId: bid, interior: true,
                    transition: { tx: sx, ty: sy + 1, tz: z + 1, type: 'stairs' }
                });
                // Stairs down on floor above — land one tile south of the downstairs stair
                this.world.setTile(sx, sy, z + 1, {
                    terrain: T.STAIRS_DOWN, ceiling: true, buildingId: bid, interior: true,
                    transition: { tx: sx, ty: sy + 1, tz: z, type: 'stairs' }
                });
            }
        }

        // Roof layer on top — only covers interior, leaving perimeter walls visible
        const roofZ = floors;
        this.fillRect(x + 1, y + 1, w - 2, h - 2, roofZ, T.ROOF, { buildingId: bid, interior: true });

        this._spawnBuildingKey(bid, x, y, w, h, 0);
        if (opts.withStove) {
            this._placeStove(x, y, w, h, doorSide);
            if (!opts.deferChest) {
                this._placeHouseChest(x, y, w, h, bid);
            }
        }
        return bid;
    }

    /**
     * Place a kitchen stove on an interior wall, away from the door.
     * @param {'south'|'north'|'east'|'west'} doorSide
     */
    _placeStove(x, y, w, h, doorSide) {
        const z = 0;
        /** @type {{ x: number, y: number }[]} */
        const candidates = [];
        if (doorSide === 'south') {
            candidates.push({ x: x + Math.floor(w / 2), y: y + 1 });
        } else if (doorSide === 'north') {
            candidates.push({ x: x + Math.floor(w / 2), y: y + h - 2 });
        } else if (doorSide === 'west') {
            candidates.push({ x: x + w - 2, y: y + Math.floor(h / 2) });
        } else {
            candidates.push({ x: x + 1, y: y + Math.floor(h / 2) });
        }

        for (const { x: tx, y: ty } of candidates) {
            const tile = this.world.getTile(tx, ty, z);
            if (!tile?.interior || tile.obj) continue;
            this.placeObject(tx, ty, z, Obj.STOVE);
            return;
        }
    }

    /** Pantry chest with steaks — updates an existing chest or places a new one. */
    _placeHouseChest(x, y, w, h, bid) {
        const z = 0;
        const steaks = [{ objType: Obj.UNCOOKED_STEAK, count: 2 }];

        for (let ty = y + 1; ty <= y + h - 2; ty++) {
            for (let tx = x + 1; tx <= x + w - 2; tx++) {
                const tile = this.world.getTile(tx, ty, z);
                if (!tile?.interior || tile.buildingId !== bid) continue;
                if (tile.obj !== Obj.CHEST) continue;
                this.placeContainer(tx, ty, z, Obj.CHEST, steaks);
                return;
            }
        }

        for (let ty = y + 1; ty <= y + h - 2; ty++) {
            for (let tx = x + 1; tx <= x + w - 2; tx++) {
                const tile = this.world.getTile(tx, ty, z);
                if (!tile?.interior || tile.buildingId !== bid) continue;
                if (tile.obj) continue;
                this.placeContainer(tx, ty, z, Obj.CHEST, steaks);
                return;
            }
        }
    }

    /**
     * Place this building's key on an empty interior floor tile (ground floor).
     */
    _spawnBuildingKey(bid, x, y, w, h, z) {
        for (let ty = y + 1; ty <= y + h - 2; ty++) {
            for (let tx = x + 1; tx <= x + w - 2; tx++) {
                const t = this.world.getTile(tx, ty, z);
                if (!t || !t.interior || t.buildingId !== bid) continue;
                if (t.obj) continue;
                if (!this.world.isWalkable(tx, ty, z)) continue;
                this.world.setTile(tx, ty, z, { obj: Obj.KEY, keyBuildingId: bid });
                return;
            }
        }
    }

    /** Place elevated terrain (hill) with cliff edges and a stair connection. */
    placeHill(x, y, w, h, stairSide = 'south') {
        // Cliff edges (z=0, not walkable)
        this.fillRect(x, y, w, h, 0, T.CLIFF);

        // Walkable top surface (z=1)
        this.fillRect(x, y, w, h, 1, T.GRASS);

        // Stair tile connecting z=0 to z=1
        let sx, sy;
        if (stairSide === 'south') { sx = x + Math.floor(w / 2); sy = y + h; }
        else if (stairSide === 'north') { sx = x + Math.floor(w / 2); sy = y - 1; }
        else if (stairSide === 'west') { sx = x - 1; sy = y + Math.floor(h / 2); }
        else { sx = x + w; sy = y + Math.floor(h / 2); }

        // Direction offsets: toward hill center vs away from hill
        let toHillDx = 0, toHillDy = 0;
        if (stairSide === 'south') toHillDy = -1;
        else if (stairSide === 'north') toHillDy = 1;
        else if (stairSide === 'west') toHillDx = 1;
        else toHillDx = -1;

        // The stair tile on z=0 — land one tile onto the hill surface at z=1
        this.world.setTile(sx, sy, 0, {
            terrain: T.STAIRS_UP,
            transition: { tx: sx + toHillDx, ty: sy + toHillDy, tz: 1, type: 'stairs' }
        });
        // Matching stair on z=1 — land one tile away from the hill at z=0
        this.world.setTile(sx, sy, 1, {
            terrain: T.STAIRS_DOWN,
            transition: { tx: sx - toHillDx, ty: sy - toHillDy, tz: 0, type: 'stairs' }
        });
    }

    /** Place a bridge (z=1) over existing z=0 terrain. */
    placeBridge(x1, y1, x2, y2) {
        const dx = Math.sign(x2 - x1) || 0;
        const dy = Math.sign(y2 - y1) || 0;
        let cx = x1, cy = y1;
        while (cx !== x2 + dx || cy !== y2 + dy) {
            this.world.setTile(cx, cy, 1, { terrain: T.BRIDGE });
            cx += dx;
            cy += dy;
        }
        // Ramp tiles at each end (on z=0, connecting to z=1)
        // Start ramp: land one tile further onto the bridge
        this.world.setTile(x1 - dx, y1 - dy, 0, {
            terrain: T.STAIRS_UP,
            transition: { tx: x1 + dx, ty: y1 + dy, tz: 1, type: 'ramp' }
        });
        // Bridge start: land one tile further off the bridge
        this.world.setTile(x1, y1, 1, {
            terrain: T.BRIDGE,
            transition: { tx: x1 - 2 * dx, ty: y1 - 2 * dy, tz: 0, type: 'ramp' }
        });
        // End ramp: land one tile further onto the bridge
        this.world.setTile(x2 + dx, y2 + dy, 0, {
            terrain: T.STAIRS_UP,
            transition: { tx: x2 - dx, ty: y2 - dy, tz: 1, type: 'ramp' }
        });
        // Bridge end: land one tile further off the bridge
        this.world.setTile(x2, y2, 1, {
            terrain: T.BRIDGE,
            transition: { tx: x2 + 2 * dx, ty: y2 + 2 * dy, tz: 0, type: 'ramp' }
        });
    }
}

// ── Village map construction ──

/** Build and return the demo fantasy village world. */
export function buildVillage() {
    const world = new World3D();
    const b = new WorldBuilder(world);
    const W = 60, H = 50;

    // 1) Base terrain: grass everywhere
    b.fillRect(0, 0, W, H, 0, T.GRASS);

    // 2) Dirt paths — main crossroads
    // Horizontal path
    b.fillRect(0, 22, W, 2, 0, T.DIRT);
    // Vertical path
    b.fillRect(28, 5, 2, H - 5, 0, T.DIRT);
    // Market square (wider area at intersection)
    b.fillRect(24, 19, 10, 8, 0, T.STONE_PATH);

    // 3) Trees scattered around edges and in groves
    const treePositions = [
        [1, 1], [3, 0], [0, 4], [2, 6], [55, 1], [57, 3], [58, 0], [56, 6],
        [1, 45], [3, 47], [0, 42], [56, 44], [58, 46], [55, 48],
        [8, 2], [10, 4], [12, 1], [45, 3], [47, 1], [50, 5],
        [5, 41], [7, 40], [9, 42], [48, 43], [50, 40], [52, 42],
        [15, 8], [17, 6], [40, 8], [42, 6], [44, 10],
    ];
    for (const [tx, ty] of treePositions) {
        b.placeObject(tx, ty, 0, Obj.TREE);
    }

    // 4) Buildings
    // House 1 — small cottage (northwest area)
    const elaraHouseBid = b.placeBuilding(6, 12, 7, 6, 1, 'wood', {
        doorSide: 'south', doorOffset: 3, withStove: true, deferChest: true,
    });
    // Furniture inside (bed, table, chair hold stashable items; chest is storage)
    b.placeContainer(8, 13, 0, Obj.BED, [{ objType: Obj.FLOWER, count: 2 }]);
    b.placeContainer(10, 13, 0, Obj.TABLE, [{ objType: Obj.FLOWER, count: 1 }]);
    b.placeObject(10, 14, 0, Obj.CHAIR);
    b._placeHouseChest(6, 12, 7, 6, elaraHouseBid);

    // House 2 — stone house (southwest area)
    const finnHouseBid = b.placeBuilding(6, 28, 7, 6, 1, 'stone', {
        doorSide: 'north', doorOffset: 3, withStove: true, deferChest: true,
    });
    b.placeContainer(8, 30, 0, Obj.TABLE, [{ objType: Obj.CRATE, count: 1 }]);
    b.placeObject(9, 30, 0, Obj.CHAIR);
    b.placeObject(10, 30, 0, Obj.BARREL);
    b._placeHouseChest(6, 28, 7, 6, finnHouseBid);

    // Tavern — larger, 2-story (east side)
    b.placeBuilding(36, 12, 10, 8, 2, 'stone', { doorSide: 'south', doorOffset: 5 });
    // Ground floor: tables (can hold loose items)
    b.placeContainer(38, 14, 0, Obj.TABLE, []);
    b.placeObject(39, 14, 0, Obj.CHAIR);
    b.placeContainer(38, 16, 0, Obj.TABLE, []);
    b.placeObject(39, 16, 0, Obj.CHAIR);
    b.placeObject(42, 14, 0, Obj.BARREL);
    b.placeObject(42, 15, 0, Obj.BARREL);
    // Second floor: beds (inn)
    b.placeContainer(38, 14, 1, Obj.BED, []);
    b.placeContainer(40, 14, 1, Obj.BED, []);
    b.placeContainer(38, 16, 1, Obj.TABLE, [{ objType: Obj.FLOWER, count: 2 }]);
    b.placeContainer(40, 15, 0, Obj.CHEST, [{ objType: Obj.CRATE, count: 2 }, { objType: Obj.FLOWER, count: 1 }]);

    // Brom's cottage — behind the tavern (wander AI stays on homeZ, so not the inn upstairs)
    b.placeBuilding(48, 17, 6, 5, 1, 'wood', { doorSide: 'west', doorOffset: 2, withStove: true });

    // NPC homes — small cottages (empty floors so villagers can spawn inside)
    // Mira — west of the market square
    b.placeBuilding(18, 20, 7, 6, 1, 'wood', { doorSide: 'south', doorOffset: 3, withStove: true });
    // Sage — beside the northwest cottage cluster
    b.placeBuilding(13, 12, 7, 6, 1, 'wood', { doorSide: 'east', doorOffset: 2, withStove: true });
    // Shop — (east of market); place before Nyx so the shared row is laid out first
    b.placeBuilding(36, 26, 8, 6, 1, 'wood', { doorSide: 'west', doorOffset: 3 });

    // Nyx — east of the shop (south door — west wall adjoins the shop's east wall)
    b.placeBuilding(44, 26, 7, 6, 1, 'wood', { doorSide: 'south', doorOffset: 3, withStove: true });
    b.placeObject(38, 28, 0, Obj.CRATE);
    b.placeObject(39, 28, 0, Obj.CRATE);
    b.placeObject(40, 28, 0, Obj.BARREL);
    b.placeContainer(41, 28, 0, Obj.CHEST, [{ objType: Obj.FLOWER, count: 4 }, { objType: Obj.BARREL, count: 1 }]);

    // 5) Market decorations
    b.placeObject(25, 20, 0, Obj.SIGN);
    b.placeObject(26, 21, 0, Obj.BARREL);
    b.placeObject(31, 21, 0, Obj.CRATE);
    b.placeObject(25, 25, 0, Obj.LAMP);
    b.placeObject(32, 25, 0, Obj.LAMP);

    // 6) River (runs east-west across the full map)
    b.fillRect(0, 36, W, 3, 0, T.WATER);
    // Sandy banks
    b.fillRect(0, 35, W, 1, 0, T.SAND);
    b.fillRect(0, 39, W, 1, 0, T.SAND);

    // 7) Bridge over river — north-south at x=28, aligned with the dirt path
    b.placeBridge(28, 36, 28, 38);

    // 8) Hill with lookout (northeast)
    b.placeHill(48, 6, 8, 6, 'west');
    // Decorations on top of hill
    b.placeObject(50, 8, 1, Obj.SIGN);
    b.placeObject(52, 9, 1, Obj.ROCK);

    // 9) Well in market square + public stash chest
    b.placeObject(28, 22, 0, Obj.WELL);
    b.placeContainer(26, 23, 0, Obj.CHEST, [
        { objType: Obj.FLOWER, count: 3 },
        { objType: Obj.WHEAT_SEED, count: 8 },
    ]);

    // Wheat field south of the market (dirt patch)
    b.fillRect(24, 30, 6, 4, 0, T.DIRT);
    b.placeWheatCrop(24, 30, 0, 3, -3 * 18);
    b.placeWheatCrop(25, 30, 0, 2, -2 * 18);
    b.placeWheatCrop(26, 30, 0, 1, -1 * 18);
    b.placeWheatCrop(27, 30, 0, 0, 0);
    b.placeWheatCrop(28, 31, 0, 3, -3 * 18);
    b.placeWheatCrop(29, 31, 0, 3, -3 * 18);

    // 10) Some bushes and flowers for ambiance
    const bushPositions = [
        [14, 10], [16, 12], [20, 8], [22, 14], [32, 10], [34, 14],
        [14, 34], [18, 30], [42, 34], [50, 30],
    ];
    for (const [bx, by] of bushPositions) {
        b.placeAmbientPlant(bx, by, 0, Obj.BUSH);
    }
    const flowerPositions = [
        [20, 20], [22, 24], [33, 20], [33, 24], [15, 22], [18, 22],
    ];
    for (const [fx, fy] of flowerPositions) {
        b.placeAmbientPlant(fx, fy, 0, Obj.FLOWER);
    }

    // 11) Tall grass patches
    b.fillRect(2, 30, 4, 3, 0, T.TALL_GRASS);
    // Keep x≥51 so the east wall of Nyx's cottage (x=50) stays intact
    b.fillRect(51, 28, 4, 4, 0, T.TALL_GRASS);

    return world;
}

/**
 * Tile coordinates [x, y] for an axis-aligned rectangle on the ground layer.
 * All four bounds are inclusive.
 *
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @returns {[number, number][]}
 */
export function tilesInSquare(left, top, right, bottom) {
    /** @type {[number, number][]} */
    const tiles = [];
    for (let ty = top; ty <= bottom; ty++) {
        for (let tx = left; tx <= right; tx++) {
            tiles.push([tx, ty]);
        }
    }
    return tiles;
}

/**
 * Map-authored farm zones for NPC coordination (see danImpl/notes/llm-communication.md).
 * Zone names and labels are included in LLM system prompts; tile sets drive farming filters.
 */
export const _rawZones = [
    // Man made structures
    {
        name: 'town_square',
        label: 'the town square (10x8 tiles)',
        tiles: tilesInSquare(24, 19, 33, 26),
    },
    {
        name: 'building_northwest_1',
        label: 'a northwest building (7x6 tiles)',
        tiles: tilesInSquare(6, 12, 12, 17),
    },
    {
        name: 'building_northwest_2',
        label: 'a northwest building (7x6 tiles)',
        tiles: tilesInSquare(13, 12, 19, 17),
    },
    {
        name: 'building_southwest',
        label: 'the southwest building (7x6 tiles)',
        tiles: tilesInSquare(6, 28, 12, 33),
    },
    {
        name: 'building_northeast_1',
        label: 'a northeast building (10x8 tiles)',
        tiles: tilesInSquare(36, 12, 45, 19),
    },
    {
        name: 'building_northeast_2',
        label: 'a northeast building (8x5 tiles)',
        tiles: tilesInSquare(46, 17, 53, 21),
    },
    {
        name: 'building_southeast_1',
        label: 'a southeast building (10x8 tiles)',
        tiles: tilesInSquare(36, 26, 43, 31),
    },
    {
        name: 'building_southeast_2',
        label: 'a southeast building (8x5 tiles)',
        tiles: tilesInSquare(44, 26, 50, 31),
    },
    {
        name: 'building_centereast',
        label: 'the building just east of the town square (7x6 tiles)',
        tiles: tilesInSquare(18, 20, 24, 25),
    },
    // Partition of the land north of the river
    {
        name: 'field_northwest',
        label: 'the northwest half of the main field (29x23 tiles)',
        tiles: tilesInSquare(0, 0, 28, 22),
    },
    {
        name: 'field_northeast',
        label: 'the northeast half of the main field (31x23 tiles)',
        tiles: tilesInSquare(29, 0, 59, 22),
    },
    {
        name: 'field_southwest',
        label: 'the southwest half of the main field (29x12 tiles)',
        tiles: tilesInSquare(0, 23, 28, 34),
    },
    {
        name: 'field_southeast',
        label: 'the southeast half of the main field (31x12 tiles)',
        tiles: tilesInSquare(29, 23, 59, 34),
    },
    // Partition of the river
    {
        name: 'north_coast',
        label: 'the north coast of the river (60x1 tiles)',
        tiles: tilesInSquare(0, 35, 59, 35),
    },
    {
        name: 'river',
        label: 'the river (60x3 tiles)',
        tiles: tilesInSquare(0, 36, 59, 38),
    },
    {
        name: 'south_coast',
        label: 'the south coast of the river (60x1 tiles)',
        tiles: tilesInSquare(0, 39, 59, 39),
    },
    // South of the river
    {
        name: 'far_south_west_field',
        label: 'the far southwest field (29x10 tiles)',
        tiles: tilesInSquare(0, 40, 28, 49),
    },
    {
        name: 'far_south_east_field',
        label: 'the far southeast field (31x12 tiles)',
        tiles: tilesInSquare(29, 40, 59, 49),
    },
];

/** @type {Map<string, string>} Maps "x,y,z" tile keys to zone names (highest-priority zone wins). */
export const TILE_TO_ZONE = new Map();

export const FARM_ZONES = _rawZones.map((zone) => {
    const ownedTiles = zone.tiles.filter(([x, y]) => {
        const key = `${x},${y},0`;
        if (TILE_TO_ZONE.has(key)) return false;
        TILE_TO_ZONE.set(key, zone.name);
        return true;
    });
    return { ...zone, tiles: ownedTiles };
});

/** @type {Map<string, {name: string, label: string, tiles: [number,number][]}>} */
export const FARM_ZONES_BY_NAME = new Map(FARM_ZONES.map((z) => [z.name, z]));

/**
 * NPC spawn positions (tile centers). Each matches a home placed in {@link buildVillage}.
 * `homeX/homeY` on the NPC come from these coords for wander AI.
 */
export const NPC_DEFAULT_INVENTORY = [{ objType: Obj.UNCOOKED_STEAK, count: 1 }];

export const VILLAGE_NPC_SPAWNS = [
    // Finn — southwest stone house (6, 28)
    { name: 'Finn', preset: 1, x: 9.5, y: 30.5, z: 0 },
    // Elara — northwest cottage (6, 12)
    { name: 'Elara', preset: 2, x: 8.5, y: 15.5, z: 0 },
    // Mira — west of market square (18, 20)
    { name: 'Mira', preset: 4, x: 20.5, y: 23.5, z: 0 },
];
