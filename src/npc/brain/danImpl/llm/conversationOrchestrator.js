/**
 * Async conversation orchestrator — ping-pong LLM turns outside the tick loop.
 */
import { callConversationLlm } from './llmClient.js';
import { buildConversationPrompt } from './thinkPrompt.js';
import { sanitizeBrainTweak } from '../brainTweak.js';

/** @typedef {import('../danBrain.js').DanBrain} DanBrain */

export const MAX_CONVERSATION_TURNS = 10;

/**
 * @param {DanBrain} initiatorBrain
 * @param {DanBrain} responderBrain
 * @param {string} openingMessage
 * @returns {Promise<void>}
 */
export async function runConversationOrchestrator(initiatorBrain, responderBrain, openingMessage) {
    const initiator = initiatorBrain._npc;
    const responder = responderBrain._npc;
    if (!initiator || !responder) return;

    initiatorBrain._conversing = true;
    responderBrain._conversing = true;

    /** @type {string[]} */
    const transcript = [];
    let otherLastSay = openingMessage;
    /** @type {DanBrain} */
    let activeBrain = initiatorBrain;
    /** @type {DanBrain} */
    let passiveBrain = responderBrain;

    try {
        for (let turn = 0; turn < MAX_CONVERSATION_TURNS; turn++) {
            const activeNpc = activeBrain._npc;
            const passiveNpc = passiveBrain._npc;
            if (!activeNpc || !passiveNpc) break;

            const { system, user } = buildConversationPrompt(
                activeNpc,
                activeBrain,
                passiveNpc.name,
                otherLastSay,
                transcript,
                {
                    openingTurn: turn === 0 && activeBrain === initiatorBrain,
                },
            );

            const output = await callConversationLlm(system, user);
            const line = `${activeNpc.name}: ${output.say}`;
            transcript.push(line);

            const loc = [
                Math.floor(activeNpc.x),
                Math.floor(activeNpc.y),
                activeNpc.z,
            ];
            const tick = activeBrain._gameTime;
            const entry = {
                subject: activeNpc.name,
                action: /** @type {'conversation'} */ ('conversation'),
                location: /** @type {[number, number, number]} */ (loc),
                tick,
                details: output.say,
                otherPerson: passiveNpc.name,
            };
            activeBrain._actionMemory.append(entry);
            passiveBrain._actionMemory.append({ ...entry });

            if (output.brainTweak) {
                const tweak = sanitizeBrainTweak(
                    output.brainTweak,
                    activeNpc.name,
                    activeBrain._npcRegistry,
                );
                activeBrain.applyBrainTweak(tweak);
            }

            if (output.endConversation) break;

            otherLastSay = output.say;
            [activeBrain, passiveBrain] = [passiveBrain, activeBrain];
        }
    } finally {
        initiatorBrain._conversing = false;
        responderBrain._conversing = false;
    }
}
