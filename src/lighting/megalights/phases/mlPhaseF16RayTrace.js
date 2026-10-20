import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { createRayTracePass, RAY_TRACE_TEXTURE_UNIT_KEY } from "../mlRayTraceGlue.js";
import {
  RAY_ORIGIN_BIAS_STUDS,
  RAY_TRACE_PASS_NAME,
  SCREEN_TRACE_PARITY_TOLERANCE,
  describeRayPolicy,
} from "../mlRayTraceCore.js";
import { describeBvhTraversalGlsl } from "../mlBvhTraversalGlsl.js";
import { describeBvhTextureLayout } from "../mlBvhTextureLayoutCore.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F16";
export const RAY_TRACE_FLAG_ID = "MegaLightsRayTrace";
export const TEXTURE_UNIT_KEY = RAY_TRACE_TEXTURE_UNIT_KEY;

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa;

  registerFlag({
    id: RAY_TRACE_FLAG_ID,
    phase: PHASE_ID,
    description: "resolves the samples the screen trace and the shadow pages left unknown, with one ray through the engine BVH",


    defaultsByTier: {
      fraco: false,
      medio: pipelineContract.tierDefaults("medio").rayTraceEnabled === true,
      forte: pipelineContract.tierDefaults("forte").rayTraceEnabled === true,
    },
  });

  const rayTracePass = createRayTracePass({
    THREE: context.THREE || null,
    telemetry,
  });

  registerPass(RAY_TRACE_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(RAY_TRACE_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return rayTracePass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  if (telemetry) telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  const policy = describeRayPolicy();
  const shaderDescription = describeBvhTraversalGlsl();
  if (telemetry) {
    telemetry.phase(PHASE_ID, {
      implemented: true,
      title: "Ray traced occlusion through BVH",
      block: "D",
      ownsPass: RAY_TRACE_PASS_NAME,
      flag: RAY_TRACE_FLAG_ID,
      raysPerPixelByTier: policy.raysPerPixelByTier,
      originBiasStuds: RAY_ORIGIN_BIAS_STUDS,
      screenTraceParityTolerance: SCREEN_TRACE_PARITY_TOLERANCE,

      textureUnitsDeclared: declaredTextureUnits,
      bvhTextureLayout: describeBvhTextureLayout().layoutName,
      reusesEngineCore: "src/lighting/bvhCore.js (packBvhForGpu output, read only)",
      registersGlslPatch: false,
      glslFunctionNames: shaderDescription.functionNames,
      glslUsesScreenDerivatives: shaderDescription.usesScreenDerivatives,
      glslRequiredVersion: shaderDescription.requiredGlslVersion,
      lightingInjectionRefusal: shaderDescription.lightingInjectionRefusal,
      contractDivergence:
        "the plan asks for a reduced ceiling on the medium tier; MGL_TIER_DEFAULTS.medio.rayTraceEnabled is false, " +
        "so medio traces zero rays until the contract version is bumped in review",
      note: "pass registered; rays are spent only while the flag is on and the engine publishes a packed BVH",
    });
  }


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.rayTrace = rayTracePass;
  }

  return { implemented: true, rayTrace: rayTracePass };
}
