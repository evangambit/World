/**
 * NPC brain interface — shared types for all brain implementations.
 */

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../world/world.js').World3D} World3D */
/** @typedef {import('../shared/npcMemory.js').TileMemoryEntry} TileMemoryEntry */

/**
 * @typedef {Object} NpcBrain
 * @property {(npc: NpcEntity) => void} attach
 * @property {(world: World3D, dt: number, gameTime: number) => EntityAction | null | void} tick
 * @property {() => void} [destroy]
 * @property {(x: number, y: number, z: number, entry: TileMemoryEntry) => void} [observeTile]
 * @property {() => { lines: string[] }} [getStatus]
 */

export {};
