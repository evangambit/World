# LLM Communication — Tech Spec

This document covers the design for user-triggered LLM "think" calls, NPC-to-NPC conversations, and the brain state structures needed for coordination (task queuing).

---

## 1. The "Think" Call

An NPC thinks when the **player explicitly triggers it** (e.g. a UI button or keyboard shortcut targeting that NPC). There is no automatic periodic think call in the current design.

> **Future work:** Automatic periodic think calls (e.g. every ~2 real-time minutes) are the obvious next step once the manual flow is working. The trigger is straightforward to add; the open questions are around rate-limiting, cost, and whether the call should block the NPC's tick or run asynchronously. Deferring until we have experience with the manual flow.

The think call runs asynchronously (not on the tick loop) and produces a `ThinkOutput` that is applied at the next safe task boundary (when `_taskGen` is null, or immediately if the output adds a high-priority task).

### 1.1 Context fed to the LLM

The prompt is assembled from four layers:

**Layer 1 — Fixed system prompt (per NPC, set at spawn)**
- Game mechanics summary: farming loop, hunger/vitality, objects, actions available
- Zone registry: names and label strings from `FARM_ZONES`, urgency tier descriptions for `addPendingTask`

> **Future work:** Per-NPC personality (name, values, backstory, relationships to other NPCs) belongs here and is the primary lever for making conversations feel distinct and believable. Deferring until the basic LLM flow is working.

**Layer 2 — Current state snapshot**
- Hunger level and inventory contents
- Current task name and its description string (from the introspection push/pop stack)

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
  "wheat_field_west": { "label": "the left half of the main field", "explored": 6, "tiles": { "growing": 3, "harvestable": 1, "bare": 2 } },
  "north_plot":       { "label": "the north garden", "explored": 3, "tiles": { "growing": 1, "bare": 2 } }
}
```

Dirt tiles outside any `FARM_ZONE` are not reported. On the current map this shouldn't arise; revisit if the map gains informal farmable areas.

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

`talkToTask` is partially simulated through `drainHypo()`: the hypo run simulates only the **walk** to the target's last known position, then returns. The conversation itself cannot be simulated. This means the walk's real costs and benefits (hunger accumulation, new tiles seen, eventually dangerous terrain) are captured naturally by the utility function. On top of the simulated ΔU, a pre-assigned `urgency_bonus` is added to represent the conversation's intrinsic value:

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

**Target position lookup:** `talkToTask` needs the target's last known position to simulate the walk. `_chooseTask()` looks this up from `ActionMemory` before constructing the hypo, and passes it as a parameter:

```js
const targetPos = this._lastKnownPosition(pendingTask.target); // from ActionMemory
const taskFn = (ctx) => talkToTask(ctx, pendingTask.target, pendingTask.message, targetPos);
```

If the target has never appeared in ActionMemory, `targetPos` is null, the walk is a no-op in hypo, and ΔU is just the urgency bonus. The NPC will still pursue the conversation — they just have to search on arrival.

**Single slot:** `_pendingTask` holds at most one pending task. If a new think call fires while a task is already pending, the new one replaces the old one.

### 2.3 Task mechanics (real mode)

```
talkToTask(ctx, targetName, openingMessage, targetPos)
  1. Walk to targetPos (or search if null).
  2. If targetName is not within CONVERSATION_RADIUS tiles, idle briefly and retry
     (the target may be moving).
  3. Fire the conversation orchestrator (see synchronization below).
```

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

The orchestrator holds references to both NPC brains via an `npcRegistry` (name → brain) injected into `DanBrain` at construction time. This is the only point where one NPC brain directly touches another.

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

Zones are defined at map-build time alongside the world layout in `builder.js`. Each zone has a human-readable name and an explicit tile set. Zone summaries in LLM prompts group crop status by these named regions.

```js
// Defined alongside buildVillage() in builder.js
export const FARM_ZONES = {
  wheat_field_west: { label: "the left half of the main field, roughly 6 tiles", tiles: [[24,30],[25,30],[26,30],[27,30],[24,31],[25,31]] },
  wheat_field_east: { label: "the right half of the main field, roughly 5 tiles", tiles: [[28,30],[29,30],[28,31],[29,31],[30,31]] },
  // ...
};
```

Zone names and their `label` strings are included in the NPC system prompt, giving the LLM enough context to reason about them in conversation without needing to understand coordinates.

> **Future work:** If the map becomes procedural or farmable areas are discovered at runtime, zone boundaries will need to be computed algorithmically (e.g. Voronoi partition of known dirt tiles by NPC home position) rather than authored. Only the zone registry source changes.

---

## 5. ActionMemory

The full `ActionMemory` struct:

```ts
interface ActionMemory {
  subject: string;           // NPC name
  action: ActionEnum;        // movement | farm_action | say | think
  location: [number, number, number];
  tick: number;
  details: string;           // direction, object name, text said/thought
  otherPerson?: string;      // set for say/conversation entries
}
```

**Pruning (TODO):** ActionMemory will grow unboundedly without pruning. Priority heuristics for removal:
- Movement entries older than N ticks are compressed (keep first + last of a movement sequence)
- `farm_action` entries older than M ticks are pruned, keeping one per location
- `say` / `think` entries are kept longer (they carry coordination state)
- The most recent entry per other NPC is always retained

---

## 6. Open Questions

- **ActionMemory query tool:** Should NPCs have a tool call that lets the LLM query ActionMemory by NPC, time range, or action type? Useful for large histories, deferred for now.
- **Coordination trigger:** What causes the LLM to decide to initiate coordination? Current answer: the LLM sees relevant context in ActionMemory (e.g., another NPC farming nearby) and decides autonomously. No hardcoded trigger.
