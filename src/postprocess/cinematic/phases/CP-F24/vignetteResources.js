import { VIGNETTE_OWNER } from "./vignetteContract.js";
import { VIGNETTE_FRAGMENT_SHADER } from "./vignetteShader.js";

export function createVignetteResources(adapter, pool, uniforms) {
  let material = null;
  let disposed = false;
  const generations = new Map();

  function invalidate() {
    material?.dispose();
    material = null;
    pool.releaseOwner(VIGNETTE_OWNER);
    generations.clear();
  }

  return Object.freeze({
    draw(source, frame) {
      if (disposed) throw new Error("CP-F24 resources are disposed");
      if (adapter.context?.isContextLost?.()) {
        invalidate();
        throw new Error("CP-F24 WebGL context is lost");
      }
      if (source.width > (adapter.capabilities?.maxTextureSize ?? Infinity) || source.height > (adapter.capabilities?.maxTextureSize ?? Infinity)) throw new RangeError("CP-F24 source exceeds the texture-size capability");
      const key = `${VIGNETTE_OWNER}.color.${frame.viewId}`;
      if (generations.has(frame.viewId) && generations.get(frame.viewId) !== frame.generation) pool.release(key);
      generations.set(frame.viewId, frame.generation);
      const target = pool.acquire(VIGNETTE_OWNER, key, { width: source.width, height: source.height, format: "rgba16f", filter: "nearest" });
      if (source.texture === target.texture) throw new Error("CP-F24 rejects texture read/write feedback");
      material ??= adapter.createMaterial(VIGNETTE_FRAGMENT_SHADER, { cp24InputTexture: { value: null }, ...uniforms });
      material.uniforms.cp24InputTexture.value = source.texture;
      adapter.draw(material, target);
      return target;
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
    }
  });
}
