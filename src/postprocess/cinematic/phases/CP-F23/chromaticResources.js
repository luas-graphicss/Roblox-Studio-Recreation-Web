import { CHROMATIC_OWNER } from "./chromaticContract.js";
import { CHROMATIC_FRAGMENT_SHADER } from "./chromaticShader.js";
import { createChromaticUniforms, updateChromaticUniforms } from "./chromaticUniforms.js";

export function createChromaticResources(adapter, pool, capabilities) {
  const records = new Map();
  const uniforms = createChromaticUniforms();
  let material = null;
  let materialGeneration = null;
  let disposed = false;

  function invalidate() {
    for (const record of records.values()) record.alive = false;
    records.clear();
    material?.dispose();
    material = null;
    pool.releaseOwner(CHROMATIC_OWNER);
  }

  return Object.freeze({
    draw(source, frame, settings, geometry) {
      if (disposed) throw new Error("CP-F23 resources are disposed");
      if (adapter.context?.isContextLost?.()) {
        invalidate();
        throw new Error("CP-F23 WebGL context is lost");
      }
      if (
        Math.max(source.width, source.height, geometry.width, geometry.height) >
        capabilities.maxTextureSize
      )
        throw new RangeError("CP-F23 texture-size capability exceeded");
      const key = `${CHROMATIC_OWNER}.target.${frame.viewId}`;
      const previous = records.get(frame.viewId);
      if (previous?.target.texture === source.texture)
        throw new Error("CP-F23 rejects texture read/write feedback");
      if (
        previous &&
        (previous.generation !== frame.generation ||
          previous.target.width !== geometry.width ||
          previous.target.height !== geometry.height)
      ) {
        previous.alive = false;
        pool.release(key);
      }
      const target = pool.acquire(CHROMATIC_OWNER, key, {
        width: geometry.width,
        height: geometry.height,
        format: "rgba16f",
        filter: "nearest",
      });
      if (target.texture === source.texture)
        throw new Error("CP-F23 rejects texture read/write feedback");
      if (material && materialGeneration !== frame.generation) {
        material.dispose();
        material = null;
      }
      material ??= adapter.createMaterial(CHROMATIC_FRAGMENT_SHADER, uniforms);
      materialGeneration = frame.generation;
      updateChromaticUniforms(uniforms, source, settings, geometry);
      if (previous) previous.alive = false;
      const record = { target, generation: frame.generation, alive: false };
      records.set(frame.viewId, record);
      adapter.draw(material, target);
      record.alive = true;
      return {
        target,
        isAlive: () => !disposed && record.alive && !adapter.context?.isContextLost?.(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
    },
  });
}
