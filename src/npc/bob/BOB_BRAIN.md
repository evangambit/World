# BobBrain

**Modules:** `bobBrain.js`, `bobContext.js`, `bobTasks.js`, `bobBehaviors.js`
**Shared:** `npcMemoryWorld.js` (MemoryWorldView), `thomasPerception.js` (wall-respecting perception)

BobBrain is a **utility-driven planner** built on top of the same tick-to-async execution engine as ThomasBrain.  The key addition is a `simulate` method paired with every `execute` coroutine.  Before starting any task, the scheduler runs each candidate's `simulate` synchronously, scores the projected outcome with a utility function, and executes the winner.

---

## Architecture overview

Every simulation tick the engine calls `BobBrain.tick()`, which:

1. Runs **wall-respecting perception** (reuses `tickThomasPerception` — supercover DDA raycast, same as Thomas).
2. **Resolves the pending `nextTick()` promise**, advancing the running execute coroutine by one frame (same tick-to-async bridge as ThomasBrain).
3. If no task is running, calls **`_scheduleNextTask()`**:
   - Snapshots the current NPC state into a `SimContext`.
   - For each candidate task class, clones the `SimContext`, calls `task.simulate(clone)`, and scores the `SimResult` with the utility function.
   - Instantiates the highest-scoring task and starts its `execute(ctx)` coroutine.
   - When execute returns (task complete or `endTick` reached), scheduling fires again on the next tick.

**Default task classes:** `EatFoodTask`, `FarmAndBakeTask`, `ExploreTask`, `IdleTask`.

---

## The simulate / execute pair

Every task class has the same constructor signature and two methods:

```js
class MyTask {
    constructor(endTick) { this.endTick = endTick; }

    simulate(simCtx) { /* synchronous, heuristic — mutates simCtx */ }
    async execute(ctx) { /* async coroutine — drives the live NPC */ }
}
```

`endTick` is an **absolute tick deadline** set by the scheduler to `now + reevalInterval` (default 100).  Both methods respect it: simulate stops projecting when `simCtx.currentTick >= endTick`; execute returns when `ctx.tickCount >= endTick`.

Sub-tasks inherit the parent's deadline by capping their own: `new SubTask(Math.min(subDeadline, this.endTick))`.

### Task restart invariant

Execute functions must not carry progress in local variables.  Any state that matters between iterations must live in `npc.tileMemory` or the world.  This guarantees that cancelling and restarting a task produces the same behavior as continuing — which is why the scheduler can safely re-instantiate tasks each `reevalInterval` ticks without saving or restoring coroutine state.

---

## SimContext (`bobContext.js`)

`SimContext` carries projected mutable state through the simulate call tree.  It is created once per scheduling cycle via `SimContext.fromBrain(brain)` and **cloned** before each candidate task's simulate call so tasks cannot corrupt each other.

| Field | Type | Description |
|---|---|---|
| `tileMemory` | `Map` (read-only ref) | Live NPC memory — not mutated during simulate |
| `world` | `World3D` (read-only ref) | Used only for pathfinding via `MemoryWorldView` |
| `projectedX/Y/Z` | `number` | Projected NPC position, updated by `simMove` |
| `currentTick` | `number` | Absolute tick counter, advances as actions are modelled |
| `projectedHunger` | `number` | Projected hunger, updated by `adjustHunger` |
| `_inventory` | `Map<objType, count>` | Projected inventory, updated by `adjustInventory` |
| `_simDiscoveredKeys` | `Set<string>` | Tile keys already credited as discovered this run — prevents double-counting across multiple `simMove` calls |
| `elapsedTicks` | `number` | Ticks consumed so far (accumulated output) |
| `newTilesDiscovered` | `number` | New tiles credited so far (accumulated output) |

**Key methods:**

`simMove(tx, ty, endTick)` — The core simulate primitive.  Runs A\* via `MemoryWorldView` (memory-backed, not ground-truth world), advances `currentTick`/`elapsedTicks`/`projectedX/Y`, and credits newly visible tiles at the destination.  Returns `'arrived'` | `'impossible'` | `'max_ticks'`.  Only mutates on `'arrived'` — callers can try alternatives on `'impossible'` without cloning.

`canReach(tx, ty)` — Non-mutating A\* reachability check via `MemoryWorldView`.

`countPotentialDiscoveries(tx, ty)` — Counts tiles in perception radius of `(tx, ty)` absent from both `tileMemory` and `_simDiscoveredKeys`.  Used by `WanderTask.simulate` to pick the most information-rich direction.

`clone()` — Deep-copies all mutable fields including `_simDiscoveredKeys`.  The scheduler calls this before each candidate task so simulations are independent.

`toResult()` — Returns a `SimResult` passed to the utility function.

### SimResult

```js
{
    elapsedTicks: number,          // ticks the task would consume
    netInventoryDelta: Record<objType, number>,  // net item changes
    newTilesDiscovered: number,    // new tiles that would enter memory
    netHungerDelta: number,        // hunger change (negative = ate food)
}
```

---

## Memory-backed pathfinding (`npcMemoryWorld.js`)

