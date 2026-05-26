/**
 * Wander brain — random walk near home, no memory or plans.
 */

import { isMoveAction, moveToAction } from '../../../actors/npcActions.js';
import { isEntityActionComplete } from '../../../domain/entityActions.js';
import {
    advanceBrainLocomotion,
    beginBrainMove,
    clearBrainLocomotion,
    createBrainLocomotion,
    isBrainLocomotionActive,
} from '../../locomotion/brainLocomotion.js';
import { planPathToTile } from '../../locomotion/pathUtils.js';

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
        /** @type {World3D | null} */
        this._world = null;
        /** @type {Generator<EntityAction | null, void, void> | null} */
        this._actionIter = null;
        this._locomotion = createBrainLocomotion();
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
        this._actionIter = this.wanderLoop(npc);
    }

    /**
     * @param {NpcEntity} npc
     * @returns {Generator<EntityAction | null, void, void>}
     */
    *wanderLoop(npc) {
        while (!npc._dead) {
            const world = this._world;
            if (!world) {
                yield null;
                continue;
            }

            const radius = npc.wanderRadius ?? 10;
            for (let attempt = 0; attempt < 10; attempt++) {
                const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
                const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
                if (!world.isWalkable(gx, gy, npc.homeZ)) continue;

                const path = planPathToTile(world, npc, gx, gy, npc.homeZ);
                if (!path || path.length < 2) continue;

                for (let i = 1; i < path.length; i++) {
                    const step = path[i];
                    yield moveToAction(npc, step.x, step.y, step.z);
                }
                break;
            }

            yield null;
        }
    }

    /** @param {NpcEntity} npc @param {EntityAction} action @param {World3D} world */
    applyAction(npc, action, world) {
        if (!isMoveAction(action)) {
            return action.apply(world);
        }
        if (isEntityActionComplete(action, npc)) {
            return true;
        }
        return beginBrainMove(this._locomotion, npc, action.goal, world);
    }

    /** @param {NpcEntity} npc @param {number} dt */
    advanceLocomotion(npc, dt) {
        if (!isBrainLocomotionActive(this._locomotion)) return;
        advanceBrainLocomotion(this._locomotion, npc, dt);
    }

    /**
     * @param {NpcEntity} npc
     * @returns {boolean}
     */
    _isBusy(npc) {
        if (isBrainLocomotionActive(this._locomotion)) return true;
        if (npc.resolvingAction && !isEntityActionComplete(npc.resolvingAction, npc)) {
            return true;
        }
        return false;
    }

    /**
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} _gameTime
     * @returns {EntityAction | null}
     */
    tick(world, _dt, _gameTime) {
        this._world = world;
        const npc = this.npc;
        if (!npc || npc._dead) return null;
        if (this._isBusy(npc)) return null;

        if (!this._actionIter) {
            this._actionIter = this.wanderLoop(npc);
        }

        const { value } = this._actionIter.next();
        return value ?? null;
    }

    destroy() {
        clearBrainLocomotion(this._locomotion);
        this._actionIter = null;
        this.npc = null;
        this._world = null;
    }
}
