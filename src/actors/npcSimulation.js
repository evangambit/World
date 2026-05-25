/**
 * NPC body simulation — vitality, eating, death, and the action tick pipeline.
 */
import { tickVitality } from '../domain/vitality.js';
import {
    actionDuration,
    isAdjacentToTile,
    isEntityActionComplete,
    pickUpAction,
} from '../domain/entityActions.js';
import { isMoveAction, moveToAction } from './npcActions.js';
import { isAtMoveGoal } from '../npc/locomotion/pathUtils.js';
import { Entity } from './entity.js';
import { attachNpcBrain } from '../npc/brain/attach.js';

/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../npc/brain/interface.js').NpcBrain} NpcBrain */

/** NPC appearance presets (skin, hair, shirt, pants). */
export const NPC_PRESETS = [
    ['#e8c090', '#8B4513', '#8B2252', '#4a4a3a'],
    ['#d4a070', '#2a2a2a', '#2a6e2a', '#5a4a3a'],
    ['#e8c090', '#c4a265', '#6a4a8a', '#3a3a5a'],
    ['#c49060', '#1a1a1a', '#8a6a2a', '#4a3a2a'],
    ['#e8c090', '#aa4444', '#3a5a7a', '#3a3a4a'],
    ['#d4a070', '#e0c080', '#7a2a2a', '#4a4a4a'],
    ['#e8c090', '#5a3a2a', '#5a7a5a', '#4a4a3a'],
    ['#c49060', '#3a3a3a', '#aa8a40', '#3a3020'],
];

/**
 * Entity with NPC village fields (optional brain).
 * @typedef {Entity & {
 *   name: string,
 *   homeX: number,
 *   homeY: number,
 *   homeZ: number,
 *   wanderRadius: number,
 *   isAlive: boolean,
 *   brain?: NpcBrain,
 *   tick: (world: World3D, dt: number, gameTime: number) => EntityAction | null,
 *   scheduleAction: (action: EntityAction) => void,
 *   _pendingAction: EntityAction | null,
 * }} NpcEntity
 */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {object} [opts]
 * @param {number} [opts.presetIndex]
 * @param {string} [opts.name]
 * @param {{ objType: number, count: number, buildingId?: number }[]} [opts.inventory]
 * @param {NpcBrain} [opts.brain]
 * @returns {NpcEntity}
 */
export function createNpcEntity(x, y, z, opts = {}) {
    const entity = new Entity(x, y, z);
    initNpcEntity(entity, opts);
    return /** @type {NpcEntity} */ (entity);
}

/**
 * @param {Entity} entity
 * @param {object} [opts]
 * @param {number} [opts.presetIndex]
 * @param {string} [opts.name]
 * @param {{ objType: number, count: number, buildingId?: number }[]} [opts.inventory]
 * @param {NpcBrain} [opts.brain]
 */
export function initNpcEntity(entity, opts = {}) {
    const {
        presetIndex = 0,
        name = 'Villager',
        inventory = [],
        brain,
    } = opts;

    entity.speed = 2.0;
    entity.name = name;
    entity.appearance = NPC_PRESETS[presetIndex % NPC_PRESETS.length];
    entity.inventory = inventory.map((s) => ({ ...s }));
    entity._dead = false;
    entity.homeX = Math.floor(entity.x);
    entity.homeY = Math.floor(entity.y);
    entity.homeZ = entity.z;
    entity.wanderRadius = 10;

    const loco = /** @type {NpcEntity} */ (entity);
    loco._pendingAction = null;
    loco.scheduleAction = (action) => scheduleNpcAction(loco, action);
    loco.tick = (world, dt, gameTime) => tickNpc(loco, world, dt, gameTime);

    Object.defineProperty(entity, 'isAlive', {
        get() {
            return !this._dead;
        },
        configurable: true,
    });

    if (brain) {
        attachNpcBrain(loco, brain);
    }
}

/**
 * @param {NpcEntity} entity
 */
export function markNpcDead(entity) {
    if (entity._dead) return;
    entity._dead = true;
    entity.health = 0;
    entity.currentAction = null;
    entity._pendingAction = null;
    entity.timedAction.cancel();
    entity.brain?.destroy?.();
}

/**
 * @param {NpcEntity} npc
 * @param {EntityAction} action
 */
export function scheduleNpcAction(npc, action) {
    npc._pendingAction = action;
}

/**
 * @param {NpcEntity} npc
 * @returns {EntityAction | null}
 */
function takePendingNpcAction(npc) {
    const action = npc._pendingAction ?? null;
    npc._pendingAction = null;
    return action;
}

