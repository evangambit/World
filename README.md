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
  simulation/             # Per-frame world tick (crops, NPCs)
    tickSimulation.js
    playerSimulation.js   # Headless player body (tests); game uses playerController
  domain/                 # Actor-agnostic game logic
    cooking.js            # Inventory transforms (steak, etc.)
    entityActions.js      # Shared “actor did X in the world” API
  actors/                 # Bodies in the world
    entity.js             # Shared body (movement, inventory, vitality)
    npcSimulation.js      # NPC vitality/movement/death (no AI — use in tests)
    npcLocomotion.js      # Pathfinding + path follow
    npc.js                # Full NPC (sim + task/plan brain)
  npc/                    # NPC control (scheduling, plans, memory — see npc/README.md)
    npcBrain.js           # Pluggable brain (memory + tasks; attach via npc.brain)
    npcMemory.js          # Per-tile perception + reachability
    npcMemoryTravel.js    # Adaptive travel toward memory refs
    npcPlanRefs.js        # rememberLocationsOfNearby(...) in plan steps
    npcTasks.js
    npcTaskPrimitives.js
    npcPlanRunner.js
    npcPlanTemplates.js
    npcObjectTags.js
    llm/                  # LLM planner + prompts
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

2. **Domain logic** (`src/domain/`, except `entityActions`) — Pure transformations that do not care *who* is acting (e.g. turn uncooked steak into cooked steak in an inventory array). No positions, no UI, no pathfinding.

3. **Entity actions** (`src/domain/entityActions.js`) — **The contract for “something an actor can do.”** Each function takes an `Entity` (player or NPC), a `World3D`, and coordinates or item ids. Pick up, cook at stove, toggle door, drop, take/stash in containers. If player and NPC should behave the same in the world, the rule lives here (or in domain logic it calls).

4. **Actors** (`src/actors/`) — Bodies in the world: position, layer, inventory, movement. `Entity` holds shared state; `NPC` adds AI control. The human player is an `Entity` updated from `client/playerController.js`. Actor methods should be thin wrappers over `entityActions` when they represent world interactions.

5. **Control / presentation** — How an actor *chooses* to invoke actions:
   - **Player:** `src/main.js` + `src/client/playerController.js` — clicks, keys, inventory/container panels, messages.
   - **NPC:** `src/npc/` — queued tasks, async travel, declarative plans (`seq` / `sel`), object tags, **tile memory** and plan location refs (`rememberLocationsOfNearby`). Details: [`src/npc/README.md`](src/npc/README.md).

6. **Content** (`src/content/`) — Maps, buildings, spawns. Not gameplay rules.

```text
  [ Player input / NPC plans ]
            │
            ▼
     entityActions  ◄── single source of truth for “did it work?”
            │
     ┌──────┴──────┐
     ▼             ▼
  world/      domain/cooking.js (etc.)
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
- **`main.js`** — *When* the player tries (clicked tile, pressed E), *what* to show (open chest panel, toast). Opening a container UI is presentation; moving items uses `takeFromContainer` / `stashToContainer`.
- **`npc/`** — *When* and *in what order* (go to tile, then door; find stove, then cook). Plans use **object tags** (`npcObjectTags.js`) and **memory refs** (`rememberLocationsOfNearby(stove)` in plan `ref` fields) so JSON stays abstract; leaves resolve tags and call the same actions as the player. See [`src/npc/README.md`](src/npc/README.md).

### Adding a new capability (checklist)

1. Add or extend types/rules in `world/tileTypes.js` / `world/world.js` if the world model changes.
2. Add pure logic in a domain module if it is inventory-only and actor-agnostic.
3. Add **`entityActions.yourAction(entity, world, …)`** with all placement, adjacency, and permission checks.
4. **Player:** hook input in `main.js` → call the action → refresh UI.
5. **NPC:** add a plan leaf type (and/or `runYourAction` in `npcTaskPrimitives.js`) that calls the **same** function after `travelToTile` if needed.
6. If NPCs need to refer to a place or thing abstractly, add an object tag and/or a memory ref query; do not reimplement the effect in the plan runner.

### Movement is separate (on purpose)

Movement uses two paths today: player `tryMove` (continuous input) vs NPC pathfinding (`travelToTile`). That is fine—control differs, but **interactions** must not fork. After both stand next to a stove, they both call `cookAtStove`.

### Plans vs tasks

- **Tasks** (`goTo`, `find`) — imperative queue, good for simple scripts and spawn behavior.
- **Plans** (`seq`, `sel`, leaves like `eat`, `door`, `take`) — composable behavior; still must bottom out in `entityActions`.

When a plan step needs a remembered place (stove, chest), use **`ref`: `rememberLocationsOfNearby(tag)`** — not hard-coded coordinates. The NPC must have perceived that tile first.

### NPC tile memory (summary)

NPCs record tiles within **5 tiles** on their current floor each frame (`tileMemory`: snapshot + `seenAt`). Failed pathfinding marks a tile **`reachable: false`** until the tile’s remembered **state** changes. Plan `goto` / `take` / `stash` / `action` steps can use `rememberLocationsOfNearby(stove)` to walk to the nearest **reachable** remembered match, retargeting if a closer one is seen while traveling. Full behavior: [`src/npc/README.md`](src/npc/README.md). Tests: `npcMemory.test.mjs`, `npcMemoryTravel.test.mjs`, `npcPlanRefs.test.mjs`, `npcPlanRunner.test.mjs`.

### Tests

Run tests: `npm test` (colocated `src/**/*.test.mjs` via `node:test`).

Legacy smokes in `scripts/`: `planRunnerSmoke.mjs`, `npcVitalitySmoke.mjs`, `simulationSmoke.mjs`. For new rules, add `*.test.mjs` next to the module under test (e.g. `domain/crops.test.mjs`).

### Layer boundaries (presentation vs logic)

**Rule:** `world/`, `domain/`, `actors/`, `simulation/`, `npc/`, `content/`, all `src/**/*.test.mjs` (except under `client/`), and `scripts/` must **not** import `client/` or `main.js`. Rendering, input, and canvas code live in `client/`; the game entry `main.js` wires UI to simulation.

**Enforced by:** `src/architecture/importLayers.test.mjs` (runs with `npm test`). Presentation must not import `main.js` either.

Allowed direction: `main.js` → `client/` + logic layers; `client/` → logic layers only (e.g. `tileTypes`, `vitality` for HUD colors — not `Renderer` from npc code).

---

## Key files (quick reference)

| Path | Role |
|------|------|
| `domain/entityActions.js` | Shared actor ↔ world interactions |
| `actors/entity.js`, `actors/npcSimulation.js`, `actors/npc.js`, `client/playerController.js` | Actor state and movement |
| `main.js` | Player input and UI |
| `npc/npcPlanRunner.js` | Plan execution (calls entity actions) |
| `npc/npcTaskPrimitives.js` | Low-level NPC steps (travel, find, door, drop, …) |
| `npc/npcObjectTags.js` | Abstract names for plan JSON |
| `npc/npcMemory.js` | Perception + `tileMemory` / reachability |
| `npc/npcPlanRefs.js` | `rememberLocationsOfNearby(tag)` → tile list |
| `npc/npcMemoryTravel.js` | Adaptive pathing to memory refs |
| `npc/README.md` | NPC memory, refs, plans (detail) |
| `domain/cooking.js` | Inventory-only cooking transform |
