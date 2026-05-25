/**
 * NPC body simulation — vitality, eating, movement, death.
 * No task queue or plans; safe to import from headless tests.
 */
import { tickVitality, tryEatFromInventoryIfHungry } from '../domain/vitality.js';
import {
    clearNpcLocomotion,
    initNpcLocomotion,
    tickNpcLocomotion,
    isAtMoveGoal,
} from './npcLocomotion.js';
import {
    actionDuration,
    isAdjacentToTile,
    isEntityActionComplete,
    pickUpAction,
} from '../domain/entityActions.js';
import { moveToAction } from './npcActions.js';
import { Entity } from './entity.js';
import { attachNpcBrain } from '../npc/brain/attach.js';

/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */

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

/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('./npcLocomotion.js').NpcLocomotionState} NpcLocomotionState */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../npc/brain/interface.js').NpcBrain} NpcBrain */

/**
 * Entity with NPC village fields (optional brain).
 * @typedef {Entity & NpcLocomotionState & {
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

    initNpcLocomotion(/** @type {Entity & NpcLocomotionState} */ (entity));

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
    clearNpcLocomotion(entity);
    entity.brain?.destroy?.();
}

/**
 * Queue an action for the next NPC tick (async tasks after travel, etc.).
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
 * Apply an NPC action: interrupts in-progress timed work, sets currentAction.
 * @param {NpcEntity} npc
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {boolean}
 */
export function applyNpcAction(npc, action, world) {
    if (npc.timedAction.isBusy()) {
        npc.timedAction.cancel();
    }
    npc.currentAction = action;
    const ok = action.apply(world);
    if (!ok) {
        npc.currentAction = null;
        if (npc._trip) {
            const { reject } = npc._trip;
            npc._trip = null;
            reject(new Error('action failed'));
        }
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
    if (npc._trip) {
        const { resolve } = npc._trip;
        npc._trip = null;
        resolve();
    }
}

/**
 * @param {NpcEntity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {World3D} world
 * @param {{ onto?: boolean }} [opts] - default `{ onto: true }` for exact tile (legacy travel)
 * @returns {Promise<void>}
 */
export function travelNpcToTile(npc, tx, ty, tz, world, opts = {}) {
    const onto = opts.onto !== false;

    if (npc._dead) {
        return Promise.reject(new Error('dead'));
    }
    if (npc._trip) {
        npc._trip.reject(new Error('travel superseded'));
        npc._trip = null;
    }

    if (isAtMoveGoal(npc, tx, ty, tz, onto)) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        npc._trip = { x: tx, y: ty, z: tz, onto, resolve, reject };
        scheduleNpcAction(npc, moveToAction(npc, tx, ty, tz, { onto }));
    });
}

/**
 * Travel adjacent if needed, then apply pickup.
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
 * Locomotion + pending actions only (no brain). For tests and memory-ref travel drivers.
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
        tickNpcLocomotion(entity, dt);
        finishNpcCurrentAction(entity);
    }
}

/**
 * Per-frame NPC tick: brain/pending action first (with interrupt), then body sim.
 * @param {NpcEntity} entity
 * @param {World3D} world
 * @param {number} dt
 * @param {number} gameTime
 * @returns {EntityAction | null} action applied this frame, if any
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
        tickNpcLocomotion(entity, dt);
        finishNpcCurrentAction(entity);
    }

    return applied;
}

/**
 * Vitality, timed actions, path following — no brain. Prefer tickNpc in the sim loop.
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
    } else {
        tickNpcLocomotion(entity, dt);
    }
}
