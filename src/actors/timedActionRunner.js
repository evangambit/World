/**
 * Runs a single timed action on an entity (blocks movement until done).
 */
import { getTimedAction } from '../domain/timedActions.js';

/** @typedef {import('./entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */

/** Timed action stopped before completion (movement, click, new NPC goal, etc.). */
export class ActionInterruptedError extends Error {
    constructor(message = 'Interrupted') {
        super(message);
        this.name = 'ActionInterruptedError';
    }
}

export class TimedActionRunner {
    /** @param {Entity} entity */
    constructor(entity) {
        this.entity = entity;
        /** @type {{ id: string, tx: number, ty: number, tz: number, elapsed: number, duration: number } | null} */
        this.active = null;
        /** @type {{ resolve: () => void, reject: (err: Error) => void } | null} */
        this._wait = null;
    }

    isBusy() {
        return this.active != null;
    }

    /** @returns {number} 0–1 */
    getProgress() {
        if (!this.active) return 0;
        return Math.min(1, this.active.elapsed / this.active.duration);
    }

    getLabel() {
        if (!this.active) return '';
        return getTimedAction(this.active.id)?.label ?? this.active.id;
    }

    /**
     * @param {string} actionId
     * @param {World3D} world
     * @param {number} tx
     * @param {number} ty
     * @param {number} [tz]
     * @returns {{ ok: boolean, message: string }}
     */
    start(actionId, world, tx, ty, tz = this.entity.z) {
        if (this.active) return { ok: false, message: 'Already busy' };

        const def = getTimedAction(actionId);
        if (!def) return { ok: false, message: 'Unknown action' };

        const check = def.canStart(this.entity, world, tx, ty, tz);
        if (!check.ok) return { ok: false, message: check.message };

        this.active = {
            id: actionId,
            tx,
            ty,
            tz,
            elapsed: 0,
            duration: def.duration,
            startPx: Math.floor(this.entity.x),
            startPy: Math.floor(this.entity.y),
        };
        this.entity.faceTile(tx, ty);
        return { ok: true, message: def.label };
    }

    /**
     * Stop the current action without applying its effect.
     * @returns {boolean} whether an action was active
     */
    cancel() {
        if (!this.active) return false;
        this._finish(false, new ActionInterruptedError('Cancelled'));
        return true;
    }

    /**
     * @param {number} dt
     * @param {World3D} world
     */
    tick(dt, world) {
        if (!this.active) return;

        // move_to_tile: interpolate position smoothly so walk animation fires.
        // Skip re-validation — the move was already approved at start().
        if (this.active.id === 'move_to_tile') {
            this.active.elapsed += dt;
            const t = Math.min(1, this.active.elapsed / this.active.duration);
            this.entity.x = this.active.startPx + 0.5 + (this.active.tx - this.active.startPx) * t;
            this.entity.y = this.active.startPy + 0.5 + (this.active.ty - this.active.startPy) * t;
            if (this.active.elapsed >= this.active.duration) {
                this.entity.x = this.active.tx + 0.5;
                this.entity.y = this.active.ty + 0.5;
                this._finish(true);
            }
            return;
        }

        const px = Math.floor(this.entity.x);
        const py = Math.floor(this.entity.y);
        if (px !== this.active.startPx || py !== this.active.startPy) {
            this._finish(false, new ActionInterruptedError('Moved'));
            return;
        }

        const def = getTimedAction(this.active.id);
        if (!def) {
            this._finish(false, new Error('Unknown action'));
            return;
        }

        const { tx, ty, tz } = this.active;
        const check = def.canStart(this.entity, world, tx, ty, tz);
        if (!check.ok) {
            this._finish(false, new ActionInterruptedError(check.message));
            return;
        }

        this.active.elapsed += dt;
        if (this.active.elapsed >= this.active.duration) {
            def.complete(this.entity, world, tx, ty, tz);
            this._finish(true);
        }
    }

    /** @returns {Promise<void>} */
    waitForCompletion() {
        if (!this.active) return Promise.resolve();
        return new Promise((resolve, reject) => {
            this._wait = { resolve, reject };
        });
    }

    /**
     * @param {boolean} success
     * @param {Error} [err]
     */
    _finish(success, err) {
        const wait = this._wait;
        this.active = null;
        this._wait = null;
        this.entity.currentAction = null;
        if (wait) {
            if (success) wait.resolve();
            else wait.reject(err ?? new Error('Action failed'));
        }
    }

}
