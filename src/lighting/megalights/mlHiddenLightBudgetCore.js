import { MGL_HIDDEN_LIGHT_SAMPLE_FRACTION, MGL_MAX_SAMPLES_PER_PIXEL } from "./mlPipelineContract.js";
import { resolveHiddenSampleFraction } from "./mlHiddenLightRelaxationCore.js";

export const HIDDEN_LIGHT_BUDGET_LIMITS = Object.freeze({
  baseHiddenSampleFraction: MGL_HIDDEN_LIGHT_SAMPLE_FRACTION,
  maximumSampleBudget: MGL_MAX_SAMPLES_PER_PIXEL,
});

function finiteNumberOr(value, fallback) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}

function clampSampleBudget(rawSampleBudget, problems) {
  const requested = finiteNumberOr(rawSampleBudget, NaN);
  if (!Number.isFinite(requested)) {
    problems.push("no sample budget was given, so this pixel gets no sample at all");
    return 0;
  }
  const wholeSamples = Math.floor(requested);
  if (wholeSamples <= 0) return 0;
  if (wholeSamples > HIDDEN_LIGHT_BUDGET_LIMITS.maximumSampleBudget) {
    problems.push(
      "sample budget " + wholeSamples + " is above the contract ceiling of " +
        HIDDEN_LIGHT_BUDGET_LIMITS.maximumSampleBudget + " and was clamped",
    );
    return HIDDEN_LIGHT_BUDGET_LIMITS.maximumSampleBudget;
  }
  return wholeSamples;
}


function optionalCount(rawCount) {
  if (rawCount === null || rawCount === undefined) return null;
  const asNumber = Number(rawCount);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, Math.floor(asNumber));
}

function unitRangeOrNull(rawValue) {
  const asNumber = Number(rawValue);
  if (!Number.isFinite(asNumber)) return null;
  if (asNumber < 0 || asNumber >= 1) return null;
  return asNumber;
}














export function allocateSampleBudget(request) {
  const input = request || {};
  const problems = [];
  const sampleBudget = clampSampleBudget(input.sampleBudget, problems);
  const hiddenLightCount = optionalCount(input.hiddenLightCount);

  const relaxation = resolveHiddenSampleFraction({
    baseHiddenSampleFraction: HIDDEN_LIGHT_BUDGET_LIMITS.baseHiddenSampleFraction,
    visibleLightCount: input.visibleLightCount,
    visibleWeightSum: input.visibleWeightSum,
    historyReprojectionValid: input.historyReprojectionValid,
  });




  const hiddenLightsKnownToBeAbsent = hiddenLightCount === 0;
  const hiddenSampleFraction = hiddenLightsKnownToBeAbsent ? 0 : relaxation.hiddenSampleFraction;

  const targetHiddenSampleCount = sampleBudget * hiddenSampleFraction;
  const wholeHiddenSampleCount = Math.floor(targetHiddenSampleCount);
  const fractionalRemainder = targetHiddenSampleCount - wholeHiddenSampleCount;
  const randomValue = unitRangeOrNull(input.randomValue);

  let stochasticExtraSample = 0;
  if (fractionalRemainder > 0) {
    if (randomValue === null) {
      problems.push(
        "no blue noise value in [0, 1) was given, so " + fractionalRemainder.toFixed(3) +
          " of a hidden sample was dropped instead of drawn: with this budget a new light can never be found",
      );
    } else if (randomValue < fractionalRemainder) {
      stochasticExtraSample = 1;
    }
  }

  const hiddenSampleCount = Math.min(sampleBudget, wholeHiddenSampleCount + stochasticExtraSample);
  const guidedSampleCount = sampleBudget - hiddenSampleCount;

  return Object.freeze({
    sampleBudget,
    hiddenSampleCount,
    guidedSampleCount,

    hiddenSampleFraction,

    hiddenSampleShare: sampleBudget > 0 ? hiddenSampleCount / sampleBudget : 0,
    usedStochasticRemainder: stochasticExtraSample === 1,
    hiddenLightsKnownToBeAbsent,
    relaxation,
    problems: Object.freeze(problems),
  });
}


export function describeHiddenLightBudget() {
  return {
    baseHiddenSampleFraction: HIDDEN_LIGHT_BUDGET_LIMITS.baseHiddenSampleFraction,
    maximumSampleBudget: HIDDEN_LIGHT_BUDGET_LIMITS.maximumSampleBudget,
  };
}
