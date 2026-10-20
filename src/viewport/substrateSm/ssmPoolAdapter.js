import { assertSubstrateSmKey, createSubstrateSmBatchKey } from "../../lighting/substrateSm/ssmRecipeKeys.js";
import { createSubstrateSmPoolBatchRegistry } from "./ssmPoolBatchRegistry.js";
import { createSubstrateSmPoolMaterialBindings } from "./ssmPoolMaterialBindings.js";

function poolMeshes(pool) {
  return [pool.mesh, ...(pool.extras || [])];
}

export function createSubstrateSmPoolAdapter({
  THREE, resolveRecipe, createMaterialAdapter, ledger,
  baselineDrawCalls, maxBatches = 256, maxPromotions = 64,
} = {}) {
  if (typeof resolveRecipe !== "function") throw new TypeError("A canonical recipe resolver is required");
  if (!Number.isSafeInteger(maxPromotions) || maxPromotions < 0 || maxPromotions > 128) {
    throw new RangeError("The promotion limit must be between zero and 128");
  }
  const registry = createSubstrateSmPoolBatchRegistry({ ledger, baselineDrawCalls, maxBatches });
  const bindings = createSubstrateSmPoolMaterialBindings({ THREE, createMaterialAdapter });
  const records = new Map();
  const promotions = new Set();
  let disposed = false;
  let preparing = false;
  let lastRefusal = null;

  function refusal(reason) {
    lastRefusal = reason;
    return Object.freeze({ ok: false, reason });
  }

  function resolve(record, hostBatchKey) {
    if (disposed) return refusal("SSM_POOL_ADAPTER_DISPOSED");
    try {
      const recipe = resolveRecipe(record);
      if (recipe == null) return Object.freeze({ ok: true, key: hostBatchKey, recipeKey: null, request: null });
      if (typeof createMaterialAdapter !== "function") return refusal("SSM_POOL_BINDING_UNAVAILABLE");
      assertSubstrateSmKey(recipe.recipeKey, "recipe");
      if (!recipe.request || typeof recipe.request !== "object" || !Object.isFrozen(recipe.request)) {
        return refusal("SSM_POOL_IMMUTABLE_REQUEST_REQUIRED");
      }
      const batchKey = createSubstrateSmBatchKey({ hostBatchKey, recipeKey: recipe.recipeKey, resources: recipe.resources ?? [] });
      return Object.freeze({ ok: true, key: batchKey.signature, recipeKey: recipe.recipeKey, request: recipe.request });
    } catch {
      return refusal("SSM_POOL_RECIPE_RESOLUTION_FAILED");
    }
  }

  function hasRecipe(record) {
    const resolution = resolve(record, "admission");
    return resolution.ok && resolution.recipeKey !== null;
  }

  function preparePool(pool, resolution, replacingPool = null) {
    if (disposed || preparing) return refusal(disposed ? "SSM_POOL_ADAPTER_DISPOSED" : "SSM_POOL_REENTRANT_PREPARATION");
    if (!resolution?.ok) return refusal(resolution?.reason || "SSM_POOL_RESOLUTION_REQUIRED");
    const existing = records.get(pool);
    if (existing) return validatePool(pool, resolution);
    if (pool.palette && resolution.recipeKey) return refusal("SSM_POOL_PALETTE_DELEGATED");
    const meshes = poolMeshes(pool);
    preparing = true;
    try {
      const reservation = registry.reserve({ pool, resolution, drawCost: meshes.length, replacingPool });
      if (!reservation.ok) return refusal(reservation.reason);
      const lease = resolution.recipeKey
        ? bindings.prepare(meshes, resolution, { getMeshes: () => poolMeshes(pool) }) : null;
      if (disposed || (lease && !lease.ok)) {
        lease?.release?.();
        registry.release(pool);
        return refusal(lease?.reason || "SSM_POOL_ADAPTER_DISPOSED");
      }
      records.set(pool, { resolution, lease, materials: meshes.map(mesh => mesh.material) });
      return Object.freeze({ ok: true });
    } catch {
      registry.release(pool);
      return refusal("SSM_POOL_PREPARATION_FAILED");
    } finally {
      preparing = false;
    }
  }

  function validatePool(pool, resolution = records.get(pool)?.resolution) {
    const record = records.get(pool);
    if (disposed || !record) return refusal("SSM_POOL_NOT_BOUND");
    if (record.resolution.key !== resolution?.key || record.resolution.request !== resolution?.request) {
      return refusal("SSM_POOL_RECIPE_REQUEST_MISMATCH");
    }
    if (record.lease && !record.lease.isActive()) return refusal("SSM_POOL_BINDING_RELEASED");
    if (record.lease && (poolMeshes(pool).length !== record.materials.length
      || poolMeshes(pool).some((mesh, index) => mesh.material !== record.materials[index]))) {
      return refusal("SSM_POOL_MATERIAL_REPLACED");
    }
    return Object.freeze({ ok: true });
  }

  function releasePool(pool) {
    const record = records.get(pool);
    if (!record) return false;
    records.delete(pool);
    record.lease?.release();
    registry.release(pool);
    return true;
  }

  function preparePromotion(pool, meshes) {
    const valid = validatePool(pool);
    if (!valid.ok) return valid;
    const record = records.get(pool);
    if (!record.resolution.recipeKey) return refusal("SSM_PROMOTION_LEGACY_DELEGATED");
    if (preparing) return refusal("SSM_POOL_REENTRANT_PREPARATION");
    if (!Array.isArray(meshes) || meshes.length !== record.materials.length) {
      return refusal("SSM_PROMOTION_SUBMESH_LAYOUT_MISMATCH");
    }
    if (promotions.size >= maxPromotions) return refusal("SSM_PROMOTION_LIMIT_EXCEEDED");
    const owner = {};
    const cost = { residentRecipes: 0, numericBufferBytes: 0, cpuCacheBytes: 128 + meshes.length * 128 };
    if (!ledger.reserve(owner, cost)) return refusal("SSM_PROMOTION_MEMORY_BUDGET_EXCEEDED");
    preparing = true;
    let lease;
    try {
      lease = bindings.prepare(meshes, record.resolution, { promoted: true });
    } catch {
      ledger.release(owner);
      return refusal("SSM_PROMOTION_PREPARATION_FAILED");
    } finally {
      preparing = false;
    }
    if (!lease.ok || disposed) {
      lease.release?.();
      ledger.release(owner);
      return refusal(lease.reason || "SSM_POOL_ADAPTER_DISPOSED");
    }
    let released = false;
    const materials = [...new Set(meshes.map(mesh => mesh.material))];
    const promotion = Object.freeze({
      ok: true, recipeKey: record.resolution.recipeKey,
      isActive: () => !released && lease.isActive(),
      release() {
        if (released) return false;
        released = true;
        promotions.delete(promotion);
        for (const material of materials) material.removeEventListener("dispose", promotion.release);
        lease.release();
        ledger.release(owner);
        return true;
      },
    });
    for (const material of materials) material.addEventListener("dispose", promotion.release);
    promotions.add(promotion);
    return promotion;
  }

  function permitsHostMaterialChange() {
    for (const record of records.values()) {
      if (record.resolution.recipeKey) {
        refusal("SSM_POOL_HOST_CHANGE_REQUIRES_REBUILD");
        return false;
      }
    }
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const promotion of [...promotions]) promotion.release();
    for (const pool of records.keys()) releasePool(pool);
    bindings.dispose();
    registry.dispose();
  }

  function getState() {
    return Object.freeze({
      ...registry.getState(), disposed, promotions: promotions.size,
      materials: bindings.getState().materials, cleanupFailures: bindings.getState().cleanupFailures,
      lastRefusal, autoEnabled: false,
    });
  }

  return Object.freeze({
    resolve, hasRecipe, preparePool, validatePool, releasePool,
    preparePromotion, permitsHostMaterialChange, getState, dispose,
  });
}
