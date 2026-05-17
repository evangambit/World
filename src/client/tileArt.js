/**
 * Tile/object pixel-art pre-rendering (16×16 offscreen canvases).
 */
import { T, Obj, isWheatCropObject } from '../world/tileTypes.js';

// ── Color palette ──
const C = {
    grassA: '#4a8c2a', grassB: '#3d7a22', grassC: '#5a9c35',
    dirtA: '#8B6914', dirtB: '#7A5C11', dirtC: '#9C7A1E',
    stoneA: '#8a8a8a', stoneB: '#6e6e6e', stoneC: '#9e9e9e',
    waterA: '#2a6cb8', waterB: '#1e5ea0', waterC: '#3a7cd0',
    woodA: '#8B5E3C', woodB: '#7A4F30', woodC: '#9C6F48',
    sFloorA: '#5a5a5a', sFloorB: '#4a4a4a', sFloorC: '#6a6a6a',
    wallStoneA: '#6e6e6e', wallStoneB: '#555555', wallStoneC: '#7e7e7e',
    wallWoodA: '#6B4226', wallWoodB: '#5A3520', wallWoodC: '#7C5337',
    cliffA: '#5a5a4a', cliffB: '#4a4a3a', cliffC: '#6a6a5a',
    roofA: '#8B3A2A', roofB: '#7A2E20', roofC: '#9C4535',
    sandA: '#d4b86a', sandB: '#c4a85a', sandC: '#e0c878',
    doorA: '#5A3520', doorB: '#4A2810', doorC: '#3a3a3a',
    tallGrassA: '#3d8025', tallGrassB: '#357020', tallGrassC: '#4a9030',
};

// ── Seeded pseudo-random for deterministic tile patterns ──
function seededRand(seed) {
    let s = seed;
    return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

// ── Create a 16×16 offscreen canvas and return its context ──
function makeTile() {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 16;
    return { canvas: c, ctx: c.getContext('2d') };
}

function fill(ctx, color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 16, 16);
}

function px(ctx, x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
}

