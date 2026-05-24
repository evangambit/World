/**
 * Thomas brain — wall-respecting perception + async behavior coroutines.
 */
import { tickThomasPerception } from './thomasPerception.js';
import { TaskContext } from './thomasTasks.js';
import { farmBehavior } from './thomasBehaviors.js';
import { initTileStore } from '../tileStore.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */

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
/** @implements {NpcBrain} */
export class ThomasBrain {
    /**
     * @param {((ctx: TaskContext) => Promise<void>)} [behavior]
     *   Async function that controls the NPC.  If omitted, uses a default wander.
     */
    constructor(behavior) {
        /** @type {NpcEntity | null} */
        this.npc = null;
        initTileStore(this);
        /** @type {(ctx: TaskContext) => Promise<void>} */
        this._behavior = behavior ?? farmBehavior;
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
        this._tileStore.clear();
    }
}

/**
 * @param {((ctx: import('./thomasTasks.js').TaskContext) => Promise<void>)} [behavior]
 * @returns {ThomasBrain}
 */
export function createThomasBrain(behavior) {
    return new ThomasBrain(behavior);
}
