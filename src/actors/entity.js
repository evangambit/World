/**
 * Entity base class — position, movement, inventory, vitality.
 * Village NPCs use npcSimulation.js; full AI uses actors/npc.js. Player is an Entity + playerController.
 * Sprites: set `appearance` (four colors); client/entityAppearance.js draws them.
 */
import { isAdjacentToTile as entityIsAdjacentToTile } from '../domain/entityActions.js';
import { TimedActionRunner } from './timedActionRunner.js';

const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

export class Entity {
    /**
     * @param {number} x - tile x
     * @param {number} y - tile y
     * @param {number} z - layer
     */
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.dir = DIR.DOWN;
        this.speed = 3.5; // tiles per second
        /** @type {import('../client/entityAppearance.js').EntityAppearance|undefined} */
        this.appearance = undefined;
        /** Cooldown after a transition to prevent immediate re-trigger */
        this._transitionCooldown = 0;
        /** @type {{ objType: number, count: number, buildingId?: number }[]} carried item stacks */
        this.inventory = [];
        /** 0 = full, 100 = starving */
        this.hunger = 0;
        /** 100 = healthy, 0 = down */
        this.health = 100;
        this.timedAction = new TimedActionRunner(this);
    }

    /** Try to move by (dx, dy) with collision against the world. */
    tryMove(dx, dy, world, dt) {
        if (dx === 0 && dy === 0) return false;

        // Update facing direction
        if (Math.abs(dx) > Math.abs(dy)) {
            this.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
        } else {
            this.dir = dy > 0 ? DIR.DOWN : DIR.UP;
        }

        const step = this.speed * dt;
        let nx = this.x + dx * step;
        let ny = this.y + dy * step;

        // Hitbox: 0.5 × 0.5 tiles centered on position
        const hw = 0.2, hh = 0.2;

        // Check X movement
        if (dx !== 0) {
            const testX = this.x + dx * step;
            if (this._canOccupy(testX, this.y, hw, hh, world)) {
                this.x = testX;
            }
        }
        // Check Y movement (using potentially updated x)
        if (dy !== 0) {
            const testY = this.y + dy * step;
            if (this._canOccupy(this.x, testY, hw, hh, world)) {
                this.y = testY;
            }
        }

        // Check for transitions (stairs, ramps) — with cooldown to prevent bouncing
        if (this._transitionCooldown > 0) {
            this._transitionCooldown -= dt;
        } else {
            const tileX = Math.floor(this.x), tileY = Math.floor(this.y);
            const trans = world.getTransition(tileX, tileY, this.z);
            if (trans) {
                this.z = trans.tz;
                this.x = trans.tx + 0.5;
                this.y = trans.ty + 0.5;
                this._transitionCooldown = 0.4; // seconds before next transition allowed
            }
        }

        return true;
    }

    /** Chebyshev distance ≤ 1 from this entity's tile to (tileX, tileY). */
    isAdjacentToTile(tileX, tileY) {
        return entityIsAdjacentToTile(this, tileX, tileY);
    }

    /** Face a tile (for timed actions). */
    faceTile(tileX, tileY) {
        const px = Math.floor(this.x);
        const py = Math.floor(this.y);
        const dx = tileX - px;
        const dy = tileY - py;
        if (Math.abs(dx) > Math.abs(dy)) {
            this.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
        } else if (dy !== 0) {
            this.dir = dy > 0 ? DIR.DOWN : DIR.UP;
        }
    }

    /** Check if hitbox centered at (cx, cy) can occupy that space. */
    _canOccupy(cx, cy, hw, hh, world) {
        // Check all tiles the hitbox overlaps
        const minTX = Math.floor(cx - hw);
        const maxTX = Math.floor(cx + hw);
        const minTY = Math.floor(cy - hh);
        const maxTY = Math.floor(cy + hh);
        for (let ty = minTY; ty <= maxTY; ty++) {
            for (let tx = minTX; tx <= maxTX; tx++) {
                if (!world.isWalkable(tx, ty, this.z)) return false;
            }
        }
        return true;
    }
}

export { DIR };
