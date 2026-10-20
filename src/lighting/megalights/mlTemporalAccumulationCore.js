export const ACCUMULATION_LIMITS = Object.freeze({

  maximumHistoryFrameCount: 16,
  minimumBlendWeight: 1 / 16,
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}


export function radianceFrom(value) {
  if (Array.isArray(value)) {
    return Object.freeze({
      r: finiteNumberOrFallback(value[0], 0),
      g: finiteNumberOrFallback(value[1], 0),
      b: finiteNumberOrFallback(value[2], 0),
    });
  }
  const source = value || {};
  return Object.freeze({
    r: finiteNumberOrFallback(source.r, 0),
    g: finiteNumberOrFallback(source.g, 0),
    b: finiteNumberOrFallback(source.b, 0),
  });
}


export function mixScalar(historyValue, currentValue, blendWeight) {
  const weight = Math.min(1, Math.max(0, finiteNumberOrFallback(blendWeight, 1)));
  return finiteNumberOrFallback(historyValue, 0) * (1 - weight) + finiteNumberOrFallback(currentValue, 0) * weight;
}

export function mixRadiance(historyRadiance, currentRadiance, blendWeight) {
  const history = radianceFrom(historyRadiance);
  const current = radianceFrom(currentRadiance);
  return Object.freeze({
    r: mixScalar(history.r, current.r, blendWeight),
    g: mixScalar(history.g, current.g, blendWeight),
    b: mixScalar(history.b, current.b, blendWeight),
  });
}


export function clampHistoryFrameCount(accumulatedFrameCount) {
  const frames = Math.floor(finiteNumberOrFallback(accumulatedFrameCount, 0));
  if (frames < 0) return 0;
  return Math.min(ACCUMULATION_LIMITS.maximumHistoryFrameCount, frames);
}


export function blendWeightFor(historyFrameCount, historyAccepted) {
  if (!historyAccepted) return 1;
  const frames = clampHistoryFrameCount(historyFrameCount);
  return Math.max(ACCUMULATION_LIMITS.minimumBlendWeight, 1 / (frames + 1));
}


export function nextAccumulatedFrameCount(historyFrameCount, historyAccepted) {
  if (!historyAccepted) return 1;
  return Math.min(
    ACCUMULATION_LIMITS.maximumHistoryFrameCount,
    clampHistoryFrameCount(historyFrameCount) + 1,
  );
}


export function accumulateRadiance(request) {
  const input = request || {};
  const blendWeight = Math.min(1, Math.max(0, finiteNumberOrFallback(input.blendWeight, 1)));
  return Object.freeze({
    radiance: mixRadiance(input.historyRadiance, input.currentRadiance, blendWeight),
    blendWeight,
  });
}
