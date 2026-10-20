import { MGL_GATES, tierDefaults } from "./mlPipelineContract.js";

export const BUDGET_DECISION = Object.freeze({
  hold: "hold",
  spendLess: "spendLess",
  spendMore: "spendMore",
  refuse: "refuse",
});

export const BUDGET_REFUSAL = Object.freeze({
  none: "none",
  measurementInvalid:
    "the frame time is not admissible evidence (frozen clock or refused guard), and a governor driven by fiction is worse than a static budget",
  warmupWindow:
    "still inside the warmup window: three compiles programs lazily, so these frames contain a compile stall and not the steady cost",
  weakTierIsOptIn:
    "the weak tier stays off unless a human turns it on: a half-working MegaLights looks worse than the legacy path",
  alreadyAtMinimum: "the budget is already at its cheapest setting on this tier",
  alreadyAtTierCeiling: "the budget is already at the ceiling this tier declares",
});

export const BUDGET_LIMITS = Object.freeze({

  targetMillisecondsByTier: Object.freeze({ fraco: 16.6, medio: 16.6, forte: 11.1 }),

  spendLessAboveRatio: 1.1,
  spendMoreBelowRatio: 0.7,
  minimumSamplesPerPixel: 1,

  warmupFrameCount: 30,
  warmupSpikeMilliseconds: MGL_GATES.maxWarmupSpikeMilliseconds,
});

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function targetMillisecondsFor(tierName) {
  const target = BUDGET_LIMITS.targetMillisecondsByTier[tierName];
  return isNumber(target) ? target : BUDGET_LIMITS.targetMillisecondsByTier.medio;
}


export function samplesPerPixelRangeFor(tierName) {
  const defaults = tierDefaults(tierName) || {};
  const ceiling = isNumber(defaults.samplesPerPixel) ? defaults.samplesPerPixel : 1;
  return {
    minimum: BUDGET_LIMITS.minimumSamplesPerPixel,
    maximum: Math.max(BUDGET_LIMITS.minimumSamplesPerPixel, ceiling),
    tierCeiling: ceiling,
    tierEnabledByDefault: defaults.enabled === true,
  };
}

function refusal(reason, samplesPerPixel, tierName, measuredMilliseconds) {
  return {
    decision: BUDGET_DECISION.refuse,
    reason,
    tier: tierName,
    samplesPerPixel,
    previousSamplesPerPixel: samplesPerPixel,
    targetMilliseconds: targetMillisecondsFor(tierName),
    measuredMilliseconds: isNumber(measuredMilliseconds) ? measuredMilliseconds : null,
  };
}








export function budgetDecisionFor(request) {
  const input = request || {};
  const tierName = typeof input.tierName === "string" ? input.tierName : "medio";
  const range = samplesPerPixelRangeFor(tierName);
  const currentSamplesPerPixel = isNumber(input.currentSamplesPerPixel)
    ? Math.min(range.maximum, Math.max(range.minimum, Math.floor(input.currentSamplesPerPixel)))
    : range.maximum;
  const targetMilliseconds = targetMillisecondsFor(tierName);

  if (input.measurementIsValid !== true || !isNumber(input.measuredMilliseconds)) {
    return refusal(
      BUDGET_REFUSAL.measurementInvalid,
      currentSamplesPerPixel,
      tierName,
      input.measuredMilliseconds,
    );
  }
  if (!isNumber(input.framesSinceChange) || BUDGET_LIMITS.warmupFrameCount > input.framesSinceChange) {
    return refusal(BUDGET_REFUSAL.warmupWindow, currentSamplesPerPixel, tierName, input.measuredMilliseconds);
  }

  const measuredMilliseconds = input.measuredMilliseconds;
  const spendLessAbove = targetMilliseconds * BUDGET_LIMITS.spendLessAboveRatio;
  const spendMoreBelow = targetMilliseconds * BUDGET_LIMITS.spendMoreBelowRatio;

  const decisionBase = {
    tier: tierName,
    previousSamplesPerPixel: currentSamplesPerPixel,
    targetMilliseconds,
    measuredMilliseconds,
    spendLessAboveMilliseconds: spendLessAbove,
    spendMoreBelowMilliseconds: spendMoreBelow,
  };

  if (measuredMilliseconds > spendLessAbove) {
    if (currentSamplesPerPixel === range.minimum) {
      return Object.assign(refusal(BUDGET_REFUSAL.alreadyAtMinimum, currentSamplesPerPixel, tierName, measuredMilliseconds), decisionBase);
    }
    return Object.assign({}, decisionBase, {
      decision: BUDGET_DECISION.spendLess,
      reason: "the frame is over budget, so the sample count drops one step",
      samplesPerPixel: currentSamplesPerPixel - 1,
    });
  }

  if (spendMoreBelow > measuredMilliseconds) {


    if (!range.tierEnabledByDefault) {
      return Object.assign(refusal(BUDGET_REFUSAL.weakTierIsOptIn, currentSamplesPerPixel, tierName, measuredMilliseconds), decisionBase);
    }
    if (currentSamplesPerPixel === range.maximum) {
      return Object.assign(refusal(BUDGET_REFUSAL.alreadyAtTierCeiling, currentSamplesPerPixel, tierName, measuredMilliseconds), decisionBase);
    }
    return Object.assign({}, decisionBase, {
      decision: BUDGET_DECISION.spendMore,
      reason: "there is headroom under the target, so the sample count rises one step",
      samplesPerPixel: currentSamplesPerPixel + 1,
    });
  }

  return Object.assign({}, decisionBase, {
    decision: BUDGET_DECISION.hold,
    reason: "the frame time sits inside the hysteresis band around the target",
    samplesPerPixel: currentSamplesPerPixel,
  });
}


export function adaptedTierDefaults(tierName, decision) {
  const defaults = tierDefaults(tierName) || {};
  const samplesPerPixel =
    decision && isNumber(decision.samplesPerPixel) ? decision.samplesPerPixel : defaults.samplesPerPixel;
  return Object.assign({}, defaults, {
    samplesPerPixel,
    adaptedBy: "ML-F28",
    adaptedDecision: decision ? decision.decision : BUDGET_DECISION.refuse,
  });
}


export function looksLikeWarmupSpike(measuredMilliseconds) {
  return isNumber(measuredMilliseconds) && measuredMilliseconds > BUDGET_LIMITS.warmupSpikeMilliseconds;
}
