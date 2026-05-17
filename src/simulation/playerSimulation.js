/**
 * Player body simulation without keyboard input (vitality + timed actions).
 */
import { tickVitality } from '../domain/vitality.js';

/** @typedef {import('../actors/entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */

/**
 * @param {Entity} entity
 * @param {World3D} world
 * @param {number} dt
 */
export function tickPlayerSimulation(entity, world, dt) {
    tickVitality(entity, dt);

    if (entity.timedAction.isBusy()) {
        entity.timedAction.tick(dt, world);
    }
}
