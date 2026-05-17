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
  simulation/             # Per-frame world tick (crops, player, NPCs)
    tickSimulation.js
    playerSimulation.js
  domain/                 # Actor-agnostic game logic
    cooking.js            # Inventory transforms (steak, etc.)
    entityActions.js      # Shared “actor did X in the world” API
  actors/                 # Bodies in the world
    entity.js             # Shared body (movement, inventory, vitality)
    npcSimulation.js      # NPC vitality/movement/death (no AI — use in tests)
    npcLocomotion.js      # Pathfinding + path follow
    npc.js                # Full NPC (sim + task/plan brain)
  npc/                    # NPC control (scheduling, plans — not world rules)
    npcTasks.js
    npcTaskPrimitives.js
    npcPlanRunner.js
    npcPlanTemplates.js
    npcPlanBindings.js
    npcObjectTags.js
  content/                # Maps and spawns (data, not rules)
    builder.js
  client/                 # Browser presentation
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
   - **NPC:** `src/npc/` — queued tasks, async travel, declarative plans (`seq` / `sel`), object tags, binding queries.

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
- **`npc/`** — *When* and *in what order* (go to tile, then door; find stove, then cook). Plans use **object tags** (`npcObjectTags.js`) and **bindings** (`npcPlanBindings.js`) so JSON plans stay abstract; leaves resolve tags and call the same actions as the player.

### Adding a new capability (checklist)

1. Add or extend types/rules in `world/tileTypes.js` / `world/world.js` if the world model changes.
2. Add pure logic in a domain module if it is inventory-only and actor-agnostic.
3. Add **`entityActions.yourAction(entity, world, …)`** with all placement, adjacency, and permission checks.
4. **Player:** hook input in `main.js` → call the action → refresh UI.
5. **NPC:** add a plan leaf type (and/or `runYourAction` in `npcTaskPrimitives.js`) that calls the **same** function after `travelToTile` if needed.
6. If NPCs need to refer to the action abstractly, add an object tag or binding query; do not reimplement the effect in the plan runner.

### Movement is separate (on purpose)

Movement uses two paths today: player `tryMove` (continuous input) vs NPC pathfinding (`travelToTile`). That is fine—control differs, but **interactions** must not fork. After both stand next to a stove, they both call `cookAtStove`.

### Plans vs tasks

- **Tasks** (`goTo`, `find`) — imperative queue, good for simple scripts and spawn behavior.
- **Plans** (`seq`, `sel`, leaves like `eat`, `door`, `take`) — composable behavior; still must bottom out in `entityActions`.

When a plan step needs a tile (kitchen, home chest), resolve it via **bindings**, not hard-coded coordinates in JSON.

### Tests

`scripts/planRunnerSmoke.mjs` exercises plan leaves against stub worlds. `scripts/npcVitalitySmoke.mjs` runs starvation/death via `npcSimulation.js`. `scripts/simulationSmoke.mjs` uses `tickSimulation()` with `runNpcBrain: false`. For new actions, add a smoke case that calls the same `entityActions` entry point the game uses.

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
| `npc/npcPlanBindings.js` | Resolve “my kitchen”, “home chest”, etc. |
| `domain/cooking.js` | Inventory-only cooking transform |
