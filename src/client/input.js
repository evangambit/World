const MOVEMENT_KEYS = new Set([
    'w', 'a', 's', 'd',
    'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
]);

/** @param {string} key - e.key */
function normalizeKey(key) {
    const k = key.toLowerCase();
    switch (k) {
        case 'up': return 'arrowup';
        case 'down': return 'arrowdown';
        case 'left': return 'arrowleft';
        case 'right': return 'arrowright';
        default: return k;
    }
}

const GAME_KEYS = new Set([
    ...MOVEMENT_KEYS,
    'e', 't', ' ', 'escape',
]);

/** Keyboard input manager — tracks key states per frame. */
export class Input {
  constructor() {
      /** @type {Set<string>} keys currently held */
      this.held = new Set();
      /** @type {Set<string>} keys pressed this frame */
      this.justPressed = new Set();
      /** @type {Set<string>} keys released this frame */
      this.justReleased = new Set();

      this._nextPressed = new Set();
      this._nextReleased = new Set();

      const onKeyDown = (e) => {
          const k = normalizeKey(e.key);
          if (MOVEMENT_KEYS.has(k)) {
              // Always track movement keys (repeat re-adds after blur cleared held)
              this.held.add(k);
              if (!e.repeat) this._nextPressed.add(k);
              e.preventDefault();
              return;
          }
          if (e.repeat) return;
          this.held.add(k);
          this._nextPressed.add(k);
          if (GAME_KEYS.has(k)) e.preventDefault();
      };

      const onKeyUp = (e) => {
          const k = normalizeKey(e.key);
          this.held.delete(k);
          this._nextReleased.add(k);
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      // Blur can fire on canvas click and drop held keys while WASD is still down
      document.addEventListener('visibilitychange', () => {
          if (document.hidden) this.held.clear();
      });
  }

  /** Call at the start of each frame to refresh per-frame sets. */
  update() {
      this.justPressed = new Set(this._nextPressed);
      this.justReleased = new Set(this._nextReleased);
      this._nextPressed.clear();
      this._nextReleased.clear();
  }

  /** @returns {boolean} true if the key is currently held */
  isHeld(key) { return this.held.has(key); }

  /** @returns {boolean} true if the key was pressed this frame */
  isPressed(key) { return this.justPressed.has(key); }

  /** Convenience: returns movement vector from WASD/arrows, normalized. */
  getMovement() {
      let dx = 0, dy = 0;
      if (this.isHeld('w') || this.isHeld('arrowup'))    dy -= 1;
      if (this.isHeld('s') || this.isHeld('arrowdown'))  dy += 1;
      if (this.isHeld('a') || this.isHeld('arrowleft'))  dx -= 1;
      if (this.isHeld('d') || this.isHeld('arrowright')) dx += 1;
      // Normalize diagonal
      if (dx !== 0 && dy !== 0) {
          const inv = 1 / Math.SQRT2;
          dx *= inv;
          dy *= inv;
      }
      return { dx, dy };
  }
}

/**
 * @param {Input} input
 * @returns {boolean}
 */
export function hasMovementInput(input) {
    if (!input || typeof input.isHeld !== 'function') return false;
    for (const k of MOVEMENT_KEYS) {
        if (input.isHeld(k) || input.isPressed(k)) return true;
    }
    return false;
}
