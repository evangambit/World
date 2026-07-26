# NPC control

Scheduling and **tile memory** — not world rules. World interactions still go through `domain/entityActions.js`.

## Brain (`npc.brain`)

Each NPC has a pluggable **brain** (`brain/`):

- **`WanderBrain`** (default for `NPC` class) — picks a random walkable tile near home and walks there; uses tile memory for pathfinding only
- **`NoopNpcBrain`** — no cognition (body-only tests)
- **`DanBrain`** — utility-driven task selection with hypothetical planning and optional LLM think/conversation ([architecture](./brain/danImpl/ARCHITECTURE.md))

Select at runtime with `?brain=wander` (default), `?brain=noop`, or `?brain=dan` (see `shared/npcBrainRuntime.js`).

When using Dan brains, `main.js` calls `buildDanNpcRegistry(npcs)` so `talk_to` tasks and conversations can resolve NPC names.

Layout:

```
shared/              # tile memory, hypothetical world, chunk describe, test helpers, brain runtime
brain/
  interface.js, tileStore.js, attach.js, index.js
  shared/walkToLocation.js
  noopImpl/noopBrain.js
  wanderImpl/wanderBrain.js
  danImpl/             # utility brain (see danImpl/ARCHITECTURE.md)
```

`tileStore.js` is a legacy no-op hook; memory storage lives in `shared/npcMemory.js`.

Attach explicitly for test entities (or use `attachNpcBrain(npc, brain)` from `brain/attach.js`):

```js
import { createNpcEntity } from '../actors/npcSimulation.js';
import { DanBrain } from './brain/index.js';

const npc = createNpcEntity(0, 0, 0, { brain: new DanBrain() });
```

Swap implementations via constructor:

```js
new NPC(x, y, z, preset, name, inv, { brain: myCustomBrain });
```

Each `npc.brain.tick(...)` receives `visibleTiles` for this frame. Long-lived reads use `npcMemory` helpers (`getNpcTileMemory`, `getNpcTileMemoryStore`, `forEachNpcObservedTile`, etc.).

## Simulation order (per NPC, each frame)

`tickSimulation` calls `npc.tick` (`actors/npcSimulation.js`), which runs:

1. Vitality update (death check)
2. Perception snapshot (`tickNpcPerception`) — updates memory, returns current `visibleTiles`
3. `npc.brain.tick` — receives `visibleTiles` and `lastActionResult`; Dan and Wander return `null` while `resolvingAction` (Noop always returns `null`)
4. In-flight timed-action progression (`timedAction.tick`) if busy

Perception runs **before** the brain so newly seen tiles can influence pathfinding and planning on the same frame.

## Tile memory

**Module:** `shared/npcMemory.js`  
**Constant:** `NPC_PERCEPTION_RADIUS` in `shared/npcConstants.js` (default 5)  
**Storage:** internal store keyed by NPC; `tickNpcPerception` writes, `getNpcTileMemory(npc, …)` reads

Memory is created lazily on first perception write (all NPCs, regardless of brain type).

### Perception

Each frame, on the NPC's current floor (`npc.z`), every tile within **5 tiles** (Chebyshev distance) in the perception square is considered:

```ts
{ seenAt: gameTime, state: TileData snapshot, reachable?: boolean }
```

- **`state`** is a copy of the live tile (`snapshotTileState`) so later world edits do not change memory until the tile is seen again.
- **Off-map void** (no tile in the world, but within perception range) is recorded **once** as synthetic `WALL_STONE` with `reachable: false`, so NPCs learn map boundaries through sight.

### Reachability (`reachable`)

Optional flag on each memory entry:

| Value | Meaning |
|--------|---------|
| *(omitted)* | Unknown — `isTileMemoryReachable` treats this as pathable |
| `true` | Explicitly marked reachable (`markTileReachable`) |
| `false` | Impassable or pathing failed — skip when choosing targets |

**Set `false` when:** a void tile is first perceived, or code calls `markTileUnreachable`.

**Cleared (back to unknown) when:** the tile is re-perceived and **`state` changed** (e.g. door unlocked, object replaced). Same snapshot keeps the previous `reachable` value.

Helpers: `markTileUnreachable`, `markTileReachable`, `isTileMemoryReachable`.

Dan's `farmTask` skips tiles with `reachable === false` when scanning the hypothetical world.

### How brains use memory

| Brain | Uses tile memory |
|-------|------------------|
| **Wander** | Builds a hypothetical world from memory for pathfinding; idles until memory is non-empty |
| **Dan** | Requires non-empty memory before acting; hypothetical planning and farming scan memory-backed tiles |
| **Noop** | Perception still runs; brain ignores memory |

### Tests

- `shared/npcMemory.test.mjs` — perception, snapshots, void tiles, reachability reset on state change
- `shared/hypotheticalWorld.test.mjs` — copy-on-write world from memory
- `brain/shared/walkToLocation.test.mjs` — pathfinding
- `brain/danImpl/actionMemory.test.mjs` — action log buffering
- `brain/danImpl/danBrain.integration.test.mjs` — Dan tick loop and task selection

Run: `npm test`

## Dan LLM (optional)

With `?brain=dan`, the NPC panel exposes a **Think** button (`DanBrain.think()`). LLM calls run async and do not block the tick loop.

Configure via URL params (see `brain/danImpl/llm/llmConfig.js`):

| Param | Default | Purpose |
|--------|---------|---------|
| `llm` | `mock` | `mock`, `openrouter`, or `openai` |
| `apiKey` | (localStorage `world_llm_api_key`) | API key; without one, mock responses are used |
| `model` | provider default | Override model id |
| `llmLog` | on | Set `0` to silence browser console logging |

Full think/conversation flow: [brain/danImpl/notes/llm-communication.md](./brain/danImpl/notes/llm-communication.md).

## Chunk descriptions (debug / tests)

**Module:** `shared/tileChunkDescribe.js`

Exports English chunk summaries (`describeChunkSnapshot`, `describeChunkDiff`) and `tileStatesEqual` (used by `npcMemory.js` for snapshot comparison). Not wired into any live brain prompt — Dan's LLM context uses `danImpl/zoneUtils.js` instead.
