import {
  MSM_GRID_EMPTY_SLOT,
  MSM_GRID_MAX_LIGHT_COUNT,
  decodeLightSlot,
  encodeLightSlot,
} from "./msmWorldGridLayout.js";
import { MSM_CONVERGENCE_FRAMES_98 } from "./msmConvergenceClockCore.js";
import { readMsmLightKey } from "./msmLightRecordCore.js";


export const MSM_LIGHT_INDEX_PHASE_ID = "MSM-F6";


export const MSM_LIGHT_INDEX_CAPACITY = MSM_GRID_MAX_LIGHT_COUNT;


export const MSM_LIGHT_INDEX_NONE = -1;


export const MSM_LIGHT_INDEX_QUARANTINE_FRAMES = MSM_CONVERGENCE_FRAMES_98;


export const MSM_LIGHT_INDEX_REFUSAL = Object.freeze({
  MISSING_KEY: "missingLightKey",
  CAPACITY_EXHAUSTED: "capacityExhausted",
  NOT_REGISTERED: "notRegistered",
});

function clampCapacity(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MSM_LIGHT_INDEX_CAPACITY;
  const whole = Math.trunc(value);
  if (whole > MSM_LIGHT_INDEX_CAPACITY) return MSM_LIGHT_INDEX_CAPACITY;
  return whole >= 1 ? whole : 1;
}

function clampQuarantineFrames(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MSM_LIGHT_INDEX_QUARANTINE_FRAMES;
  const whole = Math.trunc(value);
  return whole >= 0 ? whole : 0;
}

function acquireResult(index, created, reused, earlyReuse) {
  return Object.freeze({ ok: true, index, created, reused, earlyReuse, refusal: null, reason: "" });
}

function refusalResult(refusal, reason) {
  return Object.freeze({
    ok: false,
    index: MSM_LIGHT_INDEX_NONE,
    created: false,
    reused: false,
    earlyReuse: false,
    refusal,
    reason,
  });
}


