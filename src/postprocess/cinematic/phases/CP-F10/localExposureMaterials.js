import { LOG_LUMINANCE_FRAGMENT } from "./logLuminanceShader.js";
import { BILATERAL_FILTER_FRAGMENT } from "./bilateralFilterShader.js";
import { LOCAL_GAIN_FRAGMENT } from "./localGainShader.js";
import { LOCAL_EXPOSURE_COMPOSITE_FRAGMENT } from "./localExposureCompositeShader.js";

function uniforms(values) {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
}

export function updateLocalExposureUniforms(material, values) {
  for (const [name, value] of Object.entries(values)) {
    if (!material.uniforms[name]) throw new Error(`CP-F10 uniform was not declared: ${name}`);
    material.uniforms[name].value = value;
  }
}

export function createLocalExposureMaterials(adapter) {
  const created = [];
  function create(fragment, values) {
    const material = adapter.createMaterial(fragment, uniforms(values));
    created.push(material);
    return material;
  }
  try {
    const luminance = create(LOG_LUMINANCE_FRAGMENT, { uSceneColor: null, uPreExposure: 1 });
    const filter = create(BILATERAL_FILTER_FRAGMENT, { uInput: null, uDirection: [1, 0], uRadius: 4, uSpatialSigma: 2, uRangeSigma: 0.5, uEdgeThreshold: 2 });
    const gain = create(LOCAL_GAIN_FRAGMENT, {
      uBase: null, uSceneColor: null, uVelocity: null, uHistory: null, uInverseSize: [1, 1], uJitterDeltaUv: [0, 0],
      uHistoryWeight: 0, uHistoryRejectionStops: 0.25, uHighlightContrast: 1, uShadowContrast: 1,
      uDetailStrength: 1, uPivotStops: Math.log2(0.18), uExposureOffsetStops: 0, uBlurredLuminanceBlend: 0,
      uEdgeThreshold: 2, uDetailLimit: 1, uMaxGainStops: 8, uEnabled: true
    });
    const composite = create(LOCAL_EXPOSURE_COMPOSITE_FRAGMENT, { uSceneColor: null, uGain: null });
    let disposed = false;
    return Object.freeze({ luminance, filter, gain, composite, dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of created) material.dispose();
    } });
  } catch (error) {
    for (const material of created) material.dispose();
    throw error;
  }
}
