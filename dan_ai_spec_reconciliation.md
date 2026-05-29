# Reconciling `dan_ai_spec.md` with the current codebase

This document lists changes needed in [`dan_ai_spec.md`](dan_ai_spec.md) so the NPC AI design matches how brains actually plug into the game today. The **core ideas** in Dan's spec (generator tasks, shared real/hypothetical code, copy-on-write overlays, stateless re-planning) can still apply, but the **integration surface** is different.

**Authoritative brain contract:** [`src/npc/brain/interface.js`](src/npc/brain/interface.js)

**Reference implementation:** [`src/npc/brain/wanderImpl/wanderBrain.js`](src/npc/brain/wanderImpl/wanderBrain.js)

**Related docs (some sections are ahead of or behind the repo):**

| Doc | Status |
|-----|--------|
| [`src/npc/README.md`](src/npc/README.md) | Describes task/plan/LLM brains that are **not present** in the current tree; useful for intent, not for current wiring |
| [`README.md`](README.md) | Same drift around `NpcTaskBrain`, `?brain=task`, plan runner paths |

---

## Summary of required spec changes

| Spec concept | Current reality | Action for `dan_ai_spec.md` |
|--------------|-----------------|-----------------------------|
| `GameNPC` + embedded `Scheduler` | `NpcEntity` (`Entity` + village fields) + `tickNpc()` in [`npcSimulation.js`](src/actors/npcSimulation.js) | Replace `GameNPC` section with the real tick pipeline |
| `brain.chooseTask(realCtx)` | `brain.tick(world, dt, gameTime, actionProgress, visibleTiles, lastActionResult)` | Brain returns **one action per frame**, not a task generator factory |
| `brain.shouldPreempt(worldModel)` | Not on `NpcBrain` interface | Drop or mark as future optional hook; describe preemption inside brain/task generators instead |
| `AtomicAction` `{ type, … }` | `EntityAction` objects from [`entityActions.js`](src/domain/entityActions.js) | Replace action type section; reference `moveToTileAction`, `pickUpAction`, etc. |
| `WorldModel` on NPC (position, HP, ammo, tick) | Tile memory in [`npcMemory.js`](src/npc/shared/npcMemory.js); body state on `Entity` (position, `health`, `hunger`, `inventory`) | Split “world model” into tile memory + entity vitals; drop ammo-centric examples unless added to sim |
| `RealContext` / `HypotheticalContext` + context primitives | [`HypotheticalWorld`](src/npc/shared/hypotheticalWorld.js) + real execution via `EntityAction` + [`actionExecutor.js`](src/actors/actionExecutor.js) | Reframe contexts; hypothetical path uses memory-backed world, not live `World3D` |
| Perception inside `GameNPC.tick(tilesICanSee)` | [`tickNpcPerception()`](src/npc/shared/npcMemory.js) runs **before** `brain.tick`, writes memory, passes `visibleTiles` | Move perception out of brain-owned memory update |
| Discrete integer ticks | `dt` + `gameTime` (seconds); timed actions via [`TimedActionRunner`](src/actors/timedActionRunner.js) | Use simulation time, not abstract tick counters, or define mapping |
| 2D grid, one action = one tile step | 3D layers (`z`), continuous movement (`tryMove`), `moveToTile` timed steps | Update movement examples for 3D + timed locomotion |
| Brain is stateless w.r.t. task choice | Brains may hold **continuation state** (e.g. `WanderBrain._walker`) | Soften “stateless brain”; distinguish persistent world knowledge from in-flight generator state |
| Save/load via `WorldModel.serialize()` | Not implemented for NPC cognition | Mark serialization as TBD; tile memory is WeakMap-backed today |

---

## 1. The `NpcBrain` interface (replace “The Brain” / “GameNPCBrain”)

Every brain implementation must satisfy:

```js
// src/npc/brain/interface.js (abridged)
{
  attach(npc: NpcEntity): void,
  tick(
    world: World3D,
    dt: number,
    gameTime: number,
    actionProgress: number | null,
    visibleTiles: VisibleTile[],
    lastActionResult?: ActionExecutionResult | null
  ): EntityAction | null | void,
  destroy?(): void,
  getStatus?(): { lines: string[] },
}
```

