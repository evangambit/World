/**
 * NPC task queue — legacy primitives plus seq/sel plans.
 */
import {
    buildPlannerMessages,
    logPlannerMessages,
    logPlannerResponse,
} from './llm/npcPrompt.js';
import { parsePlanDocument } from './llm/npcPlanner.js';
import { describePlanStep, formatPlanOutline, getPlanStepAt } from './npcPlanDescribe.js';
import { MAX_PLAN_HISTORY } from './npcPlanHistory.js';
import { runPlan, validatePlan } from './npcPlanRunner.js';
import { runFind, runGoTo, runTimedAction } from './npcTaskPrimitives.js';
import { findPath } from '../world/pathfinding.js';

/** @typedef {import('./llm/npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {import('./llm/npcPrompt.js').PlannerEvent} PlannerEvent */

/**
 * @typedef {Object} NpcTaskRunnerOptions
 * @property {NpcPlannerFn} [planner]
 * @property {number} [plannerCooldownMs]
 * @property {boolean} [wanderOnPlannerFailure]
 */

/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/** @typedef {{ type: 'goTo', x: number, y: number, z: number }} GoToTask */
/** @typedef {{ type: 'find', objType: number, radius: number, buildingId?: number }} FindTask */
/** @typedef {{ type: 'action', action: string, x: number, y: number, z: number }} ActionTask */
/** @typedef {GoToTask | FindTask | ActionTask} NpcTask */

/**
 * @typedef {Object} PlanDocument
 * @property {string} goal
 * @property {import('./npcPlanRunner.js').PlanStep} plan
 */

/** @typedef {{ kind: 'task', task: NpcTask } | { kind: 'plan', doc: PlanDocument }} QueueItem */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {GoToTask}
 */
export function goTo(x, y, z) {
    return { type: 'goTo', x, y, z };
}

/**
 * @param {number} objType - Obj.* constant
 * @param {number} radius - Chebyshev tiles from the NPC when the task starts
 * @param {{ buildingId?: number }} [opts] - for keys, only match keyBuildingId on the tile
 * @returns {FindTask}
 */
export function find(objType, radius, opts) {
    const task = { type: 'find', objType, radius };
    if (opts?.buildingId != null) task.buildingId = opts.buildingId;
    return task;
}

/**
 * Timed world action at a tile (NPC walks adjacent first).
 * @param {string} actionId - e.g. `clear_grass`
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {ActionTask}
 */
export function timedAction(actionId, x, y, z) {
    return { type: 'action', action: actionId, x, y, z };
}

/** @returns {ActionTask} */
export function clearGrass(x, y, z) {
    return timedAction('clear_grass', x, y, z);
}

/**
 * @param {import('../actors/npcSimulation.js').NpcEntity} npc
 * @param {NpcTask} task
 * @param {Error} err
 */
async function handleTaskFailure(npc, task, err) {
    if (!npc.isAlive) return;
    if (err?.name === 'ActionInterruptedError') return;
    if (err?.message === 'dead') return;
    console.log(`[NPC ${npc.name}] task failed`, task, err?.message ?? err);
}

/**
 * @param {import('../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlanDocument} doc
 * @param {Error} err
 */

/**
 * @param {import('../actors/npcSimulation.js').NpcEntity} npc
 * @param {import('../world/world.js').World3D} world
 * @param {NpcTask} task
 */
async function executeTask(npc, world, task) {
    if (task.type === 'goTo') {
        await runGoTo(npc, world, task.x, task.y, task.z);
        return;
    }
    if (task.type === 'find') {
        await runFind(npc, world, task.objType, task.radius, task.buildingId);
        return;
    }
    if (task.type === 'action') {
        await runTimedAction(npc, world, task.action, task.x, task.y, task.z);
        return;
    }
    throw new Error(`Unknown task type: ${task.type}`);
}

/**
 * @param {import('../actors/npcSimulation.js').NpcEntity} npc
 * @param {import('../world/world.js').World3D} world
 * @param {PlanDocument} doc
 * @param {NPCTaskRunner} runner
 */
async function executePlan(npc, world, doc, runner) {
    const validationError = validatePlan(doc.plan);
    if (validationError) throw new Error(validationError);

    runner._activePlanDoc = doc;
    runner._activeTask = null;
    runner._planPath = [];

    const result = await runPlan(npc, world, doc.plan, {
        onStepStart(path) {
            runner._planPath = path;
        },
    });
    if (!result.ok) throw result.error;
}

/**
 * @param {NpcTask} task
 * @returns {string}
 */
function describeTask(task) {
    if (task.type === 'goTo') return `go to (${task.x}, ${task.y}, ${task.z})`;
    if (task.type === 'find') return `find object #${task.objType} (radius ${task.radius})`;
    if (task.type === 'action') {
        return `${task.action} at (${task.x}, ${task.y}, ${task.z})`;
    }
    return task.type;
}

