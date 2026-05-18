/**
 * Advance world simulation by one frame (crops, NPC bodies, injected NPC brain).
 * Player is ticked separately — see client/playerController.js or playerSimulation.js.
 */
import { updateCrops } from '../domain/crops.js';
import { tickNpcSimulation } from '../actors/npcSimulation.js';
import { noopNpcBrain } from '../npc/npcBrain.js';
import { tickNpcPerception } from '../npc/npcMemory.js';

/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('../npc/npcBrain.js').NpcBrainTick} NpcBrainTick */

/**
 * @param {object} opts
 * @param {World3D} opts.world
 * @param {number} opts.gameTime - simulation clock before this frame
 * @param {number} opts.dt - seconds
 * @param {NpcEntity[]} [opts.npcs]
 * @param {NpcBrainTick} [opts.npcBrain] - AI after body sim; defaults to no-op
 * @returns {{ gameTime: number }}
 */
export function tickSimulation(opts) {
    const { world, dt, npcs = [], npcBrain = noopNpcBrain } = opts;

    const gameTime = opts.gameTime + dt;
    updateCrops(world, gameTime);

    for (const npc of npcs) {
        tickNpcSimulation(npc, world, dt);
        tickNpcPerception(npc, world, gameTime);
        npcBrain(npc, world, dt);
    }

    return { gameTime };
}
