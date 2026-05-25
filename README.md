# World

A small tile-based village sim: shared world rules, player input, and NPC task/plan AI.

## Source layout

```text
src/
  main.js                 # Entry: game loop, player UI wiring
  world/                  # Simulation substrate (no actors)
    world.js              # Tile grid, walkability, transitions
    tileTypes.js          # Terrain/object enums and gameplay rules
    index.js              # Re-exports tileTypes (optional barrel)
    pathfinding.js        # A* on walkable tiles
    worldConstants.js     # Shared constants (e.g. WORLD_CHUNK_SIZE)
  simulation/             # Per-frame world tick (crops, NPCs)
    tickSimulation.js
    playerSimulation.js   # Headless player body (tests); game uses playerController
  domain/                 # Actor-agnostic game logic
    cooking.js            # Inventory transforms (steak, etc.)
    crops.js              # Wheat planting, growth, harvest
    vitality.js           # Shared hunger/health (player and NPCs)
    timedActions.js       # Registry for timed world actions (clear grass, etc.)
    entityActions.js      # Shared "actor did X in the world" API
  actors/                 # Bodies in the world
    entity.js             # Shared body (movement, inventory, vitality)
    timedActionRunner.js  # Runs timed actions on an entity (blocks movement)
    npcSimulation.js      # NPC vitality/movement/death (no AI — use in tests)
    npcLocomotion.js      # Pathfinding + path follow
    npc.js                # Full NPC (sim + task/plan brain)
  npc/                    # NPC control (scheduling, plans, memory — see npc/README.md)
    shared/               # Tile memory, object tags, chunk describe, brain runtime
    brain/                # Brain interface + task / wander / thomas / noop impls
    llm/                  # LLM planner + prompts (task brain)
      npcPlanner.js       # Planner contract and plan JSON validation
      npcPrompt.js        # System/user prompt builders
      npcActionCatalog.js # Machine-readable plan DSL (kept in sync with runner)
      createLlmPlanner.js # Factory wiring prompt → provider → plan
      plannerRuntime.js   # Resolves LLM provider config (env vars / localStorage)
      llmResponseCache.js # Disk cache for LLM responses
      mockPlanner.js      # Default dev/test planner (returns built-in plan when hungry)
      extractJson.js      # Pulls JSON object from raw or fenced model output
      llmTypes.js         # Shared LLM message/role types (used by all providers)
      providers/          # OpenAI-compatible and OpenRouter backends
  content/                # Maps and spawns (data, not rules)
    builder.js
  architecture/           # Import-boundary tests (logic vs client)
  client/                 # Browser presentation (must not be imported by logic/tests)
    tileArt.js            # Tile/object sprite pre-rendering (canvas)
    entitySprites.js      # Character pixel art (canvas)
    entityAppearance.js   # Entity sprite cache + animation
    playerController.js   # Keyboard → player entity
    input.js
    camera.js
    renderer.js
```

Imports use explicit paths (e.g. `../domain/entityActions.js`). Entry point: `index.html` → `src/main.js`.

## Architecture philosophy

### Layers (bottom to top)

1. **World** (`src/world/`) — What exists and what is legal. Tile data, walkability, object types, container rules, door lock state. No actor-specific logic; if something is impossible in the world, it is impossible for everyone.

2. **Domain logic** (`src/domain/`, except `entityActions`) — Pure transformations that do not care *who* is acting (e.g. turn uncooked steak into cooked steak in an inventory array; advance wheat crop stage; apply hunger). No positions, no UI, no pathfinding.

3. **Entity actions** (`src/domain/entityActions.js`) — **The contract for "something an actor can do."** Each function takes an `Entity` (player or NPC), a `World3D`, and coordinates or item ids. Pick up, cook at stove, toggle door, drop, take/stash in containers. If player and NPC should behave the same in the world, the rule lives here (or in domain logic it calls).

4. **Actors** (`src/actors/`) — Bodies in the world: position, layer, inventory, movement. `Entity` holds shared state; `NPC` adds a pluggable **brain**. The human player is an `Entity` updated from `client/playerController.js`. Actor methods should be thin wrappers over `entityActions` when they represent world interactions.

5. **Control / presentation** — How an actor *chooses* to invoke actions:
   - **Player:** `src/main.js` + `src/client/playerController.js` — clicks, keys, inventory/container panels, messages.
   - **NPC:** `src/npc/` — pluggable brain (`NpcTaskBrain` / `NoopNpcBrain`), queued tasks, async travel, declarative plans (`seq` / `sel`), object tags, **tile memory** and plan location refs (`rememberLocationsOfNearby`). Details: [`src/npc/README.md`](src/npc/README.md).

6. **Content** (`src/content/`) — Maps, buildings, spawns. Not gameplay rules.

```text
  [ Player input / NPC plans ]
            │
            ▼
     entityActions  ◄── single source of truth for "did it work?"
            │
     ┌──────┴──────┐
     ▼             ▼
  world/      domain/ (cooking, crops, vitality, timedActions, …)
```

**Principle:** Push behavior down until it cannot go lower without losing actor-agnostic meaning. World rules stay in the world; inventory math stays in domain modules; anything that needs a body in the world goes through entity actions.

