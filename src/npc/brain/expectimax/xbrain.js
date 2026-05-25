/**
 * Expectimax / experimental brain stub.
 */
import { moveToAction } from '../../../actors/npcActions.js';
import {
    applyHostAction,
    advanceHostLocomotion,
    destroyBrainLocomotionHost,
    initBrainLocomotionHost,
    isHostMoving,
} from '../../locomotion/brainLocomotionMixin.js';
import { initTileStore } from '../tileStore.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */

/** @implements {import('../interface.js').NpcBrain} */
export class XBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {string} */
        this._statusLine = 'Idle';
        initTileStore(this);
        initBrainLocomotionHost(this);
    }

    /** @returns {{ lines: string[] }} */
    getStatus() {
        return { lines: [this._statusLine] };
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /** @param {NpcEntity} npc @param {EntityAction} action @param {World3D} world */
    applyAction(npc, action, world) {
        return applyHostAction(this, npc, action, world);
    }

    /** @param {NpcEntity} npc @param {number} dt */
    advanceLocomotion(npc, dt) {
        advanceHostLocomotion(this, npc, dt);
    }

    /**
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} _gameTime
     * @returns {EntityAction | null}
     */
    tick(world, _dt, _gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead) return null;
        if (isHostMoving(this, npc)) return null;

        return moveToAction(npc, 0, 0, 0);
    }

    destroy() {
        destroyBrainLocomotionHost(this);
        this.npc = null;
        this._tileStore.clear();
    }
}
