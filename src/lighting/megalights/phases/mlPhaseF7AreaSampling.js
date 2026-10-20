import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";


import * as pipelineContract from "../mlPipelineContract.js";
import * as areaSamplingGlue from "../mlAreaSamplingGlue.js";
import * as areaSamplingGlsl from "../mlAreaSamplingGlsl.js";

export const PHASE_ID = "ML-F7";
export const AREA_SAMPLING_FLAG_ID = "MegaLightsAreaSampling";
export const TEXTURE_UNIT_KEY = "ML-F7:areaSampling";
export const RESERVED_TEXTURE_UNITS = 0;

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || null;

  registerFlag({
    id: AREA_SAMPLING_FLAG_ID,
    phase: PHASE_ID,
    description: "ML-F7: area preserving sampling of sphere, rect and tube lights (library)",
    defaultsByTier: { fraco: false, medio: false, forte: false },
  });

  const installation = areaSamplingGlue.installAreaSamplingGlsl({
    sampleCount: areaSamplingGlue.DEFAULT_AREA_SAMPLE_COUNT,
    isActive: (patchContext) => {
      const tier = patchContext && patchContext.tier ? patchContext.tier : null;
      return isFlagActive(AREA_SAMPLING_FLAG_ID, tier);
    },
  });

  if (telemetry) {


    telemetry.textureUnit(TEXTURE_UNIT_KEY, RESERVED_TEXTURE_UNITS);
    telemetry.phase(PHASE_ID, {
      status: "library installed",
      flag: AREA_SAMPLING_FLAG_ID,
      flagDefault: "off on every tier until ML-F11 consumes it",
      patch: installation.patchId,
      anchor: installation.anchor,
      patchOrder: installation.order,
      uniform: installation.uniformName,
      shapes: Object.keys(pipelineContract.MGL_LIGHT_SHAPE).join(", "),
      glslFunctions: areaSamplingGlsl.MGL_AREA_SAMPLING_FUNCTIONS.length,
      textureUnits: RESERVED_TEXTURE_UNITS,
      ownsPass: "none (library consumed by ML-F11)",
    });
  }

  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.areaSampling = areaSamplingGlue.createAreaSamplingConsoleApi();
  }

  return {
    phaseId: PHASE_ID,
    flagId: AREA_SAMPLING_FLAG_ID,
    patchId: installation.patchId,
    uniformName: installation.uniformName,
    textureUnits: RESERVED_TEXTURE_UNITS,
  };
}
