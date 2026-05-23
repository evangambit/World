/**
 * Attach a brain to an NPC entity.
 */

/** @typedef {import('./interface.js').NpcBrain} NpcBrain */
/** @typedef {import('./interface.js').NpcEntity} NpcEntity */

/**
 * @param {NpcEntity} npc
 * @param {NpcBrain} brain
 * @returns {NpcBrain}
 */
export function attachNpcBrain(npc, brain) {
    npc.brain = brain;
    brain.attach(npc);
    return brain;
}
