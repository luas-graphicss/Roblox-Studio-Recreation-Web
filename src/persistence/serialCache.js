import { bus } from "../core/eventBus.js";
import { Events } from "../datamodel/index.js";

const MAX_CACHE_ENTRIES = 20000;
const EVICTION_BATCH_SIZE = 2000;


function evictOldestEntries(entries, amount) {
  let remaining = Math.min(amount, entries.size);
  for (const key of entries.keys()) {
    if (remaining <= 0) break;
    entries.delete(key);
    remaining--;
  }
}

export function createSerializationCache() {
  const entries = new Map();
  return {
    get(inst) {
      if (!inst || inst.id == null) return null;
      return entries.get(inst.id) || null;
    },
    set(inst, entry) {
      if (!inst || inst.id == null || !entry) return;
      if (entries.size >= MAX_CACHE_ENTRIES) evictOldestEntries(entries, EVICTION_BATCH_SIZE);
      entries.set(inst.id, entry);
    },
    invalidate(id) {
      if (id != null) entries.delete(id);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

export const serializationCache = createSerializationCache();

function instanceFromPayload(payload) {
  if (!payload) return null;
  if (payload.__isInstance === true) return payload;
  if (payload.instance && payload.instance.__isInstance === true) return payload.instance;
  if (payload.inst && payload.inst.__isInstance === true) return payload.inst;
  return null;
}

function onInstanceEvent(payload) {
  const inst = instanceFromPayload(payload);
  if (inst && inst.id != null) serializationCache.invalidate(inst.id);
}

bus.on(Events.PropertyChanged, onInstanceEvent);
bus.on(Events.AttributeChanged, onInstanceEvent);
bus.on(Events.Destroying, onInstanceEvent);
bus.on("project:loaded", () => serializationCache.clear());