/**
 * @param {NpcEntity} npc
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {boolean}
 */
export function applyNpcAction(npc, action, world) {
    if (npc.timedAction.isBusy()) {
        npc.timedAction.cancel();
    }

    if (isMoveAction(action)) {
        npc.currentAction = action;
        const ok = npc.brain?.applyAction?.(npc, action, world) ?? false;
        if (!ok) {
            npc.currentAction = null;
            return false;
        }
        if (isEntityActionComplete(action, npc)) {
            npc.currentAction = null;
        }
        return true;
    }

    npc.currentAction = action;
    const ok = action.apply(world);
    if (!ok) {
        npc.currentAction = null;
        return false;
    }
    if (isEntityActionComplete(action, npc)) {
        npc.currentAction = null;
    } else if (actionDuration(action) > 0 && !npc.timedAction.isBusy()) {
        npc.currentAction = null;
    }
    return true;
}

/**
 * @param {NpcEntity} npc
 */
function finishNpcCurrentAction(npc) {
    if (!npc.currentAction) return;
    if (!isEntityActionComplete(npc.currentAction, npc)) return;
    npc.currentAction = null;
}

/**
 * @param {NpcEntity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {World3D} world
 * @param {{ onto?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function travelNpcToTile(npc, tx, ty, tz, world, opts = {}) {
    if (!npc.brain?.travelToTile) {
        return Promise.reject(new Error('NPC has no brain that supports travel'));
    }
    const onto = opts.onto !== false;
    if (isAtMoveGoal(npc, { tx, ty, tz, onto })) {
        return Promise.resolve();
    }
    const promise = npc.brain.travelToTile(npc, tx, ty, tz, world, opts);
    scheduleNpcAction(npc, moveToAction(npc, tx, ty, tz, { onto }));
    return promise;
}

/**
 * @param {NpcEntity} npc
 * @param {World3D} world
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} [tileZ]
 * @returns {Promise<void>}
 */
export async function runPickUpAtTile(npc, world, tileX, tileY, tileZ = npc.z) {
    if (!isAdjacentToTile(npc, tileX, tileY) || npc.z !== tileZ) {
        await travelNpcToTile(npc, tileX, tileY, tileZ, world, { onto: false });
    }
    if (!applyNpcAction(npc, pickUpAction(npc, tileX, tileY, tileZ), world)) {
        throw new Error(`Pick up failed at (${tileX}, ${tileY}, ${tileZ})`);
    }
}

/**
 * @param {NpcEntity} entity
 * @param {World3D} world
 * @param {number} dt
 */
export function tickNpcLocomotionFrame(entity, world, dt) {
    if (entity._dead) return;

    let pending;
    while ((pending = takePendingNpcAction(entity))) {
        applyNpcAction(entity, pending, world);
    }

    if (entity.timedAction.isBusy()) {
        entity.timedAction.tick(dt, world);
    } else {
        entity.brain?.advanceLocomotion?.(entity, dt);
        finishNpcCurrentAction(entity);
    }
}

/**
 * @param {NpcEntity} entity
 * @param {World3D} world
 * @param {number} dt
 * @param {number} gameTime
 * @returns {EntityAction | null}
 */
export function tickNpc(entity, world, dt, gameTime) {
    if (entity._dead) return null;

    tickVitality(entity, dt);
    if (entity.health <= 0) {
        markNpcDead(entity);
        return null;
    }

    const brainAction = entity.brain?.tick(world, dt, gameTime) ?? null;
    /** @type {EntityAction | null} */
    let applied = null;
    if (brainAction) {
        applyNpcAction(entity, brainAction, world);
        applied = brainAction;
    }
    let pending;
    while ((pending = takePendingNpcAction(entity))) {
        applyNpcAction(entity, pending, world);
        applied = pending;
    }

    if (entity.timedAction.isBusy()) {
        entity.timedAction.tick(dt, world);
    } else {
        entity.brain?.advanceLocomotion?.(entity, dt);
        finishNpcCurrentAction(entity);
    }

    return applied;
}

/**
 * Vitality and timed actions only — no brain locomotion.
 * @param {NpcEntity} entity
 * @param {World3D} world
 * @param {number} dt
 */
export function tickNpcSimulation(entity, world, dt) {
    if (entity._dead) return;

    tickVitality(entity, dt);

    if (entity.health <= 0) {
        markNpcDead(entity);
        return;
    }

    if (entity.timedAction.isBusy()) {
        entity.timedAction.tick(dt, world);
    }
}
