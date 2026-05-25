/**
 * NPC brain interface — shared types for all brain implementations.
 */

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../world/world.js').World3D} World3D */
/** @typedef {import('../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */
/** @typedef {import('../llm/npcPlanner.js').NpcPlannerFn} NpcPlannerFn */
/** @typedef {import('./taskImpl/npcTasks.js').NPCTaskRunner} NPCTaskRunner */

/**
 * @typedef {Object} NpcTaskBrainOptions
 * @property {NpcPlannerFn} [planner]
 * @property {number} [plannerCooldownMs]
 * @property {boolean} [wanderOnPlannerFailure]
 */

/**
 * @typedef {Object} NpcBrain
 * @property {(npc: NpcEntity) => void} attach
 * @property {(world: World3D, dt: number, gameTime: number) => EntityAction | null | void} tick
 * @property {() => void} [destroy]
 * @property {(npc: NpcEntity, action: EntityAction, world: World3D) => boolean} [applyAction]
 * @property {(npc: NpcEntity, dt: number) => void} [advanceLocomotion]
 * @property {(npc: NpcEntity, tx: number, ty: number, tz: number, world: World3D, opts?: { onto?: boolean }) => Promise<void>} [travelToTile]
 * @property {(x: number, y: number, z: number, entry: TileMemoryEntry) => void} [observeTile]
 * @property {NPCTaskRunner} [tasks]
 */

export {};
