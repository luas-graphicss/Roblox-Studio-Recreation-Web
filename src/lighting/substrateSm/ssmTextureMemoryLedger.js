import { getSubstrateSmProfile } from './ssmContract.js';
import { requireSubstrateSmByteCount } from './ssmTextureFootprint.js';

export function createSubstrateSmTextureMemoryLedger({ recipeMemoryLedger, textureLimitBytes } = {}) {
  const profile = getSubstrateSmProfile(recipeMemoryLedger?.profile);
  if (!profile || typeof recipeMemoryLedger.reserve !== 'function') throw new TypeError('A shared F07 recipe memory ledger is required');
  const hardLimit = profile.limits.derivedTexturePeakBytes;
  const limit = textureLimitBytes === undefined ? hardLimit : requireSubstrateSmByteCount(textureLimitBytes, 'textureLimitBytes');
  if (limit > hardLimit) throw new RangeError('Derived texture limits may only be reduced');
  const allocations = new Map();
  let textureBytes = 0;
  let highWaterBytes = 0;

  function reserve(owner, cost) {
    if (!owner || !cost) throw new TypeError('Texture reservations require identity and cost');
    requireSubstrateSmByteCount(cost.textureBytes, 'textureBytes');
    requireSubstrateSmByteCount(cost.cpuBytes, 'cpuBytes');
    if (cost.cpuBytes < 32) throw new RangeError('Texture metadata must be accounted explicitly');
    const previous = allocations.get(owner);
    const next = textureBytes - (previous?.textureBytes ?? 0) + cost.textureBytes;
    if (!Number.isSafeInteger(next) || next > limit) return false;
    if (!recipeMemoryLedger.reserve(owner, { residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes: cost.cpuBytes })) return false;
    allocations.set(owner, Object.freeze({ ...cost }));
    textureBytes = next;
    highWaterBytes = Math.max(highWaterBytes, next);
    return true;
  }

  function release(owner) {
    const previous = allocations.get(owner);
    if (!previous) return false;
    allocations.delete(owner);
    textureBytes -= previous.textureBytes;
    recipeMemoryLedger.release(owner);
    return true;
  }

  return Object.freeze({
    profile: recipeMemoryLedger.profile, limitBytes: limit, reserve, release,
    recipeMemoryLedger,
    readStatistics: () => Object.freeze({ textureBytes, highWaterBytes, allocations: allocations.size, limitBytes: limit,
      cpu: recipeMemoryLedger.readStatistics() }),
  });
}
