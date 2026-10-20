import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";


import * as pipelineContract from "../mlPipelineContract.js";
import {
  MGL_TRACE_KIND,
  TRACE_CASCADE_ORDER,
  cascadeFollowsContractPassOrder,
  cascadeStepCount,
  describeTraceCascadeByTier,
  isTraceKindAllowedOnTier,
  resolveTraceCascade,
} from "../mlTraceCascadeCore.js";
import {
  TRACE_RAY_BUDGET_LIMITS,
  TRACE_RAY_BUDGET_UNIFORM,
  frameRayBudget,
  raysPerSampleEntitlement,
  raysToCompleteOneSample,
} from "../mlTraceRayBudgetCore.js";
import {
  TRACE_FALLBACK_REASON,
  TRACE_FALLBACK_RESULT,
  resolveDisabledTracePolicy,
  resolveTracePolicy,
} from "../mlTracePolicyCore.js";
import { compactUnresolvedSamples } from "../mlTraceSampleCompactionCore.js";
import {
  SAMPLE_VISIBILITY_BUFFER_NAME,
  SAMPLE_VISIBILITY_SAMPLER_UNIFORM,
  decodeSampleVisibility,
  encodeSampleVisibility,
  encodedChannelsMatchFrozenLayout,
} from "../mlSampleVisibilityCore.js";
import { TRACE_POLICY_REFUSALS, tracePolicyRefusalCodes } from "../mlTracePolicyRefusalsCore.js";
import {
  TRACE_POLICY_GATES,
  evaluateRayCostAgainstLightCount,
  evaluateTracePolicy,
  maximumRaysPerSampleOnTier,
} from "../mlTracePolicyGatesCore.js";
import {
  TRACE_ROTATION_LIMITS,
  planRotationPulse,
  rotationPulsesToServeAll,
  runRotationCycle,
  samplesServedPerPulse,
} from "../mlTraceRayRotationCore.js";
import { createTracePolicyInstrument } from "../mlTracePolicyGlue.js";

export const PHASE_ID = "ML-F17";
export const TRACE_POLICY_FLAG_ID = "MegaLightsTracePolicy";
export const TEXTURE_UNIT_KEY = "ML-F17:tracePolicy";
const DEFAULT_TIER_NAME = "medio";


function resolveForTier(request) {
  const input = request || {};
  const tierName = input.tierName || DEFAULT_TIER_NAME;
  if (!isFlagActive(TRACE_POLICY_FLAG_ID, tierName)) {
    return resolveDisabledTracePolicy({ tierName, samples: input.samples });
  }
  return resolveTracePolicy(Object.assign({}, input, { tierName }));
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;

  registerFlag({
    id: TRACE_POLICY_FLAG_ID,
    phase: PHASE_ID,
    description:
      "chains screen trace, virtual shadow map and ray trace, promoting only the samples still unknown",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });


  telemetry.textureUnit(TEXTURE_UNIT_KEY, 0);


  const raysPerSampleCeiling = maximumRaysPerSampleOnTier(DEFAULT_TIER_NAME);
  telemetry.uniform(TRACE_RAY_BUDGET_UNIFORM, raysPerSampleCeiling);




  const tracePolicyInstrument = createTracePolicyInstrument({
    telemetry,
    isPolicyActive: (tierName) => isFlagActive(TRACE_POLICY_FLAG_ID, tierName || DEFAULT_TIER_NAME),
  });

  const tracePolicy = Object.freeze({
    traceKinds: MGL_TRACE_KIND,
    cascadeOrder: TRACE_CASCADE_ORDER,
    cascadeByTier: describeTraceCascadeByTier(),
    resolveTraceCascade,
    cascadeStepCount,
    isTraceKindAllowedOnTier,
    rayBudgetLimits: TRACE_RAY_BUDGET_LIMITS,
    frameRayBudget,
    raysPerSampleEntitlement,
    maximumRaysPerSampleOnTier,
    fallbackResult: TRACE_FALLBACK_RESULT,
    fallbackReasons: TRACE_FALLBACK_REASON,
    refusals: TRACE_POLICY_REFUSALS,
    gates: TRACE_POLICY_GATES,

    resolve: resolveTracePolicy,
    resolveForTier,
    resolveDisabled: resolveDisabledTracePolicy,
    compactUnresolvedSamples,
    raysToCompleteOneSample,
    rotationLimits: TRACE_ROTATION_LIMITS,
    samplesServedPerPulse,
    rotationPulsesToServeAll,
    planRotationPulse,
    runRotationCycle,


    instrument: tracePolicyInstrument,
    encodeSampleVisibility,
    decodeSampleVisibility,
    evaluate: evaluateTracePolicy,
    evaluateRayCostAgainstLightCount,
    isActive(tierName) {
      return isFlagActive(TRACE_POLICY_FLAG_ID, tierName || DEFAULT_TIER_NAME);
    },
  });

  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Hybrid trace policy and ray budget",
    block: "D",
    ownsPass: null,
    flag: TRACE_POLICY_FLAG_ID,
    consumedBy: "ML-F14, ML-F15, ML-F16, ML-F18",
    contractVersion: pipelineContract.MGL_CONTRACT_VERSION,
    cascadeByTier: describeTraceCascadeByTier(),
    cascadeFollowsContractPassOrder: cascadeFollowsContractPassOrder(),
    fallbackResult: TRACE_FALLBACK_RESULT,
    fallbackKind: MGL_TRACE_KIND.policyFallback,
    weakTierRaysPerSample: TRACE_POLICY_GATES.weakTierRaysPerSample,
    raysPerSampleCeilingByTier: Object.freeze({
      fraco: maximumRaysPerSampleOnTier("fraco"),
      medio: maximumRaysPerSampleOnTier("medio"),
      forte: maximumRaysPerSampleOnTier("forte"),
    }),
    writesBuffer: SAMPLE_VISIBILITY_BUFFER_NAME,
    samplerUniform: SAMPLE_VISIBILITY_SAMPLER_UNIFORM,
    encodedChannelsMatchFrozenLayout: encodedChannelsMatchFrozenLayout(),
    refusals: tracePolicyRefusalCodes(),
    rotationIsDeterministic: true,
    rotationWindowRule: "floor(rays available for the frame / rays to complete one sample)",
    rotationBoundRule: "ceil(pending samples / samples served per pulse)",
    registersPass: false,
    registersGlslPatch: false,
    textureUnitsDeclared: 0,
    note: "decision function only: the three tracers call resolveForTier and write the sampleVisibility texel",


    contractResidual:
      "no texture unit is reserved for the sampleVisibility sampler; ML-F2 owns that reservation",


    tracersInstalledToday: 0,
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.tracePolicy = tracePolicy;
  }

  return { implemented: true, tracePolicy };
}
