/**
 * Legacy locomotion helpers — brains now drive movement via per-tick actions.
 */
/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */

/**
 * @param {object} _host
 * @param {NpcEntity} npc
 * @returns {boolean}
 */
export function isHostMoving(_host, npc) {
    void npc;
    return false;
}

/**
 * @param {object} host
 */
export function initBrainLocomotionHost(host) {
    host._locomotion = null;
    host._trip = null;
}

/**
 * @param {object} host
 */
export function destroyBrainLocomotionHost(host) {
    host._locomotion = null;
    host._trip = null;
}
