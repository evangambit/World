# LLM Communication — Tech Spec

This document covers the design for user-triggered LLM "think" calls, NPC-to-NPC conversations, and the brain state structures needed for coordination (task queuing).

---

## 1. The "Think" Call

An NPC thinks when the **player explicitly triggers it** (e.g. a UI button or keyboard shortcut targeting that NPC). There is no automatic periodic think call in the current design.

> **Future work:** Automatic periodic think calls (e.g. every ~2 real-time minutes) are the obvious next step once the manual flow is working. The trigger is straightforward to add; the open questions are around rate-limiting, cost, and whether the call should block the NPC's tick or run asynchronously. Deferring until we have experience with the manual flow.

The think call runs asynchronously (not on the tick loop). `_thinking` prevents overlapping think requests; it does not block `tick()`.

`brainTweak` from a think response is applied immediately (`applyBrainTweak()`). A `thought` is appended to `ActionMemory` as soon as the LLM responds. A queued `talk_to` task (`_pendingTask`) competes at the next `_chooseTask()` replan — not mid-task.

### 1.1 Context fed to the LLM

The prompt is assembled from four layers:

**Layer 1 — Fixed system prompt (per NPC, set at spawn)**
- Game mechanics summary: farming loop, hunger/vitality, objects, actions available
- Urgency tier descriptions for `addPendingTask` talk_to tasks

> **Future work:** Per-NPC personality (name, values, backstory, relationships to other NPCs) belongs here and is the primary lever for making conversations feel distinct and believable. Deferring until the basic LLM flow is working. Zone names and labels are not in the system prompt today — they appear in Layer 4 via `buildZoneSummary()`.

**Layer 2 — Current state snapshot**
- Hunger level and inventory contents
- Current task kind (`eat`, `farm`, `explore`, `talk`, or idle) and hypo goal coordinates from `DanBrain._currentGoal` when set

**Layer 3 — Action memory**
- Last ~20 `ActionMemory` entries for self (movement entries can be compressed/elided)
- Most recent single `ActionMemory` entry per other known NPC (so the NPC knows roughly what others are doing)
- **All** `ActionMemory` entries of type `conversation`, regardless of age — conversation history is the primary signal for coordination state

**Layer 4 — Tile memory summary (derived, not raw)**

The raw tile memory map is not passed to the LLM. Instead, a structured summary is derived at call time from explored farm zones.

A zone is included only if the NPC has explored it (`explored > 0`). Zones never visited are omitted entirely.

```js
for each zone in FARM_ZONES:
  count tiles from tile memory → { explored, growing, harvestable, bare }
  include if explored > 0
```

The result is a compact JSON object embedded in the prompt:

```json
{
  "field_northwest": { "label": "the northwest half of the main field (29x23 tiles)", "explored": 6, "tiles": { "growing": 3, "harvestable": 1, "bare": 2 } },
  "field_northeast": { "label": "the northeast half of the main field (31x23 tiles)", "explored": 3, "tiles": { "growing": 1, "bare": 2 } }
}
```

Only zones with `explored > 0` are included. Tile categories count wheat crops (growing vs harvestable by maturity) and bare dirt within each zone's tile set.

### 1.2 Output format

The **entire LLM response is a JSON object** conforming to this schema. There is no free-text wrapper — the response is parsed directly.

```ts
interface ThinkOutput {
  thought?: string;          // logged to ActionMemory as type=think
  brainTweak?: BrainTweak;   // optional state mutation (see §3)
}
```

---

## 2. The "Talk To" Task

### 2.1 How a conversation is initiated

A conversation is initiated when a think call (§1) produces a `BrainTweak` with `addPendingTask: { type: "talk_to", target: "<name>", message: "<opening topic>", urgency: "normal" }`. Since think calls are currently user-triggered, this means the player deliberately prompts an NPC to think, the LLM decides it wants to talk to someone, and the task is stored as `_pendingTask` on the brain.

### 2.2 Pending task selection

At the next `_chooseTask()` call, the pending task competes against all other candidates on the same ΔU scale — it does **not** unconditionally bypass the utility system.

