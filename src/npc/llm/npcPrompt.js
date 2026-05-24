/**
 * Build LLM prompts for NPC plan authoring.
 */
import { VITALITY } from '../../domain/vitality.js';
import { EAT_FOOD_PLAN } from '../brain/taskImpl/npcPlanTemplates.js';
import { OBJECT_TAGS } from '../shared/npcObjectTags.js';
import {
    PLAN_REF_QUERIES,
    PLAN_LEAF_ACTIONS,
    PLAN_LIMITS,
    VITALITY_RULES,
    describeObjectTag,
    listObjectTagNames,
} from './npcActionCatalog.js';
import { formatPlanHistorySection } from '../brain/taskImpl/npcPlanHistory.js';
import { formatSurroundingsSection } from '../shared/tileChunkDescribe.js';

/** @typedef {import('../brain/taskImpl/npcPlanHistory.js').PlanHistoryRecord} PlanHistoryRecord */

/** @typedef {import('../brain/taskImpl/npcTasks.js').PlanDocument} PlanDocument */

/**
 * @typedef {'idle' | 'plan_completed' | 'plan_failed'} PlannerReason
 */

/**
 * @typedef {Object} PlannerEvent
 * @property {PlannerReason} reason
 * @property {string} [goal]
 * @property {string} [error]
 * @property {string} [failedStep] - human-readable step that failed (latest attempt)
 * @property {string} [position] - NPC tile at failure, e.g. "(12, 30, 0)"
 * @property {PlanHistoryRecord[]} [recentPlans] - prior plan outcomes, oldest first
 * @property {import('../shared/tileChunkDescribe.js').ChunkDiffResult[]} [chunkDiffs] - optional chunk diffs (caller-computed)
 */

/**
 * @typedef {Object} BuildPromptOptions
 * @property {import('../../world/world.js').World3D} [world] - marks empty cells vs unseen in chunk text
 */

/**
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @returns {Record<string, number>}
 */
export function summarizeInventoryByTag(npc) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const tag of listObjectTagNames()) {
        counts[tag] = 0;
    }
    for (const entry of npc.inventory ?? []) {
        if (!entry?.count) continue;
        for (const [tag, spec] of Object.entries(OBJECT_TAGS)) {
            if (spec.inventoryTypes.includes(entry.objType)) {
                counts[tag] = (counts[tag] ?? 0) + entry.count;
            }
        }
    }
    return counts;
}

/**
 * @param {string} [name]
 * @returns {string}
 */
export function buildSystemPrompt(name = 'Villager') {
    const tags = listObjectTagNames().map(describeObjectTag).join('; ');
    const leaves = PLAN_LEAF_ACTIONS.map(
        (a) => `- ${a.type}: ${a.summary} Fields: ${a.fields ?? 'none'}.`,
    ).join('\n');
    const refQueries = PLAN_REF_QUERIES.map((q) => `- ${q}`).join('\n');
    const example = JSON.stringify(EAT_FOOD_PLAN, null, 2);

    return [
        `You are ${name}, a villager in a small world. You choose what to do next by writing one JSON plan document; the game engine runs it step by step without asking you again until the plan finishes or fails.`,
        '',
        '## Starvation',
        `- Hunger is ${VITALITY_RULES.hungerRange} (max ${VITALITY.MAX_HUNGER}).`,
        `- ${VITALITY_RULES.hungerRate}`,
        `- ${VITALITY_RULES.starve}`,
        `- ${VITALITY_RULES.eat}`,
        '',
        '## Plan language',
        '- seq: run steps in order; stop on first failure.',
        '- sel: try each branch in order; succeed on first branch that completes.',
        `- Limits: at most ${PLAN_LIMITS.maxSteps} nodes total, sel nesting depth at most ${PLAN_LIMITS.maxSelDepth}.`,
        '',
        '## Leaf actions',
        leaves,
        '',
        '## Object tags (use these in object fields, not raw type ids)',
        tags,
        '',
        '## Location refs (use in ref fields for goto, take, stash, action)',
        refQueries,
        'Example: { "type": "goto", "ref": "rememberLocationsOfNearby(stove)" } walks to the nearest reachable remembered stove and retargets if a closer one is seen while traveling.',
        '',
        '## Output',
        'Reply with a single JSON object only (no markdown):',
        '{ "goal": string, "plan": { "type": "seq"|"sel", "steps": [...] } }',
        '',
        'Example plan for eating when hungry:',
        example,
    ].join('\n');
}

/**
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlannerEvent} event
 * @returns {string}
 */
