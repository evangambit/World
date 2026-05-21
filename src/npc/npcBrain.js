/**
 * NPC brain — tile memory, perception, and optional task/plan runner.
 */
import { mockRequestPlan } from './llm/mockPlanner.js';
import { tickNpcPerception } from './npcMemory.js';
import { tickThomasPerception } from './thomasPerception.js';
import { TaskContext, defaultWanderBehavior } from './thomasTasks.js';
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

/**
 * Simple wander brain — no memory, no plans, no task queue.
 * Picks a random walkable tile near home each time the previous journey ends.
 */
export class WanderBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        this._traveling = false;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /**
     * @param {World3D} world
     */
    tick(world, _dt, _gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead || this._traveling) return;

        const radius = npc.wanderRadius ?? 10;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            if (!world.isWalkable(gx, gy, npc.homeZ)) continue;
            this._traveling = true;
            npc.travelToTile(gx, gy, npc.homeZ, world)
                .catch(() => {})
                .finally(() => {
                    this._traveling = false;
                });
            return;
        }
    }

    destroy() {
        this.npc = null;
        this._traveling = false;
    }
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

/** @returns {WanderBrain} */
export function createWanderBrain() {
    return new WanderBrain();
}

/**
 * Thomas's custom brain — wall-respecting perception + async task abstraction.
 *
 * Accepts a `behavior` async function that receives a `TaskContext` and drives
 * the NPC using high-level primitives (`moveTowardLocation`, `seekKnownDesires`,
 * etc.) rather than thinking in ticks.
 *
 * The bridge: each call to `tick()` resolves the pending `nextTick()` promise,
 * advancing the behavior by one simulation frame.
 */
export class ThomasBrain {
    /**
     * @param {((ctx: TaskContext) => Promise<void>)} [behavior]
     *   Async function that controls the NPC.  If omitted, uses a default wander.
     */
    constructor(behavior) {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {Map<string, import('./npcMemory.js').TileMemoryEntry>} */
        this.tileMemory = new Map();
        /** @type {(ctx: TaskContext) => Promise<void>} */
        this._behavior = behavior ?? defaultWanderBehavior;
        /** @type {World3D | null} */
        this._world = null;
        this._gameTime = 0;
        this._tickCount = 0;
        /** @type {(() => void) | null} */
        this._tickResolve = null;
        this._taskRunning = false;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
        Object.defineProperty(npc, 'tileMemory', {
            get: () => this.tileMemory,
            configurable: true,
        });
    }

    /**
     * Called every simulation frame by the engine.
     * Runs perception, then advances the async behavior by one tick.
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} gameTime
     */
    tick(world, _dt, gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead) return;

        this._world = world;
        this._gameTime = gameTime;
        this._tickCount++;

        tickThomasPerception(npc, world, gameTime);

        if (this._tickResolve) {
            const resolve = this._tickResolve;
            this._tickResolve = null;
            resolve();
        }

        if (!this._taskRunning && this._behavior) {
            this._startBehavior();
        }
    }

    /**
     * Returns a promise that resolves on the next `tick()` call.
     * Used by TaskContext — not called directly by behavior code.
     * @returns {Promise<void>}
     */
    _nextTick() {
        return new Promise(resolve => {
            this._tickResolve = resolve;
        });
    }

    /** @private */
    _startBehavior() {
        this._taskRunning = true;
        const ctx = new TaskContext(this);
        Promise.resolve(this._behavior(ctx))
            .catch(err => {
                if (err?.message !== 'dead') {
                    console.log(
                        `[ThomasBrain ${this.npc?.name ?? '?'}] behavior error:`,
                        err?.message ?? err,
                    );
                }
            })
            .finally(() => {
                this._taskRunning = false;
            });
    }

    destroy() {
        this._tickResolve = null;
        this._taskRunning = false;
        this.npc = null;
    }
}

/**
 * @param {((ctx: import('./thomasTasks.js').TaskContext) => Promise<void>)} [behavior]
 * @returns {ThomasBrain}
 */
export function createThomasBrain(behavior) {
    return new ThomasBrain(behavior);
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
