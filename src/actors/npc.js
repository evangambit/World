/**
 * NPC — Entity + village sim + task/plan brain.
 * For tests without AI, use createNpcEntity / tickNpcSimulation from npcSimulation.js.
 */
import { Entity } from './entity.js';
import { pickUpAtTile } from '../domain/entityActions.js';
import { initNpcEntity, tickNpcSimulation } from './npcSimulation.js';
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
     */
    constructor(x, y, z, presetIndex = 0, name = 'Villager', inventory = []) {
        super(x, y, z);
        initNpcEntity(this, { presetIndex, name, inventory });
        this.tasks = new NPCTaskRunner(this);
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
        if (this._dead) return;
        this.tasks.update(world);
    }
}
