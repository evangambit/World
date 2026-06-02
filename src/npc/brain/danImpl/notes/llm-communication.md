# LLM Communication — Tech Spec

This document covers the design for periodic LLM "think" calls, NPC-to-NPC conversations, and the brain state structures needed for coordination (tile ownership, task queuing).

---

## 1. Periodic "Think" Call

Every ~2 real-time minutes (configurable), each NPC gets a background LLM call. This is not a tick-level action — it runs asynchronously and produces a `BrainTweak` that is applied at the next safe task boundary (i.e. when `_taskGen` is null, or immediately if the tweak adds a high-priority task).

### 1.1 Context fed to the LLM

The prompt is assembled from four layers:

**Layer 1 — Fixed system prompt (per NPC, set at spawn)**
- Game mechanics summary: farming loop, hunger/vitality, objects, actions available
- NPC personality: name, values, backstory, relationships to other NPCs

**Layer 2 — Current state snapshot**
- Hunger level and inventory contents
- Current task name and its description string (from the introspection push/pop stack)
- NPC's current `zoneCommitment` (see §3)

**Layer 3 — Action memory**
- Last ~20 `ActionMemory` entries for self (movement entries can be compressed/elided)
- Most recent single `ActionMemory` entry per other known NPC (so the NPC knows roughly what others are doing)
- **All** `ActionMemory` entries of type `conversation`, regardless of age — conversation history is the primary signal for coordination state

**Layer 4 — Tile memory summary (derived, not raw)**

The raw tile memory map is not passed to the LLM. Instead, a compact summary is derived at call time:

```
Farmable area: ~18 dirt tiles, roughly clustered around (24–30, 30–34)
Your claimed zone: west half (x < 27) [per zoneCommitment]
Others' known claims: Finn → south_field, Elara → east_half
Crops currently growing: 3
Crops harvestable now: 2
```

This is computable deterministically from tile memory + `zoneCommitment` and gives the LLM what it needs without a coordinate dump.

### 1.2 Output format

The LLM returns a JSON object:

```ts
interface ThinkOutput {
  thought?: string;          // logged to ActionMemory as type=think
  brainTweak?: BrainTweak;   // optional state mutation (see §4)
}
```

---

## 2. The "Talk To" Task

### 2.1 How a conversation is initiated

A conversation is initiated when the LLM think call produces a `BrainTweak` with `addPendingTask: { type: "talk_to", target: "<name>", message: "<what to say or discuss>" }`. The pending task is queued in the brain and selected at the next `_chooseTask()` call (it scores as effectively infinite utility so it always wins).

A conversation task can also be initiated programmatically (e.g. if a future utility term for "unresolved coordination conflict" reaches a threshold), but initially LLM-initiated only.

### 2.2 Task mechanics

```
talkToTask(ctx, targetName, openingMessage)
  1. Walk to targetName's last-known position.
  2. If targetName is not within CONVERSATION_RADIUS tiles, idle briefly and retry
     (the target may be moving).
  3. Set CONVERSING_WITH flag on both NPCs.
  4. Begin conversation loop (initiator goes first).
```

**Conversation loop:**

Each turn of the loop is one LLM call for the active speaker. The input is:
- Full context (§1.1) plus the full conversation-so-far as a transcript
- The other NPC's most recent `say`

The output is:

```ts
interface ConversationTurnOutput {
  say: string;
  endConversation?: boolean;
  brainTweak?: BrainTweak;   // applied immediately on this NPC's brain
}
```

The turn ping-pongs: initiator speaks, responder speaks, initiator speaks, ... A `MAX_CONVERSATION_TURNS` cap (e.g. 10) prevents infinite loops. Either party can set `endConversation: true` to stop.

**Synchronization:** The initiator drives the loop. When `CONVERSING_WITH` is set on the responder, the responder's `tick()` interrupts its current task (i.e. `_taskGen` is cleared) and enters a `conversationResponseTask` generator that waits for and responds to the initiator's turns. When the conversation ends, both flags clear and both NPCs resume normal task selection via `_chooseTask()`.

