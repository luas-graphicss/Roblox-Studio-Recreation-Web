export const MSM_GATE_COMPARISON = Object.freeze({
  atLeast: "atLeast",
  atMost: "atMost",
  exactly: "exactly",


  insideInclusiveRange: "insideInclusiveRange",


  withinRelativeTolerance: "withinRelativeTolerance",
  withinAbsoluteTolerance: "withinAbsoluteTolerance",
});

export const MSM_REQUIREMENT_STATUS = Object.freeze({


  pending: "pending",
  passed: "passed",
  failed: "failed",
});

export function isKnownComparison(comparison) {
  return Object.prototype.hasOwnProperty.call(MSM_GATE_COMPARISON, String(comparison));
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function comparisonNeedsCeiling(comparison) {
  return comparison === MSM_GATE_COMPARISON.insideInclusiveRange;
}


export function requirementIsExecutable(requirement) {
  if (!requirement || typeof requirement.metric !== "string" || requirement.metric.length === 0) {
    return false;
  }
  if (!isKnownComparison(requirement.comparison)) {
    return false;
  }
  if (!isFiniteNumber(requirement.target)) {
    return false;
  }
  if (comparisonNeedsCeiling(requirement.comparison)) {
    return isFiniteNumber(requirement.targetCeiling) && requirement.targetCeiling > requirement.target;
  }
  return true;
}

function describeComparison(requirement, measuredValue) {
  if (requirement.comparison === MSM_GATE_COMPARISON.atLeast) {
    return measuredValue + " >= " + requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.atMost) {
    return measuredValue + " <= " + requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.exactly) {
    return measuredValue + " === " + requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.insideInclusiveRange) {
    return requirement.target + " <= " + measuredValue + " <= " + requirement.targetCeiling;
  }
  return "abs(" + measuredValue + ") <= " + requirement.target;
}

function measurementSatisfies(requirement, measuredValue) {
  if (requirement.comparison === MSM_GATE_COMPARISON.atLeast) {
    return measuredValue >= requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.atMost) {
    return measuredValue <= requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.exactly) {
    return measuredValue === requirement.target;
  }
  if (requirement.comparison === MSM_GATE_COMPARISON.insideInclusiveRange) {
    return measuredValue >= requirement.target && measuredValue <= requirement.targetCeiling;
  }


  return Math.abs(measuredValue) <= requirement.target;
}

function requirementVerdict(metric, status, reason) {
  return Object.freeze({
    metric,
    status,
    passed: status === MSM_REQUIREMENT_STATUS.passed,
    blocks: status !== MSM_REQUIREMENT_STATUS.passed,
    reason,
  });
}


export function evaluateRequirement(requirement, measuredValue) {
  const metric = requirement && typeof requirement.metric === "string" ? requirement.metric : "unnamedMetric";
  if (!requirementIsExecutable(requirement)) {
    return requirementVerdict(metric, MSM_REQUIREMENT_STATUS.failed, "the requirement is not executable by a spec");
  }
  if (!isFiniteNumber(measuredValue)) {
    return requirementVerdict(metric, MSM_REQUIREMENT_STATUS.pending, "nothing was measured yet");
  }
  const satisfied = measurementSatisfies(requirement, measuredValue);
  const expression = describeComparison(requirement, measuredValue) + " (" + (requirement.unit || "unitless") + ")";
  return requirementVerdict(
    metric,
    satisfied ? MSM_REQUIREMENT_STATUS.passed : MSM_REQUIREMENT_STATUS.failed,
    (satisfied ? "passed: " : "failed: ") + expression,
  );
}
