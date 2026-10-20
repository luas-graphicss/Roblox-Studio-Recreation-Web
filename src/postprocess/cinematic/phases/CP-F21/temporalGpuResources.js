import { TEMPORAL_RECONSTRUCTION_OWNER } from "./temporalSettings.js";

export function createTemporalGpuResources(pool, adapter) {
  const materials = new Map();
  const views = new Map();
  let disposed = false;

  function releaseView(viewId) {
    const record = views.get(viewId);
    if (!record) return;
    for (const key of record.keys) pool.release(key);
    views.delete(viewId);
  }

  function acquire(frame, name, size, format = "rgba16f") {
    if (disposed) throw new Error("CP-F21 resources are disposed");
    const signature = JSON.stringify([frame.generation, frame.renderSize, frame.outputSize]);
    if (views.get(frame.viewId)?.signature !== signature) releaseView(frame.viewId);
    if (!views.has(frame.viewId)) views.set(frame.viewId, { signature, keys: new Set() });
    const key = `CP-F21.${encodeURIComponent(frame.viewId)}.${name}`;
    const target = pool.acquire(TEMPORAL_RECONSTRUCTION_OWNER, key, { ...size, format, depth: false, filter: "nearest" });
    views.get(frame.viewId).keys.add(key);
    return target;
  }

  function draw(name, shader, values, target) {
    if (disposed) throw new Error("CP-F21 resources are disposed");
    let material = materials.get(name);
    if (!material) {
      material = adapter.createMaterial(shader, Object.fromEntries(Object.keys(values).map((key) => [key, { value: values[key] }])));
      materials.set(name, material);
    }
    for (const [key, value] of Object.entries(values)) {
      if (value === target.texture) throw new Error("CP-F21 attempted read/write texture feedback");
      material.uniforms[key].value = value;
    }
    try {
      adapter.draw(material, target);
      if (adapter.errors?.().length) throw new Error("CP-F21 shader compilation failed");
    } finally {
      for (const key of Object.keys(values)) if (values[key]?.isTexture) material.uniforms[key].value = null;
    }
    return target;
  }

  return Object.freeze({
    acquire,
    draw,
    releaseView,
    materialCount: () => materials.size,
    dispose() {
      if (disposed) return;
      for (const viewId of [...views.keys()]) releaseView(viewId);
      for (const material of materials.values()) material.dispose();
      materials.clear();
      disposed = true;
    }
  });
}
