/**
 * Execute NPC plans — seq / sel combinators and leaf steps.
 */
import { getObjectTagSpec } from './npcObjectTags.js';
import { cookUncookedSteakInInventory } from './cooking.js';
import { runGoTo, runFind } from './npcTaskPrimitives.js';

/** @typedef {{ x: number, y: number, z: number }} TileRef */

/**
 * @typedef {Object} PlanStep
 * @property {string} type
 * @property {PlanStep[]} [steps]
 * @property {string} [ref]
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {string} [object]
 * @property {number} [radius]
 * @property {string} [near]
 * @property {boolean} [pickup]
 * @property {string} [from]
 * @property {string} [pick]
 * @property {number} [buildingId]
 */

/** @typedef {{ ok: true } | { ok: false, error: Error }} PlanResult */

const LEAF_TYPES = new Set(['goto', 'find', 'eat', 'cook']);
const COMPOSITE_TYPES = new Set(['seq', 'sel']);

/**
 * @param {PlanStep} plan
 * @param {{ maxSteps?: number, maxSelDepth?: number }} [limits]
 * @returns {string|null}
 */
export function validatePlan(plan, limits = {}) {
    const maxSteps = limits.maxSteps ?? 16;
    const maxSelDepth = limits.maxSelDepth ?? 2;
    let steps = 0;
    let maxDepth = 0;

    /** @param {PlanStep} node @param {number} selDepth */
    function walk(node, selDepth) {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
            return 'Plan node must be an object with a type';
        }
        steps += 1;
        if (steps > maxSteps) return `Plan exceeds max step count (${maxSteps})`;

        if (COMPOSITE_TYPES.has(node.type)) {
            if (!Array.isArray(node.steps) || node.steps.length === 0) {
                return `${node.type} requires a non-empty steps array`;
            }
            const nextSelDepth = node.type === 'sel' ? selDepth + 1 : selDepth;
            if (nextSelDepth > maxSelDepth) {
                return `Plan exceeds max sel nesting depth (${maxSelDepth})`;
            }
            maxDepth = Math.max(maxDepth, nextSelDepth);
            for (const child of node.steps) {
                const err = walk(child, nextSelDepth);
                if (err) return err;
            }
            return null;
        }

        if (!LEAF_TYPES.has(node.type)) return `Unknown plan step type: ${node.type}`;
        if (node.type === 'goto' && node.ref == null && (node.x == null || node.y == null || node.z == null)) {
            return 'goto requires ref or x, y, z';
        }
        if (node.type === 'find') {
            if (!node.object) return 'find requires object tag';
            if (node.radius == null) return 'find requires radius';
        }
        if (node.type === 'eat' || node.type === 'cook') {
            if (!node.object) return `${node.type} requires object tag`;
        }
        return null;
    }

    return walk(plan, 0);
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
 * @param {PlanStep} plan
 * @param {Record<string, TileRef | null>} bindings
 * @returns {Promise<PlanResult>}
 */
