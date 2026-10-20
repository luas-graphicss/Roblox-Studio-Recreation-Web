import { HISTORY_RESCALE_FRAGMENT } from "./historyRescaleShader.js";
import { getPreExposureScale } from "./preExposureScale.js";

export function createGpuHistoryRescale(rendererAdapter) {
  let material = null;
  let disposed = false;
  return Object.freeze({
    rescale(source, destination, scale) {
      if (disposed) throw new Error("History converter is disposed");
      getPreExposureScale(1, scale);
      if (!source?.texture || !destination?.texture || source.texture === destination.texture) throw new Error("History conversion requires distinct textures");
      if (source.width !== destination.width || source.height !== destination.height || source.format !== "rgba16f" || destination.userData?.format !== "rgba16f") throw new Error("History conversion target shape or format mismatch");
      if (typeof rendererAdapter?.createMaterial !== "function" || typeof rendererAdapter?.draw !== "function") throw new Error("GPU history conversion is unavailable");
      if (!material) material = rendererAdapter.createMaterial(HISTORY_RESCALE_FRAGMENT, { historyTexture: { value: null }, preExposureScale: { value: 1 } });
      material.uniforms.historyTexture.value = source.texture;
      material.uniforms.preExposureScale.value = scale;
      try { rendererAdapter.draw(material, destination); }
      finally { material.uniforms.historyTexture.value = null; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material?.dispose();
      material = null;
    }
  });
}
