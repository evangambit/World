/**
 * Timed world actions — registry and per-action rules.
 * Player and NPC runners call these; add new actions here.
 */
import { isAdjacentToTile } from './entityActions.js';
import { T, isClearableGrassTerrain } from '../world/tileTypes.js';

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
        complete(_entity, world, tx, ty, tz) {
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
