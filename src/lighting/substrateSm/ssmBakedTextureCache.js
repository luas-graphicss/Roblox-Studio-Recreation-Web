import { assertSubstrateSmKey } from './ssmRecipeKeys.js';
import { requireSubstrateSmByteCount, sumSubstrateSmBytes } from './ssmTextureFootprint.js';

export function createSubstrateSmBakedTextureCache({ memoryLedger } = {}) {
  if (!memoryLedger?.recipeMemoryLedger) throw new TypeError('A shared texture memory ledger is required');
  const entries = new Map();
  const preparing = new Map();
  let disposed = false;
  let hits = 0;
  let refusals = 0;

  function address(key, contextGeneration) {
    assertSubstrateSmKey(key, 'recipe');
    if (!Number.isSafeInteger(contextGeneration) || contextGeneration < 0) throw new TypeError('Context generation is required');
    return `${contextGeneration}:${key.signature}`;
  }

  function residentCost(entry, references) {
    return { textureBytes: sumSubstrateSmBytes(entry.resource.cpuBytes, entry.resource.gpuBytes),
      cpuBytes: sumSubstrateSmBytes(entry.metadataBytes, entry.resource.cpuBytes, references * 128) };
  }

  function lease(entry) {
    if (disposed || entry.removed || !memoryLedger.reserve(entry.owner, residentCost(entry, entry.references + 1))) return null;
    entry.references += 1;
    let released = false;
    return Object.freeze({
      key: entry.key, contextGeneration: entry.contextGeneration,
      resource: entry.resource.texture,
      isValid: () => !released && !entry.removed && !disposed,
      release() {
        if (released) return false;
        released = true;
        entry.references -= 1;
        if (!entry.removed) memoryLedger.reserve(entry.owner, residentCost(entry, entry.references));
        return true;
      },
    });
  }

  function acquire(key, contextGeneration) {
    const entry = entries.get(address(key, contextGeneration));
    if (!entry || disposed) return null;
    const result = lease(entry);
    if (result) hits += 1;
    return result;
  }

  function reserve(key, contextGeneration, memory) {
    const identity = address(key, contextGeneration);
    if (disposed || entries.has(identity) || preparing.has(identity)) return null;
    for (const field of ['cpuPeakBytes', 'incrementalPeakBytes', 'derivedCpuBytes', 'derivedGpuBytes']) {
      requireSubstrateSmByteCount(memory?.[field], field);
    }
    const metadataBytes = 2048 + identity.length * 2;
    const owner = {};
    const peak = { textureBytes: memory.incrementalPeakBytes, cpuBytes: sumSubstrateSmBytes(memory.cpuPeakBytes, metadataBytes, 128) };
    if (memory.derivedCpuBytes === 0 || memory.derivedCpuBytes !== memory.derivedGpuBytes
      || peak.textureBytes < memory.derivedCpuBytes + memory.derivedGpuBytes
      || memory.cpuPeakBytes < memory.derivedCpuBytes) throw new RangeError('Incomplete texture peak accounting');
    if (!memoryLedger.reserve(owner, peak)) { refusals += 1; return null; }
    let settled = false;
    const ticket = Object.freeze({
      cancel() {
        if (settled) return false;
        settled = true;
        preparing.delete(identity);
        memoryLedger.release(owner);
        return true;
      },
      publish(resource) {
        if (settled || disposed) return null;
        if (!resource || resource.uploadComplete !== true || typeof resource.dispose !== 'function'
          || !resource.texture || resource.cpuBytes !== memory.derivedCpuBytes
          || resource.gpuBytes !== memory.derivedGpuBytes) throw new TypeError('Published textures must be complete and match the admitted bytes');
        const entry = { owner, key, contextGeneration, identity, metadataBytes, resource, references: 0, removed: false };
        const result = lease(entry);
        if (!result) return null;
        settled = true;
        preparing.delete(identity);
        entries.set(identity, entry);
        return result;
      },
    });
    preparing.set(identity, ticket);
    return ticket;
  }

  function removeEntry(entry) {
    if (!entry || entry.references !== 0) return false;
    entry.removed = true;
    entries.delete(entry.identity);
    try { entry.resource.dispose(); } finally { memoryLedger.release(entry.owner); }
    return true;
  }

  function clearUnused() {
    let removed = 0;
    for (const entry of entries.values()) if (removeEntry(entry)) removed += 1;
    return removed;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const entry of entries.values()) entry.removed = true;
    const errors = [];
    for (const entry of entries.values()) {
      try { entry.resource.dispose(); } catch (error) { errors.push(error); }
      memoryLedger.release(entry.owner);
    }
    entries.clear();
    if (errors.length) throw new AggregateError(errors, 'Texture cache cleanup failed');
  }

  return Object.freeze({
    memoryLedger, acquire, reserve, clearUnused, dispose,
    readStatistics: () => Object.freeze({ disposed, entries: entries.size, preparing: preparing.size, hits, refusals,
      references: [...entries.values()].reduce((sum, entry) => sum + entry.references, 0), memory: memoryLedger.readStatistics() }),
  });
}
