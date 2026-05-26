/**
 * NPC — Entity + village sim + pluggable brain.
 * For tests without AI, use createNpcEntity / tickNpcSimulation from npcSimulation.js.
 */
import { Entity } from './entity.js';
import { attachNpcBrain, WanderBrain } from '../npc/brain/index.js';
import {
    initNpcEntity,
    tickNpc,
    tickNpcSimulation,
    scheduleNpcAction,
    applyNpcAction,
    travelNpcToTile,
} from './npcSimulation.js';
export {
    createNpcEntity,
    initNpcEntity,
    tickNpc,
    tickNpcSimulation,
    scheduleNpcAction,
    applyNpcAction,
    travelNpcToTile,
    isNpcTraveling,
    runPickUpAtTile,
    NPC_PRESETS,
} from './npcSimulation.js';
export {
    moveDirectionAction,
    isMoveDirectionAction,
} from '../domain/entityActions.js';
export { tickEntityAction } from './actionExecutor.js';
export {
    attachNpcBrain,
    NoopNpcBrain,
    WanderBrain,
} from '../npc/brain/index.js';

/** @typedef {import('./npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../npc/brain/interface.js').NpcBrain} NpcBrain */

export class NPC extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} presetIndex
     * @param {string} name
     * @param {{ objType: number, count: number, buildingId?: number }[]} [inventory]
     * @param {{ brain?: NpcBrain }} [brainOpts]
     */
    constructor(x, y, z, presetIndex = 0, name = 'Villager', inventory = [], brainOpts = {}) {
        super(x, y, z);
        initNpcEntity(this, { presetIndex, name, inventory });
        const brain = brainOpts.brain ?? new WanderBrain();
        attachNpcBrain(/** @type {NpcEntity} */ (this), brain);
    }

    get isAlive() {
        return !this._dead;
    }
}
