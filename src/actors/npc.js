/**
 * NPC — task-driven movement and pathfinding.
 */
import { Entity, DIR } from './entity.js';
import { findPath } from '../world/pathfinding.js';
import { pickUpAtTile } from '../domain/entityActions.js';
import { tickVitality, tryEatFromInventoryIfHungry } from '../domain/vitality.js';
import {
    NPCTaskRunner,
    goTo,
    find,
    clearGrass,
    timedAction,
} from '../npc/npcTasks.js';

export { goTo, find, clearGrass, timedAction };
export { EAT_FOOD_PLAN } from '../npc/npcPlanTemplates.js';

// NPC appearance presets (skin, hair, shirt, pants)
const NPC_PRESETS = [
    ['#e8c090', '#8B4513', '#8B2252', '#4a4a3a'],   // red-shirted villager
    ['#d4a070', '#2a2a2a', '#2a6e2a', '#5a4a3a'],   // green-shirted villager
    ['#e8c090', '#c4a265', '#6a4a8a', '#3a3a5a'],   // purple robe
    ['#c49060', '#1a1a1a', '#8a6a2a', '#4a3a2a'],   // brown tunic
    ['#e8c090', '#aa4444', '#3a5a7a', '#3a3a4a'],   // blue coat
    ['#d4a070', '#e0c080', '#7a2a2a', '#4a4a4a'],   // crimson shirt
    ['#e8c090', '#5a3a2a', '#5a7a5a', '#4a4a3a'],   // sage green
    ['#c49060', '#3a3a3a', '#aa8a40', '#3a3020'],   // golden tunic
];

export class NPC extends Entity {
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} presetIndex - index into NPC_PRESETS
     * @param {string} name - NPC name (for future dialogue)
     * @param {{ objType: number, count: number, buildingId?: number }[]} [inventory] - starting carried items
     */
    constructor(x, y, z, presetIndex = 0, name = 'Villager', inventory = []) {
        super(x, y, z);
        this.name = name;
        this.speed = 2.0;
        const preset = NPC_PRESETS[presetIndex % NPC_PRESETS.length];
        this.initSprites(...preset);
        this.inventory = inventory.map((s) => ({ ...s }));

        /** @type {Array<{x:number,y:number,z:number}>|null} current path */
        this.path = null;
        /** Index into current path */
        this.pathIndex = 0;
        /** Home position (integer tile coords where the NPC was placed) */
        this.homeX = Math.floor(x);
        this.homeY = Math.floor(y);
        this.homeZ = z;
        /** Tiles from home for idle wander GoTo targets */
        this.wanderRadius = 10;

        this._state = 'idle'; // 'idle' | 'walking'
        /** @type {{ x: number, y: number, z: number, resolve: () => void, reject: (err: Error) => void }|null} */
        this._trip = null;

        this.tasks = new NPCTaskRunner(this);
        this._dead = false;
    }

    get isAlive() {
        return !this._dead;
    }

    /** Stop AI, movement, and tasks when health reaches zero. */
    _die() {
        if (this._dead) return;
        this._dead = true;
        this.health = 0;

        this.timedAction.cancel();
        this.endWorking();

        if (this._trip) {
            this._trip.reject(new Error('dead'));
            this._trip = null;
        }
        this.path = null;
        this.pathIndex = 0;
        this._state = 'idle';

        this.tasks.clear();
    }

    /**
     * @param {number} gx
     * @param {number} gy
     * @param {number} gz
     * @param {import('../world/world.js').World3D} world
     * @returns {boolean}
     */
    setGoal(gx, gy, gz, world) {
        const sx = Math.floor(this.x);
        const sy = Math.floor(this.y);
        const path = findPath(world, sx, sy, this.z, gx, gy, gz);
        if (path && path.length > 1) {
            this.path = path;
            this.pathIndex = 1;
            this._state = 'walking';
            return true;
        }
        if (path && path.length === 1) {
            this.path = null;
            this.pathIndex = 0;
            this._state = 'idle';
            return true;
        }
        return false;
    }

    /**
     * Path to a tile and resolve when the NPC reaches it.
     * @param {number} tx
     * @param {number} ty
     * @param {number} tz
     * @param {import('../world/world.js').World3D} world
     * @returns {Promise<void>}
     */
    travelToTile(tx, ty, tz, world) {
        if (!this.isAlive) {
            return Promise.reject(new Error('dead'));
        }
        if (this.timedAction.isBusy()) {
            this.timedAction.cancel();
        }
        if (this._trip) {
            this._trip.reject(new Error('travel superseded'));
            this._trip = null;
        }

        const px = Math.floor(this.x);
        const py = Math.floor(this.y);
        if (px === tx && py === ty && this.z === tz) {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            if (!this.setGoal(tx, ty, tz, world)) {
                reject(new Error(`no path to (${tx}, ${ty}, ${tz})`));
                return;
            }
            if (this._state === 'idle' && px === tx && py === ty && this.z === tz) {
                resolve();
                return;
            }
            this._trip = { x: tx, y: ty, z: tz, resolve, reject };
        });
    }

    /**
     * Pick up a loose world object within 1 tile (Chebyshev).
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} tileZ
     * @param {import('../world/world.js').World3D} world
     * @returns {boolean}
     */
    pickUpAt(tileX, tileY, tileZ, world) {
        return pickUpAtTile(this, world, tileX, tileY, tileZ);
    }

    /**
     * @param {import('../world/world.js').World3D} world
     * @param {number} dt
     */
    update(world, dt) {
        if (this._dead) return;

        tickVitality(this, dt);

        if (this.health <= 0) {
            this._die();
            return;
        }

        if (this.timedAction.isBusy()) {
            this.timedAction.tick(dt, world);
        } else {
            this._tickMovement(dt);
            tryEatFromInventoryIfHungry(this, 55);
        }
        this.tasks.update(world);
    }

    /**
     * @param {number} dt
     */
    _tickMovement(dt) {
        if (this._state === 'idle') {
            this.updateAnimation(dt, false);
            return;
        }

        if (!this.path || this.pathIndex >= this.path.length) {
            this._state = 'idle';
            this._finishTripIfAtGoal();
            this.updateAnimation(dt, false);
            return;
        }

        const target = this.path[this.pathIndex];
        const tx = target.x + 0.5;
        const ty = target.y + 0.5;

        const ddx = tx - this.x;
        const ddy = ty - this.y;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);

        if (dist < 0.15) {
            this.x = tx;
            this.y = ty;
            if (target.z !== this.z) {
                this.z = target.z;
            }
            this.pathIndex++;
            if (this.pathIndex >= this.path.length) {
                this._state = 'idle';
                this._finishTripIfAtGoal();
            }
        } else {
            const nx = ddx / dist;
            const ny = ddy / dist;
            this.x += nx * this.speed * dt;
            this.y += ny * this.speed * dt;

            if (Math.abs(nx) > Math.abs(ny)) {
                this.dir = nx > 0 ? DIR.RIGHT : DIR.LEFT;
            } else {
                this.dir = ny > 0 ? DIR.DOWN : DIR.UP;
            }
        }

        this.updateAnimation(dt, this._state === 'walking');
    }

    _finishTripIfAtGoal() {
        if (!this._trip) return;
        const px = Math.floor(this.x);
        const py = Math.floor(this.y);
        const { x, y, z, resolve } = this._trip;
        if (px === x && py === y && this.z === z) {
            this._trip = null;
            resolve();
        }
    }
}