// ── Tile renderers ──
const tileRenderers = {
    [T.GRASS](ctx, seed) {
        fill(ctx, C.grassA);
        const r = seededRand(seed);
        for (let i = 0; i < 12; i++) {
            px(ctx, (r()*16)|0, (r()*16)|0, r()>0.5 ? C.grassB : C.grassC);
        }
        // Occasional flower
        if ((seed % 7) === 0) {
            const fx = 4 + (seed % 8), fy = 4 + ((seed*3) % 8);
            px(ctx, fx, fy, '#e8e040');
            px(ctx, fx+1, fy, '#e8e040');
        }
    },
    [T.TALL_GRASS](ctx, seed) {
        fill(ctx, C.tallGrassA);
        const r = seededRand(seed);
        for (let i = 0; i < 16; i++) {
            const gx = (r()*16)|0, gy = (r()*16)|0;
            px(ctx, gx, gy, r()>0.4 ? C.tallGrassB : C.tallGrassC);
        }
        // Grass blade tips
        for (let x = 1; x < 15; x += 3) {
            px(ctx, x, (seed + x) % 3, C.tallGrassC);
        }
    },
    [T.DIRT](ctx, seed) {
        fill(ctx, C.dirtA);
        const r = seededRand(seed);
        for (let i = 0; i < 10; i++) {
            px(ctx, (r()*16)|0, (r()*16)|0, r()>0.5 ? C.dirtB : C.dirtC);
        }
    },
    [T.STONE_PATH](ctx, seed) {
        fill(ctx, C.stoneB);
        // Cobblestone pattern
        const r = seededRand(seed);
        for (let by = 0; by < 16; by += 4) {
            const off = (by/4 % 2) * 4;
            for (let bx = off; bx < 16; bx += 8) {
                ctx.fillStyle = r() > 0.5 ? C.stoneA : C.stoneC;
                ctx.fillRect(bx+1, by+1, 6, 2);
            }
        }
    },
    [T.WATER](ctx, seed) {
        fill(ctx, C.waterA);
        const r = seededRand(seed);
        for (let i = 0; i < 6; i++) {
            const wx = (r()*14)|0, wy = (r()*14)|0;
            ctx.fillStyle = C.waterC;
            ctx.fillRect(wx, wy, 3, 1);
        }
    },
    [T.WOOD_FLOOR](ctx) {
        fill(ctx, C.woodA);
        // Horizontal planks
        for (let y = 0; y < 16; y += 4) {
            ctx.fillStyle = C.woodB;
            ctx.fillRect(0, y, 16, 1);
            ctx.fillStyle = C.woodC;
            ctx.fillRect(0, y+2, 16, 1);
        }
    },
    [T.STONE_FLOOR](ctx) {
        fill(ctx, C.sFloorA);
        ctx.fillStyle = C.sFloorB;
        // Grid mortar lines
        ctx.fillRect(0, 0, 16, 1);
        ctx.fillRect(0, 8, 16, 1);
        ctx.fillRect(0, 0, 1, 16);
        ctx.fillRect(8, 0, 1, 16);
        px(ctx, 4, 4, C.sFloorC);
        px(ctx, 12, 12, C.sFloorC);
    },
    [T.WALL_STONE](ctx, seed) {
        fill(ctx, C.wallStoneA);
        // Brick pattern
        for (let by = 0; by < 16; by += 4) {
            ctx.fillStyle = C.wallStoneB;
            ctx.fillRect(0, by, 16, 1);
            const off = (by / 4 % 2) * 5;
            for (let bx = off; bx < 16; bx += 10) {
                ctx.fillStyle = C.wallStoneB;
                ctx.fillRect(bx, by, 1, 4);
            }
        }
        // Highlight
        const r = seededRand(seed);
        for (let i = 0; i < 4; i++) {
            px(ctx, (r()*16)|0, (r()*16)|0, C.wallStoneC);
        }
    },
    [T.WALL_WOOD](ctx) {
        fill(ctx, C.wallWoodA);
        // Vertical planks
        for (let x = 0; x < 16; x += 4) {
            ctx.fillStyle = C.wallWoodB;
            ctx.fillRect(x, 0, 1, 16);
            ctx.fillStyle = C.wallWoodC;
            ctx.fillRect(x+2, 0, 1, 16);
        }
    },
    [T.CLIFF](ctx) {
        fill(ctx, C.cliffA);
        // Layered rock face
        for (let y = 0; y < 16; y += 3) {
            ctx.fillStyle = y % 6 === 0 ? C.cliffB : C.cliffC;
            ctx.fillRect(0, y, 16, 1);
        }
        // Shadow at top
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, 0, 16, 3);
    },
    [T.BRIDGE](ctx) {
        fill(ctx, '#00000000');
        ctx.clearRect(0, 0, 16, 16);
        // Wooden planks
        ctx.fillStyle = C.woodA;
        ctx.fillRect(2, 0, 12, 16);
        for (let y = 0; y < 16; y += 4) {
            ctx.fillStyle = C.woodB;
            ctx.fillRect(2, y, 12, 1);
        }
        // Rope railings
        ctx.fillStyle = '#8B7355';
        ctx.fillRect(1, 0, 1, 16);
        ctx.fillRect(14, 0, 1, 16);
    },
    [T.DOOR](ctx) {
        fill(ctx, C.woodA);
        // Door frame
        ctx.fillStyle = C.doorA;
        ctx.fillRect(0, 0, 16, 16);
        ctx.fillStyle = C.doorB;
        ctx.fillRect(2, 0, 12, 14);
        // Handle
        px(ctx, 11, 7, '#c4a265');
        px(ctx, 11, 8, '#c4a265');
    },
    [T.STAIRS_UP](ctx) {
        fill(ctx, C.stoneA);
        // Steps going "up" (lighter at top)
        for (let y = 0; y < 16; y += 4) {
            const brightness = 0.6 + 0.4 * (1 - y / 16);
            const g = Math.floor(138 * brightness);
            ctx.fillStyle = `rgb(${g},${g},${g})`;
            ctx.fillRect(1, y, 14, 3);
        }
        // Arrow indicator
        px(ctx, 7, 1, '#e0d8c0');
        px(ctx, 8, 1, '#e0d8c0');
        px(ctx, 6, 2, '#e0d8c0');
        px(ctx, 9, 2, '#e0d8c0');
    },
    [T.STAIRS_DOWN](ctx) {
        fill(ctx, C.stoneA);
        for (let y = 0; y < 16; y += 4) {
            const brightness = 0.4 + 0.4 * (y / 16);
            const g = Math.floor(138 * brightness);
            ctx.fillStyle = `rgb(${g},${g},${g})`;
            ctx.fillRect(1, y, 14, 3);
        }
        px(ctx, 7, 14, '#e0d8c0');
        px(ctx, 8, 14, '#e0d8c0');
        px(ctx, 6, 13, '#e0d8c0');
        px(ctx, 9, 13, '#e0d8c0');
    },
    [T.ROOF](ctx, seed) {
        fill(ctx, C.roofA);
        // Overlapping shingle pattern
        for (let y = 0; y < 16; y += 3) {
            const off = (y / 3 % 2) * 4;
            for (let x = off; x < 16; x += 8) {
                ctx.fillStyle = C.roofB;
                ctx.fillRect(x, y, 1, 3);
                ctx.fillStyle = C.roofC;
                px(ctx, x + 3, y + 1);
            }
        }
    },
    [T.SAND](ctx, seed) {
        fill(ctx, C.sandA);
        const r = seededRand(seed);
        for (let i = 0; i < 8; i++) {
            px(ctx, (r()*16)|0, (r()*16)|0, r()>0.5 ? C.sandB : C.sandC);
        }
    },
};

