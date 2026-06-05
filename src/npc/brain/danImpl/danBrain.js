/**
 * Dan brain — utility-based NPC AI with hypothetical planning.
 *
 * Each time a task completes, _chooseTask() evaluates every candidate task
 * hypothetically via ctx.hypothetical(), drains the same task generators,
 * and starts the one that yields the greatest utility gain.
 */
import { getNpcTileMemoryStore } from '../../shared/npcMemory.js';
import { NPC_PERCEPTION_RADIUS } from '../../shared/npcConstants.js';
import { RealContext, drainHypo } from './danContext.js';
import { computeCentroid } from './tasks/explore.js';
import { eatTask } from './tasks/eat.js';
import { farmTask } from './tasks/farm.js';
import { exploreTask } from './tasks/explore.js';
import { talkToTask, walkToTargetOnly } from './tasks/talkTo.js';
import { createHypotheticalFromMemory } from '../../shared/hypotheticalWorld.js';
import { Obj, isWheatCropObject } from '../../../world/tileTypes.js';
import { VITALITY } from '../../../domain/vitality.js';
import { ActionMemory } from './actionMemory.js';
import { sanitizeBrainTweak } from './brainTweak.js';
import { buildThinkPrompt } from './llm/thinkPrompt.js';
import { callThinkLlm } from './llm/llmClient.js';
import { isMoveToTileAction, isMoveDirectionAction } from '../../../domain/entityActions.js';

/** @typedef {import('../interface.js').NpcBrain} NpcBrain */
/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').EntityAction} EntityAction */
/** @typedef {import('../../shared/hypotheticalWorld.js').HypotheticalWorld} HypotheticalWorld */
/** @typedef {import('./danContext.js').DanContext} DanContext */
/** @typedef {import('./danContext.js').HypotheticalContext} HypotheticalContext */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */

/** Maximum task restarts per tick to avoid busy-looping on instant completions. */
const MAX_TASK_RESTARTS_PER_TICK = 3;

/** Scale exploration score to sit alongside food utility. */
const EXPLORE_WEIGHT = 0.0005;

/** Nutrition lookup matching vitality.js FOOD_NUTRITION for fast inventory scoring. */
const FOOD_NUTRITION = {
    [Obj.STEAK]: 40,
    [Obj.WHEAT]: 15,
    [Obj.BREAD]: 30,
};

/** @typedef {(ctx: DanContext) => Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>} DanTaskFn */

/** Urgency bonuses for pending talk_to tasks (spec §2.2). */
const URGENCY_BONUS = {
    low: 0.01,
    normal: 0.1,
    high: 1.0,
};

/** @typedef {import('./brainTweak.js').PendingTask} PendingTask */
/** @typedef {import('./brainTweak.js').BrainTweak} BrainTweak */

/** @type {DanTaskFn[]} */
const BASE_TASKS = [eatTask, farmTask, exploreTask];

/**
 * Food component of Dan's utility function: -1 / (satiety + stockpile value).
 *
 * @param {{ hunger: number, inventory?: { objType: number, count: number }[] }} entity
 * @returns {number}
 */
function foodUtility(entity) {
    const satiety = Math.max(0, VITALITY.MAX_HUNGER - entity.hunger);
    let score = satiety;
    for (const stack of entity.inventory ?? []) {
        score += (FOOD_NUTRITION[stack.objType] ?? 0) * stack.count;
    }
    return -1 / Math.max(1, score);
}

/**
 * Hunger urgency penalty: quadratic, kicking in past HUNGER_PENALTY_THRESHOLD.
 *
 * This is a pragmatic approximation of health consequences. The spec's food utility
 * -1/(satiety + kB) treats satiety and inventory food as perfect substitutes, so
 * ΔU(eat) = 0 exactly — the NPC is indifferent to eating and will starve. The
 * principled fix requires health in the utility function (hunger → health loss →
 * death → −∞ utility), integrated over future time. This penalty approximates that:
 * being hungry is penalized directly and independently of inventory, so eating
 * reduces the penalty and has genuine positive ΔU.
 *
 * Calibrated so that Dan prefers eating over exploration at around hunger ≈ 65.
 * At hunger=70 ΔU(eat) ≈ +0.25, which comfortably beats a typical exploration step.
 * At hunger=55 ΔU(eat) ≈ +0.028, so Dan will explore if mildly hungry but not
 * critically so.
 *
 * @param {{ hunger: number }} entity
 * @returns {number}
 */
