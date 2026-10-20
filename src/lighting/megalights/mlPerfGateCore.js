import { MGL_GATES } from "./mlPipelineContract.js";

export const GATE_VERDICT = Object.freeze({
  pass: "pass",
  fail: "fail",
  notMeasured: "notMeasured",
  invalid: "invalid",
});

export const MEASUREMENT_VALIDITY = Object.freeze({
  valid: "valid",
  clockFrozen: "clockFrozen",
  guardRefused: "guardRefused",
});

export const VALIDITY_REASONS = Object.freeze({
  valid: "the real clock advanced and the measurement guard accepted the sample",
  clockFrozen:
    "the real clock is frozen: the preview is hidden or the project is not active on screen, so every wall-clock number is throttled fiction",
  guardRefused:
    "the measurement guard refused the sample (measurementValid: false), so no wall-clock number from it is admissible",
});


const COMPARISON = Object.freeze({ atMost: "atMost", atLeast: "atLeast" });


export const PERFORMANCE_GATE_ROWS = Object.freeze([
  {
    id: "fixedCostWithinTolerance",
    description: "the cost stays fixed as lights are added, within 15%",
    measurementKey: "fixedCostRatio",
    required: MGL_GATES.fixedCostToleranceRatio,
    comparison: COMPARISON.atMost,
    dependsOnWallClock: true,
  },
  {
    id: "simultaneousAreaLightsStrongTier",
    description: "at least 512 simultaneous area lights on the strong tier",
    measurementKey: "simultaneousAreaLights",
    required: MGL_GATES.minSimultaneousAreaLightsStrongTier,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: false,
  },
  {
    id: "totalFrameMillisecondsStrongTier",
    description: "the whole MegaLights path fits in 5 ms on the strong tier",
    measurementKey: "totalMillisecondsStrongTier",
    required: MGL_GATES.maxTotalMillisecondsStrongTier,
    comparison: COMPARISON.atMost,
    dependsOnWallClock: true,
  },
  {
    id: "flagOffIsByteForByte",
    description: "with every flag off the frame is the legacy image",
    measurementKey: "flagOffSsim",
    required: MGL_GATES.flagOffMinimumSsim,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: false,
  },
  {
    id: "overheadWithAllFlagsOff",
    description: "a switched-off MegaLights costs almost nothing",
    measurementKey: "overheadMillisecondsAllFlagsOff",
    required: MGL_GATES.maxOverheadMillisecondsAllFlagsOff,
    comparison: COMPARISON.atMost,
    dependsOnWallClock: true,
  },
  {
    id: "framesPerSecondMediumTier",
    description: "30 fps on the medium tier",
    measurementKey: "framesPerSecondMediumTier",
    required: MGL_GATES.minFramesPerSecondMediumTier,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: true,
  },
  {
    id: "framesPerSecondStrongTier",
    description: "45 fps on the strong tier",
    measurementKey: "framesPerSecondStrongTier",
    required: MGL_GATES.minFramesPerSecondStrongTier,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: true,
  },
  {
    id: "warmupSpike",
    description: "the first frame after a tier change stays under 12 ms",
    measurementKey: "warmupSpikeMilliseconds",
    required: MGL_GATES.maxWarmupSpikeMilliseconds,
    comparison: COMPARISON.atMost,
    dependsOnWallClock: true,
  },
  {
    id: "fireflyRatio",
    description: "almost no firefly pixels survive the denoiser",
    measurementKey: "fireflyLuminanceRatio",
    required: MGL_GATES.maxFireflyLuminanceRatio,
    comparison: COMPARISON.atMost,
    dependsOnWallClock: false,
  },
  {
    id: "shadingConfidenceCorrelation",
    description: "the confidence signal really correlates with the shading error",
    measurementKey: "shadingConfidenceCorrelation",
    required: MGL_GATES.minShadingConfidenceCorrelation,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: false,
  },
  {
    id: "blindRoundEvaluators",
    description: "at least 3 evaluators took the blind round",
    measurementKey: "blindRoundEvaluators",
    required: MGL_GATES.blindRoundMinimumEvaluators,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: false,
  },
  {
    id: "blindRoundConfusionRate",
    description: "evaluators cannot reliably tell our image from the reference",
    measurementKey: "blindRoundConfusionRate",
    required: MGL_GATES.blindRoundMinimumConfusionRate,
    comparison: COMPARISON.atLeast,
    dependsOnWallClock: false,
  },
]);

function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}






export function measurementValidityOf(request) {
  const input = request || {};
  if (input.realClockFrozen === true) {
    return { validity: MEASUREMENT_VALIDITY.clockFrozen, reason: VALIDITY_REASONS.clockFrozen };
  }
  if (input.measurementValid === false) {
    return { validity: MEASUREMENT_VALIDITY.guardRefused, reason: VALIDITY_REASONS.guardRefused };
  }
  return { validity: MEASUREMENT_VALIDITY.valid, reason: VALIDITY_REASONS.valid };
}

function verdictForRow(row, measuredValue, validity) {
  if (!isNumber(measuredValue)) return GATE_VERDICT.notMeasured;
  if (row.dependsOnWallClock && validity !== MEASUREMENT_VALIDITY.valid) return GATE_VERDICT.invalid;
  const isPassing =
    row.comparison === COMPARISON.atMost ? row.required >= measuredValue : measuredValue >= row.required;
  return isPassing ? GATE_VERDICT.pass : GATE_VERDICT.fail;
}


export function evaluatePerformanceGates(request) {
  const input = request || {};
  const measured = input.measured && typeof input.measured === "object" ? input.measured : {};
  const validityReport = measurementValidityOf(input);

  const rows = PERFORMANCE_GATE_ROWS.map((row) => {
    const measuredValue = measured[row.measurementKey];
    const verdict = verdictForRow(row, measuredValue, validityReport.validity);
    return {
      id: row.id,
      description: row.description,
      required: row.required,
      comparison: row.comparison,
      measured: isNumber(measuredValue) ? measuredValue : null,
      dependsOnWallClock: row.dependsOnWallClock,
      verdict,
      reason: verdict === GATE_VERDICT.invalid ? validityReport.reason : null,
    };
  });

  const countOf = (verdict) => rows.filter((row) => row.verdict === verdict).length;
  const passCount = countOf(GATE_VERDICT.pass);
  const failCount = countOf(GATE_VERDICT.fail);
  const invalidCount = countOf(GATE_VERDICT.invalid);
  const notMeasuredCount = countOf(GATE_VERDICT.notMeasured);

  return {
    rows,
    total: rows.length,
    passCount,
    failCount,
    invalidCount,
    notMeasuredCount,
    measurementValidity: validityReport.validity,
    measurementReason: validityReport.reason,


    certified: failCount === 0 && invalidCount === 0 && notMeasuredCount === 0,
    allMeasuredGatesPass: failCount === 0,
  };
}


export function describePerformanceVerdict(report) {
  if (!report) return "performance gates: not evaluated";
  return (
    "performance gates: " +
    report.passCount +
    " pass, " +
    report.failCount +
    " fail, " +
    report.invalidCount +
    " invalid, " +
    report.notMeasuredCount +
    " not measured (" +
    report.measurementValidity +
    ")"
  );
}
