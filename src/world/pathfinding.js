/**
 * A* pathfinding on the 3D world grid.
 * Nodes are (x, y, z) triples. Supports layer transitions via tile transitions.
 */

// ── Binary min-heap for the open set ──
class MinHeap {
  constructor() { this.data = []; }

  push(item) {
      this.data.push(item);
      this._bubbleUp(this.data.length - 1);
  }

  pop() {
      const top = this.data[0];
      const last = this.data.pop();
      if (this.data.length > 0) {
          this.data[0] = last;
          this._sinkDown(0);
      }
      return top;
  }

  get size() { return this.data.length; }

  _bubbleUp(i) {
      while (i > 0) {
          const parent = (i - 1) >> 1;
          if (this.data[i].f >= this.data[parent].f) break;
          [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
          i = parent;
      }
  }

  _sinkDown(i) {
      const n = this.data.length;
      while (true) {
          let smallest = i;
          const l = 2 * i + 1, r = 2 * i + 2;
          if (l < n && this.data[l].f < this.data[smallest].f) smallest = l;
          if (r < n && this.data[r].f < this.data[smallest].f) smallest = r;
          if (smallest === i) break;
          [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
          i = smallest;
      }
  }
}

/**
* Find a path from (sx,sy,sz) to (gx,gy,gz) using A*.
* @param {import('./world.js').World3D} world
* @param {number} sx - start x
* @param {number} sy - start y
* @param {number} sz - start z
* @param {number} gx - goal x
* @param {number} gy - goal y
* @param {number} gz - goal z
* @param {number} maxNodes - maximum nodes to expand (budget)
* @returns {Array<{x:number,y:number,z:number}>|null} path (including start), or null if no path
*/
export function findPath(world, sx, sy, sz, gx, gy, gz, maxNodes = 2000) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const startKey = key(sx, sy, sz);
  const goalKey = key(gx, gy, gz);

  if (startKey === goalKey) return [{ x: sx, y: sy, z: sz }];

  const open = new MinHeap();
  const gScore = new Map();  // key → best g-score
  const cameFrom = new Map(); // key → parent key
  const coords = new Map();   // key → {x, y, z}

  const h = (x, y, z) => Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz) * 3;

  gScore.set(startKey, 0);
  coords.set(startKey, { x: sx, y: sy, z: sz });
  open.push({ key: startKey, f: h(sx, sy, sz) });

  let expanded = 0;

  while (open.size > 0 && expanded < maxNodes) {
      const current = open.pop();
      const ck = current.key;
      expanded++;

      if (ck === goalKey) {
          // Reconstruct path
          const path = [];
          let k = goalKey;
          while (k) {
              path.push(coords.get(k));
              k = cameFrom.get(k) || null;
          }
          path.reverse();
          return path;
      }

      const { x, y, z } = coords.get(ck);
      const currentG = gScore.get(ck);
      const neighbors = world.getWalkableNeighbors(x, y, z);

      for (const nb of neighbors) {
          const nk = key(nb.x, nb.y, nb.z);
          // Movement cost: 1 for cardinal, 3 for layer change
          const moveCost = nb.z !== z ? 3 : 1;
          const tentG = currentG + moveCost;

          if (!gScore.has(nk) || tentG < gScore.get(nk)) {
              gScore.set(nk, tentG);
              cameFrom.set(nk, ck);
              coords.set(nk, nb);
              const f = tentG + h(nb.x, nb.y, nb.z);
              open.push({ key: nk, f });
          }
      }
  }

  return null; // No path found within budget
}