---

## Keeping player and NPC actions in sync

**Goal:** Anything the player can do to the world, an NPC should be able to do (and vice versa), without maintaining two implementations.

### Rule: implement once, wire twice

| Step | Player | NPC |
|------|--------|-----|
| Define the effect | `entityActions.*` (or domain module) | *same* |
| Trigger it | `main.js` (click / key → action) | Plan leaf, task primitive, or `enqueue` → *same* action |
| Feedback | UI messages, panels | Plan failure logs; no duplicate game rules |

Do **not** put world-changing logic in `main.js` or `npcPlanRunner.js` except to call `entityActions` (or to schedule movement before an action).

### What belongs where

- **`domain/entityActions.js`** — Adjacency checks, door key rules, drop placement, container transfer. Returns success/failure (and optional messages for UI).
- **`domain/timedActions.js`** — Registry for actions that take real time (e.g. clearing grass). Both player and NPC runners call these; add new timed effects here.
- **`main.js`** — *When* the player tries (clicked tile, pressed E), *what* to show (open chest panel, toast). Opening a container UI is presentation; moving items uses `takeFromContainer` / `stashToContainer`.
- **`npc/`** — *When* and *in what order* (go to tile, then door; find stove, then cook). Plans use **object tags** (`npcObjectTags.js`) and **memory refs** (`rememberLocationsOfNearby(stove)` in plan `ref` fields) so JSON stays abstract; leaves resolve tags and call the same actions as the player. See [`src/npc/README.md`](src/npc/README.md).

### Adding a new capability (checklist)

1. Add or extend types/rules in `world/tileTypes.js` / `world/world.js` if the world model changes.
2. Add pure logic in a domain module if it is inventory-only and actor-agnostic.
3. If the action takes time, add an entry to `domain/timedActions.js`; otherwise add **`entityActions.yourAction(entity, world, …)`** with all placement, adjacency, and permission checks.
4. **Player:** hook input in `main.js` → call the action → refresh UI.
5. **NPC:** add a plan leaf type (and/or `runYourAction` in `npcTaskPrimitives.js`) that calls the **same** function after `travelNpcToTile` if needed.
6. If NPCs need to refer to a place or thing abstractly, add an object tag and/or a memory ref query; do not reimplement the effect in the plan runner.

### Movement is separate (on purpose)

Movement uses two paths today: player `tryMove` (continuous input) vs NPC `moveToAction` / `travelNpcToTile`. That is fine—control differs, but **interactions** must not fork. After both stand next to a stove, they both call `cookAtStove`.

### Plans vs tasks

- **Tasks** (`goTo`, `find`) — imperative queue, good for simple scripts and spawn behavior.
- **Plans** (`seq`, `sel`, leaves like `eat`, `door`, `take`, `explore`) — composable behavior; still must bottom out in `entityActions`.

When a plan step needs a remembered place (stove, chest), use **`ref`: `rememberLocationsOfNearby(tag)`** — not hard-coded coordinates. The NPC must have perceived that tile first. For finding objects over a large area, use an **`explore`** step (`npcExplore.js`), which walks a grid of waypoints and retries `find` at each stop.

### NPC brain

Each NPC has a pluggable **brain** (`npc/brain/`):

- **`NpcTaskBrain`** — perception + task/plan queue with optional LLM planner (default for the `NPC` class).
- **`WanderBrain`** — no memory or plans; periodically picks a random walkable tile near home and walks there.
- **`ThomasBrain`** — wall-respecting tile memory (supercover DDA raycast) + async behavior framework; default behavior is autonomous wheat farming. See [`src/npc/README.md`](src/npc/README.md) for the full task API.
- **`NoopNpcBrain`** — no cognition (body-only tests).

Select at runtime with `?brain=task` (default), `?brain=wander`, `?brain=thomas`, or `?brain=noop` (see `npcBrainRuntime.js`).

Per-frame simulation order (see `tickSimulation.js`):

1. `tickNpcSimulation` — vitality, locomotion, timed actions
2. `npc.brain?.tick` — perception → task queue (which runs `syncMemoryRefTravelGoal` internally)

Perception runs **before** the task runner so newly seen tiles can influence travel and plans on the same frame. Full brain/memory/plan details: [`src/npc/README.md`](src/npc/README.md).

### LLM planning

`npc/llm/` contains an optional LLM-backed planner that produces plan JSON at runtime:

- **`npcPrompt.js`** — builds system and user prompts (tile chunk descriptions, plan history, surroundings).
- **`npcActionCatalog.js`** — machine-readable plan DSL; kept in sync with `npcPlanRunner.js`.
- **`createLlmPlanner.js`** — factory that wires prompt → provider → validated plan.
- **`plannerRuntime.js`** — resolves LLM provider config from env vars (Node) or URL params / localStorage (browser).
- **`providers/`** — OpenAI-compatible and OpenRouter backends.

The planner is wired in via `NpcTaskBrain`'s `planner` option. `createDefaultTaskBrain` uses `mockPlanner` as the default when no planner is supplied; pass `planner: null` to disable LLM planning entirely. The brain falls back to templates when the planner returns `null`.