**Spec updates:**

- Remove `GameNPCBrain.chooseTask(realCtx)` and the brain-owned candidate-evaluation loop as the **external** API. That logic can live **inside** a Dan-style brain's private `tick()` implementation, but the engine never calls it directly.
- Document `attach(npc)` — called by [`attachNpcBrain()`](src/npc/brain/attach.js) when a brain is bound to an entity.
- Document optional `destroy()` — invoked on NPC death in [`markNpcDead()`](src/actors/npcSimulation.js).
- Document optional `getStatus()` for debug UI (not used by sim yet).

**How Dan's `chooseTask` maps:** A Dan brain would, on each `tick()` (or when its internal task generator completes), run hypothetical evaluation privately, start a new real-mode generator, then `next()` that generator until it yields an `EntityAction` or `null`. The spec's `Scheduler` loop becomes **private brain state**, not a separate engine class.

---

## 2. Simulation pipeline (replace “GameNPC” and “The Scheduler”)

Actual per-frame order in [`tickNpc()`](src/actors/npcSimulation.js):

1. Skip if dead; run [`tickVitality()`](src/domain/vitality.js) (hunger/health).
2. Compute `actionProgress` if a timed action is in flight.
3. **`tickNpcPerception(npc, world, gameTime)`** — updates tile memory, returns `visibleTiles[]`.
4. Read `lastActionResult` from the **previous** frame's action execution (then clear it).
5. **`brain.tick(...)`** — brain returns the next `EntityAction` or `null`.
6. If not already `resolvingAction` and brain returned an action: execute via [`tickEntityActionResult()`](src/actors/actionExecutor.js), store result for next frame.
7. Advance in-flight timed actions (`entity.timedAction.tick(dt, world)`).

[`tickSimulation()`](src/simulation/tickSimulation.js) calls `npc.tick(world, dt, gameTime)` for each NPC.

**Spec updates:**

- Replace `class GameNPC` with `NpcEntity` + `tickNpc` description.
- Remove standalone `class Scheduler` owned by the NPC. Instead: “the brain (or a helper it owns) holds the current task generator and resumes it across `tick()` calls.”
- Replace `tick(tilesICanSee)` with the parameters above.
- Add the **action feedback loop**: generators that yield actions should expect `lastActionResult` on the following tick (see [`walkToLocation`](src/npc/brain/shared/walkToLocation.js) — `yield moveToTileAction(...)` then resume with `{ ok, message? }`).
- Document the **`resolvingAction` gate**: while `entity.currentAction` is set, the brain's new action is not applied ([`WanderBrain`](src/npc/brain/wanderImpl/wanderBrain.js) returns `null` when `npc.resolvingAction` is set). This replaces spec's “yield `null` for multi-tick primitives” at the engine boundary — busy state is tracked on the entity, not as a yielded sentinel from the brain to the engine.

**Scheduler loop (spec §329) — revised semantics:**

| Spec behavior | Current behavior |
|---------------|------------------|
| On task complete, immediately `chooseTask` in same tick (bounded loop) | Brain may loop internally (`while` in `WanderBrain.tick`) but engine calls `brain.tick` **once per frame** |
| Scheduler returns `Action` or `null` | `tickNpc` returns the action **applied this frame** (or `null`) |
| `reset()` calls `generator.return()` | No engine-level reset; brain must discard its generator in `destroy()` or on preemption |

---

## 3. Actions (replace “Atomic Actions”)

The engine does not consume `{ type: 'move', direction }` literals. Brains return **`EntityAction`** objects defined in [`entityActions.js`](src/domain/entityActions.js):

- **Shape:** `{ prereq, apply?, tick?, duration?, type?, …coords }`
- **Movement:** `moveDirectionAction(entity, dx, dy)` (continuous) or `moveToTileAction(entity, tileX, tileY, tileZ)` (adjacent tile step, often timed)
- **World interaction:** `pickUpAction`, `cookSteakAtStoveAction`, `toggleDoorLockAction`, container actions, crop actions, etc.
- **Execution:** [`tickEntityActionResult()`](src/actors/actionExecutor.js) validates prereqs, runs `tick` or `apply`, returns `{ ok, message? }`.

