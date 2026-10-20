import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import {
  DOWNSAMPLE_PHASE_ID,
  DOWNSAMPLE_FLAG_ID,
  DOWNSAMPLE_UNIFORM_NAMES,
  createDownsampleController,
} from "../mlDownsampleGlue.js";
import { downsampleModeNameForTier } from "../mlDownsampleModeCore.js";

export const PHASE_ID = DOWNSAMPLE_PHASE_ID;

const TIER_NAMES = Object.freeze(["fraco", "medio", "forte"]);


const FLAG_DEFAULTS_BY_TIER = Object.freeze({ fraco: true, medio: true, forte: true });

function modeNameByTier() {
  const modes = {};
  TIER_NAMES.forEach((tierName) => {
    modes[tierName] = downsampleModeNameForTier(tierName);
  });
  return modes;
}

function tierFromContext(installContext) {
  const context = installContext && typeof installContext === "object" ? installContext : {};
  if (typeof context.tier === "string") return context.tier;
  const bench = context.bench;
  if (bench && typeof bench.tier === "string") return bench.tier;
  return "";
}

function publishOnLab(installContext, controller) {
  const context = installContext && typeof installContext === "object" ? installContext : {};
  if (context.lab && typeof context.lab === "object") context.lab.downsample = controller;
  if (typeof window === "undefined") return;
  if (window.__mlLab && typeof window.__mlLab === "object") window.__mlLab.downsample = controller;
}

export function installPhase(installContext) {
  const telemetry = (installContext && installContext.mlQa) || mlQa;

  registerFlag({
    id: DOWNSAMPLE_FLAG_ID,
    phase: PHASE_ID,
    description: "Runs the light sampling at reduced resolution (checkerboard 2x, four rooks 4x)",
    defaultsByTier: FLAG_DEFAULTS_BY_TIER,
  });

  const controller = createDownsampleController({
    telemetry,
    isFlagEnabled: (tierName) => isFlagActive(DOWNSAMPLE_FLAG_ID, tierName),
  });

  const tier = tierFromContext(installContext);
  const initialPlan = tier
    ? controller.planForFrame({
        tier,
        frameIndex: 0,
        fullWidth: (installContext && installContext.renderWidth) || 1,
        fullHeight: (installContext && installContext.renderHeight) || 1,
      })
    : null;

  const description = controller.describe();
  telemetry.phase(PHASE_ID, {
    implemented: true,
    flag: DOWNSAMPLE_FLAG_ID,
    ownsPass: false,
    glslPatchCount: 0,
    reservedTextureUnits: 0,
    uniforms: [DOWNSAMPLE_UNIFORM_NAMES.factor, DOWNSAMPLE_UNIFORM_NAMES.pattern],
    uniformOwnership: description.uniformOwnership,
    modeByTier: modeNameByTier(),
    temporalJitterPolicy: description.temporalJitterPolicy,
    initialPlan: initialPlan || "not planned: tier unknown at install time",
  });
  telemetry.textureUnit(PHASE_ID + ":downsample", 0);

  publishOnLab(installContext, controller);

  return Object.freeze({ phaseId: PHASE_ID, downsample: controller });
}
