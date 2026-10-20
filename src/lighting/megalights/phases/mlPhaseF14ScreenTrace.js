import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { createScreenTracePass } from "../mlScreenTraceGlue.js";
import {
  SCREEN_TRACE_FLAG_ID,
  SCREEN_TRACE_PASS_NAME,
  SCREEN_TRACE_TEXTURE_UNIT_KEY,
  screenTraceRefusalCodes,
  screenTraceSettingsForTier,
} from "../mlScreenTraceContract.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F14";

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa;
  if (!telemetry) return { implemented: false, reason: "install context is missing mlQa" };

  const bench = context.bench || null;
  const renderer = bench ? bench.renderer : null;

  registerFlag({
    id: SCREEN_TRACE_FLAG_ID,
    phase: PHASE_ID,
    description: "hierarchical screen space trace: visible / occluded / unknown per sample",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const screenTracePass = createScreenTracePass({
    THREE: context.THREE || null,
    renderer,
    telemetry,
  });

  registerPass(SCREEN_TRACE_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(SCREEN_TRACE_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return screenTracePass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};


  const declaredTextureUnits = Number(reservedTextureUnits[SCREEN_TRACE_TEXTURE_UNIT_KEY]) || 0;
  telemetry.textureUnit(SCREEN_TRACE_TEXTURE_UNIT_KEY, declaredTextureUnits);

  const settings = screenTraceSettingsForTier(context.tier || "medio");
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Screen space trace",
    block: "D",
    ownsPass: SCREEN_TRACE_PASS_NAME,
    flag: SCREEN_TRACE_FLAG_ID,
    stepBudget: settings.maximumStepCount,
    thickness: settings.thicknessInViewDepth,
    depthBias: settings.depthBiasInViewDepth,
    textureUnitsDeclared: declaredTextureUnits,
    textureUnitsUsedInLitShader: 0,
    registersGlslPatch: false,
    refuses: screenTraceRefusalCodes(),


    gpuMarchBlockedBy: "the pyramid of ML-F3 is per level targets; the march needs the mipped texture the contract declares",
    note: "pass registered and honest: it reports what it waits for and never answers visible without reaching the light",
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.screenTrace = screenTracePass;
  }



  return { implemented: true, screenTrace: screenTracePass };
}
