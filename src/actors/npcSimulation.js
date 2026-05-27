/**
 * NPC body simulation — vitality, eating, death, and the action tick pipeline.
 */
import { tickVitality } from '../domain/vitality.js';
import {
    actionDuration,
    isAdjacentToTile,
    pickUpAction,
} from '../domain/entityActions.js';
import { tickEntityAction, tickEntityActionResult } from './actionExecutor.js';
import { Entity } from './entity.js';
import { attachNpcBrain } from '../npc/brain/attach.js';
import { tickNpcPerception } from '../npc/shared/npcMemory.js';

/** @typedef {import('../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../npc/brain/interface.js').NpcBrain} NpcBrain */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

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
 *   resolvingAction: EntityAction | null,
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
    /** @type {ActionExecutionResult | null} */
    entity._lastBrainActionResult = null;

    const loco = /** @type {NpcEntity} */ (entity);
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
function markNpcDead(entity) {
    if (entity._dead) return;
    entity._dead = true;
    entity.health = 0;
    entity.currentAction = null;
    entity.timedAction.cancel();
    entity.brain?.destroy?.();
}

/**
 * @param {NpcEntity} npc
 * @param {EntityAction} action
 * @param {World3D} world
 * @param {number} dt
 * @returns {boolean}
 */
export function applyNpcAction(npc, action, world, dt) {
    return tickEntityAction(npc, action, world, dt);
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
        throw new Error(`Pick up requires adjacency at (${tileX}, ${tileY}, ${tileZ})`);
    }
    if (!applyNpcAction(npc, pickUpAction(npc, tileX, tileY, tileZ), world, 0)) {
        throw new Error(`Pick up failed at (${tileX}, ${tileY}, ${tileZ})`);
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

    /** @type {EntityAction | null} */
    let applied = null;

    /** @type {number|null} */
    let actionProgress = null;
    if (entity.currentAction && actionDuration(entity.currentAction) > 0) {
        actionProgress = entity.timedAction.getProgress();
    }

    const visibleTiles = tickNpcPerception(entity, world, gameTime);
    const lastActionResult = entity._lastBrainActionResult ?? null;
    entity._lastBrainActionResult = null;
    const brainAction =
        entity.brain?.tick(world, dt, gameTime, actionProgress, visibleTiles, lastActionResult) ?? null;
    if (!entity.resolvingAction && brainAction) {
        entity._lastBrainActionResult = tickEntityActionResult(entity, brainAction, world, dt);
        applied = brainAction;
    }

    if (entity.timedAction.isBusy()) {
        entity.timedAction.tick(dt, world);
    }

    return applied;
}

