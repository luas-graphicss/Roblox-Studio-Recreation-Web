export const UPSAMPLE_TAP_SOURCE = Object.freeze({
  downsampledNeighbor: "downsampledNeighbor",
  history: "history",
  nearestNeighborLastResort: "nearestNeighborLastResort",
  hole: "hole",
});

export const UPSAMPLE_FALLBACK_REASON = Object.freeze({
  none: "none",
  everyNeighborRejected: "everyNeighborRejected",
  emptyDownsampledBuffer: "emptyDownsampledBuffer",
  historyMissing: "historyMissing",
  historyMarkedInvalid: "historyMarkedInvalid",
  historyNotAccumulated: "historyNotAccumulated",
  historyReprojectionInvalid: "historyReprojectionInvalid",
});


export function historyIsReusable(history) {
  if (!history) return { reusable: false, reason: UPSAMPLE_FALLBACK_REASON.historyMissing };
  if (history.isValid === false) {
    return { reusable: false, reason: UPSAMPLE_FALLBACK_REASON.historyMarkedInvalid };
  }
  if (history.reprojectionIsValid === false) {
    return { reusable: false, reason: UPSAMPLE_FALLBACK_REASON.historyReprojectionInvalid };
  }
  const accumulatedFrameCount = Number(history.accumulatedFrameCount);
  if (!(accumulatedFrameCount > 0)) {
    return { reusable: false, reason: UPSAMPLE_FALLBACK_REASON.historyNotAccumulated };
  }
  return { reusable: true, reason: UPSAMPLE_FALLBACK_REASON.none, accumulatedFrameCount };
}








export function resolveUpsampleFallback(request) {
  const settings = request || {};
  const trigger = settings.trigger || UPSAMPLE_FALLBACK_REASON.everyNeighborRejected;
  const historyDecision = historyIsReusable(settings.history);

  if (historyDecision.reusable) {
    return {
      source: UPSAMPLE_TAP_SOURCE.history,
      trigger,
      reason: trigger,
      usesHistory: true,
      historyAccumulatedFrameCount: historyDecision.accumulatedFrameCount,
      neighbor: null,
      isHole: false,
    };
  }

  const nearestNeighbor = settings.nearestNeighbor || null;
  if (nearestNeighbor) {
    return {
      source: UPSAMPLE_TAP_SOURCE.nearestNeighborLastResort,
      trigger,
      reason: historyDecision.reason,
      usesHistory: false,
      historyAccumulatedFrameCount: 0,
      neighbor: nearestNeighbor,
      isHole: false,
    };
  }


  return {
    source: UPSAMPLE_TAP_SOURCE.hole,
    trigger,
    reason: UPSAMPLE_FALLBACK_REASON.emptyDownsampledBuffer,
    usesHistory: false,
    historyAccumulatedFrameCount: 0,
    neighbor: null,
    isHole: true,
  };
}
