# NPC AI System Specification

## Overview

This document specifies an AI system for grid-based, tick-driven game NPCs. The system is built around three principles:

1. **Tasks are coroutines.** NPC behavior is expressed as JavaScript generator functions, not state-machine objects. Composition is via `yield*` (delegation).
2. **Real and hypothetical execution share code.** The same task function runs in both modes; only leaf primitives branch on context type. Hypothetical mode fast-forwards through actions for cheap planning.
3. **The brain is stateless w.r.t. task choice.** It re-derives the optimal task from the world model on demand. Save/load serializes only the world model.

## Core Types

### Atomic Actions

The game engine consumes one `AtomicAction` per tick from an NPC. Examples: `move(direction)`, `reload()`, `harvest()`, `openDoor(direction)`.

```js
// Shape: { type: string, ...params }
const Action = {
  move: (dir) => ({ type: 'move', direction: dir }),
  reload: () => ({ type: 'reload' }),
  harvest: () => ({ type: 'harvest' }),
  // ...
};
```

### Tiles and the World Model

```js
// A tile value (read-only data describing what's at a coordinate)
class TileValue {
  constructor({ passable, terrain, occupant, resource }) { /* ... */ }
}

// A remembered tile in the NPC's memory
class RememberedTile {
  constructor({ x, y, value, lastSeenTick }) { /* ... */ }
}

// Read interface
class WorldModelRead {
  get(x, y) { /* -> RememberedTile | null */ }
  tiles() { /* -> Iterable<RememberedTile> */ }
  npcPosition() { /* -> {x, y} */ }
  currentTick() { /* -> number */ }
}

// The NPC's persistent memory (lives on the GameNPC).
// This is the ONLY persistent state in the AI system.
class WorldModel extends WorldModelRead {
  update(tilesICanSee) { /* bulk update from perception */ }
  updateTile(x, y, lastSeenTick, value) { /* single tile update */ }
  setNpcPosition({ x, y }) { /* called by engine on real moves */ }
  setCurrentTick(t) { /* called by engine each tick */ }
}
```

### Contexts

A `Context` is what tasks operate on. There are two concrete kinds: `RealContext` and `HypotheticalContext`. They share an interface so task code is mode-agnostic — except at leaf primitives, which branch on `ctx.isReal`.

```js
class Context {
  get isReal() { /* abstract */ }
  get worldModel() { /* WorldModelRead */ }
  hypothetical() { /* -> HypotheticalContext */ }

  // Atomic action primitives — implementations differ by context type.
  // In real contexts, these yield an Action to the scheduler.
  // In hypothetical contexts, they mutate the overlay and return synchronously.
  //
  // All primitives are generator functions, so callers always use `yield*`.
  *move(direction) { /* abstract */ }
  *reload() { /* abstract */ }
  *harvest() { /* abstract */ }
  *openDoor(direction) { /* abstract */ }
  // ...
}
```

#### RealContext

```js
class RealContext extends Context {
  constructor(npc) {
    super();
    this._npc = npc;
  }
  get isReal() { return true; }
  get worldModel() { return this._npc.memory; }
  hypothetical() { return new HypotheticalContext(this); }

  // Each real primitive yields one or more Actions. The scheduler consumes
  // these and feeds them to the engine, one per tick.
  *move(direction) {
    yield Action.move(direction);
    return true; // engine will have updated worldModel.npcPosition by next resume
  }
  *reload() {
    // Reload takes multiple ticks; the engine handles that by not advancing
    // the NPC's action queue until reload completes. We yield once and the
    // scheduler resumes us after the reload duration.
    yield Action.reload();
    return true;
  }
  // ...
}
```

#### HypotheticalContext

