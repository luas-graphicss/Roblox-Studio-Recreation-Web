import { MSM_ATLAS_VISIBILITY_NO_INFORMATION, isUsableAtlasRow } from "./msmAtlasVisibilityCore.js";
import { MSM_PROXY_BOX_CEILING } from "./msmProxyOcclusionCore.js";
import { MSM_PROXY_VETO_REASON, decideMsmProxyOcclusion } from "./msmProxyVetoPolicyCore.js";
import { screenTraceStepsForTier } from "./msmScreenTraceBudgetCore.js";
import { isEngineTier, isMsmTier } from "./msmTierPolicy.js";
import {
  MSM_VISIBILITY_SOURCE,
  visibilityDepthTapsForSource,
  visibilitySlotEvaluationsForSource,
} from "./msmVisibilityTapBudgetCore.js";

export const MSM_VISIBILITY_POLICY_OWNER = "MSM-F20";


export const MSM_VISIBILITY_SOURCE_PRIORITY = Object.freeze([
  MSM_VISIBILITY_SOURCE.ATLAS,
  MSM_VISIBILITY_SOURCE.SCREEN_TRACE,
  MSM_VISIBILITY_SOURCE.PROXY,
]);


export const MSM_FULLY_LIT_VISIBILITY = 1;


export const MSM_FULLY_SHADOWED_VISIBILITY = 0;


export const MSM_VISIBILITY_ROUTE_REASON = Object.freeze({
  ATLAS_PAGE_ANSWERS: "the sampled light owns a live atlas page - the only source with a real shadow map",
  SCREEN_TRACE_ANSWERS: "no atlas page for this light, and the shared half res depth can see the segment",
  PROXY_ANSWERS: "the screen cannot serve this sample, so the coarse boxes answer instead of leaving it lit",
  NO_SOURCE_CAN_ANSWER: "every source refused - the sample stays fully lit, which is the fail-safe direction",
});


export const MSM_VISIBILITY_SKIP_REASON = Object.freeze({
  MSM_ASLEEP_ON_THIS_TIER: "the MSM does not run on this tier - the original MegaLights assumes",
  UNKNOWN_TIER: "the renderer tier was not informed or is not a tier of the engine",
  ATLAS_ASLEEP: "the atlas uniform gate is off - there is no page to read",
  ATLAS_ROW_UNMAPPED: "the sampled light has no atlas row - beyond the meta texture (MSM-F16)",
  ATLAS_PAGE_EMPTY: "the atlas row carries no slot - the page was never rendered",
  SCREEN_TRACE_HAS_NO_STEPS: "the tier grants the screen trace no steps",
  SCREEN_TRACE_SOLD_BY_THE_LADDER: "the governor sold the screen trace to stay inside the budget (rung 3, section 6.3)",
  SAMPLED_LIGHT_BEHIND_CAMERA: "the sampled light sits behind the camera - the screen holds no evidence about it",
  PROXY_TIER_TOO_WEAK: "proxy occlusion is a low+ feature and this tier is below it (MSM-F19)",
  PROXY_DISABLED_BY_FLAG: "proxy occlusion is off by operator flag",
  PROXY_SOLD_BY_THE_LADDER: "the governor sold the proxy occlusion (rung requested by MSM-F19, owned by MSM-F31)",
  PROXY_HAS_NO_BOX: "no proxy box is active - eight neutral slots would answer exactly 1.0 for the price of eight walks",
});


export const MSM_VISIBILITY_ANSWER_REASON = Object.freeze({
  SOURCE_ANSWERED: "the chosen source answered and its answer is final",
  SOURCE_RUNNER_MISSING: "the chosen source has no runner wired - the sample stays lit and no other source is tried",
  SOURCE_REFUSED_TO_ANSWER: "the chosen source returned no usable number - the sample stays lit and no other source is tried",
  NO_SOURCE_EXECUTED: "no source was eligible, so nothing ran and nothing was spent",
});


export const MSM_VISIBILITY_POLICY_REQUEST_FIELDS = Object.freeze([
  "tier",
  "isAtlasAwake",
  "atlasRow",
  "hasLiveAtlasPage",
  "isScreenTraceSoldByTheLadder",
  "isSampledLightInFrontOfCamera",
  "isProxyEnabledByFlag",
  "isProxySoldByTheLadder",
  "activeProxyBoxCount",
]);


