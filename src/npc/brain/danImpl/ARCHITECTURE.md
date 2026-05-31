# Dan Brain — Architecture

Dan is a utility-driven NPC brain that plans by hypothetically running the same task code used at execution time. Enable with `?brain=dan` (see `npcBrainRuntime.js`).

For the underlying theory (utility math, hypothetical overlays, design rationale), see [notes/index.md](./notes/index.md).

## Layout

```
danImpl/
  danBrain.js       — tick loop, utility function, task selection
  danContext.js     — RealContext / HypotheticalContext, drainHypo()
  tasks/
    eat.js          — consume best available food
    farm.js         — harvest / cook / plant loop
    explore.js      — walk toward map frontier
  notes/            — theory (index.md + utility_functions/)
  ARCHITECTURE.md   — this file
```

Shared dependencies outside `danImpl/`:

| Module | Role |
|--------|------|
| `npc/shared/npcMemory.js` | Tile memory from perception; void tiles at map edges |
| `npc/shared/hypotheticalWorld.js` | Copy-on-write world + entity for hypo simulation |
| `npc/brain/shared/walkToLocation.js` | Real-mode pathfinding; exported `findPath` for hypo |
| `domain/entityActions.js` | Atomic actions (`eatAction`, harvest, plant, cook, …) |

## Tick loop

Each frame, `DanBrain.tick()`:

1. Waits if the NPC is mid-action (`resolvingAction`).
2. Resumes the current task generator with the last action result, or starts a new one when idle.
3. Yields at most one `EntityAction` per tick to the simulation.

When a task generator completes, `_chooseTask()` runs again. The brain does **not** remember which task was “in progress” for planning purposes — only the active generator holds execution state.

## Real vs hypothetical contexts

Tasks are generator functions taking a `DanContext`. They never branch on “am I planning?” directly; they call leaf primitives:

- `yield* ctx.walkTo(target)` — move to a tile
- `yield* ctx.applyAction(action)` — perform a world interaction

| | RealContext | HypotheticalContext |
|---|-------------|---------------------|
| `walkTo` | Yields `moveToTileAction` steps via `walkToLocation` | A* path, teleport entity, accumulate `newTilesSeen` |
| `applyAction` | Yields the action; engine runs it | Calls `action.apply(hypoWorld)` synchronously |
| `newTilesSeen` | Always empty | Set of `"x,y,z"` keys newly visible along walked paths |

`RealContext.hypothetical(memory)` clones the NPC into a `HypotheticalContext` backed by `createHypotheticalFromMemory(memory)`. Task selection drains each candidate task through this hypo context with `drainHypo()`, which asserts no actions are yielded.

## Task selection

On each replan, `_chooseTask()`:

1. Computes a fixed **centroid** of known tiles on the NPC’s floor (from tile memory).
2. Scores the **baseline** utility at the real position (`initialU`).
3. For each task in `[eatTask, farmTask, exploreTask]`:
   - Branches a fresh `HypotheticalContext`.
   - Runs the task to completion with `drainHypo()`.
   - Computes `ΔU = utility(hypo) − initialU`.
4. Starts the task with the largest positive `ΔU`, or idles if none beat zero.

The winning hypo context’s final position is stored for status display (`farming → (x, y, z)`, etc.).

## Utility function

`utility(ctx, centroid)` sums four terms evaluated on the hypo (or real) state:

| Term | Purpose |
|------|---------|
| **foodUtility** | `-1 / (satiety + inventory nutrition)` — rewards food security and satiety |
| **hungerPenalty** | Quadratic penalty for `hunger > 40` — makes eating have positive ΔU (the pure food term alone treats satiety and inventory as substitutes, so ΔU(eat) = 0) |
| **explorationUtility** | `EXPLORE_WEIGHT × Σ min(1/dist, 1)` over `ctx.newTilesSeen`, dist to centroid — only tiles newly seen along walked paths count |
| **cropUtility** | `-0.2 / max(1, foodTotalSatiety + cropCount)` — nudges Dan to maintain a crop pipeline |

Exploration is path-based, not position-based: farming through known territory does not inflate explore ΔU, and idling does not score exploration from the current tile alone.

## Tasks

### `eatTask`

Picks the best edible item in inventory (bread → steak → wheat priority) and applies `eatAction`. No movement. Competes via hunger penalty when Dan is hungry enough.

### `farmTask`

Internal loop (up to `MAX_FARM_STEPS` in hypo mode):

1. `chooseBestFarmTarget()` scans remembered tiles for harvest (weight 3), cook (weight 2), plant (weight 1) opportunities.
2. Scores each as `weight / Chebyshev distance` to the NPC.
3. Walks to the walk target, performs one action, repeats until nothing remains.

Cooking stops at `MAX_BREAD_STOCK` bread. Planting requires seeds, bare dirt, and walkable tile.

### `exploreTask`

Finds the best of eight directional **frontier goals** (last known walkable tile before unknown terrain), scores candidate goals by weighted new tiles visible from the goal divided by path length, walks to the winner.

## Perception and map edges

`tickNpcPerception()` records tiles within `NPC_PERCEPTION_RADIUS`. Coordinates with no world tile (off-map void) are written once as synthetic `WALL_STONE` entries with `reachable: false`. Dan learns boundaries through sight, not omniscience — this prevents endless re-exploration of map edges.

Hypothetical `walkTo` treats tiles absent from **memory** as unseen for exploration scoring; void tiles in memory are known and impassable.

## Known gaps / future work

- Full lookahead with **health** in utility would replace the hunger penalty hack (see comments in `danBrain.js` and `notes/index.md`).
- `cropUtility` weight and mature-vs-all crop counting need calibration.
- `eatTask` still has `HUNGER_EAT_THRESHOLD` exported but selection is utility-driven, not threshold-gated.
- Engine refactor may change action/timed-action shapes; revisit `notes/index.md` when stable.
