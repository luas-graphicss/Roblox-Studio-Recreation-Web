import { REC709_LUMINANCE_WEIGHTS } from "../llFireflyClampCore.js";

export const MSM_HISTORY_FALLBACK_OWNER = "MSM-F29";


export const MSM_COARSE_MIP_LEVEL = 1;


export const MSM_FIREFLY_FRAME_LUMINANCE_RATIO = 0.001;


export const MSM_FALLBACK_MINIMUM_LUMINANCE = 0.000001;

export const MSM_NO_CONFIDENCE = 0;
export const MSM_FULL_CONFIDENCE = 1;


export const MSM_LUMINANCE_WEIGHTS = Object.freeze([
  REC709_LUMINANCE_WEIGHTS.red,
  REC709_LUMINANCE_WEIGHTS.green,
  REC709_LUMINANCE_WEIGHTS.blue,
]);


export const MSM_HISTORY_FALLBACK_INJECTED_INPUTS = Object.freeze([
  Object.freeze({
    name: "historyColor",
    providedBy: "MSM-F26",
    whyNotHere: "reprojecting the history is the temporal pass; this phase only stands in when it is unusable",
  }),
  Object.freeze({
    name: "historyConfidence",
    providedBy: "MSM-F26",
    whyNotHere: "the depth and motion rejection that produces the confidence belongs to the temporal pass",
  }),
  Object.freeze({
    name: "neighborhoodMin",
    providedBy: "MSM-F26",
    whyNotHere: "the 3x3 envelope is already read by the temporal clamp - gathering it again would cost 8 extra taps",
  }),
  Object.freeze({
    name: "neighborhoodMax",
    providedBy: "MSM-F26",
    whyNotHere: "same envelope, same taps: it is cheaper to receive it than to gather it twice",
  }),
  Object.freeze({
    name: "coarsePrior",
    providedBy: "MSM-F29 in GLSL (one fetch of mip 1) and by the caller in Node",
    whyNotHere: "Node has no sampler, so the mirror receives the colour the shader fetches",
  }),
  Object.freeze({
    name: "frameLuminance",
    providedBy: "MSM-F31 telemetry",
    whyNotHere: "a frame average is a measurement, not shading; 0 is accepted and makes the ceiling stricter",
  }),
]);


export const MSM_HISTORY_FALLBACK_CONSUMER_READY = false;


export const MSM_HISTORY_FALLBACK_MIRROR_ARGUMENT_ORDER = Object.freeze({
  msmFallbackLuminance: Object.freeze(["color"]),
  msmFireflyCeilingLuminance: Object.freeze(["neighborhoodMaxLuminance", "frameLuminance"]),
  msmFallbackTargetLuminance: Object.freeze(["luminance", "minimumLuminance", "maximumLuminance"]),
  msmFallbackScale: Object.freeze(["luminance", "targetLuminance"]),
  msmScaleColorToLuminance: Object.freeze(["color", "minimumLuminance", "maximumLuminance", "target"]),
  msmFallbackPriorColor: Object.freeze([
    "coarsePrior",
    "coarsePriorConfidence",
    "neighborhoodMin",
    "neighborhoodMax",
    "target",
  ]),
  msmFireflyClampedSample: Object.freeze(["currentSample", "neighborhoodMax", "frameLuminance", "target"]),
  msmHistorySubstitute: Object.freeze([
    "coarsePrior",
    "coarsePriorConfidence",
    "neighborhoodMin",
    "neighborhoodMax",
    "frameLuminance",
    "target",
  ]),
  msmResolvedHistory: Object.freeze([
    "historyColor",
    "historyConfidence",
    "coarsePrior",
    "coarsePriorConfidence",
    "neighborhoodMin",
    "neighborhoodMax",
    "frameLuminance",
    "target",
  ]),
});


export const MSM_HISTORY_FALLBACK_JS_ONLY_ARGUMENT = "target";


export const MSM_HISTORY_FALLBACK_MIRROR_DIFFERENCES = Object.freeze([
  Object.freeze({
    name: "target",
    side: "js",
    why: "GLSL returns a vec3; the mirror writes into an array owned by the caller so it allocates nothing",
  }),
  Object.freeze({
    name: "msmHistoryCoarsePrior",
    side: "glsl",
    why: "the fetch of mip 1 needs a sampler, which does not exist in Node",
  }),
  Object.freeze({
    name: "non finite sanitation",
    side: "js",
    why: "Node receives numbers from tests and telemetry; on the GPU a NaN is forbidden upstream by the guarded divisions of MSM-F18 and MSM-F19",
  }),
  Object.freeze({
    name: "float precision",
    side: "js",
    why: "the mirror computes in float64 and the GPU in float32, so equality is asserted on the declared numbers and not on the last bit of a pixel",
  }),
]);


export const MSM_REFUSED_CLAMP_MODES = Object.freeze([
  Object.freeze({
    id: "per-channel-clip",
    shape: "clamp(color, neighborhoodMin, neighborhoodMax) channel by channel",
    whyRefused:
      "it clips red, green and blue independently, so the hue walks towards the colour of the envelope and a clamped warm spark comes back grey",
  }),
  Object.freeze({
    id: "hard-luminance-ceiling",
    shape: "one authored maximum luminance for the whole frame",
    whyRefused:
      "an authored ceiling is a magic number that depends on exposure and on the scene; the envelope of the neighbours is measured, not invented",
  }),
]);

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function channelOr(color, index) {
  return Array.isArray(color) ? finiteOr(Number(color[index]), 0) : 0;
}


