# NPC control

Scheduling, declarative plans, and **tile memory** — not world rules. World interactions still go through `domain/entityActions.js`.

## Simulation order (per NPC, each frame)

`tickSimulation` runs:

1. `tickNpcSimulation` — vitality, locomotion, timed actions  
2. `tickNpcPerception` — update `tileMemory` from nearby tiles  
3. `syncMemoryRefTravelGoal` — retarget active memory-ref travel if a better stove (etc.) appears  
4. `npcBrain` — task queue / planner (e.g. `tickNpcTaskBrain`)

Perception runs **before** the brain so newly seen tiles can influence travel and plans on the same frame.

## Tile memory

**Module:** `npcMemory.js`  
**Storage:** `npc.tileMemory` — `Map<"x,y,z", TileMemoryEntry>`

### Perception

Each frame, on the NPC’s current floor (`npc.z`), every tile within **5 tiles** (Chebyshev distance) that exists in the world is recorded:

```ts
{ seenAt: gameTime, state: TileData snapshot, reachable?: boolean }
```

- **`state`** is a copy of the live tile (`snapshotTileState`) so later world edits do not change memory until the tile is seen again.  
- Empty cells (no tile in the world) are not stored.

Initialized in `initNpcEntity` (`npcSimulation.js`).

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

Run: `npm test`

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

## Plans vs tasks

- **Tasks** (`npcTasks.js`) — `goTo`, `find`, `timedAction`; imperative queue.  
- **Plans** (`npcPlanRunner.js`) — `seq` / `sel` and leaves (`eat`, `cook`, `door`, `take`, …); must call `entityActions` (or primitives that do).  

Templates: `npcPlanTemplates.js` (e.g. `EAT_FOOD_PLAN` uses `rememberLocationsOfNearby(stove)`).

LLM planners: `llm/` — prompts in `npcPrompt.js`, catalog in `llm/npcActionCatalog.js`.

## Adding a stove (or similar) to plans

1. Add or extend tag in `npcObjectTags.js` if needed.  
2. Use `rememberLocationsOfNearby(your_tag)` in `ref` fields.  
3. Ensure NPCs can **see** the tile (wander near it) so perception fills memory.  
4. Add tests next to `npcMemory.js` / `npcMemoryTravel.js` for non-obvious behavior.