const HUNGER_PENALTY_THRESHOLD = 40;

function hungerPenalty(entity) {
    const excess = Math.max(0, entity.hunger - HUNGER_PENALTY_THRESHOLD);
    const scale = VITALITY.MAX_HUNGER - HUNGER_PENALTY_THRESHOLD;
    return -((excess / scale) ** 2);
}

/**
 * Exploration value earned by a task — the set of tiles that would be newly
 * seen along all walkTo paths, weighted by proximity to the centroid.
 *
 * Each unseen tile contributes min(1/distance, 1) so tiles near the centroid
 * of known territory (gap-filling) score higher than distant tentacles. Using
 * the accumulated set rather than the final position avoids the pathological
 * case where farming (or any task that moves through known territory) scores 0
 * while doing nothing scores positively from the NPC's current-position view.
 *
 * @param {Set<string>} newTilesSeen - populated by HypotheticalContext.walkTo
 * @param {{ x: number, y: number }} centroid - fixed at _chooseTask time
 * @returns {number}
 */
function explorationUtility(newTilesSeen, centroid) {
    let score = 0;
    for (const key of newTilesSeen) {
        const parts = key.split(',');
        const tx = Number(parts[0]);
        const ty = Number(parts[1]);
        const dist = Math.sqrt((tx - centroid.x) ** 2 + (ty - centroid.y) ** 2);
        score += dist > 0 ? Math.min(1 / dist, 1) : 1;
    }
    return EXPLORE_WEIGHT * score;
}

/**
 * Farming component of Dan's utility function.
 *
 * A planted-crop term gives Dan some intrinsic motivation to maintain crops
 * even when his food stockpile is adequate. The form -0.2 / N is concave and
 * approaches 0 as N grows, so Dan is eager to plant the first few crops but
 * not obsessively so.
 *
 * TODO: This term needs more thought. Key open questions:
 *   - Should it only count *mature* crops (immediate harvest value) vs all
 *     crops (future pipeline value)? Immature crops have time-discounted value
 *     that this static term can't express.
 *   - The weight 0.2 is not derived from anything principled — it should be
 *     calibrated so that planting is preferred to exploration when Dan is
 *     moderately hungry but has seeds, and vice versa when he's sated.
 *   - Planted crops visible in hypo mode are crops Dan already knows about;
 *     they don't capture crops he might discover by exploring.
 *
 * @param {HypotheticalWorld} world
 * @param {number} z
 * @returns {number}
 */
function cropUtility(world, entity) {
    let count = 0;
    world.forEachTile((key, tile) => {
        if (isWheatCropObject(tile.obj)) count++;
    });
    const foodTotalSatiety = -1/foodUtility(entity)
    return -0.2 / Math.max(1, foodTotalSatiety + count);
}

/**
 * @param {DanContext} ctx
 * @param {{ x: number, y: number }} centroid - fixed at _chooseTask time, not recomputed per task
 * @returns {number}
 */
function utility(ctx, centroid) {
    const foodU = foodUtility(ctx.entity);
    const hungerP = hungerPenalty(ctx.entity);
    const explorationU = explorationUtility(ctx.newTilesSeen, centroid);
    const cropU = cropUtility(ctx.world, ctx.entity);
    return foodU + hungerP + explorationU + cropU;
}

