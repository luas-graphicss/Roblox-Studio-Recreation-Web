import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";


import * as pipelineContract from "../mlPipelineContract.js";
import { HIDDEN_LIGHT_BUDGET_LIMITS, allocateSampleBudget, describeHiddenLightBudget } from "../mlHiddenLightBudgetCore.js";
import { HIDDEN_LIGHT_RELAXATION_LIMITS, HIDDEN_LIGHT_RELAXATION_REASON } from "../mlHiddenLightRelaxationCore.js";
import { HIDDEN_LIGHT_BUDGET_REFUSALS, hiddenLightBudgetRefusalCodes } from "../mlHiddenLightRefusalsCore.js";
import {
  HIDDEN_LIGHT_RECOVERY_GATES,
  evaluateHiddenLightRecovery,
  simulateHiddenLightRecovery,
} from "../mlHiddenLightRecoveryCore.js";

export const PHASE_ID = "ML-F10";
export const HIDDEN_LIGHT_BUDGET_FLAG_ID = "MegaLightsHiddenLightBudget";
export const TEXTURE_UNIT_KEY = "ML-F10:hiddenLightBudget";
export const HIDDEN_LIGHT_SAMPLE_FRACTION_UNIFORM = "uMglHiddenLightSampleFraction";
const DEFAULT_TIER_NAME = "medio";


function allocateForTier(request, tierName) {
  const tier = tierName || DEFAULT_TIER_NAME;
  if (!isFlagActive(HIDDEN_LIGHT_BUDGET_FLAG_ID, tier)) {
    return allocateSampleBudget(Object.assign({}, request, { hiddenLightCount: 0 }));
  }
  return allocateSampleBudget(request);
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;

  registerFlag({
    id: HIDDEN_LIGHT_BUDGET_FLAG_ID,
    phase: PHASE_ID,
    description: "keeps up to 20% of the samples for lights outside the visible list, and relaxes that share",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });


  telemetry.textureUnit(TEXTURE_UNIT_KEY, 0);

  const baseHiddenSampleFraction =
    pipelineContract.MGL_HIDDEN_LIGHT_SAMPLE_FRACTION || HIDDEN_LIGHT_BUDGET_LIMITS.baseHiddenSampleFraction;
  telemetry.uniform(HIDDEN_LIGHT_SAMPLE_FRACTION_UNIFORM, baseHiddenSampleFraction);

  const hiddenLightBudget = Object.freeze({
    limits: HIDDEN_LIGHT_BUDGET_LIMITS,
    relaxationLimits: HIDDEN_LIGHT_RELAXATION_LIMITS,
    relaxationReasons: HIDDEN_LIGHT_RELAXATION_REASON,
    refusals: HIDDEN_LIGHT_BUDGET_REFUSALS,
    recoveryGates: HIDDEN_LIGHT_RECOVERY_GATES,
    allocate: allocateSampleBudget,
    allocateForTier,
    simulateRecovery: simulateHiddenLightRecovery,
    evaluateRecovery: evaluateHiddenLightRecovery,
    isActive(tierName) {
      return isFlagActive(HIDDEN_LIGHT_BUDGET_FLAG_ID, tierName || DEFAULT_TIER_NAME);
    },
    describe: describeHiddenLightBudget,
  });

  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Hidden light budget",
    block: "C",
    ownsPass: null,
    flag: HIDDEN_LIGHT_BUDGET_FLAG_ID,
    consumedBy: "ML-F11",
    baseHiddenSampleFraction,
    fullyRelaxedHiddenSampleFraction: HIDDEN_LIGHT_RELAXATION_LIMITS.fullyRelaxedHiddenSampleFraction,
    historyFailureHiddenSampleFraction: HIDDEN_LIGHT_RELAXATION_LIMITS.historyFailureHiddenSampleFraction,
    maximumFramesToRecover: HIDDEN_LIGHT_RECOVERY_GATES.maximumFramesToRecover,
    refusals: hiddenLightBudgetRefusalCodes(),
    registersPass: false,
    registersGlslPatch: false,
    textureUnitsDeclared: 0,
    note: "decision function only: ML-F11 calls allocateForTier inside the sampling pass",
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.hiddenLightBudget = hiddenLightBudget;
  }

  return { implemented: true, hiddenLightBudget };
}
