import { registerPatch, registerUniform } from "./runtime/megaLightsPatchRegistry.js";


import * as pipelineContract from "./mlPipelineContract.js";
import * as areaSamplingGlsl from "./mlAreaSamplingGlsl.js";
import * as sphereSamplingCore from "./mlSphereSamplingCore.js";
import * as rectSamplingCore from "./mlRectSamplingCore.js";
import * as tubeSamplingCore from "./mlTubeSamplingCore.js";
import * as areaSampleBitmaskCore from "./mlAreaSampleBitmaskCore.js";

export const AREA_SAMPLING_PATCH_ID = "ml-f7-area-sampling";
export const AREA_SAMPLING_ANCHOR = "common";
export const DEFAULT_AREA_SAMPLE_COUNT = 4;

export function areaSamplingPatchOrder() {
  const order = pipelineContract.MGL_PATCH_ORDER["ML-F7"];
  return Number.isFinite(order) ? order : 1000;
}


export function installAreaSamplingGlsl(options) {
  const settings = options || {};
  const sampleCount = Number.isFinite(settings.sampleCount)
    ? settings.sampleCount
    : DEFAULT_AREA_SAMPLE_COUNT;

  registerUniform(areaSamplingGlsl.MGL_AREA_SAMPLE_COUNT_UNIFORM, sampleCount);

  registerPatch({
    id: AREA_SAMPLING_PATCH_ID,
    phase: "ML-F7",
    anchor: AREA_SAMPLING_ANCHOR,
    order: areaSamplingPatchOrder(),
    materialPaths: null,
    isActive: typeof settings.isActive === "function" ? settings.isActive : () => false,
    apply(patchContext) {



      return patchContext.insertBeforeChunk(
        "fragment",
        AREA_SAMPLING_ANCHOR,
        areaSamplingGlsl.MGL_AREA_SAMPLING_GLSL,
      );
    },
  });

  return {
    patchId: AREA_SAMPLING_PATCH_ID,
    anchor: AREA_SAMPLING_ANCHOR,
    order: areaSamplingPatchOrder(),
    uniformName: areaSamplingGlsl.MGL_AREA_SAMPLE_COUNT_UNIFORM,
  };
}


export function createAreaSamplingConsoleApi() {
  return {
    sampleSphere: sphereSamplingCore.sampleSphere,
    sampleRectangle: rectSamplingCore.sampleRectangle,
    sampleTube: tubeSamplingCore.sampleTube,
    sphereSolidAngle: sphereSamplingCore.sphereSolidAngle,
    rectangleSolidAngle: rectSamplingCore.rectangleSolidAngle,
    tubeSolidAngleUpperBound: tubeSamplingCore.tubeSolidAngleUpperBound,
    buildBitmask: areaSampleBitmaskCore.buildAreaSampleBitmask,
    remapWithBitmask: areaSampleBitmaskCore.remapUnitSquareWithBitmask,
    enabledQuadrants: areaSampleBitmaskCore.enabledQuadrants,
    glslSource: () => areaSamplingGlsl.MGL_AREA_SAMPLING_GLSL,
  };
}
