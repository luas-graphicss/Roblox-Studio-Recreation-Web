import { isText } from "./certificationData.js";

function hasMeasuredValue(value, depth = 0) {
  if (depth > 32 || value == null) return false;
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isText(value);
  if (typeof value !== "object") return false;
  const children = Object.values(value);
  return children.length > 0 && children.every((child) => hasMeasuredValue(child, depth + 1));
}

export function validateCertificationExecution(evidence) {
  const checks = evidence.checks;
  if (!Array.isArray(checks) || checks.length === 0) throw new Error("Nonempty measured checks are required");
  const identifiers = new Set();
  for (const check of checks) {
    if (!check || !isText(check.id) || identifiers.has(check.id) || check.status !== "passed" || !hasMeasuredValue(check.observed)) {
      throw new Error("Distinct passed checks must contain actual observations, not missing measurements");
    }
    identifiers.add(check.id);
  }
  const execution = evidence.execution;
  if (execution?.exitCode !== 0 || !isText(execution.runner) || !Number.isFinite(Date.parse(execution.completedAt))) {
    throw new Error("An identified successful execution is required");
  }
  if (!Number.isSafeInteger(execution.passed) || execution.passed < 1 || ["failed", "todo", "skipped"].some((field) => execution[field] !== 0)) {
    throw new Error("Zero-test, failed, skipped and TODO runs cannot pass any certification gate");
  }
}
