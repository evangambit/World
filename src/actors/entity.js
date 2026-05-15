/**
 * Entity system — base Entity class and Player subclass.
 * Entities have float positions in tile-space and smooth movement.
 */
import { inventoryHasUncookedSteak } from '../domain/cooking.js';
import {
    cookAtStove,
    isAdjacentToTile as entityIsAdjacentToTile,
    pickUpAtTile,
} from '../domain/entityActions.js';

// ── Sprite drawing helpers ──

const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 };

/**
 * Draw a simple 16×16 pixel-art character.
 * @param {CanvasRenderingContext2D} ctx - offscreen 16×16 canvas context
 * @param {string} skinColor
 * @param {string} hairColor
 * @param {string} shirtColor
 * @param {string} pantsColor
 * @param {number} dir - DIR.* constant
 * @param {number} frame - walk frame (0 or 1)
 */
function drawCharacter(ctx, skinColor, hairColor, shirtColor, pantsColor, dir, frame) {
    ctx.clearRect(0, 0, 16, 16);
    const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
    const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };

    // Head
    rect(5, 1, 6, 5, skinColor);
    // Hair
    rect(5, 1, 6, 2, hairColor);
    if (dir === DIR.LEFT) rect(5, 1, 2, 4, hairColor);
    if (dir === DIR.RIGHT) rect(9, 1, 2, 4, hairColor);

    // Eyes
    if (dir !== DIR.UP) {
        const eyeY = 3;
        if (dir === DIR.DOWN) { px(6, eyeY, '#222'); px(9, eyeY, '#222'); }
        else if (dir === DIR.LEFT) { px(6, eyeY, '#222'); }
        else { px(9, eyeY, '#222'); }
    }

    // Body / shirt
    rect(5, 6, 6, 5, shirtColor);
    // Arms
    if (frame === 0) {
        rect(4, 7, 1, 3, shirtColor);
        rect(11, 7, 1, 3, shirtColor);
    } else {
        rect(4, 6, 1, 3, shirtColor);
        rect(11, 8, 1, 3, shirtColor);
    }
    // Hands
    px(4, frame === 0 ? 10 : 9, skinColor);
    px(11, frame === 0 ? 10 : 11, skinColor);

    // Pants/legs
    const legOffset = frame === 1 ? 1 : 0;
    rect(5, 11, 2, 4, pantsColor);
    rect(9, 11, 2, 4, pantsColor);
    // Feet
    rect(5, 14 + (frame === 1 ? 1 : 0), 2, 1, '#3a2a1a');
    rect(9, 14 + (frame === 0 ? 1 : 0), 2, 1, '#3a2a1a');
}

// ── Pre-render character sprite sheets ──
function buildSpriteSheet(skinColor, hairColor, shirtColor, pantsColor) {
    // 4 directions × 2 walk frames = 8 sprites
    const sprites = {};
    for (const [name, dirVal] of Object.entries(DIR)) {
        sprites[dirVal] = [];
        for (let frame = 0; frame < 2; frame++) {
            const c = document.createElement('canvas');
            c.width = 16; c.height = 16;
            const ctx = c.getContext('2d');
            drawCharacter(ctx, skinColor, hairColor, shirtColor, pantsColor, dirVal, frame);
            sprites[dirVal].push(c);
        }
    }
    return sprites;
}

// ── Entity base class ──
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
        this.sprites = null;
        this._animTimer = 0;
        this._animFrame = 0;
        this._moving = false;
        /** Cooldown after a transition to prevent immediate re-trigger */
        this._transitionCooldown = 0;
        /** @type {{ objType: number, count: number, buildingId?: number }[]} carried item stacks */
        this.inventory = [];
    }

    /** Set the sprite sheet colors. Call after construction. */
    initSprites(skinColor, hairColor, shirtColor, pantsColor) {
        this.sprites = buildSpriteSheet(skinColor, hairColor, shirtColor, pantsColor);
    }

    /** Get the current sprite canvas. */
    getSprite() {
        if (!this.sprites) return null;
        return this.sprites[this.dir][this._animFrame];
    }

    /** Update walk animation timer. */
    updateAnimation(dt, moving) {
        this._moving = moving;
        if (moving) {
            this._animTimer += dt;
            if (this._animTimer > 0.2) {
                this._animTimer = 0;
                this._animFrame = 1 - this._animFrame;
            }
        } else {
            this._animTimer = 0;
            this._animFrame = 0;
        }
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

// ── Player subclass ──
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

    update(input, world, dt) {
        const { dx, dy } = input.getMovement();
        const moved = dx !== 0 || dy !== 0;
        if (moved) {
            this.tryMove(dx, dy, world, dt);
        }
        this.updateAnimation(dt, moved);
    }
}

export { DIR };
