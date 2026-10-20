import { areSubstrateSmKeysEqual, assertSubstrateSmKey } from "../../lighting/substrateSm/ssmRecipeKeys.js";
import { inspectSubstrateSmPhongHost } from "./ssmPhongHostPolicy.js";
import { createSubstrateSmPhongMaterialAdapter } from "./ssmPhongMaterialAdapter.js";

export const SSM_SIMPLE_POOL_ADAPTER_VERSION = 2;

function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

function validRecipeKey(recipeKey) {
  try {
    assertSubstrateSmKey(recipeKey, "recipe");
    return true;
  } catch {
    return false;
  }
}

function stagedSuccessfully(prepared) {
  return prepared?.ok === true && typeof prepared.then !== "function";
}

function promotedRequest(request) {
  return Object.freeze({ ...request, routing: Object.freeze({ ...request.routing, materialPath: "phong" }) });
}

function inspectBoundHost(adapter, mesh) {
  return typeof adapter?.inspectHost === "function" ? adapter.inspectHost(mesh) : inspectSubstrateSmPhongHost(mesh);
}

export function createSubstrateSmSimplePoolAdapter({ THREE, createMaterialAdapter = createSubstrateSmPhongMaterialAdapter } = {}) {
  if (typeof createMaterialAdapter !== "function") {
    throw new TypeError("A Phong material adapter factory is required");
  }

  const recordsByMaterial = new Map();
  const recordsByMesh = new Map();
  const promotionsByMaterial = new Map();
  let disposed = false;

  function prepareAdapter({ mesh, materialPath, request, getMesh }) {
    const adapter = createMaterialAdapter({ THREE, mesh, material: mesh.material, materialPath, getMesh });
    let prepared;
    try {
      prepared = adapter.prepare(request);
    } catch (error) {
      adapter.dispose();
      throw error;
    }
    if (!stagedSuccessfully(prepared)) {
      adapter.dispose();
      return refusal(prepared?.reason || "SSM_POOL_BINDING_NOT_STAGED");
    }
    return Object.freeze({ ok: true, adapter, prepared });
  }

  function releasePromotion(material) {
    const promotion = promotionsByMaterial.get(material);
    if (!promotion) return false;
    promotionsByMaterial.delete(material);
    promotion.record.promotions.delete(material);
    material.removeEventListener("dispose", promotion.onDispose);
    promotion.adapter.dispose();
    return true;
  }

  function releaseRecord(record) {
    recordsByMaterial.delete(record.material);
    for (const mesh of record.meshes) recordsByMesh.delete(mesh);
    record.meshes.clear();
    for (const material of [...record.promotions]) releasePromotion(material);
    record.material.removeEventListener("dispose", record.onDispose);
    record.adapter.dispose();
  }

  function bindPool({ mesh, recipeKey, request } = {}) {
    if (disposed) return refusal("SSM_POOL_ADAPTER_DISPOSED");
    if (!mesh?.isInstancedMesh || mesh.userData?.__rswPool !== true) {
      return refusal("SSM_SIMPLE_POOL_REQUIRED");
    }
    if (!validRecipeKey(recipeKey)) return refusal("SSM_POOL_RECIPE_KEY_REQUIRED");
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return refusal("SSM_POOL_REQUEST_REQUIRED");
    }
    const existingMeshRecord = recordsByMesh.get(mesh);
    if (existingMeshRecord && existingMeshRecord.material !== mesh.material) {
      return refusal("SSM_POOL_MATERIAL_REPLACED");
    }
    let record = recordsByMaterial.get(mesh.material);
    const host = inspectBoundHost(record?.adapter, mesh);
    if (!host.allowed) return refusal(host.code);
    if (record && !areSubstrateSmKeysEqual(record.recipeKey, recipeKey)) {
      return refusal("SSM_POOL_HETEROGENEOUS_RECIPE_DELEGATED");
    }
    if (record && record.request !== request) return refusal("SSM_POOL_REQUEST_UPDATE_REQUIRED");
    if (!record) {
      const pending = { material: mesh.material, recipeKey, request, adapter: null, meshes: new Set(), promotions: new Set(), onDispose: null, currentMesh: mesh };
      const staged = prepareAdapter({ mesh, materialPath: "poolPhong", request, getMesh: () => pending.currentMesh });
      if (!staged.ok) return staged;
      pending.adapter = staged.adapter;
      pending.onDispose = () => releaseRecord(pending);
      mesh.material.addEventListener("dispose", pending.onDispose);
      recordsByMaterial.set(mesh.material, pending);
      record = pending;
    }
    record.meshes.add(mesh);
    recordsByMesh.set(mesh, record);
    return Object.freeze({ ok: true, adapter: record.adapter, recipeKey: record.recipeKey, materialPath: "poolPhong" });
  }

  function promote({ poolMesh, mesh } = {}) {
    if (disposed) return refusal("SSM_POOL_ADAPTER_DISPOSED");
    const record = recordsByMesh.get(poolMesh);
    if (!record) return refusal("SSM_POOL_NOT_BOUND");
    const material = mesh?.material;
    const existing = promotionsByMaterial.get(material);
    if (existing && existing.record !== record) return refusal("SSM_PROMOTION_OWNERSHIP_CONFLICT");
    const host = inspectBoundHost(existing?.adapter, mesh);
    if (!host.allowed) return refusal(host.code);
    if (host.materialPath !== "phong" || material === record.material || recordsByMaterial.has(material)) {
      return refusal("SSM_PROMOTED_PHONG_REQUIRED");
    }
    if (existing) {
      if (!existing.parked) return Object.freeze({ ok: true, adapter: existing.adapter, recipeKey: record.recipeKey, materialPath: "phong" });
      const prepared = existing.adapter.prepare(promotedRequest(record.request));
      if (!stagedSuccessfully(prepared)) return refusal(prepared?.reason || "SSM_POOL_BINDING_NOT_STAGED");
      existing.parked = false;
      return Object.freeze({ ok: true, adapter: existing.adapter, recipeKey: record.recipeKey, materialPath: "phong" });
    }
    const staged = prepareAdapter({ mesh, materialPath: "phong", request: promotedRequest(record.request) });
    if (!staged.ok) return staged;
    const onDispose = () => releasePromotion(material);
    promotionsByMaterial.set(material, { record, adapter: staged.adapter, onDispose, parked: false });
    record.promotions.add(material);
    material.addEventListener("dispose", onDispose);
    return Object.freeze({ ok: true, adapter: staged.adapter, recipeKey: record.recipeKey, materialPath: "phong" });
  }

  function demote({ mesh } = {}) {
    if (disposed) return refusal("SSM_POOL_ADAPTER_DISPOSED");
    const promotion = promotionsByMaterial.get(mesh?.material);
    if (!promotion || promotion.parked) return refusal("SSM_DEMOTION_ACTIVE_PROMOTION_REQUIRED");
    promotion.adapter.disable("SSM_POOL_DEMOTED");
    promotion.parked = true;
    return Object.freeze({ ok: true });
  }

  function adapterFor(mesh) {
    const record = recordsByMesh.get(mesh);
    if (record) return record.adapter;
    const promotion = promotionsByMaterial.get(mesh?.material);
    return promotion && !promotion.parked ? promotion.adapter : null;
  }

  function confirmProgram({ mesh, renderer, requireSelected = true } = {}) {
    if (disposed) return refusal("SSM_POOL_ADAPTER_DISPOSED");
    const adapter = adapterFor(mesh);
    if (!adapter) return refusal("SSM_POOL_NOT_BOUND");
    return adapter.confirmProgram({ renderer, token: adapter.getState().token, requireSelected });
  }

  function inspect(mesh) {
    const adapter = adapterFor(mesh);
    return adapter ? adapter.getState() : null;
  }

  function unbindPool(mesh) {
    const record = recordsByMesh.get(mesh);
    if (!record) return false;
    recordsByMesh.delete(mesh);
    record.meshes.delete(mesh);
    if (record.meshes.size === 0) releaseRecord(record);
    return true;
  }

  function replacePoolMesh(previousMesh, nextMesh) {
    const record = recordsByMesh.get(previousMesh);
    if (!record) return refusal("SSM_POOL_NOT_BOUND");
    if (nextMesh?.material !== record.material) return refusal("SSM_POOL_MATERIAL_REPLACED");
    if (!nextMesh.isInstancedMesh || nextMesh.userData?.__rswPool !== true) return refusal("SSM_SIMPLE_POOL_REQUIRED");
    const host = inspectBoundHost(record.adapter, nextMesh);
    if (!host.allowed) return refusal(host.code);
    const previousCurrent = record.currentMesh;
    record.currentMesh = nextMesh;
    const prepared = record.adapter.prepare(record.request);
    if (!stagedSuccessfully(prepared)) {
      record.currentMesh = previousCurrent;
      return refusal(prepared?.reason || "SSM_POOL_BINDING_NOT_STAGED");
    }
    if (previousMesh !== nextMesh) {
      recordsByMesh.delete(previousMesh);
      record.meshes.delete(previousMesh);
    }
    record.meshes.add(nextMesh);
    recordsByMesh.set(nextMesh, record);
    return Object.freeze({ ok: true, adapter: record.adapter, recipeKey: record.recipeKey, materialPath: "poolPhong" });
  }

  function disable() {
    for (const record of [...recordsByMaterial.values()]) releaseRecord(record);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const record of [...recordsByMaterial.values()]) releaseRecord(record);
  }

  function getState() {
    let parked = 0;
    for (const promotion of promotionsByMaterial.values()) if (promotion.parked) parked += 1;
    return Object.freeze({
      version: SSM_SIMPLE_POOL_ADAPTER_VERSION, disposed,
      poolMaterials: recordsByMaterial.size, poolMeshes: recordsByMesh.size,
      promotedMaterials: promotionsByMaterial.size - parked, parkedPromotions: parked,
    });
  }

  return Object.freeze({ bindPool, promote, demote, releasePromotion, confirmProgram, inspect, unbindPool, replacePoolMesh, disable, dispose, getState });
}