```js
class HypotheticalContext extends Context {
  constructor(parent) {
    super();
    this._parent = parent;
    this._overlay = new WorldModelOverlay(parent.worldModel);
  }
  get isReal() { return false; }
  get worldModel() { return this._overlay; }
  hypothetical() { return new HypotheticalContext(this); }

  // Hypothetical primitives mutate the overlay and return synchronously.
  // They still must be generator functions so callers can `yield*` uniformly.
  *move(direction) {
    const pos = this._overlay.npcPosition();
    const newPos = stepInDirection(pos, direction);
    const tile = this._overlay.get(newPos.x, newPos.y);
    if (!tile || !tile.value.passable) return false;
    this._overlay.setNpcPosition(newPos);
    this._overlay.setCurrentTick(this._overlay.currentTick() + 1);
    return true;
  }
  *reload() {
    this._overlay.setCurrentTick(this._overlay.currentTick() + RELOAD_TICKS);
    // Update overlay's NPC state to reflect "weapon reloaded"
    return true;
  }
  // ...
}
```

### WorldModelOverlay

A copy-on-write overlay that falls through to its parent for unchanged data. Used by `HypotheticalContext` to hold predicted deltas without mutating the underlying world model.

```js
class WorldModelOverlay extends WorldModelRead {
  constructor(parent) {
    super();
    this._parent = parent;
    this._tileOverrides = new Map(); // key: "x,y" -> RememberedTile
    this._npcPosition = null;        // null = fall through
    this._currentTick = null;        // null = fall through
  }

  get(x, y) {
    const key = `${x},${y}`;
    if (this._tileOverrides.has(key)) return this._tileOverrides.get(key);
    return this._parent.get(x, y);
  }
  tiles() {
    // Merge overlay with parent, overlay wins on collision.
    const seen = new Set();
    const results = [];
    for (const [key, tile] of this._tileOverrides) {
      seen.add(key);
      if (tile !== null) results.push(tile);
    }
    for (const tile of this._parent.tiles()) {
      const key = `${tile.x},${tile.y}`;
      if (!seen.has(key)) results.push(tile);
    }
    return results;
  }
  npcPosition() {
    return this._npcPosition ?? this._parent.npcPosition();
  }
  currentTick() {
    return this._currentTick ?? this._parent.currentTick();
  }
  setNpcPosition(pos) { this._npcPosition = pos; }
  setCurrentTick(t) { this._currentTick = t; }
  updateTile(x, y, lastSeenTick, value) {
    this._tileOverrides.set(`${x},${y}`, new RememberedTile({ x, y, value, lastSeenTick }));
  }
}
```

## Tasks

A **task** is a generator function with the signature:

```js
function* taskName(ctx, ...params) {
  // ... task logic, yielding Actions in real mode, mutating context in hypothetical ...
  return result; // success indicator, optionally structured
}
```

### Task Conventions

1. **Every task is a generator function.** Even ones that have no `yield`. This is so callers can always use `yield*` uniformly.
2. **Tasks call subtasks with `yield*`.** This is the "await" pattern. In real mode, yielded `Action`s propagate up to the scheduler. In hypothetical mode, sub-generators run to completion synchronously.
3. **Tasks return a result.** At minimum a boolean (success/failure). For richer tasks, an object: `{ success: bool, reason?: string, info?: {...} }`.
4. **Tasks read from `ctx.worldModel`, never write directly.** Mutations to world state happen through context primitives (`yield* ctx.move(...)` etc.) so they're correctly routed to real engine actions or hypothetical overlay updates.
5. **Tasks should be deterministic given their inputs and the world model.** If a task needs randomness, it must take a seed (typically derived from NPC ID + current tick).

### Example: MoveTo (Leaf Primitive Task)

```js
function* moveTo(ctx, goal) {
  // Single-step move to an adjacent tile. Assumes goal is adjacent.
  const pos = ctx.worldModel.npcPosition();
  const dir = directionFromTo(pos, goal);
  if (!dir) return { success: false, reason: 'not_adjacent' };
  const ok = yield* ctx.move(dir);
  return { success: ok };
}
```

### Example: Pathfind (Composite Task)

