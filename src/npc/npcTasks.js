/**
 * NPC task queue — legacy primitives plus seq/sel plans.
 */
import { buildPlannerMessages } from './llm/npcPrompt.js';
import { parsePlanDocument } from './llm/npcPlanner.js';
import { resolvePlanBindings } from './npcPlanBindings.js';
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
 * @property {Record<string, { query: string }>} [bindings]
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
 */
async function executePlan(npc, world, doc) {
    const validationError = validatePlan(doc.plan);
    if (validationError) throw new Error(validationError);

    const bindings = resolvePlanBindings(npc, world, doc.bindings);
    const result = await runPlan(npc, world, doc.plan, bindings);
    if (!result.ok) throw result.error;
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
                    this._schedulePlanner(world, { reason: 'idle' });
                }
                return;
            }
            this._enqueueWander(world);
        }
        if (this._queue.length === 0) return;

        const item = this._queue.shift();
        this._running = true;
        const run = item.kind === 'plan'
            ? executePlan(this.npc, world, item.doc)
            : executeTask(this.npc, world, item.task);

        let succeeded = false;
        run
            .then(() => {
                succeeded = true;
            })
            .catch((err) => {
                if (item.kind === 'plan') return this._onPlanFailure(world, item.doc, err);
                return handleTaskFailure(this.npc, item.task, err);
            })
            .finally(() => {
                this._running = false;
                if (this._queue.length > 0) {
                    this.update(world);
                    return;
                }
                if (item.kind === 'plan' && succeeded && this._planner && this._canRequestPlanner()) {
                    this._schedulePlanner(world, {
                        reason: 'plan_completed',
                        goal: item.doc.goal,
                    });
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

        const messages = buildPlannerMessages(this.npc, event);
        const request = {
            npc: this.npc,
            world,
            event,
            messages,
        };

        Promise.resolve(planner(request))
            .then((raw) => {
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
        console.log(`[NPC ${this.npc.name}] plan failed`, doc.goal, message);

        if (this._planner && this._canRequestPlanner()) {
            this._schedulePlanner(world, {
                reason: 'plan_failed',
                goal: doc.goal,
                error: message,
            });
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
