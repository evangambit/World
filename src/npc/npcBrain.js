/**
 * NPC brain implementations — injected into tickSimulation.
 */
/** @typedef {import('../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../world/world.js').World3D} World3D */

/** @typedef {(npc: NpcEntity, world: World3D, dt: number) => void} NpcBrainTick */

/** No-op brain for tests and body-only simulation. */
export const noopNpcBrain = () => {};

/**
 * Default game brain: task/plan queue.
 * @param {NpcEntity & { tasks?: { update: (world: World3D) => void } }} npc
 * @param {World3D} world
 */
export function tickNpcTaskBrain(npc, world, _dt) {
    if (npc._dead) return;
    npc.tasks?.update(world);
}
