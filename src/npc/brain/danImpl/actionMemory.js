/**
 * ActionMemory — short-term action log for LLM context and target lookup.
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
 */

/** @typedef {ActionMemoryEntry[]} ActionMemoryStore */

const MAX_SELF_ENTRIES = 20;
const MOVE_PRUNE_AGE = 200;
const FARM_PRUNE_AGE = 300;

/**
 * @returns {ActionMemoryStore}
 */
export function createActionMemoryStore() {
    return [];
}

/**
 * @param {ActionMemoryStore} store
 * @param {ActionMemoryEntry} entry
 */
export function appendAction(store, entry) {
    store.push(entry);
    pruneMemory(store);
}

/**
 * @param {ActionMemoryStore} store
 */
export function pruneMemory(store) {
    if (store.length === 0) return;

    const latestTick = store[store.length - 1].tick;
    const keepIndices = new Set();

    for (let i = 0; i < store.length; i++) {
        const e = store[i];
        if (e.action === 'conversation' || e.action === 'say' || e.action === 'think') {
            keepIndices.add(i);
        }
    }

    /** @type {Map<string, number>} */
    const latestOtherNpc = new Map();
    for (let i = store.length - 1; i >= 0; i--) {
        const e = store[i];
        if (e.otherPerson) continue;
        if (!latestOtherNpc.has(e.subject)) {
            latestOtherNpc.set(e.subject, i);
            keepIndices.add(i);
        }
    }

    /** @type {Map<string, number>} */
    const latestFarmPerLocation = new Map();
    for (let i = store.length - 1; i >= 0; i--) {
        const e = store[i];
        if (e.action !== 'farm_action') continue;
        const locKey = e.location.join(',');
        if (!latestFarmPerLocation.has(locKey)) {
            latestFarmPerLocation.set(locKey, i);
            keepIndices.add(i);
        }
    }

    let selfKept = 0;
    for (let i = store.length - 1; i >= 0 && selfKept < MAX_SELF_ENTRIES; i--) {
        const e = store[i];
        if (e.otherPerson) continue;
        keepIndices.add(i);
        selfKept++;
    }

    const pruned = store.filter((e, i) => {
        if (keepIndices.has(i)) return true;
        const age = latestTick - e.tick;
        if (e.action === 'movement' && age > MOVE_PRUNE_AGE) return false;
        if (e.action === 'farm_action' && age > FARM_PRUNE_AGE) return false;
        return age < MOVE_PRUNE_AGE;
    });

    compressMovementRuns(pruned);
    store.length = 0;
    store.push(...pruned);
}

/**
 * @param {ActionMemoryStore} store
 */
function compressMovementRuns(store) {
    /** @type {number[]} */
    const moveIndices = [];
    for (let i = 0; i < store.length; i++) {
        if (store[i].action === 'movement') moveIndices.push(i);
    }
    if (moveIndices.length <= 4) return;

    const toDrop = new Set();
    for (let r = 0; r < moveIndices.length; ) {
        let rEnd = r;
        while (rEnd + 1 < moveIndices.length) {
            const a = store[moveIndices[rEnd]];
            const b = store[moveIndices[rEnd + 1]];
            if (b.tick - a.tick > 5) break;
            rEnd++;
        }
        if (rEnd - r >= 3) {
            for (let k = r + 1; k < rEnd; k++) {
                toDrop.add(moveIndices[k]);
            }
        }
        r = rEnd + 1;
    }
    if (toDrop.size === 0) return;

    const filtered = store.filter((_, i) => !toDrop.has(i));
    store.length = 0;
    store.push(...filtered);
}

/**
 * @param {ActionMemoryStore} store
 * @param {string} npcName
 * @returns {[number, number, number] | null}
 */
export function getLastKnownPosition(store, npcName) {
    for (let i = store.length - 1; i >= 0; i--) {
        if (store[i].subject === npcName) {
            return store[i].location;
        }
    }
    return null;
}

/**
 * @param {ActionMemoryStore} store
 * @returns {ActionMemoryEntry[]}
 */
export function getConversationEntries(store) {
    return store.filter((e) => e.action === 'conversation');
}

/**
 * Build layer-3 action memory slice for prompts.
 *
 * @param {ActionMemoryStore} store
 * @param {string} selfName
 * @returns {ActionMemoryEntry[]}
 */
export function getPromptActionSlice(store, selfName) {
    const conversations = getConversationEntries(store);
    const convSet = new Set(conversations);

    /** @type {Map<string, ActionMemoryEntry>} */
    const latestOther = new Map();
    /** @type {ActionMemoryEntry[]} */
    const selfEntries = [];

    for (let i = store.length - 1; i >= 0; i--) {
        const e = store[i];
        if (convSet.has(e)) continue;
        if (e.subject === selfName) {
            if (selfEntries.length < MAX_SELF_ENTRIES) selfEntries.push(e);
        } else if (!latestOther.has(e.subject)) {
            latestOther.set(e.subject, e);
        }
    }

    return [...selfEntries.reverse(), ...latestOther.values(), ...conversations];
}
