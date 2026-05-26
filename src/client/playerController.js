/**
 * Apply keyboard input to the player entity (movement, timed-action cancel).
 */
import { tickVitality } from '../domain/vitality.js';
import { moveDirectionAction } from '../domain/entityActions.js';
import { tickEntityAction } from '../actors/actionExecutor.js';
import { hasMovementInput } from './input.js';

/** @typedef {import('../actors/entity.js').Entity} Entity */
/** @typedef {import('../world/world.js').World3D} World3D */
/** @typedef {import('./input.js').Input} Input */

/**
 * @param {Entity} entity
 * @param {Input} input
 * @param {World3D} world
 * @param {number} dt
 */
export function updatePlayerFromInput(entity, input, world, dt) {
    tickVitality(entity, dt);

    if (entity.timedAction.isBusy()) {
        if (hasMovementInput(input)) {
            const { dx, dy } = input.getMovement();
            entity.timedAction.cancel();
            if (dx !== 0 || dy !== 0) {
                tickEntityAction(entity, moveDirectionAction(entity, dx, dy), world, dt);
            }
            return;
        }
        entity.timedAction.tick(dt, world);
        return;
    }

    const { dx, dy } = input.getMovement();
    if (dx !== 0 || dy !== 0) {
        tickEntityAction(entity, moveDirectionAction(entity, dx, dy), world, dt);
    }
}