export const MSM_VISIBILITY_POLICY_REFUSED_INPUTS = Object.freeze([
  "lightCount",
  "sceneLightCount",
  "visibleLightCount",
  "lightsInCell",
  "candidateCount",
  "pixelIndex",
  "frameIndex",
]);


export const MSM_VISIBILITY_SOURCE_RUNNER_FIELDS = Object.freeze({
  [MSM_VISIBILITY_SOURCE.ATLAS]: "runAtlasVisibility",
  [MSM_VISIBILITY_SOURCE.SCREEN_TRACE]: "runScreenTraceVisibility",
  [MSM_VISIBILITY_SOURCE.PROXY]: "runProxyVisibility",
});







export const MSM_VISIBILITY_PASS_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "one-branch-not-three-selects",
    requirement: "the assembled fragment must BRANCH to one source, never evaluate all three and select",
    why: "a select evaluates every source and pays the union, which is the ceiling on every pixel instead of only on divergent warps",
  }),
  Object.freeze({
    id: "route-before-any-fetch",
    requirement: "the routing predicates must be resolved before the first texture fetch of the sample",
    why: "routing after a fetch is a fallback chain wearing a different name, and the first fetch is already a second source",
  }),
  Object.freeze({
    id: "priority-is-a-compiled-constant",
    requirement: "the order of MSM_VISIBILITY_SOURCE_PRIORITY must be compiled in, never fed by a uniform",
    why: "golden rule 6 - the GLSL is generated once, and a priority that moves at run time is a priority that flickers",
  }),
  Object.freeze({
    id: "refusal-lights-the-sample",
    requirement: "any branch that fails to produce a number must return 1.0, never 0.0",
    why: "the fail-safe direction of the plan: a missing shadow is a missing effect, a wrong shadow is a wrong image",
  }),
]);


export const MSM_VISIBILITY_POLICY_RESIDUALS = Object.freeze([
  Object.freeze({
    id: "screen-trace-sample-gets-no-proxy-help",
    residue: "a sample served by the screen trace receives no proxy occlusion, so an occluder that is off screen leaves it lit",
    price: "this is the direct cost of one source per sample; serving both is exactly the double path the acceptance forbids",
    ownerIfEverRevisited: "MSM-F31",
  }),
  Object.freeze({
    id: "per-pixel-cost-differs-by-source",
    residue: "two pixels of one frame may route to different sources and spend different tap counts",
    price: "bounded by worstCaseVisibilityTapsForTier, which comes from the tier table and never from the light count - a divergent warp pays that ceiling",
    ownerIfEverRevisited: "MSM-F21",
  }),
  Object.freeze({
    id: "atlas-consumer-flag-untouched",
    residue: "MSM_ATLAS_SAMPLE_CONSUMER_READY stays false, so the atlas still does not wake",
    price: "MSM-F20 is a policy, not a pass; flipping that flag belongs to the phase that really reads the atlas, and until then the engine is byte for byte unchanged (gate G9)",
    ownerIfEverRevisited: "MSM-F21",
  }),
]);

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function readTierText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function eligible(source, reason) {
  return Object.freeze({ source, isEligible: true, reason });
}

function notEligible(source, reason) {
  return Object.freeze({ source, isEligible: false, reason });
}


export function clampActiveProxyBoxCount(value) {
  const boxCount = Math.floor(Number(value));
  if (!Number.isFinite(boxCount) || 0 > boxCount) return 0;
  return boxCount > MSM_PROXY_BOX_CEILING ? MSM_PROXY_BOX_CEILING : boxCount;
}


export function describeAtlasEligibility(request) {
  const input = asObject(request);
  const source = MSM_VISIBILITY_SOURCE.ATLAS;

  if (!isMsmTier(input.tier)) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.MSM_ASLEEP_ON_THIS_TIER);
  if (input.isAtlasAwake !== true) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.ATLAS_ASLEEP);
  if (!isUsableAtlasRow(input.atlasRow)) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.ATLAS_ROW_UNMAPPED);
  if (input.hasLiveAtlasPage !== true) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.ATLAS_PAGE_EMPTY);

  return eligible(source, MSM_VISIBILITY_ROUTE_REASON.ATLAS_PAGE_ANSWERS);
}


