/** Smooth-follow camera with viewport culling. */
export class Camera {
  constructor() {
      /** Camera center in world-tile units */
      this.x = 0;
      this.y = 0;
      /** Lerp speed (0–1 range, higher = snappier) */
      this.smoothing = 0.08;
      /** Pixels per tile (display scale) */
      this.tileSize = 48;
      /** Canvas pixel dimensions (set by resize) */
      this.screenW = 0;
      this.screenH = 0;
  }

  /** Follow a target position smoothly. */
  follow(targetX, targetY, dt) {
      const t = 1 - Math.pow(1 - this.smoothing, dt * 60);
      this.x += (targetX - this.x) * t;
      this.y += (targetY - this.y) * t;
  }

  /** Snap camera instantly to a position. */
  snapTo(x, y) {
      this.x = x;
      this.y = y;
  }

  /** Update canvas dimensions (call on resize). */
  resize(canvasW, canvasH) {
      this.screenW = canvasW;
      this.screenH = canvasH;
  }

  /** Convert world-tile coords to screen pixel coords. */
  worldToScreen(wx, wy) {
      const sx = (wx - this.x) * this.tileSize + this.screenW / 2;
      const sy = (wy - this.y) * this.tileSize + this.screenH / 2;
      return { x: sx, y: sy };
  }

  /** Convert screen pixel coords to world-tile coords. */
  screenToWorld(sx, sy) {
      const wx = (sx - this.screenW / 2) / this.tileSize + this.x;
      const wy = (sy - this.screenH / 2) / this.tileSize + this.y;
      return { x: wx, y: wy };
  }

  /** Get the visible tile range (for culling). Returns inclusive min/max. */
  getVisibleBounds() {
      const halfW = this.screenW / 2 / this.tileSize;
      const halfH = this.screenH / 2 / this.tileSize;
      return {
          minX: Math.floor(this.x - halfW) - 1,
          maxX: Math.ceil(this.x + halfW) + 1,
          minY: Math.floor(this.y - halfH) - 1,
          maxY: Math.ceil(this.y + halfH) + 1,
      };
  }
}
