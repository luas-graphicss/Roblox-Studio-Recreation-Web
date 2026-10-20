export const MGL_FIRST_LIGHT_ID = 1;
export const MGL_NO_SLOT = -1;


export function createLightIdentityTable(options) {
  const settings = options && typeof options === "object" ? options : {};
  const onSlotReleased = typeof settings.onSlotReleased === "function" ? settings.onSlotReleased : null;

  const entriesByKey = new Map();
  const entriesBySlot = [];
  const generationBySlot = [];
  const freeSlots = [];
  const staleKeys = [];

  let nextLightId = MGL_FIRST_LIGHT_ID;
  let currentFrameIndex = 0;
  let slotReuseCount = 0;
  let releasedCount = 0;
  let highWaterSlotCount = 0;

  function takeSlot() {
    if (freeSlots.length > 0) return freeSlots.pop();
    const slotIndex = entriesBySlot.length;
    entriesBySlot.push(null);
    generationBySlot.push(0);
    return slotIndex;
  }

  function releaseEntry(entry) {
    const slotIndex = entry.slotIndex;
    entriesByKey.delete(entry.key);
    if (slotIndex !== MGL_NO_SLOT) {
      entriesBySlot[slotIndex] = null;
      freeSlots.push(slotIndex);
      if (onSlotReleased) onSlotReleased(slotIndex, entry.lightId);
    }
    entry.slotIndex = MGL_NO_SLOT;
    entry.alive = false;
    releasedCount++;
  }

  return {

    beginFrame(frameIndex) {
      currentFrameIndex = Number.isFinite(frameIndex) ? frameIndex : currentFrameIndex + 1;
      return currentFrameIndex;
    },


    acquire(key) {
      const stableKey = String(key);
      const existing = entriesByKey.get(stableKey);
      if (existing) {
        existing.lastSeenFrame = currentFrameIndex;
        existing.isNew = false;
        existing.reusedSlot = false;
        return existing;
      }

      const slotIndex = takeSlot();
      const previousOwner = entriesBySlot[slotIndex];
      const reusedSlot = previousOwner === null && generationBySlot[slotIndex] > 0;
      if (reusedSlot) {
        generationBySlot[slotIndex] = generationBySlot[slotIndex] + 1;
        slotReuseCount++;
      } else if (generationBySlot[slotIndex] === 0) {
        generationBySlot[slotIndex] = 1;
      }

      const entry = {
        key: stableKey,
        lightId: nextLightId++,
        slotIndex,
        generation: generationBySlot[slotIndex],
        isNew: true,
        reusedSlot,
        lastSeenFrame: currentFrameIndex,
        alive: true,
      };
      entriesByKey.set(stableKey, entry);
      entriesBySlot[slotIndex] = entry;
      if (entriesBySlot.length > highWaterSlotCount) highWaterSlotCount = entriesBySlot.length;
      return entry;
    },


    releaseUnseen() {
      staleKeys.length = 0;
      entriesByKey.forEach((entry) => {
        if (entry.lastSeenFrame !== currentFrameIndex) staleKeys.push(entry.key);
      });
      for (let index = 0; index < staleKeys.length; index++) {
        const entry = entriesByKey.get(staleKeys[index]);
        if (entry) releaseEntry(entry);
      }
      return staleKeys.length;
    },


    release(key) {
      const entry = entriesByKey.get(String(key));
      if (!entry) return false;
      releaseEntry(entry);
      return true;
    },

    entryFor(key) {
      return entriesByKey.get(String(key)) || null;
    },

    entryForSlot(slotIndex) {
      return entriesBySlot[slotIndex] || null;
    },

    generationOfSlot(slotIndex) {
      return generationBySlot[slotIndex] === undefined ? 0 : generationBySlot[slotIndex];
    },

    lightIdOfSlot(slotIndex) {
      const entry = entriesBySlot[slotIndex];
      return entry ? entry.lightId : 0;
    },

    activeCount() {
      return entriesByKey.size;
    },


    slotCount() {
      return entriesBySlot.length;
    },

    freeSlotCount() {
      return freeSlots.length;
    },

    stats() {
      return {
        activeLights: entriesByKey.size,
        slotCount: entriesBySlot.length,
        freeSlots: freeSlots.length,
        slotReuseCount,
        releasedCount,
        highWaterSlotCount,
        nextLightId,
        frameIndex: currentFrameIndex,
      };
    },

    clear() {
      entriesByKey.clear();
      entriesBySlot.length = 0;
      generationBySlot.length = 0;
      freeSlots.length = 0;
      staleKeys.length = 0;
      slotReuseCount = 0;
      releasedCount = 0;


    },
  };
}
