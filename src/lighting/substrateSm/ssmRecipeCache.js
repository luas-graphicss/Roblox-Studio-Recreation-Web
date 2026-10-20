import { assertSubstrateSmKey } from './ssmRecipeKeys.js';
import { serializeSubstrateSmKeyDescriptor } from './ssmKeySerialization.js';
import { SSM_RECIPE_BYTE_LENGTH, SSM_RECIPE_FLOAT_COUNT, validateSubstrateSmRecipePayload } from './ssmRecipeLayout.js';
import { createSubstrateSmRecipeMemoryLedger } from './ssmRecipeMemoryLedger.js';

const SSM_CACHE_ENTRY_OVERHEAD_BYTES = 256;
const SSM_CACHE_LEASE_OVERHEAD_BYTES = 96;

function payloadsEqual(first, second) {
  for (let index = 0; index < SSM_RECIPE_FLOAT_COUNT; index += 1) {
    if (!Object.is(first[index], second[index])) return false;
  }
  return true;
}

export function createSubstrateSmRecipeCache({ profile = 'Lite', limits = {}, memoryLedger } = {}) {
  const ledger = memoryLedger ?? createSubstrateSmRecipeMemoryLedger({ profile, limits });
  const entries = new Map();
  const leaseOwners = new Set();
  let disposed = false;
  let hits = 0;
  let misses = 0;
  let evictions = 0;
  let refusals = 0;

  function touch(entry) {
    entries.delete(entry.key.signature);
    entries.set(entry.key.signature, entry);
  }

  function removeEntry(entry) {
    entries.delete(entry.key.signature);
    ledger.release(entry);
    entry.payload = null;
    entry.metadataText = null;
    entry.live = false;
  }

  function store({ key, payload, metadata = null }) {
    assertSubstrateSmKey(key, 'recipe');
    validateSubstrateSmRecipePayload(payload);
    if (disposed) return Object.freeze({ ok: false, reason: 'disposed' });
    const existing = entries.get(key.signature);
    if (existing) {
      if (!payloadsEqual(existing.payload, payload)) {
        refusals += 1;
        return Object.freeze({ ok: false, reason: 'identityPayloadMismatch' });
      }
      touch(existing);
      hits += 1;
      return Object.freeze({ ok: true, reused: true, key: existing.key });
    }
    const metadataText = serializeSubstrateSmKeyDescriptor(metadata);
    const ownedKey = Object.freeze({ kind: key.kind, hash: key.hash, signature: key.signature });
    const entry = { key: ownedKey, payload: null, metadataText, references: 0, live: true };
    const cost = {
      residentRecipes: 1,
      numericBufferBytes: SSM_RECIPE_BYTE_LENGTH,
      cpuCacheBytes: SSM_CACHE_ENTRY_OVERHEAD_BYTES + SSM_RECIPE_BYTE_LENGTH
        + 2 * (key.signature.length + key.hash.length + metadataText.length),
    };
    const victims = [];
    for (const candidate of entries.values()) {
      if (ledger.canReserve(entry, cost, victims)) break;
      if (candidate.references === 0) victims.push(candidate);
    }
    if (!ledger.canReserve(entry, cost, victims)) {
      refusals += 1;
      return Object.freeze({ ok: false, reason: 'cacheBudgetExceeded' });
    }
    for (const victim of victims) {
      removeEntry(victim);
      evictions += 1;
    }
    if (!ledger.reserve(entry, cost)) throw new Error('SSM cache reservation changed during admission');
    try {
      entry.payload = new Float32Array(payload);
    } catch (error) {
      ledger.release(entry);
      throw error;
    }
    entries.set(key.signature, entry);
    return Object.freeze({ ok: true, reused: false, key: ownedKey });
  }

  function acquire(key) {
    assertSubstrateSmKey(key, 'recipe');
    const entry = disposed ? null : entries.get(key.signature);
    if (!entry) {
      misses += 1;
      return null;
    }
    const owner = {};
    if (!ledger.reserve(owner, { residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes: SSM_CACHE_LEASE_OVERHEAD_BYTES })) {
      refusals += 1;
      return null;
    }
    leaseOwners.add(owner);
    entry.references += 1;
    touch(entry);
    hits += 1;
    let retainedEntry = entry;

    function copyPayloadTo(target) {
      if (!retainedEntry?.live || disposed) return false;
      if (!(target instanceof Float32Array) || target.length !== SSM_RECIPE_FLOAT_COUNT) {
        throw new TypeError('SSM recipe copies require exact float32 storage');
      }
      target.set(retainedEntry.payload);
      return true;
    }

    function readMetadata() {
      return retainedEntry?.live && !disposed ? JSON.parse(retainedEntry.metadataText) : null;
    }

    function release() {
      if (!retainedEntry) return false;
      if (retainedEntry.live) retainedEntry.references -= 1;
      retainedEntry = null;
      leaseOwners.delete(owner);
      ledger.release(owner);
      return true;
    }

    return Object.freeze({ key: entry.key, copyPayloadTo, readMetadata, release });
  }

  function has(key) {
    assertSubstrateSmKey(key, 'recipe');
    return !disposed && entries.has(key.signature);
  }

  function remove(key) {
    assertSubstrateSmKey(key, 'recipe');
    const entry = entries.get(key.signature);
    if (!entry || entry.references !== 0) return false;
    removeEntry(entry);
    return true;
  }

  function clear() {
    let removed = 0;
    for (const entry of entries.values()) {
      if (entry.references !== 0) continue;
      removeEntry(entry);
      removed += 1;
    }
    return removed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) removeEntry(entry);
    for (const owner of leaseOwners) ledger.release(owner);
    leaseOwners.clear();
  }

  function readStatistics() {
    return Object.freeze({
      disposed, residentRecipes: entries.size, numericBufferBytes: entries.size * SSM_RECIPE_BYTE_LENGTH,
      activeLeases: leaseOwners.size, hits, misses, evictions, refusals,
      memory: ledger.readStatistics(),
    });
  }

  return Object.freeze({ store, acquire, has, remove, clear, dispose, readStatistics, memoryLedger: ledger });
}
