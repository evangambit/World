/**
 * Task brain — perception, tile memory, and optional task/plan queue.
 */
import { mockRequestPlan } from '../../llm/mockPlanner.js';
import { tickNpcPerception } from '../../shared/npcMemory.js';
import { NPCTaskRunner } from './npcTasks.js';
import { initTileStore } from '../tileStore.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').NpcTaskBrainOptions} NpcTaskBrainOptions */
/** @typedef {import('../interface.js').World3D} World3D */

/** Perception + memory-ref travel + task/plan queue (default game brain). */
export class NpcTaskBrain {
    /**
     * @param {NpcTaskBrainOptions} [opts]
     */
    constructor(opts = {}) {
        initTileStore(this);
        /** @type {NpcTaskBrainOptions} */
        this._opts = opts;
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {NPCTaskRunner | null} */
        this._tasks = null;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
        this._tasks = new NPCTaskRunner(npc, this._opts);
    }

    /** @returns {NPCTaskRunner | null} */
    get tasks() {
        return this._tasks;
    }

    /**
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} gameTime
     * @returns {null}
     */
    tick(world, _dt, gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead) return null;

        tickNpcPerception(npc, world, gameTime);
        this._tasks?.update(world);
        return null;
    }

    destroy() {
        this._tasks?.clear();
        this._tileStore.clear();
    }
}

/**
 * @param {NpcTaskBrainOptions} [opts]
 * @returns {NpcTaskBrain}
 */
export function createTaskBrain(opts = {}) {
    return new NpcTaskBrain(opts);
}

/**
 * @param {NpcTaskBrainOptions} [opts]
 * @returns {NpcTaskBrain}
 */
export function createDefaultTaskBrain(opts = {}) {
    const planner = opts.planner === undefined ? mockRequestPlan : opts.planner;
    return createTaskBrain({
        ...opts,
        planner: planner ?? undefined,
    });
}
