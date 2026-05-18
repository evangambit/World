/**
 * Build LLM prompts for NPC plan authoring.
 */
import { VITALITY } from '../../domain/vitality.js';
import { EAT_FOOD_PLAN } from '../npcPlanTemplates.js';
import { OBJECT_TAGS } from '../npcObjectTags.js';
import {
    BINDING_QUERIES,
    PLAN_LEAF_ACTIONS,
    PLAN_LIMITS,
    VITALITY_RULES,
    describeObjectTag,
    listObjectTagNames,
} from './npcActionCatalog.js';

/** @typedef {import('../npcTasks.js').PlanDocument} PlanDocument */

/**
 * @typedef {'idle' | 'plan_completed' | 'plan_failed'} PlannerReason
 */

/**
 * @typedef {Object} PlannerEvent
 * @property {PlannerReason} reason
 * @property {string} [goal]
 * @property {string} [error]
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
    const bindings = BINDING_QUERIES.map((q) => `- ${q}`).join('\n');
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
        '## Binding queries (declare in bindings, reference with ref in steps)',
        bindings,
        'Example: "my_kitchen": { "query": "whereIsMyKitchen" } then { "type": "goto", "ref": "my_kitchen" }.',
        '',
        '## Output',
        'Reply with a single JSON object only (no markdown):',
        '{ "goal": string, "bindings"?: { [name]: { "query": string } }, "plan": { "type": "seq"|"sel", "steps": [...] } }',
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
export function buildUserPrompt(npc, event) {
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

    if (event.reason === 'idle') {
        lines.push('', 'The queue is empty. Choose a new plan or the character will wander.');
    } else if (event.reason === 'plan_completed') {
        lines.push('', 'Your last plan finished successfully. Choose what to do next.');
    } else if (event.reason === 'plan_failed') {
        lines.push('', 'Your last plan failed. Choose a different plan.');
    }

    return lines.join('\n');
}

/**
 * @param {import('../../actors/npcSimulation.js').NpcEntity} npc
 * @param {PlannerEvent} event
 * @returns {{ system: string, user: string }}
 */
export function buildPlannerMessages(npc, event) {
    return {
        system: buildSystemPrompt(npc.name ?? 'Villager'),
        user: buildUserPrompt(npc, event),
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
