/**
 * Wander brain — random walk near home, no memory or plans.
 */

import { moveToAction } from '../../../actors/npcActions.js';
import { isEntityActionComplete } from '../../../domain/entityActions.js';
import {
    applyHostAction,
    advanceHostLocomotion,
    destroyBrainLocomotionHost,
    initBrainLocomotionHost,
    isHostMoving,
} from '../../locomotion/brainLocomotionMixin.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */

/**
 * Simple wander brain — no memory, no plans, no task queue.
 * Picks a random walkable tile near home each time the previous journey ends.
 */
/** @implements {NpcBrain} */
export class WanderBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        initBrainLocomotionHost(this);
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /** @param {NpcEntity} npc @param {import('../../../domain/entityActions.js').EntityAction} action @param {World3D} world */
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
        if (isHostMoving(this, npc)) {
            return null;
        }
        if (npc.currentAction && !isEntityActionComplete(npc.currentAction, npc)) {
            return null;
        }

        const radius = npc.wanderRadius ?? 10;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            if (!world.isWalkable(gx, gy, npc.homeZ)) continue;
            return moveToAction(npc, gx, gy, npc.homeZ, { onto: true });
        }
        return null;
    }

    destroy() {
        destroyBrainLocomotionHost(this);
        this.npc = null;
    }
}
