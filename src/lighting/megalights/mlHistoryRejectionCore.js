export const HISTORY_REJECTION_LIMITS = Object.freeze({

  relativeDepthTolerance: 0.05,

  minimumNormalCosine: 0.9063,
  normalToleranceInDegrees: 25,

  minimumAcceptedTapWeight: 1e-4,
});

export const HISTORY_REJECTION_REASON = Object.freeze({
  accepted: "accepted",
  outsideFrame: "outsideFrame",
  missingSample: "missingSample",
  emptyHistory: "emptyHistory",
  depthMismatch: "depthMismatch",
  normalMismatch: "normalMismatch",
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function vectorFrom(value) {
  const source = value || {};
  if (Array.isArray(value)) {
    return {
      x: finiteNumberOrFallback(value[0], 0),
      y: finiteNumberOrFallback(value[1], 0),
      z: finiteNumberOrFallback(value[2], 0),
    };
  }
  return {
    x: finiteNumberOrFallback(source.x, 0),
    y: finiteNumberOrFallback(source.y, 0),
    z: finiteNumberOrFallback(source.z, 0),
  };
}


export function normalCosine(currentNormal, previousNormal) {
  const current = vectorFrom(currentNormal);
  const previous = vectorFrom(previousNormal);
  const currentLength = Math.sqrt(current.x * current.x + current.y * current.y + current.z * current.z);
  const previousLength = Math.sqrt(previous.x * previous.x + previous.y * previous.y + previous.z * previous.z);
  if (currentLength <= 0 || previousLength <= 0) return 0;
  const dot = current.x * previous.x + current.y * previous.y + current.z * previous.z;
  return dot / (currentLength * previousLength);
}


export function relativeDepthDifference(currentDepth, previousDepth) {
  const current = finiteNumberOrFallback(currentDepth, 0);
  const previous = finiteNumberOrFallback(previousDepth, 0);
  const scale = Math.max(Math.abs(current), Math.abs(previous), 1e-6);
  return Math.abs(current - previous) / scale;
}










export function testHistoryTap(request) {
  const input = request || {};
  const tap = input.tap || {};
  if (!tap.insideFrame) {
    return Object.freeze({ accepted: false, reason: HISTORY_REJECTION_REASON.outsideFrame });
  }
  const historySample = input.historySample;
  if (!historySample) {
    return Object.freeze({ accepted: false, reason: HISTORY_REJECTION_REASON.missingSample });
  }
  if (!(finiteNumberOrFallback(historySample.accumulatedFrameCount, 0) > 0)) {
    return Object.freeze({ accepted: false, reason: HISTORY_REJECTION_REASON.emptyHistory });
  }
  if (
    relativeDepthDifference(input.currentDepth, historySample.depth) >
    HISTORY_REJECTION_LIMITS.relativeDepthTolerance
  ) {
    return Object.freeze({ accepted: false, reason: HISTORY_REJECTION_REASON.depthMismatch });
  }
  if (normalCosine(input.currentNormal, historySample.normal) < HISTORY_REJECTION_LIMITS.minimumNormalCosine) {
    return Object.freeze({ accepted: false, reason: HISTORY_REJECTION_REASON.normalMismatch });
  }
  return Object.freeze({ accepted: true, reason: HISTORY_REJECTION_REASON.accepted });
}


export function resolveHistoryTapWeights(request) {
  const input = request || {};
  const taps = Array.isArray(input.taps) ? input.taps : [];
  const sampleHistory = typeof input.sampleHistory === "function" ? input.sampleHistory : () => null;

  const evaluated = [];
  let acceptedWeightSum = 0;
  for (let index = 0; index < taps.length; index++) {
    const tap = taps[index];
    const historySample = tap && tap.insideFrame ? sampleHistory(tap.pixelX, tap.pixelY) : null;
    const verdict = testHistoryTap({
      tap,
      currentDepth: input.currentDepth,
      currentNormal: input.currentNormal,
      historySample,
    });
    const weight = verdict.accepted ? finiteNumberOrFallback(tap.weight, 0) : 0;
    acceptedWeightSum += weight;
    evaluated.push({
      pixelX: tap ? tap.pixelX : 0,
      pixelY: tap ? tap.pixelY : 0,
      weight,
      reason: verdict.reason,
      historySample: verdict.accepted ? historySample : null,
    });
  }

  const historyAccepted = acceptedWeightSum > HISTORY_REJECTION_LIMITS.minimumAcceptedTapWeight;
  const resolvedTaps = evaluated.map((tap) =>
    Object.freeze({
      pixelX: tap.pixelX,
      pixelY: tap.pixelY,
      weight: tap.weight,
      normalizedWeight: historyAccepted ? tap.weight / acceptedWeightSum : 0,
      reason: tap.reason,
      historySample: tap.historySample,
    }),
  );

  return Object.freeze({
    taps: Object.freeze(resolvedTaps),
    acceptedWeightSum,
    acceptedTapCount: resolvedTaps.filter((tap) => tap.weight > 0).length,
    historyAccepted,


    normalizedWeightSum: resolvedTaps.reduce((total, tap) => total + tap.normalizedWeight, 0),
  });
}
