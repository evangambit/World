/**
 * Thomas brain — wall-respecting perception + async behavior coroutines.
 */
import { initTileStore } from '../tileStore.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */

export class XBrain {
    /**
     */
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        initTileStore(this);
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
        if (!npc || npc._dead) return null;

        return moveToAction(npc, 0, 0, 0);
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