/** @typedef {'eat' | 'farm' | 'explore' | 'talk' | null} DanTaskKind */

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
        /** @type {{ x: number, y: number, z: number } | null} */
        this._currentGoal = null;
        /** @type {Record<string, string | null>} */
        this.zoneOwners = {};
        /** @type {PendingTask | null} */
        this._pendingTask = null;
        /** @type {boolean} */
        this._conversing = false;
        /** @type {boolean} */
        this._thinking = false;
        this._actionMemory = new ActionMemory('');
        /** @type {Map<string, DanBrain> | null} */
        this._npcRegistry = null;
        /** @type {string | null} */
        this._lastThinkError = null;
    }

    /**
     * @param {Map<string, DanBrain>} registry
     */
    setNpcRegistry(registry) {
        this._npcRegistry = registry;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this._npc = npc;
        this._actionMemory.selfName = npc.name;
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
        if (this._conversing) return null;
        if (npc.resolvingAction) return null;

        this._gameTime = gameTime;

        if (lastActionResult) {
            this._pendingResult = lastActionResult;
        }

        for (let i = 0; i < MAX_TASK_RESTARTS_PER_TICK; i++) {
            if (!this._taskGen) {
                const memory = getNpcTileMemoryStore(npc);
                if (!memory || memory.size === 0) return null;

                const ctx = new RealContext(npc, this._makeGetWorld(), () => this._gameTime, (name) => this._actionMemory.getLastKnownPosition(name));
                this._taskGen = this._chooseTask(ctx, memory);
                if (!this._taskGen) return null;
            }

            const step = this._taskGen.next(this._pendingResult);
            this._pendingResult = null;

            if (step.done) {
                this._logTaskOutcome(step.value);
                this._taskGen = null;
                this._currentTaskKind = null;
                this._currentGoal = null;
                continue;
            }

            this._logActionYielded(step.value);
            return step.value;
        }

        return null;
    }

    /** @returns {() => HypotheticalWorld} */
    _makeGetWorld() {
        const npc = this._npc;
        return () => {
            const mem = npc ? getNpcTileMemoryStore(npc) : undefined;
            return createHypotheticalFromMemory(mem ?? new Map());
        };
    }

    /**
     * @param {DanTaskFn} taskFn
     * @returns {DanTaskKind}
     */
    _taskKind(taskFn) {
        if (taskFn === eatTask) return 'eat';
        if (taskFn === farmTask) return 'farm';
        if (taskFn === exploreTask) return 'explore';
        if (typeof taskFn === 'function' && taskFn._danTalkTask) return 'talk';
        return null;
    }

    /**
     * @param {BrainTweak} tweak
     */
    applyBrainTweak(tweak) {
        const npc = this._npc;
        if (!npc) return;
        const safe = sanitizeBrainTweak(tweak, npc.name, this._npcRegistry);
        if (safe.updateZoneOwnership) {
            Object.assign(this.zoneOwners, safe.updateZoneOwnership);
        }
        if (safe.addPendingTask) {
            this._pendingTask = safe.addPendingTask;
        }
    }

    /** Player-triggered async think (spec §1). */
    async think() {
        const npc = this._npc;
        if (!npc || !npc.isAlive || this._thinking) return;
        this._thinking = true;
        this._lastThinkError = null;
        try {
            const { system, user } = buildThinkPrompt(npc, this);
            const output = await callThinkLlm(system, user);
            if (output.thought) {
                this._actionMemory.append({
                    subject: npc.name,
                    action: 'think',
                    location: [Math.floor(npc.x), Math.floor(npc.y), npc.z],
                    tick: this._gameTime,
                    details: output.thought,
                });
            }
            if (output.brainTweak) {
                this.applyBrainTweak(output.brainTweak);
            }
        } catch (err) {
            this._lastThinkError = err instanceof Error ? err.message : String(err);
            console.error('[DanBrain] think failed:', err);
        } finally {
            this._thinking = false;
        }
    }

    /**
     * @param {import('../../domain/entityActions.js').EntityAction | null | undefined} action
     */
    _logActionYielded(action) {
        const npc = this._npc;
        if (!npc || !action) return;
        if (isMoveToTileAction(action) || isMoveDirectionAction(action)) {
            const details = isMoveToTileAction(action)
                ? `→ (${action.tileX}, ${action.tileY})`
                : `dir (${action.dx}, ${action.dy})`;
            this._actionMemory.append({
                subject: npc.name,
                action: 'movement',
                location: [Math.floor(npc.x), Math.floor(npc.y), npc.z],
                tick: this._gameTime,
                details,
            });
        }
    }

    /**
     * @param {ActionExecutionResult | undefined} taskResult
     */
    _logTaskOutcome(taskResult) {
        const npc = this._npc;
        if (!npc || this._currentTaskKind !== 'farm') return;
        if (taskResult?.ok) {
            this._actionMemory.append({
                subject: npc.name,
                action: 'farm_action',
                location: [Math.floor(npc.x), Math.floor(npc.y), npc.z],
                tick: this._gameTime,
                details: this._currentGoal
                    ? `farm @ (${this._currentGoal.x}, ${this._currentGoal.y})`
                    : 'farm action',
            });
        }
    }

    /**
     * Record another NPC's position for talk_to pathing.
     *
     * @param {string} name
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {string} [details]
     */
    observeNpc(name, x, y, z, details = 'seen nearby') {
        if (!name || name === this._npc?.name) return;
        const last = this._actionMemory.getLastKnownPosition(name);
        const fx = Math.floor(x);
        const fy = Math.floor(y);
        if (last && last[0] === fx && last[1] === fy && last[2] === z) return;
        this._actionMemory.append({
            subject: name,
            action: 'movement',
            location: [fx, fy, z],
            tick: this._gameTime,
            details,
        });
    }

    /**
     * @param {RealContext} ctx
     * @param {Map<string, import('../../shared/npcMemory.js').TileMemoryEntry>} memory
     * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null> | null}
     */
    _chooseTask(ctx, memory) {
        const centroid = computeCentroid(memory, ctx.entity.z);
        const initialU = utility(ctx, centroid);

        let bestDeltaU = 0;
        /** @type {DanTaskFn | null} */
        let bestTaskFn = null;
        /** @type {HypotheticalContext | null} */
        let bestHypoCtx = null;

        for (const taskFn of BASE_TASKS) {
            const hypo = ctx.hypothetical(memory);
            const runTask =
                taskFn === farmTask
                    ? () => farmTask(hypo, this.zoneOwners)
                    : () => taskFn(hypo);
            drainHypo(runTask());
            const deltaU = utility(hypo, centroid) - initialU;
            if (deltaU > bestDeltaU) {
                bestDeltaU = deltaU;
                bestTaskFn = taskFn;
                bestHypoCtx = hypo;
            }
        }

        const pending = this._pendingTask;
        if (pending?.type === 'talk_to') {
            const hypo = ctx.hypothetical(memory);
            drainHypo(walkToTargetOnly(hypo, pending.target));
            const urgencyBonus = URGENCY_BONUS[pending.urgency] ?? URGENCY_BONUS.normal;
            const deltaU = utility(hypo, centroid) - initialU + urgencyBonus;
            if (deltaU > bestDeltaU) {
                bestDeltaU = deltaU;
                const captured = pending;
                bestTaskFn = (realCtx) => talkToTask(
                    realCtx,
                    captured.target,
                    captured.message,
                    this,
                );
                bestTaskFn._danTalkTask = true;
                bestHypoCtx = hypo;
                this._pendingTask = null;
            }
        }

        if (!bestTaskFn) return null;

        /** @type {DanTaskKind} */
        let taskKind = this._taskKind(bestTaskFn);
        if (bestTaskFn === farmTask) {
            const zoneOwners = this.zoneOwners;
            bestTaskFn = (realCtx) => farmTask(realCtx, zoneOwners);
            taskKind = 'farm';
        }

        this._currentTaskKind = taskKind;
        if (bestHypoCtx) {
            this._currentGoal = {
                x: Math.floor(bestHypoCtx.entity.x),
                y: Math.floor(bestHypoCtx.entity.y),
                z: bestHypoCtx.entity.z,
            };
        } else {
            this._currentGoal = null;
        }

        return bestTaskFn(ctx);
    }

    destroy() {
        this._taskGen?.return(/** @type {ActionExecutionResult} */ ({ ok: false }));
        this._taskGen = null;
        this._currentTaskKind = null;
        this._currentGoal = null;
        this._pendingResult = null;
        this._npc = null;
    }

    /** @returns {{ lines: string[] }} */
    getStatus() {
        if (this._thinking) return { lines: ['thinking…'] };
        if (this._conversing) return { lines: ['in conversation'] };
        if (this._lastThinkError) return { lines: [`think error: ${this._lastThinkError}`] };
        if (this._pendingTask?.type === 'talk_to') {
            return {
                lines: [`pending: talk to ${this._pendingTask.target} (${this._pendingTask.urgency})`],
            };
        }
        if (!this._currentTaskKind) return { lines: ['idle'] };

        switch (this._currentTaskKind) {
            case 'eat':
                return { lines: ['eating'] };
            case 'farm':
                if (this._currentGoal) {
                    const { x, y, z } = this._currentGoal;
                    return { lines: [`farming → (${x}, ${y}, ${z})`] };
                }
                return { lines: ['farming'] };
            case 'explore':
                if (this._currentGoal) {
                    const { x, y, z } = this._currentGoal;
                    return { lines: [`exploring → (${x}, ${y}, ${z})`] };
                }
                return { lines: ['exploring'] };
            case 'talk':
                return { lines: ['talking to another villager'] };
            default:
                return { lines: ['idle'] };
        }
    }
}