All planning uses `MemoryWorldView` instead of the live `World3D`:

- **Known tiles** — walkability derived from remembered terrain/obj/doorLocked state.
- **Unknown tiles** — treated as walkable (optimistic open-world assumption: the NPC doesn't know they're blocked).

If the NPC plans a route through an unmapped area that turns out to be blocked, the execute path returns `IMPOSSIBLE` and marks the tile unreachable in memory.  The live locomotion engine (`npc.setGoal`) still uses the real `World3D` — walls are always enforced at runtime.

---

## Primitive task classes (`bobTasks.js`)

| Class | simulate | execute |
|---|---|---|
| `MoveTask(endTick, tx, ty)` | `simCtx.simMove(tx, ty, endTick)` | `moveTowardLocation` |
| `SeekDesiresTask(endTick, desires)` | Scan memory with `findDesirableTiles`, resolve approach tile, `simMove` to best | `seekKnownDesires` |
| `WanderTask(endTick)` | Score 4 cardinal directions by `countPotentialDiscoveries`, `simMove` to best reachable | `wanderOnce` |
| `TimedActionTask(endTick, actionId, tx, ty, estimatedTicks)` | Advance `currentTick` by `estimatedTicks` | `doTimedAction` |

All primitives return typed exit codes (`MoveResult.*`, `SeekResult.*`, `ActionResult.*`) consistent with the Thomas task layer they delegate to on the execute path.

---

## High-level task classes (`bobBehaviors.js`)

High-level tasks return a `SimResult` from simulate (scored by the utility function) and run a full behavior coroutine from execute.

### `EatFoodTask`

**simulate:** While hungry and bread is in projected inventory, eats one loaf per tick, reducing `projectedHunger` and adjusting inventory.

**execute:** Eats bread from live inventory until no longer hungry, out of bread, dead, or `endTick`.  Returns early so the scheduler can pick the next task immediately.

### `FarmAndBakeTask`

**simulate:** Loops `_simStep` until `endTick`.  Each step: bake bread if surplus wheat → otherwise seek the best farming target (mature crops > empty dirt if have seeds > tall grass if have seeds > stove if have wheat) → model the inventory effect of interacting.  Falls back to `WanderTask` when nothing is known.

**execute:** Same priority-ordered loop against the live world.  Uses `SeekDesiresTask.execute` and `WanderTask.execute` for sub-goals.

### `ExploreTask`

**simulate:** Repeatedly calls `WanderTask.simulate`, accumulating `newTilesDiscovered` until `endTick`.

**execute:** Repeatedly calls `WanderTask.execute` (random walk near home) until `endTick`.

### `IdleTask`

**simulate:** Burns the remaining tick budget with zero delta — used as a baseline so any productive task scores higher.

**execute:** Waits until `endTick`.

---

## Utility function (`defaultBobUtility`)

Scores a `SimResult` given the NPC's current state.  Higher is better.

```
score  = hungerRelief   × hungerFactor          // hunger reduced (negative netHungerDelta)
       + breadGained    × 10 × hungerFactor     // bread in inventory
       + wheatGained    × 3
       + seedsGained    × 1
       + newTiles       × 0.2
```

`hungerFactor = 1 + hunger / 100` — a starving NPC weights food outcomes more heavily.  Supply a custom `utilityFn` to `BobBrain` to change priorities per-NPC.

---

## Branching in simulate

The scheduler clones `SimContext` before each candidate task's simulate, so tasks cannot interfere.  Within a single simulate call tree, branching also uses `clone()`:

```js
const branchA = simCtx.clone();
strategyA(branchA);

const branchB = simCtx.clone();
strategyB(branchB);

return branchA.newTilesDiscovered > branchB.newTilesDiscovered
    ? branchA.toResult()
    : branchB.toResult();
```

For cases where a sub-call only mutates on success (e.g. `simMove` only mutates on `'arrived'`), iterating over alternatives is safe without cloning — the state is unchanged on `'impossible'`.

---

## Writing a new task

```js
export class MyTask {
    constructor(endTick) {
        this.endTick = endTick;
    }

    simulate(simCtx) {
        // Model the outcome heuristically.
        // Use simCtx.simMove, simCtx.adjustInventory, sub-task.simulate, etc.
        // Return simCtx.toResult() at the end.
        const seek = new SeekDesiresTask(this.endTick, myDesires);
        if (seek.simulate(simCtx) === SeekResult.ARRIVED) {
            simCtx.adjustInventory(Obj.WHEAT, +1);
        }
        return simCtx.toResult();
    }

    async execute(ctx) {
        while (ctx.tickCount < this.endTick) {
            if (ctx.npc._dead) return;
            const seek = new SeekDesiresTask(
                Math.min(ctx.tickCount + 500, this.endTick),
                myDesires,
            );
            if (await seek.execute(ctx) === SeekResult.ARRIVED) {
                doSomething(ctx);
            }
            await ctx.nextTick();
        }
    }
}
```

Register it with the scheduler:

```js
const brain = createBobBrain({
    taskClasses: [EatFoodTask, MyTask, FarmAndBakeTask, ExploreTask, IdleTask],
});
```