**Spec updates:**

- Replace the `Action` helper object and all `Action.move(dir)` examples.
- Task primitives should **`yield*` factory functions** that return `EntityAction` instances, not plain records.
- Multi-tick work uses **`duration > 0`** and `TimedActionRunner`, not generator yields of `null`. Inside a task generator, the pattern is: yield one action → wait for `lastActionResult` on resume → check `actionProgress` if needed.
- State that Dan's spec puts on `WorldModel` (`setNpcHp`, `setNpcAmmo`) is updated by **domain/sim** when actions succeed (e.g. vitality), not by context primitives in the brain layer.

---

## 4. Memory and world model (replace “Tiles and the World Model”)

### Tile memory (persistent NPC knowledge)

Implemented in [`npcMemory.js`](src/npc/shared/npcMemory.js):

- Storage: `WeakMap<NpcEntity, Map<string, TileMemoryEntry>>` — not a property on the NPC.
- Entry: `{ seenAt: gameTime, state: TileData snapshot, reachable?: boolean }`.
- Perception radius: `NPC_PERCEPTION_RADIUS` (5, Chebyshev) on current floor — see [`npcConstants.js`](src/npc/shared/npcConstants.js).
- Helpers: `getNpcTileMemory`, `markTileReachable` / `markTileUnreachable`, `forEachNpcObservedTile`.

This replaces `RememberedTile`, `WorldModel.update(tilesICanSee)`, and most of `WorldModelRead` for **terrain/objects**.

### Entity state (body)

On [`Entity`](src/actors/entity.js) / `NpcEntity`:

- Position: `x`, `y`, `z` (continuous coordinates; tile indices via `Math.floor`)
- Vitality: `health`, `hunger` (not HP/ammo)
- `inventory`, `homeX/Y/Z`, `wanderRadius`, `isAlive`

**Spec updates:**

- Replace `WorldModel` class hierarchy with two subsystems: **tile memory API** + **entity fields**.
- Remove `npcAmmo` / `npcMaxAmmo` unless combat is added to the sim.
- Replace `currentTick()` with `gameTime` passed into `brain.tick` (and/or read from closure); hypothetical planning can track simulated time internally.
- Replace `npcPosition()` / `setNpcPosition()` with reading/writing `entity.x/y/z` in real mode and overlay copies in hypothetical mode.
- Document **`reachable`** on memory entries (pathfinding hint) — not in Dan's spec.
- Note: tile memory is **not serialized** today; save/load section is aspirational.

---

## 5. Hypothetical execution (replace “Contexts” / “WorldModelOverlay”)

Current planning substrate: [`HypotheticalWorld`](src/npc/shared/hypotheticalWorld.js) + optional [`HypotheticalEntity`](src/npc/shared/hypotheticalWorld.js).

| Spec | Code |
|------|------|
| `HypotheticalContext` forks from `RealContext` | `hypoWorld.branch()` / `createHypotheticalFromMemory(memory)` |
| `WorldModelOverlay` copy-on-write | Nested `_tiles` / `_containerContents` maps with parent fallthrough |
| Reads live world | Reads **remembered tiles only**; unobserved coords are `null` |
| Context `*move()`, `*reload()` generators | No context class; use `HypotheticalWorld.apply(action, entity)` for one-shots; movement **not** simulated in hypo (see TODOs in file) |
| `ctx.isReal` branch at leaf | Branch on whether you are driving `walkToLocation` against hypo vs returning real `EntityAction`s |

**Spec updates:**

- Replace `Context` / `RealContext` / `HypotheticalContext` sections with `HypotheticalWorld` + `HypotheticalEntity`.
- Align invariant §1: hypothetical mode uses **perceived** tiles, not the live world — stricter than the spec's overlay-on-full-model assumption.
- Align invariant §2: hypothetical **`apply()`** path must not yield actions; movement planning uses pathfinding over `HypotheticalWorld.isWalkable` ([`walkToLocation.js`](src/npc/brain/shared/walkToLocation.js)), not stepped hypo moves.
- Update `explore` / `pathfind` examples to call `findPath` on `HypotheticalWorld` and emit `moveToTileAction` only in real mode.
- Keep the **fast-forward optimization** idea (§Performance) but branch on `instanceof HypotheticalWorld` or a explicit `{ mode: 'hypothetical' }` parameter instead of `HypotheticalContext`.

