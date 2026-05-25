/**
 * Shared locomotion + travel promise handling for brains that return move actions.
 */
import { isMoveAction } from '../../actors/npcActions.js';
import { isEntityActionComplete } from '../../domain/entityActions.js';
import { isAtMoveGoal } from './pathUtils.js';
import {
    advanceBrainLocomotion,
    beginBrainMove,
    clearBrainLocomotion,
    createBrainLocomotion,
    isBrainLocomotionActive,
    remainingBrainLocomotionSteps,
} from './brainLocomotion.js';

/** @typedef {import('../../actors/npcSimulation.js').NpcEntity} NpcEntity */
/** @typedef {import('../../domain/entityActions.js').EntityAction} EntityAction */
/** @typedef {import('../../world/world.js').World3D} World3D */

/**
 * @typedef {Object} NpcTrip
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {boolean} onto
 * @property {() => void} resolve
 * @property {(err: Error) => void} reject
 */

/**
 * @param {object} host - brain instance (receives _locomotion, _trip)
 */
export function initBrainLocomotionHost(host) {
    host._locomotion = createBrainLocomotion();
    host._trip = null;
}

/**
 * @param {object} host
 */
export function destroyBrainLocomotionHost(host) {
    if (host._trip) {
        host._trip.reject(new Error('dead'));
        host._trip = null;
    }
    if (host._locomotion) {
        clearBrainLocomotion(host._locomotion);
    }
}

/**
 * @param {object} host
 * @param {NpcEntity} npc
 * @returns {boolean}
 */
export function isHostMoving(host, npc) {
    if (isBrainLocomotionActive(host._locomotion)) return true;
    if (npc.currentAction && isMoveAction(npc.currentAction)) {
        return !isEntityActionComplete(npc.currentAction, npc);
    }
    return false;
}

/**
 * @param {object} host
 * @param {NpcEntity} npc
 * @param {EntityAction} action
 * @param {World3D} world
 * @returns {boolean}
 */
export function applyHostAction(host, npc, action, world) {
    if (!isMoveAction(action)) {
        return action.apply(world);
    }
    if (isEntityActionComplete(action, npc)) {
        return true;
    }
    return beginBrainMove(host._locomotion, npc, action.goal, world);
}

/**
 * @param {object} host
 * @param {NpcEntity} npc
 * @param {number} dt
 */
export function advanceHostLocomotion(host, npc, dt) {
    if (!isBrainLocomotionActive(host._locomotion)) {
        tryFinishHostTrip(host, npc);
        return;
    }
    advanceBrainLocomotion(host._locomotion, npc, dt);
    tryFinishHostTrip(host, npc);
}

/**
 * @param {object} host
 * @param {NpcEntity} npc
 */
function tryFinishHostTrip(host, npc) {
    const trip = host._trip;
    if (!trip) return;
    if (isAtMoveGoal(npc, { tx: trip.x, ty: trip.y, tz: trip.z, onto: trip.onto })) {
        host._trip = null;
        trip.resolve();
    }
}

/**
 * @param {object} host
 * @param {NpcEntity} npc
 * @param {number} tx
 * @param {number} ty
 * @param {number} tz
 * @param {World3D} world
 * @param {{ onto?: boolean }} [opts]
 * @returns {Promise<void>}
 */
export function hostTravelToTile(host, npc, tx, ty, tz, world, opts = {}) {
    const onto = opts.onto !== false;

    if (npc._dead) {
        return Promise.reject(new Error('dead'));
    }
    if (host._trip) {
        host._trip.reject(new Error('travel superseded'));
        host._trip = null;
    }

    if (isAtMoveGoal(npc, { tx, ty, tz, onto })) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        host._trip = { x: tx, y: ty, z: tz, onto, resolve, reject };
    });
}

/**
 * @param {object} host
 * @returns {number}
 */
export function hostRemainingPathSteps(host) {
    return remainingBrainLocomotionSteps(host._locomotion);
}

/**
 * @param {object} host
 * @returns {boolean}
 */
export function hostIsLocomotionActive(host) {
    return isBrainLocomotionActive(host._locomotion);
}
