/**
 * Wander brain — random walk near home, no memory or plans.
 */

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */

/**
 * Simple wander brain — no memory, no plans, no task queue.
 * Picks a random walkable tile near home each time the previous journey ends.
 */
/** @implements {NpcBrain} */
export class WanderBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
        this._traveling = false;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /**
     * @param {World3D} world
     * @param {number} _dt
     * @param {number} _gameTime
     * @returns {null}
     */
    tick(world, _dt, _gameTime) {
        const npc = this.npc;
        if (!npc || npc._dead || this._traveling) return null;

        const radius = npc.wanderRadius ?? 10;
        for (let attempt = 0; attempt < 10; attempt++) {
            const gx = npc.homeX + Math.floor(Math.random() * radius * 2 - radius);
            const gy = npc.homeY + Math.floor(Math.random() * radius * 2 - radius);
            if (!world.isWalkable(gx, gy, npc.homeZ)) continue;
            this._traveling = true;
            npc.travelToTile(gx, gy, npc.homeZ, world)
                .catch(() => {})
                .finally(() => {
                    this._traveling = false;
                });
            return null;
        }
        return null;
    }

    destroy() {
        this.npc = null;
        this._traveling = false;
    }
}