---

## 6. Tasks as generators (preserve, but re-anchor)

Dan's task/generator model is partially present:

- [`walkToLocation`](src/npc/brain/shared/walkToLocation.js) — generator yielding `EntityAction`, resuming with `ActionExecutionResult`.
- [`WanderBrain`](src/npc/brain/wanderImpl/wanderBrain.js) — holds generator, loops in `tick()`.

**Spec updates:**

- Keep §Tasks (generator signatures, `yield*` composition, return values).
- Change task parameter from `ctx` to something like `{ entity, world, hypoWorld, gameTime, visibleTiles }` or a thin adapter that exposes `worldModel` as `HypotheticalWorld` + entity snapshot.
- Replace `yield* ctx.move(dir)` with `yield moveToTileAction(...)` (real) or hypo position updates inside planning-only helpers.
- Replace `ctx.taskStack` introspection with optional debug data on the brain (`getStatus()`) or an internal stack — nothing on a shared `Context` today.
- **`moveTo` example:** adjacency is Chebyshev ≤ 1 on the same `z`; direction-based single-step movement is [`moveDirectionAction`](src/domain/entityActions.js) (continuous), not grid `{ direction }` enums.

---

## 7. Preemption (revise §Preemption)

| Spec mechanism | Current support |
|----------------|-----------------|
| `shouldPreempt(worldModel)` before scheduler | **Not implemented** on `NpcBrain` |
| Scheduler `reset()` + `generator.return()` | Brain must drop its generator manually |
| Task yield-point checks | Still valid inside generators |

**Spec updates:**

- Mark brain-level preemption as **optional future** `NpcBrain` method or as internal brain policy (e.g. clear `_walker` when `health` drops).
- Keep Mechanism 2 (explicit checks in tasks) unchanged — works with `entity.health` / `entity.hunger`.
- Document interaction with `TimedActionRunner`: starting a new action cancels an in-flight timed action ([`tickEntityActionResult`](src/actors/actionExecutor.js)).

---

## 8. Stateless brain and save/load (revise §Stateless Re-Planning, §GameNPC serialization)

**Spec claim:** brain has no persistent task-choice state; only `WorldModel` persists.

**Current code:**

- Tile memory persists in a WeakMap (lifetime = NPC entity).
- Brains hold **ephemeral** continuation state (`WanderBrain._walker`, `_walkerInput`).
- No `serialize()` / `deserialize()` for NPC AI.

**Spec updates:**

- Reframe “stateless” as **stateless policy choice**: replanning reads tile memory + entity state, not “which task was chosen last frame,” but **in-flight generators are allowed** and are lost on reload unless serialized separately.
- Save/load section: specify serializing tile memory map + entity vitals/inventory; brain generators are rebuilt on load (same as spec intent, different storage).
- Tie-breaking / utility-gap guidance (§Utility Function, invariants 5–6) — **keep as-is**; still applies to internal `chooseTask` logic.

---

## 9. Utility functions and open problems (mostly keep)

Sections on exploration utility, hunger/bread math, discounting, and open problems are **design math**, not integration code. Keep them, with minor edits:

- “Tiles around home” → use `NpcEntity.homeX/homeY/homeZ` and tile memory keys.
- “Bread” / inventory → `entity.inventory` stacks (`objType`, `count`).
- “Hunger” → `entity.hunger` (0 = full, 100 = starving) per [`vitality.js`](src/domain/vitality.js).

---

## 10. Suggested new sections for `dan_ai_spec.md`

Add these after reconciling the above:

### 10.1 Attachment and brain selection

- [`attachNpcBrain()`](src/npc/brain/attach.js)
- [`createBrainForType()`](src/npc/shared/npcBrainRuntime.js) — currently `wander` | `noop` only
- [`NPC` constructor](src/actors/npc.js) defaults to `WanderBrain`

### 10.2 Reference brain walkthrough

Walk through `WanderBrain.tick()` as the minimal compliant implementation:

1. Guard: alive, not `resolvingAction`
2. Apply `lastActionResult` to internal generator
3. Loop: start or resume `walkToLocation` generator
4. Return yielded `EntityAction` or `null`

