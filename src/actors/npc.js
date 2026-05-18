/**
 * NPC — Entity + village sim + task/plan brain.
 * For tests without AI, use createNpcEntity / tickNpcSimulation from npcSimulation.js.
 */
import { Entity } from './entity.js';
import { pickUpAtTile } from '../domain/entityActions.js';
import { tickNpcTaskBrain } from '../npc/npcBrain.js';
import { initNpcEntity, tickNpcSimulation } from './npcSimulation.js';
import { mockRequestPlan } from '../npc/llm/mockPlanner.js';
import {
    NPCTaskRunner,
    goTo,
    find,
    clearGrass,
    timedAction,
} from '../npc/npcTasks.js';

export { goTo, find, clearGrass, timedAction };
export { EAT_FOOD_PLAN } from '../npc/npcPlanTemplates.js';
export { createNpcEntity, initNpcEntity, tickNpcSimulation, NPC_PRESETS } from './npcSimulation.js';

/** @typedef {import('./npcSimulation.js').NpcEntity} NpcEntity */

export class NPC extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} presetIndex
     * @param {string} name
     * @param {{ objType: number, count: number, buildingId?: number }[]} [inventory]
     * @param {{ planner?: import('../npc/llm/npcPlanner.js').NpcPlannerFn | null, plannerCooldownMs?: number }} [brainOpts]
     */
    constructor(x, y, z, presetIndex = 0, name = 'Villager', inventory = [], brainOpts = {}) {
        super(x, y, z);
        initNpcEntity(this, { presetIndex, name, inventory });
        const planner = brainOpts.planner === undefined ? mockRequestPlan : brainOpts.planner;
        this.tasks = new NPCTaskRunner(this, {
            planner: planner ?? undefined,
            plannerCooldownMs: brainOpts.plannerCooldownMs,
        });
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
     */
    update(world, dt) {
        tickNpcSimulation(/** @type {NpcEntity} */ (this), world, dt);
        tickNpcTaskBrain(/** @type {NpcEntity} */ (this), world, dt);
    }
}