// ── Object renderers (drawn on top of terrain) ──
const objectRenderers = {
    [Obj.TREE](ctx) {
        // Trunk
        ctx.fillStyle = '#5A3A1A';
        ctx.fillRect(6, 10, 4, 6);
        // Canopy layers
        ctx.fillStyle = '#2d6e1e';
        ctx.fillRect(2, 2, 12, 9);
        ctx.fillStyle = '#3a8a28';
        ctx.fillRect(3, 3, 10, 7);
        ctx.fillStyle = '#4a9a35';
        ctx.fillRect(5, 1, 6, 4);
    },
    [Obj.ROCK](ctx) {
        ctx.fillStyle = '#7a7a7a';
        ctx.fillRect(3, 6, 10, 8);
        ctx.fillStyle = '#8a8a8a';
        ctx.fillRect(4, 5, 8, 7);
        ctx.fillStyle = '#9a9a9a';
        ctx.fillRect(5, 6, 4, 3);
    },
    [Obj.BUSH](ctx) {
        ctx.fillStyle = '#3a7a22';
        ctx.fillRect(2, 6, 12, 8);
        ctx.fillStyle = '#4a8a30';
        ctx.fillRect(3, 5, 10, 7);
        ctx.fillStyle = '#5a9a3a';
        ctx.fillRect(5, 7, 3, 2);
    },
    [Obj.FLOWER](ctx) {
        // Stem
        ctx.fillStyle = '#3a7a22';
        ctx.fillRect(7, 8, 2, 6);
        // Petals
        ctx.fillStyle = '#e84080';
        ctx.fillRect(5, 5, 6, 4);
        ctx.fillStyle = '#f0e040';
        ctx.fillRect(7, 6, 2, 2);
    },
    [Obj.TABLE](ctx) {
        ctx.fillStyle = C.woodA;
        ctx.fillRect(2, 5, 12, 8);
        ctx.fillStyle = C.woodB;
        ctx.fillRect(3, 6, 10, 6);
        // Legs
        ctx.fillStyle = C.woodB;
        ctx.fillRect(3, 13, 2, 2);
        ctx.fillRect(11, 13, 2, 2);
    },
    [Obj.CHAIR](ctx) {
        ctx.fillStyle = C.woodA;
        ctx.fillRect(4, 8, 8, 6);
        // Back
        ctx.fillStyle = C.woodB;
        ctx.fillRect(4, 3, 8, 5);
        ctx.fillStyle = C.woodC;
        ctx.fillRect(5, 4, 6, 3);
    },
    [Obj.BED](ctx) {
        // Frame
        ctx.fillStyle = C.woodA;
        ctx.fillRect(1, 2, 14, 13);
        // Blanket
        ctx.fillStyle = '#3a4a8a';
        ctx.fillRect(2, 6, 12, 8);
        // Pillow
        ctx.fillStyle = '#e0d8c0';
        ctx.fillRect(3, 3, 10, 3);
    },
    [Obj.BARREL](ctx) {
        ctx.fillStyle = '#6B4226';
        ctx.fillRect(4, 4, 8, 10);
        ctx.fillStyle = '#5A3520';
        ctx.fillRect(3, 5, 10, 8);
        // Metal bands
        ctx.fillStyle = '#8a8a8a';
        ctx.fillRect(3, 6, 10, 1);
        ctx.fillRect(3, 10, 10, 1);
    },
    [Obj.CRATE](ctx) {
        ctx.fillStyle = C.woodA;
        ctx.fillRect(3, 4, 10, 10);
        ctx.fillStyle = C.woodB;
        ctx.fillRect(3, 4, 10, 1);
        ctx.fillRect(3, 4, 1, 10);
        ctx.fillRect(8, 4, 1, 10);
    },
    [Obj.SIGN](ctx) {
        // Post
        ctx.fillStyle = '#5A3A1A';
        ctx.fillRect(7, 8, 2, 8);
        // Board
        ctx.fillStyle = C.woodA;
        ctx.fillRect(2, 3, 12, 6);
        ctx.fillStyle = C.woodB;
        ctx.fillRect(3, 4, 10, 4);
    },
    [Obj.WELL](ctx) {
        ctx.fillStyle = '#6e6e6e';
        ctx.fillRect(3, 4, 10, 10);
        ctx.fillStyle = '#5a5a5a';
        ctx.fillRect(4, 5, 8, 8);
        // Water inside
        ctx.fillStyle = C.waterA;
        ctx.fillRect(5, 6, 6, 6);
        // Roof posts
        ctx.fillStyle = '#5A3A1A';
        ctx.fillRect(3, 1, 2, 4);
        ctx.fillRect(11, 1, 2, 4);
        // Roof
        ctx.fillStyle = C.roofA;
        ctx.fillRect(2, 0, 12, 2);
    },
    [Obj.LAMP](ctx) {
        // Post
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(7, 6, 2, 10);
        // Lamp head
        ctx.fillStyle = '#c4a265';
        ctx.fillRect(5, 3, 6, 4);
        // Glow
        ctx.fillStyle = '#f0e040';
        ctx.fillRect(6, 4, 4, 2);
    },
    [Obj.CHEST](ctx) {
        // Body
        ctx.fillStyle = C.woodB;
        ctx.fillRect(3, 7, 10, 8);
        ctx.fillStyle = C.woodA;
        ctx.fillRect(3, 7, 10, 2);
        // Lid
        ctx.fillStyle = C.woodC;
        ctx.fillRect(2, 4, 12, 4);
        ctx.fillStyle = '#5A3520';
        ctx.fillRect(2, 7, 12, 1);
        // Metal bands + lock
        ctx.fillStyle = '#8a8a8a';
        ctx.fillRect(3, 4, 10, 1);
        ctx.fillRect(3, 10, 10, 1);
        ctx.fillRect(7, 5, 2, 3);
        px(ctx, 7, 6, '#e8d8a8');
        px(ctx, 8, 6, '#e8d8a8');
    },
    [Obj.KEY](ctx) {
        // Bow — brass ring (solid frame + clear center reads as a handle hole)
        ctx.fillStyle = '#a88430';
        ctx.fillRect(2, 6, 5, 5);
        ctx.clearRect(3, 7, 3, 3);
        ctx.fillStyle = '#7a6020';
        px(ctx, 2, 6, '#5a4810');
        px(ctx, 6, 6, '#5a4810');
        px(ctx, 2, 10, '#5a4810');
        px(ctx, 6, 10, '#5a4810');

        // Shaft
        ctx.fillStyle = '#d4b050';
        ctx.fillRect(7, 8, 7, 2);
        ctx.fillStyle = '#f5e8b8';
        ctx.fillRect(8, 8, 4, 1);

        // Bit — small wards at the tip (classic key silhouette)
        ctx.fillStyle = '#8a7020';
        ctx.fillRect(14, 8, 2, 2);
        ctx.fillRect(13, 10, 4, 1);
        ctx.fillRect(14, 11, 2, 2);
        ctx.fillRect(15, 12, 1, 1);
    },
    [Obj.STOVE](ctx) {
        ctx.fillStyle = '#4a4a4a';
        ctx.fillRect(3, 4, 10, 11);
        ctx.fillStyle = '#5a5a5a';
        ctx.fillRect(4, 5, 8, 9);
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(5, 6, 3, 3);
        ctx.fillRect(9, 6, 3, 3);
        ctx.fillStyle = '#8a2020';
        ctx.fillRect(6, 7, 1, 1);
        ctx.fillRect(10, 7, 1, 1);
        ctx.fillStyle = '#6a6a6a';
        ctx.fillRect(2, 14, 12, 2);
    },
    [Obj.UNCOOKED_STEAK](ctx) {
        ctx.fillStyle = '#c45a6a';
        ctx.fillRect(4, 6, 8, 7);
        ctx.fillStyle = '#d86a7a';
        ctx.fillRect(5, 7, 6, 5);
        ctx.fillStyle = '#f0e8d8';
        ctx.fillRect(6, 8, 4, 2);
        ctx.fillStyle = '#9a3a4a';
        ctx.fillRect(4, 11, 8, 1);
    },
    [Obj.STEAK](ctx) {
        ctx.fillStyle = '#6a3a1a';
        ctx.fillRect(4, 6, 8, 7);
        ctx.fillStyle = '#8a4a22';
        ctx.fillRect(5, 7, 6, 5);
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(6, 9, 1, 2);
        ctx.fillRect(9, 8, 1, 3);
        ctx.fillStyle = '#4a3018';
        ctx.fillRect(4, 11, 8, 1);
    },
    [Obj.WHEAT](ctx) {
        ctx.fillStyle = '#c4a035';
        ctx.fillRect(5, 4, 6, 10);
        ctx.fillStyle = '#d8b848';
        ctx.fillRect(6, 5, 4, 8);
        ctx.fillStyle = '#8a7020';
        ctx.fillRect(4, 12, 8, 2);
        ctx.fillStyle = '#e8d060';
        ctx.fillRect(6, 3, 1, 3);
        ctx.fillRect(9, 3, 1, 3);
        ctx.fillRect(7, 2, 2, 2);
    },
    [Obj.WHEAT_SEED](ctx) {
        ctx.fillStyle = '#6a5028';
        ctx.fillRect(4, 8, 8, 5);
        ctx.fillStyle = '#8a6840';
        for (let i = 0; i < 6; i++) {
            px(ctx, 5 + (i % 3) * 2, 9 + Math.floor(i / 3) * 2, '#a07848');
        }
        ctx.fillStyle = '#4a3818';
        ctx.fillRect(3, 12, 10, 2);
    },
};

