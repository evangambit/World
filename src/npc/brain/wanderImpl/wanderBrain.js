/**
 * Wander brain — random walk near home, no memory or plans.
 */

import { walkToLocation } from '../shared/walkToLocation.js';
import { createHypotheticalFromMemory } from '../../shared/hypotheticalWorld.js';
import { getNpcTileMemoryStore } from '../../shared/npcMemory.js';

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */
/** @typedef {import('../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/**
 * Simple wander brain — no memory, no plans, no task queue.
 * Picks a random walkable tile near home and returns moveDirection each tick.
 */
/** @implements {NpcBrain} */
export class WanderBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        /** @type {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null> | null} */
        this._walker = null;
        /** @type {ActionExecutionResult | null} */
        this._walkerInput = null;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /**
     * @param {NpcEntity} npc
     * @param {number} attempts
     */
    *_tileCandidates(npc, attempts) {
        const radius = npc.wanderRadius ?? 10;
        for (let i = 0; i < attempts; i++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            yield { x: gx, y: gy, z: npc.homeZ };
        }
    }

    /**
     * @param {NpcEntity} npc
     * @returns {HypotheticalWorld | null}
     */
    _hypotheticalWorld(npc) {
        const memory = getNpcTileMemoryStore(npc);
        if (!memory || memory.size === 0) return null;
        return createHypotheticalFromMemory(memory);
    }

    /**
     * @param {NpcEntity} npc
     * @returns {boolean}
     */
    _startWalk(npc) {
        const hypo = this._hypotheticalWorld(npc);
        if (!hypo) return false;

        for (const candidate of this._tileCandidates(npc, 10)) {
            if (!hypo.isWalkable(candidate.x, candidate.y, candidate.z)) continue;
            this._walker = walkToLocation(npc, hypo, candidate, {
                getWorld: () => this._hypotheticalWorld(npc) ?? hypo,
            });
            this._walkerInput = null;
            return true;
        }
        this._walker = null;
        this._walkerInput = null;
        return false;
    }

    /**
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} _gameTime
     * @param {number|null} _actionProgress
     * @param {import('../../shared/npcMemory.js').VisibleTile[]} _visibleTiles
     * @param {ActionExecutionResult|null} [lastActionResult]
     * @returns {EntityAction | null}
     */
    tick(world, _dt, _gameTime, _actionProgress, _visibleTiles, lastActionResult = null) {
        const npc = this.npc;
        if (!npc || !npc.isAlive) return null;
        if (npc.resolvingAction) return null;

        if (lastActionResult) {
            this._walkerInput = lastActionResult;
        }

        while (true) {
            if (!this._walker && !this._startWalk(npc)) return null;
            if (!this._walker) return null;
            const step = this._walker.next(this._walkerInput);
            this._walkerInput = null;
            if (step.done) {
                this._walker = null;
                continue;
            }
            return step.value;
        }
    }

    destroy() {
        this._walker = null;
        this._walkerInput = null;
        this.npc = null;
    }
}
