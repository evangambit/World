/**
 * Resolve plan binding queries into tile refs for goto steps.
 */
/** @typedef {{ x: number, y: number, z: number }} TileRef */

/**
 * @typedef {Object} BindingQuerySpec
 * @property {string} query
 */

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
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
* @param {import('./npc.js').NPC} npc
* @param {import('./world.js').World3D} world
* @param {BindingQuerySpec} spec
* @returns {TileRef | null}
*/
function runBindingQuery(npc, world, spec) {
  if (spec.query === 'whereIsMyKitchen') {
      return whereIsMyKitchen(npc, world);
  }
  throw new Error(`Unknown binding query: ${spec.query}`);
}

/**
* @param {import('./npc.js').NPC} npc
* @param {import('./world.js').World3D} _world
* @returns {TileRef | null}
*/
function whereIsMyKitchen(npc, _world) {
  if (npc.homeX == null || npc.homeY == null || npc.homeZ == null) return null;
  return { x: npc.homeX, y: npc.homeY, z: npc.homeZ };
}
