/**
 * Entity sprite sheets and walk/work animation (client only).
 */
import { buildSpriteSheet } from './entitySprites.js';

/** @typedef {import('../actors/entity.js').EntityAppearance} EntityAppearance */

/** @type {Map<string, { sprites: Record<number, HTMLCanvasElement[]>, workSprites: Record<number, HTMLCanvasElement[]> }>} */
const sheetCache = new Map();

/** @type {WeakMap<object, { animTimer: number, animFrame: number, lastX?: number, lastY?: number }>} */
const animState = new WeakMap();

/**
 * @param {EntityAppearance} colors
 * @returns {string}
 */
function appearanceKey(colors) {
    return colors.join('|');
}

/**
 * @param {EntityAppearance} colors
 */
function getSheet(colors) {
    const key = appearanceKey(colors);
    if (!sheetCache.has(key)) {
        sheetCache.set(key, buildSpriteSheet(...colors));
    }
    return sheetCache.get(key);
}

/**
 * @param {import('../actors/entity.js').Entity} entity
 */
function getAnim(entity) {
    let state = animState.get(entity);
    if (!state) {
        state = { animTimer: 0, animFrame: 0 };
        animState.set(entity, state);
    }
    return state;
}

/**
 * Advance walk or work animation from sim state (position, timed actions).
 * @param {import('../actors/entity.js').Entity} entity
 * @param {number} dt
 */
export function tickEntityAppearance(entity, dt) {
    if (!entity.appearance) return;

    const state = getAnim(entity);
    const working = entity.timedAction?.isBusy?.() ?? false;

    if (working) {
        state.animTimer += dt;
        if (state.animTimer >= 0.28) {
            state.animTimer = 0;
            state.animFrame = 1 - state.animFrame;
        }
        state.lastX = entity.x;
        state.lastY = entity.y;
        return;
    }

    const moved =
        state.lastX != null &&
        state.lastY != null &&
        (Math.hypot(entity.x - state.lastX, entity.y - state.lastY) > 0.001);
    state.lastX = entity.x;
    state.lastY = entity.y;

    if (moved) {
        state.animTimer += dt;
        if (state.animTimer > 0.2) {
            state.animTimer = 0;
            state.animFrame = 1 - state.animFrame;
        }
    } else {
        state.animTimer = 0;
        state.animFrame = 0;
    }
}

/**
 * Current 16×16 sprite canvas for an entity, or null if no appearance.
 * @param {import('../actors/entity.js').Entity} entity
 * @returns {HTMLCanvasElement|null}
 */
export function getEntitySprite(entity) {
    const colors = entity.appearance;
    if (!colors) return null;

    const sheet = getSheet(colors);
    const dir = entity.dir;
    const state = getAnim(entity);
    const working = entity.timedAction?.isBusy?.() ?? false;

    if (working && sheet.workSprites?.[dir]) {
        return sheet.workSprites[dir][state.animFrame] ?? null;
    }
    return sheet.sprites[dir]?.[state.animFrame] ?? null;
}
