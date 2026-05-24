/**
 * NPC — Entity + village sim + pluggable brain.
 * For tests without AI, use createNpcEntity / tickNpcSimulation from npcSimulation.js.
 */
import { Entity } from './entity.js';
import { pickUpAtTile } from '../domain/entityActions.js';
import { attachNpcBrain, createDefaultTaskBrain } from '../npc/brain/index.js';
import { initNpcEntity, tickNpcSimulation } from './npcSimulation.js';
import {
    goTo,
    find,
    clearGrass,
    timedAction,
} from '../npc/npcTasks.js';

export { goTo, find, clearGrass, timedAction };
export { EAT_FOOD_PLAN } from '../npc/npcPlanTemplates.js';
export {
    createNpcEntity,
    initNpcEntity,
    tickNpcSimulation,
    NPC_PRESETS,
} from './npcSimulation.js';
export {
    attachNpcBrain,
    createTaskBrain,
    createDefaultTaskBrain,
    createWanderBrain,
    noopNpcBrain,
    NoopNpcBrain,
    NpcTaskBrain,
    WanderBrain,
} from '../npc/brain/index.js';

/** @typedef {import('./npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../npc/brain/interface.js').NpcBrain} NpcBrain */
/** @typedef {import('../npc/npcTasks.js').NPCTaskRunner} NPCTaskRunner */

export class NPC extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} presetIndex
     * @param {string} name
     * @param {{ objType: number, count: number, buildingId?: number }[]} [inventory]
     * @param {{ brain?: NpcBrain, planner?: import('../npc/llm/npcPlanner.js').NpcPlannerFn | null, plannerCooldownMs?: number }} [brainOpts]
     */
    constructor(x, y, z, presetIndex = 0, name = 'Villager', inventory = [], brainOpts = {}) {
        super(x, y, z);
        initNpcEntity(this, { presetIndex, name, inventory });
        const brain =
            brainOpts.brain ??
            createDefaultTaskBrain({
                planner: brainOpts.planner,
                plannerCooldownMs: brainOpts.plannerCooldownMs,
            });
        attachNpcBrain(/** @type {NpcEntity} */ (this), brain);
    }

    /** @returns {NPCTaskRunner | undefined} */
    get tasks() {
        return this.brain?.tasks;
    }

    get isAlive() {
        return !this._dead;
    }

    pickUpAt(tileX, tileY, tileZ, world) {
        return pickUpAtTile(this, world, tileX, tileY, tileZ);
    }

    /**
     * @param {import('../world/world.js').World3D} world
     * @param {number} dt
     * @param {number} [gameTime]
     */
    update(world, dt, gameTime = 0) {
        tickNpcSimulation(/** @type {NpcEntity} */ (this), world, dt);
        this.brain?.tick(world, dt, gameTime);
    }
}
