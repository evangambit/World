/**
 * Real and hypothetical execution contexts for Dan tasks.
 *
 * Tasks call ctx.walkTo / ctx.applyAction via yield* — only these leaf
 * primitives differ between real (yield EntityActions) and hypothetical
 * (A* teleport + instant apply) modes.
 */
import { walkToLocation, findPath, getHeldBuildingKeys } from '../shared/walkToLocation.js';
import { HypotheticalEntity } from '../../shared/hypotheticalWorld.js';
import { NPC_PERCEPTION_RADIUS } from '../../shared/npcConstants.js';

/** @typedef {import('../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number }} TileCoord */

/** Shared empty set returned by RealContext.newTilesSeen to avoid allocations. */
const EMPTY_SET = new Set();

/**
 * @typedef {RealContext | HypotheticalContext} DanContext
 */

/** Real execution — yields EntityActions to the brain scheduler. */
export class RealContext {
    /**
     * @param {NpcEntity} npc
     * @param {() => HypotheticalWorld} getWorld
     * @param {() => number} getGameTime
     */
    constructor(npc, getWorld, getGameTime) {
        this._npc = npc;
        this._getWorld = getWorld;
        this._getGameTime = getGameTime;
    }

    /** @returns {NpcEntity} */
    get entity() {
        return this._npc;
    }

    /** @returns {HypotheticalWorld} */
    get world() {
        return this._getWorld();
    }

    /** @returns {number} */
    get gameTime() {
        return this._getGameTime();
    }

    /** @returns {Set<string>} Always empty — real execution doesn't accumulate hypothetical tiles. */
    get newTilesSeen() {
        return EMPTY_SET;
    }

    /**
     * @param {TileCoord} target
     * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
     */
    *walkTo(target) {
        return yield* walkToLocation(this._npc, this._getWorld(), target, {
            getWorld: this._getWorld,
        });
    }

    /**
     * @param {EntityAction} action
     * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
     */
    *applyAction(action) {
        const result = yield action;
        return result ?? { ok: true };
    }

    /**
     * @param {Map<string, TileMemoryEntry>} memory
     * @returns {HypotheticalContext}
     */
    hypothetical(memory) {
        return new HypotheticalContext(this._npc, this._getWorld(), this._getGameTime(), memory);
    }
}

/** Hypothetical execution — fast-forwards without yielding actions. */
export class HypotheticalContext {
    /**
     * @param {NpcEntity} npc
     * @param {HypotheticalWorld} hypoWorld
     * @param {number} gameTime
     * @param {Map<string, TileMemoryEntry>} memory - used to identify tiles not yet seen
     * @param {import('../../shared/hypotheticalWorld.js').HypotheticalEntity} [hypoEntity]
     */
    constructor(npc, hypoWorld, gameTime, memory, hypoEntity = null) {
        this._npc = npc;
        this._hypoWorld = hypoWorld;
        this._hypoEntity = hypoEntity ?? new HypotheticalEntity(npc);
        this._gameTime = gameTime;
        this._memory = memory ?? new Map();
        /** @type {Set<string>} Tiles newly visible along walked paths (not in memory at task start). */
        this._newTilesSeen = new Set();
    }

    /** @returns {Set<string>} */
    get newTilesSeen() {
        return this._newTilesSeen;
    }

    /** @returns {HypotheticalEntity} */
    get entity() {
        return this._hypoEntity;
    }

    /** @returns {HypotheticalWorld} */
    get world() {
        return this._hypoWorld;
    }

    /** @returns {number} */
    get gameTime() {
        return this._gameTime;
    }

    /**
     * @param {TileCoord} target
     * @returns {Generator<never, ActionExecutionResult, unknown>}
     */
    *walkTo(target) {
        const heldBuildingKeys = getHeldBuildingKeys(this._hypoEntity);
        const path = findPath(
            this._hypoWorld,
            Math.floor(this._hypoEntity.x),
            Math.floor(this._hypoEntity.y),
            this._hypoEntity.z,
            target.x,
            target.y,
            target.z,
            undefined,
            heldBuildingKeys,
        );
        if (!path) {
            return { ok: false, message: 'No path to target tile' };
        }

        // Record tiles not yet in memory that would become visible at each step.
        for (const step of path) {
            for (let dx = -NPC_PERCEPTION_RADIUS; dx <= NPC_PERCEPTION_RADIUS; dx++) {
                for (let dy = -NPC_PERCEPTION_RADIUS; dy <= NPC_PERCEPTION_RADIUS; dy++) {
                    const key = `${step.x + dx},${step.y + dy},${step.z}`;
                    if (!this._memory.has(key)) {
                        this._newTilesSeen.add(key);
                    }
                }
            }
        }

        if (path.length > 1) {
            this._hypoEntity.x = target.x + 0.5;
            this._hypoEntity.y = target.y + 0.5;
            this._hypoEntity.z = target.z;
        }
        return { ok: true };
    }

    /**
     * @param {EntityAction} action
     * @returns {Generator<never, ActionExecutionResult, unknown>}
     */
    *applyAction(action) {
        if (typeof action.apply !== 'function') {
            return { ok: false, message: 'Action has no apply' };
        }
        const ok = action.apply(this._hypoWorld);
        return { ok: !!ok };
    }

    /** @returns {HypotheticalContext} */
    hypothetical() {
        return new HypotheticalContext(
            this._npc,
            this._hypoWorld.branch(),
            this._gameTime,
            this._memory,
            this._hypoEntity.branch(),
        );
    }
}

/**
 * Drain a task generator in hypothetical mode. Asserts that no EntityAction
 * is yielded (hypo leaf primitives must complete synchronously).
 *
 * @param {Generator<EntityAction, ActionExecutionResult, unknown>} taskGen
 * @returns {ActionExecutionResult | undefined}
 */
export function drainHypo(taskGen) {
    let step;
    do {
        step = taskGen.next();
        if (!step.done && step.value !== undefined) {
            throw new Error('Hypo task yielded an action — leaf primitive bug');
        }
    } while (!step.done);
    return step.value;
}
