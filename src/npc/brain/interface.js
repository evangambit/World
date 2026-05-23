/**
 * NPC brain interface — shared types for all brain implementations.
 */

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../world/world.js').World3D} World3D */
/** @typedef {import('../npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('../llm/npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {import('../npcTasks.js').NPCTaskRunner} NPCTaskRunner */

/**
 * @typedef {Object} NpcTaskBrainOptions
 * @property {NpcPlannerFn} [planner]
 * @property {number} [plannerCooldownMs]
 * @property {boolean} [wanderOnPlannerFailure]
 */

/**
 * @typedef {Object} NpcBrain
 * @property {(npc: NpcEntity) => void} attach
 * @property {(world: World3D, dt: number, gameTime: number) => void} tick
 * @property {() => void} [destroy]
 * @property {(x: number, y: number, z: number, entry: TileMemoryEntry) => void} [observeTile]
 * @property {NPCTaskRunner} [tasks]
 */

export {};