export function buildUserPrompt(npc, event, options = {}) {
    const hunger = Math.round(npc.hunger ?? 0);
    const health = Math.round(npc.health ?? 0);
    const inv = summarizeInventoryByTag(npc);
    const invLines = Object.entries(inv)
        .filter(([, n]) => n > 0)
        .map(([tag, n]) => `${tag}: ${n}`)
        .join(', ');
    const home =
        npc.homeX != null
            ? `(${npc.homeX}, ${npc.homeY}, ${npc.homeZ})`
            : 'unknown';

    const lines = [
        `## State`,
        `hunger: ${hunger} / ${VITALITY.MAX_HUNGER}`,
        `health: ${health} / ${VITALITY.MAX_HEALTH}`,
        `inventory: ${invLines || '(empty)'}`,
        `home: ${home}`,
        '',
        `## Event`,
        `reason: ${event.reason}`,
    ];

    if (event.goal) lines.push(`goal: ${event.goal}`);
    if (event.error) lines.push(`error: ${event.error}`);
    if (event.failedStep) lines.push(`failed_step: ${event.failedStep}`);
    if (event.position) lines.push(`position: ${event.position}`);

    if (event.reason === 'idle') {
        lines.push('', 'The queue is empty. Choose a new plan or the character will wander.');
    } else if (event.reason === 'plan_completed') {
        lines.push('', 'Your last plan finished successfully. Choose what to do next.');
    } else if (event.reason === 'plan_failed') {
        lines.push(
            '',
            'Your last plan failed (see recent plans and error above). Choose a different plan that avoids the same mistake.',
        );
    }

    const historyLines = formatPlanHistorySection(event.recentPlans ?? []);
    if (historyLines.length > 0) {
        lines.push('', ...historyLines);
    }

    const surroundings = formatSurroundingsSection(npc, {
        world:
            options.world && typeof options.world.getTile === 'function'
                ? options.world
                : undefined,
        chunkDiffs: event.chunkDiffs,
    });
    if (surroundings.length > 0) {
        lines.push('', ...surroundings);
    }

    return lines.join('\n');
}

/**
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlannerEvent} event
 * @returns {{ system: string, user: string }}
 */
export function buildPlannerMessages(npc, event, options = {}) {
    return {
        system: buildSystemPrompt(npc.name ?? 'Villager'),
        user: buildUserPrompt(npc, event, options),
    };
}

/**
 * Log outbound planner prompts (mock and real LLM share this path).
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlannerEvent} event
 * @param {{ system: string, user: string }} messages
 */
export function logPlannerMessages(npc, event, messages) {
    const name = npc.name ?? 'NPC';
    const label = `[NPC ${name}] planner → LLM (${event.reason})`;

    if (typeof console.groupCollapsed === 'function') {
        console.groupCollapsed(label);
        console.log('event', event);
        console.log('system\n', messages.system);
        console.log('user\n', messages.user);
        console.groupEnd();
        return;
    }

    console.log(label);
    console.log('event', event);
    console.log('system\n', messages.system);
    console.log('user\n', messages.user);
}

/**
 * @typedef {Object} PlannerResponseLog
 * @property {number} [attempt]
 * @property {string} [content] - raw model text
 * @property {boolean} [cached] - served from localStorage, not the API
 * @property {import('../brain/taskImpl/npcTasks.js').PlanDocument} [plan] - parsed plan document
 * @property {string} [error]
 * @property {null} [result] - explicit null result (mock idle, exhausted retries)
 */

/**
 * Log planner responses (raw LLM text, parsed plan, or null).
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlannerEvent} event
 * @param {PlannerResponseLog} response
 */
export function logPlannerResponse(npc, event, response) {
    const name = npc.name ?? 'NPC';
    const attemptSuffix =
        response.attempt != null ? ` attempt ${response.attempt}` : '';
    const label = `[NPC ${name}] planner ← LLM (${event.reason})${attemptSuffix}`;

    const logBody = () => {
        console.log('event', event);
        if (response.cached) {
            console.log('(localStorage cache hit)');
        }
        if (response.content != null) {
            console.log('content\n', response.content);
        }
        if (response.plan != null) {
            console.log('plan\n', JSON.stringify(response.plan, null, 2));
        }
        if (response.error != null) {
            console.log('error', response.error);
        }
        if (response.result === null) {
            console.log('result', null);
        }
    };

    if (typeof console.groupCollapsed === 'function') {
        console.groupCollapsed(label);
        logBody();
        console.groupEnd();
        return;
    }

    console.log(label);
    logBody();
}
