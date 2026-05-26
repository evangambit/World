/**
 * Wander brain — random walk near home, no memory or plans.
 */

import { moveDirectionAction } from '../../../domain/entityActions.js';
import {
    advancePathIndexAtWaypoint,
    directionTowardPoint,
    planPathToTile,
} from '../../locomotion/pathUtils.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */

/**
 * Simple wander brain — no memory, no plans, no task queue.
 * Picks a random walkable tile near home and returns moveDirection each tick.
 */
/** @implements {NpcBrain} */
export class WanderBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {World3D | null} */
        this._world = null;
        /** @type {{ x: number, y: number, z: number }[] | null} */
        this._path = null;
        /** @type {number} */
        this._pathIndex = 0;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /**
     * @param {NpcEntity} npc
     * @returns {boolean}
     */
    _pickNewPath(npc) {
        const world = this._world;
        if (!world) return false;

        const radius = npc.wanderRadius ?? 10;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            if (!world.isWalkable(gx, gy, npc.homeZ)) continue;

            const path = planPathToTile(world, npc, gx, gy, npc.homeZ);
            if (!path || path.length < 2) continue;

            this._path = path;
            this._pathIndex = 1;
            return true;
        }

        this._path = null;
        this._pathIndex = 0;
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
        if (!npc || !npc.isAlive) return null;
        if (npc.resolvingAction) return null;

        if (!this._path || this._pathIndex >= this._path.length) {
            if (!this._pickNewPath(npc)) return null;
        }

        this._pathIndex = advancePathIndexAtWaypoint(npc, this._path, this._pathIndex);
        if (this._pathIndex >= this._path.length) {
            this._path = null;
            this._pathIndex = 0;
            return null;
        }

        const wp = this._path[this._pathIndex];
        const { dx, dy } = directionTowardPoint(npc, wp.x + 0.5, wp.y + 0.5);
        return moveDirectionAction(npc, dx, dy);
    }

    destroy() {
        this._path = null;
        this._pathIndex = 0;
        this.npc = null;
        this._world = null;
    }
}
