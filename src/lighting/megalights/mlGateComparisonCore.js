export const ML_GATE_COMPARISON = Object.freeze({
  atLeast: "atLeast",
  atMost: "atMost",
  exactly: "exactly",


  withinRelativeTolerance: "withinRelativeTolerance",
  withinAbsoluteTolerance: "withinAbsoluteTolerance",
});

export function isKnownComparison(comparison) {
  return Object.prototype.hasOwnProperty.call(ML_GATE_COMPARISON, String(comparison));
}

export function isNumericTarget(target) {
  return typeof target === "number" && Number.isFinite(target);
}

function verdict(passed, expression) {
  return Object.freeze({ passed, reason: (passed ? "passed: " : "failed: ") + expression });
}













export function compareMeasurement(comparison, measured, target) {
  if (!isKnownComparison(comparison)) {
    return verdict(false, 'unknown comparison "' + String(comparison) + '"');
  }
  if (!isNumericTarget(target)) {
    return verdict(false, "the gate target is not a finite number");
  }
  if (!isNumericTarget(measured)) {
    return verdict(false, "nothing was measured yet");
  }

  if (comparison === ML_GATE_COMPARISON.atLeast) {
    return verdict(measured >= target, measured + " >= " + target);
  }
  if (comparison === ML_GATE_COMPARISON.atMost) {
    return verdict(measured <= target, measured + " <= " + target);
  }
  if (comparison === ML_GATE_COMPARISON.exactly) {
    return verdict(measured === target, measured + " === " + target);
  }


  return verdict(Math.abs(measured) <= target, "abs(" + measured + ") <= " + target);
}


export function isExecutableGate(gate) {
  return !!gate && isKnownComparison(gate.comparison) && isNumericTarget(gate.target);
}