/** @param {CanvasRenderingContext2D} ctx @param {number} stage 0–3 */
function drawWheatCropStage(ctx, stage) {
    const stem = '#4a8a28';
    const stemHi = '#5a9a35';
    const head = '#c4a035';
    const headHi = '#e0c050';
    if (stage <= 0) {
        px(ctx, 7, 12, stem);
        px(ctx, 8, 11, stemHi);
        px(ctx, 7, 11, stem);
    } else if (stage === 1) {
        ctx.fillStyle = stem;
        ctx.fillRect(7, 8, 2, 6);
        ctx.fillStyle = stemHi;
        ctx.fillRect(7, 6, 2, 3);
        px(ctx, 6, 9, stemHi);
        px(ctx, 9, 10, stem);
    } else if (stage === 2) {
        ctx.fillStyle = stem;
        ctx.fillRect(6, 4, 2, 10);
        ctx.fillRect(9, 5, 2, 9);
        ctx.fillStyle = stemHi;
        ctx.fillRect(6, 3, 2, 3);
        ctx.fillRect(9, 4, 2, 2);
        ctx.fillStyle = '#6a9a40';
        ctx.fillRect(5, 7, 1, 3);
        ctx.fillRect(10, 8, 1, 2);
    } else {
        ctx.fillStyle = stem;
        ctx.fillRect(5, 2, 2, 12);
        ctx.fillRect(8, 3, 2, 11);
        ctx.fillRect(11, 4, 2, 10);
        ctx.fillStyle = head;
        ctx.fillRect(4, 1, 4, 4);
        ctx.fillRect(7, 0, 4, 5);
        ctx.fillRect(10, 1, 4, 4);
        ctx.fillStyle = headHi;
        px(ctx, 5, 1, headHi);
        px(ctx, 8, 0, headHi);
        px(ctx, 11, 1, headHi);
    }
}