```js
function* pathfind(ctx, goal, maxTicks) {
  const startTick = ctx.worldModel.currentTick();
  const path = aStar({
    start: ctx.worldModel.npcPosition(),
    goal,
    world: ctx.worldModel,
    unknownTileCost: 1.5,
  });

  if (!path.found) {
    return { success: false, reason: 'no_path' };
  }
  if (path.estimatedCost > maxTicks) {
    return { success: false, reason: 'over_budget', estimatedCost: path.estimatedCost };
  }

  for (const waypoint of path.waypoints) {
    const elapsed = ctx.worldModel.currentTick() - startTick;
    if (elapsed > maxTicks) {
      return { success: false, reason: 'timeout' };
    }
    const r = yield* moveTo(ctx, waypoint);
    if (!r.success) {
      // Path was invalidated mid-execution. Try to replan once.
      const newPath = aStar({
        start: ctx.worldModel.npcPosition(),
        goal,
        world: ctx.worldModel,
        unknownTileCost: 1.5,
      });
      if (!newPath.found) return { success: false, reason: 'no_path_replan' };
      const remaining = maxTicks - (ctx.worldModel.currentTick() - startTick);
      if (newPath.estimatedCost > remaining) {
        return { success: false, reason: 'over_budget_replan', estimatedCost: newPath.estimatedCost };
      }
      path.waypoints = newPath.waypoints;
      continue;
    }
  }

  return { success: true, ticksTaken: ctx.worldModel.currentTick() - startTick };
}
```

### Example: Explore (Higher-Level Task)

```js
const EIGHT_DIRECTIONS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function* explore(ctx, maxTicks) {
  // Hypothetically pathfind toward each direction's frontier, pick the best.
  let bestDir = null;
  let bestUtility = -Infinity;
  let bestGoal = null;

  for (const [dx, dy] of EIGHT_DIRECTIONS) {
    const steps = computeStepsUntilUnknownTile(ctx.worldModel, [dx, dy]);
    if (steps === 0) continue;
    const pos = ctx.worldModel.npcPosition();
    const candidateGoal = { x: pos.x + dx * steps, y: pos.y + dy * steps };

    const hypo = ctx.hypothetical();
    const r = yield* pathfind(hypo, candidateGoal, maxTicks);
    if (!r.success) continue;

    const utility = explorationUtility(hypo.worldModel, candidateGoal);
    if (utility > bestUtility) {
      bestUtility = utility;
      bestDir = [dx, dy];
      bestGoal = candidateGoal;
    }
  }

  if (bestGoal === null) {
    return { success: false, reason: 'nowhere_to_explore' };
  }
  return yield* pathfind(ctx, bestGoal, maxTicks);
}
```

## The Scheduler

The scheduler drives a task generator in real mode, consuming yielded `Action`s and feeding them to the engine one per tick.

```js
class Scheduler {
  constructor(npc) {
    this._npc = npc;
    this._currentGen = null;
    this._pendingAction = null;
  }

  // Called by GameNPC.tick(). Returns the next Action to execute, or null if
  // the NPC has nothing to do this tick (e.g., still completing a multi-tick action).
  tick() {
    if (this._pendingAction) {
      const a = this._pendingAction;
      this._pendingAction = null;
      return a;
    }
    if (!this._currentGen) {
      this._currentGen = this._npc.brain.chooseTask(new RealContext(this._npc));
    }
    const { value, done } = this._currentGen.next();
    if (done) {
      this._currentGen = null;
      // Brain will be asked for a new task on the next tick.
      return null;
    }
    // `value` should be an Action object.
    return value;
  }
}
```

## The Brain

The brain decides what task to run. It is **stateless** with respect to task choice — every call to `chooseTask` re-derives the answer from the world model.

```js
class GameNPCBrain {
  // Returns a generator (the chosen task), already invoked with the real context.
  // Called when the previous task finishes, or when the scheduler is empty.
  chooseTask(realCtx) {
    // Evaluate top-level options by hypothetical execution.
    const options = this._candidates(realCtx);
    let best = null;
    let bestUtility = -Infinity;

    for (const option of options) {
      const hypo = realCtx.hypothetical();
      // Drain the hypothetical generator to completion to get its outcome.
      const gen = option.factory(hypo);
      let result;
      while (true) {
        const step = gen.next();
        if (step.done) { result = step.value; break; }
        // In hypothetical mode, primitives shouldn't yield Actions; if they do,
        // that's a bug. Assert and bail.
        throw new Error('Hypothetical task yielded an Action: ' + JSON.stringify(step.value));
      }
      const utility = option.utility(hypo.worldModel, result);
      if (utility > bestUtility) {
        bestUtility = utility;
        best = option;
      }
    }

    if (best === null) {
      // Fallback: idle. Return a generator that yields nothing.
      return (function*() { return { success: true }; })();
    }
    return best.factory(realCtx);
  }

  _candidates(ctx) {
    // List of { factory: (ctx) => generator, utility: (worldModel, result) => number }
    // Examples: explore, forage, hunt, flee, idle.
    return [
      { factory: (c) => explore(c, 100), utility: (wm, r) => /* ... */ },
      { factory: (c) => forage(c, 100),  utility: (wm, r) => /* ... */ },
      // ...
    ];
  }
}
```

