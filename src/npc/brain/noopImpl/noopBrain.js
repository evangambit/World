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
     * @param {number|null} _actionProgress
     * @param {import('../../shared/npcMemory.js').VisibleTile[]} _visibleTiles
     * @param {{ ok: boolean, message?: string }|null} [_lastActionResult]
     * @returns {null}
     */
    tick(_world, _dt, _gameTime, _actionProgress, _visibleTiles, _lastActionResult) {
        return null;
    }

    destroy() {
        this.npc = null;
    }
}

