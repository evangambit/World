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

      window.addEventListener('keydown', (e) => {
          if (e.repeat) return;
          const k = e.key.toLowerCase();
          this.held.add(k);
          this._nextPressed.add(k);
          // Prevent default for game keys
          if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',
               'e',' ','escape'].includes(k)) {
              e.preventDefault();
          }
      });

      window.addEventListener('keyup', (e) => {
          const k = e.key.toLowerCase();
          this.held.delete(k);
          this._nextReleased.add(k);
      });

      // Clear held keys when window loses focus
      window.addEventListener('blur', () => this.held.clear());
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