export class NPCTaskRunner {
    /**
     * @param {import('../actors/npcSimulation.js').NpcEntity} npc
     * @param {NpcTaskRunnerOptions} [opts]
     */
    constructor(npc, opts = {}) {
        this.npc = npc;
        /** @type {QueueItem[]} */
        this._queue = [];
        this._running = false;
        /** @type {NpcPlannerFn | null} */
        this._planner = opts.planner ?? null;
        this._plannerCooldownMs = opts.plannerCooldownMs ?? 10_000;
        this._wanderOnPlannerFailure = opts.wanderOnPlannerFailure !== false;
        this._lastPlannerAt = 0;
        this._awaitingPlanner = false;
        /** @type {PlanDocument | null} */
        this._activePlanDoc = null;
        /** @type {number[]} */
        this._planPath = [];
        /** @type {NpcTask | null} */
        this._activeTask = null;
        /** @type {import('./npcPlanHistory.js').PlanHistoryRecord[]} */
        this._planHistory = [];
    }

    /**
     * @param {PlanDocument} doc
     * @param {'completed' | 'failed'} outcome
     * @param {unknown} [err]
     */
    _recordPlanOutcome(doc, outcome, err) {
        const npc = this.npc;
        const step = getPlanStepAt(doc.plan, this._planPath);
        /** @type {import('./npcPlanHistory.js').PlanHistoryRecord} */
        const record = {
            goal: doc.goal,
            outcome,
            position: `(${Math.floor(npc.x)}, ${Math.floor(npc.y)}, ${npc.z})`,
        };
        if (outcome === 'failed') {
            record.error = err instanceof Error ? err.message : String(err);
            if (step) record.failedStep = describePlanStep(step);
        }
        this._planHistory.push(record);
        if (this._planHistory.length > MAX_PLAN_HISTORY) {
            this._planHistory.splice(0, this._planHistory.length - MAX_PLAN_HISTORY);
        }
    }

    /**
     * @param {PlannerEvent} event
     * @returns {PlannerEvent}
     */
    _plannerEventWithHistory(event) {
        return {
            ...event,
            recentPlans: [...this._planHistory],
        };
    }

    /** Snapshot for UI — goal, plan outline, current step. */
    getPlanStatus() {
        if (this._awaitingPlanner) {
            return { phase: 'planning', lines: ['Planning next goal…'] };
        }
        if (this._activePlanDoc) {
            const { goal, plan } = this._activePlanDoc;
            const current = getPlanStepAt(plan, this._planPath);
            /** @type {string[]} */
            const lines = [`Goal: ${goal}`];
            if (current) {
                lines.push(`Now: ${describePlanStep(current)}`);
            }
            lines.push(...formatPlanOutline(plan, this._planPath));
            if (this._queue.length > 0) {
                lines.push(`(+${this._queue.length} queued)`);
            }
            return { phase: 'plan', goal, lines };
        }
        if (this._activeTask) {
            return {
                phase: 'task',
                lines: [
                    describeTask(this._activeTask),
                    ...(this._queue.length > 0 ? [`(+${this._queue.length} queued)`] : []),
                ],
            };
        }
        if (this._running) {
            return { phase: 'busy', lines: ['Working…'] };
        }
        if (this._queue.length > 0) {
            return { phase: 'queued', lines: [`${this._queue.length} item(s) queued`] };
        }
        return { phase: 'idle', lines: ['Idle'] };
    }

    /** @param {NpcTask} task */
    enqueue(task) {
        this._queue.push({ kind: 'task', task });
    }

    /** @param {NpcTask[]} tasks */
    enqueueMany(tasks) {
        for (const task of tasks) this.enqueue(task);
    }

    /** @param {PlanDocument} doc */
    enqueuePlan(doc) {
        this._queue.push({ kind: 'plan', doc });
    }

    clear() {
        this._queue = [];
    }

