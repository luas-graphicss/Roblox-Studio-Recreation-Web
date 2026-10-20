import { REPROJECTION_STATUS, reprojectPixel } from "./mlTemporalReprojectionCore.js";
import { resolveHistoryTapWeights } from "./mlHistoryRejectionCore.js";
import {
  ACCUMULATION_LIMITS,
  blendWeightFor,
  mixRadiance,
  mixScalar,
  nextAccumulatedFrameCount,
  radianceFrom,
} from "./mlTemporalAccumulationCore.js";
import {
  accumulateSecondMoment,
  luminanceOf,
  relativeVarianceFrom,
  varianceFromMoments,
  varianceIsTrusted,
} from "./mlTemporalVarianceCore.js";


export const TEMPORAL_FILTER_PASS_NAME = "temporalFilter";
export const TEMPORAL_FILTER_PHASE_ID = "ML-F20";
export const TEMPORAL_FILTER_HISTORY_FRAME_COUNT = ACCUMULATION_LIMITS.maximumHistoryFrameCount;

export const TEMPORAL_RESOLVE_REASON = Object.freeze({
  accumulated: "accumulated",
  historyRejected: "historyRejected",
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function weightedHistoryOf(resolvedTaps) {
  const total = {
    diffuse: { r: 0, g: 0, b: 0 },
    specular: { r: 0, g: 0, b: 0 },
    diffuseSecondMoment: 0,
    specularSecondMoment: 0,
    accumulatedFrameCount: 0,
  };
  for (let index = 0; index < resolvedTaps.length; index++) {
    const tap = resolvedTaps[index];
    const weight = finiteNumberOrFallback(tap.normalizedWeight, 0);
    if (weight <= 0 || !tap.historySample) continue;
    const sample = tap.historySample;
    const diffuse = radianceFrom(sample.diffuse);
    const specular = radianceFrom(sample.specular);
    total.diffuse.r += diffuse.r * weight;
    total.diffuse.g += diffuse.g * weight;
    total.diffuse.b += diffuse.b * weight;
    total.specular.r += specular.r * weight;
    total.specular.g += specular.g * weight;
    total.specular.b += specular.b * weight;
    total.diffuseSecondMoment += finiteNumberOrFallback(sample.diffuseSecondMoment, 0) * weight;
    total.specularSecondMoment += finiteNumberOrFallback(sample.specularSecondMoment, 0) * weight;
    total.accumulatedFrameCount += finiteNumberOrFallback(sample.accumulatedFrameCount, 0) * weight;
  }
  return total;
}

function resolveChannel(request) {
  const currentRadiance = radianceFrom(request.currentRadiance);
  const radiance = request.historyAccepted
    ? mixRadiance(request.historyRadiance, currentRadiance, request.blendWeight)
    : currentRadiance;
  const secondMoment = accumulateSecondMoment({
    historySecondMoment: request.historyAccepted ? request.historySecondMoment : 0,
    currentLuminance: luminanceOf(currentRadiance),
    blendWeight: request.historyAccepted ? request.blendWeight : 1,
  });


  const firstMoment = luminanceOf(radiance);
  const variance = varianceFromMoments(firstMoment, secondMoment);
  return Object.freeze({
    radiance,
    firstMoment,
    secondMoment,
    variance,
    relativeVariance: relativeVarianceFrom(variance, firstMoment),
  });
}


export function resolveTemporalPixel(request) {
  const input = request || {};
  const current = input.current || {};

  const reprojection = reprojectPixel({
    pixelX: input.pixelX,
    pixelY: input.pixelY,
    frame: input.frame,
    screenVelocity: input.screenVelocity,
    encodedVelocity: input.encodedVelocity,
    velocityIsValid: input.velocityIsValid,
  });

  const historyWeights = resolveHistoryTapWeights({
    taps: reprojection.taps,
    currentDepth: current.depth,
    currentNormal: current.normal,
    sampleHistory: input.sampleHistory,
  });

  const historyAccepted =
    reprojection.status === REPROJECTION_STATUS.reprojected && historyWeights.historyAccepted;
  const history = weightedHistoryOf(historyWeights.taps);
  const blendWeight = blendWeightFor(history.accumulatedFrameCount, historyAccepted);
  const accumulatedFrameCount = nextAccumulatedFrameCount(history.accumulatedFrameCount, historyAccepted);

  const diffuse = resolveChannel({
    currentRadiance: current.diffuse,
    historyRadiance: history.diffuse,
    historySecondMoment: history.diffuseSecondMoment,
    historyAccepted,
    blendWeight,
  });
  const specular = resolveChannel({
    currentRadiance: current.specular,
    historyRadiance: history.specular,
    historySecondMoment: history.specularSecondMoment,
    historyAccepted,
    blendWeight,
  });

  return Object.freeze({
    historyAccepted,
    reason: historyAccepted
      ? TEMPORAL_RESOLVE_REASON.accumulated
      : reprojection.status === REPROJECTION_STATUS.reprojected
        ? TEMPORAL_RESOLVE_REASON.historyRejected
        : reprojection.status,
    blendWeight,
    accumulatedFrameCount,
    varianceIsTrusted: varianceIsTrusted(accumulatedFrameCount),
    diffuse,
    specular,
    reprojection,
    historyWeights,
  });
}


export function simulateTemporalSequence(request) {
  const input = request || {};
  const frameCount = Math.max(1, Math.floor(finiteNumberOrFallback(input.frameCount, 16)));
  const frame = input.frame || { width: 4, height: 4 };
  const pixelX = Math.round(finiteNumberOrFallback(input.pixelX, 1));
  const pixelY = Math.round(finiteNumberOrFallback(input.pixelY, 1));
  const sampleAt =
    typeof input.sampleAt === "function"
      ? input.sampleAt
      : () => ({ diffuse: { r: 1, g: 1, b: 1 }, specular: { r: 0, g: 0, b: 0 }, depth: 1, normal: { x: 0, y: 0, z: 1 } });

  let history = input.initialHistory || null;
  const frames = [];
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    const sample = sampleAt(frameIndex) || {};
    const resolved = resolveTemporalPixel({
      pixelX,
      pixelY,
      frame,
      current: {
        diffuse: sample.diffuse,
        specular: sample.specular,
        depth: finiteNumberOrFallback(sample.depth, 1),
        normal: sample.normal || { x: 0, y: 0, z: 1 },
      },
      screenVelocity: sample.screenVelocity || [0, 0],
      velocityIsValid: sample.velocityIsValid === undefined ? true : !!sample.velocityIsValid,
      sampleHistory: (tapX, tapY) => (history && tapX === pixelX && tapY === pixelY ? history : null),
    });
    frames.push(resolved);
    history = Object.freeze({
      diffuse: resolved.diffuse.radiance,
      specular: resolved.specular.radiance,
      diffuseSecondMoment: resolved.diffuse.secondMoment,
      specularSecondMoment: resolved.specular.secondMoment,
      accumulatedFrameCount: resolved.accumulatedFrameCount,
      depth: finiteNumberOrFallback(sample.depth, 1),
      normal: sample.normal || { x: 0, y: 0, z: 1 },
    });
  }

  return Object.freeze({ frames: Object.freeze(frames), history });
}


export function blendScalarForSpec(historyValue, currentValue, blendWeight) {
  return mixScalar(historyValue, currentValue, blendWeight);
}