### 10.3 Architecture boundary

From [`README.md`](README.md): brains **return** actions; [`actionExecutor`](src/actors/actionExecutor.js) **executes** them. World rules live in [`entityActions.js`](src/domain/entityActions.js). Do not duplicate game rules inside task code.

### 10.4 Implementing a Dan brain

Sketch for a new `DanBrain` class implementing `NpcBrain`:

```text
attach(npc)
  └─ store npc ref; optional init of tile memory if needed

tick(world, dt, gameTime, actionProgress, visibleTiles, lastActionResult)
  ├─ if internal taskGen done/missing: taskGen = runChooseTask(npc, memory, gameTime)
  ├─ step = taskGen.next(lastActionResult)
  ├─ if step.done: taskGen = null; optionally loop choose again (bounded)
  └─ return step.value ?? null

destroy()
  └─ taskGen.return(); clear refs
```

Private `runChooseTask` contains Dan's hypothetical evaluation over `HypotheticalWorld` branches; private task functions mirror spec generators but yield `EntityAction`s.

---

## 11. Checklist: edit `dan_ai_spec.md` section by section

- [ ] **Overview** — add pointer to `NpcBrain` interface; note 3D world + continuous time.
- [ ] **Core Types › Atomic Actions** → **Entity Actions** (`entityActions.js`).
- [ ] **Core Types › Tiles and World Model** → **Tile memory** + **Entity state** (`npcMemory.js`, `Entity`).
- [ ] **Core Types › Contexts** → **HypotheticalWorld** / real action execution.
- [ ] **WorldModelOverlay** → **HypotheticalWorld** branching (merge with Contexts).
- [ ] **Tasks** — update `ctx` and primitive examples; keep generator conventions.
- [ ] **The Scheduler** → **Brain-internal task generator** (invoked from `tick()`).
- [ ] **The Brain** → **`NpcBrain` interface** + private `chooseTask` implementation detail.
- [ ] **Preemption** — demote `shouldPreempt` to optional; keep task-level checks.
- [ ] **Introspection** — `getStatus()` / internal stack, not `ctx.taskStack`.
- [ ] **Performance** — fast-forward via `HypotheticalWorld` checks.
- [ ] **GameNPC** → **`NpcEntity` + `tickNpc` pipeline**.
- [ ] **Invariants** — revise #1–2 for memory-only hypo world; revise #4 for allowed generator state.
- [ ] **Utility Function / Open Problems / Bread & Hunger** — keep; wire nouns to `Entity` fields.
- [ ] **Engine refactor note** (top) — update: Morgan refactor landed; this reconciliation reflects current `src/npc/brain`.

---

## 12. Code map (quick links)

| Concern | Module |
|---------|--------|
| Brain contract | [`src/npc/brain/interface.js`](src/npc/brain/interface.js) |
| Attach brain to NPC | [`src/npc/brain/attach.js`](src/npc/brain/attach.js) |
| NPC tick pipeline | [`src/actors/npcSimulation.js`](src/actors/npcSimulation.js) |
| Action definitions | [`src/domain/entityActions.js`](src/domain/entityActions.js) |
| Action execution | [`src/actors/actionExecutor.js`](src/actors/actionExecutor.js) |
| Tile perception & memory | [`src/npc/shared/npcMemory.js`](src/npc/shared/npcMemory.js) |
| Hypothetical planning world | [`src/npc/shared/hypotheticalWorld.js`](src/npc/shared/hypotheticalWorld.js) |
| Pathfinding generator task | [`src/npc/brain/shared/walkToLocation.js`](src/npc/brain/shared/walkToLocation.js) |
| Example brain | [`src/npc/brain/wanderImpl/wanderBrain.js`](src/npc/brain/wanderImpl/wanderBrain.js) |
| Timed actions | [`src/actors/timedActionRunner.js`](src/actors/timedActionRunner.js) |
| Vitality (hunger/health) | [`src/domain/vitality.js`](src/domain/vitality.js) |
| World grid | [`src/world/world.js`](src/world/world.js) |
| NPC module overview | [`src/npc/README.md`](src/npc/README.md) |