    /** @param {import('../world/world.js').World3D} world */
    update(world) {
        if (!this.npc.isAlive) return;
        if (this._running || this._awaitingPlanner) return;

        if (this._queue.length === 0) {
            if (this._planner) {
                if (this._canRequestPlanner()) {
                    this._schedulePlanner(
                        world,
                        this._plannerEventWithHistory({ reason: 'idle' }),
                    );
                }
                return;
            }
            this._enqueueWander(world);
        }
        if (this._queue.length === 0) return;

        const item = this._queue.shift();
        this._running = true;
        if (item.kind === 'task') {
            this._activeTask = item.task;
            this._activePlanDoc = null;
            this._planPath = [];
        }
        const run = item.kind === 'plan'
            ? executePlan(this.npc, world, item.doc, this)
            : executeTask(this.npc, world, item.task);

        let succeeded = false;
        run
            .then(() => {
                succeeded = true;
                if (item.kind === 'plan') {
                    this._recordPlanOutcome(item.doc, 'completed');
                }
            })
            .catch((err) => {
                if (item.kind === 'plan') return this._onPlanFailure(world, item.doc, err);
                return handleTaskFailure(this.npc, item.task, err);
            })
            .finally(() => {
                this._running = false;
                this._activePlanDoc = null;
                this._activeTask = null;
                this._planPath = [];
                if (this._queue.length > 0) {
                    this.update(world);
                    return;
                }
                if (item.kind === 'plan' && succeeded && this._planner && this._canRequestPlanner()) {
                    this._schedulePlanner(
                        world,
                        this._plannerEventWithHistory({
                            reason: 'plan_completed',
                            goal: item.doc.goal,
                        }),
                    );
                    return;
                }
                if (this._queue.length === 0) this.update(world);
            });
    }

    /** @returns {boolean} */
    _canRequestPlanner() {
        if (!this._planner) return false;
        if (this._plannerCooldownMs <= 0) return true;
        return Date.now() - this._lastPlannerAt >= this._plannerCooldownMs;
    }

    /**
     * @param {import('../world/world.js').World3D} world
     * @param {PlannerEvent} event
     */
    _schedulePlanner(world, event) {
        const planner = this._planner;
        if (!planner || this._awaitingPlanner) return;

        this._awaitingPlanner = true;
        this._lastPlannerAt = Date.now();

        const messages = buildPlannerMessages(this.npc, this._plannerEventWithHistory(event), {
            world,
        });
        logPlannerMessages(this.npc, event, messages);
        const request = {
            npc: this.npc,
            world,
            event,
            messages,
        };

        Promise.resolve(planner(request))
            .then((raw) => {
                logPlannerResponse(
                    this.npc,
                    event,
                    raw == null ? { result: null } : { plan: raw },
                );
                if (!this.npc.isAlive) return;
                if (raw == null) {
                    this._lastPlannerAt = Date.now();
                    if (this._wanderOnPlannerFailure) this._enqueueWander(world);
                    return;
                }
                const parsed = parsePlanDocument(raw);
                if (!parsed.ok) {
                    this._lastPlannerAt = Date.now();
                    console.log(
                        `[NPC ${this.npc.name}] planner returned invalid plan`,
                        parsed.error,
                    );
                    if (this._wanderOnPlannerFailure) this._enqueueWander(world);
                    return;
                }
                this.enqueuePlan(parsed.doc);
            })
            .catch((err) => {
                console.log(
                    `[NPC ${this.npc.name}] planner error`,
                    err instanceof Error ? err.message : err,
                );
                if (this._wanderOnPlannerFailure) this._enqueueWander(world);
            })
            .finally(() => {
                this._awaitingPlanner = false;
                if (this.npc.isAlive) this.update(world);
            });
    }

    /**
     * @param {import('../world/world.js').World3D} world
     * @param {PlanDocument} doc
     * @param {unknown} err
     */
    _onPlanFailure(world, doc, err) {
        if (!this.npc.isAlive) return;
        if (/** @type {Error} */ (err)?.name === 'ActionInterruptedError') return;
        if (/** @type {Error} */ (err)?.message === 'dead') return;

        const message = err instanceof Error ? err.message : String(err);
        const failedStep = getPlanStepAt(doc.plan, this._planPath);
        const failedStepLabel = failedStep ? describePlanStep(failedStep) : undefined;
        const position = `(${Math.floor(this.npc.x)}, ${Math.floor(this.npc.y)}, ${this.npc.z})`;

        this._recordPlanOutcome(doc, 'failed', err);
        console.log(`[NPC ${this.npc.name}] plan failed`, doc.goal, message);

        if (this._planner && this._canRequestPlanner()) {
            this._schedulePlanner(
                world,
                this._plannerEventWithHistory({
                    reason: 'plan_failed',
                    goal: doc.goal,
                    error: message,
                    failedStep: failedStepLabel,
                    position,
                }),
            );
        }
    }

    /**
     * Pick a random walkable tile near home and queue GoTo when idle.
     * @param {import('../world/world.js').World3D} world
     */
    _enqueueWander(world) {
        const npc = this.npc;
        if (!npc.isAlive) return;
        const radius = npc.wanderRadius ?? 10;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            const gz = npc.homeZ;
            if (!world.isWalkable(gx, gy, gz)) continue;
            const sx = Math.floor(npc.x);
            const sy = Math.floor(npc.y);
            if (!findPath(world, sx, sy, npc.z, gx, gy, gz)) continue;
            this.enqueue(goTo(gx, gy, gz));
            return;
        }
    }
}
