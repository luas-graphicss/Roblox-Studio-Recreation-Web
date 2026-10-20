const PROFILE_GROWTH_PERCENT = Object.freeze({ Lite: 10, Moderate: 15 });

function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

export function createSubstrateSmPoolBatchRegistry({ ledger, baselineDrawCalls, maxBatches = 256 } = {}) {
  const growthPercent = PROFILE_GROWTH_PERCENT[ledger?.profile];
  if (growthPercent === undefined || typeof ledger?.reserve !== "function"
    || typeof ledger?.release !== "function") {
    throw new TypeError("The shared SSM recipe memory ledger is required");
  }
  if (!Number.isSafeInteger(baselineDrawCalls) || baselineDrawCalls < 1
    || baselineDrawCalls > 1000000 || !Number.isSafeInteger(maxBatches)
    || maxBatches < 1 || maxBatches > 256) {
    throw new RangeError("A measured baseline and a bounded pool limit are required");
  }
  const maxDrawCalls = Math.floor(baselineDrawCalls * (100 + growthPercent) / 100);
  const entries = new Map();
  let disposed = false;

  function liveDrawCalls(excludedPool = null, includePending = false) {
    let total = 0;
    for (const entry of entries.values()) {
      if (entry.pool !== excludedPool && (includePending || entry.pool.count > 0)) total += entry.drawCost;
    }
    return total;
  }

  function reserve({ pool, resolution, drawCost, replacingPool = null }) {
    if (disposed) return refusal("SSM_BATCH_REGISTRY_DISPOSED");
    if (entries.has(pool)) return refusal("SSM_BATCH_ALREADY_RESERVED");
    if (!Number.isSafeInteger(drawCost) || drawCost < 1 || drawCost > 12) {
      return refusal("SSM_BATCH_DRAW_COST_INVALID");
    }
    if (entries.size >= maxBatches) return refusal("SSM_BATCH_LIMIT_EXCEEDED");
    const outgoingPool = replacingPool?.count === 1 ? replacingPool : null;
    if (liveDrawCalls(outgoingPool, true) + drawCost > maxDrawCalls) {
      return refusal("SSM_BATCH_DRAW_BUDGET_EXCEEDED");
    }
    const recipeSignatures = new Set();
    for (const entry of entries.values()) {
      if (entry.resolution.recipeKey) recipeSignatures.add(entry.resolution.recipeKey.signature);
    }
    if (resolution.recipeKey) recipeSignatures.add(resolution.recipeKey.signature);
    if (recipeSignatures.size > ledger.limits.residentRecipes) {
      return refusal("SSM_BATCH_RECIPE_LIMIT_EXCEEDED");
    }
    const cost = {
      residentRecipes: 0,
      numericBufferBytes: 0,
      cpuCacheBytes: 256 + resolution.key.length * 2
        + (resolution.recipeKey?.signature.length ?? 0) * 2 + drawCost * 128,
    };
    const owner = {};
    if (!ledger.reserve(owner, cost)) return refusal("SSM_BATCH_MEMORY_BUDGET_EXCEEDED");
    entries.set(pool, { pool, resolution, drawCost, owner });
    return Object.freeze({ ok: true });
  }

  function release(pool) {
    const entry = entries.get(pool);
    if (!entry) return false;
    entries.delete(pool);
    ledger.release(entry.owner);
    return true;
  }

  function getState() {
    const recipes = new Set();
    for (const entry of entries.values()) {
      if (entry.resolution.recipeKey) recipes.add(entry.resolution.recipeKey.signature);
    }
    return Object.freeze({
      disposed, batches: entries.size, recipes: recipes.size,
      drawCalls: liveDrawCalls(), reservedDrawCalls: liveDrawCalls(null, true), baselineDrawCalls, maxDrawCalls, maxBatches,
      growthPercent, accounting: "Borrowed F07 recipes; owned batch metadata only",
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const pool of entries.keys()) release(pool);
  }

  return Object.freeze({ reserve, release, getState, dispose });
}
