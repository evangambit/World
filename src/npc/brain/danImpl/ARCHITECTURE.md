# Dan Brain — Architecture

Dan is a utility-driven NPC brain that plans by hypothetically running the same task code used at execution time. Enable with `?brain=dan` (see `npcBrainRuntime.js`).

For the underlying theory (utility math, hypothetical overlays, design rationale), see [notes/index.md](./notes/index.md).

## Layout

```
danImpl/
  danBrain.js            — tick loop, utility function, task selection, LLM glue
  danContext.js          — RealContext / HypotheticalContext, drainHypo()
  actionMemory.js        — short-term action log; feeds LLM prompts
  brainTweak.js          — structured mutations from LLM responses (zone ownership, pending tasks)
  zoneUtils.js           — zone/tile lookup helpers; builds zone summary for prompts
  tasks/
    eat.js               — consume best available food
    farm.js              — harvest / cook / plant loop
    explore.js           — walk toward map frontier
    talkTo.js            — walk to another NPC and start a conversation
  llm/
    thinkPrompt.js       — assemble system + user prompts for think and conversation calls
    llmClient.js         — callThinkLlm / callConversationLlm (OpenRouter or mock)
    llmConfig.js         — API key / model resolution from URL params
    conversationOrchestrator.js — async ping-pong LLM turns between two NPCs
    extractJson.js       — strip markdown fences and parse JSON from LLM output
  notes/                 — theory (index.md + utility_functions/)
  ARCHITECTURE.md        — this file
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

1. Returns `null` if mid-action (`resolvingAction`), in a conversation (`_conversing`), or dead.
2. Stores the incoming `lastActionResult` for delivery to the task generator next step.
3. Resumes the current task generator, or starts a new one via `_chooseTask()` when idle.
4. On each yielded `EntityAction`, calls `_logActionYielded()` (records movement to `ActionMemory`) and returns the action to the simulation.
5. On generator completion, calls `_logTaskOutcome()` (records a `farm_action` entry when a farm task succeeds) and replans.

Up to `MAX_TASK_RESTARTS_PER_TICK = 3` instant-completing tasks may run in a single tick to avoid stalling.

After each simulation tick, `main.js` calls `_observeNearbyNpcsForDanBrains()`, which calls `brain.observeNpc()` for all visible NPCs within radius 12. This records their positions in `ActionMemory` for both LLM context and talk-to pathing.

## Real vs hypothetical contexts

Tasks are generator functions taking a `DanContext`. They never branch on "am I planning?" directly; they call leaf primitives:

- `yield* ctx.walkTo(target)` — move to a tile
- `yield* ctx.applyAction(action)` — perform a world interaction
- `ctx.getLastKnownPosition(name)` — look up another NPC's last observed position

| | RealContext | HypotheticalContext |
|---|-------------|---------------------|
| `walkTo` | Yields `moveToTileAction` steps via `walkToLocation` | A* path, teleport entity, accumulate `newTilesSeen` |
| `applyAction` | Yields the action; engine runs it | Calls `action.apply(hypoWorld)` synchronously |
| `newTilesSeen` | Always empty | Set of `"x,y,z"` keys newly visible along walked paths |
| `getLastKnownPosition` | Live query against `ActionMemory` (updated each frame) | Snapshot from planning time |

`RealContext.hypothetical(memory)` clones the NPC into a `HypotheticalContext` backed by `createHypotheticalFromMemory(memory)`. Task selection drains each candidate task through this hypo context with `drainHypo()`, which asserts no actions are yielded.

## Task selection

On each replan, `_chooseTask()`:

1. Computes a fixed **centroid** of known tiles on the NPC's floor (from tile memory).
2. Scores the **baseline** utility at the real position (`initialU`).
3. For each task in `[eatTask, farmTask, exploreTask]`:
   - Branches a fresh `HypotheticalContext`.
   - Runs the task to completion with `drainHypo()`.
   - Computes `ΔU = utility(hypo) − initialU`.
4. If a `talk_to` pending task exists, scores it the same way (walk-only hypo) and adds an urgency bonus (`low` = 0.01, `normal` = 0.1, `high` = 1.0).
5. Starts the task with the largest positive `ΔU`, or idles if none beat zero.

The winning hypo context's final position is stored for status display (`farming → (x, y, z)`, etc.).

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

Internal loop (up to `MAX_FARM_STEPS`):

1. `chooseBestFarmTarget()` scans remembered tiles for harvest (weight 3), cook (weight 2), plant (weight 1) opportunities. Respects zone ownership — only targets tiles in zones owned by this NPC (or any zone when no ownership is set).
2. Scores each as `weight / Chebyshev distance` to the NPC.
3. Walks to the walk target, performs one action, repeats until nothing remains.

Planting requires seeds, bare dirt, and a walkable tile.

### `exploreTask`

Finds the best of eight directional **frontier goals** (last known walkable tile before unknown terrain), scores candidate goals by weighted new tiles visible from the goal divided by path length, walks to the winner.

### `talkToTask`

Queued via `addPendingTask` (from the LLM). Execution:

1. Calls `ctx.getLastKnownPosition(targetName)` at walk time (live in real mode, snapshotted in hypo mode) and walks there.
2. Waits (up to 120 ticks of idle yield) for the target to come within `CONVERSATION_RADIUS = 3`.
3. Fires `runConversationOrchestrator(initiator, responder, openingMessage)` as a detached async task and returns immediately, leaving `_conversing = true` on both brains.

## LLM integration

### Think

Player-triggered via the NPC panel. `DanBrain.think()`:

1. Builds a four-part prompt (`buildThinkPrompt`): system persona, current state snapshot, action memory, zone summary.
2. Calls `callThinkLlm` (OpenRouter or mock).
3. If the response has a `thought`, appends it to `ActionMemory` as a `'think'` entry — this also flushes the movement buffer, preserving chronological order.
4. If the response has a `brainTweak`, applies it via `applyBrainTweak()`.

### Conversation

`runConversationOrchestrator` runs a ping-pong loop (up to `MAX_CONVERSATION_TURNS = 10`):

1. Active brain calls `callConversationLlm` with its own state snapshot + shared transcript.
2. The response `say` is appended to both brains' `ActionMemory` as a `'conversation'` entry.
3. If the response includes `brainTweak`, it is applied to the active brain only.
4. `endConversation: true` or hitting the turn cap ends the loop; both brains exit `_conversing`.

### BrainTweak

Both think and conversation responses may include a `brainTweak` object:

```json
{
  "updateZoneOwnership": { "field_northwest": "Elara" },
  "addPendingTask": { "type": "talk_to", "target": "Finn", "message": "...", "urgency": "normal" }
}
```

`sanitizeBrainTweak()` validates zone names against `FARM_ZONES_BY_NAME`, NPC names against `VILLAGE_NPC_SPAWNS`, and target existence in the live NPC registry before applying.

## ActionMemory

`ActionMemory` maintains a short-term log used to build LLM prompts and to look up last-known positions for talk-to pathing.

### Entry types

| Action | Who | Flushed by |
|--------|-----|-----------|
| `movement` (self) | Self | Buffered (see below) |
| `movement` (other) | Other NPC | `observeNpc()` each frame |
| `farm_action` | Self | `_logTaskOutcome` on successful farm completion |
| `think` | Self | `think()` after LLM responds |
| `conversation` | Active speaker | `conversationOrchestrator` each turn |

### Movement buffer

Self movement entries are held in a two-slot `{start, latest}` buffer rather than being appended every step. The buffer is only flushed to `_entries` when a meaningful self action (think, farm completion, conversation) interrupts movement.

Critically, `observeNpc()` — called every frame for nearby NPCs — does **not** flush the buffer. Without this guard, every individual step would land in `_entries`, filling the 20-slot self-entry budget with movement noise.

### Prompt slice

`getPromptActionSlice()` returns:

- Up to `MAX_SELF_ENTRIES = 20` recent self entries from `_entries`.
- The active movement buffer collapsed into **one merged entry** with `endTick` and `endLocation` set, rendered as `t201–t207 Elara movement: (11,23,0)→(27,26,0)`.
- The most-recent entry per other NPC.
- All conversation entries.

## Perception and map edges

`tickNpcPerception()` records tiles within `NPC_PERCEPTION_RADIUS`. Coordinates with no world tile (off-map void) are written once as synthetic `WALL_STONE` entries with `reachable: false`. Dan learns boundaries through sight, not omniscience — this prevents endless re-exploration of map edges.

Hypothetical `walkTo` treats tiles absent from **memory** as unseen for exploration scoring; void tiles in memory are known and impassable.

## Known gaps / future work

- Full lookahead with **health** in utility would replace the hunger penalty hack (see comments in `danBrain.js` and `notes/index.md`).
- `cropUtility` weight and mature-vs-all crop counting need calibration.
- `eatTask` still has `HUNGER_EAT_THRESHOLD` exported but selection is utility-driven, not threshold-gated.
- Think is player-triggered only; auto-think on a timer or event would let Dan act on LLM decisions without manual prompting.
- Zone ownership is per-brain only — there is no broadcast mechanism so two NPCs can claim the same zone without conflict resolution.