objectRenderers[Obj.WHEAT_CROP] = (ctx, stage = 0) => {
    drawWheatCropStage(ctx, stage);
};

// ── Tile cache: pre-rendered canvases ──
const tileCache = new Map();
const objCache = new Map();

/**
 * Get a pre-rendered 16×16 canvas for a tile type.
 * @param {number} tileType - T.* constant
 * @param {number} seed - position-based seed for variation
 * @returns {HTMLCanvasElement}
 */
export function getTileCanvas(tileType, seed = 0) {
    const key = `${tileType}_${seed}`;
    if (tileCache.has(key)) return tileCache.get(key);

    const { canvas, ctx } = makeTile();
    const renderer = tileRenderers[tileType];
    if (renderer) renderer(ctx, seed);
    tileCache.set(key, canvas);
    return canvas;
}

/**
 * Get a pre-rendered 16×16 canvas for an object type.
 * @param {number} objType - Obj.* constant
 * @param {number} [variant] - e.g. wheat crop stage 0–3
 * @returns {HTMLCanvasElement}
 */
export function getObjCanvas(objType, variant = 0) {
    const key = isWheatCropObject(objType) ? `${objType}_${variant}` : String(objType);
    if (objCache.has(key)) return objCache.get(key);

    const { canvas, ctx } = makeTile();
    const renderer = objectRenderers[objType];
    if (renderer) renderer(ctx, variant);
    objCache.set(key, canvas);
    return canvas;
}
