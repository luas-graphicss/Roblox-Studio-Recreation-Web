import { inspectSubstrateSmPoolHost } from "./ssmPoolHostPolicy.js";

function refusal(reason) {
  return Object.freeze({ ok: false, reason });
}

export function createSubstrateSmPoolMaterialBindings({ THREE, createMaterialAdapter } = {}) {
  const owners = new Map();
  let disposed = false;
  let preparing = false;
  let cleanupFailures = 0;

  function disposeAdapter(adapter) {
    try {
      adapter?.dispose?.();
    } catch {
      cleanupFailures += 1;
    }
  }

  function prepare(meshes, resolution, { promoted = false, getMeshes = () => meshes } = {}) {
    if (disposed) return refusal("SSM_POOL_BINDINGS_DISPOSED");
    if (preparing) return refusal("SSM_POOL_REENTRANT_PREPARATION");
    if (typeof createMaterialAdapter !== "function") return refusal("SSM_POOL_BINDING_UNAVAILABLE");
    if (!Array.isArray(meshes) || meshes.length < 1 || meshes.length > 12) {
      return refusal("SSM_POOL_MESH_LIST_INVALID");
    }
    const hosts = [];
    const uniqueMaterials = new Set();
    for (const mesh of meshes) {
      const host = inspectSubstrateSmPoolHost(mesh, { promoted });
      if (!host.ok) return host;
      if (owners.has(mesh.material)) return refusal("SSM_POOL_MATERIAL_OWNERSHIP_CONFLICT");
      if (uniqueMaterials.has(mesh.material)) continue;
      uniqueMaterials.add(mesh.material);
      const index = meshes.indexOf(mesh);
      hosts.push({ mesh, material: mesh.material, materialPath: host.materialPath, getMesh: () => getMeshes()[index] });
    }
    const adapters = [];
    const materials = [];
    let released = false;
    let invalidated = false;

    function release() {
      if (released) return false;
      released = true;
      for (const material of materials) {
        material.removeEventListener("dispose", onMaterialDispose);
        owners.delete(material);
      }
      for (const adapter of adapters) disposeAdapter(adapter);
      return true;
    }

    function onMaterialDispose() {
      invalidated = true;
      release();
    }

    preparing = true;
    try {
      for (const host of hosts) {
        const adapter = createMaterialAdapter({ THREE, ...host });
        if (typeof adapter?.prepare !== "function" || typeof adapter?.dispose !== "function") {
          disposeAdapter(adapter);
          release();
          return refusal("SSM_POOL_BINDING_CONTRACT_REQUIRED");
        }
        adapters.push(adapter);
        materials.push(host.material);
        host.material.addEventListener("dispose", onMaterialDispose);
        const result = adapter.prepare(resolution.request);
        const asynchronous = typeof result?.then === "function";
        if (asynchronous) Promise.resolve(result).catch(() => {});
        if (disposed || invalidated || host.mesh.material !== host.material
          || result?.ok !== true || result.applied !== true || asynchronous) {
          release();
          return refusal(result?.reason || "SSM_POOL_BINDING_NOT_COMMITTED");
        }
      }
      const lease = Object.freeze({ ok: true, release, isActive: () => !released });
      for (const material of materials) owners.set(material, lease);
      return lease;
    } catch {
      release();
      return refusal("SSM_POOL_BINDING_PREPARATION_FAILED");
    } finally {
      preparing = false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const lease of new Set(owners.values())) lease.release();
  }

  return Object.freeze({
    prepare, dispose,
    getState: () => Object.freeze({ disposed, materials: owners.size, cleanupFailures }),
  });
}
