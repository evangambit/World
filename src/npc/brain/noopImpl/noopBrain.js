/**
 * No-op brain — body-only simulation, no cognition.
 */

/** No cognition — body-only simulation. */
export class NoopNpcBrain {
    attach(_npc) {}

    tick(_world, _dt, _gameTime) {}

    destroy() {}
}

/** @returns {NoopNpcBrain} */
export function noopNpcBrain() {
    return new NoopNpcBrain();
}