export function createLightIndexTable(options) {
  const settings = options && typeof options === "object" ? options : {};
  const capacity = clampCapacity(settings.capacity);
  const quarantineFrames = clampQuarantineFrames(settings.quarantineFrames);

  const indexByKey = new Map();
  const keyByIndex = new Array(capacity).fill(null);
  const quarantinedIndices = [];
  const counters = {
    frameIndex: 0,
    nextFreshIndex: 0,
    acquireCount: 0,
    releaseCount: 0,
    refusedCount: 0,
    reuseCount: 0,
    earlyReuseCount: 0,
    indexChangeCount: 0,
  };

  function takeFreeIndex() {
    if (capacity > counters.nextFreshIndex) {
      const freshIndex = counters.nextFreshIndex;
      counters.nextFreshIndex += 1;
      return { index: freshIndex, reused: false, earlyReuse: false };
    }
    if (quarantinedIndices.length === 0) return null;
    const oldest = quarantinedIndices.shift();
    const framesResting = counters.frameIndex - oldest.releasedAtFrame;
    return { index: oldest.index, reused: true, earlyReuse: quarantineFrames > framesResting };
  }

  function indexOf(lightOrKey) {
    const key = readMsmLightKey(lightOrKey);
    if (key === null) return MSM_LIGHT_INDEX_NONE;
    const index = indexByKey.get(key);
    return index === undefined ? MSM_LIGHT_INDEX_NONE : index;
  }

  function acquire(lightOrKey) {
    const key = readMsmLightKey(lightOrKey);
    if (key === null) {
      counters.refusedCount += 1;
      return refusalResult(MSM_LIGHT_INDEX_REFUSAL.MISSING_KEY, "luz sem chave estavel: o MSM nao inventa identidade");
    }
    const existing = indexByKey.get(key);
    if (existing !== undefined) return acquireResult(existing, false, false, false);

    const claimed = takeFreeIndex();
    if (claimed === null) {
      counters.refusedCount += 1;
      return refusalResult(
        MSM_LIGHT_INDEX_REFUSAL.CAPACITY_EXHAUSTED,
        "teto de " + capacity + " luzes cheio: a luz " + key + " fica de fora e nenhuma luz viva perde o indice",
      );
    }

    indexByKey.set(key, claimed.index);
    keyByIndex[claimed.index] = key;
    counters.acquireCount += 1;
    if (claimed.reused) counters.reuseCount += 1;
    if (claimed.earlyReuse) counters.earlyReuseCount += 1;
    return acquireResult(claimed.index, true, claimed.reused, claimed.earlyReuse);
  }

  function release(lightOrKey) {
    const key = readMsmLightKey(lightOrKey);
    if (key === null) {
      return refusalResult(MSM_LIGHT_INDEX_REFUSAL.MISSING_KEY, "luz sem chave estavel: nada para liberar");
    }
    const index = indexByKey.get(key);
    if (index === undefined) {
      return refusalResult(MSM_LIGHT_INDEX_REFUSAL.NOT_REGISTERED, "luz " + key + " nao estava registrada");
    }
    indexByKey.delete(key);
    keyByIndex[index] = null;
    quarantinedIndices.push({ index, releasedAtFrame: counters.frameIndex });
    counters.releaseCount += 1;
    return Object.freeze({ ok: true, index, refusal: null, reason: "" });
  }


  function syncLights(lights) {
    const list = Array.isArray(lights) ? lights : [];
    const wantedKeys = [];
    const wantedKeySet = new Set();
    const refused = [];

    for (let position = 0; list.length > position; position += 1) {
      const key = readMsmLightKey(list[position]);
      if (key === null) {
        counters.refusedCount += 1;
        refused.push(Object.freeze({
          inputIndex: position,
          key: null,
          refusal: MSM_LIGHT_INDEX_REFUSAL.MISSING_KEY,
          reason: "luz sem chave estavel: o MSM nao inventa identidade",
        }));
        continue;
      }
      if (wantedKeySet.has(key)) continue;
      wantedKeySet.add(key);
      wantedKeys.push(key);
    }

    const indexBeforeSync = new Map();
    for (let position = 0; wantedKeys.length > position; position += 1) {
      const key = wantedKeys[position];
      const previousIndex = indexByKey.get(key);
      if (previousIndex !== undefined) indexBeforeSync.set(key, previousIndex);
    }

    const released = [];
    const liveKeys = Array.from(indexByKey.keys());
    for (let position = 0; liveKeys.length > position; position += 1) {
      const key = liveKeys[position];
      if (wantedKeySet.has(key)) continue;
      const outcome = release(key);
      if (outcome.ok) released.push(Object.freeze({ key, index: outcome.index }));
    }

    const acquired = [];
    let stableCount = 0;
    for (let position = 0; wantedKeys.length > position; position += 1) {
      const key = wantedKeys[position];
      const outcome = acquire(key);
      if (!outcome.ok) {
        refused.push(Object.freeze({
          inputIndex: position,
          key,
          refusal: outcome.refusal,
          reason: outcome.reason,
        }));
        continue;
      }
      if (indexBeforeSync.has(key)) {
        stableCount += 1;


        if (indexBeforeSync.get(key) !== outcome.index) counters.indexChangeCount += 1;
        continue;
      }
      acquired.push(Object.freeze({ key, index: outcome.index }));
    }

    return Object.freeze({
      liveCount: indexByKey.size,
      acquired: Object.freeze(acquired),
      released: Object.freeze(released),
      refused: Object.freeze(refused),
      stableCount,
      indexChangeCount: counters.indexChangeCount,
    });
  }

  return Object.freeze({
    capacity,
    quarantineFrames,

    acquire,
    release,
    syncLights,
    indexOf,


    slotOf(lightOrKey) {
      const index = indexOf(lightOrKey);
      return index === MSM_LIGHT_INDEX_NONE ? MSM_GRID_EMPTY_SLOT : encodeLightSlot(index);
    },


    keyAt(index) {
      if (typeof index !== "number" || !Number.isFinite(index)) return null;
      const whole = Math.trunc(index);
      if (!(whole >= 0) || whole >= capacity) return null;
      return keyByIndex[whole];
    },


    keyAtSlot(slot) {
      const index = decodeLightSlot(slot);
      return index === MSM_LIGHT_INDEX_NONE ? null : this.keyAt(index);
    },


    advanceFrame() {
      counters.frameIndex += 1;
      return counters.frameIndex;
    },


    reset() {
      indexByKey.clear();
      keyByIndex.fill(null);
      quarantinedIndices.length = 0;
      counters.nextFreshIndex = 0;
      return true;
    },


    snapshot() {
      let readyForReuseCount = 0;
      for (let position = 0; quarantinedIndices.length > position; position += 1) {
        const framesResting = counters.frameIndex - quarantinedIndices[position].releasedAtFrame;
        if (framesResting >= quarantineFrames) readyForReuseCount += 1;
      }
      return Object.freeze({
        capacity,
        quarantineFrames,
        frameIndex: counters.frameIndex,
        liveCount: indexByKey.size,
        freshCount: capacity - counters.nextFreshIndex,
        quarantinedCount: quarantinedIndices.length,
        readyForReuseCount,
        acquireCount: counters.acquireCount,
        releaseCount: counters.releaseCount,
        refusedCount: counters.refusedCount,
        reuseCount: counters.reuseCount,
        earlyReuseCount: counters.earlyReuseCount,
        indexChangeCount: counters.indexChangeCount,
      });
    },


    describe() {
      const state = this.snapshot();
      return [
        "luzes " + state.liveCount + "/" + state.capacity,
        "virgens " + state.freshCount,
        "quarentena " + state.quarantinedCount + " (prontos " + state.readyForReuseCount + ")",
        "recusas " + state.refusedCount,
        "reciclagens " + state.reuseCount + " (antes do prazo " + state.earlyReuseCount + ")",
        "indices deslocados " + state.indexChangeCount,
      ].join(" | ");
    },
  });
}
