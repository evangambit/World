# NPC AI System Specification (Theory)

> **Theory doc.** This describes the intended decision-making model — utility functions, hypothetical planning, and task coroutines — largely independent of engine details. For how Dan is wired into the current codebase, see [ARCHITECTURE.md](../ARCHITECTURE.md).

> **Note on Engine Refactor:** The game engine is currently being refactored by Morgan. The high-level ideas in this document should remain mostly valid, and the required tweaks shouldn't require significant changes to the proposed AI architecture. However, this specification must be revisited once the engine refactor is done.

## Overview

This document specifies an AI system for grid-based, tick-driven game NPCs. The system is built around three principles:

1. **Tasks are coroutines.** NPC behavior is expressed as JavaScript generator functions, not state-machine objects. Composition is via `yield*` (delegation).
2. **Real and hypothetical execution share code.** The same task function runs in both modes; only leaf primitives branch on context type. Hypothetical mode fast-forwards through actions for cheap planning.
3. **The brain is stateless w.r.t. task choice.** It re-derives the optimal task from the world model on demand. Save/load serializes only the world model.

## Core Types

### Atomic Actions

The game engine consumes one `AtomicAction` per tick from an NPC. Examples: `move(direction)`, `reload()`, `harvest()`, `openDoor(direction)`. *(Note: There will be many more actions in the full system, such as managing inventory, interacting with containers and stoves, multi-floor traversal, and executing timed actions like cooking.)*

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
  npcHp() { /* -> number */ }
  npcMaxHp() { /* -> number */ }
  npcAmmo() { /* -> number */ }
  npcMaxAmmo() { /* -> number */ }
}

// The NPC's persistent memory (lives on the GameNPC).
// This is the ONLY persistent state in the AI system.
class WorldModel extends WorldModelRead {
  update(tilesICanSee) { /* bulk update from perception */ }
  updateTile(x, y, lastSeenTick, value) { /* single tile update */ }
  setNpcPosition({ x, y }) { /* called by engine on real moves */ }
  setCurrentTick(t) { /* called by engine each tick */ }
  setNpcHp(hp) { /* called by engine on damage/healing */ }
  setNpcAmmo(ammo) { /* called by engine on fire/reload */ }
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

