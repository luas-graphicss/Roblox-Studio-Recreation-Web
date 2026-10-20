import { LENS_FLARE_OWNER, MAX_RETAINED_VIEWS } from "./lensFlareContract.js";

export function createLensFlareGpuResources(adapter, pool) {
  const materials = new Map();
  const views = new Map();
  let disposed = false;
  let assetKey = null;

  function releaseRecord(record) {
    for (const key of record.keys) pool.release(key);
    record.keys.clear();
  }

  function begin(frame, plan) {
    if (disposed) throw new Error("Lens flare GPU resources are disposed");
    if (adapter.context?.isContextLost?.()) throw new Error("CP-F16 WebGL context is lost");
    const signature = `${frame.generation}:${plan.width}:${plan.height}:${plan.workingWidth}:${plan.workingHeight}:${plan.active}`;
    let record = views.get(frame.viewId);
    if (record && record.signature !== signature) releaseRecord(record);
    if (!record) {
      if (views.size >= MAX_RETAINED_VIEWS) {
        const oldest = views.keys().next().value;
        releaseRecord(views.get(oldest));
        views.delete(oldest);
      }
      record = { keys: new Set(), signature };
    }
    record.signature = signature;
    record.active = plan.active;
    views.delete(frame.viewId);
    views.set(frame.viewId, record);
    if (![...views.values()].some((view) => view.active)) {
      pool.release(`${LENS_FLARE_OWNER}.bokehAsset`);
      assetKey = null;
    }
    return (name, width, height, format = "rgba16f") => {
      const key = `${LENS_FLARE_OWNER}.${encodeURIComponent(frame.viewId)}.${name}`;
      const target = pool.acquire(LENS_FLARE_OWNER, key, { width, height, format, filter: "nearest", depth: false });
      record.keys.add(key);
      return target;
    };
  }

  function acquireBokeh(width, height) {
    const key = `${LENS_FLARE_OWNER}.bokehAsset`;
    if (assetKey && assetKey !== `${width}:${height}`) pool.release(key);
    assetKey = `${width}:${height}`;
    return pool.acquire(LENS_FLARE_OWNER, key, { width, height, format: "rgba16f", filter: "nearest", depth: false });
  }

  function draw(name, fragment, values, target) {
    if (disposed) throw new Error("Lens flare GPU resources are disposed");
    for (const value of Object.values(values)) if (value === target.texture) throw new Error("CP-F16 attempted texture read/write feedback");
    let material = materials.get(name);
    if (!material) {
      material = adapter.createMaterial(fragment, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])));
      materials.set(name, material);
    }
    for (const [key, value] of Object.entries(values)) material.uniforms[key].value = value;
    adapter.draw(material, target);
    if (adapter.errors?.().length) throw new Error("CP-F16 shader compilation failed");
    return target;
  }

  function reset() {
    for (const record of views.values()) releaseRecord(record);
    views.clear();
    pool.release(`${LENS_FLARE_OWNER}.bokehAsset`);
    assetKey = null;
    for (const material of materials.values()) material.dispose();
    materials.clear();
  }

  return Object.freeze({
    begin, acquireBokeh, draw, reset,
    materialCount: () => materials.size,
    retainedViews: () => views.size,
    dispose() { if (disposed) return; reset(); disposed = true; }
  });
}