**ActionMemory:** Every `say` by either NPC is appended to both NPCs' `ActionMemory` as type `conversation`, with `otherPerson` set to the counterpart. This is how the conversation persists into future think-call context.

### 2.3 Multi-NPC conversations

Three-way coordination is deferred. For now, A talks to B, then separately A talks to C. The conversation history in ActionMemory carries the coordination state across both conversations.

---

## 3. Tile Ownership: `zoneCommitment`

Each NPC brain holds a `zoneCommitment` object as persistent state:

```ts
interface ZoneCommitment {
  myClaim: ZoneDescriptor | null;
  knownClaims: Record<string, ZoneDescriptor>;  // npc name → their claim
}

type ZoneDescriptor =
  | { type: "named"; name: string }              // e.g. "west_field"
  | { type: "x_range"; xMin: number; xMax: number }
  | { type: "y_range"; yMin: number; yMax: number }
  | { type: "tiles"; coords: [number, number][] } // explicit list, for small sets
```

Zone descriptors are intentionally human-readable — the LLM produces and consumes them. A small runtime function maps a `ZoneDescriptor` to the set of tiles from memory that it covers, which is used for utility scoring.

**Effect on utility:** In the near term, `zoneCommitment` is a data structure only — it does not affect `farmTask` utility. The intended follow-on integration: tiles outside `myClaim` score lower (or zero) in `chooseBestFarmTarget()`. This is deferred until coordination conversations are working and claims are stable enough to rely on.

**Conflict detection:** The LLM context always includes both the NPC's own claim and `knownClaims`. If the NPC observes (via ActionMemory) that another NPC is farming tiles within `myClaim`, the think call should surface this conflict and the LLM can decide to initiate a `talk_to` task to renegotiate.

---

## 4. Brain Tweak Format

`BrainTweak` is the structured output that the LLM uses to mutate brain state. It is a plain JSON object — not free-form text. The brain's tweak interpreter applies it safely at a task boundary.

```ts
interface BrainTweak {
  // Log a thought to ActionMemory (type=think)
  recordThought?: string;

  // Update zone commitment (self's claim and/or knowledge of others)
  updateZoneCommitment?: Partial<ZoneCommitment>;

  // Queue a high-priority task for the next _chooseTask() call
  addPendingTask?: PendingTask;

  // Override a named utility weight (e.g. suppress exploration while focused on farming)
  setUtilityWeight?: Record<string, number>;
}

type PendingTask =
  | { type: "talk_to"; target: string; message: string }
  | { type: "plant_in"; zone: ZoneDescriptor }
  | { type: "idle_until"; gameTime: number }
```

**Safety constraints:**
- `setUtilityWeight` keys must be members of a whitelist (e.g. `EXPLORE_WEIGHT`, `CROP_WEIGHT`)
- `addPendingTask` types are an enumerated union, not arbitrary code
- The interpreter ignores unknown keys and clamps numeric values to sane ranges

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

- **Tile memory summary format:** Should the LLM receive a textual paragraph, or a small structured object? Paragraph is easier to prompt-engineer; structured is more reliable for zone descriptor generation.
- **Tool calls for memory queries:** Should NPCs have a tool call that lets the LLM query ActionMemory by NPC, time range, or action type? Useful for large histories, deferred for now.
- **Coordination trigger:** What causes the LLM to decide to initiate coordination? Current answer: the LLM sees a conflict in its context (e.g., another NPC farming its tiles) and decides autonomously. No hardcoded trigger.
- **Zone descriptor grounding:** When the LLM proposes a `ZoneDescriptor`, how does it know the actual map layout? It learns from the tile memory summary in its context. The summary should explicitly state farmable tile extents so the LLM can generate sensible range descriptors.
- **Utility integration with zone claims:** Deferred. When implemented: tiles outside `myClaim` get a multiplier < 1 in `chooseBestFarmTarget()` scoring. The exact multiplier needs calibration — it should be strong enough that NPCs respect zones but not so strong that a NPC starves if its zone has no harvestable crops.
