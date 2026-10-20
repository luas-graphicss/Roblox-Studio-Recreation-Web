import { DIRT_OWNER } from "./dirtMaskContract.js";
import { DIRT_MASK_FRAGMENT } from "./dirtMaskShader.js";
import { createDirtMaskTextureCache } from "./dirtMaskTextureCache.js";

export function createDirtMaskGpu(services) {
  const { rendererAdapter: adapter, pool, capabilities } = services;
  if (capabilities?.webgl2 !== true || capabilities.floatColorBuffer !== true) throw new Error("CP-F17 requires WebGL2 floating-point targets; no byte fallback");
  if (!Number.isInteger(capabilities.maxTextureUnits) || capabilities.maxTextureUnits < 4) throw new Error("CP-F17 requires at least four explicitly reported texture units");
  if (!Number.isInteger(capabilities.maxTextureSize) || capabilities.maxTextureSize < 1) throw new Error("CP-F17 requires an explicit positive maxTextureSize");
  const masks = createDirtMaskTextureCache(adapter);
  const views = new Map();
  let material;
  let disposed = false;
  let deviceInvalidated = false;

  function deviceIsInvalid() {
    if (adapter.context?.isContextLost?.()) deviceInvalidated = true;
    return deviceInvalidated;
  }

  function draw(source, frame, settings, mapping, glareInputs, active) {
    if (disposed) throw new Error("CP-F17 GPU is disposed");
    if (deviceIsInvalid()) throw new Error("CP-F17 graphics context was lost; reinstall the phase after restoration");
    if (Math.max(source.width, source.height) > capabilities.maxTextureSize) throw new RangeError("CP-F17 output exceeds maxTextureSize");
    const mask = active ? masks.acquire(settings.mask) : null;
    const emptyGlare = { texture: source.texture, textureSize: [1, 1], sourceSize: [1, 1], padding: [0, 0], gain: 0 };
    const firstGlare = glareInputs[0] ?? emptyGlare;
    const secondGlare = glareInputs[1] ?? emptyGlare;
    const values = {
      sourceTexture: source.texture, maskTexture: mask?.texture ?? source.texture,
      maskSize: mask ? [settings.mask.width, settings.mask.height] : [1, 1],
      maskScale: mapping?.scale ?? [1, 1], outputRect: settings.outputRect,
      dirtTint: settings.tint, dirtIntensity: settings.intensity, dirtEnabled: active, writeRangeMask: false,
      firstGlareTexture: firstGlare.texture, firstGlareTextureSize: firstGlare.textureSize, firstGlareSourceSize: firstGlare.sourceSize, firstGlarePadding: firstGlare.padding, firstGlareGain: firstGlare.gain,
      secondGlareTexture: secondGlare.texture, secondGlareTextureSize: secondGlare.textureSize, secondGlareSourceSize: secondGlare.sourceSize, secondGlarePadding: secondGlare.padding, secondGlareGain: secondGlare.gain
    };
    if (!material) material = adapter.createMaterial(DIRT_MASK_FRAGMENT, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])));
    for (const [key, value] of Object.entries(values)) material.uniforms[key].value = value;
    const prefix = `${DIRT_OWNER}.${encodeURIComponent(frame.viewId)}`;
    let record = views.get(frame.viewId);
    if (!record) {
      if (views.size >= 4) {
        const oldestViewId = views.keys().next().value;
        const oldest = views.get(oldestViewId);
        oldest.serial += 1;
        pool.release(`${oldest.prefix}.color`);
        pool.release(`${oldest.prefix}.rangeMask`);
        views.delete(oldestViewId);
      }
      record = { serial: 0, prefix, width: source.width, height: source.height };
    }
    views.delete(frame.viewId);
    views.set(frame.viewId, record);
    const serial = ++record.serial;
    const color = pool.acquire(DIRT_OWNER, `${prefix}.color`, { width: source.width, height: source.height, format: "rgba16f", filter: "nearest", depth: false });
    const rangeMask = pool.acquire(DIRT_OWNER, `${prefix}.rangeMask`, { width: source.width, height: source.height, format: "r16f", filter: "nearest", depth: false });
    for (const target of [color, rangeMask]) {
      if ([source.texture, mask?.texture, ...glareInputs.map((input) => input.texture)].includes(target.texture)) throw new Error("CP-F17 texture feedback refused");
    }
    material.uniforms.writeRangeMask.value = true;
    adapter.draw(material, rangeMask);
    material.uniforms.writeRangeMask.value = false;
    adapter.draw(material, color);
    if ((adapter.errors?.() ?? []).length) throw new Error("CP-F17 shader compilation failed");
    record.width = source.width;
    record.height = source.height;
    return { color, rangeMask, isAlive: () => !disposed && !deviceIsInvalid() && views.get(frame.viewId) === record && record.serial === serial, cache: masks.stats() };
  }

  return Object.freeze({
    draw,
    stats: () => ({ views: views.size, materials: material ? 1 : 0, declaredTargetBytes: [...views.values()].reduce((sum, view) => sum + view.width * view.height * 10, 0), maskCache: masks.stats() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      material?.dispose();
      masks.dispose();
      for (const record of views.values()) {
        record.serial += 1;
        pool.release(`${record.prefix}.color`);
        pool.release(`${record.prefix}.rangeMask`);
      }
      views.clear();
    }
  });
}
