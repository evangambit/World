/**
 * ActionMemory — short-term action log for LLM context and target lookup.
 *
 * Self movement entries are held in a two-slot buffer (_movementBuffer) rather
 * than being appended every tick. The buffer is flushed (start + latest) when
 * a non-movement action occurs, keeping _entries clean without any post-hoc
 * compression pass.
 */

/** @typedef {'movement' | 'farm_action' | 'say' | 'think' | 'conversation'} ActionEnum */

/**
 * @typedef {Object} ActionMemoryEntry
 * @property {string} subject
 * @property {ActionEnum} action
 * @property {[number, number, number]} location
 * @property {number} tick
 * @property {string} details
 * @property {string} [otherPerson]
 * @property {number} [endTick] - set only on merged movement entries (start tick in `tick`, end in `endTick`)
 * @property {[number, number, number]} [endLocation] - current position at `endTick`
 */

const MAX_SELF_ENTRIES = 20;
const PRUNE_AGE = /** @type {Record<ActionEnum, number>} */ ({
    movement: 200,
    farm_action: 300,
    say: Infinity,
    think: Infinity,
    conversation: Infinity,
});

export class ActionMemory {
    /** @param {string} selfName */
    constructor(selfName) {
        /** @type {string} */
        this.selfName = selfName;
        /** @type {ActionMemoryEntry[]} */
        this._entries = [];
        /** @type {{ start: ActionMemoryEntry, latest: ActionMemoryEntry } | null} */
        this._movementBuffer = null;
    }

    /** @param {ActionMemoryEntry} entry */
    append(entry) {
        if (entry.action === 'movement' && entry.subject === this.selfName) {
            if (!this._movementBuffer) {
                this._movementBuffer = { start: entry, latest: entry };
            } else {
                this._movementBuffer.latest = entry;
            }
        } else {
            // Only flush the self-movement buffer when a meaningful self action
            // interrupts movement (think, farm_action, conversation, etc.).
            // Observations of other NPCs must not flush it — observeNpc is called
            // every frame and would otherwise nullify the two-slot compression.
            if (entry.subject === this.selfName) {
                this._flushMovement();
            }
            this._entries.push(entry);
            this._prune();
        }
    }

    /** @returns {number} */
    get length() {
        const bufLen = !this._movementBuffer ? 0
            : this._movementBuffer.start === this._movementBuffer.latest ? 1 : 2;
        return this._entries.length + bufLen;
    }

    /**
     * @param {string} npcName
     * @returns {[number, number, number] | null}
     */
    getLastKnownPosition(npcName) {
        if (npcName === this.selfName && this._movementBuffer) {
            return this._movementBuffer.latest.location;
        }
        for (let i = this._entries.length - 1; i >= 0; i--) {
            if (this._entries[i].subject === npcName) {
                return this._entries[i].location;
            }
        }
        return null;
    }

    /** @returns {ActionMemoryEntry[]} */
    getConversationEntries() {
        return this._entries.filter((e) => e.action === 'conversation');
    }

    /**
     * Build the action-memory slice used in LLM prompts.
     *
     * An in-progress self-movement run is represented as a single merged entry
     * with `endTick` and `endLocation` set so the prompt can render a compact
     * tick range (e.g. "t201–t207 movement: (11,23,0)→(27,26,0)").
     *
     * @returns {ActionMemoryEntry[]}
     */
    getPromptActionSlice() {
        // Build a view of _entries that excludes the raw buffer slots; the
        // buffer is represented separately as a merged entry (see below).
        const base = this._entries;
        const conversations = base.filter((e) => e.action === 'conversation');
        const convSet = new Set(conversations);

        // Most-recent MAX_SELF_ENTRIES self entries from _entries only.
        const selfEntries = base
            .filter((e) => !convSet.has(e) && e.subject === this.selfName)
            .slice(-MAX_SELF_ENTRIES);

        // Merge the buffered movement run into a single entry.
        if (this._movementBuffer) {
            const { start, latest } = this._movementBuffer;
            /** @type {ActionMemoryEntry} */
            const merged = start === latest
                ? start
                : {
                    ...start,
                    endTick: latest.tick,
                    endLocation: latest.location,
                };
            selfEntries.push(merged);
        }

        // Most-recent entry per other NPC.
        /** @type {Map<string, ActionMemoryEntry>} */
        const latestOther = new Map();
        for (let i = base.length - 1; i >= 0; i--) {
            const e = base[i];
            if (!convSet.has(e) && e.subject !== this.selfName && !latestOther.has(e.subject)) {
                latestOther.set(e.subject, e);
            }
        }

        return [...selfEntries, ...latestOther.values(), ...conversations];
    }

    _flushMovement() {
        if (!this._movementBuffer) return;
        const { start, latest } = this._movementBuffer;
        this._movementBuffer = null;
        if (start === latest) {
            this._entries.push(start);
        } else {
            this._entries.push(start, latest);
        }
    }

    /**
     * Returns _entries combined with any buffered movement entries.
     * Used for read-only queries so the buffer is never missed.
     * @returns {ActionMemoryEntry[]}
     */
    _entriesWithBuffer() {
        if (!this._movementBuffer) return this._entries;
        const { start, latest } = this._movementBuffer;
        return start === latest
            ? [...this._entries, start]
            : [...this._entries, start, latest];
    }

    _prune() {
        const entries = this._entries;
        if (entries.length === 0) return;

        const latestTick = entries[entries.length - 1].tick;
        const keepIndices = new Set();

        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e.action === 'conversation' || e.action === 'say' || e.action === 'think') {
                keepIndices.add(i);
            }
        }

        /** @type {Map<string, number>} */
        const latestOtherNpc = new Map();
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            if (e.otherPerson) continue;
            if (!latestOtherNpc.has(e.subject)) {
                latestOtherNpc.set(e.subject, i);
                keepIndices.add(i);
            }
        }

        /** @type {Map<string, number>} */
        const latestFarmPerLocation = new Map();
        for (let i = entries.length - 1; i >= 0; i--) {
            const e = entries[i];
            if (e.action !== 'farm_action') continue;
            const locKey = e.location.join(',');
            if (!latestFarmPerLocation.has(locKey)) {
                latestFarmPerLocation.set(locKey, i);
                keepIndices.add(i);
            }
        }

        let selfKept = 0;
        for (let i = entries.length - 1; i >= 0 && selfKept < MAX_SELF_ENTRIES; i--) {
            const e = entries[i];
            if (e.subject !== this.selfName) continue;
            keepIndices.add(i);
            selfKept++;
        }

        this._entries = entries.filter((e, i) =>
            keepIndices.has(i) || latestTick - e.tick < PRUNE_AGE[e.action],
        );
    }
}
