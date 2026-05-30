/**
 * Dan brain — generator-based NPC AI with hypothetical planning.
 *
 * The brain holds an in-flight task generator (_taskGen). Each tick() resumes
 * it with the previous frame's action result and returns whatever EntityAction
 * the generator yields next. When a task completes, _chooseTask() re-plans
 * from the current tile memory.
 */
import { walkToLocation } from '../shared/walkToLocation.js';
import { createHypotheticalFromMemory } from '../../shared/hypotheticalWorld.js';
import { getNpcTileMemoryStore } from '../../shared/npcMemory.js';
import { chooseBestExplorationGoal } from './tasks/explore.js';
import { eatTask, shouldEat } from './tasks/eat.js';
import { chooseBestFarmTarget, farmTask } from './tasks/farm.js';

/** @typedef {import('../interface.js').NpcBrain} NpcBrain */
/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').EntityAction} EntityAction */
/** @typedef {import('../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/** Maximum task restarts per tick to avoid busy-looping on instant completions. */
const MAX_TASK_RESTARTS_PER_TICK = 3;

/** @typedef {'eat' | 'farm' | 'explore' | null} DanTaskKind */

/** @implements {NpcBrain} */
export class DanBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this._npc = null;
        /** @type {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null> | null} */
        this._taskGen = null;
        /** @type {ActionExecutionResult | null} */
        this._pendingResult = null;
        /** @type {number} */
        this._gameTime = 0;
        /** @type {DanTaskKind} */
        this._currentTaskKind = null;
        /** @type {import('./tasks/farm.js').FarmActionType | null} */
        this._currentFarmAction = null;
        /** @type {{ x: number, y: number, z: number } | null} */
        this._currentGoal = null;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this._npc = npc;
    }

    /**
     * @param {import('../../world/world.js').World3D} _world
     * @param {number} _dt
     * @param {number} gameTime
     * @param {number|null} _actionProgress
     * @param {import('../../shared/npcMemory.js').VisibleTile[]} _visibleTiles
     * @param {ActionExecutionResult|null} [lastActionResult]
     * @returns {EntityAction | null}
     */
    tick(_world, _dt, gameTime, _actionProgress, _visibleTiles, lastActionResult = null) {
        const npc = this._npc;
        if (!npc || !npc.isAlive) return null;
        if (npc.resolvingAction) return null;

        this._gameTime = gameTime;

        if (lastActionResult) {
            this._pendingResult = lastActionResult;
        }

        for (let i = 0; i < MAX_TASK_RESTARTS_PER_TICK; i++) {
            if (!this._taskGen) {
                this._taskGen = this._chooseTask();
                if (!this._taskGen) return null;
            }

            const step = this._taskGen.next(this._pendingResult);
            this._pendingResult = null;

            if (step.done) {
                this._taskGen = null;
                this._currentTaskKind = null;
                this._currentFarmAction = null;
                this._currentGoal = null;
                continue;
            }

            return step.value;
        }

        return null;
    }

    /**
     * @returns {() => HypotheticalWorld}
     */
    _makeGetWorld() {
        const npc = this._npc;
        return () => {
            const mem = npc ? getNpcTileMemoryStore(npc) : undefined;
            return mem ? createHypotheticalFromMemory(mem) : createHypotheticalFromMemory(new Map());
        };
    }

    /**
     * Build a fresh HypotheticalWorld from current tile memory and pick the
     * best task. Returns a generator, or null if there is nothing to do.
     *
     * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null> | null}
     */
    _chooseTask() {
        const npc = this._npc;
        if (!npc) return null;

        const memory = getNpcTileMemoryStore(npc);
        if (!memory || memory.size === 0) return null;

        const hypoWorld = createHypotheticalFromMemory(memory);
        const getWorld = this._makeGetWorld();
        const getGameTime = () => this._gameTime;

        if (shouldEat(npc)) {
            this._currentTaskKind = 'eat';
            this._currentFarmAction = null;
            this._currentGoal = null;
            return eatTask(npc);
        }

        const farmTarget = chooseBestFarmTarget(npc, hypoWorld, this._gameTime);
        if (farmTarget) {
            this._currentTaskKind = 'farm';
            this._currentFarmAction = farmTarget.actionType;
            this._currentGoal = farmTarget.tileCoord;
            return farmTask(npc, getWorld, getGameTime);
        }

        const goal = chooseBestExplorationGoal(npc, hypoWorld);
        if (!goal) return null;

        this._currentTaskKind = 'explore';
        this._currentFarmAction = null;
        this._currentGoal = goal;
        return walkToLocation(npc, hypoWorld, goal, {
            getWorld,
        });
    }

    destroy() {
        this._taskGen?.return(/** @type {ActionExecutionResult} */ ({ ok: false }));
        this._taskGen = null;
        this._currentTaskKind = null;
        this._currentFarmAction = null;
        this._currentGoal = null;
        this._pendingResult = null;
        this._npc = null;
    }

    /** @returns {{ lines: string[] }} */
    getStatus() {
        if (!this._currentTaskKind) return { lines: ['idle'] };

        switch (this._currentTaskKind) {
            case 'eat':
                return { lines: ['eating'] };
            case 'farm': {
                const action = this._currentFarmAction ?? 'working';
                if (this._currentGoal) {
                    const { x, y, z } = this._currentGoal;
                    return { lines: [`farming: ${action} → (${x}, ${y}, ${z})`] };
                }
                return { lines: [`farming: ${action}`] };
            }
            case 'explore':
                if (this._currentGoal) {
                    const { x, y, z } = this._currentGoal;
                    return { lines: [`exploring → (${x}, ${y}, ${z})`] };
                }
                return { lines: ['exploring'] };
            default:
                return { lines: ['idle'] };
        }
    }
}
