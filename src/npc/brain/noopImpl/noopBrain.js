/**
 * No-op brain — body-only simulation, no cognition.
 */

/** @typedef {import('../interface.js').NpcEntity} NpcEntity */
/** @typedef {import('../interface.js').World3D} World3D */
/** @typedef {import('../interface.js').NpcBrain} NpcBrain */

/** @implements {NpcBrain} */
export class NoopNpcBrain {
    constructor() {
        /** @type {NpcEntity | null} */
        this.npc = null;
    }

    /** @param {NpcEntity} npc */
    attach(npc) {
        this.npc = npc;
    }

    /**
     * @param {World3D} _world
     * @param {number} _dt
     * @param {number} _gameTime
     */
    tick(_world, _dt, _gameTime) {}

    destroy() {
        this.npc = null;
    }
}

