# NPC control

Scheduling, declarative plans, and **tile memory** — not world rules. World interactions still go through `domain/entityActions.js`.

## Brain (`npc.brain`)

Each NPC may have a pluggable **brain** (`npcBrain.js`):

- **`NpcTaskBrain`** (default for `NPC` class) — perception + task/plan queue with optional LLM planner
- **`WanderBrain`** — no memory or plans; periodically picks a random walkable tile near home and walks there
- **`ThomasBrain`** — wall-respecting tile memory + async behavior framework; default behavior is autonomous wheat farming (`thomasBehaviors.js`)
- **`NoopNpcBrain`** — no cognition (body-only tests)

Select at runtime with `?brain=task` (default), `?brain=wander`, `?brain=thomas`, or `?brain=noop` (see `npcBrainRuntime.js`).

Attach explicitly for test entities:

```js
import { createNpcEntity } from '../actors/npcSimulation.js';
import { createTaskBrain } from './npcBrain.js';

const npc = createNpcEntity(0, 0, 0, { brain: createTaskBrain() });
```

Swap implementations via constructor:

```js
new NPC(x, y, z, preset, name, inv, { brain: myCustomBrain });
```

`npc.tasks` is available when the brain exposes it (task brain). The brain records observations via `observeTile`; reads use `npcMemory` helpers (`getNpcTileMemory`, `forEachNpcObservedTile`, etc.).

## ThomasBrain

See [`THOMAS_BRAIN.md`](THOMAS_BRAIN.md) for full details: wall-respecting perception, the async task API, writing behaviors, and the farming behavior loop.

## Simulation order (per NPC, each frame)

`tickSimulation` runs:

1. `tickNpcSimulation` — vitality, locomotion, timed actions  
2. `npc.brain.tick` — for task brain: perception → task queue (which runs `syncMemoryRefTravelGoal` internally)

Perception runs **before** the task runner so newly seen tiles can influence travel and plans on the same frame.

## Tile memory

**Module:** `npcMemory.js`  
**Storage:** `brain._tileStore` (private); `npc.brain.observeTile` to write, `getNpcTileMemory(npc, …)` to read

### Perception

Each frame, on the NPC’s current floor (`npc.z`), every tile within **5 tiles** (Chebyshev distance) that exists in the world is recorded:

```ts
{ seenAt: gameTime, state: TileData snapshot, reachable?: boolean }
```

- **`state`** is a copy of the live tile (`snapshotTileState`) so later world edits do not change memory until the tile is seen again.  
- Empty cells (no tile in the world) are not stored.

Initialized when a task brain attaches.

### Reachability (`reachable`)

Optional flag on each memory entry:

| Value | Meaning |
|--------|---------|
| *(omitted)* | Unknown — pathfinding may be attempted |
| `true` | NPC has successfully reached this tile (or pathing succeeded) |
| `false` | No path found — skip when choosing travel targets |

**Set `false` when:**

- `findPath` finds no route while selecting a memory-ref target  
- `setNpcGoal` fails for that tile  

**Set `true` when:**

- Memory-ref travel completes at the tile  

**Cleared (back to unknown) when:**

- The tile is re-perceived and **`state` changed** (e.g. door unlocked, object replaced) — same snapshot keeps the previous `reachable` value  

Helpers: `markTileUnreachable`, `markTileReachable`, `isTileMemoryReachable`.

### Tests