### Stateless Re-Planning

The brain holds no persistent state about which task is currently running. On every call to `chooseTask`, it re-derives the optimal choice from the world model. This means:

- **Save/load is trivial.** Serialize `WorldModel`, deserialize, and the brain picks the same task on the next call.
- **NPCs change their minds only on genuinely novel information.** The "sunk cost" of partially-executed tasks naturally biases toward continuation: the remaining cost is smaller than at the start, making the in-progress task look more attractive in subsequent re-plans.
- **Utility functions must avoid near-ties between meaningfully different options.** If two top-level options can have utilities within floating-point noise of each other, the NPC may oscillate. Design utilities with clear gaps.
- **Tie-breaking must be deterministic.** When utilities are exactly equal, break ties on a stable key (e.g., task name) rather than anything that could vary across runs.

### Re-Plan Frequency

The brain is _called_ only when the scheduler runs out of tasks (current task completed or aborted). It does not re-plan every tick by default. For ancestor-level reactivity to mid-execution events (e.g., taking damage interrupts foraging), see "Preemption" below.

## Preemption

Tasks may need to abort early in response to events: taking damage, a path becoming invalid, time running out, or an ancestor task deciding the strategy is no longer viable.

### Mechanism: Guards

A task can register a guard at any point. The scheduler checks all active guards before each `yield`. If a guard fires, the scheduler throws a `Preempted` exception into the generator, which propagates up the `yield*` chain (each level can `try`/`finally` for cleanup).

```js
function* forage(ctx, maxTicks) {
  const startHp = ctx.worldModel.npcHp();
  ctx.guard(() => ctx.worldModel.npcHp() < startHp * 0.5, 'took_damage');

  try {
    const r = yield* goToWheatField(ctx, maxTicks);
    return r;
  } catch (e) {
    if (e instanceof Preempted) {
      return { success: false, reason: e.reason };
    }
    throw e;
  } finally {
    ctx.unguard('took_damage');
  }
}
```

Context provides:

```js
ctx.guard(predicate, reason)   // register a guard
ctx.unguard(reason)            // remove a guard
```

In hypothetical mode, guards are still registered but **not checked** by default. This is because hypothetical execution is fast-forwarded — it doesn't pass through the tick-level events that would trigger guards. Tasks that want to model their own self-interruption during planning must do so explicitly.

### Guard Ordering

Guards are checked in registration order. The first to fire wins. Higher-level tasks register their guards first (because they start running first), so their guards take precedence over inner task guards — which matches the intuition that ancestor concerns dominate.

## Introspection

For debugging, tasks can push frames onto a logical task stack maintained on the context. This is purely optional bookkeeping.

```js
function withFrame(name) {
  return function*(ctx, ...args) {
    ctx.taskStack.push({ name, args, startedAt: ctx.worldModel.currentTick() });
    try {
      return yield* this(ctx, ...args);
    } finally {
      ctx.taskStack.pop();
    }
  };
}

// Or explicitly:
function* pathfind(ctx, goal, maxTicks) {
  ctx.taskStack.push({ name: 'pathfind', goal, maxTicks });
  try {
    // ... body ...
  } finally {
    ctx.taskStack.pop();
  }
}
```

`ctx.taskStack` is a simple array, queryable at any time by debug tooling.
## Performance