### NPC tile memory (summary)

NPCs record tiles within **5 tiles** (Chebyshev) on their current floor each frame (`tileMemory`: snapshot + `seenAt`). Failed pathfinding marks a tile **`reachable: false`** until the tile's remembered **state** changes. Plan `goto` / `take` / `stash` / `action` steps can use `rememberLocationsOfNearby(stove)` to walk to the nearest **reachable** remembered match, retargeting if a closer one is seen while traveling. Full behavior: [`src/npc/README.md`](src/npc/README.md).

### Tests

Run: `npm test` (colocated `src/**/*.test.mjs` via `node:test`).

Test files live next to the module they cover:

| Test file | Covers |
|---|---|
| `domain/crops.test.mjs` | Wheat growth and harvest |
| `npc/shared/npcMemory.test.mjs` | Perception, snapshots, reachability reset |
| `npc/brain/taskImpl/npcMemoryTravel.test.mjs` | Travel, retargeting, skipping unreachable tiles |
| `npc/npcPlanRefs.test.mjs` | `rememberLocationsOfNearby` ref resolution |
| `npc/npcPlanRunner.test.mjs` | seq/sel execution and failure |
| `npc/npcPlanHistory.test.mjs` | Rolling plan log |
| `npc/npcPlanDescribe.test.mjs` | Plan step descriptions |
| `npc/npcExplore.test.mjs` | Wide-area waypoint search |
| `npc/shared/tileChunkDescribe.test.mjs` | Chunk snapshot and diff strings |
| `npc/thomasBehaviors.test.mjs` | Behavioral regression: full `farmBehavior` loop over 10 000 ticks |
| `npc/llm/*.test.mjs` | Prompt building, plan parsing, response cache |
| `architecture/importLayers.test.mjs` | Layer boundary enforcement |

For new rules, add a `*.test.mjs` next to the module under test.

#### Behavioral regression tests

`thomasBehaviors.test.mjs` runs `ThomasBrain` / `farmBehavior` for 10 000 simulation ticks (~500 game-seconds) in under a second — no browser, no renderer. It uses `buildVillage()` for a realistic world and asserts the NPC survives and ends with ≥ 5 bread (meaning the full farming cycle ran at least once). The `[bread-production]` console line prints a snapshot of final inventory and hunger for comparing productivity across AI-code changes.

The key technique: `tickSimulation` is synchronous, but `ThomasBrain` behaviors are async coroutines. A plain `for` loop would freeze them (microtasks don't drain mid-loop). Adding `await Promise.resolve()` after each tick flushes the queue so the coroutine advances one step per tick, matching how the browser loop works.

### Layer boundaries (presentation vs logic)

**Rule:** `world/`, `domain/`, `actors/`, `simulation/`, `npc/`, `content/`, all `src/**/*.test.mjs` (except under `client/`), and `scripts/` must **not** import `client/` or `main.js`. Rendering, input, and canvas code live in `client/`; the game entry `main.js` wires UI to simulation.

**Enforced by:** `src/architecture/importLayers.test.mjs` (runs with `npm test`). Presentation must not import `main.js` either.

Allowed direction: `main.js` → `client/` + logic layers; `client/` → logic layers only (e.g. `tileTypes`, `vitality` for HUD colors — not `Renderer` from npc code).

---

## Key files (quick reference)

| Path | Role |
|------|------|
| `domain/entityActions.js` | Shared actor ↔ world interactions |
| `domain/timedActions.js` | Timed action registry (clear grass, etc.) |
| `domain/cooking.js` | Inventory-only cooking transform |
| `domain/crops.js` | Wheat growth and harvest |
| `domain/vitality.js` | Shared hunger/health |
| `actors/entity.js`, `actors/npcSimulation.js`, `actors/npc.js`, `client/playerController.js` | Actor state and movement |
| `actors/timedActionRunner.js` | Runs timed actions on entities |
| `main.js` | Player input and UI |
| `npc/brain/` | Pluggable NPC brain interface + implementations |
| `npc/shared/npcBrainRuntime.js` | Resolves `?brain=` URL param to a brain instance |
| `npc/brain/thomasImpl/` | Thomas perception, async tasks, behaviors |
| `npc/brain/taskImpl/` | Task queue, plans, explore, memory-ref travel |
| `npc/npcPlanRunner.js` | Plan execution (calls entity actions) |
| `npc/npcTaskPrimitives.js` | Low-level NPC steps (travel, find, door, drop, …) |
| `npc/npcExplore.js` | Wide-area search (`explore` plan step) |
| `npc/shared/` | Tile memory, object tags, chunk describe (shared across brains) |
| `npc/npcPlanRefs.js` | `rememberLocationsOfNearby(tag)` → tile list |
| `npc/npcMemoryTravel.js` | Adaptive pathing to memory refs |
| `npc/llm/npcPrompt.js` | LLM system/user prompt builders |
| `npc/llm/npcActionCatalog.js` | Machine-readable plan DSL |
| `npc/llm/createLlmPlanner.js` | LLM planner factory |
| `npc/README.md` | NPC memory, refs, plans, LLM (detail) |
