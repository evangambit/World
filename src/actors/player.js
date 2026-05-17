/**
 * Player — input-driven movement and interaction wrappers.
 */
import { inventoryHasUncookedSteak } from '../domain/cooking.js';
import { cookAtStove, pickUpAtTile } from '../domain/entityActions.js';
import { hasMovementInput } from '../client/input.js';
import { tickVitality, consumeFoodFromInventory } from '../domain/vitality.js';
import { Entity } from './entity.js';

export class Player extends Entity {
    constructor(x, y, z) {
        super(x, y, z);
        this.speed = 4;
        // Fantasy adventurer colors
        this.initSprites('#e8c090', '#5a3020', '#2a5a8a', '#3a3a4a');
    }

    /**
     * If the clicked tile has a pickable object and is within 1 tile (Chebyshev), take it.
     * @param {import('../world/world.js').World3D} world
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean} whether something was picked up
     */
    tryPickUp(world, tileX, tileY) {
        if (!this.inventory) this.inventory = [];
        return pickUpAtTile(this, world, tileX, tileY, this.z);
    }

    /**
     * Cook one uncooked steak in inventory while adjacent to a stove tile.
     * @param {import('../world/world.js').World3D} world
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean}
     */
    tryCookAtStove(world, tileX, tileY) {
        if (!this.inventory) this.inventory = [];
        return cookAtStove(this, world, tileX, tileY);
    }

    /** @returns {boolean} */
    hasUncookedSteak() {
        return inventoryHasUncookedSteak(this.inventory ?? []);
    }

    /**
     * @param {import('../client/input.js').Input} input
     * @param {import('../world/world.js').World3D} world
     * @param {number} dt
     */
    /**
     * @param {number} objType
     * @param {number} [buildingId]
     * @returns {boolean}
     */
    tryEatFromInventory(objType, buildingId) {
        return consumeFoodFromInventory(this, objType, buildingId);
    }

    update(input, world, dt) {
        tickVitality(this, dt);

        if (this.timedAction.isBusy()) {
            if (hasMovementInput(input)) {
                const { dx, dy } = input.getMovement();
                this.timedAction.cancel();
                if (dx !== 0 || dy !== 0) {
                    this.tryMove(dx, dy, world, dt);
                }
                this.updateAnimation(dt, true);
                return;
            }
            this.timedAction.tick(dt, world);
            return;
        }

        const { dx, dy } = input.getMovement();
        const wantsMove = dx !== 0 || dy !== 0;
        if (wantsMove) {
            this.tryMove(dx, dy, world, dt);
        }
        this.updateAnimation(dt, wantsMove);
    }
}
