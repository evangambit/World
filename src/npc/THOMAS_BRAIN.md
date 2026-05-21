# ThomasBrain

**Modules:** `thomasPerception.js`, `thomasTasks.js`, `thomasBehaviors.js`

A fully custom brain with two novel layers on top of the standard NPC body simulation.

## Wall-respecting perception (`thomasPerception.js`)

Replaces the default Chebyshev scan with a **supercover DDA raycast** per candidate tile. Opaque tiles (`WALL_STONE`, `WALL_WOOD`, `CLIFF`, `ROOF`, `TREE`) block line of sight; the NPC only records tiles it can actually see. The observer's tile and the target tile are never treated as blockers (so a wall tile adjacent to the NPC is still perceived).

## Async task framework (`thomasTasks.js`)

A **tick-to-async bridge**: `await ctx.nextTick()` suspends the behavior for exactly one simulation frame. The brain resolves it each `tick()` call. This lets behavior code read as sequential logic rather than a state machine.

**`TaskContext`** — passed to every behavior; live getters for `npc`, `world`, `tileMemory`, `gameTime`, `tickCount`; plus `nextTick()` and `setStatus(line)`.

**Primitives:**

| Function | Returns | Description |
|---|---|---|
| `moveTowardLocation(ctx, x, y, maxTicks)` | `MoveResult.*` | Walk to a tile; polls locomotion each tick |
| `seekKnownDesires(ctx, desires, maxTicks)` | `SeekResult.*` | Scan memory, rank by `weight/distance`, walk to best; re-evaluates every `reevalInterval` ticks |
| `doTimedAction(ctx, actionId, tx, ty)` | `ActionResult.*` | Start a timed action and wait for completion |
| `wanderOnce(ctx, maxTicks)` | `MoveResult.*` | Single random walk near home |
| `inventoryCount(npc, objType)` | `number` | Count carried items |

Exit reasons follow a typed `*Result` pattern (e.g. `arrived`, `impossible`, `took_damage`, `max_ticks`) so behaviors can switch on outcomes without inspecting raw state.

## Writing a behavior

Pass an `async (ctx) => { ... }` to the `ThomasBrain` constructor. If it returns, the brain restarts it on the next tick.

```js
import { ThomasBrain } from './npcBrain.js';
import { seekKnownDesires, SeekResult } from './thomasTasks.js';

const brain = new ThomasBrain(async (ctx) => {
    while (true) {
        const result = await seekKnownDesires(ctx, myDesires, 500);
        if (result === SeekResult.ARRIVED) { /* interact */ }
        // ...
    }
});
```

### Desires

`seekKnownDesires` takes an array of `Desire` objects, each with a `match` predicate and a `weight`. It scans `tileMemory`, ranks matches by `weight / distance`, and walks toward the best, re-evaluating each `reevalInterval` ticks (default 60) as perception updates memory.

```js
const desires = [
    { match: s => s.obj === Obj.WHEAT_CROP && s.cropStage >= 3, weight: 2 },
    { match: s => !s.obj && s.terrain === T.DIRT,               weight: 1 },
];
```

Tiles marked `reachable: false` in memory are automatically skipped. A tile is marked unreachable when `moveTowardLocation` returns `IMPOSSIBLE`; it is cleared back to unknown when perception sees a changed state on that tile.

### Status display

Call `ctx.setStatus(line)` at any point to update the string shown in the NPC panel when the NPC is clicked. Update it before long-running awaits so the panel reflects what the NPC is currently doing.

### Avoiding tight loops

If `seekKnownDesires` returns `ARRIVED` and the interaction is a no-op (e.g. the live tile no longer matches because memory is stale), always `await ctx.nextTick()` afterwards so perception runs before the next seek iteration. Without this, the behavior can spin synchronously and freeze the game.

## Default behavior: wheat farming (`thomasBehaviors.js`)

`farmBehavior` loops:
1. **Need seeds** → seek `TALL_GRASS` → `clear_grass` (5 s timed action) → receive 1–2 seeds
2. **Have seeds** → seek empty `DIRT` tiles → plant instantly
3. **Crops ready** → seek mature `WHEAT_CROP` → harvest (wheat + 2 seeds back)
4. **Nothing known** → `wanderOnce` to expand perception coverage

Wheat can only be planted on `T.DIRT` — enforced by `canPlantWheatAt` in `domain/crops.js`.
