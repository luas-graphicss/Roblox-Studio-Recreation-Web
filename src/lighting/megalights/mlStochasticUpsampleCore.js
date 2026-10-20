import { downsampledFootprint, nearestNeighborOf } from "./mlUpsampleNeighborhoodCore.js";
import { EDGE_STOPPING_DEFAULTS, UPSAMPLE_REJECTION, neighborEdgeWeight } from "./mlUpsampleEdgeWeightCore.js";
import { selectWeightedTap } from "./mlUpsampleTapSelectionCore.js";
import {
  UPSAMPLE_FALLBACK_REASON,
  UPSAMPLE_TAP_SOURCE,
  resolveUpsampleFallback,
} from "./mlUpsampleFallbackCore.js";

function emptyRejectionCounts() {
  return {
    outsideBuffer: 0,
    missingGeometry: 0,
    depthDisagreement: 0,
    normalDisagreement: 0,
  };
}

function countRejections(candidates) {
  const counts = emptyRejectionCounts();
  candidates.forEach((candidate) => {
    if (candidate.rejection === UPSAMPLE_REJECTION.none) return;
    if (Object.prototype.hasOwnProperty.call(counts, candidate.rejection)) counts[candidate.rejection]++;
  });
  return counts;
}


export function resolveUpsampledPixel(request) {
  const settings = request || {};
  const edgeStopping = Object.assign({}, EDGE_STOPPING_DEFAULTS, settings.edgeStopping || {});
  const readNeighborGeometry =
    typeof settings.readNeighborGeometry === "function" ? settings.readNeighborGeometry : () => null;

  const footprint = downsampledFootprint({
    pixelX: settings.pixelX,
    pixelY: settings.pixelY,
    downsampleFactor: settings.downsampleFactor,
    downsampledWidth: settings.downsampledWidth,
    downsampledHeight: settings.downsampledHeight,
  });

  const candidates = footprint.neighbors.map((neighbor) => {
    const geometry = neighbor.isInsideBuffer ? readNeighborGeometry(neighbor.x, neighbor.y) : null;
    const verdict = neighborEdgeWeight({
      isInsideBuffer: neighbor.isInsideBuffer,
      centerDepth: settings.centerDepth,
      centerNormal: settings.centerNormal,
      neighborDepth: geometry ? geometry.depth : null,
      neighborNormal: geometry ? geometry.normal : null,
      depthWeight: edgeStopping.depthWeight,
      normalWeight: edgeStopping.normalWeight,
      minimumSimilarity: edgeStopping.minimumSimilarity,
    });
    return Object.assign({}, neighbor, {
      geometry: geometry || null,
      depthSimilarity: verdict.depthSimilarity,
      normalSimilarity: verdict.normalSimilarity,
      edgeWeight: verdict.edgeWeight,
      accepted: verdict.accepted,
      rejection: verdict.rejection,
      combinedWeight: neighbor.bilinearWeight * verdict.edgeWeight,
    });
  });

  const rejections = countRejections(candidates);
  const acceptedNeighborCount = candidates.filter((candidate) => candidate.accepted).length;

  if (acceptedNeighborCount === 0) {
    const fallback = resolveUpsampleFallback({
      trigger: footprint.isEmptyBuffer
        ? UPSAMPLE_FALLBACK_REASON.emptyDownsampledBuffer
        : UPSAMPLE_FALLBACK_REASON.everyNeighborRejected,
      history: settings.history,
      nearestNeighbor: nearestNeighborOf(footprint),
    });
    return {
      source: fallback.source,
      neighbor: fallback.neighbor,
      chosenProbability: 0,
      usedStochasticChoice: false,
      acceptedNeighborCount: 0,
      rejections,
      candidates,
      footprint,
      fallback,
      problems: [],
    };
  }

  const selection = selectWeightedTap({
    candidateWeights: candidates.map((candidate) => candidate.combinedWeight),
    randomValue: settings.randomValue,
  });
  const chosen = selection.chosenIndex === -1 ? null : candidates[selection.chosenIndex] || null;

  if (!chosen) {


    const fallback = resolveUpsampleFallback({
      trigger: UPSAMPLE_FALLBACK_REASON.everyNeighborRejected,
      history: settings.history,
      nearestNeighbor: nearestNeighborOf(footprint),
    });
    return {
      source: fallback.source,
      neighbor: fallback.neighbor,
      chosenProbability: 0,
      usedStochasticChoice: false,
      acceptedNeighborCount,
      rejections,
      candidates,
      footprint,
      fallback,
      problems: selection.problems,
    };
  }

  return {
    source: UPSAMPLE_TAP_SOURCE.downsampledNeighbor,
    neighbor: chosen,
    chosenProbability: selection.chosenProbability,
    usedStochasticChoice: selection.usedStochasticChoice,
    acceptedNeighborCount,
    rejections,
    candidates,
    footprint,
    fallback: null,
    problems: selection.problems,
  };
}
