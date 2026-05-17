/**
 * NPC task queue — legacy primitives plus seq/sel plans.
 */
import { resolvePlanBindings } from './npcPlanBindings.js';
import { runPlan, validatePlan } from './npcPlanRunner.js';
import { runFind, runGoTo, runTimedAction } from './npcTaskPrimitives.js';
import { findPath } from '../world/pathfinding.js';

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
async function handlePlanFailure(npc, doc, err) {
    if (!npc.isAlive) return;
    if (err?.name === 'ActionInterruptedError') return;
    if (err?.message === 'dead') return;
    console.log(`[NPC ${npc.name}] plan failed`, doc.goal, err?.message ?? err);
}

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
     */
    constructor(npc) {
        this.npc = npc;
        /** @type {QueueItem[]} */
        this._queue = [];
        this._running = false;
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
        if (this._running) return;
        if (this._queue.length === 0) {
            this._enqueueWander(world);
        }
        if (this._queue.length === 0) return;

        const item = this._queue.shift();
        this._running = true;
        const run = item.kind === 'plan'
            ? executePlan(this.npc, world, item.doc)
            : executeTask(this.npc, world, item.task);

        run
            .catch((err) => {
                if (item.kind === 'plan') return handlePlanFailure(this.npc, item.doc, err);
                return handleTaskFailure(this.npc, item.task, err);
            })
            .finally(() => {
                this._running = false;
                if (this._queue.length > 0) this.update(world);
            });
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
