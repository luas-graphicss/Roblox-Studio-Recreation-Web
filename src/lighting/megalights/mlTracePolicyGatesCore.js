import { ML_GATE_COMPARISON, compareMeasurement } from "./mlGateComparisonCore.js";
import { raysToCompleteOneSample } from "./mlTraceRayBudgetCore.js";

export const TRACE_POLICY_WEAK_TIER_NAME = "fraco";

export const TRACE_POLICY_GATES = Object.freeze({
  maximumUnresolvedSamples: 0,
  maximumRetracedResolvedSamples: 0,
  maximumUnlabelledFallbacks: 0,

  weakTierRaysPerSample: 1,
  maximumRayCountDifferenceAcrossLightCounts: 0,
});


export function maximumRaysPerSampleOnTier(tierName) {


  return raysToCompleteOneSample(tierName);
}

function measurementOf(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function gateRow(definition) {
  const verdict = compareMeasurement(definition.comparison, definition.measured, definition.target);
  return Object.freeze({
    metric: definition.metric,
    comparison: definition.comparison,
    measured: definition.measured,
    target: definition.target,
    unit: definition.unit,
    description: definition.description,
    passed: verdict.passed,
    reason: verdict.reason,
  });
}


export function evaluateTracePolicy(run) {
  const report = run || {};
  const tierName = report.tierName;
  const rows = [
    gateRow({
      metric: "unresolvedSamplesAfterCascade",
      comparison: ML_GATE_COMPARISON.atMost,
      measured: measurementOf(report.unresolvedSampleCount),
      target: TRACE_POLICY_GATES.maximumUnresolvedSamples,
      unit: "samples",
      description: "no sample leaves the cascade still unknown",
    }),
    gateRow({
      metric: "retracedResolvedSamples",
      comparison: ML_GATE_COMPARISON.atMost,
      measured: measurementOf(report.retracedResolvedSampleCount),
      target: TRACE_POLICY_GATES.maximumRetracedResolvedSamples,
      unit: "samples",
      description: "only samples still unknown are promoted to the next tracer",
    }),
    gateRow({
      metric: "unlabelledFallbacks",
      comparison: ML_GATE_COMPARISON.atMost,
      measured: measurementOf(report.unlabelledFallbackCount),
      target: TRACE_POLICY_GATES.maximumUnlabelledFallbacks,
      unit: "samples",
      description: "every fallback carries the policyFallback kind and a named reason",
    }),
    gateRow({
      metric: "raysPerSample",
      comparison: ML_GATE_COMPARISON.atMost,
      measured: measurementOf(report.raysPerSample),
      target: maximumRaysPerSampleOnTier(tierName),
      unit: "rays",
      description: "one trace attempt per cascade step at most, so the cost follows the sample budget",
    }),
  ];

  if (tierName === TRACE_POLICY_WEAK_TIER_NAME) {


    rows.push(
      gateRow({
        metric: "raysPerPixelOnTheWeakTier",
        comparison: ML_GATE_COMPARISON.exactly,
        measured: measurementOf(report.raysPerSample),
        target: TRACE_POLICY_GATES.weakTierRaysPerSample,
        unit: "rays",
        description: "exactly one ray per pixel on the weak tier, with no visibility hole",
      })
    );
  }

  return Object.freeze({
    tierName,
    pass: rows.every((row) => row.passed),
    rows: Object.freeze(rows),
    failedMetrics: Object.freeze(rows.filter((row) => !row.passed).map((row) => row.metric)),
  });
}


export function evaluateRayCostAgainstLightCount(runWithFewLights, runWithManyLights) {
  const fewLights = runWithFewLights || {};
  const manyLights = runWithManyLights || {};
  const raysWithFewLights = measurementOf(fewLights.raysSpentTotal);
  const raysWithManyLights = measurementOf(manyLights.raysSpentTotal);
  const rayCountDifference =
    raysWithFewLights === null || raysWithManyLights === null
      ? null
      : Math.abs(raysWithManyLights - raysWithFewLights);

  return gateRow({
    metric: "rayCountDifferenceAcrossLightCounts",
    comparison: ML_GATE_COMPARISON.withinAbsoluteTolerance,
    measured: rayCountDifference,
    target: TRACE_POLICY_GATES.maximumRayCountDifferenceAcrossLightCounts,
    unit: "rays",
    description: "the ray budget is sized by samples, so the light count cannot change it",
  });
}
