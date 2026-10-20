import { MGL_DISOCCLUSION_FRAME_COUNT } from "./mlPipelineContract.js";

export const SHADING_CONFIDENCE_DEFINITION = Object.freeze({

  historyLengthAndRelativeVariance: "historyLengthAndRelativeVariance",

  guidedEnergyFraction: "guidedEnergyFraction",
});

export const SHADING_CONFIDENCE_DEFAULTS = Object.freeze({


  convergedFrameCount: MGL_DISOCCLUSION_FRAME_COUNT * 2,

  relativeVarianceAtZeroConfidence: 1,
  minimumLuminance: 1e-4,
  quantisationSteps: 255,
});

function clampToUnitRange(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}


export function varianceFromSecondMoment(mean, secondMoment) {
  const meanValue = Number(mean) || 0;
  const secondMomentValue = Number(secondMoment) || 0;
  return Math.max(0, secondMomentValue - meanValue * meanValue);
}


export function resolveShadingConfidence(request) {
  const settings = request || {};
  const framesOfHistory = Math.max(0, Math.floor(Number(settings.framesOfHistory) || 0));
  const luminance = Math.max(0, Number(settings.luminance) || 0);
  const variance = varianceFromSecondMoment(luminance, settings.secondMoment);

  const historyFactor = clampToUnitRange(
    framesOfHistory / SHADING_CONFIDENCE_DEFAULTS.convergedFrameCount,
  );

  const luminanceFloor = Math.max(SHADING_CONFIDENCE_DEFAULTS.minimumLuminance, luminance);
  const relativeVariance = variance / (luminanceFloor * luminanceFloor);
  const varianceFactor = clampToUnitRange(
    1 - relativeVariance / SHADING_CONFIDENCE_DEFAULTS.relativeVarianceAtZeroConfidence,
  );

  const steps = SHADING_CONFIDENCE_DEFAULTS.quantisationSteps;
  const confidence = Math.round(clampToUnitRange(historyFactor * varianceFactor) * steps) / steps;

  return Object.freeze({
    confidence,
    historyFactor,
    varianceFactor,
    relativeVariance,
    definition: SHADING_CONFIDENCE_DEFINITION.historyLengthAndRelativeVariance,
  });
}
