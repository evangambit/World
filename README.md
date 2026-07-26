# World

A small tile-based village sim: shared world rules, player input, and NPC brains.

## How to run

```
cd World
python3 -m http.server 8080
# Navigate to http://localhost:8080/?brain=dan&llm=openrouter&apiKey=YOUR_KEY
```

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
    npcSimulation.js      # NPC vitality/travel/death; brains return actions
    npc.js                # Full NPC (sim + pluggable brain)
  npc/                    # NPC control (scheduling, memory — see npc/README.md)
    shared/               # Tile memory, hypothetical world, brain runtime
    brain/                # Brain interface + wander / noop / dan impls
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
   - **NPC:** `src/npc/` — pluggable brain (`WanderBrain`, `DanBrain`, `NoopNpcBrain`), **tile memory**, utility task selection (Dan). Details: [`src/npc/README.md`](src/npc/README.md).

6. **Content** (`src/content/`) — Maps, buildings, spawns. Not gameplay rules.

```text
  [ Player input / NPC brains ]
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
| Trigger it | `main.js` (click / key → action) | Brain task → *same* action |
| Feedback | UI messages, panels | Plan failure logs; no duplicate game rules |

Do **not** put world-changing logic in `main.js` except to call `entityActions` (or to schedule movement before an action).

### What belongs where

- **`domain/entityActions.js`** — Adjacency checks, door key rules, drop placement, container transfer. Returns success/failure (and optional messages for UI).
- **`domain/timedActions.js`** — Registry for actions that take real time (e.g. clearing grass). Both player and NPC runners call these; add new timed effects here.
- **`main.js`** — *When* the player tries (clicked tile, pressed E), *what* to show (open chest panel, toast). Opening a container UI is presentation; moving items uses `takeFromContainer` / `stashToContainer`.
- **`npc/`** — *When* and *in what order* an NPC acts. Dan's tasks (eat, farm, explore, talk) call the same `entityActions` as the player. See [`src/npc/README.md`](src/npc/README.md).

### Adding a new capability (checklist)

1. Add or extend types/rules in `world/tileTypes.js` / `world/world.js` if the world model changes.
2. Add pure logic in a domain module if it is inventory-only and actor-agnostic.
3. If the action takes time, add an entry to `domain/timedActions.js`; otherwise add **`entityActions.yourAction(entity, world, …)`** with all placement, adjacency, and permission checks.
4. **Player:** hook input in `main.js` → call the action → refresh UI.
5. **NPC:** add or extend a Dan task (or new brain behavior) that calls the **same** function; the brain should emit movement actions per tick when repositioning is needed.

### Movement/action execution

Player and NPC share the same action execution primitives (`moveDirectionAction`, `tickEntityAction`, `runEntityAction`). Brains choose *which* action to run; world effects come from the same action layer.

### NPC brain

Each NPC has a pluggable **brain** (`npc/brain/`):

- **`WanderBrain`** (default) — random walk near home; uses tile memory for pathfinding
- **`NoopNpcBrain`** — no cognition (body-only tests)
- **`DanBrain`** — utility-driven eat / farm / explore / talk; optional LLM think and conversation ([architecture](src/npc/brain/danImpl/ARCHITECTURE.md))

Select at runtime with `?brain=wander` (default), `?brain=noop`, or `?brain=dan` (see `npc/shared/npcBrainRuntime.js`).

Per-frame simulation order (see `actors/npcSimulation.js`):

1. Vitality update
2. Perception (`tickNpcPerception`) — fills tile memory
3. `npc.brain?.tick` — choose next action (skipped while `resolvingAction`)
4. Timed-action progression if busy

Full brain and memory details: [`src/npc/README.md`](src/npc/README.md).

### NPC tile memory (summary)

NPCs record tiles within **5 tiles** (Chebyshev) on their current floor each frame (snapshot + `seenAt`). Off-map voids within range are stored once as impassable `WALL_STONE`. Optional `reachable: false` skips tiles in pathfinding and Dan's farm scan; cleared when the remembered tile **state** changes. Full behavior: [`src/npc/README.md`](src/npc/README.md).

### Tests

Run: `npm test` (colocated `src/**/*.test.mjs` via `node:test`).

Test files live next to the module they cover:

| Test file | Covers |
|---|---|
| `domain/crops.test.mjs` | Wheat growth and harvest |
| `domain/entityActions.test.mjs` | Shared actor ↔ world interactions |
| `npc/shared/npcMemory.test.mjs` | Perception, snapshots, reachability reset |
| `npc/shared/hypotheticalWorld.test.mjs` | Hypothetical world from tile memory |
| `npc/shared/tileChunkDescribe.test.mjs` | Chunk snapshot and diff strings |
| `npc/brain/shared/walkToLocation.test.mjs` | NPC pathfinding |
| `npc/brain/danImpl/actionMemory.test.mjs` | Dan action log buffering |
| `npc/brain/danImpl/danBrain.integration.test.mjs` | Dan tick loop and task selection |
| `architecture/importLayers.test.mjs` | Layer boundary enforcement |

For new rules, add a `*.test.mjs` next to the module under test.

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
| `actors/entity.js`, `actors/npcSimulation.js`, `actors/npc.js`, `client/playerController.js` | Actor state, action execution, and movement |
| `actors/timedActionRunner.js` | Runs timed actions on entities |
| `main.js` | Player input and UI |
| `npc/brain/` | Pluggable NPC brain interface + implementations |
| `npc/shared/npcBrainRuntime.js` | Resolves `?brain=` URL param to a brain instance |
| `npc/brain/danImpl/` | Dan utility brain, LLM think/conversation |
| `npc/shared/npcMemory.js` | Tile memory from perception |
| `npc/shared/hypotheticalWorld.js` | Copy-on-write world overlay for planning |
| `npc/shared/tileChunkDescribe.js` | Chunk summaries (tests; `tileStatesEqual` used by memory) |
| `npc/README.md` | NPC brains and tile memory (detail) |
| `npc/brain/danImpl/ARCHITECTURE.md` | Dan brain architecture (detail) |
