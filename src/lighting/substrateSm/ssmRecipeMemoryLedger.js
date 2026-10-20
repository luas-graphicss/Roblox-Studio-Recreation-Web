import { SSM_PROFILES } from './ssmContract.js';

const SSM_MEMORY_FIELDS = Object.freeze(['residentRecipes', 'numericBufferBytes', 'cpuCacheBytes']);
const SSM_STORAGE_LIMIT_FIELDS = Object.freeze([
  ...SSM_MEMORY_FIELDS, 'uploadRecordsPerSlice', 'uploadBytesPerSlice',
]);

function validateCost(cost) {
  for (const name of SSM_MEMORY_FIELDS) {
    if (!Number.isSafeInteger(cost[name]) || cost[name] < 0) throw new RangeError(`Invalid SSM memory cost: ${name}`);
  }
}

export function createSubstrateSmRecipeMemoryLedger({ profile = 'Lite', limits = {} } = {}) {
  if (!Object.hasOwn(SSM_PROFILES, profile)) throw new TypeError('Unknown SSM storage profile');
  for (const name of Object.keys(limits)) {
    if (!SSM_STORAGE_LIMIT_FIELDS.includes(name)) throw new TypeError(`Unknown SSM storage limit: ${name}`);
  }
  const ceilings = {};
  for (const name of SSM_STORAGE_LIMIT_FIELDS) {
    const ceiling = SSM_PROFILES[profile].limits[name];
    const requested = limits[name] === undefined ? ceiling : limits[name];
    if (!Number.isSafeInteger(requested) || requested < 0 || requested > ceiling) {
      throw new RangeError(`SSM storage limit exceeds ${profile}: ${name}`);
    }
    ceilings[name] = requested;
  }
  Object.freeze(ceilings);
  const allocations = new Map();
  const totals = { residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes: 0 };

  function canReserve(owner, cost, releasedOwners = []) {
    validateCost(cost);
    if (owner === null || owner === undefined || cost.cpuCacheBytes < 32) {
      throw new TypeError('SSM reservations require an owner and explicit CPU accounting');
    }
    const previous = allocations.get(owner);
    const released = new Set(releasedOwners);
    released.delete(owner);
    for (const field of SSM_MEMORY_FIELDS) {
      let next = totals[field] - (previous?.[field] ?? 0) + cost[field];
      for (const releasedOwner of released) next -= allocations.get(releasedOwner)?.[field] ?? 0;
      if (next > ceilings[field]) return false;
    }
    return true;
  }

  function release(owner) {
    const cost = allocations.get(owner);
    if (!cost) return false;
    for (const field of SSM_MEMORY_FIELDS) totals[field] -= cost[field];
    allocations.delete(owner);
    return true;
  }

  function reserve(owner, cost, releasedOwners = []) {
    if (!canReserve(owner, cost, releasedOwners)) return false;
    for (const releasedOwner of releasedOwners) release(releasedOwner);
    release(owner);
    const storedCost = Object.freeze({
      residentRecipes: cost.residentRecipes,
      numericBufferBytes: cost.numericBufferBytes,
      cpuCacheBytes: cost.cpuCacheBytes,
    });
    allocations.set(owner, storedCost);
    for (const field of SSM_MEMORY_FIELDS) totals[field] += storedCost[field];
    return true;
  }

  function readStatistics() {
    return Object.freeze({
      profile, limits: ceilings, ...totals, allocations: allocations.size,
      accountingModel: 'payload-bytes-plus-utf16-and-explicit-overhead-v1',
    });
  }

  return Object.freeze({ profile, limits: ceilings, canReserve, reserve, release, readStatistics });
}
