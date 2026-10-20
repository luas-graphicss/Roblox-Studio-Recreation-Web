import { SPATIAL_KERNEL } from "./mlSpatialFilterKernelCore.js";
import { VARIANCE_LIMITS } from "./mlTemporalVarianceCore.js";
import { MGL_GATES } from "./mlPipelineContract.js";

export const GATE_VERDICT = Object.freeze({
  pass: "pass",
  fail: "fail",
  notMeasured: "notMeasured",
});

export const SPATIAL_FILTER_GATES = Object.freeze({

  maximumTapsRequestedPerPixel: SPATIAL_KERNEL.tapCount,

  minimumTapSavingRatioVersusDenseKernel: 0.6,


  minimumDistinctRotations: 2,


  maximumRadiusInPixels: SPATIAL_KERNEL.maximumRadiusInPixels,

  minimumFramesBeforeSharpening: VARIANCE_LIMITS.minimumFramesForTrustedVariance,

  flagOffMinimumSsim: MGL_GATES.flagOffMinimumSsim,


  minimumBlurredPixelRatio: 0.5,
});

function verdictFor(isMeasured, isPassing) {
  if (!isMeasured) return GATE_VERDICT.notMeasured;
  return isPassing ? GATE_VERDICT.pass : GATE_VERDICT.fail;
}

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}


export function evaluateSpatialFilterGates(measured) {
  const values = measured && typeof measured === "object" ? measured : {};

  const blurredRatio =
    isNumber(values.blurredPixelCount) && isNumber(values.readPixelCount) && values.readPixelCount > 0
      ? values.blurredPixelCount / values.readPixelCount
      : null;

  const gates = [
    {
      id: "sparseTapBudget",
      description: "taps requested per pixel never exceed the sparse kernel budget",
      required: SPATIAL_FILTER_GATES.maximumTapsRequestedPerPixel,
      measured: values.meanTapsRequestedPerPixel,
      verdict: verdictFor(
        isNumber(values.meanTapsRequestedPerPixel),
        SPATIAL_FILTER_GATES.maximumTapsRequestedPerPixel >= values.meanTapsRequestedPerPixel,
      ),
    },
    {
      id: "cheaperThanDenseKernel",
      description: "the sparse kernel saves at least 60% of a dense 5x5 kernel",
      required: SPATIAL_FILTER_GATES.minimumTapSavingRatioVersusDenseKernel,
      measured: values.tapSavingRatioVersusDenseKernel,
      verdict: verdictFor(
        isNumber(values.tapSavingRatioVersusDenseKernel),
        values.tapSavingRatioVersusDenseKernel >=
          SPATIAL_FILTER_GATES.minimumTapSavingRatioVersusDenseKernel,
      ),
    },
    {
      id: "kernelRotatesPerPixel",
      description: "the kernel rotation differs between pixels, so the sparse pattern cannot stand still",
      required: SPATIAL_FILTER_GATES.minimumDistinctRotations,
      measured: values.distinctRotationCount,
      verdict: verdictFor(
        isNumber(values.distinctRotationCount),
        values.distinctRotationCount >= SPATIAL_FILTER_GATES.minimumDistinctRotations,
      ),
    },
    {
      id: "radiusCeiling",
      description: "no pixel is filtered wider than the declared maximum radius",
      required: SPATIAL_FILTER_GATES.maximumRadiusInPixels,
      measured: values.maximumRadiusUsedInPixels,
      verdict: verdictFor(
        isNumber(values.maximumRadiusUsedInPixels),
        SPATIAL_FILTER_GATES.maximumRadiusInPixels >= values.maximumRadiusUsedInPixels,
      ),
    },
    {
      id: "filterActuallyFilters",
      description: "at least half of the pixels handed to the filter come out changed",
      required: SPATIAL_FILTER_GATES.minimumBlurredPixelRatio,
      measured: blurredRatio,
      verdict: verdictFor(
        isNumber(blurredRatio),
        blurredRatio >= SPATIAL_FILTER_GATES.minimumBlurredPixelRatio,
      ),
    },
    {
      id: "edgeStoppingHasGeometry",
      description: "depth or normal reached the filter, so the blur cannot bleed across surfaces",
      required: true,
      measured:
        values.edgeStoppingUsedDepth === undefined && values.edgeStoppingUsedNormal === undefined
          ? undefined
          : values.edgeStoppingUsedDepth === true || values.edgeStoppingUsedNormal === true,
      verdict: verdictFor(
        values.edgeStoppingUsedDepth !== undefined || values.edgeStoppingUsedNormal !== undefined,
        values.edgeStoppingUsedDepth === true || values.edgeStoppingUsedNormal === true,
      ),
    },
    {
      id: "flagOffIsByteForByte",
      description: "with the flag off the frame is the legacy image",
      required: SPATIAL_FILTER_GATES.flagOffMinimumSsim,
      measured: values.flagOffSsim,
      verdict: verdictFor(
        isNumber(values.flagOffSsim),
        values.flagOffSsim >= SPATIAL_FILTER_GATES.flagOffMinimumSsim,
      ),
    },
  ];

  const passCount = gates.filter((gate) => gate.verdict === GATE_VERDICT.pass).length;
  const failCount = gates.filter((gate) => gate.verdict === GATE_VERDICT.fail).length;
  return {
    gates,
    passCount,
    failCount,
    notMeasuredCount: gates.length - passCount - failCount,
    allMeasuredGatesPass: failCount === 0,
  };
}
