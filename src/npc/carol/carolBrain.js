/**
 * CarolBrain — utility-driven NPC brain using Real/Hypothetical contexts.
 *
 * Each tick:
 *   1. Runs wall-respecting perception (Thomas raycast).
 *   2. Resolves the pending nextTick() promise for the running task coroutine.
 *   3. When idle or reevalInterval elapsed, evaluates each candidate task on a
 *      HypotheticalCarolContext (instant nextTick), scores via ctx.utility(),
 *      and starts the winner on a RealCarolContext.
 */
import { tickThomasPerception } from '../thomasPerception.js';
import { RealCarolContext } from './carolContext.js';
import {
    eatFoodTask,
    exploreTask,
    farmAndBakeTask,
    idleTask,
} from './carolBehaviors.js';

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../world/world.js').World3D} World3D */
/** @typedef {import('./carolContext.js').RealCarolContext} RealCarolContextType */
/** @typedef {(ctx: RealCarolContextType, endTick: number) => Promise<void>} CarolTaskFn */

const DEFAULT_TASKS = /** @type {CarolTaskFn[]} */ ([
    eatFoodTask,
    farmAndBakeTask,
    exploreTask,
    idleTask,
]);

/**
 * Thin adapter so thomasTasks primitives can drive Carol's live execution path.
 */
class CarolTaskContext {
    /**
     * @param {CarolBrain} brain
     * @param {RealCarolContext} carolCtx
     */
    constructor(brain, carolCtx) {
        this._brain = brain;
        this._carolCtx = carolCtx;
    }

    get npc() { return this._brain.npc; }
    get tileMemory() { return this._brain.tileMemory; }
    get world() { return this._brain._world; }
    get gameTime() { return this._brain._gameTime; }
    get tickCount() { return this._brain._tickCount; }

    nextTick() { return this._brain._nextTick(); }
    setStatus(line) { this._carolCtx.setStatus(line); }
}

/**
 * @typedef {Object} CarolBrainOptions
 * @property {CarolTaskFn[]} [tasks]
 * @property {number} [reevalInterval]
 */

export class CarolBrain {
    /** @param {CarolBrainOptions} [opts] */
    constructor(opts = {}) {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {Map<string, import('../npcMemory.js').TileMemoryEntry>} */
        this.tileMemory = new Map();

        this._tasks = opts.tasks ?? DEFAULT_TASKS;
        this._reevalInterval = opts.reevalInterval ?? 100;

        /** @type {World3D | null} */
        this._world = null;
        this._gameTime = 0;
        this._tickCount = 0;

        /** @type {(() => void) | null} */
        this._tickResolve = null;
        this._taskRunning = false;
        this._taskEpoch = 0;
        this._taskStartTick = 0;
        this._statusLine = 'Idle';
        this._scheduling = false;
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

        if (this._taskRunning) {
            if (this._tickCount - this._taskStartTick >= this._reevalInterval) {
                void this._scheduleNextTask();
            }
        } else if (!this._scheduling) {
            void this._scheduleNextTask();
        }
    }

    /** @returns {Promise<void>} */
    _nextTick() {
        return new Promise(resolve => {
            this._tickResolve = resolve;
        });
    }

    /**
     * @param {RealCarolContext} carolCtx
     * @returns {CarolTaskContext}
     */
    _taskContext(carolCtx) {
        return new CarolTaskContext(this, carolCtx);
    }

    /** @private */
    async _scheduleNextTask() {
        if (!this._world || this._scheduling) return;
        this._scheduling = true;

        if (this._tickResolve) {
            const resolve = this._tickResolve;
            this._tickResolve = null;
            resolve();
        }

        this._taskEpoch++;
        const epoch = this._taskEpoch;
        this._taskStartTick = this._tickCount;

        const endTick = this._tickCount + this._reevalInterval;
        const baseCtx = new RealCarolContext(this, epoch);

        let bestTask = null;
        let bestScore = -Infinity;

        for (const taskFn of this._tasks) {
            const hypo = baseCtx.hypothetical();
            await taskFn(hypo, endTick);
            const score = hypo.utility();
            if (score > bestScore) {
                bestScore = score;
                bestTask = taskFn;
            }
        }

        this._scheduling = false;

        if (!bestTask) {
            this._taskRunning = false;
            return;
        }

        this._taskRunning = true;
        this._statusLine = bestTask.name || 'Task';

        const liveCtx = new RealCarolContext(this, epoch);
        Promise.resolve(bestTask(liveCtx, endTick))
            .catch(err => {
                if (err?.message !== 'dead') {
                    console.log(
                        `[CarolBrain ${this.npc?.name ?? '?'}] task error:`,
                        err?.message ?? err,
                    );
                }
            })
            .finally(() => {
                if (this._taskEpoch !== epoch) return;
                this._taskRunning = false;
            });
    }

    destroy() {
        this._taskEpoch++;
        this._tickResolve = null;
        this._taskRunning = false;
        this._scheduling = false;
        this.npc = null;
    }
}

/** @param {CarolBrainOptions} [opts] @returns {CarolBrain} */
export function createCarolBrain(opts) {
    return new CarolBrain(opts);
}
