import {
  LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
  LIGHT_FUNCTION_FIRST_CONTENT_SLOT,
  LIGHT_FUNCTION_NEUTRAL_SLOT,
  LIGHT_FUNCTION_SLOT_COUNT,
} from "./mlLightFunctionAtlasCore.js";

export const SLOT_ACQUIRE_OUTCOME = Object.freeze({
  reused: "reused",
  allocated: "allocated",
  evicted: "evicted",
  refused: "refused",
});

function normalizeKey(key) {
  return typeof key === "string" ? key.trim() : "";
}

export function createLightFunctionSlotAllocator(options = {}) {
  const requestedCapacity = Number.isInteger(options.contentSlotCapacity)
    ? options.contentSlotCapacity
    : LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY;
  const capacity = Math.min(Math.max(requestedCapacity, 0), LIGHT_FUNCTION_SLOT_COUNT - 1);

  const slotByKey = new Map();
  const keyBySlot = new Map();
  const lastUsedFrameByKey = new Map();
  const freeSlots = [];
  for (let slot = LIGHT_FUNCTION_FIRST_CONTENT_SLOT; slot < LIGHT_FUNCTION_FIRST_CONTENT_SLOT + capacity; slot++) {
    freeSlots.push(slot);
  }

  let refusedAcquireCount = 0;
  let evictionCount = 0;


  let contentSlotBudget = capacity;

  function findEvictionCandidate(frameIndex) {
    let candidateKey = "";
    let candidateFrame = Number.POSITIVE_INFINITY;
    for (const [key, lastUsedFrame] of lastUsedFrameByKey) {
      if (lastUsedFrame >= frameIndex) continue;                                          
      if (lastUsedFrame < candidateFrame) {
        candidateFrame = lastUsedFrame;
        candidateKey = key;
      }
    }
    return candidateKey;
  }

  return {
    contentSlotCapacity: capacity,

    acquire(key, frameIndex = 0) {
      const normalizedKey = normalizeKey(key);
      if (!normalizedKey) {
        refusedAcquireCount++;
        return {
          slot: LIGHT_FUNCTION_NEUTRAL_SLOT,
          outcome: SLOT_ACQUIRE_OUTCOME.refused,
          reason: "empty light function key",
          evictedKey: "",
        };
      }
      const knownSlot = slotByKey.get(normalizedKey);
      if (knownSlot !== undefined) {
        lastUsedFrameByKey.set(normalizedKey, frameIndex);
        return { slot: knownSlot, outcome: SLOT_ACQUIRE_OUTCOME.reused, reason: "", evictedKey: "" };
      }
      const budgetLimit = LIGHT_FUNCTION_FIRST_CONTENT_SLOT + contentSlotBudget;
      if (freeSlots.length > 0 && freeSlots[0] < budgetLimit) {
        const slot = freeSlots.shift();
        slotByKey.set(normalizedKey, slot);
        keyBySlot.set(slot, normalizedKey);
        lastUsedFrameByKey.set(normalizedKey, frameIndex);
        return { slot, outcome: SLOT_ACQUIRE_OUTCOME.allocated, reason: "", evictedKey: "" };
      }
      const evictedKey = findEvictionCandidate(frameIndex);
      if (!evictedKey) {
        refusedAcquireCount++;
        return {
          slot: LIGHT_FUNCTION_NEUTRAL_SLOT,
          outcome: SLOT_ACQUIRE_OUTCOME.refused,
          reason: "atlas full of slots already used in this frame",
          evictedKey: "",
        };
      }
      const slot = slotByKey.get(evictedKey);
      slotByKey.delete(evictedKey);
      lastUsedFrameByKey.delete(evictedKey);
      slotByKey.set(normalizedKey, slot);
      keyBySlot.set(slot, normalizedKey);
      lastUsedFrameByKey.set(normalizedKey, frameIndex);
      evictionCount++;
      return { slot, outcome: SLOT_ACQUIRE_OUTCOME.evicted, reason: "", evictedKey };
    },

    setContentSlotBudget(budget) {
      const requested = Number(budget);
      contentSlotBudget = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 0), capacity) : capacity;
      return contentSlotBudget;
    },

    contentSlotBudget() {
      return contentSlotBudget;
    },

    touch(key, frameIndex = 0) {
      const normalizedKey = normalizeKey(key);
      if (!slotByKey.has(normalizedKey)) return false;
      lastUsedFrameByKey.set(normalizedKey, frameIndex);
      return true;
    },

    release(key) {
      const normalizedKey = normalizeKey(key);
      const slot = slotByKey.get(normalizedKey);
      if (slot === undefined) return false;
      slotByKey.delete(normalizedKey);
      keyBySlot.delete(slot);
      lastUsedFrameByKey.delete(normalizedKey);
      freeSlots.push(slot);
      freeSlots.sort((a, b) => a - b);
      return true;
    },

    slotOf(key) {
      const slot = slotByKey.get(normalizeKey(key));
      return slot === undefined ? LIGHT_FUNCTION_NEUTRAL_SLOT : slot;
    },

    keyOf(slot) {
      return keyBySlot.get(slot) || "";
    },

    usedSlotCount() {
      return slotByKey.size;
    },

    freeSlotCount() {
      return freeSlots.length;
    },

    describe() {
      return {
        contentSlotCapacity: capacity,
        contentSlotBudget,
        usedSlotCount: slotByKey.size,
        freeSlotCount: freeSlots.length,
        evictionCount,
        refusedAcquireCount,
      };
    },
  };
}