`talkToTask` is partially simulated through `drainHypo(walkToTargetOnly(hypo, targetName))`: the hypo run simulates only the **walk** to the target's last known position, then returns. The conversation itself cannot be simulated. This means the walk's real costs and benefits (hunger accumulation, new tiles seen, eventually dangerous terrain) are captured naturally by the utility function. On top of the simulated ΔU, a pre-assigned `urgency_bonus` is added to represent the conversation's intrinsic value:

```
ΔU(talk_to) = utility(after_walk_hypo) − initialU + urgency_bonus
```

The urgency tiers and their calibrated bonuses:

| `urgency` | bonus | Loses to | Beats |
|---|---|---|---|
| `"low"` | ~0.01 | almost everything | idle |
| `"normal"` | ~0.1 | acute hunger | routine farming, exploration |
| `"high"` | ~1.0 | critical survival | most things |

The system prompt tells the LLM: *"Use `normal` for routine coordination, `high` if the conversation is time-sensitive."* The LLM never sees raw utility numbers.

**Target position lookup:** `walkToTargetOnly()` and real-mode `talkToTask()` both call `ctx.getLastKnownPosition(targetName)` at walk time (from `ActionMemory`, updated each frame via `observeNpc()`). Positions are not passed in as a separate parameter.

If the target has never appeared in ActionMemory, the walk is a no-op in hypo, and ΔU is just the urgency bonus. The NPC will still pursue the conversation — they wait at the target's last known position (or skip the walk) and retry proximity for up to 120 ticks.

**Single slot:** `_pendingTask` holds at most one pending task. A new think call replaces any existing pending task. The pending task is cleared only when `talk_to` **wins** utility selection; if it loses, it is retried on the next replan.

### 2.3 Task mechanics (real mode)

```
talkToTask(ctx, targetName, openingMessage, brain)
  1. Walk to ctx.getLastKnownPosition(targetName), if known.
  2. If targetName is not within CONVERSATION_RADIUS tiles, idle briefly and retry
     (the target may be moving).
  3. Fire the conversation orchestrator (see synchronization below).
```

`brain` is the initiator's `DanBrain` instance; it supplies `_npcRegistry` to resolve the target NPC.

**Conversation loop:**

Each turn of the loop is one LLM call for the active speaker. The input is:
- Full context (§1.1) plus the full conversation-so-far as a transcript
- The other NPC's most recent `say`

The **entire LLM response is a JSON object** conforming to this schema:

```ts
interface ConversationTurnOutput {
  say: string;
  endConversation?: boolean;
  brainTweak?: BrainTweak;
}
```

The turn ping-pongs: initiator speaks, responder speaks, initiator speaks, ... A `MAX_CONVERSATION_TURNS` cap (e.g. 10) prevents infinite loops. Either party can set `endConversation: true` to stop.

Each turn's `brainTweak` is applied to that NPC's brain as soon as the orchestrator processes the turn response — not deferred to conversation end.

**Synchronization:** Conversations are handled by a single async orchestrator function that runs outside the tick loop (the same pattern as think calls). When `talkToTask` reaches the conversation phase, it fires the orchestrator and sets `_conversing = true` on both NPC brains. While `_conversing` is true, both NPCs' `tick()` returns null — they are frozen for the duration of the conversation. When the orchestrator completes, it clears `_conversing` on both brains and both NPCs resume normal task selection via `_chooseTask()`.

The orchestrator holds references to both NPC brains directly (initiator and responder). Each `DanBrain` gets a shared name → brain registry via `buildDanNpcRegistry()` in `main.js` after spawn (`setNpcRegistry()`), used for resolving talk targets and sanitizing `brainTweak` targets.

> **Future work:** Freezing NPCs during conversation is a simplification. Ideally NPCs remain "alive" — able to eat if starving, flee from danger, etc. — while a conversation is in progress. This requires the conversation loop to be interruptible and the turn-taking to be integrated with the tick loop rather than sitting above it. Deferred until the basic flow is working.

**ActionMemory:** Every `say` by either NPC is appended to both NPCs' `ActionMemory` as type `conversation`, with `otherPerson` set to the counterpart. This is how the conversation persists into future think-call context.

### 2.4 Multi-NPC conversations

Three-way coordination is deferred. For now, A talks to B, then separately A talks to C. The conversation history in ActionMemory carries the coordination state across both conversations.

