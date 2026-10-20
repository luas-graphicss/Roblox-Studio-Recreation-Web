export const HIDDEN_LIGHT_RELAXATION_REASON = Object.freeze({
  none: "none",
  emptyVisibleList: "emptyVisibleList",
  thinVisibleWeight: "thinVisibleWeight",
  historyReprojectionFailed: "historyReprojectionFailed",
});

export const HIDDEN_LIGHT_RELAXATION_LIMITS = Object.freeze({


  thinVisibleWeightSum: 1e-3,
  historyFailureHiddenSampleFraction: 0.5,
  fullyRelaxedHiddenSampleFraction: 1,
});

function finiteNumberOr(value, fallback) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}

function clampToUnitRange(value) {
  if (!(value > 0)) return 0;
  if (value > 1) return 1;
  return value;
}


export function resolveHiddenSampleFraction(request) {
  const input = request || {};
  const baseHiddenSampleFraction = clampToUnitRange(finiteNumberOr(input.baseHiddenSampleFraction, 0));
  const visibleLightCount = Math.max(0, Math.floor(finiteNumberOr(input.visibleLightCount, 0)));
  const visibleWeightSum = Math.max(0, finiteNumberOr(input.visibleWeightSum, 0));
  const historyReprojectionValid = input.historyReprojectionValid !== false;

  const triggeredReasons = [];
  let hiddenSampleFraction = baseHiddenSampleFraction;
  let appliedReason = HIDDEN_LIGHT_RELAXATION_REASON.none;

  function relaxTo(candidateFraction, reason) {
    triggeredReasons.push(reason);
    if (candidateFraction > hiddenSampleFraction) {
      hiddenSampleFraction = clampToUnitRange(candidateFraction);
      appliedReason = reason;
    }
  }

  const visibleListIsEmpty = visibleLightCount <= 0 || visibleWeightSum <= 0;
  if (visibleListIsEmpty) {
    relaxTo(
      HIDDEN_LIGHT_RELAXATION_LIMITS.fullyRelaxedHiddenSampleFraction,
      HIDDEN_LIGHT_RELAXATION_REASON.emptyVisibleList,
    );
  } else if (visibleWeightSum < HIDDEN_LIGHT_RELAXATION_LIMITS.thinVisibleWeightSum) {


    const emptinessRatio = 1 - visibleWeightSum / HIDDEN_LIGHT_RELAXATION_LIMITS.thinVisibleWeightSum;
    const thinWeightFraction =
      baseHiddenSampleFraction +
      (HIDDEN_LIGHT_RELAXATION_LIMITS.fullyRelaxedHiddenSampleFraction - baseHiddenSampleFraction) * emptinessRatio;
    relaxTo(thinWeightFraction, HIDDEN_LIGHT_RELAXATION_REASON.thinVisibleWeight);
  }

  if (!historyReprojectionValid) {
    relaxTo(
      HIDDEN_LIGHT_RELAXATION_LIMITS.historyFailureHiddenSampleFraction,
      HIDDEN_LIGHT_RELAXATION_REASON.historyReprojectionFailed,
    );
  }

  return Object.freeze({
    hiddenSampleFraction,
    baseHiddenSampleFraction,
    relaxed: hiddenSampleFraction > baseHiddenSampleFraction,
    appliedReason,
    triggeredReasons: Object.freeze(triggeredReasons),
    visibleLightCount,
    visibleWeightSum,
    historyReprojectionValid,
  });
}