export function describeScreenTraceEligibility(request) {
  const input = asObject(request);
  const source = MSM_VISIBILITY_SOURCE.SCREEN_TRACE;

  if (!isMsmTier(input.tier)) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.MSM_ASLEEP_ON_THIS_TIER);
  if (screenTraceStepsForTier(input.tier) === null) {
    return notEligible(source, MSM_VISIBILITY_SKIP_REASON.SCREEN_TRACE_HAS_NO_STEPS);
  }
  if (input.isScreenTraceSoldByTheLadder === true) {
    return notEligible(source, MSM_VISIBILITY_SKIP_REASON.SCREEN_TRACE_SOLD_BY_THE_LADDER);
  }
  if (input.isSampledLightInFrontOfCamera === false) {
    return notEligible(source, MSM_VISIBILITY_SKIP_REASON.SAMPLED_LIGHT_BEHIND_CAMERA);
  }

  return eligible(source, MSM_VISIBILITY_ROUTE_REASON.SCREEN_TRACE_ANSWERS);
}

function skipReasonForProxyVeto(vetoReason) {
  if (vetoReason === MSM_PROXY_VETO_REASON.TIER_TOO_WEAK) return MSM_VISIBILITY_SKIP_REASON.PROXY_TIER_TOO_WEAK;
  if (vetoReason === MSM_PROXY_VETO_REASON.DISABLED_BY_FLAG) return MSM_VISIBILITY_SKIP_REASON.PROXY_DISABLED_BY_FLAG;
  if (vetoReason === MSM_PROXY_VETO_REASON.SOLD_BY_THE_LADDER) return MSM_VISIBILITY_SKIP_REASON.PROXY_SOLD_BY_THE_LADDER;
  return MSM_VISIBILITY_SKIP_REASON.UNKNOWN_TIER;
}


export function describeProxyEligibility(request) {
  const input = asObject(request);
  const source = MSM_VISIBILITY_SOURCE.PROXY;

  if (!isMsmTier(input.tier)) return notEligible(source, MSM_VISIBILITY_SKIP_REASON.MSM_ASLEEP_ON_THIS_TIER);

  const vetoDecision = decideMsmProxyOcclusion({
    tier: input.tier,
    isSoldByTheLadder: input.isProxySoldByTheLadder === true,
    isEnabledByFlag: input.isProxyEnabledByFlag !== false,
  });
  if (!vetoDecision.runsProxyOcclusion) return notEligible(source, skipReasonForProxyVeto(vetoDecision.vetoReason));
  if (!(clampActiveProxyBoxCount(input.activeProxyBoxCount) > 0)) {
    return notEligible(source, MSM_VISIBILITY_SKIP_REASON.PROXY_HAS_NO_BOX);
  }

  return eligible(source, MSM_VISIBILITY_ROUTE_REASON.PROXY_ANSWERS);
}

function describeEligibilityBySource(request) {
  const eligibilityBySource = {};
  eligibilityBySource[MSM_VISIBILITY_SOURCE.ATLAS] = describeAtlasEligibility(request);
  eligibilityBySource[MSM_VISIBILITY_SOURCE.SCREEN_TRACE] = describeScreenTraceEligibility(request);
  eligibilityBySource[MSM_VISIBILITY_SOURCE.PROXY] = describeProxyEligibility(request);
  return Object.freeze(eligibilityBySource);
}

function reasonForNoSource(tier) {
  if (!isMsmTier(tier)) {
    return isEngineTier(tier)
      ? MSM_VISIBILITY_SKIP_REASON.MSM_ASLEEP_ON_THIS_TIER
      : MSM_VISIBILITY_SKIP_REASON.UNKNOWN_TIER;
  }
  return MSM_VISIBILITY_ROUTE_REASON.NO_SOURCE_CAN_ANSWER;
}









export function describeVisibilityRouting(request) {
  const input = asObject(request);
  const tier = readTierText(input.tier);
  const eligibilityBySource = describeEligibilityBySource(input);

  const chosenSource =
    MSM_VISIBILITY_SOURCE_PRIORITY.find(function isFirstEligible(source) {
      return eligibilityBySource[source].isEligible;
    }) || MSM_VISIBILITY_SOURCE.NONE;

  const isServed = chosenSource !== MSM_VISIBILITY_SOURCE.NONE;

  return Object.freeze({
    owner: MSM_VISIBILITY_POLICY_OWNER,
    tier,
    source: chosenSource,
    reason: isServed ? eligibilityBySource[chosenSource].reason : reasonForNoSource(tier),
    eligibilityBySource,
    budgetedDepthTapCount: isServed ? visibilityDepthTapsForSource(chosenSource, tier) : 0,
    budgetedSlotEvaluationCount: isServed ? visibilitySlotEvaluationsForSource(chosenSource, tier) : 0,
  });
}


