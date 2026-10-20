import { mixScalar, radianceFrom } from "./mlTemporalAccumulationCore.js";


export const LUMINANCE_WEIGHTS = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });

export const VARIANCE_LIMITS = Object.freeze({


  minimumFramesForTrustedVariance: 4,

  relativeVarianceFloor: 1e-6,
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function luminanceOf(radiance) {
  const value = radianceFrom(radiance);
  return (
    value.r * LUMINANCE_WEIGHTS.red + value.g * LUMINANCE_WEIGHTS.green + value.b * LUMINANCE_WEIGHTS.blue
  );
}


export function accumulateSecondMoment(request) {
  const input = request || {};
  const currentLuminance = finiteNumberOrFallback(input.currentLuminance, 0);
  return mixScalar(
    finiteNumberOrFallback(input.historySecondMoment, 0),
    currentLuminance * currentLuminance,
    input.blendWeight,
  );
}


export function varianceFromMoments(firstMoment, secondMoment) {
  const first = finiteNumberOrFallback(firstMoment, 0);
  const second = finiteNumberOrFallback(secondMoment, 0);
  return Math.max(0, second - first * first);
}


export function relativeVarianceFrom(variance, firstMoment) {
  const first = finiteNumberOrFallback(firstMoment, 0);
  return finiteNumberOrFallback(variance, 0) / Math.max(first * first, VARIANCE_LIMITS.relativeVarianceFloor);
}

export function varianceIsTrusted(accumulatedFrameCount) {
  return (
    Math.floor(finiteNumberOrFallback(accumulatedFrameCount, 0)) >=
    VARIANCE_LIMITS.minimumFramesForTrustedVariance
  );
}


export function offlineVarianceOf(luminanceSamples) {
  const samples = Array.isArray(luminanceSamples) ? luminanceSamples : [];
  if (samples.length === 0) return 0;
  let sum = 0;
  let sumOfSquares = 0;
  for (let index = 0; index < samples.length; index++) {
    const sample = finiteNumberOrFallback(samples[index], 0);
    sum += sample;
    sumOfSquares += sample * sample;
  }
  const mean = sum / samples.length;
  return Math.max(0, sumOfSquares / samples.length - mean * mean);
}


export function exponentialVarianceBiasRatio(blendWeight) {
  const weight = Math.min(1, Math.max(0, finiteNumberOrFallback(blendWeight, 1)));
  return weight / (2 - weight);
}
