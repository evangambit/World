/**
 * Assemble four-layer prompts for Dan think and conversation LLM calls.
 */
import { FARM_ZONES } from '../../../../content/builder.js';
import { OBJ_NAMES } from '../../../../world/tileTypes.js';
import { VITALITY } from '../../../../domain/vitality.js';
import { getNpcTileMemoryStore } from '../../../shared/npcMemory.js';
import { getPromptActionSlice } from '../actionMemory.js';
import { buildZoneSummary } from '../zoneUtils.js';

/** @typedef {import('../actionMemory.js').ActionMemoryStore} ActionMemoryStore */
/** @typedef {import('../../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../danBrain.js').DanBrain} DanBrain */

/**
 * @param {NpcEntity} npc
 * @param {Record<string, string | null>} zoneOwners
 * @returns {string}
 */
function buildSystemPrompt(npc) {
    const zoneLines = Object.entries(FARM_ZONES)
        .map(([name, z]) => `- ${name}: ${z.label}`)
        .join('\n');

    return `You are ${npc.name}, a villager in a small farming simulation.

## Game mechanics
- Hunger rises over time; eat bread, steak, or wheat from inventory when hungry.
- Farm loop: plant wheat seeds on bare dirt, harvest mature wheat, cook wheat at a stove into bread.
- You can update beliefs about who owns which farm zone, and queue a talk_to task to coordinate with another villager.

## Farm zones (use only these names in updateZoneOwnership)
${zoneLines}

## Urgency for addPendingTask talk_to
- "low": minor coordination (~beats idle only)
- "normal": routine coordination (beats farming/exploration, loses to acute hunger)
- "high": time-sensitive (beats most tasks except critical survival)

## Response format
Reply with a single JSON object only (no markdown):
{
  "thought": "optional private reasoning, logged to memory",
  "brainTweak": {
    "updateZoneOwnership": { "zone_name": "NPC name or null" },
    "addPendingTask": { "type": "talk_to", "target": "Name", "message": "opening topic", "urgency": "normal" }
  }
}
Both fields in brainTweak are optional. Omit keys you do not need.`;
}

/**
 * @param {NpcEntity} npc
 * @param {DanBrain} brain
 * @returns {string}
 */
function buildStateSnapshot(npc, brain) {
    const hunger = Math.round(npc.hunger);
    const inv = (npc.inventory ?? [])
        .map((s) => `${OBJ_NAMES[s.objType] ?? s.objType}×${s.count}`)
        .join(', ') || 'empty';

    const task = brain._currentTaskKind ?? 'idle';
    const goal = brain._currentGoal
        ? `goal (${brain._currentGoal.x}, ${brain._currentGoal.y}, ${brain._currentGoal.z})`
        : 'no goal';

    return `## Current state
- Hunger: ${hunger} / ${VITALITY.MAX_HUNGER}
- Inventory: ${inv}
- Current task: ${task} — ${goal}`;
}

/**
 * @param {ActionMemoryStore} store
 * @param {string} selfName
 * @returns {string}
 */
function buildActionMemorySection(store, selfName) {
    const slice = getPromptActionSlice(store, selfName);
    if (slice.length === 0) return '## Action memory\n(none yet)';
    const lines = slice.map((e) => {
        const loc = e.location.join(',');
        const other = e.otherPerson ? ` (with ${e.otherPerson})` : '';
        const t = Math.round(e.tick);
        return `- t${t} ${e.subject} ${e.action} @(${loc}): ${e.details}${other}`;
    });
    return `## Action memory\n${lines.join('\n')}`;
}

/**
 * @param {NpcEntity} npc
 * @param {Record<string, string | null>} zoneOwners
 * @param {number} gameTime
 * @returns {string}
 */
function buildZoneSummarySection(npc, zoneOwners, gameTime) {
    const memory = getNpcTileMemoryStore(npc) ?? new Map();
    const summary = buildZoneSummary(memory, zoneOwners, gameTime);
    return `## Farm zones (your knowledge)\n${JSON.stringify(summary, null, 2)}`;
}

/**
 * @param {NpcEntity} npc
 * @param {DanBrain} brain
 * @returns {{ system: string, user: string }}
 */
export function buildThinkPrompt(npc, brain) {
    const system = buildSystemPrompt(npc);
    const user = [
        buildStateSnapshot(npc, brain),
        buildActionMemorySection(brain._actionMemory, npc.name),
        buildZoneSummarySection(npc, brain.zoneOwners, brain._gameTime),
        '',
        'What do you want to do? Reply with JSON only.',
    ].join('\n\n');
    return { system, user };
}

/**
 * @param {NpcEntity} npc
 * @param {DanBrain} brain
 * @param {string} otherName
 * @param {string} otherLastSay
 * @param {string[]} transcript
 * @param {{ openingTurn?: boolean }} [opts]
 * @returns {{ system: string, user: string }}
 */
export function buildConversationPrompt(npc, brain, otherName, otherLastSay, transcript, opts = {}) {
    const system = `${buildSystemPrompt(npc)}

## Conversation turn
You are in a live conversation with ${otherName}. Reply with JSON only:
{
  "say": "what you say aloud",
  "endConversation": false,
  "brainTweak": { ... optional, same as think ... }
}
Set endConversation true when the conversation should end.`;

    const user = [
        buildStateSnapshot(npc, brain),
        buildActionMemorySection(brain._actionMemory, npc.name),
        buildZoneSummarySection(npc, brain.zoneOwners, brain._gameTime),
        '',
        '## Conversation transcript',
        transcript.length ? transcript.join('\n') : '(conversation starting)',
        '',
        opts.openingTurn
            ? `## Opening topic (you speak first)`
            : `## ${otherName} just said`,
        opts.openingTurn
            ? otherLastSay || '(start the conversation)'
            : otherLastSay || '(opening — you speak first)',
        '',
        'Your turn. Reply with JSON only.',
    ].join('\n\n');

    return { system, user };
}