function positiveChannel(color, index) {
  return Math.max(channelOr(color, index), 0);
}

function clampConfidence(value) {
  const confidence = finiteOr(Number(value), MSM_NO_CONFIDENCE);
  if (confidence > MSM_FULL_CONFIDENCE) return MSM_FULL_CONFIDENCE;
  if (MSM_NO_CONFIDENCE > confidence) return MSM_NO_CONFIDENCE;
  return confidence;
}


export function createFallbackColor() {
  return [0, 0, 0];
}


const operationCounter = {
  resolvedHistoryCalls: 0,
  luminanceEvaluations: 0,
  colorScaleEvaluations: 0,
};

export function readMsmHistoryFallbackCounter() {
  return {
    resolvedHistoryCalls: operationCounter.resolvedHistoryCalls,
    luminanceEvaluations: operationCounter.luminanceEvaluations,
    colorScaleEvaluations: operationCounter.colorScaleEvaluations,
  };
}

export function resetMsmHistoryFallbackCounter() {
  operationCounter.resolvedHistoryCalls = 0;
  operationCounter.luminanceEvaluations = 0;
  operationCounter.colorScaleEvaluations = 0;
}


export function msmFallbackLuminance(color) {
  operationCounter.luminanceEvaluations += 1;
  return (
    positiveChannel(color, 0) * MSM_LUMINANCE_WEIGHTS[0] +
    positiveChannel(color, 1) * MSM_LUMINANCE_WEIGHTS[1] +
    positiveChannel(color, 2) * MSM_LUMINANCE_WEIGHTS[2]
  );
}






export function msmFireflyCeilingLuminance(neighborhoodMaxLuminance, frameLuminance) {
  return (
    finiteOr(neighborhoodMaxLuminance, 0) +
    MSM_FIREFLY_FRAME_LUMINANCE_RATIO * Math.max(finiteOr(frameLuminance, 0), 0)
  );
}


export function msmFallbackTargetLuminance(luminance, minimumLuminance, maximumLuminance) {
  return Math.min(
    Math.max(finiteOr(luminance, 0), finiteOr(minimumLuminance, 0)),
    finiteOr(maximumLuminance, 0),
  );
}


export function msmFallbackScale(luminance, targetLuminance) {
  return finiteOr(targetLuminance, 0) / Math.max(finiteOr(luminance, 0), MSM_FALLBACK_MINIMUM_LUMINANCE);
}


export function msmScaleColorToLuminance(color, minimumLuminance, maximumLuminance, target) {
  const luminance = msmFallbackLuminance(color);
  const targetLuminance = msmFallbackTargetLuminance(luminance, minimumLuminance, maximumLuminance);
  const scale = msmFallbackScale(luminance, targetLuminance);
  target[0] = positiveChannel(color, 0) * scale;
  target[1] = positiveChannel(color, 1) * scale;
  target[2] = positiveChannel(color, 2) * scale;
  operationCounter.colorScaleEvaluations += 1;
  return target;
}


export function msmFallbackPriorColor(
  coarsePrior,
  coarsePriorConfidence,
  neighborhoodMin,
  neighborhoodMax,
  target,
) {
  const confidence = clampConfidence(coarsePriorConfidence);
  for (let channel = 0; 3 > channel; channel += 1) {
    const neighborhoodMid = (positiveChannel(neighborhoodMin, channel) + positiveChannel(neighborhoodMax, channel)) * 0.5;
    target[channel] = neighborhoodMid * (1 - confidence) + positiveChannel(coarsePrior, channel) * confidence;
  }
  return target;
}





export function msmFireflyClampedSample(currentSample, neighborhoodMax, frameLuminance, target) {
  const ceilingLuminance = msmFireflyCeilingLuminance(msmFallbackLuminance(neighborhoodMax), frameLuminance);
  return msmScaleColorToLuminance(currentSample, 0, ceilingLuminance, target);
}


export function msmHistorySubstitute(
  coarsePrior,
  coarsePriorConfidence,
  neighborhoodMin,
  neighborhoodMax,
  frameLuminance,
  target,
) {
  msmFallbackPriorColor(coarsePrior, coarsePriorConfidence, neighborhoodMin, neighborhoodMax, scratchPriorColor);
  const floorLuminance = msmFallbackLuminance(neighborhoodMin);
  const ceilingLuminance = msmFireflyCeilingLuminance(msmFallbackLuminance(neighborhoodMax), frameLuminance);
  return msmScaleColorToLuminance(scratchPriorColor, floorLuminance, ceilingLuminance, target);
}


export function msmResolvedHistory(
  historyColor,
  historyConfidence,
  coarsePrior,
  coarsePriorConfidence,
  neighborhoodMin,
  neighborhoodMax,
  frameLuminance,
  target,
) {
  const confidence = clampConfidence(historyConfidence);
  msmHistorySubstitute(
    coarsePrior,
    coarsePriorConfidence,
    neighborhoodMin,
    neighborhoodMax,
    frameLuminance,
    scratchSubstituteColor,
  );
  for (let channel = 0; 3 > channel; channel += 1) {
    target[channel] =
      scratchSubstituteColor[channel] * (1 - confidence) + positiveChannel(historyColor, channel) * confidence;
  }
  operationCounter.resolvedHistoryCalls += 1;
  return target;
}


const scratchPriorColor = [0, 0, 0];
const scratchSubstituteColor = [0, 0, 0];
