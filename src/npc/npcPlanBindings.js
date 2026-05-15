/**
 * Resolve plan binding queries into tile refs for goto / take / stash steps.
 */
import { Obj, isContainerObject } from '../world/tiles.js';

/** @typedef {{ x: number, y: number, z: number }} TileRef */

/**
 * @typedef {Object} BindingQuerySpec
 * @property {string} query
 */

/**
 * @param {import('../actors/npc.js').NPC} npc
 * @param {import('../world/world.js').World3D} world
 * @param {Record<string, BindingQuerySpec>} bindingSpecs
 * @returns {Record<string, TileRef | null>}
 */
export function resolvePlanBindings(npc, world, bindingSpecs) {
  /** @type {Record<string, TileRef | null>} */
  const resolved = {};
  for (const [name, spec] of Object.entries(bindingSpecs ?? {})) {
      resolved[name] = runBindingQuery(npc, world, spec);
  }
  return resolved;
}

/**
* @param {import('../actors/npc.js').NPC} npc
* @param {import('../world/world.js').World3D} world
* @param {BindingQuerySpec} spec
* @returns {TileRef | null}
*/
function runBindingQuery(npc, world, spec) {
  if (spec.query === 'whereIsMyKitchen') {
      return whereIsMyKitchen(npc, world);
  }
  if (spec.query === 'whereIsHomeChest') {
      return whereIsHomeChest(npc, world);
  }
  throw new Error(`Unknown binding query: ${spec.query}`);
}

/**
* @param {import('../actors/npc.js').NPC} npc
* @param {import('../world/world.js').World3D} _world
* @returns {TileRef | null}
*/
function whereIsMyKitchen(npc, _world) {
  if (npc.homeX == null || npc.homeY == null || npc.homeZ == null) return null;
  return { x: npc.homeX, y: npc.homeY, z: npc.homeZ };
}

/**
 * @param {import('../actors/npc.js').NPC} npc
 * @param {import('../world/world.js').World3D} world
 * @returns {TileRef | null}
 */
function whereIsHomeChest(npc, world) {
  if (npc.homeX == null || npc.homeY == null || npc.homeZ == null) return null;
  const bid = world.getBuildingId(npc.homeX, npc.homeY, npc.homeZ);
  if (bid == null) return null;

  for (const [key, tile] of world.tiles) {
      if (!isContainerObject(tile.obj) || tile.buildingId !== bid) continue;
      const parts = key.split(',').map(Number);
      const x = parts[0];
      const y = parts[1];
      const z = parts[2];
      if (z !== npc.homeZ) continue;
      if (tile.obj === Obj.CHEST) return { x, y, z };
  }
  return null;
}
