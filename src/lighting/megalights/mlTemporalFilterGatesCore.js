import { REPROJECTION_LIMITS } from "./mlTemporalReprojectionCore.js";
import { ACCUMULATION_LIMITS } from "./mlTemporalAccumulationCore.js";

export const TEMPORAL_FILTER_GATES = Object.freeze({

  maximumVarianceErrorRatio: 0.05,

  maximumFramesToWarmHistory: ACCUMULATION_LIMITS.maximumHistoryFrameCount,
  maximumMonotoneConvergenceViolations: 0,

  maximumStaticReprojectionErrorInPixels: REPROJECTION_LIMITS.maximumStaticReprojectionErrorInPixels,

  temporalPassesPerFrame: 1,


  maximumGhostLuminanceRatio: 0.02,
});

const GATE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "varianceMatchesOfflineReference",
    measurement: "varianceErrorRatio",
    comparison: "atMost",
    limit: TEMPORAL_FILTER_GATES.maximumVarianceErrorRatio,
    detail: "Temporal variance against the offline variance of the same samples.",
  }),
  Object.freeze({
    id: "staticPixelWarmsHistoryWithinBudget",
    measurement: "framesToWarmHistory",
    comparison: "atMost",
    limit: TEMPORAL_FILTER_GATES.maximumFramesToWarmHistory,
    detail: "Frames until a static pixel reaches the full history window.",
  }),
  Object.freeze({
    id: "staticPixelConvergesMonotonically",
    measurement: "monotoneConvergenceViolations",
    comparison: "exactly",
    limit: TEMPORAL_FILTER_GATES.maximumMonotoneConvergenceViolations,
    detail: "Frames where the error toward the target grew instead of shrinking.",
  }),
  Object.freeze({
    id: "staticPixelReprojectsWithinSubpixelBudget",
    measurement: "staticReprojectionErrorInPixels",
    comparison: "atMost",
    limit: TEMPORAL_FILTER_GATES.maximumStaticReprojectionErrorInPixels,
    detail: "Reprojection error of a pixel that did not move, in pixels.",
  }),
  Object.freeze({
    id: "singleTemporalPassPerFrame",
    measurement: "temporalPassesPerFrame",
    comparison: "exactly",
    limit: TEMPORAL_FILTER_GATES.temporalPassesPerFrame,
    detail: "Temporal resolves executed per frame, counted by the pass itself.",
  }),
  Object.freeze({
    id: "noGhostingAfterDisocclusion",
    measurement: "ghostLuminanceRatio",
    comparison: "atMost",
    limit: TEMPORAL_FILTER_GATES.maximumGhostLuminanceRatio,
    detail: "Leftover of the rejected history in the pixel after a disocclusion.",
  }),
]);

export function temporalFilterGateIds() {
  return Object.freeze(GATE_DEFINITIONS.map((definition) => definition.id));
}





export function evaluateTemporalFilterGates(measurements) {
  const measured = measurements || {};
  const results = GATE_DEFINITIONS.map((definition) => {
    const value = measured[definition.measurement];
    const isNumber = typeof value === "number" && Number.isFinite(value);
    if (!isNumber) {
      return Object.freeze({
        id: definition.id,
        measurement: definition.measurement,
        measured: null,
        limit: definition.limit,
        comparison: definition.comparison,
        status: "notMeasured",
        passed: false,
        detail: definition.detail,
      });
    }
    const passed = definition.comparison === "exactly" ? value === definition.limit : value <= definition.limit;
    return Object.freeze({
      id: definition.id,
      measurement: definition.measurement,
      measured: value,
      limit: definition.limit,
      comparison: definition.comparison,
      status: passed ? "passed" : "failed",
      passed,
      detail: definition.detail,
    });
  });

  return Object.freeze({
    passed: results.every((result) => result.passed),
    results: Object.freeze(results),
    notMeasuredGateIds: Object.freeze(
      results.filter((result) => result.status === "notMeasured").map((result) => result.id),
    ),
    failedGateIds: Object.freeze(results.filter((result) => result.status === "failed").map((result) => result.id)),
  });
}