Tasks may provide a closed-form fast-forward implementation for hypothetical execution when iterating through the predicted steps would be wasteful. To do so, branch on `ctx instanceof HypotheticalContext` at the top of the task body and produce the predicted end-state directly. This is an optimization, not a requirement; tasks without a fast-forward path will still work correctly in hypothetical mode, just slower. When providing a fast-forward path, take care that the closed-form result matches what step-by-step execution would have produced — divergence between the two modes is a source of subtle planning bugs.
## GameNPC

The top-level NPC class ties the pieces together.

```js
class GameNPC {
  constructor({ id, initialPosition, brain }) {
    this.id = id;
    this.memory = new WorldModel(initialPosition);
    this.brain = brain;
    this._scheduler = new Scheduler(this);
  }

  // Called by the engine, many times per second.
  tick(tilesICanSee) {
    this.memory.update(tilesICanSee);
    return this._scheduler.tick(); // returns AtomicAction or null
  }

  // Serialization
  serialize() {
    return { id: this.id, memory: this.memory.serialize() };
  }
  static deserialize(data, brain) {
    const npc = new GameNPC({
      id: data.id,
      initialPosition: data.memory.npcPosition,
      brain,
    });
    npc.memory = WorldModel.deserialize(data.memory);
    return npc;
  }
}
```

## Invariants and Contracts

These are the load-bearing properties of the design. Violating any of them produces subtle bugs.

1. **Leaf primitives must be semantically equivalent across real and hypothetical contexts.** `ctx.move(dir)` in real mode should produce the same end-state as `ctx.move(dir)` in hypothetical mode (modulo information the NPC couldn't have known). This is the foundation of unified task code.
    
2. **Hypothetical execution must not yield `Action`s.** All hypothetical context primitives must complete synchronously (within the generator) without yielding. The brain's drain-to-completion loop asserts this.
    
3. **Tasks must not retain references to context objects across `yield`s in a way that would survive context disposal.** Hypothetical contexts are short-lived; holding references to them in long-lived structures will leak.
    
4. **The brain has no persistent state about task choice.** All state is in the world model. The `Scheduler`'s `_currentGen` is the only "current task" reference, and it is rebuilt from scratch on load.
    
5. **Randomness must be seeded deterministically.** Any task using randomness derives its seed from `(npcId, currentTick, taskName)` or similar, so re-running planning produces the same results.
    
6. **Utility functions must produce meaningful gaps.** Two top-level options that represent genuinely different strategies should differ by more than floating-point noise in any given state. If they don't, the NPC may oscillate.
    

## Open Design Decisions

These are intentionally underspecified and need to be settled during implementation:

- **A* unknown-tile cost.** Currently a constant (`1.5`). May need to vary by NPC personality (cautious vs. bold) or by what's known about adjacent tiles.
- **Re-plan frequency at the brain level.** Currently re-plans only when the scheduler is empty. May need to add periodic re-plans (every N ticks) or event-triggered re-plans for ancestor-level reactivity beyond what guards provide.
- **Overlay merge semantics for multi-level hypotheticals.** Currently each overlay is a flat layer over its parent. Deeply nested hypotheticals could be slow due to lookup chain length. May need to flatten overlays past some depth.
- **Utility function shape.** Currently each top-level option supplies its own utility function. May want a unified utility framework so options are directly comparable.
- **Cancellation cleanup.** Tasks that allocate resources (subscriptions, world-model deltas they want to commit) need `try`/`finally` discipline. Worth lint-enforcing.

## Summary

The design is built on three load-bearing ideas. Generator-based tasks give you "await-like" sequential code that runs fast in hypothetical mode and tick-by-tick in real mode, with the mode difference confined to leaf primitives. Copy-on-write world-model overlays make hypothetical contexts cheap to fork and discard, enabling planners that evaluate many candidates per decision. And a stateless brain that re-derives task choice from the world model on demand gives you free save/load coherence and reactive replanning without explicit hysteresis machinery — provided utility functions are designed to avoid near-ties.

The cost of this elegance is concentrated in two places: the discipline of keeping real and hypothetical primitive implementations semantically equivalent, and the discipline of designing utility functions with meaningful gaps. Both are tractable but neither is free, and both should be tested explicitly.