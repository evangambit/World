/**
 * Timed world actions — registry and per-action rules.
 * Player and NPC runners call these; add new actions here.
 */
import { isAdjacentStepToTile, isAdjacentToTile, mergeStackInto } from './entityActions.js';
import { T, Obj, isClearableGrassTerrain } from '../world/tileTypes.js';

/** @typedef {import('../actors/entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {{ ok: true } | { ok: false, message: string }} ActionCheck */

/**
 * @typedef {Object} TimedActionDef
 * @property {number} duration - seconds
 * @property {string} label - UI label while in progress
 * @property {(entity: Entity, world: World3D, tx: number, ty: number, tz: number) => ActionCheck} canStart
 * @property {(entity: Entity, world: World3D, tx: number, ty: number, tz: number) => void} complete
 */

/** @type {Record<string, TimedActionDef>} */
export const TIMED_ACTIONS = {
    move_to_tile: {
        duration: 0.3,
        label: 'Moving',
        canStart(entity, world, tx, ty, tz) {
            if (tz !== entity.z) return { ok: false, message: 'Wrong floor' };
            if (!isAdjacentStepToTile(entity, tx, ty)) {
                return { ok: false, message: 'Tile must be adjacent' };
            }
            if (!world.isWalkable(tx, ty, tz)) {
                return { ok: false, message: 'Tile is not walkable' };
            }
            return { ok: true };
        },
        complete(entity, _world, tx, ty, _tz) {
            entity.x = tx + 0.5;
            entity.y = ty + 0.5;
        },
    },
    clear_grass: {
        duration: 5,
        label: 'Clearing grass',
        canStart(entity, world, tx, ty, tz) {
            if (tz !== entity.z) return { ok: false, message: 'Wrong floor' };
            if (!isAdjacentToTile(entity, tx, ty)) {
                return { ok: false, message: 'Too far away' };
            }
            const tile = world.getTile(tx, ty, tz);
            if (!tile) return { ok: false, message: 'Nothing here' };
            if (tile.obj) return { ok: false, message: 'Tile is blocked' };
            if (!isClearableGrassTerrain(tile.terrain)) {
                return { ok: false, message: 'No grass to clear' };
            }
            return { ok: true };
        },
        complete(entity, world, tx, ty, tz) {
            const tile = world.getTile(tx, ty, tz);
            if (tile?.terrain === T.TALL_GRASS) {
                const seeds = 1 + Math.floor(Math.random() * 2);
                if (!entity.inventory) entity.inventory = [];
                mergeStackInto(entity.inventory, Obj.WHEAT_SEED, seeds);
            }
            world.setTile(tx, ty, tz, { terrain: T.DIRT });
        },
    },
};

/**
 * @param {string} actionId
 * @returns {TimedActionDef | null}
 */
export function getTimedAction(actionId) {
    return TIMED_ACTIONS[actionId] ?? null;
}
