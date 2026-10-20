import { MATERIAL_OWNER } from "./materialContract.js";

export function createMaterialTargetStore(pool, materialId, maximumViews = 8) {
  const views = new Map();
  let disposed = false;
  return Object.freeze({
    acquire(frame, descriptor, suffix = "output") {
      if (disposed) throw new Error("Material target store is disposed");
      if (!views.has(frame.viewId) && views.size >= maximumViews) throw new Error("Material view capacity exceeded; release inactive views");
      const key = `${MATERIAL_OWNER}.${materialId}.${encodeURIComponent(frame.viewId)}.${suffix}`;
      let record = views.get(frame.viewId);
      if (record && record.generation !== frame.generation) {
        for (const ownedKey of record.keys) pool.release(ownedKey);
        views.delete(frame.viewId);
        record = null;
      }
      if (!record) { record = { generation: frame.generation, keys: new Set() }; views.set(frame.viewId, record); }
      const target = pool.acquire(MATERIAL_OWNER, key, descriptor);
      record.keys.add(key);
      return target;
    },
    releaseView(viewId) {
      const record = views.get(viewId);
      if (!record) return;
      for (const key of record.keys) pool.release(key);
      views.delete(viewId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of views.values()) for (const key of record.keys) pool.release(key);
      views.clear();
    }
  });
}
