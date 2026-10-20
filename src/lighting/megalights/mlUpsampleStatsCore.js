import { UPSAMPLE_TAP_SOURCE } from "./mlUpsampleFallbackCore.js";

export const UPSAMPLE_ACCEPTANCE = Object.freeze({
  maximumHolePixels: 0,
  minimumSsimVersusFullRateSampling: 0.995,
  proofSceneId: "scene04",
  proofSceneTitle: "studio rect lights",
});

function emptyCounters() {
  return {
    resolvedPixels: 0,
    neighborTaps: 0,
    historyFallbacks: 0,
    nearestNeighborLastResorts: 0,
    holePixels: 0,
    stochasticChoices: 0,
    deterministicChoices: 0,
    clampedFootprints: 0,
    rejectedTaps: 0,
    rejectionsByReason: {
      outsideBuffer: 0,
      missingGeometry: 0,
      depthDisagreement: 0,
      normalDisagreement: 0,
    },
  };
}


export function createUpsampleStats() {
  let counters = emptyCounters();

  function record(resolution) {
    if (!resolution) return counters;
    counters.resolvedPixels++;

    if (resolution.source === UPSAMPLE_TAP_SOURCE.downsampledNeighbor) counters.neighborTaps++;
    else if (resolution.source === UPSAMPLE_TAP_SOURCE.history) counters.historyFallbacks++;
    else if (resolution.source === UPSAMPLE_TAP_SOURCE.nearestNeighborLastResort) {
      counters.nearestNeighborLastResorts++;
    } else counters.holePixels++;

    if (resolution.usedStochasticChoice) counters.stochasticChoices++;
    else counters.deterministicChoices++;

    if (resolution.footprint && resolution.footprint.clampedNeighborCount > 0) counters.clampedFootprints++;

    const rejections = resolution.rejections || {};
    Object.keys(counters.rejectionsByReason).forEach((reason) => {
      const count = Number(rejections[reason]) || 0;
      counters.rejectionsByReason[reason] += count;
      counters.rejectedTaps += count;
    });
    return counters;
  }

  function snapshot() {
    const resolvedPixels = counters.resolvedPixels;
    const fallbackPixels = counters.historyFallbacks + counters.nearestNeighborLastResorts;
    const share = (count) => (resolvedPixels > 0 ? count / resolvedPixels : 0);
    return {
      resolvedPixels,
      neighborTaps: counters.neighborTaps,
      historyFallbacks: counters.historyFallbacks,
      nearestNeighborLastResorts: counters.nearestNeighborLastResorts,
      holePixels: counters.holePixels,
      stochasticChoices: counters.stochasticChoices,
      deterministicChoices: counters.deterministicChoices,
      clampedFootprints: counters.clampedFootprints,
      rejectedTaps: counters.rejectedTaps,
      rejectionsByReason: Object.assign({}, counters.rejectionsByReason),
      fallbackPixels,
      historyFallbackShare: share(counters.historyFallbacks),
      fallbackShare: share(fallbackPixels),
      holeShare: share(counters.holePixels),


      everyPixelAccountedFor:
        counters.neighborTaps +
          counters.historyFallbacks +
          counters.nearestNeighborLastResorts +
          counters.holePixels ===
        resolvedPixels,
      meetsNoHoleGate: counters.holePixels === UPSAMPLE_ACCEPTANCE.maximumHolePixels,
    };
  }

  function reset() {
    counters = emptyCounters();
    return counters;
  }

  return { record, snapshot, reset };
}


export function describeUpsampleStats(statsSnapshot) {
  if (!statsSnapshot) return "no upsample statistics yet";
  return (
    statsSnapshot.resolvedPixels +
    " pixels resolved: " +
    statsSnapshot.neighborTaps +
    " from a downsampled tap, " +
    statsSnapshot.historyFallbacks +
    " from history, " +
    statsSnapshot.nearestNeighborLastResorts +
    " from the nearest tap as a last resort, " +
    statsSnapshot.holePixels +
    " holes (gate: 0)"
  );
}
