import { MGL_PATCH_ORDER, MGL_TRACE_RESULT } from "./mlPipelineContract.js";

export const PHASE_ID = "ML-F14";
export const SCREEN_TRACE_PASS_NAME = "screenTrace";
export const SCREEN_TRACE_FLAG_ID = "MegaLightsScreenTrace";
export const SCREEN_TRACE_TEXTURE_UNIT_KEY = "ML-F14:screenTrace";
export const SCREEN_TRACE_PATCH_ORDER = MGL_PATCH_ORDER[PHASE_ID];


export const SCREEN_TRACE_UNIFORM_NAMES = Object.freeze({
  hierarchicalDepth: "uMglHierarchicalDepth",
  renderResolution: "uMglRenderResolution",
  stepCount: "uMglScreenTraceStepCount",
  thickness: "uMglScreenTraceThickness",
});

export const SCREEN_TRACE_EXIT_REASON = Object.freeze({
  hitConfirmed: "hitConfirmed",
  reachedRayEnd: "reachedRayEnd",
  leftScreen: "leftScreen",
  stepBudgetExhausted: "stepBudgetExhausted",
  behindSurfaceBeyondThickness: "behindSurfaceBeyondThickness",
  degenerateScreenSegment: "degenerateScreenSegment",
  rayBehindCamera: "rayBehindCamera",
  noHierarchicalDepth: "noHierarchicalDepth",
});


export const RESULT_FOR_EXIT_REASON = Object.freeze({
  [SCREEN_TRACE_EXIT_REASON.hitConfirmed]: MGL_TRACE_RESULT.occluded,
  [SCREEN_TRACE_EXIT_REASON.reachedRayEnd]: MGL_TRACE_RESULT.visible,


  [SCREEN_TRACE_EXIT_REASON.leftScreen]: MGL_TRACE_RESULT.unknown,


  [SCREEN_TRACE_EXIT_REASON.stepBudgetExhausted]: MGL_TRACE_RESULT.unknown,


  [SCREEN_TRACE_EXIT_REASON.behindSurfaceBeyondThickness]: MGL_TRACE_RESULT.unknown,
  [SCREEN_TRACE_EXIT_REASON.degenerateScreenSegment]: MGL_TRACE_RESULT.unknown,
  [SCREEN_TRACE_EXIT_REASON.rayBehindCamera]: MGL_TRACE_RESULT.unknown,
  [SCREEN_TRACE_EXIT_REASON.noHierarchicalDepth]: MGL_TRACE_RESULT.unknown,
});

export function resultForExitReason(exitReason) {
  return RESULT_FOR_EXIT_REASON[exitReason] || MGL_TRACE_RESULT.unknown;
}


export const DEFAULT_SCREEN_TRACE_SETTINGS = Object.freeze({

  maximumStepCount: 16,




  startLevel: 1,
  maximumLevel: 6,

  thicknessInViewDepth: 0.25,


  depthBiasInViewDepth: 0.02,

  startOffsetInTexels: 1,


  jitter: 0,
});


export const SCREEN_TRACE_STEP_BUDGET_BY_TIER = Object.freeze({
  fraco: 8,
  medio: 16,
  forte: 24,
});

export function screenTraceStepBudgetForTier(tierName) {
  const budget = SCREEN_TRACE_STEP_BUDGET_BY_TIER[tierName];
  return typeof budget === "number" ? budget : SCREEN_TRACE_STEP_BUDGET_BY_TIER.medio;
}

export function screenTraceSettingsForTier(tierName) {
  return Object.freeze(
    Object.assign({}, DEFAULT_SCREEN_TRACE_SETTINGS, {
      maximumStepCount: screenTraceStepBudgetForTier(tierName),
    }),
  );
}

function finiteNumberOr(value, fallback) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}


export function normalizeScreenTraceSettings(settings) {
  const requested = settings || {};
  const defaults = DEFAULT_SCREEN_TRACE_SETTINGS;
  return {
    maximumStepCount: Math.max(1, Math.floor(finiteNumberOr(requested.maximumStepCount, defaults.maximumStepCount))),
    startLevel: Math.max(0, Math.floor(finiteNumberOr(requested.startLevel, defaults.startLevel))),
    maximumLevel: Math.max(0, Math.floor(finiteNumberOr(requested.maximumLevel, defaults.maximumLevel))),
    thicknessInViewDepth: Math.max(0, finiteNumberOr(requested.thicknessInViewDepth, defaults.thicknessInViewDepth)),
    depthBiasInViewDepth: Math.max(0, finiteNumberOr(requested.depthBiasInViewDepth, defaults.depthBiasInViewDepth)),
    startOffsetInTexels: Math.max(0, finiteNumberOr(requested.startOffsetInTexels, defaults.startOffsetInTexels)),
    jitter: Math.min(1, Math.max(0, finiteNumberOr(requested.jitter, defaults.jitter))),
  };
}


export const SCREEN_TRACE_REFUSALS = Object.freeze([
  Object.freeze({
    code: "screenTrace.noVisibleWithoutReachingTheRayEnd",
    refuses: "answering visible for any reason other than reaching the end of the ray",
    because: "a step budget that runs out is a march that stopped early, not a light that is visible",
  }),
  Object.freeze({
    code: "screenTrace.noHitWithoutThickness",
    refuses: "calling every dip behind a surface a hit",
    because: "screen space cannot tell a thin sheet from a wall; beyond the assumed thickness the answer is unknown",
  }),
  Object.freeze({
    code: "screenTrace.noSilentSingleLevelFallback",
    refuses: "marching level 0 alone when the pyramid cannot be bound",
    because: "a silent linear march looks like a working phase and quietly removes the whole point of ML-F14",
  }),
  Object.freeze({
    code: "screenTrace.noScreenDerivativesInTraceGlsl",
    refuses: "dFdx, dFdy or fwidth anywhere in the trace shader",
    because: "screen derivatives are discontinuous on silhouettes and quantised in 2x2 pixel blocks - the engine paid for this one twice",
  }),
]);

export function screenTraceRefusalCodes() {
  return SCREEN_TRACE_REFUSALS.map((refusal) => refusal.code);
}
