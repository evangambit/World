/**
 * Machine-readable NPC plan DSL — kept in sync with npcPlanRunner / npcPlanRefs.
 */
import { OBJECT_TAGS } from '../shared/npcObjectTags.js';

export const PLAN_LIMITS = {
    maxSteps: 16,
    maxSelDepth: 2,
};

/** @type {readonly string[]} */
export const PLAN_REF_QUERIES = [
    'rememberLocationsOfNearby(objectTag) — walks to the nearest reachable remembered match; retargets mid-travel if a closer reachable match appears in memory',
];

/** @type {readonly { type: string, summary: string, fields?: string }[]} */
export const PLAN_LEAF_ACTIONS = [
    {
        type: 'goto',
        summary: 'Walk to a tile (adjacent if needed).',
        fields: 'ref (memory query or x, y, z)',
    },
    {
        type: 'find',
        summary: 'Search nearby tiles for an object tag, walk to it, pick up.',
        fields: 'object (tag), radius (tiles), pickup: true',
    },
    {
        type: 'explore',
        summary:
            'Search a wide area for a pickable object: local find, remembered tiles, then grid waypoints from anchor.',
        fields: 'object (tag), radius (tiles from anchor), anchor: "home"|"self", pickup: true',
    },
    {
        type: 'eat',
        summary: 'Eat matching food from inventory; lowers hunger.',
        fields: 'from: "inventory", object (tag), pick: "random" (optional)',
    },
    {
        type: 'cook',
        summary: 'Cook uncooked food in inventory (e.g. uncooked steak → steak).',
        fields: 'object (tag, e.g. uncooked_food)',
    },
    {
        type: 'door',
        summary: 'Toggle lock on adjacent door (needs key in inventory if locking).',
        fields: '(none)',
    },
    {
        type: 'drop',
        summary: 'Drop tagged items from inventory onto the ground nearby.',
        fields: 'object (tag), count (optional)',
    },
    {
        type: 'take',
        summary: 'Take tagged items from a container at a ref.',
        fields: 'object (tag), from (ref)',
    },
    {
        type: 'stash',
        summary: 'Put tagged items from inventory into a container at a ref.',
        fields: 'object (tag), to (ref)',
    },
    {
        type: 'action',
        summary: 'Walk adjacent and perform a timed world action (e.g. clear_grass).',
        fields: 'action (id), ref OR x, y, z',
    },
];

export const VITALITY_RULES = {
    hungerRange: '0 (full) to 100 (starving)',
    hungerRate: 'Hunger rises continuously while alive.',
    starve: 'At hunger 100 you lose health until you die unless you eat.',
    eat: 'Use the eat step with object tags like edible_food to reduce hunger.',
};

/**
 * @returns {string[]}
 */
export function listObjectTagNames() {
    return Object.keys(OBJECT_TAGS);
}

/**
 * @param {string} tag
 * @returns {string}
 */
export function describeObjectTag(tag) {
    const spec = OBJECT_TAGS[tag];
    if (!spec) return tag;
    return `${tag} (inventory types: ${spec.inventoryTypes.length}, world types: ${spec.worldTypes.length})`;
}
