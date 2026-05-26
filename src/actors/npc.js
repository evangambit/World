/**
 * NPC — Entity + village sim + pluggable brain.
 * For tests without AI, use createNpcEntity / tickNpcSimulation from npcSimulation.js.
 */
import { Entity } from './entity.js';
import { attachNpcBrain, ThomasBrain } from '../npc/brain/index.js';
import {
    initNpcEntity,
    tickNpc,
    tickNpcSimulation,
    scheduleNpcAction,
    applyNpcAction,
    travelNpcToTile,
} from './npcSimulation.js';
import { moveToAction, travelToTileAction } from './npcActions.js';

export {
    createNpcEntity,
    initNpcEntity,
    tickNpc,
    tickNpcSimulation,
    scheduleNpcAction,
    applyNpcAction,
    travelNpcToTile,
    runPickUpAtTile,
    NPC_PRESETS,
} from './npcSimulation.js';
export { moveToAction, travelToTileAction } from './npcActions.js';
export {
    attachNpcBrain,
    NoopNpcBrain,
    WanderBrain,
    ThomasBrain,
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
        const brain = brainOpts.brain ?? new ThomasBrain();
        attachNpcBrain(/** @type {NpcEntity} */ (this), brain);
    }

    get isAlive() {
        return !this._dead;
    }
}
