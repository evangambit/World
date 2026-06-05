/**
 * Talk-to task — walk to another NPC and run the conversation orchestrator.
 */
import { runConversationOrchestrator } from '../llm/conversationOrchestrator.js';

/** @typedef {import('../danContext.js').DanContext} DanContext */
/** @typedef {import('../../../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {{ ok: boolean, message?: string }} ActionExecutionResult */
/** @typedef {{ x: number, y: number, z: number } | null} TileCoord */

export const CONVERSATION_RADIUS = 3;

/**
 * Hypothetical walk-only segment for utility estimation.
 *
 * @param {DanContext} ctx
 * @param {TileCoord} targetPos
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* walkToTargetOnly(ctx, targetPos) {
    if (!targetPos) return { ok: true };
    return yield* ctx.walkTo(targetPos);
}

/**
 * @param {import('../interface.js').NpcEntity} entity
 * @param {import('../interface.js').NpcEntity} target
 * @returns {boolean}
 */
export function isWithinConversationRadius(entity, target) {
    if (entity.z !== target.z) return false;
    const px = Math.floor(entity.x);
    const py = Math.floor(entity.y);
    const tx = Math.floor(target.x);
    const ty = Math.floor(target.y);
    return Math.max(Math.abs(px - tx), Math.abs(py - ty)) <= CONVERSATION_RADIUS;
}

import { moveDirectionAction } from '../../../../domain/entityActions.js';

/**
 * @param {import('../danBrain.js').DanBrain} brain
 * @param {string} targetName
 * @returns {import('../danBrain.js').DanBrain | null}
 */
function resolveTargetBrain(brain, targetName) {
    return brain._npcRegistry?.get(targetName) ?? null;
}

/**
 * @param {DanContext} ctx
 * @param {string} targetName
 * @param {string} openingMessage
 * @param {TileCoord} targetPos
 * @param {import('../danBrain.js').DanBrain} brain
 * @returns {Generator<EntityAction, ActionExecutionResult, ActionExecutionResult | null>}
 */
export function* talkToTask(ctx, targetName, openingMessage, targetPos, brain) {
    if (targetPos) {
        const walkResult = yield* ctx.walkTo(targetPos);
        if (!walkResult.ok) return walkResult;
    }

    const targetBrain = resolveTargetBrain(brain, targetName);
    const targetNpc = targetBrain?._npc;
    if (!targetNpc) {
        return { ok: false, message: `Unknown NPC: ${targetName}` };
    }

    for (let attempt = 0; attempt < 120; attempt++) {
        if (isWithinConversationRadius(ctx.entity, targetNpc)) break;
        yield moveDirectionAction(ctx.entity, 0, 0);
    }

    if (!isWithinConversationRadius(ctx.entity, targetNpc)) {
        return { ok: false, message: `${targetName} not nearby for conversation` };
    }

    if (targetBrain && targetBrain !== brain) {
        runConversationOrchestrator(brain, targetBrain, openingMessage).catch((err) => {
            console.error('[DanBrain] conversation failed:', err);
            brain._conversing = false;
            targetBrain._conversing = false;
        });
    }

    return { ok: true };
}
