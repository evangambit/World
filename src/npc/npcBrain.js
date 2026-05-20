/**
 * NPC brain — tile memory, perception, and optional task/plan runner.
 */
import { mockRequestPlan } from './llm/mockPlanner.js';
import { tickNpcPerception } from './npcMemory.js';
import { syncMemoryRefTravelGoal } from './npcMemoryTravel.js';
import { NPCTaskRunner } from './npcTasks.js';

/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('./npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('./llm/npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {import('./npcTasks.js').NPCTaskRunner} NPCTaskRunner */

/**
 * @typedef {Object} NpcTaskBrainOptions
 * @property {NpcPlannerFn} [planner]
 * @property {number} [plannerCooldownMs]
 * @property {boolean} [wanderOnPlannerFailure]
 */

/**
 * @typedef {Object} NpcBrain
 * @property {(npc: NpcEntity) => void} attach
 * @property {(world: World3D, dt: number, gameTime: number) => void} tick
 * @property {() => void} [destroy]
 * @property {Map<string, TileMemoryEntry>} [tileMemory]
 * @property {NPCTaskRunner} [tasks]
 */

/** No cognition — body-only simulation. */
export class NoopNpcBrain {
    attach(_npc) {}

    tick(_world, _dt, _gameTime) {}

    destroy() {}
}

/** Perception + memory-ref travel + task/plan queue (default game brain). */
export class NpcTaskBrain {
    /**
     * @param {NpcTaskBrainOptions} [opts]
     */
    constructor(opts = {}) {
        /** @type {Map<string, TileMemoryEntry>} */
        this.tileMemory = new Map();
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
        Object.defineProperty(npc, 'tileMemory', {
            get: () => this.tileMemory,
            configurable: true,
        });
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
     */
    tick(world, _dt, gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead) return;

        tickNpcPerception(npc, world, gameTime);
        syncMemoryRefTravelGoal(npc, world);
        this._tasks?.update(world);
    }

    destroy() {
        this._tasks?.clear();
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

/** @returns {NoopNpcBrain} */
export function noopNpcBrain() {
    return new NoopNpcBrain();
}

/**
 * @param {NpcEntity} npc
 * @param {NpcBrain} brain
 * @returns {NpcBrain}
 */
export function attachNpcBrain(npc, brain) {
    npc.brain = brain;
    brain.attach(npc);
    return brain;
}