---

## 3. Brain Tweak Format

`BrainTweak` is an optional field in `ThinkOutput` and `ConversationTurnOutput`. The brain's tweak interpreter applies it safely at the next task boundary.

```ts
interface BrainTweak {
  // Queue a talk_to task for the next _chooseTask() call
  addPendingTask?: PendingTask;
}

type PendingTask = {
  type: "talk_to";
  target: string;
  message: string;
  urgency: "low" | "normal" | "high";
}
```

**Safety constraints:**
- `addPendingTask` target must be a known NPC name
- The interpreter ignores unknown keys

> **Future work:** As the set of brain mutations grows, replacing `BrainTweak` with LLM tool / function calls is the natural evolution. Tool calls give each operation a typed schema, allow optional invocation without a wrapper object, and separate reasoning text from structured actions. Deferring until the structured JSON approach proves limiting.

---

## 4. Farm Zones (map-authored)

Zones are defined at map-build time in `content/builder.js` (`_rawZones` → `FARM_ZONES`). Each zone has a `name`, human-readable `label`, and explicit `[x,y]` tile list. Overlapping tiles are deduplicated (`TILE_TO_ZONE` — first zone wins). Zone summaries in LLM prompts group crop status by these named regions via `zoneUtils.buildZoneSummary()`.

```js
// Excerpt from content/builder.js — FARM_ZONES is an array of zone objects
export const _rawZones = [
  {
    name: 'field_northwest',
    label: 'the northwest half of the main field (29x23 tiles)',
    tiles: tilesInSquare(0, 0, 28, 22),
  },
  {
    name: 'field_northeast',
    label: 'the northeast half of the main field (31x23 tiles)',
    tiles: tilesInSquare(29, 0, 59, 22),
  },
  // buildings, river, far-south fields, …
];

export const FARM_ZONES = _rawZones.map(/* dedupe overlapping tiles */);
```

Zone `label` strings appear in the Layer 4 JSON summary for zones the NPC has explored. They are not listed in the static system prompt today.

> **Future work:** If the map becomes procedural or farmable areas are discovered at runtime, zone boundaries will need to be computed algorithmically (e.g. Voronoi partition of known dirt tiles by NPC home position) rather than authored. Only the zone registry source changes.

---

## 5. ActionMemory

The full `ActionMemory` entry shape:

```ts
interface ActionMemoryEntry {
  subject: string;           // NPC name
  action: 'movement' | 'farm_action' | 'think' | 'conversation';
  location: [number, number, number];
  tick: number;
  details: string;           // direction, object name, text said/thought
  otherPerson?: string;      // set for conversation entries
  endTick?: number;          // merged self-movement runs only
  endLocation?: [number, number, number];
}
```

**Pruning (implemented):** On each non-movement append, `_prune()` runs with per-type age limits (`movement`: 200 ticks, `farm_action`: 300, `think`/`conversation`: kept). Always retains: all conversation entries, the most recent entry per other NPC, the latest `farm_action` per location, and up to 20 recent self entries. Self movement uses a two-slot buffer flushed when a meaningful self action interrupts it (see [ARCHITECTURE.md](../ARCHITECTURE.md#actionmemory)).

---

## 6. LLM configuration

Browser URL params (see `llm/llmConfig.js`):

| Param | Default | Values |
|--------|---------|--------|
| `llm` | `mock` | `mock`, `openrouter`, `openai` |
| `apiKey` | localStorage `world_llm_api_key` | Required for live calls |
| `model` | provider default (`gpt-4o-mini` / `openai/gpt-4o-mini`) | Override model id |
| `llmLog` | on | `0` or `false` to disable console logging |

Without an API key (or with `llm=mock`), think and conversation calls return stub JSON.

---

## 7. Open Questions

- **ActionMemory query tool:** Should NPCs have a tool call that lets the LLM query ActionMemory by NPC, time range, or action type? Useful for large histories, deferred for now.
- **Coordination trigger:** What causes the LLM to decide to initiate coordination? Current answer: the LLM sees relevant context in ActionMemory (e.g., another NPC farming nearby) and decides autonomously. No hardcoded trigger.
