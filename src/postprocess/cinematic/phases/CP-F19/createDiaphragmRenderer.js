import { DIAPHRAGM_NORMALIZATION_SHADER } from "./diaphragmNormalizationShader.js";
import { DIAPHRAGM_GATHER_SHADER } from "./diaphragmGatherShader.js";
import { DIAPHRAGM_HOLE_FILL_SHADER } from "./diaphragmHoleFillShader.js";
import { DIAPHRAGM_RECOMBINE_SHADER, DIAPHRAGM_COPY_SHADER, DIAPHRAGM_CLEAR_SHADER } from "./diaphragmRecombineShader.js";
import { createDiaphragmGpuResources } from "./diaphragmGpuResources.js";
import { apertureAxes } from "./diaphragmAperture.js";

export function createDiaphragmRenderer(adapter, pool) {
  if (!adapter?.createMaterial || !adapter.draw || !pool?.acquire) throw new TypeError("CP-F19 requires a renderer adapter and pool");
  const resources = createDiaphragmGpuResources(pool);
  const common = Object.fromEntries([
    "sourceColor", "signedCoc", "surfaceData", "kernelNormalization", "sourceSize", "apertureScale",
    "bladeCount", "bladeCurvature", "bladeRotation", "maximumRadius", "alphaMode", "focusProtectionRadius", "depthTolerance",
    "gatherExtent", "gatherNear", "farLayer", "nearLayer", "holeFillExtent", "filledFarLayer"
  ].map((name) => [name, { value: null }]));
  const materials = [];
  const make = (shader, uniforms = common) => {
    const material = adapter.createMaterial(shader, uniforms);
    materials.push(material);
    return material;
  };
  let copy, clear, normalization, gather, holeFill, recombine;
  try {
    copy = make(DIAPHRAGM_COPY_SHADER);
    clear = make(DIAPHRAGM_CLEAR_SHADER, { clearValue: { value: [0, 0, 0, 0] } });
    normalization = make(DIAPHRAGM_NORMALIZATION_SHADER);
    gather = make(DIAPHRAGM_GATHER_SHADER);
    holeFill = make(DIAPHRAGM_HOLE_FILL_SHADER);
    recombine = make(DIAPHRAGM_RECOMBINE_SHADER);
  } catch (error) { for (const material of materials) material.dispose(); throw error; }
  let disposed = false;
  return Object.freeze({
    render(source, coc, surface, settings, plan, metadata) {
      if (disposed) throw new Error("CP-F19 renderer is disposed");
      if (adapter.context?.isContextLost?.()) throw new Error("CP-F19 device lost; restore host and reinstall pipeline");
      const targets = resources.acquire(plan);
      common.sourceColor.value = source.texture;
      if (!plan.active) {
        adapter.draw(copy, targets.color);
        clear.uniforms.clearValue.value = [1, 0, 0, 0];
        adapter.draw(clear, targets.normalization);
        clear.uniforms.clearValue.value = [0, 0, 0, 0];
        for (const target of [targets.near, targets.far, targets.filledFar]) adapter.draw(clear, target);
        return targets;
      }
      const values = {
        signedCoc: coc.texture, surfaceData: surface.texture, sourceSize: [source.width, source.height],
        apertureScale: apertureAxes(settings.anamorphicRatio), bladeCount: settings.bladeCount,
        bladeCurvature: settings.bladeCurvature, bladeRotation: settings.bladeRotationDegrees * Math.PI / 180,
        maximumRadius: [metadata.maxima.near, metadata.maxima.far], alphaMode: ["opaque", "straight", "premultiplied"].indexOf(metadata.alphaMode),
        focusProtectionRadius: settings.focusProtectionRadiusPixels, depthTolerance: settings.depthToleranceMeters, holeFillExtent: settings.holeFillRadiusPixels
      };
      for (const [name, value] of Object.entries(values)) common[name].value = value;
      adapter.draw(normalization, targets.normalization);
      common.kernelNormalization.value = targets.normalization.texture;
      common.gatherNear.value = 1;
      common.gatherExtent.value = plan.nearExtent;
      adapter.draw(gather, targets.near);
      common.gatherNear.value = 0;
      common.gatherExtent.value = plan.farExtent;
      adapter.draw(gather, targets.far);
      common.nearLayer.value = targets.near.texture;
      common.farLayer.value = targets.far.texture;
      adapter.draw(holeFill, targets.filledFar);
      common.filledFarLayer.value = targets.filledFar.texture;
      adapter.draw(recombine, targets.color);
      return targets;
    },
    materialCount: () => materials.length,
    dispose() {
      if (disposed) return;
      disposed = true;
      resources.dispose();
      for (const material of materials) material.dispose();
    }
  });
}
