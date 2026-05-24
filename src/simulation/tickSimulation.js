/**
 * Advance world simulation by one frame (crops, NPC bodies, per-NPC brain).
 * Player is ticked separately — see client/playerController.js or playerSimulation.js.
 */
import { updateCrops } from '../domain/crops.js';

/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @param {object} opts
 * @param {World3D} opts.world
 * @param {number} opts.gameTime - simulation clock before this frame
 * @param {number} opts.dt - seconds
 * @param {NpcEntity[]} [opts.npcs]
 * @returns {{ gameTime: number }}
 */
export function tickSimulation(opts) {
    const { world, dt, npcs = [] } = opts;

    const gameTime = opts.gameTime + dt;
    updateCrops(world, gameTime);

    for (const npc of npcs) {
        npc.tick(world, dt, gameTime);
    }

    return { gameTime };
}
