import { MGL_GUIDING_TILE_SIZE } from "./mlPipelineContract.js";
import { HIDDEN_LIGHT_BUDGET_LIMITS, allocateSampleBudget } from "./mlHiddenLightBudgetCore.js";
import { ML_GATE_COMPARISON, compareMeasurement } from "./mlGateComparisonCore.js";

export const HIDDEN_LIGHT_RECOVERY_GATES = Object.freeze({
  maximumFramesToRecover: 4,

  maximumBudgetedHiddenShare: HIDDEN_LIGHT_BUDGET_LIMITS.baseHiddenSampleFraction,


  realizedShareStandardDeviations: 3,
});


export function realizedHiddenShareCeiling(budgetedShare, totalSamples, standardDeviations) {
  const share = Number.isFinite(budgetedShare) ? budgetedShare : 0;
  const draws = Number.isFinite(totalSamples) && totalSamples > 0 ? totalSamples : 1;
  const sigmaCount = Number.isFinite(standardDeviations)
    ? standardDeviations
    : HIDDEN_LIGHT_RECOVERY_GATES.realizedShareStandardDeviations;
  return share + sigmaCount * Math.sqrt((share * (1 - share)) / draws);
}

export const HIDDEN_LIGHT_RECOVERY_DEFAULTS = Object.freeze({
  sampleBudget: 1,
  pixelCount: MGL_GUIDING_TILE_SIZE * MGL_GUIDING_TILE_SIZE,
  visibleLightCount: 4,
  visibleWeightSum: 4,
  strongHiddenLightWeight: 8,
  otherHiddenLightsWeightSum: 24,
  otherHiddenLightCount: 12,
  historyReprojectionValid: true,
  frameLimit: 8,
  noiseStreamOffset: 0,
});

const BUDGET_NOISE_STREAM = 0;
const DRAW_NOISE_STREAM = 1013;
const STREAM_STRIDE = 977;


export function deterministicUnitNoise(sequenceIndex, streamIndex) {
  let hashed = (Math.imul(sequenceIndex + 1, 374761393) + Math.imul(streamIndex + 1, 668265263)) | 0;
  hashed = Math.imul(hashed ^ (hashed >>> 13), 1274126177) | 0;
  return ((hashed ^ (hashed >>> 16)) >>> 0) / 4294967296;
}

function finiteNumberOr(value, fallback) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}


export function simulateHiddenLightRecovery(request) {
  const input = request || {};
  const settings = {};
  Object.keys(HIDDEN_LIGHT_RECOVERY_DEFAULTS).forEach((fieldName) => {
    const givenValue = input[fieldName];
    settings[fieldName] =
      fieldName === "historyReprojectionValid"
        ? givenValue !== false
        : finiteNumberOr(givenValue, HIDDEN_LIGHT_RECOVERY_DEFAULTS[fieldName]);
  });

  const hiddenWeightSum = settings.strongHiddenLightWeight + settings.otherHiddenLightsWeightSum;
  const strongLightPickProbability = hiddenWeightSum > 0 ? settings.strongHiddenLightWeight / hiddenWeightSum : 0;
  const hiddenLightCount = 1 + Math.max(0, Math.floor(settings.otherHiddenLightCount));

  const frames = [];
  let framesToRecover = null;
  let budgetedHiddenShareCeiling = 0;
  let totalHiddenSamples = 0;
  let totalSamples = 0;

  for (let frameIndex = 0; frameIndex < settings.frameLimit && framesToRecover === null; frameIndex++) {
    let hiddenSamplesInTile = 0;
    let budgetedHiddenShare = 0;

    for (let pixelIndex = 0; pixelIndex < settings.pixelCount; pixelIndex++) {
      const allocation = allocateSampleBudget({
        sampleBudget: settings.sampleBudget,
        visibleLightCount: settings.visibleLightCount,
        visibleWeightSum: settings.visibleWeightSum,
        hiddenLightCount,
        historyReprojectionValid: settings.historyReprojectionValid,
        randomValue: deterministicUnitNoise(
          frameIndex + settings.noiseStreamOffset * STREAM_STRIDE,
          pixelIndex + BUDGET_NOISE_STREAM,
        ),
      });
      hiddenSamplesInTile += allocation.hiddenSampleCount;
      budgetedHiddenShare = allocation.hiddenSampleFraction;
    }


    let strongLightWasDrawn = false;
    for (let sampleIndex = 0; sampleIndex < hiddenSamplesInTile && !strongLightWasDrawn; sampleIndex++) {
      const draw = deterministicUnitNoise(
        frameIndex + settings.noiseStreamOffset * STREAM_STRIDE,
        sampleIndex + DRAW_NOISE_STREAM,
      );
      if (draw < strongLightPickProbability) strongLightWasDrawn = true;
    }

    const samplesInTile = settings.pixelCount * settings.sampleBudget;
    totalHiddenSamples += hiddenSamplesInTile;
    totalSamples += samplesInTile;
    if (budgetedHiddenShare > budgetedHiddenShareCeiling) budgetedHiddenShareCeiling = budgetedHiddenShare;

    frames.push(
      Object.freeze({
        frameIndex,
        hiddenSamplesInTile,
        samplesInTile,
        budgetedHiddenShare,
        realizedHiddenShare: samplesInTile > 0 ? hiddenSamplesInTile / samplesInTile : 0,
        strongLightWasDrawn,
      }),
    );


    if (strongLightWasDrawn) framesToRecover = frameIndex + 1;
  }

  return Object.freeze({
    recovered: framesToRecover !== null,
    framesToRecover,
    budgetedHiddenShareCeiling,
    meanRealizedHiddenShare: totalSamples > 0 ? totalHiddenSamples / totalSamples : 0,


    totalHiddenSamples,
    totalSamples,
    frames: Object.freeze(frames),
  });
}

function gateRow(metric, comparison, measured, target, description) {
  const verdict = compareMeasurement(comparison, measured, target);
  return Object.freeze({ metric, comparison, measured, target, description, passed: verdict.passed, reason: verdict.reason });
}


export function evaluateHiddenLightRecovery(simulation, gates) {
  const limits = gates || HIDDEN_LIGHT_RECOVERY_GATES;
  const result = simulation || {};
  const rows = [
    gateRow(
      "framesToRecoverAStrongHiddenLight",
      ML_GATE_COMPARISON.atMost,
      result.framesToRecover === null || result.framesToRecover === undefined ? null : result.framesToRecover,
      limits.maximumFramesToRecover,
      "a light switched on must reach the visible light list within four frames",
    ),
    gateRow(
      "budgetedHiddenShareCeiling",
      ML_GATE_COMPARISON.atMost,
      result.budgetedHiddenShareCeiling,
      limits.maximumBudgetedHiddenShare,
      "while it is hidden, a strong light may never be promised more than the 20% budget",
    ),
    gateRow(
      "meanRealizedHiddenShare",
      ML_GATE_COMPARISON.atMost,
      result.meanRealizedHiddenShare,
      realizedHiddenShareCeiling(
        limits.maximumBudgetedHiddenShare,
        result.totalSamples,
        limits.realizedShareStandardDeviations,
      ),
      "integer rounding may wobble around the budget, but never drift away from it",
    ),
  ];
  const problems = rows.filter((row) => !row.passed).map((row) => row.metric + ": " + row.reason);
  return Object.freeze({ pass: problems.length === 0, rows: Object.freeze(rows), problems: Object.freeze(problems) });
}
