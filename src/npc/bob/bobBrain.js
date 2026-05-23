/**
 * BobBrain — utility-driven NPC brain with simulate/execute task pairs.
 *
 * Architecture summary
 * ─────────────────────
 * Each "tick" the engine calls `tick(world, dt, gameTime)`.  BobBrain:
 *   1. Runs wall-respecting perception (reuses tickThomasPerception).
 *   2. Resolves the pending nextTick() promise so the running execute
 *      coroutine advances by one simulation frame (identical bridge to
 *      ThomasBrain).
 *   3. When no task is running, calls `_scheduleNextTask()`:
 *      a. Builds a SimContext snapshot of current live state.
 *      b. For each candidate task class, instantiates it with
 *         `endTick = now + reevalInterval`, clones the SimContext,
 *         calls `task.simulate(clone)`, and scores the SimResult.
 *      c. Instantiates the winner again with the same endTick and
 *         starts `task.execute(ctx)` as an async coroutine.
 *      d. When execute returns (task completed or endTick reached),
 *         `_taskRunning` is cleared and scheduling fires again on the
 *         next tick.
 *
 * Task restart invariant
 * ──────────────────────
 * Tasks must not carry progress in local variables — all state that
 * matters between iterations should live in npc.tileMemory or the world.
 * This means cancelling (letting execute return) and restarting always
 * produces the same behavior as continuing, which is why the scheduler
 * can safely re-instantiate tasks every reevalInterval ticks.
 */
import { tickThomasPerception } from '../thomasPerception.js';
import { SimContext, TaskContext } from './bobContext.js';
import { EatFoodTask, FarmAndBakeTask, ExploreTask, IdleTask, defaultBobUtility } from './bobBehaviors.js';

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../world/world.js').World3D} World3D */
/** @typedef {import('../npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('./bobContext.js').SimResult} SimResult */

/**
 * @typedef {Object} BobBrainOptions
 * @property {Array<new(endTick: number) => { simulate(simCtx: SimContext): SimResult, execute(ctx: import('../thomasTasks.js').TaskContext): Promise<void> }>} [taskClasses]
 *   Ordered list of high-level task classes the scheduler will evaluate.
 *   Defaults to [EatFoodTask, FarmAndBakeTask, ExploreTask, IdleTask].
 * @property {(result: SimResult, npc: NpcEntity) => number} [utilityFn]
 *   Scores a SimResult; higher is better.  Defaults to defaultBobUtility.
 * @property {number} [reevalInterval]
 *   Ticks between scheduler re-evaluations (= endTick horizon per task).
 *   Defaults to 100.
 */

const DEFAULT_TASK_CLASSES = [EatFoodTask, FarmAndBakeTask, ExploreTask, IdleTask];

export class BobBrain {
    /** @param {BobBrainOptions} [opts] */
    constructor(opts = {}) {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {Map<string, TileMemoryEntry>} */
        this.tileMemory = new Map();

        this._taskClasses = opts.taskClasses ?? DEFAULT_TASK_CLASSES;
        this._utilityFn   = opts.utilityFn   ?? defaultBobUtility;
        this._reevalInterval = opts.reevalInterval ?? 100;

        /** @type {World3D | null} */
        this._world = null;
        this._gameTime = 0;
        this._tickCount = 0;

        /** @type {(() => void) | null} */
        this._tickResolve = null;
        this._taskRunning = false;
        /** @type {string} */
        this._statusLine = 'Idle';
    }

    /** @returns {{ lines: string[] }} */
    getStatus() {
        return { lines: [this._statusLine] };
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

        // Advance the running execute coroutine by one frame.
        if (this._tickResolve) {
            const resolve = this._tickResolve;
            this._tickResolve = null;
            resolve();
        }

        if (!this._taskRunning) {
            this._scheduleNextTask();
        }
    }

    /**
     * Tick-to-async bridge used by TaskContext.
     * @returns {Promise<void>}
     */
    _nextTick() {
        return new Promise(resolve => {
            this._tickResolve = resolve;
        });
    }

    /** @private */
    _scheduleNextTask() {
        if (!this._world) return;

        const baseCtx = SimContext.fromBrain(this);
        const endTick  = this._tickCount + this._reevalInterval;

        let bestTask  = null;
        let bestScore = -Infinity;

        for (const TaskClass of this._taskClasses) {
            const task    = new TaskClass(endTick);
            const simCtx  = baseCtx.clone();
            const result  = task.simulate(simCtx);
            const score   = this._utilityFn(result, this.npc);
            if (score > bestScore) {
                bestScore = score;
                bestTask  = task;
            }
        }

        if (!bestTask) return;

        this._taskRunning = true;
        const ctx = new TaskContext(this);
        Promise.resolve(bestTask.execute(ctx))
            .catch(err => {
                if (err?.message !== 'dead') {
                    console.log(
                        `[BobBrain ${this.npc?.name ?? '?'}] task error:`,
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
 * @param {BobBrainOptions} [opts]
 * @returns {BobBrain}
 */
export function createBobBrain(opts) {
    return new BobBrain(opts);
}
