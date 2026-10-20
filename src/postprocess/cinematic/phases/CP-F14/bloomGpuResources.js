import { BLOOM_OWNER } from "./bloomSettings.js";

export function createBloomGpuResources(pool, adapter) {
  const materials = new Map();
  const views = new Map();
  let disposed = false;

  function releaseView(record) {
    for (const key of record.keys) pool.release(key);
    record.keys.clear();
  }

  function begin(frame, source, plan) {
    if (disposed) throw new Error("Bloom GPU resources are disposed");
    const signature = `${source.width}:${source.height}:${frame.generation}:${plan.active}:${plan.levels.length}`;
    let record = views.get(frame.viewId);
    if (!record) {
      record = { signature, keys: new Set() };
      views.set(frame.viewId, record);
    } else if (record.signature !== signature) {
      releaseView(record);
      record.signature = signature;
    }
    return (name, width, height, format = "rgba16f") => {
      const key = `${BLOOM_OWNER}.${encodeURIComponent(frame.viewId)}.${name}`;
      const target = pool.acquire(BLOOM_OWNER, key, { width, height, format, filter: "nearest", depth: false });
      record.keys.add(key);
      return target;
    };
  }

  function draw(name, shader, values, target) {
    if (disposed) throw new Error("Bloom GPU resources are disposed");
    let material = materials.get(name);
    if (!material) {
      material = adapter.createMaterial(shader, Object.fromEntries(Object.keys(values).map((key) => [key, { value: values[key] }])));
      materials.set(name, material);
    }
    for (const [key, value] of Object.entries(values)) {
      if (value?.isTexture && value === target.texture) throw new Error("Bloom attempted GPU texture feedback");
      material.uniforms[key].value = value;
    }
    adapter.draw(material, target);
    const errors = adapter.errors?.() ?? [];
    if (errors.length) throw new Error(`CP-F14 shader compilation failed: ${JSON.stringify(errors.at(-1))}`);
    return target;
  }

  return Object.freeze({
    begin,
    draw,
    materialCount: () => materials.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of views.values()) releaseView(record);
      views.clear();
      for (const material of materials.values()) material.dispose();
      materials.clear();
    }
  });
}