export async function runPlan(npc, world, plan, bindings) {
    return executeNode(npc, world, plan, bindings);
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
 * @param {PlanStep} node
 * @param {Record<string, TileRef | null>} bindings
 * @returns {Promise<PlanResult>}
 */
async function executeNode(npc, world, node, bindings) {
    if (node.type === 'seq') {
        for (const step of node.steps ?? []) {
            const result = await executeNode(npc, world, step, bindings);
            if (!result.ok) return result;
        }
        return { ok: true };
    }

    if (node.type === 'sel') {
        /** @type {PlanResult | null} */
        let lastFailure = null;
        for (const step of node.steps ?? []) {
            const result = await executeNode(npc, world, step, bindings);
            if (result.ok) return result;
            lastFailure = result;
        }
        return lastFailure ?? { ok: false, error: new Error('sel: no branches') };
    }

    try {
        await executeLeaf(npc, world, node, bindings);
        return { ok: true };
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        return { ok: false, error };
    }
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {import('./world.js').World3D} world
 * @param {PlanStep} step
 * @param {Record<string, TileRef | null>} bindings
 */
async function executeLeaf(npc, world, step, bindings) {
    if (step.type === 'goto') {
        const target = resolveGotoTarget(step, bindings);
        if (!target) throw new Error(`goto: unbound ref ${step.ref}`);
        await runGoTo(npc, world, target.x, target.y, target.z);
        return;
    }

    if (step.type === 'find') {
        const spec = getObjectTagSpec(step.object);
        const objType = spec.worldTypes[0];
        if (objType == null) {
            throw new Error(`find: object tag ${step.object} has no world types`);
        }
        if (step.pickup === false) {
            throw new Error('find without pickup is not implemented');
        }
        await runFind(npc, world, objType, step.radius, step.buildingId);
        return;
    }

    if (step.type === 'cook') {
        cookFromInventory(npc, step.object);
        return;
    }

    if (step.type === 'eat') {
        if (step.from && step.from !== 'inventory') {
            throw new Error(`eat: unsupported from ${step.from}`);
        }
        eatFromInventory(npc, step.object, step.pick);
        return;
    }

    throw new Error(`Unknown plan step type: ${step.type}`);
}

/**
 * @param {PlanStep} step
 * @param {Record<string, TileRef | null>} bindings
 * @returns {TileRef | null}
 */
function resolveGotoTarget(step, bindings) {
    if (step.ref != null) {
        return bindings[step.ref] ?? null;
    }
    if (step.x != null && step.y != null && step.z != null) {
        return { x: step.x, y: step.y, z: step.z };
    }
    return null;
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {string} objectTag
 */
function cookFromInventory(npc, objectTag) {
    const spec = getObjectTagSpec(objectTag);
    if (spec.inventoryTypes.includes(Obj.UNCOOKED_STEAK)) {
        if (!cookUncookedSteakInInventory(npc.inventory)) {
            throw new Error(`cook: no ${objectTag} in inventory`);
        }
        return;
    }

    const fromType = spec.inventoryTypes[0];
    const edibleSpec = getObjectTagSpec('edible_food');
    const toType = edibleSpec.inventoryTypes[0];
    if (fromType == null || toType == null) {
        throw new Error(`cook: cannot map ${objectTag} to edible_food`);
    }

    const stack = npc.inventory.find((e) => e.objType === fromType && e.count > 0);
    if (!stack) throw new Error(`cook: no ${objectTag} in inventory`);

    stack.count -= 1;
    if (stack.count <= 0) {
        const idx = npc.inventory.indexOf(stack);
        if (idx >= 0) npc.inventory.splice(idx, 1);
    }

    const cooked = npc.inventory.find((e) => e.objType === toType);
    if (cooked) cooked.count += 1;
    else npc.inventory.push({ objType: toType, count: 1 });
}

/**
 * @param {import('./npc.js').NPC} npc
 * @param {string} objectTag
 * @param {string} [pick]
 */
function eatFromInventory(npc, objectTag, pick) {
    const spec = getObjectTagSpec(objectTag);
    const stacks = npc.inventory.filter(
        (e) => spec.inventoryTypes.includes(e.objType) && e.count > 0,
    );
    if (stacks.length === 0) throw new Error(`eat: no ${objectTag} in inventory`);

    /** @type {typeof stacks[0]} */
    let stack;
    if (pick === 'random') {
        const total = stacks.reduce((sum, e) => sum + e.count, 0);
        let roll = Math.floor(Math.random() * total);
        stack = stacks[stacks.length - 1];
        for (const candidate of stacks) {
            roll -= candidate.count;
            if (roll < 0) {
                stack = candidate;
                break;
            }
        }
    } else {
        stack = stacks[0];
    }

    stack.count -= 1;
    if (stack.count <= 0) {
        const idx = npc.inventory.indexOf(stack);
        if (idx >= 0) npc.inventory.splice(idx, 1);
    }
}