- `npcMemory.test.mjs` — perception, snapshots, reachability reset on state change  
- `npcMemoryTravel.test.mjs` — travel, retargeting, skipping unreachable tiles  
- `thomasBehaviors.test.mjs` — behavioral regression for `farmBehavior` (see [ThomasBrain testing](#thomasbrain-testing))

Run: `npm test`

### ThomasBrain testing

Because `ThomasBrain` behaviors are async coroutines, a plain synchronous `for` loop would freeze them — microtasks don't drain mid-loop. The trick is to yield after each tick:

```js
async function runTicks(world, npcs, ticks, dt = 0.05) {
    let gameTime = 0;
    for (let i = 0; i < ticks; i++) {
        ({ gameTime } = tickSimulation({ world, gameTime, dt, npcs }));
        await Promise.resolve(); // flush microtask queue so nextTick() resolves
    }
    return gameTime;
}
```

`thomasBehaviors.test.mjs` uses this helper to run 10 000 ticks (~500 game-seconds) in under a second. It logs a `[bread-production]` snapshot line (bread / wheat / seeds / hunger) so productivity changes are visible when comparing AI-code versions. Tighten the `bread >= 5` threshold whenever you want stricter coverage of a specific behavior.

## Plan location refs

**Module:** `npcPlanRefs.js`

Plans no longer use a top-level `bindings` object. Steps use **`ref`** strings on `goto`, `take`, `stash`, and `action`.

### `rememberLocationsOfNearby(objectTag)`

Syntax: `rememberLocationsOfNearby(stove)` (object tag from `npcObjectTags.js`, e.g. `stove`, `chest`).

Returns all remembered tiles on the NPC’s floor whose **snapshot** matches the tag (tile `obj` or container `contents`).

**Travel behavior** (`npcMemoryTravel.js`):

1. Pick the **reachable** remembered match with the shortest path from the NPC’s current tile.  
2. Walk there (`travelNpcToMemoryRef`).  
3. Each frame after perception, **retarget** if another remembered match has a **strictly shorter** remaining path (or shorter full path if not walking yet).  
4. Skip entries with `reachable === false`.  
5. If every remembered match is unreachable, the step fails (`no reachable remembered target`).

Example plan step:

```json
{ "type": "goto", "ref": "rememberLocationsOfNearby(stove)" }
```

Literal coordinates still work: `{ "type": "goto", "x": 3, "y": 4, "z": 0 }`.

### Object tags

**Module:** `npcObjectTags.js` — abstract names in plan JSON (`edible_food`, `stove`, …) mapped to world/inventory type ids.

## Wide-area search (`explore`)

**Module:** `npcExplore.js`

`find` only scans live tiles within a fixed radius of the NPC’s **current** position. **`explore`** is for genuine search over a region:

1. **`runFind`** at perception range (default 5 tiles).  
2. Travel to **remembered** pickable tiles matching the object tag (still on the ground).  
3. Visit a **grid of walkable waypoints** (same spacing as perception) inside a Chebyshev disk around **`anchor`**: `home` (default) or `self`.  
4. Repeat until something is picked up or **`maxVisits`** (default capped at 64) is exhausted.

Example:

```json
{ "type": "explore", "object": "edible_food", "radius": 20, "anchor": "home", "pickup": true }
```

Use **`find`** for a quick grab near the NPC; use **`explore`** after `goto` to a stove (or when wandering) to sweep the homestead.

## Plans vs tasks

- **Tasks** (`npcTasks.js`) — `goTo`, `find`, `timedAction`; imperative queue.  
- **Plans** (`npcPlanRunner.js`) — `seq` / `sel` and leaves (`eat`, `cook`, `door`, `take`, `explore`, …); must call `entityActions` (or primitives that do).  

Templates: `npcPlanTemplates.js` (e.g. `EAT_FOOD_PLAN` uses `rememberLocationsOfNearby(stove)`).

LLM planners: `llm/` — prompts in `npcPrompt.js`, catalog in `llm/npcActionCatalog.js`.

## Chunk descriptions (LLM context)

**Module:** `tileChunkDescribe.js`  
**Constant:** `WORLD_CHUNK_SIZE` in `world/worldConstants.js` (default 5×5 tiles per chunk).

- **`describeChunkSnapshot`** — e.g. `Chunk (3, 5): 15 dirt tiles, 10 wall stone tiles. 5/25 unseen tiles.`
- **`diffChunk` / `describeChunkDiff`** — call explicitly when you have before/after memory; not run each frame.
- Planner user prompts include a **## Surroundings** section (memory + world for empty vs unseen) when a real `World3D` is passed to `buildPlannerMessages`.

## Adding a stove (or similar) to plans

1. Add or extend tag in `npcObjectTags.js` if needed.  
2. Use `rememberLocationsOfNearby(your_tag)` in `ref` fields.  
3. Ensure NPCs can **see** the tile (wander near it) so perception fills memory.  
4. Add tests next to `npcMemory.js` / `npcMemoryTravel.js` for non-obvious behavior.
