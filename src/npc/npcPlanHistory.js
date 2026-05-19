/**
 * Rolling log of executed plans for LLM context.
 */

/** @typedef {'completed' | 'failed'} PlanOutcome */

/**
 * @typedef {Object} PlanHistoryRecord
 * @property {string} goal
 * @property {PlanOutcome} outcome
 * @property {string} [error]
 * @property {string} [failedStep]
 * @property {string} [position] - tile coords at outcome time, e.g. "(12, 30, 0)"
 */

export const MAX_PLAN_HISTORY = 6;

/**
 * @param {PlanHistoryRecord} record
 * @returns {string}
 */
export function formatPlanHistoryEntry(record) {
    const pos = record.position ? ` @ ${record.position}` : '';
    if (record.outcome === 'completed') {
        return `${record.goal} — completed${pos}`;
    }
    const step = record.failedStep ? ` at ${record.failedStep}` : '';
    const err = record.error ? `: ${record.error}` : '';
    return `${record.goal} — failed${step}${err}${pos}`;
}

/**
 * @param {PlanHistoryRecord[]} records oldest first
 * @returns {string[]}
 */
export function formatPlanHistorySection(records) {
    if (!records.length) return [];
    return [
        '## Recent plans (oldest first)',
        ...records.map((r, i) => `${i + 1}. ${formatPlanHistoryEntry(r)}`),
    ];
}