  // Each real primitive yields one value per tick. Single-tick actions yield
  // one Action. Multi-tick actions yield the initiating Action on the first
  // tick, then null for each subsequent tick until the action completes.
  // The engine interprets null as "NPC busy, no new action this tick".
  *move(direction) {
    yield Action.move(direction);
    return true; // engine will have updated worldModel.npcPosition by next resume
  }
  *reload() {
    yield Action.reload();
    for (let i = 1; i < RELOAD_TICKS; i++) {
      yield null; // hold the generator until reload is done
    }
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
    this._overlay.setNpcAmmo(this._overlay.npcMaxAmmo());
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
    this._npcHp = null;              // null = fall through
    this._npcAmmo = null;            // null = fall through
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
  npcHp() {
    return this._npcHp ?? this._parent.npcHp();
  }
  npcMaxHp() {
    return this._parent.npcMaxHp(); // max HP doesn't change in hypothetical mode
  }
  npcAmmo() {
    return this._npcAmmo ?? this._parent.npcAmmo();
  }
  npcMaxAmmo() {
    return this._parent.npcMaxAmmo(); // max ammo doesn't change in hypothetical mode
  }
  setNpcHp(hp) { this._npcHp = hp; }
  setNpcAmmo(ammo) { this._npcAmmo = ammo; }
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
  for (let attempt = 0; attempt < 10; attempt++) {
    const now = ctx.worldModel.currentTick();

    const path = aStar({
      start: ctx.worldModel.npcPosition(),
      goal,
      world: ctx.worldModel,
      unknownTileCost: 1.5,
    });

    if (!path.found) {
      return { success: false, reason: 'no_path' };
    }
    if (now + path.estimatedCost > startTick + maxTicks) {
      return { success: false, reason: 'over_budget', estimatedCost: path.estimatedCost };
    }

    let success = true;
    for (const waypoint of path.waypoints) {
      if (ctx.worldModel.currentTick() - startTick > maxTicks) {
        return { success: false, reason: 'timeout' };
      }
      const r = yield* moveTo(ctx, waypoint);
      if (!r.success) {
        // Path was invalidated mid-execution. Break to outer loop to replan.
        success = false;
        break;
      }
    }
    if (success) {
      return { success: true, ticksTaken: ctx.worldModel.currentTick() - startTick };
    }
  }
  return { success: false, reason: 'replan_limit' };
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

The scheduler drives a task generator in real mode, advancing it one step per tick and returning whatever the generator yields — an `Action`, or `null` if the NPC is busy mid-way through a multi-tick primitive. When a task completes, the scheduler immediately consults the brain for a new task within the same tick, so no time is wasted idle between tasks. This loop is bounded to prevent infinite loops from instantly-completing tasks. The scheduler is otherwise stateless: it holds only the current generator and delegates all multi-tick timing to the primitives themselves.

```js
class Scheduler {
  constructor(npc) {
    this._npc = npc;
    this._currentGen = null;
  }

  hasTask() {
    return this._currentGen !== null;
  }

  // Discard the current task. The brain will choose a new one on the next tick.
  reset() {
    if (this._currentGen) {
      this._currentGen.return(undefined); // Resume the generator with an implicit return to trigger `finally` blocks
    }
    this._currentGen = null;
  }

  // Called by GameNPC.tick(). Returns the next Action to execute, or null if
  // the NPC is idle or mid-way through a multi-tick action.
  tick() {
    // Loop so that when a task completes, we immediately consult the brain
    // for a new task rather than wasting a tick idle. Bounded to prevent
    // infinite loops from tasks that complete instantly.
    for (let attempts = 0; attempts < 3; attempts++) {
      if (!this._currentGen) {
        this._currentGen = this._npc.brain.chooseTask(new RealContext(this._npc));
      }
      const { value, done } = this._currentGen.next();
      if (done) {
        this._currentGen = null;
        continue; // task finished — immediately choose a new one
      }
      // value is an Action, or null if a multi-tick primitive is still running.
      return value;
    }
    // All attempts produced instantly-completing tasks; idle this tick.
    return null;
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

The brain is _called_ when the scheduler runs out of tasks (current task completed or aborted) or every N ticks (for some reasonably large N). It does not re-plan every tick. For mid-execution reactivity, see "Preemption" below.

## Preemption

Tasks may need to abort early in response to events: taking damage, a path becoming invalid, time running out, or the aforementioned N ticks passing. Two mechanisms handle this, one at the NPC level and one at the task level.

### Mechanism 1: Brain-Level Preemption Hook

For global interrupts that should abort *any* currently running task (e.g., taking heavy damage, entering combat), `GameNPC.tick()` calls `shouldPreempt()` before advancing the scheduler. If it returns true, the scheduler's current generator is discarded and the brain is asked for a new task on the next tick.

```js
// In GameNPC:
tick(tilesICanSee) {
  this.memory.update(tilesICanSee);
  if (this._scheduler.hasTask() && this.brain.shouldPreempt(this.memory)) {
    this._scheduler.reset();
  }
  return this._scheduler.tick();
}
```

```js
// In GameNPCBrain:
shouldPreempt(worldModel) {
  // Example: abort everything if HP drops below 20%
  return worldModel.npcHp() < worldModel.npcMaxHp() * 0.2;
}
```

When the scheduler is reset mid-task, it calls `return(undefined)` on the current generator before discarding it. This causes the generator to resume as if a `return` statement executed at the current yield point, ensuring any active `try`/`finally` blocks execute on the way out. Tasks that acquire resources they need to release (e.g., reserving a tile, or pushing to the `taskStack`) can safely rely on `finally` blocks for guaranteed cleanup during brain-level preemption.

### Mechanism 2: Explicit Yield-Point Checks

For task-specific conditions (e.g., a forage task aborting if the NPC takes significant damage mid-path), the task checks the condition at natural yield points and returns early:

```js
function* forage(ctx, maxTicks) {
  const startHp = ctx.worldModel.npcHp();

  const r = yield* goToWheatField(ctx, maxTicks);
  if (!r.success) return r;

  if (ctx.worldModel.npcHp() < startHp * 0.5) {
    return { success: false, reason: 'took_damage' };
  }

  return yield* harvest(ctx);
}
```

For finer granularity, subtasks like `goToWheatField` can themselves check the condition at each waypoint and return early. This puts interrupt logic in the task that owns the concern, makes control flow explicit, and requires no scheduler machinery beyond normal generator returns.

## Introspection

For debugging, tasks can push frames onto a logical task stack maintained on the context. This is purely optional bookkeeping.

```js
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
    // Brain-level preemption: discard current task if a global interrupt fires.
    if (this._scheduler.hasTask() && this.brain.shouldPreempt(this.memory)) {
      this._scheduler.reset();
    }
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

1. **Leaf primitives must produce equivalent world-state transitions given the same world knowledge.** `ctx.move(dir)` in real mode and hypothetical mode should update position identically. However, hypothetical mode does not simulate perception: real execution causes the engine to reveal new tiles on the next tick, while hypothetical execution leaves the world model unchanged beyond the explicit overlay update. Tasks that depend on discovering new information mid-execution will therefore behave differently in hypothetical mode than in real mode. This is an accepted limitation — simulating vision in hypothetical mode is not worth the cost — but it means the brain's evaluation of such tasks is inherently optimistic about unknown territory.
    
2. **Hypothetical execution must not yield `Action`s.** All hypothetical context primitives must complete synchronously (within the generator) without yielding. The brain's drain-to-completion loop asserts this.
    
3. **Tasks must not retain references to context objects across `yield`s in a way that would survive context disposal.** Hypothetical contexts are short-lived; holding references to them in long-lived structures will leak.
    
4. **The brain has no persistent state about task choice.** All state is in the world model. The `Scheduler`'s `_currentGen` is the only "current task" reference, and it is rebuilt from scratch on load.
    
5. **Randomness must be seeded deterministically.** Any task using randomness derives its seed from `(npcId, currentTick, taskName)` or similar, so re-running planning produces the same results.
    
6. **Utility functions must produce meaningful gaps.** Two top-level options that represent genuinely different strategies should differ by more than floating-point noise in any given state. If they don't, the NPC may oscillate.
    
## Utility Function

### Exploration

→ [utility_functions/power_law_exploration.md](utility_functions/power_law_exploration.md)

Scale-invariance forces `1/dist^α` per tile. Exponential distance-penalty would make
circularity-obsession grow with scale; the power law keeps it constant.

### Hunger

→ [utility_functions/crra_death_floor.md](utility_functions/crra_death_floor.md)

The binding constraints (anti-starvation, anti-waste) force `u` to depend only on `s + kB`.
The right functional form on that composite — including why it must be CRRA and not CARA —
is derived in the entry above and the batch math below.

### Discounting Time Cost

This is challenging.

Define
- `∆U = Uf - Ui = U(final_state) - U(initial_state)`
- `∆T = Tf - Ti = final_state.time - initial_state.time`

Some options

- `∆U / ∆T` - rate optimizing
- `∆U - k * ∆T` - linear discounting
- `∆U * k^∆T` - exponential discounting
- `∆U / (1 + k * ∆T` - hyperbolic discounting
- Always look forward a fixed amount of time/ticks

Naively, one might think time-inconsistent discounting is a deal-breaker. Not so. As long as you discount *at least as much as exponential*, NPCs will tend to do the tasks they set out to do. For example, hyperbolic discounting will cause even *less* oscllating than exponential.

Currently, I'm leaning toward either

1. `∆U / ∆T`
2. Requiring all high level tasks to simulate precisely X ticks ahead to provide apples-to-apples comparisons.

You might think I'm an idiot for not using the "correct" exponential approach. I'm not. Consider this scenario:

>Suppose $\gamma = 0.99$ Suppose one task (e.g. pick berry) takes 1 second and yields 1 util. I can do it whenever I want. The other task yields 2000 utils after 1000 seconds.
>
>`1 * 0.99^1 = 0.99`
>`2000*0.99^1000 = 0.086`
>
>I will always do the short task, even though, after 1000 seconds, I would have more utility doing the latter.

What's absolutely crucial is that each component of the utility function (e.g. bread/food, exploration, etc) must have derivatives that tend toward zero. This will ensure some kind of diversity of behavior, even if the discounting is off.

## Summary

The design is built on three load-bearing ideas. Generator-based tasks give you "await-like" sequential code that runs fast in hypothetical mode and tick-by-tick in real mode, with the mode difference confined to leaf primitives. Copy-on-write world-model overlays make hypothetical contexts cheap to fork and discard, enabling planners that evaluate many candidates per decision. And a stateless brain that re-derives task choice from the world model on demand gives you free save/load coherence and reactive replanning without explicit hysteresis machinery — provided utility functions are designed to avoid near-ties.

The cost of this elegance is concentrated in two places: the discipline of keeping real and hypothetical primitive implementations semantically equivalent, and the discipline of designing utility functions with meaningful gaps. Both are tractable but neither is free, and both should be tested explicitly.

## Open Problems

- **Discounting Time Cost** - see above

- **Randomness.** - We want "randomness" to be deterministic. How deterministic? I'm currently leaning towards requiring all task functions that need randomness to create a generator with a constant (or per-npc-id) seed at the top of themselves.

- **Choose Bread & Hunger Utility Function** - See [utility_functions/crra_death_floor.md](utility_functions/crra_death_floor.md) and the Bread & Hunger Math section below.

## Bread & Hunger Math

Full derivation: [utility_functions/crra_death_floor.md](utility_functions/crra_death_floor.md)
and [utility_functions/cara_sequential_discounting.md](utility_functions/cara_sequential_discounting.md).

The batch algebra (`UPS = f(ay − b) / y`) forces `f` linear in the tail → `UPS ∝ −1/y`.
The jump from batch-value to state-utility rests on three independent properties of `−1/(s + kB)`:
homotheticity (CRRA-2), starvation singularity at `w → 0`, and slow polynomial tail preserving
option value — all of which the utility function entries analyze in detail.