export function routeVisibilitySource(request) {
  return describeVisibilityRouting(request).source;
}

function readRunnerFor(request, source) {
  const runnerField = MSM_VISIBILITY_SOURCE_RUNNER_FIELDS[source];
  if (!runnerField) return null;
  const runner = asObject(request)[runnerField];
  return typeof runner === "function" ? runner : null;
}


function normalizeSourceReport(rawReport) {
  if (typeof rawReport === "number") {
    return { visibility: rawReport, depthTapCount: null, slotEvaluationCount: null };
  }

  const report = asObject(rawReport);
  return {
    visibility: Number(report.visibility),
    depthTapCount: Number.isFinite(report.depthTapCount) ? Math.floor(report.depthTapCount) : null,
    slotEvaluationCount: Number.isFinite(report.slotEvaluationCount) ? Math.floor(report.slotEvaluationCount) : null,
  };
}


export function isUsableVisibilityAnswer(value) {
  return Number.isFinite(value) && value >= MSM_FULLY_SHADOWED_VISIBILITY && MSM_FULLY_LIT_VISIBILITY >= value;
}


export function isAtlasNoInformation(value) {
  return value === MSM_ATLAS_VISIBILITY_NO_INFORMATION;
}

function buildSampleAnswer(fields) {
  return Object.freeze({
    owner: MSM_VISIBILITY_POLICY_OWNER,
    tier: fields.routing.tier,
    source: fields.routing.source,
    routeReason: fields.routing.reason,
    answerReason: fields.answerReason,
    visibility: fields.visibility,
    sourcesExecuted: fields.sourcesExecuted,
    depthTapCount: fields.depthTapCount,
    slotEvaluationCount: fields.slotEvaluationCount,
    costIsMeasured: fields.costIsMeasured,
    eligibilityBySource: fields.routing.eligibilityBySource,
  });
}


export function resolveSampleVisibility(request) {
  const input = asObject(request);
  const routing = describeVisibilityRouting(input);
  const ledger = asObject(input.ledger);
  const recordSample = typeof ledger.recordSample === "function" ? ledger.recordSample : null;

  function finish(answer) {
    if (recordSample) recordSample(answer);
    return answer;
  }

  if (routing.source === MSM_VISIBILITY_SOURCE.NONE) {
    return finish(
      buildSampleAnswer({
        routing,
        answerReason: MSM_VISIBILITY_ANSWER_REASON.NO_SOURCE_EXECUTED,
        visibility: MSM_FULLY_LIT_VISIBILITY,
        sourcesExecuted: 0,
        depthTapCount: 0,
        slotEvaluationCount: 0,
        costIsMeasured: false,
      }),
    );
  }

  const runner = readRunnerFor(input, routing.source);
  if (runner === null) {
    return finish(
      buildSampleAnswer({
        routing,
        answerReason: MSM_VISIBILITY_ANSWER_REASON.SOURCE_RUNNER_MISSING,
        visibility: MSM_FULLY_LIT_VISIBILITY,
        sourcesExecuted: 0,
        depthTapCount: 0,
        slotEvaluationCount: 0,
        costIsMeasured: false,
      }),
    );
  }


  const report = normalizeSourceReport(runner());
  const costIsMeasured = report.depthTapCount !== null;
  const depthTapCount = costIsMeasured ? report.depthTapCount : routing.budgetedDepthTapCount;
  const slotEvaluationCount =
    report.slotEvaluationCount === null ? routing.budgetedSlotEvaluationCount : report.slotEvaluationCount;

  if (!isUsableVisibilityAnswer(report.visibility)) {
    return finish(
      buildSampleAnswer({
        routing,
        answerReason: MSM_VISIBILITY_ANSWER_REASON.SOURCE_REFUSED_TO_ANSWER,
        visibility: MSM_FULLY_LIT_VISIBILITY,
        sourcesExecuted: 1,
        depthTapCount,
        slotEvaluationCount,
        costIsMeasured,
      }),
    );
  }

  return finish(
    buildSampleAnswer({
      routing,
      answerReason: MSM_VISIBILITY_ANSWER_REASON.SOURCE_ANSWERED,
      visibility: report.visibility,
      sourcesExecuted: 1,
      depthTapCount,
      slotEvaluationCount,
      costIsMeasured,
    }),
  );
}
