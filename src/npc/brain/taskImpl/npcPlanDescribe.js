/**
 * Human-readable plan steps for UI / debug.
 */
import { formatPlanRef } from './npcPlanRefs.js';

/** @typedef {import('./npcPlanRunner.js').PlanStep} PlanStep */

/**
 * @param {PlanStep} step
 * @returns {string}
 */
export function describePlanStep(step) {
    if (!step || typeof step.type !== 'string') return '(invalid step)';

    switch (step.type) {
        case 'seq':
            return `seq (${step.steps?.length ?? 0} steps)`;
        case 'sel':
            return `sel (${step.steps?.length ?? 0} branches)`;
        case 'goto': {
            if (step.ref != null) return `goto ${formatPlanRef(step.ref)}`;
            if (step.x != null && step.y != null && step.z != null) {
                return `goto (${step.x}, ${step.y}, ${step.z})`;
            }
            return 'goto';
        }
        case 'find': {
            const pickup = step.pickup === false ? '' : ', pickup';
            return `find ${step.object} (r=${step.radius}${pickup})`;
        }
        case 'explore': {
            const anchor = step.anchor === 'self' ? 'self' : 'home';
            const pickup = step.pickup === false ? '' : ', pickup';
            return `explore ${step.object} (r=${step.radius}, ${anchor}${pickup})`;
        }
        case 'eat':
            return `eat ${step.object}${step.from ? ` from ${step.from}` : ''}${step.pick ? ` (${step.pick})` : ''}`;
        case 'cook':
            return `cook ${step.object}`;
        case 'door':
            return 'door';
        case 'drop':
            return `drop ${step.object}${step.count != null ? ` ×${step.count}` : ''}`;
        case 'take':
            return `take ${step.object} from ${formatPlanRef(step.from)}`;
        case 'stash':
            return `stash ${step.object} → ${formatPlanRef(step.to)}`;
        case 'action': {
            const at = step.ref != null
                ? formatPlanRef(step.ref)
                : (step.x != null ? `(${step.x}, ${step.y}, ${step.z})` : '?');
            return `action ${step.action} @ ${at}`;
        }
        default:
            return step.type;
    }
}

/**
 * @param {PlanStep} root
 * @param {number[]} path
 * @returns {PlanStep | null}
 */
export function getPlanStepAt(root, path) {
    let node = root;
    for (const i of path) {
        const steps = node?.steps;
        if (!Array.isArray(steps) || steps[i] == null) return null;
        node = steps[i];
    }
    return node ?? null;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {boolean}
 */
function pathsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Flatten plan tree for display; marks the active step with ">".
 * @param {PlanStep} root
 * @param {number[]} activePath
 * @returns {string[]}
 */
export function formatPlanOutline(root, activePath = []) {
    /** @type {string[]} */
    const lines = [];

    /** @param {PlanStep} node @param {number[]} path @param {number} depth */
    function walk(node, path, depth) {
        const indent = '  '.repeat(depth);
        const marker = pathsEqual(path, activePath) ? '> ' : '  ';
        lines.push(`${indent}${marker}${describePlanStep(node)}`);
        if ((node.type === 'seq' || node.type === 'sel') && Array.isArray(node.steps)) {
            for (let i = 0; i < node.steps.length; i++) {
                walk(node.steps[i], [...path, i], depth + 1);
            }
        }
    }

    walk(root, [], 0);
    return lines;
}
